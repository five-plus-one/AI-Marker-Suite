const DIAGNOSTIC_DEFAULT_RANGE = 2 * 60 * 60 * 1000;

function diagnosticFields(source, keys) {
    return Object.fromEntries(keys.flatMap(key => {
        const value = source?.[key];
        return Number.isFinite(value) || typeof value === 'boolean' || value === null ? [[key, value]] : [];
    }));
}

function diagnosticChoice(value, options) {
    return options.includes(value) ? value : undefined;
}

function diagnosticScoring(scoring) {
    return {
        ...diagnosticFields(scoring, ['maxScore', 'roundStep']),
        roundMethod: diagnosticChoice(scoring?.roundMethod, ['round', 'floor', 'ceil']),
        units: Array.isArray(scoring?.units) ? scoring.units.map(unit => diagnosticFields(unit, ['maxScore', 'roundStep'])) : [],
        diligence: diagnosticFields(scoring?.diligence, ['enabled', 'maxBonus', 'decayPower']),
    };
}

function diagnosticConfiguration(presets, providers, workflows, builtinProviders, state) {
    const providerNames = Object.keys(providers?.providers || {});
    const workflowList = Object.values(workflows?.workflows || {});
    const providerIndex = name => providerNames.indexOf(name) + 1 || undefined;
    const model = config => ({
        provider: providerIndex(config?.provider),
        model: diagnosticModelId(config?.model, providers?.providers?.[config?.provider]?.apiKey),
        reasoningEffort: diagnosticChoice(config?.reasoningEffort, ['', 'disabled', 'minimal', 'low', 'medium', 'high', 'xhigh']),
    });
    const presetList = Object.entries(presets?.list || {});
    const presetIndex = name => presetList.findIndex(([key]) => key === name) + 1 || undefined;
    return {
        activePreset: presetIndex(presets?.active),
        presets: presetList.map(([, config]) => ({
            gradingMode: diagnosticChoice(config.gradingMode, ['normal', 'trial', 'unattended']),
            outputMode: diagnosticChoice(config.outputMode ?? config.scoring?.outputMode, ['detailed', 'score-only']),
            workflow: workflowList.findIndex(workflow => workflow.id === config.workflowId) + 1 || undefined,
            provider: providerIndex(config.provider),
            model: diagnosticModelId(config.model, config.apiKey ?? providers?.providers?.[config.provider]?.apiKey),
            scoring: diagnosticScoring(config.scoring),
            batch: diagnosticFields(config.batchConfig, ['enabled', 'targetCount']),
            retries: {
                ...diagnosticFields(config.retryPolicy, ['maxRetries', 'retryOnTimeout']),
                unattendedAnswerFailure: diagnosticChoice(config.retryPolicy?.unattendedAnswerFailure, ['recover', 'pause']),
            },
            paperGuard: diagnosticFields(config.paperGuard, ['enabled']),
            questionGuard: diagnosticFields(config.questionGuard, ['enabled']),
            blankDetection: diagnosticFields(config.blankDetection, ['enabled', 'threshold']),
            answerReview: diagnosticFields(config.answerReview, ['enabled', 'maxPending']),
            ...diagnosticFields(config, ['answerStatusCheck', 'referenceImageEvidenceCheck']),
            pacing: {
                ...diagnosticFields(config.humanPacing, ['enabled', 'recordDuration']),
                normalDelay: diagnosticFields(config.humanPacing?.normalDelay, ['enabled', 'min', 'max', 'minSeconds', 'maxSeconds']),
                unattendedDelay: diagnosticFields(config.humanPacing?.unattendedDelay, ['enabled', 'min', 'max', 'minSeconds', 'maxSeconds']),
                rest: diagnosticFields(config.humanPacing?.rest, ['enabled', 'everyCount', 'min', 'max', 'minSeconds', 'maxSeconds']),
            },
        })),
        providers: providerNames.map(name => {
            const provider = providers.providers[name];
            return {
                builtin: Object.prototype.hasOwnProperty.call(builtinProviders, name) ? name : undefined,
                endpointConfigured: !!provider.endpoint,
                keyConfigured: !!provider.apiKey,
                modelCount: Object.keys(provider.models || {}).length,
            };
        }),
        workflows: workflowList.map(workflow => ({
            primary: model(workflow.model),
            dualEvaluation: workflow.dualEval ? {
                ...diagnosticFields(workflow.dualEval, ['enabled', 'threshold']),
                mergeMode: diagnosticChoice(workflow.dualEval.mergeMode, ['round', 'floor', 'ceil', 'min', 'max']),
                secondary: model(workflow.dualEval.secondary),
                arbitration: model(workflow.dualEval.arbitration),
            } : null,
        })),
        runtime: diagnosticFields(state, ['isRunning', 'isPaused', 'saveImages', 'autoRefreshOn403']),
    };
}

