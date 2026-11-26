const YUNHEN_ORIGIN = 'https://ercdmark.eduyunhen.com';
const YUNHEN_READ = /^\/exam\/marking\/readPaper\/(\d+)(?:\/\d+){4}\/?$/;
const YUNHEN_SAVE_ORIGIN = 'https://apis.eduyunhen.com';
const YUNHEN_SAVE_PATH = '/marking-main/exam/grad/read_over';
const YUNHEN_IMAGE_HOST = 'bucket1-1315484122.cos.ap-shanghai.myqcloud.com';

const YunhenAdapter = {
    name: '云痕大数据',
    id: 'yunhen',
    iconUrl: '',
    urlPatterns: [`${YUNHEN_ORIGIN}/*`],

    shouldInitialize() { return window.location.origin === YUNHEN_ORIGIN; },
    _page() { return typeof unsafeWindow === 'undefined' ? window : unsafeWindow; },
    _route() { return this.shouldInitialize() && YUNHEN_READ.exec(window.location.pathname); },

    _view() {
        if (!this._route()) return null;
        const document = this._page().document;
        const root = document.querySelector('#app > .marking-container') || document.querySelector('#app .marking-container');
        if (!root) return null;
        if (this._viewCache?.root === root) return this._viewCache;
        const pending = [document.querySelector('#app')?._vnode];
        const seen = new Set();
        while (pending.length && seen.size < 500) {
            const node = pending.pop();
            if (!node || typeof node !== 'object' || seen.has(node)) continue;
            seen.add(node);
            const proxy = node.component?.proxy;
            if (node.el === root && Array.isArray(proxy?.eachList) && typeof proxy.showSubmit === 'function') {
                this._viewCache = { root, proxy };
                return this._viewCache;
            }
            pending.push(node.component?.subTree, node.suspense?.activeBranch);
            if (Array.isArray(node.children)) pending.push(...node.children);
        }
        return null;
    },

    _normal(view) {
        const state = view?.proxy;
        return state && Number(state.readType) === 1 && Number(state.pageSize) === 1
            && Number(state.isMark) === 0 && state.markType === false;
    },

    _units(view) {
        if (!this._normal(view)) return [];
        const fields = [...view.root.querySelectorAll('.manal_mark .board-table input.inputtt')];
        const rows = view.proxy.eachList;
        if (!fields.length || fields.length !== rows.length) return [];
        const units = fields.map((element, index) => {
            const row = rows[index];
            const label = element.closest('tr')?.cells[0]?.textContent.trim();
            const maximum = this._points(row?.stand?.point);
            const displayed = /^满分\s*(\d+(?:\.\d+)?)\s*分$/.exec(element.placeholder)?.[1];
            if (!label || !row?.gradingTodo || !maximum || this._points(displayed) !== maximum
                || row.isError || row.isOriginError || Number(row.isReview || 0) !== 0
                || element.disabled || element.readOnly || !MarkingPaper.visible(element)) return null;
            return { element, index, label, maxScore: maximum / 100, row };
        });
        return units.every(Boolean) ? units : [];
    },

    _points(value) {
        if (!['number', 'string'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) return null;
        const points = Math.round(Number(value) * 100);
        return Number.isSafeInteger(points) ? points : null;
    },

    _task(view, units) {
        if (!units.length) return '';
        const selection = view.proxy.selPanelList?.filter(group => !group.pauseStatus)
            .flatMap(group => group.questionNums.filter(question => question.selected).map(question => question.num));
        if (!selection?.length) return '';
        return JSON.stringify([window.location.pathname.replace(/\/$/, ''), selection,
            ...units.map(({ row, label, maxScore }) => [row.num, label, maxScore])]);
    },

    getGradingTaskIdentifier() {
        const view = this._view();
        return this._task(view, this._units(view));
    },
    getTaskIdentifier() { return this.getGradingTaskIdentifier(); },
    getScoreInputs() {
        return this._units(this._view()).map(({ row, ...unit }) => unit);
    },
    getQuestionContext() {
        const units = this.getScoreInputs();
        return nativeQuestionContext(units, units.length === 1 ? units[0].label : undefined);
    },
    isRegradeMode() {
        return /^\/exam\/marking\/paperReview(?:\/|$)/.test(window.location.pathname);
    },
    isMarkingPage() {
        const view = this._view();
        return !!this._normal(view) && (this._units(view).length > 0 || view.proxy.loading || view.proxy.loadQuestion
            || this.isGradingTaskComplete());
    },

    async detectMarkingPage() {
        for (let attempt = 0; this._route() && attempt < 35; attempt++) {
            if (this._snapshot()?.ready) return true;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },

    _imageUrl(value) {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && !url.port && !url.username && !url.password
                && url.hostname === YUNHEN_IMAGE_HOST && /^\/\d+\/wuhen\//.test(url.pathname)
                && /(?:[?&]|\/)imageMogr2\/(?:cut|crop)\/\d+x\d+x\d+x\d+(?:[&/]|$)/.test(url.href)
                ? url.href : null;
        } catch (_) { return null; }
    },

    _imagesReady(identity, urls) {
        const key = JSON.stringify([identity, urls]);
        if (this._images?.key !== key) {
            const images = urls.map(url => {
                const image = new Image();
                image.src = url;
                return image;
            });
            this._images = { key, images };
        }
        return this._images.images.every(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
    },

    _snapshot() {
        const view = this._view(), units = this._units(view);
        if (!units.length || view.proxy.loading || view.proxy.loadQuestion) return null;
        const groups = view.proxy.originData;
        const questions = groups?.length === 1 && groups[0].questionNums;
        if (!Array.isArray(questions) || !questions.length) return null;
        const task = this._task(view, units);
        const examId = this._route()?.[1];
        if (!examId || !task) return null;
        const plans = questions.map(question => {
            const todo = question.gradingTodo;
            const scoreRows = question.questionSplitVos;
            if (!todo?.id || !todo.resultDetailId || Number(question.isReview || 0) !== 0 || question.isOriginError
                || !Array.isArray(scoreRows) || !scoreRows.length) return null;
            const paper = view.root.ownerDocument.getElementById(`myDiv${todo.id}`);
            if (!paper?.matches('#read_content .each_item') || !view.root.contains(paper) || !MarkingPaper.visible(paper)) return null;
            const { noteStyle, backStyle } = scoreRows[0];
            if (!Array.isArray(noteStyle) || !noteStyle.length) return null;
            const sources = noteStyle.map(image => this._imageUrl(image?.url));
            const displayed = [...paper.querySelectorAll('.img-container > .m-image-label')];
            if (sources.some(url => !url) || displayed.length !== sources.length || displayed.some((element, index) => {
                const background = /^url\(["']?(.*?)["']?\)$/.exec(element.style.backgroundImage)?.[1];
                const expected = view.proxy.expandArea ? this._imageUrl(backStyle?.[index]?.url) : sources[index];
                return !MarkingPaper.visible(element) || !expected || this._imageUrl(background) !== expected;
            })) return null;
            const unitsForQuestion = scoreRows.map(row => units.find(unit => unit.row === row));
            if (unitsForQuestion.some(unit => !unit)) return null;
            return { todoId: String(todo.id), detailId: String(todo.resultDetailId), num: String(todo.num),
                question: String(todo.question), split: question.isSplit === true || Number(question.isSplit) === 1,
                sources, units: unitsForQuestion };
        });
        if (plans.some(plan => !plan) || new Set(plans.map(plan => plan.todoId)).size !== plans.length
            || plans.flatMap(plan => plan.units).some((unit, index) => unit !== units[index])
            || plans.reduce((count, plan) => count + plan.units.length, 0) !== units.length) return null;
        const urls = [...new Set(plans.flatMap(plan => plan.sources))];
        const identity = JSON.stringify([task, ...plans.map(({ todoId, detailId }) => [todoId, detailId])]);
        return { examId, task, identity, units, plans, urls, ready: this._imagesReady(identity, urls), view };
    },

    getPaperIdentity() {
        const paper = this._snapshot();
        return paper?.ready ? paper.identity : '';
    },

    async gatherAnswerImages() {
        const task = this.getGradingTaskIdentifier();
        if (!task) return [];
        let previous = '';
        for (let attempt = 0; attempt < 50; attempt++) {
            if (window.aiGradingState?.abortController?.signal.aborted || this.getGradingTaskIdentifier() !== task) return [];
            const paper = this._snapshot();
            if (paper?.ready && paper.identity === previous) {
                this._gathered = paper;
                return paper.urls.slice();
            }
            previous = paper?.ready ? paper.identity : '';
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return [];
    },

    async fetchImageAsBase64(url, signal) {
        const paper = this._snapshot();
        if (!paper?.ready || this._gathered?.identity !== paper.identity || !paper.urls.includes(url)) {
            throw new Error('当前答题卡已变化，请重新读取');
        }
        return fetchImageAsBase64(url, signal, { autoRefreshOn403: false });
    },

    fillScores(scores) {
        this._filled = null;
        this.lastFillError = '请核对当前答题卡及分数后再填分';
        const paper = this._snapshot();
        if (!paper?.ready || this._gathered?.identity !== paper.identity || this._submitted === paper.identity
            || !Array.isArray(scores) || scores.length !== paper.units.length) return false;
        const values = Array.from(scores, score => this._points(score));
        if (values.some((value, index) => value === null || value > this._points(paper.units[index].maxScore))) return false;
        const page = this._page();
        const setValue = Object.getOwnPropertyDescriptor(page.HTMLInputElement.prototype, 'value').set;
        for (const [index, { element }] of paper.units.entries()) {
            if (this.getPaperIdentity() !== paper.identity) return false;
            setValue.call(element, String(values[index] / 100));
            element.dispatchEvent(new page.Event('input', { bubbles: true }));
        }
        if (this.getPaperIdentity() !== paper.identity || !this._scoresMatch(paper, values)) return false;
        this._filled = { paper, values };
        this.lastFillError = '';
        return true;
    },

    _scoresMatch(paper, values) {
        return paper.units.every(({ element, row }, index) => this._points(element.value) === values[index]
            && this._points(row.gradingTodo.score) === values[index]);
    },

    async submitGrade(guard = {}) {
        const filled = this._filled;
        this._filled = null;
        if (!filled || this._submitting) return false;
        this._submitting = true;
        this.lastSubmitError = '原站未确认保存，请核对阅卷记录后继续';
        try {
            await guard.verify?.();
            const paper = this._snapshot();
            const button = [...(paper?.view.root.querySelectorAll('.manal_mark button') || [])]
                .find(element => element.textContent.trim() === '提交分数');
            if (guard.signal?.aborted || guard.isCurrent?.() === false || !paper?.ready
                || paper.identity !== filled.paper.identity || paper.units.some((unit, index) => unit.element !== filled.paper.units[index]?.element)
                || !this._scoresMatch(paper, filled.values) || this._submitted === paper.identity
                || !MarkingPaper.visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true'
                || button.classList.contains('is-loading')) return false;
            if (paper.plans.some(plan => plan.sources.some((_, index) => {
                const layer = paper.view.proxy.$refs?.[`imageLabel${plan.todoId}${index}`]?.[0];
                return !layer || layer.canvas?.getObjects().length > 0;
            }))) {
                this.lastSubmitError = '请使用阅卷平台保存带批注的答卷';
                return false;
            }
            if (!await this._confirmSave(button, paper, filled.values, guard)) return false;
            this._submitted = paper.identity;
            this.lastSubmitError = '';
            return true;
        } finally { this._submitting = false; }
    },

    _requestMatches(body, paper, values) {
        try {
            const data = JSON.parse(body);
            const questions = data.groupExamQuestionVos?.length === 1 && data.groupExamQuestionVos[0].examQuestionVos;
            return String(data.examId) === paper.examId && Number(data.teacherType) === 1
                && Array.isArray(questions) && questions.length === paper.plans.length
                && paper.plans.every((plan, index) => {
                    const sent = questions[index];
                    return sent && String(sent.todoId) === plan.todoId && String(sent.detailId) === plan.detailId
                        && String(sent.num) === plan.num && String(sent.question) === plan.question
                        && Number(sent.isAbnormal) === 0 && Number(sent.isReview || 0) === 0
                        && (sent.isSplit === true || Number(sent.isSplit) === 1) === plan.split
                        && Math.abs(Number(sent.score) * 100 - plan.units.reduce((sum, unit) => sum + values[unit.index], 0)) < 1e-7
                        && sent.score != null && sent.score !== ''
                        && sent.questionSplitVos?.length === plan.units.length && plan.units.every((unit, offset) => {
                            const split = sent.questionSplitVos[offset];
                            return split && this._points(split.gradingScore) === values[unit.index]
                                && (!plan.split || String(split.splitNum) === String(unit.row.splitNum)
                                    && String(split.splitQuestion) === String(unit.row.splitQuestion));
                        });
                });
        } catch (_) { return false; }
    },

    _confirmSave(button, paper, values, guard) {
        const adapter = this;
        const page = this._page();
        const proto = page.XMLHttpRequest?.prototype;
        if (!proto) return Promise.resolve(false);
        const originalOpen = proto.open, originalSend = proto.send;
        const candidates = new WeakSet();
        return new Promise(resolve => {
            let request, receiptTimer, finished = false;
            const finish = result => {
                if (finished) return;
                finished = true;
                clearTimeout(launchTimer);
                clearTimeout(receiptTimer);
                if (proto.open === open) proto.open = originalOpen;
                if (proto.send === send) proto.send = originalSend;
                request?.removeEventListener('loadend', loaded);
                guard.signal?.removeEventListener('abort', cancel);
                resolve(result);
            };
            const cancel = () => finish(false);
            const sameTask = () => !guard.signal?.aborted && guard.isCurrentTask?.() !== false
                && adapter.getGradingTaskIdentifier() === paper.task;
            const loaded = () => {
                try {
                    const result = request.responseType === 'json' ? request.response : JSON.parse(request.responseText);
                    finish(sameTask() && request.status >= 200 && request.status < 300 && Number(result?.code) === 200);
                } catch (_) { cancel(); }
            };
            function open(method, url, ...rest) {
                const opened = originalOpen.call(this, method, url, ...rest);
                candidates.delete(this);
                if (String(method).toUpperCase() === 'POST') {
                    const target = new URL(url, page.location.href);
                    if (target.origin === YUNHEN_SAVE_ORIGIN && target.pathname === YUNHEN_SAVE_PATH) candidates.add(this);
                }
                return opened;
            }
            function send(body) {
                if (!candidates.has(this)) return originalSend.call(this, body);
                if (request || finished || !sameTask() || paper.view.proxy.loadQuestion || !adapter._requestMatches(body, paper, values)) return cancel();
                request = this;
                clearTimeout(launchTimer);
                receiptTimer = setTimeout(cancel, 15000);
                request.addEventListener('loadend', loaded, { once: true });
                try { return originalSend.call(this, body); }
                catch (_) { return cancel(); }
            }
            const launchTimer = setTimeout(cancel, 4000);
            guard.signal?.addEventListener('abort', cancel, { once: true });
            try {
                if (guard.signal?.aborted) return cancel();
                proto.open = open;
                proto.send = send;
                button.click();
            } catch (_) { cancel(); }
        });
    },

    isGradingTaskComplete() {
        const view = this._view();
        return this._normal(view) && !view.proxy.loading && !view.proxy.loadQuestion
            && !view.proxy.eachList.length && /当前题的阅卷任务已完成/.test(view.root.textContent);
    },

    waitForNextPaper(_url, context = {}) {
        const previous = context.paperId || this._submitted;
        const task = context.taskId || this._gathered?.task;
        if (!previous || !task) return Promise.resolve(false);
        const signal = context.signal;
        if (signal?.aborted) return Promise.resolve(false);
        return new Promise(resolve => {
            let candidate = '', attempts = 0;
            const finish = result => {
                clearInterval(timer);
                signal?.removeEventListener('abort', cancel);
                resolve(result);
            };
            const cancel = () => finish(false);
            const timer = setInterval(() => {
                const current = this.getGradingTaskIdentifier();
                if (!this._route() || this.isGradingTaskComplete() || (current && current !== task)
                    || ++attempts >= 125) return cancel();
                const identity = this.getPaperIdentity();
                if (identity && identity !== previous && identity === candidate) return finish(true);
                candidate = identity === previous ? '' : identity;
            }, 200);
            signal?.addEventListener('abort', cancel, { once: true });
        });
    }
};

if (YunhenAdapter.shouldInitialize()) {
    const existing = window.__AI_MARKER_ADAPTER__;
    if (existing) console.error(`[注册冲突] ${existing.name} 与云痕大数据同时匹配当前页面`);
    else window.__AI_MARKER_ADAPTER__ = YunhenAdapter;
}
