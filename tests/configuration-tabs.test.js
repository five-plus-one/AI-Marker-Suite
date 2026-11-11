const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function page(store, faults = {}) {
    const context = { window: {}, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout,
        SCRIPT_CONFIG: { DEFAULT_ENDPOINT: 'https://example.test/v1/chat/completions', DEFAULT_MODEL: 'aimarker-fast' },
        GM_getValue(key, fallback) { if (faults.read) throw Error('read failed'); return key in store ? store[key] : fallback; },
        GM_setValue(key, value) { if (faults.write === key) throw Error('write failed'); store[key] = value; } };
    vm.createContext(context);
    for (const file of ['runtime.js', 'ai-engine.js', 'preset.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/core', file), 'utf8'), context);
    vm.runInContext('window.exports = { PresetManager, ProviderManager, WorkflowManager, mergeConfigurationEdits };', context);
    return context.window.exports;
}
const json = value => JSON.parse(JSON.stringify(value));
const stored = (store, key = 'ai-grading-presets') => JSON.parse(store[key]);
function setup() {
    const store = {};
    const first = page(store), second = page(store);
    first.PresetManager.init();
    first.ProviderManager.init();
    first.WorkflowManager.init();
    return { store, first, second, a: first.PresetManager, b: second.PresetManager };
}

