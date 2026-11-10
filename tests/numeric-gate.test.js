// ========== N5 坑审计收口：core 填分数值闸 ==========
// 坑审计实锤：纠正流是唯一 NaN 入口（用户编辑/解析可注入 NaN/∞/负数），24 家全或无
// 适配器无数值闸。core 在填分汇聚点统一收口：全部分数 isFinite 且非负 → 否则显式拒绝
// + warn（不静默替 0/跳过）；越界（超满分）留给各适配器 maxScore 语义（不拦）。
// 变异可红：validateScoresForFill 恒 true / safeFillScores 旁路闸 → 必有红。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 过闸有效真 PNG（16×16，77 字节）：废图闸地板 <15px 剔除，1×1 会反走废图路径；
// 真 PNG 保证闸的真实头解析路径被走到（'QUJD' 裸 base64 只落"未知格式不误杀"旁路）
const PNG_16x16 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR4nGP4TyJgGNUwqmH4agAAr639H708R/EAAAAASUVORK5CYII=';

function grab(src, re, name) {
    const m = src.match(re);
    assert.ok(m, name + ' 未找到');
    return m[0];
}

const MAIN_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'main.js'), 'utf8');
const GATE = grab(MAIN_SRC, /function validateScoresForFill\([^)]*\) \{[\s\S]*?\n\}/, 'validateScoresForFill')
    + '\n' + grab(MAIN_SRC, /function safeFillScores\([^)]*\) \{[\s\S]*?\n\}/, 'safeFillScores');

function loadGate(spies) {
    const warns = [];
    const sandbox = {
        console: { log: () => {}, warn: (m) => warns.push(String(m)), error: () => {} },
        Math, JSON, Number, Array, Object, String, isFinite, parseInt, parseFloat,
        adapter: spies && spies.adapter,
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/core/runtime.js'), 'utf8'), sandbox);
    vm.runInContext(GATE + '\n;__exports__ = { validateScoresForFill, safeFillScores };', sandbox);
    return { ...sandbox.__exports__, warns };
}

// ---------- 闸本体 ----------
test('闸：合法分数放行（含 0 与超满分值——越界留给适配器 maxScore 语义）', () => {
    const { validateScoresForFill } = loadGate();
    assert.strictEqual(validateScoresForFill([0, 1.5, 100, 999], 't'), true);
    assert.strictEqual(validateScoresForFill([], 't'), true);
});

test('闸：NaN / ∞ / 负数 / 空值 / 非数值一律拒绝并 warn', () => {
    for (const bad of [[NaN], [Infinity], [-Infinity], [-0.5], [null], [undefined], ['5'], [8, NaN]]) {
        const { validateScoresForFill, warns } = loadGate();
        assert.strictEqual(validateScoresForFill(bad, '测试'), false, `必须拒绝 ${JSON.stringify(bad)}`);
        assert.ok(warns.some(w => w.includes('数值闸')), '拒绝必须 warn「数值闸」');
    }
});

test('safeFillScores：拒绝时不触达 adapter.fillScores，返回 false', () => {
    let filled = 0;
    const { safeFillScores } = loadGate();
    const ok = safeFillScores({ fillScores: () => { filled++; return true; } }, [8, NaN], 't');
    assert.strictEqual(ok, false);
    assert.strictEqual(filled, 0, '非法分数绝不能触达适配器');
});

test('safeFillScores：合法值原样下传并透传适配器返回值', () => {
    let got = null;
    const { safeFillScores } = loadGate();
    const ok = safeFillScores({ fillScores: (s) => { got = s; return 'ADAPTER_RESULT'; } }, [1, 2.5], 't');
    assert.strictEqual(ok, 'ADAPTER_RESULT');
    assert.deepStrictEqual([...got], [1, 2.5]);
});

// ---------- 纠正流 NaN 注入被拦（坑审计：唯一 NaN 入口） ----------
function loadFillScoreWrapper(spy) {
    const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'ui-submit-dialog.js'), 'utf8');
    const wrapper = grab(uiSrc, /async function fillScore\([^)]*\) \{[\s\S]*?\n\}/, 'fillScore 包装器');
    const alerts = [];
    const dialogs = [];
    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        Math, JSON, Number, Array, Object, String, isFinite,
        window: { __AI_MARKER_ADAPTER__: spy.adapter, aiGradingState: {activeRun:{}} },
        verifyGradingContext: async()=>{}, isGradingContextCurrent:()=>true,
        snapshotScoreInputs: () => [],
        safeAlert: (m) => alerts.push(String(m)),
        showAutoSubmitDialog: (score, comment, subScores, extra) => dialogs.push({ score, extra }),
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/core/runtime.js'), 'utf8'), sandbox);
    sandbox.verifyGradingContext = async () => {};
    sandbox.isGradingContextCurrent = () => true;
    sandbox.requireGradingContextTarget = () => {};
    vm.runInContext(GATE + '\n' + wrapper + '\n;__exports__ = { fillScore };', sandbox);
    return { fillScore: sandbox.__exports__.fillScore, alerts, dialogs };
}

test('纠正流 NaN 注入被拦：小题分含 NaN → 不填入，显式人工通道', async () => {
    let filled = 0;
    const { fillScore, alerts, dialogs } = loadFillScoreWrapper({
        adapter: { fillScores: () => { filled++; return true; }, fillScore: () => { filled++; return true; } },
    });
    await fillScore(5, '评语', [{ label: '56(1)', score: 2 }, { label: '56(2)', score: NaN }]);
    assert.strictEqual(filled, 0, 'NaN 小题分绝不能进适配器');
    assert.ok(alerts.some(a => a.includes('非法数值')), '必须显式告警，实际: ' + alerts.join(' | '));
    assert.strictEqual(dialogs.length, 1, '仍弹确认框转人工');
    assert.strictEqual(dialogs[0].extra && dialogs[0].extra.fillFailed, true, '走 fillFailed 显式失败语义');
});

