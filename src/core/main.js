// ========== 页面元素等待与检测 ==========
function waitForElement(selector, timeoutOrDoc = 15000) {
    // 支持传入自定义document（用于iframe检测）
    const isDoc = timeoutOrDoc && typeof timeoutOrDoc.querySelector === 'function';
    const doc = isDoc ? timeoutOrDoc : document;
    const timeout = isDoc ? 15000 : timeoutOrDoc;

    return new Promise((resolve, reject) => {
        const immediateCheck = doc.querySelector(selector);
        if (immediateCheck) return resolve(immediateCheck);
        const startTime = Date.now();
        const timer = setInterval(() => {
            const element = doc.querySelector(selector);
            if (element) {
                clearInterval(timer);
                resolve(element);
            } else if (Date.now() - startTime > timeout) {
                clearInterval(timer);
                reject(new Error('等待元素超时: ' + selector));
            }
        }, 200);
    });
}

async function detectMarkingPage() {
    const adapter = window.__AI_MARKER_ADAPTER__;
    if (adapter && adapter.detectMarkingPage) {
        return adapter.detectMarkingPage();
    }
    return false;
}

// ========== 答卷一致性校验（数据安全） ==========
// AI 请求耗时期间若用户翻卷，AI 返回的是旧卷分数，而填分按当前页面 DOM 填，
// 会把旧卷分数填进新卷并自动提交。这里在填分前校验答卷是否仍是原来那份。
//
// 判定策略（既要拦住错卷、又不能误拦）：
//   - 未变化  -> 返回 unchanged:true，主流程零影响（绝大多数情况）
//   - 明确变了 -> 返回 unchanged:false，由调用方抛错进入既有暂停流程
//   - 无法判定 -> 返回 unchanged:null，放行并打告警（不阻塞）
// 任何异常都归入「无法判定」，绝不因校验本身破坏正常批改。
//
// 平台差异处理（实测踩到的两个误拦坑，均已覆盖）：
//   1. 多图平台按加载态过滤取图（img.complete/naturalWidth），翻卷过渡期只能取到
//      已加载的部分 —— 张数/首图会与基准不同，不能据此判「已切换」。
//   2. 平台图片 URL 带 cachebuster（如 ?_=xxx，酷鱼网），同一份卷两次取图 URL 必不同。
//   3. c30/lehua 等 Canvas 型平台返回 canvas.toDataURL() 的 data: URL，每次可能不同
//      且 gatherAnswerImages 内含 0.5~1s 等待 —— 直接跳过图片比对。
//
// 因此比对时做两件事：① 归一化 URL（去掉 query/hash，只留路径）；
// ② 不比张数/首图是否相等，而是看「基准首图（归一化）是否仍在当前集合中」。
function normalizePaperImageUrl(u) {
    if (typeof u !== 'string' || !u) return '';
    let s = u;
    const q = s.indexOf('?');
    if (q !== -1) s = s.slice(0, q);
    const h = s.indexOf('#');
    if (h !== -1) s = s.slice(0, h);
    return s;
}

// normalizedList 为「归一化后的基准 URL 集合」；判定当前集合是否含其中任一个
function paperUrlSetContains(urls, normalizedList) {
    const set = normalizedList || [];
    return (urls || []).some(u => {
        const n = normalizePaperImageUrl(u);
        return n && set.indexOf(n) !== -1;
    });
}

async function scoreInputsCleared(adapter) {
    try {
        if (!adapter || typeof adapter.getScoreInputs !== 'function') return false;
        const inputs = adapter.getScoreInputs() || [];
        if (!inputs.length) return false;
        return inputs.every(x => x && x.element && !String(x.element.value || '').trim());
    } catch (e) {
        return false;
    }
}

