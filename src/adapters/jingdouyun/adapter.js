// ========== 精斗云(大数据精准教学) 适配器 ==========
// exam.wxy100.com — AngularJS 1.x + jQuery，hash 路由 SPA
// 批改页：#!/testCenter/paperMark?examId=...&itemid=...（按题批阅，一次一题）
// 答题卡：#imgBox 内 ng-repeat AllImages 渲染 img[questionid]（多图/合并图两种模式）
// 评分：单分数框 input#topic（ng-model=correctStatus.topicScore）+ 打分板按键
//       （打分板走 enterScoreKeydown({keyCode})，直接写 ng-model 可绕开按键模拟）
// 提交：button.qbtn-save（ng-click=markSave()，ng-disabled=markSaveVolid 校验模型值）
//
// 关键交互（DOM 证据推断，待真机复核）：
// - 图片 URL 带 ?r= 随机缓存参数，翻卷检测只比 URL 路径（剥离 query）
// - 「自动提交」开关（isSubmitAuto）勾选时平台可能在分数录入后自动交卷
//   → fillScores 前先取消勾选（同九科星作业 #242 教训），提交时机由脚本提交流程接管
// - 保存后平台是否自动加载下一份未实测：waitForNextPaper 按图片路径变化轮询，
//   若实测保存后不自动翻卷，需二轮在等待超时前补点「下一个」按钮（绝不能盲点，
//   防止平台本要自动翻卷时被跳卷）
// - 任务标识只取 URL 的 examId+itemid（题目维度，学生切换不变），不掺 DOM 题号——
//   题号渲染有延迟，掺入会让 URL 轮询误判「任务已切换」反复弹配置引导

