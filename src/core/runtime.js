// 异步批改上下文：每轮持有自己的取消信号和答卷基准。
function isConfigurationRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getGradingOutputMode(config) {
    return config?.outputMode === 'score-only' || config?.scoring?.outputMode === 'score-only'
        ? 'score-only' : 'detailed';
}

// 仅解释展示缺省值；原始答案和评分数据仍按模型返回内容保存。
function getGradingOutputText(value, config, field, fallback = '—') {
    const text = String(value ?? '');
    const omittedAnswer = field === '识别答案' && ['未能识别', '未能识别答案'].includes(text.trim());
    if (getGradingOutputMode(config) === 'score-only' && (!text.trim() || omittedAnswer)) {
        return field === '识别答案'
            ? '精简模式仅输出分数，省略识别答案、评分依据、分数计算和评语。'
            : `精简模式下不提供${field}。`;
    }
    return text.trim() ? text : fallback;
}

function saveInitialConfiguration(manager, label) {
    try {
        const saved = manager.save();
        manager._initialSaveFailed = saved === false;
        return saved;
    } catch (error) {
        manager._initialSaveFailed = true;
        console.error(`[配置] ${label}尚未保存，保留当前配置供重试:`, error);
        return false;
    }
}

// 按本页上次读取的基线合并保存，避免旧页面的整份缓存覆盖其他页面的编辑。
function mergeConfigurationEdits(baseline, edited, latest, selections = []) {
    const equal = (a, b) => {
        if (a === b) return true;
        if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
        const keys = Object.keys(a);
        return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && equal(a[key], b[key]));
    };
    const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const merge = (before, local, remote, depth = 0) => {
        if (equal(local, before)) return copy(remote);
        if (equal(remote, before) || equal(local, remote)) return copy(local);
        if (!isConfigurationRecord(before) || !isConfigurationRecord(local) || !isConfigurationRecord(remote)) throw new Error('concurrent configuration edit');
        const result = {};
        for (const key of new Set([...Object.keys(before), ...Object.keys(local), ...Object.keys(remote)])) {
            if (depth === 0 && selections.includes(key)) continue;
            const value = merge(before[key], local[key], remote[key], depth + 1);
            if (value !== undefined) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
        }
        if (depth === 0) {
            const source = selections.some(key => !equal(local[key], before[key])) ? local : remote;
            selections.forEach(key => { if (source[key] !== undefined) result[key] = copy(source[key]); });
        }
        return result;
    };
    return merge(baseline, edited, latest);
}

function saveConfigurationEdits(manager, key, label, validate, selections) {
    let raw, latest, merged;
    const owns = (object, name) => Object.prototype.hasOwnProperty.call(object, name);
    try {
        raw = GM_getValue(key);
        latest = raw ? JSON.parse(raw) : null;
        if (latest !== null && !validate(latest)) throw new Error('stored configuration is invalid');
        merged = mergeConfigurationEdits(manager._storageBaseline ?? null, manager.data, latest, selections);
        if (!validate(merged)) throw new Error('merged configuration is invalid');
        // 其他页面删除方案后，当前选择和绑定也必须指向仍存在的配置。
        if (key === 'ai-grading-presets') {
            if (!owns(merged.list, merged.active)) merged.active = owns(merged.list, latest?.active) ? latest.active : Object.keys(merged.list)[0];
            for (const binding of Object.keys(merged.bindings || {})) if (!owns(merged.list, merged.bindings[binding])) delete merged.bindings[binding];
        } else if (key === 'ai-grading-providers-v2') {
            if (!owns(merged.providers, merged.activeProvider)) merged.activeProvider = owns(merged.providers, latest?.activeProvider) ? latest.activeProvider : Object.keys(merged.providers)[0];
            const models = merged.providers[merged.activeProvider]?.models || {};
            if (!owns(models, merged.activeModel)) merged.activeModel = Object.keys(models)[0] || '';
        } else if (key === 'ai-grading-workflows') {
            if (!Object.values(merged.workflows).some(wf => wf.id === merged.activeWorkflow)) merged.activeWorkflow = Object.values(merged.workflows)[0]?.id || '';
        }
    } catch (error) {
        console.warn(`[配置] ${label}保存前校验未通过，保留已保存内容:`, error);
        if (typeof showToast === 'function') showToast(`${label}尚未保存。其他页面可能已更新配置，请先导出本次修改，再刷新页面核对。`);
        return false;
    }
    const json = JSON.stringify(merged);
    try { if (raw && raw !== json && raw.length <= 2 * 1024 * 1024) GM_setValue(key + '-prev', raw); }
    catch (_) { /* 备份失败仍可保存已经合并的完整内容。 */ }
    GM_setValue(key, json);
    manager.data = merged;
    manager._storageBaseline = JSON.parse(json);
    manager._initialSaveFailed = false;
    return true;
}

