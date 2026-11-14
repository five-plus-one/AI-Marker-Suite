const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const M = require('./_adapter-matrix.js');

// 与现场 JSP 对齐：父页持有同源 iframe，题块 img、得分点与原生业务状态分开更新。
function setup({ count = 1, regions = 1 } = {}) {
    const sb = M.makeStub({ host: 'yuejuan.yuandingbang.cn', path: '/web/main.jsp' });
    sb.setTimeout = (fn, ms) => setTimeout(fn, ms === 100 ? 0 : ms);
    sb.clearTimeout = clearTimeout;
    const location = new URL('https://yuejuan.yuandingbang.cn/web/mark/sjpy/sjpy_kspy.jsp?ksdm=100&kmdm=B21&stbh=2');
    const w = { location, ksdm: '100', kmdm: 'B21', stbh: '2', loadok: true, err: false,
        sfhp: false, dfms: '1', sfsp: '0', tjfsFlag: true, dtkgs: '1', getComputedStyle: () => ({ display: 'block' }) };
    sb.location.origin = location.origin;
    w.zgtxx = { STBH: '2', KMDM: 'B21', STMC: '22(1-2)', DFDMC: Array.from({ length: count }, (_, i) => `22(${i + 1})`).join('|'),
        DFDFS: Array(count).fill('6').join('|'), DFDSL: count, STMF: 6 * count,
        DFBC: '0', DFBCMS: '1', PYCS: 1, SFSP: '0', SFYGMS: '0', SFFP: '0', SFMP: '0',
        TXQY: Array.from({ length: regions }, (_, i) => i + 3).join(','), TXDZ: 'https://yuejuan-img.yuandingbang.cn/Examimg/' };
    w.dfdmc = w.zgtxx.DFDMC.split('|'); w.dfdfs = w.zgtxx.DFDFS.split('|'); w.txqy = w.zgtxx.TXQY.split(',');
    const doc = { defaultView: w }; w.document = doc;
    const visible = () => ({ ownerDocument: doc, getClientRects: () => [{}] });
    class Input {
        constructor(i) { Object.assign(this, visible(), { id: `dfd${i}`, placeholder: '满分6', writes: 0, _value: '' }); }
        get value() { return this._value; }
        set value(v) { this.writes++; this._value = String(v); }
        dispatchEvent() {}
    }
    w.HTMLInputElement = Input; w.Event = class { constructor(type) { this.type = type; } };
    const fields = Array.from({ length: count }, (_, i) => new Input(i));
    const rows = fields.map((field, i) => ({ querySelector: q => q.startsWith('input') ? field : { textContent: w.dfdmc[i] } }));
    const images = Array.from({ length: regions }, (_, i) => ({ ...visible(), id: `mainimg_${i}`, complete: true, naturalWidth: 1140, naturalHeight: 219 }));
    const paper = { value: '' };
    function next(id) {
        w.rwxx = { RWID: `task-${id}`, DQPC: '1', BMH: id, STBH: '2', PYCS: 1, SFYC: '0', SFZC: '0', ZJBZ: '0', PYCJ_1: null, PYSJ_1: null };
        paper.value = id;
        images.forEach((img, i) => { img.src = `${w.zgtxx.TXDZ}1359/100/B21/${id}/${id}_${i + 3}.jpg?v=123`; });
    }
    next('paperA');
    let response = { res: true }, delayed = false, last, blocked = false, sendChange = data => data;
    const sent = [];
    class XHR {
        constructor() { this.events = new Map(); this.status = 200; }
        open(method, url) { this.url = url; }
        addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
        removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
        send(body) { last = this; sent.push(body); if (!delayed) setTimeout(() => this.respond(response), 0); }
        respond(data) { this.responseText = typeof data === 'string' ? data : JSON.stringify(data); for (const fn of [...(this.events.get('load') || [])]) fn(); }
    }
    w.XMLHttpRequest = XHR;
    w.checkDfd = () => true;
    const button = { ...visible(), classList: { contains: () => false }, click() {
        const data = sendChange({ ksdm: '100', kmdm: 'B21', stbh: '2', rwid: w.rwxx.RWID, dqpc: '1', pycs: 1, sfmp: '0',
            pycj: fields.reduce((sum, f) => sum + Number(f.value), 0), pydfd: fields.map(f => f.value).join('|') });
        const xhr = new w.XMLHttpRequest(); xhr.open('POST', location.origin + '/sjpy_tjfs.do'); xhr.send(new URLSearchParams(data).toString());
    } };
    doc.querySelector = q => q === '#tjfsbtn' ? button : q === '#copyvalue' ? paper : q === '#dfdxx .dfddiv' ? rows[0] : null;
    doc.querySelectorAll = q => q === '#dfdxx .dfddiv' ? rows : q.startsWith('#imgdiv') ? images : blocked ? [visible()] : [];
    sb.document.querySelector = q => q === '#main_frame' ? { contentWindow: w } : null;
    assert.deepEqual(M.loadOne(sb, 'yuandingbang').errors, []);
    return { adapter: sb.__AI_MARKER_ADAPTER__, sb, w, fields, images, button, next, sent, paper,
        response: data => { response = data; }, delay: () => { delayed = true; }, last: () => last,
        block: () => { blocked = true; }, changeRequest: fn => { sendChange = fn; } };
}

