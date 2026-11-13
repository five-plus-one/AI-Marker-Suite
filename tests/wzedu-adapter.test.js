const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./_adapter-matrix.js');

const SCORE = '.redbiginput input.el-input__inner[placeholder="请给分"]';
const BOUND = '.givescorebox.isbind .bindinputs input.el-input__inner';
const OLD = 'https://yuejuan.wzedu.cn/r/deployment:/union_new/exam/subject/school/student/A/hash/web/42.png';
const NEXT = OLD.replace('/student/A/', '/student/B/');
function image(src, visible = true) {
    return { getAttribute: () => src, getBoundingClientRect: () => ({ width: 1030, height: 400 }), checkVisibility: () => visible };
}
function setup({ hash = '#/marking/grading?questionId=42&choiceIndex=0', keyboard = false, late = false, bound = false } = {}) {
    const sb = M.makeStub({ host: 'yuejuan.wzedu.cn', path: '/static-v2/exam/index.html', hash });
    const input = { _v: '', get value() { return this._v; },
        dispatchEvent() { throw Error('填分不能派发快捷提交事件'); } };
    let clicks = 0;
    let request, response = { code: 200, data: { exist: true } }, autoRespond = true;
    class XHR {
        constructor() { this.listeners = new Map(); this.status = 200; }
        open() {}
        addEventListener(type, fn) { this.listeners.set(type, fn); }
        removeEventListener(type) { this.listeners.delete(type); }
        send(body) { this.body = JSON.parse(body); request = this;
            if (autoRespond) setTimeout(() => this.respond(response), 0); }
        abort() { this.aborted = true; }
        respond(body, type = 'load') { this.responseText = JSON.stringify(body); this.listeners.get(type)?.(); }
    }
    sb.XMLHttpRequest = XHR;
    sb.clearTimeout = clearTimeout;
    const button = { disabled: false, getAttribute: () => null, getClientRects: () => [{}], click() {
        clicks++;
        const xhr = new sb.XMLHttpRequest(); xhr.open('POST', '/v2/union/mark/submit');
        xhr.send(JSON.stringify({ studentId: state.readOverInfo.studentId, sheetId: state.readOverInfo.sheetId,
            questionId: state.readOverInfo.questionId, score: state.questionScore,
            ...(bound ? { haveJoin: true, questionSubmitList: models.map((score, i) => ({ questionId: 42 + i, score })) } : {}) }));
    } };
    const state = { markingType: keyboard ? 1 : 2, haveJoin: false, IsSubItemscoring: false, batchGrading: false,
        questionScore: null, reviewProps: {}, markReview: false,
        readOverInfo: { studentId: 'A', sheetId: 101, questionId: 42,
            question: { questionName: '31(1)', score: 3 }, inputFastSumbitFlag: true } };
    const store = { state: { mark: state }, commit(key, value) {
        assert.equal(key, 'mark/SET_SCOREING'); state.questionScore = value;
    } };
    sb.__dom['#app'] = { __vue_app__: { config: { globalProperties: { $store: store } } } };
    const models = [null, null], fields = [input, { _v: '', get value() { return this._v; }, dispatchEvent: input.dispatchEvent }];
    let panel;
    if (bound) {
        Object.assign(state, { haveJoin: true, markingType: 4, selectArea: [
            { questionId: 42, questionName: '17（1）', score: 7 }, { questionId: 43, questionName: '17（2）', score: 8 }] });
        fields.forEach((el, i) => { el.name = String(i); el.matches = sel => sel === BOUND; });
        panel = { exposed: { countScoreMultiple(values) { values.forEach((v, i) => { models[i] = v.score; }); } },
            subTree: { children: fields.map((el, i) => ({ component: { exposed: { input: { value: el } },
                vnode: { props: { get modelValue() { return models[i]; } } } } })) } };
        sb.__dom['#app'].__vue_app__._container = { _vnode: { component: panel } };
    }
    const key = bound ? BOUND : keyboard ? 'input#compuinput' : SCORE;
    function mount() { sb.__dom[key] = input; sb.__dom['button.submitscorebtn'] = button; }
    if (!late) mount();
    let images = [image(OLD)];
    const queryAll = sb.document.querySelectorAll;
    sb.document.querySelectorAll = sel => sel === 'img.el-image__inner' ? images : queryAll(sel);
    sb.__AI_MARKER_WAIT_WINDOW_MS__ = 100;
    sb.setTimeout = setTimeout;
    const result = M.loadOne(sb, 'huahanyun');
    assert.deepEqual(result.errors, []);
    return { sb, input, button, state, store, mount, fields, panel, models, clicks: () => clicks,
        xhr: () => request, response: value => { response = value; }, delay: () => { autoRespond = false; },
        images: value => { images = value; }, adapter: () => sb.__AI_MARKER_ADAPTER__ };
}

