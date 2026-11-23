const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSrc } = require('./_adapter-matrix');
const { fixture, waitingFixture, URL_A, URL_B } = require('./_platform-image-fixture');

const platforms = ['c30', 'haiyun', 'hanhan', 'haofenshuyize', 'haoyuejuan', 'huixuexing',
    'huiyuejuan', 'keewing', 'kuyuu', 'ruiya', 'wuyuetong', 'xinkao', 'xinkao-2',
    'xinkao-campus', 'xueba54', 'yuejiaoxiangyun', 'yunyuejuan', 'xinjiaoyu'];

for (const dir of platforms) {
    test(`${dir}: 同卷评分框为空或被清空时等待，不触发新卷`, async () => {
        for (const change of ['already-empty', 'cleared', 'zero']) {
            const e = waitingFixture(dir);
            if (change === 'zero') e.input.value = '0';
            if (change === 'cleared') {
                e.input.value = '8'; e.sb.setTimeout(() => { e.input.value = ''; }, 1000);
            }
            assert.equal(await e.run(e.adapter.waitForNextPaper(e.oldUrl)), false, change);
        }
    });
    test(`${dir}: 新答卷资源或平台卷号就绪后继续`, async () => {
        const e = waitingFixture(dir);
        e.sb.setTimeout(() => e.next(), 1000);
        assert.equal(await e.run(e.adapter.waitForNextPaper(e.oldUrl)), true);
    });
}

test('C30: 同卷列表重新获取不作为换卷证据', async () => {
    const e = waitingFixture('c30');
    e.input.value = '8';
    e.sb.setTimeout(() => { e.adapter._state.latestApiTimestamp = e.sb.Date.now(); }, 1000);
    assert.equal(await e.run(e.adapter.waitForNextPaper(e.oldUrl)), false);
});

function xinjiaoyuHomeworkFixture() {
    const e = waitingFixture('xinjiaoyu');
    const { pathname } = e.sb.location;
    e.sb.location.pathname = pathname + 'teacher/grading_center/homework/2/class/3/grading_by_question/1';
    const imageA = 'data:image/png;base64,' + 'A'.repeat(6000);
    const imageB = 'data:image/png;base64,' + 'B'.repeat(6000);
    const canvas = {
        width: 2, height: 1, image: imageA, cleared: false,
        getClientRects: () => [{}],
        toDataURL() { return this.image; },
        getContext: () => ({
            getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, canvas.cleared ? 255 : 0]) }),
        }),
    };
    const label = { textContent: '1.学生甲' };
    const sidebar = { textContent: '学生甲' };
    e.input.closest = selector => selector === e.selectors.HOMEWORK_SCORE_ROW ? {
        querySelector: inner => inner === e.selectors.HOMEWORK_SCORE_STUDENT ? label : null,
    } : null;
    const query = e.sb.document.querySelector;
    e.sb.document.querySelector = selector => {
        if (selector === e.selectors.ANSWER_CANVAS) return canvas;
        if (selector === '.studentSelectClass.newStudent') return sidebar;
        return query(selector);
    };
    const submit = () => e.adapter.getPaperWaitKeys([canvas.image]);
    const wait = (paperWaitKeys, extra) => e.adapter.waitForNextPaper(imageA, { paperWaitKeys, ...extra });
    return { ...e, canvas, label, sidebar, imageA, imageB, submit, wait };
}

test('新教育作业: 侧栏分数变化、旧学生画布重绘及分数框清空均不触发换卷', async () => {
    const e = xinjiaoyuHomeworkFixture();
    const oldKeys = e.submit();
    e.sb.setTimeout(() => {
        e.sidebar.textContent = '学生甲 0分';
        e.input.value = '';
        e.canvas.image = e.imageB;
    }, 600);
    assert.equal(await e.run(e.wait(oldKeys)), false);
});

test('新教育作业: 换卷早于等待且侧栏未更新时，等待新学生的画布实际绘制完成', async () => {
    const e = xinjiaoyuHomeworkFixture();
    const oldKeys = e.submit();
    e.label.textContent = '1.学生乙';
    e.sb.setTimeout(() => {
        e.canvas.image = e.imageB.replaceAll('B', 'C');
        e.canvas.cleared = true;
    }, 1200);
    e.sb.setTimeout(() => {
        e.canvas.image = e.imageB;
        e.canvas.cleared = false;
    }, 2400);
    const start = e.sb.Date.now();
    assert.equal(await e.run(e.wait(oldKeys)), true);
    assert.ok(e.sb.Date.now() - start >= 2700);
    assert.deepEqual(Array.from(await e.adapter.gatherAnswerImages()), [e.imageB]);
});

test('新教育作业: 已经换卷时沿用提交前基线，重复等待不把新学生当旧学生', async () => {
    const e = xinjiaoyuHomeworkFixture();
    const oldKeys = e.submit();
    e.label.textContent = '1.学生乙';
    e.canvas.image = e.imageB;
    assert.equal(await e.run(e.wait(oldKeys)), true);
    assert.equal(await e.run(e.wait(oldKeys)), true);
});

test('新教育作业: 等待支持中止并且不跨题确认下一卷', async () => {
    const e = xinjiaoyuHomeworkFixture();
    const oldKeys = e.submit();
    const controller = new AbortController();
    e.sb.setTimeout(() => controller.abort(), 500);
    const start = e.sb.Date.now();
    assert.equal(await e.run(e.wait(oldKeys, { signal: controller.signal })), false);
    assert.ok(e.sb.Date.now() - start <= 700);

    const taskId = e.adapter.getTaskIdentifier();
    e.sb.location.pathname = e.sb.location.pathname.replace(/1$/, '4');
    e.label.textContent = '1.学生乙';
    e.canvas.image = e.imageB;
    assert.equal(await e.run(e.wait(oldKeys, { taskId })), false);
});

