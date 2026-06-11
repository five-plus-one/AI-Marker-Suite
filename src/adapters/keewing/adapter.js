// ========== 科耘阅卷平台适配器 ==========
// kaoshi.keewing.com — Vue + Element UI
// 图片通过 SVG <image> 标签渲染（xlink:href）
// 评分通过输入框 + 满分/零分快捷按钮

const KeewingAdapter = {
    name: '科耘阅卷',
    id: 'keewing',
    urlPatterns: ['*://kaoshi.keewing.com/*'],
    iconUrl: 'https://kaoshi.keewing.com/favicon.ico',

    shouldInitialize() {
        return window.location.hostname.includes('kaoshi.keewing.com');
    },

    // 快速页面检查（不等待 DOM）
    isMarkingPage() {
        const hash = window.location.hash;
        // 匹配阅卷页面路径，如 #/review/read/15564/1
        return hash.includes('/review/read/') || hash.includes('/marking/');
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('🔎 [科耘] 当前不在阅卷页面 (hash:', window.location.hash, ')');
            return false;
        }

        console.log('🔎 [科耘] 开始检测批改页面...');
        try {
            // 等待关键元素出现
            const result = await Promise.race([
                waitForElement(KEEWING_SELECTORS.PAGE_DETECT_IMAGE, 8000).then(() => 'svg-image'),
                waitForElement(KEEWING_SELECTORS.PAGE_DETECT_SCORE, 8000).then(() => 'score-input'),
                waitForElement(KEEWING_SELECTORS.PAGE_DETECT_SUBMIT, 8000).then(() => 'submit-btn'),
            ]).catch(() => null);

            if (result) {
                console.log(`✅ [科耘] 检测到批改页面元素: ${result}`);
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 2000));
            const hasImage = document.querySelector(KEEWING_SELECTORS.PAGE_DETECT_IMAGE);
            const hasScore = document.querySelector(KEEWING_SELECTORS.PAGE_DETECT_SCORE);
            const hasBtn = document.querySelector(KEEWING_SELECTORS.PAGE_DETECT_SUBMIT);
            const detected = !!(hasImage && (hasScore || hasBtn));
            console.log(`🔎 [科耘] 兜底检测 — 图片: ${!!hasImage}, 输入框: ${!!hasScore}, 提交: ${!!hasBtn}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [科耘] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // 使用 URL 作为唯一标识（包含题块 ID 和索引）
        return window.location.href;
    },

    async gatherAnswerImages() {
        console.log('🖼️ [科耘] 开始获取答题卡图片...');

        // 等待 SVG 渲染完成
        await new Promise(r => setTimeout(r, 500));

        const urls = [];

        // 优先从 SVG <image> 标签获取带裁切参数的图片
        const svgImages = document.querySelectorAll(KEEWING_SELECTORS.SVG_IMAGE);
        svgImages.forEach(img => {
            const url = img.getAttribute('xlink:href') || img.getAttribute('href') || img.getAttribute('src');
            if (url && url.startsWith('http')) {
                // 只保留带裁切参数的 URL（当前题目区域）
                if (url.includes('x-oss-process=image/crop')) {
                    urls.push(url);
                }
            }
        });

        // 如果没有找到带裁切参数的图片，回退到普通 img 标签
        if (urls.length === 0) {
            const container = document.querySelector(KEEWING_SELECTORS.IMAGE_CONTAINER);
            if (container) {
                const img = container.querySelector('img');
                if (img && img.src && img.src.startsWith('http')) {
                    urls.push(img.src);
                }
            }
        }

        // 去重
        const uniqueUrls = [...new Set(urls)];
        console.log(`🖼️ [科耘] 找到答题卡图片: ${uniqueUrls.length} 张`);
        return uniqueUrls;
    },

    async fetchImageAsBase64(url) {
        // 如果已经是 data URL，直接提取 base64
        if (url.startsWith('data:')) {
            return url.split(',')[1];
        }

        // 使用通用的下载方法
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];

        // 查找分数输入框
        const scoreInput = document.querySelector(KEEWING_SELECTORS.SCORE_INPUT);
        if (scoreInput) {
            // 从 placeholder 解析满分值
            const placeholder = scoreInput.placeholder || '';
            const match = placeholder.match(/满分(\d+)/);
            const maxScore = match ? parseInt(match[1]) : 0;

            // 从 block-title 获取题号范围
            const blockTitle = scoreInput.closest('.score-list')?.querySelector('.block-title');
            const label = blockTitle ? blockTitle.textContent.trim() : '总分';

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

        // 科耘平台在填入分数后会自动提交
        // 所以需要延迟到用户确认后再填入
        this._pendingScore = score;
        console.log(`📝 [科耘] 记录待填入分数: ${score}（等待用户确认后填入）`);
        return true;
    },

    // 填入分数（在用户确认后调用）
    _applyScore() {
        if (this._pendingScore === null || this._pendingScore === undefined) {
            console.warn('⚠️ [科耘] 没有待填入的分数');
            return false;
        }

        const score = this._pendingScore;
        this._pendingScore = null;

        console.log(`📝 [科耘] 填入分数: ${score}`);

        // 获取满分值
        const maxScore = this._getCurrentMaxScore();

        // 如果是满分，点击满分按钮
        if (maxScore > 0 && score === maxScore) {
            const fullBtn = document.querySelector(KEEWING_SELECTORS.FULL_SCORE_BUTTON);
            if (fullBtn) {
                fullBtn.click();
                console.log(`✅ [科耘] 已点击"满分"按钮`);
                return true;
            }
        }

        // 如果是零分，点击零分按钮
        if (score === 0) {
            const zeroBtn = document.querySelector(KEEWING_SELECTORS.ZERO_SCORE_BUTTON);
            if (zeroBtn) {
                zeroBtn.click();
                console.log(`✅ [科耘] 已点击"零分"按钮`);
                return true;
            }
        }

        // 使用输入框填入分数
        const scoreInput = document.querySelector(KEEWING_SELECTORS.SCORE_INPUT);
        if (scoreInput) {
            // 尝试通过 Vue 实例设置值
            const vueInstance = scoreInput.__vue__ || scoreInput.closest('[data-v-]')?.__vue__;
            if (vueInstance) {
                console.log(`📝 [科耘] 通过 Vue 实例设置分数`);
                vueInstance.value = String(score);
                vueInstance.$emit?.('input', String(score));
                vueInstance.$emit?.('change', String(score));
            }

            // 使用原生方式设置值（兼容非 Vue 场景）
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(scoreInput, score);

            // 触发完整的事件链，确保 Vue 响应式更新
            scoreInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(score) }));
            scoreInput.dispatchEvent(new Event('change', { bubbles: true }));
            scoreInput.dispatchEvent(new Event('blur', { bubbles: true }));

            console.log(`✅ [科耘] 分数已填入输入框`);
            return true;
        }

        console.warn('⚠️ [科耘] 无法填入分数');
        return false;
    },

    // 获取当前满分值
    _getCurrentMaxScore() {
        const scoreInput = document.querySelector(KEEWING_SELECTORS.SCORE_INPUT);
        if (scoreInput) {
            const max = parseInt(scoreInput.getAttribute('max'));
            if (!isNaN(max)) return max;

            const match = (scoreInput.placeholder || '').match(/满分(\d+)/);
            if (match) return parseInt(match[1]);
        }
        return 0;
    },

    submitGrade() {
        console.log('📤 [科耘] 开始提交分数...');

        // 先填入分数（触发平台自动提交）
        this._applyScore();

        // 平台会自动提交，不需要再点击提交按钮
        // 但处理可能的确认弹窗
        this._handleConfirmDialog();

        return true;
    },

    // 处理二次确认弹窗
    _handleConfirmDialog() {
        console.log('⏳ [科耘] 等待确认弹窗...');

        let checkCount = 0;
        const checkInterval = setInterval(() => {
            checkCount++;

            // 查找弹窗中的确认按钮
            const confirmBtns = document.querySelectorAll('.el-message-box__btns button, .el-dialog__footer button');
            for (const btn of confirmBtns) {
                const text = btn.textContent.trim();
                if (text === '确认' || text === '确定' || text === 'OK') {
                    console.log('✅ [科耘] 找到确认弹窗，自动点击');
                    btn.click();
                    clearInterval(checkInterval);
                    return;
                }
            }

            // 超时（最多等 2 秒）
            if (checkCount >= 10) {
                clearInterval(checkInterval);
                console.log('ℹ️ [科耘] 未检测到确认弹窗');
            }
        }, 200);
    },

    async waitForNextPaper(oldImageUrl) {
        console.log('⏳ [科耘] 等待下一份试卷...');

        // 记录当前图片 URL
        const oldUrls = this._getCurrentImageUrls();
        console.log(`⏳ [科耘] 当前图片数量: ${oldUrls.length}`);

        const startTime = Date.now();
        const maxWait = 30000; // 最多等待 30 秒

        return new Promise((resolve) => {
            const timer = setInterval(() => {
                const currentUrls = this._getCurrentImageUrls();

                // 检测图片变化
                if (oldUrls.length > 0 && currentUrls.length > 0) {
                    const oldSet = new Set(oldUrls);
                    const hasNew = currentUrls.some(url => !oldSet.has(url));
                    if (hasNew) {
                        clearInterval(timer);
                        console.log('✅ [科耘] 新试卷已加载（图片变化）');
                        resolve(true);
                        return;
                    }
                }

                // 检测输入框被清空（提交后平台会清空输入框）
                const scoreInput = document.querySelector(KEEWING_SELECTORS.SCORE_INPUT);
                if (scoreInput && scoreInput.value === '' && Date.now() - startTime > 1000) {
                    clearInterval(timer);
                    console.log('✅ [科耘] 新试卷已加载（输入框已清空）');
                    resolve(true);
                    return;
                }

                // 超时检测
                if (Date.now() - startTime > maxWait) {
                    clearInterval(timer);
                    console.warn('⚠️ [科耘] 等待下一份试卷超时');
                    resolve(false);
                }
            }, 500);
        });
    },

    // 获取当前图片 URL 列表
    _getCurrentImageUrls() {
        const images = document.querySelectorAll(KEEWING_SELECTORS.SVG_IMAGE);
        const urls = [];
        images.forEach(img => {
            let url = img.getAttribute('xlink:href') || img.getAttribute('href') || img.getAttribute('src');
            if (url && url.startsWith('http')) {
                urls.push(url);
            }
        });
        return urls;
    },

    isRegradeMode() {
        // 检查 URL 是否包含 review 关键字
        const hash = window.location.hash;
        if (hash.includes('/review/')) {
            return true;
        }

        // 检查页面文本中是否包含"回评"
        const bodyText = document.body.textContent;
        if (bodyText.includes('回评') || bodyText.includes('复核')) {
            return true;
        }

        return false;
    },

    onPageLoad() {
        console.log('🚀 [科耘] 页面加载完成，执行初始化...');

        // 确保"自动提交"未勾选（避免意外提交）
        const autoSubmitCheckbox = document.querySelector(KEEWING_SELECTORS.AUTO_SUBMIT_CHECKBOX);
        if (autoSubmitCheckbox && autoSubmitCheckbox.checked) {
            const label = autoSubmitCheckbox.closest('label.el-checkbox');
            if (label) {
                label.click();
                console.log('📝 [科耘] 已取消"自动提交"勾选');
            }
        }
    },

    onGradingComplete() {
        console.log('✅ [科耘] 本轮批改完成');
    },
};

// 注册适配器
if (KeewingAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = KeewingAdapter;
}
