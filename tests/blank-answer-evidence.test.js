const test = require('node:test');
const assert = require('node:assert/strict');
const { env, load, vm } = require('./_audit-harness');

test('模型明确未作答时，三种模式均填入零分并保留原始识别结论', async () => {
    for (const mode of ['normal', 'trial', 'unattended']) for (const outputMode of ['detailed', 'score-only']) for (const multi of [false, true]) {
        const e = env(); e.state.gradingMode = mode; e.cfg.outputMode = outputMode;
        e.cfg.answer = { text: '催化剂只改变化学反应速率，不改变生成物的质量' };
        e.cfg.rubric = { text: '每个要点1分' };
        load(e, 'src/core/prompt.js'); load(e, 'src/core/score.js'); load(e, 'src/core/main.js');
        if (multi) { e.cfg.scoring.units = [{ label: '1', maxScore: 4 }, { label: '2', maxScore: 6 }]; }
        e.sb.response = '【作答状态】未作答\n【答案复述】未作答\n【分数计算】\n1分数：0\n2分数：0\n【得分】0';
        e.sb.scoringUnits = e.cfg.scoring.units;
        e.sb.parsed = vm.runInContext(multi ? 'parseSubQuestionResponse(response, {subQuestions:scoringUnits,scoring:{maxScore:10}})' : 'parseStructuredResponse(response, 10)', e.sb);
        let requests = 0;
        e.sb.callAIGrading = async () => { requests++; return e.sb.parsed; };
        e.sb.showAutoSubmitDialog = (...args) => e.calls.dialogs.push(args);
        await e.sb.startAutoGrading();
        assert.equal(requests, 1); assert.equal(e.state.isPaused, false);
        assert.equal(e.calls.fill.length, 1); assert.equal(e.calls.fill[0].scores[0], 0);
        assert.equal(e.calls.fill[0].scores.length, multi ? 2 : 1);
        assert.equal(e.calls.dialogs.length, 1); assert.equal(e.calls.history.length, 0);
        assert.equal(e.state.currentStudentAnswer, '未作答');
    }
});

test('未作答却给正分的冲突不会走无人模式待复核自动提交通道', async () => {
    for (const mode of ['normal', 'trial', 'unattended']) {
        const e = env(); e.state.gradingMode = mode;
        e.cfg.answerReview = {enabled:true,maxPending:5};
        load(e, 'src/core/main.js'); let requests = 0;
        e.sb.callAIGrading = async () => { requests++; return { score: 10, answerStatus: '未作答', studentAnswer: '未作答' }; };
        await e.sb.startAutoGrading();
        assert.equal(requests, 1); assert.equal(e.state.isPaused, true);
        assert.equal(e.calls.fill.length, 0); assert.equal(e.calls.submit.length, 0); assert.equal(e.calls.history.length, 0);
    }
});

test('参考答案与正确学生答案相同时，不以文本相似度更改分数', () => {
    const e = env();
    assert.doesNotThrow(() => e.sb.requireGradingEvidence({ score: 1, answerStatus: '可辨认', studentAnswer: '猪肝块' }));
});
