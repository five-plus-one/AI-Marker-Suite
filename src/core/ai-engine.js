function isOfficialModelProvider(provider) {
    try { return new URL(provider?.endpoint || '').hostname === new URL(SCRIPT_CONFIG.DEFAULT_ENDPOINT).hostname; }
    catch (_) { return false; }
}

function isProviderDataValid(data) {
    const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
    return record(data?.providers) && Object.values(data.providers).every(provider => record(provider) &&
        (provider.models === undefined || record(provider.models)));
}

function isWorkflowDataValid(data) {
    const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
    return record(data?.workflows) && Object.values(data.workflows).every(record);
}

// ========== 供应商管理器 ==========
const ProviderManager = {
    data: null,
    init() {
        this._writeDisabled = false;
        if (typeof configurationImportRecoveryBlocked !== 'undefined' && configurationImportRecoveryBlocked) { this._enterReadOnly(null); return; }
        let raw = null;
        try {
            raw = GM_getValue('ai-grading-providers-v2');
        } catch (e) {
            console.error('❌ ProviderManager init 读取失败，进入只读降级:', e);
            this._enterReadOnly(null);
            return;
        }
        if (raw) {
            try {
                this.data = JSON.parse(raw);
                if (!isProviderDataValid(this.data)) throw new Error('供应商数据格式不正确');
            } catch (e) {
                // 解析失败：救原始字节 + 只读降级，绝不覆写清空（#293）
                this._enterReadOnly(raw, e);
                return;
            }
            // 迁移隔离（#293）：失败保留已加载数据
            try {
                this._migrateProviders();
            } catch (e) {
                console.error('[providers] 迁移失败（保留原数据继续）:', e);
            }
        } else {
            // 尝试迁移旧格式
            try {
                const oldSaved = GM_getValue('ai-grading-providers');
                this.data = oldSaved ? this._migrateFromV1(JSON.parse(oldSaved)) : this._getDefault();
                this._migrateProviders();
            } catch (e) {
                this._enterReadOnly(null, e);
                return;
            }
            saveInitialConfiguration(this, '供应商');
        }
    },
    // 只读降级（#293）：禁止保存覆写；原始字节存 rescue 键供恢复
    _enterReadOnly(raw, err) {
        if (err) console.error('❌ ProviderManager 数据解析失败，进入只读降级:', err);
        try { if (raw != null) GM_setValue('ai-grading-providers-v2-rescue', String(raw)); } catch (_) {}
        this.data = this._getDefault();
        this._degradedBase = JSON.parse(JSON.stringify(this.data));
        this._writeDisabled = true;
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

            if (!provider.models || typeof provider.models !== 'object' || Array.isArray(provider.models)) {
                provider.models = {};
                changed = true;
            }
            if (name === '5plus1官方' && isOfficialModelProvider(provider) && provider.models['deepseek-fast']) {
                delete provider.models['deepseek-fast'];
                if (this.data.activeProvider === name && this.data.activeModel === 'deepseek-fast') this.data.activeModel = 'deepseek-flash';
                changed = true;
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
            saveInitialConfiguration(this, '供应商');
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
                        "deepseek-flash": { label: "DeepSeek Flash", tags: ["快速", "内置"], isBuiltin: true },
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
        const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
        if (!record(oldData?.list) || Object.values(oldData.list).some(value => !record(value))) throw new Error('旧供应商数据格式不正确');
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
                newData.providers[name].endpoint = config.endpoint || newData.providers[name].endpoint;
                newData.providers[name].apiKey = config.apiKey || '';
                if (config.model) {
                    newData.providers[name].models[config.model] = { label: config.model, tags: [] };
                }
            }
        }
        if (oldData.active && newData.providers[oldData.active]) {
            newData.activeProvider = oldData.active;
            const provider = newData.providers[oldData.active];
            const modelKeys = Object.keys(provider.models);
            newData.activeModel = oldData.list?.[oldData.active]?.model || modelKeys[0] || '';
        }
        console.log('[ProviderManager] 已从 v1 格式迁移');
        return newData;
    },
    save() {
        if (typeof configurationImportRecoveryBlocked !== 'undefined' && configurationImportRecoveryBlocked) return false;
        if (this._writeDisabled) {
            // 惰性探活：读取恢复后合并原数据与保护期编辑（与 preset 对齐）。
            try {
                const probe = GM_getValue('ai-grading-providers-v2');
                const recovered = probe ? JSON.parse(probe) : null;
                if (isProviderDataValid(recovered)) {
                    this.data = mergeRecoveredData(recovered, this.data, this._degradedBase);
                    this._writeDisabled = false;
                    if (typeof showToast === 'function') showToast('供应商配置存储已恢复，请再次点击保存');
                    return false;
                }
            } catch (_) { /* 维持降级 */ }
            console.error('[providers] 存储处于只读降级，跳过保存以保护原数据（#293）');
            if (typeof showToast === 'function') showToast('⚠️ 供应商配置存储异常：本次修改未保存（原数据已保护）');
            return false;
        }
        const json = JSON.stringify(this.data);
        try {
            const prev = GM_getValue('ai-grading-providers-v2');
            if (prev && prev !== json && prev.length <= 2 * 1024 * 1024) GM_setValue('ai-grading-providers-v2-prev', prev);
        } catch (_) { /* 备份失败不阻塞保存 */ }
        GM_setValue('ai-grading-providers-v2', json);
        this._initialSaveFailed = false;
        return true;
    },
    getProvider(name) {
        return Object.prototype.hasOwnProperty.call(this.data.providers, name) ? this.data.providers[name] : null;
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
        const provider = this.getProvider(providerName);
        if (!provider || !modelId || !Object.prototype.hasOwnProperty.call(provider.models || {}, modelId)) return null;
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
        this._writeDisabled = false;
        if (typeof configurationImportRecoveryBlocked !== 'undefined' && configurationImportRecoveryBlocked) { this._enterReadOnly(null); return; }
        let raw = null;
        try {
            raw = GM_getValue('ai-grading-workflows');
        } catch (e) {
            console.error('❌ WorkflowManager init 读取失败，进入只读降级:', e);
            this._enterReadOnly(null);
            return;
        }
        if (raw) {
            try {
                this.data = JSON.parse(raw);
                if (!isWorkflowDataValid(this.data)) throw new Error('工作流数据格式不正确');
            } catch (e) {
                this._enterReadOnly(raw, e);
                return;
            }
            try {
                this._migrateWorkflows();
            } catch (e) {
                console.error('[workflows] 迁移失败（保留原数据继续）:', e);
            }
        } else {
            this.data = this._getDefault();
            saveInitialConfiguration(this, '工作流');
        }
    },
    // 只读降级（#293）：禁止保存覆写；原始字节存 rescue 键供恢复
    _enterReadOnly(raw, err) {
        if (err) console.error('❌ WorkflowManager 数据解析失败，进入只读降级:', err);
        try { if (raw != null) GM_setValue('ai-grading-workflows-rescue', String(raw)); } catch (_) {}
        this.data = this._getDefault();
        this._degradedBase = JSON.parse(JSON.stringify(this.data));
        this._writeDisabled = true;
    },
    _migrateWorkflows(providerMap = ProviderManager.data.providers) {
        let changed = false;
        const defaults = this._getDefault();
        const currentVersion = SCRIPT_CONFIG.VERSION;
        const lastMigratedVersion = this.data._migratedVersion || '';

        // 仅在版本升级时重置内置工作流的模型配置，避免覆盖用户手动修改
        const shouldMigrateDefaults = lastMigratedVersion !== currentVersion;

        for (const [name, wf] of Object.entries(defaults.workflows)) {
            if (!this.data.workflows[name]) { this.data.workflows[name] = wf; changed = true; }
        }
        for (const [name, wf] of Object.entries(this.data.workflows)) {
            for (const model of [wf.model, wf.dualEval?.secondary, wf.dualEval?.arbitration]) {
                if (model?.provider === '5plus1官方' && model.model === 'deepseek-fast' &&
                    isOfficialModelProvider(providerMap[model.provider])) {
                    model.model = 'deepseek-flash';
                    changed = true;
                }
            }
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
            saveInitialConfiguration(this, '工作流');
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
                        threshold: 2,
                        mergeMode: "round"
                    },
                    isBuiltin: true
                }
            },
            activeWorkflow: "fast"
        };
    },
    save() {
        if (typeof configurationImportRecoveryBlocked !== 'undefined' && configurationImportRecoveryBlocked) return false;
        if (this._writeDisabled) {
            // 惰性探活：读取恢复后合并原数据与保护期编辑（与 preset 对齐）。
            try {
                const probe = GM_getValue('ai-grading-workflows');
                const recovered = probe ? JSON.parse(probe) : null;
                if (isWorkflowDataValid(recovered)) {
                    this.data = mergeRecoveredData(recovered, this.data, this._degradedBase);
                    this._writeDisabled = false;
                    if (typeof showToast === 'function') showToast('工作流配置存储已恢复，请再次点击保存');
                    return false;
                }
            } catch (_) { /* 维持降级 */ }
            console.error('[workflows] 存储处于只读降级，跳过保存以保护原数据（#293）');
            if (typeof showToast === 'function') showToast('⚠️ 工作流配置存储异常：本次修改未保存（原数据已保护）');
            return false;
        }
        const json = JSON.stringify(this.data);
        try {
            const prev = GM_getValue('ai-grading-workflows');
            if (prev && prev !== json && prev.length <= 2 * 1024 * 1024) GM_setValue('ai-grading-workflows-prev', prev);
        } catch (_) { /* 备份失败不阻塞保存 */ }
        GM_setValue('ai-grading-workflows', json);
        this._initialSaveFailed = false;
        return true;
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
        return this.save();
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

// ========== 废图闸（工单①：图片进 AI 请求前的尺寸护栏）==========
// 实测事故：取图链把 942×4 的裁剪残片发给 API，触发
// 「Image dimensions are too small. Minimum allowed dimension: 14 pixels」整单 400 暂停。
// 规则：宽或高 <15px（API 地板 14px +1 安全边距）或极端比例 >100:1 的图片按废图剔除；
// 无法解析尺寸（未知格式）不误杀，按可用保留（合法长条题块图比例远低于 100:1）。
// 剔除后无图 = 显式失败（宁可不取，绝不让 AI 对空图盲评）。
function probeImageDimensions(data) {
    try {
        if (typeof data !== 'string' || !data) return null;
        let b64 = data;
        if (b64.slice(0, 5) === 'data:') {
            const comma = b64.indexOf(',');
            if (comma === -1) return null;
            b64 = b64.slice(comma + 1);
        }
        if (typeof atob !== 'function') return null;
        const bin = atob(b64);
        const b = i => bin.charCodeAt(i) & 0xff;
        const be16 = i => (b(i) << 8) | b(i + 1);
        const be32 = i => (((b(i) << 24) >>> 0) + (b(i + 1) << 16) + (b(i + 2) << 8) + b(i + 3)) >>> 0;
        // PNG：签名 8 字节，IHDR 宽/高在偏移 16..23（大端 32 位）
        if (bin.length >= 24 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) {
            return { width: be32(16), height: be32(20) };
        }
        // GIF：'GIF8'，宽/高在偏移 6..9（小端 16 位）
        if (bin.length >= 10 && b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) {
            return { width: b(6) | (b(7) << 8), height: b(8) | (b(9) << 8) };
        }
        // JPEG：扫描 SOF 段取宽高
        if (bin.length >= 4 && b(0) === 0xff && b(1) === 0xd8) {
            let i = 2;
            while (i + 9 < bin.length) {
                if (b(i) !== 0xff) { i++; continue; }
                const marker = b(i + 1);
                if (marker === 0xff) { i++; continue; }
                if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
                if (marker === 0xd9 || marker === 0xda) break;
                const segLen = be16(i + 2);
                // SOF0..SOF15（DHT/JPG/DAC 除外）：段内偏移 5..8 为高×宽（大端 16 位）
                if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                    return { width: be16(i + 7), height: be16(i + 5) };
                }
                if (segLen < 2) break;
                i += 2 + segLen;
            }
            return null;
        }
        // WebP：RIFF....WEBP + VP8 / VP8L / VP8X 三种头
        if (bin.length >= 30 && b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 &&
            b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) {
            const four = bin.slice(12, 16);
            if (four === 'VP8X') {
                return { width: 1 + (b(24) | (b(25) << 8) | (b(26) << 16)), height: 1 + (b(27) | (b(28) << 8) | (b(29) << 16)) };
            }
            if (four === 'VP8 ') {
                return { width: (b(26) | (b(27) << 8)) & 0x3fff, height: (b(28) | (b(29) << 8)) & 0x3fff };
            }
            if (four === 'VP8L') {
                const bits = (b(21) | (b(22) << 8) | (b(23) << 16) | (b(24) << 24)) >>> 0;
                return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
            }
            return null;
        }
        return null;
    } catch (e) {
        return null;
    }
}

