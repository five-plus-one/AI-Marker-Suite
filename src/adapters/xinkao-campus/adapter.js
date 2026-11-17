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
        // 内网裸 IP:端口部署，不硬编码 hostname，靠路径 + DOM 专有锚识别（防串台）
        const path = window.location.pathname || '';
        if (/\/Marking\/NormalReadPaper(\.\w+)?\/?$/i.test(path)) {
            // 同路径与 yunyuejuan 重叠（strict-b S17）——按提交形态分叉：yunyuejuan 有独立
            // 提交按钮 button.btn-standard-pri.phr15，campus 走 inputkey(']') 无此按钮（附 A.3）
            return !document.querySelector('button.btn-standard-pri');
        }
        // DOM 兜底（strict-a 附 A.3）：data-score 满分语义 + inputkey 提交契约是 campus 专有
        // 组合（与 adapter 读取同源），排 yunyuejuan 的独立提交按钮（strict-b S15/S16 教训）
        return !!(document.querySelector(XINKAO_CAMPUS_SELECTORS.ANSWER_IMAGE)
            && document.querySelector('input.fenshu[data-score]')
            && typeof window.inputkey === 'function'
            && !document.querySelector('button.btn-standard-pri'));
    },

    isMarkingPage() {
        return /\/Marking\/NormalReadPaper(\.\w+)?\/?$/i.test(window.location.pathname);
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

    _paperSnapshot() {
        return MarkingPaper.snapshot(XINKAO_CAMPUS_SELECTORS.ANSWER_IMAGE);
    },

    getPaperIdentity() {
        return this._paperSnapshot().identity;
    },

    async gatherAnswerImages() {
        return MarkingPaper.gather(this);
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

        // 数据安全：两遍式全或无（#296，模板=guangda #275）——先全量校验，
        // 任一缺失/错位即整体拒绝，全部命中才写入，不留半填状态
        if (scores.length > inputs.length) {
            console.warn(`⚠️ [鑫考校园] 分数个数(${scores.length})多于输入框数(${inputs.length})（配置错位）→ 拒绝`);
            return false;
        }
        for (let i = 0; i < inputs.length; i++) {
            if (scores[i] === null || scores[i] === undefined) {
                console.warn(`⚠️ [鑫考校园] ${inputs[i].label} 无 AI 分数（第 ${i + 1} 题缺失）→ 拒绝`);
                return false;
            }
        }

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        for (let i = 0; i < inputs.length; i++) {
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
            console.log(`[鑫考校园] ${inputs[i].label} 分数 ${scores[i]} 已填入`);
        }
        return true;
    },

    submitGrade(options = {}) {
        const submitButton = null;
        return MarkingPaper.submit(this, submitButton, options);
    },

    async waitForNextPaper(oldImageUrl, context = {}) {
        return MarkingPaper.wait(this, oldImageUrl, context);
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

// 注册守卫（#324 教训 + strict-a 附 A.0）：自查 shouldInitialize → 先到先得（不覆盖）→
// 已注册且我也认领本页 = 多命中冲突，console.error 红灯告警（静默劫持变可见）→ 异常 fail-closed
(function registerXinkaoCampusAdapter() {
    try {
        if (!XinkaoCampusAdapter.shouldInitialize()) return;
        const existing = window.__AI_MARKER_ADAPTER__;
        if (existing) {
            console.error(`🚫 [注册冲突] ${existing.name} 已注册，但 鑫考校园(xinkao-campus) 也认领本页（疑似串台/劫持），保留先到者`);
            return;
        }
        window.__AI_MARKER_ADAPTER__ = XinkaoCampusAdapter;
    } catch (e) {
        console.warn('⚠️ [注册] 判定异常，fail-closed 不注册:', e);
    }
})();
