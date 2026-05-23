// ========== 54学霸阅卷适配器 ==========
// jQuery + layui 传统页面，答题卡使用 Canvas 渲染
// 支持多小题评分模式

const Xueba54Adapter = {
    name: '54学霸',
    id: 'xueba54',
    urlPatterns: ['*://54xueba.cn/*'],
    iconUrl: '',

    shouldInitialize() {
        return window.location.hostname.includes('54xueba.cn');
    },

    isMarkingPage() {
        return window.location.pathname.includes('marking.action');
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('[54学霸] 当前不在阅卷页面 (pathname:', window.location.pathname, ')');
            return false;
        }

        console.log('[54学霸] 开始检测批改页面...');
        try {
            const result = await Promise.race([
                waitForElement(XUEBA54_SELECTORS.PAGE_DETECT_CANVAS).then(() => 'canvas'),
                waitForElement(XUEBA54_SELECTORS.PAGE_DETECT_IMG).then(() => 'base64-img'),
                waitForElement(XUEBA54_SELECTORS.PAGE_DETECT_INPUT).then(() => 'score-input'),
            ]).catch(() => null);

            if (result) {
                console.log(`[54学霸] 检测到批改页面元素: ${result}`);
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 3000));
            const hasCanvas = document.querySelector(XUEBA54_SELECTORS.CANVAS);
            const hasImg = document.querySelector(XUEBA54_SELECTORS.BASE64_IMG);
            const hasInput = document.querySelector(XUEBA54_SELECTORS.SCORE_INPUT_PREFIX);
            const detected = !!(hasCanvas || hasImg) && !!hasInput;
            console.log(`[54学霸] 兜底检测 - Canvas/Img: ${!!(hasCanvas || hasImg)}, 输入框: ${!!hasInput}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('[54学霸] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // 使用页面 URL 和当前题目信息作为唯一标识
        const questionLabel = document.querySelector(XUEBA54_SELECTORS.QUESTION_LABEL_PREFIX);
        const labelText = questionLabel ? questionLabel.textContent.trim() : '';
        return `${window.location.href}#${labelText}`;
    },

    async gatherAnswerImages() {
        console.log('[54学霸] 开始获取答题卡图片...');

        const startTime = Date.now();
        const maxWait = 8000;
        const MIN_VALID_LENGTH = 5000; // 空白 canvas 的 dataURL 约 200-500 字节，真实图片 > 10KB

        // 轮询等待图片内容就绪（最多 8 秒）
        // 优先等待 img 标签（平台实际渲染的图片），canvas 可能为空白
        while (Date.now() - startTime < maxWait) {
            // 策略1（优先）: 从 img 标签提取 base64
            const base64Img = document.querySelector(XUEBA54_SELECTORS.BASE64_IMG);
            if (base64Img && base64Img.src && base64Img.src.startsWith('data:image')) {
                if (base64Img.src.length > MIN_VALID_LENGTH) {
                    console.log(`[54学霸] 从 img 标签获取有效 base64 图片 (${base64Img.src.length} bytes)`);
                    return [base64Img.src];
                }
            }

            // 策略2（备选）: 从 canvas 导出（仅在 img 不存在时尝试）
            if (!base64Img) {
                const canvas = document.querySelector(XUEBA54_SELECTORS.CANVAS);
                if (canvas) {
                    try {
                        const dataUrl = canvas.toDataURL('image/png');
                        if (dataUrl && dataUrl.length > MIN_VALID_LENGTH) {
                            console.log(`[54学霸] 从 canvas 导出有效图片 (${dataUrl.length} bytes)`);
                            return [dataUrl];
                        }
                    } catch (e) { /* 忽略 */ }
                }
            }

            const elapsed = Date.now() - startTime;
            console.log(`[54学霸] 图片内容尚未就绪，等待中... (${elapsed}ms)`);
            await new Promise(r => setTimeout(r, 300));
        }

        // 超时兜底: 返回能找到的任何内容（降低阈值）
        console.warn('[54学霸] 等待图片就绪超时，尝试返回已有内容...');
        const fallbackImg = document.querySelector(XUEBA54_SELECTORS.BASE64_IMG);
        if (fallbackImg?.src?.startsWith('data:image') && fallbackImg.src.length > 500) {
            console.log(`[54学霸] 超时兜底: 从 img 获取 (${fallbackImg.src.length} bytes)`);
            return [fallbackImg.src];
        }

        const fallbackCanvas = document.querySelector(XUEBA54_SELECTORS.CANVAS);
        if (fallbackCanvas) {
            try {
                const dataUrl = fallbackCanvas.toDataURL('image/png');
                if (dataUrl && dataUrl.length > 500) {
                    console.log(`[54学霸] 超时兜底: 从 canvas 获取 (${dataUrl.length} bytes)`);
                    return [dataUrl];
                }
            } catch (e) { /* 忽略 */ }
        }

        console.warn('[54学霸] 未找到答题卡图片');
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
        let index = 0;

        // 遍历所有可能的小题输入框
        while (true) {
            const input = document.querySelector(XUEBA54_SELECTORS.SCORE_INPUT_BY_INDEX(index));
            if (!input) break;

            // 获取满分
            const maxScoreInput = document.querySelector(XUEBA54_SELECTORS.MAX_SCORE_BY_INDEX(index));
            const maxScore = maxScoreInput ? parseInt(maxScoreInput.value) || 0 : 0;

            // 获取小题标签
            const labelEl = document.querySelector(XUEBA54_SELECTORS.QUESTION_LABEL_BY_INDEX(index));
            const label = labelEl ? labelEl.textContent.trim() : `第${index + 1}题`;

            inputs.push({
                element: input,
                label: label,
                index: index,
                maxScore: maxScore
            });

            index++;
        }

        console.log(`[54学霸] 找到 ${inputs.length} 个分数输入框`);
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

            // 触发事件（layui 需要）
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));

            // 尝试调用平台的 onchange 处理函数
            if (typeof input.onchange === 'function') {
                try {
                    input.onchange.call(input);
                } catch (e) {
                    // 忽略
                }
            }

            successCount++;
        }

        return successCount > 0;
    },

    submitGrade() {
        // 查找"立即提交"按钮
        const buttons = document.querySelectorAll(XUEBA54_SELECTORS.SUBMIT_BUTTON);
        for (const btn of buttons) {
            const text = (btn.textContent || '').trim();
            if (text.includes('立即提交') || text.includes('提交')) {
                btn.click();
                // 自动点击确认弹窗
                this._autoConfirmDialog();
                return true;
            }
        }

        // 备选：查找所有按钮
        const allButtons = document.querySelectorAll('button');
        for (const btn of allButtons) {
            const text = (btn.textContent || '').trim();
            if (text === '立即提交') {
                btn.click();
                // 自动点击确认弹窗
                this._autoConfirmDialog();
                return true;
            }
        }

        console.warn('[54学霸] 未找到提交按钮');
        return false;
    },

    // 自动点击确认弹窗（layui-layer）
    _autoConfirmDialog() {
        const maxAttempts = 30; // 最多检测 30 次（6秒）
        let attempts = 0;

        const checkDialog = setInterval(() => {
            attempts++;

            // 查找 layui-layer 弹窗中的"确认"按钮
            const confirmBtns = document.querySelectorAll('.layui-layer-btn0, .layui-layer-btn .layui-layer-btn0');
            for (const btn of confirmBtns) {
                const text = (btn.textContent || '').trim();
                if (text === '确认' || text === '确定') {
                    console.log('[54学霸] 自动点击确认按钮');
                    btn.click();
                    clearInterval(checkDialog);
                    return;
                }
            }

            // 备选：查找包含"确认"文字的按钮
            const allBtns = document.querySelectorAll('.layui-layer-btn a, .layui-layer button');
            for (const btn of allBtns) {
                const text = (btn.textContent || '').trim();
                if (text === '确认' || text === '确定') {
                    console.log('[54学霸] 自动点击确认按钮');
                    btn.click();
                    clearInterval(checkDialog);
                    return;
                }
            }

            if (attempts >= maxAttempts) {
                clearInterval(checkDialog);
            }
        }, 200);
    },

    async waitForNextPaper(oldImageUrl) {
        let checkTimes = 0;
        const maxChecks = 50;

        return new Promise((resolve) => {
            const timer = setInterval(() => {
                checkTimes++;

                // 检查图片是否变化
                const base64Img = document.querySelector(XUEBA54_SELECTORS.BASE64_IMG);
                const canvas = document.querySelector(XUEBA54_SELECTORS.CANVAS);

                let currentUrl = null;
                if (base64Img && base64Img.src) {
                    currentUrl = base64Img.src;
                } else if (canvas) {
                    try {
                        currentUrl = canvas.toDataURL('image/png');
                    } catch (e) {
                        // 忽略
                    }
                }

                // 检查分数输入框是否已清空
                const firstInput = document.querySelector(XUEBA54_SELECTORS.SCORE_INPUT_BY_INDEX(0));
                const inputCleared = firstInput && (firstInput.value === '' || firstInput.value === '0');

                if (oldImageUrl && currentUrl && currentUrl !== oldImageUrl) {
                    clearInterval(timer);
                    console.log('[54学霸] 检测到图片变化');
                    resolve(true);
                } else if (inputCleared && checkTimes > 3) {
                    clearInterval(timer);
                    console.log('[54学霸] 检测到输入框已清空');
                    resolve(true);
                } else if (checkTimes > maxChecks) {
                    clearInterval(timer);
                    console.warn('[54学霸] 等待下一份答卷超时');
                    resolve(false);
                }
            }, 200);
        });
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

    // 页面加载后设置 z-index，解决 layui-layer 遮挡问题
    onPageLoad() {
        const style = document.createElement('style');
        style.id = 'xueba54-zindex-fix';
        style.textContent = `
            /* 提高脚本 UI 的 z-index，避免被 layui-layer 遮挡 */
            .ai-grade-btn, .ai-history-btn, .ai-settings-btn,
            .ai-toast, #ai-history-panel, #ai-grading-settings,
            .ai-modal-overlay, #correction-panel,
            #auto-submit-dialog, #asd-minimized-bar,
            #ai-stream-container, #ai-history-overlay {
                z-index: 19999999 !important;
            }
        `;
        document.head.appendChild(style);
        console.log('[54学霸] 已注入 z-index 修复样式');
    },
};

// 注册适配器
if (Xueba54Adapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = Xueba54Adapter;

    // 立即注入 z-index 修复样式（覆盖 ID 选择器元素）
    const style = document.createElement('style');
    style.id = 'xueba54-zindex-fix';
    style.textContent = `
        /* 提高脚本 UI 的 z-index，避免被 54学霸 平台元素遮挡 */
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

    // 核心模块通过内联样式设置按钮 z-index，CSS !important 无法覆盖
    // 需要等待 UI 创建后，用 JS 强制修改内联样式
    const fixInlineZIndex = () => {
        document.querySelectorAll('.ai-grade-btn, .ai-history-btn, .ai-settings-btn').forEach(el => {
            el.style.setProperty('z-index', '2147483640', 'important');
        });
    };
    // 多次尝试，确保覆盖
    setTimeout(fixInlineZIndex, 3000);
    setTimeout(fixInlineZIndex, 5000);
    setTimeout(fixInlineZIndex, 8000);

    console.log('[54学霸] 已注入 z-index 修复样式');
}
