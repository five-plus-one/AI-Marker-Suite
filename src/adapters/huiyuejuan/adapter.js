// ========== 慧阅卷适配器 ==========
// web.17yuejuan.cn — AngularJS
// 阅卷界面以弹窗形式呈现，评分通过点击分数按钮（+0, +1, +2, ...）
//
// 特殊架构：平台使用 <frameset> + <frame> 结构
// 顶层 frameset 几乎为空，实际内容在 frame 内部
// 脚本在顶层运行，通过 frame.contentDocument 遍历到内部操作

// ========== 弹窗状态监测（Frame 感知） ==========
let _huiyuejuanMarkingActive = false;
let _huiyuejuanObserver = null;

if (window.location.hostname.includes('17yuejuan.cn')) {
    // 获取 frame 内部的 document
    function _huiGetFrameDoc() {
        try {
            const frame = document.querySelector('frame[src*="17yuejuan"], frame[src*="oemimoms"]');
            if (!frame) return null;
            return frame.contentDocument || (frame.contentWindow && frame.contentWindow.document) || null;
        } catch (e) {
            return null;
        }
    }

    // 检测 frame 内部的给分面板
    function _huiCheckMarkingPanel() {
        const frameDoc = _huiGetFrameDoc();
        if (!frameDoc) return;
        const panel = frameDoc.querySelector(HUIYUEJUAN_SELECTORS.SCORE_PANEL);
        if (panel && !_huiyuejuanMarkingActive) {
            _huiyuejuanMarkingActive = true;
            console.log('🔔 [慧阅卷] 检测到阅卷弹窗出现（frame 内部）');
        } else if (!panel && _huiyuejuanMarkingActive) {
            _huiyuejuanMarkingActive = false;
            console.log('🔔 [慧阅卷] 检测到阅卷弹窗关闭（frame 内部）');
        }
    }

    // 启动 MutationObserver
    function _huiStartObserver() {
        if (_huiyuejuanObserver) return;

        _huiyuejuanObserver = new MutationObserver(() => {
            // 先检查 frame 是否已加载
            const frameDoc = _huiGetFrameDoc();
            if (frameDoc) {
                _huiCheckMarkingPanel();
            }
        });

        const body = document.body || document.documentElement;
        _huiyuejuanObserver.observe(body, {
            childList: true,
            subtree: true
        });

        // 立即检查一次（frame 可能已加载）
        _huiCheckMarkingPanel();

        // 如果 frame 尚未加载完成，轮询等待其 contentDocument 可用
        let frameCheckCount = 0;
        const frameCheckTimer = setInterval(() => {
            frameCheckCount++;
            const frameDoc = _huiGetFrameDoc();
            if (frameDoc) {
                clearInterval(frameCheckTimer);
                console.log('🔔 [慧阅卷] frame contentDocument 已可访问');
                _huiCheckMarkingPanel();

                // 在 frame 内部也挂载 observer，监测弹窗变化
                try {
                    const innerObserver = new MutationObserver(() => {
                        _huiCheckMarkingPanel();
                    });
                    innerObserver.observe(frameDoc.body || frameDoc.documentElement, {
                        childList: true,
                        subtree: true
                    });
                } catch (e) {
                    console.warn('⚠️ [慧阅卷] 无法在 frame 内部挂载 observer:', e.message);
                }
            }
            if (frameCheckCount >= 60) { // 最多等 30 秒
                clearInterval(frameCheckTimer);
            }
        }, 500);
    }

    // 延迟启动 observer，等待 body 可用
    function _huiInitObserver() {
        if (document.body) {
            _huiStartObserver();
        } else {
            setTimeout(_huiInitObserver, 200);
        }
    }
    _huiInitObserver();
}

