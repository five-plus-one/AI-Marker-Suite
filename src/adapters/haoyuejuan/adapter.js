// ========== 阅小二适配器 ==========
// www.haoyuejuan.com/yuejuan/#/reading — Vue 3 + Element Plus
// 与五岳阅卷同构（DOM/CDN 同源），但回评判定相反、hash 固定需拼题号

const HaoyuejuanAdapter = {
    name: '阅小二',
    id: 'haoyuejuan',
    urlPatterns: ['*://www.haoyuejuan.com/*', '*://haoyuejuan.com/*'],
    iconUrl: 'https://www.haoyuejuan.com/favicon.ico',

    shouldInitialize() {
        return window.location.hostname.includes('haoyuejuan.com');
    },

    // 快速页面检查（不等待 DOM）
    isMarkingPage() {
        const hash = window.location.hash || '';
        if (hash.includes('/reading')) return true;
        return !!document.querySelector(HAOYUEJUAN_SELECTORS.SUBMIT_BUTTON);
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('🔎 [阅小二] 当前不在阅卷页面 (hash:', window.location.hash, ')');
            return false;
        }

        console.log('🔎 [阅小二] 开始检测批改页面...');
        try {
            const result = await Promise.race([
                waitForElement(HAOYUEJUAN_SELECTORS.PAGE_DETECT_IMAGE, 8000).then(() => 'answer-image'),
                waitForElement(HAOYUEJUAN_SELECTORS.PAGE_DETECT_INPUT, 8000).then(() => 'score-input'),
                waitForElement(HAOYUEJUAN_SELECTORS.PAGE_DETECT_SUBMIT, 8000).then(() => 'submit-btn'),
            ]).catch(() => null);

            if (result) {
                console.log(`✅ [阅小二] 检测到批改页面元素: ${result}`);
                return true;
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
            const hasImage = document.querySelector(HAOYUEJUAN_SELECTORS.ANSWER_IMAGE);
            const hasInput = document.querySelector(HAOYUEJUAN_SELECTORS.SCORE_INPUT_SINGLE);
            const hasBtn = document.querySelector(HAOYUEJUAN_SELECTORS.SUBMIT_BUTTON);
            const detected = !!(hasImage && hasInput && hasBtn);
            console.log(`🔎 [阅小二] 兜底检测 — 图片: ${!!hasImage}, 输入框: ${!!hasInput}, 提交: ${!!hasBtn}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [阅小二] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // SPA 下 hash 固定为 #/reading，换卷不变；题号在 .computeItem .num
        // 换题时题号变化 → 重新绑定方案；换学生时题号不变 → 不重复弹窗
        const numEl = document.querySelector(HAOYUEJUAN_SELECTORS.SCORE_ITEM_NUM);
        const num = numEl ? numEl.textContent.trim() : '';
        return `${location.pathname}${location.hash}|${num}`;
    },

    async gatherAnswerImages() {
        // 换卷时 outBox 会短暂清空重建，稍等直到出现已加载的可见图
        for (let i = 0; i < 12; i++) {
            const imgs = Array.from(document.querySelectorAll(HAOYUEJUAN_SELECTORS.ANSWER_IMAGE));
            const urls = imgs
                .filter(img => img.src && img.naturalWidth > 0)
                .map(img => img.src);
            if (urls.length > 0) {
                console.log(`🖼️ [阅小二] 找到当前答卷 ${urls.length} 张答题卡（含 OSS 裁剪参数）`);
                return [...new Set(urls)];
            }
            await new Promise(r => setTimeout(r, 250));
        }

        // 兜底：不要求 naturalWidth，避免慢加载
        const fallback = Array.from(document.querySelectorAll(HAOYUEJUAN_SELECTORS.ANSWER_IMAGE_ALL))
            .map(img => img.src)
            .filter(src => src && src.startsWith('http'));
        if (fallback.length > 0) {
            console.log(`🖼️ [阅小二] 兜底取到 ${fallback.length} 张图片`);
            return [...new Set(fallback)];
        }

        console.warn('⚠️ [阅小二] 未找到答题卡图片');
        return [];
    },

    async fetchImageAsBase64(url) {
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];
        const computeItems = document.querySelectorAll(HAOYUEJUAN_SELECTORS.SCORE_ITEM);

        if (computeItems.length > 0) {
            computeItems.forEach((item, i) => {
                const numEl = item.querySelector('.num');
                const inputEl = item.querySelector('.el-input__inner');
                if (inputEl) {
                    const placeholder = inputEl.placeholder || '';
                    const maxScoreMatch = placeholder.match(/满分(\d+(?:\.\d+)?)分/);
                    const maxScore = maxScoreMatch ? parseFloat(maxScoreMatch[1]) : 0;
                    const label = numEl ? numEl.textContent.trim() : `第${i + 1}题`;
                    inputs.push({ element: inputEl, label, index: i, maxScore });
                }
            });
        } else {
            const singleInput = document.querySelector(HAOYUEJUAN_SELECTORS.SCORE_INPUT_SINGLE);
            if (singleInput) {
                const placeholder = singleInput.placeholder || '';
                const maxScoreMatch = placeholder.match(/满分(\d+(?:\.\d+)?)分/);
                const maxScore = maxScoreMatch ? parseFloat(maxScoreMatch[1]) : 0;
                inputs.push({ element: singleInput, label: '总分', index: 0, maxScore });
            }
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
            console.log(`✅ [阅小二] ${inputs[i].label} 分数 ${scores[i]} 已填入`);
        }
        return successCount > 0;
    },

    submitGrade() {
        const submitBtn = document.querySelector(HAOYUEJUAN_SELECTORS.SUBMIT_BUTTON);
        if (submitBtn) {
            console.log('✅ [阅小二] 点击提交按钮');
            submitBtn.click();
            return true;
        }
        console.warn('⚠️ [阅小二] 未找到提交按钮');
        return false;
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
                    // 等 naturalWidth 就绪，避免抓到 0x0 未加载图
                    const loaded = Array.from(document.querySelectorAll(HAOYUEJUAN_SELECTORS.ANSWER_IMAGE))
                        .some(img => img.naturalWidth > 0 && this._imgPath(img.src) !== oldPath);
                    if (loaded) {
                        clearInterval(timer);
                        console.log('✅ [阅小二] 新试卷已加载（图片 path 变化）');
                        resolve(true);
                        return;
                    }
                }

                // 输入框被清空（提交后平台会清空）
                const input = document.querySelector(HAOYUEJUAN_SELECTORS.SCORE_INPUT_SINGLE)
                    || document.querySelector(HAOYUEJUAN_SELECTORS.SCORE_ITEM_INPUT);
                if (input && input.value === '' && checkTimes > 3) {
                    clearInterval(timer);
                    console.log('✅ [阅小二] 新试卷已加载（输入框清空）');
                    resolve(true);
                    return;
                }

                if (checkTimes > 125) {  // 25秒（125 × 200ms），对齐其他适配器，避免平台加载慢时误判
                    clearInterval(timer);
                    console.warn('⚠️ [阅小二] 等待下一份试卷超时');
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
        return Array.from(document.querySelectorAll(HAOYUEJUAN_SELECTORS.ANSWER_IMAGE))
            .map(img => this._imgPath(img.src));
    },

    isRegradeMode() {
        // 与五岳相反：正常态是「回评上一份」，回评态出现「取消回评」
        // 不能用 btnBackUp 是否存在判断（换卷瞬间也会消失）
        const cancelBtn = document.querySelector(HAOYUEJUAN_SELECTORS.CANCEL_REGRADE_BUTTON);
        if (cancelBtn && (cancelBtn.textContent || '').includes('取消回评')) {
            return true;
        }
        const cardBack = document.querySelector('.cardBack');
        return !!(cardBack && (cardBack.textContent || '').includes('取消回评'));
    },
};

// 注册适配器
if (HaoyuejuanAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = HaoyuejuanAdapter;
}
