// ========== 睿芽考试服务云平台阅卷适配器 ==========
// ASP.NET WebForms + jQuery + Bootstrap + iCheck
// 域名: ruiya.onlyets.com，阅卷页: /mark/v6/view/<32位GUID>
//
// 与威科姆（wyna.onlyets.com）同为厂商 CampusManage/MarkClient 代码，DOM 一致，
// 但本适配器独立维护（不修改 wuyuetong），并修正其以下缺陷：
//   1. 页头恒有「回 评」链接 → 回评判定必须用 #reviewPanel 可见性，不能搜页面文字
//   2. 任务标识用 pathname（剔除 query/cachebuster），不用 location.href
//   3. 「输入框为空」不能单独作为翻卷证据，更不能把 "0" 当空（0 分是合法分值）
//   4. 满分解析用 parseFloat（威科姆的 parseInt 会把 4.5 截成 4）
//
// 范围：仅常规键盘打分模式（#rdKeyboard），支持一页 1..N 个 .ipt_score 顺次填分
// 平台提交语义：点击 #submitMark → Mark.submitKeyboard($('#panelKey').find('input:text'), true)
//   该函数直接读 DOM .value，故原生 setter 赋值 + 事件即可生效
//   页面 Enter 键处理器已 return false（不再提交），必须点按钮

const RUIYA_TIMING = {
    IMAGE_POLL_MS: 250,
    IMAGE_STABLE_HITS: 2,          // 连续 2 次同 src 且 naturalWidth>0 ≈ 500ms 稳定
    IMAGE_TIMEOUT_MS: 10000,
    DETECT_TIMEOUT_MS: 12000,
    NEXT_PAPER_TIMEOUT_MS: 26000,
    NEXT_PAPER_POLL_MS: 250,
    NEXT_PAPER_GRACE_MS: 1500,     // 宽限期内不认「输入框被清空」
    NEXT_PAPER_EMPTY_HITS: 3,      // 连续 3 次全空 ≈ 750ms
    MODAL_WATCH_MS: 3000,
    MODAL_WATCH_POLL_MS: 200,
    // 资源时间线兜底：默认关闭（宁可返回空图，不可批错卷）
    ALLOW_RESOURCE_FALLBACK: false,
};

