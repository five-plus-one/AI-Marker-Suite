// ========== 供应商管理器 ==========
const ProviderManager = {
    data: null,
    init() {
        try {
            let saved = GM_getValue('ai-grading-providers-v2');
            if (saved) {
                this.data = JSON.parse(saved);
                // 迁移：更新内置供应商的模型配置
                this._migrateProviders();
            } else {
                // 尝试迁移旧格式
                const oldSaved = GM_getValue('ai-grading-providers');
                if (oldSaved) {
                    this.data = this._migrateFromV1(JSON.parse(oldSaved));
                } else {
                    this.data = this._getDefault();
                }
                this.save();
            }
        } catch (e) {
            console.error('❌ ProviderManager init failed, using defaults:', e);
            this.data = this._getDefault();
        }
    },
    _migrateProviders() {
        let changed = false;
        const defaults = this._getDefault();

        // 确保内置供应商存在且模型正确
        for (const [name, defaultProvider] of Object.entries(defaults.providers)) {
            if (!defaultProvider.isBuiltin) continue;

            let provider = this.data.providers[name];
            if (!provider) {
                // 内置供应商不存在，添加它
                this.data.providers[name] = { ...defaultProvider };
                changed = true;
                console.log(`[ProviderManager] 添加内置供应商 "${name}"`);
                continue;
            }

            // 确保内置模型存在
            for (const [modelId, modelInfo] of Object.entries(defaultProvider.models)) {
                if (!provider.models[modelId]) {
                    provider.models[modelId] = { ...modelInfo };
                    changed = true;
                    console.log(`[ProviderManager] 添加内置模型 "${modelId}" 到供应商 "${name}"`);
                } else {
                    // 确保内置模型的 isBuiltin 标记正确
                    if (modelInfo.isBuiltin && !provider.models[modelId].isBuiltin) {
                        provider.models[modelId].isBuiltin = true;
                        changed = true;
                    }
                }
            }

            // 确保供应商的 isBuiltin 标记正确
            if (defaultProvider.isBuiltin && !provider.isBuiltin) {
                provider.isBuiltin = true;
                changed = true;
            }
        }

        if (changed) {
            this.save();
        }
    },
    _getDefault() {
        return {
            providers: {
                "5plus1官方": {
                    endpoint: SCRIPT_CONFIG.DEFAULT_ENDPOINT,
                    apiKey: "",
                    models: {
                        "aimarker-fast": { label: "快速批改", tags: ["轻量", "推荐"], isBuiltin: true },
                        "aimarker-pro": { label: "高精度批改", tags: ["专业", "推荐"], isBuiltin: true }
                    },
                    isBuiltin: true
                },
                "火山引擎": {
                    endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
                    apiKey: "",
                    models: {
                        "doubao-seed-2-0-lite-260428": { label: "豆包 Seed Lite", tags: ["轻量"] },
                        "doubao-seed-2-0-pro-260215": { label: "豆包 Seed Pro", tags: ["专业"] }
                    }
                },
                "OpenAI兼容": {
                    endpoint: "https://api.openai.com/v1/chat/completions",
                    apiKey: "",
                    models: {
                        "gpt-4o": { label: "GPT-4o", tags: ["专业"] },
                        "gpt-4o-mini": { label: "GPT-4o Mini", tags: ["轻量"] }
                    }
                }
            },
            activeProvider: "5plus1官方",
            activeModel: "aimarker-fast"
        };
    },
    _migrateFromV1(oldData) {
        const newData = this._getDefault();
        if (oldData.list) {
            for (const [name, config] of Object.entries(oldData.list)) {
                if (!newData.providers[name]) {
                    newData.providers[name] = {
                        endpoint: config.endpoint || '',
                        apiKey: config.apiKey || '',
                        models: {}
                    };
                }
                if (config.model) {
                    newData.providers[name].models[config.model] = { label: config.model, tags: [] };
                }
            }
        }
        if (oldData.active && newData.providers[oldData.active]) {
            newData.activeProvider = oldData.active;
            const provider = newData.providers[oldData.active];
            const modelKeys = Object.keys(provider.models);
            if (modelKeys.length > 0) {
                newData.activeModel = modelKeys[0];
            }
        }
        console.log('[ProviderManager] 已从 v1 格式迁移');
        return newData;
    },
    save() {
        GM_setValue('ai-grading-providers-v2', JSON.stringify(this.data));
    },
    getProvider(name) {
        return this.data.providers[name] || null;
    },
    getCurrentProvider() {
        return this.data.providers[this.data.activeProvider] || {};
    },
    getCurrentModel() {
        const provider = this.getCurrentProvider();
        return provider.models?.[this.data.activeModel] || {};
    },
    getCurrentEndpoint() {
        return this.getCurrentProvider().endpoint || SCRIPT_CONFIG.DEFAULT_ENDPOINT;
    },
    getCurrentApiKey() {
        return this.getCurrentProvider().apiKey || '';
    },
    getCurrentModelId() {
        return this.data.activeModel || '';
    },
    // 获取完整调用配置
    getCallConfig(providerName, modelId) {
        const provider = this.data.providers[providerName];
        if (!provider) return null;
        return {
            endpoint: provider.endpoint,
            apiKey: provider.apiKey,
            model: modelId
        };
    },
    // 添加供应商
    addProvider(name, config) {
        this.data.providers[name] = {
            endpoint: config.endpoint || '',
            apiKey: config.apiKey || '',
            models: config.models || {}
        };
        this.save();
    },
    // 删除供应商
    deleteProvider(name) {
        const provider = this.data.providers[name];
        if (!provider) return false;
        if (provider.isBuiltin) {
            console.warn('⚠️ 不能删除内置供应商');
            return false;
        }
        if (Object.keys(this.data.providers).length <= 1) return false;
        delete this.data.providers[name];
        if (this.data.activeProvider === name) {
            this.data.activeProvider = Object.keys(this.data.providers)[0];
            const provider = this.getCurrentProvider();
            const modelKeys = Object.keys(provider.models || {});
            this.data.activeModel = modelKeys[0] || '';
        }
        this.save();
        return true;
    },
    // 添加模型
    addModel(providerName, modelId, label, tags) {
        const provider = this.data.providers[providerName];
        if (!provider) return false;
        provider.models[modelId] = { label: label || modelId, tags: tags || [] };
        this.save();
        return true;
    },
    // 删除模型
    deleteModel(providerName, modelId) {
        const provider = this.data.providers[providerName];
        if (!provider || !provider.models[modelId]) return false;
        // 内置模型不允许删除
        if (provider.models[modelId].isBuiltin) {
            console.warn('⚠️ 不能删除内置模型');
            return false;
        }
        if (Object.keys(provider.models).length <= 1) return false;
        delete provider.models[modelId];
        if (this.data.activeProvider === providerName && this.data.activeModel === modelId) {
            this.data.activeModel = Object.keys(provider.models)[0] || '';
        }
        this.save();
        return true;
    },
    // 设置当前活跃
    setActive(providerName, modelId) {
        if (this.data.providers[providerName]) {
            this.data.activeProvider = providerName;
            if (modelId && this.data.providers[providerName].models[modelId]) {
                this.data.activeModel = modelId;
            }
            this.save();
        }
    }
};
ProviderManager.init();

