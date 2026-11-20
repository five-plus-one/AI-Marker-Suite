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
        run(source) { return vm.runInContext(instrumentDiagnosticLogs(source, 'core/test.js'), context); },
        read(start, end) { return structuredClone(vm.runInContext(`DiagnosticLog.read(${start}, ${end})`, context)); },
    };
}

test('stores diagnostic arguments and errors across tabs while filtering credentials', () => {
    const at = 1794997905708;
    const shared = new Map([['user-setting', 'preserved']]);
    const first = openPage(shared, at - 1000, 'mark.first.example');
    first.run('const answer = "private answer"; console.log(`已记录：${answer}`, { apiKey: "private key", link: "https://mark.example/paper?paperId=41&token=private-url-token" });');
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
    assert.equal(entries[0].args[1].link, 'https://mark.example/paper?paperId=41&token=[凭证]');
    assert.equal(entries[1].args[1].message, 'private response');
    assert.match(entries[1].args[1].stack, /Error: private response/);
    assert.ok(!JSON.stringify([...shared]).includes('private key'));
    assert.equal(first.shown[0][0], '已记录：private answer');
    assert.equal(first.shown[0][1].apiKey, 'private key');
    assert.deepEqual(viewer.read(at, at).entries.map(row => row.level), ['warn']);
    assert.equal(shared.get('user-setting'), 'preserved');
});
