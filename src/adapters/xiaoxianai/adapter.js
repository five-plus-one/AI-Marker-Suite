// 小闲 AI：原生任务与答卷绑定，独立解码题块原图，保存历史确认后继续。
const XiaoxianaiAdapter = {
    name: '小闲 AI 网上阅卷', id: 'xiaoxianai', iconUrl: '',
    urlPatterns: ['https://ls.xiaoxianai.cn/webPaper*'],
    shouldInitialize() {
        return window.location.hostname === 'ls.xiaoxianai.cn'
            && /^\/webPaper(?:\/|$)/.test(window.location.pathname);
    },
    _window() { return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window; },
    _plain(value) { return value?.toJS ? value.toJS() : value; },
    _owner(el, predicate) {
        const key = el && Object.keys(el).find(k => k.startsWith('__reactInternalInstance$'));
        let node = key && el[key]?._currentElement?._owner;
        for (let depth = 0; node && depth < 30; depth++, node = node._currentElement?._owner) {
            if (node._instance && predicate(node._instance)) return node._instance;
        }
        return null;
    },
    _page() {
        if (!this.shouldInitialize() || window.location.pathname !== '/webPaper/newMarkPaper') { this._nativePage = null; return null; }
        const page = this._owner(this._window().document.querySelector(XIAOXIANAI_SELECTORS.INPUT),
            p => typeof p.submit === 'function' && typeof p.getQuestion === 'function');
        if (page) this._nativePage = page;
        // 原生保存后拉取下一份时会暂时卸载给分栏，任务身份仍由同一页面组件持有。
        return page || (this._nativePage?.state.showNext || this._nativePage?.state.showMask
            || this._nativePage?.state.submiting || this._nativePage?.state.showModal ? this._nativePage : null);
    },
    _visible(el) {
        if (!el?.getClientRects().length) return false;
        const style = this._window().getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    },
    _number(value) {
        if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) return null;
        return Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    },
    _task(p = this._page()) {
        const l = p?.location, q = l?.questionsInfo?.find(q => q.number === p.state.questionNum), c = q?.question_config;
        if (!l?.paperInfo?.paper_uuid || !l.ruleId || !q || !c || c.mode !== 1 || q.isGroup
            || l.oh_id || l.exam_id || !(this._number(q.score) > 0)
            || !Array.isArray(c.valid_scores) || !c.valid_scores.length
            || c.valid_scores.some(v => this._number(v) === null) || !(this._number(c.valid_step) > 0)) return null;
        return { q, c, key: JSON.stringify([l.paperInfo.paper_uuid, l.ruleId, q.number, q.score, c.valid_scores, c.valid_step,
            c.lowScoreWarning, c.lowScore, p.state.student_category]) };
    },
    getTaskIdentifier() { return this._task()?.key || null; },
    isMarkingPage() {
        const p = this._page();
        return !!p && (!!this._window().document.querySelector(XIAOXIANAI_SELECTORS.SUBMIT)
            || !!(p.state.submiting || p.state.showNext || p.state.showMask || p.state.showModal));
    },
    async detectMarkingPage() {
        for (let i = 0; i < 75; i++) {
            if (this.isMarkingPage()) return true;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },
    _state() {
        const p = this._page(), task = this._task(p), st = p?.state, w = this._window();
        if (!task || !st || st.loading || st.showMask || st.showNext || st.showModal || st.showStepModal
            || st.submiting || st.batchMode || st.mouseMode || st.quickGrading || st.reSubmit
            || st.rotateDeg !== 0 || st.handleClip !== 0 || st.subjectiveQuestionAmount !== 1
            || st.questionIndex !== st.historyQuestionList?.size - 1) return null;
        const rows = this._plain(st.currentQuestionList), row = rows?.[0];
        if (rows?.length !== 1 || !row?.uuid || !row.id || !row.image_uuid || row.number !== task.q.number
            || String(row.rule_id) !== String(p.location.ruleId) || row.mark_status !== 0 || row.abnormal
            || row.sub_scores_config?.length || this._number(row.total_score) !== this._number(task.q.score)
            || st.currentUuid !== row.uuid || !Array.isArray(row.images) || row.images.length !== 1) return null;
        const inputs = Array.from(w.document.querySelectorAll(XIAOXIANAI_SELECTORS.INPUT));
        const input = inputs[0], title = w.document.querySelector(XIAOXIANAI_SELECTORS.TITLE)?.textContent;
        if (inputs.length !== 1 || !this._visible(input) || input.disabled || input.readOnly
            || this._owner(input, v => v === p) !== p
            || !title?.replace(/\s/g, '').startsWith(`${row.number}（${row.total_score}分）`)) return null;
        const images = [];
        for (const image of row.images) {
            if (image.number !== row.number || !Array.isArray(image.urls) || !image.urls.length
                || image.effect_range?.length !== image.urls.length * 4 || image.subject_range?.length !== image.urls.length * 5) return null;
            for (let i = 0; i < image.urls.length; i++) {
                try {
                    const url = new URL(image.urls[i]);
                    const parts = url.pathname.split('/');
                    if (url.protocol !== 'https:' || url.hostname !== 'i3rx-registry.oss-cn-shanghai.aliyuncs.com' || url.port || url.username || url.password
                        || parts.length !== 7 || parts[1] !== 'papers' || parts[3] !== String(p.location.paperInfo.paper_uuid)
                        || parts[4] !== 'answers' || parts[5] !== String(row.image_uuid)
                        || !parts[6].startsWith(`${row.number}_`)) return null;
                    const effect = image.effect_range.slice(i * 4, i * 4 + 4), subject = image.subject_range.slice(i * 5, i * 5 + 5);
                    if (![...effect, ...subject].every(Number.isFinite) || effect[0] < 0 || effect[1] < 0 || effect[2] < 1 || effect[3] < 1) return null;
                    for (const key of ['OSSAccessKeyId', 'Expires', 'Signature', 'random']) url.searchParams.delete(key);
                    images.push({ url: image.urls[i], key: url.href, effect, subject });
                } catch (_) { return null; }
            }
        }
        const canvases = Array.from(w.document.querySelectorAll(XIAOXIANAI_SELECTORS.CANVAS));
        if (canvases.length !== images.length || canvases.some((canvas, i) => {
            const component = this._owner(canvas, v => typeof v.initCanvas === 'function');
            return !this._visible(canvas) || component?.props.uuid !== row.uuid || component.props.url !== images[i].url
                || component.props.index !== i || component.props.questionNum !== 0 || component.props.rotate !== 0
                || component.props.clipValue !== 0 || component.props.handleClip !== 0;
        })) return null;
        const paper = JSON.stringify([row.id, row.uuid, row.image_uuid, row.update_time]);
        const identity = JSON.stringify([task.key, paper, images.map(i => [i.key, i.effect, i.subject])]);
        return { p, w, row, task: task.key, paper, identity, input, images, maxScore: Number(row.total_score), config: task.c };
    },
    getPaperIdentity() { return this._state()?.identity || null; },
    getQuestionContext() {
        const s = this._state();
        return s ? { question: s.row.number, units: [{ label: s.row.number, maxScore: s.maxScore }] } : null;
    },
    getScoreInputs() {
        const s = this._state();
        return s ? [{ element: s.input, index: 0, label: s.row.number, maxScore: s.maxScore, roundStep: s.config.valid_step }] : [];
    },
    detectSubQuestions() { return []; },
    async prepareGrading() {
        if (this._page()?.state.quickGrading) {
            this.lastFillError = '请先关闭小闲平台的自动提交，再开始批改';
            if (typeof showToast === 'function') showToast(this.lastFillError);
            return false;
        }
        return true;
    },
    async gatherAnswerImages() {
        this._imageSnapshot = this._state();
        return this._imageSnapshot?.images.map(i => i.url) || [];
    },
    // 核心下载器会取出该函数再调用，公开入口保持固定接收者。
    fetchImageAsBase64(url, signal) { return XiaoxianaiAdapter._fetchCroppedImage(url, signal); },
    async _fetchCroppedImage(url, signal) {
        const s = this._imageSnapshot, image = s?.images.find(i => i.url === url);
        if (signal?.aborted) throw new Error('用户主动暂停');
        if (!image || this.getPaperIdentity() !== s.identity) throw new Error('答卷已切换，请重新批改');
        if (this._imageCache?.identity === s.identity && this._imageCache.values.has(url)) return this._imageCache.values.get(url);
        const bytes = await fetchImageAsBase64(url, signal);
        const result = await new Promise((resolve, reject) => {
            const img = new s.w.Image();
            img.onerror = () => reject(new Error('答卷图片加载失败，请重试'));
            img.onload = () => {
                try {
                    if (signal?.aborted) throw new Error('用户主动暂停');
                    const [ex, ey, ew, eh] = image.effect, [, sx, sy] = image.subject;
                    const x = sx < 0 ? Math.max(sx + ex, 0) : ex, y = sy < 0 ? Math.max(sy + ey, 0) : ey;
                    const width = Math.floor(ew), height = Math.floor(eh);
                    if (x + width > img.naturalWidth || y + height > img.naturalHeight) throw new Error('答题区域与原图不符，请核对当前答卷');
                    const canvas = s.w.document.createElement('canvas'); canvas.width = width; canvas.height = height;
                    canvas.getContext('2d').drawImage(img, x, y, width, height, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/png').split(',')[1]);
                } catch (error) { reject(error); }
            };
            img.src = `data:image/jpeg;base64,${bytes}`;
        });
        if (signal?.aborted) throw new Error('用户主动暂停');
        if (this.getPaperIdentity() !== s.identity) throw new Error('答卷已切换，请重新批改');
        if (this._imageCache?.identity !== s.identity) this._imageCache = { identity: s.identity, values: new Map() };
        this._imageCache.values.set(url, result);
        return result;
    },
    fillScores(scores) {
        this._filled = null; this.lastFillError = '';
        const fail = message => { this.lastFillError = message; return false; };
        const s = this._state(), value = Array.isArray(scores) && scores.length === 1 ? this._number(scores[0]) : null;
        if (!s) return fail('请使用普通单题、单份答卷的键盘给分方式，并关闭平台自动提交');
        if (value === null || value > s.maxScore || !s.config.valid_scores.map(Number).includes(value)
            || Math.abs(value / s.config.valid_step - Math.round(value / s.config.valid_step)) > 1e-8) {
            return fail('评分结果不符合本题满分或合法分值，请核对评分方案');
        }
        Object.getOwnPropertyDescriptor(s.w.HTMLInputElement.prototype, 'value').set.call(s.input, String(value));
        s.input.dispatchEvent(new s.w.Event('input', { bubbles: true }));
        if (this.getPaperIdentity() !== s.identity || this._number(s.input.value) !== value) return fail('平台未接受分数，请核对当前答卷');
        this._filled = { ...s, value };
        return true;
    },
    async submitGrade(guard = {}) {
        const f = this._filled;
        this._submittedPaper = null;
        const currentTask = () => !guard.signal?.aborted && this.shouldInitialize()
            && window.location.pathname === '/webPaper/newMarkPaper' && this._task(f?.p)?.key === f?.task
            && (!this._page() || this._page() === f?.p);
        const currentPaper = () => currentTask() && guard.isCurrent?.() !== false;
        if (!f || this._submitting || !currentPaper()) return false;
        this._submitting = true;
        try {
            // React 事件完成后再次核对原生状态；仅有输入框文字不足以提交。
            await new Promise(resolve => setTimeout(resolve, 0));
            const s = this._state(), button = s?.w.document.querySelector(XIAOXIANAI_SELECTORS.SUBMIT);
            if (!currentPaper() || !s || s.identity !== f.identity || s.input !== f.input || this._number(s.input.value) !== f.value
                || this._number(s.row.score) !== f.value || s.row.revised !== true || !this._visible(button)) return false;
            const baseline = this._plain(s.p.state.historyQuestionList);
            button.click();
            for (let poll = 0; poll < 150; poll++) {
                // 原生开始拉取下一份后，旧卷 guard 会失效；此时以运行取消、任务身份和已保存历史核对结果。
                if (!currentTask()) return false;
                const st = s.p.state, history = this._plain(st.historyQuestionList);
                if (history?.length === baseline.length + 1) {
                    const saved = history[baseline.length];
                    if (['id', 'uuid', 'rule_id', 'number', 'image_uuid'].every(k => String(saved?.[k]) === String(f.row[k]))
                        && this._number(saved.score) === f.value && saved.revised === true) {
                        this._submittedPaper = f;
                        return true;
                    }
                    return false;
                }
                if (history?.length !== baseline.length || st.showModal || st.showStepModal) return false;
                const active = this._plain(st.currentQuestionList)?.[0];
                if (active && (active.uuid !== f.row.uuid || this._number(active.score) !== f.value)) return false;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return false;
        } finally {
            this._filled = null; this._submitting = false;
            if (!this._submittedPaper) this.lastSubmitError = '未确认保存成功，请在小闲平台核对当前答卷后继续';
        }
    },
    async waitForNextPaper(_oldImageUrl, guard = {}) {
        const f = this._submittedPaper;
        if (!f || guard.paperId && guard.paperId !== f.identity || guard.taskId && guard.taskId !== f.task) return false;
        for (let poll = 0; poll < 200; poll++) {
            if (guard.signal?.aborted || this.getTaskIdentifier() !== f.task) return false;
            const s = this._state();
            if (s && s.paper !== f.paper && s.row.uuid !== f.row.uuid && s.row.id !== f.row.id) {
                try {
                    await this.gatherAnswerImages();
                    for (const image of s.images) await this.fetchImageAsBase64(image.url);
                    return !guard.signal?.aborted && this.getPaperIdentity() === s.identity;
                } catch (_) { return false; }
            }
            if (this._page()?.state.showModal) return false;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    },
    isRegradeMode() { const st = this._page()?.state; return !!st && st.questionIndex !== st.historyQuestionList?.size - 1; },
};
if (XiaoxianaiAdapter.shouldInitialize()) window.__AI_MARKER_ADAPTER__ = XiaoxianaiAdapter;
