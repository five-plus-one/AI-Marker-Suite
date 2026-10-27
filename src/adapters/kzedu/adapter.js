// ========== 云阅卷(开州)适配器 ==========
// yyj.kzedu.cn — Vue 3 + Element Plus SPA
// 答题卡：<img> 渲染于 .svg-container 内（S3 预签名 URL，域 ycc.kzedu.cn）
// 评分方式：点击式 button.scoreitem（0..满分）+ readonly 分数框 + 「给分」提交
//
// 关键交互（实测确认）：
// - 「自动给分」勾选时，点击 scoreitem 会立即 POST /v2/union/mark/submit 并自动翻卷（无确认弹窗）
//   → fillScores 绝不点击按钮，点击动作统一推迟到 submitGrade，避免跳过用户确认环节
// - 「自动给分」未勾选时，点击 scoreitem 只填分，需再点「给分」才提交
//   → submitGrade 按勾选状态分支，勾选时只点 scoreitem（再点「给分」会给下一份误打分）
// - URL 仅含 questionId（学生切换 URL 不变），翻卷检测靠图片 src 路径变化

const KzeduAdapter = {
    name: '云阅卷(开州)',
    id: 'kzedu',
    urlPatterns: ['*://yyj.kzedu.cn/*'],
    iconUrl: '',

    shouldInitialize() {
        return window.location.hostname.includes('yyj.kzedu.cn');
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器（OOBE 弹窗判定走这里）
    // 必须精确匹配 /marking/grading 路由：
    // 不能用 includes('/marking/grading')——任务列表页 #/marking/gradingList/list 也含该子串，会误弹 OOBE
    isMarkingPage() {
        return /#\/marking\/grading(\?|$)/.test(window.location.hash);
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('🔎 [诊断] 云阅卷(开州) — 当前不在阅卷页面 (hash:', window.location.hash, ')');
            return false;
        }

        console.log('🔎 [诊断] 云阅卷(开州) — 开始检测批改页面...');
        try {
            await waitForElement(KZEDU_SELECTORS.PAGE_DETECT_PANEL, 8000).catch(() => null);

            const panel = document.querySelector(KZEDU_SELECTORS.SCORE_PANEL);
            const img = document.querySelector(KZEDU_SELECTORS.ANSWER_IMAGE);
            const input = document.querySelector(KZEDU_SELECTORS.PAGE_DETECT_INPUT);
            const items = document.querySelectorAll(KZEDU_SELECTORS.SCORE_ITEM);
            const detected = !!(panel && img && (input || items.length > 0));
            console.log(`🔎 [诊断] 云阅卷(开州) — 面板: ${!!panel}, 图片: ${!!img}, 分数框: ${!!input}, scoreitem: ${items.length}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [诊断] 云阅卷(开州) detectMarkingPage 异常:', error);
            return false;
        }
    },

    // 题目维度稳定（hash 含 questionId，学生切换不变），方案绑定按题复用
    getTaskIdentifier() {
        return window.location.hash || window.location.href;
    },

    async gatherAnswerImages() {
        console.log('🖼️ [诊断] 云阅卷(开州) — 开始获取答题卡图片...');

        // 等待图片渲染完成
        await new Promise(r => setTimeout(r, 500));

        // 只取 .svg-container 内的真实答案图，排除分数闪现 base64 小图
        const imgs = Array.from(document.querySelectorAll('img.el-image__inner'));
        const urls = imgs
            .filter(img => img.closest('.svg-container') && img.src && !img.src.startsWith('data:'))
            .map(img => img.src);

        if (urls.length === 0) {
            // 兜底选择器
            const fb = document.querySelector(KZEDU_SELECTORS.ANSWER_IMAGE_FALLBACK);
            if (fb && fb.src && !fb.src.startsWith('data:')) urls.push(fb.src);
        }

        console.log(`🖼️ [诊断] 云阅卷(开州) — 找到 ${urls.length} 张答题卡图片`);
        return urls;
    },

    async fetchImageAsBase64(url) {
        if (url.startsWith('data:')) {
            return url.split(',')[1];
        }
        // S3 预签名 URL 跨域，走 GM_xmlhttpRequest（connect: '*' 已覆盖 ycc.kzedu.cn）
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];
        const scoreEls = Array.from(document.querySelectorAll(KZEDU_SELECTORS.SCORE_INPUT));

        // scoreitem 可选分数列表（点击式评分）
        const scores = Array.from(document.querySelectorAll(KZEDU_SELECTORS.SCORE_ITEM))
            .map(b => parseFloat(b.textContent.trim()))
            .filter(n => !isNaN(n));

        // 题干标签（如「二、主观题 11-16(24分)」）
        const titleEl = document.querySelector(KZEDU_SELECTORS.QUESTION_TITLE);
        const titleText = titleEl ? titleEl.textContent.trim() : '';

        scoreEls.forEach((el, i) => {
            // 满分三重来源：输入框 max 属性 → scoreitem 最高分 → 题干「(N分)」
            let maxScore = parseInt(el.getAttribute('max') || '0', 10) || 0;
            if (!maxScore && scores.length > 0) maxScore = Math.max(...scores);
            if (!maxScore && titleText) {
                const m = titleText.match(/(\d+(?:\.\d+)?)\s*分/);
                if (m) maxScore = parseFloat(m[1]);
            }

            let label = titleText || '总分';
            if (scoreEls.length > 1) label = `${label || '总分'} #${i + 1}`;

            inputs.push({
                element: el,
                label,
                index: i,
                maxScore,
                type: 'click',
                scores
            });
        });

        console.log(`📝 [诊断] 云阅卷(开州) — 评分单元 ${inputs.length} 个`, inputs.map(x => `${x.label}(满${x.maxScore})`).join(' | '));
        return inputs;
    },

    fillScores(scores) {
        if (!scores || scores.length === 0) return false;

        // 多单元按顺序记录（当前页面为单单元）
        this._pendingScores = scores.slice();
        this._pendingScore = scores[0];

        // 只做显示预览，绝不点击按钮：
        // 「自动给分」勾选时点击 scoreitem 会立即提交翻卷，跳过用户确认环节
        scores.forEach((score, i) => {
            if (score === null || score === undefined) return;
            const els = document.querySelectorAll(KZEDU_SELECTORS.SCORE_INPUT);
            const el = els[i];
            if (el) this._setInputPreview(el, score);
        });

        console.log(`📝 [诊断] 云阅卷(开州) — 记录待提交分数: ${scores.join(',')}（等待用户确认后点击给分）`);
        return true;
    },

    async submitGrade() {
        const score = this._pendingScore;
        if (score === null || score === undefined) {
            console.warn('⚠️ [诊断] 云阅卷(开州) — 没有待提交的分数');
            return false;
        }
        this._pendingScore = null;

        const btn = this._findScoreItemBtn(score);
        if (btn) {
            const autoOn = this._isAutoScoreOn();
            btn.click();

            if (autoOn) {
                // 勾选自动给分：点击即提交翻卷。
                // 绝不能再点「给分」——此时若页面已翻卷，会给下一份误打分
                console.log(`✅ [诊断] 云阅卷(开州) — 已点击分数按钮「${btn.textContent.trim()}」（自动给分：提交并翻卷）`);
                return true;
            }

            // 未勾选自动给分：点「给分」确认提交
            console.log(`✅ [诊断] 云阅卷(开州) — 已点击分数按钮「${btn.textContent.trim()}」，等待后点给分`);
            await new Promise(r => setTimeout(r, 250));
            return this._clickGiveBtn();
        }

        // 兜底：找不到对应分数按钮（如非整数分）→ 依赖 fillScores 写入的输入框值
        console.warn(`⚠️ [诊断] 云阅卷(开州) — 未找到分数 ${score} 对应按钮，改用输入框+给分按钮`);
        this._setInputPreview(document.querySelector(KZEDU_SELECTORS.SCORE_INPUT), score);
        return this._clickGiveBtn();
    },

    async waitForNextPaper(oldImageUrl) {
        console.log('⏳ [诊断] 云阅卷(开州) — 等待下一份试卷...');

        // 只比路径（去掉签名 query）：同一学生签名刷新不会误判，路径里含学生专属段
        const pathOf = (u) => {
            if (!u) return '';
            try { return new URL(u, location.href).pathname; } catch (e) { return String(u).split('?')[0]; }
        };
        const oldPath = pathOf(oldImageUrl);
        const startTime = Date.now();
        const maxWait = 30000;

        while (Date.now() - startTime < maxWait) {
            const img = document.querySelector(KZEDU_SELECTORS.ANSWER_IMAGE) ||
                        document.querySelector(KZEDU_SELECTORS.ANSWER_IMAGE_FALLBACK);
            const curPath = img ? pathOf(img.src) : '';
            if (curPath && curPath !== oldPath) {
                console.log('✅ 云阅卷(开州) — 新试卷已加载 (图片路径变化)');
                return true;
            }
            await new Promise(r => setTimeout(r, 300));
        }

        console.warn('⚠️ 云阅卷(开州) — 等待下一份试卷超时');
        return false;
    },

    isRegradeMode() {
        // 「退出回评」按钮可见 = 当前处于回评模式
        const btns = Array.from(document.querySelectorAll('button'));
        for (const b of btns) {
            if (b.textContent.trim() === KZEDU_SELECTORS.EXIT_REGRADE_TEXT) {
                const r = b.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            }
        }
        return false;
    },

    // ========== 内部工具 ==========

    // 输入框显示预览（native setter 绕过 Vue 受控输入，不触发任何提交）
    _setInputPreview(el, score) {
        if (!el || score === null || score === undefined) return;
        try {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, String(score));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (e) {
            console.warn('⚠️ [诊断] 云阅卷(开州) — 输入框预览失败:', e.message);
        }
    },

    // 查找目标分数按钮：精确文本 → 数值解析 → 零分/满分按钮兜底
    _findScoreItemBtn(score) {
        const num = Number(score);
        const items = Array.from(document.querySelectorAll(KZEDU_SELECTORS.SCORE_ITEM));

        let exactBtn = null;
        let numBtn = null;
        for (const b of items) {
            const text = b.textContent.trim();
            if (text === String(score) || text === String(num)) {
                if (!exactBtn) exactBtn = b;
            }
            const n = parseFloat(text);
            if (!isNaN(n) && n === num && !numBtn) numBtn = b;
        }
        if (exactBtn || numBtn) return exactBtn || numBtn;

        // 零分按钮兜底
        if (num === 0) {
            const zero = document.querySelector(KZEDU_SELECTORS.ZERO_SCORE_BUTTON);
            if (zero) return zero;
        }

        // 满分按钮兜底
        const input = document.querySelector(KZEDU_SELECTORS.SCORE_INPUT);
        const max = input ? parseInt(input.getAttribute('max') || '0', 10) || 0 : 0;
        if (max > 0 && num === max) {
            const full = document.querySelector(KZEDU_SELECTORS.FULL_SCORE_BUTTON);
            if (full) return full;
        }

        return null;
    },

    // 「自动给分」勾选状态；找不到时按勾选处理（更保守：不点给分，避免给下一份误打分）
    _isAutoScoreOn() {
        const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        for (const cb of cbs) {
            const labelEl = cb.closest('label') || cb.closest('.el-checkbox');
            const text = (labelEl ? labelEl.textContent : (cb.value || '')).trim();
            if (text.includes(KZEDU_SELECTORS.AUTO_CHECKBOX_TEXT)) return cb.checked;
        }
        return true;
    },

    // 点击「给分」提交按钮
    _clickGiveBtn() {
        const btn = document.querySelector(KZEDU_SELECTORS.SUBMIT_BUTTON);
        if (!btn) {
            console.warn('⚠️ [诊断] 云阅卷(开州) — 未找到给分按钮');
            return false;
        }
        btn.click();
        console.log('✅ [诊断] 云阅卷(开州) — 已点击给分按钮');
        return true;
    },

    onPageLoad() {
        console.log('🚀 [诊断] 云阅卷(开州) — 页面加载完成');
    },

    onGradingComplete() {
        console.log('✅ [诊断] 云阅卷(开州) — 本轮批改完成');
    },
};

// 注册适配器
if (KzeduAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = KzeduAdapter;
}
