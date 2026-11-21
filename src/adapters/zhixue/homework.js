// 智学网作业批改页的分数按钮会直接提交。
const ZhixueHomeworkAdapter = {
    id: 'zhixue',
    name: '智学网',
    iconUrl: 'https://www.zhixue.com/favicon.ico',
    scoreDetectionLabel: '读取当前题分值',
    urlPatterns: ['https://www.zhixue.com/*', 'https://zhixue.com/*', 'https://*.zhixue.com/*'],

    shouldInitialize() {
        if (!/^\/tfbwowbookweb\/?$/i.test(location.pathname)) return false;
        const route = /^#\/smarthw\/?\?(.+)$/.exec(location.hash);
        const query = route ? new URLSearchParams(route[1]) : null;
        return !!(query?.get('hwId') && query.get('classId'));
    },

    isMarkingPage() {
        return this.shouldInitialize() && !!document.querySelector('.smart-hw-container');
    },

    async detectMarkingPage() {
        for (let i = 0; i < 50 && this.shouldInitialize(); i++) {
            if (this.isMarkingPage()) return true;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },

    _view() {
        if (!this.shouldInitialize()) return null;
        const page = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
        const root = page.document.querySelector('.smart-hw-container');
        const view = root?.__vue__;
        return view?.$options?.name === 'ShuzhiCorrect' ? view : null;
    },

    getTaskIdentifier() {
        const view = this._view();
        const topicId = view?.curTopicItem?.childQuestionId;
        if (!view?.hwId || !view.curClassId || !topicId) return '';
        return 'zhixue-homework:' + JSON.stringify([view.hwId, view.curClassId, topicId, view.curBlankId || '']);
    },

    getGradingTaskIdentifier() {
        return this.getTaskIdentifier();
    },

    _scorePanel(view) {
        const sidebar = view?.$el.querySelector('.sidebar-right-container');
        return sidebar?.querySelector('.operation-panel') || sidebar;
    },

    getScoreInputs() {
        const view = this._view();
        const panel = this._scorePanel(view);
        const label = panel?.querySelector('.correct-tool-title span')?.textContent.trim();
        const maxScore = Number(view?.curTopicItem?.standardScore);
        if (!view || view.curBlankId || !label || !Number.isFinite(maxScore) || maxScore <= 0
            || !MarkingPaper.visible(panel.querySelector('button.green-btn'))
            || !MarkingPaper.visible(panel.querySelector('button.red-btn'))) return [];
        const interval = panel.querySelector('.score-interval-select input')?.value;
        const roundStep = Number(/^(\d+(?:\.\d+)?)\s*分$/.exec(interval || '')?.[1]);
        return [{ label, maxScore, roundStep: roundStep > 0 ? roundStep : undefined }];
    },

    getScoreDetectionHint() {
        const view = this._view();
        const panel = this._scorePanel(view);
        if (panel?.querySelector('.score-box') && !panel.querySelector('button.green-btn')) {
            return '本题按答案选项计分，请切换到有分值按钮的题目。';
        }
        if (view?.curBlankId) return '请切换到整题评分后再读取分值。';
        return '当前题目的评分区尚未就绪，请等待作业加载后重试。';
    },

    getQuestionContext() {
        const units = this.getScoreInputs();
        if (!units.length) return null;
        return { question: units[0].label, units };
    },

    _paper() {
        const view = this._view();
        const task = this.getTaskIdentifier();
        const studentId = view?.curStudentItem?.studentId;
        if (!studentId || !task || view.loading || view.correctLoading) return null;
        const source = view.cutImageList;
        const elements = [...view.$el.querySelectorAll('.question-viewer .image-wrapper img')];
        if (!Array.isArray(source) || !source.length || elements.length !== source.length) return null;
        const urls = elements.map(image => image.src);
        if (!elements.every((image, index) => image.complete && image.naturalWidth > 0
            && MarkingPaper.imageKey(source[index]) && MarkingPaper.imageKey(source[index]) === MarkingPaper.imageKey(image.src))) return null;
        return { view, task, studentId, identity: task + ':' + JSON.stringify(studentId), urls };
    },

    _scoreButton(target, score) {
        const unit = this.getScoreInputs()[0];
        if (!unit || !Number.isFinite(score) || score < 0 || score > unit.maxScore) return null;
        const panel = this._scorePanel(target.view);
        const selector = score === 0 ? 'button.red-btn'
            : score === unit.maxScore ? 'button.green-btn' : '.score-btn-group .score-btn';
        const matches = [...panel.querySelectorAll(selector)].filter(button => MarkingPaper.visible(button)
            && (score === 0 ? button.textContent.trim() === '零分'
                : score === unit.maxScore ? button.textContent.trim() === '满分' : Number(button.textContent.trim()) === score)
            && !button.matches(':disabled,[aria-disabled="true"],.disabled,.is-disabled'));
        return matches.length === 1 ? matches[0] : null;
    },

    prepareGrading() {
        this._filled = null;
        const [unit] = this.getScoreInputs();
        this.lastFillError = unit ? '请选择已加载答卷图片且可修改分数的作业答卷' : this.getScoreDetectionHint();
        const target = unit && this._paper();
        if (!target || target.view.canNotEdit || target.view.topicSaving) return false;
        const configured = PresetManager.getMaxScore();
        if (configured !== unit.maxScore) {
            this.lastFillError = '评分方案满分与作业题目不一致，请调整后继续';
            return false;
        }
        this.lastFillError = '';
        return true;
    },

    getPaperIdentity() {
        return this._paper()?.identity || null;
    },

    gatherAnswerImages() {
        return this._paper()?.urls || [];
    },

    fillScores(scores) {
        this._filled = null;
        this.lastFillError = '当前作业的给分区没有这一分值，请核对评分方案和平台的分值间隔';
        const target = this._paper();
        const score = Array.isArray(scores) && scores.length === 1 ? scores[0] : NaN;
        if (!target || target.view.canNotEdit || target.view.topicSaving || this._submitting
            || !this._scoreButton(target, score)) return false;
        this._filled = { ...target, score };
        this.lastFillError = '';
        return true;
    },

    async submitGrade(guard = {}) {
        if (this._submitting || !this._filled) return false;
        const filled = this._filled;
        this._filled = null;
        this._submitting = true;
        this.lastSubmitError = '请在智学网核对这份作业的保存状态后继续';
        try {
            await guard.verify?.();
            const target = this._paper();
            if (guard.signal?.aborted || guard.isCurrent?.() === false || target?.identity !== filled.identity) return false;
            if (target.view.canNotEdit || target.view.topicSaving) {
                guard.onNotDispatched?.();
                return false;
            }
            const button = this._scoreButton(target, filled.score);
            if (!button) {
                guard.onNotDispatched?.();
                return false;
            }
            const saved = await this._confirmSave(button, filled, guard);
            if (saved) this.lastSubmitError = '';
            return saved;
        } finally { this._submitting = false; }
    },

    _confirmSave(button, filled, guard) {
        const page = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
        const proto = page.XMLHttpRequest?.prototype;
        if (!proto) return false;
        const originalOpen = proto.open, originalSend = proto.send;
        const path = filled.view.isEhw ? '/api-dihw-marking/online/ehw/marking/modifyScore' : '/api-dihw-marking/online/sz/marking/modifyScore';
        const expected = {
            homeworkId: filled.view.hwId, classId: filled.view.curClassId, studentId: filled.studentId,
            childQuestionId: filled.view.curTopicItem.childQuestionId, modifyScore: filled.score,
        };
        const candidates = new WeakSet();
        return new Promise(resolve => {
            let request, timer, done = false;
            function restore() {
                if (proto.open === open) proto.open = originalOpen;
                if (proto.send === send) proto.send = originalSend;
            }
            function finish(saved) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                restore();
                request?.removeEventListener('loadend', receipt);
                guard.signal?.removeEventListener('abort', cancelled);
                resolve(saved);
            }
            function cancelled() { finish(false); }
            function receipt() {
                try {
                    const response = request.responseType === 'json' ? request.response : JSON.parse(request.responseText);
                    finish(request.status >= 200 && request.status < 300 && String(response?.code) === '10000000');
                } catch (_) { cancelled(); }
            }
            function open(method, url, ...rest) {
                candidates.delete(this);
                try {
                    const target = new URL(url, page.location.href);
                    if (String(method).toUpperCase() === 'POST' && target.origin === 'https://pyj.zhixue.com'
                        && target.pathname === path) candidates.add(this);
                } catch (_) { /* 其他原站请求沿用自身行为。 */ }
                return originalOpen.call(this, method, url, ...rest);
            }
            function send(body) {
                if (candidates.has(this)) {
                    let data;
                    try { data = JSON.parse(body); } catch (_) {}
                    if (data && !data.blankId && Object.entries(expected).every(([key, value]) => String(data[key]) === String(value))) {
                        request = this;
                        clearTimeout(timer);
                        timer = setTimeout(cancelled, 30000);
                        restore();
                        this.addEventListener('loadend', receipt, { once: true });
                    }
                }
                try { return originalSend.call(this, body); }
                catch (error) { if (this === request) cancelled(); throw error; }
            }
            try {
                if (guard.signal?.aborted) return cancelled();
                timer = setTimeout(cancelled, 8000);
                guard.signal?.addEventListener('abort', cancelled, { once: true });
                proto.open = open;
                proto.send = send;
                button.click();
            } catch (_) { cancelled(); }
        });
    },

    async waitForNextPaper(_oldImageUrl, guard = {}) {
        if (!guard.taskId || !guard.paperId) return false;
        let candidate;
        for (let i = 0; i < 125; i++) {
            if (guard.signal?.aborted) return false;
            const task = this.getTaskIdentifier();
            if (task && task !== guard.taskId) return false;
            const paper = this._paper();
            const next = paper?.identity !== guard.paperId && paper?.task === guard.taskId ? paper.identity : null;
            if (next && next === candidate) return true;
            candidate = next;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },
};
