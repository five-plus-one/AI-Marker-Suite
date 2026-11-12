const test = require('node:test');
const assert = require('node:assert/strict');
const { env, load, vm } = require('./_audit-harness');

async function runResponse(text, outputMode = 'detailed', gradingMode = 'unattended') {
    const e = env(); load(e, 'src/core/prompt.js'); load(e, 'src/core/main.js'); load(e, 'src/core/ui-submit-dialog.js');
    e.cfg.outputMode = outputMode; e.state.gradingMode = gradingMode; e.sb.response = text;
    const parsed = vm.runInContext('parseStructuredResponse(response, 10)', e.sb);
    let calls = 0; e.sb.callAIGrading = async () => { calls++; return parsed; };
    await e.sb.startAutoGrading();
    return { e, parsed, calls };
}

test('叙述式整卷空白正分在真实主流程填分前暂停', async () => {
    const { e, calls } = await runResponse('【答案复述】该学生未作答，图中只有印刷题干和预印电路图。\n【得分】10');
    assert.equal(e.calls.fill.length, 0); assert.equal(e.state.isPaused, true); assert.equal(calls, 1);
});

test('普通与试改模式明确无法辨认时交教师核对，详细和精简模式一致', async () => {
    for (const gradingMode of ['normal', 'trial']) for (const mode of ['detailed', 'score-only']) for (const score of [0, 10]) {
        const { e, calls } = await runResponse(`【作答状态】无法辨认\n【得分】${score}`, mode, gradingMode);
        assert.equal(e.calls.fill.length, 0); assert.equal(e.calls.submit.length, 0);
        assert.equal(e.state.isPaused, true); assert.equal(calls, 1);
    }
    const { e } = await runResponse('【答案复述】未能识别\n【得分】10', 'detailed', 'normal');
    assert.equal(e.calls.fill.length, 0);
});

test('结构化状态与原始复述冲突时暂停，模型不能用可辨认覆盖明确空白', async () => {
    for (const [status, answer, score] of [['可辨认', '未作答', 10], ['未作答', 'I=3A', 0]]) {
        const { e } = await runResponse(`【作答状态】${status}\n【答案复述】${answer}\n【得分】${score}`);
        assert.equal(e.calls.fill.length, 0); assert.equal(e.state.isPaused, true);
    }
});

test('部分不清、局部未作答、正常短答案及缺省精简输出保持兼容，不强制改成零分', async () => {
    for (const text of [
        '【作答状态】部分不清\n【答案复述】(1)I=3A；(2)[无法辨认]\n【得分】1',
        '【答案复述】(1)未作答；(2)答案是无\n【得分】1',
        '【答案复述】无\n【得分】1',
        '【得分】1',
        '1'
    ]) {
        const { e } = await runResponse(text, 'score-only');
        assert.equal(e.calls.fill.length, 1, text); assert.equal(e.state.isPaused, false, text);
    }
});

test('双评空白冲突对主副顺序与分差阈值均不敏感，停止前仅使用原来两次调用', async () => {
    for (const reverse of [false, true]) for (const threshold of [0, 2, 20]) {
        const e = env(); load(e, 'src/core/prompt.js'); load(e, 'src/core/score.js'); load(e, 'src/core/ai-engine.js');
        e.sb.answers = [{ score: 1, studentAnswer: 'I=3A', _sections: { '作答状态': '可辨认', '答案复述': 'I=3A' } },
            { score: 0, studentAnswer: '未作答', _sections: { '作答状态': '未作答', '答案复述': '未作答' } }];
        if (reverse) e.sb.answers.reverse();
        e.sb.calls = 0;
        vm.runInContext('callAIGrading = async () => { calls++; return answers.shift(); }; ProviderManager.getCallConfig = () => ({model:"test",endpoint:"https://test",apiKey:"test"});', e.sb);
        const cfg = { scoring: { maxScore: 10 }, workflowSnapshot: { model: {}, dualEval: { enabled: true, threshold, secondary: {}, arbitration: {} } } };
        await assert.rejects(() => e.sb.callDualEvaluation(['IMAGE'], cfg), /分歧/);
        assert.equal(e.sb.calls, 2);
    }
});

test('仲裁保留自己的识别答案及状态，不沿用主模型原文', async () => {
    const e = env(); load(e, 'src/core/prompt.js'); load(e, 'src/core/score.js'); load(e, 'src/core/ai-engine.js');
    e.sb.answers = [{ score: 0, studentAnswer: 'I=2A' }, { score: 5, studentAnswer: 'I=3A' }];
    vm.runInContext('callAIGrading = async () => answers.shift(); ProviderManager.getCallConfig = () => ({model:"test",endpoint:"https://test",apiKey:"test"}); callAIWithRetry = async () => "【作答状态】可辨认\\n【答案复述】原卷I=3A\\n【最终得分】1";', e.sb);
    const result = await e.sb.callDualEvaluation(['IMAGE'], { scoring: { maxScore: 10 }, workflowSnapshot: { model: {}, dualEval: { enabled: true, threshold: 0, secondary: {}, arbitration: {} } } });
    assert.equal(result.studentAnswer, '原卷I=3A'); assert.equal(result.answerStatus, '可辨认');
});

test('普通、精简和多小题评分要求状态，详细模式逐字转录并引用作答依据', () => {
    const e = env(); load(e, 'src/core/prompt.js');
    e.sb.cfg = { scoring: { maxScore: 10 }, answer: '参考', rubric: '评分', subQuestions: [{ label: '13', maxScore: 10 }] };
    for (const outputMode of ['detailed', 'score-only']) {
        e.sb.cfg.outputMode = outputMode;
        for (const name of ['buildStructuredPrompt(cfg)', 'buildSubQuestionPrompt(cfg)']) {
            const prompt = vm.runInContext(name, e.sb);
            assert.match(prompt, /【作答状态】/); assert.match(prompt, /完整正确的等价方法/);
            if (outputMode === 'detailed') { assert.match(prompt, /逐字转录/); assert.match(prompt, /对应作答原文/); }
            else assert.doesNotMatch(prompt, /【答案复述】/);
        }
    }
});