async function verifyPaperUnchanged(adapter, recordedUrls) {
    try {
        if (!adapter || typeof adapter.gatherAnswerImages !== 'function') {
            return { unchanged: null, reason: '适配器不支持 gatherAnswerImages' };
        }
        if (!recordedUrls || !recordedUrls.length) {
            return { unchanged: null, reason: '未记录基准图片' };
        }
        const baseline = recordedUrls[0];

        // Canvas 型平台（data: URL）：图片不可比对，跳过重取以免误判与额外耗时
        if (typeof baseline === 'string' && baseline.indexOf('data:') === 0) {
            if (await scoreInputsCleared(adapter)) {
                return { unchanged: false, reason: '分数输入框已清空（Canvas 型平台，图片不可比对）' };
            }
            return { unchanged: null, reason: 'Canvas 型平台，图片不可比对，按原流程继续' };
        }

        // 归一化基准集合（去 cachebuster；过滤空值，空 URL 不能作为比对依据）
        const normBaselineSet = recordedUrls.map(normalizePaperImageUrl).filter(Boolean);
        if (!normBaselineSet.length) {
            return { unchanged: null, reason: '基准图片 URL 为空，无法比对' };
        }

        const newUrls = await adapter.gatherAnswerImages();
        if (!newUrls || !newUrls.length) {
            return { unchanged: null, reason: '重新获取图片为空' };
        }

        // 任一基准图（归一化后）仍在当前集合中 —— 仍是同一份。
        // 用「任一」而非「首图」：翻卷过渡期首图可能恰好未加载被过滤掉，
        // 用首图会误判；用任一基准图在集合中则稳得多。
        // 这同时容忍：翻卷过渡期张数不齐、URL 带 cachebuster 每次不同。
        if (paperUrlSetContains(newUrls, normBaselineSet)) {
            return { unchanged: true };
        }

        // 基准图都不见了 —— 可能真换卷，也可能这些图此刻恰好都未加载完被过滤。
        // 等待片刻复查一次再判定，避免把加载过渡期误判成换卷。
        await new Promise(r => setTimeout(r, 1500));
        const retryUrls = await adapter.gatherAnswerImages();
        if (!retryUrls || !retryUrls.length) {
            return { unchanged: null, reason: '复查时未取到图片，无法判定' };
        }
        if (paperUrlSetContains(retryUrls, normBaselineSet)) {
            return { unchanged: null, reason: '图片加载过渡期，复查后基准图仍在，按原流程继续' };
        }

        // 两次取图都不含任何基准图 —— 确实换了卷
        return { unchanged: false, reason: '答题卡图片已变化（基准图不再出现）' };
    } catch (e) {
        return { unchanged: null, reason: '校验异常: ' + (e && e.message) };
    }
}

