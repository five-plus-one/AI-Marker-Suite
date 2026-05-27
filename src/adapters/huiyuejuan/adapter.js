// ========== 慧阅卷适配器 ==========
// web.17yuejuan.cn — AngularJS
// 阅卷界面以弹窗形式呈现，评分通过点击分数按钮（+0, +1, +2, ...）
// 特殊设计：MutationObserver 监听弹窗出现/消失，题号从 DOM 提取

// ========== 弹窗状态监测 ==========
let _huiyuejuanMarkingActive = false;
let _huiyuejuanObserver = null;

// 持续监测弹窗状态，确保核心层能正确感知
if (window.location.hostname.includes('17yuejuan.cn')) {
    function _huiCheckMarkingPanel() {
        const panel = document.querySelector(HUIYUEJUAN_SELECTORS.SCORE_PANEL);
        if (panel && !_huiyuejuanMarkingActive) {
            _huiyuejuanMarkingActive = true;
            console.log('🔔 [慧阅卷] 检测到阅卷弹窗出现');
        } else if (!panel && _huiyuejuanMarkingActive) {
            _huiyuejuanMarkingActive = false;
            console.log('🔔 [慧阅卷] 检测到阅卷弹窗关闭');
        }
    }

    // 使用 MutationObserver 监听 DOM 变化
    _huiyuejuanObserver = new MutationObserver(() => {
        _huiCheckMarkingPanel();
    });

    // 延迟启动 observer，等待 body 可用
    function _huiStartObserver() {
        if (document.body) {
            _huiyuejuanObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
            // 立即检查一次
            _huiCheckMarkingPanel();
        } else {
            setTimeout(_huiStartObserver, 200);
        }
    }
    _huiStartObserver();
}

