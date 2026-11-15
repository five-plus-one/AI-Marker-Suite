'use strict';
const C = require('./common.cjs');
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
async function main() {
  const ctx=C.context(),{metadata}=C.readDelivery();
  C.invariant(metadata.repository===ctx.name && metadata.commit===C.sha(ctx.sha),'Release source differs');
  const preview=metadata.target==='preview';
  if(preview) await C.currentBranch(ctx,'preview',metadata.commit);
  else C.invariant(ctx.eventName==='push' && ctx.ref==='refs/tags/v'+metadata.version &&
    metadata.target==='stable','Stable release requires its matching tag');
  const prefix='/repos/'+ctx.repository, tag=preview?'preview-latest':'v'+metadata.version;
  let existing=await C.api(ctx,prefix+'/releases/tags/'+encodeURIComponent(tag),{allow404:true});
  const currentTag=await C.api(ctx,prefix+'/tags/'+encodeURIComponent(tag),{allow404:true});
  if(preview) {
    if(existing) await C.api(ctx,prefix+'/releases/'+existing.id,{method:'DELETE'});
    if(currentTag) await C.api(ctx,prefix+'/tags/'+encodeURIComponent(tag),{method:'DELETE'});
    await C.apiJson(ctx,prefix+'/tags','POST',{tag_name:tag,target:metadata.commit});
    existing=null;
  } else {
    C.invariant(currentTag && (currentTag.commit.sha||currentTag.commit.id)===metadata.commit,'Release tag differs from built commit');
  }
  const entry=existing || await C.apiJson(ctx,prefix+'/releases','POST',{
    tag_name:tag,target_commitish:metadata.commit,name:preview?'Preview v'+metadata.version:tag,
    body:C.fs.readFileSync(C.path.join(C.OUTPUT,'RELEASE_NOTES.md'),'utf8'),draft:false,prerelease:preview
  });
  const assets=await C.api(ctx,prefix+'/releases/'+entry.id+'/assets');
  for(const name of ['ai_marker.user.js','manifest.json','delivery.json']) {
    if(assets.some(asset=>asset.name===name)) continue;
    const form=new FormData();
    form.set('attachment',new Blob([C.fs.readFileSync(C.path.join(C.OUTPUT,name))]),name);
    await C.api(ctx,prefix+'/releases/'+entry.id+'/assets?name='+encodeURIComponent(name),{method:'POST',body:form});
  }
  console.log('Published Forgejo release '+tag);
}
if(require.main===module) C.cli(main);
module.exports={writeNotes,compare};