// ========== 主控流程 ==========
async function startAutoGrading() {
    window.aiGradingState.abortController = new AbortController();
    console.log('▶️ [诊断] startAutoGrading 开始执行');

    try {
        // 使用新的配置获取方式（优先工作流，回退直接配置）
        const config = PresetManager.getActiveCallConfig();
        if (!config.apiKey) {
            openSettingsPanel();
            showToast('请先配置 AI 密钥');
            window.aiGradingState.isRunning = false;
            return;
        }

        const presetConfig = PresetManager.getCurrentConfig();
        if (!extractFieldText(presetConfig.answer).trim() || !extractFieldText(presetConfig.rubric).trim()) {
            openSettingsPanel();
            showToast('请先填写参考答案和评卷标准');
            window.aiGradingState.isRunning = false;
            return;
        }

        // 检查满分配置是否完整
        const validation = PresetManager.validateScoringUnits();
        if (!validation.valid) {
            const labels = validation.missingMaxScore.map(u => u.label).join('、');
            openSettingsPanel();
            showToast(`请先填写小题分：${labels}`);
            window.aiGradingState.isRunning = false;
            return;
        }

        // 获取工作流信息（用于双评判断）
        const workflowId = presetConfig.workflowId;
        const workflow = workflowId ? WorkflowManager.getWorkflow(workflowId) : null;
        const isDualEval = workflow && workflow.dualEval && workflow.dualEval.enabled;

        if (isDualEval) {
            console.log(`🔄 [诊断] 使用双评模式 — 工作流: ${workflow.name}`);
        } else if (workflow) {
            console.log(`🔍 [诊断] 使用工作流: ${workflow.name} — 模型: ${config.model}`);
        }

        const adapter = window.__AI_MARKER_ADAPTER__;

        // AI 失败重试时复用已下载的图片，避免重新抓取（拦截器缓冲可能已清空）
        const isRetry = window.aiGradingState.errorRetryCount > 0
            && window.aiGradingState.currentBase64DataArray.length > 0;

        let imageUrls, base64DataArray;

        if (isRetry) {
            imageUrls = window.aiGradingState.currentImageUrls;
            base64DataArray = window.aiGradingState.currentBase64DataArray;
            console.log(`♻️ [诊断] 复用已有图片数据进行重试 (${imageUrls.length} 张)`);
        } else {
            console.log(`🔍 使用方案【${PresetManager.data.active}】查找答卷...`);
            imageUrls = adapter ? await adapter.gatherAnswerImages() : [];
            console.log(`🖼️ [诊断] 找到答题卡图片数量: ${imageUrls.length}`);

            if (!imageUrls || imageUrls.length === 0) {
                if (window.aiGradingState.gradingMode === 'unattended') {
                    stopAutoGrading();
                    safeAlert('✅ 所有试卷已批改完成！');
                    return;
                }
                safeAlert('❌ 未找到答题卡图片！');
                window.aiGradingState.isRunning = false;
                return;
            }

            window.aiGradingState.currentImageUrls = imageUrls;

            const gradeBtn = document.querySelector('.ai-grade-btn');
            if (gradeBtn && window.aiGradingState.gradingMode !== 'unattended') {
                gradeBtn.textContent = imageUrls.length > 1 ? `📥 下载多图(${imageUrls.length})...` : '📥 下载图片...';
            }

            console.log(`📥 [诊断] 开始下载 ${imageUrls.length} 张图片...`);
            const fetchFn = adapter && adapter.fetchImageAsBase64 ? adapter.fetchImageAsBase64 : fetchImageAsBase64;
            base64DataArray = await Promise.all(imageUrls.map(url => fetchFn(url)));
            window.aiGradingState.currentBase64DataArray = base64DataArray;
            console.log(`✅ [诊断] 图片下载完成，各图片Base64大小: ${base64DataArray.map(b => Math.round(b.length / 1024) + 'KB').join(', ')}`);
        }

        if (window.aiGradingState.isPaused) throw new Error('用户暂停');

        // ===== 空白答题卡检测 =====
        const blankConfig = presetConfig.blankDetection;
        let blankDetectionResult = null; // 缓存检测结果，避免重复计算
        if (blankConfig && blankConfig.enabled && !window.aiGradingState.blankDetection.skipOnce) {
            const refData = BlankDetector.loadReference();
            if (refData) {
                try {
                    const currentRatios = await BlankDetector.calcBatchRatios(base64DataArray, refData.thresholds);
                    blankDetectionResult = { currentRatios, refData }; // 缓存
                    const result = BlankDetector.isBlankSheet(currentRatios, refData, blankConfig.threshold);
                    if (result.isBlank) {
                        console.log('⏭️ [空白检测] 检测到空白答题卡，自动跳过');
                        window.aiGradingState.blankDetection.blankCount++;
                        showToast(`⏭️ 空白答题卡已跳过（第${window.aiGradingState.blankDetection.blankCount}张）`);

                        // 填入 0 分
                        const scoringConfig = presetConfig.scoring || {};
                        const maxScore = PresetManager.getMaxScore();
                        if (adapter) {
                            const units = scoringConfig.units || [];
                            if (adapter.fillScores && units.length > 0) {
                                adapter.fillScores(units.map(() => 0));
                            } else if (adapter.fillScores) {
                                adapter.fillScores([0]);
                            }
                        }

                        // 显示提交对话框
                        const zeroSubScores = (scoringConfig.units || []).map(u => ({
                            label: u.label, score: 0, maxScore: u.maxScore
                        }));
                        showAutoSubmitDialog(0, '空白答题卡，自动判0分', zeroSubScores, {
                            isBlankCard: true,
                            blankRatios: {
                                current: currentRatios.map(r => ({ ratio: r.ratio, skipped: r.skipped })),
                                reference: refData.ratios,
                                threshold: blankConfig.threshold
                            }
                        });
                        return;
                    } else {
                        console.log(`🔍 [空白检测] 非空白卡 — ${result.reason}`);
                    }
                } catch (e) {
                    console.warn('⚠️ [空白检测] 检测失败，继续正常批改:', e);
                }
            }
        }
        // 重置跳过标记（仅生效一次）
        window.aiGradingState.blankDetection.skipOnce = false;
        // ===== 空白检测结束 =====

        const gradeBtnEl = document.querySelector('.ai-grade-btn');
        if (gradeBtnEl && window.aiGradingState.gradingMode !== 'unattended') {
            gradeBtnEl.textContent = '⏳ AI分析中...';
            showStreamPanel();
        }

        console.log('🤖 [诊断] 开始调用AI接口...');
        // 根据是否启用双评，选择调用方式
        const outputObservation = { upgraded: false };
        const outputLimitKey = JSON.stringify({
            preset: PresetManager.data.active,
            workflowId,
            model: workflow?.model || config.model,
            dualEval: workflow?.dualEval || null,
            endpoint: config.endpoint,
            outputLimitEnabled: config.outputLimitEnabled !== false,
            maxOutputTokens: config.maxOutputTokens || 2048
        });
        const gradingConfig = { ...config, workflowId, outputObservation, outputLimitKey };
        const result = isDualEval
            ? await callDualEvaluation(base64DataArray, gradingConfig, (streamedText) => {
                if (window.aiGradingState.gradingMode !== 'unattended') updateStreamPanel(streamedText);
            })
            : await callAIGrading(base64DataArray, gradingConfig, (streamedText) => {
                if (window.aiGradingState.gradingMode !== 'unattended') updateStreamPanel(streamedText);
            });

        hideStreamPanel();
        if (window.aiGradingState.isPaused) throw new Error('用户暂停');

        console.log(`📊 [诊断] callAIGrading 返回 — score: ${result.score}, comment长度: ${(result.comment || '').length}字`);
        if (result.score !== undefined && result.score !== null) {
            recordOutputLimitOutcome(gradingConfig);
            const scoringConfig = presetConfig.scoring || { roundStep: 1, roundMethod: 'round' };
            const maxScore = PresetManager.getMaxScore();

            // 字数 ≤ 15 或未作答时，强制无勤勉分
            let diligenceLevel = result.diligenceLevel || 0;
            const answerLen = (result.studentAnswer || '').replace(/\s/g, '').length;
            if (answerLen <= 15) diligenceLevel = 0;

            // 使用 ScoreCalculator 统一计算流水线
            // 将配置中的 roundStep 合并到 AI 返回的小题分数中
            const configUnits = scoringConfig.units || [];
            const aiUnitScores = result.subScores
                ? result.subScores.map((sq, i) => ({
                    ...sq,
                    roundStep: configUnits[i]?.roundStep || scoringConfig.roundStep
                }))
                : null;

            const calculated = ScoreCalculator.calculate({
                aiScore: result.rawScore || result.score,
                diligenceLevel,
                maxScore,
                scoringConfig,
                aiUnitScores
            });

            const { finalScore, finalUnitScores, bonus: roundedBonus, breakdown } = calculated;

            window.aiGradingState.currentStudentAnswer = result.studentAnswer || '未能识别';
            window.aiGradingState.errorRetryCount = 0;
            // ===== 答卷一致性校验（数据安全，实验性可关）=====
            // 请求耗时期间若已翻卷，旧卷分数绝不能填进新卷。
            // 若用户遇到误报，可在设置面板「答卷校验」关闭此项。
            if (presetConfig.paperGuard && presetConfig.paperGuard.enabled === false) {
                console.log('ℹ️ [答卷校验] 已在设置中关闭，跳过填分前校验');
            } else {
                const verifyAdapter = window.__AI_MARKER_ADAPTER__;
                const paperCheck = await verifyPaperUnchanged(verifyAdapter, imageUrls);
                if (paperCheck.unchanged === false) {
                    console.warn('🚫 [答卷校验] 答卷已切换，丢弃本次结果:', paperCheck.reason);
                    throw new Error('答卷已切换，本次评分结果已丢弃，请人工核对后再继续（' + paperCheck.reason + '）');
                }
                if (paperCheck.unchanged === null) {
                    console.warn('⚠️ [答卷校验] 无法判定答卷是否变化，按原流程继续:', paperCheck.reason);
                }
            }

            console.log(`✏️ [诊断] 准备填入分数: ${finalScore}，调用 fillScores...`);

            // 填分：优先使用新接口 fillScores，回退到旧接口 fillScore
            const adapter = window.__AI_MARKER_ADAPTER__;
            if (adapter) {
                if (adapter.fillScores && finalUnitScores) {
                    // 新接口：按评分单元顺序填入
                    adapter.fillScores(finalUnitScores.map(u => u.score));
                } else if (adapter.fillScores) {
                    // 单题模式
                    adapter.fillScores([finalScore]);
                } else if (adapter.fillScore) {
                    // 旧接口兼容
                    adapter.fillScore({ total: finalScore, subScores: finalUnitScores });
                }
            }
            // 传递结构化评分详情、双评信息和勤勉信息到提交对话框
            // 如果开启了空白卡检测且有范本，附带当前图的占比数据（复用之前缓存的结果）
            let blankRatiosData = null;
            if (blankConfig && blankConfig.enabled) {
                try {
                    // 优先复用缓存的检测结果
                    if (blankDetectionResult) {
                        blankRatiosData = {
                            current: blankDetectionResult.currentRatios.map(r => ({ ratio: r.ratio, skipped: r.skipped })),
                            reference: blankDetectionResult.refData.ratios,
                            threshold: blankConfig.threshold
                        };
                    } else {
                        const refForDialog = BlankDetector.loadReference();
                        if (refForDialog) {
                            const curRatios = await BlankDetector.calcBatchRatios(base64DataArray, refForDialog.thresholds);
                            blankRatiosData = {
                                current: curRatios.map(r => ({ ratio: r.ratio, skipped: r.skipped })),
                                reference: refForDialog.ratios,
                                threshold: blankConfig.threshold
                            };
                        }
                    }
                } catch (e) { /* 静默失败，不影响主流程 */ }
            }
            showAutoSubmitDialog(finalScore, result.comment, finalUnitScores || result.subScores, {
                scoringDetails: result._sections || null,
                dualEval: result.dualEval || null,
                rawScore: result.rawScore || result.score,
                diligence: {
                    level: diligenceLevel,
                    reason: result.diligenceReason || '',
                    bonus: roundedBonus,
                    decayFactor: breakdown.decayFactor,
                    accuracyScore: breakdown.accuracyScore
                },
                blankRatios: blankRatiosData
            });
        } else {
            throw new Error('AI未返回可识别的分数，请检查模型回答后继续批改');
        }

    } catch (error) {
        hideStreamPanel();
        if (error.message === '用户主动暂停' || error.message === '用户暂停') {
            console.log('⏸️ 请求已被暂停');
            return;
        }

        console.error('❌ 打分失败:', error);
        console.error('❌ 批改失败，已暂停:', error);
        window.aiGradingState.isRunning = false;
        window.aiGradingState.isPaused = true;
        const btn = document.querySelector('.ai-grade-btn');
        if (btn) {
            btn.textContent = '继续批改';
            btn.classList.remove('running', 'unattended', 'trial');
            btn.classList.add('paused');
        }
        showToast(`批改已暂停：${error.message}。检查后可继续批改`);
    }
}