async function exportDiagnosticPackage(start, end) {
    const logs = DiagnosticLog.read(start, end);
    let history, historyFromStorage = true;
    try { history = HistoryManager._readReviewRecords(); }
    catch (_) {
        history = HistoryManager.records;
        historyFromStorage = false;
    }
    const records = history.filter(record => Number.isFinite(record?.timestamp) && record.timestamp >= start && record.timestamp <= end)
        .sort((a, b) => a.timestamp - b.timestamp);
    const secrets = diagnosticSecrets();
    const configurationDetails = diagnosticSnapshot({
        presets: PresetManager.data, providers: ProviderManager.data, workflows: WorkflowManager.data,
        runtime: window.aiGradingState,
    }, { secrets, omitImageData: true });
    const entries = [], recordImages = [];
    const imageBudget = 64 * 1024 * 1024;
    let imageBytes = 0, imageCount = 0, imagesLimited = false;
    for (const [index, record] of records.entries()) {
        const files = [];
        try {
            const base64s = record.imageBase64s?.length ? record.imageBase64s : record.id ? await ImageStore.get(record.id) : null;
            for (const [imageIndex, base64] of (Array.isArray(base64s) ? base64s : []).entries()) {
                if (typeof base64 !== 'string' || !base64) continue;
                if (base64.length * 0.75 > imageBudget - imageBytes || entries.length >= 65530) {
                    imagesLimited = true;
                    continue;
                }
                try {
                    const data = HistoryManager._base64ToBytes(base64);
                    const name = `答卷图片/${index + 1}/${imageIndex + 1}.png`;
                    entries.push({ name, data });
                    files.push(name);
                    imageBytes += data.length;
                    imageCount++;
                } catch (_) { /* 其他图片仍可导出。 */ }
            }
        } catch (_) { /* 图片可能存放在另一平台域名。 */ }
        recordImages.push(files);
    }
    const recordDetails = records.map(({ imageBase64s, ...record }, index) => {
        return diagnosticSnapshot({ ...record, imageFiles: recordImages[index] }, { secrets, omitImageData: true });
    });
    const configuration = diagnosticConfiguration(PresetManager.data, ProviderManager.data, WorkflowManager.data,
        ProviderManager._getDefault().providers, window.aiGradingState);
    const metadata = {
        formatVersion: 3,
        scriptVersion: SCRIPT_CONFIG.VERSION,
        exportedAt: new Date().toISOString(),
        range: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        browser: navigator.userAgent,
        userscriptManager: typeof GM_info === 'undefined' ? undefined : {
            name: GM_info.scriptHandler, version: GM_info.version, injectInto: GM_info.injectInto,
        },
        environment: {
            language: navigator.language, platform: navigator.platform, viewport: [window.innerWidth, window.innerHeight],
            devicePixelRatio: window.devicePixelRatio, online: navigator.onLine,
        },
        platform: window.__AI_MARKER_ADAPTER__?.id,
        logCount: logs.entries.length,
        recordCount: records.length,
        imageCount,
        imagesLimited,
        logRetentionDays: logs.retentionDays,
        logStorageLimited: logs.storageLimited,
        historyFromStorage,
    };
    const files = {
        '导出说明.json': metadata,
        '运行日志.json': logs.entries,
        '阅卷记录.json': recordDetails,
        '配置摘要.json': configuration,
        '配置详情.json': configurationDetails,
    };
    for (const [name, value] of Object.entries(files)) {
        entries.push({ name, data: ZipWriter._utf8(JSON.stringify(value, null, 2)) });
    }
    return { archive: ZipWriter.build(entries), metadata };
}

