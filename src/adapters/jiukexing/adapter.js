// 九科星考试阅卷：原生答卷、完整题块、Vue 评分登记及保存回执。
const JiukexingAdapter = {
    name: '九科星', id: 'jiukexing',
    urlPatterns: ['*://marking.jkxjxw.com/*'], iconUrl: '',
    _pendingScores: null, _collectedPaper: null, _submittedPaper: null, _submitting: false,

    shouldInitialize() {
        return window.location.hostname === 'marking.jkxjxw.com';
    },
    _page() {
        if (!this.shouldInitialize() || !/^\/(?:marking|reviewMarking)\/?$/.test(window.location.pathname)) return null;
        const queue = [document.querySelector('#app')?.__vue__], seen = new Set();
        while (queue.length) {
            const page = queue.shift();
            if (!page || seen.has(page)) continue;
            seen.add(page);
            if (Array.isArray(page.getGradeList) && Array.isArray(page.imgsList)
                && page.markingNow && typeof page.submit === 'function' && typeof page.changePaper === 'function') return page;
            queue.push(...(page.$children || []));
        }
        return null;
    },
    getTaskIdentifier() {
        const page = this._page(), query = new URL(window.location.href).searchParams;
        return 'jiukexing_' + JSON.stringify([
            page?.examId ?? query.get('examId'), page?.subjectId ?? query.get('subjectId'),
            page?.questionvalue ?? query.get('questionBlockId'), page?.isdp ?? query.get('isdp')
        ].map(value => value == null ? '' : String(value)));
    },
    getPaperIdentity() {
        const page = this._page(), paper = page?.markingNow;
        return paper?.id != null && String(paper.id).trim() !== ''
            ? JSON.stringify([this.getTaskIdentifier(), String(paper.id), String(paper.scanPaperId ?? ''),
                String(paper.markingRecordId ?? '')]) : null;
    },
    matchesLegacyTaskIdentifier(value) {
        try {
            const url = new URL(value), page = this._page();
            return !!page && url.hostname === 'marking.jkxjxw.com' && url.pathname === '/marking'
                && [['examId', page.examId], ['subjectId', page.subjectId], ['questionBlockId', page.questionvalue], ['isdp', page.isdp]]
                    .every(([key, current]) => url.searchParams.get(key) === String(current));
        } catch (_) { return false; }
    },
    _url(raw) {
        try {
            if (typeof raw !== 'string' || !raw.trim()) return null;
            const url = new URL(raw, window.location.href);
            if (!/^https?:$/.test(url.protocol)) return null;
            url.hash = '';
            return url.href;
        } catch (_) { return null; }
    },
    _state() {
        const page = this._page(), paper = page?.markingNow;
        if (!paper?.id || page.lockScreen || page.yi || this.isRegradeMode()
            || !Array.isArray(paper.markingUrlList) || !paper.markingUrlList.length
            || String(paper.questionBlockId) !== String(page.questionvalue)
            || page.imgsList.length !== 1 || page.imgsList[0].showLoading !== false) return null;
        const urls = paper.markingUrlList.map(item => this._url(item.markingUrlObj));
        const rendered = page.imgsList[0].imgUrl;
        const images = Array.from(document.querySelectorAll(JIUKEXING_SELECTORS.ANSWER_IMAGE));
        if (urls.some(url => !url) || !Array.isArray(rendered) || rendered.length !== urls.length
            || rendered.some((item, i) => this._url(item.markingUrlObj) !== urls[i])
            || images.length !== urls.length || images.some((img, i) => this._url(img.getAttribute('src')) !== urls[i]
                || !img.complete || !(img.naturalWidth > 0) || !(img.naturalHeight > 0))) return null;
        return { page, urls, images, paperId: String(paper.id), questionBlockId: String(paper.questionBlockId),
            identity: this.getPaperIdentity(), task: this.getTaskIdentifier() };
    },
    isMarkingPage() {
        return !!this._page() && !!document.querySelector('.MTcontainer_content');
    },
    async detectMarkingPage() {
        return this.isMarkingPage();
    },
    async gatherAnswerImages() {
        const task = this.getTaskIdentifier(), signal = window.aiGradingState?.activeRun?.controller?.signal;
        const started = Date.now();
        let previous = null;
        while (Date.now() - started < 8000) {
            if (signal?.aborted || this.getTaskIdentifier() !== task || !this.isMarkingPage()) return [];
            const state = this._state();
            if (state && previous?.identity === state.identity && JSON.stringify(previous.urls) === JSON.stringify(state.urls)
                && state.images.every((img, i) => img === previous.images[i])) {
                this._collectedPaper = { identity: state.identity, task };
                return state.urls;
            }
            previous = state;
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        return [];
    },
    async fetchImageAsBase64(url, signal) { return fetchImageAsBase64(url, signal); },
    _scoreRule(page, unit) {
        const parent = page.questionObj;
        const rule = Array.isArray(parent?.childList) && parent.childList.length
            ? page.getChildScoreStepConfig?.(unit) : parent;
        return { mode: Number(rule?.enableScoreStep) || 0, interval: Number(rule?.intervalScore) || 0,
            values: String(rule?.fixedScore ?? '').split(',').map(value => value.trim()).filter(Boolean).map(Number) };
    },
    getScoreInputs() {
        const page = this._page();
        if (!page?.markingNow?.id || this.isRegradeMode()) return [];
        const elements = Array.from(document.querySelectorAll('.quesGrade .input_btn'));
        if (!page.getGradeList.length || elements.length !== page.getGradeList.length) return [];
        return page.getGradeList.map((unit, i) => ({ element: elements[i], label: String(unit.customQuestionNumber),
            index: i, maxScore: Number(unit.score), questionId: String(unit.customQuestionNumber), nativeUnit: unit,
            scoreRule: this._scoreRule(page, unit) }));
    },
    _matches(pending) {
        const state = this._state(), inputs = this.getScoreInputs();
        return !!pending && !!state && state.page === pending.page && state.identity === pending.identity
            && state.task === pending.task && JSON.stringify(state.urls) === JSON.stringify(pending.urls)
            && !pending.signal?.aborted
            && !window.aiGradingState?.activeRun?.controller?.signal?.aborted
            && state.page.radio === 2 && state.page.checked === false && !state.page.isSubmit && !state.page.isSubmitting
            && inputs.length === pending.inputs.length && inputs.every((unit, i) =>
                unit.element === pending.inputs[i].element && unit.questionId === pending.inputs[i].questionId
                && unit.nativeUnit === pending.inputs[i].nativeUnit
                && JSON.stringify(unit.scoreRule) === JSON.stringify(pending.inputs[i].scoreRule)
                && unit.maxScore === pending.inputs[i].maxScore && !unit.element.disabled && !unit.element.readOnly);
    },
    _matchesPending(pending) {
        return this._matches(pending) && this.getScoreInputs().every((unit, i) =>
            String(unit.element.value).trim() !== '' && Number(unit.element.value) === pending.scores[i]
            && String(unit.nativeUnit.grade).trim() !== '' && Number(unit.nativeUnit.grade) === pending.scores[i]);
    },
    fillScores(scores) {
        this._pendingScores = null;
        if (this._submitting) return false;
        const state = this._state(), inputs = this.getScoreInputs();
        if (state?.page.checked) {
            showToast('请关闭九科星的“自动提交”，由批改助手确认后提交');
            return false;
        }
        if (!state || (this._collectedPaper && (this._collectedPaper.identity !== state.identity || this._collectedPaper.task !== state.task))
            || !Array.isArray(scores) || !inputs.length || scores.length !== inputs.length
            || inputs.some((unit, i) => typeof scores[i] !== 'number' || !Number.isFinite(scores[i])
                || scores[i] < 0 || !(unit.maxScore > 0) || scores[i] > unit.maxScore
                || Math.abs(scores[i] * 2 - Math.round(scores[i] * 2)) > 1e-8
                || (unit.scoreRule.mode === 1 && unit.scoreRule.interval > 0
                    && scores[i] % unit.scoreRule.interval !== 0 && scores[i] !== unit.maxScore)
                || (unit.scoreRule.mode === 2 && unit.scoreRule.values.length
                    && !unit.scoreRule.values.includes(scores[i])))) return false;
        const pending = { ...state, inputs, scores: scores.slice(), signal: window.aiGradingState?.activeRun?.controller?.signal };
        if (!this._matches(pending)) return false;
        // 原生 openFlag 清除键盘自动提交计时器，避免切换设置前遗留的计时器提交本次分数。
        if (typeof state.page.openFlag === 'function') state.page.openFlag();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        for (let i = 0; i < inputs.length; i++) {
            if (!this._matches(pending)) return false;
            setter.call(inputs[i].element, scores[i]);
            // 原生 v-model 只需 input。keyup/Enter、快捷满零按钮会触发平台提交。
            inputs[i].element.dispatchEvent(new Event('input', { bubbles: true }));
            if (!this._matches(pending)) return false;
        }
        if (!this._matchesPending(pending)) return false;
        this._pendingScores = pending;
        return true;
    },
    async submitGrade(guard) {
        if (this._submitting) return false;
        const pending = this._pendingScores;
        this._pendingScores = null;
        if (!pending || guard?.signal?.aborted || (guard && !guard.isCurrent()) || !this._matchesPending(pending)) return false;
        this._submitting = true;
        let timer, endpoint, original, capture;
        try {
            if (guard) await guard.verify();
            if (guard?.signal?.aborted || (guard && !guard.isCurrent()) || !this._matchesPending(pending)) return false;
            const btn = document.querySelector(JIUKEXING_SELECTORS.SUBMIT_BUTTON);
            endpoint = pending.page.$api?.task;
            original = endpoint?.submitScore;
            if (!btn || btn.disabled || typeof original !== 'function') return false;
            let receipt = null, calls = 0;
            capture = function (payload, ...rest) {
                calls++;
                const children = payload?.childList;
                if (calls !== 1 || String(payload?.paperId) !== pending.paperId
                    || String(payload?.questionBlockId) !== pending.questionBlockId
                    || Number(payload?.studentScore) !== pending.scores.reduce((sum, value) => sum + value, 0)
                    || (pending.inputs.length > 1 && (!Array.isArray(children) || children.length !== pending.scores.length
                        || children.some((child, i) => Number(child.studentScore) !== pending.scores[i]
                            || String(child.customQuestionNumber) !== pending.inputs[i].questionId)))) {
                    throw new Error('平台提交的分数与本次评分不一致，请核对后重试');
                }
                const request = original.call(this, payload, ...rest);
                receipt = Promise.resolve(request).then(result => result?.code === 0, () => false);
                return request;
            };
            endpoint.submitScore = capture;
            if (endpoint.submitScore !== capture) return false;
            this._submittedPaper = { identity: pending.identity, task: pending.task };
            try { btn.click(); } finally { if (endpoint.submitScore === capture) endpoint.submitScore = original; }
            // 本地校验拒绝或最短时长未满足时，原生函数不会发送保存请求。
            if (!receipt || calls !== 1) return false;
            const accepted = await Promise.race([receipt, new Promise(resolve => { timer = setTimeout(() => resolve(false), 30000); })]);
            if (!accepted) showToast('平台尚未确认保存，请核对阅卷记录后继续');
            return accepted && !pending.signal?.aborted && !guard?.signal?.aborted && (!guard || guard.isCurrent())
                && this.getTaskIdentifier() === pending.task;
        } finally {
            clearTimeout(timer);
            if (endpoint && endpoint.submitScore === capture) endpoint.submitScore = original;
            this._submitting = false;
        }
    },
    async waitForNextPaper(oldImageUrl, options = {}) {
        const task = this.getTaskIdentifier();
        if (options.taskId && options.taskId !== task) return false;
        const baseline = this._submittedPaper?.task === task ? this._submittedPaper : this._collectedPaper;
        const oldId = options.paperId || (baseline?.task === task ? baseline.identity : null);
        if (!oldId) return false;
        const started = Date.now();
        while (Date.now() - started < 30000) {
            if (options.signal?.aborted || this.getTaskIdentifier() !== task) return false;
            const state = this._state();
            if (state && state.identity !== oldId) return true;
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        return false;
    },
    isRegradeMode() {
        const page = this._page();
        return window.location.pathname === '/reviewMarking' || page?.oldornew === 'old'
            || !!window.aiGradingState?.isRegrading;
    },
    detectSubQuestions() { return []; },

    // 页面加载后设置 z-index，解决 Vue 组件遮挡问题
    onPageLoad() {
        if (document.getElementById('jiukexing-zindex-fix')) return;
        const style = document.createElement('style');
        style.id = 'jiukexing-zindex-fix';
        style.textContent = `
            /* 提高脚本 UI 的 z-index，避免被九科星平台元素遮挡 */
            .ai-grade-btn, .ai-history-btn, .ai-settings-btn,
            .ai-toast, #ai-history-panel, #ai-grading-settings,
            .ai-modal-overlay, #correction-panel,
            #auto-submit-dialog, #asd-minimized-bar,
            #ai-stream-container, #ai-history-overlay {
                z-index: 2147483640 !important;
            }
        `;
        document.head.appendChild(style);
        console.log('[九科星] 已注入 z-index 修复样式');
    },
};

// 注册适配器
if (JiukexingAdapter.shouldInitialize() && !window.__AI_MARKER_ADAPTER__) {
    window.__AI_MARKER_ADAPTER__ = JiukexingAdapter;

    // 立即注入 z-index 修复样式
    const style = document.createElement('style');
    style.id = 'jiukexing-zindex-fix';
    style.textContent = `
        /* 提高脚本 UI 的 z-index，避免被九科星平台元素遮挡 */
        .ai-grade-btn, .ai-history-btn, .ai-settings-btn,
        .ai-toast, #ai-history-panel, #ai-grading-settings,
        .ai-modal-overlay, #correction-panel,
        #auto-submit-dialog, #asd-minimized-bar,
        #ai-stream-container, #ai-history-overlay,
        #ai-stream-panel {
            z-index: 2147483640 !important;
        }
    `;
    document.head.appendChild(style);

    // 用 JS 强制修改内联样式，覆盖所有脚本 UI 元素
    const JIUKEXING_UI_SELECTORS = [
        '.ai-grade-btn', '.ai-history-btn', '.ai-settings-btn',
        '#ai-grading-settings', '#ai-history-panel', '#ai-history-overlay',
        '#ai-history-detail', '#ai-stream-panel', '#auto-submit-dialog',
        '#asd-minimized-bar', '#correction-panel', '.ai-modal-overlay',
        '.ai-toast', '#ai-update-dialog'
    ];

    const fixInlineZIndex = () => {
        document.querySelectorAll(JIUKEXING_UI_SELECTORS.join(', ')).forEach(el => {
            el.style.setProperty('z-index', '2147483640', 'important');
        });
    };

    // 多次尝试，确保在 UI 创建后执行
    setTimeout(fixInlineZIndex, 3000);
    setTimeout(fixInlineZIndex, 5000);
    setTimeout(fixInlineZIndex, 8000);

    // 监听 DOM 变化，自动修复新创建的脚本 UI 元素
    const observer = new MutationObserver(() => fixInlineZIndex());
    observer.observe(document.body, { childList: true, subtree: true });

    console.log('[九科星] 已注入 z-index 修复样式');
}
