const test = require('node:test');
const assert = require('node:assert/strict');
const { env, load, read, settle, ROOT, vm } = require('./_audit-harness');
const M = require('./_adapter-matrix');

function flow() {
    const e = env();
    load(e, 'src/core/main.js');
    load(e, 'src/core/ui-submit-dialog.js');
    const root = e.sb.getUIRoot;
    load(e, 'src/core/ui-button.js'); e.sb.getUIRoot = root;
    e.sb.updateBatchProgress = () => e.calls.progress++;
    return e;
}

test('暂停、停止和替换弹窗使原倒计时失效', async () => {
    for (const action of ['pause', 'stop', 'replace']) {
        const e = flow();
        const old = e.sb.showAutoSubmitDialog(8, 'test', null);
        const oldTimers = [...e.intervals.values()];
        if (action === 'pause') e.sb.toggleAutoGrading();
        if (action === 'stop') e.sb.stopAutoGrading();
        if (action === 'replace') e.sb.showAutoSubmitDialog(7, 'updated', null);
        for (const callback of oldTimers) callback();
        await old.confirmSubmit(); await settle();
        assert.equal(e.calls.submit.length, 0, action);
        assert.equal(e.calls.history.length, 0, action);
        assert.equal(old.gradingDisposed, true);
    }
});

test('提交时换卷与换题均阻止提交，包括缓存分数的 C30 适配器', async () => {
    for (const change of ['paper', 'task', 'c30']) {
        const e = flow(); let task = 'task', paper = 'A'; const writes = [];
        e.sb.PresetManager.getTaskIdentifier = () => task;
        if (change === 'c30') {
            const a = M.loadOne(M.makeStub({ host: 'zy.iclass30.com', path: '/' }), 'c30').winner;
            a.getPaperIdentity = () => paper; a.gatherAnswerImages = async () => ['https://x.test/' + paper + '.png'];
            a.isMarkingPage = () => true; a._setScoreValue = score => { writes.push(score); return true; };
            a._handleConfirmDialog = () => {};
            e.sb.__AI_MARKER_ADAPTER__ = a; a.fillScores([8]);
        }
        const dialog = e.sb.showAutoSubmitDialog(8, 'test', null);
        if (change === 'task') task = 'new-task'; else { e.setPaper('B'); paper = 'B'; }
        await dialog.confirmSubmit();
        assert.equal(e.calls.submit.length, 0);
        assert.equal(writes.length, 0);
        assert.equal(e.calls.history.length, 0);
    }
});

test('提交失败不累计完成，成功仅一次；迟到回调不能再次提交', async () => {
    for (const accepted of [false, true]) {
        const e = flow(); e.adapter.submitGrade = async () => { e.calls.submit.push('A'); return accepted; };
        const dialog = e.sb.showAutoSubmitDialog(8, 'test', null);
        await Promise.all([dialog.confirmSubmit(), dialog.confirmSubmit()]);
        await dialog.confirmSubmit();
        assert.equal(e.calls.submit.length, 1);
        assert.equal(e.calls.progress, accepted ? 1 : 0);
        assert.equal(e.calls.history.length, accepted ? 1 : 0);
    }
});

test('回评确认成功才更新原记录，失败与重复确认均不增写历史', async () => {
    for (const accepted of [false, true]) {
        const e = flow(), updates = [];
        e.sb.HistoryManager.update = (...args) => updates.push(args);
        e.adapter.submitGrade = async () => accepted;
        const dialog = e.sb.showAutoSubmitDialog(6, '原评语', [{ score: 6 }], {
            regradeId: 'original', correction: { isCorrected: true, correctionReason: '教师确认', aiScore: 8 }
        });
        assert.equal(updates.length, 0);
        await Promise.all([dialog.confirmSubmit(), dialog.confirmSubmit()]);
        assert.equal(e.calls.history.length, 0);
        assert.equal(updates.length, accepted ? 1 : 0);
        if (accepted) {
            assert.equal(updates[0][0], 'original');
            assert.equal(updates[0][1].finalScore, 6);
            assert.equal(updates[0][1].status, 'submitted');
        }
    }
});