function filterUsableImagesForAI(list) {
    const kept = [];
    const removed = [];
    (list || []).forEach((item, index) => {
        if (typeof item !== 'string' || !item.trim()) {
            removed.push({ index, reason: '空图片数据' });
            return;
        }
        const size = probeImageDimensions(item);
        if (!size) {
            // 未知格式/尺寸不可解析：不误杀，保留
            kept.push(item);
            return;
        }
        const { width, height } = size;
        if (width < 15 || height < 15) {
            removed.push({ index, reason: `尺寸过小 ${width}×${height}（<15px）` });
            return;
        }
        const ratio = Math.max(width / height, height / width);
        if (ratio > 100) {
            removed.push({ index, reason: `极端比例 ${width}×${height}（${Math.round(ratio)}:1）` });
            return;
        }
        kept.push(item);
    });
    return { kept, removed };
}

// ========== 通用 AI 请求函数 ==========
function callAIOnce(prompt, base64DataArray, config, onStreamUpdate, extraImages, maxTokens) {
    const signal = config.signal || window.aiGradingState.abortController?.signal;
    let abortRequest;
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('用户主动暂停'));
        // 合并额外图片（来自题目/答案/评分标准）+ 学生答题卡图片
        var allImages = (extraImages && extraImages.length) ? extraImages.concat(base64DataArray) : base64DataArray;
        // 废图闸（请求组装汇聚点，工单①）：剔除尺寸异常的裁剪残片，防止 API 400 整单暂停。
        // main.js 下载循环已前置剔除；此处兜底覆盖回评/纠错等所有调用链。
        const rawImageCount = (allImages && allImages.length) || 0;
        const imgGate = filterUsableImagesForAI(allImages);
        if (imgGate.removed.length > 0) {
            console.warn(`⚠️ [废图剔除] ${imgGate.removed.length} 张废图不进 AI 请求: ` +
                imgGate.removed.map(r => `#${r.index} ${r.reason}`).join('；'));
            allImages = imgGate.kept;
        }
        if (allImages.length === 0 && rawImageCount > 0) {
            // 剔除后无图 = 显式失败（宁可不取）：绝不让 AI 对空图评分
            return reject(new Error('答题卡图片均不可用（废图剔除后无有效图片），请人工核查后继续批改'));
        }
        // 部分剔除时必须告知 AI 只剩残卷（返修②）：误杀真面板时 AI 不得对残卷"照常出分"而不知情。
        // 剔除计数三来源合并：本层兜底剔除 + main.js 主流程剔除（config，显式 0 权威）+ 回评/纠错剔除（aiGradingState 兜底）
        const preRemoved = (config && config.imageGateRemovedCount != null) ? config.imageGateRemovedCount
            : ((typeof window !== 'undefined' && window.aiGradingState && window.aiGradingState.imageGateRemovedCount) || 0);
        const removedNote = imgGate.removed.length + (preRemoved || 0);
        const promptText = (removedNote > 0 && allImages.length > 0)
            ? `${prompt}\n\n【图片说明】已剔除 ${removedNote} 张废图（尺寸异常），请基于剩余图片评判。`
            : prompt;
        const messageContent = [{ type: "text", text: promptText }];
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

        if (signal) {
            abortRequest = () => {
                if (!settled) {
                    settled = true;
                    request.abort();
                    reject(new Error('用户主动暂停'));
                }
            };
            signal.addEventListener('abort', abortRequest, { once: true });
        }
    }).finally(() => { if (abortRequest) signal?.removeEventListener('abort', abortRequest); });
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