// ========== 工作流管理器 ==========
const WorkflowManager = {
    data: null,
    init() {
        try {
            let saved = GM_getValue('ai-grading-workflows');
            if (saved) {
                this.data = JSON.parse(saved);
                // 迁移：更新内置工作流的模型配置
                this._migrateWorkflows();
            } else {
                this.data = this._getDefault();
                this.save();
            }
        } catch (e) {
            console.error('❌ WorkflowManager init failed, using defaults:', e);
            this.data = this._getDefault();
        }
    },
    _migrateWorkflows() {
        let changed = false;
        const defaults = this._getDefault();
        const currentVersion = SCRIPT_CONFIG.VERSION;
        const lastMigratedVersion = this.data._migratedVersion || '';

        // 仅在版本升级时重置内置工作流的模型配置，避免覆盖用户手动修改
        const shouldMigrateDefaults = lastMigratedVersion !== currentVersion;

        for (const [name, wf] of Object.entries(this.data.workflows)) {
            if (wf.isBuiltin && defaults.workflows[name]) {
                const defaultWf = defaults.workflows[name];
                // 迁移 reasoningEffort 字段（始终执行，因为旧数据可能缺少此字段）
                if (wf.model && defaultWf.model && wf.model.reasoningEffort === undefined) {
                    wf.model.reasoningEffort = defaultWf.model.reasoningEffort || '';
                    changed = true;
                }
                // 仅在版本升级时补充缺失字段，不覆盖用户已修改的配置
                if (shouldMigrateDefaults) {
                    // 模型配置：仅补充缺失字段，不整体替换（用户可自定义 provider/model）
                    if (wf.model && defaultWf.model) {
                        for (const k of Object.keys(defaultWf.model)) {
                            if (wf.model[k] === undefined) {
                                wf.model[k] = defaultWf.model[k];
                                changed = true;
                            }
                        }
                    }
                    // 双评配置：仅补充新增字段，不覆盖用户已修改的值（如 threshold）
                    if (defaultWf.dualEval && wf.dualEval) {
                        for (const key of Object.keys(defaultWf.dualEval)) {
                            if (wf.dualEval[key] === undefined) {
                                wf.dualEval[key] = defaultWf.dualEval[key];
                                changed = true;
                            }
                        }
                        // secondary/arbitration 子对象：只填缺失字段，不整体替换
                        for (const subKey of ['secondary', 'arbitration']) {
                            if (defaultWf.dualEval[subKey] && wf.dualEval[subKey]) {
                                for (const k of Object.keys(defaultWf.dualEval[subKey])) {
                                    if (wf.dualEval[subKey][k] === undefined) {
                                        wf.dualEval[subKey][k] = defaultWf.dualEval[subKey][k];
                                        changed = true;
                                    }
                                }
                            } else if (defaultWf.dualEval[subKey] && !wf.dualEval[subKey]) {
                                wf.dualEval[subKey] = defaultWf.dualEval[subKey];
                                changed = true;
                            }
                        }
                    } else if (defaultWf.dualEval && !wf.dualEval) {
                        wf.dualEval = defaultWf.dualEval;
                        changed = true;
                    }
                }
            }
        }
        if (changed || shouldMigrateDefaults) {
            this.data._migratedVersion = currentVersion;
            console.log('[WorkflowManager] 已迁移内置工作流配置');
            this.save();
        }
    },
    _getDefault() {
        return {
            workflows: {
                "快速批改(推荐)": {
                    id: "fast",
                    description: "快速低价，适合大多数题型",
                    model: { provider: "5plus1官方", model: "aimarker-fast", reasoningEffort: "minimal" },
                    dualEval: null,
                    isBuiltin: true
                },
                "普通批改": {
                    id: "normal",
                    description: "响应速度较慢，消耗额度相对较高，准确度较高",
                    model: { provider: "5plus1官方", model: "aimarker-pro", reasoningEffort: "" },
                    dualEval: null,
                    isBuiltin: true
                },
                "双评模式(高精度)": {
                    id: "dual",
                    description: "兼顾准确度、速度与价格",
                    model: { provider: "5plus1官方", model: "aimarker-fast", reasoningEffort: "minimal" },
                    dualEval: {
                        enabled: true,
                        secondary: { provider: "5plus1官方", model: "aimarker-fast", reasoningEffort: "minimal" },
                        arbitration: { provider: "5plus1官方", model: "aimarker-pro", reasoningEffort: "" },
                        threshold: 2
                    },
                    isBuiltin: true
                }
            },
            activeWorkflow: "fast"
        };
    },
    save() {
        GM_setValue('ai-grading-workflows', JSON.stringify(this.data));
    },
    getWorkflow(id) {
        // 按 id 查找
        for (const [name, wf] of Object.entries(this.data.workflows)) {
            if (wf.id === id) return { ...wf, name };
        }
        // 按名称查找（兼容）
        if (this.data.workflows[id]) {
            return { ...this.data.workflows[id], name: id };
        }
        return null;
    },
    getActiveWorkflow() {
        return this.getWorkflow(this.data.activeWorkflow) || this.getWorkflow('fast');
    },
    getWorkflowModelConfig(workflowId) {
        const wf = this.getWorkflow(workflowId);
        if (!wf || !wf.model) return null;
        const callConfig = ProviderManager.getCallConfig(wf.model.provider, wf.model.model);
        if (callConfig && wf.model.reasoningEffort) {
            callConfig.reasoningEffort = wf.model.reasoningEffort;
        }
        if (callConfig) {
            callConfig.outputLimitEnabled = wf.outputLimitEnabled !== false;
            callConfig.maxOutputTokens = wf.maxOutputTokens || 2048;
        }
        return callConfig;
    },
    setActive(id) {
        this.data.activeWorkflow = id;
        this.save();
    },
    addWorkflow(name, config) {
        this.data.workflows[name] = {
            id: config.id || name.toLowerCase().replace(/\s+/g, '-'),
            description: config.description || '',
            model: config.model || { provider: "", model: "", reasoningEffort: "" },
            dualEval: config.dualEval || null,
            isBuiltin: false
        };
        this.save();
    },
    updateWorkflow(name, config) {
        if (!this.data.workflows[name]) return false;
        Object.assign(this.data.workflows[name], config);
        this.save();
        return true;
    },
    deleteWorkflow(name) {
        const wf = this.data.workflows[name];
        if (!wf || wf.isBuiltin) return false;
        delete this.data.workflows[name];
        if (this.data.activeWorkflow === (wf.id || name)) {
            this.data.activeWorkflow = 'fast';
        }
        this.save();
        return true;
    },
    // 获取所有工作流列表
    getAll() {
        return Object.entries(this.data.workflows).map(([name, wf]) => ({
            ...wf, name
        }));
    }
};
WorkflowManager.init();

