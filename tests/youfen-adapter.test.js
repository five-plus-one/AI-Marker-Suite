const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/adapters/youfen/adapter.js'), 'utf8');
function setup(options = {}) {
    const path = 'https://xzb-onlinemarking.oss-cn-beijing.aliyuncs.com/liankao/testdb/24/DILI';
    class Input {
        constructor(max = 5) { this.dataset = {max: String(max), min:'0', seg:'1.0'}; this._v = ''; }
        get value() { return this._v; } set value(v) { this._v = String(v); }
        closest() { return {firstElementChild:{textContent:'16.2.'}}; }
        removeAttribute() {} getClientRects() { return [1]; }
    }
    const input = new Input(); const inputs = [input];
    const img = {complete:true, naturalWidth:1478, naturalHeight:290, src:'data:image/png;base64,abc', getClientRects:()=>[1]};
    const auto = {checked:true}, old = {textContent:''}, score = {textContent:''};
    const w = {HTMLInputElement:Input, project:{dataBaseName:'testdb',proId:24,subId:11}, question:{questionIndex:2,arb:'default',xzt:'0'},
        currentItem:{saveType:1,path,mode:0,index:2,title:'16.2',maxScore:5,minScore:0,interval:1,optionalTitle:'0',stepSet:'',rect:'0-90-1243-1478-290'},
        currentPaper:{id:320,examCode:'24930011',url:'0.tif;1.tif',proId:24,subId:'11',questionIndex:'2',optionalTitle:'0',dataBaseName:'testdb',path,mode:0,scoreMode:0,arb:'default',date:null,stepScore:null},
        panelFlag:0,commitable:true,keyEnabled:true,drawTag:'default',paperTag:'default',direction:1};
    let clicks = 0, sent = null, prefilter, active;
    const button = {disabled:false,getClientRects:()=>[1],click(){
        clicks++;
        const payload = {...w.currentPaper, score:inputs.reduce((n,i)=>n+Number(i.value),0), stepScore:inputs.map(i=>i.value).join(',')};
        options.mutatePayload?.(payload); sent = payload;
        const url='/Service/MarkService.asmx/PostPaper';
        const xhr={abort(){this.aborted=true;},done(fn){this.onDone=fn;return this;},fail(fn){this.onFail=fn;return this;}};
        active=xhr; prefilter({url},{data:JSON.stringify(payload)},xhr);
        if (options.noResponse) return;
        if (options.networkError) xhr.onFail?.();
        else xhr.onDone?.(options.response || {result:1});
    }};
    w.location={host:'liankao.1000cb.com',hostname:'liankao.1000cb.com',pathname:'/Home/Mark',href:'http://liankao.1000cb.com/Home/Mark',origin:'http://liankao.1000cb.com'};
    w.document={querySelectorAll:selector=>selector==='.modal.in'?[]:inputs,
        querySelector:selector=>({'#scorePanel':{},'#imgPaper':img,'#chkAutoPost':auto,'#scoreOld':old,'#score':score,'#btnSumScore':button}[selector] || null)};
    w.ChangePanelFlag=()=>{w.panelFlag=1;input.value='';};
    w.jQuery={ajaxPrefilter:fn=>{prefilter=fn;}};
    const ctx={window:w,unsafeWindow:w,URL,document:w.document,location:w.location,
        setTimeout:fn=>{fn();return 1;},fetchImageAsBase64:async()=>{options.onFetch?.(w);return 'base64';}};
    vm.runInNewContext(source,ctx);
    const a=w.__AI_MARKER_ADAPTER__;
    return {a,w,input,inputs,img,auto,old,button,clicks:()=>clicks,sent:()=>sent,active:()=>active};
}
async function fill(s, scores=[4]) { assert.equal(await s.a.prepareGrading(),true);assert.equal((await s.a.gatherAnswerImages()).length,1);return s.a.fillScores(scores); }
test('task identity excludes workload counters and changes with scoring settings',()=>{const s=setup(), key=s.a.getTaskIdentifier();s.w.currentItem.myPapers=20;assert.equal(s.a.getTaskIdentifier(),key);s.w.currentItem.interval=.5;assert.notEqual(s.a.getTaskIdentifier(),key);});
test('native crop uses the correct file, exam and rectangle',async()=>{const s=setup();const urls=await s.a.gatherAnswerImages();assert.equal(urls[0],'https://xzb-onlinemarking.oss-cn-beijing.aliyuncs.com/liankao/testdb/24/DILI/24930011/0.tif?x-oss-process=image/format,png/crop,x_90,y_1243,w_1478,h_290');});
test('fill changes native inputs and total without saving',async()=>{const s=setup();assert.equal(await fill(s),true);assert.equal(s.input.value,'4');assert.equal(s.w.document.querySelector('#score').textContent,'得分：4');assert.equal(s.auto.checked,false);assert.equal(s.clicks(),0);});
test('zero is valid',async()=>{const s=setup();assert.equal(await fill(s,[0]),true);assert.equal(await s.a.submitGrade(),true);assert.equal(s.sent().score,0);});
test('reject invalid range, fractional interval, numeric strings and missing units',async()=>{for(const values of [[-1],[6],[1.5],[NaN],[Infinity],['4'],[],[2,2]]){const s=setup();assert.equal(await fill(s,values),false);assert.equal(await s.a.submitGrade(),false);assert.equal(s.clicks(),0);}});
test('reject changed paper before fill and before submit',async()=>{for(const phase of ['fill','submit']){const s=setup();await fill(s);s.w.currentPaper.examCode='24930012';assert.equal(phase==='fill'?s.a.fillScores([4]):await s.a.submitGrade(),false);assert.equal(s.clicks(),0);}});
test('snapshot required before fill',()=>{const s=setup();assert.equal(s.a.fillScores([4]),false);});
test('empty input cannot submit a filled zero',async()=>{const s=setup();await fill(s,[0]);s.input.value='';assert.equal(await s.a.submitGrade(),false);});
test('positive server receipt required and cannot submit twice',async()=>{const s=setup();await fill(s);assert.equal(await s.a.submitGrade(),true);assert.equal(await s.a.submitGrade(),false);assert.equal(s.clicks(),1);});
test('server failures and network failures do not count as saved',async()=>{for(const options of [{response:{result:-100}},{response:{result:-1}},{response:{}},{networkError:true},{noResponse:true}]){const s=setup(options);await fill(s);assert.equal(await s.a.submitGrade(),false);assert.equal(s.a._submitted,null);}});
test('mismatched request cannot confirm another score or paper',async()=>{for(const field of ['score','id','examCode','questionIndex','dataBaseName','stepScore','proId','subId','arb','optionalTitle']){const s=setup({mutatePayload:p=>{p[field]='invalid';}});await fill(s);assert.equal(await s.a.submitGrade(),false);assert.equal(s.active().aborted,true);}});
test('unready timer and disabled submit do not save',async()=>{for(const field of ['timer','button']){const s=setup();await fill(s);if(field==='timer')s.w.commitable=false;else s.button.disabled=true;assert.equal(await s.a.submitGrade(),false);assert.equal(s.clicks(),0);}});
test('guard cancellation and verification-time paper switch prevent save',async()=>{const s=setup();await fill(s);assert.equal(await s.a.submitGrade({signal:{aborted:false},isCurrent:()=>true,verify:async()=>{s.w.currentPaper.id++;}}),false);assert.equal(s.clicks(),0);});
test('loading, wrong crop, regrade, other modes and foreign image hosts are rejected',()=>{for(const mutate of [s=>s.img.complete=false,s=>s.img.naturalWidth=1,s=>s.w.currentPaper.date='today',s=>s.w.currentPaper.stepScore='4',s=>s.old.textContent='已评分：4',s=>s.w.drawTag='sum',s=>s.w.paperTag='arb',s=>s.w.currentPaper.questionIndex=3,s=>s.w.currentItem.path='https://example.com/',s=>s.w.currentItem.rect='0-1-2-3',s=>s.w.currentPaper.url='../0.tif']){const s=setup();mutate(s);assert.equal(s.a.getPaperIdentity(),null);}});
test('image fetch works with detached receiver and rejects a switch during download',async()=>{const s=setup();let urls=await s.a.gatherAnswerImages();const fetch=s.a.fetchImageAsBase64;assert.equal(await fetch(urls[0]),'base64');const changed=setup({onFetch:w=>{w.currentPaper.id++;}});urls=await changed.a.gatherAnswerImages();await assert.rejects(changed.a.fetchImageAsBase64(urls[0]),/答卷已切换/);});
test('next paper requires saved receipt, changed business identity and stable image',async()=>{const s=setup();await fill(s);assert.equal(await s.a.waitForNextPaper(),false);assert.equal(await s.a.submitGrade(),true);assert.equal(await s.a.waitForNextPaper(),false);s.w.currentPaper={...s.w.currentPaper,id:321,examCode:'24930012'};assert.equal(await s.a.waitForNextPaper(),true);assert.equal(await s.a.waitForNextPaper(null,{signal:{aborted:true}}),false);});

test('step scoring preserves unit order and validates each maximum',async()=>{const s=setup();s.w.currentItem.stepSet='a:2,b:3';s.inputs.splice(0,1,new s.w.HTMLInputElement(2),new s.w.HTMLInputElement(3));await s.a.gatherAnswerImages();assert.equal(s.a.fillScores([3,2]),false);assert.equal(s.a.fillScores([2,3]),true);assert.equal(await s.a.submitGrade(),true);assert.equal(s.sent().stepScore,'2,3');assert.equal(s.sent().score,5);});
test('multiple native crops preserve page order and validate layout',async()=>{const s=setup();s.w.currentItem.rect='0-0-0-50-30,1-0-0-50-20';s.img.naturalWidth=50;s.img.naturalHeight=50;const urls=await s.a.gatherAnswerImages();assert.equal(urls.length,2);assert.ok(urls[0].includes('/0.tif?'));assert.ok(urls[1].includes('/1.tif?'));s.img.naturalHeight=30;assert.equal(s.a.getPaperIdentity(),null);});

