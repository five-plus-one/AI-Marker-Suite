const test = require('node:test');
const assert = require('node:assert/strict');
const { env, load, vm } = require('./_audit-harness');

function scene(enabled = true, mode = 'unattended') {
    const e = env(), store = {}, images = new Map();
    e.cfg.answerReview = { enabled, maxPending: 5 };
    e.state.gradingMode = mode;
    e.sb.location.origin = 'https://x.test';
    e.sb.GM_getValue = (key, fallback) => store[key] ?? fallback;
    e.sb.GM_setValue = (key, value) => { store[key] = value; };
    e.sb.savedImages = images;
    load(e, 'src/core/history.js');
    vm.runInContext('this.history = HistoryManager; this.imageStore = ImageStore; ImageStore.save = async (id, values) => savedImages.set(id, values.slice()); ImageStore.get = async id => savedImages.get(id); ImageStore.getSize = async () => ({totalBytes:0});', e.sb);
    load(e, 'src/core/main.js');
    let requests = 0;
    e.sb.callAIGrading = async () => { requests++; return { score: 7, studentAnswer: '无法辨认', answerStatus: '无法辨认' }; };
    return Object.assign(e, { store, images, requests: () => requests, records: () => JSON.parse(store['ai-grading-history'] || '[]') });
}

test('无法辨认始终暂停；默认关闭选项时沿用证据保护', async () => {
    for (const enabled of [undefined, false, 'true']) for (const mode of ['normal', 'trial', 'unattended']) {
        const e = scene(enabled, mode);
        if (enabled === undefined) delete e.cfg.answerReview;
        await e.sb.startAutoGrading();
        assert.equal(e.requests(), 1);
        assert.equal(e.calls.fill.length, 0); assert.equal(e.calls.submit.length, 0);
        assert.equal(e.records().length, 0); assert.equal(e.state.isPaused, true);
    }
});

test('开启后原图与方案先保存，普通和试改直接核对，无人只重试一次', async () => {
    for (const mode of ['normal', 'trial', 'unattended']) {
        const e = scene(true, mode); e.cfg.apiKey = 'private-test-key';
        await e.sb.startAutoGrading();
        assert.equal(e.requests(), mode === 'unattended' ? 2 : 1);
        assert.equal(e.calls.fill.length, 0); assert.equal(e.calls.submit.length, 0);
        assert.equal(e.state.isPaused, true);
        const [record] = e.records();
        assert.equal(record.reviewStatus, 'pending'); assert.equal(record.status, 'pending');
        assert.equal(record.aiScore, 7); assert.equal(record.finalScore, null);
        assert.deepEqual(Array.from(e.images.get(record.id)), ['PNG']);
        assert.deepEqual(record.configurationSnapshot.rubric, { text: 'rubric' });
        assert.equal(JSON.stringify(record).includes('private-test-key'), false);
    }
});

test('无人识别重试恢复可辨认后正常填分，保持本轮答卷基准', async () => {
    const e = scene(); let requests = 0;
    e.sb.callAIGrading = async () => ++requests === 1 ? { score: 7, answerStatus: '无法辨认' } : { score: 7, answerStatus: '可辨认', studentAnswer: 'I=3A' };
    e.sb.showAutoSubmitDialog = () => {};
    await e.sb.startAutoGrading();
    assert.equal(requests, 2); assert.equal(e.calls.fill.length, 1); assert.equal(e.records().length, 0);
});

test('达到积压上限前停止请求；写入失败、图片失败、换卷与取消均不填分', async () => {
    const capped = scene();
    capped.store['ai-grading-history'] = JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ id: String(i), reviewStatus: 'pending' })));
    await capped.sb.startAutoGrading(); assert.equal(capped.requests(), 0);
    for (const failure of ['image', 'history', 'changed', 'cancelled', 'quota']) {
        const e = scene();
        if (failure === 'image') e.sb.imageStore.save = async () => { throw Error('write failed'); };
        if (failure === 'history') e.sb.GM_setValue = () => { throw Error('quota'); };
        if (failure === 'changed') e.sb.imageStore.save = async () => e.setPaper('B');
        if (failure === 'cancelled') e.sb.imageStore.save = async () => e.sb.invalidateGradingRun();
        if (failure === 'quota') e.sb.imageStore.getSize = async () => ({ totalBytes: 50 * 1024 * 1024 });
        await e.sb.startAutoGrading();
        assert.equal(e.calls.fill.length, 0); assert.equal(e.calls.submit.length, 0); assert.equal(e.records().length, 0);
    }
});

test('同卷按原图去重，已复核记录保留；未完成记录受清理保护', async () => {
    const e = scene();
    const context = e.sb.createGradingContext(); context.imageUrls = ['https://x.test/A.png']; context.base64DataArray = ['PNG'];
    const a = await e.sb.history.savePendingReview(context, { score: 7 });
    const b = await e.sb.history.savePendingReview(context, { score: 7 });
    assert.equal(a, b); assert.equal(e.sb.history.getPendingReviewCount(), 1);
    assert.equal(e.sb.history.delete(a), false);
    await assert.rejects(() => e.sb.imageStore.clear(), /先完成/);
    e.sb.history.markReviewed(a);
    await e.sb.history.savePendingReview(context, { score: 7 });
    assert.equal(e.records().length, 2); assert.equal(e.records().find(record => record.id === a).reviewStatus, 'reviewed');
});
