// ========== 鑫考校园 6.0 适配器 ==========
// /Marking/NormalReadPaper — jQuery 传统页面，内网裸 IP:端口部署
// 与 xinkao-2（/biluo/display.jsp）、yunyuejuan 同属「云阅卷」代码家族，但各有一套本地补丁：
//   - 满分存 data-score 属性（xinkao-2 是 fen 属性）
//   - 提交走 inputkey(']')，多小题逐个确认，最后一个小题时调 submit() 交卷，submit() 内部会 get_paper() 自动换卷
//   - 小题标签取所在 <tr> 第一列文字（如 "13-17(+12)"），不是 #btag{i}
//   - 任务标识靠全局变量 subId + teaCode（换题变、换学生不变）
//   - 换卷信号：img.teaimg 的 src 中 examcode/picName/path token 变化

const XinkaoCampusAdapter = {
    name: '鑫考校园',
    id: 'xinkao-campus',
    urlPatterns: ['*://*/Marking/NormalReadPaper*'],
    iconUrl: '',

    shouldInitialize() {
        // 内网裸 IP:端口部署，不硬编码 hostname，靠路径 + DOM 特征识别（防串台）
        const path = window.location.pathname || '';
        if (/\/Marking\/NormalReadPaper/i.test(path)) return true;
        return !!(document.querySelector(XINKAO_CAMPUS_SELECTORS.ANSWER_IMAGE)
            && document.querySelector(XINKAO_CAMPUS_SELECTORS.SCORE_INPUTS));
    },

    isMarkingPage() {
        return /\/Marking\/NormalReadPaper/i.test(window.location.pathname);
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('[鑫考校园] 当前不在阅卷页面 (path:', window.location.pathname, ')');
            return false;
        }
        console.log('[鑫考校园] 开始检测批改页面...');
        try {
            const result = await Promise.race([
                waitForElement(XINKAO_CAMPUS_SELECTORS.PAGE_DETECT_IMAGE, 8000).then(() => 'answer-image'),
                waitForElement(XINKAO_CAMPUS_SELECTORS.PAGE_DETECT_INPUT, 8000).then(() => 'score-input'),
            ]).catch(() => null);

            if (result) {
                console.log(`[鑫考校园] 检测到批改页面元素: ${result}`);
                return true;
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
            const hasImage = document.querySelector(XINKAO_CAMPUS_SELECTORS.ANSWER_IMAGE);
            const hasInput = document.querySelector(XINKAO_CAMPUS_SELECTORS.SCORE_INPUTS);
            const hasInputkey = typeof (typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window).inputkey === 'function';
            const detected = !!(hasImage && hasInput && hasInputkey);
            console.log(`[鑫考校园] 兜底检测 — 图片: ${!!hasImage}, 输入框: ${!!hasInput}, inputkey: ${hasInputkey}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('[鑫考校园] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // 全局变量 subId + teaCode：换题变、换学生不变（换学生时 examcode/testPaperId 变，subId/teaCode 稳定）
        try {
            const subId = window.subId || '';
            const teaCode = window.teaCode || '';
            if (subId || teaCode) {
                return `xinkao_campus_${subId}_${teaCode}`;
            }
        } catch (e) { /* ignore */ }
        return window.location.pathname;
    },

    async gatherAnswerImages() {
        // 换卷时 src 的 examcode/picName/path token 变化，等 naturalWidth>0 避免抓到未加载图
        for (let i = 0; i < 12; i++) {
            const imgs = document.querySelectorAll(XINKAO_CAMPUS_SELECTORS.ANSWER_IMAGE);
            const loaded = Array.from(imgs).filter(img => img.src && img.src.startsWith('http') && img.naturalWidth > 0);
            if (loaded.length > 0) {
                console.log(`[鑫考校园] 找到答题卡 ${loaded.length} 张`);
                return [...new Set(loaded.map(img => img.src))];
            }
            await new Promise(r => setTimeout(r, 250));
        }
        // 兜底：不要求 naturalWidth
        const fallback = Array.from(document.querySelectorAll(XINKAO_CAMPUS_SELECTORS.ANSWER_IMAGE))
            .map(img => img.src)
            .filter(src => src && src.startsWith('http'));
        if (fallback.length > 0) {
            console.log('[鑫考校园] 兜底取图');
            return [...new Set(fallback)];
        }
        console.warn('[鑫考校园] 未找到答题卡图片');
        return [];
    },

    async fetchImageAsBase64(url) {
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];
        const fenEls = document.querySelectorAll(XINKAO_CAMPUS_SELECTORS.SCORE_INPUTS);

        fenEls.forEach((inputEl, i) => {
            // 满分从 data-score 属性提取（云阅卷wx_自改把 fen 改成了 data("score")）
            let maxScore = 0;
            const scoreAttr = inputEl.getAttribute('data-score') || '';
            const m = scoreAttr.match(/(\d+(?:\.\d+)?)/);
            if (m) maxScore = parseFloat(m[1]);

            // label 取所在 <tr> 第一列文本（如 "13-17(+12)"），兜底「第N题」
            let label = '';
            const row = inputEl.closest(XINKAO_CAMPUS_SELECTORS.SCORE_ROW);
            if (row) {
                const firstTd = row.querySelector('td');
                if (firstTd) label = firstTd.textContent.trim();
            }
            if (!label) label = `第${i + 1}题`;

            inputs.push({ element: inputEl, label, index: i, maxScore });
        });

        console.log(`[鑫考校园] 找到 ${inputs.length} 个分数输入框`);
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
            // 调平台全局 clearNoNum 归一化分数格式（数字+小数点、最多 2 位小数）
            try {
                const pageWindow = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
                if (typeof pageWindow.clearNoNum === 'function') pageWindow.clearNoNum(el);
            } catch (e) { /* ignore */ }
            successCount++;
            console.log(`[鑫考校园] ${inputs[i].label} 分数 ${scores[i]} 已填入`);
        }
        return successCount > 0;
    },

    submitGrade() {
        // 先 focus 最后一个分数输入框，触发 fenshuFocus 设置全局 o（inputkey 内部用 var obj=o 读当前输入）
        const fenEls = document.querySelectorAll(XINKAO_CAMPUS_SELECTORS.SCORE_INPUTS);
        const lastInput = fenEls[fenEls.length - 1];
        if (lastInput) {
            try { lastInput.focus(); } catch (e) { /* ignore */ }
        }

        // 调平台 inputkey(']')：校验分数 → 最后一个小题时内部调 submit() 交卷并自动换卷
        try {
            const pageWindow = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
            if (typeof pageWindow.inputkey === 'function') {
                console.log('[鑫考校园] 调用 inputkey("]") 提交');
                pageWindow.inputkey(']');
                return true;
            }
        } catch (e) {
            console.warn('[鑫考校园] inputkey 调用失败:', e.message);
        }

        console.warn('[鑫考校园] 未找到 inputkey 函数');
        return false;
    },

    async waitForNextPaper(oldImageUrl) {
        // 换卷信号：img.teaimg 的 src 中 examcode/picName/path token 变化（submit() → get_paper() → getpic() 更新）
        const oldToken = oldImageUrl ? this._imgToken(oldImageUrl) : (this._currentImgToken() || '');
        let checkTimes = 0;

        return new Promise((resolve) => {
            const timer = setInterval(() => {
                checkTimes++;

                // 信号1：图片 token 变化（换卷）
                const curToken = this._currentImgToken();
                if (oldToken && curToken && curToken !== oldToken) {
                    const img = document.querySelector(XINKAO_CAMPUS_SELECTORS.ANSWER_IMAGE);
                    if (img && img.naturalWidth > 0) {
                        clearInterval(timer);
                        console.log('[鑫考校园] 新试卷已加载（图片 token 变化）');
                        resolve(true);
                        return;
                    }
                }

                // 信号2：全局 examcode 变化（换学生卷）
                if (window.examcode && this._oldExamcode && window.examcode !== this._oldExamcode && checkTimes > 2) {
                    clearInterval(timer);
                    console.log('[鑫考校园] 新试卷已加载（examcode 变化）');
                    resolve(true);
                    return;
                }

                // 信号3：输入框被清空（提交后平台会清空）
                const input = document.querySelector(XINKAO_CAMPUS_SELECTORS.SCORE_INPUTS);
                if (input && input.value === '' && checkTimes > 3) {
                    clearInterval(timer);
                    console.log('[鑫考校园] 新试卷已加载（输入框清空）');
                    resolve(true);
                    return;
                }

                if (checkTimes > 125) {  // 25秒（125 × 200ms），对齐其他适配器
                    clearInterval(timer);
                    console.warn('[鑫考校园] 等待下一份试卷超时');
                    resolve(false);
                }
            }, 200);
            this._oldExamcode = window.examcode || '';
        });
    },

    _imgToken(url) {
        try {
            const u = new URL(url, location.href);
            // path token 是换卷主信号，examcode/picName 也随换卷变化
            return [u.searchParams.get('examcode'), u.searchParams.get('picName'), u.searchParams.get('path')].join('|');
        } catch (e) {
            return '';
        }
    },

    _currentImgToken() {
        const img = document.querySelector(XINKAO_CAMPUS_SELECTORS.ANSWER_IMAGE);
        return img ? this._imgToken(img.src) : '';
    },

    isRegradeMode() {
        // markingOrReview: "1"=正常阅卷，其他值=回评/复查；huipFlag: 0=正常，非 0=回评
        try {
            if (window.markingOrReview !== undefined && window.markingOrReview !== null && String(window.markingOrReview) !== '1') {
                return true;
            }
            if (window.huipFlag !== undefined && window.huipFlag !== null && Number(window.huipFlag) !== 0) {
                return true;
            }
        } catch (e) { /* ignore */ }
        // 兜底文案检测
        const bodyText = document.body.innerText || '';
        return bodyText.includes('回评') && !bodyText.includes('正常阅卷');
    },
};

// 注册适配器
if (XinkaoCampusAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = XinkaoCampusAdapter;
}
