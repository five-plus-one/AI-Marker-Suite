// ========== 工单②：双评合并取整策略（mergeMode）回归测试 ==========
// 语义体检结论（先质疑再固化，改前已核对 ai-engine.js mergeDualSubScores 全函数）：
//   - round（默认/缺字段）= 平均后四舍五入到评分梯度
//   - floor / ceil = 平均后强制向下/向上取整到评分梯度
//   - min / max = 取低分/取高分（不平均），外向吸附（返修① 教师语义）：
//     min→floor 只降不升（min(1.5,2)→1，绝不输出高于低分的值）、max→ceil 只升不降
//     （此前 round 吸附会把取低分抬高、取高分压低，违背标签语义）
//   - 缺分语义不放松：单侧 null/undefined 直取对侧原值（不吸附）；双侧 null → null
//   - NaN 传染语义不放松：任一侧 NaN → 结果 NaN（与历史平均路径一致）
//   - 长度不齐/单侧无 subScores：原样返回 detailA.subScores（所有模式一致）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadEngine() {
    // score.js 先于 ai-engine.js 载入：mergeDualValue 依赖 ScoreCalculator（构建产物同全局）
    const scoreSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'score.js'), 'utf8');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'ai-engine.js'), 'utf8');
    const store = {};   // GM 存储空启动（走 _getDefault）
    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        window: {}, document: null,
        SCRIPT_CONFIG: { DEFAULT_ENDPOINT: 'x', DEFAULT_MODEL: 'y', VERSION: '0' },
        GM_getValue: (k, d) => (k in store ? store[k] : d),
        GM_setValue: (k, v) => { store[k] = v; },
        fetch: async () => { throw new Error('no net'); },
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        Math, JSON, Date, Error, RegExp, String, Number, Array, Object, Promise,
        parseFloat, parseInt, isNaN, isFinite, setTimeout, clearTimeout, AbortController,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/core/runtime.js'), 'utf8'), sandbox);
    vm.runInContext(scoreSrc, sandbox);
    vm.runInContext(src + '\n;__exports__ = { mergeDualValue, mergeDualSubScores, buildDualEvalDetail, callDualEvaluation, WorkflowManager };', sandbox);
    return { fx: sandbox.__exports__, sandbox, store };
}

function unit(score, maxScore, extra) { return { id: 'x', label: '56', score, maxScore, comment: '', ...extra }; }
// 跨 vm 域数组包一层宿主数组，避免 deepStrictEqual 的跨域原型误报
const host = (arr) => [...arr];

// ---------- mergeDualSubScores：五模式 ----------
test('round 模式按四舍五入吸附，不受单评向下取整设置影响', () => {
    const { mergeDualSubScores } = loadEngine().fx;
    const A = { subScores: [unit(2, 4), unit(1, 4)] };
    const B = { subScores: [unit(1, 4), unit(2, 4)] };
    const out = mergeDualSubScores(A, B, { roundStep: 1, roundMethod: 'round' });
    assert.strictEqual(out[0].score, 2, '(2+1)/2=1.5 → Math.round=2');
    assert.strictEqual(out[1].score, 2);

    // 双评 round 策略按标签语义执行，与单评 floor 设置分别验证。
    const outFloorCfg = mergeDualSubScores(A, B, { roundStep: 1, roundMethod: 'floor' });
    assert.strictEqual(outFloorCfg[0].score, 2, 'round 模式按平均后四舍五入执行');
});

test('floor：平均后向下取整到评分梯度（变异可红：与 round/ceil/min/max 结果均不同）', () => {
    const { mergeDualSubScores } = loadEngine().fx;
    // (7+6.5)/2=6.75 → floor 6；round 会得 7、ceil 7、min 6.5→吸附 7、max 7 —— 任一变异必红
    const A = { subScores: [unit(7, 10)] };
    const B = { subScores: [unit(6.5, 10)] };
    const out = mergeDualSubScores(A, B, { roundStep: 1, roundMethod: 'round' }, 'floor');
    assert.strictEqual(out[0].score, 6);

    // 步长吸附不变：平均 14.25 在 1.5 梯度上 floor = 13.5
    const A2 = { subScores: [unit(15, 20)] };
    const B2 = { subScores: [unit(13.5, 20)] };
    const out2 = mergeDualSubScores(A2, B2, { roundStep: 1.5, roundMethod: 'round' }, 'floor');
    assert.strictEqual(out2[0].score, 13.5);
});

