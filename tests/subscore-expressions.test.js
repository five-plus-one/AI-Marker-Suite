const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ctx = { console: { log() {}, warn() {} }, window: {}, document: null };
vm.createContext(ctx);
for (const file of ['score.js', 'prompt.js']) vm.runInContext(fs.readFileSync('src/core/' + file, 'utf8'), ctx);
vm.runInContext('this.calculator = ScoreCalculator', ctx);
const units = [{ id: 'a', label: '1', maxScore: 4 }, { id: 'b', label: '2', maxScore: 5 }, { id: 'c', label: '3', maxScore: 1 }];
const config = { subQuestions: units };
const response = (scores, total = '4') => '【答案复述】示例作答\n【分数计算】\n' + scores.map((score, i) => `${i + 1}分数：${score}\n${i + 1}评语：示例`).join('\n') + '\n【得分】' + total;
const values = result => Array.from(result.subScores, unit => unit.score);

test('反馈算式得到 3、1、0，计算流水线保持总分 4', () => {
    const result = ctx.parseSubQuestionResponse(response(['1+0+2=3', '0+0+0+1=1', '0']), config);
    assert.deepEqual(values(result), [3, 1, 0]);
    assert.equal(result.score, 4);
    assert.equal(result.rawScore, 4);
    const final = ctx.calculator.calculate({ aiScore: result.rawScore, diligenceLevel: 0, maxScore: 10,
        scoringConfig: { roundStep: 1, roundMethod: 'round' }, aiUnitScores: result.subScores });
    assert.equal(final.finalScore, 4);
    assert.deepEqual(Array.from(final.finalUnitScores, unit => unit.score), [3, 1, 0]);
});

test('当前现场无等号的逐点加法汇总为 2，覆盖模型总分 3', () => {
    const result = ctx.parseSubQuestionResponse(response(['0+1+0', '0+0+0+0', '1'], '3'), config);
    assert.deepEqual(values(result), [1, 0, 1]);
    assert.equal(result.score, 2);
    assert.equal(result.rawScore, 2);
    assert.equal(result._sections['得分'], '3', '保留模型原文供核查');
});

test('旧格式和结构化格式共用算式解析，缺总分仍由完整明细汇总', () => {
    const legacy = '学生答案：示例\n1分数：1+0+2=3\n2分数：0+0+0+1\n3分数：0\n总分：1';
    for (const result of [ctx.parseSubQuestionResponse(legacy, config), ctx.parseLegacySubQuestionResponse(legacy, config),
        ctx.parseSubQuestionResponse(response(['1+0+2', '1', '0'], '待计算'), config)]) {
        assert.deepEqual(values(result), [3, 1, 0]);
        assert.equal(result.score, 4);
        assert.equal(result.rawScore, 4);
    }
});

test('小数、全角算式、负分与满分截断', () => {
    for (const [field, expected] of [['０．５＋１．５＝２分', 2], ['4-1=3', 3], ['0.1+0.2=0.3', 0.3],
        ['.5+.5', 1], ['-1', 0], ['5+1=6', 4], ['二。五分', 2.5], ['3。4分', 3]]) {
        assert.equal(ctx.parseSubQuestionScoreValue(field, 4), expected, field);
    }
});

test('未完成、矛盾或未知算式保留缺分，不退回首项或等号后的数字', () => {
    for (const field of ['1+', '1+0+2=4', '1+未知=3', '1*2', '3/4', '1e2', '1=2', '1+0=1=2', 'NaN', 'Infinity', '1**2']) {
        const result = ctx.parseSubQuestionResponse(response([field, '1', '0']), config);
        assert.equal(result.subScores[0].score, null, field);
        assert.equal(result.score, null, field);
        assert.equal(result.rawScore, null, field);
    }
});

test('空字段不借用下一行或总分，小题缺失不补零', () => {
    for (const text of ['1分数：\n2分数：1\n3分数：0\n【得分】4', '2分数：1\n3分数：0\n【得分】4',
        '2分数：1\n3分数：0\n1分数：\n【得分】4']) {
        const result = ctx.parseSubQuestionResponse(text, config);
        assert.equal(result.subScores[0].score, null);
        assert.equal(result.score, null);
    }
});

test('数字题号精确匹配，不借用第 11 小题，也不取 OCR 复述数字', () => {
    const text = '【答案复述】\n1：4\n1分数：4\n【分数计算】\n11分数：4\n2分数：1\n3分数：0\n【得分】5';
    const result = ctx.parseSubQuestionResponse(text, config);
    assert.equal(result.subScores[0].score, null);
    assert.equal(result.score, null);
    const legacy = ctx.parseLegacySubQuestionResponse('学生答案：\n1：4\n2：5\n3：1\n总分：10', config);
    assert.deepEqual(values(legacy), [null, null, null]);
    assert.equal(legacy.score, null);
});

test('重复字段一致时保留，矛盾或无效时待核查', () => {
    for (const [second, expected] of [['1+2=3', 3], ['2', null], ['未知', null]]) {
        const result = ctx.parseSubQuestionResponse(response(['3', '1', '0']) + '\n1分数：' + second, config);
        assert.equal(result.subScores[0].score, expected);
        assert.equal(result.score, expected === null ? null : 4);
    }
});

test('旧标签变体、Markdown、正则字符与小数格式兼容', () => {
    for (const [label, line] of [['25(1)', '**25(1)分数：** 1+2=3分'], ['25', '25(1)分数：3'],
        ['25', '25(1)：3'], ['25', '25：3'], ['25', '25 3分'], ['题[1].', '- 题[1].分数：3']]) {
        const result = ctx.parseSubQuestionResponse('【答案复述】示例\n【分数计算】\n' + line + '\n【得分】3',
            { subQuestions: [{ label, maxScore: 4 }] });
        assert.equal(result.subScores[0].score, 3, line);
        assert.equal(result.score, 3);
    }
});

test('多个括号子题不冒充父题，已配置子题不被父题重复计分', () => {
    const result = ctx.parseSubQuestionResponse('25(1)分数：2\n25(2)分数：3\n【得分】5',
        { subQuestions: [{ label: '25', maxScore: 5 }] });
    assert.equal(result.score, null);
    const overlap = ctx.parseSubQuestionResponse('25(1)分数：2\n【得分】2',
        { subQuestions: [{ label: '25', maxScore: 5 }, { label: '25(1)', maxScore: 5 }] });
    assert.deepEqual(values(overlap), [null, 2]);
});