test('园丁邦绑定 iframe 的原生题目、满分与完整题块图', async () => {
    const { adapter: a, images } = setup({ count: 2, regions: 2 });
    assert.equal(a.getQuestionContext().question, '22(1-2)');
    assert.equal(a.getScoreInputs().length, 2);
    assert.equal(a.getScoreInputs()[0].roundStep, 1);
    assert.deepEqual(Array.from(await a.gatherAnswerImages()), images.map(i => i.src));
});
test('园丁邦分数全批验证：零分有效，非法值、超分、步长与数量错误均不写入', () => {
    const { adapter: a, fields } = setup({ count: 2 });
    for (const values of [[2, null], [2, true], [2, ''], [2, Infinity], [2, -1], [2, 7], [2, 1.5], [2], [2, 3, 4]]) {
        assert.equal(a.fillScores(values), false, String(values));
        assert.equal(fields.reduce((n, f) => n + f.writes, 0), 0);
    }
    assert.equal(a.fillScores([0, 6]), true);
    assert.deepEqual(fields.map(f => f.value), ['0', '6']);
});
test('园丁邦原生离散给分档位与小数步长', () => {
    const { adapter: a, w, fields } = setup();
    w.zgtxx.DFBC = '1'; w.zgtxx.DFBCMS = '0,2,6';
    assert.equal(a.fillScores([1]), false); assert.equal(fields[0].writes, 0);
    assert.equal(a.fillScores([2]), true);
    w.zgtxx.DFBC = '0'; w.zgtxx.DFBCMS = '0.5';
    assert.equal(a.fillScores([2.5]), true); assert.equal(a.fillScores([2.2]), false);
});
test('园丁邦回评、试评、贴分、仲裁及未完成加载不会进入自动给分', () => {
    for (const change of [w => { w.sfhp = true; }, w => { w.sfsp = '1'; }, w => { w.dfms = '2'; },
        w => { w.zgtxx.PYCS = 3; }, w => { w.zgtxx.SFYGMS = '1'; }, w => { w.loadok = false; },
        w => { w.rwxx.PYCJ_1 = 2; }, w => { w.rwxx.STBH = '3'; }, w => { w.dfdmc = ['23']; }]) {
        const { adapter: a, w } = setup(); change(w); assert.equal(a.getPaperIdentity(), null); assert.equal(a.fillScores([3]), false);
    }
});
test('园丁邦逐张检查答卷和题块区域，拒绝旧图、缺图、加载中与整图弹层', async () => {
    for (const change of [h => { h.images[1].complete = false; }, h => { h.images.pop(); },
        h => { h.images[1].src = h.images[1].src.replace('paperA_4', 'paperA_99'); },
        h => { h.next('paperB'); h.images[0].src = h.images[0].src.replaceAll('paperB', 'paperA'); }, h => h.block()]) {
        const h = setup({ regions: 2 }); change(h); assert.equal(h.adapter.getPaperIdentity(), null);
        assert.equal((await h.adapter.gatherAnswerImages()).length, 0);
    }
});
test('园丁邦缓存刷新不改变答卷标识，原生换卷改变标识', () => {
    const h = setup(), old = h.adapter.getPaperIdentity();
    h.images[0].src = h.images[0].src.replace('v=123', 'v=456'); assert.equal(h.adapter.getPaperIdentity(), old);
    h.next('paperB'); assert.notEqual(h.adapter.getPaperIdentity(), old);
});

