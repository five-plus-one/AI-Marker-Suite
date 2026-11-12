// ========== 懂你系统（dongni100.com）适配器 ==========
// www.dongni100.com — Vue2 + Element UI SPA（fat-web），教师端「精准化教学」/v2/exam/*
//
// 平台阅卷模型（2026-11-10 实测，证据见 tmp/agn_dongni_report.md）：
// - 题块制按题批改：阅卷安排按题号(9-20)分配任务量（单评/仲裁双模式），老师逐份打分
// - 答题卡为题块裁切图：img.img-dom，URL 形态
//   https://cdn.dongni100.com/upload/answerCard/{y}/{m}/{d}/{examId}/{paperId}/{stuId}_{考号}/{题块}.jpg
//   → 考号在 URL 里 = 稳定试卷/学生标识（同卷不变、换卷必变，#281 强信号模式）
// - 记分 API：POST /api/exam/mark/handle/subjective/question/score（主观题）、
//   handle/student/score、handle/student/scoreCurrentPage、handle/objective/question/score
// - 认证走请求头 dongni-login / function / timestampss / recognitionversion（axios 拦截器注入）
//
// [待复现]（批改工作台现场未实测，选择器按已实测姊妹页（抽样详情/阅卷记录/修订分数）推定）：
//   - 批改工作台给分控件形态（radio 档位 vs 打分板按钮）与提交按钮文本
//   - 翻卷交互（自动下一份 vs 手动）
//   实现上凡依赖处均带多特征兜底，识别不了宁可不批（不猜、不误给分）

