const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./_adapter-matrix.js');

function setup({ multi = false, single = false, nativeProgress = false } = {}) {
    const sb = M.makeStub({ host: 'xinluolk.fjjxhl.com', path: '/lypaper/Base/lyReadPaper.aspx' });
    sb.setTimeout = fn => setTimeout(fn, 0);
    const w = sb;
    w.location.origin = 'https://xinluolk.fjjxhl.com';
    w.location.href = w.location.origin + '/lypaper/Base/lyReadPaper.aspx';
    const visible = { getClientRects: () => [{}] }, elements = {};
    const value = (id, val) => { elements[id] = { value: String(val), textContent: String(val) }; };
    for (const [id, val] of Object.entries({ examsub: 7000805, examtea: '001', teaid: 5006188, xmid: 7000234,
        pingyueti: '29-1', pingyuefen: 4, scores: 4, teaname_: '29-1', autohuiche: '' })) value(id, val);
    elements.autohuiche.checked = false;
    elements.autohuiche.removeAttribute = () => {};
    Object.assign(w, { gettype: 1, xmod: 0, jianfen: 0, fbgf: 0, xzbj: 0, isSwitchPaper: false,
        paperrowid: '1', teapos: 1, pjsign: single ? 0 : 1, xmode: 0, scopart: '', teapics: 'fixture', leastViewTime: 0 });
    let selected, calls = 0, response = 'ok', changeData, pendingOptions, nativeCallbacks = 0, reads = 0;
    class Input {
        constructor(i, max) { Object.assign(this, visible); this.id = 'fenshu' + i; this.name = String(max); this.max = max; this._value = ''; this.writes = 0; }
        get value() { return this._value; }
        set value(v) { this.writes++; this._value = String(v); }
        getAttribute() { return String(this.max); }
        focus() { selected = this; }
    }
    w.HTMLInputElement = Input;
    const inputs = (multi ? [1, 3] : [4]).map((max, i) => { value('btag' + i, '00' + (i + 1)); return new Input(i, max); });
    const images = [{ ...visible, src: w.location.origin + '/lypaper/Base/lyImage.aspx?type=jpeg&p=paper1&imgcut=fixture',
        complete: true, naturalWidth: 1497, naturalHeight: 215 }];
    w.document = { ...sb.document, getElementById: id => elements[id] || null,
        querySelectorAll: q => q === '#xtlist input.fenshu' ? inputs : q === '#myimg img.teaimg' ? images : [] };
    w.sumscore = () => { w.total = inputs.reduce((n, el) => n + Number(el.value), 0); };
    function next(id) { w.paperrowid = id; images[0].src = w.location.origin + '/lypaper/Base/lyImage.aspx?type=jpeg&p=paper' + id; inputs.forEach(el => { el._value = ''; }); }
    w.jQuery = Object.assign(el => ({ get: () => el }), { active: 0, ajax(options) {
        pendingOptions = options;
        if (!/action=putpaper/.test(options.url)) { reads++; return; }
        calls++;
        if (response === 'error') { options.error('offline'); options.complete(); return; }
        if (response === 'null') { options.success(null); options.complete(); return; }
        if (response === 'defer') return;
        const id = response === 'ok' ? '2' : response === 'last' ? '-2' : response;
        options.success({ id }); options.complete();
    } });
    elements.submitbtn = { ...visible, click() {
        assert.equal(selected, inputs.at(-1), '原生按钮需最后一个评分点获得焦点');
        const data = { examsub: elements.examsub.value, examtea: elements.examtea.value, teaid: elements.teaid.value,
            id: String(w.paperrowid), teapos: String(w.teapos), pjsign: String(w.pjsign), gettype: String(w.gettype),
            scores: String(inputs.reduce((n, el) => n + Number(el.value), 0)), xt: inputs.map(el => el.value).join(',') };
        changeData?.(data);
        if (nativeProgress) w.jQuery.active++;
        w.jQuery.ajax({ url: 'lyGetData.aspx?action=' + (w.pjsign === 0 ? 'putpaper' : 'putpaper2'), data,
            success(result) { nativeCallbacks++; if (result.id === '-2' || /^[1-9]\d*$/.test(result.id)) next(result.id); } });
        if (nativeProgress) w.jQuery.active--;
    } };
    sb.fetchImageAsBase64 = async () => 'fixture-image';
    assert.deepEqual(M.loadOne(sb, 'xiangshangxue').errors, []);
    return { a: sb.__AI_MARKER_ADAPTER__, sb, w, elements, inputs, images, visible, next,
        response(v) { response = v; }, change(fn) { changeData = fn; }, calls: () => calls, callbacks: () => nativeCallbacks,
        pending: () => pendingOptions, reads: () => reads };
}
async function fill(h, scores = [2]) { await h.a.gatherAnswerImages(); assert.equal(h.a.prepareGrading(), true); return h.a.fillScores(scores); }

