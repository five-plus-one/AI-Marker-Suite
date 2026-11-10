const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { console: { log() {}, warn() {} } };
vm.createContext(context);
vm.runInContext(fs.readFileSync('src/core/prompt.js', 'utf8'), context);

const config = { subQuestions: [
    { id: 'a', label: '第一小题', maxScore: 6 },
    { id: 'b', label: '第二小题', maxScore: 6 }
] };

test('小题评分缺失时不生成零分', () => {
    const result = context.parseSubQuestionResponse('学生答案：未看清', config);
    assert.strictEqual(result.score, null);
    // 逐值断言（防聚合值掩盖单项回归）
    assert.strictEqual(result.subScores.length, 2);
    assert.strictEqual(result.subScores[0].score, null);
    assert.strictEqual(result.subScores[1].score, null);
});

test('总分存在而小题缺失时保留待核查状态', () => {
    const result = context.parseSubQuestionResponse('【得分】8\n【答案复述】测试', config);
    assert.strictEqual(result.score, null, '小题缺失不得直取总分（待核查）');
    // 逐值断言（原聚合断言 subScores.length===2 不看单项，单项回归会被掩盖）
    assert.strictEqual(result.subScores.length, 2);
    assert.strictEqual(result.subScores[0].score, null, '第 1 小题应为 null（不得补零）');
    assert.strictEqual(result.subScores[1].score, null, '第 2 小题应为 null（不得补零）');
    // 可分辨期望（原 score===null 分不清「待核查扣留」与「解析器没抓到总分」）：
    // 对照组——小题齐备时同一总分必须能被解析，证明 null 是有意扣留而非解析丢失
    const full = context.parseSubQuestionResponse('【得分】8\n第一小题分数：2\n第二小题分数：6', config);
    assert.strictEqual(full.score, 8, '对照组：小题齐备时总分应解析为 8（说明上面的 null 是扣留语义）');
    assert.strictEqual(full.subScores[0].score, 2);
    assert.strictEqual(full.subScores[1].score, 6);
});
