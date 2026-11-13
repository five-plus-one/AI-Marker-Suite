// 天喻慧学：绑定原生题目、答卷与评分板，提交后核对原生成功状态。
const HuixueAdapter = {
    name: window.location.hostname === 'hx-webscan.hzjy.edu.cn' ? '惠州市智慧教育平台' : '天喻慧学',
    id: 'huixue', iconUrl: '',
    urlPatterns: ['*://hx-webscan.tyhuixue.com/web-reviewer/*', '*://hx-webscan.hzjy.edu.cn/web-reviewer/*'],
    shouldInitialize() {
        return ['hx-webscan.tyhuixue.com', 'hx-webscan.hzjy.edu.cn'].includes(window.location.hostname)
            && /^\/web-reviewer\//.test(window.location.pathname);
    },
    _window() { return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window; },
    _page() {
        if (!this.shouldInitialize() || window.location.hash.split('?')[0] !== '#/generalReview') return null;
        const p = this._window().document.querySelector(HUIXUE_SELECTORS.ROOT)?.__vue__;
        return p?.$options?.name === 'GeneralReview' && !p._isDestroyed && typeof p.submitScoreFn === 'function' ? p : null;
    },
    _number(v) {
        if (typeof v !== 'number' && (typeof v !== 'string' || !/^\d+(?:\.\d+)?$/.test(v))) return null;
        return Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
    },
    _visible(el) {
        if (!el?.getClientRects().length) return false;
        const style = this._window().getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    },
    _task(p = this._page()) {
        const q = p?.$route?.query;
        if (!p || !q?.examId || !q.subjectId || !p.markItemId || !p.markerId || q.role !== 'Normal'
            || !p.selectValue || !Array.isArray(p.scorePointList) || !p.scorePointList.length) return null;
        const units = p.scorePointList.map(v => {
            const max = this._number(v.score), allowed = typeof v.scoreLimite === 'string' ? v.scoreLimite.split(',').map(n => this._number(n)) : [];
            return v.markItemScoreId && v.markItemId === p.markItemId && v.name && max > 0 && allowed.length
                && allowed.every(n => n !== null && n <= max) ? { id: v.markItemScoreId, label: String(v.name), max, allowed } : null;
        });
        if (units.some(v => !v) || new Set(units.map(v => v.id)).size !== units.length) return null;
        return { units, key: JSON.stringify([q.examId, q.subjectId, p.markItemId, p.markerId, p.selectValue, units]) };
    },
    getTaskIdentifier() { return this._task()?.key || null; },
    isMarkingPage() { return !!this._page(); },
    async detectMarkingPage() {
        for (let i = 0; i < 75; i++) {
            if (this.isMarkingPage()) return true;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },
    _state() {
        const p = this._page(), task = this._task(p), w = this._window();
        if (!task || !p.hasImg || p.replayComment !== '进入回评' || p.isAutoSubmit || p.customValue || p.isClickScore
            || p.fastScoreMark || p.dialogVisible || p.isSetting || p.isShowSettingBox || p.isContinue
            || !p.markEntityKey || !p.handlerEntityKey || !p.secretNumber || !Array.isArray(p.img) || !p.img.length) return null;
        const inputs = Array.from(p.$el.querySelectorAll(HUIXUE_SELECTORS.INPUT));
        const imgs = Array.from(p.$refs.dragPaper?.querySelectorAll(':scope > .img > img') || []);
        if (inputs.length !== task.units.length || inputs.some((el, i) => !this._visible(el) || el.disabled || el.readOnly
            || this._number(el.getAttribute('score')) !== task.units[i].max)
            || imgs.length !== p.img.length) return null;
        const urls = [];
        for (let i = 0; i < p.img.length; i++) {
            const item = p.img[i], img = imgs[i];
            let url;
            try { url = new URL(item.imgAddress); } catch (_) { return null; }
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !img.complete
                || !img.naturalWidth || !img.naturalHeight || img.src !== url.href || !this._visible(img)) return null;
            urls.push(url.href);
        }
        const paper = JSON.stringify([p.markEntityKey, p.handlerEntityKey, p.secretNumber]);
        const identity = JSON.stringify([task.key, paper, urls]);
        return { p, w, task, paper, identity, inputs, urls, markKey: p.markEntityKey };
    },
    getPaperIdentity() { return this._state()?.identity || null; },
    getQuestionContext() {
        const s = this._state();
        return s ? { question: String(s.p.selectValue), units: s.task.units.map(u => ({ label: u.label, maxScore: u.max })) } : null;
    },
    getScoreInputs() {
        const s = this._state();
        return s ? s.task.units.map((u, index) => ({ element: s.inputs[index], index, label: u.label, maxScore: u.max })) : [];
    },
    detectSubQuestions() { return []; },
    async prepareGrading() {
        const p = this._page();
        if (p?.isAutoSubmit || p?.isClickScore || p?.customValue || p?.fastScoreMark) {
            this.lastFillError = '请使用键盘给分，并关闭天喻慧学的自动提交和快速给分';
            if (typeof showToast === 'function') showToast(this.lastFillError);
            return false;
        }
        return !!this._state();
    },
    async gatherAnswerImages() {
        const s = this._state();
        this._imageSnapshot = s;
        return s ? s.urls.slice() : [];
    },
    fetchImageAsBase64(url, signal) { return HuixueAdapter._fetchImage(url, signal); },
    async _fetchImage(url, signal) {
        const s = this._imageSnapshot;
        if (signal?.aborted) throw new Error('用户主动暂停');
        if (!s?.urls.includes(url) || this.getPaperIdentity() !== s.identity) throw new Error('答卷已切换，请重新批改');
        const bytes = await fetchImageAsBase64(url, signal);
        if (signal?.aborted) throw new Error('用户主动暂停');
        if (this.getPaperIdentity() !== s.identity) throw new Error('答卷已切换，请重新批改');
        return bytes;
    },
    fillScores(scores) {
        this._filled = null; this.lastFillError = '';
        const fail = message => { this.lastFillError = message; return false; };
        const s = this._state();
        if (!s) return fail('请在普通阅卷页面使用键盘给分，并关闭平台自动提交');
        if (this._imageSnapshot && this._imageSnapshot.identity !== s.identity) return fail('答卷已切换，请重新批改');
        const values = Array.isArray(scores) ? scores.map(v => this._number(v)) : [];
        if (values.length !== s.inputs.length || values.some((v, i) => v === null || !s.task.units[i].allowed.includes(v))) {
            return fail('评分结果不符合本题有效分值，请核对评分方案');
        }
        for (let i = 0; i < values.length; i++) {
            if (this.getPaperIdentity() !== s.identity) return fail('答卷已切换，请重新批改');
            Object.getOwnPropertyDescriptor(s.w.HTMLInputElement.prototype, 'value').set.call(s.inputs[i], String(values[i]));
            s.inputs[i].dispatchEvent(new s.w.Event('input', { bubbles: true }));
        }
        if (this.getPaperIdentity() !== s.identity || !this._accepted(s, values)) return fail('平台未接受分数，请核对当前答卷');
        this._filled = { ...s, values };
        return true;
    },
    _accepted(s, values) {
        return s.inputs.every((input, i) => this._number(input.value) === values[i]
            && this._number(s.p.scorePointList[i]?.value) === values[i]
            && this._number(s.p.domCountArr?.[i]) === values[i])
            && s.p.domCountArr.length === values.length
            && Math.abs(Number(s.p.totalScore) - values.reduce((a, b) => a + b, 0)) < 1e-8;
    },
    async submitGrade(guard = {}) {
        this._submitted = null;
        const f = this._filled;
        if (!f || this._submitting) return false;
        this._submitting = true;
        try {
            await f.p.$nextTick();
            const s = this._state();
            if (guard.signal?.aborted || guard.isCurrent?.() === false || !s || s.p !== f.p
                || s.identity !== f.identity || !this._accepted(s, f.values) || f.p.count !== 0
                || !this._visible(s.p.$el.querySelector(HUIXUE_SELECTORS.SUBMIT))) return false;
            const finished = Number(f.p.finishedCount);
            if (!Number.isInteger(finished) || finished < 0) return false;
            // 原生方法仅在成功响应后递增已阅数；其 Promise 完成不代表保存成功。
            await f.p.submitScoreFn();
            if (guard.signal?.aborted || this._page() !== f.p || this.getTaskIdentifier() !== f.task.key
                || Number(f.p.finishedCount) !== finished + 1 || f.p.count !== 0) return false;
            this._submitted = f;
            return true;
        } catch (_) { return false; }
        finally {
            this._filled = null; this._submitting = false;
            if (!this._submitted) this.lastSubmitError = '未确认保存成功，请在天喻慧学核对当前答卷后继续';
        }
    },
    async waitForNextPaper(_url, guard = {}) {
        const f = this._submitted;
        if (!f || guard.paperId && guard.paperId !== f.identity || guard.taskId && guard.taskId !== f.task.key) return false;
        for (let i = 0; i < 200; i++) {
            if (guard.signal?.aborted || this.getTaskIdentifier() !== f.task.key) return false;
            const s = this._state();
            if (s && s.paper !== f.paper && s.markKey !== f.markKey && s.urls.join('\n') !== f.urls.join('\n')) return true;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    },
    isRegradeMode() { const p = this._page(); return !!p && p.replayComment !== '进入回评'; },
};
if (HuixueAdapter.shouldInitialize()) window.__AI_MARKER_ADAPTER__ = HuixueAdapter;
