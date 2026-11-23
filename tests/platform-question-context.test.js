const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ADAPTERS, loadOne, makeStub, readSrc } = require('./_adapter-matrix');

function platform(dir, overrides = {}) {
    const cases = ADAPTERS.filter(item => item.dir === dir);
    const form = Object.assign({}, cases[0].own, overrides);
    const sb = makeStub(form);
    const { errors, winner } = loadOne(sb, dir);
    assert.deepEqual(errors, [], dir);
    assert.ok(winner, dir);
    vm.runInContext(readSrc('src/core/runtime.js'), sb);
    return { sb, adapter: winner, dom: sb.__dom };
}

function field(attributes = {}, related = {}) {
    const data = { ...attributes };
    return Object.assign(data, {
        getAttribute: name => data[name] ?? null,
        hasAttribute: name => name in data,
        getClientRects: () => [1],
        closest: selector => related[selector] || null,
        querySelector: selector => related[selector] || null
    });
}

function examContext(scene, expected) {
    assert.equal(scene.sb.supportsQuestionGuard(scene.adapter), true);
    const context = scene.sb.readGradingQuestionContext(scene.adapter);
    assert.ok(context);
    assert.deepEqual(Array.from(context.units, unit => unit.maxScore), expected);
    return context;
}

test('校验只接受完整、唯一且具有正数满分的原站评分项', () => {
    const { sb } = platform('c30');
    assert.equal(sb.nativeQuestionContext([]), null);
    for (const maxScore of [0, -1, true, undefined, Infinity, '4x', '']) {
        assert.equal(sb.nativeQuestionContext([{ label: '17', maxScore }]), null);
    }
    assert.equal(sb.nativeQuestionContext([{ label: '  ', maxScore: 4 }]), null);
    assert.equal(sb.nativeQuestionContext([{ label: '17', maxScore: 4 }, { label: '１７', maxScore: 4 }]), null);
    assert.equal(sb.nativeQuestionContext([{ label: '17', maxScore: '４.５' }]).units[0].maxScore, 4.5);
});

test('七天新版读取各小题原生分值，同题换试题 ID 不改变基准', () => {
    const scene = platform('qitian-new', { hash: '#/marking?tz=四.15' });
    const parent = (name, active = false) => Object.assign(field({}, { '.title-info': { textContent: name } }), {
        classList: { contains: key => key === 'activeTitle' && active }
    });
    const first = field({ id: 'inputScoreRef_四.15.1', placeholder: '满分4分' }, { '.scoreContainer': parent('四.15.1', true) });
    const second = field({ id: 'inputScoreRef_四.15.2', placeholder: '满分6分' }, { '.scoreContainer': parent('四.15.2') });
    const display = { textContent: '试题ID：558' };
    scene.dom['.id-container'] = display;
    scene.sb.document.querySelectorAll = () => [first, second];
    const before = examContext(scene, [4, 6]);
    display.textContent = '试题ID：560';
    assert.equal(examContext(scene, [4, 6]).key, before.key);
    second.placeholder = '满分6.5分';
    assert.notEqual(examContext(scene, [4, 6.5]).key, before.key);
    delete second.placeholder;
    assert.equal(scene.sb.readGradingQuestionContext(scene.adapter), null);

    delete first.placeholder;
    assert.equal(scene.sb.supportsQuestionGuard(scene.adapter), false);
    scene.sb.document.querySelectorAll = () => [first];
    scene.dom['.ScoreAndStep .scoreRect.scoreGreen > span:last-child'] = { textContent: '4.5' };
    examContext(scene, [4.5]);
});

test('乐华从正在使用的原生评分组件读取题组，排除同页历史组件', () => {
    const scene = platform('lehua', { hash: '#/yuejuan1/examYj1' });
    const controls = { $options: { name: 'GradingControlsNew' }, $el: field(), maxScore: 5.5 };
    const page = {
        $options: { name: 'ExamYj1' }, $refs: { gradingControls: controls }, sel_xm: '模拟考试',
        sel_sb: '英语', currentToolbarQuestionGroup: '17', max_score: 5.5
    };
    const hiddenControls = { ...controls, $el: { getClientRects: () => [] } };
    scene.dom['#app'] = { __vue__: { $children: [page, { ...page, $refs: { gradingControls: hiddenControls } }] } };
    const before = examContext(scene, [5.5]);
    page.currentToolbarQuestionGroup = '18';
    assert.notEqual(examContext(scene, [5.5]).key, before.key);
    controls.maxScore = 6;
    assert.equal(scene.sb.readGradingQuestionContext(scene.adapter), null);
});