for (const keyboard of [false, true]) {
    test(`温州${keyboard ? '键盘' : '一键'}给分：识别题号满分，填分独立于快捷提交`, async () => {
        const f = setup({ keyboard }), a = f.adapter();
        assert.equal(a.name, '温州云阅卷');
        assert.equal(a.isMarkingPage(), true);
        assert.equal(a.getScoreInputs()[0].label, '31(1)');
        assert.equal(a.getScoreInputs()[0].maxScore, 3);
        for (const score of [0, 2, 2.5, '3.00']) {
            assert.equal(a.fillScores([score]), true);
            assert.equal(f.state.questionScore, Number(score));
            assert.equal(f.input.value, String(Number(score)));
            assert.equal(f.clicks(), 0);
        }
        assert.equal(await a.submitGrade(), true);
        assert.equal(f.clicks(), 1);
        for (const scores of [[], [1, 2], [null], [undefined], [''], [' '], [true], [NaN], [Infinity], [-1], [4]]) {
            assert.equal(a.fillScores(scores), false);
            assert.equal(f.state.questionScore, 3);
        }
    });
}

test('温州任务按部署、题块和选做项区分，阅卷模式共享题目方案', () => {
    const f = setup(), a = f.adapter(), first = a.getTaskIdentifier();
    f.sb.location.hash += '&thisType=3';
    assert.equal(a.getTaskIdentifier(), first);
    f.sb.location.hash = '#/marking/grading?questionId=42&choiceIndex=1';
    assert.notEqual(a.getTaskIdentifier(), first);
    f.sb.location.hash = '#/marking/grading?questionId=43';
    assert.notEqual(a.getTaskIdentifier(), first);
    assert.ok(first.includes('wzedu'));
});

test('温州保存回执：成功才确认，服务器拒绝及网络错误停止', async () => {
    for (const result of [{ code: 500 }, { code: 1 }, { message: 'ok' },
        { code: 200, data: { exist: false, resultType: 2, msg: '评分阶段已变化' } }]) {
        const f = setup(), a = f.adapter();
        a.fillScores([2]); f.response(result);
        assert.equal(await a.submitGrade(), false);
    }
    for (const type of ['error', 'timeout', 'abort']) {
        const f = setup(), a = f.adapter(); f.delay(); a.fillScores([2]);
        const submission = a.submitGrade(); f.xhr().respond({}, type);
        assert.equal(await submission, false);
    }
});

test('温州等待回执时防重复提交，取消时释放观察器且保留平台请求', async () => {
    const f = setup(), a = f.adapter(); f.delay(); a.fillScores([0]);
    const original = f.sb.XMLHttpRequest.prototype.send;
    const controller = new AbortController();
    let resolved = false;
    const submission = a.submitGrade({ signal: controller.signal }).then(ok => { resolved = true; return ok; });
    await Promise.resolve();
    assert.equal(resolved, false);
    assert.equal(await a.submitGrade(), false);
    assert.equal(f.clicks(), 1);
    assert.equal(f.sb.XMLHttpRequest.prototype.send, original);
    controller.abort();
    assert.equal(await submission, false);
    assert.equal(f.xhr().listeners.size, 0);
    f.xhr().respond({ code: 200, data: { exist: true } });
});

test('温州填分后切卷、切题或修改分数时不提交', async () => {
    for (const change of [f => f.images([image(NEXT)]), f => { f.state.readOverInfo.studentId = 'B'; },
        f => { f.state.questionScore = 1; }, f => { f.sb.location.hash = f.sb.location.hash.replace('choiceIndex=0', 'choiceIndex=1'); }]) {
        const f = setup(), a = f.adapter(); a.fillScores([2]); change(f);
        assert.equal(await a.submitGrade(), false);
        assert.equal(f.clicks(), 0);
    }
});

test('温州列表进入阅卷页：等待 DOM 就绪后唯一注册', () => {
    const f = setup({ hash: '#/marking/gradingList/list', late: true });
    assert.equal(f.adapter(), undefined);
    f.mount();
    f.sb.location.hash = '#/marking/grading?questionId=42';
    for (const observer of f.sb.__observers) observer.cb();
    assert.equal(f.adapter().name, '温州云阅卷');
    assert.equal(f.sb.__writes.length, 1);
    for (const observer of f.sb.__observers) observer.cb();
    assert.equal(f.sb.__writes.length, 1);
});

