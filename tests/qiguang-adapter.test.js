const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/adapters/qiguang/adapter.js'), 'utf8');

function fixture(options = {}) {
    const state = { image: 'http://areayj.oss-cn-shenzhen.aliyuncs.com/fixture/a.jpg?t=1',
        paper: '试卷ID：fixture-a', mode: '0', auto: false, clicks: 0, count: '0', layers: [], events: [], ...options };
    const element = (attrs = {}) => ({ _v: '', textContent: '', disabled: false, readOnly: false,
        get value() { return this._v; }, set value(v) { this._v = String(v); },
        getAttribute: key => attrs[key] ?? null, getClientRects() { return this.hidden ? [] : [{}]; },
        dispatchEvent(event) { state.events.push(event.type); options.onInput?.(this, event, state); } });
    const inputs = (options.units || [{ 'data-id': 'q1', 'data-max': '5', 'data-fullscore': '0,1,2,3,4,5' }]).map(element);
    const canvas = element(), paper = element(), count = element(), button = element();
    Object.defineProperty(paper, 'textContent', { get: () => state.paper });
    Object.defineProperty(count, 'textContent', { get: () => state.count });
    button.click = () => { state.clicks++; options.onClick?.(state); };
    const document = {
        querySelector: selector => ({ '#scoring-item': canvas, '#paperID': paper, '#myRead': count,
            '#btn-submit-score': button, '#form-scoring input[name="score"]': inputs[0],
            'input[name="operateTypeCheck"]:checked': { value: state.mode },
            'input[name="autoSubmit"]:checked': state.auto ? element() : null,
            '#rightWrongModelCanvasDiv': state.batch ? element() : null }[selector] || null),
        querySelectorAll: selector => selector === '#form-scoring input[name="score"]' ? inputs
            : selector === '.layui-layer-content' ? state.layers : []
    };
    const sandbox = { console, document, URL, URLSearchParams,
        location: { hostname: '120.78.5.37', pathname: '/OraOnlineCheck/OraCheck/Review', search: '?SubjectId=test&questionGroupId=test', href: 'http://120.78.5.37:8091/OraOnlineCheck/OraCheck/Review' },
        getComputedStyle: el => ({ display: 'block', visibility: 'visible', backgroundImage: el === canvas && state.image ? `url("${state.image}")` : 'none' }),
        HTMLInputElement: { prototype: { set value(v) { this._v = String(v); } } },
        Event: class { constructor(type) { this.type = type; } },
        setTimeout: callback => { options.onWait?.(state); callback(); }, showToast: text => { state.message = text; }
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox); vm.runInContext(source, sandbox);
    return { adapter: sandbox.__AI_MARKER_ADAPTER__, inputs, state, canvas, button, sandbox, element };
}

test('启光取图使用作答背景，试卷身份忽略缓存时间', async () => {
    const { adapter: a, state } = fixture();
    const identity = a.getPaperIdentity();
    assert.equal((await a.gatherAnswerImages())[0], state.image);
    state.image = state.image.replace('t=1', 't=2');
    assert.equal(a.getPaperIdentity(), identity);
    state.image = state.image.replace('/a.jpg', '/b.jpg');
    assert.notEqual(a.getPaperIdentity(), identity);
});

test('启光无作答背景、隐藏画布或缺试卷号均不取图', async () => {
    for (const change of [f => f.state.image = '', f => f.canvas.hidden = true, f => f.state.paper = '']) {
        const f = fixture(); change(f);
        assert.equal((await f.adapter.gatherAnswerImages()).length, 0);
    }
});

test('启光取图和填分不发送提交或键盘事件，零分合法', () => {
    const f = fixture();
    assert.equal(f.adapter.fillScores([0]), true);
    assert.equal(f.inputs[0].value, '0');
    assert.deepEqual(f.state.events, ['input', 'blur']);
    assert.equal(f.state.clicks, 0);
});

test('启光允许小数档位并拒绝档位之外的分数', () => {
    const f = fixture({ units: [{ 'data-id': 'decimal', 'data-max': '1.5', 'data-fullscore': '0,0.5,1,1.5' }] });
    assert.equal(f.adapter.fillScores([1.5]), true);
    assert.equal(f.adapter.fillScores([0.7]), false);
    assert.equal(f.inputs[0].value, '1.5');
});

test('启光分数缺失、多余、非数及超分全部在写入前拒绝', () => {
    for (const scores of [[], [null], [undefined], [''], ['2'], [NaN], [Infinity], [-1], [6], [1.5], [1, 2]]) {
        const f = fixture(); assert.equal(f.adapter.fillScores(scores), false, String(scores));
        assert.equal(f.inputs[0].value, ''); assert.equal(f.state.events.length, 0);
    }
});

test('启光多题先完整验证，缺分时不写入任何一题', () => {
    const f = fixture({ units: [{ 'data-id': 'a', 'data-max': '5' }, { 'data-id': 'b', 'data-max': '3' }] });
    assert.equal(f.adapter.fillScores([2]), false);
    assert.deepEqual(f.inputs.map(e => e.value), ['', '']);
    assert.equal(f.adapter.fillScores([2, 3]), true);
    assert.deepEqual(f.inputs.map(e => e.value), ['2', '3']);
});

