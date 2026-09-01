// ========== C30教育云适配器 ==========
// zy.iclass30.com — Vue + Element UI + Canvas 渲染答题卡
// 图片来源：getCorrectStuList API 获取 URL + GM_xmlhttpRequest 下载
// 评分方式：el-input 输入框 + .tab-score-btn 快捷按钮
// 无显式提交按钮，平台打分后自动提交并推进到下一人

// ===== 模块级拦截器 =====
// 只拦截 getCorrectStuList API 获取图片 URL
// scanpaper 图片通过 <img> 加载，无法用 fetch/XHR 拦截
(function() {
    if (window.__C30_INTERCEPTOR_INSTALLED__) return;
    window.__C30_INTERCEPTOR_INSTALLED__ = true;

    const state = {
        latestImageUrl: null,
        studentListData: null,
        latestApiTimestamp: 0,
        onStudentListReady: null,
    };
    window.__C30_STATE__ = state;

    function tryHandleStudentList(data) {
        if (!data || typeof data !== 'object') {
            console.warn('⚠️ [C30] 数据不是对象:', typeof data);
            return;
        }
        if (data.code !== 1) {
            console.warn(`⚠️ [C30] API code=${data.code}, msg=${data.msg}`);
            return;
        }
        if (!Array.isArray(data.data)) {
            console.warn(`⚠️ [C30] data 不是数组:`, typeof data.data);
            return;
        }
        console.log(`📋 [C30] 学生列表: ${data.data.length} 名`);
        window.__C30_ADAPTER__?._handleStudentList(data);
    }

    // ---- Fetch 拦截 ----
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
        const url = (typeof args[0] === 'string') ? args[0] : args[0]?.url || '';
        const resp = await origFetch.apply(this, args);
        if (url.includes('getCorrectStuList')) {
            console.log('🎯 [C30-Fetch] 命中 getCorrectStuList');
            try {
                resp.clone().json().then(tryHandleStudentList).catch(e => {
                    console.warn('⚠️ [C30-Fetch] JSON 解析失败:', e.message);
                });
            } catch (e) {
                console.warn('⚠️ [C30-Fetch] clone 失败:', e.message);
            }
        }
        return resp;
    };

    // ---- XHR 拦截 ----
    // 关键：不修改 responseType，避免破坏平台的 HTTP 库
    // 平台用 axios/vue-resource，会在 load 后自行解析 response
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__c30Url = url;
        return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        const xhr = this;
        const url = xhr.__c30Url || '';

        if (url.includes('getCorrectStuList')) {
            console.log('🎯 [C30-XHR] 命中 getCorrectStuList');

            // 用 readystatechange 捕获，在平台处理之前先读
            xhr.addEventListener('readystatechange', function() {
                if (xhr.readyState !== 4) return;
                try {
                    // 平台 responseType='json'，xhr.response 已是解析后的对象
                    if (xhr.response && typeof xhr.response === 'object') {
                        tryHandleStudentList(xhr.response);
                    } else if (xhr.responseText) {
                        tryHandleStudentList(JSON.parse(xhr.responseText));
                    }
                } catch (e) {
                    console.warn('⚠️ [C30-XHR] 解析失败:', e.message,
                        'responseType:', xhr.responseType,
                        'response:', typeof xhr.response);
                }
            });
        }

        return origSend.apply(this, args);
    };

    console.log('🔧 [C30] 模块级拦截器已安装（fetch + XHR）');
})();


