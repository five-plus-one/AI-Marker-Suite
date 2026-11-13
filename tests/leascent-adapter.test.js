const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./_adapter-matrix.js');

// 现场结构：CurrQuestion 持有 base64，主图使用 blob；提交动作先换卷，再收到 SetMark 响应。
function setup({ maxima = [15], flag = '1', options } = {}) {
    const sb = M.makeStub({ host: '120.55.199.134', port: '9090', path: '/home/index', protocol: 'http:' });
    sb.location = new URL(sb.location.href);
    sb.setTimeout = (fn, ms) => setTimeout(fn, ms === 100 ? 0 : ms);
    sb.clearTimeout = clearTimeout;
    sb.atob = s => Buffer.from(s, 'base64').toString('binary');
    const doc = sb.document; doc.defaultView = sb;
    const visible = () => ({ ownerDocument: doc, getClientRects: () => [{}] });
    class Input {
        constructor(i) { Object.assign(this, visible(), { id: `sm-${i}`, max: String(maxima[i]), _value: '', writes: 0 }); }
        get value() { return this._value; }
        set value(v) { this.writes++; this._value = String(v); }
        getAttribute(k) { return k === 'stflag' ? flag : k === 'stindex' ? this.id.slice(3) : null; }
        dispatchEvent(e) { events.push(e.type); }
    }
    sb.HTMLInputElement = Input;
    const events = [], sent = [];
    const fields = maxima.map((_, i) => new Input(i));
    const labels = maxima.map((_, i) => `写作${i + 1}`);
    const rows = fields.map((f, i) => ({
        getAttribute: () => String(i),
        querySelector: s => s === '.st-my' ? f : { textContent: s === '.st-name' ? labels[i] : String(maxima[i]) },
        querySelectorAll: () => (options || Array.from({ length: maxima[i] * (flag === '0' ? 2 : 1) + 1 }, (_, j) => j / (flag === '0' ? 2 : 1)))
            .map(v => ({ textContent: String(v) }))
    }));
    sb.CurrPaper = { TestID: 3, QuesID: 11, QuesName: '写作', MCaption: labels.join('?'),
        MPart: maxima.join(',') + ';' + (flag === '2' ? options.join('|') : '') + ';0;3',
        ControlValue: flag === '2' ? 6 : flag === '0' ? 4 : 5, UserRight: 1 };
    Object.assign(sb, { arb: 0, isLoadIamge: false, DoubleConfirm: 0, countdown: 0 });
    const image = { ...visible(), complete: true, naturalWidth: 1000, naturalHeight: 600 };
    let bytes = Buffer.from('answer-A'), blocked = false, last, delayed = false, response = { Code: 0 }, change = x => x;
    function next(id = 'B', { sameImage = false } = {}) {
        if (!sameImage) bytes = Buffer.from('answer-' + id);
        sb.CurrQuestion = { TestId: 3, QuesID: 11, PaperId: `paper-${id}`, RowID: id.charCodeAt(0), BWRID: 42,
            NeedReleaseNum: 1, MarkType: 0, PaperImagePath: `crop-${id}.jpg`, PaperPath: 'data:image/jpg;base64,' + bytes.toString('base64') };
        sb.QuestionList = [sb.CurrQuestion];
        image.src = 'blob:' + sb.location.origin + '/' + id;
        image.pixels = bytes.toString('base64');
        fields.forEach(f => { f._value = ''; });
    }
    next('A');
    // 现场 onload 会 revokeObjectURL，验证逻辑应直接使用解码图片而不是 fetch(blob)。
    sb.fetch = async () => { throw new Error('revoked blob'); };
    sb.Image = class {
        constructor() { this.naturalWidth = 1000; this.naturalHeight = 600; }
        set src(value) { this.pixels = value.split(',')[1]; queueMicrotask(() => this.onload?.()); }
    };
    doc.createElement = () => {
        let pixels;
        return { getContext: () => ({ drawImage: img => { pixels = img.pixels; } }), toDataURL: () => pixels };
    };
    sb.$ = x => x;
    sb.setMyScore = (score, input) => {
        if (!sb.CurrQuestion.MyScore) sb.CurrQuestion.MyScore = fields.map(() => 0);
        sb.CurrQuestion.MyScore[fields.indexOf(input)] = score;
    };
    class XHR {
        constructor() { this.events = new Map(); this.status = 200; }
        open(method, url) { this.url = url; }
        addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
        removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
        send(body) { last = this; sent.push(body); if (!delayed) setTimeout(() => this.respond(response), 0); }
        respond(data) { this.responseText = typeof data === 'string' ? data : JSON.stringify(data); this.emit('load'); }
        emit(type) { for (const fn of [...(this.events.get(type) || [])]) fn(); }
    }
    sb.XMLHttpRequest = XHR;
    const button = { ...visible(), classList: { contains: () => false }, click() {
        const p = sb.CurrPaper, q = sb.CurrQuestion;
        q.IsChecked = 1; q.IsHuiping = 0;
        const data = change({ testId: p.TestID, questionId: p.QuesID, paperId: q.PaperId, rowId: q.RowID,
            bwId: q.BWRID, markType: 0, needReleaseNum: 1, gfNum: 0, arb: sb.arb, score: q.MyScore.join(','), flag: 0 });
        const xhr = new sb.XMLHttpRequest(); xhr.open('POST', '/home/SetMark'); xhr.send(new URLSearchParams(data).toString());
        next('B');
    } };
    let mode = '1';
    doc.querySelector = s => s === '#lxIndex.page-current' ? visible() : s === '#st-content .btn-next' ? button
        : s === 'input[name="bzgf"]:checked' ? { value: mode } : null;
    doc.querySelectorAll = s => s === '#st-content .st-main' ? rows : s === '#st-img .my-st-img' ? [image] : blocked ? [visible()] : [];
    assert.deepEqual(M.loadOne(sb, 'leascent').errors, []);
    return { a: sb.__AI_MARKER_ADAPTER__, sb, fields, rows, image, button, next, sent, events,
        block: () => { blocked = true; }, mode: v => { mode = v; }, bytes: v => { image.pixels = Buffer.from(v).toString('base64'); },
        response: v => { response = v; }, delay: () => { delayed = true; }, last: () => last, change: fn => { change = fn; } };
}

