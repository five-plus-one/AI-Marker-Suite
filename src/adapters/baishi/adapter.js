const BaishiAdapter = {
    name: '百师联盟',
    id: 'baishi',
    iconUrl: '',
    urlPatterns: ['https://ebs.bsedu.com/*'],

    shouldInitialize() { return window.location.hostname === 'ebs.bsedu.com'; },
    _window() { return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window; },
    _page() {
        const w = this._window();
        if (!this.shouldInitialize() || w.location.pathname !== '/mark') return null;
        const root = w.document.querySelector('.markgingBox');
        const page = root?.__vue__;
        return page?.$refs?.fullscreenElement === root && typeof page.scoreSet1 === 'function'
            && !page._isDestroyed ? page : null;
    },
    isMarkingPage() { return !!this._page(); },
    async detectMarkingPage() {
        if (this._window().location.pathname !== '/mark') return false;
        for (let i = 0; i < 50; i++) {
            if (this.isMarkingPage()) return true;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },
    isRegradeMode() { return /^\/reviewlist(?:\/|$)/.test(window.location.pathname); },

    getTaskIdentifier() {
        const page = this._page(), task = page?.taskcontent;
        const project = page?.$route?.query?.projectId;
        return project && task?.examId && task.assignmentConfigId && task.questionNumbers != null
            ? JSON.stringify([project, String(task.examId), String(task.assignmentConfigId), String(task.questionNumbers)]) : '';
    },
    getGradingTaskIdentifier() { return this.getTaskIdentifier(); },
    _visible(element) {
        return !!element?.getClientRects().length && this._window().getComputedStyle(element).visibility === 'visible';
    },
    _question(page) {
        const card = page?.taskcardObject;
        const unit = page?.submitList?.[0];
        const maxScore = Number(unit?.fullScore), label = String(unit?.questionNumber ?? '').trim();
        if (!card?.assignmentConfigId || page.submitList.length !== 1 || page.taskIndex !== 0 || !label
            || card.questionNumber !== unit.questionNumber || card.assignmentConfigId !== unit.assignmentConfigId
            || !Number.isFinite(maxScore) || maxScore <= 0 || Number(page.allscore) !== maxScore) return null;
        return { label, maxScore };
    },
    getQuestionContext() {
        const unit = this._question(this._page());
        return unit && { question: unit.label, units: [unit] };
    },
    _scoreInput(page) {
        const field = page?.$el.querySelector('input[placeholder="打分框"], .footerScore .manfenelinput input');
        return this._visible(field) ? field : null;
    },
    getScoreInputs() {
        const page = this._page(), unit = this._question(page), element = this._scoreInput(page);
        if (!unit || !element) return [];
        const step = Number(page.stepvalue);
        return [{ ...unit, element, index: 0, roundStep: step > 0 ? step : undefined }];
    },

    _paper() {
        const page = this._page(), task = this.getTaskIdentifier(), card = page?.taskcardObject;
        if (!task || !this._question(page) || !card.id || !card.teacherId
            || card.id !== page.taskCardcontent?.[0]?.id || page.taskimgIshow
            || page.tasknumIshow || page.nodefalutcardIshow) return null;
        const images = Array.from(page.$el.querySelectorAll('.watchMap .imgBox img'));
        const sources = card.questionUrls;
        if (!Array.isArray(sources) || !sources.length || sources.length !== images.length) return null;
        const urls = [];
        for (const [i, image] of images.entries()) {
            let url;
            try { url = new URL(sources[i], this._window().location.href); } catch (_) { return null; }
            if (url.protocol !== 'https:' || url.username || url.password
                || !['bs-exam-bucket.oss-cn-beijing.aliyuncs.com', 'ebs.bsedu.com'].includes(url.hostname)
                || image.src !== url.href || image.currentSrc !== url.href || !this._visible(image)
                || !image.complete || !image.naturalWidth || !image.naturalHeight) return null;
            urls.push(url.href);
        }
        const paper = String(card.id);
        return { page, card, task, paper, urls, identity: JSON.stringify([task, paper, urls]) };
    },
    getPaperIdentity() { return this._paper()?.identity || null; },
    _canEdit(target) {
        const page = target?.page;
        return !!page && page.buttondisabled1 === 1 && !page.carderrorIshow && !page.imgBigshow
            && page.keydownActive !== 2 && !page.stepNumber?.length;
    },
    async prepareGrading() {
        const target = this._paper();
        const page = this._page();
        this.lastFillError = page?.submitList?.length > 1 ? '请打开单题评阅任务后再使用 AI 批改'
            : '请等待当前答卷加载完成，并使用给分板或数字键盘';
        if (!this._canEdit(target)) return false;
        if (page.autoSubmit === true) {
            const toggle = page.$el.querySelector('.stepbcbox .el-switch[role="switch"]');
            if (this._visible(toggle) && toggle.getAttribute('aria-checked') === 'true') {
                toggle.click();
                await page.$nextTick();
            }
        }
        const input = this._scoreInput(page);
        if (page.autoSubmit !== false || !input || input.disabled || input.readOnly) {
            this.lastFillError = '请展开给分板并关闭百师联盟的自动提交';
            return false;
        }
        if (this.getPaperIdentity() !== target.identity) return false;
        this.lastFillError = '';
        return true;
    },
    async gatherAnswerImages() {
        this._collected = this._paper();
        return this._collected?.urls.slice() || [];
    },
    async fetchImageAsBase64(url, signal) {
        const adapter = BaishiAdapter, target = adapter._collected;
        if (!target?.urls.includes(url) || adapter.getPaperIdentity() !== target.identity) {
            throw new Error('当前答卷已变化，请重新批改');
        }
        const data = await fetchImageAsBase64(url, signal);
        if (signal?.aborted || adapter.getPaperIdentity() !== target.identity) {
            throw new Error('当前答卷已变化，请重新批改');
        }
        return data;
    },

    _allowsScore(page, value) {
        const unit = this._question(page);
        if (!unit || !Number.isFinite(value) || value < 0 || value > unit.maxScore) return false;
        if (value === unit.maxScore) return true;
        if (!Number.isInteger(value * 2)) return false;
        return page.stepvalue === '—' ? page.steplistBox?.includes(value) === true
            : Number(page.stepvalue) > 0 && value % Number(page.stepvalue) === 0;
    },
    fillScores(scores) {
        this._filled = null;
        const target = this._paper(), page = target?.page, input = this._scoreInput(page);
        this.lastFillError = '请核对当前答卷，并确认平台自动提交已关闭';
        if (!this._canEdit(target) || this._collected?.identity !== target.identity
            || page.autoSubmit !== false || !input || input.disabled || input.readOnly) return false;
        const value = scores?.[0];
        if (!Array.isArray(scores) || scores.length !== 1 || !this._allowsScore(page, value)) {
            this.lastFillError = '评分结果与平台的满分或打分步长不符，请核对评分方案';
            return false;
        }
        // 普通 input 只更新平台给分框，原生 Enter 键会直接提交。
        const w = this._window();
        const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
        setter.call(input, String(value));
        input.dispatchEvent(new w.Event('input', { bubbles: true }));
        if (this.getPaperIdentity() !== target.identity || String(page.inputvalue) !== String(value)
            || input.value !== String(value)) return false;
        this._filled = { ...target, input, value };
        this.lastFillError = '';
        return true;
    },
    async submitGrade(guard = {}) {
        const filled = this._filled;
        this._filled = null;
        if (!filled || this._submitting || guard.signal?.aborted || guard.isCurrent?.() === false) return false;
        this._submitting = true;
        this._submitted = null;
        this.lastSubmitError = '请在百师联盟核对当前答卷的保存状态后继续';
        try {
            // 平台对新取到的最后一张答卷设置了 500ms 的最短提交间隔。
            const remaining = 500 - (Date.now() - filled.page.getCardTime);
            if (filled.page.taskCardcontent.length === 1 && remaining > 0 && remaining <= 500) {
                await new Promise(resolve => setTimeout(resolve, remaining));
            }
            await guard.verify?.();
            const target = this._paper(), page = target?.page;
            const button = page?.$el.querySelector('.submitskipbox button.submitbuttonBlue, .footerScore button.submitbuttonBlue');
            if (guard.signal?.aborted || guard.isCurrent?.() === false || !this._canEdit(target)
                || target.identity !== filled.identity || page !== filled.page || page.autoSubmit !== false
                || this._scoreInput(page) !== filled.input || page.inputvalue === '' || filled.input.disabled
                || filled.input.value !== String(filled.value) || String(page.inputvalue) !== String(filled.value)
                || !this._allowsScore(page, filled.value) || !this._visible(button) || button.disabled) return false;
            if (!await this._confirmSave(button, filled, guard.signal)) return false;
            this._submitted = filled;
            this.lastSubmitError = '';
            return true;
        } catch (_) {
            return false;
        } finally {
            this._submitting = false;
        }
    },
    _confirmSave(button, filled, signal) {
        // 核对由原生按钮发出的保存回执，其他平台请求照常运行。
        const w = this._window(), adapter = this;
        const proto = w.XMLHttpRequest.prototype, originalOpen = proto.open, originalSend = proto.send;
        const candidates = new WeakSet();
        return new Promise(resolve => {
            let request;
            const finish = ok => {
                clearTimeout(timer);
                if (proto.open === open) proto.open = originalOpen;
                if (proto.send === send) proto.send = originalSend;
                signal?.removeEventListener('abort', failed);
                request?.removeEventListener('loadend', loaded);
                resolve(ok);
            };
            const failed = () => finish(false);
            const loaded = () => {
                try {
                    const result = request.responseType === 'json' ? request.response : JSON.parse(request.responseText);
                    finish(!signal?.aborted && adapter.getTaskIdentifier() === filled.task
                        && request.status >= 200 && request.status < 300 && Number(result?.code) === 200);
                } catch (_) { failed(); }
            };
            function open(method, url, ...args) {
                const target = new URL(url, w.location.href);
                if (String(method).toUpperCase() === 'PUT' && target.origin === w.location.origin
                    && target.pathname === '/stage-api/task/teacher/assignment') candidates.add(this);
                return originalOpen.call(this, method, url, ...args);
            }
            function send(body) {
                if (!request && candidates.has(this)) {
                    let payload;
                    try { payload = JSON.parse(body); } catch (_) { /* 由平台处理其他请求。 */ }
                    const units = payload?.taskTeacherAssignmentStepScoreVOS;
                    if (String(payload?.id) === filled.paper && payload.teacherId === filled.card.teacherId
                        && payload.score === filled.value && Array.isArray(units) && units.length === 1
                        && units[0]?.questionNumber === filled.card.questionNumber
                        && units[0].assignmentConfigId === filled.card.assignmentConfigId
                        && String(units[0].score) === String(filled.value)) {
                        request = this;
                        request.addEventListener('loadend', loaded, { once: true });
                    }
                }
                return originalSend.call(this, body);
            }
            const timer = setTimeout(failed, 25000);
            signal?.addEventListener('abort', failed, { once: true });
            try {
                proto.open = open;
                proto.send = send;
                button.click();
            } catch (_) { failed(); }
        });
    },
    async waitForNextPaper(_oldImageUrl, guard = {}) {
        const previous = this._submitted;
        if (!previous || (guard.paperId && guard.paperId !== previous.identity)
            || (guard.taskId && guard.taskId !== previous.task)) return false;
        for (let i = 0; i < 150; i++) {
            if (guard.signal?.aborted || this.getTaskIdentifier() !== previous.task
                || previous.page.tasknumIshow || previous.page.nodefalutcardIshow) return false;
            const target = this._paper();
            if (target && target.paper !== previous.paper && this._canEdit(target)
                && target.page.inputvalue === '') return true;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    },
};

if (BaishiAdapter.shouldInitialize()) window.__AI_MARKER_ADAPTER__ = BaishiAdapter;