function abortableGradingDelay(ms, signal) {
    return new Promise((resolve, reject) => {
        let timer;
        const abort = () => { clearTimeout(timer); reject(new Error('用户主动暂停')); };
        if (signal?.aborted) return abort();
        timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
        signal?.addEventListener('abort', abort, { once: true });
    });
}

function destroySubmitDialog(dialog) {
    if (!dialog) return;
    dialog.gradingDisposed = true;
    if (dialog.countdownTimer) clearInterval(dialog.countdownTimer);
    dialog.countdownTimer = null;
    if (dialog.cleanupListeners) dialog.cleanupListeners();
    dialog.remove();
}

function invalidateGradingRun() {
    const state = window.aiGradingState;
    state.abortController?.abort();
    state.activeRun = null;
    destroySubmitDialog(document.getElementById('auto-submit-dialog'));
}

function isExplicitlyBlankGradingResult(result) {
    return getGradingAnswerStatus(result) === 'blank';
}

function getGradingAnswerStatus(result) {
    const statuses = { '可辨认': 'readable', '部分不清': 'partial', '无法辨认': 'unreadable', '未作答': 'blank' };
    const declared = String(result?.answerStatus ?? result?._sections?.['作答状态'] ?? '').trim();
    const status = Object.prototype.hasOwnProperty.call(statuses, declared) ? statuses[declared]
        : (Object.values(statuses).includes(declared) ? declared : 'unknown');
    // 不把解析器补的缺省“未能识别”当作原始识别结论，兼容旧模型和精简模式。
    const raw = result?._sections?.['答案复述'] ?? result?.studentAnswer;
    const answer = String(raw ?? '').replace(/\s/g, '').replace(/[。.!！]+$/, '');
    const subject = '(?:(?:该学生|学生|本卷|整张答卷|该答卷|答卷)(?:均|完全|全部)?)?';
    const blank = new RegExp('^' + subject + '(?:未作答|没有作答|无作答|未填写答案|空白卷|空白答卷)(?:[，,；;。](?:图中|卷面|答题卡上)?(?:只有|仅有)(?:印刷题干|印刷文字|预印电路图|预印图形|题号|空白|和|与|、)+)?$').test(answer);
    const unreadable = /^(?:(?:整张答卷|该答卷|学生答案|学生作答|字迹)(?:均|完全|全部)?)?(?:未能识别|无法识别|无法辨认|看不清)$/.test(answer);
    // 新解析结果保留原始段落；旧接口直接返回 studentAnswer 时仍可识别明确弃权。
    const explicitAnswer = result?._answerProvided ?? (result?._sections?.['答案复述'] !== undefined || !result?._sections);
    if (blank) return status !== 'unknown' && status !== 'blank' ? 'conflict' : 'blank';
    if (unreadable && explicitAnswer) return status !== 'unknown' && status !== 'unreadable' ? 'conflict' : 'unreadable';
    if (status === 'blank' && explicitAnswer && answer) return 'conflict';
    return status;
}

function requireGradingEvidence(result, scores = [result?.score]) {
    const status = getGradingAnswerStatus(result);
    const positive = scores.some(score => Number.isFinite(score) && score > 0);
    let message;
    if (status === 'conflict') message = 'AI 对作答是否可辨认的说明相互矛盾，请核对本卷';
    else if (status === 'unreadable') message = 'AI 无法辨认本卷作答，请核对原图后评分';
    else if (status === 'blank' && positive) message = 'AI 将答卷识别为未作答，却给出了正分，请核对本卷后继续';
    if (message) {
        const error = new Error(message);
        error.code = 'GRADING_EVIDENCE_REVIEW';
        error.answerStatus = status;
        error.gradingResult = result;
        throw error;
    }
}

