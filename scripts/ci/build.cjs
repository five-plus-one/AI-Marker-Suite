'use strict';
const C = require('./common.cjs');
const {execFileSync} = require('node:child_process');
const {verifyStableVersion,compareVersions} = require('../verify-stable-version.cjs');
function infrastructureChange(status, file) {
  if (file.startsWith('.github/workflows/')) return status === 'D';
  return file.startsWith('.forgejo/') || file.startsWith('scripts/ci/') ||
    ['.gitignore','CLAUDE.md','CONTRIBUTING.md','README.md','tests/release-gates.test.js','scripts/verify-browser.cjs'].includes(file);
}
function stableGuard() {
  const source = C.fs.readFileSync('src/core/config.js','utf8');
  const version = source.match(/VERSION\s*:\s*['"]([^'"]+)['"]/)[1];
  const tags = execFileSync('git',['tag','--merged','HEAD','--list','v*'],{encoding:'utf8'}).trim().split(/\r?\n/)
    .filter(tag => /^v\d+\.\d+\.\d+(?:\.\d+)?$/.test(tag))
    .sort((a,b) => compareVersions(b.slice(1),a.slice(1)));
  if (!tags.length || compareVersions(version,tags[0].slice(1)) > 0) {
    verifyStableVersion(version,tags[0]?.slice(1)); return;
  }
  C.invariant(version === tags[0].slice(1), 'Stable version is older than the latest reachable release');
  const changes = execFileSync('git',['diff','--no-renames','--name-status','-z',tags[0],'HEAD'],{encoding:'utf8'}).split('\0').filter(Boolean);
  for (let index=0;index<changes.length;index+=2) {
    C.invariant(infrastructureChange(changes[index],changes[index+1]), 'Same-version deployment includes a product change: ' + changes[index+1]);
  }
  console.log('Stable infrastructure revision keeps release version ' + version);
}
async function main() {
  const ctx = C.context();
  C.invariant(Number(process.versions.node.split('.')[0]) >= 22, 'Node 22 or newer is required');
  C.invariant(C.fs.existsSync(process.env.CHROME_BIN || '/usr/bin/chromium'), 'Chromium is required');
  const release = process.argv.includes('--release');
  const target = release ? 'stable' : C.targetFor(ctx);
  const pr = ctx.eventName === 'pull_request' ? ctx.event.pull_request : null;
  const commit = C.sha(pr ? pr.head.sha : ctx.sha);
  C.invariant(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim() === commit, 'Checkout differs from source revision');
  if (!pr && !release && ctx.ref === 'refs/heads/stable') stableGuard();
  C.npm(['ci']);
  C.npm(['audit','--audit-level=low']);
  C.run(process.execPath,['--test',C.path.join(__dirname,'policy.test.cjs'),C.path.join(__dirname,'compat.test.cjs'),C.path.join(__dirname,'release.test.cjs')]);
  C.npm(['test']);
  const build = String(Date.now());
  const channel = target.startsWith('pr-') ? 'prtest' : target;
  const args = ['run','build','--','--channel=' + channel,'--build=' + build];
  if (pr && channel === 'prtest') args.push('--pr=' + (pr.number ?? ctx.event.number));
  if (release) {
    C.invariant(ctx.eventName === 'push' && /^refs\/tags\/v\d+\.\d+\.\d+(?:\.\d+)?$/.test(ctx.ref), 'Expected a version tag push');
    const version = C.fs.readFileSync('src/core/config.js','utf8').match(/VERSION\s*:\s*['"]([^'"]+)['"]/)[1];
    C.invariant(ctx.ref === 'refs/tags/v' + version, 'Tag differs from source version');
  }
  C.npm(args);
  C.npm(['run','verify:bundle']);
  C.run(process.execPath,[C.path.join(__dirname,'browser.cjs')]);
  const manifest = C.json('dist/manifest.json');
  if (release) C.invariant(ctx.ref === 'refs/tags/v' + manifest.version, 'Tag differs from built version');
  const stage = C.path.join(C.OUTPUT,'payload');
  C.fs.mkdirSync(stage,{recursive:true});
  for (const name of ['ai_marker.user.js','manifest.json']) {
    C.fs.copyFileSync('dist/' + name,C.path.join(stage,name));
    C.fs.copyFileSync('dist/' + name,C.path.join(C.OUTPUT,name));
  }
  C.packageDelivery(stage,{repository:ctx.name,commit,target,version:manifest.version,build}, {
    run:ctx.run, event:ctx.eventName, pr:pr ? Number(pr.number ?? ctx.event.number) : undefined,
    headRepository:pr?.head.repo.full_name, headRepositoryId:pr?.head.repo.id
  });
  require('./release.cjs').writeNotes(manifest,target);
  console.log('Verified delivery for ' + target + ' at ' + commit);
}
if (require.main === module) C.cli(main);
module.exports = {infrastructureChange,stableGuard};