function diagnosticDateInput(timestamp) {
    const date = new Date(timestamp);
    return new Date(timestamp - date.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 19);
}

function showDiagnosticExport() {
    if (document.getElementById('ai-diagnostic-export')) return;
    ensureModalStyles();
    const dialog = document.createElement('dialog');
    dialog.id = 'ai-diagnostic-export';
    dialog.className = 'ai-modal-card';
    dialog.setAttribute('aria-labelledby', 'ai-diagnostic-title');
    dialog.style.cssText = 'padding:0;min-width:0;width:min(92vw,460px);max-height:90vh;overflow:auto;';
    dialog.innerHTML = `
        <form>
            <div class="ai-modal-header" id="ai-diagnostic-title">导出诊断包</div>
            <div class="ai-modal-body">
                <p>诊断包包含运行日志、配置、阅卷内容和可读取的答卷图片。请仅发给协助排查的人。</p>
                <p>默认最近 2 小时，按此设备的时间选择。</p>
                <label style="display:block;">开始时间
                    <input class="ai-modal-input" name="start" type="datetime-local" step="1" style="min-height:44px;" required autofocus>
                </label>
                <label style="display:block;margin-top:12px;">结束时间
                    <input class="ai-modal-input" name="end" type="datetime-local" step="1" style="min-height:44px;" required>
                </label>
                <p data-export-status role="status" style="margin-bottom:0;"></p>
            </div>
            <div class="ai-modal-footer">
                <button type="button" class="ai-modal-btn-cancel" style="min-height:44px;">取消</button>
                <button type="submit" class="ai-modal-btn-confirm" style="min-height:44px;">下载 ZIP</button>
            </div>
        </form>
    `;
    const form = dialog.querySelector('form');
    const startField = form.elements.namedItem('start');
    const endField = form.elements.namedItem('end');
    const status = dialog.querySelector('[data-export-status]');
    const download = dialog.querySelector('[type=submit]');
    const now = Date.now();
    startField.value = diagnosticDateInput(now - DIAGNOSTIC_DEFAULT_RANGE);
    endField.value = diagnosticDateInput(now);
    form.addEventListener('input', () => { status.textContent = ''; });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const start = new Date(startField.value).getTime(), end = new Date(endField.value).getTime() + 999;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
            status.textContent = '请填写有效时间，结束时间应等于或晚于开始时间。';
            endField.focus();
            return;
        }
        if (download.disabled) return;
        download.disabled = true;
        try {
            const { archive, metadata } = await exportDiagnosticPackage(start, end);
            if (!dialog.open) return;
            HistoryManager._download(archive, 'AI批改助手诊断包_' + HistoryManager._fileTimestamp() + '.zip', 'application/zip');
            dialog.close();
            showToast(`诊断包已下载（${metadata.logCount} 条日志，${metadata.recordCount} 条阅卷记录）`);
        } catch (error) {
            console.error('[诊断导出] 下载失败:', error);
            status.textContent = '下载暂未完成，请重试。';
        } finally {
            download.disabled = false;
        }
    });
    dialog.querySelector('.ai-modal-btn-cancel').onclick = () => dialog.close();
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    getUIRoot().appendChild(dialog);
    dialog.showModal();
}

if (window === window.top && typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('导出诊断包', showDiagnosticExport);
}