// ========== 适配器定义 ==========
const HuiyuejuanAdapter = {
    name: '慧阅卷',
    id: 'huiyuejuan',
    urlPatterns: ['*://web.17yuejuan.cn/*'],
    iconUrl: 'https://web.17yuejuan.cn/favicon.ico',

    shouldInitialize() {
        return window.location.hostname.includes('17yuejuan.cn');
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器
    // 慧阅卷是弹窗模式，直接检查弹窗是否存在
    isMarkingPage() {
        return !!document.querySelector(HUIYUEJUAN_SELECTORS.SCORE_PANEL);
    },

    async detectMarkingPage() {
        console.log('🔎 [慧阅卷] 开始检测批改页面...');

        try {
            // 等待关键元素出现（弹窗可能延迟打开）
            const result = await Promise.race([
                waitForElement(HUIYUEJUAN_SELECTORS.PAGE_DETECT_PANEL, 10000).then(() => 'panel'),
                waitForElement(HUIYUEJUAN_SELECTORS.PAGE_DETECT_IMAGE, 10000).then(() => 'image'),
                waitForElement(HUIYUEJUAN_SELECTORS.PAGE_DETECT_BUTTONS, 10000).then(() => 'buttons'),
            ]).catch(() => null);

            if (result) {
                console.log(`✅ [慧阅卷] 检测到批改页面元素: ${result}`);
                _huiyuejuanMarkingActive = true;
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 2000));
            const hasPanel = document.querySelector(HUIYUEJUAN_SELECTORS.SCORE_PANEL);
            const hasImage = document.querySelector(HUIYUEJUAN_SELECTORS.ANSWER_IMAGE);
            const detected = !!(hasPanel || hasImage);
            console.log(`🔎 [慧阅卷] 兜底检测 — 给分面板: ${!!hasPanel}, 图片: ${!!hasImage}, 最终: ${detected}`);
            if (detected) _huiyuejuanMarkingActive = true;
            return detected;
        } catch (error) {
            console.error('❌ [慧阅卷] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // 从给分面板标题提取题号（如 "16、(6分)"）
        const panels = document.querySelectorAll(HUIYUEJUAN_SELECTORS.PANEL_TITLE);
        if (panels.length > 0) {
            const text = panels[0].textContent.trim();
            const match = text.match(/(\d+)/);
            if (match) return `hui_${match[1]}`;
        }

        // 回退：使用图片 src 中的唯一标识
        const img = document.querySelector(HUIYUEJUAN_SELECTORS.ANSWER_IMAGE);
        if (img && img.src) {
            const match = img.src.match(/answer_sheets\/(\d+)\/(\d+)/);
            if (match) return `hui_${match[1]}_${match[2]}`;
        }

        return `hui_unknown`;
    },

    async gatherAnswerImages() {
        console.log('🖼️ [慧阅卷] 开始获取答题卡图片...');

        // 直接从 img 标签获取 src
        const img = document.querySelector(HUIYUEJUAN_SELECTORS.ANSWER_IMAGE);
        if (img && img.src) {
            console.log(`🖼️ [慧阅卷] 找到图片: ${img.src.substring(0, 80)}...`);
            return [img.src];
        }

        // 等待图片加载（弹窗可能刚打开）
        const startTime = Date.now();
        while (Date.now() - startTime < 5000) {
            const imgEl = document.querySelector(HUIYUEJUAN_SELECTORS.ANSWER_IMAGE);
            if (imgEl && imgEl.src) {
                console.log(`🖼️ [慧阅卷] 等待后找到图片: ${imgEl.src.substring(0, 80)}...`);
                return [imgEl.src];
            }
            await new Promise(r => setTimeout(r, 300));
        }

        console.warn('⚠️ [慧阅卷] 未找到答题卡图片');
        return [];
    },

    async fetchImageAsBase64(url) {
        if (url.startsWith('data:')) {
            return url.split(',')[1];
        }
        return fetchImageAsBase64(url);
    },

    // 获取当前满分值
    _getMaxScore() {
        // 从 "本题总分: 6分" 提取
        const totalEl = document.querySelector(HUIYUEJUAN_SELECTORS.TOTAL_SCORE_TEXT);
        if (totalEl) {
            const match = totalEl.textContent.match(/(\d+)分/);
            if (match) return parseInt(match[1]);
        }
        return 0;
    },

    getScoreInputs() {
        const inputs = [];

        // 查找所有给分面板（可能有多个小题）
        const panels = document.querySelectorAll(HUIYUEJUAN_SELECTORS.SCORE_PANEL_CONTAINER);

        if (panels.length > 0) {
            panels.forEach((panel, i) => {
                const titleEl = panel.querySelector('.ui-exam-teacher-correct-score-panel-title');
                let label = titleEl ? titleEl.textContent.trim().replace(/\s+/g, ' ') : `第${i + 1}题`;

                // 解析满分（如 "16、(6分)"）
                const scoreMatch = label.match(/(\d+)分/);
                const maxScore = scoreMatch ? parseInt(scoreMatch[1]) : 0;

                // 获取可选分数按钮
                const scoreBtns = panel.querySelectorAll('.ui-input-number-target[ng-repeat]');
                const scores = [];
                scoreBtns.forEach(btn => {
                    const text = btn.textContent.trim();
                    // 慧阅卷按钮文本格式: "+0", "+1", "+2", ...
                    if (text.startsWith('+')) {
                        const num = parseInt(text.slice(1));
                        if (!isNaN(num)) scores.push(num);
                    } else {
                        const num = parseInt(text);
                        if (!isNaN(num)) scores.push(num);
                    }
                });

                inputs.push({
                    element: panel,
                    label: label.substring(0, 40),
                    index: i,
                    maxScore: maxScore || (scores.length > 0 ? Math.max(...scores) : 0),
                    type: 'click',
                    scores: scores
                });
            });
            return inputs;
        }

        // 如果没找到面板，尝试从整个评分区域获取
        const scoreBtns = document.querySelectorAll(HUIYUEJUAN_SELECTORS.SCORE_BUTTON);
        if (scoreBtns.length > 0) {
            const scores = [];
            scoreBtns.forEach(btn => {
                const text = btn.textContent.trim();
                if (text.startsWith('+')) {
                    const num = parseInt(text.slice(1));
                    if (!isNaN(num)) scores.push(num);
                } else {
                    const num = parseInt(text);
                    if (!isNaN(num)) scores.push(num);
                }
            });

            inputs.push({
                element: scoreBtns[0]?.closest('.ui-exam-teacher-correct-score-panel') || scoreBtns[0],
                label: '总分',
                index: 0,
                maxScore: this._getMaxScore() || (scores.length > 0 ? Math.max(...scores) : 0),
                type: 'click',
                scores: scores
            });
        }

        return inputs;
    },

    fillScores(scores) {
        if (!scores || scores.length === 0) return false;

        const score = scores[0];
        if (score === null || score === undefined) return false;

        console.log(`📝 [慧阅卷] 填入分数: ${score}`);

        // 获取当前满分
        const maxScore = this._getMaxScore();

        // 方法1: 使用满分/零分快捷按钮
        if (score === 0) {
            const zeroBtn = document.querySelector(HUIYUEJUAN_SELECTORS.ZERO_SCORE_BUTTON);
            if (zeroBtn) {
                zeroBtn.click();
                console.log('✅ [慧阅卷] 已点击"零分"按钮');
                return true;
            }
        }
        if (maxScore > 0 && score === maxScore) {
            const fullBtn = document.querySelector(HUIYUEJUAN_SELECTORS.FULL_SCORE_BUTTON);
            if (fullBtn) {
                fullBtn.click();
                console.log('✅ [慧阅卷] 已点击"满分"按钮');
                return true;
            }
        }

        // 方法2: 点击分数按钮
        const panel = document.querySelector(HUIYUEJUAN_SELECTORS.SCORE_PANEL_CONTAINER);
        if (panel) {
            const scoreBtns = panel.querySelectorAll('.ui-input-number-target[ng-repeat]');
            for (const btn of scoreBtns) {
                const text = btn.textContent.trim();
                // 匹配 "+N" 格式
                const btnScore = text.startsWith('+') ? parseInt(text.slice(1)) : parseInt(text);
                if (btnScore === score) {
                    btn.click();
                    console.log(`✅ [慧阅卷] 已点击分数按钮: ${text}`);
                    return true;
                }
            }
        }

        // 方法3: 使用自定义分值输入框
        const customInput = document.querySelector(HUIYUEJUAN_SELECTORS.CUSTOM_SCORE_INPUT);
        if (customInput) {
            console.log(`📝 [慧阅卷] 使用自定义分值输入框: ${score}`);
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
            ).set;
            setter.call(customInput, String(score));
            customInput.dispatchEvent(new Event('input', { bubbles: true }));
            customInput.dispatchEvent(new Event('change', { bubbles: true }));
            // 触发 AngularJS 的 ng-keydown enter 事件
            customInput.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', keyCode: 13, which: 13, bubbles: true
            }));
            customInput.dispatchEvent(new KeyboardEvent('keyup', {
                key: 'Enter', keyCode: 13, which: 13, bubbles: true
            }));
            console.log(`✅ [慧阅卷] 已通过自定义输入框填入分数: ${score}`);
            return true;
        }

        console.warn(`⚠️ [慧阅卷] 无法填入分数 ${score}`);
        return false;
    },

    submitGrade() {
        console.log('📤 [慧阅卷] 开始提交分数...');

        // 慧阅卷的评分流程：点击分数按钮即完成评分
        // 如果"评分后自动进入下一题"已勾选，会自动跳转
        // 否则需要手动点击"下一题"或类似按钮

        // 查找可能的提交/下一个按钮
        const allClickables = document.querySelectorAll('[ng-click]');
        for (const el of allClickables) {
            const ngClick = el.getAttribute('ng-click') || '';
            const text = el.textContent.trim();
            if (ngClick.includes('next') || ngClick.includes('submit') ||
                text.includes('下一个') || text.includes('下一题') || text.includes('提交')) {
                console.log(`✅ [慧阅卷] 找到提交/下一题按钮: "${text.substring(0, 20)}"`);
                el.click();
                return true;
            }
        }

        // 未找到显式按钮，可能分数按钮点击即提交
        console.log('✅ [慧阅卷] 分数已通过按钮点击提交');
        return true;
    },

    async waitForNextPaper(oldImageUrl) {
        console.log('⏳ [慧阅卷] 等待下一份试卷...');

        const oldId = this.getTaskIdentifier();
        const oldUrl = oldImageUrl || this._getCurrentImageUrl();
        console.log(`⏳ [慧阅卷] 当前标识: ${oldId}, 图片: ${oldUrl ? oldUrl.substring(0, 60) + '...' : '(无)'}`);

        const startTime = Date.now();
        const maxWait = 30000;

        return new Promise((resolve) => {
            const timer = setInterval(() => {
                // 检测1: 给分面板消失再出现（弹窗切换）
                // 检测2: 题号变化
                const currentId = this.getTaskIdentifier();
                if (currentId !== oldId && currentId !== 'hui_unknown') {
                    clearInterval(timer);
                    console.log(`✅ [慧阅卷] 新试卷已加载（标识: ${oldId} → ${currentId}）`);
                    resolve(true);
                    return;
                }

                // 检测3: 图片 URL 变化
                const currentUrl = this._getCurrentImageUrl();
                if (currentUrl && oldUrl && currentUrl !== oldUrl) {
                    clearInterval(timer);
                    console.log('✅ [慧阅卷] 新试卷已加载（图片变化）');
                    resolve(true);
                    return;
                }

                // 检测4: 分数状态重置为"未评分"
                const scoreText = document.querySelector(HUIYUEJUAN_SELECTORS.CURRENT_SCORE_TEXT);
                if (scoreText && scoreText.textContent.includes('未评分')) {
                    // 确认是新的未评分状态（面板仍然存在）
                    const panel = document.querySelector(HUIYUEJUAN_SELECTORS.SCORE_PANEL);
                    if (panel) {
                        // 等待一小段时间确保不是初始化状态
                        const elapsed = Date.now() - startTime;
                        if (elapsed > 2000) {
                            clearInterval(timer);
                            console.log('✅ [慧阅卷] 新试卷已加载（分数重置为未评分）');
                            resolve(true);
                            return;
                        }
                    }
                }

                // 超时检测
                if (Date.now() - startTime > maxWait) {
                    clearInterval(timer);
                    console.warn('⚠️ [慧阅卷] 等待下一份试卷超时');
                    resolve(false);
                }
            }, 500);
        });
    },

    // 获取当前图片 URL
    _getCurrentImageUrl() {
        const img = document.querySelector(HUIYUEJUAN_SELECTORS.ANSWER_IMAGE);
        return img ? img.src : null;
    },

    isRegradeMode() {
        // 检查是否是回评模式
        const scorePanel = document.querySelector(HUIYUEJUAN_SELECTORS.SCORE_PANEL);
        if (scorePanel) {
            const text = scorePanel.textContent;
            if (text.includes('回评') || text.includes('复核')) {
                return true;
            }
        }
        return false;
    },

    onPageLoad() {
        console.log('🚀 [慧阅卷] 页面加载完成，执行初始化...');

        // 注入 z-index 修复，确保 AI 按钮在弹窗之上
        const style = document.createElement('style');
        style.textContent = `
            .ai-grade-btn, .ai-toast, #ai-grading-settings, #ai-settings-overlay,
            .ai-history-btn, .ai-settings-btn, #ai-batch-progress,
            #auto-submit-dialog, .ai-stream-panel {
                z-index: 2147483640 !important;
            }
        `;
        document.head.appendChild(style);
    },

    onGradingComplete() {
        console.log('✅ [慧阅卷] 本轮批改完成');
    },
};

// 注册适配器
if (HuiyuejuanAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = HuiyuejuanAdapter;
}
