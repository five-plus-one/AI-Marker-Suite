const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./_jzsmartedu-fixture');
const { ADAPTERS, makeStub, loadOne } = require('./_adapter-matrix');

test('焦作只取当前作答，方案按考试题块分开，缓存变化不改变答卷身份', async () => {
    const f = fixture(), a = f.adapter, paper = a.getPaperIdentity(), task = a.getTaskIdentifier();
    assert.equal(a.isMarkingPage(), true);
    assert.deepEqual(Array.from(await a.gatherAnswerImages()), ['https://jzjx.jzsmartedu.cn/answers/A.png']);
    f.imageVm.showSrcList[0].src += '?cache=2'; f.image.src += '?cache=2';
    assert.equal(a.getPaperIdentity(), paper);
    f.advance('B', true);
    assert.notEqual(a.getPaperIdentity(), paper);
    assert.equal(a.getTaskIdentifier(), task);
    f.sb.location.hash = f.sb.location.hash.replace('readBlockId=block', 'readBlockId=other');
    assert.notEqual(a.getTaskIdentifier(), task);
    assert.equal(a.getPaperIdentity(), null);
});

test('焦作图片归属不明、未加载、缺业务标识时不取图', async () => {
    const changes = [f => f.imageVm.readItem = {}, f => f.image.complete = false,
        f => f.image.naturalWidth = 0, f => f.boardVm.readItem.examResultItemId = '',
        f => f.parent.cacheImageList = [], f => f.imageVm.saveFileUrl = 'other',
        f => f.imageVm.showSrcList = [], f => f.imageVm.saveFileUrlList = [{ src: 'javascript:1' }],
        f => f.state.extraImage = { getClientRects: () => [1], complete: true, naturalWidth: 10, naturalHeight: 10 }];
    for (const change of changes) {
        const f = fixture(); change(f);
        assert.equal((await f.adapter.gatherAnswerImages()).length, 0);
        assert.equal(f.adapter.fillScores([1]), false);
    }
});

test('焦作填分同步输入、原生模型和待提交分数，不发送快捷提交事件', () => {
    const f = fixture();
    assert.equal(f.adapter.fillScores([0]), true);
    assert.equal(f.input.value, '0');
    assert.equal(f.parent.scoreList[0].score, '0');
    assert.deepEqual(f.state.events, ['input', 'change']);
    assert.equal(f.state.clicks, 0);
});

test('焦作自由小数、固定档位、步长与满分边界遵循原生规则', () => {
    const f = fixture();
    for (const score of [0, 1.23, 15]) assert.equal(f.adapter.fillScores([score]), true);
    for (const score of [-1, 15.01, NaN, Infinity, '2', 1.234]) assert.equal(f.adapter.fillScores([score]), false);
    f.read.step = '0.5'; f.read.scoreValue = 1.3; f.boardVm.effectScoreList[0].fullScore = 1.3;
    for (const score of [0, 0.5, 1, 1.3]) assert.equal(f.adapter.fillScores([score]), true);
    assert.equal(f.adapter.fillScores([1.2]), false);
    f.read.scoreOptions = ['0', '0.3', '1.3'];
    assert.equal(f.adapter.fillScores([0.3]), true);
    assert.equal(f.adapter.fillScores([0.5]), false);
    f.read.step = '';
    assert.equal(f.adapter.fillScores([0]), false);
});

test('焦作输入或父组件同步失败明确拒绝提交', async () => {
    for (const property of ['dropInput', 'dropChange']) {
        const f = fixture(); f.state[property] = true;
        assert.equal(f.adapter.fillScores([2]), false);
        assert.equal(await f.adapter.submitGrade(), false);
        assert.equal(f.state.clicks, 0);
    }
});

test('焦作填分过程中换卷立即停止，不向新卷派发 change', () => {
    const f = fixture(); f.state.afterInput = () => f.advance('B');
    assert.equal(f.adapter.fillScores([2]), false);
    assert.deepEqual(f.state.events, ['input']);
    assert.equal(f.parent.scoreList[0].score, '');
    assert.equal(f.input.value, '');
});

test('焦作非单评、历史回评、批量模式和原生自动提交不填分', () => {
    const changes = [f => f.boardVm.boardType = '2', f => f.boardVm.autoSubmit = true,
        f => f.boardVm.type = 5, f => f.parent.readPaperType = '2', f => f.parent.isHistory = true,
        f => f.parent.isTrialRead = true, f => f.parent.loading = true, f => f.parent.animationIng = true,
        f => f.input.disabled = true, f => f.input.readOnly = true];
    for (const change of changes) {
        const f = fixture(); change(f);
        assert.equal(f.adapter.fillScores([2]), false);
        assert.equal(f.state.events.length, 0);
    }
});