// ========== 通用 AI 请求函数 ==========
function callAIOnce(prompt, base64DataArray, config, onStreamUpdate, extraImages, maxTokens) {
    return new Promise((resolve, reject) => {
        const messageContent = [{ type: "text", text: prompt }];
        // 合并额外图片（来自题目/答案/评分标准）+ 学生答题卡图片
        var allImages = (extraImages && extraImages.length) ? extraImages.concat(base64DataArray) : base64DataArray;
        allImages.forEach(base64Data => {
            messageContent.push({ type: "image_url", image_url: { url: `data:image/png;base64,${base64Data}` } });
        });

        const requestBody = {
            model: config.model,
            messages: [{ role: "user", content: messageContent }],
            stream: true
        };
        if (maxTokens !== null) requestBody.max_tokens = maxTokens;

        // 如果配置了思考链深度，添加 reasoning_effort 参数
        if (config.reasoningEffort) {
            requestBody.reasoning_effort = config.reasoningEffort;
        }

        console.log(`📤 发送请求到: ${config.endpoint} (模型: ${config.model}${config.reasoningEffort ? ', 思考深度: ' + config.reasoningEffort : ''})`);

        let fullText = '';
        let buffer = '';
        let settled = false;
        let progressCallCount = 0;
        let finishReason = null;
        let usage = null;
        let reasoningChars = 0;
        let streamError = null;
        let streamDone = false;
        let sawSSE = false;

        function parseSSEBuffer(chunk) {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (let line of lines) {
                line = line.trim();
                if (!line.startsWith('data:')) continue;
                sawSSE = true;
                const dataStr = line.substring(5).trim();
                if (dataStr === '[DONE]') { streamDone = true; continue; }
                if (!dataStr) continue;
                try {
                    const parsed = JSON.parse(dataStr);
                    if (parsed.error) streamError = parsed.error.message || '流式响应错误';
                    const choice = parsed.choices?.[0];
                    if (choice?.finish_reason) finishReason = choice.finish_reason;
                    if (parsed.usage) usage = parsed.usage;
                    reasoningChars += (choice?.delta?.reasoning_content || '').length;
                    const delta = choice?.delta?.content || '';
                    if (delta) {
                        fullText += delta;
                        if (onStreamUpdate) onStreamUpdate(fullText);
                    }
                } catch (e) {}
            }
        }

        const request = GM_xmlhttpRequest({
            method: 'POST',
            url: config.endpoint,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            data: JSON.stringify(requestBody),
            timeout: 120000,
            onprogress: function(res) {
                if (res.responseText) {
                    progressCallCount++;
                    if (progressCallCount === 1) {
                        console.log('✅ [诊断] onprogress 已触发，当前环境支持流式输出');
                    }
                    fullText = '';
                    buffer = '';
                    parseSSEBuffer(res.responseText);
                }
            },
            onload: function(res) {
                if (settled) return;
                settled = true;
                const responseText = res.responseText || '';
                console.log(`✅ [诊断] onload 触发 — HTTP状态: ${res.status}, onprogress累计触发次数: ${progressCallCount}, 响应长度: ${responseText.length} 字节`);
                if (res.status < 200 || res.status >= 300) {
                    let errorMsg = responseText || res.statusText;
                    try {
                        const errObj = JSON.parse(responseText);
                        if (errObj.error?.message) errorMsg = errObj.error.message;
                    } catch (e) {}
                    // 清理 HTML 错误页（如 openresty 504），只保留有意义的文案
                    if (/<html|<!doctype/i.test(errorMsg)) {
                        const titleMatch = errorMsg.match(/<title>([^<]+)<\/title>/i);
                        errorMsg = titleMatch ? titleMatch[1].trim() : `HTTP ${res.status}`;
                    }
                    console.error(`❌ [诊断] API返回错误: ${res.status} — ${errorMsg}`);

                    // 检测余额不足
                    const isInsufficient = /insufficient|balance|quota|余额|额度|欠费/i.test(errorMsg);
                    if (isInsufficient) {
                        const isOfficial = config.endpoint?.includes('five-plus-one.com');
                        if (isOfficial) {
                            showInsufficientBalanceDialog(true);
                        } else {
                            showInsufficientBalanceDialog(false);
                        }
                    }

                    const error = new Error(`API报错 (${res.status}): ${errorMsg}`);
                    error.status = res.status;
                    return reject(error);
                }

                fullText = '';
                buffer = '';
                finishReason = null;
                streamDone = false;
                sawSSE = false;
                reasoningChars = 0;
                parseSSEBuffer(responseText);

                if (!fullText && responseText) {
                    console.log('📝 [诊断] SSE解析无结果，尝试解析为普通JSON响应...');
                    try {
                        const jsonObj = JSON.parse(responseText);
                        if (jsonObj.error) streamError = jsonObj.error.message || '响应错误';
                        if (jsonObj.usage) usage = jsonObj.usage;
                        if (jsonObj.choices && jsonObj.choices[0]) {
                            finishReason = jsonObj.choices[0].finish_reason || finishReason;
                            if (jsonObj.choices[0].message && jsonObj.choices[0].message.content) {
                                fullText = jsonObj.choices[0].message.content;
                            } else if (jsonObj.choices[0].delta && jsonObj.choices[0].delta.content) {
                                fullText = jsonObj.choices[0].delta.content;
                            }
                        }
                        if (!fullText && jsonObj.content) {
                            fullText = jsonObj.content;
                        }
                    } catch (e) {}
                }

                if (progressCallCount === 0 && fullText && onStreamUpdate) {
                    onStreamUpdate(fullText);
                }

                console.log('[AI响应]', { finishReason, usage, reasoningChars, contentChars: fullText.length });
                if (streamError) return reject(new Error(`API响应错误: ${streamError}`));
                if (finishReason === 'length') {
                    const error = new Error(maxTokens === null
                        ? 'AI回答达到接口输出上限，结果不完整；请检查模型设置后继续批改'
                        : 'AI回答达到设定的输出上限，结果不完整');
                    error.code = 'OUTPUT_TRUNCATED';
                    return reject(error);
                }
                if (finishReason && finishReason !== 'stop') return reject(new Error(`AI响应未正常完成 (${finishReason})`));
                if (sawSSE && !finishReason && !streamDone) return reject(new Error('AI响应未完整结束，请检查网络后继续批改'));
                if (!fullText.trim()) return reject(new Error('AI未返回可用内容，请检查模型输出设置'));
                resolve(fullText);
            },
            onerror: function() {
                if (settled) return;
                settled = true;
                reject(new Error('网络请求被拦截，请检查跨域权限'));
            },
            ontimeout: function() {
                if (settled) return;
                settled = true;
                reject(new Error('请求超时'));
            }
        });

        if (window.aiGradingState.abortController) {
            window.aiGradingState.abortController.signal.addEventListener('abort', () => {
                if (!settled) {
                    settled = true;
                    request.abort();
                    reject(new Error('用户主动暂停'));
                }
            });
        }
    });
}

