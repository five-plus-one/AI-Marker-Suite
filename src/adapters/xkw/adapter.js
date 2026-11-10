// ========== 学科网 e卷通 适配器 ==========
// 平台：学科网 e卷通（门户 ejt.xkw.com + 阅卷 yuejuan.xkw.com）
// 批改页：https://yuejuan.xkw.com/exam/marking/task/mark/{examId}?readType=1&dpi=200&num={题num}&topic={题num}
//
// 实测契约（2026-11-10，全程只读调研，详见 tmp/agn_xkw_report.md）：
// - 答题图：OSS 切题图（API studentPaperInfo.paperQuestions[].positions[].ossUrl，
//   `?x-oss-process=image/crop,x_..,y_..,w_..,h_..`）+ 整卷图（paperOssUrls[].ossUrl）。
//   同一图存在无后缀与 `/quality,q_80` 两个加载变体——**禁止整 URL 比较**（换卷判定只认 paperId）。
//   取图必须走 URL：答题区是 fabric canvas，跨域图已污染画布，toDataURL 抛 SecurityError。
//   OSS 无防盗链（实测无 Referer 亦 200），直接走核心 fetchImageAsBase64。
// - 打分框：打分表每题一行 `p.ques-score input.el-input__inner`（Vue el-input，type=number），
//   placeholder "满{N}分" 即该题满分；合批多小题时多行。
// - 提交：按钮「提交分数」→ 平台 submitScore → setGradingScore/updateGradingScore
//   （记分载荷含 resultId/judgeType/gradingTime；分数校验：null 或 < -1 拒绝，-1=异常卷）。
//   提交后平台自动加载下一份；"与一评有明显偏差"仅 toast 提示，非确认框。
// - 换卷强标识：答卷 resultId / paperId（OSS 文件名数字）。
// - 回评：API `isReview=1`（question-group/item 响应体）；DOM 无独立回评指示
//   （「试卷回评」是入口按钮而非状态，按文本匹配必误判）——无信号不猜，放行并告警（弱信号铁律）。
//
// 数据安全（铁律）：
// - fillScores 全或无（guangda #275 两遍式）：先全量校验 → 全部合法才写入 → 写后逐框验证；
//   任一失败显式 false，绝不半成功续走提交。
// - submitGrade 提交前空框拒绝（ruiya 同则）；找不到按钮显式 false。
// - 兜底取图宁可不取：API 记录与 resource timing 都拿不到当前卷证据时返回 []。

// 等待窗口：生产默认 25s；测试可经 window.__AI_MARKER_WAIT_WINDOW_MS__ 缩短（huahanyun 同款约定）
const XKW_WAIT_WINDOW_MS = (typeof window !== 'undefined' && window.__AI_MARKER_WAIT_WINDOW_MS__) || 25000;

