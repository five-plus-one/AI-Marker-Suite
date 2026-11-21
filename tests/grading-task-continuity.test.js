const test = require('node:test');
const assert = require('node:assert/strict');
const {env, load, read, settle, vm} = require('./_audit-harness');

function fixture() {
    const e=env(); let task='question-31';
    e.sb.PresetManager.getTaskIdentifier=()=>task;
    e.adapter.getGradingTaskIdentifier=()=>task;
    load(e,'src/core/ui-button.js');
    return {...e, task:value=>{task=value;}};
}

test('下一轮开始前切题停止，保留原方案且不调用模型或填分', async()=>{
    const e=fixture(); load(e,'src/core/main.js');
    const old=e.sb.createGradingContext(); let requests=0;
    e.sb.callAIGrading=async()=>{requests++;return {score:0,studentAnswer:'未作答'};};
    e.task('question-30'); await e.sb.startAutoGrading();
    assert.equal(requests,0); assert.equal(e.calls.fill.length,0); assert.equal(e.calls.submit.length,0);
    assert.equal(e.state.isRunning,false); assert.equal(old.controller.signal.aborted,true);
    assert.equal(e.sb.PresetManager.data.active,'test');
    assert.ok(e.calls.toasts.some(text=>text.includes('当前题目已切换')));
});

test('等待下一份期间切题，即使适配器报告新卷也停止', async()=>{
    for(const reported of [true,false]) {
        const e=fixture(); load(e,'src/core/ui-submit-dialog.js');
        const context=e.sb.createGradingContext(); let waits=0;
        e.adapter.waitForNextPaper=async()=>{waits++;e.task('question-30');return reported;};
        assert.equal(await e.sb.waitForNextPaperWithRetry(e.adapter,'https://x.test/A.png',3,context),false);
        assert.equal(waits,1); assert.equal(e.state.isRunning,false);
        assert.equal(context.controller.signal.aborted,true);
    }
});

test('手动暂停保留连续题目基准，换题后继续在请求前停止', async()=>{
    const e=fixture(); load(e,'src/core/main.js');
    e.sb.createGradingContext(); e.sb.toggleAutoGrading();
    assert.equal(e.state.isPaused,true); assert.equal(e.state.activeRun,null);
    assert.equal(e.state.gradingTaskId,'question-31');
    let requests=0; e.sb.callAIGrading=async()=>{requests++;return {score:8};};
    e.task('question-30'); e.sb.toggleAutoGrading(); await settle();
    assert.equal(requests,0); assert.equal(e.state.isRunning,false);
    assert.equal(e.state.gradingTaskId,null);
});

test('同题换卷及暂停继续正常，未知题号不作为切题证据', async()=>{
    const e=fixture(); load(e,'src/core/main.js');
    e.sb.createGradingContext(); e.setPaper('B');
    await e.sb.startAutoGrading();
    assert.equal(e.calls.fill.length,1); assert.equal(e.state.gradingTaskId,'question-31');
    assert.equal(e.sb.stopIfGradingTaskChanged(),false);
    e.task(''); assert.equal(e.sb.stopIfGradingTaskChanged(),false);
    e.task('question-30'); e.state.isPaused=true;
    assert.equal(e.sb.stopIfGradingTaskChanged(),false);
});

test('识别期间原生题号改变，轮询取消请求并禁止旧结果填分', async()=>{
    const e=fixture(); load(e,'src/core/main.js');
    let resolve, started;
    const scoringStarted = new Promise(done => { started = done; });
    e.sb.callAIGrading = () => new Promise(done => { resolve = done; started(); });
    e.sb.runNewTaskOnboardingFlow=async()=>{};
    const run=e.sb.startAutoGrading();
    await Promise.race([scoringStarted, run]);
    assert.equal(typeof resolve, 'function');
    const context=e.state.activeRun; e.task('question-30');
    await [...e.intervals.values()][0]();
    assert.equal(context.controller.signal.aborted,true);
    resolve({score:0,studentAnswer:'未作答'}); await run;
    assert.equal(e.calls.fill.length,0); assert.equal(e.calls.submit.length,0);
});

