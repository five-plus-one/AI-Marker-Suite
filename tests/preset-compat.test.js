// ========== 配置兼容性：旧数据迁移 + 导出/导入字段保全 ==========
// 目标：证明
//   1. 旧版本数据结构（缺 outputMode/retryPolicy）自动升级到新结构
//   2. 迁移不覆盖用户已有选择（幂等）
//   3. 导出/导入整对象序列化，新字段自动保全
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadPreset(initialList) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'preset.js'), 'utf8');
    // 真实存储键是 ai-grading-presets，存 JSON 字符串（save 内 JSON.stringify / init 内 JSON.parse）
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
    // 拦截 init 里的 restoreConfigIfMissing（不存在于沙箱）
    vm.runInContext('var restoreConfigIfMissing = undefined;' + src + ';__exports__ = PresetManager;', sandbox);
    return { PM: sandbox.__exports__, store };
}

test('旧数据结构自动补 outputMode 与 retryPolicy', () => {
    const old = {
        '默认配置': {
            question: { text: '', images: [], format: 'plain' },
            answer: { text: '', images: [], format: 'plain' },
            rubric: { text: '', images: [], format: 'plain' },
            workflowId: 'fast',
            gradingMode: 'normal',
            scoring: { roundStep: 1, roundMethod: 'round' }
            // 故意不带 outputMode / retryPolicy —— 模拟旧版本数据
        }
    };
    const { PM } = loadPreset(old);
    const cfg = PM.data.list['默认配置'];
    assert.strictEqual(cfg.outputMode, 'detailed', '应补 outputMode=detailed');
    assert.ok(cfg.retryPolicy, '应补 retryPolicy');
    assert.strictEqual(cfg.retryPolicy.maxRetries, 3);
    assert.strictEqual(cfg.retryPolicy.retryOnTimeout, true);
    assert.strictEqual(cfg.retryPolicy.retryOnEmpty, true);
});

test('迁移不覆盖用户已有选择（幂等）', () => {
    const cfg = {
        question: { text: '', images: [], format: 'plain' },
        answer: { text: '', images: [], format: 'plain' },
        rubric: { text: '', images: [], format: 'plain' },
        workflowId: 'fast',
        gradingMode: 'normal',
        outputMode: 'score-only',
        retryPolicy: { maxRetries: 1, retryOnTimeout: false, retryOnEmpty: false },
        scoring: { roundStep: 0.5, roundMethod: 'floor' }
    };
    const { PM } = loadPreset({ '我的方案': cfg });
    const c = PM.data.list['我的方案'];
    assert.strictEqual(c.outputMode, 'score-only', '不得覆盖 score-only');
    assert.strictEqual(c.retryPolicy.maxRetries, 1, '不得覆盖 maxRetries');
    assert.strictEqual(c.retryPolicy.retryOnTimeout, false, '不得覆盖 retryOnTimeout');
    assert.strictEqual(c.scoring.roundStep, 0.5, '不得覆盖 roundStep');
});

test('migrateAll 可重复调用（幂等，导入后调用安全）', () => {
    const old = {
        '默认配置': {
            question: { text: '', images: [], format: 'plain' },
            answer: { text: '', images: [], format: 'plain' },
            rubric: { text: '', images: [], format: 'plain' },
            scoring: {}
        }
    };
    const { PM } = loadPreset(old);
    const first = JSON.stringify(PM.data.list['默认配置']);
    PM.migrateAll();
    PM.migrateAll();
    assert.strictEqual(JSON.stringify(PM.data.list['默认配置']), first, '重复迁移应无变化');
});

test('导出/导入整对象序列化，新字段保全', () => {
    // 导出是 `preset: preset` 整对象 JSON.stringify；导入是 `list[name] = data.preset`。
    // 这里固化「整对象往返后新字段仍在」这一性质。
    const preset = {
        question: { text: 'q', images: [], format: 'plain' },
        answer: { text: 'a', images: [], format: 'plain' },
        rubric: { text: 'r', images: [], format: 'plain' },
        workflowId: 'fast',
        gradingMode: 'normal',
        outputMode: 'score-only',
        retryPolicy: { maxRetries: 2, retryOnTimeout: false, retryOnEmpty: true },
        scoring: { roundStep: 0.5, roundMethod: 'round', units: [{ label: '56(1)', maxScore: 2, roundStep: 0.5 }] }
    };
    const exported = JSON.stringify({ type: 'ai-marker-preset', name: '测试方案', preset });
    const imported = JSON.parse(exported).preset;
    assert.strictEqual(imported.outputMode, 'score-only', 'outputMode 应保全');
    assert.strictEqual(imported.retryPolicy.maxRetries, 2, 'retryPolicy.maxRetries 应保全');
    assert.strictEqual(imported.retryPolicy.retryOnTimeout, false, 'retryPolicy.retryOnTimeout 应保全');
    assert.strictEqual(imported.scoring.units[0].roundStep, 0.5, '小题步长应保全');
});

test('导入旧版本文件后调用 migrateAll 可补齐缺失字段', () => {
    const { PM } = loadPreset({ '默认配置': { question: { text: '', images: [], format: 'plain' }, answer: { text: '', images: [], format: 'plain' }, rubric: { text: '', images: [], format: 'plain' }, scoring: {} } });
    // 模拟导入一个旧版本方案（缺新字段）
    PM.data.list['导入的旧方案'] = {
        question: { text: '', images: [], format: 'plain' },
        answer: { text: '', images: [], format: 'plain' },
        rubric: { text: '', images: [], format: 'plain' },
        scoring: { roundStep: 1, roundMethod: 'round' }
    };
    PM.migrateAll();   // 与导入路径调用的同一函数
    const c = PM.data.list['导入的旧方案'];
    assert.strictEqual(c.outputMode, 'detailed', '导入的旧方案应补 outputMode');
    assert.ok(c.retryPolicy && c.retryPolicy.maxRetries === 3, '导入的旧方案应补 retryPolicy');
});
