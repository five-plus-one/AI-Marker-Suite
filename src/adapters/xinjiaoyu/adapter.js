// ========== 新教育智能平台适配器 ==========
// 实现 PlatformAdapter 接口，处理新教育平台特定的 DOM 交互
// 支持考试系统（examination）和作业系统（homework）
// 平台特征：Vue 3 + Ant Design，Canvas 渲染答题卡，API 拦截获取图片

// ========== XHR 拦截（考试 + 作业） ==========
// 仅在新教育平台上执行 XHR 拦截，避免影响其他平台
let _xinjiaoyuCurrentImageUrl = null;
let _xinjiaoyuNextImageUrl = null;
let _xinjiaoyuCurrentQuestionNumber = null;
let _xinjiaoyuCurrentTotalScore = null;
let _xinjiaoyuQuestionRoute = '';
let _xinjiaoyuHomeworkAnswers = null;

if (window.location.hostname.includes('xinjiaoyu.com')) {
const _xinjiaoyuOrigOpen = XMLHttpRequest.prototype.open;
const _xinjiaoyuOrigSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this._xinjiaoyuUrl = url;
    return _xinjiaoyuOrigOpen.call(this, method, url, ...args);
};

XMLHttpRequest.prototype.send = function(...args) {
    const route = window.location.pathname + window.location.search;
    this.addEventListener('load', function() {
        const url = this._xinjiaoyuUrl || '';

        // 考试系统 API
        if (url.includes('/review/task/teacher/student/unreviewed/next')) {
            try {
                const response = JSON.parse(this.responseText);
                if (response.code === 200 && response.data?.records) {
                    const records = response.data.records;
                    if (records.length > 0) {
                        const current = records[0];
                        _xinjiaoyuCurrentImageUrl = current.imageURL || current.answerQuestions?.[0]?.rawScan;
                        _xinjiaoyuCurrentQuestionNumber = current.answerQuestions?.[0]?.questionNumber;
                        _xinjiaoyuCurrentTotalScore = current.answerQuestions?.[0]?.totalScore || current.score;
                        _xinjiaoyuQuestionRoute = route;
                        console.log('🖼️ [诊断] 新教育考试 API 拦截 - 当前图片:', _xinjiaoyuCurrentImageUrl?.substring(0, 80));
                    }
                    if (records.length > 1) {
                        _xinjiaoyuNextImageUrl = records[1].imageURL || records[1].answerQuestions?.[0]?.rawScan;
                    }
                }
            } catch (e) {
                console.error('❌ [诊断] 新教育考试 API 解析失败:', e);
            }
        }

        // 作业系统 API
        if (url.includes('/server_homework/homework/answer/sheet/review/progress')) {
            try {
                const response = JSON.parse(this.responseText);
                const questionId = route.match(/grading_by_question\/(\d+)/)?.[1];
                if (route !== window.location.pathname + window.location.search || !questionId
                    || response.code !== 200 || !Array.isArray(response.data?.answerSheets)) return;
                // 响应可能在打分栏更新前到达。取图和题号校验时再匹配当前学生。
                const answers = new Map();
                for (const sheet of response.data.answerSheets) {
                    const name = sheet.student?.studentName?.trim();
                    if (!name) continue;
                    const answer = sheet.questionAnswers?.find(qa => String(qa.questionId) === questionId);
                    answers.set(name, answers.has(name) ? null : answer);
                }
                _xinjiaoyuHomeworkAnswers = { route, answers };
            } catch (e) {
                console.error('❌ [诊断] 新教育作业 API 解析失败:', e);
            }
        }
    });
    return _xinjiaoyuOrigSend.call(this, ...args);
};
} // end if xinjiaoyu.com

