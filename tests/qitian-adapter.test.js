const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function scene(specs = [{}]) {
    let fields = [];
    const events = [];
    const image = { src: 'https://images.test/paper-A.png', getClientRects: () => [{}] };
    const submissions = [];
    const transports = [];
    let requestUrl = 'https://yj.7net.cc/Review/guid';
    let reply = '+OK saved', status = 200, networkEvent = 'load', lastRequest, requestScores;
    let loading = false, beforeSend;
    const target = { regionGuid: 'paper-A', th: '15' };
    const requestTarget = { regionGuid: 'paper-A', tz: '15' };
    class XHR {
        constructor() { this.listeners = new Map(); }
        open(method, url) { this.method = method; this.url = url; }
        addEventListener(type, listener) { this.listeners.set(type, listener); }
        removeEventListener(type) { this.listeners.delete(type); }
        send(body) { transports.push({ url: this.url, body }); lastRequest = this; this.status = status; this.responseText = reply;
            if (networkEvent) this.listeners.get(networkEvent)?.({ type: networkEvent }); }
    }
    const originalOpen = XHR.prototype.open, originalSend = XHR.prototype.send;
    const button = { disabled: false, getClientRects: () => [{}], click() {
        submissions.push(fields.map(input => input.value));
        beforeSend?.();
        const xhr = new XHR(); xhr.open('POST', requestUrl);
        xhr.send(new URLSearchParams({ ...requestTarget, score: requestScores ?? fields.map(input => input.value).join(';') }).toString());
    } };
    const make = (spec = {}, i = 0) => {
        const attributes = { onkeydown: `inputByKey(event,${i + 1}, ${specs.length},${spec.max ?? 14})`, ...spec.attributes };
        const title = { textContent: spec.label || `第${15 + i}题 |` };
        const board = spec.board === false ? [] : [{ textContent: '满分', getAttribute: name => name === 'data-val' ? String(spec.boardMax ?? spec.max ?? 14) : String(i + 1) }];
        const row = { querySelector: () => title, querySelectorAll: () => board };
        const input = { id: spec.id || `tbs${i + 1}`, type: 'text', value: '', disabled: false, readOnly: false,
            getAttribute: name => attributes[name] ?? null,
            getClientRects: () => spec.hidden ? [] : [{}], closest: () => row,
            dispatchEvent(event) { events.push([this.id, event.type]); spec.onEvent?.(this, event); } };
        return input;
    };
    fields = specs.map(make);
    const sandbox = { console: { log() {}, warn() {}, error() {} }, URL, URLSearchParams, setTimeout, clearTimeout,
        Event: class { constructor(type) { this.type = type; } },
        window: { XMLHttpRequest: XHR, initConfig: target, location: { hostname: 'yj.7net.cc', origin: 'https://yj.7net.cc',
            href: 'https://yj.7net.cc/Review?th=15&km=chemistry', search: '?th=15&km=chemistry' } },
        document: { querySelectorAll: selector => selector.includes('#paperImage') ? (loading ? [] : [image]) : fields,
            querySelector: selector => {
                if (selector === 'input#subfen') return button;
                if (selector === '#paperImage > #showloading') return loading ? {} : null;
                return fields[0] || null;
            } } };
    vm.createContext(sandbox);
    for (const file of ['src/adapters/qitian/selectors.js', 'src/adapters/qitian/adapter.js', 'src/core/prompt.js', 'src/core/score.js']) {
        vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
    }
    return { adapter: sandbox.window.__AI_MARKER_ADAPTER__, sandbox, fields, events, make, image, button, submissions,
        reply: (text, code = 200, event = 'load') => { reply = text; status = code; networkEvent = event; },
        requestScores: scores => { requestScores = scores; },
        requestUrl: url => { requestUrl = url; }, transports, target, requestTarget,
        showLoadingOnSubmit: callback => { beforeSend = () => { loading = true; callback?.(); }; },
        respond: () => lastRequest?.listeners.get('load')?.({ type: 'load' }),
        restored: () => XHR.prototype.open === originalOpen && XHR.prototype.send === originalSend,
        configure: scoring => { sandbox.PresetManager = { getCurrentConfig: () => ({ scoring }) }; }, replace: next => { fields = next; } };
}

