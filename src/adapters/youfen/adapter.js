// 优分优学：按原生题块获取答卷，独立校验填分与保存结果。
const YoufenAdapter = {
    id: 'youfen', name: '优分优学', iconUrl: '',
    urlPatterns: ['*://liankao.1000cb.com/Home/Mark*'],
    shouldInitialize() { return window.location.hostname === 'liankao.1000cb.com' && window.location.pathname === '/Home/Mark'; },
    _page() { return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window; },
    _number(v) {
        if (typeof v !== 'number' && (typeof v !== 'string' || !/^\d+(?:\.\d+)?$/.test(v))) return null;
        return Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
    },
    _task() {
        if (!this.shouldInitialize()) return null;
        const w = this._page(), p = w.project, q = w.question, t = w.currentItem;
        if (!p?.dataBaseName || !p.proId || !p.subId || !q || !t || q.arb !== 'default'
            || w.paperTag !== 'default' || Number(t.mode) !== 0 || Number(t.saveType) !== 1
            || String(q.questionIndex) !== String(t.index) || String(q.xzt) !== String(t.optionalTitle)
            || !(this._number(t.maxScore) > 0) || !(this._number(t.interval) > 0)) return null;
        return JSON.stringify([window.location.host, p.dataBaseName, p.proId, p.subId,
            t.index, t.optionalTitle, t.title, t.minScore, t.maxScore, t.interval, t.stepSet, t.rect]);
    },
    getTaskIdentifier() { return this._task(); },
    getQuestionContext() {
        const s = this._state();
        return s ? { question: s.w.currentItem.title, units: s.units.map(({label, maxScore}) => ({label, maxScore})) } : null;
    },
    detectSubQuestions() { const units = this.getScoreInputs(); return units.length > 1 ? units : []; },
    isMarkingPage() { return !!this._task() && !!this._page().document.querySelector('#scorePanel'); },
    async detectMarkingPage() {
        for (let i = 0; i < 75; i++) {
            if (this.isMarkingPage()) return true;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },
    _blocked() { return Array.from(this._page().document.querySelectorAll('.modal.in')).some(el => el.getClientRects().length > 0); },
    getScoreInputs() {
        return Array.from(this._page().document.querySelectorAll('#scorePanel .tscore input')).map((element, index) => ({
            element, index, label: element.closest('.row')?.firstElementChild?.textContent.trim().replace(/\.$/, '') || `得分点${index + 1}`,
            maxScore: this._number(element.dataset.max), roundStep: this._number(element.dataset.seg)
        }));
    },
    _state() {
        const w = this._page(), task = this._task(), p = w.currentPaper, t = w.currentItem;
        if (!task || !p?.id || !/^\d+$/.test(String(p.examCode)) || !p.url || w.drawTag !== 'default'
            || !w.keyEnabled || this._blocked() || p.arb !== 'default' || Number(p.mode) !== 0
            || Number(p.scoreMode) !== 0 || p.date || p.stepScore != null
            || w.document.querySelector('#scoreOld')?.textContent.trim()
            || String(p.proId) !== String(w.project.proId) || String(p.subId) !== String(w.project.subId)
            || p.dataBaseName !== w.project.dataBaseName || String(p.questionIndex) !== String(t.index)
            || String(p.optionalTitle) !== String(t.optionalTitle) || p.path !== t.path) return null;
        const img = w.document.querySelector('#imgPaper');
        if (!img?.complete || !img.naturalWidth || !img.naturalHeight || !img.getClientRects().length
            || !img.src.startsWith('data:image/png;base64,')) return null;
        let base;
        try { base = new URL(t.path); } catch (_) { return null; }
        if (base.protocol !== 'https:' || base.hostname !== 'xzb-onlinemarking.oss-cn-beijing.aliyuncs.com'
            || base.port || base.username || base.password || base.search || base.hash
            || !base.pathname.startsWith(`/liankao/${w.project.dataBaseName}/${w.project.proId}/`)) return null;
        const files = p.url.split(';');
        if (files.some(file => !/^\d+\.(?:tif|tiff|png|jpg|jpeg)$/i.test(file))) return null;
        const rects = String(t.rect || '').split(',').map(rect => rect.split('-').map(Number));
        if (!rects.length || rects.some(r => r.length !== 5 || !r.every(Number.isInteger)
            || r.some(n => n < 0) || !files[r[0]] || r[3] < 1 || r[4] < 1)) return null;
        const vertical = Number(w.direction) === 1;
        const width = vertical ? Math.max(...rects.map(r => r[3])) : rects.reduce((s, r) => s + r[3], 0);
        const height = vertical ? rects.reduce((s, r) => s + r[4], 0) : Math.max(...rects.map(r => r[4]));
        if (img.naturalWidth !== width || img.naturalHeight !== height) return null;
        const urls = rects.map(([i, x, y, width, height]) => `${base.href}/${p.examCode}/${files[i]}?x-oss-process=image/format,png/crop,x_${x},y_${y},w_${width},h_${height}`);
        const units = this.getScoreInputs();
        const expected = t.stepSet ? t.stepSet.split(',').map(part => Number(part.split(':')[1])) : [Number(t.maxScore)];
        if (!units.length || units.some(u => !(u.maxScore > 0) || !(u.roundStep > 0))
            || units.length !== expected.length || units.some((u, i) => u.maxScore !== expected[i] || u.roundStep !== Number(t.interval))
            || Math.abs(units.reduce((sum, u) => sum + u.maxScore, 0) - Number(t.maxScore)) > 1e-7) return null;
        const paperKey = JSON.stringify([p.id, p.examCode, p.url]);
        return { w, p, task, paperKey, identity: JSON.stringify([task, paperKey, urls]), urls, units };
    },
    getPaperIdentity() { return this._state()?.identity || null; },
    async prepareGrading() {
        const s = this._state();
        if (!s) { this.lastFillError = '请使用普通单评阅卷，并等待题块图片加载完成'; return false; }
        const auto = s.w.document.querySelector('#chkAutoPost');
        if (auto) auto.checked = false;
        if (s.w.panelFlag === 0) s.w.ChangePanelFlag();
        return s.w.panelFlag === 1;
    },
    async gatherAnswerImages() { this._imageSnapshot = this._state(); return this._imageSnapshot?.urls.slice() || []; },
    // 核心下载器会单独取出该方法，因此入口使用固定接收者。
    async fetchImageAsBase64(url, signal) {
        const a = YoufenAdapter, s = a._imageSnapshot;
        if (!s || !s.urls.includes(url) || a.getPaperIdentity() !== s.identity) throw new Error('答卷已切换，请重新读取');
        const data = await fetchImageAsBase64(url, signal);
        if (a.getPaperIdentity() !== s.identity) throw new Error('答卷已切换，请重新读取');
        return data;
    },
    fillScores(scores) {
        this._filled = null;
        const s = this._state();
        const fail = message => { this.lastFillError = message; return false; };
        if (!s || this._imageSnapshot?.identity !== s.identity) return fail('答卷已切换，请重新批改');
        if (!Array.isArray(scores) || scores.length !== s.units.length || scores.some((n, i) => {
            const u = s.units[i], min = this._number(u.element.dataset.min);
            return typeof n !== 'number' || !Number.isFinite(n) || min === null || n < min || n > u.maxScore
                || Math.abs(n / u.roundStep - Math.round(n / u.roundStep)) > 1e-7;
        })) return fail('请核对各得分点的分值范围和给分步长');
        const auto = s.w.document.querySelector('#chkAutoPost');
        if (auto) auto.checked = false;
        if (s.w.panelFlag === 0) s.w.ChangePanelFlag();
        if (s.w.panelFlag !== 1 || this.getPaperIdentity() !== s.identity) return fail('请切换为键盘给分后继续');
        const setter = Object.getOwnPropertyDescriptor(s.w.HTMLInputElement.prototype, 'value').set;
        for (let i = 0; i < s.units.length; i++) {
            s.units[i].element.removeAttribute('readonly');
            setter.call(s.units[i].element, String(scores[i]));
        }
        // 原站键盘事件会触发自动保存；仅写入值，确认时统一走原生提交。
        if (s.units.some((u, i) => u.element.value === '' || Number(u.element.value) !== scores[i])) return fail('分数填写失败，请核对后重试');
        s.w.document.querySelector('#score').textContent = `得分：${scores.reduce((sum, n) => sum + n, 0)}`;
        this._filled = { ...s, p: { ...s.p }, scores: scores.slice() };
        this.lastFillError = '';
        return true;
    },
    _observeSave() {
        if (this._observing) return;
        this._page().jQuery.ajaxPrefilter((options, original, xhr) => {
            const pending = this._saving;
            if (!pending) return;
            let url, payload;
            try { url = new URL(options.url, this._page().location.href); } catch (_) { return; }
            if (url.origin !== this._page().location.origin || url.pathname !== '/Service/MarkService.asmx/PostPaper') return;
            try { payload = JSON.parse(original.data); } catch (_) { pending.failed = true; xhr.abort(); return; }
            if (pending.request || String(payload.id) !== String(pending.p.id) || payload.examCode !== pending.p.examCode
                || String(payload.proId) !== String(pending.p.proId) || String(payload.subId) !== String(pending.p.subId)
                || payload.arb !== 'default' || String(payload.optionalTitle) !== String(pending.p.optionalTitle)
                || String(payload.questionIndex) !== String(pending.p.questionIndex) || payload.dataBaseName !== pending.p.dataBaseName
                || Number(payload.score) !== pending.scores.reduce((sum, n) => sum + n, 0)
                || String(payload.stepScore) !== pending.scores.join(',')) { pending.failed = true; xhr.abort(); return; }
            pending.request = xhr;
            xhr.done(result => { pending.saved = !!result && Number(result.result) === 1; pending.failed = !pending.saved; });
            xhr.fail(() => { pending.failed = true; });
        });
        this._observing = true;
    },
    async submitGrade(guard) {
        const filled = this._filled;
        this._filled = null;
        if (!filled || this._submitting) return false;
        this._submitting = true; this._submitted = null;
        try {
            if (guard?.signal?.aborted || guard?.isCurrent?.() === false) return false;
            await guard?.verify?.();
            const s = this._state();
            if (guard?.signal?.aborted || guard?.isCurrent?.() === false || !s || s.identity !== filled.identity
                || !s.w.commitable || s.w.panelFlag !== 1 || s.units.length !== filled.scores.length
                || s.units.some((u, i) => u.element.value === '' || Number(u.element.value) !== filled.scores[i])) return false;
            const button = s.w.document.querySelector('#btnSumScore');
            if (!button || button.disabled || !button.getClientRects().length) return false;
            this._observeSave();
            this._saving = { ...filled };
            button.click();
            for (let i = 0; i < 150; i++) {
                if (guard?.signal?.aborted || this.getTaskIdentifier() !== filled.task || this._saving.failed) return false;
                if (this._saving.saved) { this._submitted = filled; return true; }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            this.lastFillError = '未确认保存结果，请在阅卷平台核对后继续';
            return false;
        } finally { this._saving = null; this._submitting = false; }
    },
    async waitForNextPaper(_oldImageUrl, guard = {}) {
        const previous = this._submitted;
        if (!previous || guard.paperId && guard.paperId !== previous.identity || guard.taskId && guard.taskId !== previous.task) return false;
        let candidate = null;
        for (let i = 0; i < 150; i++) {
            if (guard.signal?.aborted || this.getTaskIdentifier() !== previous.task || this._blocked()) return false;
            const s = this._state();
            const changed = s && s.paperKey !== previous.paperKey && s.p.id !== previous.p.id && s.p.examCode !== previous.p.examCode;
            if (changed && candidate === s.identity) return true;
            candidate = changed ? s.identity : null;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    },
    isRegradeMode() { const w = this._page(); return !!(w.currentPaper?.date || w.currentPaper?.stepScore != null || w.document.querySelector('#scoreOld')?.textContent.trim()); }
};
if (YoufenAdapter.shouldInitialize()) window.__AI_MARKER_ADAPTER__ = YoufenAdapter;
