const test = require('node:test');
const assert = require('node:assert/strict');
const { env, load, settle, vm } = require('./_audit-harness');

function flow(mode) {
    const e = env();
    e.adapter.id = 'zhixue';
    e.cfg.retryPolicy = { unattendedRetries: 0 };
    e.state.gradingMode = mode;
    load(e, 'src/core/main.js');
    const root = e.sb.getUIRoot;
    load(e, 'src/core/ui-button.js');
    e.sb.getUIRoot = root;
    load(e, 'src/core/ui-submit-dialog.js');
    const requests = [];
    e.sb.callAIGrading = async () => {
        requests.push(e.sb.__AI_MARKER_ADAPTER__.getPaperIdentity());
        return { score: 6, studentAnswer: '合成答卷' };
    };
    const start = async () => {
        e.state.isRunning = true;
        e.state.isPaused = false;
        await e.sb.startAutoGrading();
        return e.ids.get('auto-submit-dialog');
    };
    return { ...e, requests, start };
}

test('智学网作业准备时补记迟到题号，已保存旧卷和暂缺题号均不能进入评分', async () => {
    const e = flow('unattended');
    e.sb.location.pathname = '/tfbWowbookWeb/';
    e.sb.location.hash = '#/smarthw/?hwId=hw&classId=class';
    e.sb.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
    load(e, 'src/core/marking-paper.js');
    load(e, 'src/adapters/zhixue/homework.js');
    const adapter = vm.runInContext('ZhixueHomeworkAdapter', e.sb);
    const image = { src: 'https://example.test/A.png', complete: true, naturalWidth: 10, naturalHeight: 10, getClientRects: () => [{}] };
    const view = {
        hwId: 'hw', curClassId: 'class', curStudentItem: { studentId: 'A' },
        curTopicItem: { standardScore: 10 }, loading: true, cutImageList: [image.src],
        $el: { querySelectorAll: () => [image] }
    };
    const waits = [];
    const nativeWait = adapter.waitForNextPaper;
    e.sb.__AI_MARKER_ADAPTER__ = Object.assign(adapter, {
        _view: () => view, isMarkingPage: () => true, getScoreInputs: () => [{ maxScore: 10 }],
        fetchImageAsBase64: e.adapter.fetchImageAsBase64,
        fillScores: e.adapter.fillScores,
        submitGrade: e.adapter.submitGrade,
        async waitForNextPaper(url, guard) {
            waits.push(guard.taskId);
            return waits.length > 1 && nativeWait.call(this, url, guard);
        }
    });
    e.sb.PresetManager.getTaskIdentifier = () => adapter.getTaskIdentifier();
    const topic = { childQuestionId: '11', standardScore: 10 };
    e.sb.abortableGradingDelay = async () => {
        view.curTopicItem = topic;
        view.loading = false;
    };
    const firstDialog = await e.start();
    assert.ok(firstDialog, e.calls.toasts.join('\n'));
    const task = adapter.getTaskIdentifier();
    const first = adapter.getPaperIdentity();
    assert.equal(e.state.activeRun.taskId, task);
    assert.equal(e.state.gradingTaskId, task);
    await firstDialog.confirmSubmit();
    assert.deepEqual(waits, [task]);
    assert.equal(e.state.isPaused, true);
    assert.equal(e.state.pendingGradingPaper.paperId, first);

    view.curTopicItem = { standardScore: 10 };
    assert.equal(await e.start(), undefined);
    view.curTopicItem = topic;
    assert.equal(await e.start(), undefined);
    assert.deepEqual(e.requests, [first]);
    assert.deepEqual(e.calls.submit, ['A']);

    view.curStudentItem = { studentId: 'B' };
    view.cutImageList = ['https://example.test/B.png'];
    assert.equal(await e.start(), undefined, '换人后仍显示旧图片');
    image.src = view.cutImageList[0];
    const second = adapter.getPaperIdentity();
    const resumed = e.start();
    await settle();
    assert.deepEqual(waits, [task, task]);
    assert.ok(e.timeouts.size);
    for (const [id, tick] of e.timeouts) { e.timeouts.delete(id); tick(); }
    assert.ok(await resumed);
    assert.deepEqual(waits, [task, task]);
    assert.deepEqual(e.requests, [first, second]);
    assert.deepEqual(e.calls.submit, ['A']);
});

test('智学网考试普通和试改确认提交后，切换方案也保留旧卷保护', async () => {
    for (const mode of ['normal', 'trial']) {
        const e = flow(mode);
        const task = () => 'exam-31';
        e.adapter.getGradingTaskIdentifier = task;
        e.sb.PresetManager.getTaskIdentifier = task;
        e.adapter.prepareQuotaContinuation = () => assert.fail('由原站用户选择继续多阅');
        let waits = 0;
        e.adapter.waitForNextPaper = async (_url, guard) => {
            assert.equal(guard.paperId, 'A');
            if (++waits === 1) {
                guard.onWaitObserved({ reason: 'zhixue-quota-prompt' });
                return false;
            }
            return e.adapter.getPaperIdentity() === 'B';
        };

        const dialog = await e.start();
        assert.equal(!!dialog.countdownTimer, mode === 'normal');
        assert.deepEqual(e.calls.submit, []);
        await dialog.confirmSubmit();
        assert.equal(e.state.isPaused, true);
        assert.deepEqual(e.calls.submit, ['A']);

        e.sb.PresetManager.data.active = 'another-preset';
        assert.equal(await e.start(), undefined);
        assert.deepEqual(e.requests, ['A']);
        assert.deepEqual(e.calls.submit, ['A']);
        e.setPaper('mixed');
        assert.equal(await e.start(), undefined, '仅身份变化不足以认定换卷');
        e.setPaper('B');
        const nextDialog = await e.start();
        assert.deepEqual(e.requests, ['A', 'B']);
        assert.deepEqual(e.calls.submit, ['A']);
        assert.equal(!!nextDialog.countdownTimer, mode === 'normal');
    }
});

test('智学网换卷间隙暂停后仍核对已提交答卷，切题停止当前方案', async () => {
    const e = flow('normal');
    let task = 'exam-31';
    e.adapter.getGradingTaskIdentifier = () => task;
    e.sb.PresetManager.getTaskIdentifier = () => task;
    e.adapter.waitForNextPaper = async () => { e.setPaper('B'); return true; };
    const dialog = await e.start();
    await dialog.confirmSubmit();
    e.setPaper('A');
    assert.equal(await e.start(), undefined);
    assert.deepEqual(e.requests, ['A']);

    task = 'exam-32';
    assert.equal(await e.start(), undefined);
    assert.equal(e.state.isRunning, false);
    assert.ok(e.calls.toasts.some(text => text.includes('当前题目已切换')));
    assert.deepEqual(e.calls.submit, ['A']);
    assert.deepEqual(e.requests, ['A']);
});