function requireCompatibleGradingEvidence(resultA, resultB) {
    for (const result of [resultA, resultB]) requireGradingEvidence(result, [result?.score, ...(result?.subScores || []).map(unit => unit.score)]);
    const a = getGradingAnswerStatus(resultA), b = getGradingAnswerStatus(resultB);
    if ((a === 'blank' && b !== 'blank' && b !== 'unknown') || (b === 'blank' && a !== 'blank' && a !== 'unknown') ||
        (a === 'blank' && resultB?.score > 0) || (b === 'blank' && resultA?.score > 0)) {
        const error = new Error('两次识别对本卷是否作答存在分歧，请核对原图后评分');
        error.code = 'GRADING_EVIDENCE_REVIEW';
        throw error;
    }
}

function isAnswerReviewEnabled(config) {
    return config?.answerReview?.enabled === true;
}

function getPendingReviewLimit(config) {
    const limit = config?.answerReview?.maxPending;
    return Number.isInteger(limit) && limit >= 1 && limit <= 50 ? limit : 5;
}

function isAnswerStatusCheckEnabled(config) {
    return config?.answerStatusCheck === true;
}

function getUnattendedAnswerFailure(config) {
    const policy = config?.retryPolicy?.unattendedAnswerFailure;
    return policy === 'pause' || policy === 'retry' ? policy : 'recover';
}

function getUnattendedRetryLimit(config) {
    const policy = config?.retryPolicy;
    const value = policy?.unattendedRetries;
    if (Number.isInteger(value) && value >= 0 && value <= 5) return value;
    const legacy = policy?.unattendedAnswerRetries;
    return policy?.unattendedAnswerFailure !== 'pause' && Number.isInteger(legacy) && legacy >= 1 && legacy <= 5
        ? legacy : 5;
}

function isUnattendedRun(context) {
    return !!context && !context.manual && window.aiGradingState.gradingMode === 'unattended';
}

function createUnattendedRetryBudget(context, stage, verify = checkGradingRetryTarget) {
    let remaining = isUnattendedRun(context) ? getUnattendedRetryLimit(context.configuration) : 0;
    let attempt = 0;
    return {
        get remaining() { return remaining; },
        async retry(delay, reason) {
            while (remaining) {
                requireCurrentGradingContext(context);
                remaining--;
                attempt++;
                if (typeof DiagnosticLog !== 'undefined') {
                    DiagnosticLog.grading('grading-retry', context, { stage, attempt, remaining, reason });
                }
                await abortableGradingDelay(delay ?? 5000 * attempt, context.controller.signal);
                requireCurrentGradingContext(context);
                try {
                    await verify(context);
                    return true;
                } catch (error) {
                    if (error?.code !== 'GRADING_STEP_RETRY' || !remaining) throw error;
                }
            }
            return false;
        }
    };
}

async function retryUnattendedStep(context, stage, operation, verify) {
    const budget = createUnattendedRetryBudget(context, stage, verify);
    for (;;) {
        try {
            return await operation();
        } catch (error) {
            if (error?.code !== 'GRADING_STEP_RETRY' || !await budget.retry(undefined, error.code)) throw error;
        }
    }
}

function gradingStepRetry(message) {
    const error = new Error(message);
    error.code = 'GRADING_STEP_RETRY';
    return error;
}

function missingGradingScore() {
    const error = new Error('AI未返回可识别的分数，请检查模型回答后继续批改');
    error.code = 'GRADING_SCORE_INVALID';
    return error;
}

function hasUsableGradingScores(result) {
    return Number.isFinite(result?.score) && result.score >= 0
        && (!Array.isArray(result.subScores) || result.subScores.every(item =>
            Number.isFinite(item?.score) && item.score >= 0));
}

async function fillGradingScoreValues(context, total, units, label) {
    const adapter = context.adapter;
    const scores = units?.length ? units.map(unit => unit.score) : [total];
    if (!validateScoresForFill([total, ...scores], label)) throw new Error('分数填入失败，请核对评分结果后继续');
    return retryUnattendedStep(context, 'fill', async () => {
        requireGradingContextTarget(context);
        let filled;
        try {
            filled = adapter?.fillScores
                ? adapter.fillScores(scores)
                : adapter?.fillScore?.({ total, subScores: units });
        } catch (error) {
            throw gradingStepRetry(error.message || '暂时未能填入分数，请核对后继续');
        }
        if (!filled) throw gradingStepRetry(adapter?.lastFillError || '暂时未能填入分数，请核对后继续');
        context.inputSnapshot = snapshotScoreInputs(adapter);
    });
}


function rememberPendingGradingPaper(context, submitted = false) {
    const protectSubmittedPaper = submitted && !context.manual && context.adapter?.id === 'zhixue';
    if (!protectSubmittedPaper && !isUnattendedRun(context)) return;
    window.aiGradingState.pendingGradingPaper = {
        adapter: context.adapter, taskId: context.taskId, presetName: context.presetName,
        paperId: context.paperId, imageUrls: context.imageUrls, protectSubmittedPaper
    };
}