// ========== 适配器定义 ==========
const XinjiaoyuAdapter = {
    name: '新教育',
    id: 'xinjiaoyu',
    urlPatterns: ['*://www.xinjiaoyu.com/*'],
    iconUrl: 'https://www.xinjiaoyu.com/favicon.ico',

    shouldInitialize() {
        return window.location.hostname.includes('xinjiaoyu.com');
    },

    isMarkingPage() {
        const pathname = window.location.pathname;
        // 考试系统：/teacher/grading_center/examination/grading_new
        const isExam = pathname.includes('/grading_center/') && pathname.includes('/grading_new');
        // 作业系统：/teacher/grading_center/homework/.../grading_by_question/...
        const isHomework = pathname.includes('/grading_center/homework/') && pathname.includes('/grading_by_question/');
        return isExam || isHomework;
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('🔎 [诊断] 新教育 — 当前不在阅卷页面 (pathname:', window.location.pathname, ')');
            return false;
        }

        console.log('🔎 [诊断] 新教育 — 开始检测批改页面元素...');
        try {
            const hasCanvas = document.querySelector(XINJIAOYU_SELECTORS.PAGE_DETECT_CANVAS);
            const hasInput = document.querySelector(XINJIAOYU_SELECTORS.PAGE_DETECT_INPUT);

            if (hasCanvas || hasInput) {
                console.log(`✅ [诊断] 检测到批改页面元素: ${hasCanvas ? 'Canvas' : ''} ${hasInput ? '输入框' : ''}`);
                return true;
            }

            // 兜底检测
            await new Promise(resolve => setTimeout(resolve, 3000));
            const hasCanvasRetry = document.querySelector(XINJIAOYU_SELECTORS.PAGE_DETECT_CANVAS);
            const hasInputRetry = document.querySelector(XINJIAOYU_SELECTORS.PAGE_DETECT_INPUT);
            const hasButton = Array.from(document.querySelectorAll('button')).some(btn => btn.textContent.includes('提交分数'));

            const detected = !!(hasCanvasRetry || (hasInputRetry && hasButton));
            console.log(`🔎 [诊断] 兜底检测结果 — Canvas: ${!!hasCanvasRetry}, 输入框: ${!!hasInputRetry}, 提交按钮: ${hasButton}, 最终判断: ${detected}`);
            return detected;
        } catch (error) {
            console.error('❌ [诊断] detectMarkingPage 抛出异常:', error);
            return false;
        }
    },

    questionContextOptional: true,
    get useDetectedScoreStep() { return this._isHomework(); },

    getQuestionContext() {
        if (!this.isMarkingPage()) return null;
        const units = this.getScoreInputs().filter(({ element }) => MarkingPaper.visible(element));
        if (this._isHomework() && units.length > 1) return nativeQuestionContext(units);
        if (this._isHomework()) {
            const answer = this._getHomeworkApiAnswer(this._getHomeworkStudent());
            const question = answer?.questionNumber;
            return nativeQuestionContext(units.map(unit => ({
                label: question, maxScore: unit.maxScore ?? answer?.maxScore
            })), question);
        }
        const current = _xinjiaoyuQuestionRoute === window.location.pathname + window.location.search;
        const question = current ? _xinjiaoyuCurrentQuestionNumber : null;
        if (units.length === 1) {
            return nativeQuestionContext([{
                label: question, maxScore: units[0].maxScore ?? (current ? _xinjiaoyuCurrentTotalScore : null)
            }], question);
        }
        return nativeQuestionContext(units, question ?? undefined);
    },

    _isHomework() {
        return window.location.pathname.includes(XINJIAOYU_SELECTORS.HOMEWORK_URL);
    },

    getTaskIdentifier() {
        const pathname = window.location.pathname;
        const search = window.location.search;

        // 作业系统：使用 questionId 作为标识
        if (pathname.includes('/homework/')) {
            const questionMatch = pathname.match(/grading_by_question\/(\d+)/);
            const questionId = questionMatch ? questionMatch[1] : '';
            return `xinjiaoyu_homework_${questionId}`;
        }

        // 考试系统：使用完整 URL
        const questionNumber = _xinjiaoyuCurrentQuestionNumber || '';
        return pathname + search + (questionNumber ? '___Q' + questionNumber : '');
    },

    async gatherAnswerImages() {
        if (this._isHomework()) {
            const student = this._getHomeworkStudent();
            if (!student) return [];
            const image = this._getHomeworkApiImage(student) || this._getHomeworkCanvasImage();
            return image ? [image] : [];
        }

        // 优先使用 API 拦截的图片 URL
        if (_xinjiaoyuCurrentImageUrl) {
            console.log('🖼️ [诊断] 使用 API 拦截的图片:', _xinjiaoyuCurrentImageUrl.substring(0, 80));
            return [_xinjiaoyuCurrentImageUrl];
        }

        // 回退：尝试从 Canvas 导出
        const canvas = document.querySelector(XINJIAOYU_SELECTORS.ANSWER_CANVAS);
        if (canvas) {
            try {
                const dataUrl = canvas.toDataURL('image/png');
                if (dataUrl.length > 1000) {
                    console.log('🖼️ [诊断] 从 Canvas 导出图片成功');
                    return [dataUrl];
                }
            } catch (e) {
                console.warn('⚠️ [诊断] Canvas 导出失败:', e.message);
            }
        }

        console.warn('⚠️ [诊断] 未找到答题卡图片');
        return [];
    },

    _getHomeworkStudent() {
        const inputs = this._getHomeworkScoreElements();
        if (inputs.length === 1) {
            const label = inputs[0].closest(XINJIAOYU_SELECTORS.HOMEWORK_SCORE_ROW)
                ?.querySelector(XINJIAOYU_SELECTORS.HOMEWORK_SCORE_STUDENT)?.textContent?.trim();
            // 单题打分栏显示「1.学生甲」，比侧栏更早反映换卷。
            const name = label?.match(/^\d+\s*[.．、]\s*(.+)$/)?.[1];
            if (name) return { key: 'score:' + name, apiName: name };
        }
        if (!inputs.length) return null;

        // 组合题的打分栏只有题号，使用侧栏选中项及其位置区分同名学生。
        const students = [...document.querySelectorAll(XINJIAOYU_SELECTORS.HOMEWORK_STUDENT_LIST)];
        const selected = students.filter(row => row.classList.contains('newStudent'));
        if (selected.length !== 1) return null;
        const row = selected[0];
        const name = row.querySelector(XINJIAOYU_SELECTORS.HOMEWORK_STUDENT_NAME)?.textContent?.trim();
        if (!name) return null;
        return {
            key: 'list:' + students.indexOf(row) + ':' + name,
            apiName: inputs.length === 1 ? name : null
        };
    },

    _getHomeworkApiImage(student) {
        const image = this._getHomeworkApiAnswer(student)?.rawScan;
        return MarkingPaper.imageKey(image) ? image : null;
    },

    _getHomeworkApiAnswer(student) {
        if (_xinjiaoyuHomeworkAnswers?.route !== window.location.pathname + window.location.search) return null;
        return _xinjiaoyuHomeworkAnswers.answers.get(student?.apiName) || null;
    },

    _getHomeworkCanvasImage() {
        const canvas = document.querySelector(XINJIAOYU_SELECTORS.ANSWER_CANVAS);
        if (!canvas?.width || !canvas.height || !MarkingPaper.visible(canvas)) return null;
        try {
            const image = canvas.toDataURL('image/png');
            if (image.length <= 1000) return null;
            // 换卷时平台会先清屏。空白画布编码后也可能大于 1000 字节。
            const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
            if (pixels) {
                const colors = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 4);
                if (!colors.some(color => color !== colors[0])) return null;
            }
            return image;
        } catch (_) {
            return null;
        }
    },

    getPaperIdentity() {
        return this._isHomework() ? this._getHomeworkStudent()?.key || null : null;
    },

    async fetchImageAsBase64(url) {
        if (url.startsWith('data:')) {
            return url.split(',')[1];
        }

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

    fillScore({ total, subScores }) {
        const inputs = this.getScoreInputs();
        if (!subScores?.length) return this.fillScores([total]);
        const byLabel = new Map(subScores.map(({ label, score }) => [label, score]));
        if (subScores.length !== inputs.length || byLabel.size !== inputs.length) return false;
        return this.fillScores(inputs.map(({ label }) => byLabel.get(label)));
    },

    _fillInputValue(input, value) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
    },

    submitGrade() {
        const allBtns = Array.from(document.querySelectorAll('button'));
        console.log(`🔎 [诊断] submitGrade — 页面按钮总数: ${allBtns.length}`);
        const submitBtn = allBtns.find(btn => btn.textContent.trim() === XINJIAOYU_SELECTORS.SUBMIT_BUTTON_TEXT
            && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && MarkingPaper.visible(btn));
        if (submitBtn) {
            console.log(`✅ [诊断] 找到"提交分数"按钮，准备点击`);
            submitBtn.click();
            return true;
        }
        console.warn(`⚠️ [诊断] 未找到"提交分数"按钮`);
        return false;
    },

    getPaperWaitKeys(imageUrls) {
        if (!this._isHomework()) return MarkingPaper.imageKeys(imageUrls);
        const student = this._getHomeworkStudent();
        if (!student) return [];
        const originalImage = imageUrls?.[0];
        const api = MarkingPaper.imageKey(originalImage) || MarkingPaper.imageKey(this._getHomeworkApiImage(student));
        const canvas = this._getHomeworkCanvasImage();
        const originalCanvas = originalImage?.startsWith('data:image/png;') ? originalImage : null;
        // 在点击提交前记录当前状态，同时保留用于评分的画布作为旧卷证据。
        const route = window.location.pathname + window.location.search;
        return [route, student.key, ...new Set([api, canvas, originalCanvas].filter(Boolean))];
    },

    async waitForNextPaper(oldImageUrl, context = {}) {
        if (this._isHomework()) return this._waitForNextHomeworkStudent(context);
        return this._waitForNextExamPaper(oldImageUrl, context);
    },

    _waitForNextExamPaper(oldImageUrl, context = {}) {
        const oldKeys = context.paperWaitKeys ?? MarkingPaper.imageKeys([oldImageUrl]);
        return MarkingPaper.waitForChange(this, () => {
            const key = MarkingPaper.imageKey(_xinjiaoyuCurrentImageUrl);
            return key ? [key] : [];
        }, oldKeys, context, 200, 10000);
    },

    _waitForNextHomeworkStudent(context) {
        const oldKeys = context.paperWaitKeys ?? [];
        if (oldKeys.length < 3) return false;
        const [route, oldStudent, ...oldImages] = oldKeys;
        const hadCanvas = oldImages.some(key => key.startsWith('data:image/png;'));
        const hadApiImage = oldImages.some(key => !key.startsWith('data:image/png;'));
        return MarkingPaper.waitForChange(this, () => {
            if (route !== window.location.pathname + window.location.search) return [];
            const student = this._getHomeworkStudent();
            if (!student || student.key === oldStudent) return [];
            const api = MarkingPaper.imageKey(this._getHomeworkApiImage(student));
            if (api && hadApiImage) return [student.key, api];
            if (!hadCanvas) return [];
            const canvas = this._getHomeworkCanvasImage();
            return canvas ? [student.key, canvas, ...(api ? [api] : [])] : [];
        }, oldKeys, context, 300, 25000);
    },

    isRegradeMode() {
        return !!window.aiGradingState?.isRegrading;
    },

    _getHomeworkScoreElements() {
        const scoped = [...document.querySelectorAll(XINJIAOYU_SELECTORS.HOMEWORK_SCORE_INPUT)];
        if (scoped.length) return scoped.filter(element => MarkingPaper.visible(element));
        // 旧版单题给分栏可能没有组合题面板的类名。
        const visible = [...document.querySelectorAll(XINJIAOYU_SELECTORS.SCORE_INPUT)]
            .filter(element => MarkingPaper.visible(element));
        return visible.length === 1 ? visible : [];
    },

    getScoreInputs() {
        const selectors = XINJIAOYU_SELECTORS;
        if (this._isHomework()) {
            const elements = this._getHomeworkScoreElements();
            const units = elements.map((element, index) => {
                const text = element.closest(selectors.HOMEWORK_QUESTION_ROW)
                    ?.querySelector(selectors.HOMEWORK_QUESTION_LABEL)?.textContent?.normalize('NFKC').trim();
                const question = text?.match(/^(.+?)\s*\.?\s*\(\s*(\d+(?:\.\d+)?)\s*分\s*\)$/u);
                return this._scoreUnit(element, index, question?.[1], question?.[2]);
            });
            if (units.length > 1 && (units.some(unit => unit.label === '总分' || !unit.maxScore)
                || new Set(units.map(unit => unit.label)).size !== units.length)) return [];
            if (units.length === 1 && !units[0].maxScore) {
                const answer = this._getHomeworkApiAnswer(this._getHomeworkStudent());
                if (Number(answer?.maxScore) > 0) units[0].maxScore = Number(answer.maxScore);
            }
            return units;
        }

        const rows = [...document.querySelectorAll(selectors.SUB_QUESTION_ITEM)];
        if (rows.length) return rows.flatMap((row, i) => {
            const element = row.querySelector(selectors.SCORE_INPUT);
            const label = row.querySelector('span')?.textContent?.trim() || '第' + (i + 1) + '题';
            return element ? [this._scoreUnit(element, i, label)] : [];
        });
        const input = document.querySelector(selectors.SCORE_INPUT);
        return input ? [this._scoreUnit(input, 0)] : [];
    },

    _scoreUnit(element, index, label = '总分', rowMaxScore) {
        const maxScore = Number(rowMaxScore ?? (element.getAttribute('aria-valuemax') || element.getAttribute('max')
            || element.placeholder?.normalize('NFKC').match(/满分\s*(\d+(?:\.\d+)?)\s*分/)?.[1]));
        const roundStep = Number(element.getAttribute('step'));
        return { element, label, index, maxScore: maxScore > 0 ? maxScore : undefined,
            roundStep: roundStep > 0 ? roundStep : undefined };
    },

    fillScores(scores) {
        const inputs = this.getScoreInputs();
        if (!inputs.length || scores.length !== inputs.length) return false;
        // 先校验整组，避免旧方案或异常分数只覆盖部分小题。
        if (inputs.some(({ element, maxScore }, i) => {
            const score = scores[i];
            return element.disabled || element.readOnly || !Number.isFinite(score) || score < 0
                || (maxScore > 0 && score > maxScore);
        })) return false;

        inputs.forEach(({ element }, i) => this._fillInputValue(element, scores[i]));
        return true;
    },

    detectSubQuestions() {
        const units = this.getScoreInputs();
        return units.length > 1 ? units : [];
    }
};

if (XinjiaoyuAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = XinjiaoyuAdapter;
}
