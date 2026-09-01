// ========== C30教育云适配器 ==========
// zy.iclass30.com — Vue + Element UI + Canvas 渲染答题卡
// 图片来源：拦截 scanpaper.iclass30.com 图片请求 + getCorrectStuList API
// 评分方式：el-input 输入框 + .tab-score-btn 快捷按钮
// 无显式提交按钮，平台打分后自动提交并推进到下一人

// ===== 模块级拦截器（文件加载时立即安装，不遗漏任何请求）=====
(function() {
    if (window.__C30_INTERCEPTOR_INSTALLED__) return;
    window.__C30_INTERCEPTOR_INSTALLED__ = true;

    const state = {
        imageCache: new Map(),        // url -> base64
        latestImageUrl: null,         // 最新图片 URL
        latestBase64: null,           // 最新图片 base64
        studentListData: null,        // getCorrectStuList 响应
        latestApiTimestamp: 0,
        onStudentListReady: null,     // Promise resolve
    };
    // 暴露给适配器实例
    window.__C30_STATE__ = state;

    // ---- Fetch 拦截 ----
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
        const url = (typeof args[0] === 'string') ? args[0] : args[0]?.url || '';

        const resp = await origFetch.apply(this, args);

        try {
            // 拦截学生列表 API
            if (url.includes('getCorrectStuList')) {
                console.log('🎯 [C30] Fetch 命中 getCorrectStuList');
                const cloned = resp.clone();
                cloned.json().then(data => {
                    window.__C30_ADAPTER__?._handleStudentList(data);
                }).catch(() => {});
            }

            // 拦截 scanpaper 图片请求
            if (url.includes('scanpaper.iclass30.com') && resp.ok) {
                console.log('🖼️ [C30] Fetch 命中 scanpaper 图片:', url.substring(0, 120));
                const cloned = resp.clone();
                cloned.arrayBuffer().then(buf => {
                    const bytes = new Uint8Array(buf);
                    let bin = '';
                    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
                    const b64 = window.btoa(bin);
                    state.imageCache.set(url, b64);
                    state.latestImageUrl = url;
                    state.latestBase64 = b64;
                    console.log(`✅ [C30] 图片已缓存 (${Math.round(b64.length / 1024)} KB base64)`);
                }).catch(e => {
                    console.warn('⚠️ [C30] 图片响应读取失败:', e.message);
                });
            }
        } catch (e) { /* 静默 */ }

        return resp;
    };

    // ---- XHR 拦截 ----
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__c30Url = url;
        return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        const xhr = this;
        const url = xhr.__c30Url || '';

        // 学生列表 API
        if (url.includes('getCorrectStuList')) {
            console.log('🎯 [C30] XHR 命中 getCorrectStuList');
            xhr.addEventListener('load', function() {
                try {
                    const data = JSON.parse(xhr.responseText);
                    window.__C30_ADAPTER__?._handleStudentList(data);
                } catch (e) {}
            });
        }

        // scanpaper 图片
        if (url.includes('scanpaper.iclass30.com')) {
            xhr.addEventListener('load', function() {
                if (xhr.status >= 200 && xhr.status < 300) {
                    console.log('🖼️ [C30] XHR 命中 scanpaper 图片:', url.substring(0, 120));
                    try {
                        const bytes = new Uint8Array(xhr.response);
                        let bin = '';
                        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
                        const b64 = window.btoa(bin);
                        state.imageCache.set(url, b64);
                        state.latestImageUrl = url;
                        state.latestBase64 = b64;
                        console.log(`✅ [C30] 图片已缓存 (${Math.round(b64.length / 1024)} KB base64)`);
                    } catch (e) {
                        console.warn('⚠️ [C30] XHR 图片处理失败:', e.message);
                    }
                }
            });
            // 确保 XHR 返回二进制数据
            if (!xhr.responseType || xhr.responseType === 'text') {
                try { xhr.responseType = 'arraybuffer'; } catch(e) {}
            }
        }

        return origSend.apply(this, args);
    };

    console.log('🔧 [C30] 模块级拦截器已安装（fetch + XHR，scanpaper 图片缓存）');
})();


