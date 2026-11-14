const test = require('node:test');
const assert = require('node:assert/strict');
const { env, load, vm } = require('./_audit-harness');

function scene(enabled = true) {
    const e = env();
    e.cfg.questionGuard = { enabled };
    let question = { question: '17', units: [{ label: '1', maxScore: 4 }, { label: '2', maxScore: 5 }, { label: '3', maxScore: 1 }] };
    let reads = 0;
    e.adapter.getQuestionContext = () => { reads++; return question; };
    load(e, 'src/core/main.js'); load(e, 'src/core/ui-submit-dialog.js');
    const mount = e.sb.getUIRoot;
    load(e, 'src/core/ui-button.js'); e.sb.getUIRoot = mount;
    return Object.assign(e, { change: value => { question = value; }, reads: () => reads });
}

test('默认关闭和非布尔开启值均不读取题号、不影响旧流程', async () => {
    for (const enabled of [false, undefined, 'true', 1]) {
        const e = scene(false); e.cfg.questionGuard = { enabled };
        const context = e.sb.createGradingContext();
        e.change({ question: '18', units: [{ label: '1', maxScore: 10 }] });
        e.sb.requireGradingContextTarget(context);
        e.sb.monitorGradingQuestionChange();
        assert.equal(e.reads(), 0);
        assert.equal(e.state.isRunning, true);
    }
});

test('同题换卷、输入清空与数字全角不改变题目基准', () => {
    const e = scene(); const context = e.sb.createGradingContext();
    e.setPaper('B');
    e.change({ question: ' １７ ', units: [{ label: '１', maxScore: 4 }, { label: '２', maxScore: 5 }, { label: '３', maxScore: 1 }] });
    e.sb.requireGradingQuestionContext(context);
    const next = e.sb.createGradingContext();
    assert.equal(next.questionBaseline.key, context.questionBaseline.key);
    e.sb.monitorGradingQuestionChange();
    assert.equal(e.state.isRunning, true);
});

test('地址未变且小题序号相同，大题变化仍在下一份取图前暂停', async () => {
    const e = scene(); const first = e.sb.createGradingContext();
    e.setPaper('B'); e.change({ question: '18', units: first.questionBaseline.units });
    let images = 0; e.adapter.gatherAnswerImages = async () => { images++; return ['url']; };
    await e.sb.startAutoGrading();
    assert.equal(images, 0); assert.equal(e.calls.fill.length, 0);
    assert.equal(e.state.isPaused, true);
    assert.ok(e.calls.toasts.some(message => message.includes('题号或小题满分已变化')));
});

test('AI 请求期间换题时拒绝填分', async () => {
    const e = scene();
    e.sb.callAIGrading = async () => {
        e.change({ question: '18', units: [{ label: '1', maxScore: 10 }] });
        return { score: 8, studentAnswer: 'answer' };
    };
    await e.sb.startAutoGrading();
    assert.equal(e.calls.fill.length, 0); assert.equal(e.calls.submit.length, 0);
    assert.equal(e.state.isPaused, true);
});

test('确认窗口等待期间换题，三种模式均不提交和计入历史', async () => {
    for (const mode of ['normal', 'unattended', 'trial']) {
        const e = scene(); e.state.gradingMode = mode;
        const dialog = e.sb.showAutoSubmitDialog(8, 'test', null);
        e.change({ question: '18', units: [{ label: '1', maxScore: 10 }] });
        await dialog.confirmSubmit();
        assert.equal(e.calls.submit.length, 0, mode); assert.equal(e.calls.history.length, 0, mode);
        assert.ok(e.calls.toasts.some(message => message.includes('题号或小题满分已变化')), mode);
    }
});

test('轮询捕获大题、小题标识或满分变化，取消旧倒计时和请求', () => {
    for (const value of [
        { question: '18', units: [{ label: '1', maxScore: 10 }] },
        { question: '17', units: [{ label: '4', maxScore: 10 }] },
        { question: '17', units: [{ label: '1', maxScore: 10 }] }
    ]) {
        const e = scene(); const dialog = e.sb.showAutoSubmitDialog(8, '', null), context = e.state.activeRun;
        e.change(value); e.sb.monitorGradingQuestionChange();
        assert.equal(e.state.isPaused, true); assert.equal(e.state.isRunning, false);
        assert.equal(context.controller.signal.aborted, true); assert.equal(dialog.gradingDisposed, true);
    }
});

