const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

const raw = (sheet = '000117', crop = '10', signature = 'one') =>
    `https://yj-oss.yunxiao.com/v1/baidu-raw/10500001/0/10/${sheet}/AABBCCDD.jpg%40c_0%2Cx_${crop}%2Cy_20%2Cw_1000%2Ch_1030%7Cf_jpg%2Cq_80?authorization=${signature}`;
const cut = (sheet = '000117') =>
    `https://yj-oss.yunxiao.com/v1/baidu-raw/cutimage/10500001/0/10/${sheet}/AABBCCDD_10_20_1000_1030.jpg?authorization=fixture`;

function image(url, options = {}) {
    return {
        getAttribute: name => name === 'xlink:href' ? url : null,
        getBoundingClientRect: () => ({ width: options.width ?? 1000, height: options.height ?? 1030 }),
        checkVisibility: () => options.visible !== false,
        style: options.style || { display: 'inline', visibility: 'visible', opacity: '1' },
    };
}

function loadAdapter(images, mode = 'normal') {
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        location: { hostname: 'yue.haofenshu.com', pathname: '/minions/subject/10500001/mark/1/normal/0' },
        aiGradingState: { gradingMode: mode },
        document: { querySelectorAll: selector => selector.includes('.images-box svg image.svg-image') ? images : [] },
        getComputedStyle: element => element.style,
        __AI_MARKER_WAIT_WINDOW_MS__: 60,
        setTimeout,
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    for (const file of ['selectors.js', 'adapter.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/adapters/haofenshu', file), 'utf8'), sandbox);
    }
    return sandbox.__AI_MARKER_ADAPTER__;
}

test('好分数现场格式：原始裁剪图在普通、试改和无人模式均可取图', async () => {
    for (const mode of ['normal', 'trial', 'unattended']) {
        const adapter = loadAdapter([image(raw())], mode);
        assert.deepEqual(Array.from(await adapter.gatherAnswerImages()), [raw()], mode);
        assert.equal(adapter.getPaperIdentity(), '10500001|0|000117');
    }
});

test('同卷原始裁剪图和 cutimage 题块图共享身份并保留作答图片', async () => {
    const adapter = loadAdapter([image(raw()), image(cut())]);
    assert.equal(adapter._sheetIdentity(raw()), adapter._sheetIdentity(cut()));
    assert.deepEqual(Array.from(await adapter.gatherAnswerImages()), [raw(), cut()]);
    assert.equal(adapter.getPaperIdentity(), '10500001|0|000117');
});

test('签名与裁剪参数更新保持同卷，等待下一份继续等待', async () => {
    const updated = raw('000117', '30', 'two');
    const adapter = loadAdapter([image(updated)]);
    assert.equal(adapter._sheetIdentity(raw()), adapter._sheetIdentity(updated));
    assert.equal(await adapter.waitForNextPaper(raw()), false);
});

test('原始裁剪图的科目、考试或答题卡序号改变可识别为新卷', async () => {
    for (const next of [raw('000118'), raw().replace('/10500001/', '/10500002/'), raw().replace('/0/10/', '/1/10/')]) {
        const adapter = loadAdapter([image(next)]);
        assert.notEqual(adapter._sheetIdentity(raw()), adapter._sheetIdentity(next));
        assert.equal(await adapter.waitForNextPaper(raw()), true);
    }
    const otherPart = raw().replace('/0/10/', '/0/11/');
    assert.equal(loadAdapter([])._sheetIdentity(raw()), loadAdapter([])._sheetIdentity(otherPart));
});

test('混入另一份可见答卷时暂停取图，旧卷仍可见时继续等待', async () => {
    const adapter = loadAdapter([image(raw()), image(cut('000118'))]);
    assert.deepEqual(Array.from(await adapter.gatherAnswerImages()), []);
    assert.equal(await adapter.waitForNextPaper(raw()), false);
});

test('隐藏旧卷、裁剪残片与旁图不进入新卷图片集合', async () => {
    const next = raw('000118');
    const adapter = loadAdapter([
        image(raw(), { visible: false }), image(next), image(cut('000119'), { height: 4 }),
        image('https://yj-oss.yunxiao.com/logo.png'),
    ]);
    assert.deepEqual(Array.from(await adapter.gatherAnswerImages()), [next]);
    assert.equal(adapter.getPaperIdentity(), '10500001|0|000118');
    assert.equal(await adapter.waitForNextPaper(raw()), true);
});

test('无可用答卷或缺少路径身份时继续等待', async () => {
    for (const images of [[], [image('https://yj-oss.yunxiao.com/logo.png')], [image(raw('000118'), { visible: false })]]) {
        const adapter = loadAdapter(images);
        assert.deepEqual(Array.from(await adapter.gatherAnswerImages()), []);
        assert.equal(await adapter.waitForNextPaper(raw()), false);
    }
    assert.equal(await loadAdapter([image(raw())]).waitForNextPaper(''), false);
    assert.equal(loadAdapter([image('https://yj-oss.yunxiao.com/logo.png')]).getPaperIdentity(), null);
    assert.equal(loadAdapter([])._sheetKey('https://yj-oss.yunxiao.com/logo.png?next=/cutimage/1/2/3/4/a.jpg'), null);
});

test('浏览器无 checkVisibility 时使用样式过滤隐藏旧卷', async () => {
    const old = image(raw(), { style: { display: 'inline', visibility: 'hidden', opacity: '1' } });
    delete old.checkVisibility;
    const adapter = loadAdapter([old, image(raw('000118'))]);
    assert.deepEqual(Array.from(await adapter.gatherAnswerImages()), [raw('000118')]);
});