// ========== 批阅份数功能 ==========
function initBatchProgress() {
    // 从配置中加载批阅份数设置
    const config = PresetManager.getCurrentConfig();
    console.log(`📊 [诊断] initBatchProgress — batchConfig:`, config.batchConfig);
    if (config.batchConfig && config.batchConfig.enabled) {
        window.aiGradingState.batchProgress.enabled = true;
        window.aiGradingState.batchProgress.targetCount = config.batchConfig.targetCount || 0;
        window.aiGradingState.batchProgress.reached = false; // 重置达到标记
        window.aiGradingState.batchProgress.limitExempt = false; // 重置豁免标记
        // 从 sessionStorage 恢复当前批阅份数（同一会话内有效）
        const savedCount = parseInt(sessionStorage.getItem('ai-batch-current-count') || '0');
        window.aiGradingState.batchProgress.currentCount = savedCount;

        // 如果已经达到了目标，标记为已达到
        if (window.aiGradingState.batchProgress.targetCount > 0 &&
            savedCount >= window.aiGradingState.batchProgress.targetCount) {
            window.aiGradingState.batchProgress.reached = true;
        }

        console.log(`📊 [批阅份数] 已启用，目标: ${window.aiGradingState.batchProgress.targetCount}，当前: ${savedCount}`);
    } else {
        // 批阅份数未启用，重置状态并移除进度条
        window.aiGradingState.batchProgress.enabled = false;
        window.aiGradingState.batchProgress.targetCount = 0;
        window.aiGradingState.batchProgress.currentCount = 0;
        window.aiGradingState.batchProgress.reached = false;
        window.aiGradingState.batchProgress.limitExempt = false;
    }
}

