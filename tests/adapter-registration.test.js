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
    const adDir = path.join(__dirname, '..', 'src', 'adapters');
    const dirs = fs.readdirSync(adDir).filter(d => fs.existsSync(path.join(adDir, d, 'adapter.js')));
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
