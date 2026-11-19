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
        model: Object.prototype.hasOwnProperty.call(builtinProviders[config?.provider]?.models || {}, config?.model)
            ? config.model : undefined,
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

function diagnosticRecords(records, start, end, presetNames) {
    return records.filter(record => Number.isFinite(record?.timestamp) && record.timestamp >= start && record.timestamp <= end)
        .sort((a, b) => a.timestamp - b.timestamp)
        .map(record => ({
            ...diagnosticFields(record, ['timestamp', 'aiScore', 'finalScore', 'isCorrected', 'diligenceBonus', 'durationMs', 'pacingDelayMs']),
            preset: presetNames.indexOf(record.presetName) + 1 || undefined,
            status: diagnosticChoice(record.status, ['submitted', 'marked', 'pending']),
            reviewStatus: diagnosticChoice(record.reviewStatus, ['pending', 'reviewed']),
            gradingMode: diagnosticChoice(record.gradingMode, ['normal', 'trial', 'unattended']),
            answerStatus: diagnosticChoice(record.answerStatus, ['readable', 'partial', 'blank', 'unreadable', 'unknown']),
            subScores: Array.isArray(record.subScores) ? record.subScores.map(unit => diagnosticFields(unit, ['score', 'maxScore'])) : [],
            dualEvaluation: record.dualEval ? diagnosticFields(record.dualEval, ['scoreA', 'scoreB', 'diff', 'arbScore']) : null,
        }));
}

function diagnosticPackageData(start, end) {
    const logs = DiagnosticLog.read(start, end);
    let history, historyFromStorage = true;
    try { history = HistoryManager._readReviewRecords(); }
    catch (_) {
        history = HistoryManager.records;
        historyFromStorage = false;
    }
    const orderedHistory = history.filter(record => Number.isFinite(record?.timestamp)
        && record.timestamp >= start && record.timestamp <= end).sort((a, b) => a.timestamp - b.timestamp);
    const records = diagnosticRecords(orderedHistory, start, end, Object.keys(PresetManager.data?.list || {}));
    const configuration = diagnosticConfiguration(PresetManager.data, ProviderManager.data, WorkflowManager.data,
        ProviderManager._getDefault().providers, window.aiGradingState);
    const metadata = {
        formatVersion: 1,
        scriptVersion: SCRIPT_CONFIG.VERSION,
        exportedAt: new Date().toISOString(),
        range: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        browser: /(?:Edg|Chrome|Firefox|Version)\/[\d.]+/.exec(navigator.userAgent)?.[0],
        platform: window.__AI_MARKER_ADAPTER__?.id,
        logCount: logs.entries.length,
        recordCount: records.length,
        logRetentionDays: logs.retentionDays,
        logStorageLimited: logs.storageLimited,
        historyFromStorage,
    };
    return { metadata, entries: logs.entries, records, configuration, orderedHistory };
}

function exportDiagnosticPackage(start, end) {
    const { metadata, entries, records, configuration } = diagnosticPackageData(start, end);
    const files = {
        '导出说明.json': metadata,
        '运行日志.json': entries,
        '阅卷记录.json': records,
        '配置摘要.json': configuration,
    };
    const archive = ZipWriter.build(Object.entries(files).map(([name, value]) => ({
        name, data: ZipWriter._utf8(JSON.stringify(value, null, 2)),
    })));
    HistoryManager._download(archive, 'AI批改助手诊断包_' + HistoryManager._fileTimestamp() + '.zip', 'application/zip');
    return metadata;
}

async function diagnosticUploadBody(start, end, includeImages) {
    const data = diagnosticPackageData(start, end);
    const records = data.records.slice(-1000);
    const selected = data.orderedHistory.slice(data.orderedHistory.length - records.length);
    const images = [];
    let imageBytes = 0;
    const addImage = (record, image) => {
        if (images.length === 12 || typeof image !== 'string' || image.length > 5_590_000 ||
            imageBytes + image.length > 10 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) return;
        images.push({ record, bytes: image });
        imageBytes += image.length;
    };
    if (includeImages) {
        const adapter = window.__AI_MARKER_ADAPTER__;
        if (!window.aiGradingState?.isRunning && !window.aiGradingState?.activeRun
            && adapter?.isMarkingPage?.() && adapter.getPaperIdentity && adapter.fetchImageAsBase64) {
            try {
                const paper = adapter.getPaperIdentity();
                const urls = paper ? await adapter.gatherAnswerImages() : [];
                const current = [];
                const signal = AbortSignal.timeout(12000);
                for (const url of urls.slice(0, 12)) {
                    if (signal.aborted || window.aiGradingState?.isRunning || adapter.getPaperIdentity() !== paper) break;
                    current.push(await adapter.fetchImageAsBase64(url, signal));
                }
                if (current.length === urls.length && !window.aiGradingState?.isRunning
                    && adapter.getPaperIdentity() === paper) current.forEach(image => addImage(-1, image));
            } catch (_) { /* 已保存的答卷仍可随包上传。 */ }
        }
        for (let index = selected.length - 1; index >= 0 && images.length < 12; index--) {
            const record = selected[index];
            let saved = record.imageBase64s;
            if (!saved?.length && ImageStore.getImageStatus(record.id).status === 'local') {
                try { saved = await ImageStore.get(record.id); } catch (_) {}
            }
            for (const image of Array.isArray(saved) ? saved : []) {
                addImage(index, image);
                if (images.length === 12) break;
            }
        }
    }
    const logs = data.entries.slice(-3000).map(entry => ({
        at: entry.at,
        level: entry.level,
        source: typeof entry.source === 'string' ? entry.source.slice(0, 45) : '',
        message: typeof entry.message === 'string' ? entry.message.slice(0, 180) : '',
        platform: entry.platform,
        version: entry.version,
        errorType: entry.errorType,
        httpStatus: entry.httpStatus,
    }));
    return {
        version: data.metadata.scriptVersion, platform: data.metadata.platform, browser: data.metadata.browser,
        start: data.metadata.range.start, end: data.metadata.range.end,
        logs, records, configuration: data.configuration, images,
    };
}

