const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/adapters/xiaoleyouyue/adapter.js'), 'utf8');
function setup(options = {}) {
    class Input {
        constructor(title = '17(3.4)', max = 3) { this._value = ''; this.title = title; this.placeholder = `满分${max}分`; }
        get value() { return this._value; } set value(v) { this._value = String(v); }
        closest() { return { firstElementChild: { textContent: this.title } }; }
        getClientRects() { return [1]; }
    }
    const input = new Input(), inputs = [input], auto = { checked: true }, keyboard = { checked: true };
    keyboard.nextElementSibling = { click() { keyboard.checked = true; } };
    const url = 'https://yyaitantao.oss-cn-shenzhen.aliyuncs.com/fixture-1.png?x-oss-process=image%2Fcrop%2Cw_300%2Ch_80%2Cx_0%2Cy_0';
    const images = [{ src: url, complete: true, naturalWidth: 300, naturalHeight: 80, getClientRects: () => [1] }];
    const w = { location: new URL('https://yy.eduer.co/pages/exam/review/review.aspx?subjectid=10&blockid=20&id=30&type=0'),
        HTMLInputElement: Input, pageQuestionList: [{id:40,title:'17(3.4)',score:3,step:{type:0,score:''},koufen:false}],
        pageKey:'fixture-1', pageIndex:{cur:8,max:8},pageIsNew:true,pageLocking:false,
        pagePaperBasicSize:[{width:300,height:80}],getComputedStyle:()=>({display:'block',visibility:'visible'}),
        changeReviewTotal(){},layui:{form:{render(){}}}};
    let prefilter, clicks = 0, sent, active, blocked = false;
    function request(data, result) {
        const xhr = { done(fn){this.onDone=fn;return this;},fail(fn){this.onFail=fn;return this;},abort(){this.aborted=true;} };
        prefilter({url:'/pages/ReviewAction.ashx'},{data},xhr);
        active = xhr;
        if (result !== undefined) xhr.onDone?.(result);
        return xhr;
    }
    w.jQuery = { ajaxPrefilter(fn){prefilter=fn;} };
    const button = { getClientRects:()=>[1],click(){
        clicks++;
        const p = new URLSearchParams({subjectid:'10',blockid:'20',taskid:'30',type:'0',key:w.pageKey,code:'11',
            scores:JSON.stringify(w.pageQuestionList.map((q,i)=>({id:q.id,score:Number(inputs[i].value)})))});
        options.mutatePayload?.(p); sent=p;
        const xhr=request(p.toString());
        if(options.noResponse) return;
        if(options.networkError) xhr.onFail?.(); else xhr.onDone?.(options.response || {state:1});
    }};
    w.document = { querySelectorAll(sel){
        if(sel.startsWith('.layui-layer')) return blocked ? [{getClientRects:()=>[1]}] : [];
        if(sel === '.quickmenu > .qlist > li .score-input') return inputs;
        if(sel === '.review_body > ul > li > img') return images;
        return [];
    },querySelector(sel){return ({'.quickmenu > .qlist':{},'input[name="autosubmit"]':auto,
        'input[name="scoremethod"][value="1"]':keyboard,'.quickmenu a[data-action="14"]':button})[sel] || null;} };
    vm.runInNewContext(source,{window:w,unsafeWindow:w,URL,URLSearchParams,setTimeout:fn=>{fn();return 1;},fetchImageAsBase64:async()=>{options.onFetch?.(w);return 'base64';}});
    return {a:w.__AI_MARKER_ADAPTER__,w,input,inputs,images,auto,keyboard,button,request,clicks:()=>clicks,sent:()=>sent,active:()=>active,block:()=>{blocked=true;}};
}
async function fill(s,scores=[2]) {assert.equal(await s.a.prepareGrading(),true);assert.equal((await s.a.gatherAnswerImages()).length,1);return s.a.fillScores(scores);}
test('platform task follows native scoring items, not counters or answer key',()=>{const s=setup(),key=s.a.getTaskIdentifier();s.w.pageKey='other';s.w.pageIndex={cur:9,max:9};assert.equal(s.a.getTaskIdentifier(),key);assert.equal(s.a.getQuestionContext().question,'17(3.4)');s.w.pageQuestionList[0].score=4;assert.notEqual(s.a.getTaskIdentifier(),key);});
test('native combined item stays one unit with its actual maximum',()=>{const s=setup(),units=s.a.getScoreInputs();assert.equal(units.length,1);assert.equal(units[0].label,'17(3.4)');assert.equal(units[0].maxScore,3);});
test('prepare disables automatic saving and selects keyboard',async()=>{const s=setup();s.keyboard.checked=false;assert.equal(await fill(s),true);assert.equal(s.auto.checked,false);assert.equal(s.keyboard.checked,true);assert.equal(s.input.value,'2');assert.equal(s.clicks(),0);});
test('zero and two-decimal scores are valid when native interval is empty',async()=>{for(const score of [0,1.25,3]){const s=setup();assert.equal(await fill(s,[score]),true);assert.equal(await s.a.submitGrade(),true);assert.equal(JSON.parse(s.sent().get('scores'))[0].score,score);}});
test('invalid scores, wrong count and missing snapshots do not fill',async()=>{for(const scores of [[-1],[4],[1.001],[NaN],[Infinity],['2'],[],[1,1]]){const s=setup();assert.equal(await fill(s,scores),false);assert.equal(await s.a.submitGrade(),false);assert.equal(s.clicks(),0);}assert.equal(setup().a.fillScores([2]),false);});
test('native fixed values and intervals are both respected',async()=>{const s=setup();s.w.pageQuestionList[0].step={type:0,score:'.5'};assert.equal(s.a.getTaskIdentifier(),null);s.w.pageQuestionList[0].step.score='0.5';await s.a.gatherAnswerImages();s.auto.checked=false;assert.equal(s.a.fillScores([1.25]),false);assert.equal(s.a.fillScores([1.5]),true);s.w.pageQuestionList[0].step={type:1,score:'0,1,3'};await s.a.gatherAnswerImages();assert.equal(s.a.fillScores([2]),false);assert.equal(s.a.fillScores([3]),true);});
test('multi-item order and maximum validation match native question IDs',async()=>{const s=setup();s.w.pageQuestionList.push({id:41,title:'18(1)',score:5,step:{type:0,score:'1'},koufen:false});s.inputs.push(new s.w.HTMLInputElement('18(1)',5));await s.a.prepareGrading();await s.a.gatherAnswerImages();assert.equal(s.a.fillScores([4,2]),false);assert.equal(s.a.fillScores([2,4]),true);assert.equal(await s.a.submitGrade(),true);assert.deepEqual(JSON.parse(s.sent().get('scores')),[{id:40,score:2},{id:41,score:4}]);});
test('unready images, expanded regions, history and other review types block grading',()=>{for(const mutate of [s=>s.images[0].complete=false,s=>s.images[0].naturalWidth=1,s=>s.w.pageExpandOpen=true,s=>s.w.pageExpandLoading=true,s=>s.w.pageLocking=true,s=>s.w.pageIndex.cur=7,s=>s.w.pageIsNew=false,s=>s.w.location.search='?subjectid=10&blockid=20&id=30&type=1',s=>s.w.location.search+='&id=31',s=>s.w.pageQuestionList[0].koufen=true,s=>s.images[0].src='https://example.com/a.png',s=>s.block(),s=>s.input.placeholder='满分4分',s=>s.input.title='other',s=>s.w.pagePaperBasicSize=[]]){const s=setup();mutate(s);assert.equal(s.a.getPaperIdentity(),null);}});
test('paper changes at fill, verification or submit prevent save',async()=>{for(const phase of ['fill','submit','verify']){const s=setup();await fill(s);if(phase!=='verify')s.w.pageKey='other';const result=phase==='fill'?s.a.fillScores([2]):await s.a.submitGrade({verify:async()=>{if(phase==='verify')s.w.pageKey='other';}});assert.equal(result,false);assert.equal(s.clicks(),0);}});
test('changed input, re-enabled auto submit and empty zero cannot save',async()=>{for(const mutate of [s=>s.input.value='',s=>s.input.value='1',s=>s.auto.checked=true,s=>s.keyboard.checked=false,s=>s.button.disabled=true]){const s=setup();await fill(s,[0]);mutate(s);assert.equal(await s.a.submitGrade(),false);assert.equal(s.clicks(),0);}});
test('save requires positive native response and is consumed once',async()=>{for(const state of [1,2]){const s=setup({response:{state}});await fill(s);assert.equal(await s.a.submitGrade(),true);assert.equal(await s.a.submitGrade(),false);assert.equal(s.clicks(),1);}for(const opts of [{response:{state:0}},{response:{state:100}},{response:{}},{response:{state:'1'}},{networkError:true},{noResponse:true}]){const s=setup(opts);await fill(s);assert.equal(await s.a.submitGrade(),false);assert.equal(s.a._submitted,null);}});
test('mismatched score requests are aborted before transmission',async()=>{for(const field of ['subjectid','blockid','taskid','type','key','scores']){const s=setup({mutatePayload:p=>p.set(field,'invalid')});await fill(s);assert.equal(await s.a.submitGrade(),false);assert.equal(s.active().aborted,true);}});
test('cancellation prevents save and next-paper wait',async()=>{const s=setup();await fill(s);assert.equal(await s.a.submitGrade({signal:{aborted:true}}),false);assert.equal(s.clicks(),0);await fill(s);assert.equal(await s.a.submitGrade(),true);assert.equal(await s.a.waitForNextPaper(null,{signal:{aborted:true}}),false);});
test('read observer invalidates old papers during loading and history, even when native isNew stays true',()=>{const s=setup(),before=s.a.getPaperIdentity();const xhr=s.request('subjectid=10&blockid=20&taskid=30&type=0&code=21');assert.equal(s.a.getPaperIdentity(),null);xhr.onDone({state:1,data:{key:s.w.pageKey}});assert.equal(s.a.getPaperIdentity(),null);assert.ok(before);});
test('read receipt must match native key, image, dimensions and task',()=>{const s=setup();const result={state:1,data:{key:'fixture-2',papers:[{path:s.images[0].src,size:{width:300,height:80}}]}};s.request('subjectid=10&blockid=20&taskid=30&type=0&code=10',result);assert.equal(s.a.getPaperIdentity(),null);s.w.pageKey='fixture-2';assert.ok(s.a.getPaperIdentity());s.images[0].src=s.images[0].src.replace('fixture-1','fixture-2');assert.equal(s.a.getPaperIdentity(),null);});
test('next paper requires saved response and stable changed key',async()=>{const s=setup();await fill(s);assert.equal(await s.a.waitForNextPaper(),false);assert.equal(await s.a.submitGrade(),true);assert.equal(await s.a.waitForNextPaper(),false);s.w.pageKey='fixture-2';assert.equal(await s.a.waitForNextPaper(),true);assert.equal(await s.a.waitForNextPaper(null,{paperId:'wrong'}),false);});
test('multiple native images preserve order and must all finish loading',async()=>{const s=setup();s.images.push({...s.images[0],src:s.images[0].src.replace('fixture-1','fixture-2')});s.w.pagePaperBasicSize.push({width:300,height:80});const urls=await s.a.gatherAnswerImages();assert.equal(urls.length,2);assert.ok(urls[0].includes('fixture-1'));assert.ok(urls[1].includes('fixture-2'));s.images[1].complete=false;assert.equal(s.a.getPaperIdentity(),null);});
test('detached download verifies paper before and after image transfer',async()=>{const s=setup();let urls=await s.a.gatherAnswerImages();assert.equal(await s.a.fetchImageAsBase64(urls[0]),'base64');const t=setup({onFetch:w=>{w.pageKey='other';}});urls=await t.a.gatherAnswerImages();const detached=t.a.fetchImageAsBase64;await assert.rejects(detached(urls[0]),/答卷已切换/);});
