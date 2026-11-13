const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./_adapter-matrix.js');

function setup(multi = false) {
    const sb = M.makeStub({ host: 'hx-webscan.tyhuixue.com', path: '/web-reviewer/', hash: '#/generalReview' });
    sb.setTimeout = (fn, ms) => setTimeout(fn, ms >= 100 ? 0 : ms);
    const visible = { getClientRects: () => [{}] };
    let submits = 0, response = 'ok', duringTick, downloads = 0;
    const units = (multi ? [4, 6] : [20]).map((score, i) => ({ markItemScoreId: 'point-' + i,
        markItemId: 'question', name: multi ? `76(${i + 1})` : '76', score,
        scoreLimite: Array.from({ length: score * 2 + 1 }, (_, n) => n / 2).join(','), value: null }));
    const p = { $options: { name: 'GeneralReview' }, $route: { query: { examId: 'exam', subjectId: 'subject', role: 'Normal' } },
        markItemId: 'question', markerId: 'teacher', selectValue: '76', scorePointList: units,
        hasImg: true, replayComment: '进入回评', count: 0, finishedCount: 0, domCountArr: [],
        $nextTick: async () => { duringTick?.(); },
        submitScoreFn: async () => {
            submits++;
            if (response === 'reject') { p.count = 1; return; }
            if (response === 'throw') throw Error('offline');
            p.finishedCount++; p.count = 0;
            if (response !== 'last') next('B'); else p.hasImg = false;
        },
    };
    Object.defineProperty(p, 'totalScore', { get: () => p.domCountArr.reduce((a, b) => a + b, 0) });
    class Input {
        constructor(index) { Object.assign(this, visible); this.index = index; this._value = ''; this.writes = 0; }
        get value() { return this._value; }
        set value(v) { this.writes++; this._value = String(v); }
        getAttribute() { return String(units[this.index].score); }
        dispatchEvent() {
            if (this.ignore) return;
            units[this.index].value = this._value === '' ? null : Number(this._value);
            p.domCountArr = units.filter(u => u.value !== null).map(u => u.value);
        }
    }
    sb.HTMLInputElement = Input;
    const inputs = units.map((_, i) => new Input(i)), images = [{ ...visible, complete: true, naturalWidth: 800, naturalHeight: 500 }];
    const button = { ...visible };
    p.$refs = { dragPaper: { querySelectorAll: () => images } };
    p.$el = { __vue__: p, querySelectorAll: () => inputs, querySelector: () => button };
    sb.document.querySelector = q => q === '.generalReview' ? p.$el : null;
    function next(id) {
        p.markEntityKey = 'mark-' + id; p.handlerEntityKey = 'handler-' + id; p.secretNumber = 'anonymous-' + id;
        p.img = [{ imgAddress: `https://huixue-source-file.huijiaoyun.com/fixture/${id}.jpg?x-tos-process=image/crop,w_800,h_500,x_1,y_2` }];
        images[0].src = p.img[0].imgAddress;
        inputs.forEach(input => { input._value = ''; }); units.forEach(u => { u.value = null; }); p.domCountArr = [];
    }
    next('A');
    sb.fetchImageAsBase64 = async () => { downloads++; return 'fixture-image'; };
    assert.deepEqual(M.loadOne(sb, 'huixue').errors, []);
    return { a: sb.__AI_MARKER_ADAPTER__, sb, p, inputs, images, next, button,
        response: v => { response = v; }, duringTick: fn => { duringTick = fn; }, submits: () => submits, downloads: () => downloads };
}

