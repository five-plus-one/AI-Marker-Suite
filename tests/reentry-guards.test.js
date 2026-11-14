// ========== strict-a 附录 C：core 三守卫回归测试 ==========
// C.2 confirmSubmitFn 重入闩：双击「确认提交」/点击×倒计时/auto-confirm 三入口并发
//     只允许一次提交（HistoryManager.add + submitGrade 不得双跑）
// C.1 回评面板：init 重调度双跑只弹一次回评面板（内存门闩 + 读取即消费）
// C.3 init in-running 闩：并发双 init 只建一次 UI；完成后允许合法重跑
//     （SPA 从列表页进批改页需重建 UI —— 只挡并发、不挡顺序重跑，语义锁定防"加固"成永久闩）
// 全部用例变异可红（见用例内注释的变异点）。
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

// ---------- C.2 confirmSubmitFn 重入闩 ----------
function loadConfirmSubmit() {
    const {env,load}=require('./_audit-harness');const e=env();
    load(e,'src/core/main.js');load(e,'src/core/ui-submit-dialog.js');
    e.sb.updateBatchProgress=()=>e.calls.progress++;
    const dialog=e.sb.showAutoSubmitDialog(5,'test',null);
    const calls={get submit(){return e.calls.submit.length},get history(){return e.calls.history.length},get progress(){return e.calls.progress}};
    return {confirmSubmitFn:dialog.confirmSubmit,calls};
}

test('C.2 双连点只提交一次：点击×2 并发不得双跑 History.add / submitGrade', async () => {
    const { confirmSubmitFn, calls } = loadConfirmSubmit();
    const p1 = confirmSubmitFn();
    const p2 = confirmSubmitFn();   // 第二击在首次 submitGrade await 中到达
    await Promise.all([p1, p2]);
    assert.strictEqual(calls.submit, 1, 'submitGrade 只能提交一次（双提交=事故）');
    assert.strictEqual(calls.history, 1, '历史记录只能写一条');
    assert.strictEqual(calls.progress, 1, '批阅份数只能计一次');
});

test('C.2 三入口并发（点击×倒计时×auto-confirm）仍只提交一次', async () => {
    const { confirmSubmitFn, calls } = loadConfirmSubmit();
    const ps = [confirmSubmitFn(), confirmSubmitFn(), confirmSubmitFn()];
    await Promise.all(ps);
    assert.strictEqual(calls.submit, 1);
    assert.strictEqual(calls.history, 1);
});

test('C.2 同一弹窗完成后不可再次提交', async () => {
    const { confirmSubmitFn, calls } = loadConfirmSubmit();
    await confirmSubmitFn();
    // 闩已释放：后续（无并发竞态的）调用不再被闩死——但生产入口此时已全部拆除
    await confirmSubmitFn();
    assert.strictEqual(calls.submit, 1, '迟到回调不能再次提交同一份试卷');
});

// ---------- C.1 + C.3：init 重入闩 / 回评面板消费 ----------
function makeSessionStore(init) {
    const s = { ...(init || {}) };
    return {
        getItem: (k) => (k in s ? s[k] : null),
        setItem: (k, v) => { s[k] = v; },
        removeItem: (k) => { delete s[k]; },
    };
}

function loadMainInit({ session, panelCalls, buttonCalls } = {}) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'main.js'), 'utf8');
    const body = grab(src, /(?:async )?function runInitBody\([^)]*\) \{[\s\S]*?\n\}/, 'runInitBody');
    const resume = grab(src, /function resumeGradingAfterReload\([^)]*\) \{[\s\S]*?\n\}/, 'resumeGradingAfterReload');
    const latch = grab(src, /let _initInFlight = false;[\s\S]*?async function init\(\) \{[\s\S]*?\n\}/, 'init 重入闩');
    const panels = panelCalls || { n: 0 };
    const buttons = buttonCalls || { main: 0, settings: 0, history: 0 };
    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        Date, Math, JSON, Promise, parseInt,
        setTimeout: (fn) => fn(), clearTimeout: () => {},   // 同步桩：init 内固定等待立即完成
        window: {
            top: null,
            aiGradingState: { isRunning: false, isPaused: false, errorRetryCount: 0, currentBase64DataArray: [] },
            __AI_MARKER_ADAPTER__: {
                gatherAnswerImages: async () => ['https://x.com/a.png'],
                fetchImageAsBase64: async () => PNG_16x16,
                isMarkingPage: () => true,
            },
        },
        document: { querySelector: () => null, getElementById: () => null, addEventListener: () => {} },
        SCRIPT_CONFIG: { VERSION: '0' },
        sessionStorage: session || makeSessionStore(),
        GM_getValue: () => false,
        detectMarkingPage: async () => true,
        isToolsPageMode: () => false,
        initToolsPageMode: async () => {},
        createHistoryOnlyButton: () => { buttons.history++; },
        createMainButton: () => { buttons.main++; },
        createSettingsPanel: () => { buttons.settings++; },
        updateMainButtonState: () => {},
        initBatchProgress: () => {}, renderBatchProgress: () => {}, checkForUpdate: () => {},
        showToast: () => {}, toggleAutoGrading: () => {}, showAlertModal: () => Promise.resolve(),
        PresetManager: { data: { active: 'x' }, getCurrentConfig: () => ({}), getActiveCallConfig: () => ({}) },
        ProviderManager: {}, WorkflowManager: {},
        HistoryManager: { getById: () => ({ aiScore: 5, aiComment: '', studentAnswer: '答', subScores: [] }) },
        // 回评链依赖（stub/真实按需）
        waitForImagesReadyForRegrade: async () => {},
        filterUsableImagesForAI: (list) => ({ kept: list || [], removed: [] }),
        fetchImageAsBase64: async () => PNG_16x16,
        showCorrectionPanel: (context) => { panels.n++; panels.context = context; },
        fillScore: () => {},
        createGradingContext: () => ({ controller: new AbortController(), imageUrls: [], base64DataArray: [] }),
        requireCurrentGradingContext: () => {}, verifyGradingContext: async () => {},
        readGradingPaperIdentity: () => null, requireGradingContextTarget: () => {},
        isGradingContextCurrent: () => true, invalidateGradingRun: () => {}, snapshotScoreInputs: () => [],
    };
    sandbox.window.top = sandbox.window;   // window === window.top（非 iframe）
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(resume + '\n' + body + '\n' + latch + '\n;__exports__ = { init };', sandbox);
    return { init: sandbox.__exports__.init, panels, buttons, sandbox };
}

