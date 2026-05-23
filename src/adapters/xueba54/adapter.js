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

        // 策略1: 优先从 img 标签提取 base64（避免跨域问题）
        const base64Img = document.querySelector(XUEBA54_SELECTORS.BASE64_IMG);
        if (base64Img && base64Img.src && base64Img.src.startsWith('data:image')) {
            console.log('[54学霸] 从 img 标签获取 base64 图片');
            // 返回 data URL，核心层会处理
            return [base64Img.src];
        }

        // 策略2: 从 canvas 导出
        const canvas = document.querySelector(XUEBA54_SELECTORS.CANVAS);
        if (canvas) {
            try {
                const dataUrl = canvas.toDataURL('image/png');
                if (dataUrl && dataUrl.length > 1000) {
                    console.log('[54学霸] 从 canvas 导出图片成功');
                    return [dataUrl];
                }
            } catch (e) {
                console.warn('[54学霸] canvas 导出失败:', e.message);
            }
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
                return true;
            }
        }

        // 备选：查找所有按钮
        const allButtons = document.querySelectorAll('button');
        for (const btn of allButtons) {
            const text = (btn.textContent || '').trim();
            if (text === '立即提交') {
                btn.click();
                return true;
            }
        }

        console.warn('[54学霸] 未找到提交按钮');
        return false;
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
};

// 注册适配器
if (Xueba54Adapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = Xueba54Adapter;
}
