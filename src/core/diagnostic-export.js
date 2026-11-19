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

function diagnosticRecords(records, presetNames) {
    return records.map(record => ({
            ...diagnosticFields(record, ['timestamp', 'aiScore', 'finalScore', 'isCorrected', 'diligenceBonus', 'durationMs', 'pacingDelayMs']),
            preset: presetNames.indexOf(record.presetName) + 1 || undefined,
            status: diagnosticChoice(record.status, ['submitted', 'marked', 'pending']),
            reviewStatus: diagnosticChoice(record.reviewStatus, ['pending', 'reviewed']),
            gradingMode: diagnosticChoice(record.gradingMode, ['normal', 'trial', 'unattended']),
            outputMode: diagnosticChoice(record.outputMode, ['detailed', 'score-only']),
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
    const records = diagnosticRecords(orderedHistory, Object.keys(PresetManager.data?.list || {}));
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

function diagnosticImageBytes(value) {
    if (typeof value !== 'string') return '';
    const bytes = value.replace(/^data:image\/(?:jpeg|png|gif|webp);base64,/i, '');
    return bytes.length <= 5_592_408 && /^(?:\/9j\/|iVBOR|R0lGOD|UklGR)[A-Za-z0-9+/]*={0,2}$/.test(bytes) ? bytes : '';
}

async function* diagnosticImages(records) {
    const adapter = window.__AI_MARKER_ADAPTER__;
    const paused = () => !window.aiGradingState?.isRunning && !window.aiGradingState?.activeRun;
    if (paused() && adapter?.isMarkingPage?.() && adapter.getPaperIdentity && adapter.fetchImageAsBase64) {
        try {
            const paper = adapter.getPaperIdentity();
            const urls = paper ? await adapter.gatherAnswerImages() : [];
            for (const [position, url] of urls.entries()) {
                if (!paused() || adapter.getPaperIdentity() !== paper) break;
                let image;
                try { image = await adapter.fetchImageAsBase64(url, AbortSignal.timeout(12000)); } catch (_) {}
                if (!paused() || adapter.getPaperIdentity() !== paper) break;
                const bytes = diagnosticImageBytes(image);
                if (bytes) yield { record: -1, position, bytes };
            }
        } catch (_) { /* The history is still available when the current paper has changed. */ }
    }
    for (const [index, record] of records.entries()) {
        let saved = record.imageBase64s;
        if (!saved?.length && record.id && ImageStore.getImageStatus(record.id).status === 'local') {
            try { saved = await ImageStore.get(record.id); } catch (_) {}
        }
        if (!saved?.length) saved = Array.isArray(record.imageUrls) ? record.imageUrls : [];
        for (const [position, image] of (Array.isArray(saved) ? saved : []).entries()) {
            let bytes = diagnosticImageBytes(image);
            if (!bytes && typeof image === 'string' && adapter?.id === 'eiduo' && adapter.fetchImageAsBase64) {
                try {
                    const url = new URL(image, location.href);
                    if (url.protocol === 'https:' && url.hostname === 'eiduo-online.oss-cn-hangzhou.aliyuncs.com') {
                        bytes = diagnosticImageBytes(await adapter.fetchImageAsBase64(url.href, AbortSignal.timeout(12000)));
                    }
                } catch (_) { /* Signed images can expire before a report is prepared. */ }
            }
            if (bytes) yield { record: index, position, bytes };
        }
    }
}

function diagnosticUploadBody(data, description) {
    const logs = data.entries.map(entry => ({
        at: entry.at,
        level: entry.level,
        source: typeof entry.source === 'string' ? entry.source.slice(0, 45) : '',
        message: typeof entry.message === 'string' ? Array.from(entry.message).slice(0, 240).join('') : '',
        platform: entry.platform,
        version: entry.version,
        errorType: entry.errorType,
        httpStatus: entry.httpStatus,
    }));
    return {
        version: data.metadata.scriptVersion, platform: data.metadata.platform, browser: data.metadata.browser,
        start: data.metadata.range.start, end: data.metadata.range.end,
        description, logs, records: data.records, configuration: data.configuration, attachments: [],
    };
}

function showDiagnosticReceipt(dialog, receipt) {
    const field = dialog.querySelector('[data-diagnostic-receipt]');
    field.hidden = false;
    const text = field.querySelector('textarea');
    text.value = '问题编号 ' + receipt.code + '\n' + receipt.url;
    const copy = dialog.querySelector('[data-diagnostic-copy]');
    copy.hidden = false;
    copy.onclick = async () => {
        try {
            if (typeof GM_setClipboard === 'function') GM_setClipboard(text.value, 'text');
            else await navigator.clipboard.writeText(text.value);
            field.querySelector('[role="status"]').textContent = '已复制';
        } catch (_) {
            text.focus();
            text.select();
            field.querySelector('[role="status"]').textContent = '请复制已选文字。';
        }
    };
    dialog.querySelector('[data-diagnostic-fields]').hidden = true;
    dialog.querySelector('[type="submit"]').hidden = true;
    dialog.querySelector('#ai-diagnostic-title').textContent = '诊断包已上传';
    dialog.querySelector('.ai-modal-btn-cancel').textContent = '关闭';
    copy.focus();
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
    styleNativeModal(dialog);
    dialog.setAttribute('aria-labelledby', 'ai-diagnostic-title');
    dialog.innerHTML = `
        <form>
            <div class="ai-modal-header"><h2 id="ai-diagnostic-title">${upload ? '上传诊断包' : '导出诊断包'}</h2></div>
            <div class="ai-modal-body" data-diagnostic-fields>
                <p>${upload ? '把日志、阅卷记录、可取得的答题卡图片和当前配置发送给管理员。'
                    : '将日志、阅卷记录和配置摘要下载为 ZIP。'}</p>
                <details data-diagnostic-range>
                    <summary>最近 2 小时 · 更改时间</summary>
                    <div class="ai-diagnostic-dates">
                        <label>开始时间<input class="ai-modal-input" name="start" type="datetime-local" step="1"></label>
                        <label>结束时间<input class="ai-modal-input" name="end" type="datetime-local" step="1"></label>
                    </div>
                </details>
                ${upload ? '<label class="ai-diagnostic-description">问题说明 <span class="ai-diagnostic-note">（选填）</span><textarea class="ai-modal-input" name="description" rows="3" maxlength="900" placeholder="例如：开始批改后，一直停在读取答题卡。"></textarea></label>' : ''}
                <p data-export-status role="status"></p>
            </div>
            ${upload ? '<div class="ai-modal-body" data-diagnostic-receipt hidden><p>把编号和查看网址发给五加一，方便定位问题。</p><label>编号和网址<textarea class="ai-modal-input" readonly rows="4"></textarea></label><p role="status"></p></div>' : ''}
            <div class="ai-modal-footer">
                <button type="button" class="ai-modal-btn-cancel">取消</button>
                <button type="submit" class="ai-modal-btn-confirm">${upload ? '确认上传' : '下载 ZIP'}</button>
                ${upload ? '<button type="button" data-diagnostic-copy class="ai-modal-btn-confirm" hidden>复制编号和网址</button>' : ''}
            </div>
        </form>
    `;
    const form = dialog.querySelector('form');
    const startField = form.elements.namedItem('start');
    const endField = form.elements.namedItem('end');
    const description = form.elements.namedItem('description');
    const range = dialog.querySelector('[data-diagnostic-range]');
    const status = dialog.querySelector('[data-export-status]');
    const now = Date.now();
    const defaultStart = diagnosticDateInput(now - DIAGNOSTIC_DEFAULT_RANGE);
    const defaultEnd = diagnosticDateInput(now);
    startField.value = defaultStart;
    endField.value = defaultEnd;
    form.addEventListener('input', () => {
        range.querySelector('summary').textContent = startField.value === defaultStart && endField.value === defaultEnd
            ? '最近 2 小时 · 更改时间' : '自选时间 · 更改时间';
    });
    const submit = form.querySelector('[type="submit"]');
    let pendingUpload;
    form.addEventListener('input', () => { status.textContent = ''; pendingUpload = null; });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (submit.disabled) return;
        const useRecent = upload && startField.value === defaultStart && endField.value === defaultEnd;
        const end = useRecent ? Date.now() : new Date(endField.value).getTime() + 999;
        const start = useRecent ? end - DIAGNOSTIC_DEFAULT_RANGE : new Date(startField.value).getTime();
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
            status.textContent = '请填写有效时间，结束时间应等于或晚于开始时间。';
            range.open = true;
            endField.focus();
            return;
        }
        if (upload) {
            const session = markerUploadSession();
            if (!session) {
                status.textContent = '请先在助手设置中连接五加一账号，再上传诊断包。';
                return;
            }
            if (end - start > 7 * 24 * 60 * 60 * 1000) {
                status.textContent = '请选择 7 天以内的时段。';
                range.open = true;
                return;
            }
            submit.disabled = true;
            startField.disabled = endField.disabled = description.disabled = true;
            try {
                status.textContent = '正在整理诊断资料…';
                if (!pendingUpload || pendingUpload.token !== session.token) {
                    const data = diagnosticPackageData(start, end);
                    pendingUpload = {
                        body: { id: markerRandomID(), ...diagnosticUploadBody(data, description.value.trim()) },
                        iterator: diagnosticImages(data.orderedHistory),
                        token: session.token,
                    };
                }
                const pending = pendingUpload;
                while (dialog.open && !pending.imagesDone) {
                    if (!pending.image) {
                        const next = await pending.iterator.next();
                        pending.imagesDone = next.done;
                        pending.image = next.value;
                    }
                    if (!dialog.open || pending.imagesDone) break;
                    status.textContent = '正在上传答题卡图片…';
                    const { record, position } = pending.image;
                    const attached = await markerServiceRequest('/v1/diagnostics/images', 'POST', pending.token,
                        JSON.stringify({ id: pending.body.id, ...pending.image }));
                    if (attached?.record !== record || attached.position !== position) throw Error('Missing image receipt');
                    pending.body.attachments.push({ record, position });
                    pending.image = null;
                }
                if (!dialog.open) return;
                status.textContent = '正在上传诊断包…';
                const result = await markerServiceRequest('/v1/diagnostics', 'POST', pending.token, JSON.stringify(pending.body));
                if (result?.receipt !== pending.body.id || !/^[a-f0-9]{40}$/.test(result.code || '') ||
                    result.url !== MARKER_TOOLS_ORIGIN + '/#diagnostic=' + result.code) throw Error('Missing upload receipt');
                if (dialog.open) showDiagnosticReceipt(dialog, result);
            } catch (error) {
                if (error?.status === 401 && markerUploadSession()?.token === session.token) GM_deleteValue(MARKER_UPLOAD_SESSION);
                if (error?.status === 401) status.textContent = '登录已过期，请重新连接五加一账号。';
                else if (error?.status === 413) status.textContent = '诊断包超出大小限制，请缩短时段后重试。';
                else if (error?.status === 429) status.textContent = '上传请求较多，请稍后重试。';
                else status.textContent = '上传暂未完成，请重试。';
            } finally {
                submit.disabled = false;
                startField.disabled = endField.disabled = description.disabled = false;
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
