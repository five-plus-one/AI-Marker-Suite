const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const M = require('./_adapter-matrix.js');

function setup({ count=1, max=6, step=1 }={}) {
    const sb=M.makeStub({host:'www.wylkyj.com',path:'/yuejuan/',hash:'#/reading'});
    const task={examNo:'exam',esubNo:'subject',queNo:'16',IsArb:false,queName:'16(4-6)'};
    sb.sessionStorage.setItem('TaskParams',JSON.stringify(task));
    sb.setTimeout=setTimeout;sb.clearTimeout=clearTimeout;
    sb.Event=class {constructor(type){this.type=type;}};
    const view=()=>({getClientRects:()=>[{}],checkVisibility:()=>true,closest:()=>null});
    const image={...view(),src:'https://img.wylkyj.com/answer.png?stuNo=A&signature=old',complete:true,naturalWidth:900};
    const box={...view(),querySelectorAll:()=>[image]};
    const fields=Array.from({length:count},(_,index)=>({
        ...view(),_v:'',get value(){return this._v;},placeholder:`满分${max}分`,
        disabled:false,readOnly:false,writes:0,focus(){},
        dispatchEvent(e){if(e.type==='input')this.writes++;}
    }));
    let review=false, response={code:200,datas:{saveResponse:{code:200,datas:{}}}}, autoRespond=true;
    const sent=[];let latest;
    class XHR {
        constructor(){this.events=new Map();this.status=200;}
        open(method,url){this.url=url;}
        send(body){sent.push(JSON.parse(body));latest=this;
            if(autoRespond&&this.url.includes('/Save'))setTimeout(()=>this.respond(response),0);}
        addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(fn);}
        removeEventListener(type,fn){this.events.get(type)?.delete(fn);}
        respond(body){this.responseText=JSON.stringify(body);for(const type of ['load','loadend'])for(const fn of [...(this.events.get(type)||[])])fn();}
    }
    sb.XMLHttpRequest=XHR;
    const button={...view(),disabled:false,classList:{contains:()=>false},click(){
        const xhr=new sb.XMLHttpRequest();xhr.open('POST','https://pcmarking.wylkyj.com/api/v1/marking/SaveAndInit');
        xhr.send(JSON.stringify({id:'paper-A',esubNo:'subject',queNo:'16',IsArb:false,
            score:fields.reduce((sum,field)=>sum+Number(field.value),0),
            stepInfoList:count>1?fields.map(field=>({stepScore:Number(field.value)})):[]}));
    }};
    const panel={...view(),textContent:`给分板 满分${max}分 步长${step}分`,querySelectorAll(selector){
        if(selector.includes('input'))return fields;
        if(selector==='button')return [{...view(),textContent:review?'取消回评':'回评上一份'}];
        if(selector.includes('Submit')||selector.includes('simplifySub'))return [button];
        return [];
    }};
    sb.document.querySelectorAll=selector=>selector.includes('giveCard')?[panel]:selector.includes('outBox')?[box]:[];
    assert.deepEqual(M.loadOne(sb,'wuyue').errors,[]);
    vm.runInContext('globalThis.wyHelper=WUYUE_HELPERS',sb);
    const xhr=new sb.XMLHttpRequest();xhr.open('POST','https://pcmarking.wylkyj.com/api/v2/marking/Init');
    xhr.send(JSON.stringify({esubNo:'subject',queNo:'16',IsArb:false}));
    xhr.respond({code:200,datas:{info:{id:'paper-A'},imageDatas:[{imageData:image.src}]}});
    sent.length=0;
    return {sb,task,image,fields,panel,button,sent,adapter:sb.__AI_MARKER_ADAPTER__,
        response:value=>response=value,delay:()=>autoRespond=false,latest:()=>latest,review:value=>review=value};
}

