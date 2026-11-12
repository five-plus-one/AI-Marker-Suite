const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeStub, ADAPTERS } = require('./_adapter-matrix');

module.exports = function fixture() {
    const sb = makeStub(ADAPTERS.find(a => a.id === 'jzsmartedu').own);
    const state = { events: [], clicks: 0, notices: [], messages: [], mode: 'success', poll: 0 };
    const visible = () => ({ getClientRects: () => [1], textContent: '' });
    const input = { ...visible(), _v: '', get value() { return this._v; }, set value(value) { this._v = String(value); }, dispatchEvent(event) {
        state.events.push(event.type);
        if (event.type === 'input') {
            if (!state.dropInput) boardVm.effectScoreList[0].score = this.value;
            state.afterInput?.();
        }
        if (event.type === 'change' && !state.dropChange) parent.scoreList[0].score = boardVm.effectScoreList[0].score;
    } };
    const row = { label: '17', fullScore: 15, score: '', step: 0, trueIndex: 0 };
    const parent = { type: 2, readPaperType: '1', examPaperId: 'exam', readBlockId: 'block',
        scoreList: [{ score: '' }], readProgressInfo: { myselfReadCount: 0 }, cacheImageList: [] };
    const read = { scoreValue: '15.00', step: '0.000', pointDetail: [], scoreOptions: [] };
    const boardVm = { $options: { name: 'ScoreBoard' }, $parent: parent, type: 2, boardType: '3', autoSubmit: false,
        effectScoreList: [row], scorePointListModel: [row], currQuesBlock: { readBlockId: 'block', paperRead: [read] } };
    const imageVm = {};
    const imageParent = { __vue__: imageVm };
    const image = { ...visible(), src: '', complete: true, naturalWidth: 300, naturalHeight: 100, parentElement: imageParent };
    const body = { ...visible(), querySelectorAll: () => state.extraImage ? [image, state.extraImage] : [image] };
    const board = { ...visible(), __vue__: boardVm, querySelectorAll(selector) {
        return selector.includes('input.') ? [input]
            : selector.includes('score-0-full') ? palette.filter(b => ['零分', '满分'].includes(b.textContent))
            : selector.includes('score-btn') ? palette.filter(b => !['零分', '满分'].includes(b.textContent))
            : selector.includes('button') ? [button] : [];
    } };
    const advance = (id = 'B', sameImage = false) => {
        const data = { examResultItemId: 'part-' + id, paperReadId: 'read', saveFileUrl: '/answers/' + (sameImage ? 'A' : id) + '.png' };
        boardVm.readItem = { examResultItemId: 'paper-' + id, data: [data] };
        parent.cacheImageList = [boardVm.readItem, { examResultItemId: 'preloaded' }];
        Object.assign(imageVm, { readItem: data, saveFileUrl: data.saveFileUrl,
            showSrcList: [{ src: 'https://jzjx.jzsmartedu.cn' + data.saveFileUrl }],
            saveFileUrlList: [{ src: 'https://jzjx.jzsmartedu.cn' + data.saveFileUrl }] });
        image.src = imageVm.showSrcList[0].src;
        row.score = ''; parent.scoreList[0].score = ''; input.value = '';
    };
    advance('A');
    const palette = [0, 1, 2.5, 15].map(score => ({ ...visible(), textContent: score === 0 ? '零分' : score === 15 ? '满分' : String(score),
        click() {
            state.paletteClicks = (state.paletteClicks || 0) + 1;
            if (!state.dropPalette) { row.score = score; if (!state.dropChange) parent.scoreList[0].score = score; }
            state.afterPalette?.();
        }
    }));
    const success = score => {
        state.messages.push({ ...visible(), textContent: `提交成功！${score}分` });
        parent.readProgressInfo.myselfReadCount++;
    };
    const button = { ...visible(), textContent: '提交', click() {
        state.clicks++;
        if (state.mode === 'success') { const score = parent.scoreList[0].score; success(score); advance(); }
        if (state.mode === 'wrong-score') success(1);
        if (state.mode === 'toast-only') state.messages.push({ ...visible(), textContent: `提交成功！${input.value}分` });
        if (state.mode === 'count-only') parent.readProgressInfo.myselfReadCount++;
        state.afterClick?.();
    } };
    const select = sb.document.querySelector;
    sb.document.querySelector = selector => selector === '#read-paper-score-board' ? board : select(selector);
    sb.document.querySelectorAll = selector => selector === '.body-center-main' ? [body]
        : selector === '.el-message.el-message--success' ? state.messages : [];
    sb.showToast = message => state.notices.push(message);
    sb.setTimeout = callback => { state.poll++; state.onPoll?.(); queueMicrotask(callback); return 0; };
    sb.fetchImageAsBase64 = async value => value;
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/adapters/jzsmartedu/adapter.js'), 'utf8'), sb);
    return { sb, state, input, boardVm, parent, read, image, imageVm, body, button, palette, advance, success,
        adapter: sb.__AI_MARKER_ADAPTER__ };
};
