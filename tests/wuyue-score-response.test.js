const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const chemistry=require('./fixtures/wuyue-chemistry.json');
const sandbox={console:{log(){},warn(){}},window:{},document:null};
vm.createContext(sandbox);
for(const file of ['score','prompt'])vm.runInContext(fs.readFileSync(path.join(__dirname,`../src/core/${file}.js`),'utf8'),sandbox);
const parse=text=>sandbox.parseSubQuestionResponse(text,{subQuestions:chemistry.units});
const intro='【作答状态】\n可辨认\n【答案复述】\n'+chemistry.cases['workflow-solid'].answer+'\n【评分依据】\n按各问实际作答给分。\n';
test('化学题组明确的括号小题分数标题可以解析',()=>{
    const result=parse(intro+'【（4）分数】\n2\n【（5）分数】2\n【（6）分数】：2\n【得分】6');
    assert.equal(result.score,6);
    assert.deepEqual(Array.from(result.subScores,x=>x.score),[2,2,2]);
});
test('化学答案中的2.5、4、293不能冒充分数，缺一问仍待核对',()=>{
    assert.equal(parse(intro).score,null);
    assert.equal(parse(intro+'（4）分数：2\n（5）分数：2\n【得分】6').score,null);
});
test('化学题组重复分数字段一致才接受，冲突保留待核对',()=>{
    const text=intro+'（4）分数：2\n（5）分数：2\n（6）分数：2\n';
    assert.equal(parse(text+'【（4）分数】2\n【得分】6').score,6);
    assert.equal(parse(text+'【（4）分数】1\n【得分】6').score,null);
});
