// ========== 威科姆（悦卷通）阅卷适配器 ==========
// jQuery 传统页面，域名: wyna.onlyets.com
// 特点：多小题输入框，OSS 图片，键盘/鼠标/步骤三种打分模式
// 图片使用阿里云 OSS，带裁剪参数和安全 token

const WuyuetongAdapter = {
    name: '威科姆阅卷',
    id: 'wuyuetong',
    urlPatterns: ['*://wyna.onlyets.com/*'],
    iconUrl: '',

    shouldInitialize() {
        return window.location.hostname.includes('wyna.onlyets.com');
    },

    isMarkingPage() {
        return /\/mark\/v\d+\/view\//i.test(window.location.pathname);
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('[威科姆] 当前不在阅卷页面 (pathname:', window.location.pathname, ')');
            return false;
        }

        console.log('[威科姆] 开始检测批改页面...');
        try {
            const result = await Promise.race([
                waitForElement(WUYUETONG_SELECTORS.PAGE_DETECT_IMAGE).then(() => 'answer-image'),
                waitForElement(WUYUETONG_SELECTORS.PAGE_DETECT_INPUT).then(() => 'score-input'),
                waitForElement(WUYUETONG_SELECTORS.PAGE_DETECT_SUBMIT).then(() => 'submit-btn'),
            ]).catch(() => null);

            if (result) {
                console.log(`[威科姆] 检测到批改页面元素: ${result}`);
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 3000));
            const hasImage = document.querySelector(WUYUETONG_SELECTORS.ANSWER_IMAGE);
            const hasInput = document.querySelector(WUYUETONG_SELECTORS.SCORE_INPUT);
            const hasBtn = document.querySelector(WUYUETONG_SELECTORS.SUBMIT_BUTTON);
            const detected = !!(hasImage && hasInput && hasBtn);
            console.log(`[威科姆] 兜底检测 - 图片: ${!!hasImage}, 输入框: ${!!hasInput}, 提交: ${!!hasBtn}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('[威科姆] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        return window.location.href;
    },

    async gatherAnswerImages() {
        console.log('[威科姆] 开始获取答题卡图片...');

        const startTime = Date.now();
        const maxWait = 8000;

        // 轮询等待图片加载完成
        while (Date.now() - startTime < maxWait) {
            const img = document.querySelector(WUYUETONG_SELECTORS.ANSWER_IMAGE);
            if (img && img.src && img.src.startsWith('http')) {
                // 检查图片是否已加载完成
                if (img.naturalWidth > 0 || img.complete) {
                    console.log('[威科姆] 获取到答题卡图片');
                    return [img.src];
                }
            }

            const elapsed = Date.now() - startTime;
            console.log(`[威科姆] 图片尚未加载，等待中... (${elapsed}ms)`);
            await new Promise(r => setTimeout(r, 300));
        }

        // 超时兜底
        const fallbackImg = document.querySelector(WUYUETONG_SELECTORS.ANSWER_IMAGE);
        if (fallbackImg && fallbackImg.src && fallbackImg.src.startsWith('http')) {
            console.log('[威科姆] 超时兜底: 获取到图片');
            return [fallbackImg.src];
        }

        console.warn('[威科姆] 未找到答题卡图片');
        return [];
    },

    async fetchImageAsBase64(url) {
        // OSS 图片可能需要移除裁剪参数以获取原图
        // 但当前 URL 已经是裁剪后的，直接使用
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];
        const inputEls = document.querySelectorAll(WUYUETONG_SELECTORS.SCORE_INPUT);

        inputEls.forEach((el, i) => {
            // 从父容器的 font 标签提取最大分数，格式: <=4
            let maxScore = 0;
            const container = el.closest(WUYUETONG_SELECTORS.SCORE_INPUT_CONTAINER);
            if (container) {
                const fontEl = container.querySelector(WUYUETONG_SELECTORS.MAX_SCORE_FONT);
                if (fontEl) {
                    const match = fontEl.textContent.match(/(\d+)/);
                    if (match) {
                        maxScore = parseInt(match[1]) || 0;
                    }
                }
            }

            // 获取小题标签（从 label.control-label 获取）
            const labelEl = container ? container.querySelector(WUYUETONG_SELECTORS.SCORE_LABEL) : null;
            const label = labelEl ? labelEl.textContent.trim().replace(/:$/, '') : `第${i + 1}题`;

            inputs.push({
                element: el,
                label: label,
                index: i,
                maxScore: maxScore
            });
        });

        console.log(`[威科姆] 找到 ${inputs.length} 个分数输入框`);
        return inputs;
    },

    fillScores(scores) {
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) return false;

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        let successCount = 0;

        // 确保键盘打分模式激活
        this._ensureKeyboardMode();

        for (let i = 0; i < Math.min(scores.length, inputs.length); i++) {
            if (scores[i] === null || scores[i] === undefined) continue;

            const input = inputs[i].element;
            const score = scores[i];

            // 设置值
            setter.call(input, score);

            // 触发事件（jQuery 页面需要触发多种事件）
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            // 触发 jQuery 的 keyup 事件（平台使用 onkeyup 验证）
            input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

            successCount++;
        }

        return successCount > 0;
    },

    submitGrade() {
        // 检查 0 分确认状态
        const zeroConfirm = document.querySelector(WUYUETONG_SELECTORS.ZERO_CONFIRM_CHECKBOX);
        if (zeroConfirm && !zeroConfirm.checked) {
            // 如果有分数为 0 且未勾选 0 分确认，可能需要处理
            const inputs = this.getScoreInputs();
            const hasZero = inputs.some(input => input.element.value === '0');
            if (hasZero) {
                console.log('[威科姆] 检测到 0 分，尝试勾选 0 分确认');
                zeroConfirm.click();
            }
        }

        const btn = document.querySelector(WUYUETONG_SELECTORS.SUBMIT_BUTTON);
        if (btn) {
            btn.click();
            console.log('[威科姆] 点击提交按钮');
            return true;
        }

        console.warn('[威科姆] 未找到提交按钮');
        return false;
    },

    async waitForNextPaper(oldImageUrl) {
        const timeout = 30000;
        const interval = 500;
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            // 检查图片是否变化
            const img = document.querySelector(WUYUETONG_SELECTORS.ANSWER_IMAGE);
            const currentUrl = img ? img.src : null;
            if (oldImageUrl && currentUrl && currentUrl !== oldImageUrl) {
                console.log('[威科姆] 检测到图片变化');
                return true;
            }

            // 检查分数输入框是否已清空
            const firstInput = document.querySelector(WUYUETONG_SELECTORS.SCORE_INPUT);
            if (firstInput && (firstInput.value === '' || firstInput.value === '0')) {
                console.log('[威科姆] 检测到输入框已清空');
                return true;
            }

            await new Promise(r => setTimeout(r, interval));
        }

        console.warn('[威科姆] 等待下一份答卷超时');
        return false;
    },

    isRegradeMode() {
        // 检查页面是否有回评相关文字
        const bodyText = document.body.innerText || '';
        if (bodyText.includes('回评') || bodyText.includes('复核')) {
            return true;
        }
        return !!window.aiGradingState?.isRegrading;
    },

    detectSubQuestions() {
        return [];
    },

    // 确保键盘打分模式激活
    _ensureKeyboardMode() {
        const keyboardRadio = document.querySelector(WUYUETONG_SELECTORS.KEYBOARD_MODE);
        if (keyboardRadio && !keyboardRadio.checked) {
            keyboardRadio.click();
            console.log('[威科姆] 切换到键盘打分模式');
        }
    },

    // 确保自动提交选项状态
    _ensureAutoSubmit(enable = true) {
        const checkbox = document.querySelector(WUYUETONG_SELECTORS.AUTO_SUBMIT_CHECKBOX);
        if (checkbox && checkbox.checked !== enable) {
            checkbox.click();
            console.log(`[威科姆] ${enable ? '启用' : '禁用'}自动提交`);
        }
    },

    onPageLoad() {
        // 确保键盘打分模式
        this._ensureKeyboardMode();

        // 注入 z-index 修复样式
        const style = document.createElement('style');
        style.id = 'wuyuetong-zindex-fix';
        style.textContent = `
            /* 提高脚本 UI 的 z-index，避免被威科姆平台元素遮挡 */
            .ai-grade-btn, .ai-history-btn, .ai-settings-btn,
            .ai-toast, #ai-history-panel, #ai-grading-settings,
            .ai-modal-overlay, #correction-panel,
            #auto-submit-dialog, #asd-minimized-bar,
            #ai-stream-container, #ai-history-overlay,
            #ai-stream-panel {
                z-index: 2147483640 !important;
            }
        `;
        document.head.appendChild(style);
        console.log('[威科姆] 已注入 z-index 修复样式');
    },
};

// 注册适配器
if (WuyuetongAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = WuyuetongAdapter;

    // 立即注入 z-index 修复样式
    const style = document.createElement('style');
    style.id = 'wuyuetong-zindex-fix';
    style.textContent = `
        /* 提高脚本 UI 的 z-index，避免被威科姆平台元素遮挡 */
        .ai-grade-btn, .ai-history-btn, .ai-settings-btn,
        .ai-toast, #ai-history-panel, #ai-grading-settings,
        .ai-modal-overlay, #correction-panel,
        #auto-submit-dialog, #asd-minimized-bar,
        #ai-stream-container, #ai-history-overlay,
        #ai-stream-panel {
            z-index: 2147483640 !important;
        }
    `;
    document.head.appendChild(style);

    // 用 JS 强制修改内联样式
    const WUYUETONG_UI_SELECTORS = [
        '.ai-grade-btn', '.ai-history-btn', '.ai-settings-btn',
        '#ai-grading-settings', '#ai-history-panel', '#ai-history-overlay',
        '#ai-history-detail', '#ai-stream-panel', '#auto-submit-dialog',
        '#asd-minimized-bar', '#correction-panel', '.ai-modal-overlay',
        '.ai-toast', '#ai-update-dialog'
    ];

    const fixInlineZIndex = () => {
        document.querySelectorAll(WUYUETONG_UI_SELECTORS.join(', ')).forEach(el => {
            el.style.setProperty('z-index', '2147483640', 'important');
        });
    };

    // 多次尝试，确保在 UI 创建后执行
    setTimeout(fixInlineZIndex, 3000);
    setTimeout(fixInlineZIndex, 5000);
    setTimeout(fixInlineZIndex, 8000);

    // 监听 DOM 变化，自动修复新创建的脚本 UI 元素
    const observer = new MutationObserver(() => fixInlineZIndex());
    observer.observe(document.body, { childList: true, subtree: true });

    console.log('[威科姆] 适配器已注册');
}
