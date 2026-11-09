const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const test = require('node:test');

// 用 DOM 桩加载真实适配器代码（含教师实测故障形态回归，#306）
function loadAdapter(imgs, dom) {
    const sb = {
        console,
        location: { hash: '#/marking/grading?questionId=332228', hostname: 'yj.lcedu.net.cn' },
        getComputedStyle: (el) => el._cs || { display: 'block', visibility: 'visible', opacity: '1' },
        Event: class { constructor(t) { this.type = t; } },
        aiGradingState: { isRegrading: false },
    };
    sb.HTMLInputElement = {
        prototype: {
            get value() { return this._v; },
            set value(v) { this._v = String(v); },
        },
    };
    sb.document = {
        querySelectorAll: (sel) => (sel === 'img.el-image__inner' ? imgs : []),
        querySelector: (sel) => (dom && dom[sel] ? dom[sel] : null),
    };
    sb.window = sb;
    // 阻塞式等待用（#309）
    sb.setTimeout = setTimeout;
    sb.clearTimeout = clearTimeout;
    // 测试用小窗口（生产默认 25s，#309 阻塞式）
    sb.__AI_MARKER_WAIT_WINDOW_MS__ = 400;
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'adapters', 'huahanyun', 'selectors.js'), 'utf8'), sb);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'adapters', 'huahanyun', 'adapter.js'), 'utf8'), sb);
    return sb.__AI_MARKER_ADAPTER__;
}

function fakeImg(src, opts = {}) {
    return {
        tagName: 'IMG',
        className: 'el-image__inner',
        getAttribute: (k) => (k === 'src' ? src : null),
        getBoundingClientRect: () => ({ width: opts.w ?? 1000, height: opts.h ?? 400 }),
        checkVisibility: () => (opts.visible !== false),
        _cs: opts.cs,
    };
}

const OLD = 'https://obsyj.lcedu.net.cn/x/student/711074/h1/332228.png?X-Amz=old';
const NEW = 'https://obsyj.lcedu.net.cn/x/student/711075/h2/332228.png?X-Amz=new';
const OLD_JITTER = 'https://obsyj.lcedu.net.cn/x/student/711074/h1/332228.png?X-Amz=rotated';

test('#306 教师故障形态：残留隐藏旧图 + 新可见图 → 立即判换卷（旧实现恒 false 空转超时）', async () => {
    const a = loadAdapter([fakeImg(OLD, { visible: false }), fakeImg(NEW, { visible: true })]);
    assert.strictEqual(await a.waitForNextPaper(OLD), true, '旧图已隐藏残留不得拖死换卷判定');
});

test('#306 过渡期新旧都真可见 → 继续等（宁等勿错，防新旧混图喂 AI）', async () => {
    const a = loadAdapter([fakeImg(OLD, { visible: true }), fakeImg(NEW, { visible: true })]);
    assert.strictEqual(await a.waitForNextPaper(OLD), false, '旧图仍可见时不得判换卷');
});

test('#306 旧图退场后判换卷，且取图只含新卷', async () => {
    const a = loadAdapter([fakeImg(OLD, { visible: false }), fakeImg(NEW, { visible: true })]);
    const imgs = await a.gatherAnswerImages();
    assert.strictEqual(imgs.length, 1, '隐藏残留图不得进入取图');
    assert.ok(imgs[0].indexOf('711075') >= 0, '取图应为新考生卷');
});

test('#306 同考生签名抖动不误判、无图不误判', async () => {
    const a1 = loadAdapter([fakeImg(OLD_JITTER, { visible: true })]);
    assert.strictEqual(await a1.waitForNextPaper(OLD), false, '同考生换签名不得判换卷');
    const a2 = loadAdapter([]);
    assert.strictEqual(await a2.waitForNextPaper(OLD), false, '无图不得判换卷');
});

test('#306 兜底路径集合判定（非标准 URL 无考生号）', async () => {
    const oldU = 'https://cdn.example.com/pic/a1.png?s=1';
    const same = 'https://cdn.example.com/pic/a1.png?s=rotated';
    const other = 'https://cdn.example.com/pic/a2.png?s=2';
    const a1 = loadAdapter([fakeImg(same, { visible: true })]);
    assert.strictEqual(await a1.waitForNextPaper(oldU), false, '同路径换签名不得判换卷');
    const a2 = loadAdapter([fakeImg(oldU, { visible: false }), fakeImg(other, { visible: true })]);
    assert.strictEqual(await a2.waitForNextPaper(oldU), true, '旧路径退出可见集即判换卷');
});