function diagnosticDateInput(timestamp) {
    const date = new Date(timestamp);
    return new Date(timestamp - date.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 19);
}

function showDiagnosticExport(upload = false) {
    if (document.getElementById('ai-diagnostic-export')) return;
    ensureModalStyles();
    const dialog = document.createElement('dialog');
    dialog.id = 'ai-diagnostic-export';
    dialog.className = 'ai-modal-card';
    dialog.setAttribute('aria-labelledby', 'ai-diagnostic-title');
    dialog.style.cssText = 'padding:0;min-width:0;width:min(92vw,460px);max-height:90vh;overflow:auto;';
    dialog.innerHTML = `
        <form>
            <div class="ai-modal-header" id="ai-diagnostic-title">${upload ? '上传诊断包' : '导出诊断包'}</div>
            <div class="ai-modal-body">
                <p>${upload ? '将所选时段的运行日志、阅卷记录和配置摘要发送给管理员，供排查和分析。'
                    : '导出这段时间的运行日志、阅卷记录和当前配置摘要，供问题排查。密钥、答卷图片和答卷原文留在本机。'}</p>
                <p>默认最近 2 小时，按此设备的时间选择。</p>
                <label style="display:block;">开始时间
                    <input class="ai-modal-input" name="start" type="datetime-local" step="1" style="min-height:44px;" required autofocus>
                </label>
                <label style="display:block;margin-top:12px;">结束时间
                    <input class="ai-modal-input" name="end" type="datetime-local" step="1" style="min-height:44px;" required>
                </label>
                ${upload ? '<label style="display:block;margin-top:12px;"><input type="checkbox" name="images"> 附上当前答卷和本浏览器已保存的答卷图片（最多 12 张）</label>' : ''}
                <p data-export-status role="status" style="margin-bottom:0;"></p>
            </div>
            <div class="ai-modal-footer">
                <button type="button" class="ai-modal-btn-cancel" style="min-height:44px;">取消</button>
                <button type="submit" class="ai-modal-btn-confirm" style="min-height:44px;">${upload ? '确认上传' : '下载 ZIP'}</button>
            </div>
        </form>
    `;
    const form = dialog.querySelector('form');
    const startField = form.elements.namedItem('start');
    const endField = form.elements.namedItem('end');
    const status = dialog.querySelector('[data-export-status]');
    const now = Date.now();
    startField.value = diagnosticDateInput(now - DIAGNOSTIC_DEFAULT_RANGE);
    endField.value = diagnosticDateInput(now);
    const submit = form.querySelector('[type="submit"]');
    let pendingUpload;
    form.addEventListener('input', () => { status.textContent = ''; pendingUpload = null; });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (submit.disabled) return;
        const start = new Date(startField.value).getTime(), end = new Date(endField.value).getTime() + 999;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
            status.textContent = '请填写有效时间，结束时间应等于或晚于开始时间。';
            endField.focus();
            return;
        }
        if (upload) {
            if (end - start > 7 * 24 * 60 * 60 * 1000) {
                status.textContent = '请选择 7 天以内的时段。';
                return;
            }
            submit.disabled = true;
            const imageField = form.elements.namedItem('images');
            startField.disabled = endField.disabled = imageField.disabled = true;
            try {
                let session = markerUploadSession();
                if (!session) {
                    status.textContent = '请在新标签页连接五加一账号。';
                    await connectMarkerAccount({ provision: false });
                    session = markerUploadSession();
                }
                if (!dialog.open || !session) return;
                status.textContent = '正在整理并上传诊断包…';
                if (!pendingUpload) {
                    const data = await diagnosticUploadBody(start, end, imageField.checked);
                    pendingUpload = { id: markerRandomID(), ...data };
                }
                if (!dialog.open) return;
                const sent = pendingUpload;
                const result = await markerServiceRequest('/v1/diagnostics', 'POST', session.token, JSON.stringify(sent));
                if (result?.receipt !== sent.id) throw Error('Missing upload receipt');
                dialog.close();
                showToast('诊断包已上传' + (sent.images.length ? '，包含 ' + sent.images.length + ' 张答卷图片' : ''));
            } catch (error) {
                if (error?.status === 401) GM_deleteValue(MARKER_UPLOAD_SESSION);
                status.textContent = error?.status === 413 ? '诊断包超出大小限制，请缩短时段后重试。'
                    : '上传暂未完成，请重试。';
            } finally {
                submit.disabled = false;
                startField.disabled = endField.disabled = imageField.disabled = false;
            }
            return;
        }
        try {
            const result = exportDiagnosticPackage(start, end);
            dialog.close();
            showToast(`诊断包已下载（${result.logCount} 条日志，${result.recordCount} 条阅卷记录）`);
        } catch (error) {
            console.error('[诊断导出] 下载失败:', error);
            status.textContent = '下载暂未完成，请重试。';
        }
    });
    dialog.querySelector('.ai-modal-btn-cancel').onclick = () => dialog.close();
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    getUIRoot().appendChild(dialog);
    dialog.showModal();
}

if (window === window.top && typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('导出诊断包', () => showDiagnosticExport());
    GM_registerMenuCommand('上传诊断包', () => showDiagnosticExport(true));
}
