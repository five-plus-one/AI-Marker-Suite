'use strict';
const C = require('./common.cjs');
async function main() {
  const ctx = C.context();
  const deleting = process.argv.includes('--delete-pr');
  let metadata, body, provenance;
  if (deleting) {
    C.invariant(ctx.name === 'AI-Marker-Suite' && ctx.eventName === 'pull_request_target' &&
      ['closed','edited'].includes(ctx.event.action), 'Unexpected cleanup event');
    const pr = ctx.event.pull_request;
    C.invariant(pr.head.repo.full_name === ctx.repository, 'Only same-repository PRs may be retired');
    const number = Number(pr.number ?? ctx.event.number);
    C.invariant(Number.isSafeInteger(number) && number > 0, 'Invalid PR number');
    const current = await C.api(ctx, '/repos/' + ctx.repository + '/pulls/' + number);
    if (current.state === 'open' && current.base.ref === 'dev') {
      console.log('PR temporary target remains active'); return;
    }
    metadata = {repository:ctx.name, target:'pr-' + number, commit:C.sha(pr.head.sha)};
  } else {
    ({metadata,body,provenance} = C.readDelivery());
    C.invariant(metadata.repository === ctx.name && metadata.commit === C.sha(ctx.sha), 'Delivery source differs from workflow');
    await C.currentBranch(ctx,metadata.target,metadata.commit);
  }
  const endpoint = new URL(process.env.MARKER_DEPLOY_URL || '');
  C.invariant(endpoint.protocol === 'https:' && endpoint.pathname === '/deploy' &&
    !endpoint.username && !endpoint.password && !endpoint.hash && !endpoint.search,
    'Expected the HTTPS deployment endpoint');
  C.invariant(process.env.MARKER_DEPLOY_TOKEN, 'Deployment token is required');
  endpoint.searchParams.set('target',metadata.target);
  endpoint.searchParams.set('commit',metadata.commit);
  const headers = {Authorization:'Bearer ' + process.env.MARKER_DEPLOY_TOKEN};
  if (!deleting) headers['Content-Type'] = 'application/gzip';
  const response = await fetch(endpoint, {method:deleting ? 'DELETE' : 'POST', headers, body,
    redirect:'error', signal:AbortSignal.timeout(180000)});
  C.invariant(response.ok || (deleting && response.status === 404),
    'Deployment request failed (' + response.status + ')');
  C.fs.mkdirSync(C.OUTPUT,{recursive:true});
  C.writeJson(C.path.join(C.OUTPUT,'deployment-receipt.json'), {
    ...metadata, operation:deleting ? 'retire' : 'deploy', status:response.status,
    archiveSha256:provenance?.archiveSha256, receivedAt:new Date().toISOString()
  });
  // The receiver keeps its authoritative manifest; response bodies are not logged.
  console.log((deleting ? 'Retired ' : 'Delivered ') + metadata.target + ' at ' + metadata.commit);
}
if (require.main === module) C.cli(main);
module.exports = {main};
