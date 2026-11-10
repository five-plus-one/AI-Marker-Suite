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
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/core/runtime.js'), 'utf8'), sandbox);
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
    const cfg = PM.data.list['默认配置'];
    // W2：纯 JSON.stringify 比较对「字段被置 undefined」失明——补键形状比较（含 undefined 值的键）
    const shapeOf = (o) => JSON.stringify(
        Object.keys(o).sort().map(k => [k, o[k] && typeof o[k] === 'object' ? Object.keys(o[k]).sort() : typeof o[k]]));
    const first = JSON.stringify(cfg);
    const firstShape = shapeOf(cfg);
    PM.migrateAll();
    PM.migrateAll();
    assert.strictEqual(JSON.stringify(cfg), first, '重复迁移值应无变化');
    assert.strictEqual(shapeOf(cfg), firstShape, '重复迁移键形状不得变化（置 undefined 的字段也算变化）');
});

test('导出/导入经真实净化链后新字段保全（W4：走 sanitizePreset+migrateAll，非裸 JSON 往返）', () => {
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
    const { PM } = loadPreset({ '默认配置': { question: { text: '', images: [], format: 'plain' }, answer: { text: '', images: [], format: 'plain' }, rubric: { text: '', images: [], format: 'plain' }, scoring: {} } });
    // 真实导入链：导出整对象 JSON 序列化 → 导入解析 → sanitizePreset（ui-settings 同链）→ migrateAll
    const exported = JSON.stringify({ type: 'ai-marker-preset', name: '测试方案', preset });
    const clean = PM.sanitizePreset(JSON.parse(exported).preset);
    PM.data.list['导入方案'] = clean;
    PM.migrateAll();
    const c = PM.data.list['导入方案'];
    assert.strictEqual(c.outputMode, 'score-only', 'outputMode 应保全');
    assert.strictEqual(c.retryPolicy.maxRetries, 2, 'retryPolicy.maxRetries 应保全');
    assert.strictEqual(c.retryPolicy.retryOnTimeout, false, 'retryPolicy.retryOnTimeout 应保全');
    assert.strictEqual(c.scoring.units[0].roundStep, 0.5, '小题步长应保全');
    assert.strictEqual(c.scoring.units[0].maxScore, 2, '小题满分应保全');
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

test('批改节奏 humanPacing 缺失时补默认值（默认关闭）', () => {
    const { PM } = loadPreset({
        '默认配置': {
            question: { text: '', images: [], format: 'plain' },
            answer: { text: '', images: [], format: 'plain' },
            rubric: { text: '', images: [], format: 'plain' },
            scoring: {}
        }
    });
    const hp = PM.data.list['默认配置'].humanPacing;
    assert.ok(hp, '应补 humanPacing');
    assert.strictEqual(hp.enabled, false, '默认应关闭');
    assert.strictEqual(hp.normalDelay.min, 5, '普通模式默认下限 5');
    assert.strictEqual(hp.normalDelay.max, 15, '普通模式默认上限 15');
    assert.strictEqual(hp.unattendedDelay.min, 0, '无人模式默认下限 0');
    assert.strictEqual(hp.unattendedDelay.max, 8, '无人模式默认上限 8');
    assert.strictEqual(hp.rest.enabled, false, '随机休息默认关闭');
    assert.strictEqual(hp.recordDuration, true, '默认记录用时');
});

test('批改节奏 humanPacing 不覆盖用户已有配置，缺失子字段自动补齐', () => {
    const cfg = {
        question: { text: '', images: [], format: 'plain' },
        answer: { text: '', images: [], format: 'plain' },
        rubric: { text: '', images: [], format: 'plain' },
        scoring: {},
        humanPacing: {
            enabled: true,
            normalDelay: { min: 10, max: 20 }
            // unattendedDelay / rest / recordDuration 缺失
        }
    };
    const { PM } = loadPreset({ '我的方案': cfg });
    const hp = PM.data.list['我的方案'].humanPacing;
    assert.strictEqual(hp.enabled, true, '不得覆盖 enabled');
    assert.strictEqual(hp.normalDelay.min, 10, '不得覆盖 normalDelay.min');
    assert.strictEqual(hp.normalDelay.max, 20, '不得覆盖 normalDelay.max');
    assert.ok(hp.unattendedDelay && hp.unattendedDelay.min === 0 && hp.unattendedDelay.max === 8, '应补 unattendedDelay');
    assert.ok(hp.rest && hp.rest.enabled === false, '应补 rest');
    assert.strictEqual(hp.recordDuration, true, '应补 recordDuration');
});

test('humanPacing 经真实净化链后保全（W4：走 sanitizePreset+migrateAll，非裸 JSON 往返）', () => {
    const preset = {
        question: { text: 'q', images: [], format: 'plain' },
        answer: { text: 'a', images: [], format: 'plain' },
        rubric: { text: 'r', images: [], format: 'plain' },
        scoring: {},
        humanPacing: {
            enabled: true,
            normalDelay: { min: 8, max: 30 },
            unattendedDelay: { min: 2, max: 6 },
            rest: { enabled: true, everyCount: 15, restMin: 60, restMax: 240 },
            recordDuration: false
        }
    };
    const { PM } = loadPreset({ '默认配置': { question: { text: '', images: [], format: 'plain' }, answer: { text: '', images: [], format: 'plain' }, rubric: { text: '', images: [], format: 'plain' }, scoring: {} } });
    const exported = JSON.stringify({ type: 'ai-marker-preset', name: '节奏方案', preset });
    const clean = PM.sanitizePreset(JSON.parse(exported).preset);
    PM.data.list['导入方案'] = clean;
    PM.migrateAll();
    const hp = PM.data.list['导入方案'].humanPacing;
    assert.ok(hp, '净化链不得剥掉 humanPacing');
    assert.strictEqual(hp.enabled, true);
    assert.deepStrictEqual(hp.normalDelay, { min: 8, max: 30 });
    assert.deepStrictEqual(hp.unattendedDelay, { min: 2, max: 6 });
    assert.deepStrictEqual(hp.rest, { enabled: true, everyCount: 15, restMin: 60, restMax: 240 });
    assert.strictEqual(hp.recordDuration, false);
});

test('变异自检 W4：净化链剥除 humanPacing → 保全断言必红（红度实证）', () => {
    // 注入变异：sanitizePreset 丢弃 humanPacing —— 上一用例的保全断言会红，此处证明其可分辨
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'preset.js'), 'utf8');
    const find = 'const out = Object.assign({}, cfg);';
    assert.ok(src.includes(find), '变异目标未命中');
    const mutated = src.replace(find, find + ' delete out.humanPacing;');
    const store = {};
    const sandbox = {
        console: { log() {}, warn() {}, error() {} }, window: {},
        SCRIPT_CONFIG: { DEFAULT_ENDPOINT: '', DEFAULT_MODEL: '' },
        GM_getValue: (k, d) => (k in store ? store[k] : d), GM_setValue: (k, v) => { store[k] = v; },
        JSON, Math, Date, Error, String, Number, Array, Object, parseFloat, parseInt, isNaN, setTimeout, clearTimeout,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(mutated + ';__exports__ = PresetManager;', sandbox);
    const clean = sandbox.__exports__.sanitizePreset({ humanPacing: { enabled: true }, scoring: {} });
    assert.strictEqual(clean.humanPacing, undefined, '变异被检出：humanPacing 被剥除——保全用例的断言此时必红');
});
