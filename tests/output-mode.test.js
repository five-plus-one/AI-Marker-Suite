// ========== #210 精简输出模式：回归测试 ==========
// 目标：证明
//   1. 默认（详细）模式提示词与历史逐字一致 —— 不影响任何现有流程
//   2. 精简模式省去答案复述/评分依据/分数计算/评语，保留分数字段
//   3. 解析器对精简输出仍能取到分数
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadPrompt() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'prompt.js'), 'utf8');
    const scoreSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'score.js'), 'utf8');
    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        window: {}, document: null,
        setTimeout, clearTimeout, Promise, Math, JSON, Date, Error, RegExp,
        String, Number, Array, Object, parseFloat, parseInt, isNaN,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(scoreSrc, sandbox);
    vm.runInContext(src + '\n;__exports__ = { buildSubQuestionPrompt, buildStructuredPrompt, parseSubQuestionResponse, parseStructuredResponse, isScoreOnlyMode };', sandbox);
    return sandbox.__exports__;
}

const P = loadPrompt();

const subConfig = {
    question: { text: '解方程 x+1=2', images: [], format: 'plain' },
    answer: { text: 'x=1', images: [], format: 'plain' },
    rubric: { text: '正确得2分', images: [], format: 'plain' },
    subQuestions: [
        { id: 'a', label: '56(1)', maxScore: 2, roundStep: 1 },
        { id: 'b', label: '56(2)', maxScore: 2, roundStep: 1 }
    ],
    scoring: { roundStep: 1, roundMethod: 'round' }
};

test('默认模式下分小题提示词含评分依据/评语（与历史一致）', () => {
    const p = P.buildSubQuestionPrompt({ ...subConfig });
    assert.ok(p.includes('【答案复述】'), '应含答案复述');
    assert.ok(p.includes('【评分依据】'), '应含评分依据');
    assert.ok(p.includes('【分数计算】'), '应含分数计算');
    assert.ok(p.includes('56(1)评语：'), '应含小题评语');
    assert.ok(p.includes('56(1)分数：'), '应含小题分数');
    assert.ok(p.includes('【得分】'), '应含总分');
});

test('精简模式分小题提示词只保留分数字段', () => {
    const p = P.buildSubQuestionPrompt({ ...subConfig, outputMode: 'score-only' });
    assert.ok(!p.includes('【评分依据】'), '不应含评分依据');
    assert.ok(!p.includes('【分数计算】'), '不应含分数计算');
    assert.ok(!p.includes('【答案复述】'), '不应含答案复述');
    assert.ok(!p.includes('评语：（'), '不应含小题评语字段');
    assert.ok(p.includes('56(1)分数：'), '应保留小题分数');
    assert.ok(p.includes('56(2)分数：'), '应保留小题分数');
    assert.ok(p.includes('【得分】'), '应保留总分');
});

test('默认模式下单题提示词含全部段落（与历史一致）', () => {
    const p = P.buildStructuredPrompt({
        question: { text: 'q', images: [], format: 'plain' },
        answer: { text: 'a', images: [], format: 'plain' },
        rubric: { text: 'r', images: [], format: 'plain' },
        scoring: { roundStep: 1, roundMethod: 'round' }
    });
    assert.ok(p.includes('【答案复述】'));
    assert.ok(p.includes('【评分依据】'));
    assert.ok(p.includes('【分数计算】'));
    assert.ok(p.includes('【得分】'));
});

test('精简模式单题提示词只保留【得分】', () => {
    const p = P.buildStructuredPrompt({
        question: { text: 'q', images: [], format: 'plain' },
        answer: { text: 'a', images: [], format: 'plain' },
        rubric: { text: 'r', images: [], format: 'plain' },
        scoring: { roundStep: 1, roundMethod: 'round' },
        outputMode: 'score-only'
    });
    assert.ok(!p.includes('【评分依据】'));
    assert.ok(!p.includes('【分数计算】'));
    assert.ok(!p.includes('【答案复述】'));
    assert.ok(p.includes('【得分】'));
});

test('解析器能从精简输出取到小题分与总分', () => {
    const text = '56(1)分数：2\n56(2)分数：1.5\n\n【得分】\n3.5';
    const r = P.parseSubQuestionResponse(text, { ...subConfig, outputMode: 'score-only' });
    assert.strictEqual(r.score, 3.5);
    assert.strictEqual(r.subScores[0].score, 2);
    assert.strictEqual(r.subScores[1].score, 1.5);
});

test('isScoreOnlyMode 默认为详细模式', () => {
    assert.strictEqual(P.isScoreOnlyMode({}), false);
    assert.strictEqual(P.isScoreOnlyMode({ outputMode: 'detailed' }), false);
    assert.strictEqual(P.isScoreOnlyMode({ outputMode: 'score-only' }), true);
    assert.strictEqual(P.isScoreOnlyMode({ scoring: { outputMode: 'score-only' } }), true);
});
