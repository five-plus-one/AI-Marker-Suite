const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./_taowei-fixture.js');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function coreGuard(f) {
    const a = f.adapter;
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/core/runtime.js'), 'utf8'), f.sb);
    const main = fs.readFileSync(path.join(__dirname, '../src/core/main.js'), 'utf8');
    vm.runInContext(main.slice(main.indexOf('function normalizePaperImageUrl('), main.indexOf('// 回评图片就绪探测')), f.sb);
    f.sb.PresetManager = { data: { active: '作文练习' } };
    const context = { manual: true, adapter: a, controller: new AbortController(), presetName: '作文练习',
        questionGuardEnabled: true, questionBaseline: f.sb.readGradingQuestionContext(a),
        taskId: a.getTaskIdentifier(), paperId: a.getPaperIdentity(), paperGuardEnabled: true,
        imageUrls: await a.gatherAnswerImages(), inputSnapshot: f.fields.map(e => e.value) };
    f.sb.aiGradingState = { activeRun: context };
    let verifications = 0;
    return { context, count: () => verifications, guard: { signal: context.controller.signal,
        isCurrent: () => { try { f.sb.requireGradingContextTarget(context); return true; } catch { return false; } },
        verify: async () => { verifications++; await f.sb.verifyGradingContext(context); } } };
}

test('韬普按实际 iframe 文档识别 2+1 评阅，两页答卷对应一个给分点', async () => {
    const f = fixture(), a = f.adapter;
    assert.equal(a.isMarkingPage(), true);
    assert.deepEqual(JSON.parse(JSON.stringify(a.getQuestionContext())), { question: '作文', units: [{ label: '作文', maxScore: 60 }] });
    assert.equal(a.getScoreInputs()[0].roundStep, 1);
    assert.equal((await a.gatherAnswerImages()).length, 2);
    const task = a.getTaskIdentifier(), paper = a.getPaperIdentity(); f.next('paper-B');
    assert.equal(a.getTaskIdentifier(), task); assert.notEqual(a.getPaperIdentity(), paper);
    assert.equal(a.getGradingTaskIdentifier(), task);
});

test('韬普逐项完整校验后才写分，零分有效', () => {
    const f = fixture({ count: 2 }), a = f.adapter;
    for (const values of [[2, null], [2, true], [2, ''], [2, Infinity], [2, -1], [2, 61], [2, 1.5], [2], [2, 3, 4], [2, ,]]) {
        assert.equal(a.fillScores(values), false, String(values));
        assert.equal(f.fields.reduce((n, e) => n + e.writes, 0), 0);
    }
    assert.equal(a.fillScores([0, 60]), true);
    assert.deepEqual(f.fields.map(e => e.value), ['0', '60']);
    assert.deepEqual(f.fields[0].events, ['input', 'change']);
});

test('韬普保留原生小数步长及离散分档', () => {
    const f = fixture(), a = f.adapter;
    f.w.zgtxx.DFBCMS = '0.5'; assert.equal(a.fillScores([3.5]), true); assert.equal(a.fillScores([3.2]), false);
    f.w.zgtxx.DFBC = '1'; f.w.zgtxx.DFBCMS = '0,20,40,60';
    assert.equal(a.fillScores([0]), true); assert.equal(a.fillScores([40]), true); assert.equal(a.fillScores([35]), false);
});

test('韬普加载、回评、仲裁、已评分与非键盘给分状态不写入', () => {
    for (const change of [f => { f.w.loadok = false; }, f => { f.w.sfhp = true; }, f => { f.w.dfms = '2'; },
        f => { f.w.sfsp = '1'; }, f => { f.w.rwxx.ZJBZ = '1'; }, f => { f.w.rwxx.PYCJ = 0; },
        f => { f.w.rwxx.RWID = 'jcj_synthetic'; },
        f => { f.w.zgtxx.PYCS = 'ZP'; }, f => { f.w.rwxx.PYZT = '2'; }, f => { f.block(); }]) {
        const f = fixture(); change(f); assert.equal(f.adapter.fillScores([30]), false); assert.equal(f.fields[0].writes, 0);
    }
});

