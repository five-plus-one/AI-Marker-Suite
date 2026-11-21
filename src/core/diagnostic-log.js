const DiagnosticLog = (() => {
    const session = Math.random().toString(36).slice(2);
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    const storageSupported = typeof GM_listValues === 'function' && typeof GM_setValue === 'function';
    const runIds = new WeakMap();
    let runSequence = 0;

    function createJournal(prefix, maxChunks, chunkLimit, deferWrites = false) {
        const chunkSpan = 20 * 60 * 1000;
        const prunedKey = prefix + 'pruned-through';
        const localChunks = new Map();
        let active, timer, storageLimited = false, nextPrune = 0, urgent = false;

        function storedKeys() {
            return GM_listValues().filter(key => key.startsWith(prefix) && /^\d{13}-[a-z\d]+-\d+$/.test(key.slice(prefix.length)))
                .sort();
        }

        function chunkTime(key) {
            return Number(key.slice(prefix.length, prefix.length + 13));
        }

        function prune(now) {
            if (now < nextPrune || typeof GM_deleteValue !== 'function') return;
            nextPrune = now + 60 * 1000;
            const keys = storedKeys();
            let prunedThrough = GM_getValue(prunedKey, 0);
            for (const [index, key] of keys.entries()) {
                if (localChunks.has(key)) continue;
                const expired = chunkTime(key) + chunkSpan < now - maxAge;
                if (!expired && index >= keys.length - maxChunks) continue;
                if (!expired) {
                    const removed = GM_getValue(key, []);
                    prunedThrough = Math.max(prunedThrough, removed.at(-1)?.at || chunkTime(key));
                    GM_setValue(prunedKey, prunedThrough);
                }
                GM_deleteValue(key);
            }
        }

        function flush() {
            clearTimeout(timer);
            timer = undefined;
            urgent = false;
            if (!storageSupported || !localChunks.size) return;
            try {
                for (const [key, chunk] of localChunks) {
                    if (chunk.saved !== chunk.entries.length) {
                        GM_setValue(key, chunk.entries);
                        chunk.saved = chunk.entries.length;
                    }
                    if (chunk !== active) localChunks.delete(key);
                }
                prune(Date.now());
            } catch (_) {
                storageLimited = true;
            }
        }

        function append(entry, persist = false) {
            const at = entry.at;
            if (!active || active.entries.length === chunkLimit || at - active.started >= chunkSpan) {
                const previous = active;
                active = { started: at, sequence: (previous?.sequence ?? -1) + 1, entries: [], saved: 0 };
                if (previous && !deferWrites) flush();
                localChunks.set(prefix + at + '-' + session + '-' + active.sequence, active);
                if (localChunks.size > 8) {
                    localChunks.delete(localChunks.keys().next().value);
                    storageLimited = true;
                }
            }
            active.entries.push(entry);
            if (!storageSupported) return;
            if (persist && !urgent) {
                clearTimeout(timer);
                urgent = true;
                timer = setTimeout(flush, 0);
            } else if (timer === undefined) {
                timer = setTimeout(flush, 1000);
            }
        }

        function read(start, end) {
            flush();
            const chunks = new Map();
            const floor = Date.now() - maxAge;
            const from = Math.max(start, floor);
            let prunedThrough = 0;
            if (storageSupported) {
                try {
                    prunedThrough = GM_getValue(prunedKey, 0);
                    for (const key of storedKeys()) {
                        if (chunkTime(key) <= end && chunkTime(key) + chunkSpan >= from) {
                            const entries = GM_getValue(key, []);
                            if (Array.isArray(entries)) chunks.set(key, entries);
                        }
                    }
                } catch (_) {
                    storageLimited = true;
                }
            }
            for (const [key, chunk] of localChunks) chunks.set(key, chunk.entries);
            const entries = [...chunks.values()].flat().filter(entry => entry?.at >= from && entry.at <= end)
                .sort((a, b) => a.at - b.at);
            return {
                entries,
                coverage: {
                    firstAt: entries[0]?.at ?? null,
                    lastAt: entries.at(-1)?.at ?? null,
                    expiredBefore: start < floor ? floor : null,
                    prunedThrough: prunedThrough >= from ? prunedThrough : null,
                    storageLimited: !storageSupported || storageLimited,
                },
            };
        }

        return { append, flush, read };
    }

    const consoleJournal = createJournal('ai-marker-diagnostic-log-v1-', 192, 160);
    const gradingJournal = createJournal('ai-marker-diagnostic-grading-v1-', 512, 240, true);

    function identity() {
        const entry = { at: Date.now(), site: window.location.hostname, version: DIAGNOSTIC_SCRIPT_VERSION };
        const adapter = window.__AI_MARKER_ADAPTER__?.id;
        if (typeof adapter === 'string' && /^[a-z\d-]{1,40}$/.test(adapter)) entry.platform = adapter;
        return entry;
    }

    function errorFields(error) {
        const fields = {};
        if (['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'AbortError', 'NetworkError',
            'InvalidStateError', 'NotFoundError', 'QuotaExceededError', 'DataError'].includes(error?.name)) {
            fields.errorType = error.name;
        }
        if (Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599) fields.httpStatus = error.status;
        if (['GRADING_CONTEXT_CHANGED', 'QUESTION_CONTEXT_CHANGED', 'OUTPUT_TRUNCATED', 'ECONNRESET', 'ETIMEDOUT'].includes(error?.code)) {
            fields.errorCode = error.code;
        }
        if (['请求超时', '网络请求被拦截，请检查跨域权限', '图片下载超时', '答卷已切换，请核对后重新批改',
            '当前题目已变化，请核对后重新批改', 'AI响应未完整结束，请检查网络后继续批改',
            'AI未返回可用内容，请检查模型输出设置', 'AI未返回可识别的分数，请检查模型回答后继续批改'].includes(error?.message)) {
            fields.errorMessage = error.message;
        }
        return fields;
    }

    // 只保留来源明确、值域受限的实际日志文本。其他 console 参数仍由浏览器原样接收。
    const safeRenderedLogs = {
        'core/main.js': [
            /^📊 \[诊断\] updateBatchProgress — 已批阅: \d+\/\d+$/,
            /^📊 \[批阅份数\] 已批阅: \d+\/\d+$/,
            /^📊 \[批阅份数\] 已启用，目标: \d+，当前: \d+$/,
            /^🖼️ \[诊断\] 找到答题卡图片数量: \d+$/,
            /^📊 \[诊断\] callAIGrading 返回 — score: -?\d+(?:\.\d+)?, comment长度: \d+字$/,
        ],
        'core/ui-submit-dialog.js': [
            /^🪟 \[诊断\] showAutoSubmitDialog 调用 — 分数: -?\d+(?:\.\d+)?, 模式: (?:normal|unattended|trial), 双评: (?:true|false|有|无)$/,
        ],
        'adapters/zhixue/adapter.js': [
            /^📋 \[诊断\] (?:旧版|新版)小题输入框: \d+ 个 \(在(?:iframe|主页面)\)$/,
        ],
        'core/ai-engine.js': [
            /^✅ \[诊断\] onload 触发 — HTTP状态: \d+, onprogress累计触发次数: \d+, 响应长度: \d+ 字节$/,
        ],
    };

    function capture(level, source, message, args = []) {
        const error = args.find(value => value instanceof Error);
        const rendered = args[0];
        const file = source.replace(/:\d+$/, '');
        if (typeof rendered === 'string' && safeRenderedLogs[file]?.some(pattern => pattern.test(rendered))) message = rendered;
        consoleJournal.append({ ...identity(), level, source, message, ...errorFields(error) });
    }

    function grading(event, context, details, { persist = false, error } = {}) {
        try {
            let run;
            if (context) {
                if (!runIds.has(context)) runIds.set(context, ++runSequence);
                run = runIds.get(context);
            }
            gradingJournal.append({ ...identity(), session, run, event, details, ...errorFields(error) }, persist);
        } catch (_) { /* 采集失败不影响阅卷。 */ }
    }

    function flush() {
        consoleJournal.flush();
        gradingJournal.flush();
    }

    function lifecycle(event) {
        const state = window.aiGradingState;
        if (!state?.activeRun && !state?.isRunning && !state?.isPaused
            && !(window.__AI_MARKER_ADAPTER__ && (event.persisted || document.wasDiscarded))) return;
        grading('page-lifecycle', state?.activeRun, {
            transition: event.type, visibility: document.visibilityState, online: navigator.onLine,
            persisted: event.persisted, wasDiscarded: document.wasDiscarded,
        }, { persist: true });
    }

    for (const type of ['pagehide', 'pageshow', 'online', 'offline']) window.addEventListener?.(type, lifecycle);
    for (const type of ['visibilitychange', 'freeze', 'resume']) document.addEventListener?.(type, lifecycle);

    // Persist before navigating away. Only this script's logging calls are collected.
    window.addEventListener?.('pagehide', flush);
    document.addEventListener?.('freeze', flush);
    document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    const ownScript = /(?:AI-Marker-Suite|ai_marker|zhixue_ai_marking)\.user\.js/i;
    window.addEventListener?.('error', event => {
        if (!ownScript.test(event.filename || '')) return;
        try { capture('error', 'userscript', '脚本执行错误', [event.error]); } catch (_) {}
    });
    return {
        grading,
        read(start, end) {
            const logs = consoleJournal.read(start, end);
            const grading = gradingJournal.read(start, end);
            return {
                entries: logs.entries, gradingEvents: grading.entries,
                coverage: { console: logs.coverage, grading: grading.coverage },
                storageLimited: logs.coverage.storageLimited || grading.coverage.storageLimited,
                retentionDays: 7,
            };
        },
        write(level, source, message, ...args) {
            try { capture(level, source, message, args); } catch (_) { /* 诊断存储不影响正常阅卷。 */ }
            return console[level](...args);
        },
    };
})();
