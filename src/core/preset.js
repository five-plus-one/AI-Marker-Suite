// ========== 全局配置方案管理器 ==========
const PresetManager = {
    data: null,
    // 对全部方案做字段迁移/补全。init 启动时调用，导入方案后也调用，
    // 保证旧版本数据（含导入的旧文件）都能自动升级到当前结构。
    migrateAll() {
        // 迁移逐项隔离（#293）：单项抛异常不丢主数据、不中断其余迁移
        ['_migrateGradingMode', '_migrateProvider', '_migrateWorkflow', '_migrateBlankDetection', '_migrateHumanPacing'].forEach(fn => {
            try {
                this[fn]();
            } catch (e) {
                console.error(`[preset] 迁移 ${fn} 失败（保留已加载数据继续）:`, e);
            }
        });
    },
    init() {
        this._writeDisabled = false;
        let raw = null;
        try {
            raw = GM_getValue('ai-grading-presets');
        } catch (e) {
            // 读取异常（标签休眠/存储瞬态故障）：只读降级，存储原数据不被触碰（#293）
            console.error('❌ PresetManager init 读取失败，进入只读降级:', e);
            this._enterReadOnly(null);
            return;
        }
        if (raw) {
            try {
                this.data = JSON.parse(raw);
                this.migrateAll();
            } catch (e) {
                // 解析失败：救下原始字节并只读降级，绝不允许后续 save 覆写清空（#293）
                this._enterReadOnly(raw, e);
            }
        } else {
            // 首次使用（键不存在）：初始化默认并保存（语义不变）
            let defaultCfg = {
                provider: '5plus1', endpoint: SCRIPT_CONFIG.DEFAULT_ENDPOINT, model: SCRIPT_CONFIG.DEFAULT_MODEL
            };
            try {
                const oldConfigStr = GM_getValue('ai-grading-config');
                if (oldConfigStr) defaultCfg = JSON.parse(oldConfigStr);
            } catch (_) { /* 旧配置迁移失败用纯默认 */ }
            this.data = {
                list: { "默认配置": defaultCfg },
                active: "默认配置",
                bindings: {}
            };
            this.save();
        }
    },
    // 只读降级（#293）：内存用最小默认运行，禁止保存覆写；原始字节存 rescue 键供恢复
    _enterReadOnly(raw, err) {
        if (err) console.error('❌ PresetManager 数据解析失败，进入只读降级:', err);
        try {
            if (raw != null) GM_setValue('ai-grading-presets-rescue', String(raw));
        } catch (_) { /* rescue 写入失败也不能再动主键 */ }
        this.data = { list: { "默认配置": {} }, active: "默认配置", bindings: {} };
        this._writeDisabled = true;
    },

    // 导入内容净化（#296）：导入 JSON 可携带任意字符串——roundMethod 被 Math[] 索引会打穿判分。
    // 只保留已知字段的可信形态，危险值一律回落安全默认
    sanitizePreset(cfg) {
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return {};
        const out = Object.assign({}, cfg);
        if (out.scoring && typeof out.scoring === 'object') {
            const sc = Object.assign({}, out.scoring);
            if (!['round', 'floor', 'ceil'].includes(sc.roundMethod)) sc.roundMethod = 'round';
            const step = parseFloat(sc.roundStep);
            sc.roundStep = (isFinite(step) && step > 0 && step <= 10) ? Math.round(step * 100) / 100 : 1;
            if (Array.isArray(sc.units)) {
                sc.units = sc.units.map(u => {
                    const unit = (u && typeof u === 'object' && !Array.isArray(u)) ? Object.assign({}, u) : {};
                    const us = parseFloat(unit.roundStep);
                    if (!isFinite(us) || us <= 0 || us > 10) delete unit.roundStep;
                    else unit.roundStep = Math.round(us * 100) / 100;
                    const ms = parseFloat(unit.maxScore);
                    unit.maxScore = isFinite(ms) && ms >= 0 ? ms : 0;
                    // label 强制字符串（#299）：防对象/数组混入渲染层
                    unit.label = String(unit.label == null ? '' : unit.label);
                    return unit;
                });
            }
            // 勤勉配置净化（#315 G2 修正字段位）：真身在 scoring.diligence（score.js 4 处消费），
            // decayPower 非数值会产出 NaN 分直写平台
            if (sc.diligence && typeof sc.diligence === 'object') {
                const dg = Object.assign({}, sc.diligence);
                dg.enabled = dg.enabled === true;
                const mb = parseFloat(dg.maxBonus);
                dg.maxBonus = (isFinite(mb) && mb >= 0 && mb <= 100) ? mb : 3;
                const dp = parseFloat(dg.decayPower);
                dg.decayPower = (isFinite(dp) && dp > 0 && dp <= 10) ? dp : 2;
                sc.diligence = dg;
            }
            out.scoring = sc;
        }
        // 顶层 diligence 兜底（历史布局兼容；#315 G2）
        if (out.diligence && typeof out.diligence === 'object') {
            const dg = Object.assign({}, out.diligence);
            dg.enabled = dg.enabled === true;
            const mb = parseFloat(dg.maxBonus);
            dg.maxBonus = (isFinite(mb) && mb >= 0 && mb <= 100) ? mb : 3;
            const dp = parseFloat(dg.decayPower);
            dg.decayPower = (isFinite(dp) && dp > 0 && dp <= 10) ? dp : 2;
            out.diligence = dg;
        }
        return out;
    },
    _migrateGradingMode() {
        let changed = false;
        for (const name in this.data.list) {
            const cfg = this.data.list[name];
            if (cfg.unattendedMode !== undefined && cfg.gradingMode === undefined) {
                cfg.gradingMode = cfg.unattendedMode ? 'unattended' : 'normal';
                delete cfg.unattendedMode;
                changed = true;
            } else if (cfg.gradingMode === undefined) {
                cfg.gradingMode = 'normal';
                changed = true;
            }
        }
        if (changed) this.save();
    },
    _migrateProvider() {
        const migration = { '5plus1': '5plus1官方', 'openai': 'OpenAI兼容' };
        let changed = false;
        for (const name in this.data.list) {
            const cfg = this.data.list[name];
            if (cfg.provider && migration[cfg.provider]) {
                cfg.provider = migration[cfg.provider];
                changed = true;
            }
        }
        if (changed) this.save();
    },
    _migrateWorkflow() {
        let changed = false;
        for (const name in this.data.list) {
            try {
                const cfg = this.data.list[name];
                if (!cfg.workflowId) {
                    cfg.workflowId = 'fast';
                    changed = true;
                }
                if (!cfg.scoring) {
                    cfg.scoring = { roundStep: 1, roundMethod: 'round' };
                    changed = true;
                }
                // 迁移：输出模式默认详细（仅在缺失时补，不覆盖用户选择）
                if (!cfg.outputMode) {
                    cfg.outputMode = 'detailed';
                    changed = true;
                }
                // 迁移：自动重试策略缺失时补默认值（不覆盖用户已有配置）
                if (!cfg.retryPolicy) {
                    cfg.retryPolicy = { maxRetries: 3, retryOnTimeout: true, retryOnEmpty: true };
                    changed = true;
                }
                // 迁移：答卷校验缺失时补默认开启（不覆盖用户已有配置）
                if (!cfg.paperGuard) {
                    cfg.paperGuard = { enabled: true };
                    changed = true;
                }
                if (cfg.scoring && !cfg.scoring.diligence) {
                    cfg.scoring.diligence = { enabled: false, maxBonus: 3, decayPower: 2, criteria: '' };
                    changed = true;
                }
                // 迁移：将旧的顶层 subQuestions 转换为 scoring.units
                if (cfg.subQuestions && cfg.subQuestions.length > 0 && (!cfg.scoring.units || cfg.scoring.units.length === 0)) {
                    cfg.scoring.units = cfg.subQuestions.map((sq, i) => ({
                        label: sq.label || `第${i + 1}题`,
                        maxScore: sq.maxScore || 0,
                        index: i,
                        roundStep: 1
                    }));
                    changed = true;
                }
                // 迁移：添加 units[] 和 maxScore（默认 0 表示未设置）
                if (cfg.scoring && cfg.scoring.units === undefined) {
                    cfg.scoring.units = [];
                    changed = true;
                }
                if (cfg.scoring && cfg.scoring.maxScore === undefined) {
                    cfg.scoring.maxScore = 0;  // 0 = 未设置，运行时需要用户配置
                    changed = true;
                }
            } catch (e) {
                console.warn(`⚠️ Migration failed for preset "${name}":`, e);
            }
        }
        if (changed) this.save();
    },
    _migrateBlankDetection() {
        let changed = false;
        for (const name in this.data.list) {
            try {
                const cfg = this.data.list[name];
                if (!cfg.blankDetection) {
                    cfg.blankDetection = { enabled: false, threshold: 0.01 };
                    changed = true;
                }
            } catch (e) {
                console.warn(`⚠️ Migration failed for preset "${name}":`, e);
            }
        }
        if (changed) this.save();
    },
    // 迁移：批改节奏（实验性）缺失时补默认值（关闭状态零行为变化，不覆盖用户已有配置）
    _migrateHumanPacing() {
        let changed = false;
        const defaults = {
            enabled: false,
            normalDelay: { min: 5, max: 15 },
            unattendedDelay: { min: 0, max: 8 },
            rest: { enabled: false, everyCount: 20, restMin: 30, restMax: 180 },
            recordDuration: true
        };
        for (const name in this.data.list) {
            try {
                const cfg = this.data.list[name];
                if (!cfg.humanPacing) {
                    cfg.humanPacing = JSON.parse(JSON.stringify(defaults));
                    changed = true;
                    continue;
                }
                const hp = cfg.humanPacing;
                if (typeof hp.enabled !== 'boolean') { hp.enabled = defaults.enabled; changed = true; }
                if (!hp.normalDelay) { hp.normalDelay = { ...defaults.normalDelay }; changed = true; }
                else {
                    if (hp.normalDelay.min === undefined) { hp.normalDelay.min = defaults.normalDelay.min; changed = true; }
                    if (hp.normalDelay.max === undefined) { hp.normalDelay.max = defaults.normalDelay.max; changed = true; }
                }
                if (!hp.unattendedDelay) { hp.unattendedDelay = { ...defaults.unattendedDelay }; changed = true; }
                else {
                    if (hp.unattendedDelay.min === undefined) { hp.unattendedDelay.min = defaults.unattendedDelay.min; changed = true; }
                    if (hp.unattendedDelay.max === undefined) { hp.unattendedDelay.max = defaults.unattendedDelay.max; changed = true; }
                }
                if (!hp.rest) { hp.rest = { ...defaults.rest }; changed = true; }
                else {
                    if (typeof hp.rest.enabled !== 'boolean') { hp.rest.enabled = defaults.rest.enabled; changed = true; }
                    if (hp.rest.everyCount === undefined) { hp.rest.everyCount = defaults.rest.everyCount; changed = true; }
                    if (hp.rest.restMin === undefined) { hp.rest.restMin = defaults.rest.restMin; changed = true; }
                    if (hp.rest.restMax === undefined) { hp.rest.restMax = defaults.rest.restMax; changed = true; }
                }
                if (typeof hp.recordDuration !== 'boolean') { hp.recordDuration = defaults.recordDuration; changed = true; }
            } catch (e) {
                console.warn(`⚠️ Migration failed for preset "${name}":`, e);
            }
        }
        if (changed) this.save();
    },
    /**
     * 获取当前配置的评分单元列表
     * 优先使用用户手动配置的 units[]，回退到 adapter 自动检测
     * @returns {Array<{label, maxScore, index}>}
     */
    getScoringUnits() {
        const config = this.getCurrentConfig();
        const units = config.scoring?.units || [];

        // 如果用户已手动配置，直接返回
        if (units.length > 0) return units;

        // 回退：从 adapter 检测
        const adapter = window.__AI_MARKER_ADAPTER__;
        if (adapter && adapter.getScoreInputs) {
            const inputs = adapter.getScoreInputs();
            if (inputs.length > 1) {
                // 多个输入框 → 每个都是一个评分单元
                return inputs.map((inp, i) => ({
                    label: inp.label || `第${i + 1}题`,
                    maxScore: inp.maxScore || 0,
                    index: inp.index !== undefined ? inp.index : i
                }));
            }
        }

        // 单输入框或无 adapter → 返回空（使用 maxScore 作为单题模式）
        return [];
    },
    /**
     * 获取总满分
     * 优先从 units 计算，回退到 scoring.maxScore
     * @returns {number}
     */
    getMaxScore() {
        const units = this.getScoringUnits();
        if (units.length > 0) {
            return units.reduce((sum, u) => sum + (u.maxScore || 0), 0);
        }
        const config = this.getCurrentConfig();
        return config.scoring?.maxScore || 0;  // 0 = 未设置（validateScoringUnits 会拦截）
    },
    /**
     * 检查评分单元是否都已配置满分
     * @returns {{ valid: boolean, missingMaxScore: Array<{index, label}> }}
     */
    validateScoringUnits() {
        const units = this.getScoringUnits();
        const missingMaxScore = [];
        for (let i = 0; i < units.length; i++) {
            if (!units[i].maxScore || units[i].maxScore <= 0) {
                missingMaxScore.push({ index: i, label: units[i].label || `第${i + 1}题` });
            }
        }
        // 单题模式也需要检查 maxScore
        if (units.length === 0) {
            const config = this.getCurrentConfig();
            if (!config.scoring?.maxScore || config.scoring.maxScore <= 0) {
                missingMaxScore.push({ index: 0, label: '总分' });
            }
        }
        return { valid: missingMaxScore.length === 0, missingMaxScore };
    },
    save() {
        if (this._writeDisabled) {
            // 降级期保存被拦（#293）：可见提示 + 惰性探活（瞬态读取失败可自愈退出降级）
            // 注意（#297）：探活成功**不覆盖内存数据**——用户在保护期的修改必须保留
            try {
                const probe = GM_getValue('ai-grading-presets');
                const recovered = probe ? JSON.parse(probe) : null;
                if (recovered && recovered.list) {
                    this._writeDisabled = false;
                    if (typeof showToast === 'function') showToast('配置存储访问已恢复，请再次点击保存');
                    return false;
                }
            } catch (_) { /* 仍不可读，维持降级 */ }
            console.error('[preset] 存储处于只读降级，跳过保存以保护原数据（#293）');
            if (typeof showToast === 'function') showToast('⚠️ 配置存储异常：本次修改未保存（原数据已保护，稍后自动重试）');
            return false;
        }
        const json = JSON.stringify(this.data);
        // 旋转备份（#293）：覆写前保留上一版到 -prev 键，误写可回滚（过大跳过）
        try {
            const prev = GM_getValue('ai-grading-presets');
            if (prev && prev !== json) {
                if (prev.length <= 2 * 1024 * 1024) GM_setValue('ai-grading-presets-prev', prev);
                else console.warn('[preset] 上一版过大（>2MB），跳过 -prev 备份');
            }
        } catch (_) { /* 备份失败不阻塞正常保存 */ }
        GM_setValue('ai-grading-presets', json);
        return true;
    },
    getCurrentConfig() {
        return this.data.list[this.data.active] || {};
    },
    getTaskIdentifier() {
        const adapter = window.__AI_MARKER_ADAPTER__;
        if (adapter && adapter.getTaskIdentifier) {
            return adapter.getTaskIdentifier();
        }
        return window.location.pathname + window.location.hash;
    },
    // 获取当前生效的 AI 调用配置（优先使用工作流，回退到直接配置）
    getActiveCallConfig() {
        const config = this.getCurrentConfig();

        // 优先使用工作流
        if (config.workflowId) {
            const wfConfig = WorkflowManager.getWorkflowModelConfig(config.workflowId);
            if (wfConfig) {
                return {
                    ...config,
                    ...wfConfig
                };
            }
        }

        // 回退到直接配置（兼容旧版）
        const provider = ProviderManager.getProvider(config.provider);
        if (provider) {
            return {
                ...config,
                endpoint: provider.endpoint,
                apiKey: provider.apiKey || config.apiKey,
                model: config.model || Object.keys(provider.models)[0]
            };
        }

        // 最后回退到当前活跃的供应商/模型
        return {
            ...config,
            endpoint: ProviderManager.getCurrentEndpoint(),
            apiKey: ProviderManager.getCurrentApiKey(),
            model: ProviderManager.getCurrentModelId()
        };
    }
};

// 更新后配置恢复检测（必须在 init 之前调用）
if (typeof restoreConfigIfMissing === 'function') restoreConfigIfMissing();
PresetManager.init();
// 暴露到 window，供适配器在 onPageLoad 中访问（适配器代码先于核心模块加载）
window.PresetManager = PresetManager;
