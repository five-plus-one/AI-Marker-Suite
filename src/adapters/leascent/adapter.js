// 丽升阅卷：题目、原生裁切图、打分板及保存响应共同绑定。
const LeascentAdapter = {
    name: '丽升阅卷', id: 'leascent', iconUrl: '',
    urlPatterns: ['http://120.55.199.134/*'],
    shouldInitialize() {
        if (window.location.hostname !== '120.55.199.134') return false;
        const url = new URL(window.location.href);
        return url.protocol === 'http:' && url.hostname === '120.55.199.134'
            && url.port === '9090' && /^\/home\/index\/?$/i.test(url.pathname);
    },
    _page() {
        if (!this.shouldInitialize()) return null;
        return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    },
    _visible(el) {
        if (!el?.getClientRects().length) return false;
        const style = el.ownerDocument.defaultView.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    },
    _blocked(w) {
        return Array.from(w.document.querySelectorAll(LEASCENT_SELECTORS.BLOCKERS)).some(el => this._visible(el));
    },
    _number(value) {
        if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : null;
    },
    getTaskIdentifier() {
        const w = this._page(), p = w?.CurrPaper;
        return p && p.TestID > 0 && p.QuesID > 0
            ? JSON.stringify([w.location.host, p.TestID, p.QuesID, p.MCaption, p.MPart, p.ControlValue]) : null;
    },
    isMarkingPage() {
        const w = this._page();
        return !!w?.document.querySelector(LEASCENT_SELECTORS.ROOT)
            && !!w.document.querySelector(LEASCENT_SELECTORS.SUBMIT);
    },
    async detectMarkingPage() {
        for (let poll = 0; poll < 75; poll++) {
            if (this.isMarkingPage()) return true;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },
    _state(allowChecked = false) {
        const w = this._page(), p = w?.CurrPaper, q = w?.CurrQuestion, task = this.getTaskIdentifier();
        if (!task || !q || !this.isMarkingPage() || this._blocked(w)
            || w.arb !== 0 || w.isLoadIamge !== false || w.isOffLine || w.isKsht || w.isShiping
            || w.DoubleConfirm !== 0 || Number(w.countdown) > 0 || Number(w.retFlag || 0) !== 0
            || (p.ControlValue & 64) === 64 || p.UserRight < 0
            || !Array.isArray(w.QuestionList) || !w.QuestionList.includes(q)
            || q.TestId !== p.TestID || q.QuesID !== p.QuesID || q.MarkType !== 0
            || q.IsHuiping > 0 || (!allowChecked && q.IsChecked === 1)
            || !q.PaperId || !(q.RowID > 0) || !(q.BWRID > 0) || !(q.NeedReleaseNum > 0)
            || typeof q.PaperPath !== 'string' || !/^data:image\/(?:jpg|jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(q.PaperPath)
            || w.document.querySelector('input[name="bzgf"]:checked')?.value !== '1'
            || typeof w.setMyScore !== 'function') return null;
        const rows = Array.from(w.document.querySelectorAll(LEASCENT_SELECTORS.ROWS));
        const labels = String(p.MCaption).split('?');
        const parts = String(p.MPart).split(';');
        const maxima = parts[0].split(',').map(v => this._number(v));
        if (!rows.length || rows.length !== labels.length || maxima.length !== labels.length) return null;
        const inputs = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i], element = row.querySelector('.st-my');
            const flag = element?.getAttribute('stflag');
            const options = Array.from(row.querySelectorAll('.st-score')).map(el => this._number(el.textContent.trim()));
            const ranges = (parts[1] || '').split(',')[i] || '';
            const control = labels.length > 1 && ranges.trim() ? 6 : p.ControlValue;
            const expectedFlag = (control & 2) === 2 ? '2' : (control & 1) === 1 ? '1' : '0';
            const expectedOptions = expectedFlag === '2' ? ranges.split('|').filter(v => v.length).map(v => this._number(v))
                : maxima[i] > 0 && maxima[i] <= 10000 ? Array.from({ length: Math.floor(maxima[i] * (expectedFlag === '0' ? 2 : 1)) + 1 },
                    (_, n) => n / (expectedFlag === '0' ? 2 : 1)) : [];
            if (!element || !this._visible(element) || element.disabled || element.readOnly
                || row.getAttribute('st') !== String(i) || element.getAttribute('stindex') !== String(i)
                || element.id !== `sm-${i}` || flag !== expectedFlag
                || !labels[i] || row.querySelector('.st-name')?.textContent.trim() !== labels[i]
                || !(maxima[i] > 0) || this._number(row.querySelector('.st-maxscore')?.textContent.trim()) !== maxima[i]
                || this._number(element.max) !== maxima[i] || !options.length
                || options.length !== expectedOptions.length
                || options.some((v, n) => v === null || v > maxima[i] || v !== expectedOptions[n])) return null;
            inputs.push({ element, label: labels[i], index: i, maxScore: maxima[i],
                roundStep: flag === '0' ? 0.5 : flag === '1' ? 1 : 0, flag, options });
        }
        const images = Array.from(w.document.querySelectorAll(LEASCENT_SELECTORS.IMAGE));
        if (images.length !== 1) return null;
        const image = images[0];
        if (!this._visible(image) || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0
            || (image.currentSrc && image.currentSrc !== image.src)
            || !(image.src.startsWith(`blob:${w.location.origin}/`) || image.src === q.PaperPath)) return null;
        const identity = JSON.stringify([task, q.PaperId, q.RowID, q.BWRID, q.PaperImagePath, q.NeedReleaseNum]);
        return { w, p, q, task, identity, image, src: image.src, data: q.PaperPath, inputs,
            signature: JSON.stringify(inputs.map(u => [u.label, u.maxScore, u.flag, u.options])) };
    },
    getPaperIdentity() { return this._state()?.identity || null; },
    _pixels(w, image) {
        const canvas = w.document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        return canvas.toDataURL('image/png');
    },
    async gatherAnswerImages() {
        const s = this._state();
        if (!s) return [];
        if (this._same(this._verified, s)) return [s.data];
        this._verified = null;
        try {
            // 页面在 onload 后立即撤销 blob URL；从已解码主图与原生图比对像素，不重取已撤销地址。
            const decoded = new s.w.Image();
            const loaded = await new Promise(resolve => {
                const finish = ok => { clearTimeout(timer); decoded.onload = decoded.onerror = null; resolve(ok); };
                const timer = setTimeout(() => finish(false), 5000);
                decoded.onload = () => finish(true); decoded.onerror = () => finish(false);
                decoded.src = s.data;
            });
            if (!loaded || decoded.naturalWidth !== s.image.naturalWidth || decoded.naturalHeight !== s.image.naturalHeight
                || this._pixels(s.w, decoded) !== this._pixels(s.w, s.image)) return [];
            const current = this._state();
            if (!this._same(s, current)) return [];
            this._verified = s;
            return [s.data];
        } catch (_) { return []; }
    },
    async fetchImageAsBase64(url) {
        const s = LeascentAdapter._state(), verified = LeascentAdapter._verified;
        if (!verified || !LeascentAdapter._same(verified, s) || url !== verified.data) throw new Error('答卷已切换，请重新读取');
        return url.slice(url.indexOf(',') + 1);
    },
    getScoreInputs() { return this._state()?.inputs || []; },
    getQuestionContext() {
        const s = this._state();
        return s ? { question: s.p.QuesName, units: s.inputs.map(u => ({ label: u.label, maxScore: u.maxScore })) } : null;
    },
    _same(a, b) {
        return !!a && !!b && a.identity === b.identity && a.task === b.task && a.q === b.q && a.p === b.p
            && a.image === b.image && a.src === b.src && a.data === b.data && a.signature === b.signature
            && a.inputs.every((u, i) => u.element === b.inputs[i]?.element);
    },
    fillScores(values) {
        this._filled = null;
        const s = this._state();
        if (this._submitting || !s || !this._same(this._verified, s) || !Array.isArray(values)
            || values.length !== s.inputs.length || values.some((v, i) => typeof v !== 'number' || !Number.isFinite(v)
                || v < 0 || v > s.inputs[i].maxScore || (s.inputs[i].flag === '2'
                    ? !s.inputs[i].options.includes(v) : !Number.isInteger(v / s.inputs[i].roundStep)))) return false;
        const setter = Object.getOwnPropertyDescriptor(s.w.HTMLInputElement.prototype, 'value').set;
        for (let i = 0; i < values.length; i++) {
            if (!this._same(s, this._state())) return false;
            const input = s.inputs[i].element;
            setter.call(input, String(values[i]));
            input.dispatchEvent(new s.w.Event('input', { bubbles: true }));
            input.dispatchEvent(new s.w.Event('change', { bubbles: true }));
            // setMyScore 只同步原生给分数组；不派发会自动提交的按键或档位点击。
            s.w.setMyScore(values[i], s.w.$(input));
        }
        if (!this._same(s, this._state()) || s.inputs.some((u, i) => this._number(u.element.value) !== values[i])
            || !Array.isArray(s.q.MyScore) || s.q.MyScore.length !== values.length
            || s.q.MyScore.some((v, i) => v !== values[i])) return false;
        this._filled = { ...s, values: [...values] };
        return true;
    },
    async submitGrade(guard = {}) {
        const p = this._filled;
        if (this._submitting || !p) return false;
        this._submitting = true; this._submittedPaper = null; this.lastSubmitError = '';
        try {
            if (guard.signal?.aborted || guard.isCurrent?.() === false) return false;
            if (guard.verify) await guard.verify();
            const s = this._state(), button = s?.w.document.querySelector(LEASCENT_SELECTORS.SUBMIT);
            if (guard.signal?.aborted || guard.isCurrent?.() === false || !this._same(p, s)
                || !this._visible(button) || button.classList.contains('disabled')
                || s.inputs.some((u, i) => this._number(u.element.value) !== p.values[i])
                || !Array.isArray(s.q.MyScore) || s.q.MyScore.length !== p.values.length
                || s.q.MyScore.some((v, i) => v !== p.values[i])) return false;
            return await new Promise(resolve => {
                const adapter = this, proto = s.w.XMLHttpRequest.prototype;
                const originalOpen = proto.open, originalSend = proto.send, candidates = new WeakSet();
                let observed = null, settled = false;
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
                    if (ok) adapter._submittedPaper = p;
                    else adapter.lastSubmitError = '未确认保存成功，请在丽升阅卷核对后继续';
                    resolve(ok);
                };
                const cancelled = () => finish(false);
                const loaded = () => {
                    try {
                        const data = observed.responseType === 'json' ? observed.response : JSON.parse(observed.responseText);
                        // 原生提交立即换卷。此处以已绑定请求的响应确认，不能再要求旧卷仍显示。
                        finish(!guard.signal?.aborted
                            && adapter.getTaskIdentifier() === p.task && observed.status >= 200 && observed.status < 300
                            && data?.Code === 0);
                    } catch (_) { finish(false); }
                };
                function open(method, url, ...args) {
                    const target = new URL(url, s.w.location.href);
                    if (String(method).toUpperCase() === 'POST' && target.origin === s.w.location.origin
                        && target.pathname.toLowerCase() === '/home/setmark') candidates.add(this);
                    return originalOpen.call(this, method, url, ...args);
                }
                function send(body) {
                    if (candidates.has(this)) {
                        const params = new URLSearchParams(typeof body === 'string' ? body : '');
                        const expected = { testId: p.p.TestID, questionId: p.p.QuesID, paperId: p.q.PaperId,
                            bwId: p.q.BWRID, rowId: p.q.RowID, markType: 0, needReleaseNum: p.q.NeedReleaseNum,
                            gfNum: 0, arb: 0, score: p.values.join(','), flag: 0 };
                        if (observed || settled || guard.signal?.aborted
                            || !adapter._same(p, adapter._state(true))
                            || !Object.entries(expected).every(([key, value]) => params.getAll(key).length === 1 && params.get(key) === String(value))) {
                            finish(false); return;
                        }
                        observed = this;
                        for (const type of ['load', 'error', 'timeout', 'abort']) this.addEventListener(type, type === 'load' ? loaded : cancelled);
                        restore();
                    }
                    return originalSend.call(this, body);
                }
                const timer = setTimeout(cancelled, 15000);
                guard.signal?.addEventListener('abort', cancelled, { once: true });
                try {
                    proto.open = open; proto.send = send; button.click();
                    restore();
                    if (!observed) finish(false);
                } catch (_) { finish(false); }
            });
        } finally { this._filled = null; this._submitting = false; }
    },
    async waitForNextPaper(_oldImageUrl, guard = {}) {
        const baseline = this._submittedPaper;
        if (!baseline || guard.paperId && guard.paperId !== baseline.identity || guard.taskId && guard.taskId !== baseline.task) return false;
        let candidate = null;
        for (let poll = 0; poll < 150; poll++) {
            if (guard.signal?.aborted || this.getTaskIdentifier() !== baseline.task) return false;
            const s = this._state();
            const changed = s && s.q.PaperId !== baseline.q.PaperId && s.q.RowID !== baseline.q.RowID;
            if (changed && candidate === s.identity && (await this.gatherAnswerImages()).length) return true;
            candidate = changed ? s.identity : null;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    },
    isRegradeMode() {
        const w = this._page();
        return !!(w?.isKsht || w?.CurrQuestion?.IsHuiping > 0 || w?.arb > 0);
    },
};

if (LeascentAdapter.shouldInitialize()) window.__AI_MARKER_ADAPTER__ = LeascentAdapter;