const JingdouyunAdapter = {
    name: '精斗云(大数据精准教学)',
    id: 'jingdouyun',
    urlPatterns: ['*://exam.wxy100.com/*'],
    iconUrl: 'https://exam.wxy100.com/favicon.ico',

    _pendingScores: null,

    shouldInitialize() {
        return window.location.hostname.includes('exam.wxy100.com');
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器（OOBE 弹窗判定走这里）
    // 精确匹配 paperMark 路由，避免任务列表页误判导致误弹配置引导
    isMarkingPage() {
        return JINGDOUYUN_SELECTORS.MARKING_HASH_REG.test(window.location.hash);
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('🔎 [诊断] 精斗云 — 当前不在阅卷页面 (hash:', window.location.hash, ')');
            return false;
        }

        console.log('🔎 [诊断] 精斗云 — 开始检测批改页面...');
        try {
            await waitForElement(JINGDOUYUN_SELECTORS.ANSWER_IMAGE, 8000).catch(() => null);

            const img = document.querySelector(JINGDOUYUN_SELECTORS.ANSWER_IMAGE);
            const input = document.querySelector(JINGDOUYUN_SELECTORS.SCORE_INPUT);
            const panel = document.querySelector(JINGDOUYUN_SELECTORS.SCORE_PANEL);
            const btn = document.querySelector(JINGDOUYUN_SELECTORS.SAVE_BUTTON);
            const detected = !!(img && input && panel);
            console.log(`🔎 [诊断] 精斗云 — 图片: ${!!img}, 分数框: ${!!input}, 面板: ${!!panel}, 保存钮: ${!!btn}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [诊断] 精斗云 detectMarkingPage 异常:', error);
            return false;
        }
    },

    // 题目维度标识：URL 含 examId+itemid，学生切换（翻卷）不变、换题变。
    // 只取 URL 不掺 DOM：题号等 DOM 渲染有延迟，值变化会被主控的 URL 轮询误判成任务切换
    getTaskIdentifier() {
        const hash = window.location.hash || '';
        const examId = (hash.match(/examId=([^&]+)/) || [])[1] || '';
        const itemid = (hash.match(/itemid=([^&]+)/) || [])[1] || '';
        return `jingdouyun_${examId}_${itemid}`;
    },

    async gatherAnswerImages() {
        console.log('🖼️ [诊断] 精斗云 — 开始获取答题卡图片...');

        // 等待 AngularJS ng-repeat/ng-src 渲染
        await new Promise(r => setTimeout(r, 500));

        // 优先取带 questionid 的答题图（区分页面其他图标），兜底取 #imgBox 内全部 img
        let imgs = Array.from(document.querySelectorAll(JINGDOUYUN_SELECTORS.ANSWER_IMAGE_ATTR));
        if (!imgs.length) {
            imgs = Array.from(document.querySelectorAll(JINGDOUYUN_SELECTORS.ANSWER_IMAGE));
        }

        const urls = imgs
            .map(img => img.src)
            .filter(src => src && !src.startsWith('data:'));

        console.log(`🖼️ [诊断] 精斗云 — 找到 ${urls.length} 张答题卡图片`);
        return urls;
    },

    async fetchImageAsBase64(url) {
        if (url.startsWith('data:')) {
            return url.split(',')[1];
        }
        // 同域图片，复用核心层下载器（GM_xmlhttpRequest 兜底）
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const els = Array.from(document.querySelectorAll(JINGDOUYUN_SELECTORS.SCORE_INPUT))
            .filter(el => el.type !== 'hidden');

        if (!els.length) {
            console.warn('⚠️ [诊断] 精斗云 — 未找到分数输入框');
            return [];
        }

        // 题号（如 17）与满分（如 14）来自 AngularJS ng-bind；题号/满分兜底取 div.qscore 前两个 span
        const itemNoEl = document.querySelector(JINGDOUYUN_SELECTORS.QUESTION_LABEL);
        const maxEl = document.querySelector(JINGDOUYUN_SELECTORS.MAX_SCORE_LABEL);
        let itemNo = itemNoEl ? itemNoEl.textContent.trim() : '';
        let maxScore = maxEl ? (parseFloat(maxEl.textContent.trim()) || 0) : 0;

        if (!itemNo || !maxScore) {
            const spans = document.querySelectorAll(JINGDOUYUN_SELECTORS.SCORE_ROW_SPANS);
            if (!itemNo && spans[0]) itemNo = spans[0].textContent.trim();
            if (!maxScore && spans[1]) maxScore = parseFloat(spans[1].textContent.trim()) || 0;
        }

        const baseLabel = itemNo ? `第${itemNo}题` : '总分';

        const inputs = els.map((el, i) => ({
            element: el,
            label: els.length > 1 ? `${baseLabel}(${i + 1})` : baseLabel,
            index: i,
            // 拆题模式（forceSplitFlag）下各小题满分未知，返回 0 由核心层引导用户配置
            maxScore: els.length > 1 ? 0 : maxScore
        }));

        console.log(`📝 [诊断] 精斗云 — 评分单元 ${inputs.length} 个`, inputs.map(x => `${x.label}(满${x.maxScore})`).join(' | '));
        return inputs;
    },

    fillScores(scores) {
        if (!scores || scores.length === 0) return false;

        // 「自动提交」勾选时分数录入可能触发平台自动交卷，绕过确认弹窗——先取消勾选
        this._disableAutoSubmit();

        const inputs = this.getScoreInputs();
        if (!inputs.length) return false;

        // 数据安全：两遍式全或无（#296，模板=guangda #275）——先全量校验，
        // 任一缺失/错位或写入失败即整体拒绝，不留半填状态
        if (scores.length > inputs.length) {
            console.warn(`⚠️ [精斗云] 分数个数(${scores.length})多于输入框数(${inputs.length})（配置错位）→ 拒绝`);
            return false;
        }
        for (let i = 0; i < inputs.length; i++) {
            if (scores[i] === null || scores[i] === undefined) {
                console.warn(`⚠️ [精斗云] ${inputs[i].label} 无 AI 分数（第 ${i + 1} 题缺失）→ 拒绝`);
                return false;
            }
        }

        for (let i = 0; i < inputs.length; i++) {
            if (!this._setScoreValue(inputs[i].element, scores[i])) {
                console.warn(`⚠️ [精斗云] ${inputs[i].label} 分数 ${scores[i]} 写入未生效 → 拒绝，不提交半填状态`);
                return false;
            }
        }

        this._pendingScores = scores.slice();
        console.log(`📝 [诊断] 精斗云 — 填入分数 ${scores.join(',')}（只写分数框预览，等待用户确认后保存）`);
        return true;
    },

    async submitGrade(guard) {
        if (guard && !guard.isCurrent()) return false;
        let btn = document.querySelector(JINGDOUYUN_SELECTORS.SAVE_BUTTON);
        if (!btn) {
            console.warn('⚠️ [诊断] 精斗云 — 未找到保存按钮');
            return false;
        }

        // 保存按钮 ng-disabled=markSaveVolid(模型值)：模型没同步时按钮保持禁用。
        // 补同步一次再等 digest 放行，仍禁用则放弃（宁可不交，不能空分/错分提交）
        if (btn.disabled && this._pendingScores && this._pendingScores.length) {
            const inputs = this.getScoreInputs();
            if (inputs.length && this._pendingScores[0] != null) {
                this._setScoreValue(inputs[0].element, this._pendingScores[0]);
                await new Promise(r => setTimeout(r, 200));
                if (guard) await guard.verify();
                if (guard && !guard.isCurrent()) return false;
                btn = document.querySelector(JINGDOUYUN_SELECTORS.SAVE_BUTTON);
            }
        }

        if (!btn || btn.disabled) {
            console.warn('⚠️ [诊断] 精斗云 — 保存按钮仍禁用（分数未通过平台校验），放弃提交');
            return false;
        }

        this._pendingScores = null;
        btn.click();
        console.log('✅ [诊断] 精斗云 — 已点击保存按钮');
        return true;
    },

    async waitForNextPaper(oldImageUrl) {
        console.log('⏳ [诊断] 精斗云 — 等待下一份试卷...');

        // img.src 带 ?r= 随机缓存参数，只比路径（路径含试卷 ID 段，换卷必变）
        const pathOf = (u) => {
            if (!u) return '';
            try { return new URL(u, location.href).pathname; } catch (e) { return String(u).split('?')[0]; }
        };
        const oldPath = pathOf(oldImageUrl) || pathOf(this._firstImageSrc());
        const startTime = Date.now();
        const maxWait = 25000;

        while (Date.now() - startTime < maxWait) {
            const curPath = pathOf(this._firstImageSrc());
            if (curPath && curPath !== oldPath) {
                console.log('✅ 精斗云 — 新试卷已加载 (图片路径变化)');
                return true;
            }
            await new Promise(r => setTimeout(r, 400));
        }

        console.warn('⚠️ 精斗云 — 等待下一份试卷超时');
        return false;
    },

    isRegradeMode() {
        // 未发现回评/复核模式的可靠 DOM 特征，暂按非回评处理（待真机复核）
        return false;
    },

    // ========== 内部工具 ==========

    _firstImageSrc() {
        const img = document.querySelector(JINGDOUYUN_SELECTORS.ANSWER_IMAGE_ATTR)
            || document.querySelector(JINGDOUYUN_SELECTORS.ANSWER_IMAGE);
        return img ? img.src : '';
    },

    // 写分数到 ng-model 绑定的输入框：
    // 优先 AngularJS ngModel.$setViewValue（同步 correctStatus.topicScore 并触发 digest，
    // 保存按钮的 ng-disabled 才会放行）；无 angular 时回退 native setter + input/change 事件
    _setScoreValue(el, score) {
        if (!el || score === null || score === undefined) return false;
        const value = String(score);

        try {
            const ng = window.angular;
            if (ng && ng.element) {
                const ngEl = ng.element(el);
                const ctrl = ngEl.controller && ngEl.controller('ngModel');
                if (ctrl && typeof ctrl.$setViewValue === 'function') {
                    ctrl.$setViewValue(value);
                    if (typeof ctrl.$render === 'function') ctrl.$render();
                    if (el.value === value) return true;
                }
            }
        } catch (e) {
            console.warn('⚠️ [诊断] 精斗云 — ngModel 填分失败，回退原生事件:', e.message);
        }

        try {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (e) {
            el.value = value;
        }
        return el.value === value;
    },

    // 填分前取消勾选「自动提交」：勾选时分数录入后平台可能自动交卷，
    // 绕过提交确认弹窗与「批改节奏」拟人延迟。提交时机由脚本提交流程接管
    _disableAutoSubmit() {
        const divs = Array.from(document.querySelectorAll(JINGDOUYUN_SELECTORS.AUTO_SUBMIT_TOGGLE));
        for (const div of divs) {
            const text = (div.textContent || '').trim();
            if (!text.includes('自动提交')) continue;

            const cb = div.querySelector('input[type="checkbox"]');
            if (!cb || !cb.checked) return; // 未勾选，无需处理

            // ng-click=setSubmitAuto() 挂在容器 div 上，点容器切换开关状态
            div.click();
            if (!cb.checked) {
                console.log('✅ [诊断] 精斗云 — 已取消勾选「自动提交」（勾选时填分可能触发平台自动交卷）');
            } else {
                console.warn('⚠️ [诊断] 精斗云 — 「自动提交」取消勾选失败，填分后可能被平台自动提交');
            }
            return;
        }
    },

    onPageLoad() {
        console.log('🚀 [诊断] 精斗云 — 页面加载完成');
    },

    onGradingComplete() {
        console.log('✅ [诊断] 精斗云 — 本轮批改完成');
    },
};

// 注册适配器
if (JingdouyunAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = JingdouyunAdapter;
}
