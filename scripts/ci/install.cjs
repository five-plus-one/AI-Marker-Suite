'use strict';
const C = require('./common.cjs');

function rewriteInstallation(script, manifest, number) {
  C.invariant(/^[1-9]\d*$/.test(String(number)) && Number.isSafeInteger(Number(number)) && String(Number(number)) === String(number), 'Expected an internal PR number');
  C.invariant(Buffer.isBuffer(script), 'Expected userscript bytes');
  const opening = Buffer.from('// ==UserScript==');
  const marker = Buffer.from('// ==/UserScript==');
  const end = script.indexOf(marker);
  C.invariant(script.subarray(0,opening.length).equals(opening) &&
    [10,13].includes(script[opening.length]), 'Expected a userscript metadata block');
  C.invariant(end > 0, 'Expected complete userscript metadata');
  const boundary = end + marker.length;
  const originalHeader = script.subarray(0,boundary);
  let header = originalHeader.toString('utf8');
  C.invariant(Buffer.from(header,'utf8').equals(originalHeader), 'Expected UTF-8 userscript metadata');
  const body = script.subarray(boundary);
  const versions = [...header.matchAll(/^\/\/[ \t]+@version[ \t]+([^\r\n]+)/gm)];
  C.invariant(versions.length === 1 && versions[0][1].trim() === manifest.version && manifest.channel === 'prtest', 'PR metadata version differs from manifest');
  const prefix = 'https://auto-update.aimarking.five-plus-one.com/ota/dev/prtest/';
  const original = prefix + number + '.user.js';
  const canonical = prefix + 'forgejo/' + number + '.user.js';
  C.invariant([original,canonical].includes(manifest.downloadUrl), 'Unexpected PR manifest installation URL');
  for (const name of ['downloadURL','updateURL']) {
    const pattern = new RegExp('^(//[ \\t]+@' + name + '[ \\t]+)([^\\r\\n]+)$','gm');
    const fields = [...header.matchAll(pattern)];
    C.invariant(fields.length === 1 && [original,canonical].includes(fields[0][2].trim()), 'Unexpected PR ' + name);
    header = header.replace(pattern, (_line,key,value) => key + canonical + (value.match(/[ \t]*$/)?.[0] || ''));
  }
  const output = Buffer.concat([Buffer.from(header,'utf8'),body]);
  C.invariant(output.subarray(output.indexOf(marker)+marker.length).equals(body), 'Userscript body changed');
  return {script:output,manifest:{...manifest,downloadUrl:canonical},installationURL:canonical};
}

function configure(number, root=process.cwd()) {
  const directory = C.path.join(root,'dist');
  C.invariant(C.fs.lstatSync(directory).isDirectory(), 'Expected a regular build directory');
  const script = C.path.join(directory,'ai_marker.user.js'), manifest = C.path.join(directory,'manifest.json');
  for (const file of [script,manifest]) C.invariant(C.fs.lstatSync(file).isFile(), 'Expected regular build files');
  const result = rewriteInstallation(C.fs.readFileSync(script),C.json(manifest),number);
  C.fs.writeFileSync(script,result.script);
  C.writeJson(manifest,result.manifest);
  return result.installationURL;
}

module.exports = {rewriteInstallation,configure};
