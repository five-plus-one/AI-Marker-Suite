// ========== 南昊AI教学提分平台适配器 ==========
// 域名: nhcisc.com，jQuery 传统页面
// 实测要点：
//   - 答题卡 #taskimg，src 相对路径（showimage?path=...），img.src 取绝对 URL，单页裁剪图
//   - 分数 input[name="score"]，placeholder「满分N」提取满分，多小题按 li 遍历 label=.subt-num
//   - 提交点 .up-score（jQuery click → 全局 submitscore()），.tj-btn 为隐藏备用
//   - 任务标识 = pathname + urlSubid + hidSubid + Que_ID，换答卷全程稳定（3 份实测）
//   - 换卷为直接替换式：examid/secid/imgSrc 同快照切换，scoreVal 同步清空（无过渡态）
//   - clearNoNum 全局函数过滤分数格式（数字+单小数点、最多 2 位小数），填分后调用

const NhciscAdapter = {
    name: '南昊AI教学提分',
    id: 'nhcisc',
    urlPatterns: ['*://nhcisc.com/*'],
    iconUrl: '',

    shouldInitialize() {
        return window.location.hostname.includes('nhcisc.com');
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器
    isMarkingPage() {
        return /\/exam\/mark\/task\/taskpaper/i.test(window.location.pathname);
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('[南昊] 当前不在阅卷页面 (pathname:', window.location.pathname, ')');
            return false;
        }

        console.log('[南昊] 开始检测批改页面...');
        try {
            const result = await Promise.race([
                waitForElement(NHCISC_SELECTORS.PAGE_DETECT_IMAGE).then(() => 'answer-image'),
                waitForElement(NHCISC_SELECTORS.PAGE_DETECT_INPUT).then(() => 'score-input'),
                waitForElement(NHCISC_SELECTORS.PAGE_DETECT_SUBMIT).then(() => 'submit-btn'),
            ]).catch(() => null);

            if (result) {
                console.log(`[南昊] 检测到批改页面元素: ${result}`);
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 3000));
            const hasImage = document.querySelector(NHCISC_SELECTORS.ANSWER_IMAGE);
            const hasInput = document.querySelector(NHCISC_SELECTORS.SCORE_INPUT);
            const hasBtn = document.querySelector(NHCISC_SELECTORS.SUBMIT_BUTTON);
            const detected = !!(hasImage && hasInput && hasBtn);
            console.log(`[南昊] 兜底检测 - 图片: ${!!hasImage}, 输入框: ${!!hasInput}, 提交: ${!!hasBtn}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('[南昊] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // pathname + URL subid + 隐藏域 subid + 题号：四者换答卷均稳定
        //（实测 3 份答卷对比 + 刷新对比均未变），换题时任一变化即可区分（#147）
        const urlSubid = new URLSearchParams(window.location.search).get(NHCISC_SELECTORS.TASK_ID_URL_PARAM) || '';
        const hidSubid = this._fieldValue(NHCISC_SELECTORS.TASK_ID_INPUT);
        const queId = this._fieldValue(NHCISC_SELECTORS.QUESTION_ID_INPUT);
        return [window.location.pathname, urlSubid, hidSubid, queId].join('::');
    },

    async gatherAnswerImages() {
        console.log('[南昊] 开始获取答题卡图片...');

        const startTime = Date.now();
        const maxWait = 8000;

        // 轮询等待图片加载完成
        while (Date.now() - startTime < maxWait) {
            const img = document.querySelector(NHCISC_SELECTORS.ANSWER_IMAGE);
            if (img && img.src && img.src.startsWith('http') && (img.naturalWidth > 0 || img.complete)) {
                console.log('[南昊] 获取到答题卡图片');
                return [img.src];
            }
            await new Promise(r => setTimeout(r, 300));
        }

        // 超时兜底
        const fallbackImg = document.querySelector(NHCISC_SELECTORS.ANSWER_IMAGE);
        if (fallbackImg && fallbackImg.src && fallbackImg.src.startsWith('http')) {
            console.log('[南昊] 超时兜底: 获取到图片');
            return [fallbackImg.src];
        }

        console.warn('[南昊] 未找到答题卡图片');
        return [];
    },

    async fetchImageAsBase64(url) {
        // src 为 showimage 动态接口，直接下载即可
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];
        const items = document.querySelectorAll(NHCISC_SELECTORS.SCORE_INPUT);

        items.forEach(el => {
            if (el.offsetParent === null) return;

            // 满分：placeholder「满分N」（实测 "满分3" → 3）
            let maxScore = 0;
            const ph = el.getAttribute('placeholder') || '';
            const m = ph.match(NHCISC_SELECTORS.MAX_SCORE_PLACEHOLDER);
            if (m) maxScore = parseFloat(m[1]) || 0;

            // 标签：li 内 .subt-num 文本（如 "1"），兜底「第N题」
            let label = '';
            const item = el.closest(NHCISC_SELECTORS.SCORE_ITEM);
            if (item) {
                const labelEl = item.querySelector(NHCISC_SELECTORS.SCORE_LABEL);
                if (labelEl) label = labelEl.textContent.trim();
            }
            if (!label) label = `第${inputs.length + 1}题`;

            inputs.push({ element: el, label: label, index: inputs.length, maxScore: maxScore });
        });

        console.log(`[南昊] 找到 ${inputs.length} 个分数输入框`);
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
            input.removeAttribute('readonly');
            setter.call(input, scores[i]);

            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));

            // 调平台全局 clearNoNum 归一化分数格式（数字+单小数点、最多 2 位小数）
            try {
                if (typeof clearNoNum === 'function') clearNoNum(input);
            } catch (e) {
                // 忽略：过滤失败不影响填分
            }

            successCount++;
        }

        return successCount > 0;
    },

    submitGrade() {
        // 主按钮 .up-score（可见），jQuery click handler 调全局 submitscore()
        const btn = document.querySelector(NHCISC_SELECTORS.SUBMIT_BUTTON)
            || document.querySelector(NHCISC_SELECTORS.SUBMIT_BUTTON_ALT);
        if (!btn) {
            console.warn('[南昊] 未找到提交按钮');
            return false;
        }

        btn.click();
        console.log('[南昊] 点击提交按钮');
        return true;
    },

    async waitForNextPaper(oldImageUrl) {
        // 实测换卷为直接替换式：examid/secid/imgSrc 同快照切换，scoreVal 同步清空
        //（无 sipd 那种清空过渡态），任一换卷信号变化即可判定
        const oldExamid = this._fieldValue(NHCISC_SELECTORS.EXAM_ID_INPUT);
        const oldSecid = this._fieldValue(NHCISC_SELECTORS.SEC_ID_INPUT);

        const timeout = 30000;
        const interval = 300;
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            // 无任务时提前结束
            const noTask = document.querySelector(NHCISC_SELECTORS.NO_TASK_PANE);
            if (noTask && noTask.offsetParent !== null) {
                console.log('[南昊] 已无阅卷任务');
                return false;
            }

            const curExamid = this._fieldValue(NHCISC_SELECTORS.EXAM_ID_INPUT);
            const curSecid = this._fieldValue(NHCISC_SELECTORS.SEC_ID_INPUT);
            const img = document.querySelector(NHCISC_SELECTORS.ANSWER_IMAGE);
            const curImg = img ? img.getAttribute('src') : null;
            const imgReady = img && img.src && img.src.startsWith('http') && (img.naturalWidth > 0 || img.complete);

            const examidChanged = curExamid && curExamid !== oldExamid;
            const secidChanged = curSecid && curSecid !== oldSecid;
            const imgChanged = !!(oldImageUrl && img && img.src && img.src !== oldImageUrl);

            if ((examidChanged || secidChanged || imgChanged) && imgReady) {
                console.log('[南昊] 检测到下一份答卷 (examid:', curExamid, ')');
                return true;
            }

            await new Promise(r => setTimeout(r, interval));
        }

        console.warn('[南昊] 等待下一份答卷超时');
        return false;
    },

    isRegradeMode() {
        // 平台有「阅卷/AI批改」模式切换 tab，未见独立回评入口；保守用文案兜底
        const bodyText = document.body.innerText || '';
        return bodyText.includes('回评') || bodyText.includes('复核');
    },

    _fieldValue(selector) {
        const el = document.querySelector(selector);
        return el && el.value !== undefined ? el.value : '';
    },
};

// 注册适配器
if (NhciscAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = NhciscAdapter;
}