test('下载期间切题，在调用模型前核对任务', async()=>{
    const e=fixture(); load(e,'src/core/main.js'); let requests=0;
    e.adapter.fetchImageAsBase64=async()=>{e.task('question-30');return 'PNG';};
    e.sb.callAIGrading=async()=>{requests++;return {score:8};};
    await e.sb.startAutoGrading();
    assert.equal(requests,0); assert.equal(e.calls.fill.length,0);
});

test('开始批改时学科网取图方法能读取适配器保存的当前答卷', async () => {
    const e = fixture();
    vm.runInContext("'use strict';\n" + read('src/adapters/xkw-cloud/adapter.js'), e.sb);
    const xkw = vm.runInContext('XkwCloudAdapter', e.sb);
    const url = 'https://x.test/A.png';
    e.adapter.fetchImageAsBase64 = xkw.fetchImageAsBase64;
    e.adapter.gatherAnswerImages = async function () {
        this._collected = { urls: [url], identity: this.getPaperIdentity() };
        return [url];
    };
    const downloads = [];
    e.sb.fetchImageAsBase64 = async (source, signal) => {
        downloads.push({ source, signal });
        return 'PNG';
    };
    load(e, 'src/core/main.js');
    await e.sb.startAutoGrading();
    assert.equal(downloads.length, 1, e.calls.toasts.join('\n'));
    assert.equal(downloads[0].source, url);
    assert.ok(downloads[0].signal instanceof AbortSignal);
    assert.deepEqual(e.calls.fill, [{ paper: 'A', scores: [8] }]);
    assert.equal(e.calls.submit.length, 0);
});

test('轮次交界题号暂不可读，恢复为另一题时仍沿用连续基准拦截',async()=>{
    const e=fixture(); load(e,'src/core/main.js'); e.sb.createGradingContext(); e.task('');
    e.adapter.gatherAnswerImages=async()=>{e.task('question-30');return ['https://x.test/A.png'];};
    let requests=0; e.sb.callAIGrading=async()=>{requests++;return {score:0};};
    await e.sb.startAutoGrading();
    assert.equal(requests,0); assert.equal(e.calls.fill.length,0); assert.equal(e.state.isRunning,false);
});

test('过期等待和手动重评不能停止正在进行的新一轮',()=>{
    const e=fixture(); const old=e.sb.createGradingContext(); e.task('question-30');
    e.sb.stopAutoGrading(); e.state.isRunning=true; const next=e.sb.createGradingContext();
    assert.equal(e.sb.stopIfGradingTaskChanged(old),false);
    assert.equal(e.state.activeRun,next); assert.equal(e.state.isRunning,true);
    const manual=e.sb.createGradingContext(true); e.task('question-29');
    assert.equal(e.sb.stopIfGradingTaskChanged(manual),false);
});

test('智学网评分栏题号优先，支持iframe与多小题总分栏，未知时返回空基准',()=>{
    for(const iframe of [false,true]) {
        const e=env(); let heading='第31题', labels=['31'], total=null;
        const input=label=>({getAttribute:name=>name==='disptitle'?label:null,getClientRects:()=>[{}]});
        const doc={querySelector:sel=>sel==='#currentTopicIndex'?{textContent:heading}:sel==='#containter_topicTxt #totalScore'?total:null,
            querySelectorAll:sel=>sel==='input[name="topicTxt"]'?labels.map(input):[]};
        e.sb.location.hash='#/marking/personal/?paper=1';
        e.sb.document=iframe?{querySelector:sel=>sel==='iframe'?{contentDocument:doc}:null,querySelectorAll:()=>[]}:doc;
        load(e,'src/adapters/zhixue/selectors.js'); load(e,'src/adapters/zhixue/adapter.js');
        const a=vm.runInContext('ZhixueAdapter',e.sb);
        assert.match(a.getGradingTaskIdentifier(),/___第31题$/);
        const baseline=a.getGradingTaskIdentifier();
        labels=['30']; assert.notEqual(a.getGradingTaskIdentifier(),baseline,'评分栏已切题，顶部仍旧题时及时识别');
        labels=['31']; heading='第30题'; assert.notEqual(a.getGradingTaskIdentifier(),baseline,'顶部已切题，评分栏仍旧题时及时识别');
        labels=['1','2','3']; heading='第17题'; assert.match(a.getGradingTaskIdentifier(),/___第17题$/);
        total=input('18'); assert.match(a.getGradingTaskIdentifier(),/第18题$/);
        total=null; labels=[]; heading=''; assert.equal(a.getGradingTaskIdentifier(),'');
    }
});