test('九科星作业保护按题批阅的题号和小数满分，同题批改进度变化不触发', () => {
    const scene = platform('jiukexing-homework', { path: '/homework/homework/mark/19', search: '?classId=1&questionId=42' });
    const score = { placeholder: '≤5.5' }, title = { textContent: '第11题(0/52)' };
    scene.dom['input.el-input__inner[placeholder^="≤"]'] = score;
    scene.dom['.student-list .student-select'] = field({}, { '.common-name-ellipsis': title });
    const before = examContext(scene, [5.5]);
    title.textContent = '第11题(1/52)';
    assert.equal(examContext(scene, [5.5]).key, before.key);
    scene.sb.location.search = '?classId=1&questionId=43';
    assert.notEqual(examContext(scene, [5.5]).key, before.key);
    scene.sb.location.search = '?studentNumber=2';
    assert.equal(scene.sb.readGradingQuestionContext(scene.adapter), null);
});

test('上进用原生评分项标识，同样的满分可区分不同题块', () => {
    const scene = platform('sipd');
    const selector = vm.runInContext('SIPD_SELECTORS', scene.sb);
    const max = { textContent: '≤4.5' };
    const item = field({ 'data-key': 'item-17' }, { [selector.MAX_SCORE_FONT]: max });
    const input = field({ offsetParent: {} }, { [selector.SCORE_INPUT_CONTAINER]: item });
    item.querySelector = key => key === selector.SCORE_INPUT ? input : key === selector.MAX_SCORE_FONT ? max : null;
    scene.dom[selector.SCORE_INPUT_CONTAINER] = item;
    const before = examContext(scene, [4.5]);
    item['data-key'] = 'item-18';
    assert.notEqual(examContext(scene, [4.5]).key, before.key);
    delete item['data-key'];
    assert.equal(scene.sb.readGradingQuestionContext(scene.adapter), null);
});

test('威科姆从评分框所属题目读取题号和满分，缺少题号时不以框序号替代', () => {
    const scene = platform('wuyuetong');
    const selector = vm.runInContext('WUYUETONG_SELECTORS', scene.sb);
    const related = { [selector.SCORE_LABEL]: { textContent: '17: ' }, [selector.MAX_SCORE_FONT]: { textContent: '<=4.5' } };
    scene.dom[selector.SCORE_INPUT] = field({}, { [selector.SCORE_INPUT_CONTAINER]: field({}, related) });
    examContext(scene, [4.5]);
    delete related[selector.SCORE_LABEL];
    assert.equal(scene.sb.readGradingQuestionContext(scene.adapter), null);
});

test('精斗云总分模式读取平台题号，拆题需原站提供每个小题满分', () => {
    const scene = platform('jingdouyun', { hash: '#/marking?examId=20&itemid=17' });
    scene.dom['span[ng-bind="taskItemNo.itemNo"]'] = { textContent: '17' };
    scene.dom['span[ng-bind="allFetchDatas.scoreMax"]'] = { textContent: '4.5' };
    scene.sb.document.querySelectorAll = selector => selector === 'input.qscore_input' ? [field()] : [];
    examContext(scene, [4.5]);
    scene.sb.document.querySelectorAll = () => [field(), field()];
    assert.equal(scene.sb.supportsQuestionGuard(scene.adapter), false);
    assert.equal(scene.sb.readGradingQuestionContext(scene.adapter), null);
});

test('A佳校验绑定题组，同题地址里的答卷查询变化不触发换题', () => {
    const route = '?projectId=exam&subjectCode=english&questionNo=17';
    const scene = platform('ajia', { search: route });
    const selector = vm.runInContext('AJIA_SELECTORS', scene.sb);
    const full = field({ 'data-score': '4.5' }), title = { textContent: '17（1）' };
    const row = field({}, { [selector.FULLSCORE]: full, [selector.QUESTION_LABEL]: title });
    const score = field({}, { tr: row });
    row.querySelector = key => key === 'input.num-source' ? score
        : key === selector.FULLSCORE ? full : key === selector.QUESTION_LABEL ? title : null;
    scene.dom[selector.SCORE_ROW] = row;
    const first = examContext(scene, [4.5]);
    scene.sb.location.search = route + '&studentId=other';
    assert.equal(examContext(scene, [4.5]).key, first.key);
    scene.sb.location.search = route.replace('17', '18');
    assert.notEqual(examContext(scene, [4.5]).key, first.key);
});