function updateBatchProgress() {
    const batch = window.aiGradingState.batchProgress;
    if (!batch.enabled) {
        console.log('📊 [诊断] updateBatchProgress — batch.enabled=false，跳过');
        return;
    }

    batch.currentCount++;
    sessionStorage.setItem('ai-batch-current-count', batch.currentCount.toString());
    console.log(`📊 [诊断] updateBatchProgress — 已批阅: ${batch.currentCount}/${batch.targetCount}`);

    console.log(`📊 [批阅份数] 已批阅: ${batch.currentCount}/${batch.targetCount}`);

    // 更新进度显示
    renderBatchProgress();

    // 检查是否达到目标份数（只暂停一次，避免重复触发；limitExempt 时跳过自动暂停）
    if (batch.targetCount > 0 && batch.currentCount >= batch.targetCount && !batch.reached && !batch.limitExempt) {
        batch.reached = true; // 标记已达到，避免重复触发
        console.log('🎯 [批阅份数] 已达到目标份数，自动暂停');
        if (window.aiGradingState.isRunning) {
            // 暂停批改（不刷新页面）
            window.aiGradingState.isPaused = true;
            window.aiGradingState.isRunning = false;
            if (window.aiGradingState.abortController) {
                window.aiGradingState.abortController.abort();
            }

            const btn = document.querySelector('.ai-grade-btn');
            if (btn) {
                btn.textContent = '继续批改';
                btn.classList.remove('running', 'unattended');
                btn.classList.add('paused');
            }

            showToast(`🎯 已达到目标批阅份数 (${batch.targetCount}份)，自动暂停`);
        }
    }
}

