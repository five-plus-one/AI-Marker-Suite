const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { instrumentDiagnosticLogs } = require('../scripts/instrument-diagnostic-logs.cjs');

const logger = fs.readFileSync(path.join(__dirname, '../src/core/diagnostic-log.js'), 'utf8');

function openPage(shared, at, hostname, { rejectWrites = false } = {}) {
    const shown = [], listeners = {}, timers = new Map();
    let nextTimer = 0;
    const context = vm.createContext({
        window: { location: { hostname }, addEventListener(type, listener) { listeners[type] = listener; } },
        document: { addEventListener() {} },
        DIAGNOSTIC_SCRIPT_VERSION: '1.21.27.9',
        Date: { now: () => at },
        console: { log: (...args) => shown.push(args), warn: (...args) => shown.push(args) },
        setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
        clearTimeout(id) { timers.delete(id); },
        GM_listValues: () => Array.from(shared.keys()),
        GM_getValue: (key, fallback) => shared.get(key) ?? fallback,
        GM_setValue: (key, value) => {
            if (rejectWrites) throw Error('Storage unavailable');
            shared.set(key, structuredClone(value));
        },
        GM_deleteValue: key => shared.delete(key),
    });
    vm.runInContext(logger, context);
    return {
        shown, listeners,
        flushTimers() { for (const { callback } of [...timers.values()]) callback(); },
        run(source, moduleName = 'core/test.js') { return vm.runInContext(instrumentDiagnosticLogs(source, moduleName), context); },
        read(start, end) { return structuredClone(vm.runInContext(`DiagnosticLog.read(${start}, ${end})`, context)); },
    };
}

test('stores diagnostic arguments and errors across tabs while filtering credentials', () => {
    const at = 1794997905708;
    const shared = new Map([['user-setting', 'preserved']]);
    const first = openPage(shared, at - 1000, 'mark.first.example');
    first.run('const answer = "private answer"; console.log(`已记录：${answer}`, { apiKey: "private key", link: "https://mark.example/paper?paperId=41&key=private-query-key&token=private-url-token&q-signature=private-cos-signature" });');
    first.listeners.pagehide();
    const second = openPage(shared, at, 'mark.second.example');
    second.run('console.warn("下载失败", Object.assign(new Error("private response"), { status: 403 }));');
    second.listeners.pagehide();
    const viewer = openPage(shared, at + 1000, 'tools.example');
    const entries = viewer.read(at - 1000, at).entries;
    assert.deepEqual(entries.map(row => row.level), ['log', 'warn']);
    assert.deepEqual(entries.map(row => row.site), ['mark.first.example', 'mark.second.example']);
    assert.equal(entries[0].message, '已记录：private answer');
    assert.equal(entries[1].httpStatus, 403);
    assert.equal(entries[1].version, '1.21.27.9');
    assert.equal(entries[0].args[0], '已记录：private answer');
    assert.equal(entries[0].args[1].apiKey, undefined);
    assert.equal(entries[0].args[1].link, 'https://mark.example/paper?paperId=41&key=[凭证]&token=[凭证]&q-signature=[凭证]');
    assert.equal(entries[1].args[1].message, 'private response');
    assert.match(entries[1].args[1].stack, /Error: private response/);
    assert.ok(!JSON.stringify([...shared]).includes('private key'));
    assert.equal(first.shown[0][0], '已记录：private answer');
    assert.equal(first.shown[0][1].apiKey, 'private key');
    assert.deepEqual(viewer.read(at, at).entries.map(row => row.level), ['warn']);
    assert.equal(shared.get('user-setting'), 'preserved');
});

test('retains grading events independently of console retention and reports the lost range', () => {
    const at = 1794997905708;
    const shared = new Map();
    for (let i = 0; i < 193; i++) {
        const time = at - 3600000 + i;
        shared.set('ai-marker-diagnostic-log-v1-' + time + '-fixture-0', [{ at: time, level: 'log' }]);
    }
    const earlier = openPage(shared, at - 1800000, 'www.zhixue.com');
    earlier.run("const run = {}; DiagnosticLog.grading('next-paper-wait-started', run, { round: 1 });");
    earlier.run("DiagnosticLog.grading('grading-paused', run, { reason: 'batch-target', currentCount: 1600, targetCount: 1600 }, {persist: true});");
    earlier.flushTimers();
    const later = openPage(shared, at, 'www.zhixue.com');
    later.run('console.log(\x60📊 [批阅份数] 已批阅: \x24{1600}/\x24{1600}\x60);', 'core/main.js');
    later.listeners.pagehide();
    const result = later.read(at - 3600000, at);
    assert.deepEqual(result.gradingEvents.map(entry => entry.run), [1, 1]);
    assert.equal(result.gradingEvents[1].details.targetCount, 1600);
    assert.equal(result.entries.at(-1).message, '📊 [批阅份数] 已批阅: 1600/1600');
    assert.ok(result.coverage.console.prunedThrough >= at - 3600000);
    assert.equal(result.coverage.grading.prunedThrough, null);
});

test('grading events on any active platform defer persistence and survive pagehide', () => {
    const at = 1794997905708, shared = new Map();
    const page = openPage(shared, at, 'other.example');
    page.run('const run = {}; for(let i=0;i<300;i++) DiagnosticLog.grading("batch-progress", run, { currentCount: i });');
    page.run('DiagnosticLog.grading("grading-paused", run, { reason: "batch-target" }, {persist: true});');
    assert.equal(shared.size, 0, '计数和暂停调用栈不写存储，包括跨日志分块时');
    page.listeners.pagehide();
    const viewer = openPage(shared, at, 'tools.example');
    const report = viewer.read(at, at);
    assert.equal(report.gradingEvents.length, 301);
    assert.equal(report.gradingEvents.at(-1).event, 'grading-paused');
});

test('a storage write failure remains local to diagnostics and is reported in coverage', () => {
    const at = 1794997905708;
    const page = openPage(new Map(), at, 'other.example', { rejectWrites: true });
    assert.doesNotThrow(() => page.run('DiagnosticLog.grading("grading-paused", null, { reason: "user-action" }, {persist: true});'));
    page.flushTimers();
    const report = page.read(at, at);
    assert.equal(report.coverage.grading.storageLimited, true);
    assert.equal(report.gradingEvents[0].details.reason, 'user-action');
});
