const EiduoAdapter = {
    name: '爱多分',
    id: 'eiduo',
    urlPatterns: ['*://ui.eiduo.com/exam-webapp/*'],

    shouldInitialize() {
        const { hostname, protocol, pathname } = window.location;
        return hostname === 'ui.eiduo.com' && protocol === 'https:' && pathname.startsWith('/exam-webapp/');
    },
    _root() {
        const { pathname, search } = window.location;
        if (!this.shouldInitialize() || pathname !== '/exam-webapp/marking/index') return null;
        const params = new URLSearchParams(search);
        if (['check', 'isArbitrate'].some(key => params.has(key) && params.get(key) !== 'false')) return null;
        const root = document.querySelector('exam-index');
        const mode = root?.querySelector('.status')?.textContent.replace(/\s/g, '');
        return mode === '当前处于阅卷模式' ? root : null;
    },
    _question(root) {
        const text = root?.querySelector('.topic-info .topic')?.getAttribute('title') || '';
        const match = /^第(\d+)题\(序号(\d+)\)$/.exec(text.trim());
        return match && { label: match[1], indexLabel: match[2] };
    },
    getTaskIdentifier() {
        const question = this._question(this._root());
        if (!question) return '';
        const params = new URLSearchParams(window.location.search);
        const ids = ['examId', 'subjectId'].map(key => params.get(key) || '');
        return ids.every(id => /^\d+$/.test(id)) ? JSON.stringify([...ids, question.label, question.indexLabel]) : '';
    },
    getGradingTaskIdentifier() { return this.getTaskIdentifier(); },
    _visible(element) {
        return !!element?.getClientRects().length && getComputedStyle(element).visibility === 'visible';
    },
    _dialog(root) {
        return [...(root?.querySelectorAll('com-dialog .dialog-content') || [])]
            .find(element => this._visible(element))?.textContent.trim() || '';
    },
    _progress(root) {
        const text = root?.querySelector('.info .detail')?.textContent || '';
        const match = /阅卷进度\s*[：:]\s*(\d+)\s*\/\s*(\d+)/.exec(text);
        return match && { marked: Number(match[1]), total: Number(match[2]) };
    },
    _panel(root) {
        const question = this._question(root);
        const panel = root?.querySelector('exam-submit');
        const rows = panel?.querySelectorAll('.submit-bd .item');
        if (!question || rows?.length !== 1 || rows[0].matches('.steps, [steps]')) return null;
        const row = rows[0];
        const element = row.querySelector('input[type="number"]');
        const scoreLabel = row.querySelector('.num')?.title.trim();
        const button = panel.querySelector('form button[type="submit"]');
        const fullScore = /^满分\s*(\d+(?:\.\d+)?)$/.exec(element?.placeholder.trim() || '');
        const maxScore = Number(fullScore?.[1]);
        if (!this._visible(element) || element.disabled || element.readOnly || scoreLabel !== question.label + '(' + question.indexLabel + ')'
            || !Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 60 || !this._visible(button)
            || (element.max && Number(element.max) !== maxScore)
            || button.textContent.trim() !== '提交分数' || panel.querySelector('.submit-mult, .submit-dashboard.multi')) return null;
        const dashboard = panel.querySelector('.submit-dashboard.show');
        const options = [...(dashboard?.querySelectorAll('.hd .radiobox') || [])];
        const auto = options.find(option => option.textContent.trim() === '自动提交' && this._visible(option));
        const step = options.find(option => option !== auto && option.classList.contains('active'));
        return { element, panel, dashboard, button, auto, label: question.label, maxScore,
            roundStep: step ? Number(step.textContent.trim()) : 1 };
    },
    _paper() {
        const root = this._root(), task = this.getTaskIdentifier(), panel = this._panel(root);
        const progress = this._progress(root);
        if (!task || !panel || !progress || !progress.total || this._dialog(root)
            || root.querySelector('.mark-container .loading.active, .mark-container .empty')) return null;
        const images = [...root.querySelectorAll('.mark-container .imgs img')];
        if (!images.length || images.some(image => !this._visible(image) || !image.complete || !image.naturalWidth || !image.naturalHeight)) return null;
        if (images.some(image => !image.currentSrc)) return null;
        const urls = images.map(image => new URL(image.currentSrc));
        if (urls.some(url => url.protocol !== 'https:' || url.username || url.password)) return null;
        const sources = urls.map(url => url.href);
        // The storage path identifies the sheet across crop and cache query changes.
        const paperKey = JSON.stringify(urls.map(url => url.origin + url.pathname));
        return { root, task, panel, progress, urls: sources, paperKey, identity: JSON.stringify([task, sources]) };
    },
    isMarkingPage() { return !!this._paper(); },
    async detectMarkingPage() {
        if (!this.shouldInitialize() || window.location.pathname !== '/exam-webapp/marking/index') return false;
        for (let i = 0; i < 40; i++) {
            if (this.isMarkingPage()) return true;
            if (this._dialog(this._root())) return false;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },
    getPaperIdentity() { return this._paper()?.identity || null; },
    getScoreInputs() {
        const panel = this._panel(this._root());
        if (!panel) return [];
        const { element, label, maxScore, roundStep } = panel;
        return [{ element, label, maxScore, roundStep, index: 0 }];
    },
    getQuestionContext() {
        const [unit] = this.getScoreInputs();
        return unit ? { question: unit.label, units: [unit] } : null;
    },
    _press(element) {
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    },
    async prepareGrading() {
        const paper = this._paper();
        this.lastFillError = '请打开一份待阅答卷，并展开爱多分打分板、选择「自动打分」';
        if (!paper?.panel.auto) return false;
        if (paper.panel.auto.classList.contains('active')) {
            this._press(paper.panel.auto);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        const current = this._paper();
        if (current?.identity !== paper.identity || !current.panel.auto || current.panel.auto.classList.contains('active')) return false;
        this.lastFillError = '';
        return true;
    },
    async gatherAnswerImages() {
        this._collected = this._paper();
        return this._collected?.urls.slice() || [];
    },
    async fetchImageAsBase64(url, signal) {
        const paper = EiduoAdapter._collected;
        if (!paper?.urls.includes(url) || EiduoAdapter.getPaperIdentity() !== paper.identity) throw new Error('当前答卷已变化，请重新批改');
        const base64 = await fetchImageAsBase64(url, signal);
        if (signal?.aborted || EiduoAdapter.getPaperIdentity() !== paper.identity) throw new Error('当前答卷已变化，请重新批改');
        return base64;
    },
    fillScores(scores) {
        this._filled = null;
        const paper = this._paper(), score = scores?.[0];
        this.lastFillError = '请核对当前答卷、打分步长和自动提交设置后重试';
        if (!paper || this._collected?.identity !== paper.identity || !Array.isArray(scores) || scores.length !== 1
            || !Number.isFinite(score) || score < 0 || score > paper.panel.maxScore) return false;
        const { auto, dashboard, element } = paper.panel;
        if (!auto || auto.classList.contains('active')) return false;
        element.focus();
        const buttons = [...dashboard.querySelectorAll('.bd > span')];
        const choices = buttons.filter(button => button.textContent.trim() === String(score) && this._visible(button));
        if (choices.length !== 1 || this.getPaperIdentity() !== paper.identity) return false;
        // The input event starts the platform's submission timer. The score board respects the auto-submit switch.
        this._press(choices[0]);
        if (element.value === '' || Number(element.value) !== score || this.getPaperIdentity() !== paper.identity) return false;
        this._filled = { ...paper, score };
        this.lastFillError = '';
        return true;
    },
    async submitGrade(guard = {}) {
        const filled = this._filled, paper = this._paper();
        this.lastSubmitError = '无法确认爱多分已保存该分数，请核对原站进度';
        if (!filled || this._submitting || paper?.identity !== filled.identity || guard.signal?.aborted
            || guard.isCurrent?.() === false || !paper.panel.auto || paper.panel.auto.classList.contains('active')
            || paper.panel.element.value === '' || Number(paper.panel.element.value) !== filled.score
            || paper.panel.element.classList.contains('ng-invalid') || paper.panel.button.disabled
            || paper.root.querySelector('.mark-container .score.active')) return false;
        this._filled = null;
        this._submitted = null;
        this._submitting = true;
        try {
            paper.panel.button.click();
            let saved = false;
            const deadline = performance.now() + 60_000;
            do {
                if (guard.signal?.aborted || this.getTaskIdentifier() !== filled.task) return false;
                const receipt = paper.root.querySelector('.mark-container .score.active');
                const score = /^得分[：:]\s*(\d+(?:\.\d+)?)$/.exec(receipt?.textContent.trim() || '');
                saved ||= !!score && Number(score[1]) === filled.score;
                const dialog = this._dialog(paper.root);
                if (dialog) {
                    if (!saved || !/^当前题块(?:所有任务|目标任务量)已完成/.test(dialog)) return false;
                    this._submitted = { completed: true, filled };
                    return true;
                }
                const next = this._paper();
                if (saved && next?.root === paper.root && next.paperKey !== filled.paperKey && next.panel.element.value === ''
                    && next.progress.marked === paper.progress.marked + 1) {
                    this._submitted = { completed: false, filled, nextIdentity: next.identity };
                    return true;
                }
                await new Promise(resolve => setTimeout(resolve, 80));
            } while (performance.now() < deadline);
            return false;
        } finally {
            this._submitting = false;
        }
    },
    isGradingTaskComplete() {
        return this._submitted?.completed === true && this.getTaskIdentifier() === this._submitted.filled.task;
    },
    async waitForNextPaper(_oldImageUrl, guard = {}) {
        const result = this._submitted;
        return !!result && !result.completed && !guard.signal?.aborted
            && (!guard.taskId || guard.taskId === result.filled.task)
            && (!guard.paperId || guard.paperId === result.filled.identity)
            && this.getPaperIdentity() === result.nextIdentity;
    },
};

if (EiduoAdapter.shouldInitialize()) window.__AI_MARKER_ADAPTER__ = EiduoAdapter;