test('空白检测过程中换卷不会填 0 或创建提交弹窗', async () => {
    const e = flow(); e.cfg.blankDetection = { enabled: true, threshold: 1 };
    e.sb.BlankDetector = { loadReference: () => ({ thresholds: [], ratios: [] }),
        calcBatchRatios: async () => { e.setPaper('B'); return []; }, isBlankSheet: () => ({ isBlank: true }) };
    e.sb.showAutoSubmitDialog = (...args) => e.calls.dialogs.push(args);
    await e.sb.startAutoGrading();
    assert.equal(e.calls.fill.length, 0); assert.equal(e.calls.dialogs.length, 0);
});

test('手动空白范本采集期间换卷不会写分或提交', async () => {
    const e = flow(); e.state.currentBase64DataArray = ['PNG'];
    e.sb.BlankDetector = { hasReference: () => false, calcBatchRatios: async () => { e.setPaper('B'); return []; }, saveReference() {} };
    const dialog = e.sb.showAutoSubmitDialog(8, 'test', null);
    await dialog.querySelector('#mark-blank-btn').listeners.click();
    assert.equal(e.calls.fill.length, 0); assert.equal(e.calls.submit.length, 0);
});

test('暂停恢复隔离旧下载重试与旧失败回调', async () => {
    const e = flow(); let attempts = 0;
    e.sb.btoa = s => Buffer.from(s, 'binary').toString('base64');
    e.sb.GM_xmlhttpRequest = options => {
        const a = options.url.includes('/A.');
        queueMicrotask(() => { if (a && attempts++ === 0) options.ontimeout();
            else options.onload({ status: 200, response: Uint8Array.from([a ? 65 : 66]).buffer }); });
        return { abort() {} };
    };
    load(e, 'src/core/image.js');
    e.adapter.fetchImageAsBase64 = (url, signal) => e.sb.fetchImageAsBase64(url, signal);
    e.sb.callAIGrading = async images => ({ score: images[0] === 'QQ==' ? 3 : 9, comment: '', studentAnswer: '' });
    e.sb.showAutoSubmitDialog = (...args) => e.calls.dialogs.push(args);
    const first = e.sb.startAutoGrading(); await settle();
    assert.equal(attempts, 1);
    e.state.isRunning = false; e.state.isPaused = true; e.sb.invalidateGradingRun();
    e.setPaper('B'); e.state.isRunning = true; e.state.isPaused = false;
    await e.sb.startAutoGrading(); await first;
    for (const callback of [...e.timeouts.values()]) callback(); await settle();
    assert.deepEqual(e.calls.fill.map(x => x.scores[0]), [9]);
    assert.equal(e.state.isRunning, true);
});

test('存储恢复合并原数据与降级期间编辑，重新载入仍完整', () => {
    const cases = [
        ['preset.js', 'PresetManager', 'ai-grading-presets', { list: { Original: { answer: 'original' } }, active: 'Original', bindings: { task: 'Original' } }, 'list'],
        ['ai-engine.js', 'ProviderManager', 'ai-grading-providers-v2', { providers: { Original: { endpoint: 'https://x.test', apiKey: 'fake', models: {} } }, activeProvider: 'Original' }, 'providers'],
        ['ai-engine.js', 'WorkflowManager', 'ai-grading-workflows', { workflows: { Original: { id: 'original', model: {} } }, activeWorkflow: 'original' }, 'workflows']
    ];
    for (const [file, name, key, original, field] of cases) {
        const e = env(), store = { [key]: JSON.stringify(original) }; let first = true;
        e.sb.GM_getValue = (k, d) => { if (k === key && first) { first = false; throw Error('transient'); } return store[k] ?? d; };
        e.sb.GM_setValue = (k, v) => { store[k] = v; };
        vm.runInContext(read('src/core/' + file) + '\nthis.manager=' + name, e.sb);
        const m = e.sb.manager;
        m.data[field].UserEdit = field === 'list' ? { answer: 'edited' } : field === 'providers' ? { models: {}, apiKey: 'fake2' } : { id: 'edit', model: {} };
        assert.equal(m.save(), false); assert.equal(m.save(), true);
        m.init();
        assert.ok(m.data[field].Original, name); assert.ok(m.data[field].UserEdit, name);
        if (field === 'list') assert.equal(m.data.bindings.task, 'Original');
    }
});

