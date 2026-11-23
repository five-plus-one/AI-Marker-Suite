// 韬普教育云阅卷。原生键盘给分、题块图片和保存响应共同绑定到当前答卷。
const TaoweiAdapter = {
    name: '韬普教育云阅卷', id: 'taowei', iconUrl: '',
    urlPatterns: ['*://*.taoweiedu.com/web/*'],
    shouldInitialize() {
        return /^s[1-6]\.taoweiedu\.com$/.test(window.location.hostname)
            && window.location.pathname.startsWith('/web/');
    },
    _page() {
        if (!this.shouldInitialize()) return null;
        try {
            const root = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const frame = root.document.querySelector(TAOWEI_SELECTORS.FRAME);
            const w = frame ? frame.contentWindow : root;
            // iframe 的 src 属性在原站导航后仍可能是 navi.jsp，以实际文档地址为准。
            return w.location.origin === root.location.origin
                && w.location.pathname === '/web/mark/sjpy/sjpy_kspy.jsp' ? w : null;
        } catch (_) { return null; }
    },
    _visible(el) {
        if (!el?.getClientRects().length) return false;
        const style = el.ownerDocument.defaultView.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    },
    _number(value) {
        if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : null;
    },
    _blocked(w, allowConfirm = false) {
        const confirm = w.document.querySelector(TAOWEI_SELECTORS.CONFIRM);
        const layer = allowConfirm && w.qropen && this._visible(confirm) ? confirm.closest('.layui-layer') : null;
        return Array.from(w.document.querySelectorAll(TAOWEI_SELECTORS.BLOCKERS)).some(el => {
            if (!this._visible(el)) return false;
            if (layer && (el === layer || el.contains(confirm))) return false;
            if (layer && el.classList.contains('layui-layer-shade') && layer.getAttribute('times')
                && el.getAttribute('times') === layer.getAttribute('times')) return false;
            return true;
        });
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
    getGradingTaskIdentifier() { return this.getTaskIdentifier() || ''; },
    isMarkingPage() {
        const w = this._page();
        return !!w?.document.querySelector(TAOWEI_SELECTORS.SUBMIT)
            && !!w.document.querySelector(TAOWEI_SELECTORS.ROWS);
    },
    async detectMarkingPage() {
        for (let poll = 0; poll < 75; poll++) {
            if (this.isMarkingPage()) return true;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },
    _question(w) {
        try {
            const z = w?.zgtxx, task = this._task(w);
            if (!task || !this.isMarkingPage()) return null;
            const labels = String(z.DFDMC).split('|'), maxima = String(z.DFDFS).split('|').map(v => this._number(v));
            if (!Array.isArray(w.dfdmc) || !Array.isArray(w.dfdfs) || labels.length !== Number(z.DFDSL)
                || labels.some((v, i) => !v || v !== w.dfdmc[i]) || w.dfdmc.length !== labels.length
                || w.dfdfs.length !== labels.length || maxima.some((v, i) => !(v > 0) || v !== this._number(w.dfdfs[i]))
                || !(this._number(z.STMF) > 0) || Math.abs(Number(z.STMF) - maxima.reduce((sum, n) => sum + n, 0)) > 1e-8) return null;
            const rows = Array.from(w.document.querySelectorAll(TAOWEI_SELECTORS.ROWS));
            if (rows.length !== labels.length) return null;
            const inputs = rows.map((row, i) => ({ element: row.querySelector(TAOWEI_SELECTORS.INPUT),
                label: labels[i], index: i, maxScore: maxima[i], roundStep: String(z.DFBC) === '0' ? this._number(z.DFBCMS) : undefined }));
            if (inputs.some((u, i) => !this._visible(u.element)
                || u.element.id !== `dfd${i}` || rows[i].querySelector(TAOWEI_SELECTORS.LABEL)?.textContent.trim() !== u.label
                || u.element.placeholder !== `满${w.dfdfs[i]}分`)) return null;
            return { w, z, task, inputs };
        } catch (_) { return null; }
    },
    _state(allowConfirm = false) {
        try {
            const w = this._page(), question = this._question(w), z = w?.zgtxx, r = w?.rwxx, task = question?.task;
            if (!task || !r || !this.isMarkingPage() || this._blocked(w, allowConfirm)
                || w.loadok !== true || w.err || w.sfhp || w.dfms !== '1' || w.tjfsFlag !== true
                || w.inPyfk || w.inPybz || w.inZdypyPreview
                || String(w.sfsp) !== '0' || String(z.SFSP) !== '0' || !['1', '2', '3'].includes(String(z.PYCS))
                || String(z.SFYGMS) !== '0' || String(z.SFFP) !== '0'
                || String(w.dtkgs) !== '1' || !['0', '1'].includes(String(z.DFBC))
                || !r.RWID || /^(fp_|jcj_)/.test(String(r.RWID)) || !r.BMH || r.DQPC == null
                || String(r.PYZT) !== '1' || String(r.ZJBZ) !== '0' || r.PYCJ != null || r.PYSJ != null || r.PYDFD != null || r.HPSJ != null
                || w.document.querySelector(TAOWEI_SELECTORS.PAPER)?.value !== String(r.BMH)) return null;
            const { inputs } = question;
            if (inputs.some(u => u.element.disabled || u.element.readOnly)) return null;
            const images = Array.from(w.document.querySelectorAll(TAOWEI_SELECTORS.IMAGES));
            const regions = String(z.TXQY).split(',');
            if (!images.length || images.length !== regions.length || !Array.isArray(w.txqy)
                || w.txqy.join(',') !== regions.join(',')) return null;
            const keys = [];
            for (let i = 0; i < images.length; i++) {
                const img = images[i];
                if (img.id !== `mainimg_${i}` || !this._visible(img) || !img.complete || img.naturalWidth <= 0
                    || img.naturalHeight <= 0 || (img.currentSrc && img.currentSrc !== img.src)) return null;
                const url = new URL(img.src), base = new URL(z.TXDZ);
                if (base.origin !== 'https://img-oss.sdzdf.com' || base.pathname !== '/Examimg/'
                    || url.origin !== base.origin || url.pathname !== `${base.pathname}1318/${w.ksdm}/${w.kmdm}/${r.BMH}/${r.BMH}_${regions[i]}.jpg`) return null;
                url.searchParams.delete('v');
                keys.push(url.href);
            }
            const paper = JSON.stringify([task, String(r.RWID), String(r.DQPC), String(r.BMH)]);
            return { w, z, r, task, paper, inputs, images, sources: images.map(img => img.src),
                annotations: Array.from(w.pybz_arr || []).join('|'), identity: JSON.stringify([paper, keys]) };
        } catch (_) { return null; }
    },
    getPaperIdentity() { return this._state(true)?.identity || null; },
    getQuestionContext() {
        const s = this._question(this._page());
        return s ? { question: s.z.STMC, units: s.inputs.map(({ label, maxScore }) => ({ label, maxScore })) } : null;
    },
    getScoreInputs() { return this._state()?.inputs || []; },
    async gatherAnswerImages() { return this._state()?.images.map(img => img.src) || []; },
    async fetchImageAsBase64(url, signal = window.aiGradingState?.abortController?.signal) {
        // 核心层以独立函数调用下载器，适配器常量保持本轮答卷核对。
        const adapter = TaoweiAdapter, s = adapter._state();
        const source = s?.images.find(img => img.src === url);
        if (!source || signal?.aborted) throw new Error('请等待当前答卷图片加载完成后重新批改');
        const dimensions = [source.naturalWidth, source.naturalHeight];
        const data = await fetchImageAsBase64(url, signal);
        if (signal?.aborted || adapter.getPaperIdentity() !== s.identity || source.src !== url
            || source.naturalWidth !== dimensions[0] || source.naturalHeight !== dimensions[1]) {
            throw new Error('当前答卷已变化，请重新批改');
        }
        return data;
    },
    fillScores(scores) {
        this._filled = null; this.lastFillError = '';
        const fail = text => { this.lastFillError = text; return false; }, s = this._state();
        if (!s) return fail('请等待答卷加载完成，并使用普通评阅的键盘给分方式');
        if (!Array.isArray(scores) || scores.length !== s.inputs.length) return fail('请核对每个得分点的评分方案');
        // 逐索引读取，稀疏数组与缺失分数均不能进入原生写入。
        const values = Array.from({ length: scores.length }, (_, i) => this._number(scores[i]));
        const allowed = String(s.z.DFBCMS).split(',').map(v => this._number(v));
        if (values.some((v, i) => v === null || v > s.inputs[i].maxScore || Math.abs(v * 10 - Math.round(v * 10)) > 1e-8
            || (String(s.z.DFBC) === '0' ? !(s.inputs[i].roundStep > 0)
                || Math.abs(v / s.inputs[i].roundStep - Math.round(v / s.inputs[i].roundStep)) > 1e-8
                : allowed.some(n => n === null) || !allowed.includes(v)))) return fail('评分结果不符合满分或给分档位，请核对评分方案');
        const setter = Object.getOwnPropertyDescriptor(s.w.HTMLInputElement.prototype, 'value').set;
        try {
            for (let i = 0; i < s.inputs.length; i++) {
                if (this.getPaperIdentity() !== s.identity || this._state()?.annotations !== s.annotations) return fail('当前答卷已变化，请重新批改');
                const input = s.inputs[i].element;
                setter.call(input, String(values[i]));
                input.dispatchEvent(new s.w.Event('input', { bubbles: true }));
                if (this.getPaperIdentity() !== s.identity) return fail('当前答卷已变化，请重新批改');
                input.dispatchEvent(new s.w.Event('change', { bubbles: true }));
            }
            const current = this._state();
            if (!current || current.identity !== s.identity || current.annotations !== s.annotations
                || current.inputs.some((u, i) => u.element !== s.inputs[i].element || this._number(u.element.value) !== values[i])) {
                return fail('平台未保留填写的分数，请核对给分栏后重新批改');
            }
            this._filled = { ...s, values };
            return true;
        } catch (_) { return fail('分数尚未完整填写，请在平台核对后重新批改'); }
    },
    _matches(p, allowConfirm = false) {
        const s = this._state(allowConfirm);
        return !!s && s.identity === p.identity && s.annotations === p.annotations
            && s.inputs.every((u, i) => u.element === p.inputs[i].element && this._number(u.element.value) === p.values[i]);
    },
    async submitGrade(guard = {}) {
        const p = this._filled;
        if (this._submitting || !p || !this._matches(p) || guard.signal?.aborted || guard.isCurrent?.() === false) return false;
        this._submitting = true; this.lastSubmitError = ''; this._submittedPaper = null;
        try {
            // 由原生倒计时恢复按钮，助手既不改计数，也不重发保存请求。
            for (let poll = 0; p.w.document.querySelector(TAOWEI_SELECTORS.SUBMIT)?.disabled; poll++) {
                if (poll >= 1200 || guard.signal?.aborted || guard.isCurrent?.() === false || !this._matches(p)) return false;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            await guard.verify?.();
            if (guard.signal?.aborted || guard.isCurrent?.() === false || !this._matches(p)) return false;
            const button = p.w.document.querySelector(TAOWEI_SELECTORS.SUBMIT);
            if (!this._visible(button) || button.disabled || typeof p.w.checkDfd !== 'function' || !p.w.checkDfd()) return false;
            return await this._save(p, button, guard);
        } catch (_) { this.lastSubmitError = '未确认保存成功，请在韬普教育核对当前答卷后继续'; return false; }
        finally { this._submitting = false; this._filled = null; }
    },
    _save(p, button, guard) {
        return new Promise(resolve => {
            const proto = p.w.XMLHttpRequest.prototype, originalOpen = proto.open, originalSend = proto.send;
            const candidates = new WeakSet();
            const currentTask = guard.isCurrentTask || guard.isCurrent;
            const expected = { ksdm: p.w.ksdm, kmdm: p.w.kmdm, stbh: p.w.stbh, rwid: p.r.RWID, dqpc: p.r.DQPC,
                pycs: p.z.PYCS, sfmp: p.z.SFMP, pycj: Math.round(p.values.reduce((sum, v) => sum + v, 0) * 10) / 10,
                pydfd: p.values.join('|'), pybz: p.annotations };
            let settled = false, observed = null, checking = false;
            const restore = () => {
                if (proto.open === open) proto.open = originalOpen;
                if (proto.send === send) proto.send = originalSend;
            };
            const finish = ok => {
                if (settled) return;
                settled = true; clearTimeout(timer); clearInterval(confirmTimer); restore();
                guard.signal?.removeEventListener('abort', cancelled);
                if (observed) for (const type of ['load', 'error', 'timeout', 'abort']) observed.removeEventListener(type, type === 'load' ? loaded : cancelled);
                if (ok) this._submittedPaper = p;
                else this.lastSubmitError = '未确认保存成功，请在韬普教育核对当前答卷后继续';
                resolve(ok);
            };
            const cancelled = () => finish(false);
            const loaded = () => {
                try {
                    const data = observed.responseType === 'json' ? observed.response : JSON.parse(observed.responseText);
                    finish(!guard.signal?.aborted && guard.isCurrentTask?.() !== false && this.getTaskIdentifier() === p.task
                        && observed.status >= 200 && observed.status < 300 && data?.res === true);
                } catch (_) { finish(false); }
            };
            function open(method, url, ...args) {
                try {
                    const target = new URL(url, p.w.location.href);
                    if (String(method).toUpperCase() === 'POST' && target.origin === p.w.location.origin
                        && target.pathname === '/sjpy_tjfs.do' && !target.search) candidates.add(this);
                } catch (_) { /* 其他原生请求保持原样。 */ }
                return originalOpen.call(this, method, url, ...args);
            }
            const adapter = this;
            function send(body) {
                if (!settled && !observed && candidates.has(this)) {
                    const q = typeof body === 'string' ? new URLSearchParams(body) : null;
                    const visibleImages = Array.from(p.w.document.querySelectorAll(TAOWEI_SELECTORS.IMAGES))
                        .filter(image => adapter._visible(image));
                    const current = adapter._page() === p.w && p.w.rwxx === p.r && p.w.zgtxx === p.z && adapter._task(p.w) === p.task
                        && JSON.stringify([p.task, String(p.r.RWID), String(p.r.DQPC), String(p.r.BMH)]) === p.paper && !p.w.sfhp
                        && p.w.document.querySelector(TAOWEI_SELECTORS.PAPER)?.value === String(p.r.BMH)
                        && visibleImages.every(image => image.src === p.sources[p.images.indexOf(image)])
                        && !p.w.err && p.w.dfms === '1' && String(p.w.sfsp) === '0' && String(p.z.SFSP) === '0'
                        && String(p.z.SFYGMS) === '0' && String(p.z.SFFP) === '0' && String(p.w.dtkgs) === '1'
                        && !p.w.inPyfk && !p.w.inPybz && !p.w.inZdypyPreview
                        && String(p.r.PYZT) === '1' && String(p.r.ZJBZ) === '0' && p.r.PYCJ == null && p.r.PYSJ == null
                        && Array.from(p.w.document.querySelectorAll(TAOWEI_SELECTORS.ROWS)).length === p.inputs.length
                        && p.inputs.every((u, i) => u.element.isConnected && !u.element.disabled && !u.element.readOnly
                            && p.w.document.querySelectorAll(TAOWEI_SELECTORS.ROWS)[i].querySelector(TAOWEI_SELECTORS.INPUT) === u.element
                            && adapter._number(p.w.dfdfs[i]) === u.maxScore && adapter._number(u.element.value) === p.values[i]);
                    if (!current || guard.signal?.aborted || currentTask?.() === false || !q
                        || !Object.entries(expected).every(([key, value]) => q.getAll(key).length === 1 && q.get(key) === String(value))) {
                        finish(false); this.abort(); return;
                    }
                    observed = this;
                    for (const type of ['load', 'error', 'timeout', 'abort']) this.addEventListener(type, type === 'load' ? loaded : cancelled);
                    restore();
                }
                return originalSend.call(this, body);
            }
            const timer = setTimeout(cancelled, 25000);
            const confirmTimer = setInterval(async () => {
                if (settled || observed || checking) return;
                if (guard.signal?.aborted || guard.isCurrent?.() === false) return finish(false);
                const doc = p.w.document, message = doc.querySelector(TAOWEI_SELECTORS.CONFIRM_TEXT);
                const match = message?.textContent.trim().match(/^确定为该学生打\s*(\d+(?:\.\d+)?)\s*分吗？$/);
                const target = doc.querySelector(TAOWEI_SELECTORS.CONFIRM_BUTTON);
                if (!p.w.qropen || !match || Number(match[1]) !== Math.round(p.values.reduce((sum, v) => sum + v, 0) * 10) / 10
                    || !this._visible(target) || !this._matches(p, true)) return;
                checking = true;
                try {
                    await guard.verify?.();
                    if (!settled && !guard.signal?.aborted && guard.isCurrent?.() !== false && this._matches(p, true)) target.click();
                } catch (_) { finish(false); }
                finally { checking = false; }
            }, 100);
            guard.signal?.addEventListener('abort', cancelled, { once: true });
            try { proto.open = open; proto.send = send; button.click(); } catch (_) { finish(false); }
        });
    },
    async waitForNextPaper(_oldImageUrl, guard = {}) {
        const baseline = this._submittedPaper;
        if (!baseline || guard.paperId && guard.paperId !== baseline.identity || guard.taskId && guard.taskId !== baseline.task) return false;
        let candidate = null;
        for (let poll = 0; poll < 300; poll++) {
            if (guard.signal?.aborted || this.getTaskIdentifier() !== baseline.task) return false;
            const s = this._state(), changed = s && s.paper !== baseline.paper && String(s.r.BMH) !== String(baseline.r.BMH);
            if (changed && candidate === s.identity) return true;
            candidate = changed ? s.identity : null;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    },
    isRegradeMode() { return !!this._page()?.sfhp; },
};
if (TaoweiAdapter.shouldInitialize()) window.__AI_MARKER_ADAPTER__ = TaoweiAdapter;
