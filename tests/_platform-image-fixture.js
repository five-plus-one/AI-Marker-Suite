const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('./_adapter-matrix');

// Deterministic clock around the actual adapter. No platform network or score writes.
function fixture(dir) {
    const form = M.ADAPTERS.find(entry => entry.dir === dir).own;
    const sb = M.makeStub(form), timers = new Map();
    let now = 100000, sequence = 0;
    sb.Date = class extends Date { static now() { return now; } };
    sb.setTimeout = (fn, ms = 0) => {
        const id = ++sequence; timers.set(id, { fn, at: now + ms }); return id;
    };
    sb.setInterval = (fn, ms = 0) => {
        const id = ++sequence; timers.set(id, { fn, at: now + ms, interval: ms || 1 }); return id;
    };
    sb.clearTimeout = sb.clearInterval = id => timers.delete(id);
    const loaded = M.loadOne(sb, dir);
    if (loaded.errors.length) throw new Error(loaded.errors.join('\n'));
    if (!loaded.winner) throw new Error(`Fixture did not register ${dir}`);
    const selectorPath = path.join(M.AD_DIR, dir, 'selectors.js');
    const selectorName = fs.readFileSync(selectorPath, 'utf8').match(/const\s+(\w+_SELECTORS)\s*=/)[1];
    const selectors = vm.runInContext(selectorName, sb);
    return {
        sb, adapter: loaded.winner, selectors,
        async run(promise) {
            let settled = false, value, error;
            Promise.resolve(promise).then(result => { settled = true; value = result; }, failure => { settled = true; error = failure; });
            for (let tick = 0; tick < 700 && !settled; tick++) {
                for (let i = 0; i < 8; i++) await Promise.resolve();
                now += 100;
                for (const [id, timer] of [...timers]) {
                    if (timer.at > now || !timers.has(id)) continue;
                    if (timer.interval) timer.at = now + timer.interval;
                    else timers.delete(id);
                    timer.fn();
                }
            }
            if (error) throw error;
            if (!settled) throw new Error(`Unsettled adapter clock: ${dir}`);
            return value;
        }
    };
}

const URL_A = 'https://images.example/student/100001/answer.jpg?p=paper-a&examcode=paper-a&picName=paper-a&path=paper-a';
const URL_B = URL_A.replaceAll('100001', '100002').replaceAll('paper-a', 'paper-b');
const DATA_A = 'data:image/png;base64,' + 'A'.repeat(6000);
const DATA_B = 'data:image/png;base64,' + 'B'.repeat(6000);

function waitingFixture(dir) {
    const e = fixture(dir), a = e.adapter, input = { value: '', textContent: '未评分' };
    const image = {
        src: dir === 'xueba54' ? DATA_A : URL_A,
        naturalWidth: 1000, naturalHeight: 800, complete: true,
        getAttribute(key) { return key === 'src' || key === 'href' || key === 'xlink:href' ? this.src : key === 'data-stu' ? '100001' : null; },
        getClientRects: () => [{}],
    };
    const canvas = { toDataURL: () => image.src };
    const images = new Set(), scores = new Set();
    for (const [key, value] of Object.entries(e.selectors)) {
        if (typeof value !== 'string') continue;
        if (/(?:IMAGE|IMG)/.test(key)) images.add(value);
        if (/(?:INPUT|SCORE_PANEL|CURRENT_SCORE_TEXT)/.test(key)) scores.add(value);
    }
    if (e.selectors.SCORE_INPUT_BY_INDEX) scores.add(e.selectors.SCORE_INPUT_BY_INDEX(0));
    if (e.selectors.STEP_INPUT_BY_INDEX) scores.add(e.selectors.STEP_INPUT_BY_INDEX(0));
    const doc = {
        querySelector: selector => images.has(selector) ? image : scores.has(selector) ? input : /canvas/.test(selector) ? canvas : null,
        querySelectorAll: selector => images.has(selector) ? [image] : scores.has(selector) ? [input] : [],
    };
    Object.assign(e.sb.document, doc);
    if (dir === 'huiyuejuan') {
        a._getFrameDoc = () => doc;
        a._getCurrentImageUrl = () => image.src;
        a.getTaskIdentifier = () => 'same-task';
    }
    let paperId = '100001';
    if (dir === 'kuyuu') a._getCurrentPaperId = () => paperId;
    if (dir === 'ruiya') {
        a._paperNo = () => paperId; a._stuId = () => paperId;
        a._rawImageSrc = () => image.src;
        a.getScoreInputs = () => [{ element: input }];
        a._lastFillSignature = 'filled';
    }
    if (dir === 'c30') a._state.latestImageUrl = URL_A;
    if (dir === 'xinjiaoyu') vm.runInContext(`_xinjiaoyuCurrentImageUrl = ${JSON.stringify(URL_A)}`, e.sb);
    return { ...e, image, input, oldUrl: image.src,
        next() {
            paperId = '100002'; image.src = dir === 'xueba54' ? DATA_B : URL_B;
            if (dir === 'c30') { a._state.latestImageUrl = URL_B; a._state.latestApiTimestamp = e.sb.Date.now(); }
            if (dir === 'xinjiaoyu') vm.runInContext(`_xinjiaoyuCurrentImageUrl = ${JSON.stringify(URL_B)}`, e.sb);
        }
    };
}

module.exports = { fixture, waitingFixture, URL_A, URL_B };