test('历史图片迁移失败保存后重载仍可重试并成功迁移', async () => {
    const e = env(), store = { 'ai-grading-history': JSON.stringify([{ id: 'old', imageBase64s: ['ORIGINAL'], imageUrls: [] }]) };
    e.sb.__AI_MARKER_ADAPTER__ = null;
    e.sb.GM_getValue = (k, d) => store[k] ?? d; e.sb.GM_setValue = (k, v) => { store[k] = v; };
    load(e, 'src/core/history.js');
    vm.runInContext("ImageStore.save=async()=>{throw Error('unavailable')};this.history=HistoryManager;this.images=ImageStore",e.sb);
    await e.sb.history.init(); await e.sb.history.init();
    assert.equal(JSON.parse(store['ai-grading-history'])[0].imageBase64s[0], 'ORIGINAL');
    let saved; e.sb.images.save = async (_id, images) => { saved = images; };
    await e.sb.history.init();
    assert.equal(saved[0], 'ORIGINAL');
    assert.equal(JSON.parse(store['ai-grading-history'])[0].imageBase64s, undefined);
});

test('十进制梯度边界、满分特例与加分预算', () => {
    const e = env(); load(e, 'src/core/score.js'); const s = vm.runInContext('ScoreCalculator', e.sb);
    for (const [v, step, method, expected] of [[0.3,0.1,'floor',0.3],[2.55,0.1,'round',2.6],[0.07,0.01,'ceil',0.07],[10,3,'round',10],[10,1.5,'floor',10],[9.8,3,'round',10]]) {
        assert.equal(s.round(v,{roundStep:step,roundMethod:method},10), expected);
    }
    for (const step of [0.01,0.1,0.25,0.3,0.5,1,1.5,2,3]) for (const method of ['floor','round','ceil']) {
        let previous = -1;
        for (let n=0;n<=1000;n++) {
            const v=n/100, out=s.round(v,{roundStep:step,roundMethod:method},10);
            assert.ok(out>=previous && out>=0 && out<=10); previous=out;
            assert.equal(s.round(out,{roundStep:step,roundMethod:method},10),out,'合法分数再次吸附应不变');
        }
    }
    const result=s.calculate({aiScore:0,diligenceLevel:2,maxScore:4,scoringConfig:{roundStep:1,roundMethod:'round',diligence:{enabled:true,maxBonus:1}},aiUnitScores:[{score:0,maxScore:2},{score:0,maxScore:2}]});
    assert.equal(result.finalScore,1);assert.equal(result.bonus,1);
});

