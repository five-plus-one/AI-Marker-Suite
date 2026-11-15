'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('./common.cjs');
const {infrastructureChange}=require('./build.cjs');
test('only named branch pushes and manual runs may deploy',()=>{
  for(const target of ['dev','preview','stable','docs']) {
    const ref='refs/heads/'+(target==='docs'?'main':target);
    assert.equal(C.trustedBranch({eventName:'push',ref},target),true);
    assert.equal(C.trustedBranch({eventName:'workflow_dispatch',ref},target),true);
    for(const eventName of ['pull_request','pull_request_target','workflow_run']) assert.equal(C.trustedBranch({eventName,ref},target),false);
    assert.equal(C.trustedBranch({eventName:'push',ref:'refs/heads/codex/internal-delivery'},target),false);
  }
});
test('same-version delivery excludes all product files',()=>{
  for(const file of ['src/core/config.js','src/core/main.js','src/adapters/wuyue/adapter.js','build.js','package.json','package-lock.json','tests/runtime.test.js'])
    assert.equal(infrastructureChange('M',file),false);
  assert.equal(infrastructureChange('D','.github/workflows/build.yml'),true);
  assert.equal(infrastructureChange('M','.github/workflows/build.yml'),false);
  assert.equal(infrastructureChange('A','.forgejo/workflows/ci.yml'),true);
  assert.equal(infrastructureChange('A','scripts/ci/deploy.cjs'),true);
});
test('source identity uses full SHAs and explicit PR targets',()=>{
  assert.throws(()=>C.sha('short'));
  assert.throws(()=>C.sha('a'.repeat(39)+';'));
  assert.equal(C.sha('a'.repeat(40)),'a'.repeat(40));
  assert.equal(C.targetFor({name:'AI-Marker-Suite',eventName:'pull_request',event:{pull_request:{number:12,base:{ref:'dev'}}}}),'pr-12');
  assert.throws(()=>C.targetFor({name:'AI-Marker-Suite',eventName:'pull_request',event:{pull_request:{number:'../stable',base:{ref:'dev'}}}}));
});
