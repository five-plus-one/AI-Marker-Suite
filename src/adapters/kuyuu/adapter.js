// ========== 酷鱼网阅卷适配器 ==========
// jQuery 传统页面 + Canvas 答题卡（ems-imageview 插件），域名: www.kuyuu.cn
// 评阅页 URL: /read/read?schoolid=..&examgroup=..&examid=..&groupid=..&itemid=N
//
// 特点：
// - 答题卡渲染在 canvas.ems-iv-img（跨域图片 tainted，toDataURL 不可用）
//   取图走「img 标签 → Performance resource 条目 → canvas 兜底」三重策略，最终用 GM_xmlhttpRequest 下载
// - 评分输入框在 #scorePanel 的「键」模式表格，带 scores 合法分数表属性
// - 键/鼠/批 三种打分模式，填分前确保「键」模式激活
// - 提交按钮 a[btntype="submit"]，另有满分/零分快捷按钮

const KuyuuAdapter = {
    name: '酷鱼网',
    id: 'kuyuu',
    urlPatterns: ['*://www.kuyuu.cn/*', '*://kuyuu.cn/*'],
    iconUrl: '',

    shouldInitialize() {
        return window.location.hostname.includes('kuyuu.cn');
    },

    isMarkingPage() {
        return /\/read\/read/i.test(window.location.pathname);
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('[酷鱼网] 当前不在评阅页面 (pathname:', window.location.pathname, ')');
            return false;
        }
        console.log('[酷鱼网] 开始检测批改页面...');
        try {
            const result = await Promise.race([
                waitForElement(KUYUU_SELECTORS.PAGE_DETECT_SCORE_PANEL).then(() => 'score-panel'),
                waitForElement(KUYUU_SELECTORS.ANSWER_CANVAS).then(() => 'canvas'),
            ]).catch(() => null);

            if (result) {
                console.log(`[酷鱼网] 检测到批改页面元素: ${result}`);
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 2000));
            const hasPanel = document.querySelector(KUYUU_SELECTORS.PAGE_DETECT_SCORE_PANEL);
            const hasCanvas = document.querySelector(KUYUU_SELECTORS.ANSWER_CANVAS);
            const detected = !!(hasPanel && hasCanvas);
            console.log(`[酷鱼网] 兜底检测 - 评分面板: ${!!hasPanel}, Canvas: ${!!hasCanvas}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('[酷鱼网] detectMarkingPage 异常:', error);
            return false;
        }
    },

    /**
     * 任务标识：取 URL 中稳定的 examid + itemid（避免 schoolid 等每次都可能变化的参数干扰）
     * 同一题目返回相同值，换题（itemid 变化）返回不同值
     */
    getTaskIdentifier() {
        const params = new URLSearchParams(window.location.search);
        const examid = params.get('examid') || '';
        const itemid = params.get('itemid') || '';
        return `kuyuu:${examid}:${itemid}`;
    },

    /**
     * 获取答题卡图片。
     * canvas 是 tainted（跨域图片绘制），toDataURL 会抛异常，故采用三重策略：
     *  1. 页面 <img> 标签（排除 UI 小图）
     *  2. Performance resource 条目中的图片 URL（排除 UI 资源）
     *  3. canvas.toDataURL 兜底（万一未 tainted）
     * 返回 URL 数组，核心层会用 fetchImageAsBase64（GM_xmlhttpRequest）下载
     */
    async gatherAnswerImages() {
        console.log('[酷鱼网] 开始获取答题卡图片...');
        const urls = [];

        // 策略1：img 标签（过滤 UI 小图 / 背景图）
        const imgs = Array.from(document.querySelectorAll('#readView img, img'));
        for (const img of imgs) {
            const src = img.src || '';
            if (!src || !src.startsWith('http')) continue;
            if (src.includes(KUYUU_SELECTORS.UI_ASSET_PREFIX)) continue;
            // 大尺寸优先（naturalWidth 在加载完成后才有值）
            const isLarge = (img.naturalWidth > 200 && img.naturalHeight > 200) ||
                            (img.width > 200 && img.height > 200);
            if (isLarge && !urls.includes(src)) {
                urls.push(src);
            }
        }
        if (urls.length) {
            console.log(`[酷鱼网] 从 img 标签获取到 ${urls.length} 张图片`);
            return urls;
        }

        // 策略2：Performance API 资源条目（img/image 类型或图片扩展名）
        try {
            const entries = performance.getEntriesByType('resource');
            for (const e of entries) {
                const name = e.name || '';
                if (!name.startsWith('http')) continue;
                if (name.includes(KUYUU_SELECTORS.UI_ASSET_PREFIX)) continue;
                const isImgInitiator = e.initiatorType === 'img' || e.initiatorType === 'image';
                const isImageExt = /\.(png|jpe?g|gif|webp|bmp|tif?f)(\?|$)/i.test(name);
                if ((isImgInitiator || isImageExt) && !urls.includes(name)) {
                    urls.push(name);
                }
            }
            if (urls.length) {
                console.log(`[酷鱼网] 从 Performance 资源条目获取到 ${urls.length} 个候选图片 URL`);
                return urls;
            }
        } catch (e) {
            console.warn('[酷鱼网] Performance API 读取失败:', e);
        }

        // 策略3：canvas 兜底（非 tainted 时可用）
        try {
            const canvas = document.querySelector(KUYUU_SELECTORS.ANSWER_CANVAS);
            if (canvas) {
                const dataUrl = canvas.toDataURL('image/png');
                if (dataUrl && dataUrl.length > 5000) {
                    console.log('[酷鱼网] canvas 兜底导出成功');
                    return [dataUrl];
                }
            }
        } catch (e) {
            console.warn('[酷鱼网] canvas 导出失败（tainted，属预期）:', e.message);
        }

        console.warn('[酷鱼网] 未能获取答题卡图片');
        return [];
    },

    /**
     * 分数输入框：#scorePanel 键模式表格的 input[type=text]
     * maxScore 从 td.first-td 文本「xxx (15分)」提取
     */
    getScoreInputs() {
        const inputEls = Array.from(document.querySelectorAll(KUYUU_SELECTORS.SCORE_INPUT));
        const inputs = [];

        inputEls.forEach((el, i) => {
            let maxScore = 0;

            // 从同一行的 td.first-td 提取满分，格式: "18/20/21  (15分)"
            const row = el.closest('tr');
            const maxScoreCell = row ? row.querySelector(KUYUU_SELECTORS.MAX_SCORE_CELL) : null;
            if (maxScoreCell) {
                const match = maxScoreCell.textContent.match(/(\d+)\s*分/);
                if (match) maxScore = parseInt(match[1], 10) || 0;
            }

            // 兜底：从 input 的 scores 属性取最大合法分数
            if (!maxScore && el.getAttribute('scores')) {
                const scoreNums = el.getAttribute('scores')
                    .split(',')
                    .map(s => parseInt(s, 10))
                    .filter(n => !isNaN(n));
                if (scoreNums.length) maxScore = Math.max(...scoreNums);
            }

            // 小题标签：first-td 的题号部分
            let label = `第${i + 1}题`;
            if (maxScoreCell) {
                const text = maxScoreCell.textContent.trim().replace(/\s+/g, ' ');
                if (text) label = text;
            }

            inputs.push({ element: el, label, index: i, maxScore });
        });

        console.log(`[酷鱼网] 找到 ${inputs.length} 个分数输入框`, inputs.map(x => `${x.label} 满分${x.maxScore}`));
        return inputs;
    },

    fillScores(scores) {
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) {
            console.warn('[酷鱼网] 未找到分数输入框');
            return false;
        }

        // 确保「键」打分模式激活
        this._ensureKeyboardMode();

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        let successCount = 0;

        for (let i = 0; i < Math.min(scores.length, inputs.length); i++) {
            if (scores[i] === null || scores[i] === undefined) continue;

            const input = inputs[i].element;
            const score = scores[i];

            setter.call(input, score);

            // jQuery 页面需触发多种事件
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

            successCount++;
        }

        console.log(`[酷鱼网] 填入 ${successCount}/${inputs.length} 个分数`);
        return successCount > 0;
    },

    submitGrade() {
        const btn = document.querySelector(KUYUU_SELECTORS.SUBMIT_BUTTON);
        if (!btn) {
            console.warn('[酷鱼网] 未找到提交按钮');
            return false;
        }
        btn.click();
        console.log('[酷鱼网] 点击提交按钮');

        // 分数确认开关开启时可能弹确认对话框，异步处理不阻塞主流程
        setTimeout(() => {
            const confirmBtn = document.querySelector('.plg-dialog .btn-blue[defaul="true"], .layui-layer-btn0, .ui-dialog-buttonpane .btn-blue');
            if (confirmBtn && confirmBtn.offsetParent !== null) {
                console.log('[酷鱼网] 检测到确认弹窗，自动点击确定');
                confirmBtn.click();
            }
        }, 250);

        return true;
    },

    async waitForNextPaper(oldImageUrl) {
        const timeout = 30000;
        const interval = 500;
        const startTime = Date.now();
        const oldTaskId = this.getTaskIdentifier();

        while (Date.now() - startTime < timeout) {
            // 检测任务标识变化（URL itemid 变化 → 换题）
            const newTaskId = this.getTaskIdentifier();
            if (newTaskId !== oldTaskId) {
                console.log('[酷鱼网] 检测到任务标识变化，进入下一题');
                return true;
            }

            // 检测分数输入框是否已清空（平台加载下一份时清空输入）
            const firstInput = document.querySelector(KUYUU_SELECTORS.SCORE_INPUT);
            if (firstInput && firstInput.value === '') {
                // 清空后稍等平台渲染答题卡
                await new Promise(r => setTimeout(r, 300));
                console.log('[酷鱼网] 检测到输入框已清空');
                return true;
            }

            await new Promise(r => setTimeout(r, interval));
        }

        console.warn('[酷鱼网] 等待下一份答卷超时');
        return false;
    },

    detectSubQuestions() {
        return [];
    },

    isRegradeMode() {
        const bodyText = document.body.innerText || '';
        return bodyText.includes('回评');
    },

    /** 确保「键」打分模式激活 */
    _ensureKeyboardMode() {
        const keyMode = document.querySelector(KUYUU_SELECTORS.KEYBOARD_MODE);
        if (keyMode && !keyMode.classList.contains('key-active')) {
            keyMode.click();
            console.log('[酷鱼网] 切换到键盘打分模式');
        }
    },

    fetchImageAsBase64(url) {
        // 走核心层的 GM_xmlhttpRequest 下载（可绕过 CORS），带重试
        return fetchImageAsBase64(url);
    },

    onPageLoad() {
        this._ensureKeyboardMode();
        console.log('[酷鱼网] 适配器已就绪');
    },
};

// 注册适配器
if (KuyuuAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = KuyuuAdapter;
    console.log('[酷鱼网] 适配器已注册');
}
