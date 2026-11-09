const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const test = require('node:test');

// 用 DOM 桩加载真实适配器代码（含教师实测故障形态回归，#306）
function loadAdapter(imgs) {
    const sb = {
        console,
        location: { hash: '#/marking/grading?questionId=332228', hostname: 'yj.lcedu.net.cn' },
        getComputedStyle: (el) => el._cs || { display: 'block', visibility: 'visible', opacity: '1' },
        Event: class { constructor(t) { this.type = t; } },
    };
    sb.HTMLInputElement = {
        prototype: {
            get value() { return this._v; },
            set value(v) { this._v = String(v); },
        },
    };
    sb.document = {
        querySelectorAll: (sel) => (sel === 'img.el-image__inner' ? imgs : []),
        querySelector: () => null,
    };
    sb.window = sb;
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

test('#306 计算样式兜底过滤（无 checkVisibility 时 opacity/display/visibility）', async () => {
    const imgs = [
        fakeImg(OLD, { cs: { display: 'block', visibility: 'hidden', opacity: '1' } }),
        fakeImg(NEW, { cs: { display: 'block', visibility: 'visible', opacity: '1' } }),
    ];
    for (const it of imgs) { delete it.checkVisibility; }
    const a = loadAdapter(imgs);
    assert.strictEqual(await a.waitForNextPaper(OLD), true, 'visibility:hidden 残留图不得拖死判定');
});
