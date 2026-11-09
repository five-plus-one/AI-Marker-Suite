// ========== #293 存储「加载失败→空默认→覆写清空」防护回归 ==========
// 事故：新教育老师配置方案被一次瞬态读取失败永久清空。
// 核心不变量：加载失败只读降级，原始存储分毫不动；迁移抛异常不丢主数据；
// 保存前旋转备份；历史读取失败不再显式重置。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(file, exports, store, opts = {}) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', file), 'utf8');
    const quiet = { log: () => {}, warn: () => {}, error: () => {} };
    const sandbox = {
        console: quiet, window: {}, document: null,
        SCRIPT_CONFIG: { DEFAULT_ENDPOINT: 'x', DEFAULT_MODEL: 'y', VERSION: '0' },
        GM_getValue: (k, d) => {
            if (opts.getThrows) throw new Error('storage read failed');
            return (k in store) ? store[k] : d;
        },
        GM_setValue: (k, v) => { store[k] = v; },
        Math, JSON, Date, Error, RegExp, String, Number, Array, Object,
        parseFloat, parseInt, isNaN, Promise, setTimeout, clearTimeout,
        fetch: async () => { throw new Error('no net'); },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src + '\n;__exports__ = {' + exports + '};', sandbox);
    return sandbox.__exports__;
}

const RAW_OK = JSON.stringify({ list: { A: { provider: '5plus1' } }, active: 'A', bindings: {} });

// ---------- PresetManager ----------
test('配置解析失败：只读降级 + 原数据不覆写 + rescue 留底', () => {
    const store = { 'ai-grading-presets': '{bad json' };
    const { PresetManager: pm } = load('preset.js', 'PresetManager', store);
    pm.init();
    assert.strictEqual(pm._writeDisabled, true, '应进入只读降级');
    assert.strictEqual(pm.save(), false, '降级期保存必须被拦截');
    assert.strictEqual(store['ai-grading-presets'], '{bad json', '原数据不得被覆写');
    assert.strictEqual(store['ai-grading-presets-rescue'], '{bad json', '原始字节应存 rescue');
});

test('配置读取异常（标签休眠类）：零写入降级', () => {
    const store = {};
    const { PresetManager: pm } = load('preset.js', 'PresetManager', store, { getThrows: true });
    pm.init();
    assert.strictEqual(pm._writeDisabled, true);
    assert.strictEqual(pm.save(), false);
    assert.ok(!('ai-grading-presets' in store), '不得产生任何写入');
});

test('正常保存旋转备份到 -prev（误写可回滚）', () => {
    const store = { 'ai-grading-presets': RAW_OK };
    const { PresetManager: pm } = load('preset.js', 'PresetManager', store);
    pm.init();
    pm.data.list.B = {};
    assert.strictEqual(pm.save(), true);
    // 语义级断言：-prev 保留了包含旧内容 A 的上一版快照（init 期间迁移自保存可能已轮转一次）
    assert.ok(store['ai-grading-presets-prev'], '上一版应留底');
    const prev = JSON.parse(store['ai-grading-presets-prev']);
    assert.ok(prev.list.A, '留底内容是上一版数据');
    assert.ok(JSON.parse(store['ai-grading-presets']).list.B, '新数据已写入');
});

test('首次使用（无键）：初始化默认并保存（语义不变）', () => {
    const store = {};
    const { PresetManager: pm } = load('preset.js', 'PresetManager', store);
    pm.init();
    assert.strictEqual(pm._writeDisabled, false);
    assert.ok(pm.data.list['默认配置']);
    assert.ok(store['ai-grading-presets'], '首启仍正常落盘');
});

test('迁移抛异常：主数据保留（不被空默认替换）', () => {
    // list=null 会让 _migrateGradingMode 的 for-in 抛异常
    const raw = JSON.stringify({ list: null, active: 'A', bindings: {} });
    const store = { 'ai-grading-presets': raw };
    const { PresetManager: pm } = load('preset.js', 'PresetManager', store);
    pm.init();
    assert.strictEqual(pm._writeDisabled, false, '迁移失败不降级');
    assert.strictEqual(pm.data.list, null, '原数据结构保留，不得换成空默认');
    assert.strictEqual(pm.data.active, 'A');
});

// ---------- ProviderManager / WorkflowManager ----------
test('供应商/工作流解析失败：同款只读降级 + rescue', () => {
    const store = { 'ai-grading-providers-v2': '{bad', 'ai-grading-workflows': '{bad' };
    const { ProviderManager, WorkflowManager } = load('ai-engine.js', 'ProviderManager, WorkflowManager', store);
    ProviderManager.init();
    WorkflowManager.init();
    assert.strictEqual(ProviderManager._writeDisabled, true);
    assert.strictEqual(WorkflowManager._writeDisabled, true);
    assert.strictEqual(ProviderManager.save(), false);
    assert.strictEqual(WorkflowManager.save(), false);
    assert.strictEqual(store['ai-grading-providers-v2'], '{bad');
    assert.strictEqual(store['ai-grading-workflows'], '{bad');
    assert.strictEqual(store['ai-grading-providers-v2-rescue'], '{bad');
    assert.strictEqual(store['ai-grading-workflows-rescue'], '{bad');
});

