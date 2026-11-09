// ========== #287 解析抗格式漂移：全角/中文数字 + 分数计算回退 ==========
// 双评偶发「双评结果不完整」的根因是 extractScore 只认半角数字；
// 模型输出「８分」「八分」「２.５」等变体时解析为 null 导致批改停摆
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadPrompt() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'prompt.js'), 'utf8');
    const scoreSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'score.js'), 'utf8');
    const sandbox = {
        console: { log: () => {}, warn: () => {} },
        window: {}, document: null,
        Math, JSON, Date, Error, RegExp, String, Number, Array, Object, parseFloat, parseInt, isNaN,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(scoreSrc + '\n;globalThis.ScoreCalculator = typeof ScoreCalculator !== "undefined" ? ScoreCalculator : null;', sandbox);
    vm.runInContext(src + '\n;__exports__ = { extractScore, parseStructuredResponse, normalizeScoreText, parseSubQuestionResponse };', sandbox);
    return sandbox.__exports__;
}

const { extractScore, parseStructuredResponse, normalizeScoreText, parseSubQuestionResponse } = loadPrompt();

// ---------- 全角数字 ----------
test('全角数字/小数点归一化后可解析', () => {
    assert.strictEqual(extractScore('８分', 24), 8);
    assert.strictEqual(extractScore('８.５分', 24), 8.5);
    assert.strictEqual(extractScore('得分：２４', 24), 24);
});

// ---------- 中文数字 ----------
test('中文数字（0~99）在"…分"语境下可解析', () => {
    assert.strictEqual(extractScore('八分', 24), 8);
    assert.strictEqual(extractScore('十五分', 24), 15);
    assert.strictEqual(extractScore('二十四分', 24), 24);
    assert.strictEqual(extractScore('二.五分', 24), 2.5, '混合小数变体（中文整数+小数点+中文小数）');
});

// ---------- 分数计算段回退 ----------
test('得分段提不出数时回退【分数计算】（等号/总得分，且不抓裸首数字）', () => {
    const text = '【答案复述】x\n【得分】：见计算\n【分数计算】0+4+4=8\n【评语】y';
    assert.strictEqual(parseStructuredResponse(text, 24).score, 8);

    const t2 = '【答案复述】x\n【得分】：-\n【分数计算】各小题 0+0+4，总得分4分';
    assert.strictEqual(parseStructuredResponse(t2, 24).score, 4);

    // 无等号无总得分：不得误抓算式里的小题分
    const t3 = '【答案复述】x\n【得分】：-\n【分数计算】第1题0分，第2题4分';
    assert.strictEqual(parseStructuredResponse(t3, 24).score, null);
});

// ---------- 组合变体（教师实测形态） ----------
test('【得分】为全角/中文数字时整体解析成功（#287 实测场景）', () => {
    const p1 = parseStructuredResponse('【答案复述】学生答对\n【得分】：８分\n【评分依据】ok', 24);
    assert.strictEqual(p1.score, 8);
    assert.strictEqual(p1.studentAnswer, '学生答对');

    const p2 = parseStructuredResponse('【答案复述】x\n【得分】：八分\n【评分依据】ok', 24);
    assert.strictEqual(p2.score, 8);
});

// ---------- 小题行变体（#289 二轮审计 A-5） ----------
test('小题行全角/中文数字经归一化可解析', () => {
    const text = '【答案复述】x\n【得分】：8\n【评分依据】ok\n第1题分数：８分\n第2题分数：二分';
    const r = parseSubQuestionResponse(text, {
        subQuestions: [{ id: 1, label: '第1题', maxScore: 10 }, { id: 2, label: '第2题', maxScore: 5 }]
    });
    assert.strictEqual(r.score, 8);
    assert.strictEqual(r.subScores[0].score, 8);
    assert.strictEqual(r.subScores[1].score, 2);
});

// ---------- 回归：半角行为逐值不变 ----------
test('半角数字/等号优先等既有语义逐值不变（回归）', () => {
    assert.strictEqual(extractScore('得分：4分', 24), 4);
    assert.strictEqual(extractScore('2+2=4', 24), 4, '等号结果优先');
    assert.strictEqual(extractScore('2+2=4，故得分4', 24), 4);
    assert.strictEqual(extractScore('', 24), null);
    assert.strictEqual(extractScore(null, 24), null);
    assert.strictEqual(extractScore('无数字', 24), null);
    assert.strictEqual(normalizeScoreText('abc'), 'abc');
});