test('绑定当前原生裁切图，下载函数支持核心层的独立调用方式', async () => {
    const { a } = setup();
    assert.equal(a.getScoreInputs()[0].maxScore, 15);
    assert.equal(a.getScoreInputs()[0].roundStep, 1);
    const images = await a.gatherAnswerImages();
    assert.equal(images.length, 1);
    const fetchFn = a.fetchImageAsBase64;
    assert.equal(await fetchFn(images[0]), Buffer.from('answer-A').toString('base64'));
});

test('主图尚未切换、图片未就绪或读取中换卷时不返回图片', async () => {
    for (const mutate of [s => s.bytes('old-answer'), s => { s.image.complete = false; }, s => { s.image.naturalWidth = 0; }]) {
        const s = setup(); mutate(s);
        assert.equal((await s.a.gatherAnswerImages()).length, 0);
    }
    const s = setup();
    const Image = s.sb.Image;
    s.sb.Image = class extends Image { set src(value) { super.src = value; s.next(); } };
    assert.equal((await s.a.gatherAnswerImages()).length, 0);
});

test('半分、整数与指定档位逐单元检查；填分同步原生数组且不提交', async () => {
    const s = setup({ maxima: [1.5, 1.5], flag: '0' }); await s.a.gatherAnswerImages();
    for (const scores of [[1, null], [1, '0'], [1, NaN], [1, Infinity], [1, -1], [1, 2], [1, 0.1], [1]]) {
        assert.equal(s.a.fillScores(scores), false); assert.equal(s.fields[0].writes, 0);
    }
    assert.equal(s.a.fillScores([0, 1.5]), true);
    assert.deepEqual(Array.from(s.sb.CurrQuestion.MyScore), [0, 1.5]);
    assert.deepEqual(s.sent, []); assert.deepEqual(s.events, ['input', 'change', 'input', 'change']);
    const integer = setup(); await integer.a.gatherAnswerImages();
    assert.equal(integer.a.fillScores([7.5]), false);
    const ranges = setup({ maxima: [15], flag: '2', options: [0, 6, 10, 15] }); await ranges.a.gatherAnswerImages();
    assert.equal(ranges.a.fillScores([7]), false); assert.equal(ranges.a.fillScores([6]), true);
});

