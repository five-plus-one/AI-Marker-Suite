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
        const step = scoringConfig.roundStep || 1;
        const method = scoringConfig.roundMethod || 'round';
        let rounded;
        if (step === 1) {
            rounded = Math[method](score);
        } else {
            rounded = Math[method](score / step) * step;
            rounded = Math.round(rounded * 100) / 100;
        }
        if (maxScore !== null && maxScore !== undefined && isFinite(maxScore) && maxScore >= 0) {
            const max = Math.round(maxScore * 100) / 100;
            if (rounded > max) rounded = max;
            if (rounded < 0) rounded = 0;
        }
        return rounded;
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
        const maxBonus = diligenceConfig.maxBonus || 3;
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
    distributeBonus(unitScores, bonus, roundFn) {
        if (!bonus || bonus <= 0 || !unitScores || unitScores.length === 0) return unitScores;
        const totalMax = unitScores.reduce((s, u) => s + (u.maxScore || 1), 0);
        if (totalMax <= 0) return unitScores;
        const round = roundFn || (v => Math.round(v * 100) / 100);
        let remaining = bonus;
        return unitScores.map((u, i) => {
            const max = u.maxScore || Infinity;
            if (i === unitScores.length - 1) {
                const added = Math.min(remaining, max - (u.score || 0));
                return { ...u, score: Math.min(round(u.score + added), max) };
            }
            const share = Math.round(bonus * (u.maxScore || 1) / totalMax * 10) / 10;
            const maxAdd = max - (u.score || 0);
            const added = Math.min(share, maxAdd, remaining);
            remaining -= added;
            return { ...u, score: Math.min(round(u.score + added), max) };
        });
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
        const roundedBonus = this.round(diligenceResult.bonus, scoringConfig);

        // 3. 最终总分 = min(取整(准确性 + 勤勉), 满分)
        let finalScore = Math.min(this.round(accuracyScore + roundedBonus, scoringConfig), maxScore);

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
            // 勤勉加分按比例分配
            finalUnitScores = roundedBonus > 0
                ? this.distributeBonus(rounded, roundedBonus, s => this.round(s, scoringConfig))
                : rounded;

            // 校验：各单元之和应等于总分；不一致时以小题之和为准（小题是明细、最终按小题填入平台）
            const unitSum = finalUnitScores.reduce((s, u) => s + (u.score || 0), 0);
            if (Math.abs(unitSum - finalScore) > 0.01) {
                // 仅当所有单元均有分数时才覆盖，避免部分单元缺分时误改总分
                const allScored = finalUnitScores.every(u => u.score !== null && u.score !== undefined);
                if (allScored) {
                    console.warn(`⚠️ [分数计算] 各单元之和(${unitSum})与总分(${finalScore})不一致，以小题之和为准`);
                    finalScore = Math.min(unitSum, maxScore);
                } else {
                    console.warn(`⚠️ [分数计算] 各单元之和(${unitSum})与总分(${finalScore})不一致（部分单元缺分，保留原总分）`);
                }
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
