// ========== 九五优评适配器 ==========
// 平台入口 timesphoenix.com（s1/s2 等子域跳转），壳页 web/main.jsp + iframe#main_frame
// 阅卷界面在 iframe 内部：web/mark/sjpy/sjpy_kspy.jsp?ksdm=&kmdm=&stbh=
// 任务标识取 iframe 全局 ksdm/kmdm/stbh（考试/科目/题目编号），同一道题跨学生稳定
// 提交走 tjfs()：存在提交限速 checkZdpysxTime（"请等待 N 秒后提交成绩"）
// 且 tjqqr 为真时弹出 layer「打分确认」对话框，需自动点确定

const JiuwuyoupingAdapter = {
    name: '九五优评',
    id: 'jiuwuyouping',
    urlPatterns: ['*://*.timesphoenix.com/*', '*://timesphoenix.com/*'],
    iconUrl: '',

    // ---------- iframe 访问 ----------
    _getFrame() {
        try {
            return document.querySelector(JIUWUYOUPING_SELECTORS.MARK_FRAME);
        } catch (e) {
            return null;
        }
    },

    _getFrameDoc() {
        try {
            const frame = this._getFrame();
            if (!frame) return null;
            return frame.contentDocument || (frame.contentWindow && frame.contentWindow.document) || null;
        } catch (e) {
            return null;
        }
    },

    _getFrameWin() {
        try {
            const frame = this._getFrame();
            return frame ? (frame.contentWindow || null) : null;
        } catch (e) {
            return null;
        }
    },

    // 去掉 ?v= 缓存戳，比较用图片路径
    _normalizeUrl(url) {
        if (!url) return '';
        return String(url).split('?')[0].split('#')[0];
    },

    // 取当前答题卡首图路径（归一化）
    _getImagePath(doc) {
        const d = doc || this._getFrameDoc();
        if (!d) return '';
        const img = d.querySelector(JIUWUYOUPING_SELECTORS.ANSWER_IMAGE);
        return this._normalizeUrl(img ? img.src : '');
    },

    _hasScoreValues(doc) {
        const d = doc || this._getFrameDoc();
        if (!d) return false;
        const inputs = d.querySelectorAll(JIUWUYOUPING_SELECTORS.SCORE_INPUT);
        for (const inp of inputs) {
            if (String(inp.value || '').trim() !== '') return true;
        }
        return false;
    },

    // ---------- 生命周期 ----------
    shouldInitialize() {
        return window.location.hostname.includes('timesphoenix.com');
    },

    // 快速检查（供 URL 变化监听器使用，不等待 DOM）
    isMarkingPage() {
        const doc = this._getFrameDoc();
        if (!doc) return false;
        return !!doc.querySelector(JIUWUYOUPING_SELECTORS.PAGE_DETECT_INPUT)
            && !!doc.querySelector(JIUWUYOUPING_SELECTORS.PAGE_DETECT_SUBMIT);
    },

    async detectMarkingPage() {
        const start = Date.now();
        while (Date.now() - start < 8000) {
            if (this.isMarkingPage()) {
                console.log('✅ [九五优评] 检测到阅卷界面（iframe#main_frame 内）');
                return true;
            }
            await new Promise(r => setTimeout(r, 300));
        }
        console.log('ℹ️ [九五优评] 未检测到阅卷界面（当前可能是选题列表页）');
        return false;
    },

    // ---------- 任务标识 ----------
    getTaskIdentifier() {
        // 优先取 iframe 全局变量（诊断已确认存在：ksdm=4 kmdm=C23 stbh=3）
        let ksdm = null, kmdm = null, stbh = null;
        try {
            const win = this._getFrameWin();
            if (win) {
                if (win.ksdm !== undefined && win.ksdm !== null) ksdm = win.ksdm;
                if (win.kmdm !== undefined && win.kmdm !== null) kmdm = win.kmdm;
                if (win.stbh !== undefined && win.stbh !== null) stbh = win.stbh;
            }
        } catch (e) { /* 跨域等情况忽略 */ }

        // 回退：从 iframe src 的 query 解析
        if (ksdm === null || kmdm === null || stbh === null) {
            try {
                const frame = this._getFrame();
                const src = (frame && (frame.getAttribute('src') || frame.src)) || '';
                const get = (k) => {
                    const m = src.match(new RegExp('[?&]' + k + '=([^&]*)'));
                    return m ? decodeURIComponent(m[1]) : null;
                };
                if (ksdm === null) ksdm = get('ksdm');
                if (kmdm === null) kmdm = get('kmdm');
                if (stbh === null) stbh = get('stbh');
            } catch (e) { /* ignore */ }
        }

        if (stbh !== null && stbh !== '' && String(stbh) !== 'null') {
            return `jwyp_${ksdm}_${kmdm}_${stbh}`;
        }
        // 选题列表页（navi.jsp）固定标识，避免轮询误触发新试题逻辑
        return 'jwyp_navi';
    },

    // ---------- 图片获取 ----------
    async gatherAnswerImages() {
        // 等待 iframe 内图片就绪（翻卷后靠 AJAX 切换 src）
        const start = Date.now();
        let urls = [];
        while (Date.now() - start < 3000) {
            const doc = this._getFrameDoc();
            if (doc) {
                const imgs = doc.querySelectorAll(JIUWUYOUPING_SELECTORS.ANSWER_IMAGE);
                urls = [];
                imgs.forEach(img => {
                    const src = img.getAttribute('src') || img.src || '';
                    if (src && /^https?:/i.test(src)) urls.push(src);
                });
                if (urls.length > 0) break;
            }
            await new Promise(r => setTimeout(r, 200));
        }
        console.log(`🖼️ [九五优评] 找到答题卡图片 ${urls.length} 张`);
        return urls;
    },

    async fetchImageAsBase64(url) {
        // 图片在 :88 端口（与页面不同端口），走 GM_xmlhttpRequest 下载
        return fetchImageAsBase64(url);
    },

    // ---------- 分数输入 ----------
    getScoreInputs() {
        const doc = this._getFrameDoc();
        if (!doc) return [];
        const inputs = [];
        const els = doc.querySelectorAll(JIUWUYOUPING_SELECTORS.SCORE_INPUT);
        els.forEach((el, i) => {
            // 标签：同一 .dfddiv 内的 .dfdspan（如 "22（1）（2）"）
            let label = `第${i + 1}题`;
            try {
                const wrap = el.closest('.dfddiv');
                const span = wrap ? wrap.querySelector(JIUWUYOUPING_SELECTORS.SCORE_LABEL) : null;
                if (span && span.textContent.trim()) label = span.textContent.trim();
            } catch (e) { /* ignore */ }

            // 满分：placeholder "满6分"
            let maxScore = 0;
            const ph = el.getAttribute('placeholder') || el.placeholder || '';
            const m = ph.match(/(\d+)/);
            if (m) maxScore = parseInt(m[1], 10);

            inputs.push({ element: el, label, index: i, maxScore });
        });
        return inputs;
    },

    fillScores(scores) {
        const doc = this._getFrameDoc();
        const win = this._getFrameWin();
        if (!doc) return false;

        const inputs = this.getScoreInputs();
        if (inputs.length === 0) return false;

        // 数据安全：两遍式全或无（#296，模板=guangda #275）——先全量校验，
        // 任一缺失/错位即整体拒绝，全部命中才写入，不留半填状态
        if (scores.length > inputs.length) {
            console.warn(`⚠️ [九五优评] 分数个数(${scores.length})多于输入框数(${inputs.length})（配置错位）→ 拒绝`);
            return false;
        }
        for (let i = 0; i < inputs.length; i++) {
            if (scores[i] === null || scores[i] === undefined) {
                console.warn(`⚠️ [九五优评] ${inputs[i].label} 无 AI 分数（第 ${i + 1} 题缺失）→ 拒绝`);
                return false;
            }
        }

        // 取 iframe 窗口的 HTMLInputElement（元素属于 iframe 文档）
        const proto = (win && win.HTMLInputElement && win.HTMLInputElement.prototype)
            || window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;

        for (let i = 0; i < inputs.length; i++) {
            const v = scores[i];
            const el = inputs[i].element;
            setter.call(el, String(v));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            console.log(`✅ [九五优评] 给分点 ${inputs[i].label} 填入 ${v}（满${inputs[i].maxScore}）`);
        }

        // 同步平台合计（页面 oninput="countSum()" 之外兜底）
        try {
            if (win && typeof win.countSum === 'function') win.countSum();
        } catch (e) { /* ignore */ }

        return true;
    },

    // ---------- 提交 ----------
    // 等待提交限速冷却（checkZdpysxTime 未通过时 tjfs 会直接拒绝）
    async _waitRateLimit(win) {
        try {
            if (win && typeof win.zdpyxsCount === 'number' && win.zdpyxsCount > 0) {
                const sec = Math.min(win.zdpyxsCount, 60);
                console.log(`⏳ [九五优评] 提交限速冷却中，等待 ${sec} 秒...`);
                await new Promise(r => setTimeout(r, sec * 1000 + 300));
            }
        } catch (e) { /* ignore */ }
    },

    // 处理「打分确认」弹窗：找确定按钮点击；找不到按钮则以 qropen 重入 tjfs 兜底
    _confirmOnce(doc, win) {
        if (!doc) return false;
        try {
            const msg = doc.querySelector(JIUWUYOUPING_SELECTORS.CONFIRM_MSG);
            let scope = null;
            const visible = (el) => !!el && (el.offsetWidth > 0 || el.offsetHeight > 0);

            if (msg && visible(msg)) {
                scope = msg.closest('.layui-layer') || msg.parentElement;
            }
            if (!scope) {
                const layers = doc.querySelectorAll('.layui-layer');
                for (const l of layers) {
                    if (visible(l) && /确定为该学生打|打分确认/.test(l.textContent || '')) {
                        scope = l;
                        break;
                    }
                }
            }
            if (!scope) return false;

            // 找「确定」按钮
            const btns = scope.querySelectorAll('button, input[type="button"], input[type="submit"], a, div, span');
            for (const b of btns) {
                const t = String(b.value || b.textContent || '').trim();
                if (t === '确定' || t === '确认') {
                    b.click();
                    console.log('✅ [九五优评] 打分确认弹窗已自动点击「确定」');
                    return true;
                }
            }
            // 找不到按钮：置 qropen 后重入 tjfs（qropen 为真时 tjfs 跳过弹窗直接提交）
            if (win && typeof win.tjfs === 'function') {
                win.qropen = true;
                win.tjfs();
                console.log('✅ [九五优评] 未找到确认按钮，已以 qropen 重入 tjfs 提交');
                return true;
            }
        } catch (e) {
            console.warn('⚠️ [九五优评] 确认弹窗处理异常:', e.message);
        }
        return false;
    },

    async submitGrade() {
        const doc = this._getFrameDoc();
        const win = this._getFrameWin();
        if (!doc) {
            console.warn('⚠️ [九五优评] 无法访问 iframe 文档');
            return false;
        }
        const btn = doc.querySelector(JIUWUYOUPING_SELECTORS.SUBMIT_BUTTON);
        if (!btn) {
            console.warn('⚠️ [九五优评] 未找到提交按钮 #tjfsbtn');
            return false;
        }

        // 限速未冷却时 tjfs 会拒绝，先等
        await this._waitRateLimit(win);

        btn.click();
        console.log('📤 [九五优评] 已点击提交按钮');

        // 确认弹窗通常在 1 秒内出现，轮询 2 秒自动确认
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 200));
            if (this._confirmOnce(doc, win)) break;
        }
        return true;
    },

    async waitForNextPaper(oldImageUrl) {
        const oldPath = this._normalizeUrl(oldImageUrl) || this._getImagePath();
        const start = Date.now();
        const TIMEOUT = 40000;
        let retries = 0;

        console.log(`⏳ [九五优评] 等待下一份试卷...（旧图: ${(oldPath || '').split('/').pop()}）`);

        while (Date.now() - start < TIMEOUT) {
            await new Promise(r => setTimeout(r, 500));
            const doc = this._getFrameDoc();
            const win = this._getFrameWin();
            if (!doc) continue;

            // 弹窗兜底确认
            this._confirmOnce(doc, win);

            const curPath = this._getImagePath(doc);
            if (curPath && oldPath && curPath !== oldPath) {
                // 等平台数据就绪（tjfs 依赖 loadok）
                const waitStart = Date.now();
                while (Date.now() - waitStart < 5000) {
                    const w = this._getFrameWin();
                    if (!w || typeof w.loadok === 'undefined' || w.loadok === true) break;
                    await new Promise(r => setTimeout(r, 200));
                }
                console.log('✅ [九五优评] 下一份试卷已加载');
                return true;
            }

            // 限速导致提交未生效：仅在明确检测到冷却计数时重试，避免误提交
            let rateLimited = false;
            try {
                rateLimited = !!win && typeof win.zdpyxsCount === 'number' && win.zdpyxsCount > 0;
            } catch (e) { /* ignore */ }

            if (rateLimited && retries < 3 && Date.now() - start > 2500 && this._hasScoreValues(doc)) {
                retries++;
                console.log(`🔁 [九五优评] 检测到提交限速，第 ${retries} 次重试提交`);
                await this._waitRateLimit(win);
                const btn = doc.querySelector(JIUWUYOUPING_SELECTORS.SUBMIT_BUTTON);
                if (btn) {
                    btn.click();
                    await new Promise(r => setTimeout(r, 800));
                    this._confirmOnce(doc, win);
                }
            }
        }

        console.warn('⚠️ [九五优评] 等待下一份试卷超时');
        return false;
    },

    // ---------- 状态查询 ----------
    isRegradeMode() {
        // TODO: 回评模式特征待实测确认（页面常驻「回评」入口文案，不能按正文包含判断）
        return false;
    },
};

if (JiuwuyoupingAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = JiuwuyoupingAdapter;
}
