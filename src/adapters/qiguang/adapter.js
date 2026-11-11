// 启光优测：单份键盘阅卷。背景图为作答，画布只承载批注。
const QiguangAdapter = {
    name: '启光优测',
    id: 'qiguang',
    urlPatterns: ['*://120.78.5.37/*'],
    iconUrl: '',

    shouldInitialize() {
        return window.location.hostname === '120.78.5.37'
            && /^\/OraOnlineCheck\/OraCheck\/Review\/?$/i.test(window.location.pathname);
    },

    _visible(el) {
        if (!el || !el.getClientRects().length) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    },

    isMarkingPage() {
        return this.shouldInitialize() && this._visible(document.querySelector('#scoring-item'))
            && !!document.querySelector('#form-scoring input[name="score"]')
            && !!document.querySelector('#btn-submit-score');
    },

    async detectMarkingPage() { return this.isMarkingPage(); },

    getTaskIdentifier() {
        const params = new URLSearchParams(window.location.search);
        return `qiguang_${params.get('SubjectId') || ''}_${params.get('questionGroupId') || ''}`;
    },

    _imageUrl() {
        const canvas = document.querySelector('#scoring-item');
        if (!this._visible(canvas)) return '';
        const bg = getComputedStyle(canvas).backgroundImage || '';
        const match = bg.match(/^url\(["']?(.+?)["']?\)$/);
        if (!match) return '';
        try {
            const url = new URL(match[1], window.location.href);
            return /^https?:$/.test(url.protocol) ? url.href : '';
        } catch (_) { return ''; }
    },

    _imageKey(url) {
        try {
            const parsed = new URL(url, window.location.href);
            // 平台仅用 t 刷新缓存；其他参数仍可能标识题块，保留。
            parsed.searchParams.delete('t');
            return parsed.href;
        } catch (_) { return ''; }
    },

    getPaperIdentity() {
        const paper = document.querySelector('#paperID');
        const id = paper?.textContent?.match(/试卷ID\s*[：:]\s*(\S+)/i)?.[1];
        const image = this._imageUrl();
        return id && image ? `${id}|${this._imageKey(image)}` : null;
    },

    async gatherAnswerImages() {
        if (!this.isMarkingPage()) return [];
        const image = this._imageUrl();
        return image && this.getPaperIdentity() ? [image] : [];
    },

    async fetchImageAsBase64(url) { return fetchImageAsBase64(url); },

    _keyboardMode() {
        const mode = document.querySelector('input[name="operateTypeCheck"]:checked');
        const params = new URLSearchParams(window.location.search);
        return mode?.value === '0' && params.get('IsAutoReview') !== '1'
            && !this._visible(document.querySelector('#rightWrongModelCanvasDiv'));
    },

    getScoreInputs() {
        if (!this.isMarkingPage() || !this._keyboardMode()) return [];
        const elements = Array.from(document.querySelectorAll('#form-scoring input[name="score"]'))
            .filter(el => this._visible(el));
        if (elements.some(el => el.disabled || el.readOnly)) return [];
        const ids = new Set();
        const units = [];
        for (const el of elements) {
            const id = el.getAttribute('data-id');
            const rawMax = el.getAttribute('data-max');
            const maxScore = rawMax?.trim() ? Number(rawMax) : NaN;
            // 重复题号或缺少题目边界时，不推测评分项。
            if (!id || ids.has(id) || !Number.isFinite(maxScore) || maxScore <= 0) return [];
            ids.add(id);
            const raw = el.getAttribute('data-fullscore');
            const scores = raw ? raw.split(',').map(s => s.trim() ? Number(s) : NaN) : null;
            if (scores && scores.some(n => !Number.isFinite(n) || n < 0 || n > maxScore)) return [];
            units.push({ element: el, label: el.getAttribute('data-questionno') || `第${units.length + 1}题`,
                index: units.length, maxScore, scores, questionId: id });
        }
        return units;
    },

    _validate(scores, inputs) {
        return Array.isArray(scores) && inputs.length > 0 && scores.length === inputs.length
            && scores.every((s, i) => {
                if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > inputs[i].maxScore) return false;
                return inputs[i].scores ? inputs[i].scores.some(n => Math.abs(n - s) < 1e-8)
                    : Math.abs(s * 10 - Math.round(s * 10)) < 1e-8;
            });
    },

    _notify(message) { if (typeof showToast === 'function') showToast(message); },

    fillScores(scores) {
        this._pending = null;
        if (!this._keyboardMode()) {
            this._notify('请切换到单份键盘给分后再开始批改');
            return false;
        }
        if (document.querySelector('input[name="autoSubmit"]:checked')) {
            this._notify('请先关闭平台的“打分后自动提交”');
            return false;
        }
        const inputs = this.getScoreInputs();
        const identity = this.getPaperIdentity();
        if (!identity || !this._validate(scores, inputs)) {
            this._notify('分数与当前题目的满分或给分档位不符，请检查评分设置');
            return false;
        }
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        for (let i = 0; i < inputs.length; i++) {
            if (this.getPaperIdentity() !== identity) return false;
            setter.call(inputs[i].element, String(scores[i]));
            // 平台 input 事件同步鼠标给分区并启用提交按钮，不发送键盘事件。
            inputs[i].element.dispatchEvent(new Event('input', { bubbles: true }));
            inputs[i].element.dispatchEvent(new Event('blur', { bubbles: true }));
        }
        if (!this._matches(inputs, scores, identity)) return false;
        this._pending = { inputs, scores: scores.slice(), identity, task: this.getTaskIdentifier() };
        return true;
    },

    _matches(inputs, scores, identity) {
        const current = this.getScoreInputs();
        return this.getPaperIdentity() === identity && current.length === inputs.length
            && current.every((unit, i) => unit.element === inputs[i].element
                && unit.questionId === inputs[i].questionId && unit.maxScore === inputs[i].maxScore
                && unit.element.value.trim() !== '' && Number(unit.element.value) === scores[i])
            && this._validate(scores, current);
    },

    async submitGrade(guard) {
        const pending = this._pending;
        this._pending = null;
        if (!pending || (guard && !guard.isCurrent())) return false;
        if (guard) await guard.verify();
        if ((guard && !guard.isCurrent()) || pending.task !== this.getTaskIdentifier()
            || document.querySelector('input[name="autoSubmit"]:checked')
            || !this._matches(pending.inputs, pending.scores, pending.identity)) return false;
        const button = document.querySelector('#btn-submit-score');
        if (!this._visible(button) || button.disabled) return false;
        const previousCount = document.querySelector('#myRead')?.textContent?.trim();
        const existingSuccess = new Set(Array.from(document.querySelectorAll('.layui-layer-content'))
            .filter(el => this._visible(el) && el.textContent.trim() === '评阅成功'));
        button.click();
        // 平台仅在成功响应后更新已阅量并显示“评阅成功”。禁用按钮本身不是成功证据。
        for (let i = 0; i < 100; i++) {
            const count = document.querySelector('#myRead')?.textContent?.trim();
            if (previousCount && count && Number(count) > Number(previousCount)) return true;
            const success = Array.from(document.querySelectorAll('.layui-layer-content'))
                .some(el => !existingSuccess.has(el) && this._visible(el) && el.textContent.trim() === '评阅成功');
            if (success) return true;
            if (guard?.signal?.aborted) return false;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        this._notify('未确认提交结果，请在阅卷平台检查后继续');
        return false;
    },

    async waitForNextPaper(oldImageUrl) {
        const oldKey = this._imageKey(oldImageUrl);
        if (!oldKey) return false;
        for (let i = 0; i < 125; i++) {
            const current = this._imageUrl();
            if (this.isMarkingPage() && current && this._imageKey(current) !== oldKey && this.getPaperIdentity()) return true;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return false;
    },

    isRegradeMode() {
        return document.querySelector('#btn-set-exception')?.textContent?.trim() === '退出回评';
    }
};

if (QiguangAdapter.shouldInitialize() && !window.__AI_MARKER_ADAPTER__) {
    window.__AI_MARKER_ADAPTER__ = QiguangAdapter;
}
