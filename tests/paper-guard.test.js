// ========== #212 答卷一致性校验：回归测试 ==========
// 目标：证明
//   1. 答卷未变化时校验放行（绝大多数情况，对所有适配器零影响）
//   2. 任何异常/不可判定都放行并告警，绝不阻塞正常批改
//   3. 只有明确证据（图片变化）才判定为「已切换」
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadVerify() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'main.js'), 'utf8');
    // scoreInputsCleared 被 verifyPaperUnchanged 调用，必须一起提取进沙箱
    const helper = src.match(/async function scoreInputsCleared\(adapter\) \{[\s\S]*?\n\}/);
    const main = src.match(/async function verifyPaperUnchanged\(adapter, recordedUrls\) \{[\s\S]*?\n\}/);
    assert.ok(main, 'verifyPaperUnchanged 函数未找到');
    assert.ok(helper, 'scoreInputsCleared 函数未找到');
    const sandbox = { console: { warn: () => {}, log: () => {} }, String, Array, Promise };
    vm.createContext(sandbox);
    vm.runInContext(helper[0] + '\n' + main[0] + '\n;__v = verifyPaperUnchanged;', sandbox);
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

test('首图变化时判定为已切换', async () => {
    const r = await verify(fakeAdapter(['https://x.com/NEW.png']), ['https://x.com/old.png']);
    assert.strictEqual(r.unchanged, false);
    assert.ok(r.reason.includes('变化'));
});

test('首图变化且输入框已清空时给出强证据文案', async () => {
    const adapter = {
        gatherAnswerImages: async () => ['https://x.com/NEW.png'],
        getScoreInputs: () => [{ element: { value: '' } }, { element: { value: '' } }]
    };
    const r = await verify(adapter, ['https://x.com/old.png']);
    assert.strictEqual(r.unchanged, false);
    assert.ok(r.reason.includes('清空'), '应提到输入框清空，实际: ' + r.reason);
});

test('适配器不支持 gatherAnswerImages 时无法判定（放行）', async () => {
    const r = await verify({}, ['https://x.com/a.png']);
    assert.strictEqual(r.unchanged, null);
});

test('无基准图片时无法判定（放行）', async () => {
    const r = await verify(fakeAdapter(['https://x.com/a.png']), []);
    assert.strictEqual(r.unchanged, null);
});

test('重新获取为空时无法判定（放行）', async () => {
    const r = await verify(fakeAdapter([]), ['https://x.com/a.png']);
    assert.strictEqual(r.unchanged, null);
});

test('gatherAnswerImages 抛异常时无法判定（放行）', async () => {
    const adapter = { gatherAnswerImages: async () => { throw new Error('boom'); } };
    const r = await verify(adapter, ['https://x.com/a.png']);
    assert.strictEqual(r.unchanged, null);
    assert.ok(r.reason.includes('boom'));
});

test('getScoreInputs 抛异常不影响主判（仍按图片变化判定）', async () => {
    const adapter = {
        gatherAnswerImages: async () => ['https://x.com/NEW.png'],
        getScoreInputs: () => { throw new Error('x'); }
    };
    const r = await verify(adapter, ['https://x.com/old.png']);
    assert.strictEqual(r.unchanged, false);
});

test('张数变化视为已切换', async () => {
    const r = await verify(fakeAdapter(['https://x.com/a.png']), ['https://x.com/a.png', 'https://x.com/b.png']);
    assert.strictEqual(r.unchanged, false);
});

test('相同张数相同首图视为未变化（即使后续 URL 不同）', async () => {
    const r = await verify(
        fakeAdapter(['https://x.com/a.png', 'https://x.com/OTHER.png']),
        ['https://x.com/a.png', 'https://x.com/b.png']
    );
    assert.strictEqual(r.unchanged, true);
});

test('Canvas 型平台（data: URL）跳过图片比对，按输入框信号判定', async () => {
    const dataUrl = 'data:image/png;base64,AAAA';
    // 输入框未清空 -> 无法判定，放行（不误判、不加耗时）
    const adapter1 = {
        gatherAnswerImages: async () => { throw new Error('不应被调用'); },
        getScoreInputs: () => [{ element: { value: '5' } }]
    };
    const r1 = await verify(adapter1, [dataUrl]);
    assert.strictEqual(r1.unchanged, null);

    // 输入框已清空 -> 判定已切换
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
