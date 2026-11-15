'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const C = require('./common.cjs');
const branches = name => name === 'AI-Marker-Suite-Docs' ? ['docs-dev','main'] : ['dev','preview','stable'];
function validatePR(ctx, pr, requested, commit) {
  C.invariant(Number.isSafeInteger(Number(requested)) && Number(requested) > 0, 'Expected a PR number');
  C.invariant(pr.number === Number(requested) && pr.state === 'open' && !pr.merged, 'PR is no longer open');
  C.invariant(pr.base.repo.full_name === ctx.repository && branches(ctx.name).includes(pr.base.ref), 'Unexpected PR base');
  C.invariant(pr.head.sha === C.sha(commit), 'A newer PR revision is available');
  C.invariant(/^[\w.-]+\/[\w.-]+$/.test(pr.head.repo.full_name), 'Unexpected head repository');
  return pr;
}
function exported(file, values) {
  for (const [key,value] of Object.entries(values)) {
    C.invariant(!/[\r\n]/.test(String(value)), 'Invalid workflow environment value');
    fs.appendFileSync(file, key + '=' + value + '\n');
  }
}
async function resolve(ctx) {
  if (process.env.CI_DISPATCH_PR !== 'true') return ctx;
  C.invariant(ctx.eventName === 'workflow_dispatch', 'Expected a trusted manual PR check');
  const pr = validatePR(ctx, await C.api(ctx, '/repos/' + ctx.repository + '/pulls/' + Number(process.env.PR_NUMBER)),
    process.env.PR_NUMBER, process.env.SOURCE_COMMIT);
  C.invariant(ctx.ref === 'refs/heads/' + pr.base.ref, 'Manual PR checks run on the matching base');
  return {...ctx, eventName:'pull_request', sha:pr.head.sha, ref:'refs/pull/' + pr.number + '/head',
    event:{number:pr.number,pull_request:pr}, infrastructureCommit:C.sha(ctx.sha)};
}
async function status(ctx, state) {
  const pr = ctx.event.pull_request;
  C.invariant(pr && ['pending','success','failure','error'].includes(state), 'Expected a PR result');
  const current = await C.api(ctx,'/repos/' + ctx.repository + '/pulls/' + pr.number);
  validatePR(ctx,current,pr.number,pr.head.sha);
  const run = await C.api(ctx,'/repos/' + ctx.repository + '/actions/runs/' + ctx.run);
  C.invariant(run.id === Number(ctx.run) && Number.isSafeInteger(run.index_in_repo), 'Unexpected source check run');
  await C.apiJson(ctx,'/repos/' + ctx.repository + '/statuses/' + pr.head.sha,'POST', {
    state,context:'forgejo/trusted-ci',description:'Internal source checks: ' + state,
    target_url:ctx.server + '/' + ctx.repository + '/actions/runs/' + run.index_in_repo
  });
}
async function prepare() {
  const native = C.context();
  const ctx = await resolve(native);
  const root = path.resolve(process.argv[3] || '.');
  const infrastructureCommit = C.sha(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim());
  C.invariant(infrastructureCommit === C.sha(ctx.infrastructureCommit || ctx.event.pull_request?.base.sha || ctx.sha), 'Checkout differs from trusted infrastructure');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'aimarker-ci-'));
  fs.mkdirSync(path.join(temp,'scripts'),{recursive:true});
  fs.cpSync(path.join(root,'scripts/ci'),path.join(temp,'scripts/ci'),{recursive:true});
  if (fs.existsSync(path.join(root,'.forgejo'))) fs.cpSync(path.join(root,'.forgejo'),path.join(temp,'.forgejo'),{recursive:true});
  for (const file of ['verify-stable-version.cjs','verify-bundle.cjs','browser-interception.cjs']) {
    const source = path.join(root,'scripts',file);
    if (fs.existsSync(source)) fs.copyFileSync(source,path.join(temp,'scripts',file));
  }
  ctx.infrastructureCommit = infrastructureCommit;
  const contextPath = path.join(temp,'context.json');
  C.writeJson(contextPath,ctx);
  exported(process.env.GITHUB_ENV || process.env.FORGEJO_ENV, {
    CI_TOOLS:temp,CI_CONTEXT_PATH:contextPath,CI_INFRASTRUCTURE_COMMIT:infrastructureCommit,
    CI_SOURCE_COMMIT:ctx.event.pull_request?.head.sha || ctx.sha,
    CI_SOURCE_REPOSITORY:ctx.event.pull_request?.head.repo.full_name || ctx.repository
  });
  if (process.env.CI_DISPATCH_PR === 'true') await status(ctx,'pending');
}
function hydrate(root=process.cwd(), tools=process.env.CI_TOOLS) {
  C.invariant(tools && path.isAbsolute(tools), 'Trusted CI tools are required');
  const original = C.sha(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim());
  C.invariant(original === C.sha(process.env.CI_SOURCE_COMMIT), 'Checkout differs from requested source');
  const destination = path.join(root,'scripts/ci');
  C.invariant(fs.lstatSync(path.join(root,'scripts')).isDirectory(), 'Scripts directory must be regular');
  C.invariant(!fs.existsSync(destination) || !fs.lstatSync(destination).isSymbolicLink(), 'CI directory must be regular');
  if (!fs.existsSync(path.join(destination,'build.cjs'))) {
    fs.mkdirSync(destination,{recursive:true});
    for (const entry of fs.readdirSync(path.join(tools,'scripts/ci'))) {
      const target = path.join(destination,entry);
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(tools,'scripts/ci',entry),target);
    }
  }
  for (const file of ['verify-stable-version.cjs','verify-bundle.cjs','browser-interception.cjs']) {
    const source = path.join(tools,'scripts',file), target = path.join(root,'scripts',file);
    if (!fs.existsSync(target) && fs.existsSync(source)) fs.copyFileSync(source,target);
  }
}
async function main() {
  if (process.argv[2] === 'prepare') return prepare();
  if (process.argv[2] === 'hydrate') return hydrate();
  if (process.argv[2] === 'status') {
    const ctx = await resolve(C.context());
    return status(ctx,process.env.CHECK_RESULT === 'success' ? 'success' : 'failure');
  }
  throw Error('Expected prepare, hydrate or status');
}
if (require.main === module) C.cli(main);
module.exports = {validatePR,exported,resolve,hydrate};
