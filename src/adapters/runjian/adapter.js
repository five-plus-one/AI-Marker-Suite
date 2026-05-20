// ========== 润建学情大数据精准分析平台适配器 ==========
// aisusheng.runjian.com — Vue 2 + Element UI + fabric.js Canvas
// 图片通过 CSS background-image 渲染（带腾讯云 COS 裁切参数）
// 评分通过点击 score-item-button 按钮（0-N）
// API: POST /marking-main/grad/v2/get_item

// ========== XHR 拦截 ==========
// 拦截 get_item API 获取当前题目信息和图片 URL
let _runjianCurrentImageUrl = null;
let _runjianCurrentItemId = null;
let _runjianCurrentQuestion = null;
let _runjianMaxScore = null;
let _runjianExamId = null;

if (window.location.hostname.includes('aisusheng.runjian.com') ||
    window.location.hostname.includes('rjedu.runjian.com')) {
    const _runjianOrigOpen = XMLHttpRequest.prototype.open;
    const _runjianOrigSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._runjianUrl = url;
        this._runjianMethod = method;
        return _runjianOrigOpen.call(this, method, url, ...args);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', function() {
            try {
                const url = this._runjianUrl || '';
                if (url.includes('get_item')) {
                    const response = JSON.parse(this.responseText);
                    if (response.code === 200 && response.result) {
                        const todo = response.result.todo;
                        const stand = response.result.stand;

                        if (todo && todo.length > 0) {
                            const current = todo[0];
                            _runjianCurrentImageUrl = current.ossUrl || null;
                            _runjianCurrentItemId = current.id || current.resultDetailId || null;
                            _runjianCurrentQuestion = current.question || null;
                            _runjianExamId = current.examId || null;
                            console.log(`🖼️ [润建] API 拦截 — 当前题目: ${_runjianCurrentQuestion}, 图片: ${_runjianCurrentImageUrl ? _runjianCurrentImageUrl.substring(0, 80) + '...' : '(无)'}`);
                        }

                        if (stand && stand.length > 0) {
                            _runjianMaxScore = stand[0].point || null;
                            console.log(`📋 [润建] API 拦截 — 满分: ${_runjianMaxScore}`);
                        }
                    }
                }
            } catch (e) {
                // 忽略解析错误
            }
        });
        return _runjianOrigSend.call(this, ...args);
    };
}

