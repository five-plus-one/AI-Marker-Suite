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

// 快照当前评分输入框的值（Canvas 型平台换卷判定的对照基准）。
// 只有真实 input/textarea 参与（有 value 属性）；点击式分数容器记 null。
// 注意 value 可能是数字 0（合法分值，非空），不能用 ||'' 判空
function snapshotScoreInputs(adapter) {
    try {
        if (!adapter || typeof adapter.getScoreInputs !== 'function') return [];
        return (adapter.getScoreInputs() || []).map(x => {
            const el = x && x.element;
            return (el && typeof el === 'object' && 'value' in el)
                ? (el.value == null ? '' : String(el.value)) : null;
        });
    } catch (e) {
        return [];
    }
}

// Canvas 型平台（data: 基准图）的换卷证据只有一种可靠形态：
// 「取图时非空 → 校验时全空」的跃变。
// 「空 → 空」是填分前的正常状态（校验本就发生在填分之前），绝不能判换卷——
// 那是 #253 误报的根源；点击式分数容器（无 value）永远不参与判定。
async function scoreInputsTransitionedEmpty(adapter, snapshot) {
    try {
        if (!adapter || typeof adapter.getScoreInputs !== 'function') return false;
        if (!snapshot || !snapshot.length) return false; // 无快照 = 不可判定，放行
        const hadValue = snapshot.some(v => v != null && String(v).trim() !== '');
        if (!hadValue) return false; // 取图时就没有值 → 现在为空是常态
        const inputs = adapter.getScoreInputs() || [];
        let realCount = 0;
        for (const x of inputs) {
            const el = x && x.element;
            if (!el || typeof el !== 'object' || !('value' in el)) continue;
            realCount++;
            const v = el.value == null ? '' : String(el.value);
            if (v.trim() !== '') return false; // 还有值（含 0 分），未被清空
        }
        return realCount > 0;
    } catch (e) {
        return false;
    }
}

