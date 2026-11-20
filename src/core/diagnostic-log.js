function diagnosticModelId(value, apiKey) {
    if (typeof value !== 'string' || value === apiKey || /^(?:sk-|eyJ[A-Za-z0-9_-]+\.)/.test(value)) return undefined;
    return /^[A-Za-z0-9][A-Za-z0-9_.:/@+~-]{0,159}$/.test(value) && !value.includes('://') ? value : undefined;
}

// 诊断包用于排查，保留业务内容和错误上下文，凭证在写日志前过滤。
function diagnosticSnapshot(input, { limit = Infinity, depth = Infinity, secrets = [], omitImageData = false } = {}) {
    const credentialField = /^(?:(?:x[-_]?)?(?:api[-_]?key|auth[-_]?token)|(?:access|refresh|id|session|security)[-_]?token|authorization|proxy[-_]?authorization|(?:set[-_]?)?cookie|password|passwd|client[-_]?secret|private[-_]?key|secret|token|signature|session[-_]?id|jsessionid|phpsessid|sid|sig|credential|policy|x[-_](?:amz|oss|goog|cos)[-_].+)$/i;
    const seen = new WeakSet();
    function redact(text) {
        for (const secret of secrets) if (secret) text = text.split(secret).join('[凭证]');
        return text.replace(/("([^"\\\r\n]+)"\s*:\s*)"((?:\\.|[^"\\\r\n])*)"/g, (field, prefix, key) =>
            credentialField.test(key) ? prefix + '"[凭证]"' : field)
            .replace(/(^|\r?\n)([A-Za-z][\w-]*):[^\r\n]*/g, (field, prefix, key) =>
                credentialField.test(key) ? prefix + key + ': [凭证]' : field)
            .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]+/gi, '$1 [凭证]')
            .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[凭证]')
            .replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[凭证]')
            .replace(/(https?:\/\/)[^\s\/?#@]+@/gi, '$1')
            .replace(/([?&#])([^\s=?&#"'<>]+)=([^\s&#"'<>]*)/g, (field, prefix, key) => {
                try { return credentialField.test(decodeURIComponent(key)) ? prefix + key + '=[凭证]' : field; }
                catch (_) { return field; }
            });
    }
    function visit(value, level) {
        if (limit <= 0 || level < 0) return '[内容已截取]';
        if (typeof value === 'string') {
            if (omitImageData && /^data:image\/[^,]+;base64,/i.test(value)) return { imageDataLength: value.length };
            // 过滤采用原值，防止凭证跨越截断位置时留下片段。
            const clean = redact(value);
            const clipped = clean.slice(0, limit);
            limit -= clipped.length;
            return clipped.length === clean.length ? clipped : clipped + '…[内容已截取]';
        }
        limit -= 16;
        if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
        if (typeof value === 'bigint') return String(value);
        if (typeof value !== 'object') return undefined;
        if (seen.has(value)) return '[循环引用]';
        seen.add(value);
        let snapshot;
        if (value instanceof Error) {
            snapshot = visit({ name: value.name, message: value.message, stack: value.stack,
                code: value.code, status: value.status, cause: value.cause }, level - 1);
        } else if (Array.isArray(value)) {
            snapshot = [];
            for (const item of value) {
                snapshot.push(visit(item, level - 1));
                if (limit <= 0) break;
            }
        } else {
            const prototype = Object.getPrototypeOf(value);
            if (prototype && prototype !== Object.prototype && Object.getPrototypeOf(prototype) !== null) {
                seen.delete(value);
                return Object.prototype.toString.call(value);
            }
            snapshot = Object.create(null);
            for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
                if ('value' in descriptor && !credentialField.test(key)) snapshot[redact(key)] = visit(descriptor.value, level - 1);
                if (limit <= 0) break;
            }
        }
        seen.delete(value);
        return snapshot;
    }
    return visit(input, depth);
}

function diagnosticSecrets() {
    try {
        return [...new Set([
            ...Object.values(ProviderManager.data?.providers || {}),
            ...Object.values(PresetManager.data?.list || {}),
        ].map(value => value?.apiKey).filter(value => typeof value === 'string' && value.length >= 4))];
    } catch (_) {
        return [];
    }
}

const DiagnosticLog = (() => {
    const prefix = 'ai-marker-diagnostic-log-v1-';
    const chunkLimit = 160;
    const chunkSpan = 20 * 60 * 1000;
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    const maxChunks = 192;
    const session = Math.random().toString(36).slice(2);
    let traceSequence = 0;
    const localChunks = new Map();
    let active, timer, storageLimited = false, nextPrune = 0;
    const storageSupported = typeof GM_listValues === 'function' && typeof GM_setValue === 'function';

    function storedKeys() {
        return GM_listValues().filter(key => key.startsWith(prefix) && /^\d{13}-[a-z\d]+-\d+$/.test(key.slice(prefix.length)))
            .sort();
    }

    function prune(now) {
        if (now < nextPrune || typeof GM_deleteValue !== 'function') return;
        nextPrune = now + 60 * 1000;
        const keys = storedKeys();
        const cutoff = now - maxAge - chunkSpan;
        keys.forEach((key, index) => {
            if (!localChunks.has(key) && (Number(key.slice(prefix.length, prefix.length + 13)) < cutoff
                || index < keys.length - maxChunks)) GM_deleteValue(key);
        });
    }

    function flush() {
        clearTimeout(timer);
        timer = undefined;
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

    function capture(level, source, message, args = [], details) {
        const at = Date.now();
        if (!active || active.entries.length === chunkLimit || at - active.started >= chunkSpan) {
            const sequence = (active?.sequence ?? -1) + 1;
            const previous = active;
            active = { started: at, sequence, entries: [], saved: 0 };
            if (previous) flush();
            localChunks.set(prefix + at + '-' + session + '-' + sequence, active);
            if (localChunks.size > 8) {
                localChunks.delete(localChunks.keys().next().value);
                storageLimited = true;
            }
        }
        const entry = { at, level, source, message, session, site: window.location.hostname, version: DIAGNOSTIC_SCRIPT_VERSION };
        const secrets = diagnosticSecrets();
        entry.page = diagnosticSnapshot(window.location.href, { limit: 4096, secrets });
        entry.frame = window === window.top ? 'top' : 'embedded';
        if (details) entry.details = diagnosticSnapshot(details, { limit: 40000, depth: 8, secrets, omitImageData: true });
        if (args.length) {
            entry.args = diagnosticSnapshot(args, { limit: 8000, depth: 5, secrets, omitImageData: true });
            if (typeof entry.args[0] === 'string' && entry.args[0]) entry.message = entry.args[0].slice(0, 800);
        }
        const adapter = window.__AI_MARKER_ADAPTER__?.id;
        if (typeof adapter === 'string' && /^[a-z\d-]{1,40}$/.test(adapter)) entry.platform = adapter;
        for (const value of args) {
            if (!(value instanceof Error)) continue;
            if (['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'AbortError', 'NetworkError'].includes(value.name)) {
                entry.errorType = value.name;
            }
            if (Number.isInteger(value.status) && value.status >= 100 && value.status <= 599) entry.httpStatus = value.status;
            break;
        }
        active.entries.push(entry);
        if (storageSupported && timer === undefined) timer = setTimeout(flush, 1000);
    }

    function read(start, end) {
        flush();
        const chunks = new Map();
        const floor = Date.now() - maxAge;
        if (storageSupported) {
            try {
                for (const key of storedKeys().slice(-maxChunks)) {
                    const chunkStart = Number(key.slice(prefix.length, prefix.length + 13));
                    if (chunkStart <= end && chunkStart + chunkSpan >= Math.max(floor, start)) {
                        const entries = GM_getValue(key, []);
                        if (Array.isArray(entries)) chunks.set(key, entries);
                    }
                }
            } catch (_) {
                storageLimited = true;
            }
        }
        for (const [key, chunk] of localChunks) chunks.set(key, chunk.entries);
        const entries = Array.from(chunks.values()).flat()
            .filter(entry => entry?.at >= Math.max(start, floor) && entry.at <= end)
            .sort((a, b) => a.at - b.at);
        return { entries, storageLimited: !storageSupported || storageLimited, retentionDays: 7 };
    }

    // Persist before navigating away. Only this script's logging calls are collected.
    window.addEventListener?.('pagehide', flush);
    document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    const ownScript = /(?:AI-Marker-Suite|ai_marker|zhixue_ai_marking)\.user\.js/i;
    window.addEventListener?.('error', event => {
        if (!ownScript.test(event.filename || '')) return;
        try { capture('error', 'userscript', '脚本执行错误', [event.error]); } catch (_) {}
    });
    function record(source, message, details) {
        try { capture('log', source, message, [], details); } catch (_) { /* 诊断存储不影响正常阅卷。 */ }
    }

    function endpointHost(value) {
        try {
            const url = new URL(value);
            if (url.protocol === 'https:' || url.protocol === 'http:') return url.host;
        } catch (_) { /* 无可记录的端点。 */ }
    }

    return {
        read,
        record,
        traceId() {
            return session + '-' + ++traceSequence;
        },
        request(callId, config, body) {
            const attemptId = this.traceId();
            const startedAt = Date.now();
            const request = {
                callId, attemptId, model: diagnosticModelId(config.model, config.apiKey),
                endpoint: endpointHost(config.endpoint),
            };
            record('core/ai-engine.js', '发出模型请求', {
                ...request, gradingId: config.diagnosticGradingId,
                url: config.endpoint, maxOutputTokens: body.max_tokens ?? null, body,
                reasoningEffort: ['', 'disabled', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(config.reasoningEffort)
                    ? config.reasoningEffort : undefined,
            });
            let requestId, httpStatus, statusText, responseUrl, responseHeaders;
            return {
                response(res) {
                    const headers = typeof res.responseHeaders === 'string' ? res.responseHeaders : '';
                    const id = /^x-oneapi-request-id:[ \t]*([A-Za-z0-9_:-]{1,64})[ \t]*\r?$/im.exec(headers)?.[1];
                    if (id && id !== config.apiKey) requestId = id;
                    if (headers) responseHeaders = Object.fromEntries(headers.split(/\r?\n/).flatMap(line => {
                        const separator = line.indexOf(':');
                        return separator > 0 ? [[line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()]] : [];
                    }));
                    statusText = res.statusText ?? statusText;
                    responseUrl = res.finalUrl ?? responseUrl;
                    if (Number.isInteger(res.status) && res.status >= 100 && res.status <= 599) httpStatus = res.status;
                },
                finish(outcome, usage, responseText) {
                    const tokens = Object.fromEntries(Object.entries({
                        inputTokens: usage?.prompt_tokens,
                        outputTokens: usage?.completion_tokens,
                        cachedTokens: usage?.prompt_tokens_details?.cached_tokens,
                    }).filter(([, value]) => Number.isSafeInteger(value) && value >= 0));
                    record('core/ai-engine.js', '模型请求结束', {
                        ...request, gradingId: config.diagnosticGradingId, requestId, httpStatus, outcome,
                        durationMs: Date.now() - startedAt, statusText, responseUrl, ...tokens, usage, responseHeaders, responseText,
                    });
                },
            };
        },
        write(level, source, message, ...args) {
            try { capture(level, source, message, args); } catch (_) { /* 诊断存储不影响正常阅卷。 */ }
            return console[level](...args);
        },
    };
})();