// ---------- HistoryManager ----------
test('历史读取失败：不再显式重置存储（#293）', async () => {
    const store = { 'ai-grading-history': '[{"id":1}]' };
    const { HistoryManager } = load('history.js', 'HistoryManager', store, { getThrows: true });
    await HistoryManager.init();
    assert.strictEqual(store['ai-grading-history'], '[{"id":1}]', '原历史不得被重置为 []');
    assert.strictEqual(HistoryManager._writeDisabled, true);
});

test('历史解析失败：rescue 留底 + 不覆写', async () => {
    const store = { 'ai-grading-history': '{bad' };
    const { HistoryManager } = load('history.js', 'HistoryManager', store);
    await HistoryManager.init();
    assert.strictEqual(store['ai-grading-history'], '{bad', '损坏数据不得被覆写');
    assert.strictEqual(store['ai-grading-history-rescue'], '{bad');
    assert.strictEqual(HistoryManager._writeDisabled, true);
});

// ---------- #293 审计修正点 ----------
test('降级期保存被拦时可见提示（不静默假成功）', () => {
    const toasts = [];
    const store = { 'ai-grading-presets': '{bad' };
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'preset.js'), 'utf8');
    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} }, window: {}, document: null,
        SCRIPT_CONFIG: { DEFAULT_ENDPOINT: 'x', DEFAULT_MODEL: 'y' },
        GM_getValue: (k, d) => (k in store ? store[k] : d),
        GM_setValue: (k, v) => { store[k] = v; },
        showToast: (m) => { toasts.push(m); },
        Math, JSON, Date, Error, RegExp, String, Number, Array, Object, parseFloat, parseInt, isNaN,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src + '\n;__exports__ = { PresetManager };', sandbox);
    const pm = sandbox.__exports__.PresetManager;
    pm.init();
    pm.save();
    assert.ok(toasts.length > 0, '拦截保存必须有可见提示');
    assert.ok(toasts.some(t => /未保存/.test(t)), '提示须说明未持久化');
});

test('降级期惰性探活：存储恢复后退出降级（瞬态失败自愈）', () => {
    const store = { 'ai-grading-presets': '{bad' };
    const { PresetManager: pm } = load('preset.js', 'PresetManager', store);
    pm.init();
    assert.strictEqual(pm._writeDisabled, true);
    // 模拟瞬态故障恢复：主键变回可解析
    store['ai-grading-presets'] = RAW_OK;
    const r = pm.save();
    assert.strictEqual(r, false, '本次保存仍未持久化（诚实返回）');
    assert.strictEqual(pm._writeDisabled, false, '降级应已解除');
    assert.strictEqual(pm.data.active, 'A', '内存数据采用恢复出的存储数据');
    assert.strictEqual(pm.save(), true, '后续保存恢复正常');
});

test('历史图片迁移失败保留 base64（不得删除，#293 审计实锤）', async () => {
    const raw = JSON.stringify([{ id: 'r1', imageBase64s: ['AAA'], imageUrls: [] }]);
    const store = { 'ai-grading-history': raw };
    const m = load('history.js', 'HistoryManager, ImageStore', store);
    m.ImageStore.save = async () => { throw new Error('idb down'); };
    await m.HistoryManager.init();
    assert.ok(m.HistoryManager.records[0].imageBase64s, '迁移失败的 base64 必须保留');
    assert.deepStrictEqual(m.HistoryManager.records[0].imageBase64s, ['AAA']);
});

test('updater 恢复只补缺失键，不覆写现存配置', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'updater.js'), 'utf8');
    const m = src.match(/function restoreConfigIfMissing\([^)]*\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'restoreConfigIfMissing 未找到');
    const store = {
        'ai-grading-presets': '{"list":{"NEW":{}}}',        // 现存（用户新版）
        'ai-grading-config-backup': JSON.stringify({ presets: '{"list":{"OLD":{}}}', providers: '{"providers":{}}' }),
    };
    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        GM_getValue: (k, d) => (k in store ? store[k] : d),
        GM_setValue: (k, v) => { store[k] = v; },
        JSON, String, Number, Array, Object,
    };
    vm.createContext(sandbox);
    vm.runInContext(m[0] + '\n;__f = restoreConfigIfMissing;', sandbox);
    sandbox.__f();
    assert.strictEqual(store['ai-grading-presets'], '{"list":{"NEW":{}}}', '现存配置不得被备份覆写');
    assert.strictEqual(store['ai-grading-providers-v2'], '{"providers":{}}', '缺失键应从备份补回');
});
