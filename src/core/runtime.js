// 异步批改上下文：每轮持有自己的取消信号和答卷基准。
function isConfigurationRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
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

function createGradingContext(manual = false) {
    invalidateGradingRun();
    const state = window.aiGradingState;
    const adapter = window.__AI_MARKER_ADAPTER__;
    const configuration = JSON.parse(JSON.stringify(PresetManager.getCurrentConfig?.() || {}));
    configuration.scoring = { ...configuration.scoring,
        maxScore: PresetManager.getMaxScore?.() ?? configuration.scoring?.maxScore,
        units: JSON.parse(JSON.stringify(PresetManager.getScoringUnits?.() || configuration.scoring?.units || [])) };
    const context = {
        controller: new AbortController(), adapter, manual, configuration,
        taskId: PresetManager.getTaskIdentifier?.() || '', presetName: PresetManager.data.active,
        pageUrl: (window.location?.pathname || '') + (window.location?.hash || ''),
        paperGuardEnabled: PresetManager.getCurrentConfig?.()?.paperGuard?.enabled !== false,
        paperId: readGradingPaperIdentity(adapter),
        imageUrls: [], inputSnapshot: [], base64DataArray: []
    };
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

function requireGradingContextTarget(context) {
    requireCurrentGradingContext(context);
    if (PresetManager.data.active !== context.presetName) throw gradingContextError('配置方案已切换，请重新批改');
    const taskId = PresetManager.getTaskIdentifier?.() || '';
    if (context.taskId && taskId && context.taskId !== taskId) throw gradingContextError('当前题目已变化，请核对后重新批改');
    const paperId = readGradingPaperIdentity(context.adapter);
    if (context.paperGuardEnabled !== false && context.paperId && paperId && context.paperId !== paperId) throw gradingContextError('答卷已切换，请核对后重新批改');
}

async function verifyGradingContext(context) {
    requireCurrentGradingContext(context);
    const taskId = PresetManager.getTaskIdentifier?.() || '';
    if (context.taskId && taskId && taskId !== context.taskId) throw gradingContextError('当前题目已变化，请核对后重新批改');
    if (await confirmLeftMarkingPage(context.adapter)) throw gradingContextError('已离开批改页面，请返回后继续');
    requireCurrentGradingContext(context);
    if (context.paperGuardEnabled !== false) {
        const check = await verifyPaperUnchanged(context.adapter, context.imageUrls, context.inputSnapshot, context.paperId);
        requireCurrentGradingContext(context);
        if (check.unchanged === false) throw gradingContextError('答卷已切换，请核对后重新批改');
        if (check.unchanged === null) console.warn('[答卷校验] 无法判定:', check.reason);
    }
    requireGradingContextTarget(context);
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
    [PresetManager, ProviderManager, WorkflowManager].forEach((manager, i) => { manager.data = values[i]; manager._writeDisabled = false; });
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
