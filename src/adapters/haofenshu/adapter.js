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
//     - 路径序号属于图片，组合题可跨多张图片，不能要求同任务的序号相同。
//       当前图片组件的 taskKey + imgUrl 关联完整题块，和已显示图片一致后才可取图。
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

    // 原生图片组件在加载任务时同步赋值 taskKey 和 imgUrl（blockImg.split(',')）。
    // 只读当前图片容器及其父组件，避免从预加载队列或其他题块取得任务。
    _nativeImageTask() {
        const seen = new Set();
        for (let node = document.querySelector('#subjectmark_content_img'); node; node = node.parentElement) {
            for (let page = node.__vue__; page && !seen.has(page); page = page.$parent) {
                seen.add(page);
                if ('taskKey' in page && 'imgUrl' in page) {
                    return { key: page.taskKey, urls: page.imgUrl };
                }
            }
        }
        return null;
    },

    _imagePath(url) {
        return typeof url === 'string' && /^https?:\/\//i.test(url.trim())
            ? url.trim().split(/[?#]/)[0] : '';
    },

    // 当前任务和页面图集必须完整对应。签名轮换不改变对应关系，缺图、旧图或多图均不放行。
    _imageSnapshot() {
        const urls = this._visibleImageUrls();
        const task = this._nativeImageTask();
        if (task) {
            const key = task.key == null ? '' : String(task.key).trim();
            if (!key || !Array.isArray(task.urls) || !task.urls.length) return null;
            const expected = task.urls.map(u => this._imagePath(u));
            const actual = urls.map(u => this._imagePath(u));
            if (expected.some(u => !u) || new Set(expected).size !== expected.length ||
                actual.length !== expected.length || actual.some((u, i) => u !== expected[i])) return null;
            return { urls, identity: JSON.stringify([this.getTaskIdentifier(), key]), native: true };
        }
        // 已取得原生任务后，组件短暂重建不降级为图片序号，避免把未知状态报告成另一份卷。
        if (this._collectedImageSnapshot?.native) return null;
        // 没有原生关联时，仅沿用已验证的同路径序号兼容规则，不能猜测不同序号属于同卷。
        const keyed = urls.map(u => ({ u, key: this._sheetKey(u) })).filter(x => x.key);
        const keys = new Set(keyed.map(x => x.key));
        return keys.size === 1 ? { urls: keyed.map(x => x.u), identity: [...keys][0], native: false } : null;
    },

    // ---- 图片身份（换卷强信号）----
    // 单张图片的路径序号；仅作原生任务数据缺失时的兼容依据。提取不到时回退
    // 「去 query + 去裁切坐标后缀」的路径（仍可容忍签名抖动/重裁切）
    getQuestionContext() {
        const inputs = this.getScoreInputs();
        if (!inputs.length) return null;
        const units = inputs.map(input => ({
            label: input.element?.closest('.score-list')?.querySelector('.block-title')?.textContent?.trim() || '',
            maxScore: input.maxScore
        }));
        if (units.some(unit => !unit.label)) return null;
        return { question: units.map(unit => unit.label).join('、'), units };
    },

    _sheetIdentity(url) {
        if (typeof url !== 'string' || !url) return '';
        const key = this._sheetKey(url);
        if (key) return key;
        return url.split('?')[0].split('#')[0].replace(/_\d+_\d+_\d+_\d+(\.\w+)$/, '$1');
    },

    // 两类图片路径共享 subject|exam|imageSerial；裁剪参数和签名不参与。
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

    // 原生任务给出组合题的完整图集；不能用单张图片序号替代整份任务身份。
    async gatherAnswerImages() {
        // 等待 SVG 裁剪图渲染/懒加载
        await new Promise(r => setTimeout(r, 1000));
        const snapshot = this._imageSnapshot();
        if (!snapshot) {
            console.warn('⚠️ [好分数] 当前任务与完整答题卡图片尚未对应，暂不取图');
            return [];
        }
        this._collectedImageSnapshot = snapshot;
        console.log(`🖼️ [好分数] 已取得完整答题卡 ${snapshot.urls.length} 张`);
        return snapshot.urls;
    },

    async fetchImageAsBase64(url) {
        // OSS 签名 URL 直取；core 实现自带 403/瞬态重试/显式 reject（拿不准宁可不取）
        return fetchImageAsBase64(url);
    },

    prepareGrading() {
        const auto = document.querySelector(HAO_FENSHU_SELECTORS.AUTO_SUBMIT_CHECKBOX + ' input[type="checkbox"]');
        if (auto?.checked) auto.click();
        if (auto?.checked) {
            this.lastFillError = '请先关闭平台自动提交';
            return false;
        }
        return true;
    },

    _collectedTaskIsCurrent() {
        if (!this._collectedImageSnapshot?.native) return true;
        const current = this._imageSnapshot();
        if (current?.native && current.identity === this._collectedImageSnapshot.identity) return true;
        this.lastFillError = '当前答题卡已变化或尚未加载完整，请重新批改';
        return false;
    },

    // 身份和取图共用快照；未完成的过渡状态返回 null，交由 core 重查。
    getPaperIdentity() {
        try {
            return this._imageSnapshot()?.identity || null;
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
        this.lastFillError = '';
        if (!this._collectedTaskIsCurrent() || !this.prepareGrading()) return false;
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
        if (!this._collectedTaskIsCurrent()) return false;
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

    // 新任务的完整图集出现且旧图退出后才继续；签名变化、清空分数和部分换图均不是完成证据。
    async waitForNextPaper(oldImageUrl, options = {}) {
        // 空旧图无从比较（#315 G5）：宁等勿错——fail-open 会同卷重复批改
        if (!oldImageUrl) return false;
        const win = Number(window.__AI_MARKER_WAIT_WINDOW_MS__);
        const windowMs = (isFinite(win) && win > 0) ? win : 25000;
        const tick = Math.max(50, Math.min(500, Math.floor(windowMs / 5)));
        const deadline = Date.now() + windowMs;
        const oldKey = this._sheetKey(oldImageUrl);
        const oldId = this._sheetIdentity(oldImageUrl);
        while (true) {
            if (options.signal?.aborted) return false;
            try {
                const current = this._imageSnapshot();
                const collected = this._collectedImageSnapshot;
                if (collected?.native && collected.urls.some(u => this._imagePath(u) === this._imagePath(oldImageUrl))) {
                    // 新任务身份、完整新图集及旧图退出必须同时成立，部分换图不能算换卷。
                    const oldPaths = new Set(collected.urls.map(u => this._imagePath(u)));
                    if (current?.native && current.identity !== collected.identity &&
                        current.urls.every(u => !oldPaths.has(this._imagePath(u)))) return true;
                } else if (current) {
                    const urls = current.urls;
                    if (oldKey) {
                        const keys = new Set(urls.map(u => this._sheetKey(u)).filter(Boolean));
                        if (keys.size > 0 && !keys.has(oldKey)) return true;
                    } else {
                        const cur = new Set(urls.map(u => this._sheetIdentity(u)).filter(Boolean));
                        if (cur.size > 0 && !cur.has(oldId)) return true;
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
