const DCESA_NORMAL_ROUTE = /^#\/exam\/area\/([^/?#]+)\/areaMarking\/subject\/([^/?#]+)\/topicStructure\/([^/?#]+)\/markingNormal\/[^/?#]+\/([^/?#]+)\/?(?:\?[^#]*)?$/;
const DCESA_SAVE_PATH = '/exam/area/marking/normal/saveMarkingGfbbz';
const DCESA_IMAGE_HOST = 'esabj.ks3-cn-beijing.ksyuncs.com';

const DcesaAdapter = {
    name: '教学质量监测管理系统',
    id: 'dcesa',
    iconUrl: 'https://dcesa.cn/static/img/small_logo.png',
    urlPatterns: ['*://dcesa.cn/*'],

    shouldInitialize() {
        const { protocol, hostname, pathname } = window.location;
        return protocol === 'https:' && hostname === 'dcesa.cn' && pathname === '/';
    },
    _view() {
        const route = this.shouldInitialize() && DCESA_NORMAL_ROUTE.exec(window.location.hash);
        if (!route) return null;
        const page = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
        const root = page.document.querySelector('#markMain');
        const native = root?.__vue__;
        // 原站通过切换题目菜单改动当前题号，地址栏仍保留入口题号。
        const topicId = String(native?.$parent?.topicId ?? '');
        if (!native || native.$el !== root || native.markType !== 'normal' || !topicId) return null;
        const [examNo, subjectId, structureId, siteId] = route.slice(1);
        const task = JSON.stringify([examNo, subjectId, structureId, siteId, topicId]);
        return { page, root, native, examNo, subjectId, siteId, topicId, task };
    },
    getTaskIdentifier() { return this._view()?.task || ''; },
    getGradingTaskIdentifier() { return this.getTaskIdentifier(); },
    isRegradeMode() { return this._view()?.native.isBackMark === true; },
    isMarkingPage() {
        const view = this._view();
        return !!view && !view.native.isBackMark;
    },
    async detectMarkingPage() {
        for (let attempt = 0; attempt < 35; attempt++) {
            if (!this.shouldInitialize() || !DCESA_NORMAL_ROUTE.test(window.location.hash) || this.isRegradeMode()) return false;
            const view = this._view();
            if (this._paper(view) && this._scoreboard(view)) return true;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },
    _number(value) {
        if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    },
    _scoreboard(view) {
        if (!view || view.native.isBackMark || view.native.isQuickScore) return null;
        const { topic } = view.native;
        const panel = view.root.querySelector('#scorePanel');
        if (String(topic?.topicId) !== view.topicId || !MarkingPaper.visible(panel)
            || [2, 3].includes(Number(topic.scorePointMode))) return null;
        const rules = topic.gfbbzList;
        const rows = [...panel.querySelectorAll('.scorepanel-socre-row')].filter(MarkingPaper.visible);
        if (!Array.isArray(rules) || !rows.length || rules.length !== rows.length) return null;
        const units = rows.map((row, index) => {
            const rule = rules[index];
            const label = row.querySelector('.scorepanel-score-row-title')?.textContent.trim();
            const id = String(rule?.gfbbzId ?? '');
            const maxScore = this._number(rule?.fullscore);
            const roundStep = this._number(rule?.gfbbzbc);
            if (!id || !label || label !== String(rule.gfbbzName).trim() || !(maxScore > 0) || !(roundStep > 0)
                || rule.fdList?.length > 1 || !Array.isArray(rule.points)) return null;
            const choices = new Map();
            for (const button of row.querySelectorAll('.normal-marking-socrepanel-row-point a')) {
                const score = this._number(button.textContent);
                if (score === null || score < 0 || score > maxScore || choices.has(score)) return null;
                if (MarkingPaper.visible(button)) choices.set(score, button);
            }
            const allowed = rule.points.map(value => this._number(value));
            if (!choices.has(0) || !choices.has(maxScore) || choices.size !== allowed.length
                || !allowed.every(score => choices.has(score))) return null;
            return { id, label, index, maxScore, roundStep, choices };
        });
        return units.every(Boolean) ? { panel, units } : null;
    },
    getScoreInputs() {
        const units = this._scoreboard(this._view())?.units || [];
        return units.map(({ label, index, maxScore, roundStep }) => ({ label, index, maxScore, roundStep }));
    },
    getQuestionContext() {
        const question = this._view()?.native.topic?.topicName;
        const units = this.getScoreInputs();
        return question != null && String(question).trim() && units.length ? { question: String(question).trim(), units } : null;
    },
    _paper(view = this._view()) {
        if (!view || view.native.isBackMark || view.native.noTask || view.native.imageSuccess !== true) return null;
        const { topic, $refs } = view.native;
        if (String(topic?.topicId) !== view.topicId || !topic.ksid || !String(topic.secretNo ?? '').trim()) return null;
        const imageViews = $refs?.markImageItem;
        if (!Array.isArray(imageViews) || !imageViews.length || imageViews.length !== topic.images?.length) return null;
        const images = topic.images.map(item => {
            const owner = imageViews.find(entry => entry.item === item);
            const image = owner?.$el.querySelector('img.el-image__inner');
            if (!MarkingPaper.visible(image) || !image.complete || !image.naturalWidth || !image.naturalHeight) return null;
            try {
                const source = new URL(item.imageSrc, view.page.location.href);
                if (source.protocol !== 'https:' || source.username || source.password || source.port
                    || (source.hostname !== 'dcesa.cn' && source.hostname !== DCESA_IMAGE_HOST)
                    || source.href !== image.currentSrc) return null;
                let crop = null;
                if (owner.isCut && item.cordinate) {
                    crop = String(item.cordinate).split('|').map(value => this._number(value));
                    const [x, y, width, height] = crop;
                    if (crop.length !== 4 || crop.some(value => value === null) || x < 0 || y < 0 || width < 1 || height < 1
                        || x + width > image.naturalWidth || y + height > image.naturalHeight) return null;
                }
                const src = source.href;
                if (crop) source.hash = 'dcesa-crop=' + crop.join(',');
                return { src, url: source.href, crop, key: [source.origin + source.pathname, crop] };
            } catch (_) {
                return null;
            }
        });
        if (images.some(image => !image)) return null;
        const sheet = JSON.stringify([String(topic.ksid), String(topic.examPaperType ?? '')]);
        const identity = JSON.stringify([view.task, sheet, images.map(image => image.key)]);
        return { ...view, sheet, identity, images, secretNo: String(topic.secretNo), ksid: String(topic.ksid) };
    },
    getPaperIdentity() { return this._paper()?.identity || null; },
    async gatherAnswerImages() {
        this._collected = this._paper();
        return [...new Set(this._collected?.images.map(image => image.url) || [])];
    },
    async fetchImageAsBase64(url, signal) {
        const adapter = DcesaAdapter;
        const paper = adapter._collected;
        const image = paper?.images.find(item => item.url === url);
        const ensureCurrent = () => {
            if (signal?.aborted) throw new Error('用户主动暂停');
            if (!image || adapter.getPaperIdentity() !== paper.identity) throw new Error('当前答卷已切换，请重新批改');
        };
        ensureCurrent();
        const base64 = await fetchImageAsBase64(image.src, signal);
        ensureCurrent();
        if (!image.crop) return base64;
        const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes]));
        try {
            ensureCurrent();
            const [x, y, width, height] = image.crop;
            if (x + width > bitmap.width || y + height > bitmap.height) throw new Error('答题区域与原图不符，请核对当前答卷');
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(width);
            canvas.height = Math.ceil(height);
            canvas.getContext('2d').drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/png').split(',')[1];
        } finally {
            bitmap.close();
        }
    },
    _blocked(view) {
        return [...view.page.document.querySelectorAll('.el-dialog__wrapper, .el-message-box__wrapper')]
            .some(MarkingPaper.visible);
    },
    _submitButton(board) {
        return [...board.panel.querySelectorAll('button.el-button-submit')].find(button => MarkingPaper.visible(button) && !button.disabled);
    },
    prepareGrading() {
        const view = this._view();
        const board = this._scoreboard(view);
        this.lastFillError = '请打开待阅答卷，展开原站给分板并关闭「自动提交」';
        if (!board || view.native.isAutoSubmit !== false || !this._submitButton(board)
            || this._blocked(view) || !this._paper(view)) return false;
        this.lastFillError = '';
        return true;
    },
    fillScores(scores) {
        this._filled = null;
        const paper = this._paper();
        const board = this._scoreboard(paper);
        this.lastFillError = '请核对当前答卷，并确认原站「自动提交」已关闭';
        if (!board || this._collected?.identity !== paper.identity || this._submitting
            || paper.native.isAutoSubmit !== false || !this._submitButton(board) || this._blocked(paper)) return false;
        const values = Array.isArray(scores) && scores.length === board.units.length
            ? board.units.map((unit, index) => ({ id: unit.id, score: scores[index], button: unit.choices.get(scores[index]) })) : [];
        if (!values.length || values.some(value => !value.button)) {
            this.lastFillError = '评分结果与原站可选分值不符，请核对评分方案';
            return false;
        }
        for (const value of values) {
            if (paper.native.isAutoSubmit !== false || this.getPaperIdentity() !== paper.identity) return false;
            value.button.click();
        }
        if (this.getPaperIdentity() !== paper.identity || !this._scoresMatch(paper.native.topic.gfbbzList, values)) return false;
        this._filled = { paper, values };
        this.lastFillError = '';
        return true;
    },
    _scoresMatch(rules, values) {
        return Array.isArray(rules) && rules.length === values.length && values.every(({ id, score }, index) =>
            String(rules[index]?.gfbbzId) === id && this._number(rules[index]?.score) === score);
    },
    async submitGrade(guard = {}) {
        if (this._submitting) return false;
        const filled = this._filled;
        this._filled = null;
        this._submitted = null;
        this.lastSubmitError = '请在原站核对本份答卷的保存结果后继续';
        const paper = this._paper();
        const board = this._scoreboard(paper);
        const button = board && this._submitButton(board);
        if (!filled || !button || paper.identity !== filled.paper.identity || paper.native !== filled.paper.native
            || guard.signal?.aborted || guard.isCurrent?.() === false || paper.native.isAutoSubmit !== false || this._blocked(paper)
            || !this._scoresMatch(paper.native.topic.gfbbzList, filled.values)) return false;

        this._submitting = true;
        try {
            if (!await this._watchSave(paper, button, filled.values, guard.signal)) return false;
            this._submitted = paper;
            this.lastSubmitError = '';
            return true;
        } finally {
            this._submitting = false;
        }
    },
    _watchSave(paper, button, values, signal) {
        // 原站并行发出保存和取卷请求，换卷不能作为保存回执。
        const prototype = paper.page.XMLHttpRequest.prototype;
        const originalOpen = prototype.open;
        const originalSend = prototype.send;
        const adapter = this;
        const candidates = new WeakSet();
        return new Promise(resolve => {
            let request;
            function restore() {
                if (prototype.open === open) prototype.open = originalOpen;
                if (prototype.send === send) prototype.send = originalSend;
            }
            function finish(ok = false) {
                clearTimeout(timer);
                restore();
                signal?.removeEventListener('abort', cancelled);
                request?.removeEventListener('loadend', loaded);
                resolve(ok);
            }
            function cancelled() { finish(); }
            function loaded() {
                try {
                    const result = request.responseType === 'json' ? request.response : JSON.parse(request.responseText);
                    const view = adapter._view();
                    finish(!signal?.aborted && request.status === 200 && Number(result?.code) === 1000
                        && view?.native === paper.native && view.task === paper.task && !view.native.isBackMark);
                } catch (_) {
                    finish();
                }
            }
            function open(method, url, ...args) {
                candidates.delete(this);
                try {
                    const target = new URL(url, paper.page.location.href);
                    if (String(method).toUpperCase() === 'POST' && target.origin === paper.page.location.origin
                        && target.pathname === DCESA_SAVE_PATH) candidates.add(this);
                } catch (_) {}
                return originalOpen.call(this, method, url, ...args);
            }
            function send(body) {
                if (!request && candidates.has(this)) {
                    let payload;
                    try { payload = JSON.parse(body); } catch (_) {}
                    if (String(payload?.ksdyNo) === paper.examNo && String(payload?.subjectId) === paper.subjectId
                        && String(payload?.pjdId) === paper.siteId && String(payload?.topicId) === paper.topicId
                        && String(payload?.ksid) === paper.ksid && String(payload?.secretNo) === paper.secretNo
                        && adapter._scoresMatch(payload.gfbbzList, values)) {
                        request = this;
                        request.addEventListener('loadend', loaded, { once: true });
                        restore();
                    }
                }
                return originalSend.call(this, body);
            }
            const timer = setTimeout(cancelled, 25_000);
            signal?.addEventListener('abort', cancelled, { once: true });
            try {
                prototype.open = open;
                prototype.send = send;
                button.click();
            } catch (_) {
                finish();
            }
        });
    },
    isGradingTaskComplete() {
        const view = this._view();
        return !!view && view.task === this._submitted?.task && !view.native.isBackMark && view.native.noTask
            && MarkingPaper.visible(view.root.querySelector('.normal-marking-left-content-notask'));
    },
    async waitForNextPaper(_oldImageUrl, guard = {}) {
        const previous = this._submitted;
        if (!previous || (guard.paperId && guard.paperId !== previous.identity) || (guard.taskId && guard.taskId !== previous.task)) return false;
        const deadline = performance.now() + 25_000;
        while (!guard.signal?.aborted && performance.now() < deadline) {
            const view = this._view();
            if (view?.task !== previous.task || view.native.isBackMark || this.isGradingTaskComplete()) return false;
            const next = this._paper(view);
            const board = this._scoreboard(next);
            if (board && next.sheet !== previous.sheet && next.native.isAutoSubmit === false && !this._blocked(view)
                && next.native.topic.gfbbzList.every(rule => this._number(rule.score) === null)) return true;
            try { await abortableGradingDelay(100, guard.signal); } catch (_) { return false; }
        }
        return false;
    },
};

if (DcesaAdapter.shouldInitialize()) window.__AI_MARKER_ADAPTER__ = DcesaAdapter;
