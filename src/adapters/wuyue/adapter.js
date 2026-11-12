// ========== 五岳阅卷适配器（Vue3 + Element Plus） ==========
const WUYUE_HELPERS = {
    visible(el) {
        if (!el || !el.getClientRects?.().length) return false;
        if (el.closest('.hideBox, .slide-fade-leave-active')) return false;
        if (el.checkVisibility) return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
        for (let node = el; node; node = node.parentElement) {
            const style = window.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
        }
        return true;
    },
    task() {
        try { return JSON.parse(window.sessionStorage.getItem('TaskParams')) || {}; }
        catch (_) { return {}; }
    },
    taskKey(task) {
        if ([task.examNo, task.esubNo, task.queNo].some(value => value == null || value === '')) return null;
        return ['wuyue', task.examNo, task.esubNo, task.queNo, task.IsArb ? 1 : 0].join('#');
    },
    panel() {
        const panels = Array.from(document.querySelectorAll(WUYUE_SELECTORS.SCORE_PANEL))
            .filter(el => this.visible(el) && !el.closest('.wyDialog'));
        return panels.length === 1 ? panels[0] : null;
    },
    box() {
        const boxes = Array.from(document.querySelectorAll(WUYUE_SELECTORS.OUT_BOX_ACTIVE))
            .filter(el => this.visible(el));
        return boxes.length === 1 ? boxes[0] : null;
    },
    images() {
        const box = this.box();
        if (!box) return [];
        const images = Array.from(box.querySelectorAll('.imgSection img'));
        return images.length && images.every(img => this.visible(img) && img.complete && img.naturalWidth > 0
            && img.src && !/imgError\.png/.test(img.src)) ? images : [];
    },
    imageKey(src) {
        try {
            const url = new URL(src, window.location.href);
            for (const key of [...url.searchParams.keys()]) {
                if (/^(?:signature|sig|token|access_token|expires|ossaccesskeyid|auth_key|x-oss-.*)$/i.test(key)) url.searchParams.delete(key);
            }
            url.searchParams.sort(); url.hash = '';
            return url.href;
        }
        catch (_) { return null; }
    },
    papers: new Map(),
    paper(task, images) {
        return this.papers.get(JSON.stringify([task, images.map(img => this.imageKey(img.currentSrc || img.src))]));
    },
    observe() {
        const pageWindow = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
        const proto = pageWindow.XMLHttpRequest?.prototype;
        if (!proto || this.observing) return;
        this.observing = true;
        const helper = this, originalOpen = proto.open, originalSend = proto.send, requests = new WeakMap();
        proto.open = function(method, url, ...args) {
            requests.delete(this);
            try {
                const target = new URL(url, pageWindow.location.href);
                if (String(method).toUpperCase() === 'POST' && /(?:^|\.)wylkyj\.com$/.test(target.hostname)
                    && /^\/api\/v[12]\/marking\/(?:Init|CheckInit|RMarkingInit|SaveAndInit)$/.test(target.pathname)) requests.set(this, target.pathname);
            } catch (_) { /* 不影响原站请求 */ }
            return originalOpen.call(this, method, url, ...args);
        };
        proto.send = function(body) {
            const endpoint = requests.get(this);
            if (endpoint) {
                try {
                    const task = helper.taskKey({ ...helper.task(), ...JSON.parse(body) });
                    const loaded = () => {
                        try {
                            if (this.status < 200 || this.status >= 300 || !task) return;
                            const response = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
                            if (response?.code !== 200) return;
                            const paper = endpoint.endsWith('/SaveAndInit') ? response.datas?.initResponse?.datas : response.datas;
                            if (paper?.info?.id == null || !paper.imageDatas?.length) return;
                            const key = JSON.stringify([task, paper.imageDatas.map(img => helper.imageKey(img.imageData))]);
                            const id = String(paper.info.id), previous = helper.papers.get(key);
                            helper.papers.set(key, previous && previous.id !== id ? { ambiguous: true } : { id });
                            while (helper.papers.size > 12) helper.papers.delete(helper.papers.keys().next().value);
                        } catch (_) { /* 不记录、不持久化答卷内容 */ }
                    };
                    this.addEventListener('load', loaded, { once: true });
                    this.addEventListener('loadend', () => this.removeEventListener('load', loaded), { once: true });
                } catch (_) { /* 保留原站请求行为 */ }
            }
            return originalSend.call(this, body);
        };
    },
    autoSubmitSwitch(panel) {
        return Array.from(panel.querySelectorAll('[role="switch"]')).find(el =>
            /自动提交/.test(el.closest('.auto, .simplifyAutoSub')?.textContent || ''));
    },
    number(value) {
        return (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
            && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    }
};

const WuyueAdapter = {
    name: '五岳阅卷', id: 'wuyue',
    urlPatterns: ['*://*.wylkyj.com/*'],
    iconUrl: 'https://www.wylkyj.com/favicon.ico',

    shouldInitialize() {
        const host = window.location.hostname.toLowerCase();
        return host === 'wylkyj.com' || host.endsWith('.wylkyj.com');
    },
    isMarkingPage() {
        return /^#\/reading(?:[/?]|$)/.test(window.location.hash)
            && !!WUYUE_HELPERS.panel() && !!WUYUE_HELPERS.box();
    },
    async detectMarkingPage() {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            if (this.isMarkingPage()) return true;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },
    getTaskIdentifier() {
        return WUYUE_HELPERS.taskKey(WUYUE_HELPERS.task());
    },
    getPaperIdentity() {
        if (!this.isMarkingPage()) return null;
        const keys = WUYUE_HELPERS.images().map(img => WUYUE_HELPERS.imageKey(img.currentSrc || img.src));
        const paper = WUYUE_HELPERS.paper(this.getTaskIdentifier(), WUYUE_HELPERS.images());
        return keys.length && keys.every(Boolean) && !paper?.ambiguous ? JSON.stringify([paper?.id || null, keys]) : null;
    },
    async gatherAnswerImages() {
        return this.isMarkingPage() ? WUYUE_HELPERS.images().map(img => img.currentSrc || img.src) : [];
    },
    async fetchImageAsBase64(url) { return fetchImageAsBase64(url); },

    getScoreInputs() {
        const panel = WUYUE_HELPERS.panel();
        if (!panel) return [];
        const fields = Array.from(panel.querySelectorAll('.computeItem input.el-input__inner, input#inputOne'))
            .filter(el => WUYUE_HELPERS.visible(el));
        return fields.map((element, index) => {
            const item = element.closest('.computeItem');
            const match = (element.placeholder || '').match(/满分\s*(\d+(?:\.\d+)?)\s*分/);
            const step = panel.textContent.match(/步长\s*(\d+(?:\.\d+)?)\s*分/);
            return { element, index, maxScore: match ? Number(match[1]) : 0,
                roundStep: step ? Number(step[1]) : 0,
                label: item?.querySelector('.num')?.textContent.trim() || WUYUE_HELPERS.task().queName || '总分',
                deduction: item?.querySelector('.inputBefore')?.textContent.trim() === '-' };
        });
    },
    detectSubQuestions() {
        const inputs = this.getScoreInputs();
        return inputs.length > 1 ? inputs : [];
    },
    fillScore({ total, subScores }) {
        if (subScores != null && (!Array.isArray(subScores) || subScores.some(score => !score
            || WUYUE_HELPERS.number(score.score) === null))) {
            this._filled = null; this.lastFillError = '评分结果不完整，请核对每个小题的分数'; return false;
        }
        const inputs = this.getScoreInputs();
        if (inputs.length === 1) return this.fillScores([total]);
        if (!Array.isArray(subScores) || subScores.length !== inputs.length) return this.fillScores([]);
        const labels = subScores.map(score => score?.label);
        if (new Set(labels).size !== labels.length || inputs.some(input => !labels.includes(input.label))) {
            this.lastFillError = '小题与给分板上的题号不一致，请核对评分方案';
            this._filled = null; return false;
        }
        return this.fillScores(inputs.map(input => subScores.find(score => score.label === input.label).score));
    },
    fillScores(scores) {
        this._filled = null; this.lastFillError = '';
        const fail = message => { this.lastFillError = message; return false; };
        const panel = WUYUE_HELPERS.panel(), inputs = this.getScoreInputs();
        const task = this.getTaskIdentifier(), paper = this.getPaperIdentity();
        if (!this.isMarkingPage() || !task || !paper || !inputs.length) {
            return fail('当前答卷或给分板尚未就绪，请等待加载完成后继续');
        }
        const metadata = WUYUE_HELPERS.paper(task, WUYUE_HELPERS.images());
        if (!metadata?.id || metadata.ambiguous) return fail('请退出阅卷后重新进入，再继续批改，以确认当前答卷');
        if (!Array.isArray(scores) || !scores.length || scores.some(score => WUYUE_HELPERS.number(score) === null)) {
            return fail('评分结果不完整，请核对每个小题的分数');
        }
        let values = scores.map(Number);
        // 题组只有一个总分框时汇总评分单元；多框仍逐项填写。
        if (inputs.length === 1) values = [Math.round(values.reduce((sum, value) => sum + value, 0) * 1e8) / 1e8];
        if (values.length !== inputs.length) return fail('小题数量与给分板不一致，请核对评分方案');
        for (let i = 0; i < inputs.length; i++) {
            const input = inputs[i];
            if (input.element.disabled || input.element.readOnly || input.element.closest('.disabled2')) {
                return fail('给分板暂时不可填写，请检查答卷加载状态和给分方式');
            }
            if (input.deduction) return fail('当前步骤采用扣分方式，请人工核对后给分');
            if (!(input.maxScore > 0) || values[i] > input.maxScore) return fail('评分结果超过给分板满分，请核对评分方案');
            if (input.roundStep > 0 && values[i] !== input.maxScore
                && Math.abs(values[i] / input.roundStep - Math.round(values[i] / input.roundStep)) > 1e-8) {
                return fail('评分结果不符合给分板步长，请调整评分方案的取整设置');
            }
        }
        const auto = WUYUE_HELPERS.autoSubmitSwitch(panel);
        if (auto?.getAttribute('aria-checked') === 'true') {
            if (auto.getAttribute('aria-disabled') === 'true') return fail('请先关闭给分板的自动提交，再继续批改');
            // 原站 ElSwitch 同步更新 P，避免 input 的 watch(j) 抢先提交。
            auto.closest('.el-switch').click();
        }
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        for (let i = 0; i < inputs.length; i++) {
            const element = inputs[i].element;
            element.focus(); // 原站按当前步骤判断是否填完。
            setter.call(element, String(values[i]));
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            if (WUYUE_HELPERS.number(element.value) !== values[i]) return fail('平台未接受填写的分数，请核对给分板');
        }
        this._filled = { task, paper, values, elements: inputs.map(input => input.element),
            nativeId: metadata.id,
            total: Math.round(values.reduce((sum, value) => sum + value, 0) * 1e8) / 1e8,
            review: this.isRegradeMode(), nativeTask: WUYUE_HELPERS.task() };
        return true;
    },

    async submitGrade(guard = {}) {
        if (this._submitting) return false;
        const pending = this._filled, panel = WUYUE_HELPERS.panel(), inputs = this.getScoreInputs();
        const button = panel && Array.from(panel.querySelectorAll(WUYUE_SELECTORS.SUBMIT_BUTTON))
            .find(el => WUYUE_HELPERS.visible(el));
        if (!pending || !button || button.disabled || button.classList.contains('disabled1')
            || guard.signal?.aborted || guard.isCurrent?.() === false || !this.isMarkingPage()
            || pending.task !== this.getTaskIdentifier() || pending.paper !== this.getPaperIdentity()
            || pending.review !== this.isRegradeMode() || inputs.length !== pending.values.length
            || inputs.some((input, i) => input.element !== pending.elements[i] || input.element.disabled
                || input.element.readOnly || WUYUE_HELPERS.number(input.element.value) !== pending.values[i])) return false;
        const auto = WUYUE_HELPERS.autoSubmitSwitch(panel);
        if (auto?.getAttribute('aria-checked') === 'true') return false;
        const pageWindow = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
        const proto = pageWindow.XMLHttpRequest?.prototype;
        if (!proto) return false;
        this._submitting = true; this.lastSubmitError = '';
        try {
            return await new Promise(resolve => {
                const originalOpen = proto.open, originalSend = proto.send, candidates = new WeakMap();
                let settled = false, observed = null, endpoint = '';
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
                    if (ok) this._filled = null;
                    else this.lastSubmitError = '平台尚未确认保存成功，请核对给分板和页面提示后继续';
                    resolve(ok);
                };
                const cancelled = () => finish(false);
                const loaded = () => {
                    try {
                        const body = observed.responseType === 'json' ? observed.response : JSON.parse(observed.responseText);
                        const saved = endpoint.endsWith('/SaveAndInit') ? body?.datas?.saveResponse : body;
                        finish(observed.status >= 200 && observed.status < 300 && body?.code === 200 && saved?.code === 200);
                    } catch (_) { finish(false); }
                };
                function open(method, url, ...args) {
                    try {
                        const target = new URL(url, pageWindow.location.href);
                        if (String(method).toUpperCase() === 'POST'
                            && (target.hostname === 'wylkyj.com' || target.hostname.endsWith('.wylkyj.com'))
                            && /^\/api\/v1\/marking\/Save(?:AndInit)?$/.test(target.pathname)) candidates.set(this, target.pathname);
                    } catch (_) { /* 非评分请求按原站行为处理 */ }
                    return originalOpen.call(this, method, url, ...args);
                }
                function send(body) {
                    if (!settled && !observed && candidates.has(this)) {
                        try {
                            const data = JSON.parse(body);
                            if (data.id != null && String(data.id) === pending.nativeId && Number(data.score) === pending.total
                                && ['esubNo', 'queNo'].every(key => String(data[key]) === String(pending.nativeTask[key]))
                                && !!data.IsArb === !!pending.nativeTask.IsArb
                                && (pending.values.length === 1 || Array.isArray(data.stepInfoList)
                                    && data.stepInfoList.length === pending.values.length
                                    && data.stepInfoList.every((step, i) => Number(step.stepScore) === pending.values[i]))) {
                                observed = this; endpoint = candidates.get(this);
                                for (const type of ['load', 'error', 'timeout', 'abort']) this.addEventListener(type, type === 'load' ? loaded : cancelled);
                                restore();
                            }
                        } catch (_) { /* 只观察原站生成的本题评分请求 */ }
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
    async waitForNextPaper(oldImageUrl, guard = {}) {
        const previous = guard.paperId || (oldImageUrl ? JSON.stringify([WUYUE_HELPERS.imageKey(oldImageUrl)]) : null);
        if (!previous) return false;
        const configured = Number(window.__AI_MARKER_WAIT_WINDOW_MS__);
        const deadline = Date.now() + (configured > 0 ? configured : 25000);
        while (Date.now() < deadline) {
            if (guard.signal?.aborted || guard.taskId && guard.taskId !== this.getTaskIdentifier()) return false;
            const current = this.getPaperIdentity();
            if (current && current !== previous && (!oldImageUrl || !WUYUE_HELPERS.images()
                .some(img => WUYUE_HELPERS.imageKey(img.src) === WUYUE_HELPERS.imageKey(oldImageUrl)))) return true;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    },
    isRegradeMode() {
        const panel = WUYUE_HELPERS.panel();
        return !!panel && Array.from(panel.querySelectorAll('button')).some(button =>
            WUYUE_HELPERS.visible(button) && button.textContent.trim() === '取消回评');
    }
};

if (WuyueAdapter.shouldInitialize()) {
    WUYUE_HELPERS.observe();
    window.__AI_MARKER_ADAPTER__ = WuyueAdapter;
}
