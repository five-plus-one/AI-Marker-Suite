// ========== AMEQP 网上评卷适配器 ==========
// 支持内网裸 IP 部署（hostname 不固定），通过路径 + DOM 五特征识别平台
// 阅卷在弹出窗口 mar_mark.aspx 中进行
//
// 平台结构要点：
// - 答题卡 img.ansImg 是整张扫描图，在 .img_box 视口里用负偏移裁剪显示当前题块
// - 分数框 input.mark_tbx[maxsco]（id 形如 txt_que_N），平台用 hidden MarQueSubSco_N / #queVal 记录已给分
// - 提交走 OnSubmit(1)，校验 hidden 字段判断"是否给分"，只改输入框 value 不够

const AmeqpAdapter = {
    name: 'AMEQP网上评卷',
    id: 'ameqp',
    urlPatterns: ['*://*/AMEQP/Webroot/mar/*'],
    iconUrl: '',

    _pendingScores: null,
    _submittedPaper: null,
    _collectedPaper: null,
    _submitting: false,

    // ---------- 内部工具 ----------

    // 去掉 ?t= 缓存戳，得到稳定图片路径
    _stripQuery(url) {
        return (url || '').split('?')[0];
    },

    // 已验证的文件名格式为 考号_数字_数字_数字.图片扩展名。
    // 缓存参数与目录不参与考号；其他地址格式不能把共有前缀当作答卷标识。
    _paperIdFromSrc(src) {
        try {
            const url = new URL(src);
            if (!/^https?:$/.test(url.protocol)) return null;
            const file = decodeURIComponent(url.pathname.split('/').pop() || '');
            const match = file.match(/^(\d+)_\d+_\d+_\d+\.(?:png|jpe?g|bmp|gif|webp|tiff?|svg)$/i);
            return match ? match[1] : null;
        } catch (_) {
            return null;
        }
    },

    _resourceKey(img) {
        try {
            // 空 src 的 DOM 属性会解析为当前页面，不能用它证明存在答卷。
            const raw = img.getAttribute('src');
            if (!String(raw == null ? img.src || '' : raw).trim()) return null;
            const url = new URL(raw == null ? img.src : raw, window.location.href);
            if (!/^https?:$/.test(url.protocol)) return null;
            url.hash = '';
            // t 是已确认的 AMEQP 缓存戳；其余参数可能选择不同答卷，必须保留。
            url.searchParams.delete('t');
            return url.href;
        } catch (_) { return null; }
    },

    // 稳定试卷标识（供答卷一致性校验做强信号比对）
    getPaperIdentity() {
        try {
            const images = this._answerImages();
            const keys = images.map(img => this._resourceKey(img));
            if (!keys.length || keys.some(key => !key)) return null;
            const ids = keys.map(key => this._paperIdFromSrc(key));
            // 单张扫描图也可能以学科名、UUID 或图片接口命名，完整资源地址可区分答卷。
            if (images.length === 1 && !ids[0]) return 'ameqp-resource:' + keys[0];
            // 多题块仍须有共同卷号；混合答卷与未知分组不作猜测。
            if (!ids[0] || !ids.every(id => id === ids[0])) return null;
            return keys.some(key => new URL(key).search) ? JSON.stringify([ids[0], keys]) : ids[0];
        } catch (e) {
            return null;
        }
    },

    _answerImages() {
        return Array.from(document.querySelectorAll(AMEQP_SELECTORS.ANSWER_IMAGE));
    },

    _scoreInputs() {
        return Array.from(document.querySelectorAll(AMEQP_SELECTORS.SCORE_INPUT));
    },

    // 从 txt_que_N / txt_que_1_1 提取内部序号（必须抓全双段编号，#278：
    // 旧正则 /txt_que_(\d+)/ 对 txt_que_1_1 只截到 "1"，导致隐藏字段同步成为空操作）
    _indexOf(el) {
        const m = (el.name || el.id || '').match(/^txt_que_(\d+(?:_\d+)?)$/);
        return m ? m[1] : null;
    },

    // DOM 五特征：#Mark_main + img.ansImg + input.mark_tbx[maxsco] + #btn_submit.mark_btn + #queSco_all
    // 内网多系统共存，必须五者同时成立才认平台，防止通配串台
    _hasDomSignature() {
        return !!(
            document.querySelector(AMEQP_SELECTORS.PAGE_MAIN) &&
            document.querySelector(AMEQP_SELECTORS.ANSWER_IMAGE) &&
            document.querySelector('input.mark_tbx[maxsco]') &&
            document.querySelector('input#btn_submit.mark_btn') &&
            document.querySelector(AMEQP_SELECTORS.PAGE_QUE_TOTAL)
        );
    },

    _isPathMatch() {
        return /^\/AMEQP\/Webroot\/mar\//i.test(window.location.pathname);
    },

    // 平台记分值的规范格式：与给分列表一致的 X.X（"4.0"）。实测写 "4" 不被记分登记（#278）
    _fmt(v) {
        const num = Number(v);
        return isFinite(num) ? num.toFixed(1) : String(v);
    },

    // 点击平台给分列表对应档位（span.sco_list[value="4.0"]）——
    // 这是人手打分的原生记分链路，会触发平台自己的登记处理（#278）
    _clickScoreOption(n, v) {
        if (!n) return false;
        try {
            const span = document.querySelector(`#Mark_scoList_${n} span.sco_list[value="${this._fmt(v)}"]`);
            if (span) {
                span.click();
                return true;
            }
        } catch (e) {
            console.warn('[AMEQP] 给分列表点击失败:', e);
        }
        return false;
    },

    // 将单个分数写入输入框并触发平台记分事件（含按键事件，#278：
    // 平台登记处理可能绑定 keyup 等按键事件，旧实现只发 input/change/blur 不够）
    _setInputValue(el, v, isCurrent = () => true) {
        if (!isCurrent()) return false;
        const fmt = this._fmt(v);
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, fmt);
        const types = ['keydown', 'keypress', 'input', 'keyup', 'change', 'blur'];
        for (const t of types) {
            if (!isCurrent()) return false;
            try {
                const ev = (t.indexOf('key') === 0)
                    ? new KeyboardEvent(t, { bubbles: true, cancelable: true, key: fmt })
                    : new Event(t, { bubbles: true, cancelable: true });
                el.dispatchEvent(ev);
            } catch (e) { /* 旧内核兜底 */ }
        }
        if (window.jQuery) {
            try {
                if (!isCurrent()) return false;
                const $el = window.jQuery(el);
                $el.val(fmt);
                for (const t of types) {
                    if (!isCurrent()) return false;
                    $el.trigger(t);
                }
            } catch (e) {
                console.warn('[AMEQP] jQuery trigger 失败:', e);
            }
        }
        return isCurrent();
    },

    // 同步平台内部状态字段与记分视觉态（OnSubmit 靠这些判断"已给分"，#278）
    _syncPlatformState(n, v) {
        const fmt = this._fmt(v);
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        if (n) {
            const sub = document.querySelector(`#${AMEQP_SELECTORS.SUB_SCORE_HIDDEN}${n}`);
            if (sub) setter.call(sub, fmt);
            // 镜像平台记分视觉态：隐藏"本题尚未给分"红字
            const msg = document.querySelector(`#${AMEQP_SELECTORS.SCORE_MSG}${n}`);
            if (msg) msg.style.display = 'none';
        }
        // 重算总分显示
        let total = 0;
        this._scoreInputs().forEach(el => {
            total += parseFloat(el.value) || 0;
        });
        const queVal = document.querySelector(AMEQP_SELECTORS.QUE_VAL);
        const queValOld = document.querySelector(AMEQP_SELECTORS.QUE_VAL_OLD);
        const t = String(Math.round(total * 10) / 10);
        if (queVal) setter.call(queVal, t);
        if (queValOld) setter.call(queValOld, t);
    },

    // 把 img 在 .img_box 视口内的可视区域裁成 dataURL（题块图，而非整张答题卡）
    _cropToViewport(img) {
        try {
            if (!img.naturalWidth || !img.naturalHeight) return null;
            const box = img.closest(AMEQP_SELECTORS.IMAGE_BOX) || img.parentElement;
            if (!box) return null;
            const boxRect = box.getBoundingClientRect();
            const imgRect = img.getBoundingClientRect();
            if (imgRect.width < 1 || imgRect.height < 1) return null;

            // 显示坐标 → 原图坐标的缩放比
            const scale = img.naturalWidth / imgRect.width;
            // 可视窗口在图片显示坐标系中的位置（图片被负偏移推到窗口外）
            let sx = (boxRect.left - imgRect.left) * scale;
            let sy = (boxRect.top - imgRect.top) * scale;
            let sw = boxRect.width * scale;
            let sh = boxRect.height * scale;

            // 裁剪范围夹紧到原图边界
            sx = Math.max(0, Math.min(sx, img.naturalWidth - 1));
            sy = Math.max(0, Math.min(sy, img.naturalHeight - 1));
            sw = Math.max(1, Math.min(sw, img.naturalWidth - sx));
            sh = Math.max(1, Math.min(sh, img.naturalHeight - sy));

            const canvas = document.createElement('canvas');
            canvas.width = Math.round(sw);
            canvas.height = Math.round(sh);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/png');
            console.log(`[AMEQP] 题块裁切: 原图 ${img.naturalWidth}x${img.naturalHeight} → 可视区 ${canvas.width}x${canvas.height}`);
            return dataUrl;
        } catch (e) {
            console.warn('[AMEQP] 裁切失败（可能跨域污染），回退整图:', e.message);
            return null;
        }
    },

    // ---------- 生命周期 ----------

    shouldInitialize() {
        return this._hasDomSignature();
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器
    isMarkingPage() {
        return this._hasDomSignature();
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage() && !this._hasDomSignature()) {
            console.log('[AMEQP] 当前不在阅卷页面 (pathname:', window.location.pathname, ')');
            return false;
        }

        console.log('[AMEQP] 开始检测批改页面...');
        try {
            await waitForElement(AMEQP_SELECTORS.ANSWER_IMAGE, 10000);
            await waitForElement(AMEQP_SELECTORS.SCORE_INPUT, 5000);

            const detected = this._hasDomSignature();
            console.log('[AMEQP] 批改页面检测结果:', detected, {
                图片: this._answerImages().length,
                分数框: this._scoreInputs().length,
            });
            return detected;
        } catch (error) {
            console.error('[AMEQP] detectMarkingPage 异常:', error);
            return this._hasDomSignature();
        }
    },

    // ---------- 任务标识 ----------
    // 必须只跟"题"绑定，绝不能含学生卷图片路径：
    // 图片文件名含考号（如 7720272115_00_1_0.PNG），换一份卷就会变，
    // 导致"绑定到当前试题"的 key 对不上，每次换卷都误判新试题弹 OOBE。

    getTaskIdentifier() {
        const labels = Array.from(document.querySelectorAll(AMEQP_SELECTORS.SCORE_LEGEND))
            .map(l => (l.title || l.textContent || '').trim())
            .filter(Boolean);
        if (labels.length > 0) {
            return 'ameqp#' + labels.join(',');
        }
        // DOM 未就绪时的占位（document-idle 下 legend 通常已在，兜底防抖动）
        return 'ameqp#pending';
    },

    // ---------- 图片获取 ----------

    async gatherAnswerImages() {
        // 等图片 src/解码就位（换卷后 src 异步更新）
        await new Promise(r => setTimeout(r, 800));
        // src 已变并不代表图片已解码；过渡期不返回旧画面或失败图片。
        for (let i = 0; i < 30 && !this._imagesReady(); i++) {
            await new Promise(r => setTimeout(r, 100));
        }
        if (!this._imagesReady()) {
            console.warn('[AMEQP] 作答图尚未就绪，或无法确认所有题块属于同一份答卷');
            return [];
        }
        const imgs = this._answerImages();
        const paperId = this.getPaperIdentity();
        const paths = imgs.map(img => this._resourceKey(img));

        const urls = [];
        imgs.forEach(img => {
            const src = img.src || img.getAttribute('src') || '';
            if (!src) return;
            // 优先裁切到题块可视区域（排除批注层 tmpImg，只取 ansImg）
            const cropped = this._cropToViewport(img);
            if (cropped) {
                urls.push(cropped);
            } else if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
                // 裁切失败兜底：保留整图访问参数
                urls.push(src);
            }
        });
        const current = this._answerImages();
        if (!paperId || !this._imagesReady() || this.getPaperIdentity() !== paperId
            || current.length !== imgs.length || urls.length !== imgs.length
            || current.some((img, i) => img !== imgs[i] || this._resourceKey(img) !== paths[i])) return [];
        this._collectedPaper = { id: paperId, task: this.getTaskIdentifier() };
        console.log(`[AMEQP] 找到答题卡图片: ${urls.length} 张（题块裁切，已排除批注层 tmpImg）`);
        return urls;
    },

    _imagesReady() {
        const imgs = this._answerImages();
        if (!imgs.length) return false;
        const paperId = this.getPaperIdentity();
        return !!paperId && imgs.every(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
    },

    async fetchImageAsBase64(url) {
        // 裁切产物是 dataURL，直接拆出 base64
        if (url.startsWith('data:')) {
            return url.split(',')[1] || '';
        }
        return fetchImageAsBase64(url);
    },

    // ---------- 分数输入 ----------

    getScoreInputs() {
        const inputs = [];
        this._scoreInputs().forEach((el, i) => {
            const n = this._indexOf(el);

            // 满分三重来源：maxsco 属性 → hidden #max_sco_N → legend 文本
            let maxScore = Number(el.getAttribute('maxsco'));
            if (!(maxScore > 0) && n) {
                const hidden = document.querySelector(`#max_sco_${n}`);
                if (hidden) maxScore = Number(hidden.value);
            }

            // 标签从 legend 解析题号（如 title="9(6.0分)" → 第9题）
            let label = `分数${i + 1}`;
            const fieldset = el.closest('fieldset');
            const legend = fieldset ? fieldset.querySelector(AMEQP_SELECTORS.SCORE_LEGEND) : null;
            if (legend) {
                const text = (legend.title || legend.textContent || '').trim();
                const qm = text.match(/^(\d+)/);
                if (qm) {
                    label = `第${qm[1]}题`;
                } else if (text) {
                    label = text;
                }
                if (!(maxScore > 0)) {
                    const sm = text.match(/(\d+(?:\.\d+)?)\s*分/);
                    if (sm) maxScore = parseFloat(sm[1]);
                }
            }

            inputs.push({
                element: el,
                label,
                index: inputs.length,
                maxScore: maxScore || 0,
                questionId: n,
            });
        });
        return inputs;
    },

    fillScores(scores) {
        this._pendingScores = null;
        if (this._submitting) return false;
        const inputs = this.getScoreInputs();
        const identity = this.getPaperIdentity();
        const task = this.getTaskIdentifier();
        if (!identity || !this._validScores(scores, inputs)
            || new Set(inputs.map(unit => unit.questionId)).size !== inputs.length || inputs.some(unit =>
            unit.element.disabled || unit.element.readOnly || !this._indexOf(unit.element)
            || !document.querySelector(`#${AMEQP_SELECTORS.SUB_SCORE_HIDDEN}${this._indexOf(unit.element)}`))) return false;

        for (let i = 0; i < inputs.length; i++) {
            const sameTarget = () => this.getPaperIdentity() === identity && this.getTaskIdentifier() === task
                && this._scoreInputs()[i] === inputs[i].element;
            if (!sameTarget()) return false;
            const v = scores[i];
            const el = inputs[i].element;
            const n = this._indexOf(el);
            // 三路记分（#278）：平台给分列表原生链路 → 输入框写值+全事件 → 隐藏字段同步
            this._clickScoreOption(n, v);
            if (!sameTarget()) return false;
            if (!this._setInputValue(el, v, sameTarget)) return false;
            if (!sameTarget()) return false;
            this._syncPlatformState(n, v);
        }

        const pending = { inputs, scores: scores.slice(), identity, task };
        if (!this._matchesPending(pending)) return false;
        this._pendingScores = pending;
        console.log(`[AMEQP] 填分完成并通过登记校验: ${inputs.length}/${inputs.length}`, scores);
        return true;
    },

    _validScores(scores, inputs) {
        return Array.isArray(scores) && inputs.length > 0 && scores.length === inputs.length
            && scores.every((score, i) => typeof score === 'number' && Number.isFinite(score) && score >= 0
                && Number.isFinite(inputs[i].maxScore) && inputs[i].maxScore > 0 && score <= inputs[i].maxScore
                && Math.abs(score * 10 - Math.round(score * 10)) < 1e-8);
    },

    _matchesPending(pending) {
        const inputs = this.getScoreInputs();
        return !!pending && this.getPaperIdentity() === pending.identity && this.getTaskIdentifier() === pending.task
            && this._validScores(pending.scores, inputs) && inputs.length === pending.inputs.length
            && inputs.every((unit, i) => {
                const hidden = document.querySelector(`#${AMEQP_SELECTORS.SUB_SCORE_HIDDEN}${this._indexOf(unit.element)}`);
                return unit.element === pending.inputs[i].element && unit.maxScore === pending.inputs[i].maxScore
                    && unit.questionId === pending.inputs[i].questionId
                    && !unit.element.disabled && !unit.element.readOnly
                    && String(unit.element.value).trim() !== '' && Math.abs(Number(unit.element.value) - pending.scores[i]) < 1e-8
                    && hidden && String(hidden.value).trim() !== '' && Math.abs(Number(hidden.value) - pending.scores[i]) < 1e-8;
            });
    },

    // ---------- 提交 ----------

    async submitGrade(guard) {
        if (this._submitting) return false;
        const pending = this._pendingScores;
        this._pendingScores = null;
        if (!pending || guard?.signal?.aborted || (guard && !guard.isCurrent()) || !this._matchesPending(pending)) return false;
        this._submitting = true;
        try {
            // 等原生记分事件完成；只核对本卷已填写的分数，不向新卷重新灌分。
            await new Promise(r => setTimeout(r, 350));
            if (guard) await guard.verify();
            if (guard?.signal?.aborted || (guard && !guard.isCurrent()) || !this._matchesPending(pending)) return false;
            const btn = document.querySelector(AMEQP_SELECTORS.SUBMIT_BUTTON);
            if (!btn || btn.disabled) return false;
            let platformWarn = null;
            const origAlert = window.alert;
            const captureAlert = function (msg) {
                platformWarn = String(msg ?? '');
                if (typeof origAlert === 'function') origAlert.call(window, msg);
            };
            // 在 click 前固定基准，平台可在事件内同步换卷。
            this._submittedPaper = { id: pending.identity, task: pending.task };
            try {
                window.alert = captureAlert;
                btn.click();
                await new Promise(r => setTimeout(r, 800));
                if (platformWarn !== null || guard?.signal?.aborted) {
                    this._submittedPaper = null;
                    return false;
                }
                return true;
            } finally {
                if (window.alert === captureAlert) window.alert = origAlert;
            }
        } catch (error) {
            this._submittedPaper = null;
            throw error;
        } finally {
            this._submitting = false;
        }
    },

    async waitForNextPaper(oldImageUrl, options = {}) {
        const task = this.getTaskIdentifier();
        if (options.taskId && options.taskId !== task) return false;
        const submitted = this._submittedPaper?.task === task ? this._submittedPaper.id : null;
        const collected = this._collectedPaper?.task === task ? this._collectedPaper.id : null;
        const fromUrl = /^https?:\/\//i.test(oldImageUrl || '')
            ? this.getPaperIdentityForUrl(oldImageUrl) : null;
        // 上下文/提交前/取图时的基准均早于换卷，不能以等待开始时的当前 DOM 为旧卷。
        const oldId = options.paperId || submitted || collected || fromUrl;
        if (!oldId || options.signal?.aborted) return false;
        let checkTimes = 0;
        return new Promise((resolve) => {
            let timer, settled = false;
            const finish = result => {
                if (settled) return;
                settled = true;
                clearInterval(timer);
                options.signal?.removeEventListener('abort', abort);
                resolve(result);
            };
            const abort = () => finish(false);
            const check = () => {
                if (options.signal?.aborted || this.getTaskIdentifier() !== task) return finish(false);
                const current = this.getPaperIdentity();
                if (current && current !== oldId && this._imagesReady()) return finish(true);
                if (++checkTimes > 100) finish(false);
            };
            options.signal?.addEventListener('abort', abort, { once: true });
            check();
            if (!settled) timer = setInterval(check, 200);
        });
    },

    getPaperIdentityForUrl(src) {
        const key = this._resourceKey({ src, getAttribute: () => src });
        if (!key) return null;
        const id = this._paperIdFromSrc(key);
        return id ? (new URL(key).search ? JSON.stringify([id, [key]]) : id) : 'ameqp-resource:' + key;
    },

    // ---------- 状态查询 ----------

    isRegradeMode() {
        // [回评状态] 标记可见时处于回评模式（安全兜底，回评功能暂不支持）
        const tit = document.querySelector(AMEQP_SELECTORS.REVIEW_TIT);
        if (!tit) return false;
        return !tit.classList.contains('hide') && tit.offsetParent !== null;
    },
};

(function registerAmeqpAdapter() {
    if (!AmeqpAdapter._isPathMatch() && !AmeqpAdapter.shouldInitialize()) return;
    let observer, settled = false;
    const attempt = () => {
        if (settled) return true;
        if (!AmeqpAdapter.shouldInitialize()) return false;
        const existing = window.__AI_MARKER_ADAPTER__;
        if (existing && existing !== AmeqpAdapter) {
            console.error('[注册冲突] AMEQP 检测到已有适配器，保留当前平台:', existing.id || existing.name);
        } else if (!existing) {
            window.__AI_MARKER_ADAPTER__ = AmeqpAdapter;
        }
        settled = true;
        observer?.disconnect();
        return true;
    };
    if (attempt()) return;
    const path = window.location.pathname;
    observer = new MutationObserver(() => {
        if (window.location.pathname !== path) { settled = true; observer.disconnect(); return; }
        attempt();
    });
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true,
        attributes: true, attributeFilter: ['id', 'class', 'src', 'maxsco'] });
    attempt();
})();
