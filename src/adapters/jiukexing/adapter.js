// ========== 九科星阅卷适配器 ==========
// Vue SPA 页面，答题卡使用 OBS 图片裁剪（多图拼接）
// 域名: marking.jkxjxw.com
// 特点：多小题评分，placeholder 格式 "≤X分" 提取满分

const JiukexingAdapter = {
    name: '九科星',
    id: 'jiukexing',
    urlPatterns: ['*://marking.jkxjxw.com/*'],
    iconUrl: '',

    shouldInitialize() {
        return window.location.hostname.includes('marking.jkxjxw.com');
    },

    async detectMarkingPage() {
        console.log('[九科星] 开始检测批改页面...');
        try {
            const result = await Promise.race([
                waitForElement(JIUKEXING_SELECTORS.PAGE_DETECT_IMAGE).then(() => 'image'),
                waitForElement(JIUKEXING_SELECTORS.PAGE_DETECT_INPUT).then(() => 'score-input'),
                waitForElement(JIUKEXING_SELECTORS.PAGE_DETECT_SUBMIT).then(() => 'submit-btn'),
            ]).catch(() => null);

            if (result) {
                console.log(`[九科星] 检测到批改页面元素: ${result}`);
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 3000));
            const hasImage = document.querySelector(JIUKEXING_SELECTORS.ANSWER_IMAGE);
            const hasInput = document.querySelector(JIUKEXING_SELECTORS.SCORE_INPUT);
            const hasSubmit = document.querySelector(JIUKEXING_SELECTORS.SUBMIT_BUTTON);
            const detected = !!(hasImage && hasInput && hasSubmit);
            console.log(`[九科星] 兜底检测 - 图片: ${!!hasImage}, 输入框: ${!!hasInput}, 提交按钮: ${!!hasSubmit}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('[九科星] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        return window.location.href;
    },

    async gatherAnswerImages() {
        console.log('[九科星] 开始获取答题卡图片...');

        const startTime = Date.now();
        const maxWait = 8000;

        // 轮询等待图片加载完成
        while (Date.now() - startTime < maxWait) {
            const imgs = document.querySelectorAll(JIUKEXING_SELECTORS.ANSWER_IMAGE);
            if (imgs.length > 0) {
                const urls = Array.from(imgs)
                    .map(img => img.src)
                    .filter(src => src && !src.startsWith('data:image/svg')); // 过滤 loading 占位图

                if (urls.length > 0) {
                    console.log(`[九科星] 获取到 ${urls.length} 张答题卡图片`);
                    return urls;
                }
            }

            const elapsed = Date.now() - startTime;
            console.log(`[九科星] 图片尚未加载，等待中... (${elapsed}ms)`);
            await new Promise(r => setTimeout(r, 300));
        }

        // 超时兜底
        console.warn('[九科星] 等待图片加载超时，尝试返回已有内容...');
        const fallbackImgs = document.querySelectorAll(JIUKEXING_SELECTORS.ANSWER_IMAGE);
        const urls = Array.from(fallbackImgs)
            .map(img => img.src)
            .filter(src => src && src.length > 100);

        if (urls.length > 0) {
            console.log(`[九科星] 超时兜底: 获取到 ${urls.length} 张图片`);
            return urls;
        }

        console.warn('[九科星] 未找到答题卡图片');
        return [];
    },

    async fetchImageAsBase64(url) {
        // 如果已经是 data URL，直接返回 base64 部分
        if (url.startsWith('data:image')) {
            const base64 = url.split(',')[1] || '';
            return base64;
        }
        // 否则使用通用方法下载
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];
        const inputEls = document.querySelectorAll(JIUKEXING_SELECTORS.SCORE_INPUT);

        inputEls.forEach((el, i) => {
            // 从 placeholder 提取满分，格式: "≤12分"
            let maxScore = 0;
            const placeholder = el.placeholder || '';
            const match = placeholder.match(/≤(\d+)分/);
            if (match) {
                maxScore = parseInt(match[1]) || 0;
            }

            // 获取小题标签（从父容器 .quesGrade 的 h1 获取）
            const parent = el.closest(JIUKEXING_SELECTORS.QUESTION_GRADE);
            const labelEl = parent ? parent.querySelector('h1') : null;
            const label = labelEl ? labelEl.textContent.trim().replace(/：$/, '') : `第${i + 1}题`;

            inputs.push({
                element: el,
                label: label,
                index: i,
                maxScore: maxScore
            });
        });

        console.log(`[九科星] 找到 ${inputs.length} 个分数输入框`);
        return inputs;
    },

    fillScores(scores) {
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) return false;

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        let successCount = 0;

        for (let i = 0; i < Math.min(scores.length, inputs.length); i++) {
            if (scores[i] === null || scores[i] === undefined) continue;

            const input = inputs[i].element;
            const score = scores[i];

            // 设置值
            setter.call(input, score);

            // 触发 Vue 响应式事件
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));

            successCount++;
        }

        return successCount > 0;
    },

    submitGrade() {
        const btn = document.querySelector(JIUKEXING_SELECTORS.SUBMIT_BUTTON);
        if (btn) {
            btn.click();
            console.log('[九科星] 点击提交按钮');
            return true;
        }

        console.warn('[九科星] 未找到提交按钮');
        return false;
    },

    async waitForNextPaper(oldImageUrl) {
        const timeout = 30000;
        const interval = 500;
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            // 检查图片是否变化
            const newImages = await this.gatherAnswerImages();
            if (newImages.length > 0) {
                const newUrl = newImages[0];
                if (oldImageUrl && newUrl !== oldImageUrl) {
                    console.log('[九科星] 检测到图片变化');
                    return true;
                }
            }

            // 检查分数输入框是否已清空
            const firstInput = document.querySelector(JIUKEXING_SELECTORS.SCORE_INPUT);
            if (firstInput && (firstInput.value === '' || firstInput.value === '0')) {
                console.log('[九科星] 检测到输入框已清空');
                return true;
            }

            await new Promise(r => setTimeout(r, interval));
        }

        console.warn('[九科星] 等待下一份答卷超时');
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

    // 页面加载后设置 z-index，解决 Vue 组件遮挡问题
    onPageLoad() {
        const style = document.createElement('style');
        style.id = 'jiukexing-zindex-fix';
        style.textContent = `
            /* 提高脚本 UI 的 z-index，避免被九科星平台元素遮挡 */
            .ai-grade-btn, .ai-history-btn, .ai-settings-btn,
            .ai-toast, #ai-history-panel, #ai-grading-settings,
            .ai-modal-overlay, #correction-panel,
            #auto-submit-dialog, #asd-minimized-bar,
            #ai-stream-container, #ai-history-overlay {
                z-index: 2147483640 !important;
            }
        `;
        document.head.appendChild(style);
        console.log('[九科星] 已注入 z-index 修复样式');
    },
};

// 注册适配器
if (JiukexingAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = JiukexingAdapter;

    // 立即注入 z-index 修复样式
    const style = document.createElement('style');
    style.id = 'jiukexing-zindex-fix';
    style.textContent = `
        /* 提高脚本 UI 的 z-index，避免被九科星平台元素遮挡 */
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

    // 用 JS 强制修改内联样式，覆盖所有脚本 UI 元素
    const JIUKEXING_UI_SELECTORS = [
        '.ai-grade-btn', '.ai-history-btn', '.ai-settings-btn',
        '#ai-grading-settings', '#ai-history-panel', '#ai-history-overlay',
        '#ai-history-detail', '#ai-stream-panel', '#auto-submit-dialog',
        '#asd-minimized-bar', '#correction-panel', '.ai-modal-overlay',
        '.ai-toast', '#ai-update-dialog'
    ];

    const fixInlineZIndex = () => {
        document.querySelectorAll(JIUKEXING_UI_SELECTORS.join(', ')).forEach(el => {
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

    console.log('[九科星] 已注入 z-index 修复样式');
}
