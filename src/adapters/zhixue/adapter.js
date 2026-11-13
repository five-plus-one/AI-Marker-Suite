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
            // ========== 新版微前端架构：等待iframe加载 ==========
            console.log('🔍 [调试] 等待iframe出现...');
            const iframe = await waitForElement('iframe', 10000).catch(() => null);

            if (iframe) {
                console.log('🔍 [调试] 找到iframe，等待内容加载...');

                // 等待iframe内容加载完成
                await new Promise((resolve) => {
                    // 检查是否已经加载完成
                    try {
                        if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
                            console.log('🔍 [调试] iframe已加载完成');
                            resolve();
                            return;
                        }
                    } catch (e) {
                        // 跨域情况下无法访问contentDocument
                    }

                    // 监听load事件
                    const onLoad = () => {
                        console.log('🔍 [调试] iframe onload事件触发');
                        iframe.removeEventListener('load', onLoad);
                        resolve();
                    };
                    iframe.addEventListener('load', onLoad);

                    // 超时保护（5秒）
                    setTimeout(() => {
                        console.log('🔍 [调试] iframe等待超时，继续检测');
                        iframe.removeEventListener('load', onLoad);
                        resolve();
                    }, 5000);
                });

                // 额外等待时间，确保iframe内部DOM完全渲染（增加到3秒）
                await new Promise(resolve => setTimeout(resolve, 3000));

                // 获取iframe文档
                const iframeDoc = this._getIframeDoc();
                if (iframeDoc) {
                    console.log('🔍 [调试] 成功获取iframe文档，开始检测元素...');

                    // 在iframe中检测元素
                    const hasInput = !!iframeDoc.querySelector('input[name="topicTxt"]') ||
                                   !!iframeDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_ALL_NEW) ||
                                   !!iframeDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_PLACEHOLDER) ||
                                   !!iframeDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT);
                    const hasButton = !!iframeDoc.querySelector(ZHIXUE_SELECTORS.SUBMIT_BUTTON_NEW) ||
                                     Array.from(iframeDoc.querySelectorAll('button')).some(btn => btn.textContent.includes('提交分数'));

                    console.log(`🔎 [诊断] iframe检测结果 — 输入框:${hasInput}, 按钮:${hasButton}`);

                    if (hasInput && hasButton) {
                        console.log('✅ [诊断] 在iframe中检测到批改页面元素');
                        return true;
                    }

                    // 如果第一次检测失败，再等待2秒后重试
                    console.log('🔍 [调试] 第一次检测未找到元素，等待2秒后重试...');
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    const hasInputRetry = !!iframeDoc.querySelector('input[name="topicTxt"]') ||
                                         !!iframeDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_ALL_NEW) ||
                                         !!iframeDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_PLACEHOLDER) ||
                                         !!iframeDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT);
                    const hasButtonRetry = !!iframeDoc.querySelector(ZHIXUE_SELECTORS.SUBMIT_BUTTON_NEW) ||
                                           Array.from(iframeDoc.querySelectorAll('button')).some(btn => btn.textContent.includes('提交分数'));

                    console.log(`🔎 [诊断] 重试检测结果 — 输入框:${hasInputRetry}, 按钮:${hasButtonRetry}`);

                    if (hasInputRetry && hasButtonRetry) {
                        console.log('✅ [诊断] 重试后在iframe中检测到批改页面元素');
                        return true;
                    }

                    // 打印iframe中的按钮信息（调试用）
                    const iframeButtons = Array.from(iframeDoc.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t);
                    console.log('🔍 [调试] iframe中的按钮:', iframeButtons.join(' | '));
                    const iframeInputs = Array.from(iframeDoc.querySelectorAll('input')).map(i => `type=${i.type},name=${i.name},placeholder=${i.placeholder}`);
                    console.log('🔍 [调试] iframe中的输入框:', iframeInputs.join(' | '));
                } else {
                    console.warn('⚠️ [诊断] 无法获取iframe文档（可能是跨域限制）');
                }
            } else {
                console.log('🔍 [调试] 未找到iframe，尝试在主页面检测...');
            }

            // ========== 兜底：在主页面检测 ==========
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 旧版兜底检测（主页面）
            const hasInputOld = document.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_PLACEHOLDER) || document.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT);
            const hasButtonOld = Array.from(document.querySelectorAll('button')).some(btn => btn.textContent.includes('提交') || btn.textContent.includes('分数'));
            // 新版兜底检测（主页面）
            const hasInputNew = document.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_NEW) || document.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_ALL_NEW);
            const hasButtonNew = !!document.querySelector(ZHIXUE_SELECTORS.SUBMIT_BUTTON_NEW);

            const detected = !!(hasInputOld && hasButtonOld) || !!(hasInputNew && hasButtonNew);
            console.log(`🔎 [诊断] 主页面兜底检测结果 — 旧版(输入框:${!!hasInputOld}, 按钮:${hasButtonOld}), 新版(输入框:${!!hasInputNew}, 按钮:${hasButtonNew}), 最终判断: ${detected}`);

            if (!detected) {
                console.warn('⚠️ [诊断] 未检测到批改页面，脚本将不会初始化。主页面按钮:', Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t).join(' | '));
            }
            return detected;
        } catch (error) {
            console.error('❌ [诊断] detectMarkingPage 抛出异常:', error);
            return false;
        }
    },

    _taskQuestions() {
        const doc = this._answerSnapshot().doc || this._getIframeDoc() || document;
        const label = element => element?.getAttribute('disptitle') || element?.closest('li')?.querySelector('.label')?.textContent;
        // 多小题的序号不是大题号；只有总分栏或唯一评分栏可补充顶部题号。
        const total = doc.querySelector('#containter_topicTxt #totalScore');
        const inputs = Array.from(doc.querySelectorAll('input[name="topicTxt"]')).filter(el => !el.getClientRects || el.getClientRects().length);
        const scoringQuestion = label(total) || (inputs.length === 1 ? label(inputs[0]) : '');
        const heading = doc.querySelector(ZHIXUE_SELECTORS.TOPIC_INDEX)?.textContent;
        const title = doc.querySelector(ZHIXUE_SELECTORS.TOPIC_TITLE);
        const normalize = value => {
            value = String(value || '').normalize('NFKC').trim();
            const number = value.match(/^(?:第\s*)?(\d+(?:\s*[-~～至、,，]\s*\d+)*)(?:\s*题)?$/);
            return number ? `第${number[1].replace(/\s/g, '')}题` : value;
        };
        return { heading: normalize(heading), scoring: normalize(scoringQuestion),
            question: normalize(heading || scoringQuestion || title?.getAttribute('title') || title?.textContent) };
    },

    getGradingTaskIdentifier() {
        const { question, heading, scoring } = this._taskQuestions();
        // 组件重载时只剩页面地址，不能把题号暂不可读解释为切题。
        if (!question) return '';
        // 顶部与评分栏任一明确变题即停止，覆盖两者先后更新的过渡窗口。
        const identity = heading && scoring && heading !== scoring ? `${heading}|${scoring}` : question;
        return this._getActualPath() + window.location.hash.split('&_t=')[0] + '___' + identity;
    },

    getTaskIdentifier() {
        // 使用实际路径（新版SPA从 app-1 参数解码）
        const actualPath = this._getActualPath();
        const baseUrl = actualPath + window.location.hash.split('&_t=')[0];
        const questionIdentifier = this._taskQuestions().question;
        return baseUrl + (questionIdentifier ? '___' + questionIdentifier : '');
    },

    getQuestionContext() {
        const doc = this._answerSnapshot().doc || this._getIframeDoc() || document;
        const inputs = this.getScoreInputs();
        if (!inputs.length) return null;
        // 评分栏大题总分框前的题号优先；顶部题号作兼容回退。
        const total = doc.querySelector('#containter_topicTxt #totalScore');
        const question = total?.getAttribute('disptitle') || total?.closest('li')?.querySelector('.label')?.textContent ||
            doc.querySelector(ZHIXUE_SELECTORS.TOPIC_INDEX)?.textContent;
        if (!question?.trim()) return null;
        const normalize = value => String(value || '').normalize('NFKC').replace(/\s/g, '').replace(/^第|题$/g, '');
        const heading = doc.querySelector(ZHIXUE_SELECTORS.TOPIC_INDEX)?.textContent;
        if (heading?.trim() && normalize(heading) !== normalize(question)) return null;
        if (inputs.some(input => input.element?.getClientRects && !input.element.getClientRects().length)) return null;
        const units = inputs.map(input => {
            const el = input.element;
            const label = el?.getAttribute('disptitle') || el?.closest('li')?.querySelector('.label')?.textContent;
            const maxScore = Number(el?.getAttribute('score')) || Number(el?.placeholder?.match(/满分\s*(\d+(?:\.\d+)?)/)?.[1]) || 0;
            return { label: label?.trim() || (inputs.length === 1 ? question.trim() : ''), maxScore };
        });
        return { question: question.trim().replace(/^第\s*|\s*题$/g, ''), units };
    },

    _answerResourceKey(src) {
        if (typeof src !== 'string' || !src.trim()) return null;
        // 增强图直接显示为内嵌 PNG；摘要只用于比对，取图始终保留完整字节。
        if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(src)) {
            let a = 2166136261, b = 5381;
            for (let i = 0; i < src.length; i++) {
                a = Math.imul(a ^ src.charCodeAt(i), 16777619);
                b = Math.imul(b, 33) ^ src.charCodeAt(i);
            }
            return `zhixue:inline:${src.length}:${a >>> 0}:${b >>> 0}`;
        }
        try {
            const url = new URL(src, window.location.href);
            if (!/^https?:$/.test(url.protocol)) return null;
            // crop 决定答题区域；签名、缩放和亮度等显示变换不决定作答来源。
            const crops = (url.searchParams.get('x-oss-process') || '').split('/').filter(op => /^crop(?:,|$)/.test(op));
            if (crops.length) url.searchParams.set('x-oss-process', 'image/' + crops.join('/'));
            else url.searchParams.delete('x-oss-process');
            for (const key of [...url.searchParams.keys()]) {
                if (/^(?:Expires|OSSAccessKeyId|Signature|Policy|Key-Pair-Id|x-amz-(?:algorithm|credential|date|expires|signedheaders|signature|security-token))$/i.test(key)) url.searchParams.delete(key);
            }
            url.hash = ''; url.searchParams.sort();
            return url.href;
        } catch (_) { return null; }
    },

    _nativeImageState(image) {
        // 只读取当前图片所属的阅卷组件，不使用预加载的 nextTopicInfo/nextCatchImage。
        for (let el = image; el; el = el.parentElement) {
            const state = el.__vue__?.$data;
            if (Array.isArray(state?.topicImageIds) && state.topicImageIds.length) return state;
        }
        return null;
    },

    _answerSnapshot() {
        const mainDoc = typeof unsafeWindow !== 'undefined' ? unsafeWindow.document : document;
        let iframeDoc;
        try {
            const iframe = mainDoc.querySelector('iframe');
            const visible = !iframe?.getClientRects || iframe.getClientRects().length > 0;
            const style = iframe?.ownerDocument?.defaultView?.getComputedStyle(iframe);
            if (visible && style?.visibility !== 'hidden' && style?.display !== 'none') iframeDoc = iframe?.contentDocument || iframe?.contentWindow?.document;
        } catch (_) { /* 跨域 iframe 不可读时仍检查主页面。 */ }
        for (const doc of [iframeDoc, mainDoc].filter(Boolean)) {
            let images = [];
            for (const selector of [ZHIXUE_SELECTORS.ANSWER_IMAGE, ZHIXUE_SELECTORS.ANSWER_IMAGE_NEW]) {
                images = Array.from(doc.querySelectorAll(selector)).filter(image => {
                    if (!image.src || (image.getClientRects && !image.getClientRects().length)) return false;
                    const style = image.ownerDocument?.defaultView?.getComputedStyle(image);
                    return !style || (style.visibility !== 'hidden' && style.display !== 'none');
                });
                if (images.length) break;
            }
            if (!images.length) continue;
            const urls = [...new Set(images.map(image => image.src))];
            const native = this._nativeImageState(images[0]);
            const nativeKeys = native?.topicImageIds.map(source => this._answerResourceKey(source));
            const keys = images.map((image, index) => {
                if (native && image.src.startsWith('data:')) {
                    // 不同学生的空白区域可能生成完全相同的 PNG；按当前题块的对应来源核对，
                    // 不能因历史缓存中另有相同内容就拒绝当前答卷。
                    const expected = nativeKeys[index];
                    return expected && Object.entries(native.catchImage || {}).some(([source, value]) =>
                        value === image.src && this._answerResourceKey(source) === expected) ? expected : null;
                }
                // 普通 DOM 回退按元素缓存摘要，避免轮询重复扫描大幅增强图。
                this._imageKeys ||= new WeakMap();
                const cached = this._imageKeys.get(image);
                if (cached?.src === image.src) return cached.key;
                const key = this._answerResourceKey(image.src);
                this._imageKeys.set(image, { src: image.src, key });
                return key;
            });
            const matchesNative = !native || (nativeKeys.length === keys.length && keys.every((key, i) => key && key === nativeKeys[i]
                && this._nativeImageState(images[i]) === native));
            return { doc, urls, keys, ready: matchesNative && images.every(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0),
                identity: keys.every(Boolean) ? 'zhixue:images:' + JSON.stringify([...new Set(keys)].sort()) : null };
        }
        return { urls: [], keys: [], ready: false, identity: null };
    },

    getPaperIdentity() {
        // 使用整组作答资源标识；平台未暴露可信原生ID时不猜测DOM字段。
        const snapshot = this._answerSnapshot();
        return snapshot.ready ? snapshot.identity : null;
    },

    async gatherAnswerImages() {
        let previous = null;
        for (let count = 0; count < 125; count++) {
            if (window.aiGradingState?.abortController?.signal.aborted) return [];
            const snapshot = this._answerSnapshot();
            if (snapshot.ready && snapshot.identity && previous === snapshot.identity) return snapshot.urls;
            previous = snapshot.ready ? snapshot.identity : null;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return [];
    },

    async fetchImageAsBase64(url, signal = window.aiGradingState?.abortController?.signal) {
        if (signal?.aborted || window.aiGradingState?.isPaused) throw new Error('用户主动暂停');
        if (url.startsWith('data:')) {
            const match = url.match(/^data:image\/(?:png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+=*)$/);
            if (!match) throw new Error('答题卡图片格式无效，请重新加载后继续');
            return match[1];
        }
        return fetchImageAsBase64(url, signal);
    },

    _scoreMaximum(element) {
        const values = [Number(element?.getAttribute('score')), Number(element?.placeholder?.match(/满分\s*(\d+(?:\.\d+)?)/)?.[1])];
        return values.find(value => Number.isFinite(value) && value > 0) || 0;
    },

    prepareGrading() {
        this.lastFillError = '';
        const inputs = this.getScoreInputs();
        const maxima = inputs.map(({ element }) => {
            if (!element || (element.getClientRects && !element.getClientRects().length)) return 0;
            return this._scoreMaximum(element);
        });
        const configured = Number(PresetManager.getMaxScore());
        if (maxima.length && maxima.every(max => Number.isFinite(max) && max > 0) && configured > 0) {
            const total = maxima.reduce((sum, max) => sum + max, 0);
            if (Math.abs(total - configured) > 1e-6) {
                this.lastFillError = `当前题目满分为${total}分，批改方案为${configured}分，请核对后继续`;
                return false;
            }
        }
        return true;
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

    async waitForNextPaper(oldImageUrl, context = {}) {
        let checkTimes = 0;
        let candidate = null, stableChecks = 0;
        const oldKey = this._answerResourceKey(oldImageUrl);
        if (!context.paperId && !oldKey) return false;
        let oldKeys = oldKey ? [oldKey] : [];
        if (context.paperId?.startsWith('zhixue:images:')) {
            try { oldKeys = JSON.parse(context.paperId.slice('zhixue:images:'.length)); } catch (_) { return false; }
            if (!Array.isArray(oldKeys) || !oldKeys.length || !oldKeys.every(key => typeof key === 'string')) return false;
        }
        return new Promise((resolve) => {
            const finish = value => {
                clearInterval(checkNextTimer);
                context.signal?.removeEventListener('abort', abort);
                resolve(value);
            };
            const abort = () => finish(false);
            const checkNextTimer = setInterval(() => {
                checkTimes++;
                const taskId = this.getGradingTaskIdentifier();
                if (context.signal?.aborted || (context.taskId && taskId && taskId !== context.taskId)) return finish(false);
                const snapshot = this._answerSnapshot();
                const changed = snapshot.ready && snapshot.identity && !snapshot.keys.some(key => oldKeys.includes(key)) && (context.paperId
                    ? snapshot.identity !== context.paperId
                    : !snapshot.keys.includes(oldKey));
                if (changed) {
                    stableChecks = candidate === snapshot.identity ? stableChecks + 1 : 1;
                    candidate = snapshot.identity;
                    if (stableChecks >= 2) return finish(true);
                } else { candidate = null; stableChecks = 0; }
                if (checkTimes >= 125) finish(false);
            }, 200);
            context.signal?.addEventListener('abort', abort, { once: true });
            if (context.signal?.aborted) finish(false);
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
                const maxScore = this._scoreMaximum(el);
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
                const maxScore = this._scoreMaximum(el);
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
            const maxScore = this._scoreMaximum(scoreInputOld);
            inputs.push({ element: scoreInputOld, label: '总分', index: 0, maxScore });
            console.log(`📋 [诊断] 旧版总分输入框 (在${iframeDoc ? 'iframe' : '主页面'})`);
            return inputs;
        }

        // 新版总分输入框
        const scoreInputNew = searchDoc.querySelector(ZHIXUE_SELECTORS.SCORE_INPUT_ALL_NEW);
        if (scoreInputNew) {
            const maxScore = this._scoreMaximum(scoreInputNew);
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

        // 数据安全：两遍式全或无（#296，模板=guangda #275）——先全量校验，
        // 任一缺失/错位即整体拒绝，全部命中才写入，不留半填状态
        if (scores.length > inputs.length) {
            console.warn(`⚠️ [智学网] 分数个数(${scores.length})多于输入框数(${inputs.length})（配置错位）→ 拒绝`);
            return false;
        }
        for (let i = 0; i < inputs.length; i++) {
            if (scores[i] === null || scores[i] === undefined) {
                console.warn(`⚠️ [智学网] ${inputs[i].label} 无 AI 分数（第 ${i + 1} 题缺失）→ 拒绝`);
                return false;
            }
        }

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        for (let i = 0; i < inputs.length; i++) {
            const input = inputs[i];
            setter.call(input.element, scores[i]);
            input.element.dispatchEvent(new Event('input', { bubbles: true }));
            input.element.dispatchEvent(new Event('change', { bubbles: true }));
            input.element.dispatchEvent(new Event('blur', { bubbles: true }));
            console.log(`✅ [诊断] ${input.label} 分数 ${scores[i]} 已填入`);
        }
        return true;
    },

    detectSubQuestions() {
        const subs = [];
        document.querySelectorAll('#containter_topicTxt li').forEach((li, i) => {
            const input = li.querySelector('input[name="topicTxt"]');
            if (!input) return;
            const labelEl = li.querySelector('.label');
            const label = labelEl?.textContent?.trim() || `第${i + 1}题`;
            const maxScore = this._scoreMaximum(input);
            subs.push({ label, element: input, index: i, maxScore });
        });
        // 只有一题时不启用分小题给分
        return subs.length > 1 ? subs : [];
    }
};

if (ZhixueAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = ZhixueAdapter;
}
