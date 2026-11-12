const test = require('node:test');
const assert = require('node:assert/strict');
const { env, load, vm } = require('./_audit-harness');

const unreadable = () => ({ score: 0, studentAnswer: '无法辨认', answerStatus: '无法辨认' });
const readable = () => ({ score: 6, studentAnswer: 'I=3A', answerStatus: '可辨认' });

function scene() {
    const e = env();
    e.cfg.answerReview = {enabled:true,maxPending:5};
    load(e, 'src/core/main.js');
    e.sb.showAutoSubmitDialog = (...args) => e.calls.dialogs.push(args);
    return e;
}

test('无人模式无法辨认时用同一份图片和配置重试，成功后填分', async () => {
    const e = scene(); const requests = [];
    e.sb.callAIGrading = async (images, config) => {
        requests.push({ images, config });
        return requests.length === 1 ? unreadable() : readable();
    };
    await e.sb.startAutoGrading();
    assert.equal(requests.length, 2);
    assert.equal(requests[0].images, requests[1].images);
    assert.equal(requests[0].config.scoring, requests[1].config.scoring);
    assert.equal(requests[0].config.signal, requests[1].config.signal);
    assert.equal(requests[0].config.allowUnreadable, false);
    assert.equal(requests[1].config.allowUnreadable, true);
    assert.deepEqual(e.calls.fill, [{ paper: 'A', scores: [6] }]);
    assert.equal(e.calls.dialogs.length, 1);
    assert.equal(e.state.isPaused, false);
});

test('普通和试改模式保留人工核对，不自动重试无法辨认结果', async () => {
    for (const mode of ['normal', 'trial']) {
        const e = scene(); e.state.gradingMode = mode; let requests = 0;
        e.sb.callAIGrading = async () => { requests++; return unreadable(); };
        await e.sb.startAutoGrading();
        assert.equal(requests, 1);
        assert.equal(e.calls.fill.length, 0);
        assert.equal(e.state.isPaused, true);
    }
});

test('单次识别重试仍无法辨认时保留 AI 分数并标记复核，不无限重试', async () => {
    const e = scene(); const context = e.sb.createGradingContext(); let requests = 0;
    const result = await e.sb.requestGradingWithRecognitionRetry(context, async () => {
        requests++; return unreadable();
    });
    assert.equal(result._needsRecognitionReview, true); assert.equal(result.score, 0);
    assert.equal(requests, 2);
    assert.equal(e.calls.fill.length, 0);
    assert.equal(e.calls.submit.length, 0);
});

test('双评识别阶段抛出的无法辨认也进入一次重试', async () => {
    const e = scene(); const context = e.sb.createGradingContext(); let requests = 0;
    const result = await e.sb.requestGradingWithRecognitionRetry(context, async () => {
        requests++;
        if (requests === 1) e.sb.requireCompatibleGradingEvidence(unreadable(), readable());
        return readable();
    });
    assert.equal(requests, 2); assert.equal(result.score, 6);
});

test('真实双评流程在重试成功后使用新一轮结果填分', async () => {
    const e = scene();
    load(e, 'src/core/prompt.js'); load(e, 'src/core/score.js'); load(e, 'src/core/ai-engine.js');
    e.cfg.workflowId = 'test';
    e.sb.workflow = { model: {}, dualEval: { enabled: true, threshold: 2, secondary: {}, arbitration: {} } };
    e.sb.answers = [unreadable(), readable(), readable(), readable()];
    e.sb.requests = 0;
    vm.runInContext('WorkflowManager.getWorkflow = () => workflow; callAIGrading = async () => { requests++; return answers.shift(); }; ProviderManager.getCallConfig = () => ({model:"test",endpoint:"https://test",apiKey:"test"});', e.sb);
    await e.sb.startAutoGrading();
    assert.equal(e.sb.requests, 4);
    assert.deepEqual(e.calls.fill, [{ paper: 'A', scores: [6] }]);
    assert.equal(e.calls.dialogs.length, 1);
});

test('作答状态冲突、空白正分冲突和网络错误保持原错误路径', async () => {
    for (const failure of [
        e => { e.sb.requireGradingEvidence({ score: 5, studentAnswer: '未作答' }); },
        e => { e.sb.requireGradingEvidence({ score: 0, studentAnswer: '无法辨认', answerStatus: '可辨认' }); },
        () => { throw new Error('network failure'); }
    ]) {
        const e = scene(); const context = e.sb.createGradingContext(); let requests = 0;
        await assert.rejects(e.sb.requestGradingWithRecognitionRetry(context, async () => { requests++; failure(e); }));
        assert.equal(requests, 1);
    }
});

