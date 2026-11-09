// 华翰云云阅卷适配器（yj.lcedu.net.cn 鹿城区部署实测；产品=吉林华翰云"云阅卷"）
// 平台特征：单题块单分框——一个阅卷任务=一个题块（如"书写 7(4分)"），一个 #compuinput 分数框
// 答卷图=OBS 题块裁剪图：obsyj.{域}/.../student/{考生号}/{hash}/{questionId}.png?X-Amz-签名
//   → 考生号在 URL 路径里 = 强换卷信号（同卷签名抖动只在 query，路径不变）（#301）
(function () {
    'use strict';

    const HY_HELPERS = {
        // 可见答卷图（过滤 data: 小图标与隐藏图，#284 同款可见性过滤）
        getVisibleAnswerImage() {
            const imgs = document.querySelectorAll(window.HUAHANYUN_SELECTORS.ANSWER_IMAGE);
            for (const img of imgs) {
                const src = img.getAttribute('src') || '';
                if (!src || src.indexOf('data:') === 0) continue;
                const r = img.getBoundingClientRect();
                if (r.width < 50 || r.height < 50) continue;
                return { img, src };
            }
            return null;
        },

        // 考生标识：OBS 路径中的考生号（签名 query 抖动不参与）（#281 强信号）
        extractStudentKey(src) {
            const m = String(src || '').match(/\/student\/([^/]+)\//);
            return m ? `hy:${m[1]}` : null;
        },

        // 路径级归一（剔除 query 签名抖动）
        normalizePath(src) {
            return String(src || '').split('?')[0];
        },

        // 面板标题「书写 7(4分)」→ { label, maxScore }
        parseTaskTitle() {
            const els = document.querySelectorAll('button, div, span');
            for (const el of els) {
                if (el.children.length > 0) continue;
                const t = (el.textContent || '').replace(/\s/g, '');
                const m = t.match(/^(.+)\((\d+(?:\.\d+)?)分\)$/);
                if (m && m[1].length > 0 && m[1].length <= 20) {
                    return { label: m[1], maxScore: parseFloat(m[2]) };
                }
            }
            return null;
        },

        // el-input（Vue）赋值：原生 setter + input/change 事件
        setNativeValue(el, value) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, String(value));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        },
    };

    const adapter = {
        name: '云阅卷(华翰云)',
        platformKey: 'huahanyun',
        version: '1.0.0',

        shouldInitialize() {
            const h = location.hostname;
            // 华翰云多区部署（本例 yj.lcedu.net.cn = 鹿城区）；域名不到时看 DOM 签名（防串台三特征）
            if (h.includes('lcedu.net.cn')) return true;
            return this._hasDomSignature();
        },

        // 三特征识别（#284 防串台）：批改路由 + 分数框 + 给分按钮
        _hasDomSignature() {
            return location.hash.indexOf('/marking/grading') >= 0
                && !!document.querySelector(window.HUAHANYUN_SELECTORS.SCORE_INPUT)
                && !!document.querySelector(window.HUAHANYUN_SELECTORS.SUBMIT_BUTTON);
        },

        async detectMarkingPage() {
            return this._hasDomSignature();
        },

        // 任务标识：URL questionId（稳定）
        getTaskIdentifier() {
            const m = location.hash.match(/questionId=(\d+)/);
            return m ? `huahanyun#${m[1]}` : `huahanyun#${location.hash.split('?')[0]}`;
        },

        isRegradeMode() {
            // 回评状态真机未见；URL thisType 语义未证实——保守返回 false（宁可放行走主流程，#301 待复现）
            return false;
        },

        // 单题块单分框：一个任务一个分框（label/满分取自面板标题「书写 7(4分)」）
        getScoreInputs() {
            const el = document.querySelector(window.HUAHANYUN_SELECTORS.SCORE_INPUT);
            if (!el) return [];
            const title = HY_HELPERS.parseTaskTitle();
            return [{
                element: el,
                label: title ? title.label : '本题',
                maxScore: title ? title.maxScore : 0,
                index: 0,
            }];
        },

        // 单分框全或无（#296 模板）：缺分/多分/空框写入失败 → 显式 false，不留半填状态
        fillScores(scores) {
            const inputs = this.getScoreInputs();
            if (inputs.length === 0) return false;
            if (!Array.isArray(scores) || scores.length === 0) return false;
            if (scores.length > 1) {
                // 单题块任务收到多分 = 配置错位，拒绝（宁停不带病）
                console.warn(`⚠️ [云阅卷华翰云] 分数个数(${scores.length})>1 但任务为单题块（配置错位）→ 拒绝`);
                return false;
            }
            const score = scores[0];
            if (score === null || score === undefined) {
                console.warn(`⚠️ [云阅卷华翰云] 无 AI 分数 → 拒绝`);
                return false;
            }
            const input = inputs[0];
            HY_HELPERS.setNativeValue(input.element, score);
            if (String(input.element.value) !== String(score)) {
                console.warn(`⚠️ [云阅卷华翰云] ${input.label} 写入校验失败（${input.element.value}≠${score}）→ 拒绝`);
                return false;
            }
            return true;
        },

        // 旧接口兜底（core 优先 fillScores，此处仅兼容）
        fillScore(request) {
            if (!request || request.total === null || request.total === undefined) return false;
            return this.fillScores([request.total]);
        },

        // 给分提交：点击 submitscorebtn；按钮缺失/禁用 → 显式 false（#296 不静默续走）
        submitGrade() {
            const btn = document.querySelector(window.HUAHANYUN_SELECTORS.SUBMIT_BUTTON);
            if (!btn) {
                console.warn('⚠️ [云阅卷华翰云] 未找到给分按钮 → 拒绝提交');
                return false;
            }
            if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
                console.warn('⚠️ [云阅卷华翰云] 给分按钮禁用 → 拒绝提交');
                return false;
            }
            btn.click();
            return true;
        },

        // 取图：可见大图（OBS 裁剪图直链带 X-Amz 签名，可直接抓取）
        async gatherAnswerImages() {
            const found = HY_HELPERS.getVisibleAnswerImage();
            return found ? [found.src] : [];
        },

        // 换卷判定：考生标识（路径级）变化即换卷；拿不准不误判（宁可等待）
        async waitForNextPaper(oldImageUrl) {
            const cur = HY_HELPERS.getVisibleAnswerImage();
            if (!cur) return false;
            const oldKey = HY_HELPERS.extractStudentKey(oldImageUrl);
            const newKey = HY_HELPERS.extractStudentKey(cur.src);
            if (oldKey && newKey) return oldKey !== newKey;
            // 标识提取失败（兜底路径）：仅当路径本身变化才判换卷
            return HY_HELPERS.normalizePath(oldImageUrl) !== HY_HELPERS.normalizePath(cur.src);
        },

        // 纸卷身份：考生号（换卷必变、同卷签名抖动不变）（#281 强信号）
        getPaperIdentity() {
            const cur = HY_HELPERS.getVisibleAnswerImage();
            return cur ? HY_HELPERS.extractStudentKey(cur.src) : null;
        },

        // 单题块单分框：一个评分单元
        detectSubQuestions() {
            const inputs = this.getScoreInputs();
            if (inputs.length === 0) return null;
            return [{
                id: 1,
                label: inputs[0].label,
                maxScore: inputs[0].maxScore,
            }];
        },
    };

    window.__AI_MARKER_ADAPTER__ = adapter;
})();