// ========== 瞬态错误退避重试（#211） ==========
// 超时 / 模型返回空内容 / 流式未完整结束，此前是零重试直接抛错 -> 主流程暂停，
// 无人值守形同虚设。这里做退避重试（默认 5s/10s/15s），次数与开关可配置。
//
// 设计约束（保证不影响既有流程与适配器）：
//   - 只覆盖原先「零重试」的瞬态错误；截断升级、5xx/429 重试仍走 callAI 原有逻辑
//   - 不消耗 requestBudget（那是主逻辑的请求预算，瞬态重试由 retryPolicy 单独限额）
//   - 答卷一致性由填分前的 verifyPaperUnchanged 兜底（#212），重试本身不校验
function getRetryPolicy(config) {
    const p = (config && config.retryPolicy) || {};
    const mr = Number(p.maxRetries);
    return {
        retryOnEmpty: p.retryOnEmpty !== false,
        retryOnTimeout: p.retryOnTimeout !== false,
        maxRetries: Number.isInteger(mr) ? Math.min(Math.max(mr, 0), 5) : 3,
        backoffBaseMs: Number(p.backoffBaseMs) > 0 ? Number(p.backoffBaseMs) : 5000
    };
}

function classifyTransientError(error, policy) {
    const msg = (error && error.message) || '';
    if (msg.indexOf('用户主动暂停') !== -1) return null;              // 用户操作，不重试
    if (msg.indexOf('被拦截') !== -1) return null;                    // 跨域配置问题，重试无意义
    if (msg.indexOf('请求超时') !== -1) {
        // 超时时服务端可能仍在生成，重试会重复计费 —— 由 retryOnTimeout 控制
        return policy.retryOnTimeout ? '请求超时' : null;
    }
    if (msg.indexOf('AI未返回可用内容') !== -1) {
        return policy.retryOnEmpty ? '模型返回空内容' : null;
    }
    if (msg.indexOf('未完整结束') !== -1) return '响应未完整结束';
    return null;
}

