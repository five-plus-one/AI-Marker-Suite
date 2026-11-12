const test = require('node:test');
const assert = require('node:assert/strict');
const { env, load, vm } = require('./_audit-harness');

function fixture({ iframe = false, oldUI = false } = {}) {
    const e = env();
    e.sb.location.href = 'https://www.zhixue.com/webmarking/marking/personal/';
    let images = [image('https://oss.test/paper-A.png?Expires=1&Signature=old')];
    const score = { value: '' };
    const doc = { querySelectorAll(selector) { return selector === (oldUI ? 'div[name="topicImg"] img' : '.enhance-definition-bright') ? images : []; },
        querySelector(selector) { return selector.includes('input') || selector.startsWith('#txt_') ? score : null; } };
    const mainDoc = { querySelectorAll: iframe ? () => [] : doc.querySelectorAll,
        querySelector: selector => selector === 'iframe' ? (iframe ? { contentDocument: doc } : null) : doc.querySelector(selector) };
    e.sb.document = mainDoc; load(e, 'src/adapters/zhixue/selectors.js'); load(e, 'src/adapters/zhixue/adapter.js');
    const a = vm.runInContext('ZhixueAdapter', e.sb); a.getTaskIdentifier = () => 'task';
    const tick = async (count = 1) => { for (let i=0;i<count;i++) { for (const fn of [...e.intervals.values()]) fn(); await Promise.resolve(); } };
    return { e, a, score, tick, setImages: next => { images = next; } };
}
function image(src, extra = {}) { return { src, complete: true, naturalWidth: 1000, naturalHeight: 800, getClientRects: () => [{}], ...extra }; }

test('复现#394：同图清空分数框持续50轮也不报告换卷', async () => {
    const f = fixture(); const old = f.a.getPaperIdentity(); let done = false;
    const pending = f.a.waitForNextPaper('https://oss.test/paper-A.png?Expires=1&Signature=old', { paperId: old, taskId: 'task' }).then(value => { done = true; return value; });
    await f.tick(50); assert.equal(done, false);
    await f.tick(75); assert.equal(await pending, false); assert.equal(f.e.intervals.size, 0);
});

test('智学网新旧界面及iframe均等待整组图片加载，换签名不换卷', async () => {
    for (const iframe of [false,true]) for (const oldUI of [false,true]) {
        const f = fixture({iframe,oldUI}); const old = f.a.getPaperIdentity(); let done = false;
        const pending = f.a.waitForNextPaper('https://oss.test/paper-A.png', {paperId:old}).then(v=>{done=true;return v;});
        f.setImages([image('https://oss.test/paper-A.png?Expires=2&Signature=new')]);
        assert.equal(f.a.getPaperIdentity(),old); await f.tick(4); assert.equal(done,false);
        f.setImages([image('https://oss.test/paper-A.png'),image('https://oss.test/paper-B-2.png')]);
        await f.tick(3); assert.equal(done,false,'新旧图片混合时不得换卷');
        f.setImages([image('https://oss.test/paper-B.png'),image('https://oss.test/paper-B-2.png',{complete:false})]);
        await f.tick(3); assert.equal(done,false); assert.equal(f.a.getPaperIdentity(),null);
        f.setImages([image('https://oss.test/paper-B.png'),image('https://oss.test/paper-B-2.png')]);
        await f.tick(1); assert.equal(done,false); await f.tick(1); assert.equal(await pending,true);
        assert.equal((await f.a.gatherAnswerImages()).length,2);
    }
});

test('切题、取消和未知基线停止等待，暂停后不重新启动评分', async () => {
    const f = fixture(); assert.equal(await f.a.waitForNextPaper(''), false);
    const controller = new AbortController(); const pending=f.a.waitForNextPaper('https://oss.test/paper-A.png',{signal:controller.signal});
    controller.abort(); assert.equal(await pending,false); assert.equal(f.e.intervals.size,0);
    const p=f.a.waitForNextPaper('https://oss.test/paper-A.png',{taskId:'another'}); await f.tick(); assert.equal(await p,false);
});

test('图片查询中的答卷参数参与身份，签名与显示变换不参与', () => {
    const f=fixture();
    assert.equal(f.a._answerResourceKey('https://oss.test/a?paperId=A&Signature=1&x-oss-process=resize'), 'https://oss.test/a?paperId=A');
    assert.notEqual(f.a._answerResourceKey('https://oss.test/a?paperId=A'),f.a._answerResourceKey('https://oss.test/a?paperId=B'));
});
