const WILLCLASS_ORIGIN = 'https://t.willclass.com';
const WILLCLASS_ROUTE = /^\/exams\/judge\/(\d+)\/?$/;
const WILLCLASS_CANVAS = '.rc_judgeCanvasModule > canvas#jCs.rc_judge_canvas';
const WILLCLASS_SUBMIT = '/exams/api/web/examCenter/';
const WILLCLASS_IMAGE_HOST = 'htfile-answer-sheet.oss-cn-beijing.aliyuncs.com';

const WillclassAdapter = {
    name: '会课阅卷',
    id: 'willclass',
    iconUrl: '',
    urlPatterns: [WILLCLASS_ORIGIN + '/exams/judge/*'],

    shouldInitialize() {
        return window.location.origin === WILLCLASS_ORIGIN && WILLCLASS_ROUTE.test(window.location.pathname);
    },

    _view() {
        if (!this.shouldInitialize()) return null;
        const page = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
        const canvas = page.document.querySelector(WILLCLASS_CANVAS);
        if (!canvas) return null;
        const key = Object.keys(canvas).find(name => /^__react(?:Fiber|InternalInstance)\$/.test(name));
        let drawing, judge, task;
        for (let node = canvas[key], depth = 0; node && depth < 32; node = node.return, depth++) {
            if (node.tag !== 1) continue;
            const component = node.stateNode;
            if (component?.stage?.canvas === canvas) drawing = component;
            if (typeof component?.onJudgeScoreRef === 'function') judge = component;
            if (typeof component?.fetchQuestionPage === 'function' && typeof component?.submitPost === 'function') task = component;
        }
        const paperId = WILLCLASS_ROUTE.exec(window.location.pathname)[1];
        const questions = task?.state?.questionIds?.map(String);
        if (!drawing || !judge || !task || String(task.props.paperId) !== paperId
            || !questions?.length || questions.some(id => !/^\d+$/.test(id))) return null;
        return { page, canvas, drawing, judge, task, paperId, taskId: JSON.stringify([paperId, questions]) };
    },

    getTaskIdentifier() { return this._view()?.taskId || ''; },
    getGradingTaskIdentifier() { return this.getTaskIdentifier(); },
    isRegradeMode() {
        const state = this._view()?.task.state;
        return !!(state?.isHistory || state?.isJudged);
    },

    _paper(view = this._view()) {
        if (!view) return null;
        const { drawing, judge, task } = view;
        const { exercise, loading, isHistory, isJudged } = task.state;
        const student = String(exercise?.judgeStudentId ?? '');
        if (loading !== false || isHistory || isJudged || !/^\d+$/.test(student)
            || judge.props.exercise !== exercise || drawing.props.exerciseDetails !== exercise.exerciseDetails
            || drawing.state.exerciseDetails !== exercise.exerciseDetails
            || !drawing.stage.children.includes(drawing.container)) return null;
        const details = exercise.exerciseDetails;
        if (!Array.isArray(details) || !details.length) return null;
        const questions = details.flatMap(detail => detail.questionLogInfos);
        if (!questions.length || questions.some(question => !question || question.isJudged || question.isException || question.isArbit
            || !question.fileUrls?.length)) return null;

        const sources = [...new Set(questions.flatMap(question => question.fileUrls)
            .map(value => this._imageUrl(value)))];
        if (sources.includes(null)) return null;
        const images = new Map();
        for (const bitmap of drawing.container.children) {
            const image = bitmap.image;
            if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
                images.set(image.src, image);
            }
        }
        const urls = sources.map(url => url + (drawing.state.isOpenSharpen ? '/sharpen,399' : ''));
        if (urls.some(url => !images.has(url))) return null;
        const identity = JSON.stringify([view.taskId, student]);
        return { ...view, student, identity, urls, images };
    },

    _imageUrl(value) {
        try {
            const url = new URL(value, WILLCLASS_ORIGIN);
            return url.origin === 'https://' + WILLCLASS_IMAGE_HOST && !url.username && !url.password && !url.hash
                ? url.href : null;
        } catch (_) { return null; }
    },

    _board(view = this._view()) {
        const panel = view?.judge.judgeScore;
        const exercise = view?.task.state.exercise;
        const rows = panel?.state?.scoreList;
        const root = view?.canvas.closest('.rc_judgepaper_model');
        const fields = [...(root?.querySelectorAll('.rc_judge_score_table .rc_score_input input') || [])];
        if (!panel || !exercise || panel.props.exercise !== exercise || panel.state.exercise !== exercise
            || ![0, 1].includes(Number(panel.props.judgeType)) || panel.allDisabled || !Array.isArray(rows)
            || !fields.length || fields.length !== rows.length) return null;
        const units = rows.map((row, index) => {
            const element = fields[index];
            const label = element.closest('tr')?.cells[0]?.textContent.trim();
            const maxScore = Number(row.totalScore);
            const displayed = /^满分\s*(\d+(?:\.\d+)?)$/.exec(element.placeholder)?.[1];
            if (!label || label !== String(row.questionIndex).trim() || Number(displayed) !== maxScore || !(maxScore > 0)
                || String(row.key) !== element.id || !/^\d+$/.test(element.id) || !/^\d+$/.test(String(row.exerciseId))
                || row.disabled || element.disabled || element.readOnly || !MarkingPaper.visible(element)) return null;
            return { label, index, maxScore, roundStep: 0.5, element, row };
        });
        if (units.some(unit => !unit)) return null;
        const button = root.querySelector('.rc_judge_score_submit_btn');
        if (!MarkingPaper.visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true'
            || !/^提交分数(?:\s*[（(]Enter[)）])?$/.test(button.textContent.trim())) return null;
        return { panel, units, button };
    },

    getScoreInputs() {
        return (this._board()?.units || []).map(({ row, ...unit }) => unit);
    },
    getQuestionContext() {
        const units = this.getScoreInputs();
        return nativeQuestionContext(units, units.length === 1 ? units[0].label : undefined);
    },
    isMarkingPage() {
        const state = this._view()?.task.state;
        return !!state && !state.isHistory && !state.isJudged;
    },
    async detectMarkingPage() {
        for (let attempt = 0; this.shouldInitialize() && attempt < 35; attempt++) {
            if (this.isRegradeMode()) return false;
            const paper = this._paper();
            if (paper && this._board(paper)) return true;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },

    getPaperIdentity() { return this._paper()?.identity || ''; },
    prepareGrading() {
        const view = this._view();
        const board = this._board(view);
        if (board && Number(board.panel.props.autoSubmit) !== 0) {
            this.lastFillError = '请先关闭会课阅卷的「自动提交分数」';
            return false;
        }
        const ready = !!(board && this._paper(view) && !this._blocked(view));
        this.lastFillError = ready ? '' : '请打开待阅答卷，等待图片和给分栏加载完成';
        return ready;
    },

    async gatherAnswerImages() {
        this._gathered = this._paper();
        return this._gathered?.urls.slice() || [];
    },
    async fetchImageAsBase64(url, signal) {
        const paper = this._paper();
        const image = paper?.images.get(url);
        if (signal?.aborted || !image || this._gathered?.identity !== paper.identity
            || this._gathered.images.get(url) !== image || !paper.urls.includes(url)) {
            throw new Error('当前答卷已变化，请重新读取');
        }
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const encoded = canvas.toDataURL('image/png').split(',')[1];
        if (!encoded) throw new Error('会课阅卷答卷图片尚未就绪');
        return encoded;
    },

    _blocked(view) {
        return [...view.page.document.querySelectorAll('.ant-modal, .ant-spin-spinning')].some(MarkingPaper.visible);
    },
    _scoresMatch(board, scores) {
        return board.units.length === scores.length && board.units.every(({ element, row }, index) =>
            element.value.trim() !== '' && Number(element.value) === scores[index]
            && row.judgeScore != null && row.judgeScore !== '' && Number(row.judgeScore) === scores[index]
            && board.panel.allScore[index] === scores[index]);
    },
    fillScores(scores) {
        this._filled = null;
        if (this._submitting || !this.prepareGrading()) return false;
        const paper = this._paper();
        const board = this._board(paper);
        this.lastFillError = '请核对当前答卷和评分结果后重新给分';
        if (!paper || !board || this._gathered?.identity !== paper.identity || this._attempted === paper.identity
            || !Array.isArray(scores) || scores.length !== board.units.length
            || board.units.some(({ maxScore, row }, index) => {
                const score = scores[index];
                return !Number.isFinite(score) || score < 0 || score > maxScore || !Number.isInteger(score * 2)
                    || (row.scoresAward?.length && ![0, maxScore, ...row.scoresAward].includes(score));
            })) return false;

        const { page } = paper;
        const setValue = Object.getOwnPropertyDescriptor(page.HTMLInputElement.prototype, 'value').set;
        for (const [index, { element }] of board.units.entries()) {
            if (this.getPaperIdentity() !== paper.identity || !element.isConnected
                || Number(board.panel.props.autoSubmit) !== 0 || this._blocked(paper)) return false;
            if (element.value.trim() !== '' && Number(element.value) === scores[index]
                && board.panel.allScore[index] === scores[index]) continue;
            setValue.call(element, String(scores[index]));
            element.dispatchEvent(new page.Event('input', { bubbles: true }));
        }
        const updated = this._board(paper);
        if (this.getPaperIdentity() !== paper.identity || !updated || !this._scoresMatch(updated, scores)) return false;
        this._filled = { paper, scores: scores.slice() };
        this.lastFillError = '';
        return true;
    },

    async submitGrade(guard = {}) {
        if (this._submitting) return false;
        const filled = this._filled;
        this._filled = null;
        this.lastSubmitError = '请在会课阅卷核对本份答卷的保存结果';
        if (!filled) return false;
        this._submitting = true;
        try {
            await guard.verify?.();
            const paper = this._paper(), board = this._board(paper);
            if (!paper || !board || filled.paper.identity !== paper.identity || this._attempted === paper.identity
                || guard.signal?.aborted || guard.isCurrent?.() === false || Number(board.panel.props.autoSubmit) !== 0
                || this._blocked(paper) || !this._scoresMatch(board, filled.scores)) return false;
            this._saved = null;
            this._attempted = paper.identity;
            if (!await this._observeSave(paper, board, filled.scores, guard.signal)) return false;
            this._saved = paper;
            this.lastSubmitError = '';
            return true;
        } finally {
            this._submitting = false;
        }
    },

    _saveMatches(body, paper, board, scores) {
        try {
            const { actionType, judgeInfo } = JSON.parse(body);
            if (actionType !== 2 || String(judgeInfo?.paperId) !== paper.paperId || String(judgeInfo.studentId) !== paper.student
                || !Array.isArray(judgeInfo.judgeList)) return false;
            const submitted = judgeInfo.judgeList.flatMap(group => group.judgeInfo.map(item =>
                JSON.stringify([String(group.exerciseId), String(item.questionId), item.score])));
            const expected = board.units.map(({ row }, index) =>
                JSON.stringify([String(row.exerciseId), String(row.key), scores[index]]));
            return JSON.stringify(submitted.sort()) === JSON.stringify(expected.sort());
        } catch (_) { return false; }
    },

    _observeSave(paper, board, scores, signal) {
        const prototype = paper.page.XMLHttpRequest.prototype;
        const { open: originalOpen, send: originalSend } = prototype;
        const requests = new WeakSet();
        const endpoint = WILLCLASS_SUBMIT + (paper.task.state.isDynamic ? 'dynamic' : 'ration') + '/judge/submit/and/fetch';
        const adapter = this;
        return new Promise(resolve => {
            let request;
            const finish = (saved = false) => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', cancel);
                request?.removeEventListener('loadend', receipt);
                if (prototype.open === open) prototype.open = originalOpen;
                if (prototype.send === send) prototype.send = originalSend;
                resolve(saved);
            };
            const cancel = () => finish();
            function receipt() {
                try {
                    const result = request.responseType === 'json' ? request.response : JSON.parse(request.responseText);
                    finish(request.status === 200 && [0, '0'].includes(result?.status) && !!result.data
                        && typeof result.data === 'object' && !Array.isArray(result.data));
                } catch (_) { finish(); }
            }
            function open(method, url, ...args) {
                requests.delete(this);
                try {
                    if (method === 'POST' && new URL(url, WILLCLASS_ORIGIN).href === WILLCLASS_ORIGIN + endpoint) requests.add(this);
                } catch (_) {}
                return originalOpen.call(this, method, url, ...args);
            }
            function send(body) {
                if (!request && requests.has(this) && adapter._saveMatches(body, paper, board, scores)) {
                    request = this;
                    request.addEventListener('loadend', receipt, { once: true });
                }
                return originalSend.call(this, body);
            }
            const timer = setTimeout(cancel, 15_000);
            signal?.addEventListener('abort', cancel, { once: true });
            try {
                prototype.open = open;
                prototype.send = send;
                board.button.click();
            } catch (_) { finish(); }
        });
    },

    isGradingTaskComplete() {
        const view = this._view();
        return !!view && view.taskId === this._saved?.taskId
            && view.task.state.judgeProgressVisible === true && view.task.state.endType === 2;
    },

    async waitForNextPaper(_oldUrl, guard = {}) {
        const previous = this._saved;
        if (!previous || (guard.paperId && guard.paperId !== previous.identity)
            || (guard.taskId && guard.taskId !== previous.taskId)) return false;
        let candidate = '';
        const deadline = performance.now() + 25_000;
        while (!guard.signal?.aborted && performance.now() < deadline) {
            const view = this._view();
            if (!view || view.taskId !== previous.taskId || this.isRegradeMode() || this.isGradingTaskComplete()) return false;
            const paper = this._paper(view);
            const ready = paper && paper.identity !== previous.identity && this._board(paper) && !this._blocked(paper);
            if (ready && candidate === paper.identity) return true;
            candidate = ready ? paper.identity : '';
            try { await abortableGradingDelay(200, guard.signal); } catch (_) { return false; }
        }
        return false;
    },
};

if (WillclassAdapter.shouldInitialize()) window.__AI_MARKER_ADAPTER__ = WillclassAdapter;
