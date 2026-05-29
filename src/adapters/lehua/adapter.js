// ========== 乐华阅卷适配器 ==========
// main.lhsvr.cn — Vue + Element UI + Canvas 渲染答题卡
// 评分方式：点击式 .score-btn 按钮 (0-N)
// 图片获取：Canvas toDataURL 导出

const LehuaAdapter = {
    name: '乐华阅卷',
    id: 'lehua',
    urlPatterns: ['*://main.lhsvr.cn/*'],
    iconUrl: '',

    shouldInitialize() {
        return window.location.hostname.includes('main.lhsvr.cn');
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器
    isMarkingPage() {
        const hash = window.location.hash;
        // 匹配阅卷页面路径，如 #/yuejuan1/examYj1
        return hash.includes('yuejuan') || hash.includes('examYj');
    },

    async detectMarkingPage() {
        // 先检查 URL 是否为阅卷页面
        if (!this.isMarkingPage()) {
            console.log('🔎 [诊断] 乐华阅卷 — 当前不在阅卷页面 (hash:', window.location.hash, ')');
            return false;
        }

        console.log('🔎 [诊断] 乐华阅卷 — 开始检测批改页面...');
        try {
            // 等待关键元素出现
            const result = await Promise.race([
                waitForElement(LEHUA_SELECTORS.PAGE_DETECT_CANVAS, 5000).then(() => 'canvas'),
                waitForElement(LEHUA_SELECTORS.PAGE_DETECT_SCORE, 5000).then(() => 'score-btn'),
                waitForElement(LEHUA_SELECTORS.PAGE_DETECT_SUBMIT, 5000).then(() => 'submit-btn'),
            ]).catch(() => null);

            if (result) {
                console.log(`✅ [诊断] 检测到批改页面元素: ${result}`);
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 2000));
            const hasCanvas = document.querySelector(LEHUA_SELECTORS.ANSWER_CANVAS);
            const hasScore = document.querySelector(LEHUA_SELECTORS.SCORE_BUTTON);
            const hasBtn = document.querySelector(LEHUA_SELECTORS.SUBMIT_BUTTON_PRIMARY);
            const detected = !!(hasCanvas && (hasScore || hasBtn));
            console.log(`🔎 [诊断] 兜底检测 — Canvas: ${!!hasCanvas}, 评分按钮: ${!!hasScore}, 提交: ${!!hasBtn}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [诊断] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        return window.location.href;
    },

    async gatherAnswerImages() {
        console.log('🖼️ [诊断] 乐华阅卷 — 开始获取答题卡图片...');

        // 等待 Canvas 渲染完成
        await new Promise(r => setTimeout(r, 1000));

        // 从 Canvas 导出图片
        const canvas = document.querySelector(LEHUA_SELECTORS.ANSWER_CANVAS);
        if (!canvas) {
            console.warn('⚠️ [诊断] 未找到 Canvas 元素');
            return [];
        }

        try {
            const dataUrl = canvas.toDataURL('image/png');
            if (dataUrl && dataUrl.length > 1000) {
                console.log(`🖼️ [诊断] 从 Canvas 导出图片成功 (${Math.round(dataUrl.length * 0.75 / 1024)} KB)`);
                return [dataUrl];
            } else {
                console.warn('⚠️ [诊断] Canvas 导出内容过小，可能为空白');
                return [];
            }
        } catch (e) {
            console.error('❌ [诊断] Canvas 导出失败:', e.message);
            return [];
        }
    },

    async fetchImageAsBase64(url) {
        // 如果已经是 data URL，直接提取 base64
        if (url.startsWith('data:')) {
            return url.split(',')[1];
        }

        // 否则使用通用的下载方法
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];

        // 查找点击式评分按钮
        const scoreBtns = document.querySelectorAll(LEHUA_SELECTORS.SCORE_BUTTON);
        if (scoreBtns.length > 0) {
            // 从按钮文本推断可选分数
            const scores = [];
            scoreBtns.forEach(btn => {
                const text = btn.textContent.trim();
                const num = parseInt(text);
                if (!isNaN(num)) scores.push(num);
            });

            // 使用第一个按钮的父容器作为 element
            const container = scoreBtns[0]?.closest('.score-panel') ||
                              scoreBtns[0]?.closest('.score-list') ||
                              scoreBtns[0]?.parentElement;

            inputs.push({
                element: container || scoreBtns[0],
                label: '总分',
                index: 0,
                maxScore: scores.length > 0 ? Math.max(...scores) : 0,
                type: 'click',
                scores: scores
            });
            return inputs;
        }

        // 备用：查找输入框
        const scoreInput = document.querySelector(LEHUA_SELECTORS.SCORE_INPUT);
        if (scoreInput) {
            inputs.push({
                element: scoreInput,
                label: '总分',
                index: 0,
                maxScore: 0
            });
        }

        return inputs;
    },

    fillScores(scores) {
        if (!scores || scores.length === 0) return false;

        const score = scores[0];
        if (score === null || score === undefined) return false;

        console.log(`📝 [诊断] 乐华阅卷 — 填入分数: ${score}`);

        // 方法1: 点击评分按钮
        const scoreBtns = document.querySelectorAll(LEHUA_SELECTORS.SCORE_BUTTON);
        if (scoreBtns.length > 0) {
            for (const btn of scoreBtns) {
                const text = btn.textContent.trim();
                if (text === String(score)) {
                    btn.click();
                    console.log(`✅ [诊断] 已点击分数按钮: ${score}`);
                    return true;
                }
            }
            console.warn(`⚠️ [诊断] 未找到分数 ${score} 对应的按钮`);
        }

        // 方法2: 使用输入框
        const scoreInput = document.querySelector(LEHUA_SELECTORS.SCORE_INPUT);
        if (scoreInput) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(scoreInput, score);
            scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
            scoreInput.dispatchEvent(new Event('change', { bubbles: true }));
            scoreInput.dispatchEvent(new Event('blur', { bubbles: true }));
            console.log(`✅ [诊断] 分数已填入输入框`);
            return true;
        }

        console.warn('⚠️ [诊断] 无法填入分数');
        return false;
    },

    submitGrade() {
        console.log('📤 [诊断] 乐华阅卷 — 开始提交分数...');

        // 查找"确认提交"按钮
        const allButtons = document.querySelectorAll('button');
        for (const btn of allButtons) {
            const text = btn.textContent.trim();
            if (text === '确认提交' || text === '确认') {
                // 检查是否可见且未禁用
                if (btn.offsetParent !== null && !btn.disabled && !btn.classList.contains('is-disabled')) {
                    console.log(`✅ [诊断] 找到提交按钮: "${text}"`);
                    btn.click();

                    // 处理可能的二次确认弹窗
                    this._handleConfirmDialog();
                    return true;
                }
            }
        }

        console.warn('⚠️ [诊断] 未找到提交按钮');
        return false;
    },

    // 处理二次确认弹窗
    _handleConfirmDialog() {
        console.log('⏳ [诊断] 等待确认弹窗...');

        let checkCount = 0;
        const checkInterval = setInterval(() => {
            checkCount++;

            // 查找弹窗中的确认按钮
            const confirmBtns = document.querySelectorAll('.el-message-box__btns button, .el-dialog__footer button');
            for (const btn of confirmBtns) {
                const text = btn.textContent.trim();
                if (text === '确认' || text === '确定' || text === 'OK') {
                    console.log('✅ [诊断] 找到确认弹窗，自动点击');
                    btn.click();
                    clearInterval(checkInterval);
                    return;
                }
            }

            // 超时（最多等 2 秒）
            if (checkCount >= 10) {
                clearInterval(checkInterval);
                console.log('⚠️ [诊断] 未检测到确认弹窗');
            }
        }, 200);
    },

    async waitForNextPaper(oldImageUrl) {
        console.log('⏳ [诊断] 乐华阅卷 — 等待下一份试卷...');

        // 记录当前 Canvas 内容的 hash
        const oldHash = this._getCanvasHash();
        console.log(`⏳ [诊断] 当前 Canvas hash: ${oldHash || '(无)'}`);

        const startTime = Date.now();
        const maxWait = 30000; // 最多等待 30 秒

        return new Promise((resolve) => {
            const timer = setInterval(() => {
                const currentHash = this._getCanvasHash();

                // Canvas 内容变化 = 新试卷已加载
                if (currentHash && currentHash !== oldHash) {
                    clearInterval(timer);
                    console.log(`✅ 乐华阅卷 — 新试卷已加载 (Canvas hash 变化)`);
                    resolve(true);
                    return;
                }

                // 超时检测
                if (Date.now() - startTime > maxWait) {
                    clearInterval(timer);
                    console.warn('⚠️ 乐华阅卷 — 等待下一份试卷超时');
                    resolve(false);
                }
            }, 500);
        });
    },

    // 获取 Canvas 内容的简单 hash（用于变化检测）
    _getCanvasHash() {
        try {
            const canvas = document.querySelector(LEHUA_SELECTORS.ANSWER_CANVAS);
            if (!canvas) return null;

            // 取 Canvas 左上角一小块区域的像素数据来计算 hash
            // 这样比导出整个 Canvas 更快
            const ctx = canvas.getContext('2d');
            const width = Math.min(canvas.width, 100);
            const height = Math.min(canvas.height, 100);
            const imageData = ctx.getImageData(0, 0, width, height);

            // 简单 hash：取前 100 个像素的 RGB 值之和
            let hash = 0;
            for (let i = 0; i < imageData.data.length; i += 4) {
                hash = (hash * 31 + imageData.data[i] + imageData.data[i + 1] + imageData.data[i + 2]) & 0xFFFFFFFF;
            }
            return hash.toString(16);
        } catch (e) {
            return null;
        }
    },

    isRegradeMode() {
        // 检查是否有回评相关元素
        const regradeEl = document.querySelector(LEHUA_SELECTORS.REGRADE_INDICATOR);
        if (regradeEl) return true;

        // 检查页面文本中是否包含"回评"
        const bodyText = document.body.textContent;
        if (bodyText.includes('回评') || bodyText.includes('复核')) {
            return true;
        }

        return false;
    },

    detectSubQuestions() {
        // 乐华阅卷目前是单题模式，返回空数组
        return [];
    },

    onPageLoad() {
        console.log('🚀 [诊断] 乐华阅卷 — 页面加载完成');
    },

    onGradingComplete() {
        console.log('✅ [诊断] 乐华阅卷 — 本轮批改完成');
    },
};

// 注册适配器
if (LehuaAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = LehuaAdapter;
}
