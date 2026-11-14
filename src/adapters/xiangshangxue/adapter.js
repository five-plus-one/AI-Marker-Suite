// 享尚学阅卷：沿用原生取图、给分与保存流程。
const XiangshangxueAdapter = {
    id: 'xiangshangxue', name: '享尚学阅卷', iconUrl: '',
    urlPatterns: ['https://xinluolk.fjjxhl.com/lypaper/Base/lyReadPaper.aspx*'],
    shouldInitialize() {
        return window.location.hostname === 'xinluolk.fjjxhl.com'
            && window.location.pathname === '/lypaper/Base/lyReadPaper.aspx';
    },
    _page() {
        const root = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        try {
            const page = root;
            return page?.location.hostname === 'xinluolk.fjjxhl.com'
                && page.location.pathname === '/lypaper/Base/lyReadPaper.aspx' ? page : null;
        } catch (_) { return null; }
    },
    _visible(el) {
        if (!el?.getClientRects().length) return false;
        const style = this._page()?.getComputedStyle(el);
        return style && style.display !== 'none' && style.visibility !== 'hidden';
    },
    _number(value) {
        return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(String(value)) && Number.isFinite(Number(value)) ? Number(value) : NaN;
    },
    _task() {
        const w = this._page();
        if (!w || Number(w.gettype) !== 1 || Number(w.xmod) !== 0 || Number(w.jianfen) !== 0
            || Number(w.fbgf) !== 0 || Number(w.xzbj) !== 0 || w.isSwitchPaper) return null;
        const d = w.document, val = id => d.getElementById(id)?.value || '';
        const route = ['examsub', 'examtea', 'teaid', 'xmid'].map(val);
        const question = d.getElementById('pingyueti')?.textContent.trim();
        const max = this._number(d.getElementById('pingyuefen')?.textContent.trim());
        if (route.some(v => !/^\d+$/.test(v)) || !question || question !== val('teaname_') || !(max > 0)
            || max !== this._number(val('scores')) || d.getElementById('teafen')
            && max !== this._number(d.getElementById('teafen').textContent.trim())) return null;
        const inputs = Array.from(d.querySelectorAll('#xtlist input.fenshu'));
        const units = inputs.map((el, i) => {
            const max = this._number(el.getAttribute('fen'));
            const label = d.getElementById('btag' + i)?.textContent.trim();
            return max > 0 && max === this._number(el.name) && label && el.id === 'fenshu' + i
                ? { label: inputs.length === 1 ? question : question + '（' + label + '）', max } : null;
        });
        if (!units.length || units.some(u => !u) || Math.abs(units.reduce((n, u) => n + u.max, 0) - max) > 1e-7) return null;
        const allowed = w.scopart === '' ? null : String(w.scopart).split(',').map(v => this._number(v));
        if (allowed?.some(v => !Number.isFinite(v))) return null;
        const integer = !!d.getElementById('disxiaoshu')?.checked;
        return { route, question, units, inputs, allowed, integer, max,
            key: JSON.stringify([route, question, units, allowed, integer]) };
    },
    _observe() {
        const w = this._page();
        if (!w?.jQuery?.ajax || this._observedPage === w) return;
        const adapter = this, ajax = w.jQuery.ajax;
        this._observedPage = w; this._loading = false; this._epoch = (this._epoch || 0) + 1;
        w.jQuery.ajax = function (options, ...args) {
            let url;
            try { url = new URL(options?.url, w.location.href); } catch (_) { return ajax.call(this, options, ...args); }
            if (url.origin !== w.location.origin || url.pathname !== '/lypaper/Base/lyGetData.aspx') return ajax.call(this, options, ...args);
            const action = url.searchParams.get('action')?.toLowerCase();
            const read = action === 'getpaperinfo', write = /^putpaper/.test(action || '');
            if (!read && !write) return ajax.call(this, options, ...args);
            const pending = adapter._saving;
            const data = typeof options.data === 'string' ? new URLSearchParams(options.data) : new URLSearchParams(options.data || {});
            if (write && pending) {
                const expected = { examsub: pending.route[0], examtea: pending.route[1], teaid: pending.route[2],
                    id: pending.paper, teapos: pending.position, gettype: '1', pjsign: pending.pjsign,
                    scores: String(pending.scores.reduce((n, v) => n + v, 0)), xt: pending.scores.join(',') };
                const valid = !pending.request && action === pending.action && adapter._state()?.identity === pending.identity
                    && Object.entries(expected).every(([k, v]) => data.getAll(k).length === 1 && data.get(k) === v);
                if (!valid) { pending.failed = true; return false; }
                pending.request = true;
            }
            const epoch = adapter._epoch = (adapter._epoch || 0) + 1;
            adapter._loading = true;
            const success = options.success, error = options.error, complete = options.complete;
            return ajax.call(this, { ...options,
                success(result, ...rest) {
                    // 正常保存响应直接返回下一份或末卷；负数错误码、回收和同卷响应均不能证明已保存。
                    if (pending && write) {
                        const id = String(result?.id);
                        pending.saved = (id === '-2' || /^[1-9]\d*$/.test(id) && id !== pending.paper)
                            && adapter._page() === w && adapter.getTaskIdentifier() === pending.key;
                        pending.failed = !pending.saved;
                    }
                    try { return success?.call(this, result, ...rest); }
                    finally { if (adapter._epoch === epoch) adapter._loading = false; }
                },
                error(...rest) {
                    if (pending && write) pending.failed = true;
                    if (adapter._epoch === epoch) adapter._loading = false;
                    return error?.apply(this, rest);
                },
                complete(...rest) {
                    if (adapter._epoch === epoch) adapter._loading = false;
                    return complete?.apply(this, rest);
                }
            }, ...args);
        };
    },
    _state() {
        this._observe();
        const w = this._page(), task = this._task();
        if (!task || this._observedPage !== w || this._loading || Number(w.jQuery.active) > 0 || !/^[1-9]\d*$/.test(String(w.paperrowid))
            || ![0, 1].includes(Number(w.pjsign)) || Number(w.xmode) !== 0
            || task.inputs.some(el => !this._visible(el) || el.disabled || el.readOnly)) return null;
        const d = w.document;
        if (['selecttea', 'backmarkwindow', 'errorsubmitwindow', 'box5', 'box6', 'box7', 'selectwindow'].some(id => this._visible(d.getElementById(id)))) return null;
        const images = Array.from(d.querySelectorAll('#myimg img.teaimg'));
        const parts = String(w.teapics || '').split(';').filter(Boolean);
        if (!images.length || images.length !== parts.length) return null;
        const urls = [];
        for (const img of images) {
            let url;
            try { url = new URL(img.src); } catch (_) { return null; }
            if (url.origin !== w.location.origin || url.pathname !== '/lypaper/Base/lyImage.aspx'
                || url.searchParams.getAll('p').length !== 1 || !url.searchParams.get('p')
                || url.searchParams.get('type') !== 'jpeg' || !this._visible(img)
                || !img.complete || !(img.naturalWidth > 0) || !(img.naturalHeight > 0)) return null;
            urls.push(url.href);
        }
        return { ...task, page: w, paper: String(w.paperrowid), position: String(w.teapos), pjsign: String(w.pjsign), urls,
            identity: JSON.stringify([task.key, String(w.paperrowid), String(w.teapos), String(w.pjsign), this._epoch, urls]) };
    },
    getTaskIdentifier() { return this._task()?.key || null; },
    getPaperIdentity() { return this._state()?.identity || null; },
    isMarkingPage() { return !!this._state(); },
    async detectMarkingPage() {
        for (let i = 0; i < 75; i++) {
            if (this.isMarkingPage()) return true;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },
    getScoreInputs() {
        const s = this._state();
        return s ? s.units.map((u, index) => ({ element: s.inputs[index], index, label: u.label, maxScore: u.max,
            roundStep: s.integer ? 1 : 0.01 })) : [];
    },
    getQuestionContext() {
        const t = this._task();
        return t ? { question: t.question, units: t.units.map(u => ({ label: u.label, maxScore: u.max })) } : null;
    },
    detectSubQuestions() { const inputs = this.getScoreInputs(); return inputs.length > 1 ? inputs : []; },
    prepareGrading() {
        const s = this._state(), auto = s?.page.document.getElementById('autohuiche');
        if (!s || !auto) return false;
        auto.checked = false; auto.removeAttribute('checked');
        return !auto.checked && this.getPaperIdentity() === s.identity;
    },
    async gatherAnswerImages() { this._imageSnapshot = this._state(); return this._imageSnapshot?.urls.slice() || []; },
    async fetchImageAsBase64(url, signal) {
        const a = XiangshangxueAdapter, snapshot = a._imageSnapshot;
        if (!snapshot || !snapshot.urls.includes(url) || a.getPaperIdentity() !== snapshot.identity) throw Error('答卷已切换，请重新读取');
        const data = await fetchImageAsBase64(url, signal);
        if (a.getPaperIdentity() !== snapshot.identity) throw Error('答卷已切换，请重新读取');
        return data;
    },
    fillScores(scores) {
        this._filled = null;
        const s = this._state(), fail = message => { this.lastFillError = message; return false; };
        if (!s || this._imageSnapshot?.identity !== s.identity || s.inputs.some((el, i) => el !== this._imageSnapshot.inputs[i])) return fail('答卷已切换，请重新批改');
        if (!Array.isArray(scores) || scores.length !== s.units.length || scores.some((n, i) => typeof n !== 'number'
            || !Number.isFinite(n) || n < 0 || n > s.units[i].max || Math.abs(n * 100 - Math.round(n * 100)) > 1e-7
            || s.integer && !Number.isInteger(n) || s.allowed && !s.allowed.includes(n))) return fail('请核对各题的满分和允许分值');
        if (s.page.document.getElementById('autohuiche')?.checked !== false) return fail('请关闭平台自动提交后继续');
        const setter = Object.getOwnPropertyDescriptor(s.page.HTMLInputElement.prototype, 'value').set;
        s.inputs.forEach((el, i) => setter.call(el, String(scores[i])));
        // sumscore 会按平台自动提交开关继续操作，先核对开关再更新原生合计。
        s.page.sumscore();
        if (this.getPaperIdentity() !== s.identity || s.inputs.some((el, i) => el.value === '' || Number(el.value) !== scores[i])) return fail('分数填写失败，请核对后重试');
        this._filled = { ...s, scores: scores.slice(), action: Number(s.pjsign) === 0 ? 'putpaper' : 'putpaper2' };
        this.lastFillError = ''; return true;
    },
    async submitGrade(guard) {
        const filled = this._filled;
        this._filled = null;
        if (!filled || this._submitting) return false;
        this._submitting = true; this._submitted = null;
        try {
            if (guard?.signal?.aborted || guard?.isCurrent?.() === false) return false;
            await guard?.verify?.();
            const s = this._state(), w = s?.page;
            if (!s || guard?.signal?.aborted || guard?.isCurrent?.() === false || s.identity !== filled.identity
                || w !== filled.page || Number(w.leastViewTime) > 0 || w.document.getElementById('autohuiche')?.checked !== false
                || s.inputs.some((el, i) => el !== filled.inputs[i] || el.value === '' || Number(el.value) !== filled.scores[i])) return false;
            const button = w.document.getElementById('submitbtn');
            if (!this._visible(button) || button.disabled) return false;
            this._saving = { ...filled };
            // 原生按钮只提交当前焦点评分点；聚焦最后一项保证整组走原生校验。
            s.inputs[s.inputs.length - 1].focus();
            // 后台标签页可能不派发 focus；原生键盘直接读取 o，显式同步同一评分点。
            w.o = w.jQuery(s.inputs[s.inputs.length - 1]);
            button.click();
            for (let i = 0; i < 150; i++) {
                if (guard?.signal?.aborted || this.getTaskIdentifier() !== filled.key || this._saving.failed) return false;
                if (this._saving.saved) { this._submitted = filled; return true; }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            this.lastFillError = '未确认保存结果，请在阅卷平台核对后继续'; return false;
        } finally { this._saving = null; this._submitting = false; }
    },
    async waitForNextPaper(_oldImageUrl, guard = {}) {
        const old = this._submitted;
        if (!old || guard.paperId && guard.paperId !== old.identity || guard.taskId && guard.taskId !== old.key) return false;
        let candidate = null;
        for (let i = 0; i < 150; i++) {
            if (guard.signal?.aborted || this.getTaskIdentifier() !== old.key || this._page() !== old.page) return false;
            const s = this._state(), changed = s && s.paper !== old.paper && s.identity !== old.identity;
            if (changed && candidate === s.identity) return true;
            candidate = changed ? s.identity : null;
            if (String(old.page.paperrowid) === '-2') return false;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    },
    isRegradeMode() { const w = this._page(); return !!w && (Number(w.gettype) !== 1 || Number(w.xmod) !== 0 || !!w.isSwitchPaper); }
};
if (XiangshangxueAdapter.shouldInitialize()) {
    XiangshangxueAdapter._observe();
    window.__AI_MARKER_ADAPTER__ = XiangshangxueAdapter;
}