const RuiyaAdapter = {
    name: '睿芽阅卷',
    id: 'ruiya',
    urlPatterns: ['*://ruiya.onlyets.com/*'],
    iconUrl: '',

    // ---------- 宿主判定 ----------
    shouldInitialize() {
        const h = (window.location.hostname || '').toLowerCase();
        // 精确匹配：不能吞掉 wyna.onlyets.com（威科姆），也不误匹配 xruiya.onlyets.com
        return h === 'ruiya.onlyets.com' || h.endsWith('.ruiya.onlyets.com');
    },

    // 快速页面检查（不等待 DOM），供 URL 变化监听器使用
    isMarkingPage() {
        return /\/mark\/v\d+\/view\//i.test(window.location.pathname);
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('[睿芽] 当前不在阅卷页面 path=', window.location.pathname);
            return false;
        }
        // 分步打分模式不支持自动批改（原 isUnsupportedMarkingMode 并非核心协议钩子、不会被调用，
        // 判定并入页面检测；鼠标模式仍可通过 _ensureKeyboardMode 自愈）
        const stepsMode = document.querySelector(RUIYA_SELECTORS.MODE_STEPS);
        if (stepsMode && stepsMode.checked) {
            console.warn('[睿芽] 分步打分模式暂不支持自动批改，不进入批改流程');
            return false;
        }
        console.log('[睿芽] 开始检测批改页面...');
        try {
            // 结构性证据优先：分数框 + 提交按钮。图片 src 异步写入，不作为硬条件
            const [inputEl, submitEl] = await Promise.all([
                waitForElement(RUIYA_SELECTORS.PAGE_DETECT_INPUT, RUIYA_TIMING.DETECT_TIMEOUT_MS).catch(() => null),
                waitForElement(RUIYA_SELECTORS.PAGE_DETECT_SUBMIT, RUIYA_TIMING.DETECT_TIMEOUT_MS).catch(() => null),
            ]);
            const panel = document.querySelector(RUIYA_SELECTORS.SCORE_PANEL);
            const img = document.querySelector(RUIYA_SELECTORS.ANSWER_IMAGE);
            const detected = !!(inputEl && submitEl);
            console.log(`[睿芽] 检测结果 panelKey=${!!panel} input=${!!inputEl} submit=${!!submitEl} img=${!!img} => ${detected}`);
            if (detected) this._logPageSnapshot();
            return detected;
        } catch (e) {
            console.error('[睿芽] detectMarkingPage 异常:', e);
            return false;
        }
    },

    // ---------- 任务标识 ----------
    getTaskIdentifier() {
        // 只用 pathname（含 GUID），剔除全部 query/hash：
        //  - 脚本加载瞬间（main.js 顶层）DOM 还没有 #lblTSub，用 DOM 标签会产生假「换题」
        //  - GUID 每页一份，跨学生稳定；换题时平台整页重载，脚本重启后基准重算
        // 白名单只保留可能承载题目维度的参数，绝不取 studentid/paperid（会按学生抖动）
        const path = (window.location.pathname || '').replace(/\/+$/, '');
        const KEEP = ['questionid', 'questionno', 'qid', 'tihao', 'step', 'steps', 'review', 'type'];
        let extra = '';
        try {
            const sp = new URLSearchParams(window.location.search || '');
            const parts = [];
            KEEP.forEach(k => {
                sp.forEach((v, key) => {
                    if (key.toLowerCase() === k && v) parts.push(`${k}=${v}`);
                });
            });
            extra = parts.sort().join('&');
        } catch (e) { /* 忽略 */ }
        return extra ? `${path}?${extra}` : path;
    },

    // ---------- 取图 ----------
    async gatherAnswerImages() {
        const deadline = Date.now() + RUIYA_TIMING.IMAGE_TIMEOUT_MS;
        let prev = '';
        let hits = 0;
        let lastGood = '';

        while (Date.now() < deadline) {
            const img = document.querySelector(RUIYA_SELECTORS.ANSWER_IMAGE);
            const src = img && typeof img.src === 'string' ? img.src : '';
            const plausible = !!src
                && (/^https?:/i.test(src) || /^data:image\//i.test(src))
                && !/(loading|placeholder|blank)\.(gif|png|jpg)/i.test(src);

            if (plausible) {
                lastGood = src;
                if (src === prev && img.naturalWidth > 0) {
                    hits++;
                    if (hits >= RUIYA_TIMING.IMAGE_STABLE_HITS) {
                        console.log(`[睿芽] 取图就绪 ${this._brief(src)} (${img.naturalWidth}x${img.naturalHeight})`);
                        return [src];
                    }
                } else {
                    hits = 0;
                }
                prev = src;
            } else {
                hits = 0;
                prev = '';
            }
            await new Promise(r => setTimeout(r, RUIYA_TIMING.IMAGE_POLL_MS));
        }

        if (RUIYA_TIMING.ALLOW_RESOURCE_FALLBACK) {
            const f = this._resourceFallback();
            if (f) {
                console.warn('[睿芽] src 超时，采用资源时间线兜底图:', this._brief(f));
                return [f];
            }
        }

        // 数据安全优先：拿不准就返回空 → 核心提示「未取到答题卡图片」并暂停，
        // 绝不把可能属于上一名学生的图送去判分（批错卷比空图严重）
        console.warn('[睿芽] 取图失败/不稳定，按数据安全策略返回空数组。lastGood=', lastGood ? this._brief(lastGood) : '(空)');
        return [];
    },

    async fetchImageAsBase64(url) {
        if (typeof url === 'string' && url.startsWith('data:')) {
            const idx = url.indexOf(',');
            return idx >= 0 ? url.slice(idx + 1) : '';
        }
        // 阿里云 OSS 图床（实测 ry-mark.oss-cn-beijing.aliyuncs.com，另有 alimarkpic.onlyets.com），
        // 走 GM_xmlhttpRequest；脚本头 connect 已含通配。403 自动刷新由 core/image.js 统一处理
        return fetchImageAsBase64(url);
    },

    // ---------- 评分单元 ----------
    getScoreInputs() {
        const panel = document.querySelector(RUIYA_SELECTORS.SCORE_PANEL);
        let els;
        if (panel) {
            els = panel.querySelectorAll(RUIYA_SELECTORS.SCORE_INPUT);
        } else {
            // 兜底：仅当 #panelKey 缺失；隐藏字段是 input[type=hidden]，不会被选中
            els = document.querySelectorAll(RUIYA_SELECTORS.SCORE_INPUT);
            if (els.length && !this._warnedNoPanel) {
                this._warnedNoPanel = true;
                console.warn('[睿芽] 未找到 #panelKey，退化为全页 input.ipt_score');
            }
        }

        const inputs = [];
        els.forEach(el => {
            if (!el || el.type === 'hidden' || el.disabled) return;
            const item = el.closest(RUIYA_SELECTORS.SCORE_ITEM);

            let maxScore = 0;
            const maxEl = item && (item.querySelector(RUIYA_SELECTORS.MAX_SCORE_SPAN)
                || item.querySelector(RUIYA_SELECTORS.MAX_SCORE_FONT));
            if (maxEl) {
                const m = (maxEl.textContent || '').match(/(\d+(?:\.\d+)?)/);
                if (m) {
                    const v = parseFloat(m[1]);
                    if (isFinite(v) && v > 0) maxScore = v;
                }
            }

            let label = '';
            const labelEl = item && (item.querySelector(RUIYA_SELECTORS.SCORE_LABEL)
                || item.querySelector(RUIYA_SELECTORS.SCORE_LABEL_FALLBACK));
            if (labelEl) label = (labelEl.textContent || '').trim().replace(/[:：]\s*$/, '');
            // 小题标题常由 JS 写入 .panel-item-input 的首个 span（静态 HTML 里为空）；
            // 只用「不含输入框、不在满分 font 内」的短文本，避免把 "<= 4" 或 GUID 当标签
            if (!label && item) {
                const spans = item.querySelectorAll('span');
                for (const sp of spans) {
                    if (sp.querySelector('input') || sp.closest('font')) continue;
                    const t = (sp.textContent || '').trim().replace(/\s+/g, ' ');
                    if (t && t.length <= 20) { label = t; break; }
                }
            }
            if (!label) label = `第${inputs.length + 1}题`;

            inputs.push({ element: el, label, index: inputs.length, maxScore });
        });

        if (inputs.length !== this._lastInputCount) {
            this._lastInputCount = inputs.length;
            console.log(`[睿芽] 评分单元 ${inputs.length} 个：`
                + inputs.map(x => `${x.label}(满${x.maxScore || '?'})`).join(' | '));
        }
        return inputs;
    },

    // ---------- 填分（必须同步返回 boolean：main.js 判 fillOk === false 即中止）----------
    fillScores(scores) {
        if (!Array.isArray(scores) || scores.length === 0) return false;

        // 先确保键盘打分模式再取框：鼠标/分步模式下输入框可能被禁用或隐藏，
        // 先取框会因 getScoreInputs 过滤 disabled 而提前失败，模式自愈逻辑永远轮不到
        if (!this._ensureKeyboardMode()) {
            console.error('[睿芽] 无法切换到键盘打分模式，放弃填分');
            return false;
        }

        const inputs = this.getScoreInputs();
        if (inputs.length === 0) {
            console.warn('[睿芽] 无分数框，填分失败');
            return false;
        }

        // 分数多于输入框 → 会漏分，显式失败（绝不静默丢分）
        if (scores.length > inputs.length) {
            console.error(`[睿芽] 分数个数(${scores.length}) > 输入框(${inputs.length})，拒绝填分`);
            return false;
        }
        if (scores.length < inputs.length) {
            console.warn(`[睿芽] 分数个数(${scores.length}) < 输入框(${inputs.length})，多余框保持原值，请人工核对`);
        }

        // 「自动提交」默认勾选：勾选时平台可能在填分后抢先交卷，
        // 绕过确认弹窗与拟人延迟（同类教训见 jingdouyun #254）。提交时机必须归脚本
        this._disableAutoSubmit();

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        let ok = 0;
        for (let i = 0; i < scores.length; i++) {
            const s = scores[i];
            if (s === null || s === undefined) {
                ok++;
                console.warn(`[睿芽] 第${i + 1}框无分数，保持原值`);
                continue;
            }
            if (this._writeScore(inputs[i].element, s, setter)) {
                ok++;
            } else {
                console.warn(`[睿芽] 第${i + 1}框(${inputs[i].label}) 写入 ${s} 未生效，实际="${inputs[i].element.value}"`);
            }
        }

        const allOk = ok === scores.length;
        console.log(`[睿芽] 填分 [${scores.join(',')}] → 实际 [${inputs.slice(0, scores.length).map(x => x.element.value || '空').join(',')}] ${allOk ? 'OK' : '存在失败'}`);
        if (allOk) this._lastFillSignature = scores.join(',');
        return allOk;
    },

    // ---------- 提交 ----------
    submitGrade() {
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) {
            console.warn('[睿芽] 无分数框，无法提交');
            return false;
        }

        // 空分进平台 = 事故：任一框为空则不提交（正常流程下 fillScores 已拦住）
        const empties = inputs.filter(x => String(x.element.value == null ? '' : x.element.value).trim() === '');
        if (empties.length > 0) {
            console.error(`[睿芽] 有 ${empties.length}/${inputs.length} 个分数框为空，拒绝提交（请人工补分）`);
            return false;
        }

        const btn = document.querySelector(RUIYA_SELECTORS.SUBMIT_BUTTON);
        if (!btn) {
            console.warn('[睿芽] 未找到 #submitMark');
            return false;
        }
        if (btn.disabled || btn.getAttribute('disabled') !== null) {
            console.warn('[睿芽] 提交按钮处于 disabled 状态');
            return false;
        }

        btn.click();
        console.log('[睿芽] 已点击 #submitMark');
        this._watchPostSubmitModals();
        return true;
    },

    // ---------- 等待下一份 ----------
    async waitForNextPaper(oldImageUrl) {
        const start = Date.now();
        const basePaperNo = this._paperNo();
        const baseStu = this._stuId();
        const basePath = this._imagePath(oldImageUrl) || this._imagePath(this._rawImageSrc());
        const hadValueBefore = this.getScoreInputs().some(x => String(x.element.value || '').trim() !== '')
            || !!this._lastFillSignature;
        let emptyHits = 0;

        console.log(`[睿芽] 等待下一份 密号=${basePaperNo || '-'} 图=${basePath ? basePath.slice(-40) : '-'}`);

        while (Date.now() - start < RUIYA_TIMING.NEXT_PAPER_TIMEOUT_MS) {
            // 强信号 1：密号变化（每生一换）
            const paperNo = this._paperNo();
            if (basePaperNo && paperNo && paperNo !== basePaperNo) {
                console.log(`[睿芽] 换卷（密号 ${basePaperNo} → ${paperNo}）`);
                return true;
            }

            // 强信号 2：答题图 data-stu 学生标识变化（img 属性，每生一换，实测存在）
            const stu = this._stuId();
            if (baseStu && stu && stu !== baseStu) {
                console.log('[睿芽] 换卷（data-stu 学生标识变化）');
                return true;
            }

            // 强信号 3：答题图路径变化（只比路径，容忍 ?_= 缓存参数）
            const path = this._imagePath(this._rawImageSrc());
            if (basePath && path && path !== basePath) {
                console.log('[睿芽] 换卷（答题图路径变化）');
                return true;
            }

            // 弱信号：全框清空 —— 必须①过宽限期 ②填分前确有值 ③连续 3 次
            // 绝不把 "0" 当空（0 分是合法分值），否则 0 分卷会被误判翻卷 → 重复提交
            if (Date.now() - start > RUIYA_TIMING.NEXT_PAPER_GRACE_MS && hadValueBefore) {
                const cur = this.getScoreInputs();
                const allEmpty = cur.length > 0
                    && cur.every(x => String(x.element.value || '').trim() === '');
                emptyHits = allEmpty ? emptyHits + 1 : 0;
                if (emptyHits >= RUIYA_TIMING.NEXT_PAPER_EMPTY_HITS) {
                    console.warn('[睿芽] 仅凭「输入框持续清空」判定翻卷（密号与图片未变），请留意');
                    return true;
                }
            }

            await new Promise(r => setTimeout(r, RUIYA_TIMING.NEXT_PAPER_POLL_MS));
        }

        console.warn('[睿芽] 等待下一份试卷超时');
        return false;
    },

    // ---------- 状态判定 ----------
    isRegradeMode() {
        // 页头恒有「回 评」链接（Mark.showReview），按文字匹配会永远为 true → 禁用整个 UI
        // 只能用 #reviewPanel（平时 display:none）的真实可见性
        if (this._visible(RUIYA_SELECTORS.REVIEW_PANEL)) {
            console.warn('[睿芽] 回评面板可见，判定为回评模式');
            return true;
        }
        return !!(window.aiGradingState && window.aiGradingState.isRegrading);
    },

    // ---------- 生命周期钩子 ----------
    onPageLoad() {
        console.log('[睿芽] 页面加载完成');
        // 「阅卷小提示」为 data-backdrop=static 弹窗会遮挡自动批改操作，
        // 点「不再提示」关闭并记住偏好（信息性弹窗，无风险）
        try {
            if (this._visible(RUIYA_SELECTORS.TIPS_MODAL)) {
                const dismiss = document.querySelector(RUIYA_SELECTORS.TIPS_MODAL_DISMISS);
                if (dismiss) {
                    dismiss.click();
                    console.log('[睿芽] 已关闭「阅卷小提示」弹窗');
                }
            }
        } catch (e) {
            console.warn('[睿芽] 关闭提示弹窗失败', e);
        }
    },

    // ---------- 内部工具 ----------
    _writeScore(el, score, setter) {
        if (!el) return false;
        const want = String(score);

        // 平台 onkeyup="Mark.clearNoNum(this)" 需要 keyup 才会清洗非法字符；
        // 提交时直接读 DOM .value，事件用于 UI 校验与内部状态
        const fire = () => {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: want.slice(-1) }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        };

        setter.call(el, want);
        fire();
        if (this._valueEquals(el, score)) return true;

        // 二次尝试：先聚焦选中（部分 WebForms 校验要求 focus），再重写
        try { el.focus(); el.select(); } catch (e) { /* 隐藏元素会抛错 */ }
        setter.call(el, want);
        fire();
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        return this._valueEquals(el, score);
    },

    _valueEquals(el, score) {
        if (!el) return false;
        const raw = el.value == null ? '' : String(el.value).trim();
        if (raw === '') return false;
        const v = parseFloat(raw);
        const w = Number(score);
        return isFinite(v) && isFinite(w) && Math.abs(v - w) < 1e-6;
    },

    _ensureKeyboardMode() {
        const kb = document.querySelector(RUIYA_SELECTORS.MODE_KEYBOARD);
        if (!kb) return true;           // 页面无模式单选，直接按键盘模式处理
        if (kb.checked) return true;

        const steps = document.querySelector(RUIYA_SELECTORS.MODE_STEPS);
        const mouse = document.querySelector(RUIYA_SELECTORS.MODE_MOUSE);
        const from = steps && steps.checked ? '分步' : (mouse && mouse.checked ? '鼠标' : '未知');
        console.log(`[睿芽] 当前为${from}打分模式，尝试切回键盘模式...`);

        this._activateRadio(kb);

        if (kb.checked) {
            console.log('[睿芽] 已切换到键盘打分模式');
            return true;
        }
        console.warn('[睿芽] 键盘模式切换失败（current checked=false）');
        return false;
    },

    _activateRadio(target) {
        const label = target.closest('label') || document.querySelector(`label[for="${target.id}"]`);
        const candidates = [];
        if (label) {
            const helper = label.querySelector(RUIYA_SELECTORS.ICHECK_HELPER);
            const proxy = label.querySelector(RUIYA_SELECTORS.ICHECK_PROXY);
            if (helper) candidates.push(helper);   // iCheck 真正接事件的是 ins.iCheck-helper
            if (proxy) candidates.push(proxy);
            candidates.push(label);
        }
        candidates.push(target);

        for (const el of candidates) {
            try { el.click(); } catch (e) { /* ignore */ }
            if (target.checked) return true;
        }
        return target.checked;
    },

    _disableAutoSubmit() {
        const cb = document.querySelector(RUIYA_SELECTORS.AUTO_SUBMIT_CHECKBOX);
        if (!cb || !cb.checked) return;

        const label = cb.closest('label');
        const candidates = [];
        if (label) {
            const helper = label.querySelector(RUIYA_SELECTORS.ICHECK_HELPER);
            const proxy = label.querySelector(RUIYA_SELECTORS.ICHECK_PROXY);
            if (helper) candidates.push(helper);
            if (proxy) candidates.push(proxy);
            candidates.push(label);
        }
        candidates.push(cb);

        for (const el of candidates) {
            if (!cb.checked) break;
            try { el.click(); } catch (e) { /* ignore */ }
        }

        if (!this._autoSubmitLogged) {
            this._autoSubmitLogged = true;
            console.log(`[睿芽] 「自动提交」填分前取消勾选（结果 checked=${cb.checked}，提交时机由脚本接管）`);
        }
        if (cb.checked) console.warn('[睿芽] 「自动提交」取消失败，填分后可能被平台抢先交卷');
    },

    _watchPostSubmitModals() {
        const start = Date.now();
        const timer = setInterval(() => {
            try {
                // 0 分确认：必须确认，否则提交不会真正落库
                if (this._visible(RUIYA_SELECTORS.ZERO_MODAL)) {
                    const okBtn = document.querySelector(RUIYA_SELECTORS.ZERO_MODAL_OK);
                    if (okBtn) {
                        okBtn.click();
                        console.log('[睿芽] 0 分确认弹窗 → 已点确定');
                    }
                }
                // 其它弹窗语义未知（多评/分数分布/易错点），只告警不自动确认，避免误操作
                [RUIYA_SELECTORS.TIPS_MODAL, RUIYA_SELECTORS.TIPS_DP_MODAL, RUIYA_SELECTORS.DIST_MODAL]
                    .forEach(sel => {
                        if (this._visible(sel)) {
                            console.warn(`[睿芽] 提交后出现阻塞弹窗 ${sel}，未自动确认，请人工留意`);
                        }
                    });
            } catch (e) { /* 轮询中的任何异常都不影响主流程 */ }

            const gone = !document.querySelector(RUIYA_SELECTORS.SUBMIT_BUTTON);
            if (gone || Date.now() - start > RUIYA_TIMING.MODAL_WATCH_MS) clearInterval(timer);
        }, RUIYA_TIMING.MODAL_WATCH_POLL_MS);
    },

    _visible(sel) {
        const el = document.querySelector(sel);
        if (!el) return null;
        if (el.getClientRects().length === 0) return null;   // 兼顾 position:fixed
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return null;
        return el;
    },

    _paperNo() {
        const el = document.querySelector(RUIYA_SELECTORS.PAPER_NO);
        return el ? (el.textContent || '').trim() : '';
    },

    // 答题图上的 data-stu 学生标识（img 属性，每生一换，实测存在）
    _stuId() {
        const img = document.querySelector(RUIYA_SELECTORS.ANSWER_IMAGE);
        return img ? (img.getAttribute('data-stu') || '').trim() : '';
    },

    _rawImageSrc() {
        const img = document.querySelector(RUIYA_SELECTORS.ANSWER_IMAGE);
        return img && typeof img.src === 'string' ? img.src : '';
    },

    _imagePath(u) {
        if (!u) return '';
        if (u.slice(0, 5) === 'data:') return 'data:' + u.length;
        try { return new URL(u, location.href).pathname; } catch (e) { return String(u).split('?')[0]; }
    },

    _brief(u) {
        if (!u) return '';
        return u.length > 90 ? u.slice(0, 90) + '...' : u;
    },

    _resourceFallback() {
        // 仅当 src 完全取不到时启用，且要求「近 12s 内唯一一张」图片资源，避免抓到旧卷
        try {
            const entries = performance.getEntriesByType('resource')
                .filter(e => e.initiatorType === 'img' && /^https?:/i.test(e.name))
                .filter(e => /onlyets\.com|alimarkpic|ry-mark\.oss/i.test(e.name))
                .filter(e => Date.now() - (performance.timeOrigin + e.startTime) < 12000);
            const uniq = Array.from(new Set(entries.map(e => e.name)));
            return uniq.length === 1 ? uniq[0] : null;
        } catch (e) { return null; }
    },

    _logPageSnapshot() {
        if (this._snapshotLogged) return;
        this._snapshotLogged = true;
        try {
            const inputs = this.getScoreInputs();
            const modes = ['#rdKeyboard', '#rdMouse', '#rdSteps'].map(s => {
                const el = document.querySelector(s);
                return s + '=' + (el ? el.checked : '×');
            }).join(' ');
            const auto = document.querySelector(RUIYA_SELECTORS.AUTO_SUBMIT_CHECKBOX);
            const zero = document.querySelector(RUIYA_SELECTORS.ZERO_CONFIRM_CHECKBOX);
            console.log('[睿芽] 页面快照', {
                url: location.pathname,
                密号: this._paperNo(),
                科目: (document.querySelector(RUIYA_SELECTORS.SUBJECT_LABEL) || {}).textContent,
                题号: (document.querySelector(RUIYA_SELECTORS.QUESTION_LABEL) || {}).textContent,
                输入框: inputs.length,
                满分: inputs.map(x => x.maxScore),
                模式: modes,
                自动提交: auto ? auto.checked : '×',
                零分确认: zero ? zero.checked : '×',
                回评面板可见: !!this._visible(RUIYA_SELECTORS.REVIEW_PANEL),
                图片: this._brief(this._rawImageSrc()),
                Mark对象: typeof window.Mark,
            });
        } catch (e) {
            console.warn('[睿芽] 页面快照异常', e);
        }
    },

    _installZIndexStyle() {
        if (document.getElementById('ruiya-zindex-fix')) return;
        const style = document.createElement('style');
        style.id = 'ruiya-zindex-fix';
        style.textContent = `
            /* 提高脚本 UI 的 z-index，避免被睿芽平台 .panel 遮挡 */
            .ai-grade-btn, .ai-history-btn, .ai-settings-btn,
            .ai-toast, #ai-history-panel, #ai-grading-settings,
            .ai-modal-overlay, #correction-panel,
            #auto-submit-dialog, #asd-minimized-bar,
            #ai-stream-container, #ai-history-overlay,
            #ai-stream-panel {
                z-index: 2147483640 !important;
            }`;
        (document.head || document.documentElement).appendChild(style);
        console.log('[睿芽] 已注入 z-index 修复样式');
    },
};

if (RuiyaAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = RuiyaAdapter;
    try {
        RuiyaAdapter._installZIndexStyle();
    } catch (e) {
        console.warn('[睿芽] 样式注入失败', e);
    }
    console.log(`[睿芽] 适配器已注册 host=${location.hostname} path=${location.pathname}`);
}
