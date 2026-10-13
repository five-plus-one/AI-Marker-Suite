// ========== 江西上进教育服务云平台适配器 ==========
// 智慧上进，域名: www.sipd.cn
// 与威科姆悦卷通 (wuyuetong) 同一套阅卷系统，jQuery + ASP.NET WebForms
// 实测要点：
//   - 换卷信号是 #imageFullScreen[data-stu]：旧值 → '0' → 新值，URL 不变
//   - 任务标识只用 pathname + data-key；input[name='input-rpe-title'] (mtid) 每次进页都变，
//     是会话实例 ID 而非题目 ID，混入标识会导致刷新后误判新试题（#136）
//   - 0 分提交弹 #zeroCheckModal，需自动点 #btn_0_ok，否则阻塞批改循环
//   - Mark.setInputScore 是清空分数框的函数，禁止用于填分
//   - submitKeyboard 提交时用 parseFloat($(this).val()) 直读输入框，原生 setter 填分有效

const SipdAdapter = {
    name: '江西上进教育服务云',
    id: 'sipd',
    urlPatterns: ['*://*.sipd.cn/*'],
    iconUrl: '',

    shouldInitialize() {
        return window.location.hostname.includes('sipd.cn');
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器
    isMarkingPage() {
        return /\/mark\/v\d+\/view\//i.test(window.location.pathname);
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('[上进教育] 当前不在阅卷页面 (pathname:', window.location.pathname, ')');
            return false;
        }

        console.log('[上进教育] 开始检测批改页面...');
        try {
            const result = await Promise.race([
                waitForElement(SIPD_SELECTORS.PAGE_DETECT_IMAGE).then(() => 'answer-image'),
                waitForElement(SIPD_SELECTORS.PAGE_DETECT_INPUT).then(() => 'score-input'),
                waitForElement(SIPD_SELECTORS.PAGE_DETECT_SUBMIT).then(() => 'submit-btn'),
            ]).catch(() => null);

            if (result) {
                console.log(`[上进教育] 检测到批改页面元素: ${result}`);
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 3000));
            const hasImage = document.querySelector(SIPD_SELECTORS.ANSWER_IMAGE);
            const hasInput = document.querySelector(SIPD_SELECTORS.SCORE_INPUT);
            const hasBtn = document.querySelector(SIPD_SELECTORS.SUBMIT_BUTTON);
            const detected = !!(hasImage && hasInput && hasBtn);
            console.log(`[上进教育] 兜底检测 - 图片: ${!!hasImage}, 输入框: ${!!hasInput}, 提交: ${!!hasBtn}, 最终: ${detected}`);
            return detected;
        } catch (error) {
            console.error('[上进教育] detectMarkingPage 异常:', error);
            return false;
        }
    },

    getTaskIdentifier() {
        // 任务标识 = pathname + data-key。
        // 注意：不能混入 input[name='input-rpe-title'] (mtid)——实测它每次进入阅卷页都会变
        //（平台的会话实例 ID，非题目 ID），会导致同一道题刷新后匹配不上已绑定方案（#136）。
        // pathname 与 data-key 在换学生、刷新场景下均稳定。
        this._migrateLegacyBindings();
        const keys = Array.from(document.querySelectorAll(SIPD_SELECTORS.SCORE_INPUT_CONTAINER))
            .map(el => el.getAttribute('data-key'))
            .filter(Boolean)
            .join(',');
        return [window.location.pathname, keys].join('::');
    },

    // 一次性迁移含 mtid 的旧绑定 key（pathname::mtid::datakey → pathname::datakey）
    // 旧标识同一道题会分裂成多条绑定，迁移时后插入的覆盖先插入的（后绑定的优先）
    _migrateLegacyBindings() {
        if (window.__sipdBindingsMigrated) return;
        window.__sipdBindingsMigrated = true;
        try {
            const bindings = window.PresetManager && window.PresetManager.data && window.PresetManager.data.bindings;
            if (!bindings) return;
            // 旧格式：pathname::纯数字mtid::datakey，pathname 含 /mark/v\d+/view/
            const legacyPattern = /^(\/mark\/v\d+\/view\/[^:]+)::(\d+)::([^:]+)$/;
            let changed = false;
            for (const key of Object.keys(bindings)) {
                const m = key.match(legacyPattern);
                if (!m) continue;
                const newKey = `${m[1]}::${m[3]}`;
                bindings[newKey] = bindings[key];
                delete bindings[key];
                changed = true;
            }
            if (changed) {
                window.PresetManager.save();
                console.log('[上进教育] 已迁移旧任务标识绑定（mtid 不稳定，已从标识中移除）');
            }
        } catch (e) {
            console.warn('[上进教育] 绑定迁移失败:', e);
        }
    },

    async gatherAnswerImages() {
        console.log('[上进教育] 开始获取答题卡图片...');

        const startTime = Date.now();
        const maxWait = 8000;

        // 轮询等待图片加载完成（OSS 裁剪图）
        while (Date.now() - startTime < maxWait) {
            const img = document.querySelector(SIPD_SELECTORS.ANSWER_IMAGE);
            if (img && img.src && img.src.startsWith('http') && (img.naturalWidth > 0 || img.complete)) {
                console.log('[上进教育] 获取到答题卡图片');
                return [img.src];
            }
            await new Promise(r => setTimeout(r, 300));
        }

        // 超时兜底
        const fallbackImg = document.querySelector(SIPD_SELECTORS.ANSWER_IMAGE);
        if (fallbackImg && fallbackImg.src && fallbackImg.src.startsWith('http')) {
            console.log('[上进教育] 超时兜底: 获取到图片');
            return [fallbackImg.src];
        }

        console.warn('[上进教育] 未找到答题卡图片');
        return [];
    },

    async fetchImageAsBase64(url) {
        // OSS 裁剪图带 security-token，直接下载即可
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const inputs = [];
        const panels = document.querySelectorAll(SIPD_SELECTORS.SCORE_INPUT_CONTAINER);

        // 单题标签：从试题答案面板标题提取（如 "20(1-2) 试题答案" → "20(1-2)"）
        let questionLabel = '';
        const titleEl = document.querySelector(SIPD_SELECTORS.QUESTION_TITLE);
        if (titleEl) {
            questionLabel = titleEl.textContent
                .replace(/试题答案|参考答案/g, '')
                .replace(/×/g, '')
                .trim();
        }

        panels.forEach((panel, i) => {
            const el = panel.querySelector(SIPD_SELECTORS.SCORE_INPUT);
            if (!el || el.offsetParent === null) return;

            // 满分：font.text-error span 的数字（如 "<= 6" → 6）
            let maxScore = 0;
            const maxEl = panel.querySelector(SIPD_SELECTORS.MAX_SCORE_FONT);
            if (maxEl) {
                const match = maxEl.textContent.match(/(\d+(?:\.\d+)?)/);
                if (match) maxScore = parseFloat(match[1]) || 0;
            }

            // 标签：优先输入框前的 span（多小题时有文字），单框时用题号
            const labelSpan = panel.querySelector(SIPD_SELECTORS.SCORE_LABEL_SPAN);
            const spanText = labelSpan ? labelSpan.textContent.trim() : '';
            let label;
            if (spanText) {
                label = spanText;
            } else if (panels.length === 1) {
                label = questionLabel || '总分';
            } else {
                label = `第${i + 1}题`;
            }

            inputs.push({ element: el, label: label, index: inputs.length, maxScore: maxScore });
        });

        console.log(`[上进教育] 找到 ${inputs.length} 个分数输入框`);
        return inputs;
    },

    fillScores(scores) {
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) return false;

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        let successCount = 0;

        // 确保键盘打分模式 + 输入框可编辑
        this._ensureKeyboardMode();

        for (let i = 0; i < Math.min(scores.length, inputs.length); i++) {
            if (scores[i] === null || scores[i] === undefined) continue;

            const input = inputs[i].element;
            input.removeAttribute('readonly');
            setter.call(input, scores[i]);

            // 只派发 input/change/blur。不要派发 keyup：
            // 平台 onkeyup 挂着 Mark.clearNoNum，会把非整数/.5 的小数截断
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));

            successCount++;
        }

        return successCount > 0;
    },

    submitGrade() {
        const btn = document.querySelector(SIPD_SELECTORS.SUBMIT_BUTTON);
        if (!btn) {
            console.warn('[上进教育] 未找到提交按钮');
            return false;
        }

        btn.click();
        console.log('[上进教育] 点击提交按钮');

        // 0分确认弹窗自动确定（轮询检测，弹窗出现时机不固定）
        // 实测：勾选「0分确认」时 0 分提交会弹 #zeroCheckModal，阻塞换卷流程
        let tries = 0;
        const timer = setInterval(() => {
            tries++;
            const modal = document.querySelector(SIPD_SELECTORS.ZERO_MODAL);
            if (modal && modal.style.display === 'block') {
                const okBtn = document.querySelector(SIPD_SELECTORS.ZERO_MODAL_OK);
                if (okBtn) {
                    console.log('[上进教育] 检测到0分确认弹窗，自动点击确定');
                    okBtn.click();
                }
                clearInterval(timer);
            } else if (tries >= 20) {
                clearInterval(timer);
            }
        }, 100);

        return true;
    },

    async waitForNextPaper(oldImageUrl) {
        // 实测换卷信号：data-stu 旧值 → '0'/图清空 → 新值，URL 不变
        // OSS security-token 全卷相同，图片尾部不可作变化信号，用完整 src 或 data-stu
        const img = document.querySelector(SIPD_SELECTORS.ANSWER_IMAGE);
        const oldStu = img ? (img.getAttribute('data-stu') || '') : '';

        const timeout = 30000;
        const interval = 300;
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const cur = document.querySelector(SIPD_SELECTORS.ANSWER_IMAGE);
            if (cur) {
                const stu = cur.getAttribute('data-stu') || '';
                const src = cur.src || '';
                const stuValid = stu && stu !== '0';
                const stuChanged = stuValid && stu !== oldStu;
                const srcChanged = !!(oldImageUrl && src && src !== oldImageUrl);

                if (stuValid && (stuChanged || srcChanged) && src.startsWith('http')) {
                    console.log('[上进教育] 检测到下一份答卷 (data-stu:', stu, ')');
                    return true;
                }
            }
            await new Promise(r => setTimeout(r, interval));
        }

        console.warn('[上进教育] 等待下一份答卷超时');
        return false;
    },

    isRegradeMode() {
        // submitMark 的 handler 以 Mark.getReviewVal() 区分正常/回评流程
        try {
            if (window.Mark && typeof Mark.getReviewVal === 'function') {
                return !!Mark.getReviewVal();
            }
        } catch (e) {
            // 忽略，走文字兜底
        }
        const bodyText = document.body.innerText || '';
        return bodyText.includes('回评') || bodyText.includes('复核');
    },

    // 确保键盘打分模式激活（鼠标/步骤模式下分数框可能隐藏或只读）
    _ensureKeyboardMode() {
        const keyboardRadio = document.querySelector(SIPD_SELECTORS.KEYBOARD_MODE);
        if (keyboardRadio && !keyboardRadio.checked) {
            keyboardRadio.click();
            console.log('[上进教育] 切换到键盘打分模式');
        }
    },
};

// 注册适配器
if (SipdAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = SipdAdapter;
}
