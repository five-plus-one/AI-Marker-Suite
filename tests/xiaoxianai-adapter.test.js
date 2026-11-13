const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./_adapter-matrix.js');

// 合成答卷：React 15 owner、原生输入事件、保存后追加历史与异步换卷。
function setup() {
    const sb = M.makeStub({ host: 'ls.xiaoxianai.cn', path: '/webPaper/newMarkPaper' });
    sb.setTimeout = (fn, ms) => setTimeout(fn, ms === 100 ? 0 : ms);
    const immutable = value => ({ size: value.length, toJS: () => structuredClone(value) });
    const history = [];
    const p = { submit() {}, getQuestion() {}, location: { ruleId: 'rule', paperInfo: { paper_uuid: 'exam' },
        questionsInfo: [{ number: '2.5', score: 6, question_config: { mode: 1, valid_scores: Array.from({ length: 13 }, (_, i) => i / 2), valid_step: .5 } }] },
        state: { questionNum: '2.5', questionIndex: -1, historyQuestionList: immutable(history), currentUuid: 'A',
            rotateDeg: 0, handleClip: 0, subjectiveQuestionAmount: 1, scoreInterval: 1 } };
    const owner = (el, instance) => { el.__reactInternalInstance$fixture = { _currentElement: { _owner: { _instance: instance } } }; return el; };
    const visible = () => ({ getClientRects: () => [{}] });
    class Input {
        constructor() { Object.assign(this, visible()); this._value = ''; this.writes = 0; }
        get value() { return this._value; }
        set value(v) { this._value = String(v); this.writes++; }
        dispatchEvent(e) { if (e.type === 'input') { row.score = this.value; row.revised = true; p.state.currentQuestionList = immutable([row]); } }
    }
    sb.HTMLInputElement = Input;
    const input = owner(new Input(), p), canvas = owner(visible(), { initCanvas() {}, props: {} });
    let row, response = 'ok', onSubmit, downloads = 0, draws = [];
    function next(id) {
        row = { id: `answer-${id}`, uuid: id, image_uuid: `image-${id}`, rule_id: 'rule', number: '2.5', total_score: 6,
            score: 0, mark_status: 0, abnormal: 0, sub_scores_config: [], update_time: id,
            images: [{ number: '2.5', urls: [`https://i3rx-registry.oss-cn-shanghai.aliyuncs.com/papers/school/exam/answers/image-${id}/2.5_0_0.jpg?Signature=one`],
                effect_range: [42, 85, 1079, 733], subject_range: [0, 1, 1421, 1206, 903] }] };
        p.state.currentUuid = id; p.state.currentQuestionList = immutable([row]);
        Object.assign(canvas.__reactInternalInstance$fixture._currentElement._owner._instance.props,
            { uuid: id, url: row.images[0].urls[0], index: 0, questionNum: 0, rotate: 0, clipValue: 0, handleClip: 0 });
        input._value = '';
    }
    next('A');
    const button = { ...visible(), click() {
        onSubmit?.();
        if (response === 'failure') { p.state.showModal = true; return; }
        if (response === 'prompt') { p.state.showStepModal = true; return; }
        if (response === 'pending') return;
        history.push(structuredClone(row)); p.state.historyQuestionList = immutable(history);
        next('B'); p.state.questionIndex = history.length - 1;
    } };
    const selectors = { 'input[class*="styles__scoreInput___"]': input, '#dragDiv': { textContent: '2.5（6分）(可拖动)' },
        '#submitDiv > div[class*="styles__submit___"]': button, '.canvasW canvas': canvas };
    sb.document.querySelector = q => selectors[q] || null;
    sb.document.querySelectorAll = q => selectors[q] ? [selectors[q]] : [];
    sb.document.createElement = () => ({ getContext: () => ({ drawImage: (...args) => draws.push(args.slice(1)) }), toDataURL: () => 'data:image/png;base64,cropped' });
    sb.Image = class { naturalWidth = 1206; naturalHeight = 903; set src(v) { queueMicrotask(() => this.onload()); } };
    sb.fetchImageAsBase64 = async () => { downloads++; return 'original'; };
    assert.deepEqual(M.loadOne(sb, 'xiaoxianai').errors, []);
    return { a: sb.__AI_MARKER_ADAPTER__, sb, p, input, canvas, button, next, row: () => row,
        sync: () => { p.state.currentQuestionList = immutable([row]); }, response: v => { response = v; },
        onSubmit: fn => { onSubmit = fn; }, draws, downloads: () => downloads, history, immutable };
}

