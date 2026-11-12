const test = require('node:test');
const assert = require('node:assert/strict');
const { env, load, vm } = require('./_audit-harness');

function scene(limit = 5) {
    const e = env(), store = {}, images = new Map();
    e.cfg.unattendedReview = { maxPending: limit };
    e.sb.location.origin = 'https://x.test';
    e.sb.GM_getValue = (key, fallback) => store[key] ?? fallback;
    e.sb.GM_setValue = (key, value) => { store[key] = value; };
    e.sb.savedImages = images;
    load(e, 'src/core/history.js');
    vm.runInContext('this.history = HistoryManager; ImageStore.save = async (id, values) => savedImages.set(id, values.slice()); ImageStore.get = async id => savedImages.get(id);', e.sb);
    load(e, 'src/core/main.js'); load(e, 'src/core/ui-submit-dialog.js');
    e.sb.updateBatchProgress = () => e.calls.progress++;
    e.sb.stopAutoGrading = () => { e.sb.invalidateGradingRun(); e.state.isRunning = false; e.state.isPaused = true; };
    e.sb.callAIGrading = async () => ({ score: 7, studentAnswer: '无法辨认', answerStatus: '无法辨认' });
    return Object.assign(e, { store, images, records: () => JSON.parse(store['ai-grading-history'] || '[]') });
}

test('无人模式保存原图和评分方案后填入 AI 分数，原生提交成功后才记录最终分数', async () => {
    const e = scene(); e.state.saveImages = false; e.cfg.apiKey = 'private-test-key'; e.cfg.outputMode = 'score-only';
    await e.sb.startAutoGrading();
    let records = e.records();
    assert.equal(records.length, 1); assert.equal(records[0].reviewStatus, 'pending');
    assert.equal(records[0].aiScore, 7); assert.equal(records[0].finalScore, null);
    assert.deepEqual(records[0].configurationSnapshot.rubric, { text: 'rubric' });
    assert.equal(records[0].outputMode, 'score-only'); assert.equal(JSON.stringify(records).includes('private-test-key'), false);
    assert.deepEqual(Array.from(e.images.get(records[0].id)), ['PNG']);
    assert.deepEqual(e.calls.fill, [{ paper: 'A', scores: [7] }]);
    await e.ids.get('auto-submit-dialog').confirmSubmit(); records = e.records();
    assert.equal(records.length, 1); assert.equal(records[0].finalScore, 7);
    assert.equal(records[0].status, 'submitted'); assert.equal(records[0].reviewStatus, 'pending');
    assert.equal(e.calls.progress, 1); assert.equal(e.state.isPaused, false);
});

test('设为零时首份待复核卷提交后暂停；等于阈值仍继续，超过才暂停', async () => {
    for (const limit of [0, 1, 5]) {
        const e = scene(limit);
        for (let index = 0; index <= limit; index++) {
            e.setPaper('paper-' + index);
            await e.sb.startAutoGrading();
            await e.ids.get('auto-submit-dialog').confirmSubmit();
            assert.equal(e.state.isPaused, index === limit);
            assert.equal(e.state.gradingMode, 'unattended');
        }
        assert.equal(e.calls.submit.length, limit + 1);
        assert.equal(e.sb.history.getPendingReviewCount(), limit + 1);
        await e.sb.startAutoGrading(); assert.equal(e.calls.submit.length, limit + 1);
    }
});

test('同一卷重试仅保留一条待复核记录，缺少原生卷号时按图片去重', async () => {
    for (const nativeId of [true, false]) {
        const e = scene(); if (!nativeId) delete e.adapter.getPaperIdentity;
        for (let i = 0; i < 2; i++) { await e.sb.startAutoGrading(); }
        assert.equal(e.records().length, 1); assert.equal(e.sb.history.getPendingReviewCount(), 1);
    }
});

test('平台提交失败保留待复核原图与待提交状态，不增加批阅进度', async () => {
    const e = scene(); e.adapter.submitGrade = async () => false;
    await e.sb.startAutoGrading(); await e.ids.get('auto-submit-dialog').confirmSubmit();
    const record = e.records()[0];
    assert.equal(record.finalScore, null); assert.equal(record.status, 'pending');
    assert.equal(e.calls.progress, 0); assert.equal(e.state.isPaused, true);
    assert.deepEqual(Array.from(e.images.get(record.id)), ['PNG']);
});

