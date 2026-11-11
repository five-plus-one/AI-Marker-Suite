const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeStub } = require('./_adapter-matrix');

module.exports = function fixture(options = {}) {
    const sb = makeStub({ host: 'marking.jkxjxw.com', path: '/marking' });
    const state = { clock: 0, events: [], notices: [], clicks: 0, requests: [], mode: 'success', polls: 0, timers: new Map() };
    class Input {
        constructor(index) { this.index = index; this._value = ''; this.disabled = false; this.readOnly = false; }
        get value() { return this._value; }
        set value(value) { this._value = String(value); }
        dispatchEvent(event) {
            state.events.push(event.type);
            if (event.type === 'input' && !state.dropInput) page.getGradeList[this.index].grade = this.value;
            state.afterInput?.(this);
        }
    }
    const inputs = Array.from({ length: options.units || 1 }, (_, i) => new Input(i));
    const endpoint = { submitScore(payload) {
        state.requests.push(payload);
        if (state.mode === 'throw') throw Error('network');
        if (state.mode === 'reject') return Promise.reject(Error('network'));
        if (state.mode === 'pending') return new Promise(resolve => { state.resolve = resolve; });
        if (state.mode === 'refresh-refused') return Promise.resolve({ code: 13303, msg: '提交分数失败，请刷新页面后重试！' });
        return Promise.resolve({ code: state.mode === 'refused' ? 13303 : 0 });
    } };
    const original = endpoint.submitScore;
    const page = { $children: [], getGradeList: [], imgsList: [], markingNow: {}, examId: 'exam', subjectId: 'subject',
        questionvalue: 'block', isdp: 1, radio: 2, checked: false, oldornew: 'new', lockScreen: false, yi: false,
        isSubmit: false, isSubmitting: false, $api: { task: endpoint }, submit() {}, changePaper() {}, openFlag() { state.cancelledAuto = true; },
        afterOperate() { state.activityCount = (state.activityCount || 0) + 1; state.idleDeadline = state.clock + 600000;
            if (state.failActivity) throw Error('activity'); } };
    const advance = (id = 'B', sameUrl = false) => {
        page.markingNow = { id, scanPaperId: 'scan-' + id, markingRecordId: 'record-' + id, questionBlockId: 'block',
            markingUrlList: Array.from({ length: options.images || 1 }, (_, i) => ({ markingUrlObj: `https://obs.test/${sameUrl ? 'A' : id}-${i}.jpg?crop=${i}` })) };
        page.imgsList = [{ showLoading: false, imgUrl: page.markingNow.markingUrlList.map(item => ({ ...item })) }];
        page.getGradeList = inputs.map((_, i) => ({ customQuestionNumber: String(13 + i), score: 10, grade: '' }));
        state.images = page.markingNow.markingUrlList.map(item => ({ complete: true, naturalWidth: 1000, naturalHeight: 800,
            src: item.markingUrlObj, getAttribute(key) { return key === 'src' ? this.src : null; } }));
        inputs.forEach(input => { input.value = ''; }); page.isSubmit = false;
    };
    advance('A');
    const button = { disabled: false, click() {
        state.clicks++;
        if (state.mode === 'validation' || state.mode === 'minimum-time') return;
        const payload = { paperId: page.markingNow.id, questionBlockId: page.questionvalue,
            studentScore: page.getGradeList.reduce((sum, unit) => sum + Number(unit.grade), 0),
            childList: page.getGradeList.length > 1 ? page.getGradeList.map(unit => ({ ...unit, studentScore: Number(unit.grade) })) : [] };
        state.beforeSave?.(payload);
        endpoint.submitScore(payload).then(result => {
            if (result.code === 0 && state.mode === 'success') advance('B', state.sameUrl);
        }, () => {});
    } };
    const query = sb.document.querySelector;
    const autoSubmit = { checked: true, disabled: false,
        closest() { return { textContent: '自动提交' }; },
        click() { state.autoClicks = (state.autoClicks || 0) + 1;
            if (!state.dropAutoClick) { this.checked = false; page.checked = false; }
            state.afterAutoClick?.();
        } };
    const recoveryButton = { disabled: false, click() {
        state.recoveryClicks = (state.recoveryClicks || 0) + 1;
        if (!state.noRefresh) advance(state.recoverSamePaper ? page.markingNow.id : 'REFRESHED');
        state.afterRecovery?.();
    } };
    const recoveryDialog = { getClientRects() { return state.hideRecovery ? [] : [{}]; },
        querySelector() { return { textContent: state.recoveryMessage || '提交分数失败，请刷新页面后重试！' }; },
        querySelectorAll() { return [recoveryButton]; } };
    sb.document.querySelector = selector => selector === '#app' ? { __vue__: { $children: [page] } }
        : selector === '.MTcontainer_content' ? {} : selector === '.submitbtn' ? button : query(selector);
    sb.document.querySelectorAll = selector => selector === '.examText .imgBG img' ? state.images
        : selector === '.quesGrade .input_btn' ? inputs
        : selector === '.el-message-box__wrapper' ? (state.noRecoveryDialog ? [] : [recoveryDialog])
        : selector === '.MTcontainer_content .autosubmit input[type="checkbox"]' ? (state.noAutoControl ? [] : [autoSubmit]) : [];
    sb.HTMLInputElement = Input; sb.showToast = text => state.notices.push(text);
    sb.fetchImageAsBase64 = async url => url;
    sb.aiGradingState = { activeRun: { controller: new AbortController() } };
    sb.Date = class extends Date { static now() { return state.clock; } };
    sb.setTimeout = (fn, delay) => {
        const id = state.timers.size + 1;
        if (delay <= 300) queueMicrotask(() => { state.clock += delay; state.polls++; state.onPoll?.(); fn(); });
        else state.timers.set(id, fn);
        return id;
    };
    sb.clearTimeout = id => state.timers.delete(id);
    vm.createContext(sb);
    for (const file of ['selectors.js', 'adapter.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/adapters/jiukexing', file), 'utf8'), sb);
    return { sb, state, page, inputs, endpoint, original, button, autoSubmit, advance, adapter: sb.__AI_MARKER_ADAPTER__ };
};