test('七天第15题按一个原生评分框识别14分满分', () => {
    const { adapter } = scene();
    const [unit] = adapter.getScoreInputs();
    assert.equal(unit.label, '第15题');
    assert.equal(unit.maxScore, 14);
    assert.equal(adapter.detectSubQuestions().length, 1);
    assert.equal(adapter.detectSubQuestions()[0].maxScore, 14);
});

test('七天满分分别来自同题给分板、键盘参数或max属性，不取别题满分', () => {
    assert.equal(scene([{ attributes: { onkeydown: '' } }]).adapter.getScoreInputs()[0].maxScore, 14);
    assert.equal(scene([{ board: false, max: 12.5 }]).adapter.getScoreInputs()[0].maxScore, 12.5);
    assert.equal(scene([{ board: false, attributes: { onkeydown: '', max: '8' } }]).adapter.getScoreInputs()[0].maxScore, 8);
    const multiple = scene([{ max: 6 }, { max: 8 }]).adapter.getScoreInputs();
    assert.deepEqual(Array.from(multiple, unit => unit.maxScore), [6, 8]);
    const unknown = scene([{ board: false, attributes: { onkeydown: 'unrelated(event,1,1,99)' } }]);
    assert.equal(unknown.adapter.getScoreInputs()[0].maxScore, undefined);
});

test('七天排除隐藏残留评分框及非评分输入框', () => {
    const e = scene([{}, { hidden: true }, { id: 'tbsSettings' }]);
    assert.equal(e.adapter.getScoreInputs().length, 1);
    assert.equal(e.adapter.fillScores([2, 0, 2, 2, 0, 2, 2]), true);
    assert.equal(e.fields[0].value, '10');
    assert.equal(e.fields[1].value, '');
    assert.equal(e.fields[2].value, '');
    assert.ok(e.events.every(([, type]) => type !== 'keydown' && type !== 'click'));
});

test('七天单总分框汇总完整七小题解析结果，满分与零分有效', () => {
    const e = scene();
    const units = Array.from({ length: 7 }, (_, i) => ({ label: `（${i + 1}）`, maxScore: 2 }));
    const text = '【答案复述】合成答卷\n【评分依据】逐题评分\n' + units.map(unit => `${unit.label}分数：2`).join('\n') + '\n【得分】14';
    const result = e.sandbox.parseSubQuestionResponse(text, { subQuestions: units });
    assert.equal(result.score, 14);
    const calculated = vm.runInContext('ScoreCalculator', e.sandbox).calculate({ aiScore: result.score, maxScore: 14,
        diligenceLevel: 0, scoringConfig: { roundStep: 1 }, aiUnitScores: result.subScores });
    assert.equal(e.adapter.fillScores(Array.from(calculated.finalUnitScores, unit => unit.score)), true);
    assert.equal(e.fields[0].value, '14');
    assert.equal(e.adapter.fillScores([0, 0, 0, 0, 0, 0, 0]), true);
    assert.equal(e.fields[0].value, '0');
    assert.equal(e.adapter.fillScore({ total: 10, subScores: units.map((unit, i) => ({ ...unit, score: i < 5 ? 2 : 0 })) }), true);
    assert.equal(e.fields[0].value, '10');
});

test('七天多框要求精确数量，先完整校验再填写', () => {
    const e = scene([{ max: 6 }, { max: 8 }]);
    for (const scores of [[6], [6, 8, 0], [6, null], [6, 9], [6, -1]]) {
        assert.equal(e.adapter.fillScores(scores), false);
        assert.deepEqual(e.fields.map(input => input.value), ['', '']);
        assert.equal(e.events.length, 0);
    }
    assert.equal(e.adapter.fillScores([0, 8]), true);
    assert.deepEqual(e.fields.map(input => input.value), ['0', '8']);
});

