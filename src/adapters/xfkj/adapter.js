// ========== 小帆智能阅卷适配器 ==========
// xfkj.cc（小帆科技）— layui + jQuery + ASP.NET WebForms 多页应用
// 入口链路：www.xfkj.cc/manage/login（滑块验证）→ 租户子域（如 xj.xfkj.cc）
//   → /pages/exam/yuejuan/list.aspx → detail.aspx?id=考试id → review.aspx?id=任务id&isai=0
//
// 关键交互（2026-11-06 实测确认）：
// - 答题卡：<img> 阿里云 OSS 裁剪图（.review_body>ul>li>img），src 带 x-oss-process=crop 签名参数，跨域走 GM_xmlhttpRequest
// - 评分：.quickmenu>.qlist>li 每小题一个 input.score-input（li 的 id=题目 id），placeholder「满分N分」提取满分
// - 提交：点 a.event-btn[data-action="14"]（「提交」）→ doSubmit() 校验全部小题已填且 0<=分<=满分
//   → POST code=144（historyid+scores）→ 成功后 50ms 自动 loadPaper(0) 翻卷
// - 「自动提交」勾选只由快捷打分按钮链路触发；直接填输入框 + 点提交不受影响，故填分绝不点快捷按钮
// - 换卷：提交成功后图片 src 的 pathname 变化（OSS 签名 query 每次刷新都变，只比 pathname）
// - 回评：.menu a[data-action="31"]（「结束回评」）可见 = 处于回评（pageIsNew=false）
// - URL review.aspx?id=任务id&isai=0 换卷时不变，适合做任务标识

