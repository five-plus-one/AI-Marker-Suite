const test = require('node:test');
const assert = require('node:assert/strict');
const { env, load } = require('./_audit-harness');

function flow() {
    const e = env();
    load(e, 'src/core/main.js');
    const root = e.sb.getUIRoot;
    load(e, 'src/core/ui-button.js');
    e.sb.getUIRoot = root;
    e.sb.updateBatchProgress = () => e.calls.progress++;
    load(e, 'src/core/ui-submit-dialog.js');
    return e;
}

test('无分数最多重试五次，第六次取得有效的零分可以继续', async () => {
    for (const recovered of [false, true]) {
        const e = flow();
        let calls = 0;
        e.sb.callAIGrading = async () => ({ score: ++calls === 6 && recovered ? 0 : null });
        e.sb.showAutoSubmitDialog = () => {};
        await e.sb.startAutoGrading();
        assert.equal(calls, 6);
        assert.deepEqual(e.calls.fill.map(item => item.scores), recovered ? [[0]] : []);
        assert.equal(e.state.isPaused, !recovered);
    }
});

test('模型请求和分数解析共用重试次数，次数为零时只评分一次', async () => {
    for (const [limit, expected] of [[0, 1], [2, 2]]) {
        const e = flow();
        e.cfg.retryPolicy = { unattendedRetries: limit };
        let calls = 0;
        e.sb.callAIGrading = async (_images, config) => {
            if (++calls === 1) await config.unattendedRetryBudget.retry(0, 'network');
            return { score: null };
        };
        await e.sb.startAutoGrading();
        assert.equal(calls, expected);
        assert.equal(e.calls.fill.length, 0);
    }
});

test('页面准备、取图、填分各自使用重试次数，填分重试复用本卷原分', async () => {
    const e = flow();
    e.cfg.retryPolicy = { unattendedRetries: 1 };
    let prepare = 0, gather = 0, fill = 0, calls = 0;
    const originalGather = e.adapter.gatherAnswerImages;
    const originalFill = e.adapter.fillScores;
    e.adapter.prepareGrading = () => ++prepare > 1;
    e.adapter.gatherAnswerImages = () => ++gather > 1 ? originalGather() : [];
    e.adapter.fillScores = scores => ++fill > 1 && originalFill(scores);
    e.sb.callAIGrading = async () => { calls++; return { score: 6 }; };
    e.sb.showAutoSubmitDialog = () => {};
    await e.sb.startAutoGrading();
    assert.deepEqual([prepare, gather, fill, calls], [2, 2, 2, 1]);
    assert.deepEqual(e.calls.fill.map(item => item.scores), [[6]]);
});

test('重试期间换卷或主动暂停后，不再调用模型、填分或提交', async () => {
    for (const change of ['paper', 'pause']) {
        const e = flow();
        let calls = 0;
        e.sb.callAIGrading = async () => { calls++; return { score: null }; };
        e.sb.abortableGradingDelay = async () => {
            if (change === 'paper') e.setPaper('B');
            else e.sb.invalidateGradingRun();
        };
        await e.sb.startAutoGrading();
        assert.equal(calls, 1);
        assert.equal(e.calls.fill.length, 0);
        assert.equal(e.calls.submit.length, 0);
    }
});

test('平台确认请求未发出时才重试提交，并只登记一次成功', async () => {
    const e = flow();
    let attempts = 0;
    e.adapter.submitGrade = async guard => {
        if (++attempts < 3) {
            guard.onNotDispatched();
            return false;
        }
        return true;
    };
    const dialog = e.sb.showAutoSubmitDialog(8, '', null);
    await Promise.all([dialog.confirmSubmit(), dialog.confirmSubmit()]);
    assert.equal(attempts, 3);
    assert.equal(e.calls.history.length, 1);
    assert.equal(e.calls.progress, 1);
});

test('提交回执未知时复查五次，停留在旧卷时继续也不会重评或重发', async () => {
    const e = flow();
    let retries = 0;
    e.adapter.submitGrade = async () => { e.calls.submit.push('A'); return false; };
    e.sb.abortableGradingDelay = async () => { retries++; };
    const dialog = e.sb.showAutoSubmitDialog(8, '', null);
    await dialog.confirmSubmit();
    assert.equal(retries, 5);
    assert.equal(e.calls.submit.length, 1);
    assert.equal(e.calls.history.length, 0);
    assert.equal(e.state.isPaused, true);
    e.state.isPaused = false;
    e.state.isRunning = true;
    e.sb.callAIGrading = async () => assert.fail('仍在原卷时不得重新请求');
    await e.sb.startAutoGrading();
    assert.equal(e.calls.submit.length, 1);
    assert.equal(e.calls.fill.length, 0);
});

test('提交确认后换卷默认等待六轮，换卷完成后才继续', async () => {
    const e = flow();
    let waits = 0;
    e.adapter.waitForNextPaper = async () => {
        if (++waits !== 6) return false;
        e.setPaper('B');
        return true;
    };
    const dialog = e.sb.showAutoSubmitDialog(8, '', null);
    await dialog.confirmSubmit();
    assert.equal(waits, 6);
    assert.equal(e.calls.submit.length, 1);
    assert.equal(e.state.pendingGradingPaper, null);
    assert.equal(e.state.isRunning, true);
});
