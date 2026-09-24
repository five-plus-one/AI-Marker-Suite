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

    // 从 txt_que_N 提取内部序号 N
    _indexOf(el) {
        const m = (el.name || el.id || '').match(/txt_que_(\d+)/);
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

    // 将单个分数写入输入框并触发平台事件
    _setInputValue(el, v) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        if (window.jQuery) {
            try {
                window.jQuery(el).val(String(v)).trigger('input').trigger('change').trigger('blur');
            } catch (e) {
                console.warn('[AMEQP] jQuery trigger 失败:', e);
            }
        }
    },

    // 同步平台内部状态字段（OnSubmit 靠这些判断"已给分"）
    _syncPlatformState(n, v) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        if (n) {
            const sub = document.querySelector(`#${AMEQP_SELECTORS.SUB_SCORE_HIDDEN}${n}`);
            if (sub) setter.call(sub, String(v));
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

        // 先暂存：submitGrade 时会重新灌一遍，防止填分与提交间隔太短导致平台没记录
        this._pendingScores = scores.slice();

        let successCount = 0;
        for (let i = 0; i < Math.min(scores.length, inputs.length); i++) {
            const v = scores[i];
            if (v === null || v === undefined) continue;
            const el = inputs[i].element;
            this._setInputValue(el, v);
            // 同步平台 hidden 字段（OnSubmit 校验点）
            this._syncPlatformState(this._indexOf(el), v);
            successCount++;
        }
        console.log(`[AMEQP] 填分完成: ${successCount}/${inputs.length}`, scores);
        return successCount > 0;
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

        const btn = document.querySelector(AMEQP_SELECTORS.SUBMIT_BUTTON);
        if (btn && !btn.disabled) {
            btn.click();
            console.log('[AMEQP] 已点击提交');
            this._pendingScores = null;
            return true;
        }
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