const XfkjAdapter = {
    name: '小帆智能阅卷',
    id: 'xfkj',
    urlPatterns: ['*://*.xfkj.cc/*', '*://xfkj.cc/*'],
    iconUrl: '',

    shouldInitialize() {
        return window.location.hostname.includes('xfkj.cc');
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器（OOBE 弹窗判定走这里）
    // 必须精确匹配 review 路由：list.aspx / detail.aspx 等页面不能误判为批改页
    isMarkingPage() {
        return /\/pages\/exam\/yuejuan\/review(_online)?\.aspx/i.test(window.location.pathname);
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('🔎 [诊断] 小帆智能阅卷 — 当前不在阅卷页面 (pathname:', window.location.pathname, ')');
            return false;
        }

        console.log('🔎 [诊断] 小帆智能阅卷 — 开始检测批改页面...');
        try {
            // 题目/输入框由 code=142 异步渲染，图片由 code=143 异步渲染，需等待
            await waitForElement(XFKJ_SELECTORS.PAGE_DETECT_INPUT, 8000).catch(() => null);
            await waitForElement(XFKJ_SELECTORS.PAGE_DETECT_IMAGE, 8000).catch(() => null);

            const panel = document.querySelector(XFKJ_SELECTORS.PAGE_DETECT_PANEL);
            const img = document.querySelector(XFKJ_SELECTORS.PAGE_DETECT_IMAGE);
            const input = document.querySelector(XFKJ_SELECTORS.PAGE_DETECT_INPUT);
            const submitBtn = document.querySelector(XFKJ_SELECTORS.SUBMIT_BUTTON);
            const detected = !!(panel && img && input && submitBtn);
            console.log(`🔎 [诊断] 小帆智能阅卷 — 面板: ${!!panel}, 图片: ${!!img}, 分数框: ${!!input}, 提交: ${!!submitBtn}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [诊断] 小帆智能阅卷 detectMarkingPage 异常:', error);
            return false;
        }
    },

    // 题块任务维度稳定（URL 含任务 id 与 isai，换卷不变），方案绑定按题块复用
    getTaskIdentifier() {
        return window.location.pathname + window.location.search;
    },

    async gatherAnswerImages() {
        console.log('🖼️ [诊断] 小帆智能阅卷 — 开始获取答题卡图片...');

        // 等待图片渲染（OSS 图可能加载稍慢，但 URL 先于位图就绪）
        const startTime = Date.now();
        while (Date.now() - startTime < 8000) {
            const imgs = Array.from(document.querySelectorAll(XFKJ_SELECTORS.ANSWER_IMAGE));
            const urls = imgs.map(img => img.src).filter(src => src && src.startsWith('http'));
            if (urls.length > 0) {
                console.log(`🖼️ [诊断] 小帆智能阅卷 — 找到 ${urls.length} 张答题卡图片`);
                return urls;
            }
            await new Promise(r => setTimeout(r, 300));
        }

        // 超时仍无图：宁可不取（空图批改比不批更危险），交给上层处理
        console.warn('⚠️ [诊断] 小帆智能阅卷 — 未找到答题卡图片');
        return [];
    },

    async fetchImageAsBase64(url) {
        if (url.startsWith('data:')) {
            return url.split(',')[1];
        }
        // OSS 签名 URL 跨域，走 GM_xmlhttpRequest（connect 已含通配）
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];
        const items = Array.from(document.querySelectorAll(XFKJ_SELECTORS.SCORE_ITEM));

        items.forEach((li, i) => {
            const el = li.querySelector('input.score-input');
            if (!el) return;

            // 满分：placeholder「满分N分」，兜底 pageQuestionList（li 的 id=题目 id）
            let maxScore = 0;
            const m = (el.getAttribute('placeholder') || '').match(XFKJ_SELECTORS.MAX_SCORE_PLACEHOLDER);
            if (m) maxScore = parseFloat(m[1]) || 0;
            if (!maxScore && typeof pageQuestionList !== 'undefined' && Array.isArray(pageQuestionList)) {
                const q = pageQuestionList.find(item => String(item.id) === li.id);
                if (q && q.score) maxScore = parseFloat(q.score) || 0;
            }

            // 标签：首 div 文本，如「(四.23.1)得分:」→ 四.23.1
            let label = '';
            const labelEl = li.querySelector(XFKJ_SELECTORS.SCORE_LABEL);
            if (labelEl) {
                const text = labelEl.textContent.trim();
                const lm = text.match(/\(([^)]*)\)/);
                label = (lm ? lm[1] : text.replace(/得分[:：]?\s*$/, '')) || '';
            }
            if (!label) label = `小题#${i + 1}`;

            inputs.push({
                element: el,
                label,
                index: inputs.length,
                maxScore,
                type: 'input'
            });
        });

        console.log(`📝 [诊断] 小帆智能阅卷 — 评分单元 ${inputs.length} 个`, inputs.map(x => `${x.label}(满${x.maxScore})`).join(' | '));
        return inputs;
    },

    fillScores(scores) {
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) return false;

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        let filled = 0;

        for (let i = 0; i < scores.length; i++) {
            if (scores[i] === null || scores[i] === undefined) continue;
            const entry = inputs[i];
            if (!entry) {
                // 数据安全：填分失败必须显式失败，不得静默续走提交
                console.warn(`⚠️ [诊断] 小帆智能阅卷 — 第 ${i + 1} 个分数无对应输入框，填分中止`);
                return false;
            }
            const el = entry.element;
            // 快捷打分模式下输入框带 disabled，去掉以保证填入生效（提交读取的是输入框值）
            el.removeAttribute('disabled');
            el.removeAttribute('readonly');
            setter.call(el, String(scores[i]));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            filled++;
        }

        console.log(`📝 [诊断] 小帆智能阅卷 — 已填入 ${filled} 个分数: ${scores.join(',')}`);
        return filled > 0;
    },

    submitGrade() {
        const btn = document.querySelector(XFKJ_SELECTORS.SUBMIT_BUTTON);
        if (!btn) {
            console.warn('⚠️ [诊断] 小帆智能阅卷 — 未找到提交按钮');
            return false;
        }
        btn.click();
        console.log('✅ [诊断] 小帆智能阅卷 — 已点击提交按钮');
        return true;
    },

    async waitForNextPaper(oldImageUrl) {
        console.log('⏳ [诊断] 小帆智能阅卷 — 等待下一份试卷...');

        // 只比 pathname（去掉 OSS 签名 query）：签名每次刷新都变，路径里含试卷/学生专属段
        const pathOf = (u) => {
            if (!u) return '';
            try { return new URL(u, location.href).pathname; } catch (e) { return String(u).split('?')[0]; }
        };
        const oldPath = pathOf(oldImageUrl);
        const startTime = Date.now();
        const maxWait = 25000;

        while (Date.now() - startTime < maxWait) {
            const img = document.querySelector(XFKJ_SELECTORS.ANSWER_IMAGE);
            const curPath = img ? pathOf(img.src) : '';
            if (curPath && curPath !== oldPath) {
                console.log('✅ 小帆智能阅卷 — 新试卷已加载 (图片路径变化)');
                return true;
            }
            await new Promise(r => setTimeout(r, 300));
        }

        console.warn('⚠️ 小帆智能阅卷 — 等待下一份试卷超时');
        return false;
    },

    isRegradeMode() {
        // 「结束回评」按钮可见 = 当前处于回评（pageIsNew=false 时 updateIsNew 才 show）
        const el = document.querySelector(XFKJ_SELECTORS.EXIT_REGRADE_BUTTON);
        return !!(el && el.getClientRects().length > 0);
    },

    onPageLoad() {
        console.log('🚀 [诊断] 小帆智能阅卷 — 页面加载完成');
    },

    onGradingComplete() {
        console.log('✅ [诊断] 小帆智能阅卷 — 本轮批改完成');
    },
};

// 注册适配器
if (XfkjAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = XfkjAdapter;
}
