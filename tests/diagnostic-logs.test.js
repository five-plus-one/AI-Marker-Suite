const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { instrumentDiagnosticLogs } = require('../scripts/instrument-diagnostic-logs.cjs');

const logger = fs.readFileSync(path.join(__dirname, '../src/core/diagnostic-log.js'), 'utf8');

function openPage(shared, at, hostname) {
    const shown = [], listeners = {};
    const context = vm.createContext({
        window: { location: { hostname }, addEventListener(type, listener) { listeners[type] = listener; } },
        document: { addEventListener() {} },
        DIAGNOSTIC_SCRIPT_VERSION: '1.21.27.9',
        Date: { now: () => at },
        console: { log: (...args) => shown.push(args), warn: (...args) => shown.push(args) },
        setTimeout() { return 1; }, clearTimeout() {},
        GM_listValues: () => Array.from(shared.keys()),
        GM_getValue: (key, fallback) => shared.get(key) ?? fallback,
        GM_setValue: (key, value) => shared.set(key, structuredClone(value)),
        GM_deleteValue: key => shared.delete(key),
    });
    vm.runInContext(logger, context);
    return {
        shown, listeners,
        run(source, moduleName = 'core/test.js') { return vm.runInContext(instrumentDiagnosticLogs(source, moduleName), context); },
        read(start, end) { return structuredClone(vm.runInContext(`DiagnosticLog.read(${start}, ${end})`, context)); },
    };
}

test('stores static log text across tabs within the chosen interval and preserves console arguments', () => {
    const at = 1794997905708;
    const shared = new Map([['user-setting', 'preserved']]);
    const first = openPage(shared, at - 1000, 'mark.first.example');
    first.run('const answer = "private answer"; console.log(`已记录：${answer}`, { apiKey: "private key" });');
    first.listeners.pagehide();
    const second = openPage(shared, at, 'mark.second.example');
    second.run('console.warn("下载失败", Object.assign(new Error("private response"), { status: 403 }));');
    second.listeners.pagehide();
    const viewer = openPage(shared, at + 1000, 'tools.example');
    const entries = viewer.read(at - 1000, at).entries;
    assert.deepEqual(entries.map(row => row.level), ['log', 'warn']);
    assert.deepEqual(entries.map(row => row.site), ['mark.first.example', 'mark.second.example']);
    assert.equal(entries[0].message, '已记录：… …');
    assert.equal(entries[1].httpStatus, 403);
    assert.equal(entries[1].version, '1.21.27.9');
    assert.ok(!JSON.stringify([...shared]).includes('private'));
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
