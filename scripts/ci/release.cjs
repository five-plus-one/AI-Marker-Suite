'use strict';
const C = require('./common.cjs');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const compare = (a,b) => {
  const x=a.split('.').map(Number),y=b.split('.').map(Number);
  for(let i=0;i<Math.max(x.length,y.length);i++) if((x[i]||0)!==(y[i]||0)) return (x[i]||0)-(y[i]||0);
  return 0;
};
function writeNotes(manifest,target) {
  const preview=target==='preview', keys=Object.keys(manifest.changelog).sort((a,b)=>compare(b,a));
  const stable=keys.find(key=>key.split('.').length===3 || (key.split('.').length===4 && key.endsWith('.0'))) || '0.0.0';
  const selected=preview ? keys.filter(key=>key.split('.').length===4 && !key.endsWith('.0') && compare(key,stable)>0)
    : [keys.find(key=>compare(key,manifest.version)===0)].filter(Boolean);
  const grouped = new Map();
  for(const item of selected.flatMap(key=>manifest.changelog[key]||[])) {
    const match=item.match(/^【(.+?)】(.+)/),category=match?.[1]||'其他';
    grouped.set(category,[...(grouped.get(category)||[]),match?.[2]?.trim()||item]);
  }
  const sections=[...grouped].map(([category,items])=>'### '+category+'\n'+items.map(item=>'- '+item).join('\n'));
  const body=['# AI 批改助手 '+(preview?'Preview ':'')+'v'+manifest.version,'',
    '[文档站](https://aimarking.five-plus-one.com/) · [稳定版安装](https://auto-update.aimarking.five-plus-one.com/ota/ai_marker.user.js) · [预览版安装](https://auto-update.aimarking.five-plus-one.com/ota/preview/ai_marker.user.js)','',
    ...(preview?['预览版供测试使用，日常使用建议安装稳定版。','']:[]),
    '## '+(preview?'相对稳定版的更新':'更新内容'),'',sections.join('\n\n')||'本次构建沿用当前版本的功能。','',
    '推荐浏览器：Microsoft Edge + Tampermonkey。',''].join('\n').replace(/@([A-Za-z][A-Za-z0-9_-]*)/g,'＠$1');
  C.fs.writeFileSync(C.path.join(C.OUTPUT,'RELEASE_NOTES.md'),body);
}
const FILES = ['ai_marker.user.js','manifest.json','delivery.json'];
const ROLLING = 'refs/tags/preview-latest';
const PREVIEW = 'refs/heads/preview';
function advanceTag(run, remote, commit) {
  C.sha(commit);
  const read = () => {
    const rows=run(['ls-remote','--refs',remote,PREVIEW,ROLLING]).trim().split(/\r?\n/).filter(Boolean);
    const refs=new Map();
    for(const row of rows) {
      const [oid,ref]=row.split(/\s+/);
      C.invariant([PREVIEW,ROLLING].includes(ref) && !refs.has(ref),'Unexpected preview ref advertisement');
      refs.set(ref,C.sha(oid));
    }
    C.invariant(refs.get(PREVIEW)===commit,'A newer preview branch revision is available');
    return refs.get(ROLLING)||'';
  };
  const expected=read();
  if(expected!==commit) {
    const specs=[PREVIEW+':refs/ci/preview'];
    if(expected) specs.push(expected+':refs/ci/previous-tag');
    run(['fetch','--no-tags','--atomic',remote,...specs]);
    C.invariant(run(['rev-parse','refs/ci/preview']).trim()===commit,'Preview advanced during history fetch');
    if(expected) run(['merge-base','--is-ancestor',expected+'^{commit}',commit]);
    C.invariant(read()===expected,'Preview refs changed before their leased update');
    run(['push','--porcelain','--force-with-lease='+ROLLING+':'+expected,remote,commit+':'+ROLLING]);
  }
  C.invariant(read()===commit,'Preview tag changed after its leased update');
  return {old:expected||null,commit};
}
function movePreviewTag(ctx,commit) {
  const server=new URL(ctx.server);
  C.invariant(server.protocol==='https:' && !server.username && !server.password,'Expected HTTPS Git origin');
  C.invariant(/^[\w.-]+\/AI-Marker-Suite$/.test(ctx.repository),'Unexpected release repository');
  const token=process.env.FORGEJO_TOKEN || process.env.GITHUB_TOKEN;
  C.invariant(token,'Workflow API token is required');
  const temp=C.fs.mkdtempSync(C.path.join(os.tmpdir(),'aimarker-release-'));
  const env=Object.fromEntries(['PATH','Path','SystemRoot','SYSTEMROOT','COMSPEC','PATHEXT','TMP','TEMP','LANG']
    .filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
  Object.assign(env,{HOME:temp,XDG_CONFIG_HOME:temp,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',
    GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_CONFIG_COUNT:'4',
    GIT_CONFIG_KEY_0:'http.'+server.origin+'/.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: token '+token,
    GIT_CONFIG_KEY_1:'credential.helper',GIT_CONFIG_VALUE_1:'',
    GIT_CONFIG_KEY_2:'http.followRedirects',GIT_CONFIG_VALUE_2:'false',
    GIT_CONFIG_KEY_3:'core.hooksPath',GIT_CONFIG_VALUE_3:C.path.join(temp,'disabled-hooks')});
  const git=(args,cwd=temp)=>{
    try { return execFileSync('git',args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000,maxBuffer:1024*1024}); }
    catch { throw Error('Preview tag Git operation failed; its expected ref may have changed'); }
  };
  try {
    git(['init','--bare','.']);
    // Fetch only the publication refs into this owned bare; checkout depth is irrelevant.
    return advanceTag(git,server.origin+'/'+ctx.repository+'.git',commit);
  } finally { C.fs.rmSync(temp,{recursive:true,force:true}); }
}
async function downloadAsset(ctx,asset) {
  const url=new URL(asset.browser_download_url),server=new URL(ctx.server);
  C.invariant(server.protocol==='https:' && url.origin===server.origin && !url.username && !url.password,
    'Release attachment must use its Forgejo HTTPS origin');
  C.invariant(Number.isSafeInteger(asset.size) && asset.size>=0 && asset.size<=20*1024*1024,'Unexpected attachment size');
  const token=process.env.FORGEJO_TOKEN || process.env.GITHUB_TOKEN;
  C.invariant(token,'Workflow API token is required');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:'token '+token}});
  C.invariant(response.ok && response.body,'Release attachment download failed');
  const chunks=[];let size=0;
  for await(const chunk of response.body) {
    size+=chunk.length;
    C.invariant(size<=asset.size,'Attachment exceeds its recorded size');
    chunks.push(chunk);
  }
  C.invariant(size===asset.size,'Attachment size differs');
  return Buffer.concat(chunks);
}
async function publish(ctx,metadata,files,notes,io={}) {
  const api=io.api||C.api,json=io.json||C.apiJson,download=io.download||downloadAsset;
  const current=io.current||C.currentBranch,move=io.move||movePreviewTag;
  C.invariant(metadata.repository===ctx.name && metadata.commit===C.sha(ctx.sha),'Release source differs');
  const preview=metadata.target==='preview';
  if(preview) await current(ctx,'preview',metadata.commit);
  else C.invariant(ctx.eventName==='push' && ctx.ref==='refs/tags/v'+metadata.version &&
    metadata.target==='stable','Stable release requires its matching tag');
  const prefix='/repos/'+ctx.repository, tag=preview?'preview-latest':'v'+metadata.version;
  const tagRoute=prefix+'/tags/'+encodeURIComponent(tag);
  const checkTag=async()=>{
    const value=await api(ctx,tagRoute,{allow404:true});
    C.invariant(value && (value.commit.sha||value.commit.id)===metadata.commit,'Release tag differs from built commit');
  };
  if(!preview) await checkTag();
  const existing=await api(ctx,prefix+'/releases/tags/'+encodeURIComponent(tag),{allow404:true});
  const fields={name:preview?'Preview v'+metadata.version:tag,body:notes,prerelease:preview};
  let entry;
  if(existing) {
    C.invariant(Number.isSafeInteger(existing.id) && existing.tag_name===tag,'Unexpected release identity');
    entry=await json(ctx,prefix+'/releases/'+existing.id,'PATCH',{...fields,draft:true});
    C.invariant(entry.id===existing.id,'Release identity changed while staging');
  }
  if(preview) await move(ctx,metadata.commit);
  await checkTag();
  if(!entry) entry=await json(ctx,prefix+'/releases','POST',{
    ...fields,tag_name:tag,target_commitish:metadata.commit,draft:true
  });
  C.invariant(Number.isSafeInteger(entry.id) && entry.tag_name===tag,'Unexpected release identity');
  const route=prefix+'/releases/'+entry.id,assetRoute=route+'/assets';
  const list=()=>api(ctx,assetRoute);
  const same=async(asset,body)=>asset.size===body.length && C.digest(await download(ctx,asset))===C.digest(body);
  const find=(assets,name)=>{
    const matches=assets.filter(asset=>asset.name===name);
    C.invariant(matches.length<=1,'Duplicate release attachment name');
    return matches[0];
  };
  for(const name of FILES) {
    const body=files[name];
    C.invariant(Buffer.isBuffer(body),'Expected attachment bytes');
    const assets=await list(),old=find(assets,name);
    if(old && await same(old,body)) continue;
    const temporary=name+'.upload-'+C.digest(body);
    let staged=find(assets,temporary);
    if(!staged) {
      const form=new FormData();
      form.set('attachment',new Blob([body]),temporary);
      staged=await api(ctx,assetRoute+'?name='+encodeURIComponent(temporary),{method:'POST',body:form});
    }
    C.invariant(Number.isSafeInteger(staged.id) && staged.id!==old?.id && await same(staged,body),
      'Uploaded attachment digest differs');
    const fresh=await list(),target=find(fresh,name);
    C.invariant(target?.id===old?.id,'Release attachment changed during replacement');
    if(old) await api(ctx,assetRoute+'/'+old.id,{method:'DELETE'});
    const renamed=await json(ctx,assetRoute+'/'+staged.id,'PATCH',{name});
    C.invariant(renamed.id===staged.id && renamed.name===name && await same(renamed,body),'Attachment rename verification failed');
  }
  const verifyAssets=async()=>{
    const assets=await list();
    for(const name of FILES) {
      const asset=find(assets,name);
      C.invariant(asset && await same(asset,files[name]),'Published attachment digest differs');
    }
  };
  await verifyAssets();
  const temporaryName=name=>FILES.some(file=>name.startsWith(file+'.upload-') && /^[a-f0-9]{64}$/.test(name.slice((file+'.upload-').length)));
  const removedTemporaryAssets=[];
  for(const asset of (await list()).filter(asset=>temporaryName(asset.name))) {
    C.invariant(Number.isSafeInteger(asset.id),'Unexpected temporary attachment identity');
    const body=await download(ctx,asset);
    const fresh=(await list()).find(item=>item.id===asset.id);
    C.invariant(fresh && fresh.name===asset.name && fresh.size===asset.size,'Temporary attachment changed during cleanup');
    await api(ctx,assetRoute+'/'+asset.id,{method:'DELETE'});
    C.invariant(!(await list()).some(item=>item.id===asset.id),'Temporary attachment cleanup failed');
    removedTemporaryAssets.push({id:asset.id,name:asset.name,size:body.length,sha256:C.digest(body)});
  }
  C.invariant(!(await list()).some(asset=>temporaryName(asset.name)),'Concurrent temporary attachments remain staged');
  if(preview) await current(ctx,'preview',metadata.commit);
  await checkTag();
  const published=await json(ctx,route,'PATCH',{...fields,draft:false});
  C.invariant(published.id===entry.id,'Release identity changed while publishing');
  const readback=await api(ctx,route);
  C.invariant(readback.id===entry.id && readback.tag_name===tag && !readback.draft &&
    Object.entries(fields).every(([key,value])=>readback[key]===value),'Published release metadata differs');
  await verifyAssets();
  return {releaseId:entry.id,tag,commit:metadata.commit,removedTemporaryAssets,
    assets:Object.fromEntries(FILES.map(name=>[name,{size:files[name].length,sha256:C.digest(files[name])}]))};
}
async function main() {
  const ctx=C.context(),{metadata}=C.readDelivery();
  const files=Object.fromEntries(FILES.map(name=>[name,C.fs.readFileSync(C.path.join(C.OUTPUT,name))]));
  const receipt=await publish(ctx,metadata,files,C.fs.readFileSync(C.path.join(C.OUTPUT,'RELEASE_NOTES.md'),'utf8'));
  C.writeJson(C.path.join(C.OUTPUT,'release-receipt.json'),receipt);
  console.log('Published Forgejo release '+receipt.tag+' (ID '+receipt.releaseId+')');
}
if(require.main===module) C.cli(main);
module.exports={writeNotes,compare,publish,advanceTag,movePreviewTag,downloadAsset};