test('新教育作业: 按打分栏匹配 API 图片和题号，并隔离不同页面与同名学生', async () => {
    const e = xinjiaoyuHomeworkFixture();
    vm.runInContext(readSrc('src/core/runtime.js'), e.sb);
    e.input.getClientRects = () => [{}];
    e.input.getAttribute = () => null;
    e.canvas.cleared = true;
    const questionContext = () => e.sb.readGradingQuestionContext(e.adapter);
    const response = new e.sb.XMLHttpRequest();
    response.addEventListener = (_, callback) => { response.loaded = callback; };
    response.open('GET', '/server_homework/homework/answer/sheet/review/progress');
    response.send();
    const sheet = (studentName, questionId, rawScan) => ({
        student: { studentName }, questionAnswers: [{ questionId, rawScan, questionNumber: 9, maxScore: 6 }],
    });
    response.responseText = JSON.stringify({ code: 200, data: {
        answerSheets: [sheet('学生甲', '1', URL_A), sheet('学生乙', 1, URL_B),
            sheet('同名', 1, URL_A), sheet('同名', 1, URL_B)],
    } });
    response.loaded();
    assert.deepEqual(Array.from(await e.adapter.gatherAnswerImages()), [URL_A]);
    const context = questionContext();
    assert.equal(context.question, '9');
    assert.equal(context.units[0].maxScore, 6);
    const oldKeys = e.adapter.getPaperWaitKeys([URL_A]);
    e.label.textContent = '1.学生乙';
    assert.equal(await e.run(e.adapter.waitForNextPaper(URL_A, { paperWaitKeys: oldKeys })), true);
    assert.deepEqual(Array.from(await e.adapter.gatherAnswerImages()), [URL_B]);
    assert.equal(questionContext().key, context.key);
    e.label.textContent = '1.同名';
    assert.deepEqual(Array.from(await e.adapter.gatherAnswerImages()), []);
    assert.equal(questionContext(), null);
    e.label.textContent = '1.学生乙';
    e.sb.location.search = '?isReviewed=true';
    assert.deepEqual(Array.from(await e.adapter.gatherAnswerImages()), []);
    assert.equal(questionContext(), null);
    e.sb.location.search = '';
    e.sb.location.pathname = e.sb.location.pathname.replace(/1$/, '4');
    assert.deepEqual(Array.from(await e.adapter.gatherAnswerImages()), []);
    assert.equal(questionContext(), null);
});

test('慧阅卷: iframe 离开后按时结束等待', async () => {
    const e = waitingFixture('huiyuejuan');
    e.adapter._getFrameDoc = () => null;
    assert.equal(await e.run(e.adapter.waitForNextPaper(e.oldUrl)), false);
});

test('科耘: SVG 裁切参数支持等价 URL 编码及相对地址', async () => {
    for (const raw of ['https://images.example/answer.jpg?x-oss-process=image/crop,w_800',
        'https://images.example/answer.jpg?x-oss-process=image%2Fcrop%2Cw_800',
        '/answer.jpg?x-oss-process=image%2Fcrop%2Cw_800']) {
        const e = fixture('keewing');
        e.sb.document.querySelectorAll = selector => selector === e.selectors.SVG_IMAGE ? [{getAttribute: () => raw}] : [];
        assert.deepEqual(Array.from(await e.run(e.adapter.gatherAnswerImages())), [new URL(raw, e.sb.location.href).href]);
    }
});

test('科耘: 相对 SVG 资源在换卷后继续', async () => {
    const e = waitingFixture('keewing');
    e.input.value = '8';
    e.image.src = '/answer/paper-a.jpg?x-oss-process=image%2Fcrop%2Cw_800';
    e.sb.setTimeout(() => { e.image.src = e.image.src.replace('paper-a', 'paper-b'); }, 1000);
    assert.equal(await e.run(e.adapter.waitForNextPaper(new URL(e.image.src,e.sb.location.href).href)), true);
});

test('九五优评: iframe 内相对、协议相对、绝对图片地址均按浏览器解析结果取图', async () => {
    for (const raw of ['/answer/paper-a.jpg', '../answer/paper-a.jpg', '//images.example/answer.jpg', 'https://images.example/answer.jpg']) {
        const e = fixture('jiuwuyouping');
        const src = new URL(raw, 'https://s1.timesphoenix.com:88/web/mark/sjpy/view.jsp').href;
        const image = { getAttribute: () => raw, src };
        e.adapter._getFrameDoc = () => ({ querySelectorAll: () => [image] });
        assert.deepEqual(Array.from(await e.run(e.adapter.gatherAnswerImages())), [src], raw);
    }
});

test('九五优评: 空资源和非 HTTP 图片不参与取图', async () => {
    const e = fixture('jiuwuyouping');
    e.adapter._getFrameDoc = () => ({ querySelectorAll: () => [
        { getAttribute: () => '', src: 'https://s1.timesphoenix.com/current-page' },
        { getAttribute: () => 'data:image/png;base64,AA==', src: 'data:image/png;base64,AA==' },
    ] });
    assert.deepEqual(Array.from(await e.run(e.adapter.gatherAnswerImages())), []);
});
