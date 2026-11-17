const M = require('./_adapter-matrix.js');

// 按原站单题页的数据契约构造，不含账号、真实卷号或答卷。
module.exports = function fixture({ count = 1, regions = 2 } = {}) {
    const sb = M.makeStub({ host: 's3.taoweiedu.com', path: '/web/main.jsp' });
    sb.location.origin = 'http://s3.taoweiedu.com';
    sb.setTimeout = (fn, ms) => setTimeout(fn, ms === 25000 ? 200 : ms === 100 ? 0 : ms);
    sb.setInterval = (fn, ms) => setInterval(fn, ms === 100 ? 1 : ms);
    sb.clearTimeout = clearTimeout; sb.clearInterval = clearInterval;
    const w = { location: new URL('http://s3.taoweiedu.com/web/mark/sjpy/sjpy_kspy.jsp?ksdm=100&kmdm=C1&stbh=12'),
        ksdm: '100', kmdm: 'C1', stbh: '12', loadok: true, err: false, sfhp: false, dfms: '1', sfsp: '0',
        tjfsFlag: true, dtkgs: '1', pybz_arr: [], getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) };
    w.zgtxx = { STBH: '12', KMDM: 'C1', STMC: '作文', DFDMC: Array.from({ length: count }, (_, i) => count === 1 ? '作文' : `12(${i + 1})`).join('|'),
        DFDFS: Array(count).fill('60').join('|'), DFDSL: count, STMF: count * 60, DFBC: '0', DFBCMS: '1',
        PYCS: 3, SFSP: '0', SFYGMS: '0', SFFP: '0', SFMP: '0', TXQY: Array.from({ length: regions }, (_, i) => i + 12).join(','),
        TXDZ: 'https://img-oss.sdzdf.com/Examimg/' };
    w.dfdmc = w.zgtxx.DFDMC.split('|'); w.dfdfs = w.zgtxx.DFDFS.split('|'); w.txqy = w.zgtxx.TXQY.split(',');
    const doc = { defaultView: w }; w.document = doc;
    const visible = () => ({ ownerDocument: doc, isConnected: true, getClientRects: () => [{}] });
    let onInput = () => {};
    class Input {
        constructor(i) { Object.assign(this, visible(), { id: `dfd${i}`, placeholder: '满60分', _value: '', writes: 0, events: [] }); }
        get value() { return this._value; }
        set value(v) { this.writes++; this._value = String(v); }
        dispatchEvent(e) { this.events.push(e.type); if (e.type === 'input') onInput(this); }
    }
    w.HTMLInputElement = Input; w.Event = class { constructor(type) { this.type = type; } };
    const fields = Array.from({ length: count }, (_, i) => new Input(i));
    const rows = fields.map((field, i) => ({ querySelector: q => q === 'input.dfdinput' ? field : { textContent: w.dfdmc[i] } }));
    const images = Array.from({ length: regions }, (_, i) => ({ ...visible(), id: `mainimg_${i}`, complete: true, naturalWidth: 1194, naturalHeight: 1428 }));
    const paper = { value: '' };
    function next(id) {
        w.rwxx = { RWID: `task-${id}`, BMH: id, DQPC: 1, PYZT: '1', ZJBZ: '0', PYCJ: null, PYDFD: null, PYSJ: null, HPSJ: null };
        paper.value = id; w.loadok = true; w.tjfsFlag = true;
        images.forEach((img, i) => { img.src = `${w.zgtxx.TXDZ}1318/100/C1/${id}/${id}_${w.txqy[i]}.jpg?v=123`; });
        fields.forEach(f => { f._value = ''; });
    }
    next('paper-A');
    let response = { res: true }, status = 200, delayed = false, last, blockers = [], alter = value => value;
    const sent = [], attempts = [], originals = {};
    class XHR {
        constructor() { this.events = new Map(); this.status = status; }
        open(method, url) { this.url = url; }
        addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
        removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
        abort() { this.aborted = true; }
        send(body) { last = this; sent.push(body); if (!delayed) setTimeout(() => this.respond(response), 0); }
        respond(data) { this.responseText = typeof data === 'string' ? data : JSON.stringify(data); for (const fn of [...(this.events.get('load') || [])]) fn(); }
    }
    w.XMLHttpRequest = XHR; originals.open = XHR.prototype.open; originals.send = XHR.prototype.send;
    w.checkDfd = () => true;
    function save() {
        w.tjfsFlag = false; w.qropen = false;
        const data = alter({ ksdm: w.ksdm, kmdm: w.kmdm, stbh: w.stbh, rwid: w.rwxx.RWID, dqpc: w.rwxx.DQPC,
            pycs: w.zgtxx.PYCS, sfmp: w.zgtxx.SFMP, pycj: Math.round(fields.reduce((sum, f) => sum + Number(f.value), 0) * 10) / 10,
            pydfd: fields.map(f => f.value).join('|'), pybz: w.pybz_arr.join('|'), pyhs: '20' });
        const xhr = new w.XMLHttpRequest(); xhr.open('POST', w.location.origin + '/sjpy_tjfs.do'); xhr.send(new URLSearchParams(data).toString());
    }
    const layer = { ...visible(), getAttribute: () => '1', contains: () => true },
        confirm = { ...visible(), getClientRects: () => w.qropen ? [{}] : [], closest: () => layer },
        confirmButton = { ...visible(), getClientRects: () => w.qropen ? [{}] : [], click: () => { attempts.push('confirm'); save(); } };
    const button = { ...visible(), click() { attempts.push('submit'); if (w.tjqqr && !w.qropen) w.qropen = true; else save(); } };
    doc.querySelector = q => q === '#tjfsbtn' ? button : q === '#copyvalue' ? paper : q === '#dfdxx .dfddiv' ? rows[0]
        : q === '#dfqr_div' ? confirm : q === '#qrfs' ? { textContent: `确定为该学生打 ${fields.reduce((s, f) => s + Number(f.value), 0)} 分吗？` }
        : q.startsWith('#dfqr_div button') ? confirmButton : null;
    doc.querySelectorAll = q => q === '#dfdxx .dfddiv' ? rows : q.startsWith('#imgdiv') ? images : w.qropen ? [...blockers, layer] : blockers;
    sb.document.querySelector = q => q === '#main_frame' ? { contentWindow: w, getAttribute: () => '/web/mark/navi.jsp?ksdm=null&kmdm=null' } : null;
    sb.fetchImageAsBase64 = async () => 'synthetic-bytes';
    const loaded = M.loadOne(sb, 'taowei');
    if (loaded.errors.length) throw Error(loaded.errors.join('; '));
    return { sb, w, doc, adapter: sb.__AI_MARKER_ADAPTER__, fields, rows, images, button, next, sent, attempts, originals,
        input: fn => { onInput = fn; }, response: (data, code = 200) => { response = data; status = code; }, delay: () => { delayed = true; },
        last: () => last, block: () => { blockers = [visible()]; }, alter: fn => { alter = fn; } };
};