test('双评的任一侧连续无法辨认时只重试一轮，并保留合并分数供复核', async () => {
    for (const reverse of [false, true]) {
        const e = scene(); load(e, 'src/core/prompt.js'); load(e, 'src/core/score.js'); load(e, 'src/core/ai-engine.js');
        e.sb.answers = reverse ? [readable(), unreadable(), readable(), unreadable()] : [unreadable(), readable(), unreadable(), readable()];
        e.sb.requests = 0;
        vm.runInContext('callAIGrading = async () => { requests++; return answers.shift(); }; ProviderManager.getCallConfig = () => null;', e.sb);
        // 仲裁配置缺省，主副配置可用，走平台既有的双评合并规则。
        vm.runInContext('ProviderManager.getCallConfig = (provider) => provider === "arb" ? null : ({model:"test",endpoint:"https://test",apiKey:"test"});', e.sb);
        const config = { answerReview:{enabled:true}, scoring: { maxScore: 10 }, workflowSnapshot: { model: {}, dualEval: { enabled: true, threshold: 0, secondary: {}, arbitration: {provider:'arb'} } } };
        const context = e.sb.createGradingContext();
        const result = await e.sb.requestGradingWithRecognitionRetry(context, recognition => e.sb.callDualEvaluation(['IMAGE'], {...config,...recognition}));
        assert.equal(e.sb.requests, 4); assert.equal(result.score, 3); assert.equal(result._needsRecognitionReview, true);
        assert.equal(result.dualEval.result, 'average-fallback');
    }
});

test('仲裁连续无法辨认时重试整轮双评，返回有效仲裁分数供复核', async () => {
    const e = scene(); load(e, 'src/core/prompt.js'); load(e, 'src/core/score.js'); load(e, 'src/core/ai-engine.js');
    e.sb.requests = 0; e.sb.arbitrations = 0;
    vm.runInContext('callAIGrading = async () => ({...({score: requests++ % 2 ? 6 : 0}),studentAnswer:"I=3A",answerStatus:"可辨认"}); ProviderManager.getCallConfig = () => ({model:"test",endpoint:"https://test",apiKey:"test"}); callAIWithRetry = async () => { arbitrations++; return "【作答状态】无法辨认\\n【答案复述】无法辨认\\n【最终得分】2"; };', e.sb);
    const config = { answerReview:{enabled:true}, scoring: { maxScore: 10 }, workflowSnapshot: { model: {}, dualEval: { enabled: true, threshold: 0, secondary: {}, arbitration: {} } } };
    const context = e.sb.createGradingContext();
    const result = await e.sb.requestGradingWithRecognitionRetry(context, recognition => e.sb.callDualEvaluation(['IMAGE'], {...config,...recognition}));
    assert.equal(e.sb.requests, 4); assert.equal(e.sb.arbitrations, 2);
    assert.equal(result.score, 2); assert.equal(result._needsRecognitionReview, true);
});

test('识别期间暂停、换卷或换题后，不再向模型发送本轮重试', async () => {
    for (const change of [
        e => { e.state.isRunning = false; e.state.isPaused = true; e.sb.invalidateGradingRun(); },
        e => e.setPaper('B'),
        e => { e.sb.PresetManager.getTaskIdentifier = () => 'another-task'; }
    ]) {
        const e = scene(); let requests = 0;
        e.sb.callAIGrading = async () => { requests++; change(e); return unreadable(); };
        await e.sb.startAutoGrading();
        assert.equal(requests, 1);
        assert.equal(e.calls.fill.length, 0);
        assert.equal(e.calls.submit.length, 0);
    }
});

test('实验选项关闭时双评与仲裁保持单轮评分，不标记待复核', async () => {
    for (const threshold of [0,20]) {
        const e = scene(); delete e.cfg.answerReview;
        load(e, 'src/core/prompt.js'); load(e, 'src/core/score.js'); load(e, 'src/core/ai-engine.js');
        e.sb.requests=0; e.sb.arbitrations=0; e.sb.answers=[unreadable(),readable()];
        vm.runInContext('callAIGrading = async () => { requests++; return answers.shift(); }; ProviderManager.getCallConfig = () => ({model:"test",endpoint:"https://test",apiKey:"test"}); callAIWithRetry = async () => { arbitrations++; return "【作答状态】无法辨认\\n【答案复述】无法辨认\\n【最终得分】2"; };',e.sb);
        const config={scoring:{maxScore:10},workflowSnapshot:{model:{},dualEval:{enabled:true,threshold,secondary:{},arbitration:{}}}};
        const context=e.sb.createGradingContext();
        const result=await e.sb.requestGradingWithRecognitionRetry(context,recognition=>e.sb.callDualEvaluation(['IMAGE'],{...config,...recognition}));
        assert.equal(e.sb.requests,2);assert.equal(e.sb.arbitrations,threshold===0?1:0);
        assert.equal(result._needsRecognitionReview,false);assert.equal(result.score,threshold===0?2:3);
    }
});