// ========== 适配器定义 ==========
const HuiyuejuanAdapter = {
    name: '慧阅卷',
    id: 'huiyuejuan',
    urlPatterns: ['*://web.17yuejuan.cn/*'],
    iconUrl: 'https://web.17yuejuan.cn/favicon.ico',

    // 待填入的分数数组（支持分小题评分）
    _pendingScores: [],

    shouldInitialize() {
        return window.location.hostname.includes('17yuejuan.cn');
    },

    // 获取 frame 内部的 document
    _getFrameDoc() {
        try {
            const frame = document.querySelector('frame[src*="17yuejuan"], frame[src*="oemimoms"]');
            if (!frame) return null;
            return frame.contentDocument || (frame.contentWindow && frame.contentWindow.document) || null;
        } catch (e) {
            return null;
        }
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器
    isMarkingPage() {
        const frameDoc = this._getFrameDoc();
        if (!frameDoc) return false;
        return !!frameDoc.querySelector(HUIYUEJUAN_SELECTORS.SCORE_PANEL);
    },

    async detectMarkingPage() {
        console.log('🔎 [慧阅卷] 开始检测批改页面...');

        try {
            // 步骤1: 等待 frame 元素出现
            console.log('🔎 [慧阅卷] 等待 frame 元素...');
            const frameEl = await waitForElement('frame[src*="17yuejuan"], frame[src*="oemimoms"]', 10000).catch(() => null);
            if (!frameEl) {
                console.warn('⚠️ [慧阅卷] 未找到 frame 元素');
                return false;
            }
            console.log('✅ [慧阅卷] 找到 frame 元素');

            // 步骤2: 等待 frame 的 contentDocument 可访问
            console.log('🔎 [慧阅卷] 等待 frame contentDocument...');
            let frameDoc = null;
            const docWaitStart = Date.now();
            while (Date.now() - docWaitStart < 10000) {
                frameDoc = this._getFrameDoc();
                if (frameDoc) break;
                await new Promise(r => setTimeout(r, 500));
            }

            if (!frameDoc) {
                console.warn('⚠️ [慧阅卷] 无法访问 frame contentDocument（可能跨域）');
                return false;
            }
            console.log('✅ [慧阅卷] frame contentDocument 已可访问');

            // 步骤3: 在 frame 内部检测批改页面元素
            // 注意：必须传入 frameDoc 作为 waitForElement 的第二个参数
            const result = await Promise.race([
                waitForElement(HUIYUEJUAN_SELECTORS.PAGE_DETECT_PANEL, frameDoc).then(() => 'panel'),
                waitForElement(HUIYUEJUAN_SELECTORS.PAGE_DETECT_IMAGE, frameDoc).then(() => 'image'),
                waitForElement(HUIYUEJUAN_SELECTORS.PAGE_DETECT_BUTTONS, frameDoc).then(() => 'buttons'),
            ]).catch(() => null);

            if (result) {
                console.log(`✅ [慧阅卷] 在 frame 内检测到批改页面元素: ${result}`);
                _huiyuejuanMarkingActive = true;
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 2000));
            const hasPanel = !!frameDoc.querySelector(HUIYUEJUAN_SELECTORS.SCORE_PANEL);
            const hasImage = !!frameDoc.querySelector(HUIYUEJUAN_SELECTORS.ANSWER_IMAGE);
            const detected = hasPanel || hasImage;
            console.log(`🔎 [慧阅卷] 兜底检测 — 给分面板: ${hasPanel}, 图片: ${hasImage}, 最终: ${detected}`);
            if (detected) _huiyuejuanMarkingActive = true;
            return detected;
        } catch (error) {
            console.error('❌ [慧阅卷] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        const frameDoc = this._getFrameDoc();
        if (!frameDoc) return 'hui_unknown';

        // 从给分面板标题提取题号（如 "16、(6分)"）
        const panels = frameDoc.querySelectorAll(HUIYUEJUAN_SELECTORS.PANEL_TITLE);
        if (panels.length > 0) {
            const text = panels[0].textContent.trim();
            const match = text.match(/(\d+)/);
            if (match) return `hui_${match[1]}`;
        }

        // 回退：使用图片 src 中的唯一标识
        const img = frameDoc.querySelector(HUIYUEJUAN_SELECTORS.ANSWER_IMAGE);
        if (img && img.src) {
            const match = img.src.match(/answer_sheets\/(\d+)\/(\d+)/);
            if (match) return `hui_${match[1]}_${match[2]}`;
        }

        return `hui_unknown`;
    },

    async gatherAnswerImages() {
        console.log('🖼️ [慧阅卷] 开始获取答题卡图片...');

        const frameDoc = this._getFrameDoc();
        if (!frameDoc) {
            console.warn('⚠️ [慧阅卷] 无法访问 frame 文档');
            return [];
        }

        // 直接从 img 标签获取 src
        const img = frameDoc.querySelector(HUIYUEJUAN_SELECTORS.ANSWER_IMAGE);
        if (img && img.src) {
            console.log(`🖼️ [慧阅卷] 找到图片: ${img.src.substring(0, 80)}...`);
            return [img.src];
        }

        // 等待图片加载（弹窗可能刚打开）
        const startTime = Date.now();
        while (Date.now() - startTime < 5000) {
            const imgEl = frameDoc.querySelector(HUIYUEJUAN_SELECTORS.ANSWER_IMAGE);
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
        const frameDoc = this._getFrameDoc();
        if (!frameDoc) return 0;

        // 从 "本题总分: 6分" 提取
        const totalEl = frameDoc.querySelector(HUIYUEJUAN_SELECTORS.TOTAL_SCORE_TEXT);
        if (totalEl) {
            const match = totalEl.textContent.match(/(\d+)分/);
            if (match) return parseInt(match[1]);
        }
        return 0;
    },

    getScoreInputs() {
        const inputs = [];
        const frameDoc = this._getFrameDoc();
        if (!frameDoc) return inputs;

        // 查找所有给分面板（可能有多个小题）
        const panels = frameDoc.querySelectorAll(HUIYUEJUAN_SELECTORS.SCORE_PANEL_CONTAINER);

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
        const scoreBtns = frameDoc.querySelectorAll(HUIYUEJUAN_SELECTORS.SCORE_BUTTON);
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

        // 保存所有小题的分数
        this._pendingScores = scores.filter(s => s !== null && s !== undefined);
        console.log(`📝 [慧阅卷] 记录待填入分数: [${this._pendingScores.join(', ')}]（等待用户确认后点击）`);
        return true;
    },

    // 点击分数按钮（在用户确认后由 submitGrade 调用）
    _clickScore() {
        if (!this._pendingScores || this._pendingScores.length === 0) {
            console.warn('⚠️ [慧阅卷] 没有待填入的分数');
            return false;
        }

        const scores = [...this._pendingScores];
        this._pendingScores = [];
        console.log(`📝 [慧阅卷] 用户确认，填入分数: [${scores.join(', ')}]`);

        const frameDoc = this._getFrameDoc();
        if (!frameDoc) {
            console.warn('⚠️ [慧阅卷] 无法访问 frame 文档');
            return false;
        }

        // 获取所有小题面板
        const panels = frameDoc.querySelectorAll(HUIYUEJUAN_SELECTORS.SCORE_PANEL_CONTAINER);

        if (panels.length === 0) {
            console.warn('⚠️ [慧阅卷] 未找到小题面板');
            return false;
        }

        // 为每个小题填入对应的分数
        let successCount = 0;
        for (let i = 0; i < Math.min(panels.length, scores.length); i++) {
            const score = scores[i];
            const panel = panels[i];

            if (score === null || score === undefined) continue;

            // 获取该小题的满分
            const titleEl = panel.querySelector('.ui-exam-teacher-correct-score-panel-title');
            const titleText = titleEl ? titleEl.textContent : '';
            const maxMatch = titleText.match(/(\d+)分/);
            const maxScore = maxMatch ? parseInt(maxMatch[1]) : 0;

            // 策略1: 使用满分/零分快捷按钮
            if (score === 0) {
                const zeroBtn = panel.querySelector(HUIYUEJUAN_SELECTORS.ZERO_SCORE_BUTTON);
                if (zeroBtn) {
                    zeroBtn.click();
                    console.log(`✅ [慧阅卷] 第${i+1}小题: 已点击"零分"按钮`);
                    successCount++;
                    continue;
                }
            }
            if (maxScore > 0 && score === maxScore) {
                const fullBtn = panel.querySelector(HUIYUEJUAN_SELECTORS.FULL_SCORE_BUTTON);
                if (fullBtn) {
                    fullBtn.click();
                    console.log(`✅ [慧阅卷] 第${i+1}小题: 已点击"满分"按钮`);
                    successCount++;
                    continue;
                }
            }

            // 策略2: 点击分数按钮
            const scoreBtns = panel.querySelectorAll('.ui-input-number-target[ng-repeat]');
            let clicked = false;
            for (const btn of scoreBtns) {
                const text = btn.textContent.trim();
                const btnScore = text.startsWith('+') ? parseInt(text.slice(1)) : parseInt(text);
                if (btnScore === score) {
                    btn.click();
                    console.log(`✅ [慧阅卷] 第${i+1}小题: 已点击分数按钮 ${text}`);
                    clicked = true;
                    successCount++;
                    break;
                }
            }
            if (clicked) continue;

            // 策略3: 使用自定义分值输入框
            const customInput = panel.querySelector(HUIYUEJUAN_SELECTORS.CUSTOM_SCORE_INPUT);
            if (customInput) {
                const frameWin = this._getFrameWindow();
                const InputProto = frameWin ? frameWin.HTMLInputElement.prototype : window.HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(InputProto, 'value').set;
                setter.call(customInput, String(score));
                customInput.dispatchEvent(new Event('input', { bubbles: true }));
                customInput.dispatchEvent(new Event('change', { bubbles: true }));
                customInput.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter', keyCode: 13, which: 13, bubbles: true
                }));
                customInput.dispatchEvent(new KeyboardEvent('keyup', {
                    key: 'Enter', keyCode: 13, which: 13, bubbles: true
                }));
                console.log(`✅ [慧阅卷] 第${i+1}小题: 已通过自定义输入框填入分数 ${score}`);
                successCount++;
            }
        }

        console.log(`📝 [慧阅卷] 分数填入完成: ${successCount}/${scores.length} 个小题成功`);
        return successCount > 0;
    },

    // 获取 frame 的 window 对象
    _getFrameWindow() {
        try {
            const frame = document.querySelector('frame[src*="17yuejuan"], frame[src*="oemimoms"]');
            return frame ? frame.contentWindow : null;
        } catch (e) {
            return null;
        }
    },

    submitGrade() {
        console.log('📤 [慧阅卷] 开始提交分数...');

        // 用户确认后才点击分数按钮（慧阅卷点击分数即自动提交）
        this._clickScore();

        const frameDoc = this._getFrameDoc();
        if (!frameDoc) {
            console.warn('⚠️ [慧阅卷] 无法访问 frame 文档');
            return false;
        }

        // 慧阅卷的评分流程：点击分数按钮即完成评分
        // 如果"评分后自动进入下一题"已勾选，会自动跳转
        // 否则需要手动点击"下一题"或类似按钮

        // 查找可能的提交/下一个按钮
        const allClickables = frameDoc.querySelectorAll('[ng-click]');
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
                const frameDoc = this._getFrameDoc();
                if (!frameDoc) return;

                // 检测1: 题号变化
                const currentId = this.getTaskIdentifier();
                if (currentId !== oldId && currentId !== 'hui_unknown') {
                    clearInterval(timer);
                    console.log(`✅ [慧阅卷] 新试卷已加载（标识: ${oldId} → ${currentId}）`);
                    resolve(true);
                    return;
                }

                // 检测2: 图片 URL 变化
                const currentUrl = this._getCurrentImageUrl();
                if (currentUrl && oldUrl && currentUrl !== oldUrl) {
                    clearInterval(timer);
                    console.log('✅ [慧阅卷] 新试卷已加载（图片变化）');
                    resolve(true);
                    return;
                }

                // 检测3: 分数状态重置为"未评分"
                const scoreText = frameDoc.querySelector(HUIYUEJUAN_SELECTORS.CURRENT_SCORE_TEXT);
                if (scoreText && scoreText.textContent.includes('未评分')) {
                    const panel = frameDoc.querySelector(HUIYUEJUAN_SELECTORS.SCORE_PANEL);
                    if (panel) {
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
        const frameDoc = this._getFrameDoc();
        if (!frameDoc) return null;
        const img = frameDoc.querySelector(HUIYUEJUAN_SELECTORS.ANSWER_IMAGE);
        return img ? img.src : null;
    },

    isRegradeMode() {
        const frameDoc = this._getFrameDoc();
        if (!frameDoc) return false;

        const scorePanel = frameDoc.querySelector(HUIYUEJUAN_SELECTORS.SCORE_PANEL);
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
    },

    onGradingComplete() {
        console.log('✅ [慧阅卷] 本轮批改完成');
    },
};

// 注册适配器
if (HuiyuejuanAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = HuiyuejuanAdapter;
}
