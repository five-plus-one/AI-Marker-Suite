// ========== A佳教育在线阅卷适配器 ==========
// jQuery + requirejs 传统页面，单题批量批改（URL 固定 questionNo，逐个学生提交）
//
// 关键交互语义（两轮诊断脚本提取的「确定」按钮处理器源码确认）：
//   - 「确定」#key_code_submit = 校验 → POST /task/updateScore → 成功后 loadData 拉下一份并 setView 重渲染
//   - 满分取同行 td.fullscore[data-score]；多行 = 同一学生多个题，score 逗号拼接提交
//   - 平台「清除」按钮的事件组合是 input + keyup，提交时直接读 DOM value，故赋值派发同组合事件即可
//   - fillScores 原生 setter 赋值已实测被平台接受（值保持不被重置）
//   - 小题快捷/分步打分板模式下「确定」先逐个小题确认再提交，首版不覆盖（建议常规打分板）

const AjiaAdapter = {
    name: 'A佳教育',
    id: 'ajia',
    urlPatterns: ['https://y.ajia.cn/*'],
    iconUrl: 'https://y.ajia.cn/favicon.ico',

    shouldInitialize() {
        return window.location.hostname.includes('y.ajia.cn');
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器
    isMarkingPage() {
        return /\/html\/page\/marking\.html/i.test(window.location.pathname);
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('[A佳] 当前不在阅卷页面 (pathname:', window.location.pathname, ')');
            return false;
        }
        console.log('[A佳] 开始检测批改页面...');
        try {
            await waitForElement(AJIA_SELECTORS.PAGE_DETECT_IMAGE);
            await waitForElement(AJIA_SELECTORS.PAGE_DETECT_INPUT);
            const hasSubmit = !!document.querySelector(AJIA_SELECTORS.PAGE_DETECT_SUBMIT);
            console.log(`[A佳] 检测完成 - 提交按钮: ${hasSubmit}`);
            return hasSubmit;
        } catch (error) {
            console.error('[A佳] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // 题目级标识（含 projectId/subjectCode/questionNo）。
        // 换学生时 URL 不变，方案按题绑定、批量沿用；hash 仅是项目/科目展示名，不含任务维度。
        return window.location.pathname + window.location.search;
    },

    async gatherAnswerImages() {
        const imgs = document.querySelectorAll(AJIA_SELECTORS.ANSWER_IMAGE);
        const urls = [];
        imgs.forEach(img => {
            if (img.src && /^https?:/i.test(img.src)) urls.push(img.src);
        });
        console.log(`[A佳] 找到答题卡图片: ${urls.length} 张`);
        return urls;
    },

    async fetchImageAsBase64(url) {
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];

        // 小题模式（快捷/分步打分板）：#subQuestionList li 各一个 input.input，满分在 .score 的兄弟 .fullscore
        const subList = document.querySelector(AJIA_SELECTORS.SUB_SCORE_LIST);
        const subItems = subList ? subList.querySelectorAll(AJIA_SELECTORS.SUB_SCORE_ITEM) : [];
        if (subItems.length && subList && getComputedStyle(subList).display !== 'none') {
            subItems.forEach((li, i) => {
                const input = li.querySelector('input.input');
                if (!input) return;
                const maxEl = li.querySelector('.fullscore') || (li.querySelector('.score') && li.querySelector('.score').nextElementSibling);
                const maxScore = parseInt(maxEl && maxEl.getAttribute('data-score'), 10) || 0;
                const label = (li.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 20) || `小题${i + 1}`;
                inputs.push({ element: input, label, index: inputs.length, maxScore });
            });
            return inputs;
        }

        // 常规模式：#markSubjectList 每行一个评分单元（多行 = 同一学生多个题）
        document.querySelectorAll(AJIA_SELECTORS.SCORE_ROW).forEach((tr, i) => {
            const input = tr.querySelector('input.num-source');
            if (!input) return;
            const label = (tr.querySelector(AJIA_SELECTORS.QUESTION_LABEL) && tr.querySelector(AJIA_SELECTORS.QUESTION_LABEL).textContent || '').trim() || `第${i + 1}题`;
            const fullscoreEl = tr.querySelector(AJIA_SELECTORS.FULLSCORE);
            const maxScore = parseInt(fullscoreEl && fullscoreEl.getAttribute('data-score'), 10) || 0;
            inputs.push({ element: input, label, index: inputs.length, maxScore });
        });

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
            // 模仿平台「清除」按钮的事件组合（input+keyup），提交时直接读 DOM value
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('keyup', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            successCount++;
        }
        return successCount > 0;
    },

    submitGrade() {
        const btn = document.querySelector(AJIA_SELECTORS.SUBMIT_BUTTON);
        if (!btn) {
            console.warn('[A佳] 未找到提交按钮 #key_code_submit');
            return false;
        }
        btn.click();
        return true;
    },

    async waitForNextPaper(oldImageUrl) {
        // 「确定」成功回调 loadData 拉下一份并 setView 重渲染：
        // studentId hidden 与答题图 src 都会整体替换，任一变化即视为翻卷
        const timeout = 25000;
        const interval = 200;
        const startTime = Date.now();
        const oldStudentId = (document.querySelector(AJIA_SELECTORS.STUDENT_ID) || {}).value;

        while (Date.now() - startTime < timeout) {
            const img = document.querySelector(AJIA_SELECTORS.ANSWER_IMAGE);
            const currentUrl = img ? img.src : null;
            const currentStudentId = (document.querySelector(AJIA_SELECTORS.STUDENT_ID) || {}).value;

            if (oldImageUrl && currentUrl && currentUrl !== oldImageUrl) return true;
            if (oldStudentId && currentStudentId && currentStudentId !== oldStudentId) return true;

            await new Promise(r => setTimeout(r, interval));
        }
        return false;
    },

    isRegradeMode() {
        // 回评：「退出回评」.link-out 由 hidden 变可见
        const linkOut = document.querySelector(AJIA_SELECTORS.LINK_OUT);
        if (linkOut && !linkOut.classList.contains('hidden') && linkOut.getBoundingClientRect().width > 0) {
            return true;
        }
        return !!window.aiGradingState?.isRegrading;
    },
};

if (AjiaAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = AjiaAdapter;
}