test('ceil：平均后向上取整到评分梯度，满分钳制不变（变异可红）', () => {
    const { mergeDualSubScores } = loadEngine().fx;
    // (10+6.2)/2=8.1 → ceil 9；round/floor 会得 8、min 6、max 10 —— 任一变异必红
    const A = { subScores: [unit(10, 10)] };
    const B = { subScores: [unit(6.2, 10)] };
    const out = mergeDualSubScores(A, B, { roundStep: 1, roundMethod: 'round' }, 'ceil');
    assert.strictEqual(out[0].score, 9);

    // 钳制不变：ceil(8.7)=9 顶出单元满分 8 → 钳回 8
    const A2 = { subScores: [unit(8.6, 8)] };
    const B2 = { subScores: [unit(8.8, 8)] };
    const out2 = mergeDualSubScores(A2, B2, { roundStep: 1, roundMethod: 'round' }, 'ceil');
    assert.strictEqual(out2[0].score, 8, 'ceil 顶出满分必须钳回');
});

test('min / max：取低分 / 取高分（不平均；变异可红：与平均取整结果均不同）', () => {
    const { mergeDualSubScores } = loadEngine().fx;
    // A=[4,0]、B=[0,4]：min=[0,0]、max=[4,4]，而 round 平均=[2,2] —— 取整/取值互不混淆
    const A = { subScores: [unit(4, 4), unit(0, 4)] };
    const B = { subScores: [unit(0, 4), unit(4, 4)] };
    const lo = mergeDualSubScores(A, B, { roundStep: 1, roundMethod: 'round' }, 'min');
    assert.strictEqual(lo[0].score, 0);
    assert.strictEqual(lo[1].score, 0);
    const hi = mergeDualSubScores(A, B, { roundStep: 1, roundMethod: 'round' }, 'max');
    assert.strictEqual(hi[0].score, 4);
    assert.strictEqual(hi[1].score, 4);
});

test('min/max 外向吸附到步长网格（min→floor 只降不升、max→ceil 只升不降；返修①）', () => {
    const { mergeDualSubScores } = loadEngine().fx;
    // 「取低分」只降不升：min(1.5, 2)=1.5 → floor → 1（round 会抬成 2 = 取低分输出高分，必红）
    const A = { subScores: [unit(1.5, 10)] };
    const B = { subScores: [unit(2, 10)] };
    const lo = mergeDualSubScores(A, B, { roundStep: 1, roundMethod: 'round' }, 'min');
    assert.strictEqual(lo[0].score, 1);
    // 「取高分」只升不降：max(1.4, 1.2)=1.4 → ceil → 2（round/floor 会压成 1，必红）
    const C = { subScores: [unit(1.4, 10)] };
    const D = { subScores: [unit(1.2, 10)] };
    const hi = mergeDualSubScores(C, D, { roundStep: 1, roundMethod: 'round' }, 'max');
    assert.strictEqual(hi[0].score, 2);
    // 步长网格：min(5, 8)=5 在 2 的梯度上 floor → 4（round 会抬成 6，必红）
    const E = { subScores: [unit(5, 10)] };
    const F = { subScores: [unit(8, 10)] };
    const lo2 = mergeDualSubScores(E, F, { roundStep: 2, roundMethod: 'round' }, 'min');
    assert.strictEqual(lo2[0].score, 4);
    // 满分钳制不变：max(8.6, 8.8)=8.8 → ceil → 9 → 钳回单元满分 8
    const G = { subScores: [unit(8.6, 8)] };
    const H = { subScores: [unit(8.8, 8)] };
    const clamped = mergeDualSubScores(G, H, { roundStep: 1, roundMethod: 'round' }, 'max');
    assert.strictEqual(clamped[0].score, 8);
});

