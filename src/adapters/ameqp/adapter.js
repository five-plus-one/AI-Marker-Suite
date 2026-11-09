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

    // ---------- 内部工具 ----------

    // 去掉 ?t= 缓存戳，得到稳定图片路径
    _stripQuery(url) {
        return (url || '').split('?')[0];
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
        const m = (el.name || el.id || '').match(/txt_que_(\d+(?:_\d+)?)/);
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
        return /\/AMEQP\/Webroot\/mar\//i.test(window.location.pathname);
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
    _setInputValue(el, v) {
        const fmt = this._fmt(v);
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, fmt);
        const types = ['keydown', 'keypress', 'input', 'keyup', 'change', 'blur'];
        types.forEach(t => {
            try {
                const ev = (t.indexOf('key') === 0)
                    ? new KeyboardEvent(t, { bubbles: true, cancelable: true, key: fmt })
                    : new Event(t, { bubbles: true, cancelable: true });
                el.dispatchEvent(ev);
            } catch (e) { /* 旧内核兜底 */ }
        });
        if (window.jQuery) {
            try {
                const $el = window.jQuery(el);
                $el.val(fmt);
                types.forEach(t => { $el.trigger(t); });
            } catch (e) {
                console.warn('[AMEQP] jQuery trigger 失败:', e);
            }
        }
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

    // 单题登记校验：隐藏状态字段必须非空（捕捉选择器/编号失效类故障，#278）
    _isRegistered(n) {
        if (!n) return false;
        const sub = document.querySelector(`#${AMEQP_SELECTORS.SUB_SCORE_HIDDEN}${n}`);
        return !!(sub && String(sub.value).trim() !== '');
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
        // 路径特征（产品名锁在路径里，不锁 hostname）
        if (this._isPathMatch()) return true;
        // DOM 特征兜底（改名部署等场景）
        if (this._hasDomSignature()) return true;
        return false;
    },

    // 快速页面检查（不等待 DOM），用于 URL 变化监听器
    isMarkingPage() {
        return this._isPathMatch();
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
        const imgs = this._answerImages();
        // 等图片加载完成再裁切，否则 naturalWidth 为 0
        await Promise.race([
            Promise.all(imgs.map(img => (img.complete && img.naturalWidth) ? null : new Promise(res => {
                img.addEventListener('load', res, { once: true });
                img.addEventListener('error', res, { once: true });
            }))),
            new Promise(r => setTimeout(r, 3000)),
        ]);

        const urls = [];
        imgs.forEach(img => {
            const src = img.src || img.getAttribute('src') || '';
            if (!src) return;
            // 优先裁切到题块可视区域（排除批注层 tmpImg，只取 ansImg）
            const cropped = this._cropToViewport(img);
            if (cropped) {
                urls.push(cropped);
            } else if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
                // 裁切失败兜底：退回整图稳定路径
                urls.push(src.startsWith('data:') ? src : this._stripQuery(src));
            }
        });
        console.log(`[AMEQP] 找到答题卡图片: ${urls.length} 张（题块裁切，已排除批注层 tmpImg）`);
        return urls;
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
            let maxScore = parseFloat(el.getAttribute('maxsco'));
            if (!maxScore && n) {
                const hidden = document.querySelector(`#max_sco_${n}`);
                if (hidden) maxScore = parseFloat(hidden.value);
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
                if (!maxScore) {
                    const sm = text.match(/(\d+(?:\.\d+)?)\s*分/);
                    if (sm) maxScore = parseFloat(sm[1]);
                }
            }

            inputs.push({
                element: el,
                label,
                index: inputs.length,
                maxScore: maxScore || 0,
            });
        });
        return inputs;
    },

    fillScores(scores) {
        const inputs = this.getScoreInputs();
        if (inputs.length === 0) return false;

        // 数据安全：全或无（#278）——任一题缺分即整体拒绝，不留半登记状态
        for (let i = 0; i < inputs.length; i++) {
            if (scores[i] === null || scores[i] === undefined) {
                console.warn(`[AMEQP] ${inputs[i].label} 无 AI 分数（第 ${i + 1} 题缺失），拒绝填分`);
                return false;
            }
        }

        // 先暂存：submitGrade 时会重新灌一遍，防止填分与提交间隔太短导致平台没记录
        this._pendingScores = scores.slice();

        for (let i = 0; i < inputs.length; i++) {
            const v = scores[i];
            const el = inputs[i].element;
            const n = this._indexOf(el);
            // 三路记分（#278）：平台给分列表原生链路 → 输入框写值+全事件 → 隐藏字段同步
            this._clickScoreOption(n, v);
            this._setInputValue(el, v);
            this._syncPlatformState(n, v);
        }

        // 登记校验：隐藏状态字段必须全部落上（能捕捉 #278 这类选择器/编号失效故障）
        for (let i = 0; i < inputs.length; i++) {
            const n = this._indexOf(inputs[i].element);
            if (!this._isRegistered(n)) {
                console.error(`[AMEQP] ${inputs[i].label} 记分登记校验失败（MarQueSubSco_${n} 为空），拒绝提交`);
                return false;
            }
        }
        console.log(`[AMEQP] 填分完成并通过登记校验: ${inputs.length}/${inputs.length}`, scores);
        return true;
    },

    // ---------- 提交 ----------

    async submitGrade() {
        // 重新灌一遍分 + 同步 hidden 字段，消除"填分→提交"间隔过短导致的"没给分"
        if (this._pendingScores && this._pendingScores.length > 0) {
            const inputs = this.getScoreInputs();
            for (let i = 0; i < Math.min(this._pendingScores.length, inputs.length); i++) {
                const v = this._pendingScores[i];
                if (v === null || v === undefined) continue;
                this._setInputValue(inputs[i].element, v);
                this._syncPlatformState(this._indexOf(inputs[i].element), v);
            }
        }

        // 给平台事件处理留出处理时间，再触发 OnSubmit(1)
        await new Promise(r => setTimeout(r, 350));

        // 提交前登记校验（#278）：任何一题未登记即显式失败，不静默续走提交
        const checkInputs = this.getScoreInputs();
        for (let i = 0; i < checkInputs.length; i++) {
            const n = this._indexOf(checkInputs[i].element);
            if (!this._isRegistered(n)) {
                console.error(`[AMEQP] 提交前校验失败：${checkInputs[i].label} 未登记（MarQueSubSco_${n} 为空），中止提交`);
                return false;
            }
        }

        // 钩住 alert，捕获平台 OnSubmit 的"没给分"类提示并显式失败（#278）
        let platformWarn = null;
        const origAlert = window.alert;
        window.alert = function (msg) {
            platformWarn = String(msg || '');
            console.warn('[AMEQP] 平台弹窗:', platformWarn);
        };

        const btn = document.querySelector(AMEQP_SELECTORS.SUBMIT_BUTTON);
        if (btn && !btn.disabled) {
            btn.click();
            console.log('[AMEQP] 已点击提交');
            this._pendingScores = null;
            await new Promise(r => setTimeout(r, 800));
            window.alert = origAlert;
            if (platformWarn && /没给分|尚未给分|给分/.test(platformWarn)) {
                console.error('[AMEQP] 平台提示记分异常，提交未完成:', platformWarn);
                return false;
            }
            return true;
        }
        window.alert = origAlert;
        console.warn('[AMEQP] 未找到可用的提交按钮');
        return false;
    },

    async waitForNextPaper(oldImageUrl) {
        // oldImageUrl 可能是裁切 dataURL 或整图 URL；换卷检测以 DOM 信号为主
        const oldPath = (oldImageUrl && !oldImageUrl.startsWith('data:'))
            ? this._stripQuery(oldImageUrl)
            : this._stripQuery((this._answerImages()[0] || {}).src);
        let checkTimes = 0;

        return new Promise((resolve) => {
            const timer = setInterval(() => {
                checkTimes++;

                // 信号1：答题卡图片路径变化（去缓存戳）
                const imgPaths = this._answerImages()
                    .map(img => this._stripQuery(img.src))
                    .filter(Boolean);
                const imgMoved = oldPath && imgPaths.length > 0 && !imgPaths.includes(oldPath);

                // 信号2：所有分数框被清空（平台换卷重置）
                const inputs = this._scoreInputs();
                const allEmpty = inputs.length > 0 && inputs.every(el => !el.value);

                // 信号3：平台总分显示归零且分数框已清（提交成功后的重置）
                const queVal = document.querySelector(AMEQP_SELECTORS.QUE_VAL);
                const queReset = queVal && (queVal.value === '' || parseFloat(queVal.value) === 0);

                if (imgMoved || (allEmpty && queReset && checkTimes >= 4) || (allEmpty && checkTimes >= 5)) {
                    clearInterval(timer);
                    console.log('[AMEQP] 检测到下一份答卷', { imgMoved, allEmpty, queReset, checkTimes });
                    resolve(true);
                } else if (checkTimes > 100) {
                    // 20s 超时
                    clearInterval(timer);
                    console.warn('[AMEQP] 等待下一份答卷超时');
                    resolve(false);
                }
            }, 200);
        });
    },

    // ---------- 状态查询 ----------

    isRegradeMode() {
        // [回评状态] 标记可见时处于回评模式（安全兜底，回评功能暂不支持）
        const tit = document.querySelector(AMEQP_SELECTORS.REVIEW_TIT);
        if (!tit) return false;
        return !tit.classList.contains('hide') && tit.offsetParent !== null;
    },
};

if (AmeqpAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = AmeqpAdapter;
}
