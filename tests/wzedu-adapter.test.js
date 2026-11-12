const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./_adapter-matrix.js');

const SCORE = '.redbiginput input.el-input__inner[placeholder="请给分"]';
const OLD = 'https://yuejuan.wzedu.cn/r/deployment:/union_new/exam/subject/school/student/A/hash/web/42.png';
const NEXT = OLD.replace('/student/A/', '/student/B/');
function image(src, visible = true) {
    return { getAttribute: () => src, getBoundingClientRect: () => ({ width: 1030, height: 400 }), checkVisibility: () => visible };
}
function setup({ hash = '#/marking/grading?questionId=42&choiceIndex=0', keyboard = false, late = false } = {}) {
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
        respond(body, type = 'load') { this.responseText = JSON.stringify(body); this.listeners.get(type)?.(); }
    }
    sb.XMLHttpRequest = XHR;
    sb.clearTimeout = clearTimeout;
    const button = { disabled: false, getAttribute: () => null, getClientRects: () => [{}], click() {
        clicks++;
        const xhr = new sb.XMLHttpRequest(); xhr.open('POST', '/v2/union/mark/submit');
        xhr.send(JSON.stringify({ studentId: state.readOverInfo.studentId, sheetId: state.readOverInfo.sheetId,
            questionId: state.readOverInfo.questionId, score: state.questionScore }));
    } };
    const state = { markingType: keyboard ? 1 : 2, haveJoin: false, IsSubItemscoring: false, batchGrading: false,
        questionScore: null, reviewProps: {}, markReview: false,
        readOverInfo: { studentId: 'A', sheetId: 101, questionId: 42,
            question: { questionName: '31(1)', score: 3 }, inputFastSumbitFlag: true } };
    const store = { state: { mark: state }, commit(key, value) {
        assert.equal(key, 'mark/SET_SCOREING'); state.questionScore = value;
    } };
    sb.__dom['#app'] = { __vue_app__: { config: { globalProperties: { $store: store } } } };
    const key = keyboard ? 'input#compuinput' : SCORE;
    function mount() { sb.__dom[key] = input; sb.__dom['button.submitscorebtn'] = button; }
    if (!late) mount();
    let images = [image(OLD)];
    const queryAll = sb.document.querySelectorAll;
    sb.document.querySelectorAll = sel => sel === 'img.el-image__inner' ? images : queryAll(sel);
    sb.__AI_MARKER_WAIT_WINDOW_MS__ = 100;
    sb.setTimeout = setTimeout;
    const result = M.loadOne(sb, 'huahanyun');
    assert.deepEqual(result.errors, []);
    return { sb, input, button, state, store, mount, clicks: () => clicks,
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
