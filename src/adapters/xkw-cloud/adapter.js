const XKW_CLOUD_PATH = '/static-v2/exam/index.html';
const XKW_CLOUD_IMAGES = 'yyj-xkw-1357989693.cos.ap-beijing.myqcloud.com';

const XkwCloudAdapter = {
    name: '学科网云阅卷',
    id: 'xkw-cloud',
    iconUrl: '',
    urlPatterns: [`https://xycp.xkw.com${XKW_CLOUD_PATH}*`],

    _window() { return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window; },
    _store() { return this._window().document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store; },
    shouldInitialize() {
        const { hostname, pathname, protocol } = window.location;
        return protocol === 'https:' && hostname === 'xycp.xkw.com' && pathname === XKW_CLOUD_PATH;
    },
    _route() {
        if (!this.shouldInitialize()) return null;
        const [path, query] = window.location.hash.split('?');
        return path === '#/marking/grading' ? new URLSearchParams(query) : null;
    },
    isRegradeMode() {
        const route = this._route(), state = this._store()?.state.mark;
        return route?.get('review') === 'true' || route?.get('markReview') === 'true'
            || route?.get('readonly') === 'true' || !!(state?.feedBack || state?.markReview
                || state?.reviewProps?.review || state?.reviewProps?.readonly);
    },
    isMarkingPage() { return !!this.getTaskIdentifier(); },
    async detectMarkingPage() { return this.isMarkingPage() && !this.isRegradeMode(); },
    getTaskIdentifier() {
        const route = this._route();
        const question = route?.get('questionId'), index = route?.get('choiceIndex'), school = route?.get('isSchool');
        return route?.get('thisType') === '2' && /^\d+$/.test(question || '') && /^\d+$/.test(index || '')
            && ['0', '1'].includes(school) ? JSON.stringify([this.id, question, index, school]) : '';
    },
    getGradingTaskIdentifier() { return this.getTaskIdentifier(); },

    _visible(element) {
        return !!element?.getClientRects().length && this._window().getComputedStyle(element).visibility === 'visible';
    },
    _gradePanel() {
        const task = this.getTaskIdentifier(), store = this._store(), state = store?.state.mark;
        if (!task || !state || this.isRegradeMode() || state.isTask || state.batchGrading || state.haveJoin
            || state.IsSubItemscoring || state.areaMark || ![1, 2].includes(Number(state.markingType))) return null;
        const route = this._route(), paper = state.readOverInfo, question = paper?.questions?.[0];
        if (String(state.dataType) !== '2' || String(state.choiceIndex) !== route.get('choiceIndex')
            || state.SchoolMark !== (route.get('isSchool') === '0') || paper?.questions?.length !== 1
            || String(paper.questionId) !== route.get('questionId') || String(question.questionId) !== String(paper.questionId)) return null;
        const label = paper.markPageTilteInfo?.questionName?.trim(), maxScore = Number(question.score);
        if (!label || !Number.isFinite(maxScore) || maxScore <= 0 || typeof question.markValues !== 'string') return null;
        const d = this._window().document;
        const panels = Array.from(d.querySelectorAll('.givescorebox.pb12')).filter(el => this._visible(el));
        if (panels.length !== 1) return null;
        const panel = panels[0], element = panel.querySelector('input[placeholder="请给分"]');
        const title = panel.querySelector('.questiontitle')?.textContent.trim();
        if (!this._visible(element) || title !== `${label}(${maxScore}分)`) return null;
        const markValues = question.markValues.trim();
        const allowedScores = markValues ? markValues.split(',').map(value => Number(value.trim() || NaN)) : [];
        if (allowedScores.some(value => !Number.isFinite(value) || value < 0 || value > maxScore)) return null;
        const step = Number(panel.querySelector('.stepmine input')?.value || question.step);
        const roundStep = !allowedScores.length && step >= 0.01 && step <= 10 ? step : undefined;
        return { task, store, state, paper, panel, allowedScores, unit: { label, maxScore, roundStep, element, index: 0 } };
    },
    getQuestionContext() {
        const unit = this._gradePanel()?.unit;
        return unit ? { question: unit.label, units: [{ label: unit.label, maxScore: unit.maxScore }] } : null;
    },
    getScoreInputs() {
        const unit = this._gradePanel()?.unit;
        return unit ? [unit] : [];
    },
    _paper(allowSaving = false) {
        const target = this._gradePanel();
        if (!target) return null;
        const { task, state, paper } = target;
        if (!paper.studentId || !paper.sheetId || !paper.teacherMarkType || paper.checked || paper.judged
            || Number(paper.scored) === 1 || state.isTimeout || (!allowSaving && target.panel.classList.contains('nooperate'))) return null;
        const urls = paper.urls, layout = state.urls;
        const images = Array.from(this._window().document.querySelectorAll('.svgall .svg-container .photo_bg img'));
        if (!Array.isArray(urls) || !urls.length || urls.length !== layout?.length || urls.length !== images.length) return null;
        const imageKeys = [];
        for (const [i, src] of urls.entries()) {
            let url;
            try { url = new URL(src); } catch (_) { return null; }
            if (url.protocol !== 'https:' || url.host !== XKW_CLOUD_IMAGES || url.username || url.password
                || !layout[i]?.done || layout[i].url !== url.href || images[i].currentSrc !== url.href
                || !images[i].complete || !images[i].naturalWidth || !images[i].naturalHeight || !this._visible(images[i])) return null;
            const crop = [...url.searchParams.keys()].find(key => key.startsWith('imageMogr2/')) || '';
            imageKeys.push([url.pathname, crop]);
        }
        const paperKey = JSON.stringify([String(paper.sheetId), String(paper.studentId), String(paper.teacherMarkType)]);
        const identity = JSON.stringify([task, paperKey, imageKeys]);
        return { ...target, urls: [...urls], paperKey, identity };
    },
    getPaperIdentity() { return this._paper(true)?.identity || ''; },
    _autoScoreToggle(target) {
        return target.panel.querySelector('input[type="checkbox"][value="自动给分"]');
    },
    _autoScoreOff(target) {
        if (Number(target.state.markingType) !== 2) return true;
        const toggle = this._autoScoreToggle(target);
        return toggle ? !toggle.checked : target.state.autoSubmit === false;
    },
    async prepareGrading() {
        this._collected = null;
        this.lastFillError = '请进入普通阅卷，展开一键给分或计算器给分面板，并等待答卷显示';
        const target = this._paper();
        if (!target) return false;
        const toggle = this._autoScoreToggle(target);
        if (toggle?.checked && !toggle.disabled && this._visible(toggle.closest('label'))) {
            toggle.click();
            await Promise.resolve();
        }
        const current = this._paper();
        if (current?.identity !== target.identity || !this._autoScoreOff(current)) {
            this.lastFillError = '请关闭学科网的自动给分，并核对当前答卷';
            return false;
        }
        this._collected = current;
        this.lastFillError = '';
        return true;
    },
    async gatherAnswerImages() {
        this._collected = this._paper();
        return this._collected?.urls || [];
    },
    async fetchImageAsBase64(url, signal) {
        const target = this._collected;
        if (!target?.urls.includes(url) || this.getPaperIdentity() !== target.identity) {
            throw new Error('当前答卷已变化，请重新批改');
        }
        const image = await fetchImageAsBase64(url, signal);
        if (signal?.aborted || this.getPaperIdentity() !== target.identity) {
            throw new Error('当前答卷已变化，请重新批改');
        }
        return image;
    },

    _allowsScore(target, score) {
        if (!Number.isFinite(score) || score < 0 || score > target.unit.maxScore
            || !/^\d+(?:\.\d{1,2})?$/.test(String(score))) return false;
        if (target.allowedScores.length) return target.allowedScores.includes(score);
        const step = target.unit.roundStep;
        return !step || score === target.unit.maxScore || Math.round(score * 100) % Math.round(step * 100) === 0;
    },
    fillScores(scores) {
        this._filled = null;
        const target = this._paper(), score = scores?.[0];
        this.lastFillError = '请关闭学科网的自动给分，并核对当前答卷';
        if (this._submitting || !target || target.identity !== this._collected?.identity || target.unit.element.disabled) return false;
        if (!this._autoScoreOff(target)) return false;
        if (!Array.isArray(scores) || scores.length !== 1 || !this._allowsScore(target, score)) {
            this.lastFillError = '请按平台的满分和给分档位核对题块总分';
            return false;
        }
        // Native score buttons and calculator input events can submit immediately.
        // The score mutation updates the model without triggering those handlers.
        target.store.commit('mark/SET_SCOREING', score);
        if (target.state.questionScore !== score || this.getPaperIdentity() !== target.identity) return false;
        target.unit.element.value = String(score);
        this._filled = { ...target, score };
        this.lastFillError = '';
        return true;
    },
    async submitGrade(guard = {}) {
        const filled = this._filled;
        this._filled = null;
        if (!filled || this._submitting) return false;
        this._submitting = true;
        this._submitted = null;
        this.lastSubmitError = '请在学科网云阅卷核对当前答卷的保存状态后继续';
        try {
            await guard.verify?.();
            const target = this._paper(), button = target?.panel.querySelector('button.submitscorebtn');
            if (guard.signal?.aborted || guard.isCurrent?.() === false || target?.identity !== filled.identity
                || target.unit.element !== filled.unit.element || target.state.questionScore !== filled.score
                || target.unit.element.value !== String(filled.score) || !this._allowsScore(target, filled.score)
                || !this._autoScoreOff(target)
                || !this._visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true'
                || button.textContent.trim() !== '给分') return false;
            const result = await this._confirmSave(button, filled, guard);
            if (!result) return false;
            this._submitted = { ...filled, result };
            this.lastSubmitError = '';
            return true;
        } finally { this._submitting = false; }
    },
    _confirmSave(button, filled, guard) {
        const w = this._window(), adapter = this, signal = guard.signal;
        const currentTask = guard.isCurrentTask || guard.isCurrent;
        const path = filled.state.SchoolMark ? '/v2/exam/mark/submit' : '/v2/union/mark/submit';
        const proto = w.XMLHttpRequest.prototype, originalOpen = proto.open, originalSend = proto.send;
        const candidates = new WeakSet();
        const expected = { questionId: filled.paper.questionId, choiceIndex: filled.state.choiceIndex,
            studentId: filled.paper.studentId, sheetId: filled.paper.sheetId, markCount: filled.paper.teacherMarkType,
            score: filled.score, markPageType: 'NORMAL_MARK' };
        return new Promise(resolve => {
            let request, receiptTimer, settled = false;
            const restore = () => {
                if (proto.open === open) proto.open = originalOpen;
                if (proto.send === send) proto.send = originalSend;
            };
            const finish = result => {
                if (settled) return;
                settled = true;
                clearTimeout(launchTimer);
                clearTimeout(receiptTimer);
                restore();
                request?.removeEventListener('loadend', loaded);
                signal?.removeEventListener('abort', cancelled);
                resolve(result);
            };
            const cancelled = () => finish(null);
            const loaded = () => {
                try {
                    const raw = request.responseType === 'json' ? request.response : JSON.parse(request.responseText);
                    const result = raw?.desc || raw?.data || raw;
                    if ([-2, -5].includes(Number(raw?.code))
                        || ['sessionout', 'sessionexpired', 'sessionmore'].includes(String(raw?.result))) {
                        adapter.lastSubmitError = '学科网登录已失效，请重新登录后核对已阅状态，再继续批改';
                        return cancelled();
                    }
                    if (signal?.aborted || adapter.getTaskIdentifier() !== filled.task || request.status < 200 || request.status >= 300
                        || Number(raw?.code) !== 200 || String(raw?.result) === '0'
                        || result?.success === false) return cancelled();
                    if (result?.exist === false && Number(result.resultType) === 1) return finish({ completed: true });
                    const next = result?.data;
                    // 学科网可以为同一题块的不同考生返回相同的卷面编号。
                    if (result?.exist === true && next?.sheetId && next?.studentId
                        && String(next.questionId) === String(expected.questionId)
                        && String(next.studentId) !== String(expected.studentId)
                        && Array.isArray(next.urls) && next.urls.length) {
                        return finish({ sheetId: String(next.sheetId), studentId: String(next.studentId) });
                    }
                    cancelled();
                } catch (_) { cancelled(); }
            };
            function open(method, url, ...rest) {
                const target = new URL(url, w.location.href);
                if (String(method).toUpperCase() === 'POST' && target.origin === w.location.origin && target.pathname === path) {
                    candidates.add(this);
                }
                return originalOpen.call(this, method, url, ...rest);
            }
            function send(body) {
                if (!candidates.has(this)) return originalSend.call(this, body);
                if (request || settled) return;
                let data;
                try { data = JSON.parse(body); } catch (_) {}
                const store = adapter._store(), state = store?.state?.mark, paper = state?.readOverInfo;
                const identity = adapter.getPaperIdentity();
                if (signal?.aborted || currentTask?.() === false || (identity && identity !== filled.identity)
                    || adapter.getTaskIdentifier() !== filled.task || store !== filled.store || !paper
                    || state.isTask || state.batchGrading || state.haveJoin || state.areaMark || state.isTimeout || adapter.isRegradeMode()
                    || String(paper.questionId) !== String(expected.questionId) || String(state.choiceIndex) !== String(expected.choiceIndex)
                    || String(paper.studentId) !== String(expected.studentId) || String(paper.sheetId) !== String(expected.sheetId)
                    || String(paper.teacherMarkType) !== String(expected.markCount) || state.questionScore !== filled.score
                    || data?.haveJoin !== false
                    || !Array.isArray(data.questionSubmitList) || data.questionSubmitList.length
                    || !Object.entries(expected).every(([key, value]) => String(data?.[key]) === String(value))) {
                    cancelled();
                    return;
                }
                request = this;
                clearTimeout(launchTimer);
                receiptTimer = setTimeout(cancelled, 15000);
                this.addEventListener('loadend', loaded, { once: true });
                try { return originalSend.call(this, body); }
                catch (error) { cancelled(); throw error; }
            }
            const warningSelector = '.el-message__content';
            const existingWarnings = new Set(w.document.querySelectorAll(warningSelector));
            const launchTimer = setTimeout(() => {
                const warning = Array.from(w.document.querySelectorAll(warningSelector)).find(message =>
                    !existingWarnings.has(message) && /^批阅过快，请查阅至少\d+秒后再进行给分$/.test(message.textContent.trim()));
                if (warning) adapter.lastSubmitError = '请按学科网提示查阅答卷，达到规定时间后再给分';
                cancelled();
            }, 2500);
            signal?.addEventListener('abort', cancelled, { once: true });
            try {
                if (signal?.aborted) return cancelled();
                proto.open = open;
                proto.send = send;
                button.click();
            } catch (_) { cancelled(); }
        });
    },
    isGradingTaskComplete() {
        return this._submitted?.result.completed === true && this.getTaskIdentifier() === this._submitted.task;
    },
    async waitForNextPaper(_oldImageUrl, guard = {}) {
        const submitted = this._submitted;
        if (!submitted || submitted.result.completed || (guard.paperId && guard.paperId !== submitted.identity)
            || (guard.taskId && guard.taskId !== submitted.task)) return false;
        for (let i = 0; i < 150; i++) {
            if (guard.signal?.aborted || this.getTaskIdentifier() !== submitted.task || this.isRegradeMode()) return false;
            const target = this._paper();
            if (target && target.identity !== submitted.identity && target.paperKey !== submitted.paperKey
                && String(target.paper.sheetId) === submitted.result.sheetId && String(target.paper.studentId) === submitted.result.studentId
                && (target.state.questionScore == null || target.state.questionScore === '')) return true;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    },
};

if (XkwCloudAdapter.shouldInitialize()) window.__AI_MARKER_ADAPTER__ = XkwCloudAdapter;
