const DiagnosticLog = (() => {
    const prefix = 'ai-marker-diagnostic-log-v1-';
    const chunkLimit = 160;
    const chunkSpan = 20 * 60 * 1000;
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    const maxChunks = 192;
    const session = Math.random().toString(36).slice(2);
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

    function capture(level, source, message, args = []) {
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
        const entry = { at, level, source, message, site: window.location.hostname, version: DIAGNOSTIC_SCRIPT_VERSION };
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
    return {
        read,
        write(level, source, message, ...args) {
            try { capture(level, source, message, args); } catch (_) { /* 诊断存储不影响正常阅卷。 */ }
            return console[level](...args);
        },
    };
})();
