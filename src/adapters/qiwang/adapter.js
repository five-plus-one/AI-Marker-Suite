const QIWANG_HOST = 'yunyuejuan.zhengrui-edu.com';
const QIWANG_ANSWER_HOST = 'qw-xinkao.oss-cn-hangzhou.aliyuncs.com';
const QIWANG_ROUTE = /^\/MarkingOss\/NormalReadOssPaper\/?$/;

const QiwangAdapter = {
    name: '启望阅卷',
    id: 'qiwang',
    iconUrl: '',
    urlPatterns: [`https://${QIWANG_HOST}/MarkingOss/NormalReadOssPaper*`],

    shouldInitialize() {
        const { protocol, host, pathname } = window.location;
        return protocol === 'https:' && host === QIWANG_HOST && QIWANG_ROUTE.test(pathname);
    },

    _page() {
        return typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    },

    isRegradeMode() {
        const { markingOrReview, huipFlag } = this._page();
        return (markingOrReview != null && String(markingOrReview) !== '1')
            || (huipFlag != null && String(huipFlag) !== '0');
    },

    _question() {
        if (!this.shouldInitialize() || this.isRegradeMode()) return null;
        const { guId, subId, teaCode, markingOrReview, huipFlag } = this._page();
        const option = document.querySelector('.navTeaSelect option:checked');
        const label = option?.textContent.trim();
        if (String(markingOrReview) !== '1' || String(huipFlag) !== '0' || !guId || !subId || !teaCode
            || !label || option.dataset.teacode !== String(teaCode)) return null;
        return { taskId: JSON.stringify([guId, subId, teaCode]), label, max: this._points(option.dataset.teascore) };
    },

    getTaskIdentifier() { return this._question()?.taskId || ''; },
    isMarkingPage() { return !!this._question(); },

    async detectMarkingPage() {
        for (let attempt = 0; attempt < 40 && this.shouldInitialize() && !this.isRegradeMode(); attempt++) {
            if (this.getQuestionContext() && this._paperSnapshot().ready) return true;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },

    _answerKey(value) {
        const key = MarkingPaper.imageKey(value);
        if (!key) return null;
        const url = new URL(key);
        if (url.protocol !== 'https:' || url.host !== QIWANG_ANSWER_HOST || url.username || url.password
            || !/\.(?:jpe?g|png|webp)$/i.test(url.pathname)) return null;
        return url.origin + url.pathname;
    },

    _imageViewKey(value) {
        const url = new URL(MarkingPaper.imageKey(value));
        for (const parameter of ['Expires', 'OSSAccessKeyId', 'Signature', 'security-token']) {
            url.searchParams.delete(parameter);
        }
        return url.href;
    },

    _paperSnapshot() {
        const taskId = this.getTaskIdentifier();
        const { testPaperId, examcode } = this._page();
        const roots = [...document.querySelectorAll('#div-readPaper #myimg')].filter(MarkingPaper.visible);
        const images = MarkingPaper.snapshot('#div-readPaper #myimg img.teaimg');
        const keys = images.urls.map(url => this._answerKey(url));
        if (!taskId || !testPaperId || !examcode || roots.length !== 1 || !images.ready || !keys.every(Boolean)
            || new Set(keys).size !== keys.length) {
            return { ready: false, identity: null };
        }
        const nativeId = JSON.stringify([testPaperId, examcode]);
        const identity = JSON.stringify([...new Set(keys)].sort());
        const previous = this._observedPaper;
        if (previous && (previous.taskId !== taskId || previous.identity !== identity)) {
            // 原站先切换卷号，再异步加载答题卡。全部新图就绪后才接受新卷。
            if (previous.nativeId === nativeId || keys.some(key => previous.keys.includes(key))) {
                return { ready: false, identity: null };
            }
        } else if (previous?.taskId === taskId && previous.nativeId !== nativeId) {
            return { ready: false, identity: null };
        }
        const views = images.urls.map(url => this._imageViewKey(url));
        const snapshot = { ready: true, taskId, nativeId, identity, keys, views, urls: images.urls };
        this._observedPaper = snapshot;
        return snapshot;
    },

    getPaperIdentity() { return this._paperSnapshot().identity; },
    async gatherAnswerImages() { return MarkingPaper.gather(this); },

    _samePaper(expected, actual = this._paperSnapshot()) {
        return !!expected?.ready && actual.ready && actual.identity === expected.identity
            && actual.taskId === expected.taskId && actual.nativeId === expected.nativeId
            && actual.views.every((view, index) => view === expected.views[index]);
    },

    _wasSubmitted(paper) {
        const submitted = this._submittedPaperSnapshot;
        return !!submitted && submitted.taskId === paper.taskId && submitted.nativeId === paper.nativeId;
    },

    async fetchImageAsBase64(url, signal) {
        const paper = this._gatheredPaperSnapshot;
        const current = this._paperSnapshot();
        const index = paper?.urls.indexOf(url) ?? -1;
        if (index < 0 || !this._samePaper(paper, current) || !this._answerKey(url)) {
            throw new Error('答题卡已变化，请重新读取');
        }
        const currentUrl = current.urls[index];
        const image = await fetchImageAsBase64(currentUrl, signal, { autoRefreshOn403: false });
        if (!this._samePaper(paper)) throw new Error('答题卡已变化，请重新读取');
        return image;
    },

    _points(value) {
        if (typeof value !== 'number' && typeof value !== 'string') return null;
        const text = String(value).trim();
        if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
        const points = Math.round(Number(text) * 100);
        return Number.isSafeInteger(points) ? points : null;
    },

    getScoreInputs() {
        const question = this._question();
        const panel = document.querySelector('#moveDiv');
        if (!question || !MarkingPaper.visible(panel) || document.querySelector('#moveBanner input.autohuiche')?.checked) return [];
        const fields = [...document.querySelectorAll('input.fenshu')];
        const inputs = fields.map((element, index) => {
            const label = element.closest('tbody.xtlist tr')?.querySelector('td')?.textContent
                .replace(/\s*[（(]\s*\+\s*\d+(?:\.\d+)?\s*[）)]\s*$/, '').trim();
            const maximum = this._points(element.dataset.score);
            if (!panel.contains(element) || !label || !(maximum > 0) || element.disabled || element.readOnly
                || !MarkingPaper.visible(element)) return null;
            return { element, label, index, maxScore: maximum / 100, maximum };
        });
        if (!inputs.length || !inputs.every(Boolean) || inputs.reduce((sum, input) => sum + input.maximum, 0) !== question.max) return [];
        return inputs;
    },

    getQuestionContext() {
        return nativeQuestionContext(this.getScoreInputs(), this._question()?.label ?? '');
    },

    _validatedScores(scores, inputs) {
        if (!Array.isArray(scores) || !inputs.length || scores.length !== inputs.length) return null;
        const { teaScopart } = this._page();
        const points = Array.from(scores, value => this._points(value));
        // 原站的设定分值模式以每个输入框的 inpart 为准。
        const restricted = String(teaScopart) === '1';
        const valid = points.every((value, index) => {
            const { element, maximum } = inputs[index];
            if (value === null || value > maximum) return false;
            if (!restricted) return true;
            const allowed = element.getAttribute('inpart')?.split(/[,，|]/).map(part => this._points(part));
            return !!allowed?.length && allowed.every(part => part !== null) && allowed.includes(value);
        });
        return valid ? points : null;
    },

    fillScores(scores) {
        this.lastFillError = '';
        const paper = this._gatheredPaperSnapshot;
        if (!this._samePaper(paper) || this._wasSubmitted(paper)) {
            this.lastFillError = '请重新读取当前答题卡后填分';
            return false;
        }
        const inputs = this.getScoreInputs();
        const points = this._validatedScores(scores, inputs);
        if (!points) {
            this.lastFillError = '请核对各小题的分数和原站给分规则';
            return false;
        }
        if (!inputs.every(({ element }) => element.isConnected) || !this._samePaper(paper)) return false;
        // 先写完整组分数，再通知原站，避免事件处理器看到部分填分。
        for (const [index, { element }] of inputs.entries()) element.value = String(points[index] / 100);
        for (const { element } of inputs) {
            if (!element.isConnected || !this._samePaper(paper)) return false;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return this._samePaper(paper) && inputs.every(({ element }, index) => this._points(element.value) === points[index]);
    },

    _submitButton() {
        const button = document.querySelector('#moveDiv button.btn-standard-pri.phr15');
        return MarkingPaper.visible(button) && button.textContent.trim() === '提交分数'
            && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
    },

    async submitGrade(options = {}) {
        this.lastSubmitError = '请核对原站阅卷记录后继续';
        const paper = this._gatheredPaperSnapshot;
        const button = this._submitButton();
        const current = () => !options.signal?.aborted && (!options.isCurrent || options.isCurrent())
            && this._samePaper(paper) && !this._wasSubmitted(paper)
            && button && this._submitButton() === button;
        if (!current()) return false;
        const inputs = this.getScoreInputs();
        if (!this._validatedScores(inputs.map(({ element }) => element.value), inputs)) return false;
        if (!MarkingPaper.submit(this, button, { ...options, isCurrent: current })) return false;
        return this.waitForNextPaper(paper.urls[0], { paperId: paper.identity, taskId: paper.taskId, signal: options.signal });
    },

    async waitForNextPaper(oldImageUrl, context = {}) {
        return MarkingPaper.wait(this, oldImageUrl, context);
    }
};

if (QiwangAdapter.shouldInitialize()) {
    const existing = window.__AI_MARKER_ADAPTER__;
    if (existing) console.error(`[注册冲突] ${existing.name} 与启望阅卷同时匹配当前页面`);
    else window.__AI_MARKER_ADAPTER__ = QiwangAdapter;
}