test('模型升级迁移官方引用，保留自定义供应商；v1 密钥、地址、活动模型保留', () => {
    const e = env(), store = {};
    e.sb.SCRIPT_CONFIG.DEFAULT_ENDPOINT = 'https://official.test/v1/chat/completions';
    e.sb.GM_getValue = (k,d)=>store[k]??d; e.sb.GM_setValue=(k,v)=>store[k]=v;
    store['ai-grading-providers']=JSON.stringify({list:{'5plus1官方':{endpoint:'https://custom.test/v1/chat/completions',apiKey:'FAKE',model:'chosen'}},active:'5plus1官方'});
    load(e,'src/core/ai-engine.js');
    vm.runInContext('this.pm=ProviderManager;this.wm=WorkflowManager',e.sb);
    assert.equal(e.sb.pm.getCurrentApiKey(),'FAKE'); assert.equal(e.sb.pm.data.activeModel,'chosen');
    assert.equal(e.sb.pm.getCurrentEndpoint(),'https://custom.test/v1/chat/completions');
    const provider=e.sb.pm.data.providers['5plus1官方'];provider.endpoint=e.sb.SCRIPT_CONFIG.DEFAULT_ENDPOINT;provider.models['deepseek-fast']={isBuiltin:true};
    e.sb.pm.addProvider('Custom',{endpoint:'https://custom.test',models:{'deepseek-fast':{}}});
    const wf=e.sb.wm.data.workflows['双评模式(高精度)'];
    for(const model of [wf.model,wf.dualEval.secondary,wf.dualEval.arbitration])model.model='deepseek-fast';
    e.sb.pm.save();e.sb.wm.save();e.sb.pm.init();e.sb.wm.init();
    assert.ok(e.sb.pm.data.providers['5plus1官方'].models['deepseek-flash']);
    assert.equal(e.sb.pm.data.providers['5plus1官方'].models['deepseek-fast'],undefined);
    assert.ok(e.sb.pm.data.providers.Custom.models['deepseek-fast']);
    const reloaded=e.sb.wm.getWorkflow('dual');
    for(const model of [reloaded.model,reloaded.dualEval.secondary,reloaded.dualEval.arbitration])assert.equal(model.model,'deepseek-flash');
});

test('华翰云列表停留后 SPA 导航与 DOM 延迟仍能注册', () => {
    const sb=M.makeStub({host:'yj.lcedu.net.cn',hash:'#/marking/list',dom:{'#compuinput':1,'button.submitscorebtn':1}});
    assert.equal(M.loadAdapters(sb).errors.length,0);assert.equal(sb.__AI_MARKER_ADAPTER__,undefined);
    sb.location.hash='#/marking/grading?questionId=1';for(const observer of sb.__observers)observer.cb([]);
    assert.equal(sb.__AI_MARKER_ADAPTER__?.platformKey,'huahanyun');
});

function configurationStore() {
    const e = env(), store = {};
    e.sb.GM_getValue = (key, fallback) => store[key] ?? fallback;
    e.sb.GM_setValue = (key, value) => { store[key] = value; };
    e.sb.GM_deleteValue = key => { delete store[key]; };
    load(e, 'src/core/ai-engine.js'); load(e, 'src/core/preset.js');
    vm.runInContext('this.pm=ProviderManager;this.wm=WorkflowManager;this.presets=PresetManager', e.sb);
    e.sb.presets.migrateAll();e.sb.wm.init();
    return { ...e, store };
}

test('整组导入写入失败回滚，重载恢复中断事务后保留原配置', () => {
    for (const failedKey of ['ai-grading-presets','ai-grading-providers-v2','ai-grading-workflows','commit-marker']) {
        const e = configurationStore();
        const previous = JSON.stringify([e.sb.presets.data,e.sb.pm.data,e.sb.wm.data]);
        const keys=['ai-grading-presets','ai-grading-providers-v2','ai-grading-workflows'];
        const raw=keys.map(key=>e.store[key]);
        const prepared=e.sb.prepareConfigurationImport({presets:{active:'Imported',list:{Imported:{scoring:{roundStep:0.5}}}}});
        let failed=false;
        e.sb.GM_setValue=(key,value)=>{
            const fail=key===failedKey || (failedKey==='commit-marker' && key==='ai-grading-import-backup' && !JSON.parse(value).pending);
            if(fail&&!failed){failed=true;throw Error('interrupted');}e.store[key]=value;
        };
        assert.throws(()=>e.sb.persistConfigurationImport(prepared));
        assert.equal(JSON.stringify([e.sb.presets.data,e.sb.pm.data,e.sb.wm.data]),previous);
        assert.deepEqual(keys.map(key=>e.store[key]),raw);
        const backup=JSON.parse(e.store['ai-grading-import-backup']);
        assert.equal(backup.pending,false,'回滚完成后恢复点不能覆盖后续编辑');
        // 模拟进程在写入新值后结束，下一页必须按恢复点读回整组旧值。
        e.store[keys[0]]=JSON.stringify(prepared.presets);
        e.store['ai-grading-import-backup']=JSON.stringify({...backup,pending:true});
        assert.equal(e.sb.recoverInterruptedConfigurationImport(),true);
        assert.deepEqual(keys.map(key=>e.store[key]),raw);
        e.sb.presets.init();e.sb.pm.init();e.sb.wm.init();
        assert.equal(JSON.stringify([e.sb.presets.data,e.sb.pm.data,e.sb.wm.data]),previous);
    }
});