async function verifyPaperUnchanged(adapter, recordedUrls, inputSnapshot, recordedPaperId) {
    try {
        if (!adapter || typeof adapter.gatherAnswerImages !== 'function') {
            return { unchanged: null, reason: '适配器不支持 gatherAnswerImages' };
        }
        // 已离开批改页（如退回列表页）≠ 换卷：跳过比对，绝不能误报「基准图不再出现」
        if (typeof adapter.isMarkingPage === 'function' && !adapter.isMarkingPage()) {
            return { unchanged: null, reason: '已离开批改页面，跳过答卷校验' };
        }
        if (!recordedUrls || !recordedUrls.length) {
            return { unchanged: null, reason: '未记录基准图片' };
        }

        // 稳定试卷标识比对（最强信号，#281）：适配器提供标识（如考号）时优先使用——
        // 同卷 src 重设/裁切产物波动不改变标识，换卷必变
        try {
            const state = (typeof window !== 'undefined' && window.aiGradingState) ? window.aiGradingState : null;
            const recordedId = recordedPaperId === undefined ? (state && state.currentPaperId) : recordedPaperId;
            if (recordedId && typeof adapter.getPaperIdentity === 'function') {
                const pid = adapter.getPaperIdentity();
                if (pid) {
                    if (pid === recordedId) {
                        return { unchanged: true };
                    }
                    return { unchanged: false, reason: '试卷标识已变化（' + recordedId + ' → ' + pid + '）' };
                }
            }
        } catch (e) { /* 标识不可用时退回既有比对 */ }

        const baseline = recordedUrls[0];

        // Canvas 型平台（data: URL）：图片不可比对，跳过重取以免误判与额外耗时。
        // 换卷证据只认「取图时非空 → 现在全空」的跃变（见 scoreInputsTransitionedEmpty）
        if (typeof baseline === 'string' && baseline.indexOf('data:') === 0) {
            if (await scoreInputsTransitionedEmpty(adapter, inputSnapshot)) {
                return { unchanged: false, reason: '分数输入框由非空变为清空（Canvas 型平台，疑似换卷）' };
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

// 离开批改页的判定必须「复查确认」：DOM 型 isMarkingPage（frame/组件重载）
// 会短暂返回 false，瞬时 false 绝不能触发清理（会误杀进行中的批改）
async function confirmLeftMarkingPage(adapter) {
    if (!adapter || typeof adapter.isMarkingPage !== 'function') return false;
    if (adapter.isMarkingPage()) return false;
    await new Promise(r => setTimeout(r, 800));
    return !adapter.isMarkingPage();
}

// 回评图片就绪探测（strict-a C.4）：固定 3s 等待改短轮询——就绪即返回，探测总上限不变。
// 判据与回评取图同源（adapter.gatherAnswerImages）；无适配器/无该方法立即放行；
// 探测异常不打断（继续轮询到上限，交由既有空图分支显式处理）。
async function waitForImagesReadyForRegrade(adapter, timeoutMs, pollMs) {
    if (!adapter || typeof adapter.gatherAnswerImages !== 'function') return;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const urls = await adapter.gatherAnswerImages();
            if (urls && urls.length > 0) return;
        } catch (e) { /* 探测失败继续轮询 */ }
        await new Promise(r => setTimeout(r, pollMs));
    }
}

// ========== 分数数值闸（N5 坑审计收口）==========
// 坑审计实锤：纠正流是唯一 NaN 入口（用户编辑/解析可注入 NaN/∞/负数），而 24 家
// 全或无适配器无数值闸（仅 huahanyun/xkw/haofenshu 三遍式有）——core 在填分汇聚点
// 统一收口：全部分数必须 isFinite 且非负；越界（超满分）留给各适配器 maxScore 语义。
// 非法值显式拒绝 + warn（绝不静默替换成 0/跳过——空分提交=事故），落调用方既有失败通道。
function validateScoresForFill(values, ctx) {
    const bad = [];
    (values || []).forEach((v, i) => {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
            bad.push(`#${i}=${v}`);
        }
    });
    if (bad.length > 0) {
        console.warn(`⚠️ [数值闸] ${ctx || '填分'}：拒绝非法分数（NaN/∞/负数/非数值）: ` + bad.join('；'));
        return false;
    }
    return true;
}

// 填分统一汇聚点：adapter.fillScores 前置数值闸（一处收口覆盖全仓）
function safeFillScores(adapter, scores, ctx) {
    if (!validateScoresForFill(scores, ctx)) return false;
    return adapter.fillScores(scores);
}

// ========== 离开批改页的生命周期清理 ==========
// SPA 导航（如退回列表页）不销毁 DOM：OOBE 弹窗会残留、批改循环会把
//「离开页面」误当成「所有试卷已批改完成」。离开时统一清理、中性停止
function handleLeaveMarkingPage() {
    invalidateGradingRun();
    // 1. 关闭新手引导弹窗
    if (typeof hideOnboardingDialog === 'function') hideOnboardingDialog();

    // 2. 关闭提交确认弹窗（取消倒计时，防止在非批改页误触发提交）
    const dialog = document.getElementById('auto-submit-dialog');
    if (dialog) {
        if (dialog.countdownTimer) clearInterval(dialog.countdownTimer);
        dialog.remove();
    }

    // 3. 批改循环中性停止——绝不能报「所有试卷已批改完成」
    if (window.aiGradingState.isRunning) {
        window.aiGradingState.isRunning = false;
        window.aiGradingState.isPaused = true;
        const btn = document.querySelector('.ai-grade-btn');
        if (btn) {
            btn.textContent = '继续批改';
            btn.classList.remove('running', 'unattended', 'trial');
            btn.classList.add('paused');
        }
        showToast('已离开批改页面，批改已暂停');
    }
}

// ========== 主控流程 ==========
async function startAutoGrading() {
    if (!window.aiGradingState.isRunning || window.aiGradingState.isPaused) return;
    const runContext = createGradingContext();
    // 批改节奏：本卷用时计时起点（开始处理 → 提交，含随机延迟）
    // 已有起点（翻卷检测时刻）时不覆盖，保住「检测到→提交」的完整窗口
    if (!window.aiGradingState.cycleStartTime) {
        window.aiGradingState.cycleStartTime = Date.now();
    }
    console.log('▶️ [诊断] startAutoGrading 开始执行');

    // 离开批改页（如退回列表页）：中性停止，绝不能报「所有试卷已批改完成」
    // 复查确认后才动手：DOM 型 isMarkingPage 在组件重载瞬间会短暂 false
    const leftPage = await confirmLeftMarkingPage(runContext.adapter);
    if (!isGradingContextCurrent(runContext)) return;
    if (leftPage) {
        console.log('ℹ️ 已离开批改页面，停止本轮批改');
        handleLeaveMarkingPage();
        return;
    }

    try {
        // 使用新的配置获取方式（优先工作流，回退直接配置）
        const config = JSON.parse(JSON.stringify(PresetManager.getActiveCallConfig()));
        if (!config.apiKey) {
            openSettingsPanel();
            showToast('请先配置 AI 密钥');
            window.aiGradingState.isRunning = false;
            return;
        }

        const presetConfig = JSON.parse(JSON.stringify(PresetManager.getCurrentConfig()));
        const effectiveUnits = PresetManager.getScoringUnits?.() || presetConfig.scoring?.units || [];
        const gradingMaxScore = PresetManager.getMaxScore();
        presetConfig.scoring = { ...presetConfig.scoring, maxScore: gradingMaxScore, units: JSON.parse(JSON.stringify(effectiveUnits)) };
        config.scoring = presetConfig.scoring;
        runContext.configuration = presetConfig;
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
        const sourceWorkflow = workflowId ? WorkflowManager.getWorkflow(workflowId) : null;
        const workflow = sourceWorkflow ? JSON.parse(JSON.stringify(sourceWorkflow)) : null;
        const isDualEval = workflow && workflow.dualEval && workflow.dualEval.enabled;

        if (isDualEval) {
            console.log(`🔄 [诊断] 使用双评模式 — 工作流: ${workflow.name}`);
        } else if (workflow) {
            console.log(`🔍 [诊断] 使用工作流: ${workflow.name} — 模型: ${config.model}`);
        }

        const adapter = window.__AI_MARKER_ADAPTER__;

        if (adapter?.prepareGrading && await adapter.prepareGrading() === false) {
            throw new Error(adapter.lastFillError || '阅卷页面尚未就绪，请核对后继续');
        }
        requireCurrentGradingContext(runContext);

        requireGradingQuestionContext(runContext);

        // AI 失败重试时复用已下载的图片，避免重新抓取（拦截器缓冲可能已清空）
        const isRetry = runContext.paperId && runContext.paperId === window.aiGradingState.currentPaperId && window.aiGradingState.errorRetryCount > 0
            && window.aiGradingState.currentBase64DataArray.length > 0;

        let imageUrls, base64DataArray;

        if (isRetry) {
            imageUrls = window.aiGradingState.currentImageUrls;
            base64DataArray = window.aiGradingState.currentBase64DataArray;
            console.log(`♻️ [诊断] 复用已有图片数据进行重试 (${imageUrls.length} 张)`);
        } else {
            console.log(`🔍 使用方案【${PresetManager.data.active}】查找答卷...`);
            imageUrls = adapter ? await adapter.gatherAnswerImages() : [];
            requireCurrentGradingContext(runContext);
            console.log(`🖼️ [诊断] 找到答题卡图片数量: ${imageUrls.length}`);

            if (!imageUrls || imageUrls.length === 0) {
                // 取图为空 ≠ 批完：复查确认是否已离开批改页（取图等待窗口内可能已导航离开）
                const hasLeft = await confirmLeftMarkingPage(adapter);
                requireCurrentGradingContext(runContext);
                if (hasLeft) {
                    console.log('ℹ️ 已离开批改页面，停止本轮批改');
                    handleLeaveMarkingPage();
                    return;
                }
                if (window.aiGradingState.gradingMode === 'unattended') {
                    stopAutoGrading();
                    // 取图为空 ≠ 一定是批完（也可能是取图被防批错卷策略拒绝），
                    // 文案保持诚实，不谎报「全部完成」（#246/#253 同一原则）
                    safeAlert('未取到答题卡图片（可能已全部批完，或平台暂未提供图片），批改已暂停，请核对后继续。');
                    return;
                }
                safeAlert('❌ 未找到答题卡图片！');
                window.aiGradingState.isRunning = false;
                return;
            }

            runContext.paperId ||= readGradingPaperIdentity(adapter);
            requireGradingContextTarget(runContext);
            window.aiGradingState.currentImageUrls = imageUrls;
            // Canvas 型平台换卷判定的对照基准：AI 期间输入框若「非空→清空」才可疑
            window.aiGradingState.paperGuardInputSnapshot = snapshotScoreInputs(adapter);
            runContext.imageUrls = imageUrls.slice();
            runContext.inputSnapshot = window.aiGradingState.paperGuardInputSnapshot.slice();
            // 记录稳定试卷标识（如有），答卷校验优先做强信号比对（#281）
            if (adapter && typeof adapter.getPaperIdentity === 'function') {
                window.aiGradingState.currentPaperId = runContext.paperId;
            }

            const gradeBtn = document.querySelector('.ai-grade-btn');
            if (gradeBtn && window.aiGradingState.gradingMode !== 'unattended') {
                gradeBtn.textContent = imageUrls.length > 1 ? `📥 下载多图(${imageUrls.length})...` : '📥 下载图片...';
            }

            console.log(`📥 [诊断] 开始下载 ${imageUrls.length} 张图片...`);
            const fetchFn = adapter && adapter.fetchImageAsBase64 ? adapter.fetchImageAsBase64 : fetchImageAsBase64;
            base64DataArray = await Promise.all(imageUrls.map(url => fetchFn(url, runContext.controller.signal)));
            requireCurrentGradingContext(runContext);
            // 废图闸（工单①）：942×4 裁剪残片类废图不得进 API/空白检测（进 API 会 400 整单暂停）
            const imgGate = filterUsableImagesForAI(base64DataArray);
            // 剔除计数登记（返修②）：本卷 AI 请求的提示词需注明「已剔除 N 张废图」，不得对残卷照常出分
            window.aiGradingState.imageGateRemovedCount = imgGate.removed.length;
            if (imgGate.removed.length > 0) {
                console.warn(`⚠️ [废图剔除] ${imgGate.removed.length} 张废图已剔除（尺寸异常）: ` +
                    imgGate.removed.map(r => `#${r.index} ${r.reason}`).join('；'));
                showToast(`⚠️ 已剔除 ${imgGate.removed.length} 张尺寸异常的废图，不送 AI 评分`);
            }
            base64DataArray = imgGate.kept;
            if (base64DataArray.length === 0) {
                // 剔除后无图 = 显式失败（宁可不取）：绝不让 AI 对空图盲评
                if (window.aiGradingState.gradingMode === 'unattended') {
                    stopAutoGrading();
                    safeAlert('答题卡图片均不可用（尺寸异常已被剔除），批改已暂停，请人工核对后继续。');
                } else {
                    safeAlert('❌ 答题卡图片均不可用（尺寸异常已被剔除），请人工核对后继续！');
                    window.aiGradingState.isRunning = false;
                }
                return;
            }
            window.aiGradingState.currentBase64DataArray = base64DataArray;
            console.log(`✅ [诊断] 图片下载完成，各图片Base64大小: ${base64DataArray.map(b => Math.round(b.length / 1024) + 'KB').join(', ')}`);
        }

        requireCurrentGradingContext(runContext);
        runContext.imageUrls = imageUrls.slice();
        runContext.inputSnapshot = window.aiGradingState.paperGuardInputSnapshot || [];
        runContext.base64DataArray = base64DataArray.slice();

        // ===== 空白答题卡检测 =====
        const blankConfig = presetConfig.blankDetection;
        let blankDetectionResult = null; // 缓存检测结果，避免重复计算
        if (blankConfig && blankConfig.enabled && !window.aiGradingState.blankDetection.skipOnce) {
            const refData = BlankDetector.loadReference();
            if (refData) {
                try {
                    const currentRatios = await BlankDetector.calcBatchRatios(base64DataArray, refData.thresholds);
                    requireCurrentGradingContext(runContext);
                    blankDetectionResult = { currentRatios, refData }; // 缓存
                    const result = BlankDetector.isBlankSheet(currentRatios, refData, blankConfig.threshold);
                    if (result.isBlank) {
                        await verifyGradingContext(runContext);
                        requireGradingContextTarget(runContext);
                        console.log('⏭️ [空白检测] 检测到空白答题卡，自动跳过');
                        window.aiGradingState.blankDetection.blankCount++;
                        showToast(`⏭️ 空白答题卡已跳过（第${window.aiGradingState.blankDetection.blankCount}张）`);

                        // 填入 0 分（失败不静默：空分提交等于误判 0 分）
                        const scoringConfig = presetConfig.scoring || {};
                        const maxScore = gradingMaxScore;
                        let blankFillOk = false;
                        if (adapter) {
                            const units = scoringConfig.units || [];
                            if (adapter.fillScores && units.length > 0) {
                                blankFillOk = safeFillScores(adapter, units.map(() => 0), '空白卡填0');
                            } else if (adapter.fillScores) {
                                blankFillOk = safeFillScores(adapter, [0], '空白卡填0');
                            } else if (adapter.fillScore) {
                                blankFillOk = adapter.fillScore({ total: 0, subScores: units.map(u => ({ ...u, score: 0 })) });
                            }
                        }
                        if (blankFillOk === false) {
                            showToast('⚠️ 0 分未成功填入，请在提交前确认分数框');
                        }

                        // 显示提交对话框
                        const zeroSubScores = (scoringConfig.units || []).map(u => ({
                            label: u.label, score: 0, maxScore: u.maxScore
                        }));
                        showAutoSubmitDialog(0, '空白答题卡，自动判0分', zeroSubScores, {
                            runContext,
                            isBlankCard: true,
                            // 数据安全（#312 B1）：0 分填入失败必须禁倒计时自动提交，
                            // 否则无人模式 1 秒倒计时会把空框送进平台（空分提交=事故）
                            fillFailed: blankFillOk === false,
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
                    if (e.code === 'GRADING_CONTEXT_CHANGED') throw e;
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
        const gradingConfig = { ...config, workflowId, workflowSnapshot: workflow, outputObservation, outputLimitKey,
            signal: runContext.controller.signal,
            imageGateRemovedCount: window.aiGradingState.imageGateRemovedCount || 0 };
        const result = isDualEval
            ? await callDualEvaluation(base64DataArray, gradingConfig, (streamedText) => {
                if (isGradingContextCurrent(runContext) && window.aiGradingState.gradingMode !== 'unattended') updateStreamPanel(streamedText);
            })
            : await callAIGrading(base64DataArray, gradingConfig, (streamedText) => {
                if (isGradingContextCurrent(runContext) && window.aiGradingState.gradingMode !== 'unattended') updateStreamPanel(streamedText);
            });

        requireCurrentGradingContext(runContext);
        hideStreamPanel();

        console.log(`📊 [诊断] callAIGrading 返回 — score: ${result.score}, comment长度: ${(result.comment || '').length}字`);
        if (result.score !== undefined && result.score !== null) {
            recordOutputLimitOutcome(gradingConfig);
            const scoringConfig = presetConfig.scoring || { roundStep: 1, roundMethod: 'round' };
            const maxScore = gradingMaxScore;

            // 字数 ≤ 15 或未作答时，强制无勤勉分
            let diligenceLevel = result.diligenceLevel || 0;
            const answerLen = (result.studentAnswer || '').replace(/\s/g, '').length;
            const explicitlyBlank = isExplicitlyBlankGradingResult(result);
            if (answerLen <= 15 || explicitlyBlank) diligenceLevel = 0;

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
                aiScore: result.rawScore ?? result.score,
                diligenceLevel,
                maxScore,
                scoringConfig,
                aiUnitScores
            });

            const { finalScore, finalUnitScores, bonus: roundedBonus, breakdown } = calculated;
            requireGradingEvidence(result, [finalScore, ...(finalUnitScores || []).map(unit => unit.score)]);

            window.aiGradingState.currentStudentAnswer = result.studentAnswer || '未能识别';
            window.aiGradingState.errorRetryCount = 0;
            // ===== 离开批改页检查（先于答卷校验：填分/提交必须在批改页上）=====
            // AI 请求期间教师可能退回列表页——这是离开页面，不是换卷，中性暂停即可
            // 复查确认：DOM 型 isMarkingPage 瞬时 false 不算离开
            await verifyGradingContext(runContext);
            requireGradingContextTarget(runContext);

            console.log(`✏️ [诊断] 准备填入分数: ${finalScore}，调用 fillScores...`);

            // 填分：优先使用新接口 fillScores，回退到旧接口 fillScore
            // 填分失败绝不能静默续走提交——那会把空分/旧分送进平台（#253 同类缺陷）
            const adapter = window.__AI_MARKER_ADAPTER__;
            let fillOk = false;
            if (adapter) {
                if (adapter.fillScores && finalUnitScores) {
                    // 新接口：按评分单元顺序填入（数值闸 N5 前置）
                    fillOk = safeFillScores(adapter, finalUnitScores.map(u => u.score), '主流程填分');
                } else if (adapter.fillScores) {
                    // 单题模式
                    fillOk = safeFillScores(adapter, [finalScore], '主流程填分');
                } else if (adapter.fillScore) {
                    // 旧接口兼容（request 内含 total/subScores，数值闸覆盖两者）
                    fillOk = validateScoresForFill(
                        [finalScore].concat((finalUnitScores || []).map(u => u.score)), '主流程填分(旧接口)')
                        ? adapter.fillScore({ total: finalScore, subScores: finalUnitScores })
                        : false;
                } else {
                    fillOk = false;
                }
            }
            if (fillOk === false) {
                console.warn('⚠️ [诊断] 分数填入失败，中止本次提交');
                throw new Error(adapter?.lastFillError || '分数填入失败（分数框缺失或分数不可填），请手动输入分数后继续');
            }
            runContext.inputSnapshot = snapshotScoreInputs(adapter);
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
            requireCurrentGradingContext(runContext);
            showAutoSubmitDialog(finalScore, result.comment, finalUnitScores || result.subScores, {
                runContext,
                scoringDetails: result._sections || null,
                answerStatus: getGradingAnswerStatus(result),
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
        // 旧轮次的失败也不能暂停新轮次或清理新轮次的界面。
        if (!isGradingContextCurrent(runContext)) return;
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
// init 重入闩（strict-a C.3）：boot 的 setTimeout(init) 与 runNewTaskOnboardingFlow 的
// setTimeout(init)（任务切换重调度）可并发触发，两路都在 await 后建 UI → 双 UI/双监听。
// in-running 闩只挡并发；完成后允许任务切换后的合法重跑（SPA 从列表页进批改页需重建 UI）。
let _initInFlight = false;
// 回评任务页内门闩（strict-a C.1）：同一页面生命周期内回评面板只弹一次
let _regradeConsumed = false;

async function init() {
    if (_initInFlight) return;
    _initInFlight = true;
    try {
        await runInitBody();
    } finally {
        _initInFlight = false;
    }
}

// 平台与题号可能已经确定，阅卷 DOM 却在首次检测之后才就绪。
// 复用现有轮询和平台检测恢复入口；初始化防重入仍由 init 统一控制。
function recoverMarkingUIIfReady() {
    if (window !== window.top || _initInFlight || document.querySelector('.ai-grade-btn')) return;
    const adapter = window.__AI_MARKER_ADAPTER__;
    if (!adapter || isToolsPageMode()) return;
    try {
        if (adapter.isMarkingPage && !adapter.isMarkingPage()) return;
        init().catch(error => console.warn('[初始化] 阅卷入口恢复失败，将在就绪后重试:', error));
    } catch (error) {
        console.warn('[初始化] 阅卷页面尚未就绪:', error);
    }
}

async function runInitBody() {
    if (window !== window.top) return; // 跳过 iframe
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 检测是否在工具页面
    if (isToolsPageMode()) {
        await initToolsPageMode();
        return;
    }

    const adapter = window.__AI_MARKER_ADAPTER__;

    const pageUrl = window.location?.href || '';
    const isCurrentPage = () => adapter === window.__AI_MARKER_ADAPTER__ && (window.location?.href || '') === pageUrl;

    // 检测是否在批改页面，支持重试（SPA应用可能需要更长时间加载）
    let isMarkingPage = await detectMarkingPage();
    if (!isCurrentPage()) return;
    if (!isMarkingPage) {
        // 第一次检测失败，等待后重试
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (!isCurrentPage()) return;
        isMarkingPage = await detectMarkingPage();
        if (!isCurrentPage()) return;
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

    if ([PresetManager, ProviderManager, WorkflowManager].some(manager => manager._initialSaveFailed)) {
        showToast('部分设置暂未保存，请在设置中重新保存');
    }

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

    resumeGradingAfterReload();

    // 检查是否有回评任务（strict-a C.1）：读取即消费 + 页内门闩——
    // init 可被任务切换重调度重跑，两路都读到同一 sessionStorage 会弹双回评面板（对同一记录双改）。
    // 消费即标记：刷新/重入不再重复弹面板（startRegrade 本就是整页跳转，消费点在新页生命周期内）
    const regradeData = sessionStorage.getItem('ai-grading-regrade');
    if (regradeData && !_regradeConsumed) {
        _regradeConsumed = true;
        sessionStorage.removeItem('ai-grading-regrade');
        try {
            const { id } = JSON.parse(regradeData);
            const record = HistoryManager.getById(id);
            if (record) {
                window.aiGradingState.isRegrading = true;
                showToast('正在加载回评数据...');
                const regradeContext = createGradingContext(true);
                setTimeout(async () => {
                    if (!isGradingContextCurrent(regradeContext)) return;
                    try {
                    // 等待图片加载（strict-a C.4）：固定 3s 等待改 200ms 短轮询，就绪即继续，
                    // 探测总上限 3s 不变
                    const adapter = window.__AI_MARKER_ADAPTER__;
                    await waitForImagesReadyForRegrade(adapter, 3000, 200);
                    requireCurrentGradingContext(regradeContext);
                    const imageUrls = adapter ? await adapter.gatherAnswerImages() : [];
                    requireCurrentGradingContext(regradeContext);
                    regradeContext.paperId ||= readGradingPaperIdentity(adapter);
                    requireGradingContextTarget(regradeContext);
                    regradeContext.imageUrls = imageUrls.slice();
                    regradeContext.inputSnapshot = snapshotScoreInputs(adapter);
                    if (imageUrls.length === 0) {
                        showAlertModal('未找到答题卡图片，无法回评。').then(() => {
                            sessionStorage.removeItem('ai-grading-regrade');
                            window.aiGradingState.isRegrading = false;
                        });
                        return;
                    }
                    const fetchFn = adapter && adapter.fetchImageAsBase64 ? adapter.fetchImageAsBase64 : fetchImageAsBase64;
                    let base64DataArray = await Promise.all(imageUrls.map(url => fetchFn(url, regradeContext.controller.signal)));
                    requireCurrentGradingContext(regradeContext);
                    // 废图闸（工单①）：回评链路同样不得把尺寸异常残片送进 API
                    const regradeGate = filterUsableImagesForAI(base64DataArray);
                    // 回评/纠错链的剔除计数登记（返修②）：correction.js 自建 callConfig，
                    // 无 config 通道，走 aiGradingState 兜底进提示词注记
                    window.aiGradingState.imageGateRemovedCount = regradeGate.removed.length;
                    if (regradeGate.removed.length > 0) {
                        console.warn(`⚠️ [废图剔除] 回评：${regradeGate.removed.length} 张废图已剔除（尺寸异常）: ` +
                            regradeGate.removed.map(r => `#${r.index} ${r.reason}`).join('；'));
                        base64DataArray = regradeGate.kept;
                    }
                    if (base64DataArray.length === 0) {
                        showAlertModal('答题卡图片均不可用（尺寸异常已被剔除），无法回评。').then(() => {
                            sessionStorage.removeItem('ai-grading-regrade');
                            window.aiGradingState.isRegrading = false;
                        });
                        return;
                    }
                    window.aiGradingState.currentBase64DataArray = base64DataArray;
                    regradeContext.base64DataArray = base64DataArray.slice();
                    await verifyGradingContext(regradeContext);

                    showCorrectionPanel({
                        score: record.aiScore, comment: record.aiComment,
                        studentAnswer: record.studentAnswer, imageUrls,
                        base64DataArray, config: regradeContext.configuration,
                        callConfig: PresetManager.getActiveCallConfig(),
                        subScores: record.subScores,
                        async onAccept(finalScore, correctionInfo) {
                            const correctedSubScores = correctionInfo.correctedSubScores || record.subScores;
                            if (!await fillScore(finalScore, record.aiComment, correctedSubScores, regradeContext, {
                                regradeId: id,
                                correction: { ...correctionInfo, aiScore: record.aiScore, aiComment: record.aiComment }
                            })) return;
                            sessionStorage.removeItem('ai-grading-regrade');
                            window.aiGradingState.isRegrading = false;
                            showToast('得分已填入，请确认提交');
                        },
                        onCancel() {
                            if (isGradingContextCurrent(regradeContext)) invalidateGradingRun();
                            sessionStorage.removeItem('ai-grading-regrade');
                            window.aiGradingState.isRegrading = false;
                            showToast('已取消回评');
                        }
                    });
                    } catch (error) {
                        if (isGradingContextCurrent(regradeContext)) { invalidateGradingRun(); showToast(error.message); }
                        window.aiGradingState.isRegrading = false;
                    }
                }, 0);
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

// 新题引导流程（#304 抽取）：方案绑定切换 + API Key 引导 + 新试题 OOBE + 配置下拉同步。
// 从任务切换轮询抽出，供「切换即命中」与「SPA 渲染竞态重试」两条路径复用。
// #312 防重入：并发生 tick 双跑会双弹 OOBE
async function runNewTaskOnboardingFlow(currentUrlId) {
    if (newTaskFlowInFlight) return;
    newTaskFlowInFlight = true;
    try {
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
    } finally {
        newTaskFlowInFlight = false;
    }
}

// #304 SPA 渲染竞态防护：登记的待重试任务与当前一致、且未在批改/暂停态才补跑
// （#315 G7：迟到 pending 不得在暂停期换活动方案）
function resumeGradingAfterReload() {
    if (sessionStorage.getItem('ai-grading-auto-resume') !== 'true') return;
    sessionStorage.removeItem('ai-grading-auto-resume');
    window.aiGradingState.errorRetryCount = parseInt(sessionStorage.getItem('ai-grading-retry-count') || '0');
    sessionStorage.removeItem('ai-grading-retry-count');
    if (PresetManager.getCurrentConfig()?.questionGuard?.enabled === true) {
        showToast('页面已刷新，请核对当前题目和评分方案后点击继续批改');
        return;
    }
    setTimeout(() => toggleAutoGrading(), 3000);
}

function shouldRetryPendingTaskFlow(pendingId, currentUrlId, isRunning, isPaused) {
    return !!pendingId && pendingId === currentUrlId && !isRunning && !isPaused;
}

// URL 及 题号变化监听器 (轻量级轮询)
let lastUrlId = PresetManager.getTaskIdentifier();
let pendingNewTaskFlowId = null;
let newTaskFlowInFlight = false; // #312 防重入：并发生 tick 不得双跑新题引导（双弹窗）

// 运行期间保留启动时的题目基准；普通换卷不得重置基准。
// 未读到题号仅表示页面可能在加载，交给取图/填分/提交前的就绪检查。
function monitorGradingQuestionChange() {
    const context = window.aiGradingState.activeRun;
    if (!isGradingContextCurrent(context) || context.questionGuardEnabled !== true || !context.questionBaseline) return;
    const current = readGradingQuestionContext(context.adapter);
    if (!current || current.key === context.questionBaseline.key) return;
    invalidateGradingRun();
    window.aiGradingState.isRunning = false;
    window.aiGradingState.isPaused = true;
    sessionStorage.removeItem('ai-grading-auto-resume');
    sessionStorage.removeItem('ai-grading-retry-count');
    const btn = document.querySelector('.ai-grade-btn');
    if (btn) {
        btn.textContent = '继续批改';
        btn.classList.remove('running', 'unattended', 'trial');
        btn.classList.add('paused');
    }
    hideStreamPanel();
    showToast('题号或小题满分已变化，批改已暂停。请核对当前题目和评分方案后继续');
}

setInterval(async () => {
    recoverMarkingUIIfReady();
    monitorGradingQuestionChange();
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

        // SPA 导航离开批改页（如退回列表页）：统一清理
        // 复查确认后才动手：DOM 型 isMarkingPage（frame 重载）瞬时 false 会误杀进行中的批改
        if (typeof adapter.isMarkingPage === 'function' && !adapter.isMarkingPage()) {
            if (await confirmLeftMarkingPage(adapter)) {
                handleLeaveMarkingPage();
            } else {
                // #312：复查结论"未离开"= 可能是 DOM 型检测瞬时 false 或 SPA 正进入新批改页——
                // 登记待重试补跑新题引导（裸 return 会像 #304 一样丢掉本次任务切换）
                pendingNewTaskFlowId = currentUrlId;
            }
            return;
        }

        // 适配器声明的「不支持的批改模式」（如九科星按学生批阅多题页）：
        // 弹提示横幅、停止批改、跳过方案切换与 OOBE——typeof 门控，未实现该钩子的适配器零影响
        if (typeof adapter.isUnsupportedMarkingMode === 'function' && adapter.isUnsupportedMarkingMode()) {
            console.log('[诊断] 当前为不支持的批改模式，跳过方案配置');
            if (typeof adapter.showUnsupportedModeNotice === 'function') {
                adapter.showUnsupportedModeNotice();
            }
            if (window.aiGradingState.isRunning) {
                window.aiGradingState.isRunning = false;
                window.aiGradingState.isPaused = true;
                const stopBtn = document.querySelector('.ai-grade-btn');
                if (stopBtn) {
                    stopBtn.textContent = '继续批改';
                    stopBtn.classList.remove('running', 'unattended', 'trial');
                    stopBtn.classList.add('paused');
                }
                showToast('当前批改模式暂不支持自动批改，批改已暂停');
            }
            return;
        }

        if (!window.aiGradingState.isRunning) {
            // 非阅卷页面不弹窗，直接返回
            // 优先使用快速检查（不等待 DOM），回退到完整检测
            const onMarkingPage = adapter.isMarkingPage
                ? adapter.isMarkingPage()
                : (adapter.detectMarkingPage ? await adapter.detectMarkingPage() : true);
            if (!onMarkingPage) {
                // #304 SPA 渲染竞态：URL 先变、阅卷 DOM 后渲染——登记待重试，
                // 下个 tick 补跑新题引导流程（一次性消费会导致配置窗丢失，需刷新才弹）
                pendingNewTaskFlowId = currentUrlId;
                return;
            }
            pendingNewTaskFlowId = null;
            await runNewTaskOnboardingFlow(currentUrlId);
        } else {
            // #312：批改运行中消费了任务切换——登记待补跑（否则批改停止后永不补跑，
            // 可能拿旧方案继续批新题）；重试分支要求 !isRunning，停止后自动补跑
            pendingNewTaskFlowId = currentUrlId;
        }
    } else if (shouldRetryPendingTaskFlow(pendingNewTaskFlowId, currentUrlId, window.aiGradingState.isRunning, window.aiGradingState.isPaused)) {
        // #304 重试：仅补跑新题引导流程（不重入清理/横幅等副作用分支）
        const adapter = window.__AI_MARKER_ADAPTER__;
        const onMarkingPage = adapter
            ? (adapter.isMarkingPage
                ? adapter.isMarkingPage()
                : (adapter.detectMarkingPage ? await adapter.detectMarkingPage() : true))
            : false;
        if (!onMarkingPage) return; // DOM 仍未就绪，继续等
        pendingNewTaskFlowId = null;
        await runNewTaskOnboardingFlow(currentUrlId);
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
