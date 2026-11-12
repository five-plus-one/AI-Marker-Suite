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

function loadVerify(mutate) {
    let src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'main.js'), 'utf8');
    if (mutate) {
        // 变异自检通道：注入实现级变异，证明关键断言必红（红度实证，不改 src/）
        assert.ok(src.includes(mutate.find), '变异目标未命中: ' + mutate.find);
        src = src.split(mutate.find).join(mutate.replace);
    }
    const grab = (name) => {
        const re = new RegExp('(?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}');
        const m = src.match(re);
        assert.ok(m, name + ' 函数未找到');
        return m[0];
    };
    const parts = [grab('normalizePaperImageUrl'), grab('paperUrlSetContains'),
                   grab('snapshotScoreInputs'), grab('scoreInputsTransitionedEmpty'),
                   grab('verifyPaperUnchanged')];
    const sandbox = { console: { warn: () => {}, log: () => {} }, String, Array, Promise, setTimeout, window: {} };
    vm.createContext(sandbox);
    vm.runInContext(parts.join('\n') + '\n;__v = verifyPaperUnchanged;', sandbox);
    sandbox.__v.win = sandbox.window;
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

test('全部基准图暂时缺失（首取空集）-> 无法判定早退放行（空集不触发复查）', async () => {
    const baseline = ['https://x.com/a.png', 'https://x.com/b.png'];
    let calls = 0;
    const adapter = {
        gatherAnswerImages: async () => {
            calls++;
            return calls === 1 ? [] : ['https://x.com/a.png', 'https://x.com/b.png'];
        },
        getScoreInputs: () => []
    };
    const r = await verify(adapter, baseline);
    assert.strictEqual(r.unchanged, null, '第一次取到空 -> 无法判定放行');
    assert.strictEqual(calls, 1, '空集早退，不得触发复查（旧用例的第二次返回从未被消费——伪复查）');
});

test('基准全缺但有图 -> 复查后回来放行（复查路径真实消费）', async () => {
    // W8 修复：旧用例首取空集即早退，"复查后回来"的桩第二次返回从未被消费。
    // 现以「首取有图但不含基准」驱动真实复查路径，断言复查确实发生且恢复判定
    const baseline = ['https://x.com/a.png', 'https://x.com/b.png'];
    let calls = 0;
    const adapter = {
        gatherAnswerImages: async () => {
            calls++;
            return calls === 1 ? ['https://x.com/GONE.png'] : ['https://x.com/a.png', 'https://x.com/b.png'];
        },
        getScoreInputs: () => []
    };
    const r = await verify(adapter, baseline);
    assert.strictEqual(r.unchanged, null, '复查后基准图回来 -> 过渡期放行');
    assert.strictEqual(calls, 2, '复查必须真实消费第二次取图');
    assert.ok(String(r.reason).includes('过渡期'), 'reason 应为复查后基准图仍在（过渡期），实际: ' + r.reason);
});

test('变异自检 W8：复查取图被删 -> 「复查后回来」断言必红（红度实证）', async () => {
    const v = loadVerify({ find: 'const retryUrls = await adapter.gatherAnswerImages();', replace: 'const retryUrls = null;' });
    const baseline = ['https://x.com/a.png', 'https://x.com/b.png'];
    let calls = 0;
    const adapter = {
        gatherAnswerImages: async () => {
            calls++;
            return calls === 1 ? ['https://x.com/GONE.png'] : ['https://x.com/a.png', 'https://x.com/b.png'];
        },
        getScoreInputs: () => []
    };
    const r = await v(adapter, baseline);
    assert.ok(!String(r.reason).includes('过渡期'),
        '变异后 reason 不再是复查恢复——上一用例的 reason 断言会红（证明其可分辨）');
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

// ---------- Canvas 型平台换卷证据（#253 语义修正）——逐场景独立用例（W9 聚合拆分） ----------
const dataUrl = 'data:image/png;base64,AAAA';
const mkCanvas = (value) => ({
    gatherAnswerImages: async () => { throw new Error('不应被调用'); },
    getScoreInputs: () => [{ element: { value } }]
});

test('Canvas：非空→清空跃变判换卷', async () => {
    const r1 = await verify(mkCanvas(''), [dataUrl], ['5']);
    assert.strictEqual(r1.unchanged, false, '非空→清空应判换卷');
});

test('Canvas：值为数字 0 是合法分值，不算清空（快照 0→清空仍判换卷）', async () => {
    const r0 = await verify({ gatherAnswerImages: async () => { throw new Error('不应被调用'); }, getScoreInputs: () => [{ element: { value: 0 } }] }, [dataUrl], ['5']);
    assert.strictEqual(r0.unchanged, null, '0 分是有效值，不得判清空');
    const r0b = await verify(mkCanvas(''), [dataUrl], [0]);
    assert.strictEqual(r0b.unchanged, false, '快照 0 分（非空）→ 被清空应判换卷');
});

test('Canvas：空→空是常态，绝不误报', async () => {
    const r2 = await verify(mkCanvas(''), [dataUrl], ['']);
    assert.strictEqual(r2.unchanged, null, '空→空是常态，必须放行');
    const r2b = await verify(mkCanvas(''), [dataUrl], [null]);
    assert.strictEqual(r2b.unchanged, null, '快照无值同样放行');
});

test('Canvas：无快照 = 不可判定', async () => {
    const r3 = await verify(mkCanvas(''), [dataUrl], null);
    assert.strictEqual(r3.unchanged, null, '无快照不得判换卷');
});

test('Canvas：仍有值不算清空', async () => {
    const r4 = await verify(mkCanvas('5'), [dataUrl], ['5']);
    assert.strictEqual(r4.unchanged, null, '仍有值不算清空');
});

test('Canvas：点击式分数容器恒不参与判定', async () => {
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

// ---------- 试卷标识强信号（#281：AMEQP 偶发误暂停修复）----------
test('试卷标识一致 → 直接判未变化（同卷 src 抖动不再误报）', async () => {
    verify.win.aiGradingState = { currentPaperId: '7720272115' };
    const adapter = {
        isMarkingPage: () => true,
        getPaperIdentity: () => '7720272115',
        gatherAnswerImages: async () => { throw new Error('标识命中不应重取图'); },
        getScoreInputs: () => []
    };
    const r = await verify(adapter, ['data:image/png;base64,AAAA']);
    assert.strictEqual(r.unchanged, true);
});

test('试卷标识变化 → 判已切换（真换卷必拦，附标识差异说明）', async () => {
    verify.win.aiGradingState = { currentPaperId: '7720272115' };
    const adapter = {
        isMarkingPage: () => true,
        getPaperIdentity: () => '7720272116',
        gatherAnswerImages: async () => { throw new Error('标识已命中不应重取图'); },
        getScoreInputs: () => []
    };
    const r = await verify(adapter, ['data:image/png;base64,AAAA']);
    assert.strictEqual(r.unchanged, false);
    assert.ok(r.reason.includes('标识'), '原因应说明标识变化，实际: ' + r.reason);
});

test('无记录标识或适配器无 getPaperIdentity → 退回既有比对（零影响）', async () => {
    verify.win.aiGradingState = {};
    const urls = ['https://x.com/a.png'];
    const r = await verify({
        isMarkingPage: () => true,
        gatherAnswerImages: async () => urls,
        getScoreInputs: () => []
    }, urls);
    assert.strictEqual(r.unchanged, true, '应走既有 URL 比对路径');
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
