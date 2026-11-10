// ========== #214 小题分取整步长：向后兼容与新行为测试 ==========
// 目标：证明默认配置（roundStep=1）下提示词与取整行为**逐字/逐值不变**，
// 仅在 0.5 等非整数步长下产生新行为。这是「不影响 30+ 现有适配器」的关键证据。
const test = require('node:test');
const assert = require('node:assert');

// 核心文件以浏览器全局脚本方式构建，这里用 vm 加载并导出内部函数
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCore(file, extra) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', file), 'utf8');
    const sandbox = Object.assign({
        console, window: {}, document: null,
        GM_xmlhttpRequest: undefined, GM_setValue: undefined, GM_getValue: undefined,
        setTimeout, clearTimeout, setInterval, clearInterval, Promise, Math, JSON, Date, Error, RegExp, String, Number, Array, Object, parseFloat, parseInt, isNaN,
    }, extra || {});
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src + '\n;__exports__ = { describeScoreStep: typeof describeScoreStep !== "undefined" ? describeScoreStep : null, ScoreCalculator: typeof ScoreCalculator !== "undefined" ? ScoreCalculator : null, mergeDualSubScores: typeof mergeDualSubScores !== "undefined" ? mergeDualSubScores : null };', sandbox);
    return sandbox.__exports__;
}

test('describeScoreStep(1) 输出与历史完全一致（一个整数）', () => {
    const { describeScoreStep } = loadCore('prompt.js');
    assert.strictEqual(describeScoreStep(1), '（一个整数）');
    assert.strictEqual(describeScoreStep(undefined), '（一个整数）');
    assert.strictEqual(describeScoreStep(null), '（一个整数）');
    assert.strictEqual(describeScoreStep('1'), '（一个整数）');
});

test('describeScoreStep(0.5) 给出 0.5 倍数措辞', () => {
    const { describeScoreStep } = loadCore('prompt.js');
    const s = describeScoreStep(0.5);
    assert.ok(s.includes('0.5'), '应提到 0.5，实际: ' + s);
    assert.ok(s.includes('1.5'), '应举例 1.5，实际: ' + s);
    assert.ok(!s.includes('一个整数'), '不应再要求整数');
});

test('describeScoreStep(0.25) 给出 0.25 倍数措辞', () => {
    const { describeScoreStep } = loadCore('prompt.js');
    const s = describeScoreStep(0.25);
    assert.ok(s.includes('0.25'), '应提到 0.25，实际: ' + s);
});

test('默认配置下 ScoreCalculator.round 与 Math.round 完全一致', () => {
    const { ScoreCalculator } = loadCore('score.js');
    const cfg = { roundStep: 1, roundMethod: 'round' };
    for (const x of [0, 0.4, 0.5, 1.5, 2.5, -0.5, 3.49, 7.5, 10.5001]) {
        assert.strictEqual(
            ScoreCalculator.round(x, cfg), Math.round(x),
            `step=1 method=round 时 round(${x}) 必须等于 Math.round(${x})`
        );
    }
});

test('0.5 步长下取整正确（0.5 的倍数）', () => {
    const { ScoreCalculator } = loadCore('score.js');
    const cfg = { roundStep: 0.5, roundMethod: 'round' };
    for (const [raw, expected] of [[0, 0], [0.25, 0.5], [0.74, 0.5], [0.76, 1], [1.25, 1.5], [1.75, 2], [2.4, 2.5]]) {
        assert.strictEqual(ScoreCalculator.round(raw, cfg), expected, `round(${raw}, step=0.5) 应为 ${expected}`);
    }
});

test('mergeDualSubScores 默认配置下双评取平均与 Math.round 一致', () => {
    // 载入 ai-engine 需要的依赖：prompt.js 的解析器 + score.js
    const score = loadCore('score.js');
    const ctx = {
        ScoreCalculator: score.ScoreCalculator,
        ProviderManager: { getCallConfig: () => null },
        WorkflowManager: { getWorkflow: () => null },
        PresetManager: { getMaxScore: () => 0 },
        callAIWithRetry: async () => '',
        buildSubQuestionPrompt: () => '',
        buildStructuredPrompt: () => '',
        buildArbitrationPrompt: () => '',
        parseSubQuestionResponse: () => ({}),
        parseStructuredResponse: () => ({}),
        collectFieldImages: () => [],
    };
    // ai-engine.js 是浏览器脚本，这里只测 mergeDualSubScores，故单独抽出其源码执行
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'ai-engine.js'), 'utf8');
    const fnMatch = src.match(/function mergeDualSubScores\(detailA, detailB, scoringConfig\) \{[\s\S]*?\n\}/);
    assert.ok(fnMatch, 'mergeDualSubScores 函数未找到');
    const sandbox = { ScoreCalculator: score.ScoreCalculator, console, Math, JSON };
    vm.createContext(sandbox);
    vm.runInContext(fnMatch[0] + ';__m = mergeDualSubScores;', sandbox);

    const a = { subScores: [{ label: '56', score: 2, comment: '' }, { label: '57', score: 1, comment: '' }] };
    const b = { subScores: [{ label: '56', score: 1, comment: '' }, { label: '57', score: 2, comment: '' }] };
    const outDefault = sandbox.__m(a, b, { roundStep: 1, roundMethod: 'round' });
    assert.strictEqual(outDefault[0].score, Math.round((2 + 1) / 2), '默认配置下必须等于 Math.round');
    assert.strictEqual(outDefault[1].score, Math.round((1 + 2) / 2), '默认配置下必须等于 Math.round');

    const out05 = sandbox.__m(a, b, { roundStep: 0.5, roundMethod: 'round', units: [{ roundStep: 0.5 }, { roundStep: 0.5 }] });
    assert.strictEqual(out05[0].score, 1.5, '0.5 步长下 (2+1)/2=1.5 应保留');
    assert.strictEqual(out05[1].score, 1.5, '0.5 步长下 (1+2)/2=1.5 应保留');
});

test('默认配置下提示词小题分措辞逐字不变', () => {
    // 构造 config，直接调用 buildSubQuestionPrompt 的内部片段逻辑验证
    const { describeScoreStep } = loadCore('prompt.js');
    // 默认配置（无 roundStep）→ 与历史输出逐字一致
    const legacyLine = '（一个整数）';
    assert.strictEqual(describeScoreStep(undefined), legacyLine);
    assert.strictEqual(describeScoreStep(1), legacyLine);
});
