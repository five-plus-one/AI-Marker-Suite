const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./_jiukexing-fixture');

test('九科星连续三卷绑定原生 ID，原生保存成功后识别已换卷（包括同 URL）', async () => {
    const f = fixture({ images: 2, units: 2 });
    for (let index = 0; index < 3; index++) {
        f.advance(String(index), index > 0);
        const urls = await f.adapter.gatherAnswerImages();
        assert.equal(urls.length, 2);
        const id = f.adapter.getPaperIdentity();
        assert.ok(f.adapter.fillScores([0, 2.5]));
        assert.ok(f.state.cancelledAuto);
        assert.deepEqual(f.state.events.slice(-2), ['input', 'input']);
        f.state.sameUrl = true;
        assert.ok(await f.adapter.submitGrade());
        assert.notEqual(f.adapter.getPaperIdentity(), id);
        assert.ok(await f.adapter.waitForNextPaper(urls[0], { paperId: id, taskId: f.adapter.getTaskIdentifier() }));
        assert.equal(f.endpoint.submitScore, f.original);
    }
    assert.equal(f.state.requests.length, 3);
    assert.equal(f.state.activityCount, 3);
});

test('九科星只在当前题块成功保存后更新原生阅卷活动', async () => {
    const f = fixture();
    for (let index = 0; index < 3; index++) {
        f.state.clock += 590000;
        assert.ok(f.adapter.fillScores([5]));
        assert.equal(f.state.activityCount || 0, index);
        assert.ok(await f.adapter.submitGrade());
        assert.equal(f.state.idleDeadline, f.state.clock + 600000);
        assert.equal(f.state.activityCount, index + 1);
    }
    for (const mode of ['validation', 'minimum-time', 'refused', 'reject', 'throw']) {
        const g = fixture(); g.state.mode = mode; assert.ok(g.adapter.fillScores([5]));
        try { await g.adapter.submitGrade(); } catch (_) {}
        assert.equal(g.state.activityCount || 0, 0);
    }
    for (const change of [g => g.sb.aiGradingState.activeRun.controller.abort(), g => { g.page.questionvalue = 'other'; }]) {
        const g = fixture(); g.state.mode = 'pending'; assert.ok(g.adapter.fillScores([5]));
        const saving = g.adapter.submitGrade(); change(g); g.state.resolve({ code: 0 });
        assert.equal(await saving, false); assert.equal(g.state.activityCount || 0, 0);
    }
});

test('九科星活动登记异常不改变已确认保存结果，锁屏显示恢复操作', async () => {
    const f = fixture(); f.state.failActivity = true; assert.ok(f.adapter.fillScores([5]));
    assert.equal(await f.adapter.submitGrade(), true); assert.equal(f.state.requests.length, 1);
    f.page.lockScreen = true; assert.equal(f.adapter.fillScores([5]), false);
    assert.match(f.adapter.lastFillError, /继续阅卷/);
    assert.equal(f.adapter.prepareGrading(), false); assert.match(f.adapter.lastFillError, /继续阅卷/);
});

test('九科星明确提交失败后通过原生弹窗重新取卷，旧分数不再提交', async () => {
    for (const samePaper of [false, true]) {
        const f = fixture(); f.state.mode = 'refresh-refused'; f.state.recoverSamePaper = samePaper;
        await f.adapter.gatherAnswerImages(); assert.ok(f.adapter.fillScores([5]));
        assert.equal(await f.adapter.submitGrade(), false);
        assert.equal(f.state.activityCount || 0, 0);
        assert.equal(await f.adapter.recoverSubmission({ isCurrent: () => true }), true);
        assert.equal(f.state.recoveryClicks, 1); assert.equal(f.state.requests.length, 1);
        assert.equal(f.inputs[0].value, ''); assert.equal(await f.adapter.submitGrade(), false);
        assert.equal(await f.adapter.recoverSubmission(), false);
        f.state.mode = 'success'; assert.ok(f.adapter.fillScores([2])); assert.ok(await f.adapter.submitGrade());
        assert.equal(f.state.requests[1].studentScore, 2); assert.equal(f.adapter._refreshRecoveryCount, 0);
    }
});

