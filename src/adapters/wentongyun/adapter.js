// 文通云：单题、单份、一键给分。分数按钮直接提交，因此填分阶段只暂存。
const WentongyunAdapter = {
    name: '文通云', id: 'wentongyun', iconUrl: '',
    urlPatterns: ['https://www.wtjy.com/*', 'https://wtjy.com/*'],
    _application() {
        return ['www.wtjy.com', 'wtjy.com'].includes(window.location.hostname)
            && /^https:\/\//.test(window.location.href)
            && window.location.pathname === '/';
    },
    _query() { return new URLSearchParams(window.location.hash.split('?')[1] || ''); },
    shouldInitialize() {
        return this._application() && /^#\/mark\/new-mark-question\?(?:.*)$/.test(window.location.hash)
            && !!document.querySelector('.mark .question-cotnent')
            && !!document.querySelector('.mark .score-board');
    },
    _visible(el) {
        if (!el?.getClientRects().length) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    },
    _blocked() {
        return Array.from(document.querySelectorAll('.el-message-box__wrapper, .el-dialog__wrapper, .el-message--error'))
            .some(el => this._visible(el));
    },
    getTaskIdentifier() {
        const q = this._query();
        return `wentongyun_${window.location.hostname}_${JSON.stringify([
            q.get('examPaperId'), q.get('sheetDetailId'), q.get('questionNum'), q.get('type'), q.get('isClass')])}`;
    },
    _id(value) { return (typeof value === 'string' || typeof value === 'number') && String(value).trim() !== ''; },
    _url(value) {
        try {
            const url = new URL(value, window.location.href);
            if (url.protocol !== 'https:' || url.hostname !== 'static.wtjy.com') return null;
            return url;
        } catch (_) { return null; }
    },
    _imageIdentity(value) {
        const url = this._url(value);
        if (!url) return null;
        // 只移除原生追加的无名时间戳；保留 OSS 裁剪、旋转及其他全部参数。
        for (const [key, val] of url.searchParams) if (/^\d{13}$/.test(key) && val === '') url.searchParams.delete(key);
        return url.href;
    },
    _state() {
        if (!this.shouldInitialize() || this._blocked()) return null;
        const roots = Array.from(document.querySelectorAll('.mark')).filter(el => this._visible(el));
        const boards = Array.from(document.querySelectorAll('.mark .score-board')).filter(el => this._visible(el));
        if (roots.length !== 1 || boards.length !== 1) return null;
        const root = roots[0], board = boards[0], vm = board.__vue__, parent = vm?.$parent;
        const common = parent?.questionCommonData, entries = parent?.questionQetailsData, q = this._query();
        if (!parent || root.__vue__ !== parent || parent.$el !== root || vm.$el !== board
            || parent.$refs?.scoreBoard !== vm || !common || !Array.isArray(entries) || entries.length !== 1
            || parent.scoreType !== 1 || parent.loading || vm.loading || parent.submiting || vm.submiting
            || parent.imgErrorFlag || parent.isTemp || parent.reviewStatus || parent.isRotate || parent.clipImage
            || parent.showSetting || parent.remarkScore != null || parent.isRemarks?.length
            || common.markType !== 2 || common.isOption || common.pointList?.length || common.isRemark
            || common.questionNumList?.length !== 1 || common.sheetDetailIdList?.length !== 1
            || q.get('type') !== '1' || q.get('again') !== '0' || q.get('isClass') !== '0'
            || q.get('reviewBoolean') || q.get('arbitration') || q.get('reappraisal')
            || parent.queryData?.reviewBoolean || parent.queryData?.arbitration || parent.queryData?.reappraisal) return null;
        for (const key of ['type', 'again', 'isClass']) {
            if (q.getAll(key).length !== 1 || String(parent.queryData?.[key]) !== q.get(key)) return null;
        }
        const item = entries[0];
        const count = parent.workloadData?.readCount;
        if (!Number.isInteger(count) || count < 0 || !this._id(item.readCount)
            || Number(item.readCount) !== count) return null;
        for (const key of ['examPaperId', 'sheetDetailId', 'questionNum']) {
            if (q.getAll(key).length !== 1 || !this._id(q.get(key)) || String(common[key]) !== q.get(key)
                || String(item[key]) !== q.get(key) || String(parent.queryData?.[key]) !== q.get(key)) return null;
        }
        if (!this._id(item.id) || !this._id(item.scanRecordId) || !this._id(item.studentId)
            || String(parent.scanRecordId) !== String(item.scanRecordId)
            || item.type !== 1 || item.studentScore != null || item.changeScore != null
            || item.isRemark || item.hasThird || item.hasArbitration || item.ifRepeat
            || item.abnormalState === 0 || item.switchStatus === 1
            || !this._imageIdentity(item.questionUrl) || typeof vm.getBoolean !== 'function' || vm.getBoolean()) return null;
        return { root, board, vm, parent, common, item, count, task: this.getTaskIdentifier(),
            paperKey: JSON.stringify([this.getTaskIdentifier(), item.id, item.scanRecordId, item.studentId]),
            identity: JSON.stringify([this.getTaskIdentifier(), item.id, item.scanRecordId, item.studentId,
                this._imageIdentity(item.questionUrl)]) };
    },
    _images(state) {
        if (!state) return [];
        const images = Array.from(state.root.querySelectorAll('.question-cotnent .question-item > img'));
        if (images.length !== 1) return [];
        const image = images[0], url = this._url(state.item.questionUrl);
        if (!url || !this._visible(image) || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0
            || image.src !== url.href || (image.currentSrc && image.currentSrc !== url.href)) return [];
        return [url.href];
    },
    _unit(state) {
        if (!state || !this._images(state).length) return null;
        const max = state.common.score, values = state.vm.gradeList;
        const buttons = Array.from(state.board.querySelectorAll('.wrap > .item')).filter(el => this._visible(el));
        if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0 || !Array.isArray(values)
            || values.length < 2 || buttons.length !== values.length
            || values.some((value, i) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max
                || (i > 0 && value <= values[i - 1]) || buttons[i].classList.contains('ban')
                || buttons[i].textContent.trim().replace(/\s+/g, '') !== `${value}分`)
            || values[0] !== 0 || values[values.length - 1] !== max) return null;
        return { element: state.board, label: String(state.item.questionNum), index: 0, maxScore: max,
            buttons, options: [...values], signature: JSON.stringify([max, values]) };
    },
    getPaperIdentity() {
        const state = this._state();
        return this._unit(state) ? state.identity : null;
    },
    isMarkingPage() { return !!this.getPaperIdentity(); },
    async detectMarkingPage() { return this.isMarkingPage(); },
    async gatherAnswerImages() { return this._images(this._state()); },
    async fetchImageAsBase64(url) { return fetchImageAsBase64(url); },
    getScoreInputs() { const unit = this._unit(this._state()); return unit ? [unit] : []; },
    getQuestionContext() {
        const state = this._state(), unit = this._unit(state);
        return unit ? { question: unit.label, units: [{ label: unit.label, maxScore: unit.maxScore }] } : null;
    },
    _current(pending) {
        const state = this._state(), unit = this._unit(state);
        return state && unit && state.identity === pending.state.identity && state.parent === pending.state.parent
            && state.count === pending.state.count
            && state.vm === pending.state.vm && state.item === pending.state.item
            && unit.signature === pending.unit.signature && unit.element === pending.unit.element
            && typeof pending.score === 'number' && unit.options.includes(pending.score) ? { state, unit } : null;
    },
    fillScores(scores) {
        this._pending = null;
        if (this._submitting) return false;
        const state = this._state(), unit = this._unit(state);
        if (!unit || !Array.isArray(scores) || scores.length !== 1 || typeof scores[0] !== 'number'
            || !unit.options.includes(scores[0])) return false;
        this._pending = { state, unit, score: scores[0] };
        return true;
    },
    async submitGrade(guard) {
        const pending = this._pending;
        this._pending = null;
        if (!pending || this._submitting) return false;
        this._submitting = true;
        try {
            if (guard && !guard.isCurrent()) return false;
            if (guard) await guard.verify();
            const current = this._current(pending);
            if ((guard && !guard.isCurrent()) || !current) return false;
            const { parent, item } = current.state;
            const count = parent.workloadData?.readCount;
            if (!Number.isInteger(count) || count < 0) return false;
            const button = current.unit.buttons[current.unit.options.indexOf(pending.score)];
            this._submittedPaper = pending.state.identity;
            button.click();
            // 原生失败分支也会重新取卷；换图本身不能证明成绩已保存。
            for (let poll = 0; poll < 120; poll++) {
                if (guard?.signal?.aborted || this.getTaskIdentifier() !== pending.state.task || this._blocked()) return false;
                const sent = parent.scoreBoard;
                if (!Array.isArray(sent) || sent.length !== 1 || sent[0].score !== pending.score
                    || String(sent[0].scanRecordId) !== String(item.scanRecordId)
                    || String(sent[0].studentId) !== String(item.studentId)
                    || String(sent[0].examPaperId) !== String(item.examPaperId)
                    || String(sent[0].sheetDetailId) !== String(item.sheetDetailId)
                    || String(sent[0].questionNum) !== String(item.questionNum) || sent[0].again !== 0) return false;
                if (parent.workloadData?.readCount === count + 1) return true;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (typeof showToast === 'function') showToast('未确认提交结果，请在文通云检查后继续');
            return false;
        } finally { this._submitting = false; }
    },
    async waitForNextPaper(_oldImageUrl, options = {}) {
        let baseline = null, baselineTask = null;
        try {
            const parts = JSON.parse(options.paperId || this._submittedPaper);
            if (Array.isArray(parts) && parts.length === 5 && typeof parts[0] === 'string') {
                baseline = JSON.stringify(parts.slice(0, 4)); baselineTask = parts[0];
            }
        } catch (_) { /* 无法确认基线时停止等待 */ }
        if (!baseline) return false;
        let candidate = null;
        for (let poll = 0; poll < 150; poll++) {
            if (options.signal?.aborted || baselineTask !== this.getTaskIdentifier()
                || (options.taskId && options.taskId !== baselineTask) || this._blocked()) return false;
            const state = this._state(), unit = this._unit(state);
            // 同一业务答卷重新裁剪也会改变完整校验指纹，但不能成为下一份答卷。
            const changed = state && unit && state.paperKey !== baseline;
            if (changed && candidate === state.identity) return true;
            candidate = changed ? state.identity : null;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    },
    isRegradeMode() {
        const q = this._query(), parent = document.querySelector('.mark .score-board')?.__vue__?.$parent;
        return !!(parent?.reviewStatus || q.get('reviewBoolean') || q.get('reappraisal') || q.get('again') === '1');
    }
};

(function registerWentongyunAdapter() {
    if (!WentongyunAdapter._application()) return;
    let observer;
    const attempt = () => {
        if (!WentongyunAdapter.shouldInitialize()) return;
        const existing = window.__AI_MARKER_ADAPTER__;
        if (!existing) window.__AI_MARKER_ADAPTER__ = WentongyunAdapter;
        observer?.disconnect();
        window.removeEventListener('hashchange', attempt);
    };
    observer = new MutationObserver(attempt);
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    window.addEventListener('hashchange', attempt);
    attempt();
})();