test('加载过渡期未读到题号不宣称换题，写入前等待核对', () => {
    const e = scene(); const context = e.sb.createGradingContext(); e.change(null);
    e.sb.monitorGradingQuestionChange(); assert.equal(e.state.isRunning, true);
    assert.throws(() => e.sb.requireGradingContextTarget(context), /暂未识别到完整题号/);
    e.change({ question: '17', units: context.questionBaseline.units });
    assert.doesNotThrow(() => e.sb.requireGradingContextTarget(context));
});

test('未支持的题号来源在开启选项后明确提示，关闭则按原流程运行', () => {
    const e = scene(); delete e.adapter.getQuestionContext;
    const context = e.sb.createGradingContext();
    assert.throws(() => e.sb.requireGradingContextTarget(context), /联系作者适配/);
    e.cfg.questionGuard.enabled = false;
    assert.doesNotThrow(() => e.sb.requireGradingContextTarget(e.sb.createGradingContext()));
});

test('只有教师主动继续才为当前题目建立新基准', () => {
    const e = scene(); e.sb.createGradingContext(); e.change({ question: '18', units: [{ label: '1', maxScore: 10 }] });
    assert.throws(() => e.sb.requireGradingQuestionContext(e.sb.createGradingContext()), /已变化/);
    e.sb.startAutoGrading = () => {};
    e.sb.resumeGrading(e.sb.document.querySelector('.ai-grade-btn'));
    const context = e.sb.createGradingContext();
    assert.equal(context.questionBaseline.question, '18');
    assert.doesNotThrow(() => e.sb.requireGradingQuestionContext(context));
});

test('配置迁移默认关闭、保留布尔选择，导入时非布尔启用值回到关闭', () => {
    const e = env(); e.sb.SCRIPT_CONFIG = { DEFAULT_ENDPOINT: '', DEFAULT_MODEL: '' };
    e.sb.GM_getValue = (key, fallback) => fallback; e.sb.GM_setValue = () => {};
    load(e, 'src/core/preset.js');
    vm.runInContext('this.pm = PresetManager', e.sb);
    e.sb.pm.data.list = { old: {}, enabled: { questionGuard: { enabled: true } }, malformed: { questionGuard: { enabled: 'true' } } };
    e.sb.pm.migrateAll();
    assert.equal(e.sb.pm.data.list.old.questionGuard.enabled, false);
    assert.equal(e.sb.pm.data.list.enabled.questionGuard.enabled, true);
    assert.equal(e.sb.pm.data.list.malformed.questionGuard.enabled, false);
    const imported = e.sb.pm.sanitizePreset(JSON.parse(JSON.stringify(e.sb.pm.data.list.enabled)));
    assert.equal(imported.questionGuard.enabled, true);
});

test('自动刷新后的恢复先消费标记，启用题号检测时等待教师核对', () => {
    for (const enabled of [true, false]) {
        const e = scene(enabled), saved = new Map([['ai-grading-auto-resume', 'true'], ['ai-grading-retry-count', '2']]);
        e.sb.sessionStorage = { getItem: key => saved.get(key), removeItem: key => saved.delete(key) };
        const previous = new Set(e.timeouts.keys()); let resumed = 0; e.sb.toggleAutoGrading = () => resumed++;
        e.sb.resumeGradingAfterReload(); e.sb.resumeGradingAfterReload();
        const callbacks = [...e.timeouts].filter(([id]) => !previous.has(id)).map(([, callback]) => callback);
        callbacks.forEach(callback => callback());
        assert.equal(resumed, enabled ? 0 : 1);
        assert.equal(saved.size, 0); assert.equal(e.state.errorRetryCount, 2);
        if (enabled) assert.ok(e.calls.toasts.some(message => message.includes('页面已刷新')));
    }
});
