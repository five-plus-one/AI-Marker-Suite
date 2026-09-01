// ========== C30教育云适配器 ==========
// zy.iclass30.com — Vue + Element UI + Canvas 渲染答题卡
// 答题卡通过 <canvas id="canvasImg"> 渲染（Alibaba Cloud OSS 图片）
// 评分通过 el-input 输入框（placeholder 含 "满分X分"）+ .tab-score-btn 快捷按钮
// 无显式提交按钮，平台打分后自动提交并推进到下一人
// 图片来源：拦截 getCorrectStuList API 获取学生答题卡 URL

const C30Adapter = {
    name: 'C30教育云',
    id: 'c30',
    urlPatterns: ['*://zy.iclass30.com/*'],
    iconUrl: '',

    // ===== 拦截器状态 =====
    _apiData: null,            // API 返回的当前学生数据
    _currentImageUrl: null,    // 当前学生图片 URL
    _currentStuId: null,       // 当前学生 ID
    _apiDataResolve: null,     // 等待 API 数据的 Promise resolve
    _apiDataPromise: null,     // 等待 API 数据的 Promise
    _lastApiTimestamp: 0,      // 最新 API 响应时间戳
    _interceptedUrls: [],      // 所有拦截到的 URL（调试用）

    // ===== 初始化 API 拦截器 =====
    _initInterceptor() {
        if (this._interceptorInitialized) return;
        this._interceptorInitialized = true;

        // 重置 API 数据等待器
        this._resetApiDataPromise();

        const self = this;

        // 拦截 window.fetch
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            const url = (typeof args[0] === 'string') ? args[0] : args[0]?.url || '';
            // 记录所有 fetch 请求（仅前 200 字符）
            if (url.includes('iclass30') || url.includes('scanpaper') || url.includes('homework')) {
                console.log(`🌐 [C30-Fetch] ${url.substring(0, 200)}`);
            }

            const response = await originalFetch.apply(this, args);
            try {
                if (url.includes('getCorrectStuList')) {
                    console.log(`🎯 [C30-Fetch] 命中 getCorrectStuList! status=${response.status}`);
                    const cloned = response.clone();
                    cloned.json().then(data => {
                        console.log(`📦 [C30-Fetch] 响应数据: code=${data?.code}, data长度=${data?.data?.length || 'N/A'}`);
                        self._handleStudentListResponse(data);
                    }).catch(e => {
                        console.warn('⚠️ [C30-Fetch] API 响应解析失败:', e);
                    });
                }
            } catch (e) {
                console.warn('⚠️ [C30-Fetch] 拦截处理异常:', e);
            }
            return response;
        };

        // 同时拦截 XMLHttpRequest（平台可能用 XHR 而非 fetch）
        const originalXHROpen = XMLHttpRequest.prototype.open;
        const originalXHRSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this._c30Url = url;
            return originalXHROpen.call(this, method, url, ...rest);
        };

        XMLHttpRequest.prototype.send = function(...args) {
            const xhr = this;
            const url = xhr._c30Url || '';

            if (url.includes('iclass30') || url.includes('scanpaper') || url.includes('homework')) {
                console.log(`🌐 [C30-XHR] ${url.substring(0, 200)}`);
            }

            if (url.includes('getCorrectStuList')) {
                console.log(`🎯 [C30-XHR] 命中 getCorrectStuList!`);
                xhr.addEventListener('load', function() {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        console.log(`📦 [C30-XHR] 响应数据: code=${data?.code}, data长度=${data?.data?.length || 'N/A'}`);
                        self._handleStudentListResponse(data);
                    } catch (e) {
                        console.warn('⚠️ [C30-XHR] 响应解析失败:', e);
                    }
                });
            }

            return originalXHRSend.apply(this, args);
        };

        console.log('🔧 [C30] API 拦截器已安装（fetch + XHR）');
    },

    // 处理学生列表 API 响应
    _handleStudentListResponse(data) {
        if (!data) {
            console.warn('⚠️ [C30] API 响应为空');
            return;
        }
        if (data.code !== 1) {
            console.warn(`⚠️ [C30] API 响应 code=${data.code}，期望 1`);
            return;
        }
        if (!Array.isArray(data.data)) {
            console.warn(`⚠️ [C30] API data 不是数组:`, typeof data.data);
            return;
        }

        this._lastApiTimestamp = Date.now();
        this._studentList = data.data;
        console.log(`📋 [C30] 拦截到学生列表，共 ${data.data.length} 名学生`);

        // 调试：打印每个学生的简要信息
        data.data.forEach((stu, i) => {
            const resList = stu.stuNewResList || stu.stuResList || [];
            console.log(`  👤 [${i}] ${stu.stuName} (ID:${stu.stuId?.slice(-6)}) correctState=${stu.correctState} 图片:${resList.length}张`);
        });

        // 提取所有图片 URL
        const imageUrls = [];
        data.data.forEach(stu => {
            const resList = stu.stuNewResList || stu.stuResList || [];
            resList.forEach(res => {
                if (res.source) imageUrls.push(res.source);
            });
        });
        this._apiImageUrls = imageUrls;
        console.log(`🖼️ [C30] 共提取 ${imageUrls.length} 张图片 URL`);
        if (imageUrls.length > 0) {
            console.log(`  📎 首张: ${imageUrls[0].substring(0, 120)}...`);
        }

        // 查找当前正在批改的学生（correctState === 0 表示待批改）
        const currentStu = data.data.find(s => s.correctState === 0) || data.data[0];
        if (currentStu) {
            this._apiData = currentStu;
            this._currentStuId = currentStu.stuId;
            const resList = currentStu.stuNewResList || currentStu.stuResList || [];
            if (resList.length > 0) {
                this._currentImageUrl = resList[0].source;
            }
            console.log(`👤 [C30] 当前学生: ${currentStu.stuName}，图片: ${this._currentImageUrl ? '有' : '无'}`);
        } else {
            console.warn('⚠️ [C30] 学生列表为空');
        }

        // 通知等待者
        if (this._apiDataResolve) {
            console.log('🔔 [C30] 通知 API 数据等待者');
            this._apiDataResolve();
            this._apiDataResolve = null;
        }
    },

    // 重置 API 数据等待器
    _resetApiDataPromise() {
        this._apiDataPromise = new Promise(resolve => {
            this._apiDataResolve = resolve;
        });
    },

    // ===== URL 解析工具 =====
    _getUrlParams() {
        try {
            const hash = window.location.hash || '';
            const queryStr = hash.split('?')[1] || '';
            const params = new URLSearchParams(queryStr);
            const dataStr = params.get('data');
            if (dataStr) {
                return JSON.parse(decodeURIComponent(dataStr));
            }
        } catch (e) {
            console.warn('⚠️ [C30] URL 参数解析失败:', e);
        }
        return {};
    },

    shouldInitialize() {
        const result = window.location.hostname.includes('zy.iclass30.com');
        console.log(`🔍 [C30] shouldInitialize: ${result} (hostname: ${window.location.hostname})`);
        return result;
    },

    // 快速页面检查（不等待 DOM）
    isMarkingPage() {
        const hash = window.location.hash;
        const result = hash.includes('/webCorrect');
        console.log(`🔍 [C30] isMarkingPage: ${result} (hash: ${hash})`);
        return result;
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('🔎 [C30] 当前不在阅卷页面 (hash:', window.location.hash, ')');
            return false;
        }

        console.log('🔎 [C30] 开始检测批改页面...');
        try {
            // 等待关键元素出现
            const result = await Promise.race([
                waitForElement(C30_SELECTORS.PAGE_DETECT_CANVAS, 8000).then(() => 'canvas'),
                waitForElement(C30_SELECTORS.PAGE_DETECT_SCORE, 8000).then(() => 'score-input'),
                waitForElement(C30_SELECTORS.PAGE_DETECT_MAIN, 8000).then(() => 'main-container'),
            ]).catch(() => null);

            if (result) {
                console.log(`✅ [C30] 检测到批改页面元素: ${result}`);
                this._logPageState();
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 2000));
            const hasCanvas = document.querySelector(C30_SELECTORS.ANSWER_CANVAS);
            const hasScore = document.querySelector(C30_SELECTORS.SCORE_INPUT);
            const hasMain = document.querySelector(C30_SELECTORS.MAIN_CONTAINER);
            const detected = !!(hasCanvas || (hasScore && hasMain));
            console.log(`🔎 [C30] 兜底检测 — Canvas: ${!!hasCanvas}, 输入框: ${!!hasScore}, 主区域: ${!!hasMain}, 最终: ${detected}`);
            if (detected) this._logPageState();
            return detected;
        } catch (error) {
            console.error('❌ [C30] detectMarkingPage 异常:', error);
            return false;
        }
    },

    // 打印当前页面状态快照（调试用）
    _logPageState() {
        console.log('📊 [C30] ===== 页面状态快照 =====');

        // Canvas 状态
        const canvas = document.querySelector(C30_SELECTORS.ANSWER_CANVAS);
        if (canvas) {
            console.log(`  🖼️ Canvas #canvasImg: ${canvas.width}x${canvas.height}, display: ${canvas.clientWidth}x${canvas.clientHeight}`);
            console.log(`     crossOrigin: ${canvas.crossOrigin || '(未设置)'}`);
            console.log(`     style.zoom: ${canvas.style.zoom || '(未设置)'}`);
            // 尝试导出
            try {
                const dataUrl = canvas.toDataURL('image/png');
                console.log(`     toDataURL: 成功 (${Math.round(dataUrl.length * 0.75 / 1024)} KB)`);
            } catch (e) {
                console.log(`     toDataURL: 失败 — ${e.message}`);
            }
        } else {
            console.log(`  🖼️ Canvas #canvasImg: 未找到`);
        }

        // 所有 canvas 元素
        const allCanvas = document.querySelectorAll('canvas');
        console.log(`  📋 页面 Canvas 总数: ${allCanvas.length}`);
        allCanvas.forEach((c, i) => {
            console.log(`     [${i}] id="${c.id}" class="${c.className}" ${c.width}x${c.height}`);
        });

        // 分数输入框
        const allInputs = document.querySelectorAll('input.el-input__inner');
        console.log(`  📝 el-input 输入框总数: ${allInputs.length}`);
        allInputs.forEach((inp, i) => {
            const rect = inp.getBoundingClientRect();
            console.log(`     [${i}] placeholder="${inp.placeholder}" value="${inp.value}" visible=${rect.width > 0} ${Math.round(rect.width)}x${Math.round(rect.height)} @(${Math.round(rect.left)},${Math.round(rect.top)})`);
        });

        // 分数按钮
        const scoreBtns = document.querySelectorAll(C30_SELECTORS.SCORE_BTN);
        console.log(`  🔢 快捷分数按钮 (.tab-score-btn): ${scoreBtns.length} 个`);
        scoreBtns.forEach((btn, i) => {
            console.log(`     [${i}] text="${btn.textContent.trim()}" class="${btn.className}"`);
        });

        // 题目选择器
        const quesInput = document.querySelector(C30_SELECTORS.QUESTION_SELECT);
        if (quesInput) {
            console.log(`  📑 题目选择器: placeholder="${quesInput.placeholder}" value="${quesInput.value}"`);
        } else {
            console.log(`  📑 题目选择器: 未找到`);
        }

        // 下一人按钮
        const nextBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.includes('下一人'));
        if (nextBtns.length > 0) {
            nextBtns.forEach((btn, i) => {
                console.log(`  ➡️ "下一人"按钮[${i}]: disabled=${btn.disabled} class="${btn.className}"`);
            });
        } else {
            console.log(`  ➡️ "下一人"按钮: 未找到`);
        }

        // Vue 检测
        const appEl = document.querySelector('#app');
        if (appEl) {
            const vue = appEl.__vue__;
            console.log(`  🟢 Vue 实例: ${vue ? '存在 (Vue ' + (vue.$options?.version || '?') + ')' : '未检测到'}`);
        }

        console.log('📊 [C30] ===== 快照结束 =====');
    },

    getTaskIdentifier() {
        const urlData = this._getUrlParams();
        const workId = urlData.workId || '';

        // 获取当前题号
        const quesInput = document.querySelector(C30_SELECTORS.QUESTION_SELECT);
        let quesNum = '';
        if (quesInput) {
            // 从 el-input 的显示值获取题号
            const wrapper = quesInput.closest('.el-select');
            if (wrapper) {
                const selectedText = wrapper.querySelector('.el-input__inner');
                if (selectedText && selectedText.value && selectedText.value !== '请选择题目') {
                    quesNum = selectedText.value;
                }
            }
        }

        const parts = [workId, quesNum].filter(Boolean);
        const id = parts.join('_') || window.location.href;
        console.log(`🆔 [C30] getTaskIdentifier: ${id.substring(0, 80)}`);
        return id;
    },

    async gatherAnswerImages() {
        console.log('🖼️ [C30] 开始获取答题卡图片...');
        console.log(`  当前状态: _currentImageUrl=${this._currentImageUrl ? '有' : '无'}, _interceptorInitialized=${this._interceptorInitialized}`);

        // 等待 API 数据（最多 8 秒）
        if (!this._currentImageUrl) {
            console.log('⏳ [C30] 等待 API 数据（最多 8 秒）...');
            await Promise.race([
                this._apiDataPromise,
                new Promise(resolve => setTimeout(resolve, 8000))
            ]);
            console.log(`  等待结束: _currentImageUrl=${this._currentImageUrl ? '有' : '无'}`);
        }

        // 优先使用 API 拦截到的图片 URL（避免 CORS 问题）
        if (this._currentImageUrl) {
            console.log(`🖼️ [C30] 使用 API 拦截到的图片 URL:`);
            console.log(`  📎 ${this._currentImageUrl.substring(0, 150)}...`);
            return [this._currentImageUrl];
        }

        // 备用方案：从 Canvas 导出（可能受 CORS 限制）
        console.log('🖼️ [C30] API 无数据，尝试 Canvas 导出...');
        const canvas = document.querySelector(C30_SELECTORS.ANSWER_CANVAS);
        if (canvas) {
            console.log(`  Canvas: ${canvas.width}x${canvas.height}, crossOrigin="${canvas.crossOrigin || ''}"`);
            try {
                const dataUrl = canvas.toDataURL('image/png');
                if (dataUrl && dataUrl.length > 1000) {
                    console.log(`🖼️ [C30] 从 Canvas 导出图片成功 (${Math.round(dataUrl.length * 0.75 / 1024)} KB)`);
                    return [dataUrl];
                } else {
                    console.warn(`⚠️ [C30] Canvas 导出内容过小 (${dataUrl?.length || 0} bytes)`);
                }
            } catch (e) {
                console.warn('⚠️ [C30] Canvas 导出失败（CORS 限制）:', e.message);
            }
        } else {
            console.warn('⚠️ [C30] 未找到 Canvas 元素');
        }

        // 最终诊断
        console.error('❌ [C30] 所有图片获取方式均失败');
        console.log(`  拦截器状态: initialized=${this._interceptorInitialized}`);
        console.log(`  已拦截 URL 数: ${this._interceptedUrls?.length || 0}`);
        console.log(`  学生列表: ${this._studentList?.length || 0} 条`);
        return [];
    },

    async fetchImageAsBase64(url) {
        console.log(`📥 [C30] fetchImageAsBase64: ${url.substring(0, 100)}...`);
        // 如果已经是 data URL，直接提取 base64
        if (url.startsWith('data:')) {
            console.log(`  类型: data URL，直接提取 base64`);
            return url.split(',')[1];
        }
        // 使用通用的下载方法（GM_xmlhttpRequest，绕过 CORS）
        console.log(`  类型: HTTP URL，使用 GM_xmlhttpRequest 下载`);
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];

        // 查找分数输入框（placeholder 含 "满分"）
        const scoreInput = document.querySelector(C30_SELECTORS.SCORE_INPUT);
        if (scoreInput) {
            // 从 placeholder 解析满分值
            const placeholder = scoreInput.placeholder || '';
            const match = placeholder.match(/满分(\d+)/);
            const maxScore = match ? parseInt(match[1]) : 0;

            inputs.push({
                element: scoreInput,
                label: `满分${maxScore}分`,
                index: 0,
                maxScore: maxScore
            });
            console.log(`📝 [C30] getScoreInputs: 找到输入框, placeholder="${placeholder}", maxScore=${maxScore}`);
        } else {
            console.warn('⚠️ [C30] getScoreInputs: 未找到分数输入框 (selector: ' + C30_SELECTORS.SCORE_INPUT + ')');
            // 诊断：列出所有 input
            const allInputs = document.querySelectorAll('input');
            console.log(`  页面 input 总数: ${allInputs.length}`);
            allInputs.forEach((inp, i) => {
                console.log(`  [${i}] type=${inp.type} class="${inp.className}" placeholder="${inp.placeholder}"`);
            });
        }

        return inputs;
    },

    fillScores(scores) {
        if (!scores || scores.length === 0) {
            console.warn('⚠️ [C30] fillScores: 空数组');
            return false;
        }

        const score = scores[0];
        if (score === null || score === undefined) {
            console.warn('⚠️ [C30] fillScores: score 为 null/undefined');
            return false;
        }

        // 记录待填入分数（等待用户确认后通过 submitGrade 应用）
        this._pendingScore = score;
        console.log(`📝 [C30] fillScores: 记录待填入分数 ${score}（等待用户确认后填入）`);
        return true;
    },

    // 填入分数到输入框（在用户确认后调用）
    _setScoreValue(score) {
        console.log(`📝 [C30] _setScoreValue: 开始填入分数 ${score}`);

        // 尝试通过 .tab-score-btn 快捷按钮
        const scoreBtns = document.querySelectorAll(C30_SELECTORS.SCORE_BTN);
        console.log(`  快捷分数按钮: ${scoreBtns.length} 个`);
        if (scoreBtns.length > 0) {
            const btnTexts = Array.from(scoreBtns).map(b => b.textContent.trim());
            console.log(`  按钮值: [${btnTexts.join(', ')}]`);
            for (const btn of scoreBtns) {
                const text = btn.textContent.trim();
                if (text === String(score)) {
                    btn.click();
                    console.log(`✅ [C30] 已点击快捷分数按钮: ${score}`);
                    return true;
                }
            }
            console.log(`  未找到匹配按钮 (目标: ${score})，回退到输入框`);
        }

        // 使用输入框填入分数
        const scoreInput = document.querySelector(C30_SELECTORS.SCORE_INPUT);
        if (!scoreInput) {
            console.warn('⚠️ [C30] _setScoreValue: 未找到分数输入框');
            return false;
        }

        console.log(`  输入框: placeholder="${scoreInput.value}" 当前值="${scoreInput.value}"`);

        // 尝试通过 Vue 组件设置值（确保响应式更新）
        let vueInstance = scoreInput.__vue__;
        let vueSource = 'input.__vue__';
        if (!vueInstance) {
            // Element UI el-input 的 Vue 实例可能在父元素上
            const elInput = scoreInput.closest('.el-input');
            if (elInput) {
                vueInstance = elInput.__vue__;
                vueSource = '.el-input.__vue__';
            }
        }

        if (vueInstance) {
            console.log(`📝 [C30] 找到 Vue 实例 (via ${vueSource})`);
            console.log(`  Vue options: ${JSON.stringify(Object.keys(vueInstance.$options || {})).substring(0, 200)}`);
            // Element UI el-input 使用 v-model，需要设置组件的 value
            if (vueInstance.value !== undefined) {
                console.log(`  Vue.value: "${vueInstance.value}" -> "${score}"`);
                vueInstance.value = String(score);
            }
            // 尝试通过 $emit 触发 v-model 更新
            if (vueInstance.$emit) {
                vueInstance.$emit('input', String(score));
                vueInstance.$emit('change', String(score));
                console.log(`  已 emit: input, change`);
            }
        } else {
            console.log(`  未找到 Vue 实例，使用原生方式`);
        }

        // 使用原生方式设置值（兼容非 Vue 场景）
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        ).set;
        setter.call(scoreInput, score);

        // 触发完整的事件链，确保 Vue 响应式更新
        scoreInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(score) }));
        scoreInput.dispatchEvent(new Event('change', { bubbles: true }));
        scoreInput.dispatchEvent(new Event('blur', { bubbles: true }));

        console.log(`✅ [C30] 分数已填入输入框，当前 value="${scoreInput.value}"`);
        return true;
    },

    submitGrade() {
        console.log('📤 [C30] submitGrade 开始...');
        console.log(`  _pendingScore: ${this._pendingScore}`);

        // 填入分数（触发平台自动提交）
        this._setScoreValue(this._pendingScore);
        this._pendingScore = null;

        // 处理可能的确认弹窗
        this._handleConfirmDialog();

        // 诊断：检查提交后的 DOM 变化
        setTimeout(() => {
            console.log('📤 [C30] submitGrade 后 1 秒状态:');
            const scoreInput = document.querySelector(C30_SELECTORS.SCORE_INPUT);
            if (scoreInput) {
                console.log(`  输入框 value="${scoreInput.value}"`);
            }
            const nextBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.includes('下一人'));
            nextBtns.forEach((btn, i) => {
                console.log(`  "下一人"[${i}]: disabled=${btn.disabled}`);
            });
            // 检查弹窗
            const dialogs = document.querySelectorAll('.el-message-box, .el-dialog');
            console.log(`  弹窗数量: ${dialogs.length}`);
            dialogs.forEach((d, i) => {
                console.log(`  弹窗[${i}]: visible=${d.style.display !== 'none'} text="${d.textContent?.substring(0, 100)}"`);
            });
        }, 1000);

        return true;
    },

    // 处理二次确认弹窗
    _handleConfirmDialog() {
        console.log('⏳ [C30] 开始监听确认弹窗...');

        let checkCount = 0;
        const checkInterval = setInterval(() => {
            checkCount++;

            // 查找 Element UI 确认弹窗
            const confirmBtns = document.querySelectorAll(
                '.el-message-box__btns button, .el-dialog__footer button'
            );
            if (confirmBtns.length > 0 && checkCount <= 3) {
                console.log(`  [${checkCount}] 发现 ${confirmBtns.length} 个弹窗按钮`);
                confirmBtns.forEach((btn, i) => {
                    console.log(`    [${i}] "${btn.textContent.trim()}" class="${btn.className}"`);
                });
            }

            for (const btn of confirmBtns) {
                const text = btn.textContent.trim();
                if (text === '确认' || text === '确定' || text === 'OK' || text === '保存') {
                    console.log('✅ [C30] 找到确认弹窗，自动点击: "' + text + '"');
                    btn.click();
                    clearInterval(checkInterval);
                    return;
                }
            }

            // 超时（最多等 3 秒）
            if (checkCount >= 15) {
                clearInterval(checkInterval);
                console.log('ℹ️ [C30] 未检测到确认弹窗（3 秒超时）');
            }
        }, 200);
    },

    async waitForNextPaper(oldImageUrl) {
        console.log('⏳ [C30] waitForNextPaper 开始...');
        console.log(`  旧图片: ${this._currentImageUrl?.substring(0, 80) || '(无)'}`);
        console.log(`  旧学生ID: ${this._currentStuId || '(无)'}`);
        console.log(`  旧API时间戳: ${this._lastApiTimestamp}`);

        const startTime = Date.now();
        const maxWait = 30000;
        const startApiTimestamp = this._lastApiTimestamp;
        const startStuId = this._currentStuId;
        const startImage = this._currentImageUrl;

        return new Promise((resolve) => {
            const timer = setInterval(() => {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

                // 检测 1：新 API 响应
                if (this._lastApiTimestamp > startApiTimestamp) {
                    clearInterval(timer);
                    console.log(`✅ [C30] 新试卷已加载（API 新数据）— ${elapsed}s`);
                    resolve(true);
                    return;
                }

                // 检测 2：学生 ID 变化
                if (startStuId && this._currentStuId && this._currentStuId !== startStuId) {
                    clearInterval(timer);
                    console.log(`✅ [C30] 新试卷已加载（学生 ID 变化: ${startStuId.slice(-6)} -> ${this._currentStuId.slice(-6)}）— ${elapsed}s`);
                    resolve(true);
                    return;
                }

                // 检测 3：图片 URL 变化
                if (startImage && this._currentImageUrl && this._currentImageUrl !== startImage) {
                    clearInterval(timer);
                    console.log(`✅ [C30] 新试卷已加载（图片 URL 变化）— ${elapsed}s`);
                    resolve(true);
                    return;
                }

                // 检测 4：分数输入框被清空
                const scoreInput = document.querySelector(C30_SELECTORS.SCORE_INPUT);
                if (scoreInput && scoreInput.value === '' && Date.now() - startTime > 1500) {
                    clearInterval(timer);
                    console.log(`✅ [C30] 新试卷已加载（输入框已清空）— ${elapsed}s`);
                    resolve(true);
                    return;
                }

                // 每 5 秒输出一次状态
                if (elapsed % 5 < 0.6) {
                    console.log(`⏳ [C30] 仍在等待... ${elapsed}s, input="${scoreInput?.value || '?'}", apiTimestamp=${this._lastApiTimestamp}`);
                }

                // 超时检测
                if (Date.now() - startTime > maxWait) {
                    clearInterval(timer);
                    console.warn(`⚠️ [C30] 等待下一份试卷超时 (${maxWait / 1000}s)`);
                    console.log(`  最终状态: apiTimestamp=${this._lastApiTimestamp}, stuId=${this._currentStuId}, image=${this._currentImageUrl ? '有' : '无'}`);
                    resolve(false);
                }
            }, 500);
        });
    },

    isRegradeMode() {
        // 检查 URL 参数中 isReview=1
        const urlData = this._getUrlParams();
        if (urlData.isReview === 1 || urlData.isReview === '1') {
            console.log('🔄 [C30] 回评模式: URL isReview=1');
            return true;
        }

        // 检查页面文本中是否包含"回评"
        const bodyText = document.body.textContent;
        if (bodyText.includes('回评') || bodyText.includes('复核')) {
            console.log('🔄 [C30] 回评模式: 页面包含"回评/复核"文本');
            return true;
        }

        return false;
    },

    onPageLoad() {
        console.log('🚀 [C30] onPageLoad 开始执行...');
        console.log(`  URL: ${window.location.href.substring(0, 150)}`);
        console.log(`  hash: ${window.location.hash}`);

        // 解析 URL 参数
        const urlData = this._getUrlParams();
        console.log(`  URL data 参数: workId=${urlData.workId || '(无)'}, workTitle=${urlData.workTitle || '(无)'}, isReview=${urlData.isReview}`);

        // 初始化 API 拦截器
        this._initInterceptor();

        // 延迟打印页面状态（等待 DOM 渲染）
        setTimeout(() => {
            this._logPageState();
        }, 2000);
    },

    onGradingComplete() {
        console.log('✅ [C30] onGradingComplete — 本轮批改完成');
        console.log(`  当前学生: ${this._currentStuId || '(未知)'}`);
        console.log(`  当前图片: ${this._currentImageUrl ? '有' : '无'}`);
    },
};

// 注册适配器
if (C30Adapter.shouldInitialize()) {
    console.log('✅ [C30] 适配器已注册到 window.__AI_MARKER_ADAPTER__');
    window.__AI_MARKER_ADAPTER__ = C30Adapter;
} else {
    console.log('ℹ️ [C30] 当前域名不匹配，适配器未注册');
}
