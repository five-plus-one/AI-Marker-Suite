// ========== 光大阅卷适配器 ==========
// pj.yixx.cn — Vue 2 + Canvas 渲染

const GuangdaAdapter = {
    name: '光大阅卷',
    id: 'guangda',
    urlPatterns: ['*://pj.yixx.cn/*'],
    iconUrl: 'https://pj.yixx.cn/njs_2006/images/yuejuan.ico',

    shouldInitialize() {
        return window.location.hostname.includes('pj.yixx.cn');
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器
    // 严格匹配：只在 /#/painter 路径下激活
    isMarkingPage() {
        const hash = window.location.hash;
        // 精确匹配 /painter 路径，排除其他如 /jdEntry、/list 等
        return hash === '#/painter' || hash.startsWith('#/painter?') || hash.startsWith('#/painter/');
    },

    async detectMarkingPage() {
        // 光大阅卷是 SPA，先检查 hash 路径是否为阅卷页面
        const hash = window.location.hash;
        // 精确匹配 /painter 路径
        const isPainterPage = hash === '#/painter' || hash.startsWith('#/painter?') || hash.startsWith('#/painter/');

        if (!isPainterPage) {
            console.log('🔎 [诊断] 光大阅卷 — 当前不在阅卷页面 (hash:', hash, ')');
            return false;
        }

        console.log('🔎 [诊断] 光大阅卷 — 开始检测批改页面...');
        try {
            // 等待关键元素出现（缩短超时时间）
            const result = await Promise.race([
                waitForElement(GUANGDA_SELECTORS.PAGE_DETECT_CANVAS, 5000).then(() => 'canvas'),
                waitForElement(GUANGDA_SELECTORS.PAGE_DETECT_SCORE, 5000).then(() => 'score-item'),
                waitForElement(GUANGDA_SELECTORS.PAGE_DETECT_SUBMIT, 5000).then(() => 'submit-btn'),
            ]).catch(() => null);

            if (result) {
                console.log(`✅ [诊断] 检测到批改页面元素: ${result}`);
                return true;
            }

            // 兜底检测（缩短等待时间）
            await new Promise(resolve => setTimeout(resolve, 1000));
            const hasCanvas = document.querySelector(GUANGDA_SELECTORS.ANSWER_CANVAS);
            const hasScore = document.querySelector(GUANGDA_SELECTORS.SCORE_ITEM);
            const hasBtn = document.querySelector(GUANGDA_SELECTORS.SUBMIT_BUTTON);
            const detected = !!(hasCanvas && hasScore && hasBtn);
            console.log(`🔎 [诊断] 兜底检测 — Canvas: ${!!hasCanvas}, 分数项: ${!!hasScore}, 提交: ${hasBtn}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [诊断] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // 光大阅卷是 SPA，使用 hash 路径
        // URL 格式: https://pj.yixx.cn/njs_2006/#/painter
        const url = new URL(window.location.href);
        const hash = url.hash;
        // 尝试从 painter 组件获取当前题目索引
        const painterEl = document.querySelector('#painter');
        const painterVm = painterEl?.closest('[data-v-]')?.__vue__;
        let questionIndex = '';
        if (painterVm) {
            // 尝试获取当前题目标识
            const data = painterVm.$data || {};
            questionIndex = data.currentKs || data.clickIndex || '';
        }
        return `guangda_${hash}_${questionIndex}`;
    },

    async gatherAnswerImages() {
        console.log('🖼️ [诊断] 光大阅卷 — 开始获取答题卡图片...');

        // 等待 Canvas 渲染完成
        await new Promise(r => setTimeout(r, 1500));

        const canvases = document.querySelectorAll(GUANGDA_SELECTORS.ANSWER_CANVAS);
        const images = [];

        for (let i = 0; i < canvases.length; i++) {
            const canvas = canvases[i];
            try {
                // 尝试导出 Canvas 内容
                const dataUrl = canvas.toDataURL('image/png');
                // 检查是否是有效的图片（不是空白或 tainted）
                if (dataUrl && dataUrl.length > 5000) {
                    // 转换为纯 base64（去掉 data:image/png;base64, 前缀）
                    const base64 = dataUrl.split(',')[1];
                    if (base64) {
                        images.push({
                            index: i,
                            id: canvas.id,
                            dataUrl: dataUrl,
                            base64: base64,
                            width: canvas.width,
                            height: canvas.height,
                        });
                        console.log(`✅ [诊断] Canvas ${canvas.id} 导出成功 (${canvas.width}x${canvas.height}, ${dataUrl.length} bytes)`);
                    }
                } else {
                    console.log(`⚠️ [诊断] Canvas ${canvas.id} 内容过小或为空 (${dataUrl?.length || 0} bytes)`);
                }
            } catch (e) {
                // Canvas 被跨域图片污染（tainted）
                console.log(`⚠️ [诊断] Canvas ${canvas.id} 无法导出 (tainted): ${e.message}`);
            }
        }

        console.log(`🖼️ [诊断] 光大阅卷 — 找到 ${images.length} 张可用图片`);

        // 如果没有从 Canvas 获取到，尝试拦截网络请求
        if (images.length === 0) {
            console.log('🖼️ [诊断] Canvas 导出失败，尝试从网络请求获取图片...');
            return this._getImageUrlsFromNetwork();
        }

        // 返回 base64 数据（适配器需要返回 URL 或 base64）
        // 由于 Canvas 是本地渲染，我们返回 data URL
        return images.map(img => img.dataUrl);
    },

    // 从网络请求中获取图片 URL（备用方案）
    _getImageUrlsFromNetwork() {
        const entries = performance.getEntriesByType('resource');
        const imageUrls = entries
            .filter(e => e.initiatorType === 'img' || e.name.includes('.jpg') || e.name.includes('.png'))
            .filter(e => e.name.includes('rescenter') || e.name.includes('markpic'))
            .map(e => e.name);

        console.log(`🖼️ [诊断] 从网络请求找到 ${imageUrls.length} 张图片`);
        return [...new Set(imageUrls)]; // 去重
    },

    async fetchImageAsBase64(url) {
        // 如果已经是 data URL，直接提取 base64
        if (url.startsWith('data:')) {
            return url.split(',')[1];
        }

        // 否则使用通用的下载方法
        return fetchImageAsBase64(url);
    },

    fillScore(request) {
        const { total, subScores } = request;
        console.log(`📝 [诊断] 光大阅卷 fillScore — 分数: ${total}`);

        // 光大阅卷使用点击方式选择分数
        const scoreItems = document.querySelectorAll(GUANGDA_SELECTORS.SCORE_ITEM);
        console.log(`📝 [诊断] 找到 ${scoreItems.length} 个分数选项`);

        // 查找匹配的分数项
        let targetItem = null;
        for (const item of scoreItems) {
            const scoreText = item.textContent.trim();
            if (scoreText === String(total)) {
                targetItem = item;
                break;
            }
        }

        if (targetItem) {
            // 点击分数项
            targetItem.click();
            console.log(`✅ [诊断] 已点击分数: ${total}`);

            // 验证是否选中
            setTimeout(() => {
                const display = document.querySelector(GUANGDA_SELECTORS.SCORE_DISPLAY);
                console.log(`📝 [诊断] 当前显示得分: ${display?.textContent}`);
            }, 300);

            return true;
        }

        // 如果没有找到匹配的分数项，尝试使用 painter 组件的方法
        console.log('📝 [诊断] 未找到匹配分数项，尝试调用组件方法...');
        return this._fillScoreViaComponent(total);
    },

    // 通过 Vue 组件方法填入分数
    _fillScoreViaComponent(score) {
        try {
            // 查找 painter 组件实例
            const painterEl = document.querySelector('#painter');
            const painterVm = painterEl?.closest('[data-v-]')?.__vue__;

            if (painterVm) {
                // 尝试调用 clickSingleScore 方法
                if (typeof painterVm.clickSingleScore === 'function') {
                    painterVm.clickSingleScore(score);
                    console.log(`✅ [诊断] 通过组件方法 clickSingleScore(${score}) 填入分数`);
                    return true;
                }

                // 尝试直接设置当前分数
                if ('currentScoreIndex' in painterVm.$data) {
                    painterVm.currentScoreIndex = score;
                    console.log(`✅ [诊断] 通过设置 currentScoreIndex = ${score} 填入分数`);
                    return true;
                }
            }
        } catch (e) {
            console.error('❌ [诊断] 组件方法填入分数失败:', e);
        }

        console.warn('⚠️ [诊断] 无法填入分数');
        return false;
    },

    submitGrade() {
        console.log('📤 [诊断] 光大阅卷 — 开始提交分数...');

        // 查找"提交分数"按钮
        const submitBtn = document.querySelector(GUANGDA_SELECTORS.SUBMIT_BUTTON);
        if (submitBtn) {
            console.log('✅ [诊断] 找到提交按钮，点击中...');
            submitBtn.click();
            return true;
        }

        // 备选：查找包含"提交"文字的按钮
        const allButtons = document.querySelectorAll('button, span');
        for (const btn of allButtons) {
            if (btn.textContent.trim().includes('提交分数')) {
                console.log('✅ [诊断] 找到包含"提交分数"的按钮，点击中...');
                btn.click();
                return true;
            }
        }

        // 尝试调用组件方法
        try {
            const painterEl = document.querySelector('#painter');
            const painterVm = painterEl?.closest('[data-v-]')?.__vue__;
            if (painterVm && typeof painterVm.commitDxj === 'function') {
                console.log('✅ [诊断] 调用组件方法 commitDxj 提交分数');
                painterVm.commitDxj();
                return true;
            }
        } catch (e) {
            console.error('❌ [诊断] 组件方法提交失败:', e);
        }

        console.warn('⚠️ [诊断] 未找到提交按钮');
        return false;
    },

    async waitForNextPaper(oldImageUrl) {
        console.log('⏳ [诊断] 光大阅卷 — 等待下一份试卷...');
        let checkTimes = 0;
        const maxChecks = 60; // 最多等待 30 秒（500ms * 60）

        return new Promise((resolve) => {
            const timer = setInterval(() => {
                checkTimes++;

                // 获取当前 Canvas 内容
                const currentCanvas = document.querySelector('#painter canvas#1, #painter canvas#2');
                let currentData = null;
                try {
                    currentData = currentCanvas?.toDataURL('image/png');
                } catch (e) {
                    // tainted, ignore
                }

                // 检测 Canvas 内容变化
                if (oldImageUrl && currentData && currentData !== oldImageUrl) {
                    clearInterval(timer);
                    console.log('✅ 光大阅卷 — 新试卷已加载（Canvas 内容变化）');
                    resolve(true);
                    return;
                }

                // 检测得分显示区域重置
                const scoreDisplay = document.querySelector(GUANGDA_SELECTORS.SCORE_DISPLAY);
                const currentScore = scoreDisplay?.textContent?.trim();
                if (currentScore === '0' && checkTimes > 3) {
                    clearInterval(timer);
                    console.log('✅ 光大阅卷 — 新试卷已加载（得分重置为0）');
                    resolve(true);
                    return;
                }

                // 超时检测
                if (checkTimes >= maxChecks) {
                    clearInterval(timer);
                    console.warn('⚠️ 光大阅卷 — 等待下一份试卷超时');
                    resolve(false);
                }
            }, 500);
        });
    },

    isRegradeMode() {
        // 检查是否是回评模式
        const buttons = document.querySelectorAll('button.mg-btn');
        for (const btn of buttons) {
            if (btn.textContent.includes('回评') || btn.textContent.includes('重评')) {
                return true;
            }
        }
        // 检查 painter 组件的 ishp 属性
        try {
            const painterEl = document.querySelector('#painter');
            const painterVm = painterEl?.closest('[data-v-]')?.__vue__;
            if (painterVm && 'ishp' in painterVm.$data) {
                return !!painterVm.ishp;
            }
        } catch (e) {
            // ignore
        }
        return false;
    },

    getScoreInputs() {
        const inputs = [];

        // 光大阅卷使用点击选择，不是输入框
        // 返回分数项信息
        const scoreItems = document.querySelectorAll(GUANGDA_SELECTORS.SCORE_ITEM);
        scoreItems.forEach((item, i) => {
            inputs.push({
                element: item,
                label: item.textContent.trim() + '分',
                index: i,
                type: 'click', // 标记为点击类型
            });
        });

        return inputs;
    },

    detectSubQuestions() {
        const subQuestions = [];

        // 检查小题信息
        const xtList = document.querySelector(GUANGDA_SELECTORS.SUB_QUESTION_LIST);
        if (xtList && xtList.style.display !== 'none') {
            const label = xtList.querySelector('label');
            if (label) {
                const text = label.textContent.trim();
                // 解析 "2（4）" 格式
                const match = text.match(/(\d+)（(\d+)）/);
                if (match) {
                    subQuestions.push({
                        index: parseInt(match[1]) - 1,
                        label: `第${match[1]}题`,
                        maxScore: parseInt(match[2]),
                    });
                }
            }
        }

        return subQuestions;
    },

    onPageLoad() {
        console.log('🚀 [诊断] 光大阅卷 — 页面加载完成，执行初始化...');

        // 尝试设置一些优化选项
        try {
            const painterEl = document.querySelector('#painter');
            const painterVm = painterEl?.closest('[data-v-]')?.__vue__;
            if (painterVm) {
                // 禁用自动提交（如果存在）
                if ('autoSubmit' in painterVm.$data) {
                    painterVm.autoSubmit = false;
                    console.log('📝 [诊断] 已禁用自动提交');
                }
            }
        } catch (e) {
            // ignore
        }
    },

    onGradingComplete() {
        console.log('✅ [诊断] 光大阅卷 — 本轮批改完成');
    },
};

// 注册适配器
if (GuangdaAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = GuangdaAdapter;
}
