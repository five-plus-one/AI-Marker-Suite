// ========== 七天网络适配器 ==========
// 实现 PlatformAdapter 接口，处理七天网络平台特定的 DOM 交互

const QITIAN_SCORE_HELPERS = {
    number(value) {
        if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : null;
    },

    bounds(element, row) {
        const candidates = [];
        const add = value => {
            const number = this.number(value);
            if (number > 0) candidates.push(number);
        };
        add(element.getAttribute('max'));
        // 原站 inputByKey(event, 输入框序号, 输入框数量, 满分)。只读字面量，不执行页面代码。
        const handler = element.getAttribute('onkeydown') || '';
        const match = handler.match(/\binputByKey\s*\(\s*event\s*,\s*\d+\s*,\s*\d+\s*,\s*(\d+(?:\.\d+)?)\s*\)/);
        if (match) add(match[1]);
        if (row) {
            row.querySelectorAll('[data-val]').forEach(button => {
                if (button.textContent.trim() !== '满分') return;
                const index = button.getAttribute('data-th');
                if (index && index !== element.id.slice(3)) return;
                add(button.getAttribute('data-val'));
            });
        }
        const values = [...new Set(candidates)];
        return { maxScore: values.length === 1 ? values[0] : undefined, maxScoreConflict: values.length > 1 };
    }
};

const QitianAdapter = {
    name: '七天网络',
    id: 'qitian',
    urlPatterns: ['*://*.7net.cc/*', '*://*.qt7.net/*', '*://*.qt7.cn/*'],
    iconUrl: '',

    shouldInitialize() {
        const h = window.location.hostname;
        // yj5.7net.cc 是新 UI，由 qitian-new 适配器处理
        if (h.includes('yj5.')) return false;
        // qt7.cn 为七天网络新域名（#296 声明与实现对齐）；
        // DOM 形态沿用 7net.cc 检测链（detectMarkingPage 三特征兜底），形态不一致时检测自然不通过
        return h.includes('7net.cc') || h.includes('qt7.net') || h.includes('qt7.cn');
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
        const elements = Array.from(document.querySelectorAll('#dutailBot input[id^="tbs"]'));
        if (!elements.length) {
            const legacy = document.querySelector(QITIAN_SELECTORS.SCORE_INPUT);
            if (legacy) elements.push(legacy);
        }
        // 作答图片中的空格不是原生评分单元；只按当前可见填分框建表。
        for (const element of new Set(elements)) {
            if (!/^tbs\d+$/.test(element.id) || !element.getClientRects().length || element.type === 'hidden') continue;
            const row = element.closest('.timuArea');
            const title = element.closest('tr')?.querySelector('td:first-child p') || row?.querySelector('.timuScore p');
            const label = title?.textContent.replace(/[|\s]/g, '').trim() || (elements.length === 1 ? '总分' : `分数${inputs.length + 1}`);
            inputs.push({ element, label, index: inputs.length, ...QITIAN_SCORE_HELPERS.bounds(element, row) });
        }
        return inputs;
    },

    fillScores(scores) {
        this.lastFillError = '';
        const fail = message => { this.lastFillError = message; return false; };
        const inputs = this.getScoreInputs();
        if (!inputs.length) return fail('未找到当前题目的分数框，请等待答卷加载完成');
        if (!Array.isArray(scores) || !scores.length || Array.from(scores).some(score => QITIAN_SCORE_HELPERS.number(score) === null)) {
            return fail('评分结果不完整，请核对每个小题的分数');
        }
        let values = scores.map(Number);
        // 一道大题包含多个作答空、平台只收一个总分时，汇总全部评分单元。
        if (inputs.length === 1) values = [Math.round(values.reduce((sum, value) => sum + value, 0) * 1e8) / 1e8];
        if (values.length !== inputs.length || new Set(inputs.map(input => input.element.id)).size !== inputs.length) {
            return fail('评分单元与页面分数框不一致，请重新检测并核对评分方案');
        }
        for (let i = 0; i < inputs.length; i++) {
            const { element, maxScore, maxScoreConflict } = inputs[i];
            if (element.disabled || element.readOnly) return fail('当前分数框暂时不可填写，请检查答卷状态');
            if (maxScoreConflict) return fail('页面满分信息不一致，请核对当前题目后继续');
            if (!Number.isFinite(values[i]) || (maxScore > 0 && values[i] > maxScore)) {
                return fail('评分结果超过当前题目满分，请核对评分方案');
            }
        }
        const task = this.getTaskIdentifier();
        const unchanged = () => {
            const current = this.getScoreInputs();
            return task === this.getTaskIdentifier() && current.length === inputs.length && current.every((input, i) => input.element === inputs[i].element
                && input.label === inputs[i].label
                && input.maxScore === inputs[i].maxScore && !input.maxScoreConflict
                && !input.element.disabled && !input.element.readOnly);
        };
        for (let i = 0; i < inputs.length; i++) {
            if (!unchanged()) return fail('题目或分数框已变化，请核对当前答卷后继续');
            const el = inputs[i].element;
            const v = String(values[i]);
            el.value = v;
            for (const type of ['input', 'change', 'keyup', 'blur']) {
                if (!unchanged()) return fail('题目或分数框已变化，请核对当前答卷后继续');
                el.dispatchEvent(new Event(type, { bubbles: true }));
            }
            console.log(`✅ [诊断] ${inputs[i].label} 分数 ${v} 已填入`);
        }
        if (!unchanged()) return fail('题目或分数框已变化，请核对当前答卷后继续');
        for (let i = 0; i < inputs.length; i++) {
            if (QITIAN_SCORE_HELPERS.number(inputs[i].element.value) !== values[i]) return fail('平台未接受填写的分数，请核对后继续');
        }
        return true;
    },

    fillScore(request) {
        const { total, subScores } = request;
        if (Array.isArray(subScores) && subScores.length > 0) {
            const normalize = label => String(label ?? '').replace(/[|\s]/g, '').replace(/^第(.+)题$/, '$1');
            const labels = Array.from(subScores, score => normalize(score?.label));
            if (new Set(labels).size !== labels.length || Array.from(subScores).some(score => !score)) {
                this.lastFillError = '小题评分有重复或缺失，请核对评分方案';
                return false;
            }
            const inputs = this.getScoreInputs();
            if (inputs.length > 1) {
                if (subScores.length !== inputs.length || inputs.some(input => !labels.includes(normalize(input.label)))) {
                    this.lastFillError = '小题与页面题号不一致，请核对评分方案';
                    return false;
                }
                return this.fillScores(inputs.map(input => subScores[labels.indexOf(normalize(input.label))].score));
            }
            return this.fillScores(subScores.map(s => s.score));
        }
        if (subScores != null && !Array.isArray(subScores)) {
            this.lastFillError = '评分结果不完整，请核对每个小题的分数';
            return false;
        }
        return this.fillScores([total]);
    },

    detectSubQuestions() {
        return this.getScoreInputs();
    }
};

if (QitianAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = QitianAdapter;
}