test('韬普题目、给分栏和完整题块互相核对，不能混入整图或上一份答卷', async () => {
    for (const change of [f => { f.w.zgtxx.STBH = '13'; }, f => { f.w.dfdfs = ['10']; },
        f => { f.fields[0].placeholder = '满10分'; }, f => { f.images[1].complete = false; },
        f => { f.images[1].src = f.images[1].src.replace('paper-A_13', 'paper-B_13'); },
        f => { f.images[1].src = f.images[1].src.replace('img-oss.sdzdf.com', 'images.example'); },
        f => { f.images[1].id = 'full_img_1'; }, f => { f.fields[0].readOnly = true; }]) {
        const f = fixture(); change(f); assert.equal((await f.adapter.gatherAnswerImages()).length, 0);
        assert.equal(f.adapter.fillScores([30]), false);
    }
});

test('韬普填分事件期间换卷或替换控件会停止后续写入', () => {
    const f = fixture({ count: 2 }); f.input(() => f.next('paper-B'));
    assert.equal(f.adapter.fillScores([20, 30]), false); assert.equal(f.fields[1].writes, 0);
    const g = fixture(); g.input(e => { e._value = '25'; }); assert.equal(g.adapter.fillScores([30]), false);
});

test('韬普独立调用图片下载函数仍核对原答卷', async () => {
    const f = fixture(), download = f.adapter.fetchImageAsBase64, url = f.images[0].src;
    assert.equal(await download(url), 'synthetic-bytes');
    f.sb.fetchImageAsBase64 = async () => { f.next('paper-B'); return 'synthetic-bytes'; };
    await assert.rejects(download(url), /答卷已变化/);
});

test('韬普保存核对原生 pycs=3、分项、总分与响应，并恢复观察方法', async () => {
    const f = fixture(); assert.equal(f.adapter.fillScores([30]), true);
    assert.equal(await f.adapter.submitGrade(), true);
    assert.equal(f.sent.length, 1); const q = new URLSearchParams(f.sent[0]);
    assert.equal(q.get('pycs'), '3'); assert.equal(q.get('pydfd'), '30'); assert.equal(q.get('pycj'), '30');
    assert.equal(f.w.XMLHttpRequest.prototype.open, f.originals.open); assert.equal(f.w.XMLHttpRequest.prototype.send, f.originals.send);
    assert.equal(await f.adapter.submitGrade(), false); assert.equal(f.sent.length, 1);
});

test('韬普未填分、教师改分、换卷和取消不提交', async () => {
    const f = fixture(); assert.equal(await f.adapter.submitGrade(), false);
    for (const change of [g => { g.fields[0]._value = '20'; }, g => g.next('paper-B'), g => { g.fields[0].readOnly = true; }]) {
        const g = fixture(); g.adapter.fillScores([30]); change(g); assert.equal(await g.adapter.submitGrade(), false); assert.equal(g.sent.length, 0);
    }
    const c = new AbortController(), g = fixture(); g.adapter.fillScores([30]); c.abort();
    assert.equal(await g.adapter.submitGrade({ signal: c.signal }), false); assert.equal(g.sent.length, 0);
});

test('韬普原生倒计时保持，冷却期间只等待一次提交', async () => {
    const f = fixture(); f.button.disabled = true; f.adapter.fillScores([30]);
    setTimeout(() => { f.button.disabled = false; }, 10);
    assert.equal(await f.adapter.submitGrade(), true); assert.deepEqual(f.attempts, ['submit']);
});

test('韬普匹配本卷零分确认按钮，确认后只发送一次原生请求', async () => {
    const f = fixture(); f.w.tjqqr = true; f.adapter.fillScores([0]);
    assert.equal(await f.adapter.submitGrade(), true); assert.deepEqual(f.attempts, ['submit', 'confirm']);
    assert.equal(new URLSearchParams(f.sent[0]).get('pycj'), '0');
});

test('韬普原生确认与核心题目、答卷校验联合运行', async () => {
    const f = fixture(), a = f.adapter, core = await coreGuard(f);
    f.w.tjqqr = true; assert.equal(a.fillScores([0]), true);
    assert.equal(await a.submitGrade(core.guard), true);
    assert.equal(core.count(), 2); assert.deepEqual(f.attempts, ['submit', 'confirm']); assert.equal(f.sent.length, 1);
});

