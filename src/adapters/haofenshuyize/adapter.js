// ========== 云阅卷(好分数)适配器 ==========
// haofenshuyize.com — Vue 3 + Element Plus
// 与云阅卷(yunyuejuan.net)是不同平台

const HaofenshuyizeAdapter = {
    name: '云阅卷(好分数)',
    id: 'haofenshuyize',
    urlPatterns: ['https://haofenshuyize.com/*'],
    iconUrl: '',

    shouldInitialize() {
        return window.location.hostname.includes('haofenshuyize.com');
    },

    async detectMarkingPage() {
        console.log('🔎 [诊断] 云阅卷(好分数) — 开始检测批改页面...');
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
        // 只用 questionId + hash 路径，不包含图片 URL（图片含学生特定哈希，每份答卷不同）
        const hash = window.location.hash || '';
        const questionMatch = hash.match(/questionId=(\d+)/);
        const questionId = questionMatch ? questionMatch[1] : '';
        return `haofenshuyize_${questionId}_${hash.split('?')[0]}`;
    },

    async gatherAnswerImages() {
        const imgElements = document.querySelectorAll(HAOFENSHUYIZE_SELECTORS.ANSWER_IMAGE);
        const urls = [];
        imgElements.forEach(img => {
            if (img.src && img.src.startsWith('http')) {
                urls.push(img.src);
            }
        });
        console.log(`🖼️ [诊断] 云阅卷(好分数) — 找到 ${urls.length} 张图片`);
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

    getScoreInputs() {
        const maxScore = this._getMaxScore();
        const scoreInput = document.querySelector(HAOFENSHUYIZE_SELECTORS.SCORE_INPUT);
        if (scoreInput) {
            return [{ element: scoreInput, label: '总分', index: 0, maxScore }];
        }
        return [];
    },

    fillScores(scores) {
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) return false;
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
        let successCount = 0;
        for (let i = 0; i < Math.min(scores.length, inputs.length); i++) {
            if (scores[i] === null || scores[i] === undefined) continue;
            setter.call(inputs[i].element, scores[i]);
            inputs[i].element.dispatchEvent(new Event('input', { bubbles: true }));
            inputs[i].element.dispatchEvent(new Event('change', { bubbles: true }));
            inputs[i].element.dispatchEvent(new Event('blur', { bubbles: true }));
            successCount++;
            console.log(`✅ [诊断] 云阅卷(好分数) — ${inputs[i].label} 分数 ${scores[i]} 已填入`);
        }
        return successCount > 0;
    },

    // 旧接口兼容
    fillScore(request) {
        const { total } = request;
        return this.fillScores([total]);
    },

    submitGrade() {
        const submitBtn = document.querySelector(HAOFENSHUYIZE_SELECTORS.SUBMIT_BUTTON);
        if (submitBtn) {
            console.log('✅ [诊断] 云阅卷(好分数) — 点击提交按钮');
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
            console.log('✅ [诊断] 云阅卷(好分数) — 通过文本找到提交按钮');
            btn.click();
            return true;
        }
        console.warn('⚠️ [诊断] 云阅卷(好分数) — 未找到提交按钮');
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
                    console.log('✅ 云阅卷(好分数) — 新试卷已加载（图片变化）');
                    resolve(true);
                    return;
                }

                // 检测输入框被清空
                const scoreInput = document.querySelector(HAOFENSHUYIZE_SELECTORS.SCORE_INPUT);
                const inputCleared = scoreInput && (scoreInput.value === '' || scoreInput.value === '0');
                if (inputCleared && checkTimes > 3) {
                    clearInterval(timer);
                    console.log('✅ 云阅卷(好分数) — 新试卷已加载（输入框清空）');
                    resolve(true);
                    return;
                }

                if (checkTimes > 50) {
                    clearInterval(timer);
                    console.warn('⚠️ 云阅卷(好分数) — 等待下一份试卷超时');
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