const XkwAdapter = {
    name: '学科网e卷通',
    id: 'xkw',
    urlPatterns: ['*://ejt.xkw.com/*', '*://yuejuan.xkw.com/*'],
    iconUrl: '',

    // ---- 运行时状态 ----
    _lastItem: null,             // 最近一次 question-group/item 响应（resultId/paperId/cropUrls/fullUrls/isReview/at）
    _lastSubmitAt: null,         // 最近一次成功点击「提交分数」的时刻（新鲜度闸基准）
    _interceptorInstalled: false,

    // ========== 生命周期 ==========
    // 纯判定谓词（P3 规格）：绝不带副作用；API 拦截安装在注册 IIFE / onPageLoad
    shouldInitialize() {
        const h = window.location.hostname;
        return h === 'ejt.xkw.com' || h.endsWith('.ejt.xkw.com')
            || h === 'yuejuan.xkw.com' || h.endsWith('.yuejuan.xkw.com');
    },

    async detectMarkingPage() {
        // 强信号：批改路由（路径级）
        if (!XKW_SELECTORS.MARK_ROUTE_PATTERN.test(window.location.pathname)) return false;
        console.log('🔎 [XKW] 开始检测批改页面元素...');
        try {
            const result = await Promise.race([
                waitForElement(XKW_SELECTORS.SCORE_INPUT).then(() => 'score-input'),
                waitForElement(XKW_SELECTORS.ANSWER_BLOCK).then(() => 'answer-block'),
            ]).catch(() => null);
            if (result) {
                console.log(`✅ [XKW] 检测到批改页面元素: ${result}`);
                return true;
            }
            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 3000));
            const hasInput = document.querySelector(XKW_SELECTORS.SCORE_INPUT);
            const hasAnswer = document.querySelector(XKW_SELECTORS.ANSWER_BLOCK);
            const detected = !!(hasInput && hasAnswer);
            console.log(`🔎 [XKW] 兜底检测 — 打分框: ${!!hasInput}, 答题区: ${!!hasAnswer}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [XKW] detectMarkingPage 异常:', error);
            return false;
        }
    },

    // 答卷校验辅助：快速页面检查（paper-guard 用），只认路由不认 DOM
    isMarkingPage() {
        return XKW_SELECTORS.MARK_ROUTE_PATTERN.test(window.location.pathname);
    },

    onPageLoad() {
        // 幂等兜底（注：core 当前无 onPageLoad 调用点，安装主入口在注册 IIFE）
        this._installApiInterceptor();
        console.log('🚀 [XKW] 学科网e卷通适配器已加载');
    },

    // ========== 任务标识 ==========
    getTaskIdentifier() {
        // 任务 = 考试(examId 路径) + 批阅题(num/topic 参数)；同一题批阅组恒定
        const path = window.location.pathname;
        const params = new URLSearchParams(window.location.search);
        const num = params.get('num') || '';
        const topic = params.get('topic') || '';
        return `xkw_${path}_${num}_${topic}`;
    },

    // ========== 强试卷标识（答卷校验，#281 同则） ==========
    getPaperIdentity() {
        const cur = this._currentPaper();
        if (!cur) return ''; // 无标识零影响
        const item = this._lastItem;
        if (item && item.paperId === cur.paperId && item.resultId) {
            return `xkw_${item.resultId}_${item.paperId}`;
        }
        return `xkw_${cur.paperId}`;
    },

    // ========== API 拦截（只读记录，绝不改写请求/响应） ==========
    _installApiInterceptor() {
        if (this._interceptorInstalled) return;
        this._interceptorInstalled = true;
        const self = this;
        try {
            const origSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.send = function (...args) {
                try {
                    this.addEventListener('load', function () {
                        try {
                            const u = this.responseURL || '';
                            if (u.indexOf(XKW_SELECTORS.ITEM_API_HINT) !== -1) {
                                self._ingestItem(this.responseText);
                            }
                        } catch (_) { /* 拦截失败绝不影响平台 */ }
                    });
                } catch (_) { /* 忽略 */ }
                return origSend.apply(this, args);
            };
        } catch (e) {
            console.warn('⚠️ [XKW] XHR 拦截安装失败（取图退回 resource timing）:', e);
        }
        try {
            const origFetch = window.fetch;
            window.fetch = function (...args) {
                const p = origFetch.apply(this, args);
                try {
                    p.then(res => {
                        try {
                            if ((res.url || '').indexOf(XKW_SELECTORS.ITEM_API_HINT) !== -1 && typeof res.clone === 'function') {
                                res.clone().text().then(t => self._ingestItem(t)).catch(() => {});
                            }
                        } catch (_) { /* 忽略 */ }
                    }).catch(() => {});
                } catch (_) { /* 忽略 */ }
                return p;
            };
        } catch (e) {
            console.warn('⚠️ [XKW] fetch 拦截安装失败:', e);
        }
    },

    _ingestItem(text) {
        // question-group/item 响应契约（实测）：
        // body.isReview: 0|1；body.studentPaperInfo.{resultId, paperOssUrls[], paperQuestions[].positions[].ossUrl}
        try {
            const data = JSON.parse(text);
            const body = data && data.body;
            const info = body && body.studentPaperInfo;
            if (!info) return;
            const positions = [];
            (info.paperQuestions || []).forEach(q => {
                (q.positions || []).forEach(p => {
                    if (p && typeof p.ossUrl === 'string' && p.ossUrl) {
                        positions.push({ order: Number(p.orderNum) || 0, url: p.ossUrl });
                    }
                });
            });
            positions.sort((a, b) => a.order - b.order);
            const fullUrls = (info.paperOssUrls || [])
                .filter(x => x && x.absent !== true && typeof x.ossUrl === 'string' && x.ossUrl)
                .map(x => x.ossUrl);
            this._lastItem = {
                resultId: info.resultId ? String(info.resultId) : null,
                paperId: XkwAdapter._paperIdFromUrl(fullUrls[0] || (positions[0] && positions[0].url) || ''),
                cropUrls: positions.map(p => p.url),
                fullUrls,
                isReview: body.isReview === 1,
                at: Date.now(),
            };
        } catch (_) { /* 非 JSON / 结构不符：忽略，不影响平台 */ }
    },

    // ========== 取图证据源 ==========
    // OSS URL → paperId（文件名数字，强标识）。无 .jpg 文件名 → ''（无标识零影响）。
    _paperIdFromUrl(url) {
        const m = String(url || '').match(XKW_SELECTORS.OSS_PAPER_ID_RE);
        return m ? m[1] : '';
    },

    _latestOssPaperFromResources() {
        // resource timing 里的 OSS 图加载记录（含切题图/整卷图）；
        // 跨源条目不暴露 timing 细节但 name（URL）始终可读。
        let out = null;
        try {
            const entries = (typeof performance !== 'undefined' && performance.getEntriesByType)
                ? performance.getEntriesByType('resource') : [];
            for (const e of entries) {
                const n = e.name || '';
                if (n.indexOf(XKW_SELECTORS.OSS_HOST_HINT) === -1) continue;
                const pid = XkwAdapter._paperIdFromUrl(n);
                if (!pid) continue;
                const at = (performance.timeOrigin || 0) + (e.startTime || 0);
                if (!out || at >= out.at) out = { paperId: pid, at };
            }
        } catch (_) { /* performance 不可用则只依赖 API 记录 */ }
        return out;
    },

    // 当前卷判定：API 记录与 resource timing 取「绝对时间更晚」的一份证据。
    // 防两类错卷：① resource buffer 满后新图不再入账（旧证据）；② 拦截漏掉新 item（旧记录）。
    // since（新鲜度闸）：只认该时刻之后出现的证据——拦截源与 resource 源同持旧卷证据（双源同腐）时返回 null。
    _currentPaper(since) {
        const res = this._latestOssPaperFromResources();
        const item = this._lastItem;
        const itemOk = !!(item && item.paperId && (!since || item.at > since));
        const resOk = !!(res && (!since || res.at > since));
        if (itemOk && (!resOk || item.at >= res.at)) {
            return { paperId: item.paperId, at: item.at, source: 'api' };
        }
        if (resOk) {
            return { paperId: res.paperId, at: res.at, source: 'resource' };
        }
        return null;
    },

    _cropUrlsFromResources(paperId) {
        if (!paperId) return [];
        const seen = new Map(); // position → url（优先无 /quality 后缀的原切图）
        try {
            const entries = (typeof performance !== 'undefined' && performance.getEntriesByType)
                ? performance.getEntriesByType('resource') : [];
            for (const e of entries) {
                const n = e.name || '';
                if (n.indexOf(XKW_SELECTORS.OSS_HOST_HINT) === -1) continue;
                if (n.indexOf(XKW_SELECTORS.OSS_CROP_HINT) === -1) continue;
                if (n.indexOf('/' + paperId + '.jpg') === -1) continue;
                const m = n.match(XKW_SELECTORS.OSS_POSITION_RE);
                const key = m ? m[0] : n;
                const prefer = n.indexOf('/quality') === -1;
                if (!seen.has(key) || prefer) seen.set(key, n);
            }
        } catch (_) { /* 忽略 */ }
        return [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(x => x[1]);
    },

    // ========== 图片获取 ==========
    async gatherAnswerImages() {
        // 新鲜度闸（双源同腐防护）：提交后只认提交时刻之后的证据——
        // 拦截记录与 resource timing 同持旧卷证据时（如提交后 _lastItem 未刷新且
        // resource buffer 已满不再入账新图），旧卷图绝不喂 AI，宁可不取
        const cur = this._currentPaper(this._lastSubmitAt);
        const item = this._lastItem;
        const itemFresh = !!(cur && item && item.paperId === cur.paperId
            && (!this._lastSubmitAt || item.at > this._lastSubmitAt));

        if (!cur && this._lastSubmitAt) {
            console.warn('⚠️ [XKW] 提交后未见新卷证据（双源同腐防护），旧卷图不喂 AI，宁可不取');
            return [];
        }

        // ① API 契约图（切题图，按 orderNum 排序）——最准
        if (itemFresh && item.cropUrls.length > 0) {
            console.log(`🖼️ [XKW] 答题图 ${item.cropUrls.length} 张（API 契约，paperId=${item.paperId}）`);
            return item.cropUrls.slice();
        }
        // ② resource timing 当前卷切题图（去 /quality,q_80 变体）
        const urls = this._cropUrlsFromResources(cur && cur.paperId);
        if (urls.length > 0) {
            console.log(`🖼️ [XKW] 答题图 ${urls.length} 张（resource timing，paperId=${cur.paperId}）`);
            return urls;
        }
        // ③ 整卷图兜底（仍是本卷真实图；切题坐标缺失时宁可用整卷也不用错卷）
        if (itemFresh && item.fullUrls.length > 0) {
            console.log(`🖼️ [XKW] 切题图缺失，回退整卷图 ${item.fullUrls.length} 张（paperId=${item.paperId}）`);
            return item.fullUrls.slice();
        }
        // ④ 宁可不取（批错卷比空图严重）
        console.warn('⚠️ [XKW] 未取到当前卷答题图（API 记录与 resource timing 均无证据），宁可不取');
        return [];
    },

    async fetchImageAsBase64(url) {
        // OSS 无防盗链（实测无 Referer 200），直接走核心（含瞬态重试与显式失败）
        return fetchImageAsBase64(url);
    },

    // ========== 分数输入 ==========
    getScoreInputs() {
        const inputs = [];
        document.querySelectorAll(XKW_SELECTORS.SCORE_BLOCK).forEach((block, i) => {
            const el = block.querySelector('input.el-input__inner');
            if (!el) return;
            const row = block.closest('tr');
            const labelEl = row ? row.querySelector(XKW_SELECTORS.QUESTION_LABEL) : null;
            const label = labelEl ? labelEl.textContent.trim() : `题${i + 1}`;
            inputs.push({
                element: el,
                label: label || `题${i + 1}`,
                index: inputs.length,
                maxScore: this._maxScoreFromInput(el),
            });
        });
        return inputs;
    },

    _maxScoreFromInput(el) {
        const ph = el.getAttribute('placeholder') || '';
        const m = ph.match(XKW_SELECTORS.MAX_SCORE_PLACEHOLDER_RE);
        return m ? parseFloat(m[1]) : 0;
    },

    // ========== 分数填入（全或无 + 写后验证，guangda #275 两遍式） ==========
    fillScores(scores) {
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) {
            console.warn('⚠️ [XKW] 未找到分数输入框，拒绝填分');
            return false;
        }
        // 全或无契约（38 家同则）：个数不一致（少给/多给）一律显式拒绝，多给的分不静默截断
        if (!Array.isArray(scores) || scores.length !== inputs.length) {
            console.warn(`⚠️ [XKW] 分数个数(${scores ? scores.length : 0})与输入框数(${inputs.length})不一致（多给/少给均拒绝），拒绝填分`);
            return false;
        }

        // 第一遍：全量校验，任一不合法整体拒绝
        for (let i = 0; i < inputs.length; i++) {
            const s = scores[i];
            if (s === null || s === undefined) {
                console.warn(`⚠️ [XKW] ${inputs[i].label} 无 AI 分数（第 ${i + 1} 个缺失），拒绝填分`);
                return false;
            }
            const n = Number(s);
            if (!Number.isFinite(n)) {
                console.warn(`⚠️ [XKW] ${inputs[i].label} 分数 "${s}" 非数值，拒绝填分`);
                return false;
            }
            if (n < 0 || (inputs[i].maxScore > 0 && n > inputs[i].maxScore)) {
                console.warn(`⚠️ [XKW] ${inputs[i].label} 分数 ${n} 越界 [0, ${inputs[i].maxScore || '∞'}]，拒绝填分`);
                return false;
            }
        }

        // 第二遍：写入（el-input 是 Vue 组件：原生 setter + 事件链）
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        for (let i = 0; i < inputs.length; i++) {
            const el = inputs[i].element;
            const v = String(scores[i]);
            setter.call(el, v);
            ['input', 'change', 'blur'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
            console.log(`✅ [XKW] ${inputs[i].label} 分数 ${v} 已填入`);
        }

        // 第三遍：写后验证，任一未落值显式失败
        for (let i = 0; i < inputs.length; i++) {
            const val = String(inputs[i].element.value ?? '').trim();
            if (val !== String(scores[i])) {
                console.error(`❌ [XKW] ${inputs[i].label} 写后校验失败（期望 ${scores[i]}，实际 "${val}"），拒绝提交`);
                return false;
            }
        }
        return true;
    },

    fillScore(request) {
        // 旧接口兼容：统一走 fillScores 的全或无语义（禁半成功回流）
        const { total, subScores } = request || {};
        if (subScores && subScores.length > 0) {
            return this.fillScores(subScores.map(s => s.score));
        }
        return this.fillScores([total]);
    },

    // ========== 提交 ==========
    submitGrade() {
        // 空框拒绝（ruiya 同则）：任何输入框为空都不提交（空分进平台=事故）
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) {
            console.warn('⚠️ [XKW] 未找到分数输入框，拒绝提交');
            return false;
        }
        for (const it of inputs) {
            if (String(it.element.value ?? '').trim() === '') {
                console.warn(`⚠️ [XKW] ${it.label} 分数框为空，拒绝提交空分`);
                return false;
            }
        }
        const btns = this._findSubmitButtons();
        // 禁用检查（disabled / aria-disabled）：禁用按钮点击无动作，return true 是假成功
        const usable = b => !b.disabled && b.getAttribute('aria-disabled') !== 'true';
        const btn = btns.find(b => usable(b) && b.getClientRects().length > 0)
            || btns.find(usable)
            || null;
        if (!btn) {
            if (btns.length > 0) {
                console.warn('⚠️ [XKW] 「提交分数」按钮处于禁用状态，拒绝假成功（显式失败）');
            } else {
                console.warn('⚠️ [XKW] 未找到「提交分数」按钮，提交显式失败');
            }
            return false;
        }
        // 记录提交时刻：此后取图只认提交后的新证据（双源同腐防护）
        this._lastSubmitAt = Date.now();
        btn.click();
        console.log('✅ [XKW] 已点击「提交分数」');
        return true;
    },

    _findSubmitButtons() {
        // 提交控件实测为 <span class="set-btn">提交分数</span>（非 button 标签，教师实测"找不到提交按钮"）——
        // 放宽到任意元素 + 叶子节点精确文本匹配（排除同文本的包裹容器），按钮/链接/span 通吃
        const nodes = document.querySelectorAll('button, .set-btn, span, a, div');
        return Array.from(nodes).filter(el => {
            if (el.children && el.children.length > 0) return false; // 叶子节点（桩无 children 属性按叶子处理）
            const t = (el.textContent || '').replace(/\s/g, '');
            return t === XKW_SELECTORS.SUBMIT_BUTTON_TEXT.replace(/\s/g, '');
        });
    },

    async waitForNextPaper(oldImageUrl) {
        // 换卷判定：**paperId 主判**（OSS 文件名强标识），不比整 URL（同卷有 /quality,q_80 变体）。
        // resultId 是记分主键，同卷重记（重评/二评同卷新 resultId）会变——**只作 tiebreak**：
        // 同 paperId 下 resultId 变化 = 重记不换卷；仅在双侧全无 paperId 证据时才允许 resultId 兜底。
        // 单侧缺 paperId 证据一律不判换卷（宁等勿错，#315 同则：fail-open 会同卷重复批改）。
        const oldPaperId = XkwAdapter._paperIdFromUrl(oldImageUrl || '');
        const startPaper = this._currentPaper();
        const basePaperId = oldPaperId || (startPaper ? startPaper.paperId : '');
        const baseResultId = (this._lastItem && this._lastItem.resultId) || '';
        const maxChecks = Math.max(1, Math.round(XKW_WAIT_WINDOW_MS / 200));
        let checkTimes = 0;
        return new Promise((resolve) => {
            const timer = setInterval(() => {
                checkTimes++;
                try {
                    const cur = this._currentPaper();
                    const curPaperId = cur ? cur.paperId : '';
                    let changed = false;
                    if (basePaperId && curPaperId) {
                        // paperId 主判：resultId 不参与（同卷重记不换卷）
                        changed = curPaperId !== basePaperId;
                    } else if (basePaperId || curPaperId) {
                        // 单侧缺 paperId 证据：不判换卷（宁等勿错）
                        changed = false;
                    } else {
                        // 双侧全无 paperId 证据：resultId 仅作 tiebreak（弱证据兜底）
                        const curResultId = (this._lastItem && !this._lastItem.paperId && this._lastItem.resultId) || '';
                        changed = !!(baseResultId && curResultId && curResultId !== baseResultId);
                    }
                    if (changed) {
                        clearInterval(timer);
                        console.log('✅ [XKW] 新答卷已加载');
                        resolve(true);
                    } else if (checkTimes >= maxChecks) {
                        clearInterval(timer);
                        console.warn('⚠️ [XKW] 等待下一份答卷超时');
                        resolve(false);
                    }
                } catch (e) {
                    clearInterval(timer);
                    console.warn('⚠️ [XKW] waitForNextPaper 异常，显式失败:', e);
                    resolve(false);
                }
            }, 200);
        });
    },

    // ========== 状态查询 ==========
    isRegradeMode() {
        // 强信号：API 契约 body.isReview===1。DOM 无独立回评指示（「试卷回评」是入口按钮
        // 而非状态，文本匹配必误判全站）——无信号不猜，放行（弱信号铁律：无法判定一律放行并告警）
        if (this._lastItem && this._lastItem.isReview) {
            console.log('ℹ️ [XKW] 检测到回评模式（API isReview=1）');
            return true;
        }
        return !!window.aiGradingState?.isRegrading;
    },

    // 旧接口兼容（deprecated）：按打分表行导出小题
    detectSubQuestions() {
        return this.getScoreInputs().map(x => ({
            label: x.label,
            element: x.element,
            index: x.index,
        }));
    },
};

// 注册必须守卫（#324 教训：无守卫注册会劫持其他平台会话）；
// 初始化钩子副作用放这里（shouldInitialize 保持纯判定）：
// 尽早装 API 拦截——SPA 路由切换不重载文档，装载即安装可覆盖批改页首次取题
if (XkwAdapter.shouldInitialize()) {
    XkwAdapter._installApiInterceptor();
    window.__AI_MARKER_ADAPTER__ = XkwAdapter;
}
