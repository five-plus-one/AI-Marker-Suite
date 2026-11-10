// ========== #273 评分步长自定义多种值（1.5/2/2.5…）：吸附+钳制语义测试 ==========
// 合法分数 = {0, s, 2s, …, floor(max/s)·s} ∪ {满分}（满分非步长整数倍时作特例）
// 同时保持 #214 不变量：默认配置（roundStep=1、不传 maxScore）行为逐值不变
const test = require('node:test');
const assert = require('node:assert');

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCore(file) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', file), 'utf8');
    const sandbox = {
        console, window: {}, document: null,
        setTimeout, clearTimeout, setInterval, clearInterval, Promise, Math, JSON, Date, Error, RegExp, String, Number, Array, Object, parseFloat, parseInt, isNaN,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src + '\n;__exports__ = { describeScoreStep: typeof describeScoreStep !== "undefined" ? describeScoreStep : null, ScoreCalculator: typeof ScoreCalculator !== "undefined" ? ScoreCalculator : null };', sandbox);
    return sandbox.__exports__;
}

function loadMergeDual() {
    const score = loadCore('score.js');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'ai-engine.js'), 'utf8');
    const fnMatch = src.match(/function mergeDualSubScores\(detailA, detailB, scoringConfig\) \{[\s\S]*?\n\}/);
    assert.ok(fnMatch, 'mergeDualSubScores 函数未找到');
    const sandbox = { ScoreCalculator: score.ScoreCalculator, console, Math, JSON };
    vm.createContext(sandbox);
    vm.runInContext(fnMatch[0] + ';__m = mergeDualSubScores;', sandbox);
    return sandbox.__m;
}

// ---------- 1.5 网格取整 ----------
test('1.5 步长取整落在网格上', () => {
    const { ScoreCalculator } = loadCore('score.js');
    const cfg = { roundStep: 1.5, roundMethod: 'round' };
    for (const [raw, expected] of [[0, 0], [1.5, 1.5], [0.8, 1.5], [0.74, 0], [2.2, 1.5], [2.3, 3], [9.5, 9], [10, 10.5]]) {
        assert.strictEqual(ScoreCalculator.round(raw, cfg), expected, `round(${raw}, step=1.5) 应为 ${expected}`);
    }
});

test('1.5 步长 + 满分 10：满分特例放行，越界钳制', () => {
    const { ScoreCalculator } = loadCore('score.js');
    const cfg = { roundStep: 1.5, roundMethod: 'round' };
    assert.strictEqual(ScoreCalculator.round(10, cfg, 10), 10, '满分 10 应作为特例放行（而非 10.5）');
    assert.strictEqual(ScoreCalculator.round(10.4, cfg, 10), 10, '越界应钳制到满分');
    assert.strictEqual(ScoreCalculator.round(100, cfg, 10), 10, '远超满分应钳制');
    assert.strictEqual(ScoreCalculator.round(9.2, cfg, 10), 9, '网格内正常吸附');
    assert.strictEqual(ScoreCalculator.round(-2, cfg, 10), 0, '负分钳制到 0');
});

test('2 / 2.5 等其它自定义步长同样工作', () => {
    const { ScoreCalculator } = loadCore('score.js');
    assert.strictEqual(ScoreCalculator.round(7, { roundStep: 2, roundMethod: 'round' }), 8);
    assert.strictEqual(ScoreCalculator.round(7, { roundStep: 2, roundMethod: 'round' }, 7), 7, '满分特例');
    assert.strictEqual(ScoreCalculator.round(3.6, { roundStep: 2.5, roundMethod: 'round' }), 2.5);
});

test('默认配置行为逐值不变（#214 不变量，含 maxScore 钳制为唯一新增语义）', () => {
    const { ScoreCalculator } = loadCore('score.js');
    const cfg = { roundStep: 1, roundMethod: 'round' };
    for (const x of [0, 0.4, 0.5, 1.5, 2.5, -0.5, 3.49, 7.5, 10.5001]) {
        assert.strictEqual(ScoreCalculator.round(x, cfg), Math.round(x), `round(${x}) 必须等于 Math.round(${x})`);
    }
    assert.strictEqual(ScoreCalculator.round(8, cfg, 10), 8, '范围内不变');
    assert.strictEqual(ScoreCalculator.round(12, cfg, 10), 10, '越界钳制为有意新增（此前会越界填入平台）');
});

// ---------- 提示词措辞 ----------
test('describeScoreStep(1.5) 措辞含倍数示例', () => {
    const { describeScoreStep } = loadCore('prompt.js');
    assert.strictEqual(describeScoreStep(1.5), '（1.5 的倍数，如 0、1.5、3）');
});