test('九科星未知结果与其他错误不自动恢复，重复失败限制两次', async () => {
    for (const mode of ['refused', 'reject']) {
        const f = fixture(); f.state.mode = mode; assert.ok(f.adapter.fillScores([5]));
        assert.equal(await f.adapter.submitGrade(), false);
        assert.equal(await f.adapter.recoverSubmission(), false); assert.equal(f.state.recoveryClicks || 0, 0);
    }
    const f = fixture(); f.state.mode = 'refresh-refused';
    for (let index = 0; index < 3; index++) {
        assert.ok(f.adapter.fillScores([5])); assert.equal(await f.adapter.submitGrade(), false);
        assert.equal(await f.adapter.recoverSubmission(), index < 2);
    }
    assert.equal(f.state.recoveryClicks, 2); assert.match(f.adapter.lastSubmitError, /连续提交失败/);
});

test('九科星恢复时取消、换题或弹窗不匹配均不继续评分', async () => {
    for (const change of [f => f.sb.aiGradingState.activeRun.controller.abort(),
        f => { f.page.questionvalue = 'other'; }, f => { f.state.recoveryMessage = '其他确认'; },
        f => { f.state.noRecoveryDialog = true; }, f => { f.state.hideRecovery = true; }]) {
        const f = fixture(); f.state.mode = 'refresh-refused'; assert.ok(f.adapter.fillScores([5]));
        assert.equal(await f.adapter.submitGrade(), false); change(f);
        assert.equal(await f.adapter.recoverSubmission(), false);
        assert.equal(f.state.recoveryClicks || 0, 0); assert.equal(f.state.requests.length, 1);
    }
    const f = fixture(); f.state.mode = 'refresh-refused'; f.state.noRefresh = true;
    assert.ok(f.adapter.fillScores([5])); assert.equal(await f.adapter.submitGrade(), false);
    assert.equal(await f.adapter.recoverSubmission(), false); assert.equal(f.state.recoveryClicks, 1);
});

test('九科星必须等原生整组图片及对应 DOM 全部加载，不能返回部分图片', async () => {
    const f = fixture({ images: 3 }); f.state.images[2].complete = false;
    f.state.onPoll = () => { if (f.state.polls === 3) f.state.images[2].complete = true; };
    assert.equal((await f.adapter.gatherAnswerImages()).length, 3);
    assert.ok(f.state.polls >= 4);
    for (const change of [g => { g.page.imgsList[0].showLoading = true; },
        g => g.state.images.pop(), g => { g.state.images[0].src += '&crop=other'; },
        g => { g.page.imgsList[0].imgUrl.pop(); }, g => { g.state.images[0].naturalWidth = 0; }]) {
        const g = fixture({ images: 2 }); change(g);
        assert.equal((await g.adapter.gatherAnswerImages()).length, 0);
    }
});

test('九科星等待图片时切题、取消、锁屏及历史阅卷均不取图', async () => {
    for (const change of [f => { f.page.questionvalue = 'other'; },
        f => f.sb.aiGradingState.activeRun.controller.abort(), f => { f.page.lockScreen = true; },
        f => { f.page.oldornew = 'old'; }]) {
        const f = fixture(); f.page.imgsList[0].showLoading = true; f.state.onPoll = () => change(f);
        assert.equal((await f.adapter.gatherAnswerImages()).length, 0);
    }
});

test('九科星单评页面的回评按钮文案不会误判模式，任务 ID 不含答卷 ID', () => {
    const f = fixture(); f.sb.document.body.textContent = '回评';
    const task = f.adapter.getTaskIdentifier(); assert.equal(f.adapter.isRegradeMode(), false);
    f.advance('other'); assert.equal(f.adapter.getTaskIdentifier(), task);
    f.page.questionvalue = 'block2'; assert.notEqual(f.adapter.getTaskIdentifier(), task);
    f.sb.location.pathname = '/task/taskDetail'; assert.equal(f.adapter.isMarkingPage(), false);
});

test('九科星鼠标评分和不可写输入框均在写入前拒绝', () => {
    for (const change of [f => { f.page.radio = 1; },
        f => { f.inputs[0].readOnly = true; }, f => { f.inputs[0].disabled = true; }]) {
        const f = fixture(); change(f); assert.equal(f.adapter.fillScores([5]), false);
        assert.equal(f.state.events.length, 0); assert.equal(f.state.requests.length, 0);
    }
});