test('旧页面切换方案保留另一页面新增的方案与绑定', () => {
    const { store, a, b } = setup();
    a.data.list.Physics = { answer: { text: '参考答案' } };
    a.data.bindings.task = 'Physics'; a.data.active = 'Physics'; assert.equal(a.save(), true);
    b.data.active = '默认配置'; assert.equal(b.save(), true);
    assert.equal(stored(store).list.Physics.answer.text, '参考答案');
    assert.equal(stored(store).bindings.task, 'Physics');
});
test('旧页面保存未编辑的方案时继承另一页面更新的答案', () => {
    const { store, a, b } = setup();
    a.data.list['默认配置'].answer = { text: '更新后的答案' }; a.save(); b.save();
    assert.equal(stored(store).list['默认配置'].answer.text, '更新后的答案');
    assert.equal(b.data.list['默认配置'].answer.text, '更新后的答案');
});
test('两个页面分别编辑不同方案均得到保存', () => {
    const { store, a, b } = setup();
    a.data.list.A = { answer: { text: 'A' } }; a.save();
    b.data.list.B = { answer: { text: 'B' } }; b.save();
    assert.ok(stored(store).list.A); assert.ok(stored(store).list.B);
});
test('同一方案的独立字段编辑可以合并', () => {
    const { store, a, b } = setup();
    a.data.list['默认配置'].answer = { text: '答案' }; a.save();
    b.data.list['默认配置'].rubric = { text: '标准' }; assert.equal(b.save(), true);
    assert.equal(stored(store).list['默认配置'].answer.text, '答案');
    assert.equal(stored(store).list['默认配置'].rubric.text, '标准');
});
test('同一内容被两页分别修改时保护已保存内容并保留当前编辑', () => {
    const { store, a, b } = setup();
    a.data.list['默认配置'].outputMode = 'score-only'; a.save();
    b.data.list['默认配置'].outputMode = 'custom-pending';
    const before = store['ai-grading-presets'];
    assert.equal(b.save(), false); assert.equal(store['ai-grading-presets'], before);
    assert.equal(b.data.list['默认配置'].outputMode, 'custom-pending');
});
test('两个页面以同名新建不同配置时拒绝拼接成第三种配置', () => {
    const { store, a, b } = setup();
    a.data.list.New = { answer: { text: 'A' } }; a.save();
    b.data.list.New = { rubric: { text: 'B' } }; assert.equal(b.save(), false);
    assert.deepEqual(stored(store).list.New, { answer: { text: 'A' } });
});
test('其他页面删除的方案不会被旧页面自动保存复活', () => {
    const { store, a } = setup();
    a.data.list.Remove = json(a.data.list['默认配置']); a.data.bindings.task = 'Remove'; assert.equal(a.save(), true);
    const b = page(store).PresetManager;
    delete a.data.list.Remove; delete a.data.bindings.task; assert.equal(a.save(), true);
    assert.equal(b.save(), true); assert.equal(stored(store).list.Remove, undefined); assert.equal(stored(store).bindings.task, undefined);
});
test('本页删除方案同时保留其他页面新建的方案', () => {
    const { store, a } = setup(); a.data.list.Remove = {}; a.save();
    const b = page(store).PresetManager;
    a.data.list.Keep = {}; a.save(); delete b.data.list.Remove; assert.equal(b.save(), true);
    assert.ok(stored(store).list.Keep); assert.equal(stored(store).list.Remove, undefined);
});
test('删除与另一页编辑同一方案冲突时保护编辑结果', () => {
    const { store, a } = setup(); a.data.list.Remove = {}; a.save();
    const b = page(store).PresetManager;
    a.data.list.Remove.answer = { text: '新答案' }; a.save(); delete b.data.list.Remove;
    assert.equal(b.save(), false); assert.equal(stored(store).list.Remove.answer.text, '新答案');
});
test('供应商旧页面保存保留新供应商和已更新的访问凭证', () => {
    const { store, first, second } = setup(); const a = first.ProviderManager, b = second.ProviderManager;
    a.data.providers.Custom = { endpoint: 'https://custom.test', apiKey: 'test-token', models: { vision: {} } }; a.save();
    b.save(); assert.equal(stored(store, 'ai-grading-providers-v2').providers.Custom.apiKey, 'test-token');
});
test('供应商凭证与模型标签的独立更新可以合并', () => {
    const { store, first, second } = setup(); const a = first.ProviderManager, b = second.ProviderManager;
    a.data.providers['5plus1官方'].apiKey = 'updated-test-token'; a.save();
    b.data.providers['5plus1官方'].models['aimarker-fast'].label = '新标签'; assert.equal(b.save(), true);
    const data = stored(store, 'ai-grading-providers-v2').providers['5plus1官方'];
    assert.equal(data.apiKey, 'updated-test-token'); assert.equal(data.models['aimarker-fast'].label, '新标签');
});
test('供应商同一凭证的并行修改拒绝覆盖', () => {
    const { store, first, second } = setup(); const a = first.ProviderManager, b = second.ProviderManager;
    a.data.providers['5plus1官方'].apiKey = 'a-test-token'; a.save();
    b.data.providers['5plus1官方'].apiKey = 'b-test-token'; assert.equal(b.save(), false);
    assert.equal(stored(store, 'ai-grading-providers-v2').providers['5plus1官方'].apiKey, 'a-test-token');
});
test('工作流旧页面切换流程保留另一页面的模型设置', () => {
    const { store, first, second } = setup(); const a = first.WorkflowManager, b = second.WorkflowManager;
    a.data.workflows['普通批改'].model.model = 'new-vision'; a.save();
    b.data.activeWorkflow = 'normal'; assert.equal(b.save(), true);
    assert.equal(stored(store, 'ai-grading-workflows').workflows['普通批改'].model.model, 'new-vision');
});
test('工作流同一模型的并行修改拒绝覆盖', () => {
    const { store, first, second } = setup(); const a = first.WorkflowManager, b = second.WorkflowManager;
    a.data.workflows['普通批改'].model.model = 'model-a'; a.save();
    b.data.workflows['普通批改'].model.model = 'model-b'; assert.equal(b.save(), false);
    assert.equal(stored(store, 'ai-grading-workflows').workflows['普通批改'].model.model, 'model-a');
});
test('保存前读取失败时三个管理器均保护完整存储', () => {
    const { store } = setup(), faults = {}, managers = page(store, faults);
    const before = JSON.stringify(store); faults.read = true;
    for (const key of ['PresetManager', 'ProviderManager', 'WorkflowManager']) assert.equal(managers[key].save(), false);
    assert.equal(JSON.stringify(store), before);
});
test('保存前发现其他页面存储损坏时不覆写原始内容', () => {
    const { store, a } = setup(); store['ai-grading-presets'] = '{broken';
    a.data.list.New = {}; assert.equal(a.save(), false); assert.equal(store['ai-grading-presets'], '{broken');
});
test('主存储写入失败后保留编辑与基线，重试合并其他页面更新', () => {
    const { store, a } = setup(), faults = {}, b = page(store, faults).PresetManager;
    b.data.list.Local = {}; faults.write = 'ai-grading-presets'; assert.throws(() => b.save(), /write failed/);
    a.data.list.Remote = {}; a.save(); delete faults.write; assert.equal(b.save(), true);
    assert.ok(stored(store).list.Local); assert.ok(stored(store).list.Remote);
});
test('迁移保存保留其他页面已选择的输出模式', () => {
    const { store, a, b } = setup(); a.data.list['默认配置'].outputMode = 'score-only'; a.save();
    delete b.data.list['默认配置'].outputMode; b.migrateAll();
    assert.equal(stored(store).list['默认配置'].outputMode, 'score-only');
});
test('已删除模型的旧页面选择回落到仍存在的模型', () => {
    const { store, first } = setup(), a = first.ProviderManager;
    a.data.providers.Custom = { models: { old: {}, keep: {} } }; a.save();
    const b = page(store).ProviderManager;
    delete a.data.providers.Custom.models.old; a.save();
    b.data.activeProvider = 'Custom'; b.data.activeModel = 'old'; assert.equal(b.save(), true);
    assert.equal(stored(store, 'ai-grading-providers-v2').activeModel, 'keep');
});
test('对象字段顺序变化不造成配置冲突', () => {
    const { first } = setup();
    const before = { entry: { a: 1, b: 2 } }, local = { entry: { b: 2, a: 1 } }, remote = { entry: { a: 3, b: 2 } };
    assert.deepEqual(json(first.mergeConfigurationEdits(before, local, remote)), remote);
});
