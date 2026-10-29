// ========== 答卷校验实验性开关：配置兼容性 ==========
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadPreset(initialList) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'preset.js'), 'utf8');
    const store = { 'ai-grading-presets': JSON.stringify({ list: initialList, active: Object.keys(initialList)[0] || '默认配置', bindings: {} }) };
    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        window: {},
        SCRIPT_CONFIG: { DEFAULT_ENDPOINT: '', DEFAULT_MODEL: '' },
        GM_getValue: (k, d) => (k in store ? store[k] : d),
        GM_setValue: (k, v) => { store[k] = v; },
        JSON, Math, Date, Error, String, Number, Array, Object, parseFloat, parseInt, isNaN, setTimeout, clearTimeout,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext('var restoreConfigIfMissing = undefined;' + src + ';__exports__ = PresetManager;', sandbox);
    return sandbox.__exports__;
}

const base = {
    question: { text: '', images: [], format: 'plain' },
    answer: { text: '', images: [], format: 'plain' },
    rubric: { text: '', images: [], format: 'plain' },
    scoring: { roundStep: 1, roundMethod: 'round' }
};

test('旧数据自动补 paperGuard.enabled = true', () => {
    const PM = loadPreset({ '默认配置': { ...base } });
    assert.strictEqual(PM.data.list['默认配置'].paperGuard.enabled, true);
});

test('用户关闭后迁移不覆盖', () => {
    const PM = loadPreset({ '我的方案': { ...base, paperGuard: { enabled: false } } });
    assert.strictEqual(PM.data.list['我的方案'].paperGuard.enabled, false);
});

test('导出/导入整对象保全 paperGuard', () => {
    const preset = { ...base, paperGuard: { enabled: false } };
    const exported = JSON.stringify({ type: 'ai-marker-preset', name: 'x', preset });
    const imported = JSON.parse(exported).preset;
    assert.strictEqual(imported.paperGuard.enabled, false);
});

test('导入旧版本方案后 migrateAll 补齐 paperGuard', () => {
    const PM = loadPreset({ '默认配置': { ...base } });
    PM.data.list['导入的旧方案'] = { ...base };   // 无 paperGuard
    PM.migrateAll();
    assert.strictEqual(PM.data.list['导入的旧方案'].paperGuard.enabled, true);
});

test('main.js 校验按开关生效（源码含开关分支）', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'main.js'), 'utf8');
    assert.ok(src.includes('paperGuard'), 'main.js 应读取 paperGuard 开关');
    assert.ok(src.includes('enabled === false'), '应有关闭分支');
});