test('满分非步长整数倍时提示词补「可给满分」，整除时措辞不变', () => {
    const { describeScoreStep } = loadCore('prompt.js');
    const odd = describeScoreStep(1.5, 10);
    assert.ok(odd.includes('可给满分 10'), '非整除应提示可给满分，实际: ' + odd);
    const even = describeScoreStep(1.5, 15);
    assert.strictEqual(even, describeScoreStep(1.5), '整除时措辞应与不带满分时一致');
    // #214 回归：0.5 步长整除场景逐字不变
    assert.strictEqual(describeScoreStep(0.5, 4), '（0.5 的倍数，如 0、0.5、1、1.5、2）');
});

// ---------- 双评合并钳制 ----------
test('双评合并按 1.5 步长吸附且钳制到单元满分', () => {
    const mergeDualSubScores = loadMergeDual();
    const units = [{ roundStep: 1.5, maxScore: 10 }, { roundStep: 1.5, maxScore: 15 }];
    const a = { subScores: [{ label: '56', score: 10, comment: '', roundStep: 1.5, maxScore: 10 }, { label: '57', score: 15, comment: '', roundStep: 1.5, maxScore: 16 }] };
    const b = { subScores: [{ label: '56', score: 10, comment: '', roundStep: 1.5, maxScore: 10 }, { label: '57', score: 13.5, comment: '', roundStep: 1.5, maxScore: 16 }] };
    const out = mergeDualSubScores(a, b, { roundStep: 1.5, roundMethod: 'round', units });
    assert.strictEqual(out[0].score, 10, '(10+10)/2=10 不得取整成 10.5');
    // 可分辨用例（#297 测试审计）：满分设 16 使钳制不会产生 15，
    // 15 只能来自 1.5 网格吸附（14.25 → 9.5 个半数向上 → 15）
    assert.strictEqual(out[1].score, 15, '(15+13.5)/2=14.25 吸附 1.5 网格 → 15');
});

test('双评合并平均分吸附到 1.5 网格', () => {
    const mergeDualSubScores = loadMergeDual();
    const a = { subScores: [{ label: '56', score: 9, comment: '', roundStep: 1.5, maxScore: 15 }] };
    const b = { subScores: [{ label: '56', score: 6, comment: '', roundStep: 1.5, maxScore: 15 }] };
    const out = mergeDualSubScores(a, b, { roundStep: 1.5, roundMethod: 'round' });
    assert.strictEqual(out[0].score, 7.5, '(9+6)/2=7.5 在网格上应保留');
});

// ---------- roundMethod 白名单（#296） ----------
test('roundMethod 白名单：非法值回落 round，不得索引任意 Math 成员', () => {
    const { ScoreCalculator } = loadCore('score.js');
    assert.strictEqual(ScoreCalculator.round(2.5, { roundStep: 1, roundMethod: 'random' }), 3, 'random 必须回落 round');
    assert.strictEqual(ScoreCalculator.round(2.5, { roundStep: 1, roundMethod: 'sqrt' }), 3, 'sqrt 必须回落 round');
    assert.strictEqual(ScoreCalculator.round(2.5, { roundStep: 1, roundMethod: 'floor' }), 2, '合法 floor 保持');
    assert.strictEqual(ScoreCalculator.round(2.5, { roundStep: 1, roundMethod: 'ceil' }), 3, '合法 ceil 保持');
});

// ---------- 勤勉分配网格吸附（#289 二轮审计 A-3） ----------
test('勤勉加分分配后各单元吸附回自身步长网格', () => {
    const { ScoreCalculator } = loadCore('score.js');
    const res = ScoreCalculator.calculate({
        aiScore: 2,
        diligenceLevel: 5,
        maxScore: 13,
        scoringConfig: { roundStep: 1, roundMethod: 'round', diligence: { enabled: true } },
        aiUnitScores: [
            { label: 'A', score: 1, maxScore: 4, roundStep: 1.5 },
            { label: 'B', score: 1, maxScore: 9, roundStep: 1.5 }
        ]
    });
    assert.ok(res.bonus > 0, '本用例需要勤勉加分大于 0');
    res.finalUnitScores.forEach(u => {
        const step = u.roundStep;
        const onGrid = Math.abs(u.score / step - Math.round(u.score / step)) < 1e-9;
        const atMax = Math.abs(u.score - u.maxScore) < 1e-9;
        assert.ok(onGrid || atMax, `${u.label} 分数 ${u.score} 脱离步长 ${step} 网格（且非满分特例）`);
    });
});

// ---------- calculate 流水线集成 ----------
test('calculate() 单元分越界取整后钳制到单元满分（1.5 步长）', () => {
    const { ScoreCalculator } = loadCore('score.js');
    const res = ScoreCalculator.calculate({
        aiScore: 10,
        diligenceLevel: 0,
        maxScore: 10,
        scoringConfig: { roundStep: 1.5, roundMethod: 'round' },
        aiUnitScores: [{ label: '56', score: 10, maxScore: 10 }]
    });
    assert.strictEqual(res.finalUnitScores[0].score, 10, '单元分应钳制为 10（而非 10.5）');
    assert.strictEqual(res.finalScore, 10);
});