test('五岳题组的多个评分单元合计填写总分，0分有效',()=>{
    const f=setup();
    for(const scores of [[2,2,2],[2,1,2],[0,0,0]]) {
        assert.equal(f.adapter.fillScores(scores),true);
        assert.equal(Number(f.fields[0].value),scores.reduce((a,b)=>a+b,0));
        assert.equal(f.sent.length,0);
    }
});
test('五岳缺分、非法分、超满分和不符步长在写入前整体拒绝',()=>{
    const f=setup();
    for(const scores of [[],[null],[undefined],[''],[true],[NaN],[Infinity],[-1],[7],[2,undefined,2],[0.5]]) {
        assert.equal(f.adapter.fillScores(scores),false,JSON.stringify(scores));
        assert.equal(f.fields[0].writes,0);assert.equal(f.sent.length,0);
        assert.ok(f.adapter.lastFillError);
    }
});
test('五岳多框逐项校验，缺分及多分不能留下半填状态',()=>{
    const f=setup({count:3,max:2});
    for(const scores of [[2,1],[2,2,3],[2,2,null],[2,2,2,0]]) {
        assert.equal(f.adapter.fillScores(scores),false);assert.ok(f.fields.every(x=>x.writes===0));
    }
    assert.equal(f.adapter.fillScores([2,1,2]),true);
    assert.deepEqual(f.fields.map(x=>x.value),['2','1','2']);
});
test('五岳禁用和只读给分板拒绝填写',()=>{
    for(const key of ['disabled','readOnly']) {
        const f=setup();f.fields[0][key]=true;
        assert.equal(f.adapter.fillScores([2]),false);assert.equal(f.fields[0].writes,0);
    }
});
test('五岳已打开页面中途加载脚本时等待重新进入阅卷确认答卷',()=>{
    const f=setup();f.sb.wyHelper.papers.clear();
    assert.equal(f.adapter.fillScores([2,2,2]),false);
    assert.match(f.adapter.lastFillError,/退出阅卷后重新进入/);
    assert.equal(f.fields[0].writes,0);assert.equal(f.sent.length,0);
    const xhr=new f.sb.XMLHttpRequest();xhr.open('POST','https://pcmarking.wylkyj.com/api/v2/marking/Init');
    xhr.send(JSON.stringify({esubNo:'subject',queNo:'16',IsArb:false}));
    xhr.respond({code:200,datas:{info:{id:'paper-A'},imageDatas:[{imageData:f.image.src}]}});
    assert.equal(f.adapter.fillScores([2,2,2]),true);
    assert.equal(f.fields[0].value,'6');
});
test('五岳兼容填分接口同样拒绝缺失小题分',()=>{
    const f=setup();assert.equal(f.adapter.fillScore({total:4,subScores:[{label:'（4）',score:null}]}),false);
    assert.equal(f.fields[0].writes,0);
});
test('五岳正常评卷与取消回评按钮的状态区分',()=>{
    const f=setup();assert.equal(f.adapter.isRegradeMode(),false);
    f.review(true);assert.equal(f.adapter.isRegradeMode(),true);
});
test('五岳原站固定地址下切题会改变方案绑定',()=>{
    const f=setup(), first=f.adapter.getTaskIdentifier();
    f.sb.sessionStorage.setItem('TaskParams',JSON.stringify({...f.task,queNo:'17'}));
    assert.notEqual(f.adapter.getTaskIdentifier(),first);
    f.sb.sessionStorage.setItem('TaskParams','invalid');assert.equal(f.adapter.getTaskIdentifier(),null);
});
test('五岳图片身份保留考生查询参数，刷新签名保持同卷',()=>{
    const f=setup(), first=f.adapter.getPaperIdentity();
    f.image.src=f.image.src.replace('signature=old','signature=new');
    assert.equal(f.adapter.getPaperIdentity(),first);
    f.image.src=f.image.src.replace('stuNo=A','stuNo=B');
    assert.notEqual(f.adapter.getPaperIdentity(),first);
    assert.equal(f.adapter.fillScores([2]),false,'未经原站确认的新图不能填分');
});
test('五岳答卷图片未加载完整时不读取，不回退到预取卷',async()=>{
    const f=setup();f.image.complete=false;
    assert.equal(f.adapter.getPaperIdentity(),null);assert.equal((await f.adapter.gatherAnswerImages()).length,0);
    assert.equal(f.adapter.fillScores([2]),false);
});
test('五岳同图清空及0分均不报告换卷',async()=>{
    const f=setup();f.sb.__AI_MARKER_WAIT_WINDOW_MS__=120;
    for(const value of ['','0']) {
        f.fields[0]._v=value;
        assert.equal(await f.adapter.waitForNextPaper(f.image.src,{paperId:f.adapter.getPaperIdentity()}),false);
    }
});
test('五岳保存成功回执后才确认，重复提交仅发送一次',async()=>{
    const f=setup();f.adapter.fillScores([2]);f.delay();
    const pending=f.adapter.submitGrade();assert.equal(await f.adapter.submitGrade(),false);
    let completed=false;pending.then(()=>completed=true);
    await new Promise(resolve=>setTimeout(resolve,5));assert.equal(completed,false);
    f.latest().respond({code:200,datas:{saveResponse:{code:200}}});
    assert.equal(await pending,true);assert.equal(f.sent.length,1);
    assert.equal(await f.adapter.submitGrade(),false);
});
test('五岳服务器拒绝与业务保存失败均不确认成功',async()=>{
    for(const body of [{code:500},{code:200,datas:{saveResponse:{code:500}}},{code:200,datas:{}}]) {
        const f=setup();f.response(body);f.adapter.fillScores([2]);
        assert.equal(await f.adapter.submitGrade(),false);assert.ok(f.adapter.lastSubmitError);
    }
});
test('五岳另一答卷的成功响应不能冒充当前答卷的保存回执',async()=>{
    const f=setup();f.delay();f.adapter.fillScores([2]);
    const normal=f.button.click;
    f.button.click=()=>{
        const xhr=new f.sb.XMLHttpRequest();xhr.open('POST','https://pcmarking.wylkyj.com/api/v1/marking/SaveAndInit');
        xhr.send(JSON.stringify({id:'paper-B',esubNo:'subject',queNo:'16',IsArb:false,score:2}));
        xhr.respond({code:200,datas:{saveResponse:{code:200}}});normal();
    };
    let completed=false;const pending=f.adapter.submitGrade();pending.then(()=>completed=true);
    await new Promise(resolve=>setTimeout(resolve,5));assert.equal(completed,false);
    f.latest().respond({code:200,datas:{saveResponse:{code:200}}});assert.equal(await pending,true);
});
test('五岳取消等待会清理保存监听，停止后不再提交',async()=>{
    const f=setup();f.delay();f.adapter.fillScores([2]);
    const controller=new AbortController();const pending=f.adapter.submitGrade({signal:controller.signal});
    controller.abort();assert.equal(await pending,false);assert.equal(f.adapter._submitting,false);
    assert.equal(await f.adapter.submitGrade({signal:controller.signal}),false);assert.equal(f.sent.length,1);
});
test('五岳确认前切题、换卷、改分或进入回评均拒绝提交',async()=>{
    for(const action of [f=>f.sb.sessionStorage.setItem('TaskParams',JSON.stringify({...f.task,queNo:'17'})),
        f=>f.image.src=f.image.src.replace('stuNo=A','stuNo=B'),f=>f.fields[0]._v='3',f=>f.review(true)]) {
        const f=setup();f.adapter.fillScores([2]);action(f);
        assert.equal(await f.adapter.submitGrade(),false);assert.equal(f.sent.length,0);
    }
});
test('五岳域名边界拒绝相似外站',()=>{
    for(const host of ['evilwylkyj.com','wylkyj.com.example.org']) {
        const sb=M.makeStub({host});assert.deepEqual(M.loadOne(sb,'wuyue').errors,[]);
        assert.equal(sb.__AI_MARKER_ADAPTER__,undefined);
    }
});