function imageDownload(h, { width = 1140, height = 219, beforeDownload, beforeLoad, decodeError = false, canvasError = false } = {}) {
    const requests = [], draws = [], canvases = [];
    h.sb.fetchImageAsBase64 = async (url, signal) => {
        requests.push({ url, signal }); beforeDownload?.(); return 'ORIGINAL_JPEG';
    };
    h.sb.Image = class {
        naturalWidth = width; naturalHeight = height;
        set src(value) {
            this.source = value;
            queueMicrotask(() => { beforeLoad?.(); (decodeError ? this.onerror : this.onload)?.(); });
        }
    };
    h.sb.document.createElement = name => {
        assert.equal(name, 'canvas');
        const canvas = { getContext: () => ({ drawImage: (...args) => draws.push(args) }),
            toDataURL: type => { assert.equal(type, 'image/png'); if (canvasError) throw Error('encode failed'); return 'data:image/png;base64,NORMALIZED_PNG'; } };
        canvases.push(canvas); return canvas;
    };
    return { requests, draws, canvases };
}

test('园丁邦下载保留完整查询和裁切参数，以原始题块尺寸输出 PNG，支持独立调用', async () => {
    const h = setup();
    h.images[0].src += '&x-oss-process=image/crop,x_10,y_20,w_1140,h_219&signature=a%2Bb';
    const { requests, draws, canvases } = imageDownload(h);
    const download = h.adapter.fetchImageAsBase64, signal = new AbortController().signal;
    assert.equal(await download(h.images[0].src, signal), 'NORMALIZED_PNG');
    assert.equal(requests[0].url, h.images[0].src); assert.equal(requests[0].signal, signal);
    assert.equal(draws.length, 1); assert.deepEqual(draws[0].slice(1), [0, 0]);
    assert.equal(draws[0][0].source, 'data:image/jpeg;base64,ORIGINAL_JPEG');
    assert.equal(canvases[0].width, 0); assert.equal(canvases[0].height, 0);
});

test('园丁邦下载期间换卷、切题、取消或尺寸不符均停止取图', async () => {
    for (const options of [
        h => ({ beforeDownload: () => h.next('paperB') }),
        h => ({ beforeLoad: () => h.next('paperB') }),
        h => ({ beforeLoad: () => { h.w.ksdm = '200'; } }),
        () => ({ width: 61582, height: 64768 }),
        () => ({ decodeError: true }), () => ({ canvasError: true }),
    ]) {
        const h = setup(); imageDownload(h, options(h));
        await assert.rejects(h.adapter.fetchImageAsBase64(h.images[0].src));
    }
    for (const when of ['beforeDownload', 'beforeLoad']) {
        const h = setup(), controller = new AbortController();
        imageDownload(h, { [when]: () => controller.abort() });
        await assert.rejects(h.adapter.fetchImageAsBase64(h.images[0].src, controller.signal));
    }
});

