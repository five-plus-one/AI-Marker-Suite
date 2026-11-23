// ========== 七天网络适配器 ==========
// 实现 PlatformAdapter 接口，处理七天网络平台特定的 DOM 交互

const QITIAN_SCORE_HELPERS = {
    label(value) {
        return String(value ?? '').normalize('NFKC').replace(/[|\s]/g, '').replace(/^第(.+)题(.*)$/, '$1$2');
    },
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

    questionContextOptional: true,

    getQuestionContext() {
        const params = new URLSearchParams(window.location.search);
        const question = QITIAN_SCORE_HELPERS.label(params.get('th'));
        if (!question) return null;
        const units = this.getScoreInputs().map(({ element, maxScore }, index, fields) => {
            const row = element.closest('.timuArea');
            const title = element.closest('tr')?.querySelector('td:first-child p') || row?.querySelector('.timuScore p');
            return { label: QITIAN_SCORE_HELPERS.label(title?.textContent) || (fields.length === 1 ? question : ''), maxScore };
        });
        return nativeQuestionContext(units, this.getTaskIdentifier());
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

    async submitGrade(guard = {}) {
        if (this._submitting) return false;
        this.lastSubmitError = '';
        const pending = this._filled;
        if (guard.signal?.aborted || guard.isCurrent?.() === false || !pending
            || !this._scoreReceiptCurrent(pending) || !this.prepareGrading()) {
            this._filled = null;
            this.lastSubmitError = '当前答卷或分数已变化，请核对后重新评分';
            return false;
        }
        const submitBtn = document.querySelector(QITIAN_SELECTORS.SUBMIT_BUTTON);
        if (submitBtn && !submitBtn.disabled && submitBtn.getClientRects().length) {
            const pageWindow = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
            const proto = pageWindow.XMLHttpRequest?.prototype;
            if (!proto) { this._filled = null; this.lastSubmitError = '暂时无法确认保存结果，请人工核对本卷'; return false; }
            this._submitting = true;
            try {
                return await new Promise(resolve => {
                    const originalOpen = proto.open, originalSend = proto.send, candidates = new WeakSet();
                    let finished = false, observed = null;
                    const finish = ok => {
                        if (finished) return;
                        finished = true; clearTimeout(timer);
                        if (proto.open === open) proto.open = originalOpen;
                        if (proto.send === send) proto.send = originalSend;
                        guard.signal?.removeEventListener('abort', cancelled);
                        if (observed) for (const type of ['load', 'error', 'abort', 'timeout']) observed.removeEventListener(type, response);
                        this._filled = null;
                        if (!ok) this.lastSubmitError = '本卷保存结果尚未确认，请在七天页面核对后继续';
                        resolve(ok);
                    };
                    const cancelled = () => finish(false);
                    const response = event => {
                        // 原站 URI 的成功协议为 +OK；HTTP 200 的错误页或 -ERR 不是保存成功。
                        finish(event.type === 'load' && observed.status >= 200 && observed.status < 300
                            && /^\+OK(?:\s|$)/.test(observed.responseText || '') && !guard.signal?.aborted
                            && guard.isCurrent?.() !== false);
                    };
                    const open = function(method, url, ...rest) {
                        candidates.delete(this);
                        try {
                            const parsed = new URL(url, window.location.href);
                            if (String(method).toUpperCase() === 'POST' && parsed.origin === window.location.origin
                                && /^\/review\/guid\/?$/i.test(parsed.pathname)) candidates.add(this);
                        } catch (_) { /* 不接管其他请求 */ }
                        return originalOpen.call(this, method, url, ...rest);
                    };
                    const adapter = this;
                    const send = function(body) {
                        if (!finished && candidates.has(this)) {
                            const form = new URLSearchParams(typeof body === 'string' ? body : '');
                            if (observed || form.get('score') !== pending.values.join(';') || guard.signal?.aborted
                                || guard.isCurrent?.() === false || !adapter._scoreReceiptCurrent(pending, form)) {
                                finish(false); return;
                            }
                            observed = this;
                            for (const type of ['load', 'error', 'abort', 'timeout']) this.addEventListener(type, response);
                        }
                        return originalSend.call(this, body);
                    };
                    const timer = setTimeout(() => finish(false), 25000);
                    proto.open = open; proto.send = send;
                    guard.signal?.addEventListener('abort', cancelled, { once: true });
                    if (guard.signal?.aborted || guard.isCurrent?.() === false) { finish(false); return; }
                    console.log('✅ [诊断] 七天网络 — 点击提交按钮并等待原生保存回执');
                    try { submitBtn.click(); } catch (_) { finish(false); }
                });
            } finally { this._submitting = false; }
        }
        this.lastSubmitError = '提交按钮暂时不可用，请检查阅卷页面';
        this._filled = null;
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

    _scoreImageKey() {
        return JSON.stringify(Array.from(document.querySelectorAll(QITIAN_SELECTORS.ANSWER_IMAGE))
            .filter(image => image.getClientRects().length).map(image => image.src));
    },

    _nativeReviewTarget() {
        const pageWindow = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
        const { regionGuid, th } = pageWindow.initConfig || {};
        if (typeof regionGuid !== 'string' || !regionGuid.trim() || typeof th !== 'string' || !th.trim()) return null;
        return { regionGuid, topic: th };
    },

    _scoreReceiptCurrent(pending, form) {
        if (pending.target) {
            const { regionGuid, topic } = pending.target;
            const currentTarget = this._nativeReviewTarget();
            if (currentTarget?.regionGuid !== regionGuid || currentTarget.topic !== topic) return false;
            if (form && (form.get('regionGuid') !== regionGuid || form.get('tz') !== topic)) return false;
        }
        const images = this._scoreImageKey();
        // 七天先以加载提示替换答卷图，再发出保存请求。此时使用原生卷号和题组核对同一答卷。
        const showingSubmitLoading = form && pending.target && pending.images !== '[]' && images === '[]'
            && document.querySelector(QITIAN_SELECTORS.SUBMIT_LOADING);
        const inputs = this.getScoreInputs();
        return pending.task === this.getTaskIdentifier() && pending.review === this.isRegradeMode()
            && (pending.images === images || showingSubmitLoading) && inputs.length === pending.inputs.length
            && inputs.every((input, i) => input.element === pending.inputs[i].element
                && input.label === pending.inputs[i].label && input.maxScore === pending.inputs[i].maxScore
                && !input.maxScoreConflict && !input.element.disabled && !input.element.readOnly
                && QITIAN_SCORE_HELPERS.number(input.element.value) === pending.values[i]);
    },

    prepareGrading() {
        this.lastFillError = '';
        const fail = message => { this.lastFillError = message; return false; };
        const inputs = this.getScoreInputs();
        if (!inputs.length) return fail('未找到当前题目的分数框，请等待答卷加载完成');
        if (inputs.some(input => input.maxScoreConflict)) return fail('页面满分信息不一致，请核对当前题目后继续');
        // 人工配置的细分小题可以汇总至一个原生框；多框时必须按题号和满分对齐。
        const scoring = typeof PresetManager === 'undefined' ? null : PresetManager.getCurrentConfig()?.scoring;
        if (!scoring) return true;
        const units = scoring.units || [];
        const labels = Array.from(units, unit => QITIAN_SCORE_HELPERS.label(unit?.label));
        if (units.length && (labels.some(label => !label) || new Set(labels).size !== labels.length)) {
            return fail('评分方案的小题名称有重复或缺失，请核对后继续');
        }
        const maxima = units.length ? Array.from(units, unit => QITIAN_SCORE_HELPERS.number(unit?.maxScore))
            : [QITIAN_SCORE_HELPERS.number(scoring.maxScore)];
        if (maxima.some(max => !(max > 0))) return fail('请先填写每个评分单元的满分');
        if (inputs.length === 1) {
            const total = Math.round(maxima.reduce((sum, max) => sum + max, 0) * 1e8) / 1e8;
            if (inputs[0].maxScore > 0 && Math.abs(total - inputs[0].maxScore) > 1e-8) {
                return fail('评分方案总分与当前题目满分不一致，请重新检测并核对评分方案');
            }
        } else if (units.length !== inputs.length || inputs.some((input, i) =>
            QITIAN_SCORE_HELPERS.label(input.label) !== labels[i]
            || (input.maxScore > 0 && Math.abs(input.maxScore - maxima[i]) > 1e-8))) {
            return fail('评分方案与页面题号或满分不一致，请重新检测并核对评分方案');
        }
        return true;
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
        this._filled = null;
        this.lastFillError = '';
        const fail = message => { this.lastFillError = message; return false; };
        if (!this.prepareGrading()) return false;
        const inputs = this.getScoreInputs();
        if (!inputs.length) return fail('未找到当前题目的分数框，请等待答卷加载完成');
        if (!Array.isArray(scores) || !scores.length || Array.from(scores).some(score => QITIAN_SCORE_HELPERS.number(score) === null)) {
            return fail('评分结果不完整，请核对每个小题的分数');
        }
        let values = scores.map(Number);
        const units = typeof PresetManager === 'undefined' ? [] : (PresetManager.getCurrentConfig()?.scoring?.units || []);
        if (units.length && (values.length !== units.length || values.some((value, i) =>
            value > QITIAN_SCORE_HELPERS.number(units[i]?.maxScore)))) {
            return fail('小题分数数量或分值与评分方案不一致，请逐项核对');
        }
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
        const task = this.getTaskIdentifier(), images = this._scoreImageKey(), review = this.isRegradeMode();
        const target = this._nativeReviewTarget();
        const unchanged = () => {
            const current = this.getScoreInputs();
            return task === this.getTaskIdentifier() && images === this._scoreImageKey() && review === this.isRegradeMode()
                && current.length === inputs.length && current.every((input, i) => input.element === inputs[i].element
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
        this._filled = { task, images, review, inputs, values, target };
        return true;
    },

    fillScore(request) {
        this._filled = null;
        const { total, subScores } = request;
        if (Array.isArray(subScores) && subScores.length > 0) {
            const normalize = QITIAN_SCORE_HELPERS.label;
            const labels = Array.from(subScores, score => normalize(score?.label));
            if (labels.some(label => !label) || new Set(labels).size !== labels.length || Array.from(subScores).some(score => !score)) {
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
            const units = typeof PresetManager === 'undefined' ? [] : (PresetManager.getCurrentConfig()?.scoring?.units || []);
            if (units.length) {
                if (units.length !== subScores.length || units.some(unit => !labels.includes(normalize(unit.label)))) {
                    this.lastFillError = '小题与评分方案不一致，请核对评分方案';
                    return false;
                }
                return this.fillScores(units.map(unit => subScores[labels.indexOf(normalize(unit.label))].score));
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