test('纠正流 NaN 注入被拦：总分 NaN（无小题）→ 不填入', async () => {
    let filled = 0;
    const { fillScore, alerts } = loadFillScoreWrapper({
        adapter: { fillScores: () => { filled++; return true; } },
    });
    await fillScore(NaN, '评语', null);
    assert.strictEqual(filled, 0);
    assert.ok(alerts.some(a => a.includes('非法数值')));
});

test('纠正流合法值照常填入（闸零影响）', async () => {
    let got = null;
    const { fillScore, dialogs } = loadFillScoreWrapper({
        adapter: { fillScores: (s) => { got = s; return true; } },
    });
    await fillScore(5, '评语', [{ label: '56(1)', score: 2 }, { label: '56(2)', score: 3 }]);
    assert.deepStrictEqual([...got], [2, 3]);
    assert.strictEqual(dialogs.length, 1);
    assert.ok(!dialogs[0].extra.fillFailed, '正常路径不得带 fillFailed');
});

// ---------- 主流程接线（startAutoGrading 真实链路） ----------
async function runMainFlowWithScore(finalScore) {
    const grabMain = (name) => grab(MAIN_SRC, new RegExp('(?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'), name);
    const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'ai-engine.js'), 'utf8');
    const parts = [
        grab(engineSrc, /(?:async )?function probeImageDimensions\([^)]*\) \{[\s\S]*?\n\}/, 'probeImageDimensions'),
        grab(engineSrc, /(?:async )?function filterUsableImagesForAI\([^)]*\) \{[\s\S]*?\n\}/, 'filterUsableImagesForAI'),
        GATE,
        grabMain('normalizePaperImageUrl'), grabMain('paperUrlSetContains'),
        grabMain('snapshotScoreInputs'), grabMain('scoreInputsTransitionedEmpty'),
        grabMain('verifyPaperUnchanged'), grabMain('confirmLeftMarkingPage'),
        grabMain('startAutoGrading'),
    ];
    const calls = { ai: 0, fill: 0, toasts: [] };
    const adapter = {
        isMarkingPage: () => true,
        gatherAnswerImages: async () => ['https://x.com/a.png'],
        fetchImageAsBase64: async () => PNG_16x16,
        getScoreInputs: () => [],
        fillScores: () => { calls.fill++; return true; },
    };
    const presetConfig = {
        question: { text: '', images: [], format: 'plain' },
        answer: { text: '答案', images: [], format: 'plain' },
        rubric: { text: '标准', images: [], format: 'plain' },
        scoring: { roundStep: 1, roundMethod: 'round' },
    };
    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        window: {
            location: { pathname: '/', hash: '' },
            __AI_MARKER_ADAPTER__: adapter,
            aiGradingState: {
                isRunning: true, isPaused: false, gradingMode: 'normal',
                errorRetryCount: 0, currentBase64DataArray: [], currentImageUrls: [],
                blankDetection: { skipOnce: false, blankCount: 0 },
            },
        },
        document: { querySelector: () => null, getElementById: () => null },
        AbortController, JSON, Math, Date, Error, RegExp, String, Number, Array, Object, Promise,
        parseFloat, parseInt, isNaN, isFinite,
        setTimeout: (fn) => fn(), clearTimeout: () => {},
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        PresetManager: {
            data: { active: '默认配置' },
            getActiveCallConfig: () => ({ apiKey: 'k', model: 'm', endpoint: 'https://e.test' }),
            getCurrentConfig: () => presetConfig,
            validateScoringUnits: () => ({ valid: true, missingMaxScore: [] }),
            getMaxScore: () => 10,
        },
        WorkflowManager: { getWorkflow: () => null },
        extractFieldText: (f) => (f && f.text) || '',
        callAIGrading: async () => ({ score: 8, rawScore: 8, comment: '', studentAnswer: '作答内容足够长', diligenceLevel: 0, subScores: null }),
        callDualEvaluation: async () => ({ score: 8, rawScore: 8, comment: '', studentAnswer: '作答内容足够长', diligenceLevel: 0, subScores: null }),
        recordOutputLimitOutcome: () => {},
        ScoreCalculator: {
            calculate: () => ({ finalScore, finalUnitScores: null, bonus: 0, breakdown: { decayFactor: 0, accuracyScore: 8 } }),
        },
        showStreamPanel: () => {}, updateStreamPanel: () => {}, hideStreamPanel: () => {},
        showToast: (m) => { calls.toasts.push(String(m)); },
        safeAlert: (m) => { calls.toasts.push(String(m)); },
        openSettingsPanel: () => {}, stopAutoGrading: () => {}, handleLeaveMarkingPage: () => {},
        showAutoSubmitDialog: () => {},
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/core/runtime.js'), 'utf8'), sandbox);
    vm.runInContext(parts.join('\n') + '\n;__run = startAutoGrading;', sandbox);
    await sandbox.__run();
    return calls;
}

test('主流程接线：最终分为 NaN → 数值闸拒绝，不填分、显式暂停', async () => {
    const calls = await runMainFlowWithScore(NaN);
    assert.strictEqual(calls.fill, 0, 'NaN 总分绝不能进适配器');
    assert.ok(calls.toasts.some(t => t.includes('分数填入失败')), '走既有显式失败通道，实际: ' + calls.toasts.join(' | '));
});

test('主流程接线：合法分数照常填入（闸零影响）', async () => {
    const calls = await runMainFlowWithScore(8);
    assert.strictEqual(calls.fill, 1);
});