test('享尚学读取本题评分点、裁切图和答卷身份', async () => {
    {
        const h = setup({ multi: true });
        assert.equal(h.a.isMarkingPage(), true);
        assert.equal(h.a.getQuestionContext().question, '29-1');
        assert.deepEqual(Array.from(h.a.getScoreInputs(), s => s.maxScore), [1, 3]);
        const urls = await h.a.gatherAnswerImages(); assert.match(urls[0], /lyImage.aspx.*imgcut/);
        const download = h.a.fetchImageAsBase64;
        assert.equal(await download(urls[0]), 'fixture-image');
        h.next('3'); await assert.rejects(download(urls[0]), /切换/);
    }
});
test('享尚学零分、满分、小数与多点评分回填原生合计', async () => {
    const h = setup();
    for (const n of [0, 4, 2.5, 1.25]) { assert.equal(await fill(h, [n]), true); assert.equal(h.w.total, n); }
    const m = setup({ multi: true }); assert.equal(await fill(m, [0, 2.5]), true); assert.equal(m.w.total, 2.5);
    assert.equal(h.calls(), 0); assert.equal(m.calls(), 0);
});
test('享尚学自动提交关闭，非法分数和数量在写入前失败', async () => {
    const h = setup(); h.elements.autohuiche.checked = true; assert.equal(h.a.prepareGrading(), true);
    assert.equal(h.elements.autohuiche.checked, false); await h.a.gatherAnswerImages();
    for (const score of [null, undefined, '', true, '2', NaN, Infinity, -1, 4.01, 1.234]) assert.equal(h.a.fillScores([score]), false);
    for (const scores of [[], [1, 2], null]) assert.equal(h.a.fillScores(scores), false);
    assert.equal(h.inputs[0].writes, 0);
    h.w.scopart = '0,2,4'; await h.a.gatherAnswerImages(); assert.equal(h.a.fillScores([1]), false); assert.equal(h.a.fillScores([2]), true);
    h.elements.disxiaoshu = { checked: true }; await h.a.gatherAnswerImages(); assert.equal(h.a.fillScores([1.5]), false);
});
test('享尚学切题、换卷、输入栏重建均不能写入旧结果', async () => {
    for (const change of [h => h.next('3'), h => { h.elements.examtea.value = '002'; }, h => { h.inputs[0] = Object.create(h.inputs[0]); }]) {
        const h = setup(); await h.a.gatherAnswerImages(); change(h);
        assert.equal(h.a.fillScores([2]), false); assert.equal(await h.a.submitGrade(), false); assert.equal(h.calls(), 0);
    }
});
test('享尚学模式、未加载图片、异站图片、错误满分和弹层限制就绪', () => {
    for (const change of [h => { h.w.gettype = 2; }, h => { h.w.gettype = 3; }, h => { h.w.xmod = 1; },
        h => { h.w.jianfen = 1; }, h => { h.w.fbgf = 1; }, h => { h.w.xzbj = 200; }, h => { h.w.isSwitchPaper = true; },
        h => { h.w.xmode = 1; }, h => { h.images[0].complete = false; }, h => { h.images[0].naturalWidth = 0; },
        h => { h.images[0].src = 'https://example.com/image.jpg'; }, h => { h.inputs[0].disabled = true; },
        h => { h.inputs[0].readOnly = true; }, h => { h.elements.scores.value = 5; }, h => { h.elements.selecttea = h.visible; },
        h => { h.w.jQuery.active = 1; }, h => { h.w.paperrowid = '-2'; }]) {
        const h = setup(); change(h); assert.equal(h.a.getPaperIdentity(), null); assert.equal(h.a.fillScores([2]), false);
    }
});
test('享尚学正常单评和双评保存确认，再等待不同答卷稳定加载', async () => {
    for (const single of [false, true]) {
        const h = setup({ single, multi: true }); const old = h.a.getPaperIdentity(), task = h.a.getTaskIdentifier();
        assert.equal(await fill(h, [1, 2.5]), true); assert.equal(await h.a.submitGrade(), true);
        assert.equal(h.calls(), 1); assert.equal(h.callbacks(), 1);
        assert.equal(await h.a.waitForNextPaper('', { paperId: old, taskId: task }), true);
        assert.equal(await h.a.submitGrade(), false); assert.equal(h.calls(), 1);
    }
});
test('享尚学原生进度刷新并行时核对成绩请求，取卷中仍拒绝提交', async () => {
    const h = setup({ nativeProgress: true }); await fill(h);
    assert.equal(await h.a.submitGrade(), true); assert.equal(h.calls(), 1);
    const loading = setup({ nativeProgress: true }); await fill(loading);
    loading.change(() => loading.w.jQuery.ajax({ url: 'lyGetData.aspx?action=GetPaperInfo' }));
    assert.equal(await loading.a.submitGrade(), false); assert.equal(loading.calls(), 0);
});
test('享尚学拒收、会话过期、回收、同卷与网络错误均停止', async () => {
    for (const response of ['-1000', '-2000', '-666', '-8', '当前科目不可阅卷', '1', 'error', 'null']) {
        const h = setup(); h.response(response); assert.equal(await fill(h), true);
        assert.equal(await h.a.submitGrade(), false, response); assert.equal(await h.a.waitForNextPaper(), false);
    }
    const h = setup(); h.response('last'); await fill(h); assert.equal(await h.a.submitGrade(), true);
    assert.equal(await h.a.waitForNextPaper(), false);
    h.next('3'); assert.equal(await h.a.waitForNextPaper(), false, '末卷后的原生刷新保持停止');
});
test('享尚学提交前再次核验成绩、时长、模式和取消状态', async () => {
    for (const change of [h => { h.inputs[0]._value = '3'; }, h => { h.w.leastViewTime = 3; }, h => { h.w.gettype = 2; },
        h => { h.elements.autohuiche.checked = true; }, h => { h.elements.submitbtn.disabled = true; }, h => h.next('3')]) {
        const h = setup(); await fill(h); change(h); assert.equal(await h.a.submitGrade(), false); assert.equal(h.calls(), 0);
    }
    const h = setup(); await fill(h); assert.equal(await h.a.submitGrade({ verify() { h.next('3'); } }), false);
    const b = setup(); await fill(b); assert.equal(await b.a.submitGrade({ signal: { aborted: true } }), false);
});
test('享尚学实际请求中的答卷、题目、评分点和总分必须与填写快照相同', async () => {
    for (const key of ['id', 'examtea', 'examsub', 'teaid', 'teapos', 'pjsign', 'gettype', 'scores', 'xt']) {
        const h = setup(); await fill(h); h.change(data => { data[key] = '99'; });
        assert.equal(await h.a.submitGrade(), false, key); assert.equal(h.calls(), 0);
    }
});
test('享尚学取消后的迟到响应不续改，读取失败仍保留原生错误处理', async () => {
    const h = setup(); await fill(h); h.response('defer'); const guard = { signal: { aborted: false } };
    const saving = h.a.submitGrade(guard); await new Promise(resolve => setTimeout(resolve, 1)); guard.signal.aborted = true;
    assert.equal(await saving, false); h.pending().success({ id: '2' }); assert.equal(await h.a.waitForNextPaper(), false);
    let errors = 0; h.w.jQuery.ajax({ url: 'lyGetData.aspx?action=GetPaperInfo', data: {}, error() { errors++; } });
    assert.equal(h.a.isMarkingPage(), false); h.pending().error(); assert.equal(errors, 1); assert.equal(h.a.isMarkingPage(), true);
});
