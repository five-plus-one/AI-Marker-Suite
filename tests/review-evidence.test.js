const test = require('node:test');
const assert = require('node:assert/strict');
const { env, load, vm } = require('./_audit-harness');

function scene(enabled = true, mode = 'unattended') {
    const e = env(), store = {}, images = new Map();
    e.cfg.answerReview = { enabled, maxPending: 5 };
    e.cfg.answerStatusCheck = true;
    e.cfg.retryPolicy = { unattendedAnswerFailure: 'recover' };
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
        assert.equal(e.requests(), mode === 'unattended' ? 6 : 1);
        assert.equal(e.calls.fill.length, 0); assert.equal(e.calls.submit.length, 0);
        assert.equal(e.records().length, 0); assert.equal(e.state.isPaused, true);
    }
});

test('开启后原图与方案保存待核对，无人模式用完重试预算才暂停', async () => {
    for (const mode of ['normal', 'trial', 'unattended']) {
        const e = scene(true, mode); e.cfg.apiKey = 'private-test-key';
        await e.sb.startAutoGrading();
        assert.equal(e.requests(), mode === 'unattended' ? 6 : 1);
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

test('待复核上限只挡新增记录；写入失败、图片失败、换卷与取消均不填分', async () => {
    const capped = scene();
    capped.store['ai-grading-history'] = JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ id: String(i), reviewStatus: 'pending' })));
    await capped.sb.startAutoGrading();
    assert.equal(capped.requests(), 6);
    assert.equal(capped.calls.fill.length, 0);
    assert.equal(capped.records().length, 5);
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

test('无人模式只用学生原图复查，确认空白后走正常的零分提交路径', async () => {
    const e = scene(false), grade = e.sb.callAIGrading;
    load(e, 'src/core/prompt.js');
    e.sb.callAIGrading = grade;
    e.cfg.question = { text: '![带作答的配图](ai-img://0)', images: ['REFERENCE'], format: 'markdown' };
    const dialogs = [];
    e.sb.showAutoSubmitDialog = (...args) => dialogs.push(args);
    e.sb.callAIWithRetry = async (prompt, images, config, onStreamUpdate, references) => {
        assert.match(prompt, /难以辨认的笔迹/);
        assert.deepEqual(Array.from(images), ['PNG']);
        assert.deepEqual(Array.from(references), []);
        return '空白';
    };
    await e.sb.startAutoGrading();
    assert.equal(e.requests(), 1);
    assert.deepEqual(e.calls.fill.map(call => call.scores), [[0]]);
    assert.equal(dialogs[0][0], 0);
    assert.equal(dialogs[0][3].answerStatus, 'blank');
    assert.equal(e.state.isPaused, false);
});

test('无人模式单次复查发现作答后重评，复查期间换卷则停止填分', async () => {
    for (const changed of [false, true]) {
        const e = scene(false);
        let requests = 0, recoveries = 0;
        e.sb.callAIGrading = async () => ++requests === 1
            ? { score: 0, answerStatus: '无法辨认' }
            : { score: 2, answerStatus: '可辨认', studentAnswer: 'I=3A' };
        e.sb.confirmStudentAnswerStatus = async () => {
            recoveries++;
            if (changed) e.setPaper('B');
            return changed ? 'blank' : 'written';
        };
        e.sb.showAutoSubmitDialog = () => {};
        await e.sb.startAutoGrading();
        assert.equal(recoveries, 1);
        assert.equal(requests, changed ? 1 : 2);
        assert.deepEqual(e.calls.fill.map(call => call.scores), changed ? [] : [[2]]);
    }
});

test('无人模式待复核额度已满时，仍继续批改可辨认卷和已确认的空白卷', async () => {
    for (const blank of [false, true]) {
        const e = scene(), grade = e.sb.callAIGrading;
        load(e, 'src/core/prompt.js');
        e.sb.callAIGrading = grade;
        e.store['ai-grading-history'] = JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ id: String(i), reviewStatus: 'pending' })));
        if (blank) e.sb.confirmStudentAnswerStatus = async () => 'blank';
        else e.sb.callAIGrading = async () => ({ score: 2, answerStatus: '可辨认', studentAnswer: 'I=3A' });
        e.sb.showAutoSubmitDialog = () => {};
        await e.sb.startAutoGrading();
        assert.deepEqual(e.calls.fill.map(call => call.scores), [[blank ? 0 : 2]]);
        assert.equal(e.records().length, 5);
        assert.equal(e.state.isPaused, false);
    }
});

test('立即暂停策略保留待复核记录并跳过无人复查和重评', async () => {
    const e = scene();
    e.cfg.retryPolicy = { unattendedAnswerFailure: 'pause' };
    let recoveries = 0;
    e.sb.confirmStudentAnswerStatus = async () => { recoveries++; return 'blank'; };
    await e.sb.startAutoGrading();
    assert.equal(e.requests(), 1);
    assert.equal(recoveries, 0);
    assert.equal(e.records()[0].reviewStatus, 'pending');
    assert.equal(e.calls.fill.length, 0);
    assert.equal(e.state.isPaused, true);
});