test('导入迁移保留旧小题独立梯度，并在持久化前拒绝无效模型引用', () => {
    const e=configurationStore();
    const prepared=e.sb.prepareConfigurationImport({presets:{list:{Legacy:{scoring:{roundStep:0.5},subQuestions:[{label:'A',maxScore:3,roundStep:0.25},{label:'B',maxScore:4}]}}}});
    assert.deepEqual(Array.from(prepared.presets.list.Legacy.scoring.units,x=>x.roundStep),[0.25,0.5]);
    const invalid=JSON.parse(JSON.stringify(prepared));
    Object.values(invalid.workflows.workflows).find(wf=>wf.id==='fast').model.model='removed-model';
    const stored=JSON.stringify(e.store);
    assert.throws(()=>e.sb.prepareConfigurationImport(invalid),/不可用/);
    assert.equal(JSON.stringify(e.store),stored);
    e.sb.presets.data.list[e.sb.presets.data.active].workflowId='missing';
    assert.throws(()=>e.sb.presets.getActiveCallConfig(),/模型不可用/);
});

test('新历史图片写入失败仍持久化，数据 URL 旧图也可恢复；存储满时保留完整记录', async () => {
    const e=env(),store={};e.sb.GM_getValue=(k,d)=>store[k]??d;e.sb.GM_setValue=(k,v)=>store[k]=v;
    e.sb.__AI_MARKER_ADAPTER__=null;e.state.saveImages=true;
    load(e,'src/core/history.js');vm.runInContext('this.history=HistoryManager;ImageStore.save=async()=>{throw Error("offline")}',e.sb);
    e.sb.history.add({imageBase64s:['ORIGINAL'],imageUrls:['data:image/png;base64,ORIGINAL'],finalScore:2});await settle();
    assert.equal(JSON.parse(store['ai-grading-history'])[0].imageBase64s[0],'ORIGINAL');
    store['ai-grading-history']=JSON.stringify([{id:'embedded',imageUrls:['data:image/png;base64,T0xE']}]);
    await e.sb.history.init();assert.equal(JSON.parse(store['ai-grading-history'])[0].imageBase64s[0],'T0xE');
    e.sb.history.records=Array.from({length:32},(_,id)=>({id}));
    e.sb.GM_setValue=()=>{throw Error('quota')};
    assert.equal(e.sb.history.save(),false);assert.equal(e.sb.history.records.length,32);
    store['ai-grading-history']='{"records":[]}';await e.sb.history.init();
    assert.equal(e.sb.history._writeDisabled,true);
});

test('旧弹窗的取消与暂停回调不能更改新轮次', async () => {
    const e=flow(),old=e.sb.showAutoSubmitDialog(8,'old',null);
    e.sb.createGradingContext();const active=e.state.activeRun;
    for(const selector of ['#cancel-submit-btn','#pause-cancel-btn','#not-blank-btn']) {
        const action=old.querySelector(selector).listeners.click;if(action)await action();
    }
    assert.equal(e.state.activeRun,active);assert.equal(e.state.isRunning,true);assert.equal(e.state.countdownPaused,false);
});