test('慧学读取题号、评分点、原生裁切图与答卷身份', async () => {
    const h = setup(true), id = h.a.getPaperIdentity();
    assert.equal(h.a.getQuestionContext().question, '76');
    assert.deepEqual(Array.from(h.a.getScoreInputs(), u => u.maxScore), [4, 6]);
    const urls = await h.a.gatherAnswerImages(); assert.match(urls[0], /x-tos-process=image\/crop/);
    const download = h.a.fetchImageAsBase64;
    assert.equal(await download(urls[0]), 'fixture-image'); assert.equal(h.downloads(), 1);
    h.next('B'); assert.notEqual(h.a.getPaperIdentity(), id); await assert.rejects(download(urls[0]), /切换/);
});
test('慧学零分、满分、半分及多评分点通过原生事件回填', () => {
    const h = setup();
    for (const score of [0, 20, 3.5]) { assert.equal(h.a.fillScores([score]), true); assert.equal(h.p.totalScore, score); }
    const m = setup(true); assert.equal(m.a.fillScores([0, 5.5]), true); assert.equal(m.p.totalScore, 5.5);
});
test('慧学非法值、数量不符和离散分档拒绝写入', () => {
    const h = setup();
    for (const score of [null, undefined, '', true, NaN, Infinity, -1, 21, 2.25, '3x']) assert.equal(h.a.fillScores([score]), false);
    for (const scores of [[], [1, 2], null]) assert.equal(h.a.fillScores(scores), false);
    assert.equal(h.inputs[0].writes, 0);
    h.p.scorePointList[0].scoreLimite = '0,5,20'; assert.equal(h.a.fillScores([3]), false);
});
test('慧学只接受正常、完整就绪的原生题块', () => {
    for (const change of [h => { h.p.isAutoSubmit = true; }, h => { h.p.customValue = true; },
        h => { h.p.fastScoreMark = true; }, h => { h.p.isClickScore = true; }, h => { h.p.hasImg = false; },
        h => { h.p.replayComment = '退出回评'; }, h => { h.p.dialogVisible = true; },
        h => { h.p.$route.query.role = 'Arbiter'; }, h => { h.sb.location.hash = '#/batchMarking'; },
        h => { h.images[0].src = 'https://example.com/old.jpg'; }, h => { h.images[0].complete = false; },
        h => { h.inputs[0].readOnly = true; }, h => { h.p.scorePointList[0].markItemId = 'other'; }]) {
        const h = setup(); change(h); assert.equal(h.a.getPaperIdentity(), null); assert.equal(h.a.fillScores([1]), false);
        assert.equal(h.inputs[0].writes, 0);
    }
});
test('慧学平台拒收输入、取图后换卷均停止提交', async () => {
    const h = setup(); h.inputs[0].ignore = true; assert.equal(h.a.fillScores([2]), false);
    assert.equal(await h.a.submitGrade(), false); assert.equal(h.submits(), 0);
    const b = setup(); await b.a.gatherAnswerImages(); b.next('B'); assert.equal(b.a.fillScores([2]), false);
});
test('慧学等待原生保存成功再继续到不同答卷', async () => {
    const h = setup(true), old = h.a.getPaperIdentity(), task = h.a.getTaskIdentifier();
    assert.equal(h.a.fillScores([2, 4.5]), true); assert.equal(await h.a.submitGrade(), true);
    assert.equal(h.submits(), 1); assert.equal(await h.a.waitForNextPaper('', { paperId: old, taskId: task }), true);
    assert.equal(await h.a.submitGrade(), false); assert.equal(h.submits(), 1);
});
test('慧学失败响应、离线、取消和提交前状态变动不会报告保存成功', async () => {
    for (const response of ['reject', 'throw']) {
        const h = setup(); h.response(response); h.a.fillScores([2]); assert.equal(await h.a.submitGrade(), false);
        assert.match(h.a.lastSubmitError, /核对/); assert.equal(await h.a.waitForNextPaper(), false);
    }
    for (const change of [h => h.next('B'), h => { h.p.isAutoSubmit = true; }, h => { h.p.scorePointList[0].value = 10; }]) {
        const h = setup(); h.a.fillScores([2]); h.duringTick(() => change(h));
        assert.equal(await h.a.submitGrade(), false); assert.equal(h.submits(), 0);
    }
    const c = setup(); c.a.fillScores([2]); assert.equal(await c.a.submitGrade({ signal: { aborted: true } }), false);
    assert.equal(c.submits(), 0);
});
test('慧学末卷可以确认保存，等待新卷支持取消及任务边界', async () => {
    const h = setup(); h.response('last'); h.a.fillScores([0]); assert.equal(await h.a.submitGrade(), true);
    assert.equal(await h.a.waitForNextPaper('', { signal: { aborted: true } }), false);
    assert.equal(await h.a.waitForNextPaper('', { taskId: 'other' }), false);
});
