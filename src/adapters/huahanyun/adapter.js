// 华翰云云阅卷适配器（鹿城 yj.lcedu.net.cn、温州 yuejuan.wzedu.cn）
// 平台特征：单题块单分框——一个阅卷任务=一个题块（如"书写 7(4分)"），一个 #compuinput 分数框
// 答卷图=OBS 题块裁剪图：obsyj.{域}/.../student/{考生号}/{hash}/{questionId}.png?X-Amz-签名
//   → 考生号在 URL 路径里 = 强换卷信号（同卷签名抖动只在 query，路径不变）（#301）
(function () {
    'use strict';

    const HY_HELPERS = {
        isWenzhou() {
            return (location.hostname || '').toLowerCase() === 'yuejuan.wzedu.cn';
        },

        isKnownHost() {
            const host = (location.hostname || '').toLowerCase();
            return HY_HELPERS.isWenzhou() || host === 'lcedu.net.cn' || host.endsWith('.lcedu.net.cn');
        },

        // 温州生产页面暴露 Vue 应用的 Vuex store；只读取阅卷状态，通过既有 mutation 填分。
        // SET_SCOREING 仅更新分数；键盘 input 事件会触发平台的快捷提交，不能用于试改填分。
        wenzhouStore() {
            if (!HY_HELPERS.isWenzhou()) return null;
            const pageWindow = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
            return pageWindow.document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$store || null;
        },

        scoreInput() {
            return document.querySelector(HY_HELPERS.isWenzhou()
                ? window.HUAHANYUN_SELECTORS.WENZHOU_SCORE_INPUT : window.HUAHANYUN_SELECTORS.SCORE_INPUT);
        },

        // 真可见答卷图（#306）：el-image 换卷过渡期常新旧图并存——隐藏残留/离屏预载
        // 能骗过尺寸过滤，必须用 checkVisibility（opacity/visibility/content-visibility）
        // + 计算样式兜底剔除；只留"真可见"的大图
        getVisibleAnswerImages() {
            const imgs = document.querySelectorAll(window.HUAHANYUN_SELECTORS.ANSWER_IMAGE);
            const out = [];
            for (const img of imgs) {
                const src = img.getAttribute('src') || '';
                if (!src || src.indexOf('data:') === 0) continue;
                const r = img.getBoundingClientRect();
                if (r.width < 50 || r.height < 50) continue;
                if (typeof img.checkVisibility === 'function') {
                    if (!img.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) continue;
                } else if (typeof getComputedStyle === 'function') {
                    const cs = getComputedStyle(img);
                    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.1) continue;
                }
                out.push({ img, src, area: r.width * r.height });
            }
            return out;
        },

        // 主答卷图：真可见中取最大面（过渡期旧图残留时取新主图）
        getVisibleAnswerImage() {
            const list = HY_HELPERS.getVisibleAnswerImages();
            if (list.length === 0) return null;
            let best = list[0];
            for (const it of list) { if (it.area > best.area) best = it; }
            return best;
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
        name: HY_HELPERS.isWenzhou() ? '温州云阅卷' : '云阅卷(华翰云)',
        platformKey: 'huahanyun',
        version: '1.0.0',

        shouldInitialize() {
            return HY_HELPERS.isKnownHost() && this._hasDomSignature();
        },

        // 三特征识别（#284 防串台）：批改路由 + 分数框 + 给分按钮
        _hasDomSignature() {
            return /#\/marking\/grading(\?|$)/.test(location.hash)
                && !!HY_HELPERS.scoreInput()
                && !!document.querySelector(window.HUAHANYUN_SELECTORS.SUBMIT_BUTTON);
        },

        async detectMarkingPage() {
            return this._hasDomSignature();
        },

        // 同步快检（#312）：供核心"离开批改页清理"与快速路径使用（DOM 三特征，O(1) 查询）
        isMarkingPage() {
            return this._hasDomSignature();
        },

        // 任务标识：URL questionId（稳定）
        getTaskIdentifier() {
            if (HY_HELPERS.isWenzhou()) {
                const params = new URLSearchParams(location.hash.split('?')[1] || '');
                return `huahanyun#wzedu#${params.get('questionId') || ''}#${params.get('choiceIndex') || '0'}`;
            }
            const m = location.hash.match(/questionId=(\d+)/);
            return m ? `huahanyun#${m[1]}` : `huahanyun#${location.hash.split('?')[0]}`;
        },

        isRegradeMode() {
            if (HY_HELPERS.isWenzhou()) {
                const params = new URLSearchParams(location.hash.split('?')[1] || '');
                const state = HY_HELPERS.wenzhouStore()?.state?.mark;
                if (['review', 'markReview', 'readonly'].some(key => params.get(key) === 'true')
                    || state?.markReview || state?.reviewProps?.review || state?.reviewProps?.readonly) return true;
            }
            // #312：委托核心回评态——此前恒 false 会短路核心自身的 isRegrading，
            // 导致回评面板开着时仍跑新题引导（方案切换+OOBE 叠加）。
            // 平台自身回评 URL 语义（thisType）仍待真机复现，暂无额外识别
            return !!(window.aiGradingState && window.aiGradingState.isRegrading);
        },

        // 单题块单分框：一个任务一个分框（label/满分取自面板标题「书写 7(4分)」）
        getScoreInputs() {
            const el = HY_HELPERS.scoreInput();
            if (!el) return [];
            if (HY_HELPERS.isWenzhou()) {
                const state = HY_HELPERS.wenzhouStore()?.state?.mark;
                // 合批、分项、批量和批注给分需独立评分模型，单题适配仅接管键盘/一键给分。
                if (state && (state.haveJoin || state.IsSubItemscoring || state.batchGrading
                    || ![1, 2].includes(Number(state.markingType)))) return [];
                const question = state?.readOverInfo?.question;
                if (question) return [{ element: el, label: question.questionName || '本题',
                    maxScore: Number(question.score) || 0, index: 0 }];
            }
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
            if (HY_HELPERS.isWenzhou() && (!this.isMarkingPage() || this.isRegradeMode())) return false;
            const inputs = this.getScoreInputs();
            if (inputs.length === 0) return false;
            if (!Array.isArray(scores) || scores.length === 0) return false;
            if (scores.length > 1) {
                // 单题块任务收到多分 = 配置错位，拒绝（宁停不带病）
                console.warn(`⚠️ [云阅卷华翰云] 分数个数(${scores.length})>1 但任务为单题块（配置错位）→ 拒绝`);
                return false;
            }
            const score = scores[0];
            if (typeof score !== 'number' && (typeof score !== 'string' || !score.trim())) {
                console.warn(`⚠️ [云阅卷华翰云] 无 AI 分数 → 拒绝`);
                return false;
            }
            // 数值闸（#312 A3）：NaN/负分/越界不得直写输入框（"NaN" 会同步校验通过进平台）
            const num = Number(score);
            const maxScore = inputs[0].maxScore;
            if (!isFinite(num) || num < 0 || (maxScore > 0 && num > maxScore)) {
                console.warn(`⚠️ [云阅卷华翰云] 分数非法（${score}，满分 ${maxScore || '未知'}）→ 拒绝`);
                return false;
            }
            const input = inputs[0];
            if (HY_HELPERS.isWenzhou()) {
                const store = HY_HELPERS.wenzhouStore();
                if (!store || typeof store.commit !== 'function') return false;
                store.commit('mark/SET_SCOREING', num);
                if (store.state.mark.questionScore !== num) return false;
                // Vue 在下一次渲染更新控件；同步写入展示值供核心即时校验，不派发快捷提交事件。
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input.element, String(num));
                const info = store.state.mark.readOverInfo;
                this._wenzhouFill = { studentId: info.studentId, sheetId: info.sheetId,
                    questionId: info.questionId, score: num, task: this.getTaskIdentifier(),
                    identity: this.getPaperIdentity() };
            } else HY_HELPERS.setNativeValue(input.element, num);
            if (String(input.element.value) !== String(num)) {
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
        submitGrade(guard) {
            if (HY_HELPERS.isWenzhou() && (!this.isMarkingPage() || this.isRegradeMode()
                || this.getScoreInputs().length !== 1)) return false;
            const buttons = Array.from(document.querySelectorAll(window.HUAHANYUN_SELECTORS.SUBMIT_BUTTON));
            const btn = HY_HELPERS.isWenzhou() ? buttons.find(el => el.getClientRects().length > 0)
                : document.querySelector(window.HUAHANYUN_SELECTORS.SUBMIT_BUTTON);
            if (!btn) {
                console.warn('⚠️ [云阅卷华翰云] 未找到给分按钮 → 拒绝提交');
                return false;
            }
            if (btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.classList?.contains('is-loading')) {
                console.warn('⚠️ [云阅卷华翰云] 给分按钮禁用 → 拒绝提交');
                return false;
            }
            if (HY_HELPERS.isWenzhou()) return this._submitWenzhou(btn, guard);
            btn.click();
            return true;
        },

        // 保留平台按钮生成请求，等同卷同分的保存回执后才让核心记账、换卷。
        // 仅在本次提交期间观察页面 XHR；不重试保存，避免回执丢失时重复给分。
        async _submitWenzhou(btn, guard = {}) {
            if (this._wenzhouSubmitting) return false;
            this._wenzhouSubmitting = true;
            try {
                if (guard.verify) await guard.verify();
                const pending = this._wenzhouFill;
                const state = HY_HELPERS.wenzhouStore()?.state?.mark;
                const info = state?.readOverInfo;
                if (!pending?.identity || !info || guard.signal?.aborted || guard.isCurrent?.() === false
                    || pending.task !== this.getTaskIdentifier() || pending.identity !== this.getPaperIdentity()
                    || pending.score !== state.questionScore
                    || ['studentId', 'sheetId', 'questionId'].some(key => pending[key] == null
                        || String(pending[key]) !== String(info[key]))) return false;
                const pageWindow = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
                const proto = pageWindow.XMLHttpRequest?.prototype;
                if (!proto) return false;
                return await new Promise(resolve => {
                    const originalOpen = proto.open, originalSend = proto.send;
                    const candidates = new WeakSet();
                    let settled = false, observed = null;
                    const restore = () => {
                        if (proto.open === open) proto.open = originalOpen;
                        if (proto.send === send) proto.send = originalSend;
                    };
                    const finish = ok => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timer); restore();
                        guard.signal?.removeEventListener('abort', cancelled);
                        if (observed) for (const type of ['load', 'error', 'timeout', 'abort']) {
                            observed.removeEventListener(type, type === 'load' ? loaded : cancelled);
                        }
                        resolve(ok);
                    };
                    const cancelled = () => finish(false);
                    const loaded = () => {
                        try {
                            const body = observed.responseType === 'json' ? observed.response
                                : JSON.parse(observed.responseText);
                            const result = body?.data;
                            finish(observed.status >= 200 && observed.status < 300 && body?.code === 200
                                && (result?.exist === true || (result?.exist === false && result.resultType === 1)));
                        } catch (_) { finish(false); }
                    };
                    function open(method, url, ...args) {
                        try {
                            const target = new URL(url, pageWindow.location.href);
                            if (String(method).toUpperCase() === 'POST' && target.origin === new URL(pageWindow.location.href).origin
                                && /^\/v2\/(?:union|exam)\/mark\/submit$/.test(target.pathname)) candidates.add(this);
                        } catch (_) { /* 其他请求继续原有行为 */ }
                        return originalOpen.call(this, method, url, ...args);
                    }
                    function send(body) {
                        if (!settled && !observed && candidates.has(this)) {
                            try {
                                const request = JSON.parse(body);
                                if (['studentId', 'sheetId', 'questionId', 'score'].every(key =>
                                    request[key] != null && String(request[key]) === String(pending[key]))) {
                                    observed = this;
                                    for (const type of ['load', 'error', 'timeout', 'abort']) {
                                        this.addEventListener(type, type === 'load' ? loaded : cancelled);
                                    }
                                    restore();
                                }
                            } catch (_) { /* 只接受平台生成的同卷评分请求 */ }
                        }
                        return originalSend.call(this, body);
                    }
                    const timer = setTimeout(cancelled, 15000);
                    guard.signal?.addEventListener('abort', cancelled, { once: true });
                    try { proto.open = open; proto.send = send; btn.click(); }
                    catch (_) { finish(false); }
                });
            } finally { this._wenzhouSubmitting = false; }
        },

        // 取图（#312 A1 单考生一致性）：只取带考生号的题块图，且**可见集必须同属一个考生**——
        // 混入他人图/头像（el-image 通用类）时整体拒绝（宁可不取，防错卷喂 AI）
        async gatherAnswerImages() {
            if (HY_HELPERS.isWenzhou() && !this.isMarkingPage()) return [];
            const keyed = HY_HELPERS.getVisibleAnswerImages()
                .map(it => ({ it, key: HY_HELPERS.extractStudentKey(it.src) }))
                .filter(x => x.key);
            const keys = new Set(keyed.map(x => x.key));
            if (keys.size === 0) return [];
            if (keys.size > 1) {
                console.warn(`⚠️ [云阅卷华翰云] 可见图考生号不一致（${[...keys].join(',') }）→ 拒绝取图（宁可不取）`);
                return [];
            }
            return keyed.map(x => x.it.src);
        },

        // 换卷判定（#306 集合退出语义 + #309 阻塞式窗口 + #312 正向证据）：
        // 全仓适配器契约为**阻塞式等待**——内部轮询至窗口结束（默认 25s 与全仓对齐），
        // 旧考生号退出**且考生号图集非空**（新卷图已出现）才返回 true；窗口耗尽才 false 交 core 重试。
        // 此前的瞬时快照检查违反该契约：提交瞬间平台尚未换图 → 必报一次"等待超时"
        async waitForNextPaper(oldImageUrl) {
            // 空旧图无从比较（#315 G5）：宁等勿错——fail-open 会同卷重复批改
            if (!oldImageUrl) return false;
            const win = Number(window.__AI_MARKER_WAIT_WINDOW_MS__);
            const windowMs = (isFinite(win) && win > 0) ? win : 25000;
            const tick = Math.max(50, Math.min(500, Math.floor(windowMs / 5)));
            const deadline = Date.now() + windowMs;
            while (true) {
                const cur = HY_HELPERS.getVisibleAnswerImages();
                const oldKey = HY_HELPERS.extractStudentKey(oldImageUrl);
                if (oldKey) {
                    // 强标识路径（#312 正向证据）：只认考生号图（旁图/头像不参与判定），
                    // 考生号图非空且旧考生号退出 → 换卷成立（可见集只含新卷，防混图喂 AI）
                    const keyed = cur.map(it => ({ it, key: HY_HELPERS.extractStudentKey(it.src) })).filter(x => x.key);
                    if (keyed.length > 0) {
                        let oldStillThere = false;
                        for (const x of keyed) {
                            if (x.key === oldKey) { oldStillThere = true; break; }
                        }
                        if (!oldStillThere && new Set(keyed.map(x => x.key)).size === 1) return true;
                    }
                } else {
                    // 兜底：考生号提取失败（非标准 URL）——按路径集合判定（拿不准宁可等待）
                    if (cur.length > 0) {
                        const oldPath = HY_HELPERS.normalizePath(oldImageUrl);
                        let oldStillThere = false;
                        for (const it of cur) {
                            if (HY_HELPERS.normalizePath(it.src) === oldPath) { oldStillThere = true; break; }
                        }
                        if (!oldStillThere) return true;
                    }
                }
                if (Date.now() >= deadline) return false;
                await new Promise(r => setTimeout(r, tick));
            }
        },

        // 纸卷身份：考生号（换卷必变、同卷签名抖动不变）（#281 强信号）
        getPaperIdentity() {
            if (HY_HELPERS.isWenzhou()) {
                if (!this.isMarkingPage()) return null;
                const keys = new Set(HY_HELPERS.getVisibleAnswerImages()
                    .map(it => HY_HELPERS.extractStudentKey(it.src)).filter(Boolean));
                return keys.size === 1 ? [...keys][0] : null;
            }
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

    // 注册守卫（#324 P0 + strict-a 附 A.0）：自查 shouldInitialize → 先到先得（不覆盖）→
    // 已注册且我也认领本页 = 多命中冲突，console.error 红灯告警（静默劫持变可见）→ 异常 fail-closed。
    // 此前无条件注册且本模块在 bundle 末位，导致所有平台页面被本适配器劫持。
    // 返回值：true=已处置（认领/让位/异常），false=不认领本页
    function tryRegisterHuahanyun() {
        try {
            if (!adapter.shouldInitialize()) return false;
            const existing = window.__AI_MARKER_ADAPTER__;
            if (existing) {
                if (existing === adapter) return true;
                console.error(`🚫 [注册冲突] ${existing.name} 已注册，但 云阅卷(华翰云)(huahanyun) 也认领本页（疑似串台/劫持），保留先到者`);
                return true;
            }
            window.__AI_MARKER_ADAPTER__ = adapter;
            return true;
        } catch (e) {
            console.warn('⚠️ [注册] 判定异常，fail-closed 不注册:', e);
            return true;
        }
    }

    if (!tryRegisterHuahanyun()) {
        // 已知宿主的列表页可通过 SPA 进入阅卷页；路由与 DOM 就绪后再按完整条件注册。
        try {
            if (HY_HELPERS.isKnownHost() && typeof MutationObserver === 'function') {
                const tryLater = () => {
                    if (tryRegisterHuahanyun()) {
                        obs.disconnect(); window.removeEventListener('hashchange', tryLater);
                    }
                };
                const obs = new MutationObserver(tryLater);
                obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
                // 列表页可能停留很久；路由和 DOM 每次仍由 shouldInitialize 严格验证。
                window.addEventListener('hashchange', tryLater);
                tryLater();
            }
        } catch (e) { /* fail-closed：观察失败即不注册 */ }
    }
})();