// ========== 带重试的 AI 请求包装 ==========
function getOutputLimitPolicy(key) {
    if (!key) return null;
    const state = window.aiGradingState;
    if (!state.outputLimitPolicy || state.outputLimitPolicy.key !== key) {
        state.outputLimitPolicy = { key, recent: [], useProviderDefault: false };
    }
    return state.outputLimitPolicy;
}

function recordOutputLimitOutcome(config) {
    if (!config.outputLimitKey || config.outputLimitEnabled === false) return;
    const policy = getOutputLimitPolicy(config.outputLimitKey);
    policy.recent.push(Boolean(config.outputObservation?.upgraded));
    if (policy.recent.length > 5) policy.recent.shift();
    if (policy.recent.length === 5 && policy.recent.filter(Boolean).length >= 3) {
        policy.useProviderDefault = true;
    }
}

// 每次先遵循用户设置；截断时仅升级一次，由接口决定重试请求的输出额度。
async function callAI(prompt, base64DataArray, config, onStreamUpdate, extraImages) {
    const budget = config.requestBudget || { remaining: 3 };
    const policy = getOutputLimitPolicy(config.outputLimitKey);
    const configuredLimit = Number(config.maxOutputTokens);
    let maxTokens = config.outputLimitEnabled === false || policy?.useProviderDefault
        ? null : (Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 2048);
    let upgraded = false;
    let serverRetried = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (window.aiGradingState.abortController?.signal.aborted) throw new Error('用户主动暂停');
        if (budget.remaining <= 0) throw new Error('AI请求次数已达到上限');
        budget.remaining--;
        try {
            const result = await callAIOnce(prompt, base64DataArray, config, onStreamUpdate, extraImages, maxTokens);
            if (upgraded && config.outputObservation) config.outputObservation.upgraded = true;
            return result;
        } catch (error) {
            if (error.code === 'OUTPUT_TRUNCATED' && maxTokens !== null && !upgraded && attempt < 2 && budget.remaining > 0) {
                upgraded = true;
                maxTokens = null;
                if (onStreamUpdate) onStreamUpdate('回答较长，正在继续分析…');
                continue;
            }
            // 5xx/429 可重试：最多2次，递增延迟（504等瞬态错误常需更长恢复窗口）
            const isServerError = error.status === 429 || (error.status >= 500 && error.status < 600);
            if (isServerError && serverRetried < 2 && attempt < 2) {
                serverRetried++;
                const delay = error.status === 429 ? 5000 : (serverRetried === 1 ? 2000 : 5000);
                console.warn(`⚠️ [callAI] 服务端错误 ${error.status}，${delay}ms 后重试（第${serverRetried}次）`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw error;
        }
    }
    throw new Error('AI请求次数已达到上限');
}

async function callAIWithRetry(prompt, base64DataArray, config, onStreamUpdate, extraImages) {
    return callAI(prompt, base64DataArray, config, onStreamUpdate, extraImages);
}

// ========== 双评引擎 ==========
// 双评小题分数合并（逐题取平均；评语有差异时并列两份）
function mergeDualSubScores(detailA, detailB) {
    if (!detailA?.subScores || !detailB?.subScores ||
        detailA.subScores.length !== detailB.subScores.length) {
        return detailA?.subScores || null;
    }
    return detailA.subScores.map((sqA, i) => {
        const sqB = detailB.subScores[i];
        const avgScore = (sqA.score !== null && sqA.score !== undefined && sqB.score !== null && sqB.score !== undefined)
            ? Math.round((sqA.score + sqB.score) / 2)
            : (sqA.score ?? sqB.score);
        // 按评语内容决定是否并列（与给分是否相同无关）：措辞不同就都展示
        const cA = (sqA.comment || '').trim();
        const cB = (sqB.comment || '').trim();
        let comment = cA || cB;
        if (cA && cB && cA !== cB) {
            comment = `A: ${cA}；B: ${cB}`;
        }
        return { ...sqA, score: avgScore, comment };
    });
}

// 双评详情重建：分数计算/评分依据必须与合并后的分数一致，不能沿用单模型原文
function buildDualEvalDetail(detailA, detailB, finalSubScores, finalScore) {
    const sections = { ...(detailA?._sections || {}) };
    if (finalSubScores && finalSubScores.length > 0) {
        const parts = finalSubScores.map(s =>
            `${s.label}得分${(s.score !== null && s.score !== undefined) ? s.score + '分' : '—'}`);
        sections['分数计算'] = `${parts.join(' + ')} = 总得分${finalScore}分`;
    } else {
        sections['分数计算'] = `双评平均 = 总得分${finalScore}分`;
    }
    const basisA = detailA?._sections?.['评分依据'] || '';
    const basisB = detailB?._sections?.['评分依据'] || '';
    sections['评分依据'] = (basisA && basisB)
        ? `【模型A】\n${basisA}\n\n【模型B】\n${basisB}`
        : (basisA || basisB || '');
    return {
        sections,
        scoringBasis: sections['评分依据'],
        calculation: sections['分数计算'],
        comment: sections['评分依据']
    };
}

async function callDualEvaluation(base64DataArray, config, onStreamUpdate) {
    const workflow = WorkflowManager.getWorkflow(config.workflowId);
    if (!workflow || !workflow.dualEval || !workflow.dualEval.enabled) {
        // 非双评模式，走普通流程
        return callAIGrading(base64DataArray, config, onStreamUpdate);
    }

    const dualConfig = workflow.dualEval;
    const threshold = dualConfig.threshold != null ? dualConfig.threshold : 2;

    // 获取主模型和副模型配置
    const primaryConfig = ProviderManager.getCallConfig(
        workflow.model.provider, workflow.model.model
    );
    if (workflow.model.reasoningEffort) {
        primaryConfig.reasoningEffort = workflow.model.reasoningEffort;
    }
    const secondaryConfig = ProviderManager.getCallConfig(
        dualConfig.secondary.provider, dualConfig.secondary.model
    );
    if (dualConfig.secondary.reasoningEffort) {
        secondaryConfig.reasoningEffort = dualConfig.secondary.reasoningEffort;
    }

    if (!primaryConfig || !secondaryConfig) {
        console.warn('⚠️ [双评] 模型配置不完整，回退到单模型模式');
        return callAIGrading(base64DataArray, config, onStreamUpdate);
    }

    console.log(`🔄 [双评] 启动双评模式 — 主模型: ${primaryConfig.model}, 副模型: ${secondaryConfig.model}, 阈值: ${threshold}分`);
    if (onStreamUpdate) onStreamUpdate('🔄 双评模式：正在并发调用两个模型...');

    // 并发调用（使用带重试的包装）
    let [resultA, resultB] = await Promise.allSettled([
        callAIGrading(base64DataArray, { ...config, ...primaryConfig }, null),
        callAIGrading(base64DataArray, { ...config, ...secondaryConfig }, null)
    ]);

    let scoreA = resultA.status === 'fulfilled' ? resultA.value.score : null;
    let scoreB = resultB.status === 'fulfilled' ? resultB.value.score : null;
    let detailA = resultA.status === 'fulfilled' ? resultA.value : null;
    let detailB = resultB.status === 'fulfilled' ? resultB.value : null;

    if (scoreA === null || scoreB === null) {
        const failure = resultA.status === 'rejected' ? resultA.reason : resultB.status === 'rejected' ? resultB.reason : null;
        throw failure || new Error('双评结果不完整，请检查两个模型的回答后继续批改');
    }

    const diff = Math.abs(scoreA - scoreB);
    console.log(`🔄 [双评] 结果 — 主模型: ${scoreA}, 副模型: ${scoreB}, 分差: ${diff}`);

    // 分差在阈值内
    if (diff <= threshold) {
        let finalScore = Math.round((scoreA + scoreB) / 2);
        console.log(`✅ [双评] 分差在阈值内，取平均分: ${finalScore}`);

        // 处理分小题分数：对每个小题分别取平均
        const finalSubScores = mergeDualSubScores(detailA, detailB);
        if (finalSubScores && detailA?.subScores && detailB?.subScores &&
            detailA.subScores.length === detailB.subScores.length) {
            console.log(`✅ [双评] 分小题平均: ${finalSubScores.map(s => s.label + '=' + s.score).join(', ')}`);

            // 总分与小题之和一致性校准（各自取整会导致偏差，以小题之和为准）
            const subSum = finalSubScores.reduce((s, u) => s + (u.score || 0), 0);
            const allScored = finalSubScores.every(u => u.score !== null && u.score !== undefined);
            if (allScored && Math.abs(subSum - finalScore) > 0.01) {
                console.warn(`⚠️ [双评] 小题之和(${subSum})与平均总分(${finalScore})不一致，以小题之和为准`);
                finalScore = subSum;
            }
        }

        // 详情重建：分数计算/评分依据跟随合并后的分数（不能沿用模型A原文）
        const detail = buildDualEvalDetail(detailA, detailB, finalSubScores, finalScore);

        // 勤勉度也取平均
        const avgDiligenceLevel = Math.round(((detailA?.diligenceLevel || 0) + (detailB?.diligenceLevel || 0)) / 2);
        const avgDiligenceReason = detailA?.diligenceLevel >= (detailB?.diligenceLevel || 0)
            ? (detailA?.diligenceReason || '') : (detailB?.diligenceReason || '');

        return {
            ...detailA,
            score: finalScore,
            rawScore: finalScore,
            subScores: finalSubScores,
            comment: detail.comment,
            scoringBasis: detail.scoringBasis,
            calculation: detail.calculation,
            _sections: detail.sections,
            diligenceLevel: avgDiligenceLevel,
            diligenceReason: avgDiligenceReason,
            dualEval: {
                scoreA, scoreB, diff, result: 'consensus',
                detailA: detailA?._sections || null,
                detailB: detailB?._sections || null,
                diligenceA: detailA?.diligenceLevel || 0,
                diligenceB: detailB?.diligenceLevel || 0
            }
        };
    }

    // 分差超阈值，触发三评仲裁
    console.log(`⚠️ [双评] 分差超阈值(${diff} > ${threshold})，启动三评仲裁...`);
    if (onStreamUpdate) onStreamUpdate(`⚠️ 分差 ${diff} 分超阈值，正在进行三评仲裁...`);

    const arbConfig = ProviderManager.getCallConfig(
        dualConfig.arbitration.provider, dualConfig.arbitration.model
    );
    if (dualConfig.arbitration.reasoningEffort) {
        arbConfig.reasoningEffort = dualConfig.arbitration.reasoningEffort;
    }
    if (!arbConfig) {
        console.warn('⚠️ [三评] 仲裁模型配置不完整，取平均分');
        const finalScore = Math.round((scoreA + scoreB) / 2);
        const finalSubScores = mergeDualSubScores(detailA, detailB);
        const detail = buildDualEvalDetail(detailA, detailB, finalSubScores, finalScore);
        const avgLevel = Math.round(((detailA?.diligenceLevel || 0) + (detailB?.diligenceLevel || 0)) / 2);
        return {
            ...detailA,
            score: finalScore,
            rawScore: finalScore,
            subScores: finalSubScores,
            comment: detail.comment,
            scoringBasis: detail.scoringBasis,
            calculation: detail.calculation,
            _sections: detail.sections,
            diligenceLevel: avgLevel,
            diligenceReason: detailA?.diligenceReason || '',
            dualEval: { scoreA, scoreB, diff, result: 'average-fallback', detailA: detailA?._sections || null, detailB: detailB?._sections || null }
        };
    }

    const arbPrompt = buildArbitrationPrompt(config, detailA, detailB, threshold);
    const arbResult = await callAIWithRetry(arbPrompt, base64DataArray, { ...config, ...arbConfig }, onStreamUpdate);

    // 多小题模式下用小题解析器，单题模式用结构化解析器
    const arbUnits = config.scoring?.units || [];
    const arbHasSub = arbUnits.length > 1 && detailA?.subScores && detailA.subScores.length > 0;
    let arbParsed;
    if (arbHasSub) {
        const arbSubQuestions = detailA.subScores.map(sq => ({ id: sq.id, label: sq.label, maxScore: sq.maxScore }));
        arbParsed = parseSubQuestionResponse(arbResult, { ...config, subQuestions: arbSubQuestions });
    } else {
        arbParsed = parseStructuredResponse(arbResult);
    }

    console.log(`✅ [三评] 仲裁结果: ${arbParsed.score}${arbHasSub ? '（多小题）' : ''}`);
    // 仲裁模型不评估勤勉度，取 A/B 平均
    const arbDiligenceLevel = Math.round(((detailA?.diligenceLevel || 0) + (detailB?.diligenceLevel || 0)) / 2);

    // 小题分兜底：仲裁漏给部分小题分时，用 A/B 合并结果补齐
    let arbSubScores = arbParsed.subScores || null;
    if (arbHasSub) {
        const fallbackSubScores = mergeDualSubScores(detailA, detailB);
        if (!arbSubScores && fallbackSubScores) {
            arbSubScores = fallbackSubScores;
            console.warn('⚠️ [三评] 仲裁未返回小题分，使用 A/B 合并结果兜底');
        } else if (arbSubScores && fallbackSubScores) {
            arbSubScores = arbSubScores.map((sq, i) => {
                if ((sq.score === null || sq.score === undefined) && fallbackSubScores[i]) {
                    console.warn(`⚠️ [三评] 仲裁缺少 ${sq.label} 小题分，使用 A/B 合并结果兜底`);
                    return { ...sq, score: fallbackSubScores[i].score, comment: fallbackSubScores[i].comment || sq.comment };
                }
                return sq;
            });
        }
    }

    // 总分与小题之和一致性校准（以小题之和为准，与共识路径规则一致）
    let arbFinalScore = arbParsed.score;
    if (arbSubScores && arbSubScores.length > 0) {
        const arbSubSum = arbSubScores.reduce((s, u) => s + (u.score || 0), 0);
        const arbAllScored = arbSubScores.every(u => u.score !== null && u.score !== undefined);
        if (arbAllScored && Math.abs(arbSubSum - arbFinalScore) > 0.01) {
            console.warn(`⚠️ [三评] 仲裁小题之和(${arbSubSum})与仲裁总分(${arbFinalScore})不一致，以小题之和为准`);
            arbFinalScore = arbSubSum;
        }
    }

    return {
        ...arbParsed,
        score: arbFinalScore,
        rawScore: arbFinalScore,
        subScores: arbSubScores,
        studentAnswer: detailA?.studentAnswer || detailB?.studentAnswer || arbParsed.studentAnswer || '未能识别',
        diligenceLevel: arbDiligenceLevel,
        diligenceReason: detailA?.diligenceReason || '',
        dualEval: {
            scoreA, scoreB, diff,
            result: 'arbitration',
            arbScore: arbFinalScore,
            arbAnalysis: arbParsed._sections?.['仲裁分析'] || '',
            detailA: detailA?._sections || null,
            detailB: detailB?._sections || null,
            diligenceA: detailA?.diligenceLevel || 0,
            diligenceB: detailB?.diligenceLevel || 0
        }
    };
}