test('自动检测小题进入 AI 配置快照，处理中更改梯度不会改变已生成分数', async () => {
    const e=flow();const units=[{label:'A',maxScore:3,roundStep:0.25},{label:'B',maxScore:7,roundStep:0.5}];
    e.sb.PresetManager.getScoringUnits=()=>units;
    let captured;
    e.sb.callAIGrading=async(_images,config)=>{captured=config;e.cfg.scoring.roundStep=3;return{score:8,comment:'',studentAnswer:''}};
    await e.sb.startAutoGrading();
    assert.deepEqual(JSON.parse(JSON.stringify(captured.scoring.units)),units);
    assert.equal(captured.scoring.roundStep,1);assert.equal(captured.scoring.maxScore,10);
});

test('平台弱换卷信号不能越过相同答卷标识，旧等待不能重试新轮次', async () => {
    const e=flow();let attempts=0;const context=e.sb.createGradingContext();
    e.adapter.waitForNextPaper=async()=>{attempts++;return true};
    assert.equal(await e.sb.waitForNextPaperWithRetry(e.adapter,'url',1,context),false);
    e.sb.createGradingContext();
    assert.equal(await e.sb.waitForNextPaperWithRetry(e.adapter,'url',3,context),true);
    assert.equal(attempts,1);
});

test('平台延迟确认在暂停、换卷或校验失败后均不会点击', async () => {
    for(const dir of ['c30','guangda','haiyun','huixuexing','keewing','lehua','xueba54','ruiya']) {
        for(const failure of ['pause','changed','verify']) {
            const entry=M.ADAPTERS.find(a=>a.dir===dir), sb=M.makeStub(entry.own);
            const callbacks=[];sb.setInterval=fn=>{callbacks.push(fn);return callbacks.length};sb.clearInterval=()=>{};
            const adapter=M.loadOne(sb,dir).winner;let current=true,clicks=0;
            const button={textContent:'确定',offsetParent:{},click(){clicks++},classList:{contains:()=>false}};
            sb.document.querySelector=()=>null;sb.document.querySelectorAll=()=>[];
            if(dir==='ruiya')adapter._visible=()=>true;
            const handler=adapter._handleConfirmDialog||adapter._autoConfirmDialog||adapter._watchPostSubmitModals;
            handler.call(adapter,{isCurrent:()=>current,verify:async()=>{if(failure==='verify')throw Error('changed');current=false}});
            sb.document.querySelector=()=>button;sb.document.querySelectorAll=()=>[button];
            if(failure==='pause')current=false;
            for(const callback of callbacks)await callback();
            assert.equal(clicks,0,dir+'/'+failure);
        }
    }
});

test('服务端退避等待使用原轮次取消信号，完成请求释放监听器', async () => {
    const e=configurationStore();let requests=0;
    const controller=new AbortController();e.state.abortController=controller;
    e.sb.GM_xmlhttpRequest=options=>{requests++;queueMicrotask(()=>options.onload({status:503,responseText:'{"error":{"message":"unavailable"}}'}));return{abort(){}}};
    const pending=e.sb.callAI('prompt',[],{endpoint:'https://test',apiKey:'fake',model:'test',signal:controller.signal});
    const rejected=assert.rejects(pending,/用户主动暂停/);
    await settle();assert.equal(requests,1);assert.equal(e.timeouts.size,1);
    controller.abort();e.state.abortController=new AbortController();await rejected;
    for(const callback of [...e.timeouts.values()])callback();await settle();assert.equal(requests,1);
    let listeners=0;
    const signal={aborted:false,addEventListener(){listeners++},removeEventListener(){listeners--}};
    e.sb.GM_xmlhttpRequest=options=>{queueMicrotask(()=>options.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:'ok'},finish_reason:'stop'}]})}));return{abort(){}}};
    assert.equal(await e.sb.callAIOnce('prompt',[],{endpoint:'https://test',model:'test',signal},null,null,100),'ok');
    assert.equal(listeners,0);
});