async function callAIOnceWithTransientRetry(prompt, base64DataArray, config, onStreamUpdate, extraImages, maxTokens) {
    config = { ...config, signal: config.signal || window.aiGradingState.abortController?.signal };
    const policy = getRetryPolicy(config);
    for (let i = 0; i <= policy.maxRetries; i++) {
        try {
            if (config.signal?.aborted) throw new Error('用户主动暂停');
            return await callAIOnce(prompt, base64DataArray, config, onStreamUpdate, extraImages, maxTokens);
        } catch (error) {
            const kind = classifyTransientError(error, policy);
            if (!kind || i >= policy.maxRetries) throw error;
            const delay = policy.backoffBaseMs * (i + 1);
            console.warn(`⚠️ [callAI] ${kind}，${delay}ms 后重试（第${i + 1}/${policy.maxRetries}次）`);
            if (onStreamUpdate) onStreamUpdate(`⏳ ${kind}，${Math.round(delay / 1000)}s 后自动重试（第${i + 1}/${policy.maxRetries}次）…`);
            await abortableGradingDelay(delay, config.signal);
        }
    }
}

// 每次先遵循用户设置；截断时仅升级一次，由接口决定重试请求的输出额度。
async function callAI(prompt, base64DataArray, config, onStreamUpdate, extraImages) {
    config = { ...config, signal: config.signal || window.aiGradingState.abortController?.signal };
    const budget = config.requestBudget || { remaining: 3 };
    const policy = getOutputLimitPolicy(config.outputLimitKey);
    const configuredLimit = Number(config.maxOutputTokens);
    let maxTokens = config.outputLimitEnabled === false || policy?.useProviderDefault
        ? null : (Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 2048);
    let upgraded = false;
    let serverRetried = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (config.signal?.aborted) throw new Error('用户主动暂停');
        if (budget.remaining <= 0) throw new Error('AI请求次数已达到上限');
        budget.remaining--;
        try {
            const result = await callAIOnceWithTransientRetry(prompt, base64DataArray, config, onStreamUpdate, extraImages, maxTokens);
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
                await abortableGradingDelay(delay, config.signal);
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
// 双评合并取整策略（工单②）：wf.dualEval.mergeMode ∈ round | floor | ceil | min | max
//   round（默认）= 平均后四舍五入到评分梯度
//   floor / ceil = 平均后向下/向上取整到评分梯度（强制取整方法，不受 scoring.roundMethod 影响）
//   min / max = 取两模型低分/高分（不平均），外向吸附：min→floor（只降不升）、max→ceil（只升不降）
//     ——「取低分」绝不输出高于低分的值、「取高分」绝不输出低于高分的值（返修①，教师语义优先）
//     迁移影响：早期预览批 min/max 曾按 scoring.roundMethod 吸附，脱梯度分数的合并结果将变化（已在 CHANGELOG 注明）
//     交互规则（N3）：**钳制最高优先**——越界输入（如 max 侧超过单元满分）本身非法，
//     满分钳制覆盖外向承诺：max(8.8, 8.6) 满分 8 → 8（宁可压回满分也不输出越界值）；
//     合法输入（≤满分、≥0）下的外向语义不受影响
// 所有模式共用同一套步长吸附 + 满分钳制（ScoreCalculator.round 第三参）；
// 缺分（单侧 null/undefined 直取对侧、不吸附）与 NaN 传染语义与历史一致，不在此放松。
function mergeDualValue(scoreA, scoreB, snap, maxScore, mergeMode) {
    const mode = mergeMode || 'round';
    let raw;
    let method = 'round';
    if (mode === 'min') {
        raw = Math.min(scoreA, scoreB);
        // 外向吸附（返修①）：「取低分」只降不升 —— floor 到梯度，
        // 此前用 round 会把 min(1.5, 2) 抬成 2（取低分输出高分），违背教师承诺
        method = 'floor';
    } else if (mode === 'max') {
        raw = Math.max(scoreA, scoreB);
        // 外向吸附（返修①）：「取高分」只升不降 —— ceil 到梯度（round 会把 max 压低）
        method = 'ceil';
    } else {
        raw = (scoreA + scoreB) / 2;
        if (mode === 'floor') method = 'floor';
        else if (mode === 'ceil') method = 'ceil';
    }
    // 钳制最高优先（N3）：外向吸附后再钳制 [0, maxScore]——越界输入非法，钳制覆盖外向承诺
    return ScoreCalculator.round(raw, { roundStep: (snap && snap.roundStep) || 1, roundMethod: method }, maxScore);
}

// 双评小题分数合并（按 mergeMode 合并；评语有差异时并列两份）
function mergeDualSubScores(detailA, detailB, scoringConfig, mergeMode) {
    if (!detailA?.subScores || !detailB?.subScores ||
        detailA.subScores.length !== detailB.subScores.length) {
        return detailA?.subScores || null;
    }
    return detailA.subScores.map((sqA, i) => {
        const sqB = detailB.subScores[i];
        // 按小题取整步长合并（mergeMode 缺省 = round 时与历史 Math.round 平均逐值一致）
        const roundStep = sqA.roundStep || scoringConfig?.units?.[i]?.roundStep || scoringConfig?.roundStep || 1;
        const roundMethod = scoringConfig?.roundMethod || 'round';
        const unitMax = sqA.maxScore ?? sqB.maxScore;
        const mergedScore = (sqA.score !== null && sqA.score !== undefined && sqB.score !== null && sqB.score !== undefined)
            ? mergeDualValue(sqA.score, sqB.score, { roundStep, roundMethod }, unitMax, mergeMode)
            : (sqA.score ?? sqB.score);
        // 按评语内容决定是否并列（与给分是否相同无关）：措辞不同就都展示
        const cA = (sqA.comment || '').trim();
        const cB = (sqB.comment || '').trim();
        let comment = cA || cB;
        if (cA && cB && cA !== cB) {
            comment = `A: ${cA}；B: ${cB}`;
        }
        return { ...sqA, score: mergedScore, comment };
    });
}

// 双评详情重建：分数计算/评分依据必须与合并后的分数一致，不能沿用单模型原文
function buildDualEvalDetail(detailA, detailB, finalSubScores, finalScore, mergeMode) {
    const sections = { ...(detailA?._sections || {}) };
    if (finalSubScores && finalSubScores.length > 0) {
        const parts = finalSubScores.map(s =>
            `${s.label}得分${(s.score !== null && s.score !== undefined) ? s.score + '分' : '—'}`);
        sections['分数计算'] = `${parts.join(' + ')} = 总得分${finalScore}分`;
    } else {
        const mergeLabel = mergeMode === 'min' ? '双评取低分' : mergeMode === 'max' ? '双评取高分' : '双评平均';
        sections['分数计算'] = `${mergeLabel} = 总得分${finalScore}分`;
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
    const sourceWorkflow = config.workflowSnapshot || WorkflowManager.getWorkflow(config.workflowId);
    const workflow = sourceWorkflow ? JSON.parse(JSON.stringify(sourceWorkflow)) : null;
    if (!workflow || !workflow.dualEval || !workflow.dualEval.enabled) {
        // 非双评模式，走普通流程
        return callAIGrading(base64DataArray, config, onStreamUpdate);
    }

    const dualConfig = workflow.dualEval;
    const arbitrationSnapshot = ProviderManager.getCallConfig(dualConfig.arbitration?.provider, dualConfig.arbitration?.model);
    const threshold = dualConfig.threshold != null ? dualConfig.threshold : 2;

    // 获取主模型和副模型配置
    const primaryConfig = ProviderManager.getCallConfig(
        workflow.model.provider, workflow.model.model
    );
    if (primaryConfig && workflow.model.reasoningEffort) {
        primaryConfig.reasoningEffort = workflow.model.reasoningEffort;
    }
    const secondaryConfig = ProviderManager.getCallConfig(
        dualConfig.secondary?.provider, dualConfig.secondary?.model
    );
    if (secondaryConfig && dualConfig.secondary.reasoningEffort) {
        secondaryConfig.reasoningEffort = dualConfig.secondary.reasoningEffort;
    }

    if (!primaryConfig || !secondaryConfig) {
        throw new Error('双评模型配置不完整，请重新选择主模型和副模型');
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

    // 单侧解析为 null 时重试该侧一次（#287）：模型偶发格式漂移/漏段落不应让整批批改停摆。
    // 仅对「调用成功但解析失败」重试（rejected 的模型异常已走 callAIGrading 内部重试，不重复打）；
    // 重试仍不可解析则保留下方显式抛错，数据安全门不放松
    async function retryUnparsedSide(cfg, label) {
        console.warn(`⚠️ [双评] ${label} 结果不可解析（score=null），重试一次...`);
        if (onStreamUpdate) onStreamUpdate(`🔄 双评：${label}结果不可解析，正在重试...`);
        try {
            const r = await callAIGrading(base64DataArray, { ...config, ...cfg }, null);
            return (r && r.score !== null && r.score !== undefined) ? r : null;
        } catch (e) {
            console.warn(`⚠️ [双评] ${label} 重试失败:`, e && e.message);
            return null;
        }
    }
    if (scoreA === null && resultA.status === 'fulfilled') {
        detailA = await retryUnparsedSide(primaryConfig, '主模型');
        scoreA = detailA ? detailA.score : null;
    }
    if (scoreB === null && resultB.status === 'fulfilled') {
        detailB = await retryUnparsedSide(secondaryConfig, '副模型');
        scoreB = detailB ? detailB.score : null;
    }

    if (scoreA === null || scoreB === null) {
        const failure = resultA.status === 'rejected' ? resultA.reason : resultB.status === 'rejected' ? resultB.reason : null;
        throw failure || new Error('双评结果不完整，请检查两个模型的回答后继续批改');
    }

    const diff = Math.abs(scoreA - scoreB);
    console.log(`🔄 [双评] 结果 — 主模型: ${scoreA}, 副模型: ${scoreB}, 分差: ${diff}`);

    // 分差在阈值内
    if (diff <= threshold) {
        // 总分合并同步走 mergeMode + roundStep 吸附 + 满分钳制（工单②；缺省 round 与原平均逐值一致）
        let finalScore = mergeDualValue(scoreA, scoreB, {
            roundStep: config.scoring?.roundStep || 1,
            roundMethod: config.scoring?.roundMethod || 'round'
        }, config.scoring?.maxScore, dualConfig.mergeMode);
        console.log(`✅ [双评] 分差在阈值内，合并分(${dualConfig.mergeMode || 'round'}): ${finalScore}`);

        // 处理分小题分数：对每个小题按 mergeMode 合并
        const finalSubScores = mergeDualSubScores(detailA, detailB, config.scoring, dualConfig.mergeMode);
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
        const detail = buildDualEvalDetail(detailA, detailB, finalSubScores, finalScore, dualConfig.mergeMode);

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

    const arbConfig = arbitrationSnapshot;
    if (arbConfig && dualConfig.arbitration.reasoningEffort) {
        arbConfig.reasoningEffort = dualConfig.arbitration.reasoningEffort;
    }
    if (!arbConfig) {
        console.warn('⚠️ [三评] 仲裁模型配置不完整，按 mergeMode 合并 A/B');
        // 仲裁降级合并同步走 mergeMode + roundStep/roundMethod + 满分钳制（#289 二轮审计 A-1 + 工单②）
        const finalScore = mergeDualValue(scoreA, scoreB, {
            roundStep: config.scoring?.roundStep || 1,
            roundMethod: config.scoring?.roundMethod || 'round'
        }, config.scoring?.maxScore, dualConfig.mergeMode);
        const finalSubScores = mergeDualSubScores(detailA, detailB, config.scoring, dualConfig.mergeMode);
        const detail = buildDualEvalDetail(detailA, detailB, finalSubScores, finalScore, dualConfig.mergeMode);
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
        const fallbackSubScores = mergeDualSubScores(detailA, detailB, config.scoring, dualConfig.mergeMode);
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
