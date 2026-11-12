const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./_wentongyun-fixture');
const { ADAPTERS, makeStub, loadOne } = require('./_adapter-matrix');

test('文通云识别原生一键给分单元、满分与题号', async () => {
    const f = fixture(), a = f.adapter;
    assert.equal(a.isMarkingPage(), true);
    assert.equal(await a.detectMarkingPage(), true);
    assert.equal(a.getScoreInputs()[0].element, f.board);
    assert.equal(a.getScoreInputs()[0].maxScore, 4);
    assert.deepEqual(JSON.parse(JSON.stringify(a.getQuestionContext())), { question: '20', units: [{ label: '20', maxScore: 4 }] });
});

test('文通云保留 OSS 裁剪，忽略缓存时间戳，业务标识变化才是新卷', async () => {
    const f = fixture(), a = f.adapter, before = a.getPaperIdentity(), task = a.getTaskIdentifier();
    const url = (await a.gatherAnswerImages())[0];
    assert.match(url, /x-oss-process=image\/crop,x_20,y_30,w_981,h_242/);
    f.parent.questionQetailsData[0].questionUrl = f.image.src = f.image.currentSrc = url.replace('1794483221835', '1794483221999');
    assert.equal(a.getPaperIdentity(), before);
    f.advance('B', true);
    assert.notEqual(a.getPaperIdentity(), before);
    assert.equal(a.getTaskIdentifier(), task);
});

test('文通云图片未齐备、模型与图片不同卷及未知图片域名停止取图填分', async () => {
    for (const change of [f => f.image.complete = false, f => f.image.naturalWidth = 0,
        f => f.image.src = 'https://static.wtjy.com/old.jpg', f => f.image.currentSrc = 'https://static.wtjy.com/old.jpg',
        f => f.parent.scanRecordId = 'old', f => f.parent.questionQetailsData[0].id = '',
        f => f.parent.workloadData.readCount = NaN,
        f => f.parent.questionQetailsData[0].questionUrl = 'https://other.example/card.jpg',
        f => f.state.extraImage = { ...f.image }, f => f.parent.loading = true, f => f.boardVm.loading = true]) {
        const f = fixture(); change(f);
        assert.equal((await f.adapter.gatherAnswerImages()).length, 0);
        assert.equal(f.adapter.fillScores([2]), false);
        assert.equal(await f.adapter.submitGrade(), false);
        assert.equal(f.state.clicks, 0);
    }
});

test('文通云答卷详情计数与教师已阅进度独立，已有进度与连续阅卷均可识别', async () => {
    const f = fixture();
    f.parent.workloadData.readCount = 17;
    f.parent.questionQetailsData[0].readCount = '0';
    assert.equal(f.adapter.isMarkingPage(), true);
    const before = f.adapter.getPaperIdentity();
    assert.equal(f.adapter.fillScores([2]), true);
    assert.equal(await f.adapter.submitGrade(), true);
    assert.equal(f.parent.workloadData.readCount, 18);
    f.parent.questionQetailsData[0].readCount = '0';
    assert.equal(await f.adapter.waitForNextPaper(null, { paperId: before }), true);
    assert.equal(f.adapter.fillScores([3]), true);
    assert.equal(await f.adapter.submitGrade(), true);
    assert.equal(f.parent.workloadData.readCount, 19);
    assert.equal(f.state.clicks, 2);
});

test('文通云各合法档位含零分只暂存，提交阶段一次原生点击并确认保存', async () => {
    for (const score of [0, 1, 2, 3, 4]) {
        const f = fixture(), before = f.adapter.getPaperIdentity();
        assert.equal(f.adapter.fillScores([score]), true);
        assert.equal(f.state.clicks, 0);
        assert.equal(f.parent.workloadData.readCount, 0);
        assert.equal(await f.adapter.submitGrade(), true);
        assert.equal(f.state.clicks, 1);
        assert.equal(f.parent.scoreBoard[0].score, score);
        assert.equal(await f.adapter.submitGrade(), false);
        assert.equal(await f.adapter.waitForNextPaper(null, { paperId: before }), true);
        assert.equal(await f.adapter.waitForNextPaper(), true);
    }
});

test('文通云遵循实际给分档位，非法分数不能提交先前暂存分数', async () => {
    for (const score of [-1, 5, 1.5, NaN, Infinity, '2', null]) {
        const f = fixture(); assert.equal(f.adapter.fillScores([2]), true);
        assert.equal(f.adapter.fillScores([score]), false);
        assert.equal(await f.adapter.submitGrade(), false);
        assert.equal(f.state.clicks, 0);
    }
    const f = fixture(); f.boardVm.gradeList[1] = 0.5; f.palette[1].textContent = '0.5分';
    assert.equal(f.adapter.fillScores([0.5]), true);
    assert.equal(await f.adapter.submitGrade(), true);
});

test('文通云原生分数与按钮不一致时不检测评分单元', () => {
    for (const change of [f => f.boardVm.gradeList = [0, 4], f => f.palette[0].textContent = '1分',
        f => f.parent.questionCommonData.score = '4', f => f.boardVm.gradeList[0] = NaN,
        f => f.palette[0].classList.contains = () => true]) {
        const f = fixture(); change(f);
        assert.equal(f.adapter.getScoreInputs().length, 0);
        assert.equal(f.adapter.fillScores([2]), false);
    }
});

test('文通云换卷、换题、评分档位或原生组件变更后不提交暂存分数', async () => {
    for (const change of [f => f.advance(), f => f.sb.location.hash += '&questionNum=21',
        f => f.sb.location.hash = f.sb.location.hash.replace('questionNum=20', 'questionNum=21'),
        f => f.parent.queryData.isClass = '1', f => f.boardVm.gradeList[1] = 0.5,
        f => f.parent.$refs.scoreBoard = {}, f => f.parent.questionQetailsData = [{ ...f.parent.questionQetailsData[0] }]]) {
        const f = fixture(); f.adapter.fillScores([2]); change(f);
        assert.equal(await f.adapter.submitGrade(), false);
        assert.equal(f.state.clicks, 0);
    }
});

