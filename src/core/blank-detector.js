// ========== 空白答题卡检测 ==========
// 通过灰度化 + Otsu 二值化 + 黑色像素占比比较，判断答题卡是否为空白。
// 范本数据保存在 sessionStorage，关闭标签页即丢弃。

const BlankDetector = {
    /** sessionStorage 键名 */
    STORAGE_KEY: 'ai-blank-ref-ratios',

    /**
     * 从 base64 加载图片并返回 ImageData
     * @param {string} base64 - 不含 data: 前缀的 base64 数据
     * @returns {Promise<{imageData: ImageData, width: number, height: number}>}
     */
    loadImageData(base64) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    resolve({ imageData, width: canvas.width, height: canvas.height });
                } catch (e) {
                    reject(new Error('Canvas 处理失败: ' + e.message));
                }
            };
            img.onerror = () => reject(new Error('图片加载失败'));
            img.src = 'data:image/png;base64,' + base64;
        });
    },

    /**
     * 将 ImageData 灰度化并返回灰度数组
     * @param {ImageData} imageData
     * @returns {Uint8Array} 灰度值数组（0-255）
     */
    toGrayscale(imageData) {
        const data = imageData.data;
        const len = data.length / 4;
        const gray = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            const offset = i * 4;
            gray[i] = Math.round(0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2]);
        }
        return gray;
    },

    /**
     * Otsu 算法计算最佳二值化阈值
     * @param {Uint8Array} gray - 灰度数组
     * @returns {number} 最佳阈值（0-255）
     */
    otsuThreshold(gray) {
        // 计算灰度直方图
        const histogram = new Float64Array(256);
        for (let i = 0; i < gray.length; i++) {
            histogram[gray[i]]++;
        }

        const total = gray.length;
        let sumAll = 0;
        for (let i = 0; i < 256; i++) sumAll += i * histogram[i];

        let sumBg = 0;
        let wBg = 0;
        let maxVariance = 0;
        let bestThreshold = 0;

        for (let t = 0; t < 256; t++) {
            wBg += histogram[t];
            if (wBg === 0) continue;

            const wFg = total - wBg;
            if (wFg === 0) break;

            sumBg += t * histogram[t];
            const meanBg = sumBg / wBg;
            const meanFg = (sumAll - sumBg) / wFg;
            const variance = wBg * wFg * (meanBg - meanFg) * (meanBg - meanFg);

            if (variance > maxVariance) {
                maxVariance = variance;
                bestThreshold = t;
            }
        }

        return bestThreshold;
    },

    /**
     * 计算图片的黑色像素占比
     * @param {string} base64 - 不含 data: 前缀的 base64 数据
     * @param {number} [fixedThreshold] - 使用外部指定的阈值（来自范本），不传则自适应计算
     * @returns {Promise<{ratio: number, threshold: number, totalPixels: number, minPixels: number}>}
     */
    async calcBlackPixelRatio(base64, fixedThreshold) {
        const { imageData, width, height } = await this.loadImageData(base64);
        const totalPixels = width * height;

        // 极小图片跳过（可能是缩略图/错误图）
        if (totalPixels < 1000) {
            return { ratio: 0, threshold: 0, totalPixels, minPixels: 0, skipped: true };
        }

        const gray = this.toGrayscale(imageData);
        const threshold = fixedThreshold !== undefined ? fixedThreshold : this.otsuThreshold(gray);

        // 统计黑色像素（灰度值 <= 阈值）
        let blackPixels = 0;
        for (let i = 0; i < gray.length; i++) {
            if (gray[i] <= threshold) blackPixels++;
        }

        const ratio = blackPixels / totalPixels;
        return { ratio, threshold, totalPixels, minPixels: blackPixels };
    },

    /**
     * 批量计算多张图片的黑色像素占比
     * @param {string[]} base64Array - base64 数据数组
     * @param {number[]} [referenceThresholds] - 范本各图的 Otsu 阈值，传入后使用相同阈值计算
     * @returns {Promise<Array<{ratio: number, threshold: number, skipped?: boolean}>>}
     */
    async calcBatchRatios(base64Array, referenceThresholds) {
        const results = [];
        for (let i = 0; i < base64Array.length; i++) {
            const fixedThreshold = referenceThresholds ? referenceThresholds[i] : undefined;
            try {
                results.push(await this.calcBlackPixelRatio(base64Array[i], fixedThreshold));
            } catch (e) {
                console.warn('⚠️ [空白检测] 图片处理失败:', e.message);
                results.push({ ratio: 0, threshold: 0, totalPixels: 0, minPixels: 0, skipped: true });
            }
        }
        return results;
    },

    /**
     * 判断是否为空白答题卡
     * @param {Array<{ratio: number, skipped?: boolean}>} currentRatios - 当前图片的占比结果
     * @param {number[]|{ratios: number[], thresholds: number[]}} referenceData - 范本数据（兼容旧格式）
     * @param {number} threshold - 差异阈值（默认 0.01 = 1%）
     * @returns {{isBlank: boolean, reason: string}}
     */
    isBlankSheet(currentRatios, referenceData, threshold = 0.01) {
        // 兼容旧格式（纯数组）和新格式（含阈值的对象）
        const referenceRatios = Array.isArray(referenceData) ? referenceData : referenceData.ratios;

        // 图片数量不匹配
        if (currentRatios.length !== referenceRatios.length) {
            return { isBlank: false, reason: `图片数量不匹配（当前${currentRatios.length}张，范本${referenceRatios.length}张），请重新采集范本` };
        }

        // 逐张对比
        let allSkipped = true;
        for (let i = 0; i < currentRatios.length; i++) {
            const current = currentRatios[i];
            const ref = referenceRatios[i];

            // 跳过的图片不影响判定
            if (current.skipped) continue;
            allSkipped = false;

            const diff = Math.abs(current.ratio - ref);
            if (diff > threshold) {
                return { isBlank: false, reason: `第${i + 1}张图黑色占比差异 ${(diff * 100).toFixed(2)}% > ${(threshold * 100).toFixed(1)}%` };
            }
        }

        // 全部图片都跳过了，无法判定为空白
        if (allSkipped) {
            return { isBlank: false, reason: '所有图片均加载失败，无法判定' };
        }

        return { isBlank: true, reason: '所有图片黑色占比均在阈值范围内' };
    },

    // ========== 范本管理 ==========

    /**
     * 保存范本占比和阈值（sessionStorage + GM_setValue 双写）
     * @param {number[]} ratios - 范本占比数组
     * @param {number[]} [thresholds] - 范本各图的 Otsu 阈值数组
     */
    saveReference(ratios, thresholds) {
        try {
            const data = thresholds ? { ratios, thresholds } : ratios;
            const json = JSON.stringify(data);
            sessionStorage.setItem(this.STORAGE_KEY, json);
            if (typeof GM_setValue !== 'undefined') GM_setValue(this.STORAGE_KEY, json);
            console.log('📸 [空白检测] 范本已保存:', ratios.map(r => (r * 100).toFixed(3) + '%').join(', '),
                thresholds ? '| 阈值: ' + thresholds.join(', ') : '');
        } catch (e) {
            console.warn('⚠️ [空白检测] 范本保存失败:', e);
        }
    },

    /**
     * 加载范本数据（优先 sessionStorage，回退 GM_setValue）
     * 兼容旧格式（纯数组）和新格式（{ratios, thresholds}）
     * @returns {{ ratios: number[], thresholds: number[] | null } | null}
     */
    loadReference() {
        try {
            let data = sessionStorage.getItem(this.STORAGE_KEY);
            if (!data && typeof GM_getValue !== 'undefined') {
                data = GM_getValue(this.STORAGE_KEY, null);
                // 从 GM_setValue 恢复到 sessionStorage
                if (data) sessionStorage.setItem(this.STORAGE_KEY, data);
            }
            if (data) {
                const parsed = JSON.parse(data);
                // 新格式: { ratios: number[], thresholds: number[] }
                if (parsed && Array.isArray(parsed.ratios) && parsed.ratios.length > 0) {
                    return { ratios: parsed.ratios, thresholds: parsed.thresholds || null };
                }
                // 旧格式兼容: 纯数组
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return { ratios: parsed, thresholds: null };
                }
            }
        } catch (e) {
            console.warn('⚠️ [空白检测] 范本加载失败:', e);
        }
        return null;
    },

    /**
     * 获取范本详情（用于设置面板展示）
     * @returns {{ count: number, ratios: number[], thresholds: number[] | null } | null}
     */
    getRatiosDetail() {
        const ref = this.loadReference();
        if (!ref) return null;
        return { count: ref.ratios.length, ratios: ref.ratios, thresholds: ref.thresholds };
    },

    /**
     * 清除范本（sessionStorage + GM_setValue）
     */
    clearReference() {
        sessionStorage.removeItem(this.STORAGE_KEY);
        if (typeof GM_setValue !== 'undefined') GM_setValue(this.STORAGE_KEY, null);
        console.log('🗑️ [空白检测] 范本已清除');
    },

    /**
     * 是否已采集范本
     * @returns {boolean}
     */
    hasReference() {
        return this.loadReference() !== null;
    }
};