test('九科星请求评分前关闭原生自动提交，填分前重新核验', async () => {
    const f = fixture(); f.page.checked = true;
    assert.equal(f.adapter.prepareGrading(), true);
    assert.equal(f.page.checked, false); assert.equal(f.autoSubmit.checked, false);
    assert.equal(f.state.autoClicks, 1); assert.ok(f.state.cancelledAuto);
    assert.equal(f.state.requests.length, 0); assert.equal(f.state.events.length, 0);
    await f.adapter.gatherAnswerImages();
    f.page.checked = true; f.autoSubmit.checked = true;
    assert.equal(f.adapter.fillScores([5]), true);
    assert.equal(f.state.autoClicks, 2); assert.equal(f.page.checked, false);
    assert.equal(f.state.requests.length, 0);
    assert.equal(await f.adapter.submitGrade(), true);
    assert.equal(f.state.requests.length, 1);
});

test('九科星关闭自动提交失败时保留原因，不填分也不提交', async () => {
    for (const change of [f => { f.state.noAutoControl = true; }, f => { f.autoSubmit.disabled = true; },
        f => { f.state.dropAutoClick = true; }, f => { f.autoSubmit.checked = false; }]) {
        const f = fixture(); f.page.checked = true; change(f);
        assert.equal(f.adapter.prepareGrading(), false);
        assert.match(f.adapter.lastFillError, /未能关闭.*自动提交/);
        assert.equal(f.adapter.fillScores([5]), false);
        assert.match(f.adapter.lastFillError, /未能关闭.*自动提交/);
        assert.equal(await f.adapter.submitGrade(), false);
        assert.equal(f.state.requests.length, 0); assert.equal(f.state.events.length, 0);
    }
});

test('九科星关闭自动提交期间换卷或取消运行时拒绝写分', () => {
    for (const change of [f => f.advance('B'), f => f.sb.aiGradingState.activeRun.controller.abort(),
        f => { f.page.lockScreen = true; }]) {
        const f = fixture(); f.page.checked = true; f.state.afterAutoClick = () => change(f);
        assert.equal(f.adapter.fillScores([5]), false);
        assert.equal(f.state.requests.length, 0); assert.equal(f.state.events.length, 0);
    }
});

test('九科星数值与原生步长校验，原生状态未接收分数时显式失败', async () => {
    for (const score of [NaN, Infinity, -1, 11, 0.25, '5', null]) {
        const f = fixture(); assert.equal(f.adapter.fillScores([score]), false); assert.equal(f.state.events.length, 0);
    }
    const f = fixture(); f.state.dropInput = true;
    assert.equal(f.adapter.fillScores([5]), false); assert.equal(await f.adapter.submitGrade(), false);
    assert.equal(f.state.requests.length, 0);
});

test('九科星填分期间换卷、换题、取消、替换原生评分单元均停止后续写入', async () => {
    for (const change of [f => f.advance('B'), f => { f.page.questionvalue = 'other'; },
        f => f.sb.aiGradingState.activeRun.controller.abort(),
        f => { f.page.getGradeList = f.page.getGradeList.map(unit => ({ ...unit })); }]) {
        const f = fixture({ units: 2 }); f.state.afterInput = () => change(f);
        assert.equal(f.adapter.fillScores([2, 3]), false); assert.equal(f.state.events.length, 1);
        assert.equal(await f.adapter.submitGrade(), false); assert.equal(f.state.requests.length, 0);
    }
});

test('九科星已采集答卷的身份不能在填分时被另一卷替换', async () => {
    const f = fixture(); await f.adapter.gatherAnswerImages(); f.advance('B', true);
    assert.equal(f.adapter.fillScores([5]), false); assert.equal(f.state.events.length, 0);
});