function resetBatchProgress() {
    window.aiGradingState.batchProgress.currentCount = 0;
    window.aiGradingState.batchProgress.reached = false;
    window.aiGradingState.batchProgress.limitExempt = false;
    sessionStorage.setItem('ai-batch-current-count', '0');
    renderBatchProgress();
    console.log('📊 [批阅份数] 计数已重置');
}
// 在函数定义后立即暴露到全局作用域，确保 inline onclick 可调用
window.resetBatchProgress = resetBatchProgress;

// ========== 工具页面模式检测 ==========
function isToolsPageMode() {
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;
    return (hostname === 'aimarking.five-plus-one.com' ||
            hostname === 'five-plus-one.github.io') &&
           pathname.includes('/tools');
}

async function initToolsPageMode() {
    console.log('📚 [工具页面] 初始化');

    // 显示加载提示
    const container = document.getElementById('ai-tools-root');
    if (container) {
        container.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:#86868b;">
                <div style="font-size:48px;margin-bottom:16px;">🛠️</div>
                <h2 style="font-size:18px;font-weight:600;color:#1a1a1a;margin-bottom:8px;">正在加载工具页面...</h2>
                <p style="font-size:13px;color:#aaa;margin-top:8px;">请稍候</p>
            </div>
        `;
    }

    // 初始化管理器
    await HistoryManager.init();
    ProviderManager.init();
    WorkflowManager.init();

    // 注入工具页面 UI
    createToolsPageUI();

    // 检查更新（延迟）
    setTimeout(() => checkForUpdate(), 3000);
}

// ========== 初始化 ==========
async function init() {
    if (window !== window.top) return; // 跳过 iframe
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 检测是否在工具页面
    if (isToolsPageMode()) {
        await initToolsPageMode();
        return;
    }

    const adapter = window.__AI_MARKER_ADAPTER__;

    // 检测是否在批改页面，支持重试（SPA应用可能需要更长时间加载）
    let isMarkingPage = await detectMarkingPage();
    if (!isMarkingPage) {
        // 第一次检测失败，等待后重试
        await new Promise(resolve => setTimeout(resolve, 2000));
        isMarkingPage = await detectMarkingPage();
        if (!isMarkingPage) {
            // 非阅卷页面：如果在阅卷平台上，仅注入历史按钮
            if (adapter) {
                console.log('📚 [诊断] 非阅卷页面，注入历史按钮');
                createHistoryOnlyButton();
            } else {
                console.log('🔎 [诊断] 未检测到批改页面，跳过初始化');
            }
            return;
        }
    }

    console.log('✅ [诊断] 检测到批改页面，开始初始化UI');
    createMainButton();

    // 首次启动或重置后显示新手引导
    const showOnboarding = GM_getValue('ai-grading-show-onboarding', true);
    if (showOnboarding) {
        // 先创建设置面板但不打开（避免空表单与 OOBE 竞争）
        createSettingsPanel({ deferOpen: true });
        setTimeout(() => showOnboardingDialog(true, 'first-launch'), 500);
    } else {
        createSettingsPanel();
    }
    if (typeof updateMainButtonState === 'function') updateMainButtonState();

    // 初始化批阅份数功能
    initBatchProgress();
    renderBatchProgress();

    // 检查更新（延迟 5 秒，避免影响页面主要功能加载）
    setTimeout(() => checkForUpdate(), 5000);

    // 更新后刷新提示
    if (sessionStorage.getItem('ai-update-reloaded') === 'true') {
        sessionStorage.removeItem('ai-update-reloaded');
        showToast('脚本已更新至最新版本 v' + SCRIPT_CONFIG.VERSION);
    }

    // 配置恢复提示
    const restoredFrom = sessionStorage.getItem('ai-config-restored');
    if (restoredFrom) {
        sessionStorage.removeItem('ai-config-restored');
        showToast(`配置已从备份恢复（备份于 v${restoredFrom}）`);
    }

    if (sessionStorage.getItem('ai-grading-auto-resume') === 'true') {
        sessionStorage.removeItem('ai-grading-auto-resume');
        window.aiGradingState.errorRetryCount = parseInt(sessionStorage.getItem('ai-grading-retry-count') || '0');
        sessionStorage.removeItem('ai-grading-retry-count');
        setTimeout(() => toggleAutoGrading(), 3000);
    }

    // 检查是否有回评任务
    const regradeData = sessionStorage.getItem('ai-grading-regrade');
    if (regradeData) {
        try {
            const { id } = JSON.parse(regradeData);
            const record = HistoryManager.getById(id);
            if (record) {
                window.aiGradingState.isRegrading = true;
                showToast('正在加载回评数据...');
                setTimeout(async () => {
                    // 等待图片加载
                    const adapter = window.__AI_MARKER_ADAPTER__;
                    const imageUrls = adapter ? await adapter.gatherAnswerImages() : [];
                    if (imageUrls.length === 0) {
                        showAlertModal('未找到答题卡图片，无法回评。').then(() => {
                            sessionStorage.removeItem('ai-grading-regrade');
                            window.aiGradingState.isRegrading = false;
                        });
                        return;
                    }
                    const fetchFn = adapter && adapter.fetchImageAsBase64 ? adapter.fetchImageAsBase64 : fetchImageAsBase64;
                    const base64DataArray = await Promise.all(imageUrls.map(url => fetchFn(url)));
                    window.aiGradingState.currentBase64DataArray = base64DataArray;

                    showCorrectionPanel({
                        score: record.aiScore, comment: record.aiComment,
                        studentAnswer: record.studentAnswer, imageUrls,
                        base64DataArray, config: PresetManager.getCurrentConfig(),
                        callConfig: PresetManager.getActiveCallConfig(),
                        subScores: record.subScores,
                        onAccept(finalScore, correctionInfo) {
                            const correctedSubScores = correctionInfo.correctedSubScores || record.subScores;
                            HistoryManager.update(id, {
                                finalScore, isCorrected: correctionInfo.isCorrected,
                                correctionReason: correctionInfo.correctionReason,
                                subScores: correctedSubScores, status: 'submitted'
                            });
                            fillScore(finalScore, record.aiComment, correctedSubScores);
                            sessionStorage.removeItem('ai-grading-regrade');
                            window.aiGradingState.isRegrading = false;
                            showToast('回评完成！分数已填入。');
                        },
                        onCancel() {
                            sessionStorage.removeItem('ai-grading-regrade');
                            window.aiGradingState.isRegrading = false;
                            showToast('已取消回评');
                        }
                    });
                }, 3000);
            }
        } catch (e) {
            console.error('回评数据解析失败:', e);
            sessionStorage.removeItem('ai-grading-regrade');
        }
    }
}

const adapter = window.__AI_MARKER_ADAPTER__;
console.log(`🚀 ${adapter ? adapter.name : 'AI-Marker-Suite'} 打分助手加载中...`);
console.log(`📌 [诊断] 脚本版本: ${SCRIPT_CONFIG.VERSION} | 平台: ${adapter ? adapter.name : '未知'} | 浏览器: ${navigator.userAgent.match(/(Chrome|Firefox|Edge)\/[\d.]+/)?.[0] || '未知'} | 时间: ${new Date().toLocaleString()}`);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    setTimeout(init, 1000);
}

// URL 及 题号变化监听器 (轻量级轮询)
let lastUrlId = PresetManager.getTaskIdentifier();
setInterval(async () => {
    const currentUrlId = PresetManager.getTaskIdentifier();
    if (currentUrlId !== lastUrlId) {
        lastUrlId = currentUrlId;

        const adapter = window.__AI_MARKER_ADAPTER__;
        // 如果没有适配器，检测是否通过 SPA 导航进入了工具页面
        if (!adapter) {
            if (isToolsPageMode()) {
                // 等待 VitePress SPA 完成渲染（VitePress 主题自身用 300ms，
                // 这里给更充裕的时间确保 #ai-tools-root 已挂载）
                await new Promise(resolve => setTimeout(resolve, 1500));
                // 延迟后重新检查条件（页面可能已再次切换）
                if (isToolsPageMode() && !document.getElementById('ai-tools-page')) {
                    await initToolsPageMode();
                }
            }
            return;
        }

        if (adapter.isRegradeMode ? adapter.isRegradeMode() : window.aiGradingState.isRegrading) return;

        if (!window.aiGradingState.isRunning) {
            // 非阅卷页面不弹窗，直接返回
            // 优先使用快速检查（不等待 DOM），回退到完整检测
            const onMarkingPage = adapter.isMarkingPage
                ? adapter.isMarkingPage()
                : (adapter.detectMarkingPage ? await adapter.detectMarkingPage() : true);
            if (!onMarkingPage) return;

            // SPA 导航到阅卷页面时，先确保 UI 已创建（按钮 + 设置面板）
            // 必须在 early return 之前调用，否则新题目引导/无 API Key 时面板不会出现
            // init 内部有防重复创建的 guard，不会产生重复 UI
            setTimeout(init, 1000);

            const boundPreset = PresetManager.data.bindings[currentUrlId];

            // ========== OOBE调试日志 ==========
            console.log('🔍 [OOBE调试] currentUrlId:', currentUrlId);
            console.log('🔍 [OOBE调试] boundPreset:', boundPreset);
            console.log('🔍 [OOBE调试] 所有绑定:', JSON.stringify(PresetManager.data.bindings));
            console.log('🔍 [OOBE调试] 活动配置:', PresetManager.data.active);
            console.log('🔍 [OOBE调试] 配置列表:', Object.keys(PresetManager.data.list).join(', '));
            // ========== OOBE调试日志结束 ==========

            if (boundPreset && PresetManager.data.list[boundPreset]) {
                PresetManager.data.active = boundPreset;
                PresetManager.save();
                showToast(`✨ 检测到新试题，已自动切换至【${PresetManager.data.active}】方案`);
            } else if (PresetManager.data.active !== "默认配置" && PresetManager.data.list["默认配置"]) {
                PresetManager.data.active = "默认配置";
                PresetManager.save();
                showToast(`📝 未找到当前题目的专属方案，已恢复为【默认配置】`);
            }

            // 检查 API KEY 是否配置
            const apiKey = ProviderManager.getProvider('5plus1官方')?.apiKey || '';
            console.log('🔍 [OOBE调试] apiKey存在:', !!apiKey);
            if (!apiKey) {
                console.log('🔍 [OOBE调试] 无API Key，弹出首次启动OOBE');
                showOnboardingDialog(true, 'first-launch');
                return;
            }

            // 检查是否是新试题（未绑定配置）
            console.log('🔍 [OOBE调试] 检查新试题条件: boundPreset=', boundPreset, ', 存在配置=', !!PresetManager.data.list[boundPreset]);
            if (!boundPreset || !PresetManager.data.list[boundPreset]) {
                console.log('🔍 [OOBE调试] 条件满足，弹出新试题OOBE');
                showOnboardingDialog(true, 'new-question');
                return;
            } else {
                console.log('🔍 [OOBE调试] 条件不满足，不弹出OOBE');
            }

            const select = document.getElementById('preset-select');
            if (select) {
                select.value = PresetManager.data.active;
                select.dispatchEvent(new Event('change'));
            }
        }
    }
}, 1000);

// ========== 油猴菜单注册 ==========
function registerMenuCommands() {
    if (typeof GM_registerMenuCommand === 'undefined' || window !== window.top) return;

    GM_registerMenuCommand('🛠️ 工具栏', () => {
        window.open('https://aimarking.five-plus-one.com/tools', '_blank');
    });

    GM_registerMenuCommand('📊 历史记录', () => {
        showHistoryPanel();
    });
}

registerMenuCommands();
