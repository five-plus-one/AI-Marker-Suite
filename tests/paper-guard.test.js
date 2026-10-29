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
                   grab('scoreInputsCleared'), grab('verifyPaperUnchanged')];
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

test('首图被过滤掉（未加载）导致暂时缺失，复查后仍在 -> 不拦截', async () => {
    const baseline = ['https://x.com/a.png', 'https://x.com/b.png'];
    let calls = 0;
    const adapter = {
        gatherAnswerImages: async () => {
            calls++;
            return calls === 1 ? ['https://x.com/b.png'] : ['https://x.com/a.png', 'https://x.com/b.png'];
        },
        getScoreInputs: () => []
    };
    const r = await verify(adapter, baseline);
    assert.strictEqual(r.unchanged, null, '复查后基准图仍在，应判无法判定并放行');
    assert.ok(r.reason.includes('过渡期') || r.reason.includes('基准图仍在'));
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

test('Canvas 型平台（data: URL）跳过图片比对，按输入框信号判定', async () => {
    const dataUrl = 'data:image/png;base64,AAAA';
    const adapter1 = {
        gatherAnswerImages: async () => { throw new Error('不应被调用'); },
        getScoreInputs: () => [{ element: { value: '5' } }]
    };
    const r1 = await verify(adapter1, [dataUrl]);
    assert.strictEqual(r1.unchanged, null);

    const adapter2 = {
        gatherAnswerImages: async () => { throw new Error('不应被调用'); },
        getScoreInputs: () => [{ element: { value: '' } }]
    };
    const r2 = await verify(adapter2, [dataUrl]);
    assert.strictEqual(r2.unchanged, false);
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