async function verifyNextGradingPaper(context) {
    const state = window.aiGradingState;
    const previous = state.pendingGradingPaper;
    if (!previous) return;
    if (previous.adapter !== context.adapter || (!previous.protectSubmittedPaper
        && (previous.taskId !== context.taskId || previous.presetName !== context.presetName))) {
        state.pendingGradingPaper = null;
        return;
    }
    await retryUnattendedStep(context, 'next-paper', async () => {
        requireCurrentGradingContext(context);
        if (stopIfGradingTaskChanged(context)) throw gradingContextError('当前题目已变化，请核对后继续');
        requireGradingQuestionContext(context);
        const current = readGradingPaperIdentity(context.adapter);
        if (previous.protectSubmittedPaper) {
            // 题号或答卷尚未就绪时保留已提交的基线。换卷仍由适配器确认。
            const taskId = readGradingTaskIdentifier();
            const stillWaiting = () => gradingStepRetry('仍在等待下一份答卷，请核对阅卷记录');
            if (!taskId || !current || current === previous.paperId) throw stillWaiting();
            captureInitialZhixueTask(context, taskId);
            const ready = await context.adapter.waitForNextPaper(previous.imageUrls[0], {
                paperId: previous.paperId, taskId, signal: context.controller.signal
            });
            requireCurrentGradingContext(context);
            if (stopIfGradingTaskChanged(context)) throw gradingContextError('当前题目已变化，请核对后继续');
            if (!ready || readGradingTaskIdentifier() !== taskId || readGradingPaperIdentity(context.adapter) !== current) {
                throw stillWaiting();
            }
        } else if (previous.paperId && current) {
            if (current === previous.paperId) throw gradingStepRetry('仍在等待下一份答卷，请核对阅卷记录');
        } else {
            const check = await verifyPaperUnchanged(context.adapter, previous.imageUrls, [], previous.paperId);
            requireCurrentGradingContext(context);
            if (check.unchanged !== false) throw gradingStepRetry('仍在等待下一份答卷，请核对阅卷记录');
        }
        context.paperId = current;
        state.pendingGradingPaper = null;
    }, requireCurrentGradingContext);
}

function getScopedQuestionPlan(config) {
    if (config?.questionEvidence?.enabled !== true) return null;
    const nativeUnits = config.scoring?.units || [];
    const totalOnly = nativeUnits.length <= 1;
    const units = totalOnly ? config.questionEvidence.questions : nativeUnits;
    if (!Array.isArray(units) || units.length < 2 || units.length > 50) {
        throw new Error('请在本方案中设置 2 至 50 个小问及其满分');
    }

    const questions = units.map((unit, index) => ({
        id: 'q' + (index + 1),
        label: typeof unit?.label === 'string' ? unit.label.trim() : '',
        maxScore: unit?.maxScore,
        roundStep: unit?.roundStep || config.scoring?.roundStep || 1
    }));
    const labels = new Set(questions.map(question => question.label.normalize('NFKC').replace(/\s/g, '')));
    if (labels.size !== questions.length || questions.some(question =>
        !question.label || !Number.isFinite(question.maxScore) || question.maxScore <= 0)) {
        throw new Error('请为每个小问填写不同的题号和有效满分');
    }
    if (totalOnly) {
        const maxScore = nativeUnits[0]?.maxScore ?? config.scoring?.maxScore ?? config.maxScore;
        const sum = questions.reduce((total, question) => total + question.maxScore, 0);
        if (questions.some(question => Math.abs(question.maxScore * 100 - Math.round(question.maxScore * 100)) > 1e-8)) {
            throw new Error('小问满分最多保留两位小数');
        }
        if (!Number.isFinite(maxScore) || Math.abs(sum - maxScore) > 1e-8) {
            throw new Error('各小问满分之和须等于本题满分');
        }
    }
    return { questions, totalOnly };
}

