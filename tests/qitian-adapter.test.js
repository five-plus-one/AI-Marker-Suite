const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function scene(specs = [{}]) {
    let fields = [];
    const events = [];
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
    const sandbox = { console: { log() {}, warn() {}, error() {} }, URLSearchParams,
        Event: class { constructor(type) { this.type = type; } },
        window: { location: { hostname: 'yj.7net.cc', search: '?th=15&km=chemistry' } },
        document: { querySelectorAll: () => fields, querySelector: () => fields[0] || null } };
    vm.createContext(sandbox);
    for (const file of ['src/adapters/qitian/selectors.js', 'src/adapters/qitian/adapter.js', 'src/core/prompt.js', 'src/core/score.js']) {
        vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
    }
    return { adapter: sandbox.window.__AI_MARKER_ADAPTER__, sandbox, fields, events, make, replace: next => { fields = next; } };
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
