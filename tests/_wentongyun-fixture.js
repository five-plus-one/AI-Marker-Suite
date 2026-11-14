// 根据 2026-11-12 文通云单题现场构造；所有业务标识和图片均为测试数据。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeStub, ADAPTERS } = require('./_adapter-matrix');

module.exports = function fixture() {
    const sb = makeStub(ADAPTERS.find(a => a.id === 'wentongyun').own);
    const state = { clicks: 0, polls: 0, blocked: false, mode: 'success', notices: [] };
    const visible = () => ({ getClientRects: () => [1], classList: { contains: () => false } });
    const root = { ...visible() }, board = { ...visible() };
    const parent = { $el: root, $refs: {}, queryData: { examPaperId: 'exam', sheetDetailId: 'sheet', questionNum: '20', type: '1', again: '0', isClass: '0' },
        scoreType: 1, loading: false, submiting: '', isRemarks: [], remarkScore: null, workloadData: { readCount: 0 },
        questionCommonData: { examPaperId: 'exam', sheetDetailId: 'sheet', questionNum: '20', markType: 2, score: 4,
            questionNumList: ['20'], sheetDetailIdList: ['sheet'] } };
    const boardVm = { $el: board, $parent: parent, loading: false, submiting: '', gradeList: [0, 1, 2, 3, 4], getBoolean: () => false };
    parent.$refs.scoreBoard = boardVm; root.__vue__ = parent; board.__vue__ = boardVm;
    const image = { ...visible(), complete: true, naturalWidth: 981, naturalHeight: 242, src: '', currentSrc: '' };
    const advance = (id = 'B', sameImage = false) => {
        const questionUrl = `https://static.wtjy.com/temp/scan/test-${sameImage ? 'A' : id}.jpg?x-oss-process=image/crop,x_20,y_30,w_981,h_242&1794483221835`;
        parent.questionQetailsData = [{ id: 'paper-' + id, scanRecordId: 'scan-' + id, studentId: 'student-' + id,
            examPaperId: 'exam', sheetDetailId: 'sheet', questionNum: '20', questionUrl,
            type: 1, studentScore: null, changeScore: null, abnormalState: null, readCount: String(parent.workloadData.readCount) }];
        parent.scanRecordId = 'scan-' + id;
        image.src = questionUrl; image.currentSrc = questionUrl;
    };
    advance('A');
    const palette = boardVm.gradeList.map((score, index) => ({ ...visible(), textContent: `${score} 分`, click() {
        score = boardVm.gradeList[index];
        state.clicks++;
        const item = parent.questionQetailsData[0];
        parent.scoreBoard = [{ score, scanRecordId: item.scanRecordId, studentId: item.studentId,
            examPaperId: item.examPaperId, sheetDetailId: item.sheetDetailId, questionNum: item.questionNum, again: 0 }];
        if (state.mode === 'success') { parent.workloadData.readCount++; advance(); }
        if (state.mode === 'reload-on-error') advance();
        if (state.mode === 'wrong-score') { parent.scoreBoard[0].score = 1; parent.workloadData.readCount++; advance(); }
        if (state.mode === 'wrong-paper') { parent.scoreBoard[0].scanRecordId = 'other'; parent.workloadData.readCount++; advance(); }
        if (state.mode === 'error') state.blocked = true;
        state.afterClick?.();
    } }));
    root.querySelectorAll = selector => selector.includes('.question-item > img') ? state.extraImage ? [image, state.extraImage] : [image] : [];
    board.querySelectorAll = () => palette;
    const select = sb.document.querySelector;
    sb.document.querySelector = selector => selector === '.mark .score-board' ? board : select(selector);
    sb.document.querySelectorAll = selector => selector === '.mark' ? [root] : selector === '.mark .score-board' ? [board]
        : selector.includes('.el-message-box__wrapper') && state.blocked ? [visible()] : [];
    sb.showToast = message => state.notices.push(message);
    sb.setTimeout = callback => { state.polls++; state.onPoll?.(); queueMicrotask(callback); return 0; };
    sb.fetchImageAsBase64 = async value => value;
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/adapters/wentongyun/adapter.js'), 'utf8'), sb);
    return { sb, state, root, board, parent, boardVm, image, palette, advance, adapter: sb.__AI_MARKER_ADAPTER__ };
};
