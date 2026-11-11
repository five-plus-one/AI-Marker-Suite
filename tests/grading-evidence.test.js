const test = require('node:test');
const assert = require('node:assert/strict');
const { env, load, read, vm } = require('./_audit-harness');

test('全部评分提示词在题目文字为空时仍说明参考图用途及空白作答规则', () => {
    const e = env(); load(e, 'src/core/prompt.js');
    const config = { question: '', answer: { text: '', images: ['REF'] }, rubric: '逐项给分', scoring: { maxScore: 10 },
        subQuestions: [{ label: '13', id: 'a', maxScore: 10 }] };
    for (const outputMode of ['detailed', 'score-only']) {
        e.sb.cfg = { ...config, outputMode };
        for (const code of ['buildStructuredPrompt(cfg)', 'buildSubQuestionPrompt(cfg)',
            'buildArbitrationPrompt(cfg, {score:0}, {score:5}, 2)', 'buildPrompt(cfg)']) {
            const prompt = vm.runInContext(code, e.sb);
            assert.match(prompt, /参考答案配图/); assert.match(prompt, /印刷题干/);
            assert.match(prompt, /得分必须为0/); assert.match(prompt, /不得自行解题/);
            if (outputMode === 'score-only' && /^build(?:Structured|SubQuestion)Prompt/.test(code)) assert.doesNotMatch(prompt, /【答案复述】/);
        }
    }
});

test('明确整卷未作答与正分冲突时，真实主流程暂停且不填分', async () => {
    const e = env(); load(e, 'src/core/main.js'); e.state.isRunning = true;
    e.sb.callAIGrading = async () => ({ score: 5, rawScore: 5, studentAnswer: '未作答', _sections: { '答案复述': '未作答' } });
    await e.sb.startAutoGrading();
    assert.equal(e.calls.fill.length, 0); assert.equal(e.calls.submit.length, 0); assert.equal(e.state.isPaused, true);
    assert.ok(e.calls.toasts.some(text => text.includes('未作答，却给出了正分')));
});

test('评分准备失败时主流程在调用模型前停止，并显示具体原因', async () => {
    const e = env(); load(e, 'src/core/main.js'); e.state.isRunning = true;
    let requests = 0;
    e.sb.__AI_MARKER_ADAPTER__.prepareGrading = () => {
        e.sb.__AI_MARKER_ADAPTER__.lastFillError = '未能关闭九科星的“自动提交”，请取消勾选后继续';
        return false;
    };
    e.sb.callAIGrading = async () => { requests++; return { score: 5 }; };
    await e.sb.startAutoGrading();
    assert.equal(requests, 0); assert.equal(e.calls.fill.length, 0); assert.equal(e.calls.submit.length, 0);
    assert.equal(e.state.isPaused, true);
    assert.ok(e.calls.toasts.some(text => text.includes('未能关闭九科星')));
});

test('评分准备成功后主流程才请求模型，填分失败保留适配器原因', async () => {
    const e = env(); load(e, 'src/core/main.js'); e.state.isRunning = true;
    const order = [];
    e.sb.__AI_MARKER_ADAPTER__.prepareGrading = () => { order.push('prepare'); return true; };
    e.sb.callAIGrading = async () => { order.push('ai'); return { score: 5, studentAnswer: 'I=3A' }; };
    e.sb.__AI_MARKER_ADAPTER__.fillScores = () => {
        e.sb.__AI_MARKER_ADAPTER__.lastFillError = '未能关闭九科星的“自动提交”，请取消勾选后继续';
        return false;
    };
    await e.sb.startAutoGrading();
    assert.deepEqual(order, ['prepare', 'ai']); assert.equal(e.calls.submit.length, 0);
    assert.ok(e.calls.toasts.some(text => text.includes('未能关闭九科星')));
});

test('原生提交失败恢复后不增加进度或历史，新轮次重新评分', async () => {
    for (const recovered of [true, false]) {
        const e = env(); load(e, 'src/core/main.js'); load(e, 'src/core/ui-submit-dialog.js');
        e.state.currentImageUrls = ['https://x.test/A.png']; e.state.currentBase64DataArray = ['PNG'];
        e.adapter.submitGrade = async () => false;
        let recoveries = 0, newRuns = 0;
        e.adapter.recoverSubmission = async guard => { recoveries++; assert.ok(guard.isCurrent()); e.setPaper('B'); return recovered; };
        e.sb.startAutoGrading = () => newRuns++;
        const dialog = e.sb.showAutoSubmitDialog(5, '', null);
        await dialog.confirmSubmit();
        assert.equal(recoveries, 1); assert.equal(e.calls.progress, 0); assert.equal(e.calls.history.length, 0);
        for (const callback of [...e.timeouts.values()]) callback();
        assert.equal(newRuns, recovered ? 1 : 0); assert.equal(e.state.isPaused, !recovered);
    }
});