async function requestGradingWithAnswerRecovery(context, request, recoverAnswerStatus, retryUnreadable = false) {
    const unattended = isUnattendedRun(context);
    const policy = unattended ? getUnattendedAnswerFailure(context.configuration) : 'pause';
    const configuredPolicy = context.configuration.retryPolicy?.unattendedAnswerFailure;
    const checkEvidence = isAnswerStatusCheckEnabled(context.configuration)
        || (unattended && (configuredPolicy === 'recover' || configuredPolicy === 'retry'));
    const budget = unattended ? createUnattendedRetryBudget(context, 'score') : null;
    for (;;) {
        requireCurrentGradingContext(context);
        try {
            const result = await request(budget);
            requireCurrentGradingContext(context);
            if (checkEvidence || (retryUnreadable && getGradingAnswerStatus(result) === 'unreadable')) {
                requireGradingEvidence(result, [result?.score, ...(result?.subScores || []).map(unit => unit.score)]);
            }
            if (unattended && !hasUsableGradingScores(result)) throw missingGradingScore();
            return result;
        } catch (error) {
            requireCurrentGradingContext(context);
            if (!budget?.remaining) throw error;
            if (error.code === 'GRADING_SCORE_INVALID') {
                if (await budget.retry(undefined, error.code)) continue;
                throw error;
            }
            if (policy === 'pause' || error.code !== 'GRADING_EVIDENCE_REVIEW') throw error;
            if (policy === 'retry') {
                if (await budget.retry(undefined, error.code)) continue;
                throw error;
            }
            let status;
            if (recoverAnswerStatus) {
                await verifyGradingContext(context);
                requireGradingContextTarget(context);
                try {
                    status = await recoverAnswerStatus();
                } catch (recoveryError) {
                    console.warn('[答卷复查] 无法确认作答状态:', recoveryError);
                }
                requireCurrentGradingContext(context);
                await verifyGradingContext(context);
                requireGradingContextTarget(context);
                if (status === 'blank') return makeBlankGradingResult(context.configuration);
            }
            if (status !== 'written' && status !== undefined && status !== 'unknown'
                && !(retryUnreadable && error.answerStatus === 'unreadable')) throw error;
            if (!await budget.retry(undefined, error.code)) throw error;
        }
    }
}

async function requestGradingWithRecognitionRetry(context, request, recoverAnswerStatus) {
    const enabled = isAnswerReviewEnabled(context.configuration);
    try {
        return await requestGradingWithAnswerRecovery(context, request, recoverAnswerStatus, enabled);
    } catch (error) {
        requireCurrentGradingContext(context);
        if (error.code === 'GRADING_EVIDENCE_REVIEW' && error.answerStatus === 'unreadable') {
            window.aiGradingState.currentStudentAnswer = error.gradingResult?.studentAnswer || '无法辨认';
            if (enabled) {
                await HistoryManager.savePendingReview(context, error.gradingResult);
                requireCurrentGradingContext(context);
                error.message = '本卷需要教师评分，原图与评分方案已保存到评阅历史的待复核记录';
            }
        }
        throw error;
    }
}

function createGradingContext(manual = false) {
    invalidateGradingRun();
    const state = window.aiGradingState;
    const adapter = window.__AI_MARKER_ADAPTER__;
    const configuration = JSON.parse(JSON.stringify(PresetManager.getCurrentConfig?.() || {}));
    configuration.scoring = { ...configuration.scoring,
        maxScore: PresetManager.getMaxScore?.() ?? configuration.scoring?.maxScore,
        units: JSON.parse(JSON.stringify(PresetManager.getScoringUnits?.() || configuration.scoring?.units || [])) };
    const questionGuardEnabled = configuration.questionGuard?.enabled === true;
    const observedQuestion = questionGuardEnabled ? readGradingQuestionContext(adapter) : null;
    const sessionQuestion = state.questionGuardSession;
    const questionBaseline = !manual && sessionQuestion?.adapter === adapter && sessionQuestion.presetName === PresetManager.data.active
        ? sessionQuestion.snapshot : observedQuestion;
    if (questionGuardEnabled && !manual && !sessionQuestion && observedQuestion) {
        state.questionGuardSession = { adapter, presetName: PresetManager.data.active, snapshot: observedQuestion };
    }
    const context = {
        controller: new AbortController(), adapter, manual, configuration,
        questionGuardEnabled, questionBaseline,
        taskId: readGradingTaskIdentifier(), presetName: PresetManager.data.active,
        pageUrl: (window.location?.pathname || '') + (window.location?.hash || ''),
        paperGuardEnabled: PresetManager.getCurrentConfig?.()?.paperGuard?.enabled !== false,
        paperId: readGradingPaperIdentity(adapter),
        imageUrls: [], inputSnapshot: [], base64DataArray: []
    };
    // 同一次连续批改保留题目基准；换卷与手动暂停均不能重新接受另一个题目。
    if (!manual && adapter?.getGradingTaskIdentifier && !state.gradingTaskId && context.taskId) state.gradingTaskId = context.taskId;
    state.abortController = context.controller;
    state.activeRun = context;
    return context;
}

