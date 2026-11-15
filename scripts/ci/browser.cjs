'use strict';
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
async function main() {
  const source = fs.readFileSync('scripts/verify-browser.cjs','utf8');
  const literal = source.match(/const fixtures = (\[[\s\S]*?\])\s*\.filter/)?.[1];
  assert.ok(literal, 'Browser fixture matrix is required');
  assert.match(literal.replace(/'[a-z0-9-]+'/g,''), /^[\s,\[\]]+$/);
  const fixtures = [...literal.matchAll(/'([a-z0-9-]+)'/g)].map(match=>match[1]);
  assert.equal(new Set(fixtures).size, fixtures.length, 'Fixture names must be unique');
  // The existing acceptance command selects a fixture and its named descendants.
  const selectsDescendants = source.includes("fixture.startsWith(selected + '-')");
  const groups = selectsDescendants
    ? fixtures.filter(name=>!fixtures.some(parent=>name.startsWith(parent+'-')))
    : fixtures;
  const rows = []; let next=0, failure;
  async function worker() {
    while (next<groups.length && !failure) {
      const name=groups[next++];
      try {
        const result = await new Promise((resolve,reject)=>{
          const child=spawn(process.execPath,['scripts/verify-browser.cjs','--fixture='+name],{env:process.env,stdio:['ignore','pipe','pipe']});
          let stdout='',stderr='';
          child.stdout.on('data',data=>{stdout+=data});
          child.stderr.on('data',data=>{stderr+=data});
          child.on('error',reject);
          child.on('close',(code,signal)=>{
            if(code!==0)return reject(Error('Browser group '+name+' failed (exit '+code+', signal '+signal+'): '+stderr.slice(-4000)));
            try {resolve(JSON.parse(stdout))} catch {reject(Error('Invalid browser report: '+name))}
          });
        });
        assert.equal(result.passed,true);
        assert.ok(result.results.length>0);
        rows.push(...result.results);
        console.log('Browser group '+name+': '+result.results.length+' cases passed');
      } catch(error) {failure=error}
    }
  }
  await Promise.all(Array.from({length:2},worker));
  if(failure)throw failure;
  assert.deepEqual([...new Set(rows.map(row=>row.fixture))].sort(),[...fixtures].sort(),'All original fixtures must be covered');
  const keys=rows.map(row=>JSON.stringify([row.fixture,row.width,row.theme,row.touch]));
  assert.equal(new Set(keys).size,keys.length,'Browser cases must not overlap');
  assert.ok(rows.every(row=>row.passed===true));
  fs.mkdirSync('ci-output',{recursive:true});
  fs.writeFileSync('ci-output/browser-results.json',JSON.stringify({passed:true,fixtures:fixtures.length,results:rows}));
  console.log('Browser acceptance passed: '+fixtures.length+' fixtures, '+rows.length+' cases');
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
