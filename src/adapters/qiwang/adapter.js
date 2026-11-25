const QIWANG_HOST = 'yunyuejuan.zhengrui-edu.com';
const QIWANG_ANSWER_HOST = 'qw-xinkao.oss-cn-hangzhou.aliyuncs.com';
const QIWANG_SAVE_PATH = '/MarkingOss/PutOssRating';
const QIWANG_NO_PAPER = '-2000';
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
        const { guId, subId, teaCode, markingOrReview, huipFlag, jumpNum } = this._page();
        const option = document.querySelector('.navTeaSelect option:checked');
        const label = option?.textContent.trim();
        if (String(markingOrReview) !== '1' || String(huipFlag) !== '0' || String(jumpNum) !== '1' || !guId || !subId || !teaCode
            || !label || option.dataset.teacode !== String(teaCode)) return null;
        return { taskId: JSON.stringify([guId, subId, teaCode].map(String)), label, max: this._points(option.dataset.teascore) };
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

    _isPaperId(value) {
        return (typeof value === 'string' || typeof value === 'number') && !!String(value).trim() && !/^(?:0$|-)/.test(String(value));
    },

    _secureAnswerUrl(value) {
        const url = new URL(value);
        if (!/^https?:$/.test(url.protocol) || url.host !== QIWANG_ANSWER_HOST || url.username || url.password
            || !/\.(?:jpe?g|png|webp)$/i.test(url.pathname)) return null;
        // 原站可能以 HTTP 写入图片地址。只升级此图源的协议，保留原签名与裁切参数。
        url.protocol = 'https:';
        return url;
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
        const { testPaperId, examcode, teaposdt } = this._page();
        const roots = [...document.querySelectorAll('#div-readPaper #myimg')].filter(MarkingPaper.visible);
        const images = MarkingPaper.snapshot('#div-readPaper #myimg img.teaimg');
        const unavailable = { ready: false, identity: null };
        if (!taskId || !this._isPaperId(testPaperId) || !examcode || roots.length !== 1 || !images.ready
            || teaposdt?.length !== images.urls.length) return unavailable;
        const answers = images.urls.map(value => this._secureAnswerUrl(value));
        if (!answers.every(Boolean)) return unavailable;
        const keys = answers.map(url => url.origin + url.pathname);
        if (new Set(keys).size !== keys.length) return unavailable;
        const nativeId = JSON.stringify([testPaperId, examcode]);
        const identity = JSON.stringify([...keys].sort());
        const previous = this._observedPaper;
        if (previous && (previous.taskId !== taskId || previous.identity !== identity)) {
            // 原站先切换卷号，再异步加载答题卡。全部新图就绪后才接受新卷。
            if (previous.nativeId === nativeId || keys.some(key => previous.keys.includes(key))) {
                return unavailable;
            }
        } else if (previous?.taskId === taskId && previous.nativeId !== nativeId) {
            return unavailable;
        }
        const urls = answers.map(url => url.href);
        const views = urls.map(url => this._imageViewKey(url));
        const snapshot = { ready: true, taskId, nativeId, paperId: String(testPaperId), identity, keys, views, urls };
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
        if (index < 0 || !this._samePaper(paper, current)) {
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
        if (!question || !MarkingPaper.visible(panel) || MarkingPaper.visible(document.querySelector('#demo_alert'))
            || document.querySelector('#moveBanner input.autohuiche')?.checked) return [];
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

    _validatedScores(scores, inputs, preserveText = false) {
        if (!Array.isArray(scores) || !inputs.length || scores.length !== inputs.length) return null;
        const { teaScopart } = this._page();
        if (typeof teaScopart !== 'string') return null;
        const allowed = teaScopart ? teaScopart.split(',') : [];
        const values = Array.from(scores, (value, index) => {
            const points = this._points(value);
            if (points === null || points > inputs[index].maximum) return null;
            const text = preserveText ? String(value) : allowed.length
                ? allowed.find(part => this._points(part) === points) : String(points / 100);
            if (allowed.length && !allowed.includes(text)) return null;
            return { text, points };
        });
        return values.every(Boolean) ? values : null;
    },

    fillScores(scores) {
        this.lastFillError = '';
        const paper = this._gatheredPaperSnapshot;
        if (!this._samePaper(paper) || this._wasSubmitted(paper)) {
            this.lastFillError = '请重新读取当前答题卡后填分';
            return false;
        }
        const inputs = this.getScoreInputs();
        const values = this._validatedScores(scores, inputs);
        if (!values) {
            this.lastFillError = '请核对各小题的分数和原站给分规则';
            return false;
        }
        if (!inputs.every(({ element }) => element.isConnected) || !this._samePaper(paper)) return false;
        // 先写完整组分数，再通知原站，避免事件处理器看到部分填分。
        for (const [index, { element }] of inputs.entries()) element.value = values[index].text;
        for (const { element } of inputs) {
            if (!element.isConnected || !this._samePaper(paper)) return false;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return this._samePaper(paper) && inputs.every(({ element }, index) => element.value === values[index].text);
    },

    _submitButton() {
        const button = document.querySelector('#moveDiv button.btn-standard-pri.phr15');
        return MarkingPaper.visible(button) && button.textContent.trim() === '提交分数'
            && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
    },

    _submissionResult(xhr, settings, paper, values, total) {
        if (String(settings.type).toUpperCase() !== 'POST' || typeof settings.data !== 'string') return null;
        const url = new URL(settings.url, window.location.href);
        if (url.origin !== window.location.origin || url.pathname !== QIWANG_SAVE_PATH) return null;
        const data = new URLSearchParams(settings.data);
        const task = JSON.stringify(['guId', 'subId', 'teaCode'].map(key => data.get(key)));
        const sent = data.get('detailScore')?.split(',').map(value => this._points(value));
        const matches = task === paper.taskId && data.get('Id') === paper.paperId && data.get('huipFlag') === '0'
            && this._points(data.get('scores')) === total
            && sent?.length === values.length && sent.every((value, index) => value === values[index].points);
        if (!matches || xhr.status < 200 || xhr.status >= 300) return null;
        const result = xhr.responseJSON;
        if (String(result?.success) !== '1') return null;
        const next = result.content?.Id;
        if (String(next) === QIWANG_NO_PAPER) return { paper, done: true };
        if (this._isPaperId(next) && String(next) !== paper.paperId) return { paper, nextId: String(next) };
        return null;
    },

    submitGrade(options = {}) {
        this.lastSubmitError = '原站未确认保存，请核对阅卷记录后继续';
        const paper = this._gatheredPaperSnapshot;
        const button = this._submitButton();
        const eventTarget = this._page().jQuery?.(document);
        const current = () => !options.signal?.aborted && (!options.isCurrent || options.isCurrent())
            && this._samePaper(paper) && !this._wasSubmitted(paper)
            && button && this._submitButton() === button;
        if (!current() || !eventTarget?.on || !eventTarget?.off) return false;
        const inputs = this.getScoreInputs();
        const values = this._validatedScores(inputs.map(({ element }) => element.value), inputs, true);
        if (!values) return false;
        const total = values.reduce((sum, value) => sum + value.points, 0);
        const nativeTotal = String(values.reduce((sum, value) => sum + Number(value.text), 0)).replace(/^(\d+\.\d{2}).*$/, '$1');
        if (this._points(nativeTotal) !== total) {
            this.lastSubmitError = '原站合计分数与小题之和不一致，请核对后提交';
            return false;
        }
        let receipt = null;
        const onComplete = (_event, xhr, settings) => {
            receipt ||= this._submissionResult(xhr, settings, paper, values, total);
        };
        // 原站同步保存。仅在原站按钮处理期间观察同题同卷的保存回执。
        eventTarget.on('ajaxComplete.aiMarkerQiwang', onComplete);
        try {
            if (!MarkingPaper.submit(this, button, { ...options, isCurrent: current })) return false;
        } finally {
            eventTarget.off('ajaxComplete.aiMarkerQiwang', onComplete);
        }
        if (!receipt) return false;
        this._submissionReceipt = receipt;
        this.lastSubmitError = '';
        return true;
    },

    isGradingTaskComplete() {
        const receipt = this._submissionReceipt;
        return receipt?.paper.taskId === this.getTaskIdentifier()
            && (receipt.done && String(this._page().testPaperId) === QIWANG_NO_PAPER
                || MarkingPaper.visible(document.querySelector('#demo_alert')));
    },

    async waitForNextPaper(oldImageUrl, context = {}) {
        if (this.isGradingTaskComplete()) return false;
        const receipt = this._submissionReceipt;
        const changed = await MarkingPaper.wait(this, oldImageUrl, context);
        return changed && (!receipt?.nextId || receipt.paper.identity !== context.paperId
            || receipt.nextId === this._paperSnapshot().paperId);
    }
};

if (QiwangAdapter.shouldInitialize()) {
    const existing = window.__AI_MARKER_ADAPTER__;
    if (existing) console.error(`[注册冲突] ${existing.name} 与启望阅卷同时匹配当前页面`);
    else window.__AI_MARKER_ADAPTER__ = QiwangAdapter;
}
