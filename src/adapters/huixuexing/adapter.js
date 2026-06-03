// ========== 慧学星适配器 ==========
// www.hxxai.com — jQuery 传统页面，分步骤评分模式
// 图片使用 OSS 托管（oss.hxxai.com / oss.jkydata.com），带裁剪参数
// 评分方式：分步骤输入框（readonly）+ 满分/零分按钮

const HuiXuexingAdapter = {
    name: '慧学星',
    id: 'huixuexing',
    urlPatterns: ['*://www.hxxai.com/*'],
    iconUrl: '',

    shouldInitialize() {
        return window.location.hostname.includes('www.hxxai.com');
    },

    isMarkingPage() {
        const url = window.location.href;
        return url.includes('/readpaper/') || url.includes('/center');
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('[慧学星] 当前不在阅卷页面 (url:', window.location.href, ')');
            return false;
        }

        console.log('[慧学星] 开始检测批改页面...');
        try {
            const result = await Promise.race([
                waitForElement(HUIXUEXING_SELECTORS.PAGE_DETECT_STEP_INPUT, 5000).then(() => 'step-input'),
                waitForElement(HUIXUEXING_SELECTORS.PAGE_DETECT_INPUT, 5000).then(() => 'score-input'),
                waitForElement(HUIXUEXING_SELECTORS.PAGE_DETECT_IMAGE, 5000).then(() => 'answer-image'),
            ]).catch(() => null);

            if (result) {
                console.log(`[慧学星] 检测到批改页面元素: ${result}`);
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 3000));
            const hasStepInput = document.querySelector(HUIXUEXING_SELECTORS.STEP_INPUT_BY_INDEX(0));
            const hasScoreInput = document.querySelector(HUIXUEXING_SELECTORS.SCORE_INPUT);
            const hasImage = document.querySelector(HUIXUEXING_SELECTORS.ANSWER_IMAGE);
            const detected = !!(hasStepInput || hasScoreInput) && !!hasImage;
            console.log(`[慧学星] 兜底检测 — 步骤输入框: ${!!hasStepInput}, 总分框: ${!!hasScoreInput}, 图片: ${!!hasImage}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('[慧学星] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // 从 URL 提取唯一标识：examId + uniqueId + examPaperId
        const params = new URLSearchParams(window.location.search);
        const examId = params.get('examId') || '';
        const uniqueId = params.get('uniqueId') || '';
        const examPaperId = params.get('examPaperId') || '';
        if (examId || uniqueId || examPaperId) {
            return `hxxai_${examId}_${uniqueId}_${examPaperId}`;
        }
        return window.location.href;
    },

    async gatherAnswerImages() {
        console.log('[慧学星] 开始获取答题卡图片...');

        const startTime = Date.now();
        const maxWait = 8000; // 最长等待 8 秒
        const pollInterval = 300; // 轮询间隔 300ms

        while (Date.now() - startTime < maxWait) {
            // 策略1: 通过 OSS 域名匹配
            let imgs = document.querySelectorAll(HUIXUEXING_SELECTORS.ANSWER_IMAGE);

            // 策略2: 兜底 - 通过 DOM 结构匹配
            if (imgs.length === 0) {
                imgs = document.querySelectorAll(HUIXUEXING_SELECTORS.ANSWER_IMAGE_BY_STRUCTURE);
            }

            if (imgs.length > 0) {
                // 等待所有图片解码完成
                const validUrls = [];
                for (const img of imgs) {
                    if (!img.src) continue;
                    try {
                        // img.decode() 确保图片已完全解码
                        await img.decode();
                        validUrls.push(img.src);
                        console.log(`[慧学星] 图片已解码: ${img.src.substring(0, 80)}...`);
                    } catch (e) {
                        // decode 失败（图片加载失败或无效）
                        console.warn('[慧学星] 图片解码失败:', img.src.substring(0, 50));
                    }
                }

                if (validUrls.length > 0) {
                    console.log(`[慧学星] 找到 ${validUrls.length} 张答题卡图片`);
                    return validUrls;
                }
            }

            // 等待后重试
            await new Promise(r => setTimeout(r, pollInterval));
        }

        // 超时兜底：降低要求，使用 naturalWidth > 0 检查
        console.warn('[慧学星] 轮询超时，尝试降级获取...');
        let fallbackImgs = document.querySelectorAll(HUIXUEXING_SELECTORS.ANSWER_IMAGE);
        if (fallbackImgs.length === 0) {
            fallbackImgs = document.querySelectorAll(HUIXUEXING_SELECTORS.ANSWER_IMAGE_BY_STRUCTURE);
        }

        const fallbackUrls = [];
        fallbackImgs.forEach(img => {
            // 降级条件：只检查 src 存在且 naturalWidth > 0（不要求 > 100）
            if (img.src && img.naturalWidth > 0) {
                fallbackUrls.push(img.src);
            }
        });

        if (fallbackUrls.length === 0) {
            console.warn('[慧学星] 未找到答题卡图片');
        } else {
            console.log(`[慧学星] 降级获取到 ${fallbackUrls.length} 张答题卡图片`);
        }

        return fallbackUrls;
    },

    async fetchImageAsBase64(url) {
        // OSS 图片使用通用下载方法
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];

        // 遍历步骤输入框
        for (let i = 0; i < 10; i++) {
            const input = document.querySelector(HUIXUEXING_SELECTORS.STEP_INPUT_BY_INDEX(i));
            if (!input) break;

            // 从 placeholder 提取满分范围（如 "0-6" → maxScore: 6）
            const placeholder = input.placeholder || '';
            const rangeMatch = placeholder.match(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
            const maxScore = rangeMatch ? parseFloat(rangeMatch[2]) : 0;

            // 从父容器 .step-li 提取步骤标签
            const stepLi = input.closest('.step-li');
            const nameEl = stepLi ? stepLi.querySelector('.name') : null;
            const label = nameEl ? nameEl.textContent.trim() : `步骤${i + 1}`;

            inputs.push({
                element: input,
                label: label,
                index: i,
                maxScore: maxScore,
            });
        }

        // 如果没有步骤输入框，尝试总分输入框（单题模式）
        if (inputs.length === 0) {
            const scoreInput = document.querySelector(HUIXUEXING_SELECTORS.SCORE_INPUT);
            if (scoreInput) {
                const placeholder = scoreInput.placeholder || '';
                const rangeMatch = placeholder.match(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
                const maxScore = rangeMatch ? parseFloat(rangeMatch[2]) : 0;
                inputs.push({
                    element: scoreInput,
                    label: '总分',
                    index: 0,
                    maxScore: maxScore,
                });
            }
        }

        console.log(`[慧学星] 找到 ${inputs.length} 个分数输入框`);
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

            // 尝试通过 value setter 设置分数（绕过 readonly）
            setter.call(input, score);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));

            // 验证值是否已设置
            if (parseFloat(input.value) === score) {
                successCount++;
                console.log(`[慧学星] ${inputs[i].label} 分数 ${score} 已填入（直接设置）`);
            } else {
                // Fallback：尝试点击满分/零分按钮
                if (score === 0) {
                    if (this._clickStepButton(i, 'zero')) {
                        successCount++;
                        console.log(`[慧学星] ${inputs[i].label} 零分（点击按钮）`);
                    }
                } else if (score === inputs[i].maxScore) {
                    if (this._clickStepButton(i, 'full')) {
                        successCount++;
                        console.log(`[慧学星] ${inputs[i].label} 满分 ${score}（点击按钮）`);
                    }
                } else {
                    // 中间分值：尝试点击 #scoreBtns 中的分数按钮
                    if (this._clickScoreButton(i, score)) {
                        successCount++;
                        console.log(`[慧学星] ${inputs[i].label} 分数 ${score}（点击分数按钮）`);
                    } else {
                        console.warn(`[慧学星] ${inputs[i].label} 无法设置中间分值 ${score}`);
                    }
                }
            }
        }

        return successCount > 0;
    },

    // 点击步骤的满分/零分按钮
    _clickStepButton(stepIndex, type) {
        const stepLis = document.querySelectorAll(HUIXUEXING_SELECTORS.STEP_LI);
        if (stepIndex >= stepLis.length) return false;

        const stepLi = stepLis[stepIndex];
        const btnSelector = type === 'full' ? '.btn-green-o' : '.btn-red-o';
        const btn = stepLi.querySelector(btnSelector);
        if (btn) {
            btn.click();
            return true;
        }
        return false;
    },

    // 点击 #scoreBtns 区域中的分数按钮
    _clickScoreButton(stepIndex, score) {
        const scoreBtns = document.querySelectorAll(HUIXUEXING_SELECTORS.SCORE_BTNS_ITEM);
        for (const btn of scoreBtns) {
            const btnScore = parseFloat(btn.textContent.trim());
            if (btnScore === score) {
                btn.click();
                return true;
            }
        }
        return false;
    },

    submitGrade() {
        // 查找"提交分数"按钮
        const submitBtn = document.querySelector(HUIXUEXING_SELECTORS.SUBMIT_BUTTON);
        if (submitBtn) {
            console.log('[慧学星] 点击提交分数按钮');
            submitBtn.click();
            // 处理可能的确认弹窗
            this._handleConfirmDialog();
            return true;
        }

        // 备选：查找所有包含"提交分数"文字的按钮
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            const text = (btn.textContent || '').trim();
            if (text.includes('提交分数') || text === '提交') {
                console.log('[慧学星] 点击提交按钮（文字匹配）');
                btn.click();
                this._handleConfirmDialog();
                return true;
            }
        }

        console.warn('[慧学星] 未找到提交按钮');
        return false;
    },

    // 处理确认弹窗
    _handleConfirmDialog() {
        let checkCount = 0;
        const checkInterval = setInterval(() => {
            checkCount++;

            // 查找弹窗中的确认/确定按钮
            const confirmBtns = document.querySelectorAll('.alert-btns .btn, .modal .btn, .dialog .btn');
            for (const btn of confirmBtns) {
                const text = (btn.textContent || '').trim();
                if (text === '确认' || text === '确定' || text === '提交') {
                    console.log('[慧学星] 自动点击确认按钮');
                    btn.click();
                    clearInterval(checkInterval);
                    return;
                }
            }

            // 超时（最多等 3 秒）
            if (checkCount >= 15) {
                clearInterval(checkInterval);
            }
        }, 200);
    },

    async waitForNextPaper(oldImageUrl) {
        console.log('[慧学星] 等待下一份答卷...');
        const startTime = Date.now();
        const maxWait = 30000;

        return new Promise((resolve) => {
            const timer = setInterval(() => {
                // 检查图片是否变化
                const currentImg = document.querySelector(HUIXUEXING_SELECTORS.ANSWER_IMAGE);
                const currentUrl = currentImg ? currentImg.src : null;

                // 检查步骤输入框是否已清空
                const firstInput = document.querySelector(HUIXUEXING_SELECTORS.STEP_INPUT_BY_INDEX(0));
                const scoreInput = document.querySelector(HUIXUEXING_SELECTORS.SCORE_INPUT);
                const inputCleared = (firstInput && (firstInput.value === '' || firstInput.value === '0')) ||
                                     (scoreInput && (scoreInput.value === '' || scoreInput.value === '0'));

                if (oldImageUrl && currentUrl && currentUrl !== oldImageUrl) {
                    clearInterval(timer);
                    console.log('[慧学星] 新答卷已加载（图片变化）');
                    resolve(true);
                } else if (inputCleared && (Date.now() - startTime > 1000)) {
                    clearInterval(timer);
                    console.log('[慧学星] 新答卷已加载（输入框清空）');
                    resolve(true);
                } else if (Date.now() - startTime > maxWait) {
                    clearInterval(timer);
                    console.warn('[慧学星] 等待下一份答卷超时');
                    resolve(false);
                }
            }, 300);
        });
    },

    isRegradeMode() {
        // 检查页面文本中是否包含"回评"
        const bodyText = document.body.innerText || '';
        if (bodyText.includes('回评') || bodyText.includes('复核')) {
            return true;
        }
        return false;
    },

    detectSubQuestions() {
        return [];
    },

    onPageLoad() {
        console.log('[慧学星] 页面加载完成');
    },

    onGradingComplete() {
        console.log('[慧学星] 本轮批改完成');
    },
};

// 注册适配器
if (HuiXuexingAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = HuiXuexingAdapter;
}