test('温州复查、回评、只读状态保护', () => {
    const f = setup(), a = f.adapter(), base = f.sb.location.hash;
    for (const key of ['review', 'markReview', 'readonly']) {
        f.sb.location.hash = base + `&${key}=true`;
        assert.equal(a.isRegradeMode(), true);
        assert.equal(a.fillScores([2]), false);
        assert.equal(a.submitGrade(), false);
    }
    f.sb.location.hash = base;
    f.state.reviewProps.review = true;
    assert.equal(a.fillScores([2]), false);
    assert.equal(f.clicks(), 0);
});

test('温州批量、合批、分项与批注模式保留原生操作', () => {
    const f = setup(), a = f.adapter();
    for (const key of ['batchGrading', 'haveJoin', 'IsSubItemscoring']) {
        f.state[key] = true;
        assert.equal(a.getScoreInputs().length, 0);
        assert.equal(a.fillScores([2]), false);
        assert.equal(a.submitGrade(), false);
        f.state[key] = false;
    }
    f.state.markingType = 7;
    assert.equal(a.getScoreInputs().length, 0);
});

test('温州加载中、禁用及绑定不可用时停止操作', () => {
    const f = setup(), a = f.adapter();
    f.button.disabled = true;
    assert.equal(a.submitGrade(), false);
    f.button.disabled = false;
    f.button.classList = { contains: name => name === 'is-loading' };
    assert.equal(a.submitGrade(), false);
    f.store.commit = () => {};
    assert.equal(a.fillScores([2]), false);
    assert.equal(f.input.value, '');
    delete f.sb.__dom['#app'];
    assert.equal(a.fillScores([2]), false);
});

test('温州答卷：同考生图集与身份一致，多考生过渡期等待', async () => {
    const f = setup(), a = f.adapter();
    assert.equal((await a.gatherAnswerImages()).length, 1);
    const id = a.getPaperIdentity();
    f.images([image(OLD + '?token=rotated')]);
    assert.equal(a.getPaperIdentity(), id);
    assert.equal(await a.waitForNextPaper(OLD), false);
    f.images([image(NEXT), image(OLD.replace('/student/A/', '/student/C/'))]);
    assert.equal(await a.waitForNextPaper(OLD), false);
    assert.equal(a.getPaperIdentity(), null);
    assert.equal((await a.gatherAnswerImages()).length, 0);
    f.images([image(OLD, false), image(NEXT)]);
    assert.equal(await a.waitForNextPaper(OLD), true);
    assert.notEqual(a.getPaperIdentity(), id);
    f.sb.location.hash = '#/marking/gradingList/list';
    assert.equal(a.getPaperIdentity(), null);
    assert.equal((await a.gatherAnswerImages()).length, 0);
});

test('温州绑定批阅：题块顺序、满分、零分与小数同步，整组保存一次', async () => {
    const f = setup({ bound: true }), a = f.adapter();
    assert.equal(a.shouldInitialize(), true);
    assert.deepEqual(Array.from(a.getScoreInputs(), i => [i.label, i.maxScore]), [['17（1）', 7], ['17（2）', 8]]);
    assert.equal(a.detectSubQuestions().length, 2);
    for (const scores of [[0, 0], [2.5, 8], [7, 0]]) {
        assert.equal(a.fillScores(scores), true);
        assert.deepEqual(f.models, scores);
        assert.deepEqual(f.fields.map(el => Number(el.value)), scores);
        assert.equal(f.clicks(), 0);
    }
    assert.equal(await a.submitGrade(), true);
    assert.equal(f.clicks(), 1);
    assert.deepEqual(f.xhr().body.questionSubmitList, [{ questionId: 42, score: 7 }, { questionId: 43, score: 0 }]);
});

test('温州绑定批阅：完整校验评分范围、个数与平台可用分数', () => {
    const f = setup({ bound: true }), a = f.adapter();
    assert.equal(a.fillScores([6, 7]), true);
    for (const scores of [[], [1], [1, 2, 3], [1, 9], [8, 1], [1, -1], [1, NaN], [null, 1], ['', 1], [true, 1], [1.001, 1]]) {
        assert.equal(a.fillScores(scores), false);
        assert.deepEqual(f.models, [6, 7]);
    }
    f.state.selectArea[0].markValues = '0,1,2,3,4,5,6,7';
    assert.equal(a.fillScores([2.5, 7]), false);
    assert.deepEqual(f.models, [6, 7]);
});