test('#309 平台延迟换图（窗口内）→ 阻塞等到换卷（教师症状本体：瞬时检查必报超时）', async () => {
    const old = fakeImg(OLD, { visible: true });
    const imgs = [old];
    const a = loadAdapter(imgs);
    // 模拟平台在提交后约 150ms 才换图（实测"其实加载很快"）
    setTimeout(() => {
        old.checkVisibility = () => false;
        imgs.push(fakeImg(NEW, { visible: true }));
    }, 150);
    const t0 = Date.now();
    assert.strictEqual(await a.waitForNextPaper(OLD), true, '窗口内换图必须被等到，不得瞬时返回 false');
    assert.ok(Date.now() - t0 >= 100, '必须体现阻塞等待（瞬时检查正是每卷误报超时的根因）');
});

test('#309 窗口耗尽才返回 false（交 core 重试）', async () => {
    const a = loadAdapter([fakeImg(OLD, { visible: true })]);
    const t0 = Date.now();
    assert.strictEqual(await a.waitForNextPaper(OLD), false, '窗口内未换卷 → false');
    assert.ok(Date.now() - t0 >= 350, '应等满窗口而非瞬时返回');
});

test('#306 计算样式兜底过滤（无 checkVisibility 时 opacity/display/visibility）', async () => {
    const imgs = [
        fakeImg(OLD, { cs: { display: 'block', visibility: 'hidden', opacity: '1' } }),
        fakeImg(NEW, { cs: { display: 'block', visibility: 'visible', opacity: '1' } }),
    ];
    for (const it of imgs) { delete it.checkVisibility; }
    const a = loadAdapter(imgs);
    assert.strictEqual(await a.waitForNextPaper(OLD), true, 'visibility:hidden 残留图不得拖死判定');
});

// ---------- #312 审计A收口 ----------
function fakeInput() {
    return {
        tagName: 'INPUT',
        getAttribute: () => null,
        dispatchEvent: () => {},
        get value() { return this._v; },
        set value(v) { this._v = String(v); },
    };
}

test('#312 取图单考生一致性：混入他人考生图 → 整体拒绝（宁可不取）', async () => {
    const a = loadAdapter([fakeImg(OLD, { visible: true }), fakeImg(NEW, { visible: true })]);
    assert.strictEqual((await a.gatherAnswerImages()).length, 0, '考生号不一致必须拒绝取图');
});

test('#312 取图：同考生多图保留、非考生图剔除', async () => {
    const a = loadAdapter([
        fakeImg(OLD, { visible: true }),
        fakeImg('https://obsyj.lcedu.net.cn/x/student/711074/h2/332229.png', { visible: true }),
        fakeImg('https://obsyj.lcedu.net.cn/logo.png', { visible: true }),
    ]);
    const out = await a.gatherAnswerImages();
    assert.strictEqual(out.length, 2, '同考生多图保留，非考生图剔除');
});

test('#312 换卷正向证据：旧图隐藏但仅旁图可见 → 继续等（不得误判换卷）', async () => {
    const a = loadAdapter([fakeImg(OLD, { visible: false }), fakeImg('https://obsyj.lcedu.net.cn/logo.png', { visible: true, w: 300, h: 120 })]);
    assert.strictEqual(await a.waitForNextPaper(OLD), false, '无考生号新图出现前不得判换卷');
});

test('#312 fillScores 数值闸：NaN/负分拒绝且不写入，合法值通过', async () => {
    const input = fakeInput();
    const a = loadAdapter([], { '#compuinput': input });
    assert.strictEqual(a.fillScores([NaN]), false, 'NaN 必须拒绝');
    assert.strictEqual(a.fillScores([-1]), false, '负分必须拒绝');
    assert.strictEqual(input.value, undefined, '拒绝时不得写入');
    assert.strictEqual(a.fillScores([3.5]), true, '合法小数通过');
    assert.strictEqual(input.value, '3.5');
});

test('#312 isRegradeMode 委托核心回评态、isMarkingPage 同步快检存在', () => {
    const a = loadAdapter([], { '#compuinput': fakeInput(), 'button.submitscorebtn': { tagName: 'BUTTON' } });
    assert.strictEqual(a.isRegradeMode(), false, '核心未回评 → false');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'adapters', 'huahanyun', 'adapter.js'), 'utf8');
    assert.ok(/aiGradingState\.isRegrading/.test(src), 'isRegradeMode 必须读核心 isRegrading（不得恒 false 短路）');
    assert.strictEqual(typeof a.isMarkingPage, 'function', '必须提供 isMarkingPage 同步快检');
    assert.strictEqual(a.isMarkingPage(), true, '三特征页面上应为 true');
    const b = loadAdapter([]);
    assert.strictEqual(b.isMarkingPage(), false, '缺特征页面应为 false');
});