const DongniAdapter = {
    name: '懂你系统',
    id: 'dongni',
    urlPatterns: ['*://www.dongni100.com/*'],
    iconUrl: '',

    shouldInitialize() {
        // 域名 + 阅卷相关路径族双闸（/v2/exam/ 为考试/阅卷模块；其余模块不激活）
        return window.location.hostname === 'www.dongni100.com'
            && window.location.pathname.includes('/v2/exam/');
    },

    // 快速页面检查（不等待 DOM），供 URL 变化监听器使用
    isMarkingPage() {
        return this.shouldInitialize() && !!document.querySelector(DONGNI_SELECTORS.ANSWER_IMAGE);
    },

    async detectMarkingPage() {
        if (!this.shouldInitialize()) return false;
        console.log('[懂你] 开始检测批改页面...');
        try {
            await waitForElement(DONGNI_SELECTORS.PAGE_DETECT_IMAGE, 8000).catch(() => null);
            const img = document.querySelector(DONGNI_SELECTORS.ANSWER_IMAGE);
            const scoreZone = document.querySelector(DONGNI_SELECTORS.SCORE_DETAIL)
                || document.querySelector(DONGNI_SELECTORS.SCORE_RADIO_GROUP);
            // 铁律：答案图与给分区双特征才认定批改页，缺一不批（宁可不批，不误给分）
            const detected = !!(img && scoreZone);
            console.log(`[懂你] 检测结果 — 答题图: ${!!img}, 给分区: ${!!scoreZone} => ${detected}`);
            return detected;
        } catch (e) {
            console.error('[懂你] detectMarkingPage 异常:', e);
            return false;
        }
    },

    // ---------- 任务标识（题目维度：换学生不变、换题变） ----------
    getTaskIdentifier() {
        // #298-①：只取 URL query，禁止 DOM 探测——填分点选给分 radio 会翻转
        // label.is-active/el-radio.is-checked 等 DOM 态，掺入标识会每次填分误触发任务切换
        const p = new URLSearchParams(window.location.search);
        const parts = DONGNI_SELECTORS.TASK_QUERY_KEYS.map(k => p.get(k) || '');
        // 题号维度同样只认 query（questionId/questionNo/qid/itemId，取到哪个用哪个）
        let qid = '';
        for (const k of DONGNI_SELECTORS.TASK_QID_QUERY_KEYS) {
            const v = p.get(k);
            if (v) { qid = v; break; }
        }
        return `dongni_${parts.join('_')}_${qid}`;
    },

    // ---------- 稳定试卷/学生标识（#281 强信号，供答卷一致性校验） ----------
    // 答题图 URL 的 {stuId}_{考号} 段：同卷不变、换卷必变
    getPaperIdentity() {
        try {
            const img = document.querySelector(DONGNI_SELECTORS.ANSWER_IMAGE);
            const src = img ? (img.src || img.getAttribute('src') || '') : '';
            const m = src.match(DONGNI_SELECTORS.PAPER_ID_URL_RE);
            return m ? `${m[1]}_${m[2]}` : (src ? null : null);
        } catch (e) {
            return null;
        }
    },

    // ---------- 图片获取 ----------
    async gatherAnswerImages() {
        console.log('[懂你] 开始获取答题卡图片...');
        // 等题块图渲染（URL 先于位图就绪）
        const startTime = Date.now();
        while (Date.now() - startTime < 8000) {
            const imgs = Array.from(document.querySelectorAll(DONGNI_SELECTORS.ANSWER_IMAGE));
            // 铁律：宁可不取——只收可见+已加载的 http 图，隐藏/未就绪一律不收（防拿旧图/坏图批改）
            const urls = imgs
                .filter(img => img.getClientRects().length > 0 && img.naturalWidth > 0)
                .map(img => img.src || img.getAttribute('src') || '')
                .filter(src => /^https?:/i.test(src));
            if (urls.length > 0) {
                console.log(`[懂你] 获取到 ${urls.length} 张题块图`);
                return [...new Set(urls)];
            }
            await new Promise(r => setTimeout(r, 300));
        }
        console.warn('[懂你] 未取到答题卡图片（未就绪/隐藏），宁可不取');
        return [];
    },

    async fetchImageAsBase64(url) {
        // cdn.dongni100.com 跨域，走 GM_xmlhttpRequest（#297 形态：2xx/空数据/超时显式拒绝）
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'blob',
                timeout: 20000,
                onload: (res) => {
                    if (res.status < 200 || res.status >= 300) {
                        reject(new Error(`图片下载失败，状态码: ${res.status}`));
                        return;
                    }
                    if (!res.response) {
                        reject(new Error('下载的图片数据为空'));
                        return;
                    }
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const base64 = (reader.result || '').split(',')[1];
                        if (!base64) {
                            reject(new Error('图片转换失败：空数据'));
                            return;
                        }
                        resolve(base64);
                    };
                    reader.onerror = () => reject(new Error('图片读取失败'));
                    reader.readAsDataURL(res.response);
                },
                onerror: () => reject(new Error('图片下载失败（网络错误或跨域被拒）')),
                ontimeout: () => reject(new Error('图片下载超时'))
            });
        });
    },

    // ---------- 评分单元（题块制：一块一单元） ----------
    getScoreInputs() {
        // 实测给分形态：满分档位 radio（0..满分）。满分=档位最大值；[待复现] 批改台或为打分板按钮
        const radios = Array.from(document.querySelectorAll(DONGNI_SELECTORS.SCORE_RADIO))
            .filter(r => r.getClientRects().length > 0 || (r.closest('.el-radio') && r.closest('.el-radio').getClientRects().length > 0));
        if (radios.length > 0) {
            const values = radios.map(r => parseFloat(r.value)).filter(n => !isNaN(n));
            const maxScore = values.length ? Math.max(...values) : 0;
            const group = document.querySelector(DONGNI_SELECTORS.SCORE_RADIO_GROUP) || radios[0].closest('.el-radio-group') || radios[0];
            // 档位字符串列表供 fillScores 预检
            return [{
                element: group,
                label: '本题块',
                index: 0,
                maxScore,
                type: 'click',
                scores: values
            }];
        }
        // 兜底：文本输入框给分（修订分数区实测存在 input.el-input__inner）
        const input = document.querySelector(DONGNI_SELECTORS.SCORE_INPUT);
        if (input) {
            return [{ element: input, label: '本题块', index: 0, maxScore: 0 }];
        }
        return [];
    },

    // ---------- 填分（全或无，模板=guangda #275 两遍式，#296） ----------
    fillScores(scores) {
        if (!scores || scores.length === 0) return false;
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) {
            console.warn('⚠️ [懂你] 未找到给分控件 → 拒绝');
            return false;
        }

        // 题块制单单元：多余分数=配置错位，显式拒绝（不静默忽略）
        if (scores.length > 1) {
            console.warn(`⚠️ [懂你] 分数个数(${scores.length})>1（单题块配置错位）→ 拒绝`);
            return false;
        }
        const score = scores[0];
        if (score === null || score === undefined) {
            console.warn('⚠️ [懂你] 无 AI 分数（分数缺失）→ 拒绝');
            return false;
        }

        const unit = inputs[0];

        // 两遍式第一遍：全量校验目标档位存在（点击式给分，先查不点）
        if (unit.type === 'click') {
            const target = Array.from(unit.element.querySelectorAll('input.el-radio__original[type="radio"]'))
                .find(r => String(parseFloat(r.value)) === String(Number(score)));
            if (!target) {
                const opts = (unit.scores || []).join(',');
                console.warn(`⚠️ [懂你] 分数 ${score} 不在给分档位 [${opts}] 内 → 拒绝`);
                return false;
            }
            // 两遍式第二遍：命中才点击
            const radioEl = target.closest('.el-radio') || target;
            radioEl.click();
            target.click();
            // 写后验证（#298-③）：必须真实选中才返回 true，点击未生效即显式拒绝
            const checked = target.checked === true
                || (radioEl.classList && radioEl.classList.contains('is-checked'));
            if (!checked) {
                console.warn(`⚠️ [懂你] 档位 ${score} 点击后未生效（未选中）→ 拒绝，不提交半填状态`);
                return false;
            }
            console.log(`✅ [懂你] 已选档位 ${score}（选中验证通过）`);
            return true;
        }

        // 输入框式：写后逐字比对（#298-③，xkw 三遍式同款）
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(unit.element, String(score));
        unit.element.dispatchEvent(new Event('input', { bubbles: true }));
        unit.element.dispatchEvent(new Event('change', { bubbles: true }));
        unit.element.dispatchEvent(new Event('blur', { bubbles: true }));
        if (String(unit.element.value).trim() !== String(score)) {
            console.warn(`⚠️ [懂你] 分数 ${score} 写入未生效（实际 "${unit.element.value}"）→ 拒绝，不提交半填状态`);
            return false;
        }
        console.log(`✅ [懂你] 分数 ${score} 已填入（逐字验证通过）`);
        return true;
    },

    // ---------- 提交（失败必须显式失败，#296；精确匹配+生效验证，#298-②） ----------
    submitGrade() {
        const btns = Array.from(document.querySelectorAll(DONGNI_SELECTORS.SUBMIT_BUTTON));
        const btn = btns.find(b => {
            const t = (b.textContent || '').replace(/\s+/g, '');
            if (!b.getClientRects().length || !t) return false;
            // 导航词显式排除：「下一份/上一份/下一题/下一步」等点掉=丢分
            if (DONGNI_SELECTORS.SUBMIT_NAV_RE.test(t)) return false;
            // strip 空白后全等（防子串误命中）
            return DONGNI_SELECTORS.SUBMIT_BUTTON_TEXT.test(t);
        });
        if (!btn) {
            console.warn('⚠️ [懂你] 未找到提交按钮（精确文本「提交/保存并下一」未命中）→ 拒绝提交');
            return false;
        }
        btn.click();
        console.log(`✅ [懂你] 已点击提交按钮「${(btn.textContent || '').trim()}」`);

        // 点后验证生效（#298-②）：按钮消失/禁用视为提交生效；否则显式失败（宁停不带病）
        return new Promise((resolve) => {
            let checks = 0;
            const timer = setInterval(() => {
                checks++;
                const stillThere = btn.isConnected && btn.getClientRects().length > 0 && !btn.disabled;
                if (!stillThere) {
                    clearInterval(timer);
                    console.log('[懂你] 提交已生效（按钮消失/禁用）');
                    resolve(true);
                    return;
                }
                if (checks >= 8) { // ~1.6s 未见证效
                    clearInterval(timer);
                    console.warn('⚠️ [懂你] 提交点击后未验证到生效（按钮仍在）→ 显式失败，请人工确认');
                    resolve(false);
                }
            }, 200);
        });
    },

    // ---------- 等待下一份（强信号优先；弱信号不做触发，铁律） ----------
    async waitForNextPaper(oldImageUrl) {
        console.log('[懂你] 等待下一份答卷...');
        const oldId = this.getPaperIdentity();
        const pathOf = (u) => {
            try { return new URL(u, location.href).pathname; } catch (e) { return String(u || '').split('?')[0]; }
        };
        const oldPath = pathOf(oldImageUrl);
        const startTime = Date.now();

        while (Date.now() - startTime < 30000) {
            await new Promise(r => setTimeout(r, 400));

            // 强信号 1：考号级标识变化（URL {stuId}_{考号} 段，换卷必变）
            const curId = this.getPaperIdentity();
            if (oldId && curId && curId !== oldId) {
                console.log(`[懂你] 换卷（标识 ${oldId} → ${curId}）`);
                return true;
            }

            // 强信号 2：题块图 pathname 变化（cdn 路径含考号段）
            const img = document.querySelector(DONGNI_SELECTORS.ANSWER_IMAGE);
            const curPath = img ? pathOf(img.src || img.getAttribute('src')) : '';
            if (curPath && oldPath && curPath !== oldPath && img && img.naturalWidth > 0) {
                console.log('[懂你] 换卷（题块图路径变化）');
                return true;
            }

            // 铁律：不做「输入框清空/弱信号」触发——无法判定宁可等超时
        }
        console.warn('[懂你] 等待下一份答卷超时');
        return false;
    },

    // ---------- 回评模式 ----------
    isRegradeMode() {
        if (DONGNI_SELECTORS.REGRADE_PATH_RE.test(window.location.pathname + window.location.hash)) return true;
        // [待复现] 批改台回评态 DOM 特征；实测「修订分数/打回」按钮为回评侧操作
        return !!document.querySelector('.edit-score-box');
    },

    // 多设备弹窗处理（#329 迁出死钩子）：core 从不调用 onPageLoad（全仓死钩子），
    // 挂在它上面生产上永不执行——安装主入口移到注册 IIFE，onPageLoad 保留幂等兜底
    // （将来 core 补调用点也不重复执行）。弹窗可能在注册后才弹出：观察 DOM，出现即处理。
    // 实测「JS 裸 click 无效」→ 派完整指针事件序列；超时未消失 toast 提示人工关闭。
    // ⚠️ 绝不点「退出其他设备」（会踢教师会话）
    _installMultiDeviceDismissal() {
        if (this._mdInstalled) return; // 幂等守卫
        this._mdInstalled = true;

        let active = false;    // 一轮"点击→验证"进行中，防 mutation 风暴重复触发
        let toastShown = false; // 人工提示只发一次

        const firePointerClick = (el) => {
            const r = el.getBoundingClientRect();
            const base = {
                bubbles: true, cancelable: true, view: window,
                clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
                pointerId: 1, isPrimary: true
            };
            el.dispatchEvent(new PointerEvent('pointerdown', base));
            el.dispatchEvent(new MouseEvent('mousedown', base));
            el.dispatchEvent(new PointerEvent('pointerup', base));
            el.dispatchEvent(new MouseEvent('mouseup', base));
            el.dispatchEvent(new MouseEvent('click', base));
        };
        const dismissed = () => {
            const b = document.querySelector(DONGNI_SELECTORS.MULTI_DEVICE_OK_BTN);
            return !b || !b.getClientRects().length;
        };

        const dismissIfPresent = () => {
            // 全程 fail-safe：弹窗处理任何异常都不得影响适配器注册/批改主流程
            try {
                if (active || dismissed()) return;
                const okBtn = document.querySelector(DONGNI_SELECTORS.MULTI_DEVICE_OK_BTN);
                if (!okBtn || !okBtn.getClientRects().length) return;
                active = true;
                firePointerClick(okBtn);
                console.log('[懂你] 已向多设备弹窗「我知道了」派发完整指针点击序列');

                let done = false;
                const check = setInterval(() => {
                    if (dismissed()) {
                        done = true;
                        clearInterval(check);
                        active = false;
                        console.log('[懂你] 多设备弹窗已关闭');
                    }
                }, 250);
                setTimeout(() => {
                    clearInterval(check);
                    active = false;
                    if (!done && !dismissed()) {
                        console.warn('⚠️ [懂你] 多设备弹窗自动关闭失败：请手动点击「我知道了」（切勿点「退出其他设备」）');
                        if (!toastShown && typeof showToast === 'function') {
                            toastShown = true;
                            showToast('⚠️ 检测到多设备在线弹窗：请手动点击「我知道了」关闭（勿点「退出其他设备」）');
                        }
                    }
                }, 5000);
            } catch (e) {
                active = false;
                console.warn('[懂你] 多设备弹窗处理异常（不影响批改）:', e && e.message);
            }
        };

        // 注册即尝试一次（弹窗可能已存在）+ 常驻观察（弹窗多为注册后才弹出）
        dismissIfPresent();
        try {
            const obs = new MutationObserver(() => dismissIfPresent());
            obs.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true });
        } catch (e) { /* 观察失败不阻塞：dismissIfPresent 仍可被调用方触发 */ }
    },

    onPageLoad() {
        // 幂等兜底（#329）：安装主入口在注册 IIFE，此处仅保证将来 core 补调用点时可安全重入
        this._installMultiDeviceDismissal();
    },
};

// 注册守卫（#324 教训：无守卫注册会劫持全平台会话）：
// shouldInitialize 域名+路径双闸，且不覆盖其他适配器已建立的注册；
// 初始化副作用放注册处（#329：core 从不调用 onPageLoad，挂死钩子永不执行）
if (DongniAdapter.shouldInitialize() && !window.__AI_MARKER_ADAPTER__) {
    DongniAdapter._installMultiDeviceDismissal();
    window.__AI_MARKER_ADAPTER__ = DongniAdapter;
}
