function diagnosticModelId(value, apiKey) {
    if (typeof value !== 'string' || value === apiKey || /^(?:sk-|eyJ[A-Za-z0-9_-]+\.)/.test(value)) return undefined;
    return /^[A-Za-z0-9][A-Za-z0-9_.:/@+~-]{0,159}$/.test(value) && !value.includes('://') ? value : undefined;
}

// 诊断包用于排查，保留业务内容和错误上下文，凭证在写日志前过滤。
function diagnosticSnapshot(input, { limit = Infinity, depth = Infinity, secrets = [], omitImageData = false } = {}) {
    const credentialField = /^(?:(?:x[-_]?)?(?:api[-_]?key|auth[-_]?token)|(?:access|refresh|id|session|security)[-_]?token|authorization|proxy[-_]?authorization|(?:proxy[-_]?)?authentication[-_]?info|(?:www|proxy)[-_]?authenticate|x[-_](?:access[-_]?token|auth|secret|session[-_]?token)|auth|key|access[-_]?key(?:[-_]?id)?|ossaccesskeyid|q[-_](?:ak|signature|security[-_]?token)|(?:set[-_]?)?cookie|password|passwd|client[-_]?secret|private[-_]?key|secret|token|signature|session[-_]?id|jsessionid|phpsessid|sid|sig|credential|policy|x[-_](?:amz|oss|goog|cos)[-_].+)$/i;
    const seen = new WeakSet();
    function redact(text) {
        for (const secret of secrets) {
            const encoded = encodeURIComponent(secret);
            text = text.split(secret).join('[凭证]');
            if (encoded !== secret) text = text.split(encoded).join('[凭证]');
        }
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
    const session = Math.random().toString(36).slice(2);
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    const chunkSpan = 20 * 60 * 1000;
    const legacyBudget = 512 * 1024;
    // Fixed keys cap the sum even when several tabs pick a slot concurrently.
    const slotBudget = 128 * 1024 - 128;
    const slotKeys = Array.from({ length: 28 }, (_, index) => 'ai-marker-diagnostic-v2-slot-' + index);
    const prefixes = { console: 'ai-marker-diagnostic-log-v1-', grading: 'ai-marker-diagnostic-grading-v1-' };
    const chunkLimits = { console: 192, grading: 512 };
    const storageSupported = typeof GM_listValues === 'function' && typeof GM_getValue === 'function'
        && typeof GM_setValue === 'function' && typeof GM_deleteValue === 'function';
    const runIds = new WeakMap();
    let runSequence = 0;
    let traceSequence = 0;
    let encoder;

    function encodedBytes(value) {
        encoder ||= new TextEncoder();
        return encoder.encode(value).byteLength;
    }

    // Count the value with the extra escaping used by userscript storage exports.
    function storedBytes(key, value) {
        return encodedBytes(JSON.stringify({ [key]: 'o' + JSON.stringify(value) }));
    }

    function legacyKeys(journal, keys = GM_listValues()) {
        const prefix = prefixes[journal];
        return keys.filter(key => key.startsWith(prefix) && /^\d{13}-[a-z\d]+-\d+$/.test(key.slice(prefix.length))).sort();
    }

    function lastAt(entries, fallback = 0) {
        const value = entries.at(-1)?.at;
        return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
    }

    function notePruned(journal, at) {
        const key = prefixes[journal] + 'pruned-through';
        GM_setValue(key, Math.max(Number(GM_getValue(key, 0)) || 0, at));
    }

    function trimLegacy(now) {
        const keys = GM_listValues();
        const remaining = [];
        const pruned = { console: 0, grading: 0 };
        let bytes = 0;
        for (const journal of Object.keys(prefixes)) {
            const logs = legacyKeys(journal, keys);
            for (const [index, key] of logs.entries()) {
                const at = Number(key.slice(prefixes[journal].length, prefixes[journal].length + 13));
                if (at + chunkSpan < now - maxAge) {
                    GM_deleteValue(key);
                    continue;
                }
                const value = GM_getValue(key, []);
                const end = Array.isArray(value) ? lastAt(value, at) : at;
                if (index < logs.length - chunkLimits[journal]) {
                    GM_deleteValue(key);
                    pruned[journal] = Math.max(pruned[journal], end);
                    continue;
                }
                const size = storedBytes(key, value);
                bytes += size;
                remaining.push({ key, journal, end, size });
            }
        }
        if (bytes > legacyBudget) {
            remaining.sort((a, b) => a.end - b.end || a.key.localeCompare(b.key));
            for (const row of remaining) {
                if (bytes <= legacyBudget) break;
                GM_deleteValue(row.key);
                bytes -= row.size;
                pruned[row.journal] = Math.max(pruned[row.journal], row.end);
            }
        }
        for (const [journal, at] of Object.entries(pruned)) {
            if (at) notePruned(journal, at);
        }
    }

    function readSlot(key) {
        const data = GM_getValue(key, null);
        return data && Object.hasOwn(prefixes, data.journal) && Array.isArray(data.entries) ? data : null;
    }

    function findSlot(end, now) {
        let oldest;
        for (const key of slotKeys) {
            const current = readSlot(key);
            if (!current || lastAt(current.entries) < now - maxAge) return { key };
            const at = lastAt(current.entries);
            if (!oldest || at < oldest.at) oldest = { key, journal: current.journal, at };
        }
        return oldest && oldest.at <= end ? oldest : null;
    }

    function createJournal(journal, chunkLimit, deferWrites = false) {
        const prefix = prefixes[journal];
        const localChunks = new Map();
        let active, timer, storageLimited = false, urgent = false, sequence = 0;

        function flush() {
            clearTimeout(timer);
            timer = undefined;
            urgent = false;
            if (!storageSupported) return;
            try {
                const now = Date.now();
                trimLegacy(now);
                for (const [id, chunk] of localChunks) {
                    // A different page can evict our slot. Never write back entries already pruned.
                    if (chunk.key && readSlot(chunk.key)?.id !== id) {
                        chunk.key = undefined;
                        chunk.entries = chunk.entries.slice(chunk.saved);
                        chunk.saved = 0;
                        if (!chunk.entries.length) {
                            localChunks.delete(id);
                            if (chunk === active) active = undefined;
                            continue;
                        }
                    }
                    if (chunk.saved !== chunk.entries.length) {
                        const end = lastAt(chunk.entries);
                        const slot = chunk.key ? { key: chunk.key } : findSlot(end, now);
                        const value = { id, journal, entries: chunk.entries };
                        if (!slot || storedBytes(slot.key, value) > slotBudget) {
                            storageLimited = true;
                            continue;
                        }
                        GM_setValue(slot.key, value);
                        chunk.key = slot.key;
                        chunk.saved = chunk.entries.length;
                        if (slot.journal) notePruned(slot.journal, slot.at);
                    }
                    if (chunk !== active) localChunks.delete(id);
                }
            } catch (_) {
                storageLimited = true;
            }
        }

        function append(entry, persist = false) {
            const at = entry.at;
            // The full encoded slot is checked again immediately before every write.
            const bytes = encodedBytes(JSON.stringify(JSON.stringify(entry)).slice(1, -1)) + 1;
            if (bytes > slotBudget - 512) {
                storageLimited = true;
                return;
            }
            if (!active || active.entries.length >= chunkLimit || at - active.started >= chunkSpan
                || active.bytes + bytes > slotBudget - 512) {
                const previous = active;
                if (previous && !deferWrites) flush();
                active = { started: at, entries: [], saved: 0, bytes: 0 };
                localChunks.set(at + '-' + session + '-' + sequence++, active);
                if (localChunks.size > 8) {
                    localChunks.delete(localChunks.keys().next().value);
                    storageLimited = true;
                }
            }
            active.entries.push(entry);
            active.bytes += bytes;
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
                    prunedThrough = GM_getValue(prefix + 'pruned-through', 0);
                    for (const key of legacyKeys(journal)) {
                        const at = Number(key.slice(prefix.length, prefix.length + 13));
                        if (at <= end && at + chunkSpan >= from) {
                            const entries = GM_getValue(key, []);
                            if (Array.isArray(entries)) chunks.set(key, entries);
                        }
                    }
                    for (const key of slotKeys) {
                        const slot = readSlot(key);
                        if (slot?.journal === journal) chunks.set(slot.id, slot.entries);
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

    const consoleJournal = createJournal('console', 160);
    const gradingJournal = createJournal('grading', 240, true);

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

    function capture(level, source, message, args = [], details) {
        const entry = { ...identity(), level, source, message, sourceMessage: message, session };
        const secrets = diagnosticSecrets();
        entry.page = diagnosticSnapshot(window.location.href, { limit: 4096, secrets });
        entry.frame = window === window.top ? 'top' : 'embedded';
        if (details) entry.details = diagnosticSnapshot(details, { limit: 40000, depth: 8, secrets, omitImageData: true });
        if (args.length) {
            entry.args = diagnosticSnapshot(args, { limit: 8000, depth: 5, secrets, omitImageData: true });
            if (typeof entry.args[0] === 'string' && entry.args[0]) entry.message = entry.args[0].slice(0, 800);
        }
        consoleJournal.append({ ...entry, ...errorFields(args.find(value => value instanceof Error)) });
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
