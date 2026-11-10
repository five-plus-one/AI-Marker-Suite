// ========== 答卷校验实验性开关：配置兼容性 + 行为回归 ==========
// 目标：证明
//   1. 旧数据迁移补 paperGuard.enabled=true，且绝不覆盖用户已有选择
//   2. 导出/导入经真实净化路径（PresetManager.sanitizePreset，#296）后 paperGuard 保全
//   3. 【行为级】main.js 主流程按开关生效：
//      - enabled=false → 答卷校验完全跳过（不复查取图、换卷也照常填分）
//      - enabled=true / 缺省 → 校验执行，换卷必拦（不填分、可见提示）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 过闸有效真 PNG（16×16，77 字节）：废图闸地板是 <15px 剔除，1×1 会反走废图路径；
// 真 PNG 保证闸的真实头解析路径被走到（'QUJD' 裸 base64 只落"未知格式不误杀"旁路）
const PNG_16x16 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR4nGP4TyJgGNUwqmH4agAAr639H708R/EAAAAASUVORK5CYII=';

function loadPreset(initialList) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'preset.js'), 'utf8');
    const store = { 'ai-grading-presets': JSON.stringify({ list: initialList, active: Object.keys(initialList)[0] || '默认配置', bindings: {} }) };
    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        window: {},
        SCRIPT_CONFIG: { DEFAULT_ENDPOINT: '', DEFAULT_MODEL: '' },
        GM_getValue: (k, d) => (k in store ? store[k] : d),
        GM_setValue: (k, v) => { store[k] = v; },
        JSON, Math, Date, Error, String, Number, Array, Object, parseFloat, parseInt, isNaN, setTimeout, clearTimeout,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext('var restoreConfigIfMissing = undefined;' + src + ';__exports__ = PresetManager;', sandbox);
    return sandbox.__exports__;
}

const base = {
    question: { text: '', images: [], format: 'plain' },
    answer: { text: '', images: [], format: 'plain' },
    rubric: { text: '', images: [], format: 'plain' },
    scoring: { roundStep: 1, roundMethod: 'round' }
};

test('旧数据自动补 paperGuard.enabled = true', () => {
    const PM = loadPreset({ '默认配置': { ...base } });
    assert.strictEqual(PM.data.list['默认配置'].paperGuard.enabled, true);
});

test('用户关闭后迁移不覆盖', () => {
    const PM = loadPreset({ '我的方案': { ...base, paperGuard: { enabled: false } } });
    assert.strictEqual(PM.data.list['我的方案'].paperGuard.enabled, false);
});

test('导出/导入经真实净化路径后保全 paperGuard（#296 导入路径）', () => {
    // 走 ui-settings.js 导入链路的同一函数 PresetManager.sanitizePreset，
    // 而不是测试里裸 JSON 往返（旧断言测的是 JSON 自身，非被测代码）
    const PM = loadPreset({ '默认配置': { ...base } });
    const preset = { ...base, paperGuard: { enabled: false } };
    // 导出形态与 ui-settings.js:1368 一致：{type, name, preset} 整对象 JSON 往返
    const exported = JSON.stringify({ type: 'ai-marker-preset', name: 'x', preset });
    const imported = PM.sanitizePreset(JSON.parse(exported).preset);
    assert.strictEqual(imported.paperGuard.enabled, false, '净化不得剥掉 paperGuard');
    // 导入后走 migrateAll 补齐其余缺失字段，且不得覆盖用户关闭
    PM.data.list['导入方案'] = imported;
    PM.migrateAll();
    assert.strictEqual(PM.data.list['导入方案'].paperGuard.enabled, false, '迁移不得覆盖用户关闭');
});

test('导入旧版本方案后 migrateAll 补齐 paperGuard', () => {
    const PM = loadPreset({ '默认配置': { ...base } });
    PM.data.list['导入的旧方案'] = { ...base };   // 无 paperGuard
    PM.migrateAll();
    assert.strictEqual(PM.data.list['导入的旧方案'].paperGuard.enabled, true);
});

// ========== 开关行为回归（替换旧「源码含开关分支」文本存在性断言）==========
// 沿用 paper-guard.test.js 的 vm 提取加载器模式：把 startAutoGrading 连同答卷校验
// 依赖的辅助函数提取进沙箱，外部依赖打桩后驱动真实主流程，断言开关两种取值下
// 「答卷校验是否执行、填分是否继续」的行为差异（旧断言只查 src.includes，
// 任何无关的 enabled === false 都能满足，门控改坏测试仍绿）。
//
// 被测语义（main.js:468-482 注释明示）：开关是误报受害者的逃生阀，
// enabled=false = 完全跳过校验（含换卷场景照常填分）；缺省 = 校验开启。
function grabFrom(src, name) {
    const re = new RegExp('(?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}');
    const m = src.match(re);
    assert.ok(m, name + ' 函数未找到');
    return m[0];
}