test('七天单框汇总前按配置核对每项数量与各自满分', () => {
    for (const scores of [[2,2,2,2,2,2], [14,0,0,0,0,0,0], [1,3,2,2,2,2,2], [14]]) {
        const e = scene();
        e.configure({ units: Array.from({ length: 7 }, (_, i) => ({ label: String(i + 1), maxScore: 2 })) });
        assert.equal(e.adapter.fillScores(scores), false);
        assert.equal(e.fields[0].value, '');
        assert.equal(e.events.length, 0);
    }
    const e = scene();
    e.configure({ units: [{ label: 'a', maxScore: 6 }, { label: 'b', maxScore: 8 }] });
    assert.equal(e.adapter.fillScore({ total: 14, subScores: [{ label: 'b', score: 8 }, { label: 'a', score: 6 }] }), true);
    assert.equal(e.fields[0].value, '14');
    assert.equal(e.adapter.fillScore({ total: 8, subScores: [{ label: 'a', score: 8 }, { label: 'b', score: 0 }] }), false);
    assert.equal(e.adapter.fillScore({ total: 8, subScores: [{ label: 'x', score: 6 }, { label: 'b', score: 2 }] }), false);
});

test('七天缺分、非数值与超满分不能汇总成总分', () => {
    for (const scores of [[], Array(7), [null], [undefined], [''], [' '], [true], [NaN], [Infinity], [-1], [2, null, 2], [8, 8]]) {
        const e = scene();
        assert.equal(e.adapter.fillScores(scores), false, String(scores));
        assert.equal(e.fields[0].value, '');
        assert.ok(e.adapter.lastFillError);
    }
    const e = scene();
    assert.equal(e.adapter.fillScore({ total: 4, subScores: [{ label: '3', score: 2 }, { label: '3', score: 2 }] }), false);
});

test('七天满分冲突、禁用、只读及重复原生框拒绝填写', () => {
    for (const spec of [{ boardMax: 12 }, { attributes: { max: '12' } }]) {
        const e = scene([spec]);
        assert.equal(e.adapter.fillScores([2]), false);
        assert.equal(e.fields[0].value, '');
    }
    for (const property of ['disabled', 'readOnly']) {
        const e = scene(); e.fields[0][property] = true;
        assert.equal(e.adapter.fillScores([2]), false);
    }
    assert.equal(scene([{ id: 'tbs1' }, { id: 'tbs1' }]).adapter.fillScores([2, 2]), false);
});

test('七天原生校验修改分数、换框或满分变化时显式失败', () => {
    const modified = scene([{ onEvent(input) { input.value = '1'; } }]);
    assert.equal(modified.adapter.fillScores([2]), false);
    const replaced = scene([{ onEvent() { replaced.replace([replaced.make()]); } }]);
    assert.equal(replaced.adapter.fillScores([2]), false);
    const changed = scene();
    changed.fields[0].dispatchEvent = () => { changed.fields[0].getAttribute = name => name === 'onkeydown' ? 'inputByKey(event,1,1,6)' : null; };
    assert.equal(changed.adapter.fillScores([2]), false);
});

test('七天旧接口按题号对齐多框，不按返回顺序错填', () => {
    const e = scene([{ max: 6 }, { max: 8 }]);
    assert.equal(e.adapter.fillScore({ total: 7, subScores: [{ label: '16', score: 5 }, { label: '15', score: 2 }] }), true);
    assert.deepEqual(e.fields.map(input => input.value), ['2', '5']);
    assert.equal(e.adapter.fillScore({ total: 7, subScores: [{ label: '17', score: 5 }, { label: '15', score: 2 }] }), false);
});

test('七天请求AI前核对方案总分、唯一小题名及多框顺序', () => {
    const e = scene();
    e.configure({ maxScore: 4 });
    assert.equal(e.adapter.prepareGrading(), false);
    assert.equal(e.adapter.fillScores([4]), false);
    assert.equal(e.fields[0].value, '');
    e.configure({ units: [{ label: '（1）', maxScore: 7 }, { label: '(1)', maxScore: 7 }] });
    assert.equal(e.adapter.prepareGrading(), false);
    e.configure({ units: Array.from({ length: 7 }, (_, i) => ({ label: `(${i + 1})`, maxScore: 2 })) });
    assert.equal(e.adapter.prepareGrading(), true);
    assert.equal(e.adapter.fillScores([2, 2, 2, 2, 2, 2, 2]), true);
    const multiple = scene([{ max: 6 }, { max: 8 }]);
    multiple.configure({ units: [{ label: '16', maxScore: 8 }, { label: '15', maxScore: 6 }] });
    assert.equal(multiple.adapter.prepareGrading(), false);
    multiple.configure({ units: [{ label: '15', maxScore: 6 }, { label: '16', maxScore: 8 }] });
    assert.equal(multiple.adapter.prepareGrading(), true);
});