test('焦作提交前复核任务、答卷、教师改分和给分规则', async () => {
    const changes = [f => f.advance(), f => f.input.value = '', f => f.input.value = '3',
        f => f.parent.scoreList[0].score = '3', f => f.boardVm.autoSubmit = true,
        f => f.read.step = '0.5', f => f.read.scoreOptions = [0, 1], f => f.button.disabled = true,
        f => f.sb.location.hash = '#/v2/read-paper?examPaperId=other&readBlockId=block&readPaperType=1'];
    for (const change of changes) {
        const f = fixture(); assert.equal(f.adapter.fillScores([2]), true); change(f);
        assert.equal(await f.adapter.submitGrade(), false);
        assert.equal(f.state.clicks, 0);
    }
});

test('焦作服务器确认后立即换卷仍能确认成功，每份只提交一次', async () => {
    const f = fixture(), before = f.adapter.getPaperIdentity();
    assert.equal(f.adapter.fillScores([2]), true);
    const guard = { verify: async () => {}, isCurrent: () => f.adapter.getPaperIdentity() === before };
    assert.equal(await f.adapter.submitGrade(guard), true);
    assert.equal(guard.isCurrent(), false);
    assert.equal(await f.adapter.waitForNextPaper('', { paperId: before, taskId: f.adapter.getTaskIdentifier() }), true);
    assert.equal(await f.adapter.submitGrade(guard), false);
    assert.equal(f.state.clicks, 1);
});

test('焦作已阅进度缺失时保持待核查，不猜测提交结果', async () => {
    for (const value of [null, undefined, '', -1, 0.5]) {
        const f = fixture(); f.adapter.fillScores([2]);
        f.parent.readProgressInfo.myselfReadCount = value;
        assert.equal(await f.adapter.submitGrade(), false);
        assert.equal(f.state.clicks, 0);
    }
});

test('焦作不以旧提示、禁用按钮、计数变化或不对应的得分报告成功', async () => {
    for (const mode of ['refused', 'toast-only', 'count-only', 'wrong-score']) {
        const f = fixture(); f.state.mode = mode;
        f.state.messages.push({ getClientRects: () => [1], textContent: '提交成功！2分' });
        assert.equal(f.adapter.fillScores([2]), true);
        assert.equal(await f.adapter.submitGrade(), false);
        assert.equal(f.state.clicks, 1);
        assert.equal(await f.adapter.submitGrade(), false);
    }
});

test('焦作取消、校验期间切题和并发调用停止后续动作', async () => {
    const f = fixture(); f.adapter.fillScores([2]);
    assert.equal(await f.adapter.submitGrade({ isCurrent: () => false }), false);
    assert.equal(f.state.clicks, 0);
    f.adapter.fillScores([2]);
    assert.equal(await f.adapter.submitGrade({ isCurrent: () => true, verify: async () => f.advance() }), false);
    f.adapter.fillScores([2]); f.state.mode = 'refused';
    const signal = { aborted: false }; f.state.afterClick = () => signal.aborted = true;
    assert.equal(await f.adapter.submitGrade({ isCurrent: () => true, verify: async () => {}, signal }), false);
    f.adapter.fillScores([2]); f.state.afterClick = null;
    const pending = f.adapter.submitGrade();
    assert.equal(f.adapter.fillScores([3]), false);
    assert.equal(await f.adapter.submitGrade(), false);
    assert.equal(await pending, false);
});

test('焦作等待下一份支持同图片不同业务答卷，取消及切题及时结束', async () => {
    const f = fixture(), before = f.adapter.getPaperIdentity();
    f.state.onPoll = () => f.advance('B', true);
    assert.equal(await f.adapter.waitForNextPaper(f.image.src, { paperId: before }), true);
    assert.equal(await f.adapter.waitForNextPaper('', { signal: { aborted: true } }), false);
    assert.equal(await f.adapter.waitForNextPaper('', { taskId: 'other' }), false);
});

test('焦作单页导航与延迟特征只注册一次并保留现有适配器', () => {
    const own = ADAPTERS.find(a => a.id === 'jzsmartedu').own;
    const sb = makeStub({ ...own, hash: '#/home', dom: {} });
    assert.equal(loadOne(sb, 'jzsmartedu').errors.length, 0);
    assert.equal(sb.__writes.length, 0);
    Object.assign(sb.__dom, own.dom); sb.location.hash = own.hash;
    sb.__observers[0].cb(); sb.__observers[0].cb();
    assert.equal(sb.__writes.length, 1);
    const claimed = makeStub(own); claimed.__AI_MARKER_ADAPTER__ = { id: 'existing' };
    assert.equal(loadOne(claimed, 'jzsmartedu').errors.length, 0);
    assert.equal(claimed.__AI_MARKER_ADAPTER__.id, 'existing');
    assert.equal(claimed.__writes.length, 1);
});