test('韬普保存回调先清空答卷时仍能确认本次回执，题目信息保持可读', async () => {
    const f = fixture(), a = f.adapter, core = await coreGuard(f);
    f.delay(); assert.equal(a.fillScores([30]), true); const pending = a.submitGrade(core.guard);
    await new Promise(resolve => setTimeout(resolve, 10));
    f.w.rwxx = null; f.w.loadok = false;
    assert.equal(a.getScoreInputs().length, 0); assert.equal(a.getQuestionContext().question, '作文');
    f.last().respond({ res: true }); assert.equal(await pending, true);
    f.next('paper-B'); assert.equal(await a.waitForNextPaper('', { paperId: core.context.paperId, taskId: core.context.taskId }), true);
});

test('韬普明确拒绝、错误页、HTTP 错误与不明回执均不登记成功或重试', async () => {
    for (const [body, status] of [[{ res: false }, 200], ['<html>登录</html>', 200], [{ res: true }, 403], [{ res: 'true' }, 200]]) {
        const f = fixture(); f.response(body, status); f.adapter.fillScores([30]);
        assert.equal(await f.adapter.submitGrade(), false); assert.equal(f.sent.length, 1); assert.ok(f.adapter.lastSubmitError);
        assert.equal(await f.adapter.waitForNextPaper(), false);
    }
});

test('韬普原生请求的题目、答卷或分数不符时阻止发送', async () => {
    for (const key of ['stbh', 'rwid', 'dqpc', 'pycs', 'pydfd', 'pycj', 'pybz']) {
        const f = fixture(); f.alter(data => ({ ...data, [key]: 'unexpected' })); f.adapter.fillScores([30]);
        assert.equal(await f.adapter.submitGrade(), false, key); assert.equal(f.sent.length, 0, key);
    }
});

test('韬普在原生点击处理期间再次核对答卷、模式和图片', async () => {
    for (const change of [f => f.next('paper-B'), f => { f.w.sfsp = '1'; },
        f => { f.images[0].src = f.images[0].src.replace('paper-A_12', 'paper-B_12'); },
        f => { f.rows[0].querySelector = () => ({ value: '30' }); }]) {
        const f = fixture(); f.alter(data => { change(f); return data; }); f.adapter.fillScores([30]);
        assert.equal(await f.adapter.submitGrade(), false); assert.equal(f.sent.length, 0);
    }
});

test('韬普零分确认期间暂停或更换评分不会自动确认', async () => {
    const f = fixture(); f.w.tjqqr = true; f.adapter.fillScores([0]);
    assert.equal(await f.adapter.submitGrade({ isCurrent: () => !f.w.qropen }), false);
    assert.deepEqual(f.attempts, ['submit']); assert.equal(f.sent.length, 0);
    const g = fixture(); g.w.tjqqr = true; g.adapter.fillScores([0]);
    assert.equal(await g.adapter.submitGrade({ verify: () => { if (g.w.qropen) g.fields[0]._value = '30'; } }), false);
    assert.deepEqual(g.attempts, ['submit']); assert.equal(g.sent.length, 0);
});

test('韬普保存未确认时超时或取消都会恢复观察，不能自动重发', async () => {
    const f = fixture(); f.delay(); f.adapter.fillScores([30]); assert.equal(await f.adapter.submitGrade(), false);
    assert.equal(f.sent.length, 1); assert.equal(f.w.XMLHttpRequest.prototype.send, f.originals.send);
    const g = fixture(), c = new AbortController(); g.delay(); g.adapter.fillScores([30]);
    const pending = g.adapter.submitGrade({ signal: c.signal }); setTimeout(() => c.abort(), 5);
    assert.equal(await pending, false); assert.equal(g.sent.length, 1); assert.equal(g.w.XMLHttpRequest.prototype.send, g.originals.send);
});

test('韬普只有保存确认后，同题新卷的所有题块就绪才继续', async () => {
    const f = fixture(), task = f.adapter.getTaskIdentifier(), id = f.adapter.getPaperIdentity();
    f.adapter.fillScores([30]); await f.adapter.submitGrade();
    f.next('paper-B'); f.images[1].complete = false;
    setTimeout(() => { f.images[1].complete = true; }, 5);
    assert.equal(await f.adapter.waitForNextPaper('', { taskId: task, paperId: id }), true);
    assert.equal(await f.adapter.waitForNextPaper('', { taskId: 'another' }), false);
    const c = new AbortController(); c.abort(); assert.equal(await f.adapter.waitForNextPaper('', { signal: c.signal }), false);
});