test('七天成功填分回执约束提交且同一回执只消费一次', async () => {
    const e = scene();
    assert.equal(await e.adapter.submitGrade(), false);
    assert.equal(e.adapter.fillScores([2, 0, 2, 2, 0, 2, 2]), true);
    assert.equal(await e.adapter.submitGrade({ isCurrent: () => true }), true);
    assert.deepEqual(e.submissions, [['10']]);
    assert.equal(await e.adapter.submitGrade(), false);
    assert.equal(e.submissions.length, 1);
});

test('七天提交前取消、换卷、换题、改分、换框及不可用按钮均停止', async () => {
    const mutations = [e => { e.image.src = 'https://images.test/paper-B.png'; },
        e => { e.sandbox.window.location.search = '?th=16&km=chemistry'; },
        e => { e.fields[0].value = '3'; }, e => { e.replace([e.make()]); },
        e => { e.button.disabled = true; }, e => { e.fields[0].readOnly = true; }];
    for (const mutate of mutations) {
        const e = scene(); assert.equal(e.adapter.fillScores([2]), true); mutate(e);
        assert.equal(await e.adapter.submitGrade(), false);
        assert.equal(e.submissions.length, 0);
    }
    const e = scene(); e.adapter.fillScores([2]);
    assert.equal(await e.adapter.submitGrade({ signal: { aborted: true } }), false);
    assert.equal(await e.adapter.submitGrade({ isCurrent: () => false }), false);
    assert.equal(e.adapter.fillScores([null]), false);
    assert.equal(await e.adapter.submitGrade(), false);
    assert.equal(e.submissions.length, 0);
});

test('七天填分事件中换卷时立即停止后续事件和后续评分框', async () => {
    const e = scene([{ max: 6 }, { max: 8 }]);
    e.fields[0].dispatchEvent = event => { e.events.push(event.type); e.image.src = 'https://images.test/paper-B.png'; };
    assert.equal(e.adapter.fillScores([2, 3]), false);
    assert.deepEqual(e.events, ['input']);
    assert.equal(e.fields[1].value, '');
    assert.equal(await e.adapter.submitGrade(), false);
});

test('七天保存核对原生请求分数与服务端成功回执并恢复请求方法', async () => {
    for (const [body, code, event, expected] of [
        ['+OK saved', 200, 'load', true], ['-ERR refused', 200, 'load', false],
        ['<html>login</html>', 200, 'load', false], ['+OK saved', 500, 'load', false],
        ['+OK saved', 200, 'error', false], ['+OK saved', 200, 'timeout', false]]) {
        const e = scene(); e.reply(body, code, event); e.adapter.fillScores([2]);
        assert.equal(await e.adapter.submitGrade(), expected);
        assert.equal(e.restored(), true);
        assert.equal(e.adapter._filled, null);
    }
    const mismatch = scene(); mismatch.adapter.fillScores([2]); mismatch.requestScores('3');
    assert.equal(await mismatch.adapter.submitGrade(), false);
    assert.equal(mismatch.transports.length, 0, '不发送与已确认分数不一致的请求');
    assert.equal(mismatch.restored(), true);
    const timeout = scene(); timeout.adapter.fillScores([2]); timeout.button.click = () => {};
    timeout.sandbox.setTimeout = callback => setTimeout(callback, 5);
    assert.equal(await timeout.adapter.submitGrade(), false);
    assert.equal(timeout.restored(), true);
    const unrelated = scene(); unrelated.adapter.fillScores([2]); unrelated.requestUrl('https://other.test/Review/guid');
    unrelated.sandbox.setTimeout = callback => setTimeout(callback, 5);
    assert.equal(await unrelated.adapter.submitGrade(), false);
    assert.equal(unrelated.transports.length, 1, '其他来源的请求保持原生行为');
    assert.equal(unrelated.restored(), true);
});

test('七天等待保存时取消或重复点击均不重复提交', async () => {
    const e = scene(); e.reply('+OK saved', 200, null); e.adapter.fillScores([2]);
    const controller = new AbortController();
    const pending = e.adapter.submitGrade({ signal: controller.signal });
    assert.equal(await e.adapter.submitGrade(), false);
    controller.abort();
    assert.equal(await pending, false);
    e.respond();
    assert.equal(e.submissions.length, 1);
    assert.equal(e.restored(), true);
    const stale = scene(); stale.reply('+OK saved', 200, null); stale.adapter.fillScores([2]);
    let current = true;
    const previous = stale.adapter.submitGrade({ isCurrent: () => current });
    current = false; stale.respond();
    assert.equal(await previous, false);
    assert.equal(stale.restored(), true);
});