test('温州绑定批阅：原站自动给分开启时等待教师确认后整组保存', async () => {
    const f = setup({ bound: true }), a = f.adapter();
    f.state.MultipleAuto = true;
    const update = f.panel.exposed.countScoreMultiple;
    f.panel.exposed.countScoreMultiple = values => {
        update(values);
        setTimeout(() => { if (f.state.MultipleAuto) f.button.click(); }, 300);
    };
    assert.equal(a.fillScores([3, 4]), true);
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(f.clicks(), 0, '原站延迟给分不能抢先提交');
    assert.deepEqual(f.models, [3, 4]);
    assert.equal(await a.submitGrade(), true);
    assert.equal(f.clicks(), 1);
});

test('温州绑定批阅：无法接管原站自动给分时保持原评分', () => {
    const f = setup({ bound: true }), a = f.adapter();
    Object.defineProperty(f.state, 'MultipleAuto', { get: () => true, set() {} });
    assert.equal(a.fillScores([3, 4]), false);
    assert.deepEqual(f.models, [null, null]);
    assert.equal(f.clicks(), 0);
});

test('温州绑定批阅：模型、控件、题块、答卷及回评变化后停止提交', async () => {
    for (const change of [f => { f.models[1] = null; }, f => { f.fields[1]._v = ''; },
        f => { f.state.selectArea.reverse(); }, f => { f.images([image(NEXT)]); },
        f => { f.state.readOverInfo.studentId = 'B'; }, f => { f.state.reviewProps.review = true; },
        f => { f.state.markingType = 5; }, f => { f.panel.subTree.children.pop(); }]) {
        const f = setup({ bound: true }), a = f.adapter();
        assert.equal(a.fillScores([0, 0]), true); change(f);
        assert.equal(await a.submitGrade(), false);
        assert.equal(f.clicks(), 0);
    }
});

test('温州绑定批阅：填分与提交核对平台模型，阻止不一致的原生请求', async () => {
    const f = setup({ bound: true }), a = f.adapter();
    assert.equal(a.fillScores([6, 7]), true);
    f.button.click = () => {
        const xhr = new f.sb.XMLHttpRequest(); xhr.open('POST', '/v2/union/mark/submit');
        xhr.send(JSON.stringify({ studentId: 'A', sheetId: 101, questionId: 42, haveJoin: true,
            questionSubmitList: [{ questionId: 42, score: 6 }, { questionId: 43, score: 8 }] }));
        assert.equal(xhr.aborted, true);
    };
    assert.equal(await a.submitGrade(), false);
    assert.equal(f.xhr(), undefined);
});

test('温州绑定批阅：字段缺失、重复题块及批注模式停止填分', () => {
    for (const change of [f => { f.fields[1].name = '0'; }, f => { f.state.selectArea[1].questionId = 42; },
        f => { f.state.multipleDraw = true; }, f => { f.state.areaMark = true; },
        f => { f.fields[1].readOnly = true; }, f => { f.state.selectArea[1].score = NaN; }]) {
        const f = setup({ bound: true }), a = f.adapter(); change(f);
        assert.equal(a.getScoreInputs().length, 0);
        assert.equal(a.fillScores([1, 2]), false);
        assert.deepEqual(f.models, [null, null]);
    }
});

test('温州绑定批阅：提交等待期间保留原分数，保存后同次填分只提交一次', async () => {
    const f = setup({ bound: true }), a = f.adapter(); f.delay();
    assert.equal(a.fillScores([6, 7]), true);
    const submission = a.submitGrade(); await Promise.resolve();
    assert.equal(a.fillScores([0, 0]), false);
    assert.equal(await a.submitGrade(), false);
    assert.deepEqual(f.models, [6, 7]);
    f.xhr().respond({ code: 200, data: { exist: true } });
    assert.equal(await submission, true);
    assert.equal(await a.submitGrade(), false);
    assert.equal(f.clicks(), 1);
});

test('温州绑定批阅：控件写入异常时还原整组评分', () => {
    const f = setup({ bound: true }), a = f.adapter();
    assert.equal(a.fillScores([6, 7]), true);
    f.fields[1]._fail = true;
    const setter = f.sb.HTMLInputElement.prototype;
    Object.defineProperty(setter, 'value', { configurable: true, set(value) {
        if (this._fail) { this._fail = false; throw Error('输入框已重建'); } this._v = value;
    } });
    assert.equal(a.fillScores([0, 0]), false);
    assert.deepEqual(f.models, [6, 7]);
    assert.deepEqual(f.fields.map(el => el.value), ['6', '7']);
});
