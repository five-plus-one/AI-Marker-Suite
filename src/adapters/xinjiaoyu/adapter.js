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

    getQuestionContext() {
        if (!this.isMarkingPage()) return null;
        const homework = window.location.pathname.includes(XINJIAOYU_SELECTORS.HOMEWORK_URL);
        const homeworkAnswer = homework ? this._getHomeworkApiAnswer(this._getHomeworkStudent()) : null;
        const examCurrent = !homework && _xinjiaoyuQuestionRoute === window.location.pathname + window.location.search;
        const question = homeworkAnswer?.questionNumber ?? (examCurrent ? _xinjiaoyuCurrentQuestionNumber : null);
        const units = this.getScoreInputs().filter(({ element }) => MarkingPaper.visible(element));
        if (!question && units.length <= 1) return null;
        if (units.length === 1) {
            const field = units[0].element;
            const maxScore = field.getAttribute('aria-valuemax') || field.getAttribute('max')
                || field.placeholder?.match(/满分\s*(\d+(?:\.\d+)?)\s*分/)?.[1]
                || homeworkAnswer?.maxScore || (examCurrent ? _xinjiaoyuCurrentTotalScore : null);
            return nativeQuestionContext([{ label: question, maxScore }], question);
        }
        return nativeQuestionContext(units.map(({ element }) => ({
            label: element.closest(XINJIAOYU_SELECTORS.SUB_QUESTION_ITEM)?.querySelector('span')?.textContent,
            maxScore: element.getAttribute('aria-valuemax') || element.getAttribute('max')
                || element.placeholder?.match(/满分\s*(\d+(?:\.\d+)?)\s*分/)?.[1]
        })), question ?? undefined);
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
        if (window.location.pathname.includes(XINJIAOYU_SELECTORS.HOMEWORK_URL)) {
            const student = this._getHomeworkStudent();
            if (!student) return [];
            const apiImage = this._getHomeworkApiAnswer(student)?.rawScan;
            const image = apiImage || this._getHomeworkCanvasImage();
            if (image) console.log(apiImage ? '🖼️ [诊断] 使用打分栏对应的作业 API 图片' : '🖼️ [诊断] 从 Canvas 导出图片成功');
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
        const input = document.querySelector(XINJIAOYU_SELECTORS.SCORE_INPUT);
        const label = input?.closest(XINJIAOYU_SELECTORS.HOMEWORK_SCORE_ROW)
            ?.querySelector(XINJIAOYU_SELECTORS.HOMEWORK_SCORE_STUDENT)?.textContent?.trim();
        // 例如「1.学生甲」。侧栏的 newStudent 标记可能继续指向上一份。
        return label?.match(/^\d+\s*[.．、]\s*(.+)$/)?.[1] || null;
    },

    _getHomeworkApiAnswer(student) {
        if (_xinjiaoyuHomeworkAnswers?.route !== window.location.pathname + window.location.search) return null;
        return _xinjiaoyuHomeworkAnswers.answers.get(student) || null;
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
        return window.location.pathname.includes(XINJIAOYU_SELECTORS.HOMEWORK_URL) ? this._getHomeworkStudent() : null;
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

    fillScore(request) {
        const { total, subScores } = request;

        // 分小题填入（仅考试系统支持）
        if (subScores && subScores.length > 0) {
            const detected = this.detectSubQuestions();
            if (detected.length > 0) {
                for (const sq of subScores) {
                    const target = detected.find(d =>
                        d.label === sq.label || sq.label.includes(d.label) || d.label.includes(sq.label)
                    );
                    if (target && sq.score !== null) {
                        this._fillInputValue(target.element, sq.score);
                        console.log(`✅ [诊断] 小题 ${sq.label} 分数 ${sq.score} 已填入`);
                    }
                }
                return true;
            }
        }

        // 回退：填总分到第一个分数输入框
        const scoreInput = document.querySelector(XINJIAOYU_SELECTORS.SCORE_INPUT);
        if (scoreInput) {
            this._fillInputValue(scoreInput, total);
            console.log(`✅ [诊断] 分数 ${total} 已填入`);
            return true;
        }

        console.warn('⚠️ [诊断] 未找到分数输入框');
        return false;
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
        const submitBtn = allBtns.find(btn => btn.textContent.includes(XINJIAOYU_SELECTORS.SUBMIT_BUTTON_TEXT));
        if (submitBtn) {
            console.log(`✅ [诊断] 找到"提交分数"按钮，准备点击`);
            submitBtn.click();
            return true;
        }
        console.warn(`⚠️ [诊断] 未找到"提交分数"按钮`);
        return false;
    },

    getPaperWaitKeys(imageUrls) {
        if (window.location.pathname.includes(XINJIAOYU_SELECTORS.HOMEWORK_URL)) {
            const student = this._getHomeworkStudent();
            const image = imageUrls?.[0];
            // 在平台按钮按下之前取基线，覆盖换卷早于历史落盘或等待开始的情况。
            const key = image?.startsWith('data:image/png;')
                ? this._getHomeworkCanvasImage() || image
                : MarkingPaper.imageKey(image);
            return student && key ? [student, key] : [];
        }
        return MarkingPaper.imageKeys(imageUrls);
    },

    async waitForNextPaper(oldImageUrl, context = {}) {
        // 作业系统：等待平台自动跳转到下一个学生
        if (window.location.pathname.includes('/homework/')) {
            return this._waitForNextHomeworkStudent(context);
        }

        // 考试系统：等待 API 返回新图片
        return this._waitForNextExamPaper(oldImageUrl, context);
    },

    _waitForNextExamPaper(oldImageUrl, context = {}) {
        const oldKeys = context.paperWaitKeys ?? MarkingPaper.imageKeys([oldImageUrl]);
        return MarkingPaper.waitForChange(this, () => {
            const key = MarkingPaper.imageKey(_xinjiaoyuCurrentImageUrl);
            return key ? [key] : [];
        }, oldKeys, context, 200, 10000);
    },

    async _waitForNextHomeworkStudent(context) {
        const oldKeys = context.paperWaitKeys ?? [];
        if (oldKeys.length !== 2) return false;
        const [oldStudent, oldImage] = oldKeys;
        const fromCanvas = oldImage.startsWith('data:image/png;');
        const changed = await MarkingPaper.waitForChange(this, () => {
            const student = this._getHomeworkStudent();
            if (!student || student === oldStudent) return [];
            const image = fromCanvas
                ? this._getHomeworkCanvasImage()
                : MarkingPaper.imageKey(this._getHomeworkApiAnswer(student)?.rawScan);
            return image ? [student, image] : [];
        }, oldKeys, context, 300, 25000);
        if (changed) console.log('✅ 作业系统 — 下一份答题卡已就绪');
        return changed;
    },

    isRegradeMode() {
        return !!window.aiGradingState?.isRegrading;
    },

    getScoreInputs() {
        const inputs = [];

        // 优先返回分小题输入框（考试系统）
        const subItems = document.querySelectorAll(XINJIAOYU_SELECTORS.SUB_QUESTION_ITEM);
        if (subItems.length > 0) {
            subItems.forEach((item, i) => {
                const input = item.querySelector('.ant-input-number-input');
                if (input) {
                    const labelEl = item.querySelector('span');
                    const label = labelEl?.textContent?.trim() || `第${i + 1}题`;
                    inputs.push({ element: input, label, index: i });
                }
            });
            return inputs;
        }

        // 回退到单个输入框（作业系统）
        const scoreInput = document.querySelector(XINJIAOYU_SELECTORS.SCORE_INPUT);
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
            console.warn(`⚠️ [新教育] 分数个数(${scores.length})多于输入框数(${inputs.length})（配置错位）→ 拒绝`);
            return false;
        }
        for (let i = 0; i < inputs.length; i++) {
            if (scores[i] === null || scores[i] === undefined) {
                console.warn(`⚠️ [新教育] ${inputs[i].label} 无 AI 分数（第 ${i + 1} 题缺失）→ 拒绝`);
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
        const subItems = document.querySelectorAll(XINJIAOYU_SELECTORS.SUB_QUESTION_ITEM);

        subItems.forEach((item, i) => {
            const input = item.querySelector('.ant-input-number-input');
            if (!input) return;

            const labelEl = item.querySelector('span');
            const label = labelEl?.textContent?.trim() || `第${i + 1}题`;

            const placeholder = input.placeholder || '';
            const maxScoreMatch = placeholder.match(/满分(\d+)分/);
            const maxScore = maxScoreMatch ? parseInt(maxScoreMatch[1]) : 0;

            subs.push({ label, element: input, index: i, maxScore });
        });

        return subs.length > 1 ? subs : [];
    }
};

if (XinjiaoyuAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = XinjiaoyuAdapter;
}
