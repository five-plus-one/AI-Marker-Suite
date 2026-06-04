// ========== 好分数书仪泽适配器 ==========
// haofenshuyize.com — Vue 3 + Element Plus
// 与好分数(yue.haofenshu.com)是不同平台

const HaofenshuyizeAdapter = {
    name: '好分数书仪泽',
    id: 'haofenshuyize',
    urlPatterns: ['https://haofenshuyize.com/*'],
    iconUrl: '',

    shouldInitialize() {
        return window.location.hostname.includes('haofenshuyize.com');
    },

    async detectMarkingPage() {
        console.log('🔎 [诊断] 好分数书仪泽 — 开始检测批改页面...');
        try {
            const hasImage = document.querySelector(HAOFENSHUYIZE_SELECTORS.PAGE_DETECT_IMAGE);
            const hasInput = document.querySelector(HAOFENSHUYIZE_SELECTORS.PAGE_DETECT_INPUT);
            const hasButton = document.querySelector(HAOFENSHUYIZE_SELECTORS.PAGE_DETECT_SUBMIT);
            const detected = !!(hasImage && hasInput && hasButton);
            console.log(`🔎 [诊断] 图片: ${!!hasImage}, 输入框: ${!!hasInput}, 提交按钮: ${!!hasButton}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [诊断] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // URL 格式: #/marking/grading?questionId=1114509&thisType=2&...
        const hash = window.location.hash || '';
        const questionMatch = hash.match(/questionId=(\d+)/);
        const questionId = questionMatch ? questionMatch[1] : '';

        // 加上当前图片 src 以区分同一题的不同答卷
        const img = document.querySelector(HAOFENSHUYIZE_SELECTORS.ANSWER_IMAGE);
        const imgSrc = img ? img.src.split('?')[0] : ''; // 去掉查询参数

        return `haofenshuyize_${questionId}_${imgSrc}`;
    },

    async gatherAnswerImages() {
        const imgElements = document.querySelectorAll(HAOFENSHUYIZE_SELECTORS.ANSWER_IMAGE);
        const urls = [];
        imgElements.forEach(img => {
            if (img.src && img.src.startsWith('http')) {
                urls.push(img.src);
            }
        });
        console.log(`🖼️ [诊断] 好分数书仪泽 — 找到 ${urls.length} 张图片`);
        return urls;
    },

    async fetchImageAsBase64(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'blob',
                onload: (res) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const base64 = reader.result.split(',')[1];
                        resolve(base64);
                    };
                    reader.readAsDataURL(res.response);
                },
                onerror: reject
            });
        });
    },

    /**
     * 从 .scoreitem 按钮中提取满分值
     * 按钮文本格式: " 0", " 1", ..., " 8"
     */
    _getMaxScore() {
        const buttons = document.querySelectorAll(HAOFENSHUYIZE_SELECTORS.SCORE_ITEM_BUTTONS);
        let maxScore = 0;
        buttons.forEach(btn => {
            const val = parseInt(btn.textContent.trim());
            if (!isNaN(val) && val > maxScore) maxScore = val;
        });
        return maxScore;
    },

    /**
     * 查找匹配目标分数的 .scoreitem 按钮
     */
    _findScoreButton(targetScore) {
        const buttons = document.querySelectorAll(HAOFENSHUYIZE_SELECTORS.SCORE_ITEM_BUTTONS);
        for (const btn of buttons) {
            const btnScore = parseInt(btn.textContent.trim());
            if (btnScore === targetScore) return btn;
        }
        return null;
    },

    getScoreInputs() {
        const maxScore = this._getMaxScore();
        const scoreInput = document.querySelector(HAOFENSHUYIZE_SELECTORS.SCORE_INPUT);
        if (scoreInput) {
            return [{ element: scoreInput, label: '总分', index: 0, maxScore }];
        }
        return [];
    },

    /**
     * 通过点击 .scoreitem 按钮填入分数
     * 注意：该平台的分数输入框是 readonly 的，只能通过点击按钮设置分数
     */
    fillScores(scores) {
        const score = scores[0]; // 单题模式
        if (score === null || score === undefined) return false;

        const btn = this._findScoreButton(score);
        if (btn) {
            btn.click();
            console.log(`✅ [诊断] 好分数书仪泽 — 点击分数按钮: ${score}`);
            return true;
        }

        // 兜底：如果没有精确匹配的按钮，尝试用满分/零分按钮
        if (score === this._getMaxScore()) {
            const fullBtn = document.querySelector(HAOFENSHUYIZE_SELECTORS.FULL_SCORE_BUTTON);
            if (fullBtn) {
                fullBtn.click();
                console.log(`✅ [诊断] 好分数书仪泽 — 点击满分按钮`);
                return true;
            }
        }
        if (score === 0) {
            const zeroBtn = document.querySelector(HAOFENSHUYIZE_SELECTORS.ZERO_SCORE_BUTTON);
            if (zeroBtn) {
                zeroBtn.click();
                console.log(`✅ [诊断] 好分数书仪泽 — 点击零分按钮`);
                return true;
            }
        }

        console.warn(`⚠️ [诊断] 好分数书仪泽 — 未找到分数 ${score} 对应的按钮`);
        return false;
    },

    // 旧接口兼容
    fillScore(request) {
        const { total } = request;
        return this.fillScores([total]);
    },

    submitGrade() {
        const submitBtn = document.querySelector(HAOFENSHUYIZE_SELECTORS.SUBMIT_BUTTON);
        if (submitBtn) {
            console.log('✅ [诊断] 好分数书仪泽 — 点击提交按钮');
            submitBtn.click();
            return true;
        }
        // 兜底：通过文本查找
        const allBtns = Array.from(document.querySelectorAll('button'));
        const btn = allBtns.find(b => {
            const span = b.querySelector('span');
            return span && span.textContent.trim() === HAOFENSHUYIZE_SELECTORS.SUBMIT_BUTTON_TEXT;
        });
        if (btn) {
            console.log('✅ [诊断] 好分数书仪泽 — 通过文本找到提交按钮');
            btn.click();
            return true;
        }
        console.warn('⚠️ [诊断] 好分数书仪泽 — 未找到提交按钮');
        return false;
    },

    async waitForNextPaper(oldImageUrl) {
        let checkTimes = 0;
        return new Promise((resolve) => {
            const timer = setInterval(() => {
                checkTimes++;
                const currentImg = document.querySelector(HAOFENSHUYIZE_SELECTORS.ANSWER_IMAGE);
                const currentUrl = currentImg ? currentImg.src : null;

                // 检测图片变化
                if (oldImageUrl && currentUrl && currentUrl !== oldImageUrl) {
                    clearInterval(timer);
                    console.log('✅ 好分数书仪泽 — 新试卷已加载（图片变化）');
                    resolve(true);
                    return;
                }

                // 检测输入框被清空
                const scoreInput = document.querySelector(HAOFENSHUYIZE_SELECTORS.SCORE_INPUT);
                const inputCleared = scoreInput && (scoreInput.value === '' || scoreInput.value === '0');
                if (inputCleared && checkTimes > 3) {
                    clearInterval(timer);
                    console.log('✅ 好分数书仪泽 — 新试卷已加载（输入框清空）');
                    resolve(true);
                    return;
                }

                if (checkTimes > 50) {
                    clearInterval(timer);
                    console.warn('⚠️ 好分数书仪泽 — 等待下一份试卷超时');
                    resolve(false);
                }
            }, 200);
        });
    },

    isRegradeMode() {
        return !!window.aiGradingState?.isRegrading;
    },

    detectSubQuestions() {
        const maxScore = this._getMaxScore();
        const scoreInput = document.querySelector(HAOFENSHUYIZE_SELECTORS.SCORE_INPUT);
        if (scoreInput && maxScore > 0) {
            // 从题目标题提取题号
            const titleEl = document.querySelector(HAOFENSHUYIZE_SELECTORS.QUESTION_TITLE);
            const label = titleEl ? titleEl.textContent.trim() : '总分';
            return [{ label, element: scoreInput, index: 0, maxScore }];
        }
        return [];
    }
};

if (HaofenshuyizeAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = HaofenshuyizeAdapter;
}