test('回评填分只进入确认步骤，提交前保留原历史状态', async () => {
    const session = makeSessionStore({ 'ai-grading-regrade': JSON.stringify({ id: 'r1' }) });
    const { init, panels, sandbox } = loadMainInit({ session });
    const writes = [], fills = [];
    sandbox.HistoryManager.update = (...args) => writes.push(args);
    sandbox.fillScore = async (...args) => { fills.push(args); return true; };
    await init(); await flushAsync();
    await panels.context.onAccept(6, { isCorrected: true, correctionReason: '教师确认' });
    assert.strictEqual(fills.length, 1);
    assert.strictEqual(fills[0][4].regradeId, 'r1');
    assert.strictEqual(writes.length, 0);
});

test('C.3 并发双 init 只建一次 UI（in-running 闩）', async () => {
    const { init, buttons } = loadMainInit();
    const p1 = init();
    const p2 = init();   // 任务切换重调度的 setTimeout(init) 与 boot 并发
    await Promise.all([p1, p2]);
    assert.strictEqual(buttons.main, 1, '并发双 init 只能建一次主按钮（双 UI=缺陷）');
    assert.strictEqual(buttons.settings, 1, '设置面板只能建一次');
});

test('启动写入失败时仍创建界面并提示重新保存', async () => {
    const { init, buttons, sandbox } = loadMainInit();
    const notices = [];
    sandbox.ProviderManager._initialSaveFailed = true;
    sandbox.showToast = message => notices.push(message);
    await init();
    assert.strictEqual(buttons.main, 1);
    assert.strictEqual(buttons.settings, 1);
    assert.ok(notices.some(message => message.includes('重新保存')));
});

test('检测等待期间离开页面或更换平台不会创建旧页面入口', async () => {
    for (const change of ['route', 'adapter']) {
        const { init, buttons, sandbox } = loadMainInit();
        sandbox.window.location = { href: 'https://platform.test/marking' };
        sandbox.detectMarkingPage = async () => {
            if (change === 'route') sandbox.window.location.href = 'https://platform.test/list';
            else sandbox.window.__AI_MARKER_ADAPTER__ = {};
            return true;
        };
        await init();
        assert.strictEqual(buttons.main, 0);
        assert.strictEqual(buttons.settings, 0);
    }
});

test('C.3 闩为 in-running 语义：完成后合法重跑（SPA 列表页→批改页需重建 UI）', async () => {
    const { init, buttons } = loadMainInit();
    await init();
    await init();   // 顺序重跑必须放行——createMainButton 自身有去重（ui-button.js:189）
    assert.strictEqual(buttons.main, 2, '顺序重跑不得被闩死（永久闩会挡住 SPA 进批改页的 UI 重建）');
});

async function flushAsync() {
    // 清空微任务级联（init 内 setTimeout(…,0) 的 async 回调）
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
}

test('C.1 内存门闩独立兜底：消费失效时 init 重调度双跑仍只弹一次回评面板', async () => {
    // 模拟 sessionStorage.removeItem 静默失效（权限/配额边缘）：此时只剩内存门闩防双面板。
    // 该用例独立杀死「去掉 !_regradeConsumed」变异；消费即标记由下一用例独立锁定。
    const session = makeSessionStore({ 'ai-grading-regrade': JSON.stringify({ id: 'r1' }) });
    session.removeItem = () => {};
    const { init, panels } = loadMainInit({ session });
    await init();
    await init();   // 同页面生命周期内的第二次 init（任务切换重调度）
    await flushAsync();
    assert.strictEqual(panels.n, 1, '回评面板只能弹一次（双面板=同一记录双改）');
});

test('C.1 消费即标记：刷新（新页生命周期）不重复弹面板', async () => {
    const session = makeSessionStore({ 'ai-grading-regrade': JSON.stringify({ id: 'r1' }) });
    const panels = { n: 0 };
    // 第一次"页面加载"
    const run1 = loadMainInit({ session, panelCalls: panels });
    await run1.init();
    await flushAsync();
    // 第二次"页面加载"（刷新）：共享同一 sessionStorage，内存门闩已随页面重置
    const run2 = loadMainInit({ session, panelCalls: panels });
    await run2.init();
    await flushAsync();
    assert.strictEqual(panels.n, 1, '消费即标记：刷新后不得重复弹回评面板');
});