test('智学网明确满分不匹配时停止准备，小数满分与未知满分分别处理',()=>{
    const e=env(); e.sb.document.querySelectorAll=()=>[];
    load(e,'src/adapters/zhixue/selectors.js'); load(e,'src/adapters/zhixue/adapter.js');
    const a=vm.runInContext('ZhixueAdapter',e.sb);
    const input=max=>({element:{getAttribute:()=>String(max),getClientRects:()=>[{}]}});
    a.getScoreInputs=()=>[input(8)]; e.sb.PresetManager.getMaxScore=()=>10;
    assert.equal(a.prepareGrading(),false); assert.match(a.lastFillError,/满分为8分，批改方案为10分/);
    e.sb.PresetManager.getMaxScore=()=>8; assert.equal(a.prepareGrading(),true); assert.equal(a.lastFillError,'');
    a.getScoreInputs=()=>[input(2.5),input(5.5)]; assert.equal(a.prepareGrading(),true);
    a.getScoreInputs=()=>[input(0)]; assert.equal(a.prepareGrading(),true);
    assert.equal(a._scoreMaximum({getAttribute:()=>null,placeholder:'满分8.5'}),8.5);
    assert.equal(a._scoreMaximum({getAttribute:()=>'-1',placeholder:'请输入分数'}),0);
});

test('智学网含括号的题号在同题换卷时保持一致，切到另一个小题时停止', () => {
    const e = fixture();
    let heading = '第24(1)题';
    let total = '24(1)';
    const input = label => ({ getAttribute: name => name === 'disptitle' ? label : null });
    Object.assign(e.sb.document, {
        querySelector: selector => {
            if (selector === '#currentTopicIndex') return { textContent: heading };
            if (selector === '#containter_topicTxt #totalScore' && total) return input(total);
            return null;
        },
        querySelectorAll: selector => selector === 'input[name="topicTxt"]' ? [input('1'), input('2')] : []
    });
    load(e, 'src/adapters/zhixue/selectors.js');
    load(e, 'src/adapters/zhixue/adapter.js');
    const adapter = vm.runInContext('ZhixueAdapter', e.sb);
    e.adapter.getGradingTaskIdentifier = () => adapter.getGradingTaskIdentifier();
    e.sb.PresetManager.getCurrentConfig = () => ({ paperGuard: { enabled: false } });
    const run = e.sb.createGradingContext();

    total = '';
    assert.equal(e.sb.stopIfGradingTaskChanged(run), false, '换卷时总分栏暂未显示');
    total = '２４（１）';
    heading = '  ';
    assert.equal(e.sb.stopIfGradingTaskChanged(run), false, '换卷时页头暂未显示');

    heading = '第24(1)题';
    total = '24(2)';
    assert.equal(e.sb.stopIfGradingTaskChanged(run), true, '评分栏先更新仍能拦住实际换题');
    assert.equal(run.controller.signal.aborted, true);
});

test('其他平台保留原有换卷参数，同时记录本轮耗时和结果', async () => {
    const e = fixture();
    load(e, 'src/core/ui-submit-dialog.js');
    const events = [];
    e.sb.DiagnosticLog = { grading: (event, run, details) => events.push({ event, run, details }) };
    e.adapter.id = 'xkw-cloud';
    const context = e.sb.createGradingContext();
    e.adapter.waitForNextPaper = async (oldImage, options) => {
        assert.equal(oldImage, 'https://x.test/A.png');
        assert.deepEqual(Object.keys(options), ['paperId', 'taskId', 'signal']);
        e.setPaper('B');
        return true;
    };
    assert.equal(await e.sb.waitForNextPaperWithRetry(e.adapter, 'https://x.test/A.png', 3, context), true);
    assert.deepEqual(events.map(row => row.event), ['next-paper-wait-started', 'next-paper-wait-finished']);
    assert.equal(events[1].details.hasNext, true);
    assert.equal(e.state.isRunning, true);
});