function isGradingContextCurrent(context) {
    const state = window.aiGradingState;
    return !!context && state.activeRun === context && !context.controller.signal.aborted &&
        context.adapter === window.__AI_MARKER_ADAPTER__ &&
        (context.manual || (state.isRunning && !state.isPaused));
}

function requireCurrentGradingContext(context) {
    if (!isGradingContextCurrent(context)) throw gradingContextError('用户主动暂停');
}

function readGradingPaperIdentity(adapter) {
    try { return adapter?.getPaperIdentity?.() || null; } catch (_) { return null; }
}

function gradingContextError(message) {
    const error = new Error(message);
    error.code = 'GRADING_CONTEXT_CHANGED';
    return error;
}

// 只消费适配器确认过的题号来源；分数、份数与 DOM 下标不构成题号证据。
function readGradingQuestionContext(adapter) {
    try {
        const value = adapter?.getQuestionContext?.();
        if (!value || typeof value.question !== 'string' || !Array.isArray(value.units) || !value.units.length) return null;
        const normalize = text => String(text ?? '').normalize('NFKC').replace(/\s+/g, '').trim();
        const question = normalize(value.question);
        const units = value.units.map(unit => ({ label: normalize(unit.label), maxScore: Number(unit.maxScore) }));
        if (!question || units.some(unit => !unit.label || !Number.isFinite(unit.maxScore) || unit.maxScore <= 0)) return null;
        return { question, units, key: JSON.stringify([question, units.map(unit => [unit.label, unit.maxScore])]) };
    } catch (_) { return null; }
}

function captureInitialGradingQuestion(context) {
    if (!context.questionGuardEnabled || context.questionBaseline) return;
    requireGradingContextTarget(context, false);
    const page = (window.location?.pathname || '') + (window.location?.hash || '');
    if (page !== context.pageUrl) throw gradingContextError('当前题目已变化，请核对后重新批改');
    const snapshot = readGradingQuestionContext(context.adapter);
    if (snapshot) {
        context.questionBaseline = snapshot;
        window.aiGradingState.questionGuardSession = {
            adapter: context.adapter, presetName: context.presetName, snapshot
        };
    }
}

function requireGradingQuestionContext(context) {
    if (context?.questionGuardEnabled !== true) return;
    const current = readGradingQuestionContext(context.adapter);
    if (!context.questionBaseline || !current) throw gradingStepRetry('暂未读取到完整题号，请核对阅卷页面后继续');
    if (context.questionBaseline.key !== current.key) {
        const error = gradingContextError('题号或小题满分已变化，请核对当前题目和评分方案后继续');
        error.code = 'GRADING_QUESTION_CHANGED';
        throw error;
    }
}

function readGradingTaskIdentifier() {
    const adapter = window.__AI_MARKER_ADAPTER__;
    try {
        return (adapter?.getGradingTaskIdentifier ? adapter.getGradingTaskIdentifier() : PresetManager.getTaskIdentifier?.()) || '';
    } catch (error) {
        console.warn('[题目校验] 暂时无法读取当前题目:', error);
        return '';
    }
}

function captureInitialZhixueTask(context, taskId = readGradingTaskIdentifier()) {
    if (context.taskId || !taskId) return;
    context.taskId = taskId;
    window.aiGradingState.gradingTaskId ||= taskId;
}

function stopIfGradingTaskChanged(context) {
    const state = window.aiGradingState;
    // 只有声明了可信题目标识的适配器启用跨轮次保护，避免将学生或临时地址当作题目。
    if (!window.__AI_MARKER_ADAPTER__?.getGradingTaskIdentifier) return false;
    if (!state.isRunning || state.isPaused || context?.manual || (!context && state.activeRun?.manual)) return false;
    if (context && !isGradingContextCurrent(context)) return false;
    const baseline = state.gradingTaskId || state.activeRun?.taskId;
    const taskId = readGradingTaskIdentifier();
    if (!baseline || !taskId || baseline === taskId) return false;
    if (typeof DiagnosticLog !== 'undefined') {
        DiagnosticLog.grading('grading-paused', context || state.activeRun, { reason: 'task-changed' }, { persist: true });
    }
    stopAutoGrading();
    showToast('当前题目已切换，批改已停止，请核对当前题目的方案后继续');
    return true;
}