test('无人重试按方案次数执行，成功即停止，耗尽时暂停', async () => {
    for (const [policy, succeeds, expectedChecks] of [['retry', true, 0], ['recover', false, 3]]) {
        const e = scene();
        e.cfg.retryPolicy = { unattendedAnswerFailure: policy, unattendedAnswerRetries: 3 };
        let attempts = 0, checks = 0;
        e.sb.callAIGrading = async () => (++attempts === 3 && succeeds)
            ? { score: 5, answerStatus: '可辨认', studentAnswer: 'f(1)=0' }
            : { score: null, answerStatus: '无法辨认' };
        e.sb.confirmStudentAnswerStatus = async () => { checks++; return 'written'; };
        e.sb.showAutoSubmitDialog = () => {};
        await e.sb.startAutoGrading();
        assert.equal(checks, expectedChecks);
        assert.equal(attempts, succeeds ? 3 : 4);
        assert.deepEqual(e.calls.fill.map(call => call.scores), succeeds ? [[5]] : []);
        assert.equal(e.state.isPaused, !succeeds);
    }
});

test('直接重试仅在无人模式使用，换卷或取消后停止请求和填分', async () => {
    for (const scenario of ['normal', 'trial', 'paper-changed', 'cancelled']) {
        const e = scene(false, ['normal', 'trial'].includes(scenario) ? scenario : 'unattended');
        e.cfg.retryPolicy = { unattendedAnswerFailure: 'retry', unattendedAnswerRetries: 5 };
        let attempts = 0;
        e.sb.callAIGrading = async () => {
            attempts++;
            if (scenario === 'paper-changed') e.setPaper('B');
            if (scenario === 'cancelled') e.sb.invalidateGradingRun();
            return { score: 0, answerStatus: '无法辨认' };
        };
        await e.sb.startAutoGrading();
        assert.equal(attempts, 1, scenario);
        assert.equal(e.calls.fill.length, 0, scenario);
        assert.equal(e.calls.submit.length, 0, scenario);
    }
});

test('逐问核对遇到不完整答卷时跳过空白卡判定', async () => {
    const e = scene(false);
    e.cfg.questionEvidence = { enabled: true };
    e.cfg.blankDetection = { enabled: true };
    e.sb.filterUsableImagesForAI = images => ({ kept: images, removed: [{ index: 1, reason: 'invalid' }] });
    let blankChecks = 0;
    e.sb.BlankDetector = { loadReference: () => { blankChecks++; return null; } };
    await e.sb.startAutoGrading();
    assert.equal(blankChecks, 0);
    assert.equal(e.calls.fill.length, 0);
    assert.equal(e.calls.submit.length, 0);
});

test('逐问评分填入平台原生小题，只有一个分数框时仅填合计', async () => {
    for (const totalOnly of [false, true]) {
        const e = scene(false);
        const subScores = [4, 1, 0].map((score, i) => ({
            id: 'q' + (i + 1), label: '第' + (i + 1) + '问', score, maxScore: [4, 6, 7][i], confirmedBlank: i === 2
        }));
        e.cfg.scoring = { maxScore: 17, roundStep: 1, units: totalOnly ? [{ label: '19', maxScore: 17 }] : subScores };
        e.sb.PresetManager.getMaxScore = () => 17;
        load(e, 'src/core/score.js');
        e.sb.callAIGrading = async () => ({ score: 5, rawScore: 5, studentAnswer: 'f(1)=0',
            subScores, scopedQuestionsTotalOnly: totalOnly, comment: '逐问结果' });
        const dialogs = [];
        e.sb.showAutoSubmitDialog = (...args) => dialogs.push(args);
        await e.sb.startAutoGrading();
        assert.deepEqual(e.calls.fill.map(call => call.scores), totalOnly ? [[5]] : [[4, 1, 0]]);
        assert.equal(dialogs[0][2]?.length ?? 0, totalOnly ? 0 : 3);
    }
});

test('总分框遵守平台步长和作答上限，题号与状态标签不计入勤勉字数', async () => {
    const e = scene(false);
    load(e, 'src/core/score.js');
    e.cfg.scoring = { roundStep: 0.5, units: [{ label: '19', maxScore: 10, roundStep: 1 }],
        diligence: { enabled: true, maxBonus: 3, decayPower: 1 } };
    e.sb.callAIGrading = async () => ({ score: 2.5, rawScore: 2.5, answerLength: 4, diligenceLevel: 5,
        studentAnswer: '第一小问（方法证明）：I=3A\n第二小问（计算结论）：[未作答]',
        subScores: [{ score: 2.5, maxScore: 2.5, roundStep: 0.5 }, { score: 0, maxScore: 7.5, confirmedBlank: true }],
        scopedQuestionsTotalOnly: true, _sections: { '分数计算': '2.5 + 0 = 2.5' } });
    const dialogs = [];
    e.sb.showAutoSubmitDialog = (...args) => dialogs.push(args);
    await e.sb.startAutoGrading();
    assert.deepEqual(e.calls.fill.map(call => call.scores), [[2]]);
    assert.equal(dialogs[0][3].diligence.level, 0);
    assert.equal(dialogs[0][3].scoringDetails['分数计算'], '2.5 + 0 = 2.5 分，折合总分 2 分');
});

test('逐问核对确认的空白小问不参与勤勉加分', () => {
    const e = scene(false);
    load(e, 'src/core/score.js');
    const result = vm.runInContext(`ScoreCalculator.calculate({
        aiScore: 5, diligenceLevel: 5, maxScore: 17,
        scoringConfig: { roundStep: 1, diligence: { enabled: true, maxBonus: 3, decayPower: 1 } },
        aiUnitScores: [{ score: 4, maxScore: 4 }, { score: 1, maxScore: 6 }, { score: 0, maxScore: 7, confirmedBlank: true }]
    })`, e.sb);
    assert.ok(result.bonus > 0);
    assert.equal(result.finalUnitScores[2].score, 0);
    assert.equal(result.finalUnitScores[1].score, 1 + result.bonus);
});