test('N3 钳制最高优先：越界输入非法，钳制覆盖外向承诺（互斥可红）', () => {
    const { mergeDualSubScores, mergeDualValue } = loadEngine().fx;
    // max 侧 8.8 超单元满分 8：ceil 外向会给 9，但钳制最高优先 → 8
    // （互斥：若钳制被外向"回抬"或去掉，结果 9/8.8 → 红）
    const A = { subScores: [unit(8.8, 8)] };
    const B = { subScores: [unit(8.6, 8)] };
    const out = mergeDualSubScores(A, B, { roundStep: 1, roundMethod: 'round' }, 'max');
    assert.strictEqual(out[0].score, 8, '钳制最高优先：宁可压回满分也不输出越界值');
    // 合法输入（≤满分）的外向语义保持，钳制不干扰：min(1.5,2)→1、max(1.4,1.2)→2
    const C = { subScores: [unit(1.5, 10)] };
    const D = { subScores: [unit(2, 10)] };
    assert.strictEqual(mergeDualSubScores(C, D, { roundStep: 1 }, 'min')[0].score, 1);
    assert.strictEqual(mergeDualSubScores({ subScores: [unit(1.4, 10)] }, { subScores: [unit(1.2, 10)] }, { roundStep: 1 }, 'max')[0].score, 2);
    // 总分口径同样钳制最高优先
    assert.strictEqual(mergeDualValue(8.8, 8.6, { roundStep: 1, roundMethod: 'round' }, 8, 'max'), 8);
});

test('缺分语义不放松：单侧 null 直取对侧原值（不吸附），双侧 null → null', () => {
    const { mergeDualSubScores } = loadEngine().fx;
    for (const mode of ['round', 'floor', 'ceil', 'min', 'max']) {
        const A = { subScores: [unit(null, 4), unit(2.5, 4)] };
        const B = { subScores: [unit(1.4, 4), unit(null, 4)] };
        const out = mergeDualSubScores(A, B, { roundStep: 1, roundMethod: 'round' }, mode);
        assert.strictEqual(out[0].score, 1.4, `${mode}：A 缺分应直取 B 原值 1.4（不吸附成 1）`);
        assert.strictEqual(out[1].score, 2.5, `${mode}：B 缺分应直取 A 原值 2.5`);
        const bothNull = mergeDualSubScores({ subScores: [unit(null, 4)] }, { subScores: [unit(null, 4)] }, { roundStep: 1 }, mode);
        assert.strictEqual(bothNull[0].score, null, `${mode}：双侧 null 保持 null`);
    }
});

test('NaN 传染语义不放松（任一侧 NaN → NaN）', () => {
    const { mergeDualSubScores } = loadEngine().fx;
    const A = { subScores: [unit(NaN, 4)] };
    const B = { subScores: [unit(2, 4)] };
    for (const mode of ['round', 'floor', 'ceil', 'min', 'max']) {
        const out = mergeDualSubScores(A, B, { roundStep: 1, roundMethod: 'round' }, mode);
        assert.ok(Number.isNaN(out[0].score), `${mode}：NaN 必须传染，不得被静默修正`);
    }
});

test('长度不齐/单侧无 subScores：原样返回 detailA（所有模式一致）', () => {
    const { mergeDualSubScores } = loadEngine().fx;
    const A = { subScores: [unit(2, 4)] };
    const B = { subScores: [unit(1, 4), unit(2, 4)] };
    for (const mode of ['round', 'floor', 'ceil', 'min', 'max']) {
        assert.strictEqual(mergeDualSubScores(A, B, { roundStep: 1 }, mode), A.subScores, `${mode}：长度不齐不得合并`);
    }
    assert.strictEqual(mergeDualSubScores({ subScores: null }, B, { roundStep: 1 }, 'min'), null);
});