test('未完成的导入恢复失败时三类配置均只读，保留恢复点', () => {
    const e=configurationStore(),keys=['ai-grading-presets','ai-grading-providers-v2','ai-grading-workflows'];
    e.store['ai-grading-import-backup']=JSON.stringify({keys,previous:keys.map(key=>e.store[key]),pending:true});
    const before=JSON.stringify(e.store);
    const sandbox={console:e.sb.console,window:{},SCRIPT_CONFIG:e.sb.SCRIPT_CONFIG,
        GM_getValue:(key,fallback)=>e.store[key]??fallback,GM_setValue:()=>{throw Error('storage unavailable')}};
    vm.createContext(sandbox);
    vm.runInContext(read('src/core/runtime.js'),sandbox);
    vm.runInContext(read('src/core/ai-engine.js'),sandbox);
    vm.runInContext(read('src/core/preset.js')+';this.managers=[PresetManager,ProviderManager,WorkflowManager]',sandbox);
    for(const manager of sandbox.managers){assert.equal(manager._writeDisabled,true);assert.equal(manager.save(),false)}
    assert.equal(JSON.stringify(e.store),before);
});

test('小题独立梯度的合计与加分在小数满分、三种取整策略下保持一致', () => {
    const e=env();load(e,'src/core/score.js');const calculator=vm.runInContext('ScoreCalculator',e.sb);
    let seed=335;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
    const clean=value=>Math.round(value*1e8)/1e8;
    const steps=[0.01,0.1,0.25,0.5,1,1.5,3];
    for(let sample=0;sample<600;sample++) {
        const units=Array.from({length:2+sample%4},()=>{const maxScore=(1+Math.floor(random()*500))/100;return{maxScore,score:Math.floor(random()*maxScore*1000)/1000,roundStep:steps[Math.floor(random()*steps.length)]}});
        const maxScore=clean(units.reduce((sum,u)=>sum+u.maxScore,0));
        const aiScore=clean(units.reduce((sum,u)=>sum+u.score,0));
        const scoringConfig={roundStep:steps[sample%steps.length],roundMethod:['round','floor','ceil'][sample%3],diligence:{enabled:true,maxBonus:2,decayPower:2}};
        const baseline=units.map(u=>calculator.round(u.score,{...scoringConfig,roundStep:u.roundStep},u.maxScore));
        const result=calculator.calculate({aiScore,maxScore,scoringConfig,aiUnitScores:units,diligenceLevel:5});
        const sum=clean(result.finalUnitScores.reduce((total,u)=>total+u.score,0));
        assert.equal(result.finalScore,sum,'总分必须等于实际填写的小题之和');
        const actualBonus=clean(result.finalUnitScores.reduce((total,u,i)=>total+u.score-baseline[i],0));
        assert.ok(Math.abs(result.bonus-actualBonus)<1e-7);
        const budget=calculator.round(calculator.calcDiligenceBonus(aiScore,5,maxScore,scoringConfig.diligence).bonus,scoringConfig);
        assert.ok(actualBonus<=budget+1e-7,'实际分配不能超过加分预算');
        result.finalUnitScores.forEach(u=>{
            assert.ok(u.score>=0&&u.score<=u.maxScore);
            assert.ok(u.score===u.maxScore||Math.abs(u.score/u.roundStep-Math.round(u.score/u.roundStep))<1e-7);
        });
    }
    const result=calculator.calculate({aiScore:0.052,maxScore:2,scoringConfig:{roundStep:0.01,roundMethod:'round'},aiUnitScores:[{score:0.026,maxScore:1},{score:0.026,maxScore:1}]});
    assert.equal(result.finalScore,0.06);
});
