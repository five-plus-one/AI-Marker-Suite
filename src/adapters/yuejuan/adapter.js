// ========== 正确阅卷适配器 ==========
// www.yuejuan.com — jQuery + layui 传统页面
// 答题卡：<img class="studentAnswerImg"> 渲染（img.yuejuan.com，外层 transform 缩放不影响原图）
// 评分方式：打分板点击式 div[data-score]（0..满分）+ 小键盘输入框 #inp_singleTestScore + 「提交分数」
//
// 关键交互（页面 DOM 证据推断，待真机复核）：
// - 「自动提交」「鼠标右键提交」为默认 OFF 的开关，小键盘模式才有「输入分值+Enter 提交」
//   → 点击打分板默认只选分不交卷。但 fillScores 仍只写输入框预览、点击推迟到 submitGrade，
//     保证任何「点击即提交」的平台行为都不会跳过用户确认环节
// - 提交按钮「提交分数」独立存在，submitGrade 先点打分板按钮（同步平台内部状态）再点提交
// - URL /markPaper/detail/{taskId}/{sheetId}：taskId 段与答题卡图片路径段一致（…/12116/sheet/…），
//   疑似题目标识；sheetId 疑似学生答卷标识。方案绑定只取 taskId，换卷不误判新题
// - 翻卷检测靠图片 URL 文件名哈希变化