test('评语并列语义不变（措辞不同 → A/B 并列）', () => {
    const { mergeDualSubScores } = loadEngine().fx;
    const A = { subScores: [unit(2, 4, { comment: '思路清晰' })] };
    const B = { subScores: [unit(1, 4, { comment: '过程跳步' })] };
    const out = mergeDualSubScores(A, B, { roundStep: 1 }, 'min');
    assert.strictEqual(out[0].comment, 'A: 思路清晰；B: 过程跳步');
});

// ---------- mergeDualValue：总分合并（共识路径与仲裁降级路径共用） ----------
test('mergeDualValue 五模式 + 满分钳制（总分口径；各模式期望互不重合，变异可红）', () => {
    const { mergeDualValue } = loadEngine().fx;
    const snap = { roundStep: 1, roundMethod: 'round' };
    // round：(8,5) 均值 6.5→7 杀 floor/min/max；(7,5.4) 均值 6.2→6 杀 ceil；(8,6) 均值 7 锁整数均值
    assert.strictEqual(mergeDualValue(8, 5, snap, 10, undefined), 7, '缺省 = round');
    assert.strictEqual(mergeDualValue(8, 6, snap, 10, 'round'), 7);
    assert.strictEqual(mergeDualValue(7, 5.4, snap, 10, 'round'), 6);
    // floor：(7,6.5) 均值 6.75→6 杀 round(7)/ceil(7)/min(吸附 7)/max(7)
    assert.strictEqual(mergeDualValue(7, 6.5, snap, 10, 'floor'), 6);
    // ceil：(10,6.2) 均值 8.1→9 杀 round/floor(8)/min(6)/max(10)
    assert.strictEqual(mergeDualValue(10, 6.2, snap, 10, 'ceil'), 9);
    assert.strictEqual(mergeDualValue(8, 5, snap, 10, 'min'), 5);
    assert.strictEqual(mergeDualValue(8, 5, snap, 10, 'max'), 8);
    // 外向吸附（返修①）：min→floor 只降不升、max→ceil 只升不降
    assert.strictEqual(mergeDualValue(1.5, 2, snap, 10, 'min'), 1, '取低分绝不输出高于低分的值');
    assert.strictEqual(mergeDualValue(1.4, 1.2, snap, 10, 'max'), 2, '取高分绝不输出低于高分的值');
    // 满分钳制在所有模式下不变
    assert.strictEqual(mergeDualValue(8, 5, snap, 6, 'max'), 6, 'max 8 超满分 6 → 钳制');
    assert.strictEqual(mergeDualValue(4, 5, snap, 4, 'ceil'), 4, 'ceil 5 → 钳制到 4');
});

// ---------- callDualEvaluation 接线（共识路径 + 仲裁降级路径走同一策略） ----------
function setupDual({ mergeMode, threshold, scoring, scores }) {
    const { fx, sandbox } = loadEngine();
    sandbox.__stubGrading = (async () => {
        const s = scores.shift();
        return {
            score: s.score, rawScore: s.score, comment: '', studentAnswer: '作答',
            diligenceLevel: 0, diligenceReason: '',
            subScores: s.subScores.map(([label, v]) => ({ id: label, label, score: v, maxScore: 10, comment: '' })),
            _sections: {},
        };
    });
    sandbox.__stubWf = () => ({
        id: 'dual', name: '双评',
        model: { provider: 'p1', model: 'm1' },
        dualEval: {
            enabled: true, threshold,
            secondary: { provider: 'p2', model: 'm2' },
            arbitration: { provider: 'p3', model: 'm3' },
            ...(mergeMode !== undefined ? { mergeMode } : {})
        }
    });
    sandbox.__stubCfg = (provider) => (provider === 'p3' ? null : { apiKey: 'k', model: 'mm', endpoint: 'https://e.test' });
    vm.runInContext('callAIGrading = __stubGrading; WorkflowManager.getWorkflow = __stubWf; ProviderManager.getCallConfig = __stubCfg;', sandbox);
    return fx.callDualEvaluation(['IMG'], { workflowId: 'dual', scoring: scoring || { roundStep: 1, roundMethod: 'round' } }, null);
}

