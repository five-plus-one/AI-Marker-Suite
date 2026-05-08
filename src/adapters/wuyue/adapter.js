// ========== 五岳阅卷适配器 ==========
// wylkyj.com — Vue3 + Element Plus

const WuyueAdapter = {
    name: '五岳阅卷',
    id: 'wuyue',
    urlPatterns: ['*://*.wylkyj.com/*'],
    iconUrl: 'https://www.wylkyj.com/favicon.ico',

    shouldInitialize() {
        return window.location.hostname.includes('wylkyj.com');
    },

    async detectMarkingPage() {
        console.log('🔎 [诊断] 五岳阅卷 — 开始检测批改页面...');
        try {
            const result = await Promise.race([
                waitForElement(WUYUE_SELECTORS.PAGE_DETECT_IMAGE).then(() => 'answer-image'),
                waitForElement(WUYUE_SELECTORS.PAGE_DETECT_INPUT).then(() => 'score-input'),
                waitForElement(WUYUE_SELECTORS.PAGE_DETECT_SUBMIT).then(() => 'submit-btn'),
            ]).catch(() => null);

            if (result) {
                console.log(`✅ [诊断] 检测到批改页面元素: ${result}`);
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 3000));
            const hasImage = document.querySelector(WUYUE_SELECTORS.ANSWER_IMAGE);
            const hasInput = document.querySelector(WUYUE_SELECTORS.SCORE_INPUT_SINGLE);
            const hasBtn = document.querySelector(WUYUE_SELECTORS.SUBMIT_BUTTON);
            const detected = !!(hasImage && hasInput && hasBtn);
            console.log(`🔎 [诊断] 兜底检测 — 图片: ${!!hasImage}, 输入框: ${!!hasInput}, 提交: ${!!hasBtn}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [诊断] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // 五岳阅卷是 SPA，使用 hash 路径
        return window.location.href;
    },

    async gatherAnswerImages() {
        // 等待图片加载
        await new Promise(r => setTimeout(r, 1000));

        // 获取当前显示的 AnswerSheet 类型图片
        const activeImage = document.querySelector(WUYUE_SELECTORS.ANSWER_IMAGE);
        if (activeImage && activeImage.src) {
            console.log(`🖼️ [诊断] 找到答题卡图片: ${activeImage.src.substring(0, 60)}...`);
            return [activeImage.src];
        }

        // 备选：获取所有 AnswerSheet 图片
        const allImages = document.querySelectorAll(WUYUE_SELECTORS.ANSWER_IMAGE_ALL);
        const urls = [];
        allImages.forEach(img => {
            if (img.src && img.src.includes('AnswerSheet')) {
                urls.push(img.src);
            }
        });

        console.log(`🖼️ [诊断] 有效图片 URL 数量: ${urls.length}`);
        return urls;
    },

    async fetchImageAsBase64(url) {
        return fetchImageAsBase64(url);
    },

    fillScore(request) {
        const { total, subScores } = request;

        // 分小题填入
        const subQuestions = this.detectSubQuestions();
        if (subQuestions.length > 0 && subScores && subScores.length > 0) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            for (const sq of subScores) {
                const target = subQuestions.find(d =>
                    d.label === sq.label || sq.label.includes(d.label) || d.label.includes(sq.label)
                );
                if (target && sq.score !== null) {
                    setter.call(target.element, sq.score);
                    target.element.dispatchEvent(new Event('input', { bubbles: true }));
                    target.element.dispatchEvent(new Event('change', { bubbles: true }));
                    target.element.dispatchEvent(new Event('blur', { bubbles: true }));
                    console.log(`✅ [诊断] 小题 ${sq.label} 分数 ${sq.score} 已填入`);
                }
            }
            return true;
        }

        // 单题模式：填总分
        const scoreInput = document.querySelector(WUYUE_SELECTORS.SCORE_INPUT_SINGLE);
        console.log(`🔎 [诊断] 五岳阅卷 fillScore — 分数: ${total}, 输入框: ${!!scoreInput}`);

        if (scoreInput) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(scoreInput, total);
            scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
            scoreInput.dispatchEvent(new Event('change', { bubbles: true }));
            scoreInput.dispatchEvent(new Event('blur', { bubbles: true }));
            console.log(`✅ [诊断] 分数已填入`);
            return true;
        }
        console.warn('⚠️ [诊断] 未找到分数输入框');
        return false;
    },

    submitGrade() {
        const submitBtn = document.querySelector(WUYUE_SELECTORS.SUBMIT_BUTTON);
        if (submitBtn) {
            console.log(`✅ [诊断] 五岳阅卷 — 点击提交按钮`);
            submitBtn.click();
            return true;
        }
        console.warn('⚠️ [诊断] 未找到提交按钮');
        return false;
    },

    async waitForNextPaper(oldImageUrl) {
        let checkTimes = 0;
        return new Promise((resolve) => {
            const timer = setInterval(() => {
                checkTimes++;

                // 获取当前图片 URL
                const currentImg = document.querySelector(WUYUE_SELECTORS.ANSWER_IMAGE);
                const currentUrl = currentImg ? currentImg.src : null;

                // 检测图片变化或输入框被清空
                const input = document.querySelector(WUYUE_SELECTORS.SCORE_INPUT_SINGLE);
                const inputCleared = input && (input.value === '' || input.value === '0');

                if (oldImageUrl && currentUrl && currentUrl !== oldImageUrl) {
                    clearInterval(timer);
                    console.log('✅ 五岳阅卷 — 新试卷已加载（图片变化）');
                    resolve(true);
                } else if (inputCleared && checkTimes > 3) {
                    clearInterval(timer);
                    console.log('✅ 五岳阅卷 — 新试卷已加载（输入框清空）');
                    resolve(true);
                } else if (checkTimes > 50) {
                    clearInterval(timer);
                    console.warn('⚠️ 五岳阅卷 — 等待下一份试卷超时');
                    resolve(false);
                }
            }, 200);
        });
    },

    isRegradeMode() {
        // 检查回评按钮是否存在且可见
        const backUpBtn = document.querySelector(WUYUE_SELECTORS.BACK_UP_BUTTON);
        return !!backUpBtn;
    },

    getScoreInputs() {
        const inputs = [];

        // 检测多小题模式
        const computeItems = document.querySelectorAll(WUYUE_SELECTORS.SCORE_ITEM);
        if (computeItems.length > 0) {
            computeItems.forEach((item, i) => {
                const numEl = item.querySelector('.num');
                const inputEl = item.querySelector('.el-input__inner');
                if (inputEl) {
                    const maxScore = numEl ? numEl.textContent.trim() : '';
                    const label = `第${i + 1}题`;
                    inputs.push({ element: inputEl, label, index: i, maxScore: parseInt(maxScore) || 0 });
                }
            });
        } else {
            // 单题模式
            const singleInput = document.querySelector(WUYUE_SELECTORS.SCORE_INPUT_SINGLE);
            if (singleInput) {
                const placeholder = singleInput.placeholder || '';
                const maxScoreMatch = placeholder.match(/满分(\d+)分/);
                const maxScore = maxScoreMatch ? parseInt(maxScoreMatch[1]) : 0;
                inputs.push({ element: singleInput, label: '总分', index: 0, maxScore });
            }
        }

        return inputs;
    },

    detectSubQuestions() {
        const subs = [];
        const computeItems = document.querySelectorAll(WUYUE_SELECTORS.SCORE_ITEM);

        // 多小题模式
        if (computeItems.length > 1) {
            computeItems.forEach((item, i) => {
                const numEl = item.querySelector('.num');
                const inputEl = item.querySelector('.el-input__inner');
                if (inputEl && numEl) {
                    const maxScore = parseInt(numEl.textContent.trim()) || 0;
                    const label = `第${i + 1}题`;
                    subs.push({ label, element: inputEl, index: i, maxScore });
                }
            });
        }

        return subs;
    },
};

if (WuyueAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = WuyueAdapter;
}