test('园丁邦超限题块、整卷地址和已取消请求在下载前停止', async () => {
    for (const change of [h => { h.images[0].naturalWidth = 61582; h.images[0].naturalHeight = 64768; },
        h => { h.images[0].naturalWidth = 14; }]) {
        const h = setup(); change(h); const { requests } = imageDownload(h);
        await assert.rejects(h.adapter.fetchImageAsBase64(h.images[0].src)); assert.equal(requests.length, 0);
    }
    const h = setup(), { requests } = imageDownload(h), controller = new AbortController(); controller.abort();
    await assert.rejects(h.adapter.fetchImageAsBase64(h.images[0].src, controller.signal));
    await assert.rejects(h.adapter.fetchImageAsBase64(h.images[0].src.replace('_3.jpg', '_0.jpg')));
    assert.equal(requests.length, 0);
});
test('园丁邦填分后切卷、改分或取消均禁止提交', async () => {
    for (const change of [h => h.next('paperB'), h => { h.fields[0].value = '4'; }, h => { h.w.dfms = '2'; }]) {
        const h = setup(); assert.equal(h.adapter.fillScores([3]), true); change(h);
        assert.equal(await h.adapter.submitGrade(), false); assert.equal(h.sent.length, 0);
    }
    const h = setup(); h.adapter.fillScores([3]); const c = new AbortController(); c.abort();
    assert.equal(await h.adapter.submitGrade({ signal: c.signal }), false); assert.equal(h.sent.length, 0);
});
test('园丁邦保存成功才结束提交，原生得分点顺序和总分进入请求', async () => {
    const h = setup({ count: 2 }), proto = h.w.XMLHttpRequest.prototype, open = proto.open, send = proto.send;
    h.adapter.fillScores([2, 3]); assert.equal(await h.adapter.submitGrade(), true);
    const sent = new URLSearchParams(h.sent[0]); assert.equal(sent.get('pydfd'), '2|3'); assert.equal(sent.get('pycj'), '5');
    assert.equal(proto.open, open); assert.equal(proto.send, send);
    h.next('paperB'); assert.equal(await h.adapter.waitForNextPaper(), true);
});
test('园丁邦错误响应、业务失败与取消不能确认保存，监听及时恢复', async () => {
    for (const response of [{ res: false }, { res: 'true' }, '<html>登录超时</html>']) {
        const h = setup(); h.response(response); h.adapter.fillScores([3]);
        assert.equal(await h.adapter.submitGrade(), false); assert.equal(h.adapter._submittedPaper, null);
    }
    const h = setup(), proto = h.w.XMLHttpRequest.prototype, open = proto.open, send = proto.send;
    h.delay(); h.adapter.fillScores([3]); const c = new AbortController();
    const waiting = h.adapter.submitGrade({ signal: c.signal }); c.abort();
    assert.equal(await waiting, false); assert.equal(proto.open, open); assert.equal(proto.send, send);
});
test('园丁邦其他答卷的保存响应不能归属于当前提交', async () => {
    const h = setup(); h.changeRequest(data => ({ ...data, rwid: 'other-paper' })); h.adapter.fillScores([3]);
    const c = new AbortController(), waiting = h.adapter.submitGrade({ signal: c.signal });
    await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(h.adapter._submittedPaper, null);
    c.abort(); assert.equal(await waiting, false);
});
test('园丁邦换卷须完整新答卷，缓存更新和未完成图片不能继续', async () => {
    const h = setup({ regions: 2 }); h.adapter.fillScores([3]); await h.adapter.submitGrade();
    h.images[0].src += '&v=789'; assert.equal(await h.adapter.waitForNextPaper(), false);
    h.next('paperB'); h.images[1].complete = false;
    assert.equal(await h.adapter.waitForNextPaper(), false);
    h.images[1].complete = true; assert.equal(await h.adapter.waitForNextPaper(), true);
    h.w.ksdm = '200'; assert.equal(await h.adapter.waitForNextPaper(), false);
});
