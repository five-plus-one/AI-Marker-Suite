'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const OUTPUT = path.resolve('ci-output');
function invariant(value, message) { if (!value) throw new Error(message); }
function context(env = process.env, event) {
  const value = key => env['FORGEJO_' + key] || env['GITHUB_' + key] || '';
  event ??= JSON.parse(fs.readFileSync(value('EVENT_PATH'), 'utf8'));
  const repository = value('REPOSITORY');
  invariant(/^[\w.-]+\/AI-Marker-Suite(?:-Docs)?$/.test(repository), 'Unexpected repository');
  return {event, repository, name: repository.split('/')[1], eventName: value('EVENT_NAME'),
    ref: value('REF'), sha: value('SHA'), server: value('SERVER_URL'),
    api: value('API_URL'), run: value('RUN_ID')};
}
function sha(value) { invariant(/^[a-f0-9]{40}$/.test(value || ''), 'Expected a full commit SHA'); return value; }
function targetFor(ctx) {
  if (ctx.eventName === 'pull_request') {
    const pr = ctx.event.pull_request;
    invariant(pr && ['dev','preview','stable','main'].includes(pr.base.ref), 'Unexpected PR base');
    if (ctx.name === 'AI-Marker-Suite-Docs') return 'docs';
    if (pr.base.ref === 'dev') {
      invariant(Number.isSafeInteger(Number(pr.number ?? ctx.event.number)) && Number(pr.number ?? ctx.event.number) > 0, 'Invalid PR number');
      return 'pr-' + (pr.number ?? ctx.event.number);
    }
    return pr.base.ref;
  }
  const branch = ctx.ref.replace(/^refs\/heads\//, '');
  return ctx.name === 'AI-Marker-Suite-Docs' ? 'docs' : (['dev','preview','stable'].includes(branch) ? branch : 'dev');
}
function trustedBranch(ctx, target) {
  return ['push','workflow_dispatch'].includes(ctx.eventName) &&
    ctx.ref === 'refs/heads/' + (target === 'docs' ? 'main' : target) &&
    ['dev','preview','stable','docs'].includes(target);
}
function run(command, args, options = {}) {
  const env = {...process.env};
  // Project code does not need the workflow's API credentials.
  for (const key of ['FORGEJO_TOKEN','GITHUB_TOKEN','MARKER_DEPLOY_TOKEN','MARKER_DEPLOY_URL']) delete env[key];
  return execFileSync(command, args, {stdio:'inherit', env, ...options});
}
function npm(args) {
  if (process.platform === 'win32') return run('cmd.exe', ['/d','/s','/c', 'npm ' + args.join(' ')]);
  return run('npm', args);
}
function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function digest(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function packageDelivery(source, metadata, extra = {}) {
  fs.mkdirSync(OUTPUT, {recursive:true});
  invariant(!fs.existsSync(path.join(source, '.delivery.json')), 'Delivery metadata already exists');
  const walk = dir => { for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    invariant(!entry.isSymbolicLink(), 'Symlinks are not delivery files');
    if (entry.isDirectory()) walk(path.join(dir,entry.name));
    else invariant(entry.isFile(), 'Only regular delivery files are accepted');
  }};
  walk(source);
  writeJson(path.join(source, '.delivery.json'), metadata);
  writeJson(path.join(OUTPUT, 'delivery.json'), metadata);
  const archive = path.join(OUTPUT, 'delivery.tar.gz');
  run('tar', ['-czf', archive, '-C', source, '.']);
  writeJson(path.join(OUTPUT, 'provenance.json'), {
    ...extra, ...metadata, archiveSha256:digest(fs.readFileSync(archive))
  });
}
function readDelivery() {
  const metadata = json(path.join(OUTPUT,'delivery.json'));
  const archive = path.join(OUTPUT,'delivery.tar.gz');
  invariant(fs.lstatSync(archive).isFile(), 'Expected a regular archive');
  const body = fs.readFileSync(archive);
  invariant(body.length > 0 && body.length < 100 * 1024 * 1024, 'Unexpected delivery size');
  const provenance = json(path.join(OUTPUT,'provenance.json'));
  invariant(provenance.archiveSha256 === digest(body), 'Delivery checksum differs');
  const members = execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split(/\r?\n/);
  const clean = members.map(file => file.replace(/^\.\//,''));
  invariant(clean.every(file => !file.startsWith('/') && !file.includes('\\') &&
    !file.split('/').includes('..')), 'Unsafe archive member');
  invariant(clean.filter(file => file === '.delivery.json').length === 1, 'Expected one delivery metadata file');
  const embedded = JSON.parse(execFileSync('tar',['-xOf',archive,members[clean.indexOf('.delivery.json')]],{encoding:'utf8'}));
  invariant(JSON.stringify(embedded) === JSON.stringify(metadata), 'Embedded metadata differs');
  sha(metadata.commit);
  return {metadata, body, provenance};
}
async function api(ctx, route, options = {}) {
  const base = new URL(ctx.api || ctx.server + '/api/v1');
  invariant(base.protocol === 'https:', 'Forgejo API requires HTTPS');
  invariant(base.origin === new URL(ctx.server).origin, 'Unexpected Forgejo API origin');
  const token = process.env.FORGEJO_TOKEN || process.env.GITHUB_TOKEN;
  invariant(token, 'Workflow API token is required');
  const url = new URL(base.href.replace(/\/$/,'') + route);
  const response = await fetch(url, {redirect:'error', signal:AbortSignal.timeout(60000),
    ...options, headers:{Authorization:'token ' + token, ...options.headers}});
  if (options.allow404 && response.status === 404) return null;
  invariant(response.ok, 'Forgejo API request failed (' + response.status + ')');
  if (response.status === 204) return null;
  return response.json();
}
function apiJson(ctx, route, method, data) {
  return api(ctx,route,{method, headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
}
async function currentBranch(ctx, target, commit) {
  invariant(trustedBranch(ctx,target), 'Deployment requires a trusted branch push or manual run');
  const branch = target === 'docs' ? 'main' : target;
  const data = await api(ctx,'/repos/' + ctx.repository + '/branches/' + branch);
  invariant((data.commit.id || data.commit.sha) === commit, 'A newer branch revision is available');
}
function cli(main) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = {fs,path,OUTPUT,invariant,context,sha,targetFor,trustedBranch,run,npm,json,writeJson,digest,
  packageDelivery,readDelivery,api,apiJson,currentBranch,cli};
