'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {rewriteInstallation} = require('./install.cjs');
const original = 'https://auto-update.aimarking.five-plus-one.com/ota/dev/prtest/187.user.js';
const canonical = original.replace('/prtest/','/prtest/forgejo/');
const manifest = {version:'0.0.187-prtest.1794737300781',channel:'prtest',downloadUrl:original,changelog:{unchanged:['original']}};
function script(newline='\n') {
  return Buffer.concat([Buffer.from(['// ==UserScript==','// @name Original source','// @version '+manifest.version,
    '// @downloadURL  '+original,'// @updateURL    '+original,'// ==/UserScript==',''].join(newline)),
    Buffer.from([0xff,0x00,0x2f,0x2f,0xe4,0xb8,0xad,0xe6,0x96,0x87])]);
}
function body(bytes) {
  const marker=Buffer.from('// ==/UserScript==');return bytes.subarray(bytes.indexOf(marker)+marker.length);
}
test('canonical PR installation changes exactly the two header URLs and manifest URL',()=>{
  const input=script();const output=rewriteInstallation(input,manifest,187);
  assert.equal(output.installationURL,canonical);
  assert.equal(output.manifest.downloadUrl,canonical);
  assert.deepEqual({...output.manifest,downloadUrl:original},manifest);
  assert.deepEqual(body(output.script),body(input));
  const header=output.script.subarray(0,output.script.indexOf(Buffer.from('// ==/UserScript=='))).toString();
  assert.match(header,/@downloadURL  .*\/forgejo\/187.user.js/);
  assert.match(header,/@updateURL    .*\/forgejo\/187.user.js/);
  assert.match(header,new RegExp('@version '+manifest.version.replaceAll('.','\\.')));
});
test('canonical installation is idempotent and preserves CRLF body bytes',()=>{
  const first=rewriteInstallation(script('\r\n'),manifest,'187');
  const second=rewriteInstallation(first.script,first.manifest,187);
  assert.deepEqual(second,first);
  assert.deepEqual(body(first.script),body(script('\r\n')));
});
test('wrong source URLs, manifest identity and duplicate metadata are rejected',()=>{
  assert.throws(()=>rewriteInstallation(script(),{...manifest,downloadUrl:original.replace('187','411')},187));
  assert.throws(()=>rewriteInstallation(script(),{...manifest,version:'0.0.411'},187));
  assert.throws(()=>rewriteInstallation(script(),{...manifest,channel:'stable'},187));
  const duplicate=Buffer.from(script().toString().replace('// @updateURL','// @downloadURL '+original+'\n// @updateURL'));
  assert.throws(()=>rewriteInstallation(duplicate,manifest,187));
  assert.throws(()=>rewriteInstallation(Buffer.from(script().toString().replace('@updateURL    '+original,'@updateURL    https://example.com/script.js')),manifest,187));
});
test('only positive exact PR numbers can select the installation path',()=>{
  for(const n of [0,-1,'../411','0187','187\n','9'.repeat(20)]) assert.throws(()=>rewriteInstallation(script(),manifest,n));
});
