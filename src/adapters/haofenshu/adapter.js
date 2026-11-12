// ========== 好分数适配器 ==========
// yue.haofenshu.com — Vue + jQuery「好分数精准教学」新 UI（#scoringBoard 打分板 + SVG 裁剪图）
//
// 实测现场（用户完整诊断，/minions/subject/{subjectId}/mark/{taskId}/normal/{index}）：
//   答案图：div#subjectmark_content_img > .images-box > svg.svg-wrapper > image.svg-image
//     xlink:href 支持两类路径：
//       /v1/baidu-raw/cutimage/{subject}/{exam}/{part}/{sheetSerial}/{hash}_{x}_{y}_{w}_{h}.jpg
//       /v1/baidu-raw/{subject}/{exam}/{part}/{sheetSerial}/{hash}.jpg%40c_…
//     - query 为 OSS 签名，同一份卷两次取图会抖动 → **不得**当换卷证据
//     - 尾部 _{x}_{y}_{w}_{h} 为裁切坐标，重裁会变 → 也不得当换卷证据
//     - 两类路径均以 subject/exam/part/sheetSerial 编排；sheetSerial 为答题卡序号
//       （如 000117），同卷各小题裁剪图共用，换卷必变
//       → 换卷强信号（getPaperIdentity/waitForNextPaper 只认它）
//     - 偶发 942×4 残片/小图标 → 过滤（兜底宁可不取，坏图批改比空图严重）
//   分数输入：#scoringBoard .quick-mark > .score-list（span.block-title「一.12」+ input.score-input，
//     placeholder「满分4分」「满分3分」，首行带 active）
//   提交：button.submit-button「提交」；footer 自动提交 checkbox/暂不打分/满分零分大按钮；#stepMark 步长面板