test('记录或图片保存失败时不填分、不提交', async () => {
    for (const failure of ['image', 'metadata']) {
        const e = scene();
        if (failure === 'image') vm.runInContext('ImageStore.save = async () => { throw Error("quota"); };', e.sb);
        else e.sb.GM_setValue = () => { throw Error('quota'); };
        await e.sb.startAutoGrading();
        assert.equal(e.calls.fill.length, 0); assert.equal(e.calls.submit.length, 0);
        assert.equal(e.state.isPaused, true);
    }
});

test('待复核数量跨刷新保留，完成复核后减少且支持恢复待复核', async () => {
    const e = scene(); await e.sb.startAutoGrading(); const id = e.records()[0].id;
    e.sb.history.records = [];
    assert.equal(e.sb.history.getPendingReviewCount(), 1);
    e.sb.history.markReviewed(id); assert.equal(e.sb.history.getPendingReviewCount(), 0);
    e.sb.history.markReviewed(id, false); assert.equal(e.sb.history.getPendingReviewCount(), 1);
    // 另一页面保存常规历史，不得覆盖新加入或已完成的复核状态。
    e.sb.history.records = [{ id: 'normal', timestamp: Date.now() }]; e.sb.history.save();
    assert.equal(e.sb.history.getPendingReviewCount(), 1);
    e.sb.history.markReviewed(id);
    e.sb.history.records = [{ id, reviewKey: 'stale', reviewStatus: 'pending' }]; e.sb.history.save();
    assert.equal(e.sb.history.getPendingReviewCount(), 0);
    e.sb.history.records = []; e.sb.history.save();
    assert.equal(e.records().find(record => record.id === id).reviewStatus, 'reviewed');
});

test('模型没有有效分数时不能借待复核通道补零提交', async () => {
    for (const score of [null, undefined, '', NaN, Infinity]) {
        const e = scene(); e.sb.callAIGrading = async () => ({ score, answerStatus: '无法辨认' });
        await e.sb.startAutoGrading();
        assert.equal(e.calls.fill.length, 0); assert.equal(e.calls.submit.length, 0); assert.equal(e.records().length, 0);
        assert.equal(e.state.isPaused, true);
    }
});

test('暂停或换题发生在保存原图期间时，不填分和提交', async () => {
    for (const change of [
        e => { e.sb.invalidateGradingRun(); e.state.isRunning = false; e.state.isPaused = true; },
        e => { e.sb.PresetManager.getTaskIdentifier = () => 'another-task'; }
    ]) {
        const e = scene();
        e.sb.change = () => change(e);
        vm.runInContext('ImageStore.save = async (id, images) => { savedImages.set(id,images.slice()); change(); };', e.sb);
        await e.sb.startAutoGrading();
        assert.equal(e.calls.fill.length, 0); assert.equal(e.calls.submit.length, 0); assert.equal(e.records().length, 0);
    }
});

test('未复核记录和原图保留到完成复核后，删除检查读取最新状态', async () => {
    const e = scene(); await e.sb.startAutoGrading(); const id = e.records()[0].id;
    e.sb.history.records = [];
    assert.equal(e.sb.history.delete(id), false); assert.equal(e.sb.history.getPendingReviewCount(), 1);
    e.sb.history.markReviewed(id); e.sb.history.delete(id);
    assert.equal(e.records().length, 0);
});

test('允许待复核数量保留零值，缺省和无效值采用默认值', () => {
    const e = scene();
    for (const value of [0, 1, 5, 1000]) assert.equal(e.sb.getPendingReviewLimit({unattendedReview:{maxPending:value}}), value);
    for (const value of [undefined, null, '', -1, 1.5, 1001, '0']) assert.equal(e.sb.getPendingReviewLimit({unattendedReview:{maxPending:value}}), 5);
});

test('方案迁移和导入保留允许数量零值，为旧方案补齐默认数量', () => {
    const e = env(); e.sb.GM_getValue = (key, fallback) => fallback; e.sb.GM_setValue = () => {};
    load(e, 'src/core/preset.js'); vm.runInContext('this.pm = PresetManager', e.sb);
    e.sb.pm.data.list = { old: {}, zero: {unattendedReview:{maxPending:0}}, malformed: {unattendedReview:{maxPending:'0'}} };
    e.sb.pm.migrateAll();
    assert.equal(e.sb.pm.data.list.old.unattendedReview.maxPending, 5);
    assert.equal(e.sb.pm.data.list.zero.unattendedReview.maxPending, 0);
    assert.equal(e.sb.pm.data.list.malformed.unattendedReview.maxPending, 5);
    const imported = e.sb.pm.sanitizePreset(JSON.parse(JSON.stringify(e.sb.pm.data.list.zero)));
    assert.equal(imported.unattendedReview.maxPending, 0);
});
