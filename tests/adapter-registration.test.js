const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const test = require('node:test');

// ---------- #324 P0 回归：适配器注册守卫 ----------
// 历史事故：huahanyun 无条件注册且在 bundle 末位，劫持所有平台页面（好分数等识别错平台）。
// 本测试 VM 加载**全部**适配器：当没有任何 shouldInitialize 命中时，注册槽必须保持为空。

function makeStub(hostname, hash, dom) {
    const sb = {
        console,
        location: { hostname, hash, pathname: '/', href: 'https://' + hostname + '/' + hash },
        getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
        Event: class { constructor(t) { this.type = t; } },
        setTimeout, clearTimeout, setInterval, clearInterval,
        navigator: { userAgent: 'test' },
        // —— strict-a.md 附录 D.1 补桩：缺桩时 c30/guangda/guangda-2/jiukexing-homework
        // 模块级代码（XHR 拦截安装/探测）抛错中断在注册行之前，守卫断言对它们恒真失明 ——
        XMLHttpRequest: class {
            open() {} send() {} setRequestHeader() {} abort() {}
            addEventListener() {} removeEventListener() {}
            upload = {}; readyState = 0; status = 0; responseText = '';
        },
        fetch: () => new Promise(() => {}),
        performance: { getEntriesByType: () => [], now: () => 0 },
        sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
        requestAnimationFrame: () => 0,
        cancelAnimationFrame: () => {},
        CSS: { supports: () => true },
        MutationObserver: class { constructor() {} observe() {} disconnect() {} takeRecords() { return []; } },
        addEventListener: () => {}, removeEventListener: () => {},
    };
    sb.HTMLInputElement = {
        prototype: {
            get value() { return this._v; },
            set value(v) { this._v = String(v); },
        },
    };
    sb.document = {
        querySelector: (sel) => (dom && dom[sel] ? dom[sel] : null),
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, getContext: () => ({}) }),
        createElementNS: () => ({ style: {}, setAttribute() {}, appendChild() {}, getContext: () => ({}) }),
        body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {} } },
        documentElement: { classList: { add: () => {}, remove: () => {} } },
    };
    sb.window = sb;
    sb.top = sb;
    sb.self = sb;
    sb.unsafeWindow = sb;
    sb.GM_info = { script: { version: 'test' } };
    return sb;
}

function loadAllAdapters(sb) {
    // strict-a.md 附录 D.3：按 build.js adapterModules 顺序加载（对齐生产 last-wins 语义；
    // 字母序下 yunyuejuan 赢、生产序下 xinkao-campus 赢——赢家类断言必须跟生产序一致）
    const adDir = path.join(__dirname, '..', 'src', 'adapters');
    const build = fs.readFileSync(path.join(__dirname, '..', 'build.js'), 'utf8');
    const order = [...new Set([...build.matchAll(/'adapters\/([a-z0-9-]+)\/(?:selectors|adapter)\.js'/g)].map(m => m[1]))];
    const unbundled = fs.readdirSync(adDir)
        .filter(d => fs.existsSync(path.join(adDir, d, 'adapter.js')) && !order.includes(d)).sort();
    const dirs = order.concat(unbundled).filter(d => fs.existsSync(path.join(adDir, d, 'adapter.js')));
    vm.createContext(sb);
    const errors = [];
    for (const d of dirs) {
        try {
            const selPath = path.join(adDir, d, 'selectors.js');
            if (fs.existsSync(selPath)) vm.runInContext(fs.readFileSync(selPath, 'utf8'), sb, { filename: d + '/selectors.js' });
            vm.runInContext(fs.readFileSync(path.join(adDir, d, 'adapter.js'), 'utf8'), sb, { filename: d + '/adapter.js' });
        } catch (e) {
            errors.push(d + ': ' + e.message);
        }
    }
    return { count: dirs.length, errors };
}