test('七天原生提交先移除答卷图片，按平台卷号和题组核对保存', async () => {
    const accepted = scene();
    assert.equal(accepted.adapter.fillScores([2]), true);
    accepted.showLoadingOnSubmit();
    assert.equal(await accepted.adapter.submitGrade(), true);
    assert.equal(accepted.transports.length, 1);
    assert.equal(accepted.restored(), true);

    for (const change of [
        e => { e.requestTarget.regionGuid = 'paper-B'; },
        e => { e.requestTarget.tz = '16'; },
        e => { e.target.regionGuid = e.requestTarget.regionGuid = 'paper-B'; },
        e => { e.requestScores('3'); },
        e => { delete e.sandbox.window.initConfig; },
    ]) {
        const e = scene();
        assert.equal(e.adapter.fillScores([2]), true);
        e.showLoadingOnSubmit(() => change(e));
        assert.equal(await e.adapter.submitGrade(), false);
        assert.equal(e.transports.length, 0);
        assert.equal(e.restored(), true);
    }
});

test('七天真实主流程在请求AI前拒绝重复小题与错误总分', async () => {
    const { env, load } = require('./_audit-harness');
    for (const scoring of [{ maxScore: 4 }, { units: [{ label: '3', maxScore: 7 }, { label: '3', maxScore: 7 }] }]) {
        const e = env(), q = scene(); let requests = 0;
        e.cfg.scoring = scoring; q.sandbox.PresetManager = e.sb.PresetManager;
        e.adapter.prepareGrading = () => {
            const ok = q.adapter.prepareGrading(); e.adapter.lastFillError = q.adapter.lastFillError; return ok;
        };
        e.sb.callAIGrading = async () => { requests++; return { score: 2 }; };
        load(e, 'src/core/main.js'); await e.sb.startAutoGrading();
        assert.equal(requests, 0); assert.equal(e.calls.fill.length, 0); assert.equal(e.calls.submit.length, 0);
        assert.ok(e.calls.toasts.some(message => /满分|重复/.test(message)));
    }
});

test('七天真实主流程使用完整分项汇总，部分识别失败不填分不提交', async () => {
    const { env, load } = require('./_audit-harness');
    for (const complete of [true, false]) {
        const e = env(), q = scene();
        const units = Array.from({ length: 7 }, (_, i) => ({ label: `（${i + 1}）`, maxScore: 2 }));
        e.cfg.scoring = { maxScore: 14, units, roundStep: 1, roundMethod: 'round' };
        e.sb.PresetManager.getMaxScore = () => 14;
        q.sandbox.PresetManager = e.sb.PresetManager;
        e.adapter.prepareGrading = q.adapter.prepareGrading.bind(q.adapter);
        e.adapter.getScoreInputs = q.adapter.getScoreInputs.bind(q.adapter);
        e.adapter.fillScores = scores => {
            const ok = q.adapter.fillScores(scores);
            e.adapter.lastFillError = q.adapter.lastFillError;
            return ok;
        };
        e.sb.showAutoSubmitDialog = (score, comment, subs) => { e.calls.dialogs.push({ score, subs }); };
        const text = '【答案复述】合成作答\n【评分依据】逐项评分\n' + units.slice(0, complete ? 7 : 6)
            .map(unit => `${unit.label}分数：2`).join('\n') + '\n【得分】14';
        e.sb.callAIGrading = async () => q.sandbox.parseSubQuestionResponse(text, { subQuestions: units });
        load(e, 'src/core/score.js'); load(e, 'src/core/main.js');
        await e.sb.startAutoGrading();
        assert.equal(q.fields[0].value, complete ? '14' : '');
        assert.equal(e.calls.dialogs.length, complete ? 1 : 0);
        assert.equal(e.calls.submit.length, 0);
        if (complete) assert.equal(e.calls.dialogs[0].subs.length, 7);
        else assert.equal(e.state.isPaused, true);
    }
});