test('提交恢复期间主动暂停后不开始新轮次', async () => {
    const e = env(); load(e, 'src/core/main.js'); load(e, 'src/core/ui-submit-dialog.js');
    e.adapter.submitGrade = async () => false;
    let newRuns = 0;
    e.adapter.recoverSubmission = async guard => {
        e.state.activeRun.controller.abort();
        e.state.isRunning = false; e.state.isPaused = true;
        assert.equal(guard.isCurrent(), false);
        return true;
    };
    e.sb.startAutoGrading = () => newRuns++;
    await e.sb.showAutoSubmitDialog(5, '', null).confirmSubmit();
    for (const callback of [...e.timeouts.values()]) callback();
    assert.equal(newRuns, 0); assert.equal(e.calls.progress, 0); assert.equal(e.calls.history.length, 0);
});

test('试改提交失败保留人工核对，不自动重新评分', async () => {
    const e = env(); load(e, 'src/core/main.js'); load(e, 'src/core/ui-submit-dialog.js');
    e.state.gradingMode = 'trial'; e.adapter.submitGrade = async () => false;
    let recoveries = 0;
    e.adapter.recoverSubmission = async () => { recoveries++; return true; };
    await e.sb.showAutoSubmitDialog(5, '', null).confirmSubmit();
    assert.equal(recoveries, 0); assert.equal(e.state.isPaused, true);
    assert.equal(e.calls.progress, 0); assert.equal(e.calls.history.length, 0);
});

test('部分小题空白、答案“无”、无法识别及精简输出均不能据此判整卷空白', () => {
    const e = env();
    for (const studentAnswer of ['无', '未能识别', '第1小题未作答，第2小题I=3A', '未作答的部分不给分，已写I=3A', '']) {
        assert.equal(e.sb.isExplicitlyBlankGradingResult({ studentAnswer }), false);
    }
    assert.ok(e.sb.isExplicitlyBlankGradingResult({ studentAnswer: '整张答卷未作答。' }));
});

test('新任务标识继承唯一有效旧绑定，保留新绑定且不猜测冲突绑定', () => {
    for (const bindings of [{ old: 'physics' }, { old: 'physics', newer: 'math' }, { old: 'physics', old2: 'math' }]) {
        const e = env(); let saves = 0;
        e.sb.__AI_MARKER_ADAPTER__.getTaskIdentifier = () => 'newer';
        e.sb.__AI_MARKER_ADAPTER__.matchesLegacyTaskIdentifier = key => key.startsWith('old');
        const method = read('src/core/preset.js').match(/    getTaskIdentifier\(\) \{[\s\S]*?\n    \},/)[0];
        vm.runInContext('testManager = {' + method + '};', e.sb);
        const manager = e.sb.testManager;
        manager.data = { bindings: { ...bindings }, list: { physics: {}, math: {} } }; manager.save = () => saves++;
        assert.equal(manager.getTaskIdentifier(), 'newer');
        assert.equal(manager.data.bindings.newer, Object.keys(bindings).length === 1 ? 'physics' : bindings.newer);
        assert.equal(saves, Object.keys(bindings).length === 1 ? 1 : 0);
    }
});

test('确认窗口使用本轮图片字节，保存历史仍保留原始来源和图片快照', async () => {
    const e = env(); load(e, 'src/core/main.js'); load(e, 'src/core/ui-submit-dialog.js');
    e.state.currentImageUrls = ['https://x.test/live.png']; e.state.currentBase64DataArray = ['FROZEN'];
    const dialog = e.sb.showAutoSubmitDialog(5, '', null);
    assert.ok(dialog.innerHTML.includes('src="data:image/png;base64,FROZEN"'));
    assert.ok(!dialog.innerHTML.includes('src="https://x.test/live.png"'));
    e.state.currentBase64DataArray = ['LATER'];
    await dialog.confirmSubmit();
    assert.equal(e.calls.history.length, 1);
    assert.deepEqual(Array.from(e.calls.history[0].imageUrls), ['https://x.test/live.png']);
    assert.deepEqual(Array.from(e.calls.history[0].imageBase64s), ['FROZEN']);
});
