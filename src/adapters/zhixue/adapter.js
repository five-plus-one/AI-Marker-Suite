// ========== 智学网适配器 ==========
// 实现 PlatformAdapter 接口，处理智学网平台特定的 DOM 交互

const ZhixueAdapter = {
    name: '智学网',
    id: 'zhixue',
    urlPatterns: ['https://www.zhixue.com/*', 'https://zhixue.com/*', 'https://*.zhixue.com/*'],
    iconUrl: 'https://www.zhixue.com/favicon.ico',

    // 辅助方法：检测当前是否为新版UI
    _isNewUI() {
        return !!document.querySelector(ZHIXUE_SELECTORS.ANSWER_IMAGE_NEW)
            || !!document.querySelector(ZHIXUE_SELECTORS.SUBMIT_BUTTON_NEW)
            || !!document.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_ALL_NEW);
    },

    // 辅助方法：获取iframe内部的document（新版微前端架构）
    _getIframeDoc() {
        const iframe = document.querySelector('iframe');
        if (!iframe) {
            console.log('🔍 [调试] 未找到iframe');
            return null;
        }
        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            if (iframeDoc) {
                console.log('🔍 [调试] 成功获取iframe文档');
            }
            return iframeDoc;
        } catch (e) {
            console.warn('⚠️ [调试] 无法访问iframe内容:', e.message);
            return null;
        }
    },

    // 辅助方法：检测当前URL是否为阅卷页面（支持新版SPA结构）
    _isMarkingUrl() {
        console.log('🔍 [调试] _isMarkingUrl() 开始检测');
        console.log('🔍 [调试] pathname:', window.location.pathname);
        console.log('🔍 [调试] search:', window.location.search);

        // 旧版：pathname 直接包含 /webmarking/
        if (window.location.pathname.includes('/webmarking/')) {
            console.log('✅ [调试] 旧版URL检测成功（pathname包含/webmarking/）');
            return true;
        }

        // 新版：阅卷路径编码在 app-N 参数中（双重URL编码，N为动态数字）
        const searchParams = new URLSearchParams(window.location.search);
        const appEntry = Array.from(searchParams.entries())
            .find(([key]) => /^app-\d+$/.test(key));
        const appParam = appEntry ? appEntry[1] : null;
        const paramName = appEntry ? appEntry[0] : 'app-N';
        console.log('🔍 [调试] app-N 参数:', appParam ? `存在 (${paramName})` : '不存在');

        if (appParam) {
            console.log('🔍 [调试] 原始值:', appParam);
            try {
                const decoded1 = decodeURIComponent(appParam);
                console.log('🔍 [调试] 第一次解码:', decoded1);
                const decoded2 = decodeURIComponent(decoded1);
                console.log('🔍 [调试] 第二次解码:', decoded2);
                const hasWebmarking = decoded2.includes('/webmarking/');
                console.log('🔍 [调试] 是否包含 /webmarking/:', hasWebmarking);
                if (hasWebmarking) {
                    console.log('✅ [调试] 新版URL检测成功（app-N参数包含/webmarking/）');
                }
                return hasWebmarking;
            } catch (e) {
                console.error('❌ [调试] 解码失败:', e);
                return false;
            }
        }

        console.log('❌ [调试] 未检测到阅卷URL');
        return false;
    },

    // 辅助方法：获取实际的阅卷路径（新版从 app-N 参数解码）
    _getActualPath() {
        // 旧版：直接使用 pathname
        if (window.location.pathname.includes('/webmarking/')) {
            return window.location.pathname;
        }
        // 新版：从 app-N 参数解码（N为动态数字）
        const searchParams = new URLSearchParams(window.location.search);
        const appEntry = Array.from(searchParams.entries())
            .find(([key]) => /^app-\d+$/.test(key));
        const appParam = appEntry ? appEntry[1] : null;
        if (appParam) {
            try {
                return decodeURIComponent(decodeURIComponent(appParam));
            } catch (e) {
                return window.location.pathname;
            }
        }
        return window.location.pathname;
    },

    shouldInitialize() {
        // 在整个智学网域名上都初始化，以便在首页也能使用油猴菜单
        return window.location.hostname.includes('zhixue.com');
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器
    isMarkingPage() {
        return this._isMarkingUrl();
    },

    async detectMarkingPage() {
        // 只在阅卷路径下才进行详细检测
        if (!this._isMarkingUrl()) {
            console.log('🔎 [诊断] 智学网 — 当前不在阅卷页面 (pathname:', window.location.pathname, ')');
            return false;
        }

        console.log('🔎 [诊断] 智学网 — 开始检测批改页面元素...');
        try {
            // 获取iframe文档（新版微前端架构）
            const iframeDoc = this._getIframeDoc();
            const searchDoc = iframeDoc || document;
            console.log('🔍 [调试] 检测目标:', iframeDoc ? 'iframe内部' : '主页面');

            // 同时检测新旧版本元素（在主页面和iframe中都检测）
            const result = await Promise.race([
                // 旧版检测（主页面）
                waitForElement(ZHIXUE_SELECTORS.PAGE_DETECT_IMAGE).then(() => 'topicImg(旧版-主页面)'),
                waitForElement(ZHIXUE_SELECTORS.PAGE_DETECT_INPUT).then(() => 'score-input(旧版-主页面)'),
                waitForElement('button:contains("提交分数")').then(() => 'submit-btn(旧版-主页面)'),
                // 新版检测（主页面）
                waitForElement(ZHIXUE_SELECTORS.PAGE_DETECT_IMAGE_NEW).then(() => 'answerImg(新版-主页面)'),
                waitForElement(ZHIXUE_SELECTORS.PAGE_DETECT_BUTTON_NEW).then(() => 'submitBtn(新版-主页面)'),
                waitForElement(ZHIXUE_SELECTORS.SCORE_INPUT_ALL_NEW).then(() => 'scoreAll(新版-主页面)'),
                // 新版检测（iframe内部）
                ...(iframeDoc ? [
                    waitForElement(ZHIXUE_SELECTORS.PAGE_DETECT_IMAGE_NEW, iframeDoc).then(() => 'answerImg(新版-iframe)'),
                    waitForElement(ZHIXUE_SELECTORS.PAGE_DETECT_BUTTON_NEW, iframeDoc).then(() => 'submitBtn(新版-iframe)'),
                    waitForElement(ZHIXUE_SELECTORS.SCORE_INPUT_ALL_NEW, iframeDoc).then(() => 'scoreAll(新版-iframe)'),
                    waitForElement(ZHIXUE_SELECTORS.SCORE_INPUT_NEW, iframeDoc).then(() => 'scoreInput(新版-iframe)'),
                ] : []),
            ]).catch(() => null);
            if (result) {
                console.log(`✅ [诊断] 检测到批改页面元素: ${result}`);
                return true;
            }

            await new Promise(resolve => setTimeout(resolve, 3000));
            // 旧版兜底检测（主页面）
            const hasInputOld = document.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_PLACEHOLDER) || document.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT);
            const hasButtonOld = Array.from(document.querySelectorAll('button')).some(btn => btn.textContent.includes('提交') || btn.textContent.includes('分数'));
            // 新版兜底检测（主页面）
            const hasInputNew = document.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_NEW) || document.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_ALL_NEW);
            const hasButtonNew = !!document.querySelector(ZHIXUE_SELECTORS.SUBMIT_BUTTON_NEW);
            // 新版兜底检测（iframe内部）
            let hasInputIframe = false;
            let hasButtonIframe = false;
            if (iframeDoc) {
                hasInputIframe = !!iframeDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_NEW) ||
                               !!iframeDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_ALL_NEW) ||
                               !!iframeDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_PLACEHOLDER);
                hasButtonIframe = !!iframeDoc.querySelector(ZHIXUE_SELECTORS.SUBMIT_BUTTON_NEW) ||
                                 Array.from(iframeDoc.querySelectorAll('button')).some(btn => btn.textContent.includes('提交分数'));
            }

            const detected = !!(hasInputOld && hasButtonOld) || !!(hasInputNew && hasButtonNew) || !!(hasInputIframe && hasButtonIframe);
            console.log(`🔎 [诊断] 兜底检测结果 — 旧版(输入框:${!!hasInputOld}, 按钮:${hasButtonOld}), 新版主页面(输入框:${!!hasInputNew}, 按钮:${hasButtonNew}), 新版iframe(输入框:${hasInputIframe}, 按钮:${hasButtonIframe}), 最终判断: ${detected}`);
            if (!detected) {
                console.warn('⚠️ [诊断] 未检测到批改页面，脚本将不会初始化。主页面按钮:', Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t).join(' | '));
                if (iframeDoc) {
                    console.warn('⚠️ [诊断] iframe按钮:', Array.from(iframeDoc.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t).join(' | '));
                }
            }
            return detected;
        } catch (error) {
            console.error('❌ [诊断] detectMarkingPage 抛出异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // 使用实际路径（新版SPA从 app-1 参数解码）
        const actualPath = this._getActualPath();
        const baseUrl = actualPath + window.location.hash.split('&_t=')[0];
        let questionIdentifier = '';
        try {
            const exactElement = document.querySelector(ZHIXUE_SELECTORS.TOPIC_INDEX);
            if (exactElement && exactElement.textContent) {
                questionIdentifier = exactElement.textContent.trim();
            } else {
                const titleElement = document.querySelector(ZHIXUE_SELECTORS.TOPIC_TITLE);
                if (titleElement) {
                    questionIdentifier = titleElement.getAttribute('title') || titleElement.textContent.trim();
                }
            }
        } catch (e) {}
        return baseUrl + (questionIdentifier ? '___' + questionIdentifier : '');
    },

    async gatherAnswerImages() {
        // 获取iframe文档（新版微前端架构）
        const iframeDoc = this._getIframeDoc();
        const searchDoc = iframeDoc || document;

        // 先尝试旧版选择器
        let imgElements = searchDoc.querySelectorAll(ZHIXUE_SELECTORS.ANSWER_IMAGE);
        if (imgElements.length > 0) {
            console.log(`🖼️ [诊断] 旧版选择器找到答题卡图片数量: ${imgElements.length} (在${iframeDoc ? 'iframe' : '主页面'})`);
            return Array.from(imgElements).map(img => img.src);
        }
        // 再尝试新版选择器
        imgElements = searchDoc.querySelectorAll(ZHIXUE_SELECTORS.ANSWER_IMAGE_NEW);
        if (imgElements.length > 0) {
            console.log(`🖼️ [诊断] 新版选择器找到答题卡图片数量: ${imgElements.length} (在${iframeDoc ? 'iframe' : '主页面'})`);
            return Array.from(imgElements).map(img => img.src);
        }
        // 如果iframe中没找到，也检查主页面
        if (iframeDoc) {
            imgElements = document.querySelectorAll(ZHIXUE_SELECTORS.ANSWER_IMAGE) || document.querySelectorAll(ZHIXUE_SELECTORS.ANSWER_IMAGE_NEW);
            if (imgElements.length > 0) {
                console.log(`🖼️ [诊断] 主页面找到答题卡图片数量: ${imgElements.length}`);
                return Array.from(imgElements).map(img => img.src);
            }
        }
        console.warn('⚠️ [诊断] 未找到答题卡图片');
        return [];
    },

    async fetchImageAsBase64(url) {
        return fetchImageAsBase64(url);
    },

    fillScore(request) {
        const { total, subScores } = request;

        // 分小题填入
        if (subScores && subScores.length > 0) {
            const detected = this.detectSubQuestions();
            if (detected.length > 0) {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                for (const sq of subScores) {
                    const target = detected.find(d =>
                        d.label === sq.label || sq.label.includes(d.label) || d.label.includes(sq.label)
                    );
                    if (target && sq.score !== null) {
                        setter.call(target.element, sq.score);
                        target.element.dispatchEvent(new Event('input', { bubbles: true }));
                        target.element.dispatchEvent(new Event('change', { bubbles: true }));
                        target.element.dispatchEvent(new Event('blur', { bubbles: true }));
                        console.log(`✅ [诊断] 小题 ${sq.label} 分数 ${sq.score} 已填入`);
                    }
                }
                return true;
            }
        }

        // 回退：填总分到分数输入框
        const allInputs = document.querySelectorAll('input');
        console.log(`🔎 [诊断] fillScore 调用 — 分数: ${total}, 页面上所有input数量: ${allInputs.length}`);

        // 优先使用 placeholder 包含"分"的选择器（更精确），避免误匹配批阅份数等无关输入框
        const scoreInput = document.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_PLACEHOLDER) ||
                           Array.from(document.querySelectorAll('input[type="text"]')).find(i => i.placeholder?.includes('分') || i.name?.includes('score')) ||
                           document.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT);

        if (scoreInput) {
            console.log(`✅ [诊断] 找到分数输入框: type=${scoreInput.type} placeholder=${scoreInput.placeholder} name=${scoreInput.name}`);
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(scoreInput, total);
            scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
            scoreInput.dispatchEvent(new Event('change', { bubbles: true }));
            scoreInput.dispatchEvent(new Event('blur', { bubbles: true }));
            console.log(`✅ [诊断] 分数已填入`);
            return true;
        } else {
            console.warn('⚠️ [诊断] 未找到分数输入框');
            return false;
        }
    },

    submitGrade() {
        // 获取iframe文档（新版微前端架构）
        const iframeDoc = this._getIframeDoc();
        const searchDoc = iframeDoc || document;
        const allBtns = Array.from(searchDoc.querySelectorAll('button'));
        console.log(`🔎 [诊断] submitGrade — 按钮总数: ${allBtns.length} (在${iframeDoc ? 'iframe' : '主页面'})，文字列表: ${allBtns.map(b => b.textContent.trim()).filter(t => t).join(' | ')}`);

        // 先尝试旧版：通过文字匹配
        const submitBtnOld = allBtns.find(btn => btn.textContent.includes(ZHIXUE_SELECTORS.SUBMIT_BUTTON_TEXT));
        if (submitBtnOld) {
            console.log(`✅ [诊断] 旧版找到"提交分数"按钮，准备点击`);
            submitBtnOld.click();
            return true;
        }

        // 再尝试新版：通过选择器
        const submitBtnNew = searchDoc.querySelector(ZHIXUE_SELECTORS.SUBMIT_BUTTON_NEW);
        if (submitBtnNew) {
            console.log(`✅ [诊断] 新版找到"提交分数"按钮，准备点击`);
            submitBtnNew.click();
            return true;
        }

        // 如果iframe中没找到，也检查主页面
        if (iframeDoc) {
            const mainBtns = Array.from(document.querySelectorAll('button'));
            const submitBtnMain = mainBtns.find(btn => btn.textContent.includes(ZHIXUE_SELECTORS.SUBMIT_BUTTON_TEXT)) ||
                                 document.querySelector(ZHIXUE_SELECTORS.SUBMIT_BUTTON_NEW);
            if (submitBtnMain) {
                console.log(`✅ [诊断] 主页面找到"提交分数"按钮，准备点击`);
                submitBtnMain.click();
                return true;
            }
        }

        console.warn(`⚠️ [诊断] 未找到"提交分数"按钮`);
        return false;
    },

    async waitForNextPaper(oldImageUrl) {
        let checkTimes = 0;
        // 获取iframe文档（新版微前端架构）
        const iframeDoc = this._getIframeDoc();
        const searchDoc = iframeDoc || document;

        return new Promise((resolve) => {
            const checkNextTimer = setInterval(() => {
                checkTimes++;

                // 检测1：图片 src 变化（旧版）
                const currentImgOld = searchDoc.querySelector(ZHIXUE_SELECTORS.ANSWER_IMAGE);
                if (currentImgOld && currentImgOld.src !== oldImageUrl) {
                    clearInterval(checkNextTimer);
                    console.log('✅ 新试卷已加载完毕（旧版图片变化）');
                    resolve(true);
                    return;
                }

                // 检测1b：图片 src 变化（新版）
                const currentImgNew = searchDoc.querySelector(ZHIXUE_SELECTORS.ANSWER_IMAGE_NEW);
                if (currentImgNew && currentImgNew.src !== oldImageUrl) {
                    clearInterval(checkNextTimer);
                    console.log('✅ 新试卷已加载完毕（新版图片变化）');
                    resolve(true);
                    return;
                }

                // 检测2：分数输入框被清空（新试卷加载时平台会重置输入框）
                // 旧版输入框
                const scoreInputOld = searchDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_PLACEHOLDER) ||
                                   searchDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT);
                const inputClearedOld = scoreInputOld && (scoreInputOld.value === '' || scoreInputOld.value === '0');
                // 新版输入框
                const scoreInputNew = searchDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_ALL_NEW) ||
                                   searchDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_NEW);
                const inputClearedNew = scoreInputNew && (scoreInputNew.value === '' || scoreInputNew.value === '0');

                if ((inputClearedOld || inputClearedNew) && checkTimes > 3) {
                    clearInterval(checkNextTimer);
                    console.log('✅ 新试卷已加载完毕（输入框清空）');
                    resolve(true);
                    return;
                }

                if (checkTimes > 50) {
                    clearInterval(checkNextTimer);
                    console.warn('⚠️ 等待下一份试卷超时');
                    resolve(false);
                }
            }, 200);
        });
    },

    isRegradeMode() {
        return !!sessionStorage.getItem('ai-grading-regrade') || !!window.aiGradingState.isRegrading;
    },

    getScoreInputs() {
        const inputs = [];
        // 获取iframe文档（新版微前端架构）
        const iframeDoc = this._getIframeDoc();
        const searchDoc = iframeDoc || document;

        // ========== 旧版：分小题输入框 ==========
        const subInputsOld = searchDoc.querySelectorAll('#containter_topicTxt input[name="topicTxt"]');
        if (subInputsOld.length > 0) {
            subInputsOld.forEach((el, i) => {
                const labelEl = el.closest('li')?.querySelector('.label');
                const label = labelEl?.textContent?.trim() || `第${i + 1}题`;
                const maxScore = parseInt(el.getAttribute('score')) || parseInt(el.placeholder?.match(/\d+/)?.[0]) || 0;
                inputs.push({ element: el, label, index: i, maxScore });
            });
            console.log(`📋 [诊断] 旧版小题输入框: ${inputs.length} 个 (在${iframeDoc ? 'iframe' : '主页面'})`);
            return inputs;
        }

        // ========== 新版：分小题输入框 ==========
        // 新版UI中小题输入框的 name 也是 "topicTxt"，但不在 #containter_topicTxt 容器内
        const subInputsNew = searchDoc.querySelectorAll('input[name="topicTxt"]');
        if (subInputsNew.length > 0) {
            subInputsNew.forEach((el, i) => {
                const maxScore = parseInt(el.getAttribute('score')) || parseInt(el.placeholder?.match(/\d+/)?.[0]) || 0;
                inputs.push({ element: el, label: `第${i + 1}题`, index: i, maxScore });
            });
            console.log(`📋 [诊断] 新版小题输入框: ${inputs.length} 个 (在${iframeDoc ? 'iframe' : '主页面'})`);
            return inputs;
        }

        // ========== 回退：总分输入框 ==========
        // 优先使用 placeholder 匹配，避免误匹配批阅份数等输入框
        const scoreInputOld = searchDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_PLACEHOLDER) ||
                           searchDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT);
        if (scoreInputOld) {
            const maxScore = parseInt(scoreInputOld.getAttribute('score')) || parseInt(scoreInputOld.placeholder?.match(/\d+/)?.[0]) || 0;
            inputs.push({ element: scoreInputOld, label: '总分', index: 0, maxScore });
            console.log(`📋 [诊断] 旧版总分输入框 (在${iframeDoc ? 'iframe' : '主页面'})`);
            return inputs;
        }

        // 新版总分输入框
        const scoreInputNew = searchDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_ALL_NEW);
        if (scoreInputNew) {
            const maxScore = parseInt(scoreInputNew.getAttribute('score')) || parseInt(scoreInputNew.placeholder?.match(/\d+/)?.[0]) || 0;
            inputs.push({ element: scoreInputNew, label: '总分', index: 0, maxScore });
            console.log(`📋 [诊断] 新版总分输入框 (在${iframeDoc ? 'iframe' : '主页面'})`);
            return inputs;
        }

        console.warn('⚠️ [诊断] 未找到任何分数输入框');
        return inputs;
    },

    fillScores(scores) {
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        let successCount = 0;
        for (let i = 0; i < Math.min(scores.length, inputs.length); i++) {
            if (scores[i] === null || scores[i] === undefined) continue;
            const input = inputs[i];
            setter.call(input.element, scores[i]);
            input.element.dispatchEvent(new Event('input', { bubbles: true }));
            input.element.dispatchEvent(new Event('change', { bubbles: true }));
            input.element.dispatchEvent(new Event('blur', { bubbles: true }));
            successCount++;
            console.log(`✅ [诊断] ${input.label} 分数 ${scores[i]} 已填入`);
        }
        return successCount > 0;
    },

    detectSubQuestions() {
        const subs = [];
        document.querySelectorAll('#containter_topicTxt li').forEach((li, i) => {
            const input = li.querySelector('input[name="topicTxt"]');
            if (!input) return;
            const labelEl = li.querySelector('.label');
            const label = labelEl?.textContent?.trim() || `第${i + 1}题`;
            const maxScore = parseInt(input.getAttribute('score')) || parseInt(input.placeholder?.match(/\d+/)?.[0]) || 0;
            subs.push({ label, element: input, index: i, maxScore });
        });
        // 只有一题时不启用分小题给分
        return subs.length > 1 ? subs : [];
    }
};

if (ZhixueAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = ZhixueAdapter;
}