const HaofenshuAdapter = {
    name: '好分数',
    id: 'haofenshu',
    urlPatterns: ['https://yue.haofenshu.com/minions/*'],
    iconUrl: 'https://yue.haofenshu.com/favicon.ico',

    shouldInitialize() {
        // hostMatches 精确姿势（strict-a 附 B）：精确域 + 子域级，禁 includes 子串
        const h = (window.location.hostname || '').toLowerCase();
        return (h === 'haofenshu.com' || h.endsWith('.haofenshu.com')) &&
               window.location.pathname.includes('/minions/');
    },

    // 防串台三特征（#324 教训）：答案图 + 分数输入 + 提交按钮必须同框才算批改页，
    // 任一单独出现（如普通页也有「提交」按钮）不得放行
    async detectMarkingPage() {
        console.log('🔎 [诊断] 好分数 — 开始检测批改页面...');
        try {
            await Promise.all([
                waitForElement(HAO_FENSHU_SELECTORS.PAGE_DETECT_IMAGE, 10000),
                waitForElement(HAO_FENSHU_SELECTORS.PAGE_DETECT_INPUT, 10000),
                waitForElement(HAO_FENSHU_SELECTORS.PAGE_DETECT_SUBMIT, 10000),
            ]);
            console.log('✅ [诊断] 三特征同框（答案图 + 分数框 + 提交按钮）');
            return true;
        } catch (e) { /* 三特征未凑齐 → 兜底复查 */ }

        await new Promise(resolve => setTimeout(resolve, 3000));
        const hasImage = document.querySelector(HAO_FENSHU_SELECTORS.ANSWER_IMAGE);
        const hasInput = document.querySelector(HAO_FENSHU_SELECTORS.SCORE_INPUT);
        const hasBtn = document.querySelector(HAO_FENSHU_SELECTORS.SUBMIT_BUTTON);
        const detected = !!(hasImage && hasInput && hasBtn);
        console.log(`🔎 [诊断] 兜底检测 — 图片: ${!!hasImage}, 输入框: ${!!hasInput}, 提交: ${!!hasBtn}, 最终: ${detected}`);
        return detected;
    },

    // 供答卷校验判「已离开批改页面」；无法判定的组合一律 false（弱信号不拦截由 core 放行）
    isMarkingPage() {
        return !!(document.querySelector(HAO_FENSHU_SELECTORS.ANSWER_IMAGE) &&
                  document.querySelector(HAO_FENSHU_SELECTORS.SCORE_INPUT) &&
                  document.querySelector(HAO_FENSHU_SELECTORS.SUBMIT_BUTTON));
    },

    getTaskIdentifier() {
        // URL: /minions/subject/{subjectId}/mark/{taskId}/normal/{index}
        return window.location.pathname;
    },

    // ---- 图片身份（换卷强信号）----
    // 已知答题卡路径里的 sheetSerial 同卷稳定、换卷必变；提取不到时回退
    // 「去 query + 去裁切坐标后缀」的路径（仍可容忍签名抖动/重裁切）
    _sheetIdentity(url) {
        if (typeof url !== 'string' || !url) return '';
        const key = this._sheetKey(url);
        if (key) return key;
        return url.split('?')[0].split('#')[0].replace(/_\d+_\d+_\d+_\d+(\.\w+)$/, '$1');
    },

    // 两类题块图共享 subject|exam|sheetSerial；裁剪参数和签名不参与身份。
    _sheetKey(url) {
        const path = typeof url === 'string' ? url.split(/[?#]/)[0] : '';
        const m = path.match(/\/(?:cutimage|baidu-raw)\/(\d+)\/(\d+)\/\d+\/(\d+)\//);
        return m ? m[1] + '|' + m[2] + '|' + m[3] : null;
    },

    // 收集当前页答案图 URL（原始，含签名；不做废图过滤，供诊断对比用）
    // 优先限定实测容器 #subjectmark_content_img，防止页面其他 .images-box 废图混入
    _rawImageUrls() {
        let nodes = document.querySelectorAll('#subjectmark_content_img ' + HAO_FENSHU_SELECTORS.ANSWER_IMAGE);
        if (!nodes.length) nodes = document.querySelectorAll(HAO_FENSHU_SELECTORS.ANSWER_IMAGE);
        return Array.from(nodes).map(el =>
            (el.getAttribute('xlink:href') || el.getAttribute('href') || (el.href && el.href.baseVal) || '').trim()
        );
    },

    // 过滤废图后取图（兜底宁可不取）：非 http / 隐藏残留 / 942×4 残片 / 小图标 / 同图双挂。
    // 可见性判定对齐 huahanyun #306：隐藏残留/离屏预载能骗过尺寸过滤（visibility:hidden
    // 矩形非零），必须 checkVisibility + 计算样式兜底剔除，只留真可见图
    _visibleImageUrls() {
        let nodes = document.querySelectorAll('#subjectmark_content_img ' + HAO_FENSHU_SELECTORS.ANSWER_IMAGE);
        if (!nodes.length) nodes = document.querySelectorAll(HAO_FENSHU_SELECTORS.ANSWER_IMAGE);
        const urls = [];
        const seen = new Set();
        let junk = 0, notLaidOut = 0, hidden = 0;
        for (const el of Array.from(nodes)) {
            const url = (el.getAttribute('xlink:href') || el.getAttribute('href') || (el.href && el.href.baseVal) || '').trim();
            if (!/^https?:/i.test(url)) continue;
            // 真可见性（#306）：checkVisibility 优先，计算样式兜底
            if (typeof el.checkVisibility === 'function') {
                if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) {
                    hidden++;   // 隐藏残留旧图——不计废图，但不得进可见集
                    continue;
                }
            } else if (typeof getComputedStyle === 'function') {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.1) {
                    hidden++;
                    continue;
                }
            }
            const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
            if (rect.width === 0 && rect.height === 0) {
                // 未布局/懒加载瞬间（strict-a H2 误杀面①）：跳过本轮重试，不算废图
                notLaidOut++;
                continue;
            }
            if (rect.height < 12 || rect.width < 40) {
                junk++;   // 942×4 残片、小图标
                continue;
            }
            const key = url.split('?')[0];   // 去签名 query 去重（同图双挂）
            if (seen.has(key)) continue;
            seen.add(key);
            urls.push(url);
        }
        if (junk > 0) {
            console.warn(`⚠️ [好分数] 过滤废图 ${junk} 张（残片/小图标不进 AI，宁可不取）`);
        }
        if (nodes.length > 0 && urls.length === 0) {
            console.warn(`⚠️ [好分数] ${nodes.length} 张候选图全部被过滤/未布局（废图 ${junk}、隐藏 ${hidden}、未布局 ${notLaidOut}），本轮不取图`);
        }
        return urls;
    },

    // 取图（#312 单卷一致性，对齐 huahanyun）：只认带 sheetSerial 的题块图，且**可见集
    // 必须同属一份卷**——混入他卷残留/他人图时整体拒绝（宁可不取，防错卷喂 AI）；
    // 非题块图（无已知路径序列）剔除不参与
    async gatherAnswerImages() {
        // 等待 SVG 裁剪图渲染/懒加载
        await new Promise(r => setTimeout(r, 1000));
        const raw = this._rawImageUrls();
        const keyed = this._visibleImageUrls()
            .map(u => ({ u, key: this._sheetKey(u) }))
            .filter(x => x.key);
        const keys = new Set(keyed.map(x => x.key));
        if (keys.size === 0) {
            console.warn(`⚠️ [好分数] 可见图中无题块序列图（候选 ${raw.length} 张）→ 不取图（宁可不取）`);
            return [];
        }
        if (keys.size > 1) {
            console.warn(`⚠️ [好分数] 可见图卷标识不一致（${[...keys].join('、')}）→ 整体拒绝取图（宁可不取，防新旧混图喂 AI）`);
            return [];
        }
        const urls = keyed.map(x => x.u);
        console.log(`🖼️ [诊断] SVG image 元素 ${raw.length} 个，单卷一致性过滤后 ${urls.length} 张（${[...keys][0]}）`);
        return urls;
    },

    async fetchImageAsBase64(url) {
        // OSS 签名 URL 直取；core 实现自带 403/瞬态重试/显式 reject（拿不准宁可不取）
        return fetchImageAsBase64(url);
    },

    // 试卷稳定标识（#281 强信号，strict-a H1-a 补强）：sheetSerial 同卷稳定（同卷各小题
    // 裁剪图共用），换卷必变；OSS 签名抖动/裁切坐标漂移不影响。
    // 取「可见图（废图/隐藏残留已剔除）」的身份并集——过渡期"旧残留+新图"并存时残留会退场，
    // 原始并集会把残留 serial 记进身份导致换卷误报；口径与 waitForNextPaper 一致。
    // 取不到返回 null → core 退回 URL 归一化比对
    getPaperIdentity() {
        try {
            const ids = [];
            for (const u of this._visibleImageUrls()) {
                const id = this._sheetKey(u);
                if (id && !ids.includes(id)) ids.push(id);
            }
            return ids.length ? ids.sort().join(',') : null;
        } catch (e) {
            return null;
        }
    },

    getScoreInputs() {
        const scoped = document.querySelectorAll('#scoringBoard ' + HAO_FENSHU_SELECTORS.SCORE_LIST);
        const lists = scoped.length ? Array.from(scoped)
            : Array.from(document.querySelectorAll(HAO_FENSHU_SELECTORS.SCORE_LIST));
        const inputs = [];
        lists.forEach((listEl, i) => {
            const titleEl = listEl.querySelector(HAO_FENSHU_SELECTORS.SCORE_LIST_TITLE);
            const inputEl = listEl.querySelector(HAO_FENSHU_SELECTORS.SCORE_INPUT);
            if (inputEl) {
                const label = titleEl?.textContent?.trim() || `第${i + 1}题`;
                // placeholder「满分4分」→ 单元满分（检测不到返回 0，core 强制用户填写）
                const pm = String(inputEl.placeholder || '').match(/满分([\d.]+)分/);
                const maxScore = pm ? parseFloat(pm[1]) : 0;
                inputs.push({ element: inputEl, label, index: i, maxScore });
            }
        });
        return inputs;
    },

    fillScores(scores) {
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) return false;

        // 数据安全：三遍式（#296 两遍式全或无 + strict-b §6.5 写后验证/数值校验）
        // 第一遍：全量校验——缺失/错位/NaN/负分/越界任一命中即整体拒绝
        if (scores.length > inputs.length) {
            console.warn(`⚠️ [好分数] 分数个数(${scores.length})多于输入框数(${inputs.length})（配置错位）→ 拒绝`);
            return false;
        }
        for (let i = 0; i < inputs.length; i++) {
            const s = scores[i];
            if (s === null || s === undefined) {
                console.warn(`⚠️ [好分数] ${inputs[i].label} 无 AI 分数（第 ${i + 1} 题缺失）→ 拒绝`);
                return false;
            }
            const n = Number(s);
            if (!isFinite(n)) {
                console.warn(`⚠️ [好分数] ${inputs[i].label} 分数非法（${s} 非有限数）→ 拒绝`);
                return false;
            }
            if (n < 0) {
                console.warn(`⚠️ [好分数] ${inputs[i].label} 分数为负（${s}）→ 拒绝`);
                return false;
            }
            if (inputs[i].maxScore > 0 && n > inputs[i].maxScore) {
                console.warn(`⚠️ [好分数] ${inputs[i].label} 分数 ${s} 超出满分 ${inputs[i].maxScore} → 拒绝`);
                return false;
            }
        }

        // 第二遍：全部命中才写入（Vue 受控输入：native setter + 事件链）
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        for (let i = 0; i < inputs.length; i++) {
            setter.call(inputs[i].element, scores[i]);
            inputs[i].element.dispatchEvent(new Event('input', { bubbles: true }));
            inputs[i].element.dispatchEvent(new Event('change', { bubbles: true }));
            inputs[i].element.dispatchEvent(new Event('blur', { bubbles: true }));
            console.log(`✅ [诊断] ${inputs[i].label} 分数 ${scores[i]} 已填入`);
        }

        // 第三遍：写后回读逐字比对（防 Vue 受控输入回写/钳制清空 → 空分带病提交）
        for (let i = 0; i < inputs.length; i++) {
            const written = String(inputs[i].element.value == null ? '' : inputs[i].element.value).trim();
            const expected = String(scores[i]).trim();
            if (written !== expected) {
                console.warn(`⚠️ [好分数] ${inputs[i].label} 写后回读不符（期望 ${expected}，实际 ${written}）→ 拒绝`);
                return false;
            }
        }
        return true;
    },

    submitGrade() {
        const submitBtn = document.querySelector(HAO_FENSHU_SELECTORS.SUBMIT_BUTTON);
        if (!submitBtn) {
            console.warn('⚠️ [好分数] 未找到提交按钮 → 拒绝提交');
            return false;
        }
        if (submitBtn.disabled || submitBtn.getAttribute('disabled') !== null) {
            console.warn('⚠️ [好分数] 提交按钮不可用 → 拒绝提交');
            return false;
        }
        console.log('✅ [好分数] 点击提交按钮');
        submitBtn.click();
        return true;
    },

    // 换卷判定（#306 集合退出 + #309 阻塞式窗口 + #312 正向证据，对齐 huahanyun）：
    // 阻塞式等待——内部轮询至窗口结束（默认 25s 与全仓对齐），旧卷标识退出**且
    // 题块图集非空**（新卷图已出现）才返回 true；窗口耗尽才 false 交 core 重试。
    // 签名 query 抖动/裁切坐标漂移不得当换卷证据；输入框清空是弱信号不参与判定
    async waitForNextPaper(oldImageUrl) {
        // 空旧图无从比较（#315 G5）：宁等勿错——fail-open 会同卷重复批改
        if (!oldImageUrl) return false;
        const win = Number(window.__AI_MARKER_WAIT_WINDOW_MS__);
        const windowMs = (isFinite(win) && win > 0) ? win : 25000;
        const tick = Math.max(50, Math.min(500, Math.floor(windowMs / 5)));
        const deadline = Date.now() + windowMs;
        const oldKey = this._sheetKey(oldImageUrl);
        const oldId = this._sheetIdentity(oldImageUrl);
        while (true) {
            try {
                const urls = this._visibleImageUrls();
                if (oldKey) {
                    // 强标识路径（#312 正向证据）：只认题块序列图（旁图/残片不参与判定），
                    // 题块图非空且旧卷标识退出 → 换卷成立（可见集只含新卷，防混图喂 AI）
                    const keys = new Set(urls.map(u => this._sheetKey(u)).filter(Boolean));
                    if (keys.size > 0 && !keys.has(oldKey)) {
                        console.log(`✅ [好分数] 新试卷已加载（旧标识 ${oldKey} 退出可见集，现集合 ${[...keys].join('、')}）`);
                        return true;
                    }
                } else {
                    // 兜底：非标准 URL（无已知路径序列）——按归一化路径集合判定（拿不准宁可等待）
                    const cur = new Set(urls.map(u => this._sheetIdentity(u)).filter(Boolean));
                    if (cur.size > 0 && !cur.has(oldId)) {
                        console.log(`✅ [好分数] 新试卷已加载（路径集合判定，旧 ${oldId} 已退出）`);
                        return true;
                    }
                }
            } catch (e) { /* 读取瞬态失败继续等 */ }
            if (Date.now() >= deadline) {
                console.warn('⚠️ [好分数] 等待下一份试卷超时');
                return false;
            }
            await new Promise(r => setTimeout(r, tick));
        }
    },

    isRegradeMode() {
        // 好分数暂未发现明确的回评模式标识；无强证据一律按非回评（弱信号不触发）
        return !!window.aiGradingState?.isRegrading;
    },
};

// 注册守卫（#324 教训 + strict-a 附 A.0）：自查 shouldInitialize → 先到先得（不覆盖）→
// 已注册且我也认领本页 = 多命中冲突，console.error 红灯告警（静默劫持变可见）→ 异常 fail-closed
(function registerHaofenshuAdapter() {
    try {
        if (!HaofenshuAdapter.shouldInitialize()) return;
        const existing = window.__AI_MARKER_ADAPTER__;
        if (existing) {
            console.error(`🚫 [注册冲突] ${existing.name} 已注册，但 好分数(haofenshu) 也认领本页（疑似串台/劫持），保留先到者`);
            return;
        }
        window.__AI_MARKER_ADAPTER__ = HaofenshuAdapter;
    } catch (e) {
        console.warn('⚠️ [注册] 判定异常，fail-closed 不注册:', e);
    }
})();