test('#324 全量适配器无守卫注册必红：shouldInitialize 全不命中时注册槽必须为空', () => {
    const sb = makeStub('example.com', '');
    const { count, errors } = loadAllAdapters(sb);
    assert.ok(count >= 39, '适配器目录数异常: ' + count);
    assert.strictEqual(sb.__AI_MARKER_ADAPTER__, undefined,
        '存在无守卫注册的适配器（会劫持所有平台页面）: ' +
        (sb.__AI_MARKER_ADAPTER__ && sb.__AI_MARKER_ADAPTER__.name) +
        ' | 加载错误: ' + errors.join('; '));
});

test('#324 守卫不误伤：目标平台命中时正常注册（华翰云样例）', () => {
    const dom = {
        '#compuinput': { tagName: 'INPUT', getAttribute: () => null, dispatchEvent: () => {} },
        'button.submitscorebtn': { tagName: 'BUTTON', disabled: false, getAttribute: () => null, click: () => {} },
    };
    const sb = makeStub('yj.lcedu.net.cn', '#/marking/grading?questionId=332228', dom);
    loadAllAdapters(sb);
    assert.ok(sb.__AI_MARKER_ADAPTER__, '目标平台应注册适配器');
    assert.strictEqual(sb.__AI_MARKER_ADAPTER__.name, '云阅卷(华翰云)', '应由华翰云适配器接管');
});

test('#324 无关域名不得误注册华翰云（好分数页实测形态回归）', () => {
    const sb = makeStub('yue.haofenshu.com', '');
    loadAllAdapters(sb);
    const a = sb.__AI_MARKER_ADAPTER__;
    assert.ok(!a || a.name !== '云阅卷(华翰云)', '好分数页面不得被华翰云适配器接管');
});

// ========== strict-a.md 附录 D 落地：零加载错误 + 全队自注册矩阵 ==========
const M = require('./_adapter-matrix.js');

// D.2（核心）：加载错误必须是失败条件——抛错=注册行未执行=守卫断言恒真失明
test('D.2 全量适配器零错误求值（抛错即注册失明，不得静默吞错）', () => {
    const sb = makeStub('example.com', '');
    const { errors } = loadAllAdapters(sb);
    assert.deepStrictEqual(errors, [],
        '适配器加载抛错=该适配器注册守卫从未执行，"无守卫必红"对其失明: ' + errors.join(' | '));
});

// D.4 自注册矩阵（单适配器隔离，防竞争干扰归因）：
//   每个适配器 ① 自家平台形态必注册 ② 近似域名/缺条件/兄弟签名形态必不注册
for (const a of M.ADAPTERS) {
    test(`D.4 自注册矩阵：${a.dir}（${a.name}）自家命中 + 近似不命中`, () => {
        const own = M.makeStub(a.own);
        const r = M.loadOne(own, a.dir);
        assert.deepStrictEqual(r.errors, [], '加载错误: ' + r.errors.join(' | '));
        assert.ok(r.winner, a.dir + ' 自家形态必须注册');
        if (a.id) assert.strictEqual(r.winner.id, a.id, a.dir + ' 注册身份不符');
        else assert.strictEqual(r.winner.name, a.name, a.dir + ' 注册身份不符');

        for (const n of a.near) {
            const sb2 = M.makeStub(n.form);
            const r2 = M.loadOne(sb2, a.dir);
            assert.deepStrictEqual(r2.errors, [], '加载错误: ' + r2.errors.join(' | '));
            assert.strictEqual(r2.winner, null,
                `${a.dir} 不得在近似/缺条件形态注册（${n.label}）`);
        }
    });
}

// D.4 负例（R3 已修回归）：huahanyun 路由收口为 #/marking/grading(\?|$)——
// '​#/marking/gradingList/list' 含旧子串但不得再被认领（kzedu 坑防回退）
test('D.4 负例（R3 已修回归）：gradingList 路由不得被 huahanyun 认领', () => {
    const sb = M.makeStub({ host: 'yj.lcedu.net.cn', path: '/', hash: '#/marking/gradingList/list' });
    const r = M.loadOne(sb, 'huahanyun');
    assert.strictEqual(r.winner, null, '路由收口后 gradingList 子串页不得注册（若回退为 indexOf 子串匹配此用例必红）');
});
