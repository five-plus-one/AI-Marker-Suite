// 园丁邦云阅卷：原生答卷、题块图、得分点和保存响应共同绑定。
const YuandingbangAdapter = {
    name: '园丁邦云阅卷', id: 'yuandingbang', iconUrl: '',
    urlPatterns: ['*://yuejuan.yuandingbang.cn/web/*'],
    shouldInitialize() {
        return window.location.hostname === 'yuejuan.yuandingbang.cn'
            && window.location.pathname.startsWith('/web/');
    },
    _page() {
        if (!this.shouldInitialize()) return null;
        try {
            const root = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const frame = root.document.querySelector(YUANDINGBANG_SELECTORS.FRAME);
            const w = frame ? frame.contentWindow : root;
            return w.location.origin === root.location.origin
                && w.location.pathname === '/web/mark/sjpy/sjpy_kspy.jsp' ? w : null;
        } catch (_) { return null; }
    },
    _visible(el) {
        if (!el?.getClientRects().length) return false;
        const style = el.ownerDocument.defaultView.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    },
    _blocked(w) {
        return Array.from(w.document.querySelectorAll(YUANDINGBANG_SELECTORS.BLOCKERS)).some(el => this._visible(el));
    },
    _number(value) {
        if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : null;
    },
    _task(w) {
        const z = w?.zgtxx;
        if (!z) return null;
        const q = new URL(w.location.href).searchParams;
        for (const key of ['ksdm', 'kmdm', 'stbh']) {
            if (q.getAll(key).length !== 1 || !q.get(key) || String(w[key]) !== q.get(key)) return null;
        }
        if (String(z.STBH) !== String(w.stbh) || String(z.KMDM) !== String(w.kmdm)) return null;
        return JSON.stringify([w.location.host, w.ksdm, w.kmdm, w.stbh,
            z.STMC, z.DFDMC, z.DFDFS, z.DFBC, z.DFBCMS, z.PYCS]);
    },
    getTaskIdentifier() { return this._task(this._page()); },
    isMarkingPage() {
        const w = this._page();
        return !!w?.document.querySelector(YUANDINGBANG_SELECTORS.SUBMIT)
            && !!w.document.querySelector(YUANDINGBANG_SELECTORS.ROWS);
    },
    async detectMarkingPage() {
        for (let poll = 0; poll < 75; poll++) {
            if (this.isMarkingPage()) return true;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },
    _state() {
        const w = this._page(), z = w?.zgtxx, r = w?.rwxx, task = this._task(w);
        if (!task || !r || !this.isMarkingPage() || this._blocked(w)
            || w.loadok !== true || w.err || w.sfhp || w.dfms !== '1' || w.tjfsFlag !== true
            || String(w.sfsp) !== '0' || String(z.SFSP) !== '0' || String(z.PYCS) !== '1'
            || String(z.SFYGMS) !== '0' || String(z.SFFP) !== '0'
            || String(w.dtkgs) !== '1' || !['0', '1'].includes(String(z.DFBC))
            || !r.RWID || String(r.RWID).startsWith('fp_') || !r.BMH || r.DQPC == null
            || String(r.STBH) !== String(w.stbh) || String(r.PYCS) !== '1'
            || String(r.SFYC) !== '0' || String(r.SFZC) !== '0' || String(r.ZJBZ) !== '0'
            || r.PYCJ_1 != null || r.PYSJ_1 != null
            || w.document.querySelector(YUANDINGBANG_SELECTORS.PAPER)?.value !== String(r.BMH)) return null;
        const labels = String(z.DFDMC).split('|'), maxima = String(z.DFDFS).split('|').map(v => this._number(v));
        if (!Array.isArray(w.dfdmc) || !Array.isArray(w.dfdfs) || labels.length !== Number(z.DFDSL)
            || labels.some((v, i) => !v || v !== w.dfdmc[i]) || w.dfdmc.length !== labels.length
            || w.dfdfs.length !== labels.length || maxima.some((v, i) => !(v > 0) || v !== this._number(w.dfdfs[i]))
            || Math.abs(this._number(z.STMF) - maxima.reduce((sum, n) => sum + n, 0)) > 1e-8) return null;
        const rows = Array.from(w.document.querySelectorAll(YUANDINGBANG_SELECTORS.ROWS));
        if (rows.length !== labels.length) return null;
        const inputs = rows.map((row, i) => {
            const element = row.querySelector(YUANDINGBANG_SELECTORS.INPUT);
            return { element, index: i, label: labels[i], maxScore: maxima[i],
                roundStep: String(z.DFBC) === '0' ? this._number(z.DFBCMS) : 0 };
        });
        if (inputs.some((u, i) => !u.element || !this._visible(u.element) || u.element.disabled || u.element.readOnly
            || u.element.id !== `dfd${i}` || rows[i].querySelector(YUANDINGBANG_SELECTORS.LABEL)?.textContent.trim() !== u.label
            || u.element.placeholder !== `满分${w.dfdfs[i]}`)) return null;
        const images = Array.from(w.document.querySelectorAll(YUANDINGBANG_SELECTORS.IMAGES));
        const regions = String(z.TXQY).split(',');
        if (!images.length || images.length !== regions.length || !Array.isArray(w.txqy)
            || w.txqy.join(',') !== regions.join(',')) return null;
        const keys = [];
        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            if (img.id !== `mainimg_${i}` || !this._visible(img) || !img.complete || img.naturalWidth <= 0
                || img.naturalHeight <= 0 || (img.currentSrc && img.currentSrc !== img.src)) return null;
            try {
                const url = new URL(img.src), base = new URL(z.TXDZ);
                const parts = url.pathname.slice(base.pathname.length).split('/');
                if (url.protocol !== 'https:' || url.hostname !== 'yuejuan-img.yuandingbang.cn'
                    || base.origin !== url.origin || !url.pathname.startsWith(base.pathname)
                    || parts.length !== 5 || !/^\d+$/.test(parts[0]) || parts[1] !== String(w.ksdm)
                    || parts[2] !== String(w.kmdm) || parts[3] !== String(r.BMH)
                    || parts[4] !== `${r.BMH}_${regions[i]}.jpg`) return null;
                url.searchParams.delete('v'); // 原生随机缓存参数不能作为换卷证据。
                keys.push(url.href);
            } catch (_) { return null; }
        }
        const paper = JSON.stringify([task, String(r.RWID), String(r.DQPC), String(r.BMH)]);
        return { w, z, r, task, paper, inputs, images, identity: JSON.stringify([paper, keys]) };
    },
    getPaperIdentity() { return this._state()?.identity || null; },
    getQuestionContext() {
        const s = this._state();
        return s ? { question: s.z.STMC, units: s.inputs.map(({ label, maxScore }) => ({ label, maxScore })) } : null;
    },
    getScoreInputs() { return this._state()?.inputs || []; },
    detectSubQuestions() { const inputs = this.getScoreInputs(); return inputs.length > 1 ? inputs : []; },
    async gatherAnswerImages() { return this._state()?.images.map(img => img.src) || []; },
    async fetchImageAsBase64(url) { return fetchImageAsBase64(url); },
    fillScores(scores) {
        this._filled = null; this.lastFillError = '';
        const fail = text => { this.lastFillError = text; return false; };
        const s = this._state();
        if (!s) return fail('请等待答卷加载完成，并使用普通评阅的键盘给分方式');
        if (!Array.isArray(scores) || scores.length !== s.inputs.length) return fail('请核对每个得分点的评分方案');
        const values = scores.map(v => this._number(v));
        const allowed = String(s.z.DFBCMS).split(',').map(v => this._number(v));
        // 原站 getPoint1() 按一位小数登记，避免显示值与保存值发生取整差异。
        if (values.some((v, i) => v === null || v > s.inputs[i].maxScore || Math.abs(v * 10 - Math.round(v * 10)) > 1e-8
            || (String(s.z.DFBC) === '0' ? !(s.inputs[i].roundStep > 0)
                || Math.abs(v / s.inputs[i].roundStep - Math.round(v / s.inputs[i].roundStep)) > 1e-8
                : allowed.some(n => n === null) || !allowed.includes(v)))) {
            return fail('评分结果不符合得分点满分或给分档位，请核对评分方案');
        }
        const setter = Object.getOwnPropertyDescriptor(s.w.HTMLInputElement.prototype, 'value').set;
        for (let i = 0; i < s.inputs.length; i++) {
            if (this.getPaperIdentity() !== s.identity) return fail('当前答卷已切换，请重新批改');
            const input = s.inputs[i].element;
            setter.call(input, String(values[i]));
            input.dispatchEvent(new s.w.Event('input', { bubbles: true }));
            input.dispatchEvent(new s.w.Event('change', { bubbles: true }));
        }
        if (s.inputs.some((u, i) => this._number(u.element.value) !== values[i]) || this.getPaperIdentity() !== s.identity) {
            return fail('平台未接受填写的分数，请检查给分栏后重新批改');
        }
        this._filled = { ...s, values };
        return true;
    },
    async submitGrade(guard = {}) {
        const p = this._filled, s = this._state(), button = s?.w.document.querySelector(YUANDINGBANG_SELECTORS.SUBMIT);
        if (this._submitting || !p || !s || p.identity !== s.identity || guard.signal?.aborted || guard.isCurrent?.() === false
            || !this._visible(button) || button.disabled || button.classList.contains('disabled')
            || s.inputs.some((u, i) => u.element !== p.inputs[i].element || this._number(u.element.value) !== p.values[i])
            || typeof s.w.checkDfd !== 'function' || !s.w.checkDfd()) return false;
        this._submitting = true; this.lastSubmitError = ''; this._submittedPaper = null;
        try {
            return await new Promise(resolve => {
                const proto = s.w.XMLHttpRequest.prototype, originalOpen = proto.open, originalSend = proto.send;
                const candidates = new WeakSet();
                let settled = false, observed = null;
                const restore = () => {
                    if (proto.open === open) proto.open = originalOpen;
                    if (proto.send === send) proto.send = originalSend;
                };
                const finish = ok => {
                    if (settled) return;
                    settled = true; clearTimeout(timer); restore();
                    guard.signal?.removeEventListener('abort', cancelled);
                    if (observed) for (const type of ['load', 'error', 'timeout', 'abort']) {
                        observed.removeEventListener(type, type === 'load' ? loaded : cancelled);
                    }
                    this._filled = null;
                    if (ok) this._submittedPaper = p;
                    else this.lastSubmitError = '未确认保存成功，请在园丁邦核对当前答卷后继续';
                    resolve(ok);
                };
                const cancelled = () => finish(false);
                const loaded = () => {
                    try {
                        const data = observed.responseType === 'json' ? observed.response : JSON.parse(observed.responseText);
                        finish(!guard.signal?.aborted && guard.isCurrent?.() !== false
                            && this.getTaskIdentifier() === p.task && observed.status >= 200 && observed.status < 300 && data?.res === true);
                    } catch (_) { finish(false); }
                };
                function open(method, url, ...args) {
                    try {
                        const target = new URL(url, s.w.location.href);
                        if (String(method).toUpperCase() === 'POST' && target.origin === s.w.location.origin
                            && target.pathname === '/sjpy_tjfs.do') candidates.add(this);
                    } catch (_) { /* 其他请求保持原生行为。 */ }
                    return originalOpen.call(this, method, url, ...args);
                }
                function send(body) {
                    if (!settled && !observed && candidates.has(this) && typeof body === 'string') {
                        const q = new URLSearchParams(body);
                        const expected = { ksdm: s.w.ksdm, kmdm: s.w.kmdm, stbh: s.w.stbh,
                            rwid: p.r.RWID, dqpc: p.r.DQPC, pycs: 1, sfmp: p.z.SFMP,
                            pycj: Math.round(p.values.reduce((sum, v) => sum + v, 0) * 10) / 10, pydfd: p.values.join('|') };
                        if (Object.entries(expected).every(([key, value]) => q.getAll(key).length === 1 && q.get(key) === String(value))) {
                            observed = this;
                            for (const type of ['load', 'error', 'timeout', 'abort']) this.addEventListener(type, type === 'load' ? loaded : cancelled);
                            restore();
                        }
                    }
                    return originalSend.call(this, body);
                }
                const timer = setTimeout(cancelled, 15000);
                guard.signal?.addEventListener('abort', cancelled, { once: true });
                try { proto.open = open; proto.send = send; button.click(); }
                catch (_) { finish(false); }
            });
        } finally { this._submitting = false; }
    },
    async waitForNextPaper(_oldImageUrl, guard = {}) {
        const baseline = this._submittedPaper;
        if (!baseline || guard.paperId && guard.paperId !== baseline.identity || guard.taskId && guard.taskId !== baseline.task) return false;
        let candidate = null;
        for (let poll = 0; poll < 250; poll++) {
            if (guard.signal?.aborted || this.getTaskIdentifier() !== baseline.task) return false;
            const s = this._state();
            const changed = s && s.paper !== baseline.paper && s.r.BMH !== baseline.r.BMH;
            if (changed && candidate === s.identity) return true;
            candidate = changed ? s.identity : null;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    },
    isRegradeMode() { return !!this._page()?.sfhp; },
};

if (YuandingbangAdapter.shouldInitialize()) window.__AI_MARKER_ADAPTER__ = YuandingbangAdapter;
