// ========== 华翰云适配器（yunyuejuan.net 旧部署，id=hanhan） ==========
// yunyuejuan.net — Vue3 + Element Plus
// ⚠️ 命名防混淆：与 lcedu 域的「云阅卷(华翰云)」（huahanyun）是两个不同适配器，勿混

const HanhanAdapter = {
    name: '华翰云',
    id: 'hanhan',
    urlPatterns: ['*://*.yunyuejuan.net/*'],
    iconUrl: 'https://yunyuejuan.net/favicon.ico',

    shouldInitialize() {
        return window.location.hostname.includes('yunyuejuan.net');
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器
    isMarkingPage() {
        return /\/marking\/grading(\?|$)/.test(window.location.hash);
    },

    async detectMarkingPage() {
        // 华翰云是 SPA，先检查 hash 路径是否为阅卷页面
        // 精确匹配 /marking/grading 后跟 ? 或结尾，排除 /marking/gradingList 等
        const hash = window.location.hash;
        if (!/\/marking\/grading(\?|$)/.test(hash)) {
            console.log('🔎 [诊断] 华翰云 — 当前不在阅卷页面 (hash:', hash, ')');
            return false;
        }

        console.log('🔎 [诊断] 华翰云 — 开始检测批改页面...');
        try {
            const result = await Promise.race([
                waitForElement(HANHAN_SELECTORS.PAGE_DETECT_IMAGE).then(() => 'answer-image'),
                waitForElement(HANHAN_SELECTORS.SCORE_INPUT).then(() => 'score-input'),
                waitForElement(HANHAN_SELECTORS.PAGE_DETECT_SUBMIT).then(() => 'submit-btn'),
            ]).catch(() => null);

            if (result) {
                console.log(`✅ [诊断] 检测到批改页面元素: ${result}`);
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 3000));
            const hasImage = document.querySelector(HANHAN_SELECTORS.ANSWER_IMAGE);
            const hasInput = document.querySelector(HANHAN_SELECTORS.SCORE_INPUT);
            const hasBtn = document.querySelector(HANHAN_SELECTORS.SUBMIT_BUTTON);
            const detected = !!(hasImage && hasInput && hasBtn);
            console.log(`🔎 [诊断] 兜底检测 — 图片: ${!!hasImage}, 输入框: ${!!hasInput}, 提交: ${!!hasBtn}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [诊断] detectMarkingPage 异常:', error);
            return false;
        }
    },

    _questionId() {
        return new URLSearchParams(window.location.hash.split('?')[1] || '').get('questionId') || '';
    },

    getTaskIdentifier() {
        return `hanhan_${this._questionId()}_${window.location.hash.split('?')[0]}`;
    },

    async gatherAnswerImages() {
        // 等待图片加载
        await new Promise(r => setTimeout(r, 1000));

        // 获取答题卡图片（排除 data: 开头的 base64 图片，这些通常是图标）
        const images = document.querySelectorAll(HANHAN_SELECTORS.ANSWER_IMAGE);
        const urls = [];

        images.forEach(img => {
            const src = img.src;
            // 只收集 http/https 开头的真实图片，排除 base64 图标
            if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
                urls.push(src);
            }
        });

        console.log(`🖼️ [诊断] 华翰云 — 找到答题卡图片: ${urls.length} 张`);
        if (urls.length > 0) {
            console.log(`🖼️ [诊断] 第一张图片: ${urls[0].substring(0, 80)}...`);
        }
        return urls;
    },

    async fetchImageAsBase64(url) {
        return fetchImageAsBase64(url);
    },

    fillScore(request) {
        return this.fillScores([request.total]);
    },

    submitGrade(guard = {}) {
        if (guard.signal?.aborted || guard.isCurrent?.() === false) return false;
        const buttons = [...document.querySelectorAll(HANHAN_SELECTORS.SUBMIT_BUTTON)]
            .filter(button => button.textContent.trim() === HANHAN_SELECTORS.SUBMIT_BUTTON_TEXT
                && MarkingPaper.visible(button));
        if (buttons.length !== 1) return false;
        const [button] = buttons;
        if (button.matches(':disabled, .is-disabled, [aria-disabled="true"]')) return false;

        const element = this.getScoreInputs()[0]?.element;
        if (!element) return false;
        if (element.readOnly || this._oneClickFill) {
            const pending = this._oneClickFill;
            const native = element.readOnly && this._getOneClickScoreContext(element);
            if (!pending || !native || native.paper !== pending.paper || native.identity !== pending.identity
                || element.value.trim() === '' || Number(element.value) !== pending.score
                || native.mark.questionScore !== pending.score) return false;
            this._oneClickFill = null;
        }
        button.click();
        return true;
    },

    getPaperWaitKeys(imageUrls) {
        return MarkingPaper.imageKeys(imageUrls);
    },

    waitForNextPaper(oldImageUrl, context = {}) {
        return MarkingPaper.waitForImages(this, HANHAN_SELECTORS.ANSWER_IMAGE, oldImageUrl, context, 200, 25000);
    },

    isRegradeMode() {
        // 华翰云暂未发现明确的回评模式标识
        return !!window.aiGradingState?.isRegrading;
    },

    _readQuestion() {
        const id = this._questionId();
        if (!this.isMarkingPage() || !id) return null;
        const titles = Array.from(document.querySelectorAll(HANHAN_SELECTORS.QUESTION_TITLE))
            .filter(title => MarkingPaper.visible(title));
        if (titles.length !== 1) return null;
        const match = titles[0].textContent.normalize('NFKC').trim().match(
            /^(?:[一二三四五六七八九十]+、\s*)?(?:主观题\s*)?(?:第\s*)?(\d+)(?:\s*题)?\s*\(\s*(\d+(?:\.\d+)?)\s*分\s*\)$/);
        const maxScore = Number(match?.[2]);
        return Number.isFinite(maxScore) && maxScore > 0 ? { question: `${id}:${match[1]}`, maxScore } : null;
    },

    getQuestionContext() {
        const info = this._readQuestion();
        return info ? { question: info.question, units: [{ label: '总分', maxScore: info.maxScore }] } : null;
    },

    getScoreInputs() {
        if (!this.isMarkingPage()) return [];
        const inputs = Array.from(document.querySelectorAll(HANHAN_SELECTORS.SCORE_INPUT))
            .filter(input => !input.matches(':disabled') && MarkingPaper.visible(input)
                && (!input.readOnly || input.matches(HANHAN_SELECTORS.ONE_CLICK_SCORE_INPUT)));
        if (inputs.length !== 1) return [];
        return [{ element: inputs[0], label: '总分', index: 0, maxScore: this._readQuestion()?.maxScore }];
    },

    _getOneClickScoreContext(element) {
        const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const app = pageWindow.document.getElementById('app');
        const store = app?.__vue_app__?.config?.globalProperties?.$store;
        const mark = store?.state?.mark;
        const paper = mark?.readOverInfo;
        const questionId = this._questionId();
        if (typeof store?.commit !== 'function' || !app.contains(element) || Number(mark?.markingType) !== 2
            || !questionId || !paper || String(paper.questionId ?? paper.question?.questionId) !== questionId
            || mark.haveJoin || mark.IsSubItemscoring || mark.batchGrading || mark.markReview
            || mark.reviewProps?.readonly || mark.feedBack || paper.judged || paper.checked || Number(paper.scored) === 1) return null;

        const maxScore = Number(paper.question?.score);
        const nativeImages = new Set(MarkingPaper.imageKeys(Array.isArray(paper.urls) ? paper.urls : []));
        const displayed = MarkingPaper.snapshot(HANHAN_SELECTORS.ANSWER_IMAGE);
        if (!Number.isFinite(maxScore) || maxScore <= 0 || !displayed.ready
            || nativeImages.size !== new Set(displayed.keys).size
            || displayed.keys.some(key => !nativeImages.has(key))) return null;
        return { store, mark, paper, maxScore, identity: displayed.identity };
    },

    fillScores(scores) {
        this.lastFillError = null;
        this._oneClickFill = null;
        const field = this.getScoreInputs()[0];
        if (!field) {
            this.lastFillError = '无法确认当前答卷的给分框，请核对阅卷页面后继续';
            return false;
        }
        const score = scores?.[0];
        if (scores?.length !== 1 || !Number.isFinite(score) || score < 0 ||
            (field.maxScore !== undefined && score > field.maxScore)) {
            this.lastFillError = '请在分数设置中重新检测评分项，核对总分后保存方案';
            return false;
        }

        const { element } = field;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        if (element.readOnly) {
            const native = this._getOneClickScoreContext(element);
            if (!native || score > native.maxScore) {
                this.lastFillError = '暂时无法写入当前答卷的分数，请检查阅卷页面后继续';
                return false;
            }
            // 一键给分通过原站状态更新分数，并保留单独的确认提交步骤。
            native.store.commit('mark/SET_SCOREING', score);
            if (native.mark.questionScore !== score || !element.isConnected) return false;
            setter.call(element, score);
            if (element.value.trim() === '' || Number(element.value) !== score) return false;
            this._oneClickFill = { paper: native.paper, identity: native.identity, score };
            return true;
        }

        setter.call(element, score);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        return element.isConnected && element.value.trim() !== '' && Number(element.value) === score;
    },

    detectSubQuestions() {
        // 华翰云暂未发现分小题结构
        return [];
    },
};

if (HanhanAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = HanhanAdapter;
}