// ===== 适配器主体 =====
const C30Adapter = {
    name: 'C30教育云',
    id: 'c30',
    urlPatterns: ['*://zy.iclass30.com/*'],
    iconUrl: '',

    get _state() { return window.__C30_STATE__ || {}; },

    _handleStudentList(data) {
        const state = this._state;
        state.latestApiTimestamp = Date.now();
        state.studentListData = data.data;

        const current = data.data.find(s => s.correctState === 0) || data.data[0];
        if (current) {
            const resList = current.stuNewResList || current.stuResList || [];
            const imgUrl = resList[0]?.source || null;
            if (imgUrl) {
                state.latestImageUrl = imgUrl;
                console.log(`🖼️ [C30] 图片 URL: ${imgUrl.substring(0, 120)}...`);
            }
            console.log(`👤 [C30] 当前: ${current.stuName} (ID:${current.stuId?.slice(-6)})`);
        }

        if (state.onStudentListReady) {
            state.onStudentListReady();
            state.onStudentListReady = null;
        }
    },

    shouldInitialize() {
        return window.location.hostname.includes('zy.iclass30.com');
    },

    isMarkingPage() {
        return window.location.hash.includes('/webCorrect');
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) return false;
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
            if (ok) this._logPageState();
            return ok;
        } catch (e) {
            console.error('❌ [C30] detectMarkingPage:', e);
            return false;
        }
    },

    _logPageState() {
        console.log('📊 [C30] ===== 页面快照 =====');

        const canvas = document.querySelector(C30_SELECTORS.ANSWER_CANVAS);
        if (canvas) {
            console.log(`  🖼️ Canvas: ${canvas.width}x${canvas.height}, display ${canvas.clientWidth}x${canvas.clientHeight}`);
            try {
                const d = canvas.toDataURL('image/png');
                console.log(`     toDataURL: OK (${Math.round(d.length * 0.75 / 1024)} KB)`);
            } catch (e) {
                console.log(`     toDataURL: FAIL — ${e.message}`);
            }
        }

        const inputs = document.querySelectorAll('input.el-input__inner');
        console.log(`  📝 el-input: ${inputs.length} 个`);
        inputs.forEach((inp, i) => {
            const r = inp.getBoundingClientRect();
            console.log(`     [${i}] ph="${inp.placeholder}" val="${inp.value}" ro=${inp.readOnly} vis=${r.width > 0}`);
        });

        // 分数按钮 — 深度诊断
        const btns = document.querySelectorAll(C30_SELECTORS.SCORE_BTN);
        console.log(`  🔢 .tab-score-btn: ${btns.length} 个`);
        btns.forEach((b, i) => {
            const texts = [];
            // 收集所有可能的文本来源
            const directText = b.textContent.trim();
            const innerHTML = b.innerHTML.substring(0, 200);
            const dataAttrs = {};
            for (const attr of b.attributes) {
                if (attr.name.startsWith('data-')) dataAttrs[attr.name] = attr.value;
            }
            // 检查子元素
            const children = Array.from(b.children).map(c => ({
                tag: c.tagName, text: c.textContent.trim(), class: c.className
            }));
            // 检查 Vue 实例
            const vue = b.__vue__;
            const vueValue = vue?.value ?? vue?.score ?? vue?.label ?? vue?.text ?? vue?.$props?.value ?? vue?.$props?.score ?? null;

            console.log(`     [${i}] text="${directText}" vueValue=${vueValue}`, {
                dataAttrs: Object.keys(dataAttrs).length ? dataAttrs : undefined,
                children: children.length ? children : undefined,
                innerHTML: innerHTML.substring(0, 100)
            });
        });

        // 题号
        this._logQuestionSelector();

        // 下一人按钮
        const nextBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.includes('下一人'));
        nextBtns.forEach((b, i) => console.log(`  ➡️ 下一人[${i}]: disabled=${b.disabled}`));

        // 缓存
        const state = this._state;
        console.log(`  💾 latestUrl: ${state.latestImageUrl ? '有' : '无'}, apiTs: ${state.latestApiTimestamp}`);

        console.log('📊 [C30] ===== 快照结束 =====');
    },

    _logQuestionSelector() {
        const sel = document.querySelector('.ques-select');
        if (!sel) { console.log('  📑 .ques-select: 未找到'); return; }
        const input = sel.querySelector('input.el-input__inner');
        console.log(`  📑 题目: input.value="${input?.value}" ro=${input?.readOnly}`);

        // Vue ElSelect
        const app = document.querySelector('#app')?.__vue__;
        if (app) {
            const findSelects = (vm, r = []) => {
                if (vm.$options?.componentName === 'ElSelect') r.push(vm);
                for (const c of (vm.$children || [])) findSelects(c, r);
                return r;
            };
            const selects = findSelects(app);
            for (const s of selects) {
                if (s.$el?.closest?.('.correct-header-left') || s.$el?.closest?.('.ques-select')) {
                    console.log(`     ElSelect: value=${JSON.stringify(s.value)?.substring(0,50)}, selectedLabel="${s.selectedLabel}"`);
                    return;
                }
            }
        }
    },

    getTaskIdentifier() {
        const urlData = this._getUrlParams();
        const workId = urlData.workId || '';

        // 方式1: input.value（readonly 但 JS 可读）
        const quesInput = document.querySelector(C30_SELECTORS.QUESTION_SELECT);
        let quesNum = quesInput?.value || '';

        // 方式2: Vue ElSelect.selectedLabel
        if (!quesNum || quesNum === '请选择题目') {
            quesNum = this._getSelectedQuestion() || '';
        }

        return [workId, quesNum].filter(Boolean).join('_') || window.location.href;
    },

    _getSelectedQuestion() {
        try {
            const app = document.querySelector('#app')?.__vue__;
            if (!app) return null;
            const findSelects = (vm, r = []) => {
                if (vm.$options?.componentName === 'ElSelect') r.push(vm);
                for (const c of (vm.$children || [])) findSelects(c, r);
                return r;
            };
            for (const s of findSelects(app)) {
                if (s.$el?.closest?.('.correct-header-left') || s.$el?.closest?.('.ques-select')) {
                    return s.selectedLabel || null;
                }
            }
        } catch (e) {}
        return null;
    },

    // ===== 图片获取 =====
    async gatherAnswerImages() {
        console.log('🖼️ [C30] 获取答题卡图片...');

        // 等待 Canvas 渲染
        await new Promise(r => setTimeout(r, 500));

        const canvas = document.querySelector(C30_SELECTORS.ANSWER_CANVAS);
        if (canvas) {
            try {
                const d = canvas.toDataURL('image/png');
                if (d && d.length > 1000) {
                    console.log(`🖼️ [C30] Canvas 导出 (${Math.round(d.length * 0.75 / 1024)} KB)`);
                    return [d];
                }
            } catch (e) {
                console.warn('⚠️ [C30] Canvas 导出失败:', e.message);
            }
        }

        console.error('❌ [C30] 无法获取图片');
        return [];
    },

    async fetchImageAsBase64(url) {
        if (url.startsWith('data:')) return url.split(',')[1];
        return fetchImageAsBase64(url);
    },

    // ===== 分数 =====
    getScoreInputs() {
        const scoreInput = document.querySelector(C30_SELECTORS.SCORE_INPUT);
        if (!scoreInput) return [];

        const ph = scoreInput.placeholder || '';
        const m = ph.match(/满分(\d+)/);
        const max = m ? parseInt(m[1]) : 0;
        console.log(`📝 [C30] getScoreInputs: max=${max}, ph="${ph}"`);
        return [{ element: scoreInput, label: `满分${max}分`, index: 0, maxScore: max }];
    },

    fillScores(scores) {
        if (!scores?.length || scores[0] == null) return false;
        this._pendingScore = scores[0];
        console.log(`📝 [C30] fillScores: ${scores[0]}`);
        return true;
    },

    _setScoreValue(score) {
        console.log(`📝 [C30] _setScoreValue(${score})`);

        // 策略1: 快捷按钮（深度匹配：子元素文本、data 属性、Vue 实例）
        const btns = document.querySelectorAll(C30_SELECTORS.SCORE_BTN);
        if (btns.length > 0) {
            for (const btn of btns) {
                const scoreVal = this._extractBtnScore(btn);
                if (scoreVal !== null && String(scoreVal) === String(score)) {
                    btn.click();
                    console.log(`✅ [C30] 点击按钮: ${score} (匹配值: ${scoreVal})`);
                    return true;
                }
            }
            // 记录所有按钮值用于调试
            const vals = Array.from(btns).map(b => this._extractBtnScore(b));
            console.log(`  按钮值: [${vals.join(',')}], 无匹配 ${score}`);
        }

        // 策略2: 输入框
        const scoreInput = document.querySelector(C30_SELECTORS.SCORE_INPUT);
        if (!scoreInput) {
            console.warn('⚠️ [C30] 无分数输入框');
            return false;
        }

        const vueComp = this._findVueComponent(scoreInput);
        if (vueComp) {
            console.log(`  Vue: ${vueComp.$options?.componentName || '?'}`);
            if ('value' in vueComp) vueComp.value = String(score);
            vueComp.$emit?.('input', String(score));
            vueComp.$emit?.('change', String(score));
        }

        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(scoreInput, String(score));
        scoreInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(score) }));
        scoreInput.dispatchEvent(new Event('change', { bubbles: true }));
        scoreInput.dispatchEvent(new Event('blur', { bubbles: true }));

        console.log(`✅ [C30] 输入框 value="${scoreInput.value}"`);
        return true;
    },

    // 从按钮元素提取分数值（多策略）
    _extractBtnScore(btn) {
        // 1. textContent
        const text = btn.textContent.trim();
        if (text && !isNaN(text)) return text;

        // 2. 子元素文本
        for (const child of btn.children) {
            const ct = child.textContent.trim();
            if (ct && !isNaN(ct)) return ct;
        }

        // 3. data 属性
        for (const attr of btn.attributes) {
            if (attr.name.startsWith('data-') && attr.value && !isNaN(attr.value)) {
                return attr.value;
            }
        }

        // 4. Vue 实例
        const vue = btn.__vue__;
        if (vue) {
            const candidates = [vue.value, vue.score, vue.label, vue.text,
                                vue.$props?.value, vue.$props?.score, vue.$props?.label];
            for (const c of candidates) {
                if (c !== undefined && c !== null && !isNaN(c)) return String(c);
            }
        }

        return null;
    },

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

        setTimeout(() => {
            const inp = document.querySelector(C30_SELECTORS.SCORE_INPUT);
            console.log(`📤 [C30] 后续: input.value="${inp?.value}"`);
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
                    console.log(`✅ [C30] 自动确认: "${t}"`);
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
                const sec = ((Date.now() - start) / 1000).toFixed(0);

                if (state.latestApiTimestamp > startTs) {
                    clearInterval(iv);
                    console.log(`✅ [C30] 新卷 (API) ${sec}s`);
                    return resolve(true);
                }
                if (startUrl && state.latestImageUrl && state.latestImageUrl !== startUrl) {
                    clearInterval(iv);
                    console.log(`✅ [C30] 新卷 (URL) ${sec}s`);
                    return resolve(true);
                }
                const inp = document.querySelector(C30_SELECTORS.SCORE_INPUT);
                if (inp?.value === '' && Date.now() - start > 1500) {
                    clearInterval(iv);
                    console.log(`✅ [C30] 新卷 (input清空) ${sec}s`);
                    return resolve(true);
                }
                if (Date.now() - start > 30000) {
                    clearInterval(iv);
                    console.warn('⚠️ [C30] 超时 30s');
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
        const d = this._getUrlParams();
        console.log(`  workId=${d.workId}, title=${d.workTitle}, isReview=${d.isReview}`);

        setTimeout(() => this._logPageState(), 2000);

        // 自动检测满分（带重试）
        this._autoDetectMaxScoreWithRetry(0);
    },

    // 带重试的满分自动检测
    _autoDetectMaxScoreWithRetry(attempt) {
        const MAX_RETRIES = 3;
        const DELAYS = [3000, 5000, 8000]; // 3s, 5s, 8s

        setTimeout(() => {
            const success = this._autoDetectMaxScore();
            if (!success && attempt < MAX_RETRIES - 1) {
                console.log(`📝 [C30] 满分检测未成功，${attempt + 2}/${MAX_RETRIES} 次重试...`);
                this._autoDetectMaxScoreWithRetry(attempt + 1);
            }
        }, DELAYS[attempt]);
    },

    // 返回 true = 检测成功并写入，false = 未检测到或已配置
    _autoDetectMaxScore() {
        const pm = window.PresetManager;
        if (!pm) {
            console.log('📝 [C30] PresetManager 未就绪');
            return false;
        }

        const config = pm.getCurrentConfig();
        const currentMax = config.scoring?.maxScore || 0;
        const units = config.scoring?.units || [];
        const unitsHaveScore = units.length > 0 && units.some(u => u.maxScore > 0);

        if (currentMax > 0 || unitsHaveScore) {
            console.log(`📝 [C30] 满分已配置 (${currentMax || units[0]?.maxScore})，跳过`);
            return true;
        }

        const inputs = this.getScoreInputs();
        if (inputs.length === 0 || inputs[0].maxScore <= 0) {
            console.log('📝 [C30] 页面未检测到满分值');
            return false;
        }

        const detected = inputs[0].maxScore;
        console.log(`📝 [C30] 检测到满分: ${detected}，写入配置...`);

        const activeKey = pm.data.active;
        const preset = pm.data.list[activeKey];
        if (!preset) return false;

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
        return true;
    },

    onGradingComplete() {
        console.log('✅ [C30] onGradingComplete');
    },

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

if (C30Adapter.shouldInitialize()) {
    window.__C30_ADAPTER__ = C30Adapter;
    window.__AI_MARKER_ADAPTER__ = C30Adapter;
    console.log('✅ [C30] 适配器已注册');
}