test('回评、仲裁、试评、加载、确认及标注给分状态不参与批改', () => {
    const mutations = [s => { s.sb.arb = 1; }, s => { s.sb.CurrQuestion.IsHuiping = 1; },
        s => { s.sb.CurrQuestion.MarkType = 51; }, s => { s.sb.isLoadIamge = true; },
        s => { s.sb.CurrPaper.ControlValue |= 64; }, s => { s.sb.CurrQuestion.TestId = 4; },
        s => { s.sb.countdown = 3; }, s => { s.sb.DoubleConfirm = 1; }, s => s.mode('2'), s => s.block()];
    for (const mutate of mutations) { const s = setup(); mutate(s); assert.equal(s.a.getPaperIdentity(), null); }
});

test('填分与提交之间的答卷、图片、分数或题目变化均拒绝提交', async () => {
    for (const mutate of [s => s.next(), s => { s.sb.CurrPaper.QuesID = 12; }, s => { s.fields[0]._value = '9'; },
        s => { s.sb.CurrQuestion.MyScore[0] = 9; }, s => { s.image.src += '-changed'; }, s => s.block()]) {
        const s = setup(); await s.a.gatherAnswerImages(); assert.equal(s.a.fillScores([10]), true); mutate(s);
        assert.equal(await s.a.submitGrade(), false); assert.equal(s.sent.length, 0);
    }
});

test('保存响应先于/晚于换卷都按对应请求确认；换卷后旧卷守卫失效不否定已保存成绩', async () => {
    const s = setup(); await s.a.gatherAnswerImages(); s.a.fillScores([10]);
    const oldId = s.a.getPaperIdentity();
    assert.equal(await s.a.submitGrade({ isCurrent: () => s.a.getPaperIdentity() === oldId }), true);
    assert.equal(s.sent.length, 1);
    assert.equal(await s.a.waitForNextPaper(null, { paperId: oldId }), true);
    assert.equal(await s.a.submitGrade(), false);
});

test('平台拒绝、非 JSON、网络错误或暂停都不能用换图冒充保存成功', async () => {
    for (const data of [{ Code: 1 }, { Code: '0' }, 'invalid']) {
        const s = setup(); await s.a.gatherAnswerImages(); s.a.fillScores([10]); s.response(data);
        assert.equal(await s.a.submitGrade(), false); assert.equal(await s.a.waitForNextPaper(), false);
    }
    for (const event of ['error', 'timeout', 'abort']) {
        const s = setup(); await s.a.gatherAnswerImages(); s.a.fillScores([10]); s.delay();
        const promise = s.a.submitGrade(); s.last().emit(event); assert.equal(await promise, false);
    }
    const s = setup(); await s.a.gatherAnswerImages(); s.a.fillScores([10]); s.delay();
    const controller = new AbortController(), promise = s.a.submitGrade({ signal: controller.signal });
    controller.abort(); assert.equal(await promise, false);
});

test('发送前核对答卷与全部分值；错误身份和分值不会发送', async () => {
    for (const change of [d => ({ ...d, paperId: 'other' }), d => ({ ...d, score: '9' }), d => ({ ...d, arb: 1 })]) {
        const s = setup(); await s.a.gatherAnswerImages(); s.a.fillScores([10]); s.change(change);
        assert.equal(await s.a.submitGrade(), false); assert.equal(s.sent.length, 0);
    }
});

test('未见保存响应前不完成，重复点击不会产生第二次请求；结束后恢复网络方法', async () => {
    const s = setup(); await s.a.gatherAnswerImages(); s.a.fillScores([10]); s.delay();
    const open = s.sb.XMLHttpRequest.prototype.open, send = s.sb.XMLHttpRequest.prototype.send;
    let finished = false; const promise = s.a.submitGrade().then(ok => { finished = true; return ok; });
    await Promise.resolve(); assert.equal(finished, false);
    assert.equal(await s.a.submitGrade(), false); assert.equal(s.sent.length, 1);
    s.last().respond({ Code: 0 }); assert.equal(await promise, true);
    assert.equal(s.sb.XMLHttpRequest.prototype.open, open); assert.equal(s.sb.XMLHttpRequest.prototype.send, send);
});

test('下一卷必须具备新业务身份与已就绪图像，任务变化和取消会结束等待', async () => {
    const s = setup(); await s.a.gatherAnswerImages(); s.a.fillScores([10]); await s.a.submitGrade();
    s.next('A'); assert.equal(await s.a.waitForNextPaper(), false);
    s.next('B'); s.image.complete = false; assert.equal(await s.a.waitForNextPaper(), false);
    s.image.complete = true; s.sb.CurrPaper.QuesID = 12; assert.equal(await s.a.waitForNextPaper(), false);
    assert.equal(await s.a.waitForNextPaper(null, { signal: { aborted: true } }), false);
});
