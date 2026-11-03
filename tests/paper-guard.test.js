// ========== #212 答卷一致性校验：回归测试 ==========
// 目标：证明
//   1. 答卷未变化时校验放行（含 cachebuster URL、翻卷过渡期张数不齐的场景）
//   2. 任何异常/不可判定都放行并告警，绝不阻塞正常批改
//   3. 只有明确证据（基准图两次都不再出现）才判定为「已切换」
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadVerify() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'main.js'), 'utf8');
    const grab = (name) => {
        const re = new RegExp('(?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}');
        const m = src.match(re);
        assert.ok(m, name + ' 函数未找到');
        return m[0];
    };
    const parts = [grab('normalizePaperImageUrl'), grab('paperUrlSetContains'),
                   grab('snapshotScoreInputs'), grab('scoreInputsTransitionedEmpty'),
                   grab('verifyPaperUnchanged')];
    const sandbox = { console: { warn: () => {}, log: () => {} }, String, Array, Promise, setTimeout };
    vm.createContext(sandbox);
    vm.runInContext(parts.join('\n') + '\n;__v = verifyPaperUnchanged;', sandbox);
    return sandbox.__v;
}

const verify = loadVerify();

function fakeAdapter(urls, inputs) {
    return {
        gatherAnswerImages: async () => urls,
        getScoreInputs: () => inputs || []
    };
}

test('答卷未变化时放行（对所有适配器零影响）', async () => {
    const urls = ['https://x.com/a.png', 'https://x.com/b.png'];
    const r = await verify(fakeAdapter([...urls]), urls);
    assert.strictEqual(r.unchanged, true);
});

test('cachebuster URL 变化仍判未变化（酷鱼网类平台）', async () => {
    const baseline = ['https://x.com/paper/1.png?_=1111'];
    const now = ['https://x.com/paper/1.png?_=2222', 'https://x.com/paper/2.png?_=3333'];
    const r = await verify(fakeAdapter(now), baseline);
    assert.strictEqual(r.unchanged, true, '去 query 后路径一致，应判未变化');
});

test('翻卷过渡期张数不齐仍判未变化（基准图仍在集合中）', async () => {
    const baseline = ['https://x.com/a.png', 'https://x.com/b.png'];
    const now = ['https://x.com/a.png', 'https://x.com/b.png', 'https://x.com/c.png'];
    const r = await verify(fakeAdapter(now), baseline);
    assert.strictEqual(r.unchanged, true);
});

test('首图被过滤掉（未加载）但其余基准图仍在 -> 立即判未变化', async () => {
    const baseline = ['https://x.com/a.png', 'https://x.com/b.png'];
    let calls = 0;
    const adapter = {
        // 第一次取图缺 a（未加载被过滤），但 b 还在 —— 任一基准图在集合中即判未变化
        gatherAnswerImages: async () => {
            calls++;
            return calls === 1 ? ['https://x.com/b.png'] : ['https://x.com/a.png', 'https://x.com/b.png'];
        },
        getScoreInputs: () => []
    };
    const r = await verify(adapter, baseline);
    assert.strictEqual(r.unchanged, true, '任一基准图仍在集合中，应立即判未变化');
    assert.strictEqual(calls, 1, '不应触发复查');
});

test('全部基准图暂时缺失、复查后回来 -> 不拦截', async () => {
    const baseline = ['https://x.com/a.png', 'https://x.com/b.png'];
    let calls = 0;
    const adapter = {
        // 第一次两张都被过滤（未加载），第二次都回来了
        gatherAnswerImages: async () => {
            calls++;
            return calls === 1 ? [] : ['https://x.com/a.png', 'https://x.com/b.png'];
        },
        getScoreInputs: () => []
    };
    const r = await verify(adapter, baseline);
    assert.strictEqual(r.unchanged, null, '第一次取到空 -> 无法判定放行');
});

test('基准图两次都不再出现 -> 判定已切换', async () => {
    const baseline = ['https://x.com/a.png', 'https://x.com/b.png'];
    const now = ['https://x.com/NEW1.png', 'https://x.com/NEW2.png'];
    const r = await verify(fakeAdapter(now), baseline);
    assert.strictEqual(r.unchanged, false);
    assert.ok(r.reason.includes('变化'));
});

test('复查时取不到图片 -> 无法判定（放行）', async () => {
    const baseline = ['https://x.com/a.png'];
    let calls = 0;
    const adapter = {
        gatherAnswerImages: async () => {
            calls++;
            return calls === 1 ? ['https://x.com/GONE.png'] : [];
        },
        getScoreInputs: () => []
    };
    const r = await verify(adapter, baseline);
    assert.strictEqual(r.unchanged, null);
});

test('适配器不支持 gatherAnswerImages 时无法判定（放行）', async () => {
    const r = await verify({}, ['https://x.com/a.png']);
    assert.strictEqual(r.unchanged, null);
});

test('无基准图片时无法判定（放行）', async () => {
    const r = await verify(fakeAdapter(['https://x.com/a.png']), []);
    assert.strictEqual(r.unchanged, null);
});

test('gatherAnswerImages 抛异常时无法判定（放行）', async () => {
    const adapter = { gatherAnswerImages: async () => { throw new Error('boom'); } };
    const r = await verify(adapter, ['https://x.com/a.png']);
    assert.strictEqual(r.unchanged, null);
    assert.ok(r.reason.includes('boom'));
});

