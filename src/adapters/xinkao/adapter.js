// ========== 鑫考网上阅卷适配器 ==========
// 支持动态 IP 地址部署，通过 DOM 特征检测平台

const XinkaoAdapter = {
    name: '鑫考网上阅卷',
    id: 'xinkao',
    urlPatterns: ['*://*/Marking/DisPlay*'],
    iconUrl: '',

    shouldInitialize() {
        // 路径精确锚（IP 不固定，不能硬编码 hostname；路径即本系统专有锚）
        const pathname = window.location.pathname || '';
        if (/\/Marking\/DisPlay/i.test(pathname)) {
            return true;
        }

        // DOM 兜底（strict-a 附 A.1）：满分在 max/data-max 属性是 xinkao 专有判别
        // （与 adapter 读取同源），且排他两家兄弟属性——家族共享 img.teaimg+input.fenshu
        // 不得单独作为命中证据（strict-b S15 互串教训）
        return !!(document.querySelector('img.teaimg')
            && document.querySelector('input.fenshu[max], input.fenshu[data-max]')
            && !document.querySelector('input.fenshu[fen]')
            && !document.querySelector('input.fenshu[data-score]'));
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器
    isMarkingPage() {
        return /\/Marking\/DisPlay/i.test(window.location.pathname);
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('[鑫考] 当前不在阅卷页面 (pathname:', window.location.pathname, ')');
            return false;
        }

        console.log('[鑫考] 开始检测批改页面...');
        try {
            const result = await Promise.race([
                waitForElement(XINKAO_SELECTORS.PAGE_DETECT_IMAGE).then(() => 'answer-image'),
                waitForElement(XINKAO_SELECTORS.PAGE_DETECT_INPUT).then(() => 'score-input'),
                waitForElement(XINKAO_SELECTORS.PAGE_DETECT_SUBMIT).then(() => 'submit-btn'),
            ]).catch(() => null);

            if (result) {
                console.log(`[鑫考] 检测到批改页面元素: ${result}`);
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 3000));
            const hasImage = document.querySelector(XINKAO_SELECTORS.ANSWER_IMAGE);
            const hasInput = document.querySelector(XINKAO_SELECTORS.SCORE_INPUT);
            const hasBtn = document.querySelector(XINKAO_SELECTORS.SUBMIT_BUTTON);
            const detected = !!(hasImage && hasInput && hasBtn);
            console.log(`[鑫考] 兜底检测 - 图片: ${!!hasImage}, 输入框: ${!!hasInput}, 提交: ${!!hasBtn}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('[鑫考] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // 完整 URL 作为唯一标识（query 参数即为 token）
        return window.location.href;
    },

    async gatherAnswerImages() {
        await new Promise(r => setTimeout(r, 1000));
        const images = document.querySelectorAll(XINKAO_SELECTORS.ANSWER_IMAGE);
        const urls = [];
        images.forEach(img => {
            const src = img.src;
            if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
                urls.push(src);
            }
        });
        console.log(`[鑫考] 找到答题卡图片: ${urls.length} 张`);
        return urls;
    },

    async fetchImageAsBase64(url) {
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];
        const mainInput = document.querySelector(XINKAO_SELECTORS.SCORE_INPUT);
        if (mainInput) {
            // 尝试从 DOM 检测满分
            const maxScore = parseInt(mainInput.getAttribute('max'))
                || parseInt(mainInput.getAttribute('data-max'))
                || parseInt(mainInput.placeholder?.match(/\d+/)?.[0])
                || 0;
            inputs.push({ element: mainInput, label: '总分', index: 0, maxScore });
        }

        // 检查其他可见的分数输入框（如附加分 #fjf）
        const allScoreInputs = document.querySelectorAll(XINKAO_SELECTORS.SCORE_INPUT_CLASS);
        allScoreInputs.forEach((input, i) => {
            if (input !== mainInput && input.offsetParent !== null) {
                const maxScore = parseInt(input.getAttribute('max'))
                    || parseInt(input.getAttribute('data-max'))
                    || 0;
                const label = input.id === 'fjf' ? '附加分' : `分数${i + 1}`;
                inputs.push({ element: input, label, index: inputs.length, maxScore });
            }
        });

        return inputs;
    },

    fillScores(scores) {
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) return false;

        // 数据安全：两遍式全或无（#296，模板=guangda #275）——先全量校验，
        // 任一缺失/错位即整体拒绝，全部命中才写入，不留半填状态
        if (scores.length > inputs.length) {
            console.warn(`⚠️ [鑫考] 分数个数(${scores.length})多于输入框数(${inputs.length})（配置错位）→ 拒绝`);
            return false;
        }
        for (let i = 0; i < inputs.length; i++) {
            if (scores[i] === null || scores[i] === undefined) {
                console.warn(`⚠️ [鑫考] ${inputs[i].label} 无 AI 分数（第 ${i + 1} 题缺失）→ 拒绝`);
                return false;
            }
        }

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        for (let i = 0; i < inputs.length; i++) {
            setter.call(inputs[i].element, scores[i]);
            inputs[i].element.dispatchEvent(new Event('input', { bubbles: true }));
            inputs[i].element.dispatchEvent(new Event('change', { bubbles: true }));
            inputs[i].element.dispatchEvent(new Event('blur', { bubbles: true }));
        }
        return true;
    },

    fillScore(request) {
        const { total, subScores } = request;
        const scoreInput = document.querySelector(XINKAO_SELECTORS.SCORE_INPUT);
        if (scoreInput) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(scoreInput, total);
            scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
            scoreInput.dispatchEvent(new Event('change', { bubbles: true }));
            scoreInput.dispatchEvent(new Event('blur', { bubbles: true }));
            return true;
        }
        return false;
    },

    submitGrade() {
        const submitBtn = document.querySelector(XINKAO_SELECTORS.SUBMIT_BUTTON);
        if (submitBtn) {
            submitBtn.click();
            return true;
        }

        // 备选：查找包含"提交"文字的按钮
        const allButtons = document.querySelectorAll('input[type="submit"], button, input[type="button"]');
        for (const btn of allButtons) {
            if (btn.value?.includes('提交') || btn.textContent?.includes('提交')) {
                btn.click();
                return true;
            }
        }

        console.warn('[鑫考] 未找到提交按钮');
        return false;
    },

    async waitForNextPaper(oldImageUrl) {
        let checkTimes = 0;
        return new Promise((resolve) => {
            const timer = setInterval(() => {
                checkTimes++;
                const currentImg = document.querySelector(XINKAO_SELECTORS.ANSWER_IMAGE);
                const currentUrl = currentImg ? currentImg.src : null;
                const input = document.querySelector(XINKAO_SELECTORS.SCORE_INPUT);
                // 仅真清空算空：'0' 是合法分值，0 分卷不能误判翻卷（#285）
                const inputCleared = input && String(input.value).trim() === '';

                if (oldImageUrl && currentUrl && currentUrl !== oldImageUrl) {
                    clearInterval(timer);
                    resolve(true);
                } else if (inputCleared && checkTimes > 3) {
                    clearInterval(timer);
                    resolve(true);
                } else if (checkTimes > 125) {  // 25秒（125 × 200ms），对齐其他适配器
                    clearInterval(timer);
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

// 注册守卫（#324 教训 + strict-a 附 A.0）：自查 shouldInitialize → 先到先得（不覆盖）→
// 已注册且我也认领本页 = 多命中冲突，console.error 红灯告警（静默劫持变可见）→ 异常 fail-closed
(function registerXinkaoAdapter() {
    try {
        if (!XinkaoAdapter.shouldInitialize()) return;
        const existing = window.__AI_MARKER_ADAPTER__;
        if (existing) {
            console.error(`🚫 [注册冲突] ${existing.name} 已注册，但 鑫考网上阅卷(xinkao) 也认领本页（疑似串台/劫持），保留先到者`);
            return;
        }
        window.__AI_MARKER_ADAPTER__ = XinkaoAdapter;
    } catch (e) {
        console.warn('⚠️ [注册] 判定异常，fail-closed 不注册:', e);
    }
})();
