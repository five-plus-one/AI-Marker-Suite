// 小乐优阅：原生题块、评分项和答卷绑定，保存响应确认后继续。
const XiaoleyouyueAdapter = {
    id: 'xiaoleyouyue', name: '小乐优阅', iconUrl: '',
    urlPatterns: ['https://yy.eduer.co/pages/exam/review/review.aspx*'],
    shouldInitialize() {
        return window.location.hostname === 'yy.eduer.co'
            && window.location.pathname === '/pages/exam/review/review.aspx';
    },
    _page() { return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window; },
    _number(v) {
        if (typeof v !== 'number' && (typeof v !== 'string' || !/^\d+(?:\.\d+)?$/.test(v))) return null;
        return Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
    },
    _route() {
        if (!this.shouldInitialize()) return null;
        const q = new URL(this._page().location.href).searchParams;
        if (['subjectid', 'blockid', 'id', 'type'].some(k => q.getAll(k).length !== 1)
            || q.get('type') !== '0' || ['subjectid', 'blockid', 'id'].some(k => !/^[1-9]\d*$/.test(q.get(k)))) return null;
        return { subjectid: q.get('subjectid'), blockid: q.get('blockid'), taskid: q.get('id'), type: '0' };
    },
    _task() {
        const w = this._page(), route = this._route(), questions = w.pageQuestionList;
        if (!route || !Array.isArray(questions) || !questions.length) return null;
        const units = questions.map(q => {
            const max = this._number(q.score), step = q.step;
            if (!q.id || !q.title || q.koufen !== false || !(max > 0) || !step) return null;
            const type = Number(step.type);
            const allowed = type === 1 && typeof step.score === 'string' ? step.score.split(',').map(n => this._number(n)) : null;
            const interval = step.score === '' ? null : this._number(step.score);
            if (type !== 0 && type !== 1 || type === 0 && step.score !== '' && !(interval > 0)
                || type === 1 && (!allowed?.length || allowed.some(n => n === null || n > max))) return null;
            // 固定分值配置在原站仍执行 parseFloat(score) 的整除检查。
            const nativeStep = type === 1 ? parseFloat(step.score) : interval;
            return { id: String(q.id), label: String(q.title), max, allowed, interval: nativeStep > 0 ? nativeStep : null };
        });
        if (units.some(u => !u) || new Set(units.map(u => u.id)).size !== units.length) return null;
        return { route, units, key: JSON.stringify([route, units]) };
    },
    getTaskIdentifier() { return this._task()?.key || null; },
    _visible(el) {
        if (!el?.getClientRects().length) return false;
        const style = this._page().getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    },
    _blocked() {
        return Array.from(this._page().document.querySelectorAll('.layui-layer-shade, .layui-layer-loading, .layui-layer-page, .layui-layer-iframe')).some(el => this._visible(el));
    },
    _observe() {
        if (this._observing || !this._page().jQuery?.ajaxPrefilter) return;
        this._page().jQuery.ajaxPrefilter((options, original, xhr) => {
            let url;
            try { url = new URL(options.url, this._page().location.href); } catch (_) { return; }
            if (url.origin !== this._page().location.origin || url.pathname !== '/pages/ReviewAction.ashx') return;
            const data = typeof original.data === 'string' ? new URLSearchParams(original.data) : null;
            const pending = this._saving;
            if (pending && (!data || !['3', '10', '21'].includes(data.get('code')))) {
                let scores;
                try { scores = JSON.parse(data?.get('scores')); } catch (_) {}
                if (pending.request || !data || data.get('code') !== '11' || data.get('key') !== pending.paperKey
                    || Object.entries(pending.route).some(([k, v]) => data.getAll(k).length !== 1 || data.get(k) !== v)
                    || data.getAll('key').length !== 1 || data.getAll('scores').length !== 1 || data.getAll('code').length !== 1
                    || !Array.isArray(scores) || scores.length !== pending.scores.length
                    || scores.some((s, i) => String(s.id) !== pending.units[i].id || s.score !== pending.scores[i])) {
                    pending.failed = true; xhr.abort(); return;
                }
                pending.request = xhr;
                xhr.done(result => { pending.saved = !!result && [1, 2].includes(result.state); pending.failed = !pending.saved; });
                xhr.fail(() => { pending.failed = true; });
            }
            if (!data || !['3', '10', '21'].includes(data.get('code'))) return;
            const epoch = this._epoch = (this._epoch || 0) + 1;
            this._loading = true; this._observedRead = true; this._paper = null;
            xhr.done(result => {
                if (this._epoch !== epoch) return;
                this._loading = false;
                const route = this._route();
                if (data.get('code') === '10' && result?.state === 1 && result.data?.key && route
                    && Object.entries(route).every(([k, v]) => data.getAll(k).length === 1 && data.get(k) === v)) {
                    this._paper = { key: result.data.key, papers: result.data.papers };
                }
            });
            xhr.fail(() => { if (this._epoch === epoch) this._loading = false; });
        });
        this._observing = true;
    },
    _state() {
        this._observe();
        const w = this._page(), task = this._task();
        if (!task || !this._observing || this._loading || w.pageLocking || w.pageExpandLoading || w.pageExpandOpen
            || !w.pageIsNew || typeof w.pageKey !== 'string' || !w.pageKey || this._blocked()
            || !Number.isInteger(w.pageIndex?.cur) || w.pageIndex.cur !== w.pageIndex.max) return null;
        if (this._observedRead && this._paper?.key !== w.pageKey) return null;
        const inputs = Array.from(w.document.querySelectorAll('.quickmenu > .qlist > li .score-input'));
        if (inputs.length !== task.units.length || inputs.some((el, i) => !this._visible(el) || el.disabled || el.readOnly
            || el.closest('li')?.firstElementChild?.textContent.trim() !== task.units[i].label
            || el.placeholder !== `满分${task.units[i].max}分`)) return null;
        const images = Array.from(w.document.querySelectorAll('.review_body > ul > li > img'));
        if (!images.length || images.length !== w.pagePaperBasicSize?.length
            || this._paper && this._paper.papers?.length !== images.length) return null;
        const urls = [];
        for (let i = 0; i < images.length; i++) {
            const img = images[i], size = w.pagePaperBasicSize[i];
            let url;
            try { url = new URL(img.src); } catch (_) { return null; }
            if (url.protocol !== 'https:' || url.hostname !== 'yyaitantao.oss-cn-shenzhen.aliyuncs.com'
                || url.port || url.username || url.password || !url.searchParams.get('x-oss-process')?.startsWith('image/crop,')
                || !img.complete || !this._visible(img) || img.naturalWidth !== size.width || img.naturalHeight !== size.height
                || !(size.width > 0) || !(size.height > 0)
                || this._paper && (this._paper.papers[i].path !== url.href
                    || this._paper.papers[i].size?.width !== size.width || this._paper.papers[i].size?.height !== size.height)) return null;
            urls.push(url.href);
        }
        return { ...task, paperKey: w.pageKey, inputs, urls,
            identity: JSON.stringify([task.key, w.pageKey, this._epoch || 0, urls]) };
    },
    isMarkingPage() { return !!this._state(); },
    async detectMarkingPage() {
        for (let i = 0; i < 75; i++) {
            if (this.isMarkingPage()) return true;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },
    getPaperIdentity() { return this._state()?.identity || null; },
    getScoreInputs() {
        const s = this._state();
        return s ? s.units.map((u, index) => ({ element: s.inputs[index], index, label: u.label, maxScore: u.max,
            ...(u.interval ? { roundStep: u.interval } : {}) })) : [];
    },
    getQuestionContext() {
        const task = this._task();
        return task ? { question: task.units.map(u => u.label).join('、'), units: task.units.map(u => ({ label: u.label, maxScore: u.max })) } : null;
    },
    detectSubQuestions() { const units = this.getScoreInputs(); return units.length > 1 ? units : []; },
    async prepareGrading() {
        const before = this._state(), w = this._page();
        if (!before) { this.lastFillError = '请进入初评，并等待当前答卷加载完成'; return false; }
        const auto = w.document.querySelector('input[name="autosubmit"]');
        const keyboard = w.document.querySelector('input[name="scoremethod"][value="1"]');
        if (!auto || !keyboard) return false;
        auto.checked = false;
        w.layui?.form?.render('checkbox');
        if (!keyboard.checked) keyboard.nextElementSibling?.click();
        return !auto.checked && keyboard.checked && this.getPaperIdentity() === before.identity;
    },
    async gatherAnswerImages() { this._imageSnapshot = this._state(); return this._imageSnapshot?.urls.slice() || []; },
    async fetchImageAsBase64(url, signal) {
        const a = XiaoleyouyueAdapter, snapshot = a._imageSnapshot;
        if (!snapshot || !snapshot.urls.includes(url) || a.getPaperIdentity() !== snapshot.identity) throw new Error('答卷已切换，请重新读取');
        const data = await fetchImageAsBase64(url, signal);
        if (a.getPaperIdentity() !== snapshot.identity) throw new Error('答卷已切换，请重新读取');
        return data;
    },
    fillScores(scores) {
        this._filled = null;
        const s = this._state(), w = this._page(), fail = message => { this.lastFillError = message; return false; };
        if (!s || this._imageSnapshot?.identity !== s.identity
            || s.inputs.some((el, i) => el !== this._imageSnapshot.inputs[i])) return fail('答卷已切换，请重新批改');
        if (!Array.isArray(scores) || scores.length !== s.units.length || scores.some((score, i) => {
            const u = s.units[i];
            return typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > u.max
                || Math.abs(score * 100 - Math.round(score * 100)) > 1e-7
                || u.allowed && !u.allowed.includes(score)
                || u.interval && Math.abs(score / u.interval - Math.round(score / u.interval)) > 1e-7;
        })) return fail('请核对各题的满分和给分档位');
        if (w.document.querySelector('input[name="autosubmit"]')?.checked !== false
            || !w.document.querySelector('input[name="scoremethod"][value="1"]')?.checked) return fail('请使用打分键盘，并关闭平台自动提交');
        const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
        s.inputs.forEach((input, i) => setter.call(input, String(scores[i])));
        // 原站提交直接读取输入值；键盘事件会触发自动提交。
        w.changeReviewTotal();
        if (this.getPaperIdentity() !== s.identity || s.inputs.some((el, i) => el.value === '' || Number(el.value) !== scores[i])) return fail('分数填写失败，请核对后重试');
        this._filled = { ...s, scores: scores.slice() }; this.lastFillError = '';
        return true;
    },
    async submitGrade(guard) {
        const filled = this._filled;
        this._filled = null;
        if (!filled || this._submitting) return false;
        this._submitting = true; this._submitted = null;
        try {
            if (guard?.signal?.aborted || guard?.isCurrent?.() === false) return false;
            await guard?.verify?.();
            const s = this._state(), w = this._page();
            if (guard?.signal?.aborted || guard?.isCurrent?.() === false || !s || s.identity !== filled.identity
                || w.document.querySelector('input[name="autosubmit"]')?.checked !== false
                || !w.document.querySelector('input[name="scoremethod"][value="1"]')?.checked
                || s.inputs.some((el, i) => el !== filled.inputs[i] || el.value === '' || Number(el.value) !== filled.scores[i])) return false;
            const button = w.document.querySelector('.quickmenu a[data-action="14"]');
            if (!this._visible(button) || button.disabled) return false;
            this._saving = { ...filled };
            button.click();
            for (let i = 0; i < 150; i++) {
                if (guard?.signal?.aborted || this.getTaskIdentifier() !== filled.key || this._saving.failed) return false;
                if (this._saving.saved) { this._submitted = filled; return true; }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            this.lastFillError = '未确认保存结果，请在阅卷平台核对后继续';
            return false;
        } finally { this._saving = null; this._submitting = false; }
    },
    async waitForNextPaper(_oldImageUrl, guard = {}) {
        const previous = this._submitted;
        if (!previous || guard.paperId && guard.paperId !== previous.identity || guard.taskId && guard.taskId !== previous.key) return false;
        let candidate = null;
        for (let i = 0; i < 150; i++) {
            if (guard.signal?.aborted || this.getTaskIdentifier() !== previous.key) return false;
            const s = this._state(), changed = s && s.paperKey !== previous.paperKey && s.identity !== previous.identity;
            if (changed && candidate === s.identity) return true;
            candidate = changed ? s.identity : null;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    },
    isRegradeMode() {
        const w = this._page();
        return !this._route() || !!(w.pageIndex && w.pageIndex.cur < w.pageIndex.max)
            || !!(this._observedRead && !this._loading && !this._paper);
    }
};
if (XiaoleyouyueAdapter.shouldInitialize()) {
    XiaoleyouyueAdapter._observe();
    window.__AI_MARKER_ADAPTER__ = XiaoleyouyueAdapter;
}
