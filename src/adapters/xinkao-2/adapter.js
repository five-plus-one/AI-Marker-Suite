// ========== 鑫考(内网版) 适配器 ==========
// /biluo/display.jsp — jQuery 传统页面，内网裸 IP 部署
// 与现有 xinkao (/Marking/DisPlay) 是两套完全不同的系统：
//   满分在 input.fenshu 的 fen 属性、提交走 inputkey(']')（键盘确认流）
// 提交按钮 onclick="inputkey(']')"，与云阅卷(yunyuejuan)同源
// inputkey(']') 行为：校验当前分数 ≤ fen → 若当前是最后一个 fenshu 则点 #submit 提交，否则焦点移下一题

const Xinkao2Adapter = {
    name: '鑫考(内网)',
    id: 'xinkao-2',
    urlPatterns: ['*://*/biluo/*'],
    iconUrl: '',

    shouldInitialize() {
        // 内网裸 IP，不硬编码 hostname，靠路径 + DOM 特征识别（防串台）
        const path = window.location.pathname || '';
        if (/\/biluo\/display/i.test(path)) return true;
        return !!(document.querySelector(XINKAO2_SELECTORS.ANSWER_IMAGE_CLASS)
            && document.querySelector(XINKAO2_SELECTORS.SCORE_INPUTS));
    },

    isMarkingPage() {
        return !!(document.querySelector(XINKAO2_SELECTORS.ANSWER_IMAGE)
            || document.querySelector(XINKAO2_SELECTORS.SUBMIT_BUTTON));
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('🔎 [鑫考内网] 当前不在阅卷页面 (path:', window.location.pathname, ')');
            return false;
        }
        console.log('🔎 [鑫考内网] 开始检测批改页面...');
        try {
            const result = await Promise.race([
                waitForElement(XINKAO2_SELECTORS.PAGE_DETECT_IMAGE, 8000).then(() => 'answer-image'),
                waitForElement(XINKAO2_SELECTORS.PAGE_DETECT_INPUT, 8000).then(() => 'score-input'),
                waitForElement(XINKAO2_SELECTORS.PAGE_DETECT_SUBMIT, 8000).then(() => 'submit-btn'),
            ]).catch(() => null);

            if (result) {
                console.log(`✅ [鑫考内网] 检测到批改页面元素: ${result}`);
                return true;
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
            const hasImage = document.querySelector(XINKAO2_SELECTORS.ANSWER_IMAGE);
            const hasInput = document.querySelector(XINKAO2_SELECTORS.SCORE_INPUTS);
            const hasBtn = document.querySelector(XINKAO2_SELECTORS.SUBMIT_BUTTON);
            const detected = !!(hasImage && hasInput && hasBtn);
            console.log(`🔎 [鑫考内网] 兜底检测 — 图片: ${!!hasImage}, 输入框: ${!!hasInput}, 提交: ${!!hasBtn}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [鑫考内网] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // URL query: title/examsub/examtea/teaid/teaname/scores
        // 用考试级+题目标识（examsub/examtea/teaid/teaname），不含 title/scores/图片 token
        // teaname 与页面 #btag{i} 对应（题号），换题时变化，换学生时不变
        try {
            const params = new URLSearchParams(window.location.search);
            const sub = params.get('examsub') || '';
            const tea = params.get('examtea') || '';
            const tid = params.get('teaid') || '';
            const tname = params.get('teaname') || '';
            if (sub || tea || tid || tname) {
                return `xinkao2_${sub}_${tea}_${tid}_${tname}`;
            }
        } catch (e) { /* ignore */ }
        return window.location.pathname + window.location.search;
    },

    async gatherAnswerImages() {
        // 换卷时 src 的 p= token 变化，等 naturalWidth>0 避免抓到未加载图
        for (let i = 0; i < 12; i++) {
            const img = document.querySelector(XINKAO2_SELECTORS.ANSWER_IMAGE);
            if (img && img.src && img.naturalWidth > 0) {
                console.log(`🖼️ [鑫考内网] 找到答题卡 1 张`);
                return [...new Set([img.src])];
            }
            await new Promise(r => setTimeout(r, 250));
        }
        // 兜底：不要求 naturalWidth
        const fallback = document.querySelector(XINKAO2_SELECTORS.ANSWER_IMAGE);
        if (fallback && fallback.src) {
            console.log(`🖼️ [鑫考内网] 兜底取图`);
            return [fallback.src];
        }
        console.warn('⚠️ [鑫考内网] 未找到答题卡图片');
        return [];
    },

    async fetchImageAsBase64(url) {
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];
        const fenEls = document.querySelectorAll(XINKAO2_SELECTORS.SCORE_INPUTS);

        fenEls.forEach((inputEl, i) => {
            // label 取同题号的 #btag{i}（与 fenshu{i} 对应），兜底取同单元格 label
            let labelEl = document.querySelector(`#btag${i}`);
            if (!labelEl) {
                const row = inputEl.closest('tr');
                labelEl = row ? row.querySelector('label') : null;
            }
            const label = labelEl ? labelEl.textContent.trim() : `第${i + 1}题`;

            // 满分从 fen 属性提取（如 fen="12"），兼容小数
            let maxScore = 0;
            const fenAttr = inputEl.getAttribute('fen') || '';
            const m = fenAttr.match(/(\d+(?:\.\d+)?)/);
            if (m) maxScore = parseFloat(m[1]);

            inputs.push({ element: inputEl, label, index: i, maxScore });
        });

        // 附加分 #fjf（默认隐藏，可见时才计入评分单元）
        const bonus = document.querySelector(XINKAO2_SELECTORS.BONUS_INPUT);
        const bonusBox = document.querySelector(XINKAO2_SELECTORS.BONUS_BOX);
        if (bonus && bonusBox && bonusBox.style.display !== 'none') {
            inputs.push({ element: bonus, label: '附加分', index: inputs.length, maxScore: 0 });
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
            console.log(`✅ [鑫考内网] ${inputs[i].label} 分数 ${scores[i]} 已填入`);
        }
        return successCount > 0;
    },

    submitGrade() {
        // 先 focus 最后一个分数输入框，触发平台 focus 处理设置全局 o
        // inputkey(']') 内部用 var obj=o 读当前输入，o 未设置时会失败
        const fenEls = document.querySelectorAll(XINKAO2_SELECTORS.SCORE_INPUTS);
        const lastInput = fenEls[fenEls.length - 1];
        if (lastInput) {
            try { lastInput.focus(); } catch (e) { /* ignore */ }
        }

        // 优先调用平台 inputkey(']')（与回车确认同路径，含分数校验与逐题确认）
        try {
            const pageWindow = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
            if (typeof pageWindow.inputkey === 'function') {
                console.log('📤 [鑫考内网] 调用 inputkey("]") 提交');
                pageWindow.inputkey(']');
                return true;
            }
        } catch (e) {
            console.warn('⚠️ [鑫考内网] inputkey 调用失败:', e.message);
        }

        // 兜底：点击提交按钮（onclick="inputkey(']')" 在页面上下文执行）
        const submitBtn = document.querySelector(XINKAO2_SELECTORS.SUBMIT_BUTTON);
        if (submitBtn) {
            console.log('📤 [鑫考内网] 点击 #submitbtn 提交');
            submitBtn.click();
            return true;
        }
        console.warn('⚠️ [鑫考内网] 未找到提交按钮');
        return false;
    },

    async waitForNextPaper(oldImageUrl) {
        const oldToken = oldImageUrl ? this._imgToken(oldImageUrl) : (this._currentImgToken() || '');
        const oldUrl = window.location.href;
        let checkTimes = 0;

        return new Promise((resolve) => {
            const timer = setInterval(() => {
                checkTimes++;

                // 信号1：图片 p= token 变化（换卷）
                const curToken = this._currentImgToken();
                if (oldToken && curToken && curToken !== oldToken) {
                    const img = document.querySelector(XINKAO2_SELECTORS.ANSWER_IMAGE);
                    if (img && img.naturalWidth > 0) {
                        clearInterval(timer);
                        console.log('✅ [鑫考内网] 新试卷已加载（图片 token 变化）');
                        resolve(true);
                        return;
                    }
                }

                // 信号2：URL 变化（换题/换卷）
                if (window.location.href !== oldUrl && checkTimes > 2) {
                    clearInterval(timer);
                    console.log('✅ [鑫考内网] 新试卷已加载（URL 变化）');
                    resolve(true);
                    return;
                }

                // 信号3：输入框被清空（提交后平台会清空）
                const input = document.querySelector(XINKAO2_SELECTORS.SCORE_INPUTS);
                if (input && input.value === '' && checkTimes > 3) {
                    clearInterval(timer);
                    console.log('✅ [鑫考内网] 新试卷已加载（输入框清空）');
                    resolve(true);
                    return;
                }

                if (checkTimes > 125) {  // 25秒（125 × 200ms），对齐其他适配器
                    clearInterval(timer);
                    console.warn('⚠️ [鑫考内网] 等待下一份试卷超时');
                    resolve(false);
                }
            }, 200);
        });
    },

    _imgToken(url) {
        try {
            return new URL(url, location.href).searchParams.get('p') || '';
        } catch (e) {
            return '';
        }
    },

    _currentImgToken() {
        const img = document.querySelector(XINKAO2_SELECTORS.ANSWER_IMAGE);
        return img ? this._imgToken(img.src) : '';
    },

    isRegradeMode() {
        // 暂不支持回评模式识别（页面存在回评入口 #caidan2，但回评态检测待验证）
        return false;
    },
};

// 注册适配器
if (Xinkao2Adapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = Xinkao2Adapter;
}