test('小闲识别原生题号、满分与答卷身份，签名刷新不换卷', async () => {
    const h = setup(), a = h.a, old = a.getPaperIdentity();
    assert.equal(a.getQuestionContext().question, '2.5'); assert.equal(a.getScoreInputs()[0].maxScore, 6);
    assert.equal((await a.gatherAnswerImages()).length, 1);
    h.row().images[0].urls[0] = h.row().images[0].urls[0].replace('one', 'two'); h.sync();
    h.canvas.__reactInternalInstance$fixture._currentElement._owner._instance.props.url = h.row().images[0].urls[0];
    assert.equal(a.getPaperIdentity(), old); h.next('C'); assert.notEqual(a.getPaperIdentity(), old);
});
test('小闲零分、满分、半分遵循题目规则，非法分不写入', () => {
    const { a, input } = setup();
    for (const score of [null, '', true, NaN, Infinity, -1, 6.5, 2.25, '2x']) {
        assert.equal(a.fillScores([score]), false); assert.equal(input.writes, 0);
    }
    for (const scores of [[], [2, 3]]) assert.equal(a.fillScores(scores), false);
    for (const value of [0, 2.5, 6]) { assert.equal(a.fillScores([value]), true); assert.equal(input.value, String(value)); }
});
test('小闲自动提交、批量、回评、题组、异常与加载过程均暂停给分', () => {
    for (const change of [h => { h.p.state.quickGrading = true; }, h => { h.p.state.batchMode = true; },
        h => { h.p.state.questionIndex = 0; }, h => { h.p.location.questionsInfo[0].isGroup = 2; },
        h => { h.p.state.showNext = true; }, h => { h.row().abnormal = 1; h.sync(); },
        h => { h.p.state.rotateDeg = 90; }, h => { h.p.location.exam_id = 'trial'; }]) {
        const h = setup(); change(h); assert.equal(h.a.getPaperIdentity(), null); assert.equal(h.a.fillScores([3]), false); assert.equal(h.input.writes, 0);
    }
});
test('小闲校验题块路径与原生 Canvas 归属，拒绝混卷和缺失区域', () => {
    for (const change of [h => { h.row().images[0].urls[0] = h.row().images[0].urls[0].replace('image-A', 'image-C'); },
        h => { h.row().images[0].effect_range = [1, 2]; }, h => { h.row().rule_id = 'other'; },
        h => { h.canvas.__reactInternalInstance$fixture._currentElement._owner._instance.props.uuid = 'old'; }]) {
        const h = setup(); change(h); h.sync(); assert.equal(h.a.getPaperIdentity(), null);
    }
});
test('小闲独立下载并裁切原图，复用 Canvas 像素不作为新图证据', async () => {
    const h = setup(); await h.a.gatherAnswerImages();
    const url = h.row().images[0].urls[0];
    const fetchFn = h.a.fetchImageAsBase64;
    assert.equal(await fetchFn(url), 'cropped');
    assert.deepEqual(h.draws[0], [42, 85, 1079, 733, 0, 0, 1079, 733]);
    await h.a.fetchImageAsBase64(url); assert.equal(h.downloads(), 1);
    h.next('B'); await assert.rejects(h.a.fetchImageAsBase64(url), /切换/);
    await h.a.gatherAnswerImages(); await h.a.fetchImageAsBase64(h.row().images[0].urls[0]); assert.equal(h.downloads(), 2);
});
test('小闲只有原生保存后追加的同卷同分历史可以确认提交', async () => {
    const h = setup(), old = h.a.getPaperIdentity(); assert.equal(h.a.fillScores([2.5]), true);
    assert.equal(await h.a.submitGrade({ isCurrent: () => h.a.getPaperIdentity() === old }), true); assert.equal(h.history[0].score, '2.5');
    assert.equal(await h.a.waitForNextPaper(), true); assert.equal(h.downloads(), 1);
});
test('小闲平台失败、低分确认、取消与改分不会确认保存', async () => {
    for (const response of ['failure', 'prompt']) {
        const h = setup(); h.response(response); h.a.fillScores([0]); assert.equal(await h.a.submitGrade(), false); assert.equal(h.history.length, 0);
    }
    for (const change of [h => h.next('C'), h => { h.input.value = '4'; }, h => { h.row().score = 4; h.sync(); }]) {
        const h = setup(); h.a.fillScores([3]); change(h); assert.equal(await h.a.submitGrade(), false); assert.equal(h.history.length, 0);
    }
    const h = setup(), c = new AbortController(); h.a.fillScores([3]); c.abort();
    assert.equal(await h.a.submitGrade({ signal: c.signal }), false);
});
test('小闲其他答卷历史、任务切换及等待中取消不能确认本次保存', async () => {
    const h = setup(); h.a.fillScores([3]); h.onSubmit(() => { h.row().uuid = 'foreign'; });
    assert.equal(await h.a.submitGrade(), false);
    const g = setup(), c = new AbortController(); g.response('pending'); g.a.fillScores([3]);
    g.onSubmit(() => c.abort()); assert.equal(await g.a.submitGrade({ signal: c.signal }), false);
    assert.equal(await g.a.waitForNextPaper(), false);
});
module.exports = { setup };