// ===== 适配器主体 =====
const C30Adapter = {
    name: 'C30教育云',
    id: 'c30',
    urlPatterns: ['*://zy.iclass30.com/*'],
    iconUrl: '',

    // 获取模块级共享状态
    get _state() { return window.__C30_STATE__ || {}; },

    // 处理学生列表 API 响应（由模块级拦截器调用）
    _handleStudentList(data) {
        if (!data || data.code !== 1 || !Array.isArray(data.data)) {
            console.warn('⚠️ [C30] 学生列表数据无效:', data?.code);
            return;
        }

        const state = this._state;
        state.latestApiTimestamp = Date.now();
        state.studentListData = data.data;

        console.log(`📋 [C30] 学生列表: ${data.data.length} 名`);

        // 找当前学生（correctState === 0 = 待批改）
        const current = data.data.find(s => s.correctState === 0) || data.data[0];
        if (current) {
            const resList = current.stuNewResList || current.stuResList || [];
            const imgUrl = resList[0]?.source || null;
            if (imgUrl) {
                state.latestImageUrl = imgUrl;
            }
            console.log(`👤 [C30] 当前: ${current.stuName}, 图片: ${imgUrl ? '有' : '无'}`);
        }

        // 通知等待者
        if (state.onStudentListReady) {
            state.onStudentListReady();
            state.onStudentListReady = null;
        }
    },

    shouldInitialize() {
        const ok = window.location.hostname.includes('zy.iclass30.com');
        console.log(`🔍 [C30] shouldInitialize: ${ok}`);
        return ok;
    },

    isMarkingPage() {
        return window.location.hash.includes('/webCorrect');
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('🔎 [C30] 不在阅卷页面 (hash:', window.location.hash, ')');
            return false;
        }

        console.log('🔎 [C30] 检测批改页面...');
        try {
            const result = await Promise.race([
                waitForElement(C30_SELECTORS.PAGE_DETECT_CANVAS, 8000).then(() => 'canvas'),
                waitForElement(C30_SELECTORS.PAGE_DETECT_SCORE, 8000).then(() => 'score-input'),
                waitForElement(C30_SELECTORS.PAGE_DETECT_MAIN, 8000).then(() => 'main-container'),
            ]).catch(() => null);

            if (result) {
                console.log(`✅ [C30] 检测到: ${result}`);
                this._logPageState();
                return true;
            }

            await new Promise(r => setTimeout(r, 2000));
            const ok = !!(document.querySelector(C30_SELECTORS.ANSWER_CANVAS) ||
                (document.querySelector(C30_SELECTORS.SCORE_INPUT) && document.querySelector(C30_SELECTORS.MAIN_CONTAINER)));
            console.log(`🔎 [C30] 兜底: ${ok}`);
            if (ok) this._logPageState();
            return ok;
        } catch (e) {
            console.error('❌ [C30] detectMarkingPage:', e);
            return false;
        }
    },

    // ===== 页面状态快照 =====
    _logPageState() {
        console.log('📊 [C30] ===== 页面快照 =====');

        // Canvas
        const canvas = document.querySelector(C30_SELECTORS.ANSWER_CANVAS);
        if (canvas) {
            console.log(`  🖼️ Canvas: ${canvas.width}x${canvas.height}, display ${canvas.clientWidth}x${canvas.clientHeight}, crossOrigin="${canvas.crossOrigin || ''}"`);
            try {
                const d = canvas.toDataURL('image/png');
                console.log(`     toDataURL: OK (${Math.round(d.length * 0.75 / 1024)} KB)`);
            } catch (e) {
                console.log(`     toDataURL: FAIL — ${e.message}`);
            }
        }

        // 所有 input.el-input__inner
        const inputs = document.querySelectorAll('input.el-input__inner');
        console.log(`  📝 el-input: ${inputs.length} 个`);
        inputs.forEach((inp, i) => {
            const r = inp.getBoundingClientRect();
            console.log(`     [${i}] ph="${inp.placeholder}" val="${inp.value}" ro=${inp.readOnly} vis=${r.width > 0} ${Math.round(r.width)}x${Math.round(r.height)}`);
        });

        // 分数按钮
        const btns = document.querySelectorAll(C30_SELECTORS.SCORE_BTN);
        console.log(`  🔢 .tab-score-btn: ${btns.length} 个`);
        btns.forEach((b, i) => {
            console.log(`     [${i}] "${b.textContent.trim()}" vis=${b.getBoundingClientRect().width > 0}`);
        });

        // 题目选择器 — 多种方式尝试读取
        this._logQuestionSelector();

        // 下一人按钮
        const nextBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.includes('下一人'));
        nextBtns.forEach((b, i) => console.log(`  ➡️ 下一人[${i}]: disabled=${b.disabled}`));

        // 缓存状态
        const state = this._state;
        console.log(`  💾 图片缓存: ${state.imageCache?.size || 0} 条, latestUrl: ${state.latestImageUrl ? '有' : '无'}, latestBase64: ${state.latestBase64 ? '有' : '无'}`);

        // Vue
        const app = document.querySelector('#app');
        console.log(`  🟢 Vue: ${app?.__vue__ ? 'yes' : 'no'}`);

        console.log('📊 [C30] ===== 快照结束 =====');
    },

    // 题目选择器诊断
    _logQuestionSelector() {
        const sel = document.querySelector('.ques-select');
        if (!sel) {
            console.log(`  📑 .ques-select: 未找到`);
            return;
        }

        const input = sel.querySelector('input.el-input__inner');
        console.log(`  📑 题目选择器: input.value="${input?.value || ''}" readonly=${input?.readOnly}`);

        // 尝试 Vue 组件
        let comp = input?.__vue__;
        if (!comp) comp = sel.querySelector('.el-input')?.__vue__;
        if (!comp) comp = sel.__vue__;

        if (comp) {
            // 遍历找 el-select 组件
            let elSel = comp;
            while (elSel && elSel.$el && !elSel.value && elSel.$parent) {
                elSel = elSel.$parent;
                if (elSel === elSel.$root) break;
            }
            console.log(`     Vue.value: "${elSel?.value}" (type: ${typeof elSel?.value})`);

            // 尝试通过 $children 找 el-select
            const findSelect = (vm) => {
                if (vm.$options?.componentName === 'ElSelect') return vm;
                for (const child of (vm.$children || [])) {
                    const found = findSelect(child);
                    if (found) return found;
                }
                return null;
            };
            const app = document.querySelector('#app')?.__vue__;
            if (app) {
                const elSelect = findSelect(app);
                if (elSelect) {
                    console.log(`     ElSelect.value: "${elSelect.value}", selectedLabel: "${elSelect.selectedLabel}"`);
                }
            }
        }
    },

    getTaskIdentifier() {
        const urlData = this._getUrlParams();
        const workId = urlData.workId || '';

        // 方式1: 读取 input.value
        const quesInput = document.querySelector(C30_SELECTORS.QUESTION_SELECT);
        let quesNum = quesInput?.value || '';

        // 方式2: 读取 Vue 组件的 selectedLabel / value
        if (!quesNum || quesNum === '请选择题目') {
            quesNum = this._getSelectedQuestion() || '';
        }

        const id = [workId, quesNum].filter(Boolean).join('_') || window.location.href;
        return id;
    },

    // 从 Vue 组件读取当前选中的题号
    _getSelectedQuestion() {
        try {
            // 遍历 Vue 组件树找 ElSelect
            const app = document.querySelector('#app')?.__vue__;
            if (!app) return null;

            const findSelects = (vm, results = []) => {
                if (vm.$options?.componentName === 'ElSelect') results.push(vm);
                for (const child of (vm.$children || [])) {
                    findSelects(child, results);
                }
                return results;
            };

            const selects = findSelects(app);
            for (const sel of selects) {
                // 找题目选择器（在 .correct-header-left 中）
                if (sel.$el?.closest?.('.correct-header-left')) {
                    return sel.selectedLabel || sel.value || null;
                }
            }

            // 兜底：第一个有 ques 相关 class 的 select
            for (const sel of selects) {
                if (sel.$el?.classList?.contains('ques-select') ||
                    sel.$el?.closest?.('.ques-select')) {
                    return sel.selectedLabel || sel.value || null;
                }
            }
        } catch (e) {
            console.warn('⚠️ [C30] _getSelectedQuestion:', e.message);
        }
        return null;
    },

    // ===== 图片获取 =====
    async gatherAnswerImages() {
        console.log('🖼️ [C30] 获取答题卡图片...');
        const state = this._state;

        // 策略1: 从 scanpaper 拦截缓存获取（最优先，平台自己请求的图片）
        if (state.latestBase64 && state.latestImageUrl) {
            console.log(`🖼️ [C30] 使用拦截缓存 (${Math.round(state.latestBase64.length / 1024)} KB)`);
            return ['data:image/png;base64,' + state.latestBase64];
        }

        // 策略2: 从 API 获取 URL，用 GM_xmlhttpRequest 下载
        if (!state.latestImageUrl) {
            console.log('⏳ [C30] 等待 API/拦截数据...');
            await Promise.race([
                new Promise(r => { state.onStudentListReady = r; }),
                new Promise(r => setTimeout(r, 8000)),
            ]);
        }

        if (state.latestImageUrl) {
            // 再检查一次缓存（等待期间可能被拦截器填充）
            const cached = state.imageCache.get(state.latestImageUrl);
            if (cached) {
                console.log(`🖼️ [C30] 等待期间获得缓存 (${Math.round(cached.length / 1024)} KB)`);
                return ['data:image/png;base64,' + cached];
            }

            console.log(`🖼️ [C30] 使用 GM_xmlhttpRequest 下载: ${state.latestImageUrl.substring(0, 100)}...`);
            return [state.latestImageUrl];
        }

        // 策略3: Canvas 导出（兜底）
        const canvas = document.querySelector(C30_SELECTORS.ANSWER_CANVAS);
        if (canvas) {
            try {
                const d = canvas.toDataURL('image/png');
                if (d && d.length > 1000) {
                    console.log(`🖼️ [C30] Canvas 导出 (${Math.round(d.length * 0.75 / 1024)} KB)`);
                    return [d];
                }
            } catch (e) {
                console.warn('⚠️ [C30] Canvas CORS 失败');
            }
        }

        console.error('❌ [C30] 所有图片获取方式均失败');
        return [];
    },

    async fetchImageAsBase64(url) {
        if (url.startsWith('data:')) return url.split(',')[1];

        // 检查拦截缓存
        const cached = this._state.imageCache?.get(url);
        if (cached) {
            console.log(`📥 [C30] 从缓存获取 base64 (${Math.round(cached.length / 1024)} KB)`);
            return cached;
        }

        console.log(`📥 [C30] GM_xmlhttpRequest 下载...`);
        return fetchImageAsBase64(url);
    },

    // ===== 分数输入 =====
    getScoreInputs() {
        const inputs = [];
        const scoreInput = document.querySelector(C30_SELECTORS.SCORE_INPUT);

        if (scoreInput) {
            const ph = scoreInput.placeholder || '';
            const m = ph.match(/满分(\d+)/);
            const max = m ? parseInt(m[1]) : 0;
            inputs.push({
                element: scoreInput,
                label: `满分${max}分`,
                index: 0,
                maxScore: max
            });
            console.log(`📝 [C30] getScoreInputs: max=${max}, ph="${ph}"`);
        } else {
            console.warn('⚠️ [C30] getScoreInputs: 未找到 [placeholder*="满分"]');
            // 诊断所有 input
            document.querySelectorAll('input').forEach((inp, i) => {
                console.log(`  input[${i}]: type=${inp.type} class="${inp.className}" ph="${inp.placeholder}"`);
            });
        }

        return inputs;
    },

    fillScores(scores) {
        if (!scores?.length || scores[0] == null) return false;
        this._pendingScore = scores[0];
        console.log(`📝 [C30] fillScores: ${scores[0]} (待确认)`);
        return true;
    },

    _setScoreValue(score) {
        console.log(`📝 [C30] _setScoreValue(${score})`);

        // 策略1: 快捷按钮
        const btns = document.querySelectorAll(C30_SELECTORS.SCORE_BTN);
        if (btns.length > 0) {
            const texts = [];
            for (const btn of btns) {
                const t = btn.textContent.trim();
                texts.push(t);
                if (t === String(score)) {
                    btn.click();
                    console.log(`✅ [C30] 点击按钮: ${score}`);
                    return true;
                }
            }
            console.log(`  按钮值: [${texts.join(',')}], 无匹配 ${score}`);
        }

        // 策略2: 输入框（Vue + 原生双重设置）
        const scoreInput = document.querySelector(C30_SELECTORS.SCORE_INPUT);
        if (!scoreInput) {
            console.warn('⚠️ [C30] 无分数输入框');
            return false;
        }

        // 查找 Vue 组件实例（向上遍历）
        let vueComp = this._findVueComponent(scoreInput);
        if (vueComp) {
            console.log(`  Vue 组件: ${vueComp.$options?.componentName || vueComp.$options?.name || '?'}`);
            // 尝试设置值
            if ('value' in vueComp) {
                vueComp.value = String(score);
                console.log(`  Vue.value = ${score}`);
            }
            vueComp.$emit?.('input', String(score));
            vueComp.$emit?.('change', String(score));
        } else {
            console.log('  未找到 Vue 组件，仅用原生方式');
        }

        // 原生设置（兜底）
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(scoreInput, String(score));
        scoreInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(score) }));
        scoreInput.dispatchEvent(new Event('change', { bubbles: true }));
        scoreInput.dispatchEvent(new Event('blur', { bubbles: true }));

        console.log(`✅ [C30] 输入框 value="${scoreInput.value}"`);
        return true;
    },

    // 向上遍历查找 Vue 组件实例
    _findVueComponent(el) {
        let node = el;
        for (let i = 0; i < 10 && node; i++) {
            if (node.__vue__) return node.__vue__;
            node = node.parentElement;
        }
        return null;
    },

    submitGrade() {
        console.log('📤 [C30] submitGrade...');
        this._setScoreValue(this._pendingScore);
        this._pendingScore = null;
        this._handleConfirmDialog();

        // 延迟诊断
        setTimeout(() => {
            const inp = document.querySelector(C30_SELECTORS.SCORE_INPUT);
            console.log(`📤 [C30] 后续: input.value="${inp?.value}"`);
            const dialogs = document.querySelectorAll('.el-message-box, .el-dialog');
            if (dialogs.length) console.log(`  弹窗: ${dialogs.length} 个`);
        }, 1000);

        return true;
    },

    _handleConfirmDialog() {
        let count = 0;
        const iv = setInterval(() => {
            count++;
            for (const btn of document.querySelectorAll('.el-message-box__btns button, .el-dialog__footer button')) {
                const t = btn.textContent.trim();
                if (['确认', '确定', 'OK', '保存'].includes(t)) {
                    console.log(`✅ [C30] 自动点击确认: "${t}"`);
                    btn.click();
                    clearInterval(iv);
                    return;
                }
            }
            if (count >= 15) clearInterval(iv);
        }, 200);
    },

    async waitForNextPaper() {
        console.log('⏳ [C30] waitForNextPaper...');
        const state = this._state;
        const startTs = state.latestApiTimestamp;
        const startUrl = state.latestImageUrl;
        const start = Date.now();

        return new Promise(resolve => {
            const iv = setInterval(() => {
                const elapsed = ((Date.now() - start) / 1000).toFixed(0);

                // API 新数据
                if (state.latestApiTimestamp > startTs) {
                    clearInterval(iv);
                    console.log(`✅ [C30] 新卷 (API) ${elapsed}s`);
                    return resolve(true);
                }

                // 图片 URL 变化
                if (startUrl && state.latestImageUrl && state.latestImageUrl !== startUrl) {
                    clearInterval(iv);
                    console.log(`✅ [C30] 新卷 (URL) ${elapsed}s`);
                    return resolve(true);
                }

                // 输入框清空
                const inp = document.querySelector(C30_SELECTORS.SCORE_INPUT);
                if (inp?.value === '' && Date.now() - start > 1500) {
                    clearInterval(iv);
                    console.log(`✅ [C30] 新卷 (input清空) ${elapsed}s`);
                    return resolve(true);
                }

                // 缓存变化（新图片被拦截到）
                if (state.imageCache.size > 0 && state.latestBase64) {
                    // 如果有新的图片被缓存且不同于之前的
                    const currentCached = state.imageCache.get(state.latestImageUrl);
                    if (currentCached && currentCached !== state.latestBase64) {
                        clearInterval(iv);
                        console.log(`✅ [C30] 新卷 (图片缓存) ${elapsed}s`);
                        return resolve(true);
                    }
                }

                if (Date.now() - start > 30000) {
                    clearInterval(iv);
                    console.warn(`⚠️ [C30] 超时 30s`);
                    resolve(false);
                }
            }, 500);
        });
    },

    isRegradeMode() {
        const d = this._getUrlParams();
        return d.isReview === 1 || d.isReview === '1';
    },

    onPageLoad() {
        console.log('🚀 [C30] onPageLoad');
        console.log(`  URL hash: ${window.location.hash}`);
        const d = this._getUrlParams();
        console.log(`  workId=${d.workId}, title=${d.workTitle}, isReview=${d.isReview}`);

        // 模块级拦截器已在文件加载时安装
        // 延迟打印快照
        setTimeout(() => this._logPageState(), 2000);

        // 自动检测满分值并写入配置
        setTimeout(() => this._autoDetectMaxScore(), 3000);
    },

    // 从页面自动检测满分值，更新到当前 preset
    _autoDetectMaxScore() {
        const pm = window.PresetManager;
        if (!pm) {
            console.log('📝 [C30] PresetManager 未就绪，跳过满分自动检测');
            return;
        }

        const config = pm.getCurrentConfig();
        const currentMax = config.scoring?.maxScore || 0;
        const hasUnits = (config.scoring?.units || []).length > 0;
        const unitsHaveScore = hasUnits && (config.scoring.units || []).some(u => u.maxScore > 0);

        // 已有满分配置，不覆盖
        if (currentMax > 0 || unitsHaveScore) {
            console.log(`📝 [C30] 满分已配置 (${currentMax || config.scoring.units[0]?.maxScore})，跳过自动检测`);
            return;
        }

        // 从页面检测
        const inputs = this.getScoreInputs();
        if (inputs.length === 0 || inputs[0].maxScore <= 0) {
            console.log('📝 [C30] 页面未检测到满分值');
            return;
        }

        const detected = inputs[0].maxScore;
        console.log(`📝 [C30] 检测到满分: ${detected}，写入配置...`);

        // 更新 preset
        const activeKey = pm.data.active;
        const preset = pm.data.list[activeKey];
        if (!preset) return;

        if (!preset.scoring) preset.scoring = {};
        preset.scoring.maxScore = detected;
        preset.scoring.units = [{
            label: inputs[0].label || '总分',
            maxScore: detected,
            index: 0,
            roundStep: 1
        }];
        pm.save();

        console.log(`✅ [C30] 满分 ${detected} 已写入配置【${activeKey}】`);
    },

    onGradingComplete() {
        console.log('✅ [C30] onGradingComplete');
    },

    // ===== URL 解析 =====
    _getUrlParams() {
        try {
            const hash = window.location.hash || '';
            const qs = hash.split('?')[1] || '';
            const data = new URLSearchParams(qs).get('data');
            if (data) return JSON.parse(decodeURIComponent(data));
        } catch (e) {}
        return {};
    },
};

// 注册
if (C30Adapter.shouldInitialize()) {
    window.__C30_ADAPTER__ = C30Adapter;
    window.__AI_MARKER_ADAPTER__ = C30Adapter;
    console.log('✅ [C30] 适配器已注册');
}