async function runMainFlow({ paperGuard, changePaper }) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'main.js'), 'utf8');
    const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'ai-engine.js'), 'utf8');
    const parts = [
        // startAutoGrading 依赖废图闸（工单①，实现在 ai-engine.js）；沙箱无 atob 时闸不误杀
        grabFrom(engineSrc, 'probeImageDimensions'), grabFrom(engineSrc, 'filterUsableImagesForAI'),
        grabFrom(src, 'normalizePaperImageUrl'), grabFrom(src, 'paperUrlSetContains'),
        grabFrom(src, 'snapshotScoreInputs'), grabFrom(src, 'scoreInputsTransitionedEmpty'),
        grabFrom(src, 'verifyPaperUnchanged'), grabFrom(src, 'confirmLeftMarkingPage'),
        grabFrom(src, 'validateScoresForFill'), grabFrom(src, 'safeFillScores'),   // N5 数值闸（startAutoGrading 填分依赖）
        grabFrom(src, 'startAutoGrading'),
    ];
    const calls = { gather: 0, fill: 0, fills: null, toasts: [], dialog: 0 };
    const adapter = {
        isMarkingPage: () => true,
        gatherAnswerImages: async () => {
            calls.gather++;
            // 首次取基准图；校验复查（第 2+ 次）时可模拟换卷
            return (changePaper && calls.gather > 1) ? ['https://x.com/NEW.png'] : ['https://x.com/a.png'];
        },
        fetchImageAsBase64: async () => PNG_16x16,
        getScoreInputs: () => [],
        fillScores: (scores) => { calls.fill++; calls.fills = scores; return true; },
    };
    const presetConfig = {
        question: { ...base.question },
        answer: { text: '参考答案', images: [], format: 'plain' },
        rubric: { text: '评分标准', images: [], format: 'plain' },
        scoring: { roundStep: 1, roundMethod: 'round' },
    };
    if (paperGuard !== undefined) presetConfig.paperGuard = paperGuard;

    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        window: {
            __AI_MARKER_ADAPTER__: adapter,
            aiGradingState: {
                isRunning: true, isPaused: false, gradingMode: 'normal',
                errorRetryCount: 0, currentBase64DataArray: [], currentImageUrls: [],
                blankDetection: { skipOnce: false, blankCount: 0 },
            },
        },
        document: { querySelector: () => null, getElementById: () => null },
        AbortController, JSON, Math, Date, Error, RegExp, String, Number, Array, Object, Promise,
        parseFloat, parseInt, isNaN,
        // setTimeout 同步桩：confirmLeftMarkingPage / 答卷校验复查的等待立即完成，
        // 测试确定性无真实时序依赖（时序盲区同 ai-response.test.js 注明）
        setTimeout: (fn) => fn(), clearTimeout: () => {},
        // —— startAutoGrading 的自由变量打桩 ——
        PresetManager: {
            data: { active: '默认配置' },
            getActiveCallConfig: () => ({ apiKey: 'k', model: 'm', endpoint: 'https://e.test' }),
            getCurrentConfig: () => presetConfig,
            validateScoringUnits: () => ({ valid: true, missingMaxScore: [] }),
            getMaxScore: () => 10,
        },
        WorkflowManager: { getWorkflow: () => null },
        extractFieldText: (f) => (f && f.text) || '',
        callAIGrading: async () => ({
            score: 8, rawScore: 8, comment: '', studentAnswer: '学生作答内容足够长',
            diligenceLevel: 0, subScores: null,
        }),
        recordOutputLimitOutcome: () => {},
        ScoreCalculator: {
            calculate: () => ({ finalScore: 8, finalUnitScores: null, bonus: 0, breakdown: { decayFactor: 0, accuracyScore: 8 } }),
        },
        showStreamPanel: () => {}, updateStreamPanel: () => {}, hideStreamPanel: () => {},
        showToast: (m) => { calls.toasts.push(String(m)); },
        safeAlert: (m) => { calls.toasts.push(String(m)); },
        openSettingsPanel: () => {}, stopAutoGrading: () => {}, handleLeaveMarkingPage: () => {},
        showAutoSubmitDialog: () => { calls.dialog++; },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(parts.join('\n') + '\n;__run = startAutoGrading;', sandbox);
    await sandbox.__run();
    return calls;
}

test('行为：enabled=false 时校验完全跳过——换卷也照常填分（不复查取图）', async () => {
    const calls = await runMainFlow({ paperGuard: { enabled: false }, changePaper: true });
    assert.strictEqual(calls.gather, 1, '校验被跳过：只应有初始取图，不得复查');
    assert.strictEqual(calls.fill, 1, '跳过校验 = 照常填分（用户显式关闭保护）');
    assert.strictEqual(calls.fills[0], 8);
    assert.ok(!calls.toasts.some(t => t.includes('答卷已切换')), '不得出现换卷拦截提示');
});

test('行为：enabled=true 时校验执行——换卷必拦（不填分、可见提示）', async () => {
    const calls = await runMainFlow({ paperGuard: { enabled: true }, changePaper: true });
    assert.strictEqual(calls.gather, 3, '初始取图 + 校验取图 + 校验复查（verify 内 1500ms 后二次取图），共 3 次');
    assert.strictEqual(calls.fill, 0, '换卷时绝不能填分');
    assert.strictEqual(calls.dialog, 0, '换卷时绝不能弹自动提交框');
    assert.ok(calls.toasts.some(t => t.includes('答卷已切换')), '换卷拦截必须可见提示，实际: ' + calls.toasts.join(' | '));
});

test('行为：paperGuard 缺省（旧方案未迁移）时按开启处理——换卷照拦', async () => {
    const calls = await runMainFlow({ paperGuard: undefined, changePaper: true });
    assert.strictEqual(calls.gather, 3, '缺省 = 校验开启，应复查取图');
    assert.strictEqual(calls.fill, 0, '缺省开启时换卷不得填分');
    assert.ok(calls.toasts.some(t => t.includes('答卷已切换')));
});

test('行为：enabled=true 且答卷未变化——放行零影响（复查命中即继续）', async () => {
    const calls = await runMainFlow({ paperGuard: { enabled: true }, changePaper: false });
    assert.strictEqual(calls.gather, 2, '初始取图 + 校验复查一次（命中即返回，不再复查）');
    assert.strictEqual(calls.fill, 1, '未变化必须照常填分');
    assert.strictEqual(calls.dialog, 1);
});
