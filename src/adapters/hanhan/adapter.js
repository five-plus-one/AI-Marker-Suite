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

    submitGrade() {
        // 查找"给分"按钮
        const buttons = document.querySelectorAll(HANHAN_SELECTORS.SUBMIT_BUTTON);
        for (const btn of buttons) {
            if (btn.textContent.trim() === HANHAN_SELECTORS.SUBMIT_BUTTON_TEXT) {
                console.log(`✅ [诊断] 华翰云 — 点击"给分"按钮`);
                btn.click();
                return true;
            }
        }

        // 备选：查找包含"给分"文字的按钮
        const allButtons = document.querySelectorAll('button');
        for (const btn of allButtons) {
            if (btn.textContent.trim().includes('给分')) {
                console.log(`✅ [诊断] 华翰云 — 点击包含"给分"的按钮`);
                btn.click();
                return true;
            }
        }

        console.warn('⚠️ [诊断] 未找到"给分"按钮');
        return false;
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
            .filter(input => !input.readOnly && !input.matches(':disabled') && MarkingPaper.visible(input));
        if (inputs.length !== 1) return [];
        return [{ element: inputs[0], label: '总分', index: 0, maxScore: this._readQuestion()?.maxScore }];
    },

    fillScores(scores) {
        this.lastFillError = null;
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
        setter.call(element, score);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        return element.value.trim() !== '' && Number(element.value) === score;
    },

    detectSubQuestions() {
        // 华翰云暂未发现分小题结构
        return [];
    },
};

if (HanhanAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = HanhanAdapter;
}
