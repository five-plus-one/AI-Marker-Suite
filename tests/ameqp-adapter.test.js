const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('./_adapter-matrix.js');
const root = path.join(__dirname, '..');
const source = ['selectors.js', 'adapter.js'].map(file => fs.readFileSync(path.join(root, 'src/adapters/ameqp', file), 'utf8')).join('\n');

function fixture(options = {}) {
    const state = { clicks: 0, optionClicks: 0, events: [], warnings: [], task: '11(4.0分)', timers: new Set() };
    class Input { constructor(id, attrs = {}) { this.id = this.name = id; this.attrs = attrs; this._value = ''; }
        get value() { return this._value; } set value(value) { this._value = String(value); }
        getAttribute(key) { return this.attrs[key] ?? null; }
        dispatchEvent(event) { state.events.push(event.type); options.onInput?.(this, event, state); }
        closest() { return { querySelector: () => ({ get title() { return state.task; } }) }; }
    }
    const inputs = [1, 2].map(i => new Input('txt_que_1_' + i, { maxsco: '4.0' }));
    const hidden = Object.fromEntries(inputs.map((_, i) => ['1_' + (i + 1), new Input('hidden') ]));
    const total = new Input('queVal');
    const img = { src: 'https://school.example/images/1001_00_1_0.PNG?t=1', complete: true, naturalWidth: 100, naturalHeight: 20,
        closest: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 20 }) }),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 20 }), getAttribute(key) { return key === 'src' ? this.src : null; } };
    Object.assign(state, { inputs, hidden, img, images: [img], total });
    state.changePaper = id => { img.src = 'https://school.example/images/' + id + '_00_1_0.PNG?t=1';
        state.inputs.forEach(input => input.value = ''); Object.values(hidden).forEach(input => input.value = ''); total.value = ''; };
    const button = { disabled: false, click() { state.clicks++; options.onSubmit?.(state); } };
    const document = {
        querySelectorAll: selector => selector === 'img.ansImg' ? state.images : selector === 'input.mark_tbx' ? state.inputs
            : selector === 'legend.mark_leg' ? [{ get title() { return state.task; } }] : [],
        querySelector(selector) {
            if (selector === '#btn_submit' || selector === 'input#btn_submit.mark_btn') return button;
            if (selector === 'img.ansImg') return state.images[0] || null;
            if (selector === 'input.mark_tbx[maxsco]') return state.inputs[0] || null;
            if (selector === '#Mark_main' || selector === '#queSco_all') return {};
            if (selector === '#queVal' || selector === '#queVal_old') return total;
            const match = selector.match(/^#MarQueSubSco_(.+)$/);
            if (match) return hidden[match[1]] || null;
            if (/^#txt_msg_/.test(selector)) return { style: {} };
            if (/^#Mark_scoList_/.test(selector)) return { click() { state.optionClicks++; options.onPalette?.(state); } };
            return null;
        },
        createElement() { let drawn; return { getContext: () => ({ drawImage(image) { drawn = image.src; options.onCrop?.(state); } }),
            toDataURL() { if (options.tainted) throw Error('tainted'); return 'data:image/png;base64,' + Buffer.from(drawn).toString('base64'); } }; }
    };
    const originalAlert = message => state.warnings.push(message);
    const sandbox = { document, console: { log() {}, warn() {}, error() {} }, URL, URLSearchParams,
        location: { pathname: '/AMEQP/Webroot/mar/mar_mark.aspx' }, HTMLInputElement: Input, alert: originalAlert,
        Event: class { constructor(type) { this.type = type; } }, KeyboardEvent: class { constructor(type) { this.type = type; } },
        setTimeout: fn => setTimeout(fn, 1), setInterval: fn => { const timer = setInterval(fn, 1); state.timers.add(timer); return timer; },
        clearInterval: timer => { clearInterval(timer); state.timers.delete(timer); } };
    if (options.jquery) sandbox.jQuery = input => ({
        val(value) { input.value = value; options.onJQueryValue?.(state); },
        trigger(type) { options.onJQuery?.(type, state); }
    });
    sandbox.window = sandbox; vm.createContext(sandbox); vm.runInContext(source, sandbox);
    return { adapter: sandbox.__AI_MARKER_ADAPTER__, state, sandbox, originalAlert, button };
}

test('AMEQP 同步换卷后直接继续，连续三份保持各自基准', async () => {
    const f = fixture({ onSubmit: state => state.changePaper(String(1001 + state.clicks)) });
    for (let index = 0; index < 3; index++) {
        const urls = await f.adapter.gatherAnswerImages(); assert.equal(urls.length, 1);
        assert.ok(f.adapter.fillScores([0, 2.5]));
        assert.ok(await f.adapter.submitGrade());
        assert.ok(await f.adapter.waitForNextPaper(urls[0]));
        assert.equal(f.state.clicks, index + 1);
    }
    assert.equal(f.state.timers.size, 0);
});

test('AMEQP 核心等待使用本轮上下文，图片已经换卷时一轮完成', async () => {
    const f = fixture(); f.state.changePaper('1002');
    f.sandbox.aiGradingState = { isRunning: true, isPaused: false };
    const context = { paperId: '1001', controller: new AbortController() };
    f.sandbox.isGradingContextCurrent = value => value === context;
    f.sandbox.readGradingPaperIdentity = adapter => adapter.getPaperIdentity();
    const main = fs.readFileSync(path.join(root, 'src/core/ui-submit-dialog.js'), 'utf8');
    const body = main.match(/async function waitForNextPaperWithRetry\([^)]*\) \{[\s\S]*?\n\}/)[0];
    vm.runInContext(body + '; window.wait = waitForNextPaperWithRetry;', f.sandbox);
    assert.ok(await f.sandbox.wait(f.adapter, 'data:image/png;base64,old', 3, context));
});

test('AMEQP 等待慢速换卷，清空分数和刷新缓存不提前结束', async () => {
    const f = fixture(); let settled = false;
    const waiting = f.adapter.waitForNextPaper('https://school.example/images/1001_00_1_0.PNG?t=1')
        .then(value => { settled = true; return value; });
    f.state.img.src = f.state.img.src.replace('?t=1', '?t=2');
    await new Promise(resolve => setTimeout(resolve, 8)); assert.equal(settled, false);
    f.state.changePaper('1002'); assert.ok(await waiting);
});

test('AMEQP 新卷 src 更新后等到所有图片解码完成', async () => {
    const f = fixture(); f.state.changePaper('1002'); f.state.img.complete = false; f.state.img.naturalWidth = 0;
    let settled = false;
    const waiting = f.adapter.waitForNextPaper('data:old', { paperId: '1001' }).then(value => { settled = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 8)); assert.equal(settled, false);
    f.state.img.complete = true; f.state.img.naturalWidth = 100; assert.ok(await waiting);
});

test('AMEQP 等待取消、缺少旧卷标识和更换试题均及时退出', async () => {
    const f = fixture(); assert.equal(await f.adapter.waitForNextPaper('data:unknown'), false);
    assert.equal(await f.adapter.waitForNextPaper('data:old', { paperId: '999', taskId: 'another-task' }), false);
    const controller = new AbortController();
    const waiting = f.adapter.waitForNextPaper('data:old', { paperId: '1001', signal: controller.signal });
    controller.abort(); assert.equal(await waiting, false); assert.equal(f.state.timers.size, 0);
    const taskWait = f.adapter.waitForNextPaper('data:old', { paperId: '1001' }); f.state.task = '12(4.0分)';
    assert.equal(await taskWait, false); assert.equal(f.state.timers.size, 0);
});

test('AMEQP 未解码图片、混合新旧卷和裁切中换卷不返回作答图', async () => {
    const f = fixture(); f.state.img.complete = false; f.state.img.naturalWidth = 0;
    assert.equal((await f.adapter.gatherAnswerImages()).length, 0);
    f.state.img.complete = true; f.state.img.naturalWidth = 100;
    f.state.images.push({ ...f.state.img, src: 'https://school.example/images/1002_00_1_0.PNG' });
    assert.equal((await f.adapter.gatherAnswerImages()).length, 0);
    const moving = fixture({ onCrop: state => state.changePaper('1002') });
    assert.equal((await moving.adapter.gatherAnswerImages()).length, 0);
});

test('AMEQP 整图回退保留访问参数', async () => {
    const f = fixture({ tainted: true }); f.state.img.src += '&signature=fixture';
    assert.equal((await f.adapter.gatherAnswerImages())[0], f.state.img.src);
});

for (const scores of [[1], [1, 2, 3], [1, null], [NaN, 2], [Infinity, 2], [-1, 2], [5, 2], ['1', 2], [0.01, 2]]) {
    test('AMEQP 填分边界 [' + scores.map(String).join(', ') + '] 整体拒绝', async () => {
        const f = fixture(); assert.equal(f.adapter.fillScores(scores), false);
        assert.ok(f.state.inputs.every(input => input.value === ''));
        assert.equal(await f.adapter.submitGrade(), false); assert.equal(f.state.clicks, 0);
    });
}

test('AMEQP 零分与小数格式完成原生登记，失败的新填分清除暂存', async () => {
    const f = fixture(); assert.ok(f.adapter.fillScores([0, 0.1 + 0.2]));
    assert.equal(f.state.hidden['1_1'].value, '0.0'); assert.equal(f.state.hidden['1_2'].value, '0.3');
    assert.equal(f.adapter.fillScores([1, null]), false);
    assert.equal(await f.adapter.submitGrade(), false); assert.equal(f.state.clicks, 0);
});

test('AMEQP 缺登记字段或重复题号时全或无预检', () => {
    const f = fixture(); delete f.state.hidden['1_2']; assert.equal(f.adapter.fillScores([1, 2]), false);
    assert.ok(f.state.inputs.every(input => input.value === ''));
    const duplicate = fixture(); duplicate.state.inputs[1].name = duplicate.state.inputs[0].name;
    assert.equal(duplicate.adapter.fillScores([1, 2]), false);
});

for (const change of ['paper', 'input', 'hidden', 'replacement', 'disabled']) test('AMEQP 提交前变化 ' + change + ' 不重复灌分', async () => {
    const f = fixture(); assert.ok(f.adapter.fillScores([1, 2]));
    const count = f.state.events.length;
    if (change === 'paper') f.state.changePaper('1002');
    if (change === 'input') f.state.inputs[0].value = '3';
    if (change === 'hidden') f.state.hidden['1_1'].value = '3';
    if (change === 'replacement') f.state.inputs[0] = Object.assign(Object.create(Object.getPrototypeOf(f.state.inputs[0])), f.state.inputs[0]);
    if (change === 'disabled') f.state.inputs[0].disabled = true;
    assert.equal(await f.adapter.submitGrade(), false); assert.equal(f.state.clicks, 0); assert.equal(f.state.events.length, count);
});

test('AMEQP 提交确认等待中换卷及时拦截', async () => {
    const f = fixture(); assert.ok(f.adapter.fillScores([1, 2]));
    const result = await f.adapter.submitGrade({ isCurrent: () => true, verify: async () => f.state.changePaper('1002') });
    assert.equal(result, false); assert.equal(f.state.clicks, 0); assert.ok(f.state.inputs.every(input => input.value === ''));
});

test('AMEQP 平台给分事件内换卷后不再写分或同步新卷', async () => {
    for (const options of [
        { onPalette: state => state.changePaper('1002') },
        { onInput: (_input, _event, state) => state.changePaper('1002') }
    ]) {
        const f = fixture(options);
        assert.equal(f.adapter.fillScores([1, 2]), false);
        assert.ok(Object.values(f.state.hidden).every(input => input.value === ''));
        assert.equal(await f.adapter.submitGrade(), false); assert.equal(f.state.clicks, 0);
    }
});

test('AMEQP 原生与 jQuery 登记链在任一事件内换卷后保留新卷空框', async () => {
    for (const phase of ['native', 'jquery']) for (const type of ['keydown', 'keypress', 'input', 'keyup', 'change', 'blur']) {
        let moved = false;
        const move = (current, state) => { if (!moved && current === type) { moved = true; state.changePaper('1002'); } };
        const f = fixture({ jquery: true,
            onInput: (_input, event, state) => { if (phase === 'native') move(event.type, state); },
            onJQuery: (event, state) => { if (phase === 'jquery') move(event, state); }
        });
        assert.equal(f.adapter.fillScores([1, 2]), false, phase + '/' + type);
        assert.ok(f.state.inputs.every(input => input.value === ''), phase + '/' + type + ' must keep new inputs empty');
        assert.ok(Object.values(f.state.hidden).every(input => input.value === ''));
        assert.equal(await f.adapter.submitGrade(), false); assert.equal(f.state.clicks, 0);
    }
});

test('AMEQP 提交幂等且异常恢复原生提示', async () => {
    const f = fixture(); assert.ok(f.adapter.fillScores([1, 2]));
    const results = await Promise.all([f.adapter.submitGrade(), f.adapter.submitGrade()]);
    assert.deepEqual(results, [true, false]); assert.equal(f.state.clicks, 1);
    assert.equal(await f.adapter.submitGrade(), false); assert.equal(f.sandbox.alert, f.originalAlert);
    const throwing = fixture({ onSubmit: () => { throw Error('native click failed'); } });
    assert.ok(throwing.adapter.fillScores([1, 2]));
    await assert.rejects(throwing.adapter.submitGrade(), /native click failed/);
    assert.equal(throwing.sandbox.alert, throwing.originalAlert); assert.equal(throwing.adapter._submitting, false);
});

test('AMEQP 平台提示保留且本次提交显式失败', async () => {
    const f = fixture({ onSubmit: () => f.sandbox.alert('本题尚未给分') }); assert.ok(f.adapter.fillScores([1, 2]));
    assert.equal(await f.adapter.submitGrade(), false); assert.deepEqual(f.state.warnings, ['本题尚未给分']);
    assert.equal(f.sandbox.alert, f.originalAlert);
});

test('AMEQP 延迟注册等待完整特征并保留已有适配器', () => {
    const own = M.ADAPTERS.find(adapter => adapter.id === 'ameqp').own;
    const sb = M.makeStub({ ...own, dom: {} }); M.loadOne(sb, 'ameqp'); assert.equal(sb.__AI_MARKER_ADAPTER__, undefined);
    Object.assign(sb.__dom, own.dom); sb.__observers.forEach(observer => observer.cb());
    assert.equal(sb.__AI_MARKER_ADAPTER__?.id, 'ameqp'); assert.equal(sb.__writes.length, 1);
    const conflict = M.makeStub(own), previous = { id: 'existing' }; conflict.__AI_MARKER_ADAPTER__ = previous;
    M.loadOne(conflict, 'ameqp'); assert.equal(conflict.__AI_MARKER_ADAPTER__, previous); assert.equal(conflict.__writes.length, 1);
});