test('共识路径接线：mergeMode=min 时总分与小题分都取低分', async () => {
    const result = await setupDual({
        mergeMode: 'min', threshold: 5,
        scores: [
            { score: 4, subScores: [['56', 2], ['57', 2]] },
            { score: 2, subScores: [['56', 1], ['57', 1]] },
        ],
    });
    assert.strictEqual(result.score, 2, '总分取低分 min(4,2)=2');
    assert.deepStrictEqual(host(result.subScores.map(s => s.score)), [1, 1], '小题分也取低分');
    assert.strictEqual(result.dualEval.result, 'consensus');
});

test('共识路径接线：mergeMode 缺字段 = round（旧配置行为不变）', async () => {
    const result = await setupDual({
        mergeMode: undefined, threshold: 5,
        scores: [
            { score: 4, subScores: [['56', 2], ['57', 2]] },
            { score: 2, subScores: [['56', 1], ['57', 1]] },
        ],
    });
    // 历史行为：小题平均取整 [2,2]，与平均总分 3 不一致时以小题之和为准 → 4
    assert.deepStrictEqual(host(result.subScores.map(s => s.score)), [2, 2], 'round 平均取整与历史逐值一致');
    assert.strictEqual(result.score, 4, '小题之和一致性校准不变');
});

test('仲裁降级路径接线：仲裁模型配置不完整时按 mergeMode 合并（floor）', async () => {
    const result = await setupDual({
        mergeMode: 'floor', threshold: 1,
        scoring: { roundStep: 1, roundMethod: 'round', maxScore: 10 },
        scores: [
            { score: 8, subScores: [['56', 8]] },
            { score: 5, subScores: [['56', 5]] },
        ],
    });
    assert.strictEqual(result.dualEval.result, 'average-fallback');
    assert.strictEqual(result.subScores[0].score, 6, '(8+5)/2=6.5 → floor 到 1 梯度 = 6');
});

// ---------- 工作流迁移兼容：内置工作流缺 mergeMode → 补 'round' ----------
test('迁移兼容：内置双评工作流缺 mergeMode 时补 round', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'ai-engine.js'), 'utf8');
    const seeded = {
        workflows: {
            '双评模式(高精度)': {
                id: 'dual', isBuiltin: true, description: '',
                model: { provider: '5plus1官方', model: 'aimarker-fast' },
                dualEval: {
                    enabled: true, threshold: 2,
                    secondary: { provider: '5plus1官方', model: 'aimarker-fast' },
                    arbitration: { provider: '5plus1官方', model: 'aimarker-pro' }
                    // 故意缺 mergeMode / _migratedVersion —— 模拟旧版本存储
                }
            }
        },
        activeWorkflow: 'dual'
    };
    const store = { 'ai-grading-workflows': JSON.stringify(seeded) };
    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        window: {}, document: null,
        SCRIPT_CONFIG: { DEFAULT_ENDPOINT: 'x', DEFAULT_MODEL: 'y', VERSION: '9' },
        GM_getValue: (k, d) => (k in store ? store[k] : d),
        GM_setValue: (k, v) => { store[k] = v; },
        fetch: async () => { throw new Error('no net'); },
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        Math, JSON, Date, Error, RegExp, String, Number, Array, Object, Promise,
        parseFloat, parseInt, isNaN, isFinite, setTimeout, clearTimeout, AbortController,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/core/runtime.js'), 'utf8'), sandbox);
    vm.runInContext(src + ';__exports__ = WorkflowManager;', sandbox);
    assert.strictEqual(sandbox.__exports__.data.workflows['双评模式(高精度)'].dualEval.mergeMode, 'round',
        '版本升级迁移应为旧双评配置补 mergeMode=round');
});