function requireGradingContextTarget(context, checkQuestion = true, checkPaper = true) {
    requireCurrentGradingContext(context);
    if (stopIfGradingTaskChanged(context)) throw gradingContextError('当前题目已变化，请核对后重新批改');
    if (checkQuestion) requireGradingQuestionContext(context);
    if (PresetManager.data.active !== context.presetName) throw gradingContextError('配置方案已切换，请重新批改');
    const taskId = readGradingTaskIdentifier();
    if (context.taskId && taskId && context.taskId !== taskId) throw gradingContextError('当前题目已变化，请核对后重新批改');
    if (checkPaper && context.paperGuardEnabled !== false && context.paperId) {
        const paperId = readGradingPaperIdentity(context.adapter);
        if (paperId && context.paperId !== paperId) throw gradingContextError('答卷已切换，请核对后重新批改');
    }
}

async function verifyGradingContext(context, requirePaperMatch = false) {
    requireCurrentGradingContext(context);
    requireGradingQuestionContext(context);
    const taskId = readGradingTaskIdentifier();
    if (context.taskId && taskId && taskId !== context.taskId) throw gradingContextError('当前题目已变化，请核对后重新批改');
    if (await confirmLeftMarkingPage(context.adapter)) {
        const pageUrl = (window.location?.pathname || '') + (window.location?.hash || '');
        if (pageUrl === context.pageUrl) throw gradingStepRetry('阅卷页面暂时未就绪，请核对后继续');
        throw gradingContextError('已离开批改页面，请返回后继续');
    }
    requireCurrentGradingContext(context);
    if (requirePaperMatch || context.paperGuardEnabled !== false) {
        const check = await verifyPaperUnchanged(context.adapter, context.imageUrls, context.inputSnapshot, context.paperId);
        requireCurrentGradingContext(context);
        if (check.unchanged === false) throw gradingContextError('答卷已切换，请核对后重新批改');
        if (check.unchanged === null) {
            if (requirePaperMatch) throw gradingStepRetry('暂未确认当前答卷，请核对后继续');
            console.warn('[答卷校验] 无法判定:', check.reason);
        }
    }
    requireGradingContextTarget(context);
}

function checkGradingRetryTarget(context) {
    return verifyGradingContext(context, true);
}

// 把降级期间相对默认快照的编辑合并到恢复的数据；未编辑的默认值不覆盖原值。
function mergeRecoveredData(recovered, edited, baseline) {
    const plain = v => v && typeof v === 'object' && !Array.isArray(v);
    const merge = (original, current, before) => {
        if (JSON.stringify(current) === JSON.stringify(before)) return original;
        if (!plain(current)) return current;
        const out = plain(original) ? { ...original } : {};
        for (const key of Object.keys(current)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
            out[key] = merge(out[key], current[key], plain(before) ? before[key] : undefined);
        }
        for (const key of Object.keys(before || {})) {
            if (!Object.prototype.hasOwnProperty.call(current, key)) delete out[key];
        }
        return out;
    };
    return merge(recovered, edited, baseline);
}

