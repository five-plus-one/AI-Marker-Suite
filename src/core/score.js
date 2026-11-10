// ========== 分数计算器 ==========
// 统一管理取整、勤勉加分、小题分配等所有分数计算逻辑。
// Adapter 只负责填分，不参与分数计算。

const ScoreCalculator = {
    /**
     * 取整规则
     * @param {number} score - 原始分数
     * @param {Object} scoringConfig - { roundStep, roundMethod }
     * @param {number} [maxScore] - 该分数对应的满分（传入时启用吸附+钳制语义，#273）
     *   合法分数 = {0, s, 2s, …, floor(max/s)·s} ∪ {满分}：
     *   - 越界一律钳制到 [0, 满分]（取整可能越过满分，如步长 1.5/满分 10 时 10 → 10.5）
     *   - 满分不整除步长时，满分本身作为特例放行（保证满分拿得到）
     *   未传 maxScore 时行为与历史逐值一致
     * @returns {number}
     */
    round(score, scoringConfig, maxScore) {
        if (score === null || score === undefined || !scoringConfig) return score;
        if (!Number.isFinite(score)) return score;
        const configuredStep = Number(scoringConfig.roundStep);
        const step = Number.isFinite(configuredStep) && configuredStep > 0 ? configuredStep : 1;
        // roundMethod 白名单（#296）：导入配置可携带任意字符串，Math[method] 索引会被打穿
        // （如 "random"/"sqrt" 静默改写每一份分数）。使用点兜底 + 导入点净化双层防御。
        const method = ['round', 'floor', 'ceil'].includes(scoringConfig.roundMethod) ? scoringConfig.roundMethod : 'round';
        const hasMax = maxScore !== null && maxScore !== undefined && Number.isFinite(Number(maxScore)) && maxScore >= 0;
        const max = hasMax ? Math.round(Number(maxScore) * 100) / 100 : Infinity;
        if (hasMax && score >= max) return max;
        if (hasMax && score <= 0) return 0;
        const quotient = score / step;
        const tolerance = Number.EPSILON * Math.max(1, Math.abs(quotient)) * 4;
        const clean = v => { const n = Math.round(v * 1e8) / 1e8; return Object.is(n, -0) ? 0 : n; };
        const lower = clean(Math.floor(quotient + tolerance) * step);
        const upper = Math.min(clean(Math.ceil(quotient - tolerance) * step), max);
        if (method === 'floor') return lower;
        if (method === 'ceil') return upper;
        // 默认整数取整保留 Math.round 的负零语义。
        if (!hasMax && step === 1) return Math.round(score);
        return score - lower < upper - score - step * tolerance ? lower : upper;
    },

    /**
     * 勤勉加分计算
     * @param {number} accuracyScore - 准确性原始分数
     * @param {number} diligenceLevel - 勤勉等级 1-5
     * @param {number} maxScore - 该题满分
     * @param {Object} diligenceConfig - { enabled, maxBonus, decayPower }
     * @returns {{ bonus, decayFactor, rawBonus, finalScore }}
     */
    calcDiligenceBonus(accuracyScore, diligenceLevel, maxScore, diligenceConfig) {
        if (!diligenceConfig || !diligenceConfig.enabled || !diligenceLevel || diligenceLevel <= 0 || maxScore <= 0) {
            return { bonus: 0, decayFactor: 0, rawBonus: 0, finalScore: accuracyScore };
        }
        const maxBonus = diligenceConfig.maxBonus ?? 3;
        const decayPower = diligenceConfig.decayPower || 2;
        const perLevel = 1;
        const ratio = Math.min(accuracyScore / maxScore, 1);
        const decayFactor = Math.pow(1 - ratio, decayPower);
        const maxAddable = Math.max(0, maxScore - accuracyScore);
        const rawBonus = Math.min(Math.max(0, diligenceLevel - 1) * perLevel, maxBonus, maxAddable);
        const bonus = Math.round(rawBonus * decayFactor * 100) / 100;
        const finalScore = Math.min(accuracyScore + bonus, maxScore);
        return { bonus, decayFactor, rawBonus, finalScore };
    },

    /**
     * 勤勉加分分配到各评分单元
     * @param {Array<{score, maxScore}>} unitScores - 各单元已取整的分数
     * @param {number} bonus - 勤勉加分总值
     * @param {Function} roundFn - 取整函数
     * @returns {Array} 分配后的单元分数
     */
    distributeBonus(unitScores, bonus, roundFn, scoringConfig) {
        if (!bonus || bonus <= 0 || !unitScores || unitScores.length === 0) return unitScores;
        const totalMax = unitScores.reduce((s, u) => s + (u.maxScore || 1), 0);
        if (totalMax <= 0) return unitScores;
        const clean = n => Math.round(n * 1e8) / 1e8;
        const out = unitScores.map(u => ({ ...u }));
        const allocated = unitScores.map(() => 0);
        let remaining = bonus;
        // 每次只分配一个真实可填的梯度，扣减实际增量。不能先分小数再逐题四舍五入。
        for (let count = 0; count < 100000; count++) {
            let best = -1, bestDelta = 0, bestNeed = -Infinity;
            out.forEach((u, i) => {
                if (u.score == null) return;
                const step = u.roundStep || scoringConfig?.roundStep || 0.01;
                const max = u.maxScore ?? Infinity;
                const next = Math.min(clean((Math.floor(u.score / step + 1e-9) + 1) * step), max);
                const delta = clean(next - u.score);
                const need = bonus * (u.maxScore || 1) / totalMax - allocated[i];
                if (delta > 0 && delta <= remaining + 1e-8 && need > bestNeed) {
                    best = i; bestDelta = delta; bestNeed = need;
                }
            });
            if (best < 0) break;
            out[best].score = clean(out[best].score + bestDelta);
            allocated[best] = clean(allocated[best] + bestDelta);
            remaining = clean(remaining - bestDelta);
        }
        return out;
    },

    /**
     * 完整的分数计算流水线
     * @param {Object} params
     * @param {number} params.aiScore - AI 原始准确性分数
     * @param {number} params.diligenceLevel - 勤勉等级 (0-5)
     * @param {number} params.maxScore - 总满分
     * @param {Object} params.scoringConfig - preset.scoring 配置
     * @param {Array<{score, maxScore, label, id, comment}>} [params.aiUnitScores] - AI 给每个评分单元的原始分数
     * @returns {{ finalScore, finalUnitScores, bonus, breakdown }}
     */
    calculate({ aiScore, diligenceLevel, maxScore, scoringConfig, aiUnitScores }) {
        // 1. 准确性分数取整（传满分启用吸附+钳制，#273）
        const accuracyScore = this.round(aiScore, scoringConfig, maxScore);
        if (accuracyScore !== aiScore) {
            console.log(`📐 [分数计算] 取整: ${aiScore} → ${accuracyScore} (步长: ${scoringConfig.roundStep}, 方式: ${scoringConfig.roundMethod})`);
        }

        // 2. 勤勉加分（基于原始分数计算衰减，不受取整影响）
        const diligenceResult = this.calcDiligenceBonus(aiScore, diligenceLevel, maxScore, scoringConfig.diligence);
        // 勤勉加分本身也取整
        let roundedBonus = this.round(diligenceResult.bonus, scoringConfig);

        // 3. 最终总分 = min(取整(准确性 + 勤勉), 满分)
        let finalScore = this.round(accuracyScore + roundedBonus, scoringConfig, maxScore);
        roundedBonus = Math.max(0, Math.round((finalScore - accuracyScore) * 100) / 100);

        if (roundedBonus > 0) {
            console.log(`🌟 [分数计算] 勤勉等级${diligenceLevel}/5, 衰减${diligenceResult.decayFactor.toFixed(2)}, 加分+${roundedBonus}, 最终${finalScore}`);
        }

        // 4. 各评分单元分数处理（每个单元可有独立步长）
        let finalUnitScores = null;
        if (aiUnitScores && aiUnitScores.length > 0) {
            // 对每个单元取整（优先使用单元步长，回退全局步长；传单元满分钳制，#273）
            const rounded = aiUnitScores.map(u => {
                const unitConfig = u.roundStep ? { ...scoringConfig, roundStep: u.roundStep } : scoringConfig;
                return {
                    ...u,
                    score: u.score !== null && u.score !== undefined ? this.round(u.score, unitConfig, u.maxScore) : null
                };
            });
            // 按单元比例与可填写梯度分配，实际增量合计不超过加分预算。
            finalUnitScores = roundedBonus > 0
                ? this.distributeBonus(rounded, roundedBonus, null, scoringConfig) : rounded;
            roundedBonus = Math.round(finalUnitScores.reduce((sum, u, i) => sum +
                (u.score == null ? 0 : u.score - rounded[i].score), 0) * 100) / 100;

            // 校验：各单元之和应等于总分；不一致时以小题之和为准（小题是明细、最终按小题填入平台）
            const unitSum = Math.round(finalUnitScores.reduce((s, u) => s + (u.score || 0), 0) * 1e8) / 1e8;
            const allScored = finalUnitScores.every(u => u.score !== null && u.score !== undefined);
            if (allScored) {
                if (Math.abs(unitSum - finalScore) > 1e-8) console.warn(`⚠️ [分数计算] 各单元之和(${unitSum})与总分(${finalScore})不一致，以小题之和为准`);
                finalScore = Math.min(unitSum, maxScore);
            } else if (Math.abs(unitSum - finalScore) > 0.01) {
                    console.warn(`⚠️ [分数计算] 各单元之和(${unitSum})与总分(${finalScore})不一致（部分单元缺分，保留原总分）`);
            }
        }

        return {
            finalScore,
            finalUnitScores,
            bonus: roundedBonus,
            breakdown: {
                aiScore,
                accuracyScore,
                diligenceLevel,
                diligenceBonus: roundedBonus,
                decayFactor: diligenceResult.decayFactor,
                rawBonus: diligenceResult.rawBonus,
                maxScore
            }
        };
    }
};
