// ========== 粤教翔云智慧测评适配器 ==========
// rrtcp.gdedu.gov.cn — jQuery 传统页面
// 仅支持「题组批改」模式，批量批改模式会提示用户切换

const YuejiaoxiangyunAdapter = {
    name: '粤教翔云智慧测评',
    id: 'yuejiaoxiangyun',
    urlPatterns: ['*://rrtcp.gdedu.gov.cn/*'],
    iconUrl: '',

    shouldInitialize() {
        return window.location.hostname.includes('rrtcp.gdedu.gov.cn');
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器
    isMarkingPage() {
        const url = window.location.href;
        // 题组批改模式
        if (url.includes(YUEJIAOXIANGYUN_SELECTORS.MARKING_URL_PATTERN)) {
            return true;
        }
        return false;
    },

    async detectMarkingPage() {
        const url = window.location.href;

        // 批量批改模式：显示弹窗引导切换
        if (url.includes(YUEJIAOXIANGYUN_SELECTORS.BATCH_URL_PATTERN)) {
            console.log('[粤教翔云] 检测到批量批改模式，暂不支持');
            if (typeof ensureModalStyles === 'function') {
                ensureModalStyles();
                const overlay = document.createElement('div');
                overlay.className = 'ai-modal-overlay';
                overlay.innerHTML = `
                    <div class="ai-modal-card">
                        <div class="ai-modal-body">
                            <div style="font-size:20px;font-weight:bold;margin-bottom:12px;">⚠️ 暂不支持批量批改模式</div>
                            <div>请切换到「题组批改」模式使用 AI 批改助手</div>
                        </div>
                        <div class="ai-modal-footer">
                            <button class="ai-modal-btn-cancel">关闭（手动批改）</button>
                            <button class="ai-modal-btn-confirm">切换（自动跳转）</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(overlay);
                overlay.querySelector('.ai-modal-btn-cancel').onclick = () => overlay.remove();
                overlay.querySelector('.ai-modal-btn-confirm').onclick = () => {
                    window.location.href = url.replace(/QuickScore/gi, 'quick');
                };
            }
            return false;
        }

        // 题组批改模式检测
        if (!this.isMarkingPage()) {
            console.log('[粤教翔云] 当前不在题组批改页面');
            return false;
        }

        console.log('[粤教翔云] 开始检测批改页面...');
        try {
            const result = await Promise.race([
                waitForElement(YUEJIAOXIANGYUN_SELECTORS.PAGE_DETECT_IMAGE).then(() => 'answer-image'),
                waitForElement(YUEJIAOXIANGYUN_SELECTORS.PAGE_DETECT_INPUT).then(() => 'score-input'),
                waitForElement(YUEJIAOXIANGYUN_SELECTORS.PAGE_DETECT_SUBMIT).then(() => 'submit-btn'),
            ]).catch(() => null);

            if (result) {
                console.log(`[粤教翔云] 检测到批改页面元素: ${result}`);
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 3000));
            const hasImage = document.querySelector(YUEJIAOXIANGYUN_SELECTORS.ANSWER_IMAGE);
            const hasInput = document.querySelector(YUEJIAOXIANGYUN_SELECTORS.SCORE_INPUT);
            const hasBtn = document.querySelector(YUEJIAOXIANGYUN_SELECTORS.SUBMIT_BUTTON);
            const detected = !!(hasImage && hasInput && hasBtn);
            console.log(`[粤教翔云] 兜底检测 — 图片: ${!!hasImage}, 输入框: ${!!hasInput}, 提交: ${!!hasBtn}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('[粤教翔云] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        return window.location.href;
    },

    async gatherAnswerImages() {
        // 等待图片加载
        await new Promise(r => setTimeout(r, 1000));

        const images = document.querySelectorAll(YUEJIAOXIANGYUN_SELECTORS.ANSWER_IMAGE);
        const urls = [];

        images.forEach(img => {
            const src = img.src || img.getAttribute('data-src') || '';
            if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
                urls.push(src);
            }
        });

        console.log(`[粤教翔云] 找到答题卡图片: ${urls.length} 张`);
        return urls;
    },

    async fetchImageAsBase64(url) {
        // 腾讯云 COS 需要正确的 Referer 头，使用 GM_xmlhttpRequest 自定义请求
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'arraybuffer',
                headers: {
                    'Referer': window.location.href,
                },
                timeout: 30000,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const arrayBuffer = response.response;
                            if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                                throw new Error('下载的图片数据为空');
                            }
                            let binary = '';
                            const bytes = new Uint8Array(arrayBuffer);
                            const len = bytes.byteLength;
                            for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
                            resolve(window.btoa(binary));
                        } catch (e) {
                            reject(new Error('图片转换失败: ' + e.message));
                        }
                    } else {
                        reject(new Error(`图片下载失败，状态码: ${response.status}`));
                    }
                },
                onerror: () => reject(new Error('图片下载跨域请求被拒绝或网络断开')),
                ontimeout: () => reject(new Error('图片下载超时')),
            });
        });
    },

    getScoreInputs() {
        const inputs = [];

        // 主分数输入框
        const mainInput = document.querySelector(YUEJIAOXIANGYUN_SELECTORS.SCORE_INPUT)
            || document.querySelector(YUEJIAOXIANGYUN_SELECTORS.SCORE_INPUT_ALT);

        if (mainInput) {
            const maxScore = this._detectMaxScore();
            inputs.push({ element: mainInput, label: '总分', index: 0, maxScore });
        }

        return inputs;
    },

    fillScores(scores) {
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) return false;

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        let successCount = 0;

        for (let i = 0; i < Math.min(scores.length, inputs.length); i++) {
            if (scores[i] === null || scores[i] === undefined) continue;

            setter.call(inputs[i].element, scores[i]);
            inputs[i].element.dispatchEvent(new Event('input', { bubbles: true }));
            inputs[i].element.dispatchEvent(new Event('change', { bubbles: true }));
            inputs[i].element.dispatchEvent(new Event('blur', { bubbles: true }));
            successCount++;
        }

        return successCount > 0;
    },

    fillScore(request) {
        const { total } = request;
        const scoreInput = document.querySelector(YUEJIAOXIANGYUN_SELECTORS.SCORE_INPUT)
            || document.querySelector(YUEJIAOXIANGYUN_SELECTORS.SCORE_INPUT_ALT);

        if (scoreInput) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(scoreInput, total);
            scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
            scoreInput.dispatchEvent(new Event('change', { bubbles: true }));
            scoreInput.dispatchEvent(new Event('blur', { bubbles: true }));
            return true;
        }

        return false;
    },

    submitGrade() {
        const submitBtn = document.querySelector(YUEJIAOXIANGYUN_SELECTORS.SUBMIT_BUTTON);
        if (submitBtn) {
            submitBtn.click();
            console.log('[粤教翔云] 已点击确定按钮');
            return true;
        }

        // 备选查找
        const altBtn = document.querySelector('input.make_sure, .make_sure');
        if (altBtn) {
            altBtn.click();
            console.log('[粤教翔云] 已点击备选确定按钮');
            return true;
        }

        console.warn('[粤教翔云] 未找到提交按钮');
        return false;
    },

    async waitForNextPaper(oldImageUrl) {
        let checkTimes = 0;
        return new Promise((resolve) => {
            const timer = setInterval(() => {
                checkTimes++;

                // 检测图片变化
                const currentImg = document.querySelector(YUEJIAOXIANGYUN_SELECTORS.ANSWER_IMAGE);
                const currentUrl = currentImg ? currentImg.src : null;

                // 检测输入框清空
                const input = document.querySelector(YUEJIAOXIANGYUN_SELECTORS.SCORE_INPUT)
                    || document.querySelector(YUEJIAOXIANGYUN_SELECTORS.SCORE_INPUT_ALT);
                const inputCleared = input && (input.value === '' || input.value === '0');

                if (oldImageUrl && currentUrl && currentUrl !== oldImageUrl) {
                    clearInterval(timer);
                    console.log('[粤教翔云] 新试卷已加载（图片变化）');
                    resolve(true);
                } else if (inputCleared && checkTimes > 3) {
                    clearInterval(timer);
                    console.log('[粤教翔云] 新试卷已加载（输入框清空）');
                    resolve(true);
                } else if (checkTimes > 60) {
                    clearInterval(timer);
                    console.warn('[粤教翔云] 等待下一份试卷超时');
                    resolve(false);
                }
            }, 500);
        });
    },

    isRegradeMode() {
        const bodyText = document.body.innerText || '';
        if (bodyText.includes('回评') || bodyText.includes('复核')) {
            return true;
        }
        return !!window.aiGradingState?.isRegrading;
    },

    detectSubQuestions() {
        return [];
    },

    // ========== 内部辅助方法 ==========

    /**
     * 从 DOM 检测满分
     * 优先级：.fullScore[data-score] > .make_sure[qtotal] > .v3-homework-fast-score[data-score]
     */
    _detectMaxScore() {
        // 方式1: .fullScore 容器的 data-score 属性
        const fullScoreEl = document.querySelector(YUEJIAOXIANGYUN_SELECTORS.MAX_SCORE_CONTAINER);
        if (fullScoreEl) {
            const score = parseInt(fullScoreEl.getAttribute('data-score'));
            if (!isNaN(score) && score > 0) return score;
        }

        // 方式2: 确定按钮的 qtotal 属性
        const submitBtn = document.querySelector(YUEJIAOXIANGYUN_SELECTORS.SUBMIT_BUTTON);
        if (submitBtn) {
            const qtotal = parseInt(submitBtn.getAttribute('qtotal'));
            if (!isNaN(qtotal) && qtotal > 0) return qtotal;
        }

        // 方式3: 快速评分区域的 data-score 属性
        const quickScoreEl = document.querySelector('.v3-homework-fast-score');
        if (quickScoreEl) {
            const score = parseInt(quickScoreEl.getAttribute('data-score'));
            if (!isNaN(score) && score > 0) return score;
        }

        // 方式4: 从页面文字中提取（如"本题满分 5 分"）
        const textMatch = document.body.innerText.match(/满分\s*(\d+)\s*分/);
        if (textMatch) {
            return parseInt(textMatch[1]);
        }

        return 0;
    },
};

if (YuejiaoxiangyunAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = YuejiaoxiangyunAdapter;
}
