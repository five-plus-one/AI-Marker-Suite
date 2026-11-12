const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, waitingFixture } = require('./_platform-image-fixture');

const platforms = ['c30', 'haiyun', 'hanhan', 'haofenshuyize', 'haoyuejuan', 'huixuexing',
    'huiyuejuan', 'keewing', 'kuyuu', 'ruiya', 'wuyue', 'wuyuetong', 'xinkao', 'xinkao-2',
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

test('新教育作业: 同一学生的分数框清空时继续等待', async () => {
    const e = waitingFixture('xinjiaoyu');
    e.sb.window.location.pathname = '/teacher/grading_center/homework/grading_by_question/1';
    const query = e.sb.document.querySelector;
    e.sb.document.querySelector = selector => selector === '.studentSelectClass.newStudent' ? { textContent: '学生甲' } : query(selector);
    assert.equal(await e.run(e.adapter.waitForNextPaper(e.oldUrl)), false);
});

test('新教育作业: 平台学生切换后继续', async () => {
    const e = waitingFixture('xinjiaoyu'), student = { textContent: '学生甲' };
    e.sb.window.location.pathname = '/teacher/grading_center/homework/grading_by_question/1';
    const query = e.sb.document.querySelector;
    e.sb.document.querySelector = selector => selector === '.studentSelectClass.newStudent' ? student : query(selector);
    e.sb.setTimeout(() => { student.textContent = '学生乙'; }, 1500);
    assert.equal(await e.run(e.adapter.waitForNextPaper(e.oldUrl)), true);
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
