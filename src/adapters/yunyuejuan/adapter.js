// ========== 云阅卷适配器 ==========
// 实现 PlatformAdapter 接口，处理云阅卷平台特定的 DOM 交互
// 平台特征：jQuery 1.11.3，传统页面，分小题输入框

const YunyuejuanAdapter = {
    name: '云阅卷',
    id: 'yunyuejuan',
    urlPatterns: ['*://*/Marking/*'],
    iconUrl: '',

    shouldInitialize() {
        // ① 部署域白名单（strict-a 附 A.4；与产品方收集后回填，为空时走 ②）
        //    hostMatches 精确姿势（endswidth，禁 includes 子串）
        const YUNYUEJUAN_HOSTS = [];
        const h = (window.location.hostname || '').toLowerCase();
        if (YUNYUEJUAN_HOSTS.some(d => h === d || h.endsWith('.' + d))) return true;
        // ② DOM 三锚（废除裸 /Marking/ 判定——它是全队最宽守卫，strict-b X03/S15/S16
        //    三方互串放大器）：/Marking/ 路径 + 独立提交按钮 + 小题表格，
        //    button.btn-standard-pri 为云阅卷家族唯一（与 xinkao-campus 分叉靠提交形态，
        //    满分同为 data-score 不可作判别）
        return window.location.pathname.includes('/Marking/')
            && !!document.querySelector('button.btn-standard-pri.phr15')
            && !!document.querySelector('tbody.xtlist');
    },

    isMarkingPage() {
        return window.location.pathname.includes('/Marking/NormalReadPaper');
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('🔎 [诊断] 云阅卷 — 当前不在阅卷页面 (pathname:', window.location.pathname, ')');
            return false;
        }

        console.log('🔎 [诊断] 云阅卷 — 开始检测批改页面元素...');
        try {
            const hasImage = document.querySelector(YUNYUEJUAN_SELECTORS.PAGE_DETECT_IMAGE);
            const hasInput = document.querySelector(YUNYUEJUAN_SELECTORS.PAGE_DETECT_INPUT);
            const hasButton = Array.from(document.querySelectorAll('button')).some(btn => btn.textContent.includes('提交分数'));

            const detected = !!(hasImage && hasInput && hasButton);
            console.log(`🔎 [诊断] 检测结果 — 图片: ${!!hasImage}, 输入框: ${!!hasInput}, 提交按钮: ${hasButton}, 最终判断: ${detected}`);

            if (!detected) {
                console.warn('⚠️ [诊断] 未检测到批改页面，脚本将不会初始化');
            }
            return detected;
        } catch (error) {
            console.error('❌ [诊断] detectMarkingPage 抛出异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        const baseUrl = window.location.pathname;
        // 尝试从页面获取题目标识
        const img = document.querySelector(YUNYUEJUAN_SELECTORS.ANSWER_IMAGE);
        const imgId = img ? img.id : '';
        return baseUrl + (imgId ? '___' + imgId : '');
    },

    async gatherAnswerImages() {
        // 只取可见题块图（#297，对照 qitian #284）：隐藏/零尺寸残留图混入会让 AI 从旧图判分
        const imgElements = Array.from(document.querySelectorAll(YUNYUEJUAN_SELECTORS.ANSWER_IMAGE))
            .filter(img => img.getClientRects().length > 0 && img.src);
        console.log(`🖼️ [诊断] 可见答题卡图片数量: ${imgElements.length}（已排除隐藏/零尺寸残留图）`);
        return imgElements.map(img => img.src);
    },

    async fetchImageAsBase64(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'blob',
                timeout: 20000,
                onload: (res) => {
                    // 数据安全（#297）：非 2xx / 空数据一律拒绝——宁可不取，不拿坏图批改
                    if (res.status < 200 || res.status >= 300) {
                        reject(new Error(`图片下载失败，状态码: ${res.status}`));
                        return;
                    }
                    if (!res.response) {
                        reject(new Error('下载的图片数据为空'));
                        return;
                    }
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const base64 = (reader.result || '').split(',')[1];
                        if (!base64) {
                            reject(new Error('图片转换失败：空数据'));
                            return;
                        }
                        resolve(base64);
                    };
                    reader.onerror = () => reject(new Error('图片读取失败'));
                    reader.readAsDataURL(res.response);
                },
                onerror: () => reject(new Error('图片下载失败（网络错误或跨域被拒）')),
                ontimeout: () => reject(new Error('图片下载超时'))
            });
        });
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

        // 回退：填总分到第一个分数输入框
        const scoreInput = document.querySelector(YUNYUEJUAN_SELECTORS.SCORE_INPUT);
        if (scoreInput) {
            console.log(`✅ [诊断] 找到分数输入框: id=${scoreInput.id}`);
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(scoreInput, total);
            scoreInput.dispatchEvent(new Event('input', { bubbles: true }));
            scoreInput.dispatchEvent(new Event('change', { bubbles: true }));
            scoreInput.dispatchEvent(new Event('blur', { bubbles: true }));
            // 触发平台特定的 onkeyup 事件
            if (typeof clearNoNum === 'function') {
                clearNoNum(scoreInput);
            }
            console.log(`✅ [诊断] 分数已填入`);
            return true;
        } else {
            console.warn('⚠️ [诊断] 未找到分数输入框');
            return false;
        }
    },

    submitGrade() {
        const allBtns = Array.from(document.querySelectorAll('button'));
        console.log(`🔎 [诊断] submitGrade — 页面按钮总数: ${allBtns.length}`);
        const submitBtn = allBtns.find(btn => btn.textContent.includes(YUNYUEJUAN_SELECTORS.SUBMIT_BUTTON_TEXT));
        if (submitBtn) {
            console.log(`✅ [诊断] 找到"提交分数"按钮，准备点击`);
            // 调用平台的 inputkey 函数或直接点击按钮
            if (typeof inputkey === 'function') {
                inputkey(']');
            } else {
                submitBtn.click();
            }
            return true;
        }
        console.warn(`⚠️ [诊断] 未找到"提交分数"按钮`);
        return false;
    },

    async waitForNextPaper(oldImageUrl) {
        let checkTimes = 0;
        return new Promise((resolve) => {
            const checkNextTimer = setInterval(() => {
                checkTimes++;

                // 检测1：图片 src 变化
                const currentImg = document.querySelector(YUNYUEJUAN_SELECTORS.ANSWER_IMAGE);
                if (currentImg && currentImg.src !== oldImageUrl) {
                    clearInterval(checkNextTimer);
                    console.log('✅ 新试卷已加载完毕（图片变化）');
                    resolve(true);
                    return;
                }

                if (checkTimes > 125) {  // 25秒（125 × 200ms），对齐其他适配器
                    clearInterval(checkNextTimer);
                    console.warn('⚠️ 等待下一份试卷超时');
                    resolve(false);
                }
            }, 200);
        });
    },

    isRegradeMode() {
        return !!window.aiGradingState?.isRegrading;
    },

    getScoreInputs() {
        const inputs = [];
        // 优先返回分小题输入框
        const subInputs = document.querySelectorAll(YUNYUEJUAN_SELECTORS.SUB_QUESTION_ROW);
        if (subInputs.length > 0) {
            subInputs.forEach((tr, i) => {
                const input = tr.querySelector('input.fenshu');
                if (input) {
                    const labelTd = tr.querySelector('td:first-child');
                    const label = labelTd?.textContent?.trim() || `第${i + 1}题`;
                    inputs.push({ element: input, label, index: i });
                }
            });
            return inputs;
        }
        // 回退到单个输入框
        const scoreInput = document.querySelector(YUNYUEJUAN_SELECTORS.SCORE_INPUT);
        if (scoreInput) {
            inputs.push({ element: scoreInput, label: '总分', index: 0 });
        }
        return inputs;
    },

    fillScores(scores) {
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) return false;

        // 数据安全：两遍式全或无（#296，模板=guangda #275）——先全量校验，
        // 任一缺失/错位即整体拒绝，全部命中才写入，不留半填状态
        if (scores.length > inputs.length) {
            console.warn(`⚠️ [云阅卷] 分数个数(${scores.length})多于输入框数(${inputs.length})（配置错位）→ 拒绝`);
            return false;
        }
        for (let i = 0; i < inputs.length; i++) {
            if (scores[i] === null || scores[i] === undefined) {
                console.warn(`⚠️ [云阅卷] ${inputs[i].label} 无 AI 分数（第 ${i + 1} 题缺失）→ 拒绝`);
                return false;
            }
        }

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        for (let i = 0; i < inputs.length; i++) {
            setter.call(inputs[i].element, scores[i]);
            inputs[i].element.dispatchEvent(new Event('input', { bubbles: true }));
            inputs[i].element.dispatchEvent(new Event('change', { bubbles: true }));
            inputs[i].element.dispatchEvent(new Event('blur', { bubbles: true }));
            console.log(`✅ [诊断] ${inputs[i].label} 分数 ${scores[i]} 已填入`);
        }
        return true;
    },

    detectSubQuestions() {
        const subs = [];
        document.querySelectorAll(YUNYUEJUAN_SELECTORS.SUB_QUESTION_ROW).forEach((tr, i) => {
            const input = tr.querySelector('input.fenshu');
            if (!input) return;
            const labelTd = tr.querySelector('td:first-child');
            const label = labelTd?.textContent?.trim() || `第${i + 1}题`;
            const maxScore = parseInt(input.getAttribute('data-score')) || 0;
            subs.push({ label, element: input, index: i, maxScore });
        });
        // 只有一题时不启用分小题给分
        return subs.length > 1 ? subs : [];
    }
};

// 注册守卫（#324 教训 + strict-a 附 A.0）：自查 shouldInitialize → 先到先得（不覆盖）→
// 已注册且我也认领本页 = 多命中冲突，console.error 红灯告警（静默劫持变可见）→ 异常 fail-closed
(function registerYunyuejuanAdapter() {
    try {
        if (!YunyuejuanAdapter.shouldInitialize()) return;
        const existing = window.__AI_MARKER_ADAPTER__;
        if (existing) {
            console.error(`🚫 [注册冲突] ${existing.name} 已注册，但 云阅卷(yunyuejuan) 也认领本页（疑似串台/劫持），保留先到者`);
            return;
        }
        window.__AI_MARKER_ADAPTER__ = YunyuejuanAdapter;
    } catch (e) {
        console.warn('⚠️ [注册] 判定异常，fail-closed 不注册:', e);
    }
})();