// ========== 适配器定义 ==========
const RunjianAdapter = {
    name: '润建学情',
    id: 'runjian',
    urlPatterns: ['*://aisusheng.runjian.com/*'],
    iconUrl: 'https://aisusheng.runjian.com/favicon.ico',

    shouldInitialize() {
        return window.location.hostname.includes('aisusheng.runjian.com');
    },

    isMarkingPage() {
        const pathname = window.location.pathname;
        return pathname.includes('/read-paper/');
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('🔎 [润建] 当前不在阅卷页面 (pathname:', window.location.pathname, ')');
            return false;
        }

        console.log('🔎 [润建] 开始检测批改页面...');
        try {
            // 等待关键元素出现
            const result = await Promise.race([
                waitForElement(RUNJIAN_SELECTORS.PAGE_DETECT_SCORE, 8000).then(() => 'score-button'),
                waitForElement(RUNJIAN_SELECTORS.PAGE_DETECT_PANEL, 8000).then(() => 'score-panel'),
                waitForElement(RUNJIAN_SELECTORS.PAGE_DETECT_IMAGE, 8000).then(() => 'image-box'),
            ]).catch(() => null);

            if (result) {
                console.log(`✅ [润建] 检测到批改页面元素: ${result}`);
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 2000));
            const hasScore = document.querySelector(RUNJIAN_SELECTORS.SCORE_BUTTON);
            const hasPanel = document.querySelector(RUNJIAN_SELECTORS.SCORE_PANEL);
            const hasImage = document.querySelector(RUNJIAN_SELECTORS.IMAGE_BOX);
            const detected = !!(hasScore || (hasPanel && hasImage));
            console.log(`🔎 [润建] 兜底检测 — 评分按钮: ${!!hasScore}, 给分面板: ${!!hasPanel}, 图片: ${!!hasImage}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [润建] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // 优先使用 API 拦截的题目 ID
        if (_runjianCurrentItemId) {
            return `runjian_${_runjianCurrentItemId}`;
        }
        // 回退到 URL 路径（包含 paperId + 题块 + index）
        return window.location.pathname;
    },

    async gatherAnswerImages() {
        console.log('🖼️ [润建] 开始获取答题卡图片...');

        // 方法1: 使用 API 拦截的图片 URL
        if (_runjianCurrentImageUrl) {
            console.log(`🖼️ [润建] 使用 API 拦截的图片: ${_runjianCurrentImageUrl.substring(0, 80)}...`);
            return [_runjianCurrentImageUrl];
        }

        // 方法2: 等待 API 拦截获取图片（最多 5 秒）
        const startTime = Date.now();
        while (Date.now() - startTime < 5000) {
            if (_runjianCurrentImageUrl) {
                console.log(`🖼️ [润建] 等待后从 API 获取到图片`);
                return [_runjianCurrentImageUrl];
            }
            await new Promise(r => setTimeout(r, 300));
        }

        // 方法3: 从 .img-box 的 background-image 提取
        const imgUrl = this._getImageFromBackground();
        if (imgUrl) {
            console.log(`🖼️ [润建] 从 background-image 获取图片: ${imgUrl.substring(0, 80)}...`);
            return [imgUrl];
        }

        console.warn('⚠️ [润建] 未找到答题卡图片');
        return [];
    },

    // 从 .img-box 的 CSS background-image 提取 URL
    _getImageFromBackground() {
        const imgBox = document.querySelector(RUNJIAN_SELECTORS.IMAGE_BOX);
        if (!imgBox) return null;

        const bgImage = window.getComputedStyle(imgBox).backgroundImage;
        if (!bgImage || bgImage === 'none') return null;

        // 解析 url("...") 或 url(...)
        const match = bgImage.match(/url\(["']?(.+?)["']?\)/);
        return match ? match[1] : null;
    },

    async fetchImageAsBase64(url) {
        // 如果已经是 data URL，直接提取 base64
        if (url.startsWith('data:')) {
            return url.split(',')[1];
        }

        // 使用通用的下载方法（支持腾讯云 COS）
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];

        // 查找给分面板中的小题信息
        const questionLabel = document.querySelector(RUNJIAN_SELECTORS.QUESTION_LABEL);
        const scoreInput = document.querySelector(RUNJIAN_SELECTORS.SCORE_INPUT);

        // 解析满分值
        let maxScore = 0;
        if (_runjianMaxScore) {
            maxScore = _runjianMaxScore;
        } else if (scoreInput) {
            const placeholder = scoreInput.placeholder || '';
            const match = placeholder.match(/满分(\d+)分/);
            if (match) maxScore = parseInt(match[1]);
        }

        // 解析小题号
        const label = questionLabel ? questionLabel.textContent.trim() : '总分';

        // 查找评分按钮
        const scoreButtons = document.querySelectorAll(RUNJIAN_SELECTORS.SCORE_BUTTON);
        if (scoreButtons.length > 0) {
            // 从按钮文本推断可选分数
            const scores = [];
            scoreButtons.forEach(btn => {
                const text = btn.querySelector('span')?.textContent?.trim();
                const num = parseInt(text);
                if (!isNaN(num)) scores.push(num);
            });

            // 使用第一个按钮的父容器作为 element
            const container = scoreButtons[0]?.closest('.score-list') || scoreButtons[0]?.closest('form');

            inputs.push({
                element: container || scoreButtons[0],
                label: label,
                index: 0,
                maxScore: maxScore || (scores.length > 0 ? Math.max(...scores) : 0),
                type: 'click',
                scores: scores
            });
        } else if (scoreInput) {
            // 没有按钮时，使用输入框
            inputs.push({
                element: scoreInput,
                label: label,
                index: 0,
                maxScore: maxScore
            });
        }

        return inputs;
    },

    fillScores(scores) {
        if (!scores || scores.length === 0) return false;

        const score = scores[0];
        if (score === null || score === undefined) return false;

        console.log(`📝 [润建] 填入分数: ${score}`);

        // 方法1: 点击评分按钮
        const scoreButtons = document.querySelectorAll(RUNJIAN_SELECTORS.SCORE_BUTTON);
        if (scoreButtons.length > 0) {
            for (const btn of scoreButtons) {
                const text = btn.querySelector('span')?.textContent?.trim();
                if (text === String(score)) {
                    btn.click();
                    console.log(`✅ [润建] 已点击分数按钮: ${score}`);
                    return true;
                }
            }
            console.warn(`⚠️ [润建] 未找到分数 ${score} 对应的按钮`);
        }

        // 方法2: 使用满分/零分快捷按钮
        if (score === 0) {
            const zeroBtn = document.querySelector(RUNJIAN_SELECTORS.ZERO_SCORE_BUTTON);
            if (zeroBtn) {
                zeroBtn.click();
                console.log('✅ [润建] 已点击"零分"按钮');
                return true;
            }
        }

        // 检查是否为满分
        const maxScore = this._getCurrentMaxScore();
        if (maxScore > 0 && score === maxScore) {
            const fullBtn = document.querySelector(RUNJIAN_SELECTORS.FULL_SCORE_BUTTON);
            if (fullBtn) {
                fullBtn.click();
                console.log('✅ [润建] 已点击"满分"按钮');
                return true;
            }
        }

        console.warn('⚠️ [润建] 无法填入分数');
        return false;
    },

    // 获取当前满分值
    _getCurrentMaxScore() {
        if (_runjianMaxScore) return _runjianMaxScore;

        const scoreInput = document.querySelector(RUNJIAN_SELECTORS.SCORE_INPUT);
        if (scoreInput) {
            const match = (scoreInput.placeholder || '').match(/满分(\d+)分/);
            if (match) return parseInt(match[1]);
        }
        return 0;
    },

    submitGrade() {
        console.log('📤 [润建] 开始提交分数...');

        // 查找提交按钮
        const submitBtn = document.querySelector(RUNJIAN_SELECTORS.SUBMIT_BUTTON);
        if (submitBtn) {
            submitBtn.click();
            console.log('✅ [润建] 已点击提交按钮');
            return true;
        }

        // 备选：查找包含"提交"文字的按钮
        const allButtons = document.querySelectorAll('button.el-button--primary');
        for (const btn of allButtons) {
            const span = btn.querySelector('span');
            if (span && span.textContent.trim() === '提交') {
                btn.click();
                console.log('✅ [润建] 已点击提交按钮（文字匹配）');
                return true;
            }
        }

        console.warn('⚠️ [润建] 未找到提交按钮');
        return false;
    },

    async waitForNextPaper(oldImageUrl) {
        console.log('⏳ [润建] 等待下一份试卷...');

        // 记录当前图片 URL（优先使用 API 拦截的）
        const oldUrl = oldImageUrl || _runjianCurrentImageUrl;
        if (oldUrl) {
            console.log(`⏳ [润建] 当前图片: ${oldUrl.substring(0, 60)}...`);
        }

        const startTime = Date.now();
        const maxWait = 30000; // 最多等待 30 秒

        return new Promise((resolve) => {
            const timer = setInterval(() => {
                // 检测1: API 拦截的图片 URL 变化
                if (_runjianCurrentImageUrl && oldUrl && _runjianCurrentImageUrl !== oldUrl) {
                    clearInterval(timer);
                    console.log('✅ [润建] 新试卷已加载（API 图片变化）');
                    resolve(true);
                    return;
                }

                // 检测2: background-image 变化
                const currentBgUrl = this._getImageFromBackground();
                if (currentBgUrl && oldUrl && currentBgUrl !== oldUrl) {
                    clearInterval(timer);
                    console.log('✅ [润建] 新试卷已加载（背景图变化）');
                    resolve(true);
                    return;
                }

                // 检测3: 小题号变化（说明切换到了新题目）
                const questionLabel = document.querySelector(RUNJIAN_SELECTORS.QUESTION_LABEL);
                const currentQuestion = questionLabel?.textContent?.trim();

                // 超时检测
                if (Date.now() - startTime > maxWait) {
                    clearInterval(timer);
                    console.warn('⚠️ [润建] 等待下一份试卷超时');
                    resolve(false);
                }
            }, 300);
        });
    },

    isRegradeMode() {
        // 检查是否有回评相关元素
        // 润建平台的回评模式可能通过 URL 参数或页面状态标识
        const url = window.location.href;
        if (url.includes('regrade') || url.includes('review')) {
            return true;
        }

        // 检查工具栏中的"初评"文字（如果不是初评则为回评）
        const toolsBar = document.querySelector('.tools');
        if (toolsBar) {
            const text = toolsBar.textContent;
            if (text.includes('回评') || text.includes('复核')) {
                return true;
            }
        }

        return false;
    },

    onPageLoad() {
        console.log('🚀 [润建] 页面加载完成，执行初始化...');

        // 确保"自动提交"未勾选（避免点击分数按钮时自动提交）
        const autoSubmitCheckbox = document.querySelector(RUNJIAN_SELECTORS.AUTO_SUBMIT_CHECKBOX);
        if (autoSubmitCheckbox && autoSubmitCheckbox.checked) {
            // 通过点击其父 label 来取消勾选
            const label = autoSubmitCheckbox.closest('label.el-checkbox');
            if (label) {
                label.click();
                console.log('📝 [润建] 已取消"自动提交"勾选');
            }
        }
    },

    onGradingComplete() {
        console.log('✅ [润建] 本轮批改完成');
    },
};

// 注册适配器
if (RunjianAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = RunjianAdapter;
}
