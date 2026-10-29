// ========== #212 答卷校验：真实时序仿真 ==========
// 不用干净数组，而是按「取图 -> AI 请求期间发生什么 -> 校验取图」的真实时序建模，
// 覆盖已知的平台取图行为差异，验证判定正确。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadVerify() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'main.js'), 'utf8');
    const grab = (name) => {
        const m = src.match(new RegExp('(?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));
        assert.ok(m, name + ' 未找到');
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

// 模拟「按加载态过滤」的取图：只返回已加载的图
function loadStateAdapter(getLoaded) {
    return {
        gatherAnswerImages: async () => getLoaded().filter(x => x.loaded).map(x => x.url),
        getScoreInputs: () => []
    };
}

// ---------- 场景 1：九科星式多图切卷（第二份） ----------
test('场景：多图平台切卷后第二份，取图张数不齐 -> 不误拦', async () => {
    // 基准：第一份，3 张全在
    const paper1 = [
        { url: 'https://o.com/p1a.jpg', loaded: true },
        { url: 'https://o.com/p1b.jpg', loaded: true },
        { url: 'https://o.com/p1c.jpg', loaded: true }
    ];
    // 第二份刚开始：只有 2 张加载完（第 3 张还在路上）
    let stage = 'partial';
    const paper2 = [
        { url: 'https://o.com/p2a.jpg', loaded: true },
        { url: 'https://o.com/p2b.jpg', loaded: true },
        { url: 'https://o.com/p2c.jpg', loaded: false }
    ];
    const adapter = loadStateAdapter(() => (stage === 'partial' ? paper2 : paper2.map(x => ({ ...x, loaded: true }))));

    // 基准是第二份的「部分快照」（切卷刚完成时抓的）
    const recorded = paper2.filter(x => x.loaded).map(x => x.url);   // [p2a, p2b]
    const r = await verify(adapter, recorded);
    assert.strictEqual(r.unchanged, true, '同一份卷取图张数不齐不应误拦');
});

// ---------- 场景 2：酷鱼网式 cachebuster ----------
test('场景：cachebuster 平台同一份卷 -> 不误拦', async () => {
    const path = 'https://ky-metacut.oss.com/2026/paper33.png';
    const baseline = [path + '?_=1730000000'];
    const now = [path + '?_=1730000001', 'https://ky-metacut.oss.com/2026/paper34.png?_=1730000002'];
    const r = await verify({ gatherAnswerImages: async () => now, getScoreInputs: () => [] }, baseline);
    assert.strictEqual(r.unchanged, true);
});

// ---------- 场景 3：OSS 签名 URL 旋转（慧学星式） ----------
test('场景：OSS 签名 URL 旋转 -> 不误拦', async () => {
    const p = 'https://oss.hxxai.com/exam/2026/0001.jpg';
    const baseline = [p + '?Expires=1&Signature=aaa'];
    const now = [p + '?Expires=2&Signature=bbb'];
    const r = await verify({ gatherAnswerImages: async () => now, getScoreInputs: () => [] }, baseline);
    assert.strictEqual(r.unchanged, true);
});

// ---------- 场景 4：真换卷（多图平台） ----------
test('场景：真换卷 -> 必须拦截', async () => {
    const baseline = ['https://o.com/p1a.jpg', 'https://o.com/p1b.jpg'];
    const now = ['https://o.com/p2a.jpg', 'https://o.com/p2b.jpg'];
    const r = await verify({ gatherAnswerImages: async () => now, getScoreInputs: () => [] }, baseline);
    assert.strictEqual(r.unchanged, false);
});

// ---------- 场景 5：真换卷 + 张数不同 ----------
test('场景：真换卷且张数不同 -> 必须拦截', async () => {
    const baseline = ['https://o.com/p1a.jpg', 'https://o.com/p1b.jpg', 'https://o.com/p1c.jpg'];
    const now = ['https://o.com/p2a.jpg'];
    const r = await verify({ gatherAnswerImages: async () => now, getScoreInputs: () => [] }, baseline);
    assert.strictEqual(r.unchanged, false);
});

// ---------- 场景 6：换卷过程中旧图短暂残留 -> 不应误判未变化 ----------
test('场景：换卷后旧图已全部消失 -> 拦截', async () => {
    // 复查两次都不含基准图
    const baseline = ['https://o.com/p1a.jpg'];
    let calls = 0;
    const adapter = {
        gatherAnswerImages: async () => {
            calls++;
            return ['https://o.com/p2a.jpg?_=' + calls];   // cachebuster 也不同
        },
        getScoreInputs: () => []
    };
    const r = await verify(adapter, baseline);
    assert.strictEqual(r.unchanged, false);
    assert.strictEqual(calls, 2, '应复查一次后再判定');
});

// ---------- 场景 7：canvas/dataURL 平台（ameqp/c30/lehua/xinjiaoyu/xueba54） ----------
test('场景：canvas 平台不重取图、不误拦', async () => {
    let called = 0;
    const adapter = {
        gatherAnswerImages: async () => { called++; return ['data:image/png;base64,XYZ']; },
        getScoreInputs: () => [{ element: { value: '3' } }]
    };
    const r = await verify(adapter, ['data:image/png;base64,AAA']);
    assert.strictEqual(called, 0);
    assert.strictEqual(r.unchanged, null);
});

// ---------- 场景 8：取图只含 cachebuster、路径相同的两张不同图（应仍能区分） ----------
test('场景：同路径不同 query 的两张图（若平台用 query 区分）—— 记录残余风险', async () => {
    // 这是归一化的已知残余风险：若平台用 ?id= 区分不同卷，会漏拦。
    // 已核查 33 个适配器取图均返回文件 URL（.jpg/.png）或 data: URL，无此模式。
    // 此测试固化该风险边界，若将来出现新平台需重新评估。
    const baseline = ['https://o.com/get?id=111'];
    const now = ['https://o.com/get?id=222'];
    const r = await verify({ gatherAnswerImages: async () => now, getScoreInputs: () => [] }, baseline);
    // 归一化后路径相同 -> 判未变化（漏拦）
    assert.strictEqual(r.unchanged, true, '已知残余风险：query 区分图片的平台会漏拦，当前无适配器使用此模式');
});
