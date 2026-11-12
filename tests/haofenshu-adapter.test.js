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

function loadAdapter(images, mode = 'normal', nativeTask) {
    const root = nativeTask ? { __vue__: nativeTask } : null;
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        location: { hostname: 'yue.haofenshu.com', pathname: '/minions/subject/10500001/mark/1/normal/0' },
        aiGradingState: { gradingMode: mode },
        document: {
            querySelector: selector => selector === '#subjectmark_content_img' ? root : null,
            querySelectorAll: selector => selector.includes('.images-box svg image.svg-image') ? images : [],
        },
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

// 脱敏现场：同一 taskKey 的 blockImg 含两张不同图片序号的裁剪图，pos.i 为 0、1。
const pageOne = cut('000231').replace('AABBCCDD_10_20_1000_1030.jpg', 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE_18_1900_1514_211.png');
const pageTwo = cut('000415').replace('AABBCCDD_10_20_1000_1030.jpg', 'FFFFFFFF-BBBB-CCCC-DDDD-EEEEEEEEEEEE_18_100_1494_673.png');

test('第30题四给分项的两张原生题块图：不同图片序号属于同一任务，三模式均完整取图', async () => {
    for (const mode of ['normal', 'trial', 'unattended']) {
        const task = { taskKey: 'fixture-current-task', imgUrl: [pageOne, pageTwo] };
        const adapter = loadAdapter([image(pageOne), image(pageTwo)], mode, task);
        assert.deepEqual(Array.from(await adapter.gatherAnswerImages()), [pageOne, pageTwo]);
        assert.equal(adapter.getPaperIdentity(), JSON.stringify([adapter.getTaskIdentifier(), task.taskKey]));
    }
});

test('当前任务只读图片容器的父组件，不读取预加载任务', async () => {
    const task = { taskKey: 'current', imgUrl: [pageOne, pageTwo] };
    const adapter = loadAdapter([image(pageOne), image(pageTwo)], 'normal', { $parent: task });
    assert.equal((await adapter.gatherAnswerImages()).length, 2);
});

test('组合题缺图、顺序不符、混入旧图、原生任务未就绪时整体等待', async () => {
    const cases = [
        [[image(pageOne)], { taskKey: 'current', imgUrl: [pageOne, pageTwo] }],
        [[image(pageOne), image(pageTwo), image(raw())], { taskKey: 'current', imgUrl: [pageOne, pageTwo] }],
        [[image(pageTwo), image(pageOne)], { taskKey: 'current', imgUrl: [pageOne, pageTwo] }],
        [[image(pageOne), image(pageTwo)], { taskKey: '', imgUrl: [pageOne, pageTwo] }],
        [[image(pageOne)], { taskKey: 'current', imgUrl: '' }],
        [[image(pageOne)], { taskKey: 'current', imgUrl: [pageOne, 'javascript:invalid'] }],
        [[image(pageOne)], { taskKey: 'current', imgUrl: [pageOne, pageOne] }],
        [[image(pageOne), image(pageTwo, { visible: false })], { taskKey: 'current', imgUrl: [pageOne, pageTwo] }],
    ];
    for (const [images, task] of cases) {
        const adapter = loadAdapter(images, 'normal', task);
        assert.deepEqual(Array.from(await adapter.gatherAnswerImages()), []);
        assert.equal(adapter.getPaperIdentity(), null);
    }
});

test('原生任务签名更新保持身份，完整新任务加载后才能进入下一份', async () => {
    const images = [image(pageOne), image(pageTwo)];
    const task = { taskKey: 'current', imgUrl: [pageOne, pageTwo] };
    const adapter = loadAdapter(images, 'unattended', task);
    await adapter.gatherAnswerImages();
    const identity = adapter.getPaperIdentity();
    images.splice(0, 2, image(pageOne.replace('fixture', 'rotated')), image(pageTwo.replace('fixture', 'rotated')));
    assert.equal(adapter.getPaperIdentity(), identity);
    assert.equal(await adapter.waitForNextPaper(pageOne), false);

    // 任务已切换但图未换齐，或只剩旧任务的一部分，均不能放行。
    task.taskKey = 'next';
    const nextOne = cut('000232'), nextTwo = cut('000416');
    task.imgUrl = [nextOne, nextTwo];
    images.splice(0, 2, image(nextOne), image(pageTwo));
    assert.equal(await adapter.waitForNextPaper(pageOne), false);
    images.splice(0, 2, image(nextOne));
    assert.equal(await adapter.waitForNextPaper(pageOne), false);
    images.push(image(nextTwo));
    assert.notEqual(adapter.getPaperIdentity(), identity);
    assert.equal(await adapter.waitForNextPaper(pageOne), true);
});

test('原生任务变化但保留旧图时，不将任务字段单独作为换卷成功', async () => {
    const task = { taskKey: 'current', imgUrl: [pageOne, pageTwo] };
    const adapter = loadAdapter([image(pageOne), image(pageTwo)], 'unattended', task);
    await adapter.gatherAnswerImages();
    task.taskKey = 'next';
    assert.equal(await adapter.waitForNextPaper(pageOne), false);
});

test('取图后任务变化或缺图时，填分与提交均显式失败', async () => {
    const images = [image(pageOne), image(pageTwo)];
    const task = { taskKey: 'current', imgUrl: [pageOne, pageTwo] };
    const adapter = loadAdapter(images, 'normal', task);
    await adapter.gatherAnswerImages();
    assert.equal(adapter._collectedTaskIsCurrent(), true);
    task.taskKey = 'next';
    assert.equal(adapter.fillScores([1, 2, 1, 3]), false);
    assert.equal(adapter.submitGrade(), false);
    task.taskKey = 'current';
    images.pop();
    assert.equal(adapter.fillScores([1, 2, 1, 3]), false);
    assert.equal(adapter.submitGrade(), false);
});

test('原生组件重建期间不降级成图片序号，恢复后仍为原任务', async () => {
    const task = { taskKey: 'current', imgUrl: [pageOne] };
    const adapter = loadAdapter([image(pageOne)], 'normal', task);
    await adapter.gatherAnswerImages();
    const identity = adapter.getPaperIdentity();
    delete task.taskKey;
    delete task.imgUrl;
    assert.equal(adapter.getPaperIdentity(), null);
    assert.deepEqual(Array.from(await adapter.gatherAnswerImages()), []);
    assert.equal(adapter.fillScores([1]), false);
    Object.assign(task, { taskKey: 'current', imgUrl: [pageOne] });
    assert.equal(adapter.getPaperIdentity(), identity);
});

test('填分前取消原生自动提交；平台未成功关闭时拒绝继续', () => {
    for (const stuck of [false, true]) {
        const root = { checked: true, click() { if (!stuck) this.checked = false; } };
        // 保留独立的 DOM 探针，验证实际 checkbox 点击及关闭结果。
        const sandbox = { console: { warn() {}, error() {} }, window: { location: { hostname: 'yue.haofenshu.com', pathname: '/minions/' } },
            document: { querySelector: () => root } };
        vm.createContext(sandbox);
        for (const file of ['selectors.js', 'adapter.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/adapters/haofenshu', file), 'utf8'), sandbox);
        assert.equal(sandbox.window.__AI_MARKER_ADAPTER__.prepareGrading(), !stuck);
        assert.equal(root.checked, stuck);
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
