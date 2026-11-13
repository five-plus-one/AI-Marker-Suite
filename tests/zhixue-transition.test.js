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
    const gather = async () => {
        const result = a.gatherAnswerImages();
        for (const [id, fn] of [...e.timeouts]) { e.timeouts.delete(id); fn(); }
        return result;
    };
    return { e, a, score, tick, gather, setImages: next => { images = next; } };
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
        assert.equal((await f.gather()).length,2);
    }
});

const inline = content => 'data:image/png;base64,' + Buffer.from(content).toString('base64');

test('内嵌增强图生成紧凑身份并等待整组新图稳定', async () => {
    const f = fixture();
    const first = inline('answer-A'), second = inline('answer-B');
    f.setImages([image(first)]);
    const old = f.a.getPaperIdentity();
    assert.ok(old); assert.ok(old.length < 150);
    assert.deepEqual(Array.from(await f.gather()), [first]);
    let done = false;
    const pending = f.a.waitForNextPaper(first, {paperId:old}).then(v=>{done=true;return v;});
    await f.tick(5); assert.equal(done, false);
    f.setImages([image(second, {complete:false})]); await f.tick(4); assert.equal(done, false);
    f.setImages([image(second)]); await f.tick(2); assert.equal(await pending, true);
    assert.notEqual(f.a.getPaperIdentity(), old);
});

test('增强图直接读取字节，网络下载传递取消信号', async () => {
    const f = fixture(), controller = new AbortController();
    const fetch = f.a.fetchImageAsBase64;
    let requested;
    f.e.sb.fetchImageAsBase64 = async (url, signal) => { requested = {url, signal}; return 'NETWORK'; };
    assert.equal(await fetch(inline('answer')), Buffer.from('answer').toString('base64'));
    assert.equal(requested, undefined);
    assert.equal(await fetch('https://oss.test/A.png', controller.signal), 'NETWORK');
    assert.equal(requested.signal, controller.signal);
    await assert.rejects(fetch('data:text/html;base64,AAAA'), /图片格式无效/);
    controller.abort(); await assert.rejects(fetch(inline('answer'), controller.signal), /用户主动暂停/);
});

test('增强显示绑定当前原始切图，开关增强及签名续期维持同卷', async () => {
    const f = fixture(), source = 'https://oss.test/scan.jpg?Expires=1&x-oss-process=image/crop,x_10,y_20,w_900,h_1200';
    const enhanced = inline('enhanced-A'), key = f.a._answerResourceKey(source);
    const state = {topicImageIds:[source], catchImage:{[key]:enhanced}};
    const parent = {__vue__:{$data:state}};
    f.setImages([image(source, {parentElement:parent})]);
    const old = f.a.getPaperIdentity();
    let done = false;
    const pending = f.a.waitForNextPaper(source, {paperId:old}).then(v=>{done=true;return v;});
    f.setImages([image(enhanced, {parentElement:parent})]);
    assert.equal(f.a.getPaperIdentity(), old); await f.tick(5); assert.equal(done, false);
    assert.deepEqual(Array.from(await f.gather()), [enhanced]);
    // 原生数据先切换，旧增强图仍留在 DOM 时不能评分或认定新卷完成。
    const next = source.replace('x_10', 'x_30');
    state.topicImageIds = [next];
    assert.equal(f.a.getPaperIdentity(), null); await f.tick(5); assert.equal(done, false);
    f.setImages([image(next, {parentElement:parent})]); await f.tick(2); assert.equal(await pending, true);
});

test('原生多图必须齐全，增强图缺少当前来源映射时等待', () => {
    const f=fixture(), a='https://oss.test/A.png', b='https://oss.test/B.png', data=inline('B');
    const state={topicImageIds:[a,b],catchImage:{}}, parent={__vue__:{$data:state}};
    f.setImages([image(a,{parentElement:parent})]); assert.equal(f.a.getPaperIdentity(),null);
    f.setImages([image(a,{parentElement:parent}),image(data,{parentElement:parent})]);
    assert.equal(f.a.getPaperIdentity(),null);
    state.catchImage[b]=data; assert.ok(f.a.getPaperIdentity());
});

test('OSS裁切坐标参与身份，签名及显示缩放不影响身份', () => {
    const f=fixture(), source='https://oss.test/scan.jpg?x-oss-process=image/crop,x_10,y_20,w_900,h_1200';
    assert.notEqual(f.a._answerResourceKey(source),f.a._answerResourceKey(source.replace('x_10','x_30')));
    assert.equal(f.a._answerResourceKey(source),f.a._answerResourceKey(source+'/resize,w_800&Signature=renewed'));
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