function prepareConfigurationImport(data) {
    const record = value => value && typeof value === 'object' && !Array.isArray(value);
    const clone = value => JSON.parse(JSON.stringify(value));
    if (!record(data?.presets?.list)) throw new Error('配置文件中的方案格式不正确');
    const presets = Object.assign(Object.create(PresetManager), { data: { list: {}, active: String(data.presets.active || ''),
        bindings: record(data.presets.bindings) ? clone(data.presets.bindings) : {} }, save() {} });
    for (const [name, cfg] of Object.entries(data.presets.list)) {
        if (['__proto__', 'constructor', 'prototype'].includes(name)) continue;
        if (!record(cfg)) throw new Error('配置文件包含无效方案');
        presets.data.list[name] = PresetManager.sanitizePreset(cfg);
    }
    const names = Object.keys(presets.data.list);
    if (!names.length) throw new Error('配置文件中没有可用方案');
    if (!presets.data.list[presets.data.active]) presets.data.active = names[0];
    presets.migrateAll();
    const providers = Object.assign(Object.create(ProviderManager), { data: clone(data.providers || ProviderManager.data), save() {} });
    if (!record(providers.data.providers)) throw new Error('配置文件中的供应商格式不正确');
    for (const [name, provider] of Object.entries(providers.data.providers)) {
        if (['__proto__', 'constructor', 'prototype'].includes(name) || !record(provider) || !record(provider.models) ||
            typeof provider.endpoint !== 'string' || typeof provider.apiKey !== 'string') throw new Error('配置文件包含无效供应商');
        if (Object.values(provider.models).some(model => !record(model))) throw new Error('配置文件包含无效模型');
    }
    providers._migrateProviders();
    const workflows = Object.assign(Object.create(WorkflowManager), { data: clone(data.workflows || WorkflowManager.data), save() {} });
    if (!record(workflows.data.workflows)) throw new Error('配置文件中的工作流格式不正确');
    workflows._migrateWorkflows(providers.data.providers);
    for (const [name, wf] of Object.entries(workflows.data.workflows)) {
        if (['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('配置文件包含无效工作流名称');
        if (!record(wf) || !record(wf.model)) throw new Error('配置文件包含无效工作流');
        const selections = [wf.model, ...(wf.dualEval?.enabled ? [wf.dualEval.secondary, wf.dualEval.arbitration] : [])];
        if (selections.some(m => !m?.model || !providers.getCallConfig(m.provider, m.model))) throw new Error('工作流引用了不可用的供应商或模型');
        if (wf.dualEval?.enabled && (!Number.isFinite(Number(wf.dualEval.threshold ?? 2)) || Number(wf.dualEval.threshold ?? 2) < 0)) throw new Error('工作流的分差阈值不正确');
    }
    for (const cfg of Object.values(presets.data.list)) {
        if (!workflows.getWorkflow(cfg.workflowId)) throw new Error('方案引用的工作流不存在');
    }
    return { presets: presets.data, providers: providers.data, workflows: workflows.data };
}

function persistConfigurationImport(prepared) {
    if (configurationImportRecoveryBlocked) throw new Error('配置恢复尚未完成，请重新打开页面后重试');
    const keys = ['ai-grading-presets', 'ai-grading-providers-v2', 'ai-grading-workflows'];
    const values = [prepared.presets, prepared.providers, prepared.workflows];
    const previous = keys.map(key => GM_getValue(key));
    // 留存整组恢复点后才开始写入。
    const backup = { keys, previous, missing: previous.map(value => value === undefined), pending: true };
    GM_setValue('ai-grading-import-backup', JSON.stringify(backup));
    try {
        keys.forEach((key, i) => GM_setValue(key, JSON.stringify(values[i])));
        GM_setValue('ai-grading-import-backup', JSON.stringify({ ...backup, pending: false }));
    }
    catch (error) {
        let rolledBack = true;
        keys.forEach((key, i) => {
            try { if (previous[i] === undefined && typeof GM_deleteValue === 'function') GM_deleteValue(key); else GM_setValue(key, previous[i]); }
            catch (_) { rolledBack = false; }
        });
        if (rolledBack) {
            try { GM_setValue('ai-grading-import-backup', JSON.stringify({ ...backup, pending: false })); }
            catch (_) { rolledBack = false; }
        }
        configurationImportRecoveryBlocked = !rolledBack;
        throw error;
    }
    [PresetManager, ProviderManager, WorkflowManager].forEach((manager, i) => {
        manager.data = values[i]; manager._writeDisabled = false; manager._initialSaveFailed = false;
        manager._storageBaseline = JSON.parse(JSON.stringify(values[i]));
    });
}

// 中断的多键导入在各管理器读取前恢复整组配置。
let configurationImportRecoveryBlocked = false;
function recoverInterruptedConfigurationImport() {
    try {
        const raw = GM_getValue('ai-grading-import-backup');
        if (!raw) return true;
        const backup = JSON.parse(raw);
        if (!backup.pending) return true;
        const keys = ['ai-grading-presets', 'ai-grading-providers-v2', 'ai-grading-workflows'];
        if (JSON.stringify(backup.keys) !== JSON.stringify(keys) || !Array.isArray(backup.previous) || backup.previous.length !== keys.length) throw new Error('导入恢复点格式不正确');
        keys.forEach((key, i) => {
            if (backup.missing?.[i] && typeof GM_deleteValue === 'function') GM_deleteValue(key);
            else GM_setValue(key, backup.previous[i]);
        });
        GM_setValue('ai-grading-import-backup', JSON.stringify({ ...backup, pending: false }));
        return true;
    } catch (error) {
        console.error('[配置] 导入恢复未完成，保护原配置:', error);
        return false;
    }
}
if (typeof GM_getValue === 'function') configurationImportRecoveryBlocked = !recoverInterruptedConfigurationImport();
