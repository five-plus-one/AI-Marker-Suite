'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const C = require('./common.cjs');
const B = require('./bootstrap.cjs');
test('project subprocesses cannot inherit workflow credentials or command files', () => {
  const input = {PATH:process.env.PATH,CI:'true',BASE_URL:'/',GITHUB_TOKEN:'secret',CUSTOM_API_SECRET:'secret',
    ACTIONS_RUNTIME_TOKEN:'secret',MARKER_DEPLOY_URL:'secret',GITHUB_ENV:'commands',GITHUB_OUTPUT:'output',GIT_CONFIG_VALUE_0:'secret'};
  assert.deepEqual(Object.keys(C.projectEnv(input)).sort(),['BASE_URL','CI','PATH']);
  const result = C.run(process.execPath,['-e','process.stdout.write(String(process.env.GITHUB_TOKEN))'],
    {stdio:'pipe',encoding:'utf8',env:{GITHUB_TOKEN:'secret'}});
  assert.equal(result,'undefined');
});
test('manual source checks bind the open PR, repository, allowed base and exact source', () => {
  const ctx = {repository:'fiveplusone-dev/AI-Marker-Suite',name:'AI-Marker-Suite'};
  const pr = {number:12,state:'open',merged:false,base:{ref:'dev',repo:{full_name:ctx.repository}},
    head:{sha:'a'.repeat(40),repo:{full_name:'fiveplusone-dev/AI-Marker-Suite'}}};
  assert.equal(B.validatePR(ctx,pr,'12','a'.repeat(40)),pr);
  for (const changed of [{state:'closed'},{merged:true},{number:13},
    {base:{ref:'codex/untrusted',repo:{full_name:ctx.repository}}},
    {head:{sha:'b'.repeat(40),repo:pr.head.repo}}]) assert.throws(()=>B.validatePR(ctx,{...pr,...changed},12,'a'.repeat(40)));
  assert.throws(()=>B.validatePR(ctx,pr,'12;echo','a'.repeat(40)));
  assert.equal(C.targetFor({name:'AI-Marker-Suite-Docs',eventName:'pull_request',event:{pull_request:{base:{ref:'docs-dev'}}}}),'docs');
});
test('hydration preserves source commits, business files and existing CI helpers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'ci-compat-test-'));
  const tools = path.join(root,'trusted'),source = path.join(root,'source');
  try {
    fs.mkdirSync(path.join(tools,'scripts/ci'),{recursive:true});
    fs.mkdirSync(path.join(source,'scripts'),{recursive:true});
    for (const file of ['package.json','build.js','tests/business.test.js','src/core/config.js']) {
      fs.mkdirSync(path.dirname(path.join(source,file)),{recursive:true});fs.writeFileSync(path.join(source,file),'original');
    }
    fs.writeFileSync(path.join(tools,'scripts/ci/build.cjs'),'trusted');
    execFileSync('git',['init','--quiet',source]);
    execFileSync('git',['-C',source,'add','.']);
    execFileSync('git',['-C',source,'-c','user.name=CI','-c','user.email=ci@example.invalid','commit','--quiet','-m','source']);
    const head = execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
    const old = process.env.CI_SOURCE_COMMIT;process.env.CI_SOURCE_COMMIT = head;
    try { B.hydrate(source,tools);B.hydrate(source,tools); } finally {
      if (old === undefined) delete process.env.CI_SOURCE_COMMIT;else process.env.CI_SOURCE_COMMIT=old;
    }
    assert.equal(fs.readFileSync(path.join(source,'scripts/ci/build.cjs'),'utf8'),'trusted');
    assert.equal(execFileSync('git',['-C',source,'diff','HEAD'],{encoding:'utf8'}),'');
    assert.equal(execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),head);
    fs.writeFileSync(path.join(source,'scripts/ci/build.cjs'),'existing');
    process.env.CI_SOURCE_COMMIT=head;
    try { B.hydrate(source,tools); } finally { if(old===undefined)delete process.env.CI_SOURCE_COMMIT;else process.env.CI_SOURCE_COMMIT=old; }
    assert.equal(fs.readFileSync(path.join(source,'scripts/ci/build.cjs'),'utf8'),'existing');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('workflow environment values reject injected command lines', () => {
  assert.throws(()=>B.exported('unused',{CI_SOURCE_COMMIT:'abc\nGITHUB_TOKEN=x'}));
});
test('delivery binds the tested source and trusted infrastructure inside and outside the archive', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ci-provenance-test-'));
  try {
    fs.mkdirSync(path.join(root,'payload'));fs.writeFileSync(path.join(root,'payload/app.js'),'source');
    const script='const C=require(process.argv[1]);C.packageDelivery("payload",{commit:"'+'a'.repeat(40)+'",target:"pr-12"});';
    execFileSync(process.execPath,['-e',script,path.join(__dirname,'common.cjs')],
      {cwd:root,env:{...process.env,CI_INFRASTRUCTURE_COMMIT:'b'.repeat(40)},stdio:'pipe'});
    const delivery=JSON.parse(fs.readFileSync(path.join(root,'ci-output/delivery.json')));
    assert.equal(delivery.testedSourceCommit,'a'.repeat(40));
    assert.equal(delivery.infrastructureCommit,'b'.repeat(40));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'payload/.delivery.json'))),delivery);
    const provenance=JSON.parse(fs.readFileSync(path.join(root,'ci-output/provenance.json')));
    assert.equal(provenance.commit,provenance.testedSourceCommit);assert.match(provenance.archiveSha256,/^[a-f0-9]{64}$/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
if (fs.existsSync(path.join(__dirname,'browser-ready.cjs'))) {
  test('browser endpoint repair keeps the complete fixture and assertion program', () => {
    const {patchReadiness}=require('./browser-ready.cjs');
    const old = "        for (let count = 0; count < 200 && !fs.existsSync(activePort); count++) await pause(100);\n" +
      "        if (!fs.existsSync(activePort)) throw Error('Chrome debugging endpoint unavailable');\n" +
      "        const [port, browserPath] = fs.readFileSync(activePort, 'utf8').trim().split(/\\r?\\n/);";
    const prefix='const fixtures = [\'original\'];\n',suffix='\nassert.equal(results.length,4);';
    const result=patchReadiness(prefix+old+suffix);
    assert.ok(result.startsWith(prefix) && result.endsWith(suffix));
    assert.ok(result.includes('fields[1]') && result.includes('await pause(100)'));
    assert.equal(patchReadiness(result),result);
  });
}
