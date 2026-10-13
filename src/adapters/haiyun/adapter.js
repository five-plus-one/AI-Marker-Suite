// ========== 海云智评适配器 ==========
// zp.kaow.cn/#/grade/teacher/index — Vue 2 + Element UI，hash 路由固定不随换卷变化
// 与阅小二（haoyuejuan）同构点：普通 <img> 答题卡、多小题面板、native setter 填分
// 特有：提交后 el-dialog 二次确认（按钮 ID 固定）、满分写在 .sub-score 文本如 "(19)"

const HaiyunAdapter = {
    name: '海云智评',
    id: 'haiyun',
    urlPatterns: ['*://zp.kaow.cn/*'],
    iconUrl: 'https://zp.kaow.cn/favicon.ico',

    shouldInitialize() {
        return window.location.hostname.includes('kaow.cn');
    },

    isMarkingPage() {
        const hash = window.location.hash || '';
        if (hash.includes('/grade/teacher')) return true;
        return !!document.querySelector(HAIYUN_SELECTORS.SUBMIT_BUTTON);
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('🔎 [海云智评] 当前不在阅卷页面 (hash:', window.location.hash, ')');
            return false;
        }

        console.log('🔎 [海云智评] 开始检测批改页面...');
        try {
            const result = await Promise.race([
                waitForElement(HAIYUN_SELECTORS.PAGE_DETECT_IMAGE, 8000).then(() => 'answer-image'),
                waitForElement(HAIYUN_SELECTORS.PAGE_DETECT_INPUT, 8000).then(() => 'score-input'),
                waitForElement(HAIYUN_SELECTORS.PAGE_DETECT_SUBMIT, 8000).then(() => 'submit-btn'),
            ]).catch(() => null);

            if (result) {
                console.log(`✅ [海云智评] 检测到批改页面元素: ${result}`);
                return true;
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
            const hasImage = document.querySelector(HAIYUN_SELECTORS.ANSWER_IMAGE);
            const hasInput = document.querySelector(HAIYUN_SELECTORS.SCORE_INPUT);
            const hasBtn = document.querySelector(HAIYUN_SELECTORS.SUBMIT_BUTTON);
            const detected = !!(hasImage && hasInput && hasBtn);
            console.log(`🔎 [海云智评] 兜底检测 — 图片: ${!!hasImage}, 输入框: ${!!hasInput}, 提交: ${!!hasBtn}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [海云智评] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // hash 固定 #/grade/teacher/index 不随换卷变化，必须拼 DOM 内容区分
        // 题组号（页脚）换题时变化，小题标签换小题时变化；换学生时两者不变 → 不重复弹引导
        const groupEl = document.querySelector(HAIYUN_SELECTORS.QUESTION_GROUP);
        const group = groupEl ? groupEl.textContent.trim() : '';
        const labels = Array.from(document.querySelectorAll(HAIYUN_SELECTORS.SCORE_ITEM_LABEL))
            .map(el => el.textContent.trim())
            .filter(Boolean)
            .join(',');
        return `${location.pathname}${location.hash}|${group}|${labels}`;
    },

    async gatherAnswerImages() {
        // 换卷时图片短暂清空重建，等待已加载的可见图
        for (let i = 0; i < 12; i++) {
            const imgs = Array.from(document.querySelectorAll(HAIYUN_SELECTORS.ANSWER_IMAGE));
            const urls = imgs
                .filter(img => img.src && img.naturalWidth > 0)
                .map(img => img.src);
            if (urls.length > 0) {
                console.log(`🖼️ [海云智评] 找到答题卡 ${urls.length} 张`);
                return [...new Set(urls)];
            }
            await new Promise(r => setTimeout(r, 250));
        }

        // 兜底：不要求 naturalWidth，避免慢加载
        const fallback = Array.from(document.querySelectorAll(HAIYUN_SELECTORS.ANSWER_IMAGE))
            .map(img => img.src)
            .filter(src => src && src.startsWith('http'));
        if (fallback.length > 0) {
            console.log(`🖼️ [海云智评] 兜底取到 ${fallback.length} 张图片`);
            return [...new Set(fallback)];
        }

        console.warn('⚠️ [海云智评] 未找到答题卡图片');
        return [];
    },

    async fetchImageAsBase64(url) {
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];
        // 多小题时多个 .sub-item 并列；.mouse-score-wrapper 内无 .sub-item，天然排除按键面板
        document.querySelectorAll(HAIYUN_SELECTORS.SCORE_ITEM).forEach((item, i) => {
            const inputEl = item.querySelector(HAIYUN_SELECTORS.SCORE_INPUT);
            if (!inputEl) return;

            const labelEl = item.querySelector(HAIYUN_SELECTORS.SCORE_ITEM_LABEL);
            const label = labelEl ? labelEl.textContent.trim() : `第${i + 1}题`;

            // 满分优先从 .sub-score 文本提取，如 "(19)"；小数如 "(2.5)" 同样命中
            let maxScore = 0;
            const maxEl = item.querySelector(HAIYUN_SELECTORS.SCORE_ITEM_MAX);
            const maxText = maxEl ? (maxEl.textContent || '') : '';
            const m1 = maxText.match(/\((\d+(?:\.\d+)?)\)/);
            if (m1) {
                maxScore = parseFloat(m1[1]);
            } else if (labelEl) {
                // 兜底：title 属性形如 "1.4(19)"
                const m2 = (labelEl.getAttribute('title') || '').match(/\((\d+(?:\.\d+)?)\)/);
                if (m2) maxScore = parseFloat(m2[1]);
            }

            inputs.push({ element: inputEl, label, index: i, maxScore });
        });

        if (inputs.length === 0) {
            const single = document.querySelector(HAIYUN_SELECTORS.SCORE_INPUT);
            if (single) inputs.push({ element: single, label: '总分', index: 0, maxScore: 0 });
        }
        return inputs;
    },

    fillScores(scores) {
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) return false;

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        let successCount = 0;
        for (let i = 0; i < Math.min(scores.length, inputs.length); i++) {
            if (scores[i] === null || scores[i] === undefined) continue;
            const el = inputs[i].element;
            setter.call(el, scores[i]);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            successCount++;
            console.log(`✅ [海云智评] ${inputs[i].label} 分数 ${scores[i]} 已填入`);
        }
        return successCount > 0;
    },

    submitGrade() {
        const submitBtn = document.querySelector(HAIYUN_SELECTORS.SUBMIT_BUTTON);
        if (!submitBtn) {
            console.warn('⚠️ [海云智评] 未找到提交按钮');
            return false;
        }
        console.log('📤 [海云智评] 点击提交按钮');
        submitBtn.click();
        // 提交后弹二次确认对话框，自动点「提交」
        this._handleConfirmDialog();
        return true;
    },

    // 处理二次确认弹窗（el-dialog，按钮 ID 固定）
    _handleConfirmDialog() {
        console.log('⏳ [海云智评] 等待确认弹窗...');
        let checkCount = 0;
        const checkInterval = setInterval(() => {
            checkCount++;

            const confirmBtn = document.querySelector(HAIYUN_SELECTORS.CONFIRM_SUBMIT);
            if (confirmBtn && confirmBtn.offsetParent !== null) {
                console.log('✅ [海云智评] 找到确认弹窗，自动点击提交');
                confirmBtn.click();
                clearInterval(checkInterval);
                return;
            }

            // 超时（最多等 3 秒）
            if (checkCount >= 15) {
                clearInterval(checkInterval);
                console.log('ℹ️ [海云智评] 未检测到确认弹窗');
            }
        }, 200);
    },

    async waitForNextPaper(oldImageUrl) {
        const oldPath = oldImageUrl ? this._imgPath(oldImageUrl) : (this._currentImagePaths()[0] || '');
        let checkTimes = 0;

        return new Promise((resolve) => {
            const timer = setInterval(() => {
                checkTimes++;

                const paths = this._currentImagePaths();
                const hasNew = paths.some(p => p && p !== oldPath);
                if (hasNew) {
                    const loaded = Array.from(document.querySelectorAll(HAIYUN_SELECTORS.ANSWER_IMAGE))
                        .some(img => img.naturalWidth > 0 && this._imgPath(img.src) !== oldPath);
                    if (loaded) {
                        clearInterval(timer);
                        console.log('✅ [海云智评] 新试卷已加载（图片 path 变化）');
                        resolve(true);
                        return;
                    }
                }

                // 输入框被清空（提交后平台会清空）
                const input = document.querySelector(HAIYUN_SELECTORS.SCORE_INPUT);
                if (input && input.value === '' && checkTimes > 3) {
                    clearInterval(timer);
                    console.log('✅ [海云智评] 新试卷已加载（输入框清空）');
                    resolve(true);
                    return;
                }

                if (checkTimes > 125) {  // 25秒（125 × 200ms），对齐其他适配器
                    clearInterval(timer);
                    console.warn('⚠️ [海云智评] 等待下一份试卷超时');
                    resolve(false);
                }
            }, 200);
        });
    },

    _imgPath(url) {
        try {
            return new URL(url, location.href).pathname;
        } catch (e) {
            return String(url || '').slice(0, 80);
        }
    },

    _currentImagePaths() {
        return Array.from(document.querySelectorAll(HAIYUN_SELECTORS.ANSWER_IMAGE))
            .map(img => this._imgPath(img.src));
    },

    isRegradeMode() {
        // 暂不支持回评模式识别
        return false;
    },
};

// 注册适配器
if (HaiyunAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = HaiyunAdapter;
}