test('启光重复题号、缺满分、损坏档位均拒绝识别评分项', () => {
    for (const units of [[{ 'data-id': 'q1' }], [{ 'data-id': 'q1', 'data-max': '5', 'data-fullscore': '0,NaN' }],
        [{ 'data-id': 'q1', 'data-max': '5' }, { 'data-id': 'q1', 'data-max': '5' }]]) {
        const f = fixture({ units }); assert.equal(f.adapter.getScoreInputs().length, 0);
        assert.equal(f.adapter.fillScores([0]), false);
    }
});

test('启光仅填写可见且可编辑的键盘评分项', () => {
    const f = fixture({ units: [{ 'data-id': 'q1', 'data-max': '5' }, { 'data-id': 'q2', 'data-max': '3' }] });
    f.inputs[1].hidden = true;
    assert.equal(f.adapter.getScoreInputs().length, 1);
    assert.equal(f.adapter.fillScores([2]), true);
    assert.equal(f.inputs[1].value, '');
});

test('启光鼠标、批注、批量及平台自动提交模式不提前填写', () => {
    for (const options of [{ mode: '1' }, { mode: '2' }, { batch: true }, { auto: true }]) {
        const f = fixture(options); assert.equal(f.adapter.fillScores([2]), false);
        assert.equal(f.state.events.length, 0); assert.equal(f.state.clicks, 0);
    }
});

test('启光写后值被平台改写或中途换卷时拒绝提交', async () => {
    for (const onInput of [el => { el._v = ''; }, (el, event, state) => { state.paper = '试卷ID：fixture-b'; }]) {
        const f = fixture({ onInput }); assert.equal(f.adapter.fillScores([2]), false);
        assert.equal(await f.adapter.submitGrade(), false); assert.equal(f.state.clicks, 0);
    }
});

test('启光填分后换卷、改分及禁用提交均不点击', async () => {
    for (const change of [f => f.state.paper = '试卷ID：fixture-b', f => f.inputs[0]._v = '3',
        f => f.button.disabled = true, f => f.state.auto = true]) {
        const f = fixture(); assert.equal(f.adapter.fillScores([2]), true); change(f);
        assert.equal(await f.adapter.submitGrade(), false); assert.equal(f.state.clicks, 0);
    }
});

test('启光提交前异步校验失效会阻止点击', async () => {
    const f = fixture(); f.adapter.fillScores([2]); let current = true;
    assert.equal(await f.adapter.submitGrade({ isCurrent: () => current, verify: async () => { current = false; } }), false);
    assert.equal(f.state.clicks, 0);
});

test('启光可见题目不能因只读或禁用而被遗漏', () => {
    for (const property of ['disabled', 'readOnly']) {
        const f = fixture(); f.inputs[0][property] = true;
        assert.equal(f.adapter.fillScores([2]), false); assert.equal(f.state.events.length, 0);
    }
});

test('启光没有列出档位时遵循平台十分之一分限制', () => {
    const f = fixture({ units: [{ 'data-id': 'q1', 'data-max': '5' }] });
    assert.equal(f.adapter.fillScores([0.3]), true);
    assert.equal(f.adapter.fillScores([0.03]), false);
});

test('启光成功响应的已阅量变化确认提交，重复调用只点击一次', async () => {
    const f = fixture({ onClick: state => state.count = '1' }); f.adapter.fillScores([2]);
    assert.equal(await f.adapter.submitGrade(), true); assert.equal(await f.adapter.submitGrade(), false);
    assert.equal(f.state.clicks, 1);
});

test('启光提交失败及旧成功提示均不报告成功', async () => {
    const f = fixture(); const toast = f.element(); toast.textContent = '评阅成功'; f.state.layers.push(toast);
    f.adapter.fillScores([2]); assert.equal(await f.adapter.submitGrade(), false);
    assert.equal(f.state.clicks, 1);
});

test('启光新成功提示可确认最后一份答卷提交', async () => {
    const f = fixture({ onClick: state => { const toast = f.element(); toast.textContent = '评阅成功'; state.layers.push(toast); } });
    f.adapter.fillScores([2]); assert.equal(await f.adapter.submitGrade(), true);
});

test('启光等待换卷忽略缓存刷新，新题块出现才继续', async () => {
    const f = fixture(); const old = f.state.image;
    f.state.image = old.replace('t=1', 't=2'); assert.equal(await f.adapter.waitForNextPaper(old), false);
    f.state.image = old.replace('/a.jpg', '/b.jpg'); assert.equal(await f.adapter.waitForNextPaper(old), true);
});

test('启光注册保护已有适配器并严格限定主机与路径', () => {
    const f = fixture(); const other = { id: 'other' }; f.sandbox.__AI_MARKER_ADAPTER__ = other;
    vm.runInContext(source.replace('const QiguangAdapter', 'var SecondAdapter').replaceAll('QiguangAdapter', 'SecondAdapter'), f.sandbox);
    assert.equal(f.sandbox.__AI_MARKER_ADAPTER__, other);
    f.sandbox.location.pathname = '/Account/Login'; assert.equal(f.adapter.shouldInitialize(), false);
    f.sandbox.location.pathname = '/OraOnlineCheck/OraCheck/Review';
    f.sandbox.location.hostname += '.example.com'; assert.equal(f.adapter.shouldInitialize(), false);
});