test('九科星本地校验、最短时长、平台拒绝和网络错误均不算保存成功', async () => {
    for (const mode of ['validation', 'minimum-time', 'refused', 'reject', 'throw']) {
        const f = fixture(); f.state.mode = mode; assert.ok(f.adapter.fillScores([5]));
        if (mode === 'throw') await assert.rejects(() => f.adapter.submitGrade(), /network/);
        else assert.equal(await f.adapter.submitGrade(), false);
        assert.equal(f.endpoint.submitScore, f.original);
        assert.equal(await f.adapter.submitGrade(), false); assert.equal(f.state.clicks, 1);
    }
});

test('九科星提交前再次核对答卷、原生分数、输入值及上下文', async () => {
    for (const change of [f => f.advance('B', true), f => { f.page.getGradeList[0].grade = 1; },
        f => { f.inputs[0].value = 1; }, f => { f.page.checked = true; }]) {
        const f = fixture(); assert.ok(f.adapter.fillScores([5])); change(f);
        assert.equal(await f.adapter.submitGrade(), false); assert.equal(f.state.clicks, 0);
    }
    const f = fixture(); assert.ok(f.adapter.fillScores([5]));
    assert.equal(await f.adapter.submitGrade({ isCurrent: () => true, verify: async () => f.advance('B', true) }), false);
    assert.equal(f.state.requests.length, 0);
});

test('九科星请求中的答卷、题块、总分和小题分须与本轮评分一致', async () => {
    for (const change of [p => { p.paperId = 'B'; }, p => { p.questionBlockId = 'other'; },
        p => { p.studentScore = 9; }, p => { p.childList[0].studentScore = 9; },
        p => { p.childList.reverse(); }]) {
        const f = fixture({ units: 2 }); assert.ok(f.adapter.fillScores([2, 3])); f.state.beforeSave = change;
        await assert.rejects(() => f.adapter.submitGrade(), /分数与本次评分不一致/);
        assert.equal(f.state.requests.length, 0); assert.equal(f.endpoint.submitScore, f.original);
    }
});

test('九科星保存回执等待期间不能重复提交，取消后不继续自动流程', async () => {
    const f = fixture(); f.state.mode = 'pending'; assert.ok(f.adapter.fillScores([5]));
    const saving = f.adapter.submitGrade();
    assert.equal(await f.adapter.submitGrade(), false); assert.equal(f.adapter.fillScores([2]), false);
    f.sb.aiGradingState.activeRun.controller.abort(); f.state.resolve({ code: 0 });
    assert.equal(await saving, false); assert.equal(f.state.requests.length, 1);
    assert.equal(f.endpoint.submitScore, f.original);
});

test('九科星服务端接收但图片未换卷时，等待不能把旧卷当新卷', async () => {
    const f = fixture(); f.state.mode = 'accepted-still'; await f.adapter.gatherAnswerImages();
    assert.ok(f.adapter.fillScores([0])); assert.ok(await f.adapter.submitGrade());
    assert.equal(await f.adapter.waitForNextPaper('unused'), false);
});

test('九科星遵守平台间隔梯度、满分特例和固定分值，规则变化后停止提交', async () => {
    const f = fixture(); f.page.questionObj = { enableScoreStep: 1, intervalScore: 3 };
    assert.equal(f.adapter.fillScores([5]), false); assert.equal(f.state.events.length, 0);
    assert.ok(f.adapter.fillScores([10]));
    f.page.questionObj.intervalScore = 2;
    assert.equal(await f.adapter.submitGrade(), false); assert.equal(f.state.requests.length, 0);
    f.page.questionObj = { enableScoreStep: 2, fixedScore: '0, 2, 5, 10' };
    assert.equal(f.adapter.fillScores([3]), false); assert.ok(f.adapter.fillScores([5]));
});

test('九科星旧任务绑定只匹配同考试、学科、题块和阅卷方式', () => {
    const f = fixture(); const url = 'https://marking.jkxjxw.com/marking?examId=exam&subjectId=subject&questionBlockId=block&isdp=1';
    assert.ok(f.adapter.matchesLegacyTaskIdentifier(url));
    for (const value of [url.replace('block', 'other'), url.replace('isdp=1', 'isdp=2'),
        url.replace('marking.jkxjxw.com/', 'marking.jkxjxw.com.evil.test/'), 'invalid']) {
        assert.equal(f.adapter.matchesLegacyTaskIdentifier(value), false);
    }
});
