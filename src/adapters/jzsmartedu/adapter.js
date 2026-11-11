// 焦作精准教学：单份单评、键盘打分。只读原生组件状态，写分走原生输入事件。
const JzsmarteduAdapter = {
    name: '焦作精准教学',
    id: 'jzsmartedu',
    urlPatterns: ['https://jzjx.jzsmartedu.cn/dnpc/*'],
    iconUrl: '',

    _application() {
        return window.location.hostname === 'jzjx.jzsmartedu.cn'
            && window.location.pathname === '/dnpc/';
    },
    _route() {
        return this._application() && /^#\/v2\/read-paper\/?(?:\?|$)/.test(window.location.hash);
    },
    shouldInitialize() {
        return this._route() && !!document.querySelector('#read-paper-score-board.page-read-paper-score-board')
            && !!document.querySelector('#tab-3') && !!document.querySelector('.body-center-main');
    },
    _visible(el) {
        if (!el?.getClientRects().length) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    },
    getTaskIdentifier() {
        const query = new URLSearchParams(window.location.hash.split('?')[1] || '');
        return `jzsmartedu_${new URL(window.location.href).origin}_${JSON.stringify([
            query.get('examPaperId'), query.get('readBlockId'), query.get('readPaperType')])}`;
    },
    _state() {
        if (!this.shouldInitialize()) return null;
        const board = document.querySelector('#read-paper-score-board');
        const vm = board?.__vue__, parent = vm?.$parent;
        const query = new URLSearchParams(window.location.hash.split('?')[1] || '');
        if (!this._visible(board) || vm?.$options?.name !== 'ScoreBoard' || !parent
            || vm.type !== 2 || parent.type !== 2 || String(parent.readPaperType) !== '1'
            || vm.isHistory || parent.isHistory || parent.isTrialRead || parent.isPrincipal
            || vm.loading || parent.loading || parent.animationIng
            || !query.get('examPaperId') || !query.get('readBlockId') || query.get('readPaperType') !== '1'
            || String(parent.examPaperId) !== query.get('examPaperId')
            || String(parent.readBlockId) !== query.get('readBlockId')
            || String(vm.currQuesBlock?.readBlockId) !== query.get('readBlockId')) return null;
        const item = vm.readItem;
        const data = item?.data;
        const id = value => (typeof value === 'string' || typeof value === 'number') && String(value).trim() !== '';
        if (!id(item?.examResultItemId) || !Array.isArray(data) || data.length !== 1
            || !id(data[0].examResultItemId) || !id(data[0].paperReadId)
            || item !== parent.cacheImageList?.[0]) return null;
        return { board, vm, parent, item, data: data[0], task: this.getTaskIdentifier(),
            identity: JSON.stringify([this.getTaskIdentifier(), item.examResultItemId,
                data[0].examResultItemId, data[0].paperReadId]) };
    },
    _images(state) {
        if (!state) return [];
        const roots = Array.from(document.querySelectorAll('.body-center-main')).filter(el => this._visible(el));
        if (roots.length !== 1) return [];
        const images = Array.from(roots[0].querySelectorAll('.js-image.img-item')).filter(el => this._visible(el));
        if (!images.length) return [];
        const urls = new Set();
        for (const image of images) {
            if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return [];
            let node = image;
            while (node && node !== roots[0] && !node.__vue__) node = node.parentElement;
            const vm = node?.__vue__;
            if (!vm || vm.readItem !== state.data || vm.saveFileUrl !== state.data.saveFileUrl
                || !Array.isArray(vm.showSrcList) || !vm.showSrcList.some(entry => entry.src === image.src)
                || !Array.isArray(vm.saveFileUrlList) || !vm.saveFileUrlList.length) return [];
            for (const entry of vm.saveFileUrlList) {
                try {
                    const url = new URL(entry.src, window.location.href);
                    if (!/^https?:$/.test(url.protocol)) return [];
                    urls.add(url.href);
                } catch (_) { return []; }
            }
        }
        return Array.from(urls);
    },
    getPaperIdentity() {
        const state = this._state();
        return state && this._images(state).length ? state.identity : null;
    },
    isMarkingPage() { return !!this.getPaperIdentity(); },
    async detectMarkingPage() { return this.isMarkingPage(); },
    async gatherAnswerImages() { return this._images(this._state()); },
    async fetchImageAsBase64(url) { return fetchImageAsBase64(url); },

    _unit(state) {
        if (!state || state.vm.boardType !== '3' || state.vm.autoSubmit) return null;
        const fields = Array.from(state.board.querySelectorAll('.keyboard .single-score-box input.el-input__inner[placeholder="得分"]'))
            .filter(el => this._visible(el));
        const entries = state.vm.effectScoreList;
        const reads = state.vm.currQuesBlock.paperRead;
        if (fields.length !== 1 || fields[0].disabled || fields[0].readOnly
            || !Array.isArray(entries) || entries.length !== 1 || !Array.isArray(reads) || reads.length !== 1
            || state.vm.scorePointListModel?.length !== 1 || state.parent.scoreList?.length !== 1) return null;
        const entry = entries[0], read = reads[0];
        const max = Number(entry.fullScore), step = Number(read.step);
        if (entry !== state.vm.scorePointListModel[0] || !entry.label || !Number.isFinite(max) || max <= 0
            || max !== Number(read.scoreValue) || read.step == null || String(read.step).trim() === ''
            || !Number.isFinite(step) || step < 0
            || (read.pointDetail?.length > 1) || !Array.isArray(read.scoreOptions)) return null;
        const options = read.scoreOptions.map(value => String(value).trim() === '' ? NaN : Number(value));
        if (options.some(value => !Number.isFinite(value) || value < 0 || value > max)) return null;
        return { element: fields[0], label: String(entry.label), index: 0, maxScore: max,
            step, options, signature: JSON.stringify([entry.label, max, step, options]) };
    },
    getScoreInputs() {
        const unit = this._unit(this._state());
        return unit ? [unit] : [];
    },
    _valid(score, unit) {
        if (!unit || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > unit.maxScore
            || Math.abs(score * 100 - Math.round(score * 100)) > 1e-7) return false;
        if (unit.options.length) return unit.options.some(value => Math.abs(value - score) < 1e-8);
        return score === 0 || score === unit.maxScore || unit.step === 0
            || Math.abs(score / unit.step - Math.round(score / unit.step)) < 1e-7;
    },
    _notify(message) { if (typeof showToast === 'function') showToast(message); },
    onPageLoad() {
        if (this._state()?.vm.boardType !== '3') this._notify('请先选择平台的“键盘打分”，关闭平台自动提交后使用');
    },
    fillScores(scores) {
        this._pending = null;
        if (this._submitting) return false;
        const state = this._state(), unit = this._unit(state);
        if (!unit) {
            this._notify('请使用单份单评的“键盘打分”，并关闭平台自动提交');
            return false;
        }
        if (!this._images(state).length || !Array.isArray(scores) || scores.length !== 1 || !this._valid(scores[0], unit)) {
            this._notify('请核对当前答卷、满分和给分档位后再批改');
            return false;
        }
        const pending = { state, unit, score: scores[0] };
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(unit.element, String(scores[0]));
        // input 更新键盘给分模型；change 触发 pointScoreChange 同步父组件实际提交分数。
        // 不发 keyup、回车或 blur，避免平台的自动提交和快捷键分支。
        unit.element.dispatchEvent(new Event('input', { bubbles: true }));
        if (!this._current(pending, false)) return false;
        unit.element.dispatchEvent(new Event('change', { bubbles: true }));
        if (!this._current(pending, true)) return false;
        this._pending = pending;
        return true;
    },
    _current(pending, checkScores) {
        const current = this._state(), unit = this._unit(current);
        if (!current || !unit || current.identity !== pending.state.identity || current.vm !== pending.state.vm
            || unit.element !== pending.unit.element || unit.signature !== pending.unit.signature
            || !this._images(current).length || !this._valid(pending.score, unit)) return false;
        if (!checkScores) return true;
        const values = [unit.element.value, current.vm.effectScoreList[0].score, current.parent.scoreList[0].score];
        return values.every(value => value !== null && value !== undefined && String(value).trim() !== ''
            && Number(value) === pending.score);
    },
    async submitGrade(guard) {
        const pending = this._pending;
        this._pending = null;
        if (!pending || this._submitting) return false;
        this._submitting = true;
        try {
            if (guard && !guard.isCurrent()) return false;
            if (guard) await guard.verify();
            if ((guard && !guard.isCurrent()) || !this._current(pending, true)) return false;
            const buttons = Array.from(pending.state.board.querySelectorAll('.keyboard .submit-section button'))
                .filter(el => this._visible(el) && el.textContent.trim() === '提交');
            if (buttons.length !== 1 || buttons[0].disabled) return false;
            const selector = '.el-message.el-message--success';
            const existing = new Set(document.querySelectorAll(selector));
            const rawCount = pending.state.parent.readProgressInfo?.myselfReadCount;
            const previousCount = Number(rawCount);
            if (rawCount == null || String(rawCount).trim() === '' || !Number.isInteger(previousCount) || previousCount < 0) return false;
            const started = new Set();
            // 仅接受本次点击后新出现、包含本次得分的原生成功提示。
            const collect = () => {
                for (const el of document.querySelectorAll(selector)) {
                    if (!existing.has(el) && this._visible(el)
                        && el.textContent.trim() === `提交成功！${pending.score}分`) started.add(el);
                }
            };
            const observer = new MutationObserver(collect);
            observer.observe(document.body, { subtree: true, childList: true, characterData: true });
            try {
                buttons[0].click();
                for (let count = 0; count < 100; count++) {
                    collect();
                    // 正常成功后平台立即换卷，答卷守卫此时会失效；仅在点击前校验该守卫。
                    if (guard?.signal?.aborted
                        || this.getTaskIdentifier() !== pending.state.task) return false;
                    if (started.size && Number(pending.state.parent.readProgressInfo?.myselfReadCount) > previousCount) return true;
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } finally { observer.disconnect(); }
            this._notify('未确认提交结果，请在阅卷平台检查后继续');
            return false;
        } finally { this._submitting = false; }
    },
    async waitForNextPaper(oldImageUrl, options = {}) {
        const old = options.paperId;
        for (let count = 0; count < 125; count++) {
            if (options.signal?.aborted || (options.taskId && this.getTaskIdentifier() !== options.taskId)) return false;
            const identity = this.getPaperIdentity(), images = this._images(this._state());
            if (identity && (old ? identity !== old : oldImageUrl && images.length && !images.includes(oldImageUrl))
                && this.getScoreInputs().length === 1) return true;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    },
    isRegradeMode() {
        const vm = document.querySelector('#read-paper-score-board')?.__vue__;
        return !!(vm?.isHistory || vm?.$parent?.isHistory);
    }
};

(function registerJzsmarteduAdapter() {
    if (!JzsmarteduAdapter._application()) return;
    let observer;
    const attempt = () => {
        if (!JzsmarteduAdapter.shouldInitialize()) return;
        const existing = window.__AI_MARKER_ADAPTER__;
        if (!existing) window.__AI_MARKER_ADAPTER__ = JzsmarteduAdapter;
        else if (existing !== JzsmarteduAdapter) console.warn('[焦作精准教学] 保留已注册的平台适配器');
        observer?.disconnect();
        window.removeEventListener('hashchange', attempt);
    };
    observer = new MutationObserver(attempt);
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    window.addEventListener('hashchange', attempt);
    attempt();
})();
