// ========== 七天网络适配器 ==========
// 实现 PlatformAdapter 接口，处理七天网络平台特定的 DOM 交互

const QitianAdapter = {
    name: '七天网络',
    id: 'qitian',
    urlPatterns: ['*://*.7net.cc/*', '*://*.qt7.net/*'],
    iconUrl: '',

    shouldInitialize() {
        const h = window.location.hostname;
        // yj5.7net.cc 是新 UI，由 qitian-new 适配器处理
        if (h.includes('yj5.')) return false;
        return h.includes('7net.cc') || h.includes('qt7.net');
    },

    async detectMarkingPage() {
        console.log('🔎 [诊断] 七天网络 — 开始检测批改页面元素...');
        try {
            const result = await Promise.race([
                waitForElement(QITIAN_SELECTORS.PAGE_DETECT_IMAGE).then(() => 'paperImage'),
                waitForElement(QITIAN_SELECTORS.PAGE_DETECT_INPUT).then(() => 'score-input'),
                waitForElement(QITIAN_SELECTORS.PAGE_DETECT_SUBMIT).then(() => 'submit-btn'),
            ]).catch(() => null);

            if (result) {
                console.log(`✅ [诊断] 检测到批改页面元素: ${result}`);
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 3000));
            const hasImg = document.querySelector(QITIAN_SELECTORS.ANSWER_IMAGE);
            const hasInput = document.querySelector(QITIAN_SELECTORS.SCORE_INPUT);
            const hasBtn = document.querySelector(QITIAN_SELECTORS.SUBMIT_BUTTON);
            const detected = !!(hasImg && hasInput && hasBtn);
            console.log(`🔎 [诊断] 兜底检测 — 图片: ${!!hasImg}, 输入框: ${!!hasInput}, 提交按钮: ${!!hasBtn}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [诊断] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        const params = new URLSearchParams(window.location.search);
        const th = params.get('th') || '';
        const km = params.get('km') || '';
        return `qitian_${km}_${th}`;
    },

    async gatherAnswerImages() {
        // 只取可见题块图（#284）：平台会残留上一卷的隐藏裁切图（rect=0），
        // 混入取图会让 AI 从旧图判分（"未填写答案"误判的根源）
        const imgElements = Array.from(document.querySelectorAll(QITIAN_SELECTORS.ANSWER_IMAGE))
            .filter(img => img.getClientRects().length > 0);
        console.log(`🖼️ [诊断] 七天网络 — 可见答题卡图片: ${imgElements.length}（已排除隐藏残留图）`);
        return imgElements.map(img => img.src);
    },

    async fetchImageAsBase64(url) {
        return fetchImageAsBase64(url);
    },

    submitGrade() {
        const submitBtn = document.querySelector(QITIAN_SELECTORS.SUBMIT_BUTTON);
        if (submitBtn) {
            console.log(`✅ [诊断] 七天网络 — 点击提交按钮`);
            submitBtn.click();
            return true;
        }
        // 兜底：直接调用平台函数
        if (typeof yjsubmit === 'function') {
            console.log(`✅ [诊断] 七天网络 — 调用 yjsubmit()`);
            yjsubmit();
            return true;
        }
        console.warn('⚠️ [诊断] 未找到提交按钮 #subfen');
        return false;
    },

    async waitForNextPaper(oldImageUrl) {
        let checkTimes = 0;
        return new Promise((resolve) => {
            const timer = setInterval(() => {
                checkTimes++;
                // 只看可见题块图（#284）：隐藏残留图会让旧 src 误判/漏判
                const visible = Array.from(document.querySelectorAll(QITIAN_SELECTORS.ANSWER_IMAGE))
                    .filter(x => x.getClientRects().length > 0);
                const currentImg = visible[0];
                if (currentImg && currentImg.src !== oldImageUrl) {
                    clearInterval(timer);
                    console.log('✅ 七天网络 — 新试卷已加载');
                    resolve(true);
                } else if (checkTimes > 125) {  // 25秒（125 × 200ms），对齐其他适配器
                    clearInterval(timer);
                    console.warn('⚠️ 七天网络 — 等待下一份试卷超时');
                    resolve(false);
                }
            }, 200);
        });
    },

    isRegradeMode() {
        const params = new URLSearchParams(window.location.search);
        const reviewMode = params.get('reviewMode');
        // reviewMode=1 为回评模式
        return reviewMode === '1' || !!window.aiGradingState?.isRegrading;
    },

    getScoreInputs() {
        const inputs = [];
        // 平台每题一个输入框 #tbs1..N，位于 #dutailBot .timuArea 行内（#284）。
        // 行序 = 题序，与评分单元顺序对齐；旧行为只认 #tbs1 导致仅第一题被填。
        document.querySelectorAll('#dutailBot .timuArea').forEach((row, i) => {
            const el = row.querySelector('input[id^="tbs"]');
            if (!el) return;
            const p = row.querySelector('p');
            const label = p ? p.textContent.replace(/[|\s]/g, '').trim() : `分数${i + 1}`;
            inputs.push({ element: el, label, index: inputs.length });
        });
        if (inputs.length > 0) return inputs;
        // 回退：旧形态只有 #tbs1
        const scoreInput = document.querySelector(QITIAN_SELECTORS.SCORE_INPUT);
        if (scoreInput) {
            inputs.push({ element: scoreInput, label: '总分', index: 0 });
        }
        return inputs;
    },

    fillScores(scores) {
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) return false;

        // 数据安全：全或无（#284）——任一题缺分即整体拒绝，不提交半份分
        for (let i = 0; i < inputs.length; i++) {
            if (scores[i] === null || scores[i] === undefined) {
                console.warn(`⚠️ [诊断] ${inputs[i].label} 无 AI 分数（第 ${i + 1} 题缺失），拒绝填分`);
                return false;
            }
        }
        for (let i = 0; i < inputs.length; i++) {
            const el = inputs[i].element;
            const v = String(scores[i]);
            el.value = v;
            ['input', 'change', 'keyup', 'blur'].forEach(t => {
                el.dispatchEvent(new Event(t, { bubbles: true }));
            });
            console.log(`✅ [诊断] ${inputs[i].label} 分数 ${v} 已填入`);
        }
        // 登记校验：全部输入框必须落值，否则显式失败
        for (let i = 0; i < inputs.length; i++) {
            if (String(inputs[i].element.value).trim() === '') {
                console.error(`❌ [诊断] ${inputs[i].label} 填分校验失败（输入框为空），拒绝提交`);
                return false;
            }
        }
        return true;
    },

    fillScore(request) {
        // 旧接口兼容：统一走 fillScores 的全或无语义（#284）
        const { total, subScores } = request;
        if (subScores && subScores.length > 0) {
            return this.fillScores(subScores.map(s => s.score));
        }
        return this.fillScores([total]);
    },

    detectSubQuestions() {
        const subs = [];
        document.querySelectorAll('.timuArea .timuScore').forEach((el, i) => {
            const text = el.querySelector('td p')?.textContent?.trim() || '';
            const match = text.match(/第(.+?)题/);
            const label = match ? match[1] : `题${i + 1}`;
            const input = el.querySelector('input[id^="tbs"]');
            if (input) {
                subs.push({ label, element: input, index: i });
            }
        });
        // 单题任务也要返回（#284：旧行为 >1 才返回，单题页检测为空）
        return subs.length > 0 ? subs : [];
    }
};

if (QitianAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = QitianAdapter;
}