const YuejuanAdapter = {
    name: '正确阅卷',
    id: 'yuejuan',
    urlPatterns: ['*://www.yuejuan.com/*', '*://yuejuan.com/*'],
    iconUrl: '',

    shouldInitialize() {
        return window.location.hostname.includes('yuejuan.com');
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器
    // 精确匹配 detail 路由：/markPaper/ 下可能有任务列表页，泛匹配会误弹 OOBE
    isMarkingPage() {
        return /\/markPaper\/detail\//.test(window.location.pathname);
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('🔎 [诊断] 正确阅卷 — 当前不在阅卷页面 (path:', window.location.pathname, ')');
            return false;
        }

        console.log('🔎 [诊断] 正确阅卷 — 开始检测批改页面...');
        try {
            await waitForElement(YUEJUAN_SELECTORS.SCORE_PANEL, 8000).catch(() => null);

            const panel = document.querySelector(YUEJUAN_SELECTORS.SCORE_PANEL);
            const img = document.querySelector(YUEJUAN_SELECTORS.ANSWER_IMAGE);
            const input = document.querySelector(YUEJUAN_SELECTORS.SCORE_INPUT);
            const items = document.querySelectorAll(YUEJUAN_SELECTORS.SCORE_ITEM);
            const detected = !!(img && (input || items.length > 0) && panel);
            console.log(`🔎 [诊断] 正确阅卷 — 面板: ${!!panel}, 图片: ${!!img}, 分数框: ${!!input}, 打分板项: ${items.length}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [诊断] 正确阅卷 detectMarkingPage 异常:', error);
            return false;
        }
    },

    // 题目维度标识（换学生不变、换题变）：
    // URL 第一段 taskId 与答题卡图片路径段一致，疑似题目标识，绝不能把第二段学生答卷 id 算进来
    // （图片哈希、sheetId 每份答卷都变，混入会导致「绑定到当前试题」失效，每次换卷误判新题）
    // #sp_testScore 题号+满分（如「17(12分)」）作双重保险，切题时必然变化
    getTaskIdentifier() {
        const labelEl = document.querySelector(YUEJUAN_SELECTORS.QUESTION_LABEL);
        const label = labelEl ? labelEl.textContent.trim() : '';
        const m = window.location.pathname.match(/\/markPaper\/detail\/(\d+)/);
        const taskId = m ? m[1] : '';
        return `yuejuan_${taskId}_${label}`;
    },

    async gatherAnswerImages() {
        console.log('🖼️ [诊断] 正确阅卷 — 开始获取答题卡图片...');

        // 等待图片渲染
        await new Promise(r => setTimeout(r, 500));

        const imgs = Array.from(document.querySelectorAll(YUEJUAN_SELECTORS.ANSWER_IMAGE));
        const urls = imgs
            .map(img => img.src)
            .filter(src => src && !src.startsWith('data:'));

        console.log(`🖼️ [诊断] 正确阅卷 — 找到 ${urls.length} 张答题卡图片`);
        return urls;
    },

    getScoreInputs() {
        const inputEl = document.querySelector(YUEJUAN_SELECTORS.SCORE_INPUT);
        const items = Array.from(document.querySelectorAll(YUEJUAN_SELECTORS.SCORE_ITEM));

        // 打分板可选分值（点击式评分）
        const scores = items
            .map(b => parseFloat(b.getAttribute('data-score')))
            .filter(n => !isNaN(n));

        // 满分三重来源：满分按钮 data-score → 打分板最高分 → 题号标签「(N分)」
        let maxScore = 0;
        const fullBtn = document.querySelector(YUEJUAN_SELECTORS.FULL_SCORE_BUTTON);
        if (fullBtn) maxScore = parseFloat(fullBtn.getAttribute('data-score')) || 0;
        if (!maxScore && scores.length > 0) maxScore = Math.max(...scores);
        const labelEl = document.querySelector(YUEJUAN_SELECTORS.QUESTION_LABEL);
        const label = labelEl ? labelEl.textContent.trim() : '总分';
        if (!maxScore && label) {
            const m = label.match(/(\d+(?:\.\d+)?)\s*分/);
            if (m) maxScore = parseFloat(m[1]);
        }

        if (!inputEl && items.length === 0) {
            console.warn('⚠️ [诊断] 正确阅卷 — 未找到评分单元');
            return [];
        }

        const unit = {
            element: inputEl || items[0],
            label: label || '总分',
            index: 0,
            maxScore,
            type: 'click',
            scores
        };
        console.log(`📝 [诊断] 正确阅卷 — 评分单元 1 个: ${unit.label}(满${unit.maxScore}), 打分板分值: [${scores.join(',')}]`);
        return [unit];
    },

    fillScores(scores) {
        if (!scores || scores.length === 0) return false;
        const score = scores[0];
        if (score === null || score === undefined) return false;

        // 只做输入框预览，不点击打分板：
        // 保证「点击即提交」类行为（若存在）不发生在用户确认之前
        this._pendingScore = score;
        const el = document.querySelector(YUEJUAN_SELECTORS.SCORE_INPUT);
        this._setInputPreview(el, score);
        console.log(`📝 [诊断] 正确阅卷 — 记录待提交分数: ${score}（等待确认后点击打分板并提交）`);
        return true;
    },

    async submitGrade() {
        const score = this._pendingScore;
        if (score === null || score === undefined) {
            console.warn('⚠️ [诊断] 正确阅卷 — 没有待提交的分数');
            return false;
        }
        this._pendingScore = null;

        const oldImg = this._getCurrentImageSrc();

        // 优先点打分板按钮（触发平台 scoringBoardScoreItemClick，同步其内部状态）
        const btn = this._findScoreItemBtn(score);
        if (btn) {
            btn.click();
            console.log(`✅ [诊断] 正确阅卷 — 已点击打分板「${btn.textContent.trim()}」`);
            await new Promise(r => setTimeout(r, 250));

            // 若点击即自动交卷翻卷（页面行为与预期不符时），绝不能再点「提交分数」——会给下一份误打分
            const newImg = this._getCurrentImageSrc();
            if (oldImg && newImg && newImg !== oldImg) {
                console.log('✅ [诊断] 正确阅卷 — 点击后已自动翻卷，跳过提交按钮');
                return true;
            }
        } else {
            // 兜底：小数分等打分板无对应按钮 → 依赖输入框值
            console.warn(`⚠️ [诊断] 正确阅卷 — 未找到分值 ${score} 对应打分板按钮，改用输入框`);
            this._setInputPreview(document.querySelector(YUEJUAN_SELECTORS.SCORE_INPUT), score);
        }

        return this._clickSubmitBtn();
    },

    async waitForNextPaper(oldImageUrl) {
        console.log('⏳ [诊断] 正确阅卷 — 等待下一份试卷...');

        // 只比路径（去掉 query）：文件名哈希每份答卷不同
        const pathOf = (u) => {
            if (!u) return '';
            try { return new URL(u, location.href).pathname; } catch (e) { return String(u).split('?')[0]; }
        };
        const oldPath = pathOf(oldImageUrl) || pathOf(this._getCurrentImageSrc());
        const startTime = Date.now();
        const maxWait = 30000;

        while (Date.now() - startTime < maxWait) {
            const curPath = pathOf(this._getCurrentImageSrc());
            if (curPath && curPath !== oldPath) {
                console.log('✅ 正确阅卷 — 新试卷已加载 (图片路径变化)');
                return true;
            }
            await new Promise(r => setTimeout(r, 300));
        }

        console.warn('⚠️ 正确阅卷 — 等待下一份试卷超时');
        return false;
    },

    isRegradeMode() {
        // 「退出回评」按钮可见 = 当前处于回评模式
        const btns = Array.from(document.querySelectorAll('button, a'));
        for (const b of btns) {
            if ((b.textContent || '').trim() === YUEJUAN_SELECTORS.EXIT_REGRADE_TEXT) {
                const r = b.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            }
        }
        return false;
    },

    // ========== 内部工具 ==========

    // 输入框显示预览（native setter + 事件，layui 内联 handler 需手动调 onchange）
    _setInputPreview(el, score) {
        if (!el || score === null || score === undefined) return;
        try {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, String(score));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            if (typeof el.onchange === 'function') {
                try { el.onchange.call(el); } catch (e) { /* 忽略 */ }
            }
            if (typeof el.oninput === 'function') {
                try { el.oninput.call(el); } catch (e) { /* 忽略 */ }
            }
        } catch (e) {
            console.warn('⚠️ [诊断] 正确阅卷 — 输入框预览失败:', e.message);
        }
    },

    // 查找打分板目标按钮：data-score 精确匹配 → 零分/满分按钮兜底
    _findScoreItemBtn(score) {
        const num = Number(score);
        const items = Array.from(document.querySelectorAll(YUEJUAN_SELECTORS.SCORE_ITEM));
        for (const b of items) {
            const n = parseFloat(b.getAttribute('data-score'));
            if (!isNaN(n) && n === num) return b;
        }
        if (num === 0) {
            const zero = document.querySelector(YUEJUAN_SELECTORS.ZERO_SCORE_BUTTON);
            if (zero) return zero;
        }
        const fullBtn = document.querySelector(YUEJUAN_SELECTORS.FULL_SCORE_BUTTON);
        if (fullBtn && parseFloat(fullBtn.getAttribute('data-score')) === num) return fullBtn;
        return null;
    },

    // 点击「提交分数」按钮
    _clickSubmitBtn() {
        const btn = document.querySelector(YUEJUAN_SELECTORS.SUBMIT_BUTTON);
        if (!btn) {
            console.warn('⚠️ [诊断] 正确阅卷 — 未找到提交按钮');
            return false;
        }
        btn.click();
        console.log('✅ [诊断] 正确阅卷 — 已点击提交分数');
        return true;
    },

    _getCurrentImageSrc() {
        const img = document.querySelector(YUEJUAN_SELECTORS.ANSWER_IMAGE);
        return img ? img.src : '';
    },

    onPageLoad() {
        console.log('🚀 [诊断] 正确阅卷 — 页面加载完成');
    },

    onGradingComplete() {
        console.log('✅ [诊断] 正确阅卷 — 本轮批改完成');
    },
};

// 注册适配器
if (YuejuanAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = YuejuanAdapter;
}
