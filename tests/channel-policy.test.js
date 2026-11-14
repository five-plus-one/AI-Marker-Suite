const test = require('node:test');
const assert = require('node:assert/strict');
const {env,load,vm}=require('./_audit-harness');
test('稳定渠道运行快照隔离预览选项并保持保存数据',()=>{
 const e=env(); e.sb.SCRIPT_CONFIG.CHANNEL='stable';
 Object.assign(e.cfg,{outputMode:'score-only',scoring:{maxScore:10,outputMode:'score-only'},questionGuard:{enabled:true},paperGuard:{enabled:false},humanPacing:{enabled:true,rest:{enabled:true}}});
 const before=JSON.stringify(e.cfg);
 const ctx=vm.runInContext('createGradingContext()',e.sb);
 assert.equal(ctx.configuration.outputMode,'detailed');assert.equal(ctx.configuration.scoring.outputMode,'detailed');
 assert.equal(ctx.questionGuardEnabled,false);assert.equal(ctx.paperGuardEnabled,true);assert.equal(ctx.configuration.humanPacing.enabled,false);
 assert.equal(JSON.stringify(e.cfg),before);
 load(e,'src/core/prompt.js');assert.equal(vm.runInContext('isScoreOnlyMode(PresetManager.getCurrentConfig())',e.sb),false);
 e.sb.SCRIPT_CONFIG.CHANNEL='preview';
 const preview=vm.runInContext('createGradingContext()',e.sb);
 assert.equal(preview.configuration.outputMode,'score-only');assert.equal(preview.questionGuardEnabled,true);
 assert.equal(vm.runInContext('isScoreOnlyMode(PresetManager.getCurrentConfig())',e.sb),true);
});
test('空白检测确认窗口使用本卷识别状态',async()=>{
 const e=env();load(e,'src/core/main.js');
 e.state.currentStudentAnswer='上一份答案';e.cfg.blankDetection={enabled:true,threshold:0.1};
 e.sb.BlankDetector={loadReference:()=>({thresholds:[],ratios:[]}),calcBatchRatios:async()=>[],isBlankSheet:()=>({isBlank:true})};
 let observed;e.sb.showAutoSubmitDialog=()=>{observed=e.state.currentStudentAnswer;};
 await e.sb.startAutoGrading();assert.equal(observed,'空白答题卡');assert.deepEqual(e.calls.fill[0].scores,[0]);
});