test('Canvas 型平台（data: URL）：仅「非空→清空」跃变判换卷（#253 语义修正）', async () => {
    const dataUrl = 'data:image/png;base64,AAAA';
    const mk = (value) => ({
        gatherAnswerImages: async () => { throw new Error('不应被调用'); },
        getScoreInputs: () => [{ element: { value } }]
    });

    // 取图时非空 → 校验时被清空：换卷证据成立
    const r1 = await verify(mk(''), [dataUrl], ['5']);
    assert.strictEqual(r1.unchanged, false, '非空→清空应判换卷');

    // 空→空：填分前的正常状态，绝不误报（旧逻辑此处误判，已根治）
    const r2 = await verify(mk(''), [dataUrl], ['']);
    assert.strictEqual(r2.unchanged, null, '空→空是常态，必须放行');
    const r2b = await verify(mk(''), [dataUrl], [null]);
    assert.strictEqual(r2b.unchanged, null, '快照无值同样放行');

    // 无快照 = 不可判定
    const r3 = await verify(mk(''), [dataUrl], null);
    assert.strictEqual(r3.unchanged, null, '无快照不得判换卷');

    // 非空 → 仍有值：未被清空
    const r4 = await verify(mk('5'), [dataUrl], ['5']);
    assert.strictEqual(r4.unchanged, null, '仍有值不算清空');

    // 点击式分数容器（无 value 属性）：恒不参与判定（旧逻辑对此恒真误报）
    const clickAdapter = {
        gatherAnswerImages: async () => { throw new Error('不应被调用'); },
        getScoreInputs: () => [{ element: { className: 'score-box' }, type: 'click' }]
    };
    const r5 = await verify(clickAdapter, [dataUrl], [null]);
    assert.strictEqual(r5.unchanged, null, '点击式容器不得判换卷');
    const r6 = await verify(clickAdapter, [dataUrl], ['5']);
    assert.strictEqual(r6.unchanged, null, '点击式容器无真实输入框，一律放行');
});

test('Canvas 型平台不会调用 gatherAnswerImages（避免 0.5~1s 额外等待）', async () => {
    let called = 0;
    const adapter = {
        gatherAnswerImages: async () => { called++; return ['data:image/png;base64,BBBB']; },
        getScoreInputs: () => []
    };
    await verify(adapter, ['data:image/png;base64,AAAA']);
    assert.strictEqual(called, 0, '基准为 data: URL 时绝不能重取图片');
});

// ---------- 离开批改页（#244）：退回列表页 ≠ 换卷 ----------
test('已离开批改页（isMarkingPage false）→ 不判换卷，即使取到不同图片', async () => {
    const adapter = {
        isMarkingPage: () => false,
        // 离开后即便取到别的图（缓存兜底/邻座图），也绝不能判「已切换」
        gatherAnswerImages: async () => ['https://x.com/neighbor.png'],
        getScoreInputs: () => []
    };
    const r = await verify(adapter, ['https://x.com/a.png']);
    assert.notStrictEqual(r.unchanged, false, '离开批改页不得判已切换');
    assert.strictEqual(r.unchanged, null, '离开批改页应放行（无法判定）');
});

test('仍在批改页（isMarkingPage true）→ 正常比对，换卷照常拦截', async () => {
    const adapter = {
        isMarkingPage: () => true,
        gatherAnswerImages: async () => ['https://x.com/new.png'],
        getScoreInputs: () => []
    };
    const r = await verify(adapter, ['https://x.com/old.png']);
    assert.strictEqual(r.unchanged, false, '批改页上真换卷仍应拦截');
});

test('适配器无 isMarkingPage（历史适配器）→ 行为不变，正常比对', async () => {
    const adapter = {
        gatherAnswerImages: async () => ['https://x.com/new.png'],
        getScoreInputs: () => []
    };
    const r = await verify(adapter, ['https://x.com/old.png']);
    assert.strictEqual(r.unchanged, false, '缺 isMarkingPage 时保持原有判定');
});

// ---------- 离开批改页判定的「复查确认」（#246 加固）----------
// DOM 型 isMarkingPage（frame/组件重载）会短暂返回 false，瞬时 false 不算离开
function loadConfirm() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'main.js'), 'utf8');
    const m = src.match(/async function confirmLeftMarkingPage\([^)]*\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'confirmLeftMarkingPage 未找到');
    const sandbox = { console: { log: () => {} }, Promise, setTimeout };
    vm.createContext(sandbox);
    vm.runInContext(m[0] + '\n;__c = confirmLeftMarkingPage;', sandbox);
    return sandbox.__c;
}
const confirmLeft = loadConfirm();

test('复查确认：持续不在批改页 → 判定离开', async () => {
    const adapter = { isMarkingPage: () => false };
    assert.strictEqual(await confirmLeft(adapter), true);
});

test('复查确认：瞬时 false 后恢复（frame 重载）→ 不算离开，不误杀', async () => {
    let calls = 0;
    const adapter = { isMarkingPage: () => { calls++; return calls > 1; } };
    assert.strictEqual(await confirmLeft(adapter), false, '复查恢复后不得判离开');
});

test('复查确认：一直在批改页 → 不算离开', async () => {
    assert.strictEqual(await confirmLeft({ isMarkingPage: () => true }), false);
});

test('复查确认：适配器无 isMarkingPage → 不算离开（零影响）', async () => {
    assert.strictEqual(await confirmLeft({}), false);
    assert.strictEqual(await confirmLeft(null), false);
});