test('文通云守卫校验期间换卷或取消不点击分数按钮', async () => {
    const f = fixture(); f.adapter.fillScores([2]);
    assert.equal(await f.adapter.submitGrade({ isCurrent: () => true, verify: async () => f.advance() }), false);
    assert.equal(f.state.clicks, 0);
    f.adapter.fillScores([2]);
    assert.equal(await f.adapter.submitGrade({ isCurrent: () => false }), false);
    assert.equal(f.state.clicks, 0);
});

test('文通云提交失败重新取卷、无响应、分数或提交对象错误均不算保存成功', async () => {
    for (const mode of ['reload-on-error', 'timeout', 'wrong-score', 'wrong-paper', 'error']) {
        const f = fixture(); f.state.mode = mode; f.adapter.fillScores([2]);
        assert.equal(await f.adapter.submitGrade(), false, mode);
        assert.equal(f.state.clicks, 1);
    }
});

test('文通云延迟保存等到原生已阅量增长，重复提交被阻止', async () => {
    const f = fixture(); f.state.mode = 'delay';
    f.state.onPoll = () => { if (f.state.polls === 3) { f.parent.workloadData.readCount++; f.advance(); } };
    f.adapter.fillScores([2]); const result = f.adapter.submitGrade();
    assert.equal(f.adapter.fillScores([3]), false);
    assert.equal(await f.adapter.submitGrade(), false);
    assert.equal(await result, true);
    assert.equal(f.state.clicks, 1);
});

test('文通云试评、复查、多题、批注、仲裁与原生弹窗不参与自动提交', () => {
    for (const change of [f => f.parent.isTemp = true, f => f.parent.reviewStatus = true,
        f => f.parent.scoreType = 2, f => f.parent.questionQetailsData.push({}),
        f => f.parent.questionCommonData.markType = 99, f => f.parent.questionCommonData.pointList = [{}],
        f => f.parent.questionCommonData.questionNumList.push('21'), f => f.parent.questionQetailsData[0].hasThird = 1,
        f => f.parent.questionQetailsData[0].studentScore = 0, f => f.parent.questionQetailsData[0].isRemark = 1,
        f => f.parent.queryData.reviewBoolean = 'true', f => f.parent.isRotate = true,
        f => f.parent.clipImage = true, f => f.state.blocked = true]) {
        const f = fixture(); change(f);
        assert.equal(f.adapter.fillScores([2]), false);
        assert.equal(f.state.clicks, 0);
    }
});

test('文通云同卷重取、加载过渡及仅缓存变化不误报换卷', async () => {
    const f = fixture(), old = f.adapter.getPaperIdentity(), url = f.image.src;
    assert.equal(await f.adapter.waitForNextPaper(url, { paperId: old }), false);
    f.image.src = f.image.currentSrc = f.parent.questionQetailsData[0].questionUrl = url.replace('1794483221835', '1794483221999');
    assert.equal(await f.adapter.waitForNextPaper(url), false);
    f.state.onPoll = () => { f.advance(); f.image.complete = false; };
    assert.equal(await f.adapter.waitForNextPaper(url, { paperId: old }), false);
    f.image.complete = true; f.state.onPoll = null;
    assert.equal(await f.adapter.waitForNextPaper(url, { paperId: old }), true);
});

test('文通云换卷等待响应取消与换任务', async () => {
    const f = fixture(), old = f.adapter.getPaperIdentity(), taskId = f.adapter.getTaskIdentifier();
    assert.equal(await f.adapter.waitForNextPaper(null, { paperId: old, signal: { aborted: true } }), false);
    f.sb.location.hash = f.sb.location.hash.replace('sheetDetailId=sheet', 'sheetDetailId=other');
    assert.equal(await f.adapter.waitForNextPaper(null, { paperId: old, taskId }), false);
    assert.equal(await f.adapter.waitForNextPaper(null, { paperId: old }), false);
});

test('文通云同卷裁剪变化使暂存失效，但不能充当下一份答卷', async () => {
    const f = fixture(), old = f.adapter.getPaperIdentity();
    assert.equal(f.adapter.fillScores([2]), true);
    const changed = f.image.src.replace('x_20', 'x_30');
    f.image.src = f.image.currentSrc = f.parent.questionQetailsData[0].questionUrl = changed;
    assert.notEqual(f.adapter.getPaperIdentity(), old);
    assert.equal(await f.adapter.submitGrade(), false);
    assert.equal(f.state.clicks, 0);
    assert.equal(await f.adapter.waitForNextPaper(null, { paperId: old }), false);
    assert.equal(await f.adapter.waitForNextPaper(null, { paperId: 'invalid' }), false);
});

test('文通云从首页延迟进入阅卷才注册，并保留其他已注册适配器', () => {
    const form = ADAPTERS.find(a => a.id === 'wentongyun').own;
    const sb = makeStub({ ...form, hash: '#/dashboard/grade/teacher' });
    assert.equal(loadOne(sb, 'wentongyun').winner, null);
    sb.location.hash = form.hash; sb.__observers.forEach(o => o.cb());
    assert.equal(sb.__AI_MARKER_ADAPTER__.id, 'wentongyun');
    const other = makeStub(form), existing = { id: 'existing' };
    other.__AI_MARKER_ADAPTER__ = existing;
    loadOne(other, 'wentongyun');
    assert.equal(other.__AI_MARKER_ADAPTER__, existing);
});
