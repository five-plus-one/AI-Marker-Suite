'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {publish,advanceTag,downloadAsset,renderNotes}=require('./release.cjs');
const {digest}=require('./common.cjs');
const sha='a'.repeat(40);
const ctx={repository:'fiveplusone-dev/AI-Marker-Suite',name:'AI-Marker-Suite',sha,
  eventName:'workflow_dispatch',ref:'refs/heads/preview',server:'https://git.example.test'};
const metadata={repository:ctx.name,commit:sha,target:'preview',version:'1.2.3.1-preview.123'};
const files=Object.fromEntries(['ai_marker.user.js','manifest.json','delivery.json'].map(name=>[name,Buffer.from('new '+name)]));

test('preview notes include milestone changes since the published stable version',()=>{
  const notes=renderNotes({version:'1.21.35.6-preview.123',changelog:{
    '1.21.36.0':['【新功能】计划功能'],
    '1.21.35.6':['【修复】改进作业换卷'],
    '1.21.35.0':['【新功能】支持智学网作业'],
    '1.21.34.1':['【修复】现行稳定版'],
  }},'preview','1.21.34.1');
  assert.match(notes,/改进作业换卷/);
  assert.match(notes,/支持智学网作业/);
  assert.doesNotMatch(notes,/计划功能|现行稳定版/);
});

test('stable release notes cover changes since the previous stable release',()=>{
  const notes=renderNotes({version:'1.21.35.6',changelog:{
    '1.21.35.6':['【修复】改进作业换卷'],
    '1.21.35.0':['【新功能】支持智学网作业'],
    '1.21.34.1':['【修复】上一稳定版'],
  }},'stable','1.21.34.1');
  assert.match(notes,/改进作业换卷/);
  assert.match(notes,/支持智学网作业/);
  assert.doesNotMatch(notes,/上一稳定版/);
});

function fixture({existing=true,stable=false}={}) {
  let nextId=100,tagCommit=sha;
  let release=existing?{id:27,tag_name:stable?'v1.2.3.0':'preview-latest',draft:false,prerelease:!stable,name:'previous',body:'previous'}:null;
  const assets=new Map(),events=[],counts={move:0,current:0};
  const add=(name,body)=>{
    const asset={id:nextId++,uuid:'00000000-0000-4000-8000-'+String(nextId).padStart(12,'0'),name,size:body.length,browser_download_url:'https://git.example.test/attachments/'+nextId};
    assets.set(asset.id,{asset,body:Buffer.from(body)});return {...asset};
  };
  const io={
    current:async()=>{counts.current++;},move:async()=>{counts.move++;tagCommit=sha;},
    download:async(_ctx,asset)=>Buffer.from(assets.get(asset.id).body),
    api:async(_ctx,route,options={})=>{
      const method=options.method||'GET';events.push({method,route});
      if(method==='GET' && route.includes('/releases/tags/')) return release&&{...release};
      if(method==='GET' && /\/tags\//.test(route)) return {commit:{sha:tagCommit}};
      if(method==='GET' && route.endsWith('/assets')) return [...assets.values()].map(x=>({...x.asset}));
      if(method==='POST' && route.includes('/assets?')) {
        const file=options.body.get('attachment'),name=new URL('https://git.example.test'+route).searchParams.get('name');
        return add(name,Buffer.from(await file.arrayBuffer()));
      }
      if(method==='DELETE' && /\/assets\/\d+$/.test(route)) {
        assert.equal(assets.delete(Number(route.split('/').pop())),true);return null;
      }
      if(method==='GET' && /\/releases\/\d+$/.test(route)) return {...release};
      throw Error('Unexpected API operation '+method+' '+route);
    },
    json:async(_ctx,route,method,data)=>{
      events.push({method,route,data});
      if(method==='POST' && route.endsWith('/releases')) {
        assert.equal(release,null);release={id:27,...data};return {...release};
      }
      if(method==='PATCH' && /\/assets\/\d+$/.test(route)) {
        const item=assets.get(Number(route.split('/').pop()));Object.assign(item.asset,data);return {...item.asset};
      }
      if(method==='PATCH' && route.endsWith('/releases/27')) {Object.assign(release,data);return {...release};}
      throw Error('Unexpected JSON operation '+method+' '+route);
    }
  };
  return {io,events,assets,counts,add,get release(){return release;},setTag:commit=>{tagCommit=commit;}};
}

test('preview preserves release ID, replaces changed same-name bytes and verifies all final assets',async()=>{
  const f=fixture(),old=f.add('ai_marker.user.js',Buffer.from('old ai_marker.user.js'));
  const receipt=await publish(ctx,metadata,files,'current notes',f.io);
  assert.equal(receipt.releaseId,27);assert.equal(f.release.id,27);assert.equal(f.release.draft,false);
  assert.equal(f.release.name,'Preview v'+metadata.version);assert.equal(f.release.body,'current notes');
  assert.equal(f.counts.move,1);assert.equal(f.counts.current,2);
  assert.equal(f.assets.has(old.id),false);
  for(const name of Object.keys(files)) {
    const item=[...f.assets.values()].find(x=>x.asset.name===name);
    assert.deepEqual(item.body,files[name]);assert.match(receipt.assets[name].sha256,/^[a-f0-9]{64}$/);
  }
  assert.equal(f.events.some(x=>x.method==='DELETE'&&!/\/assets\/\d+$/.test(x.route)),false);
  assert.equal(f.events.some(x=>x.method==='POST'&&x.route.endsWith('/releases')),false);
});

test('unchanged attachments are downloaded and retain their asset IDs',async()=>{
  const f=fixture();const ids=Object.entries(files).map(([name,body])=>f.add(name,body).id);
  await publish(ctx,metadata,files,'notes',f.io);
  assert.deepEqual([...f.assets.keys()],ids);
  assert.equal(f.events.some(x=>x.method==='POST'||x.method==='DELETE'),false);
});

test('a later build removes only reserved stale CI uploads before publication',async()=>{
  const f=fixture();
  const stale=Buffer.from('interrupted older build');
  const old=f.add('ai_marker.user.js.upload-'+digest(stale),stale);
  const user=f.add('release-notes.txt',Buffer.from('user attachment'));
  const other=f.add('ai_marker.user.js.upload-manual',Buffer.from('user attachment'));
  const receipt=await publish(ctx,metadata,files,'notes',f.io);
  assert.equal(f.release.draft,false);assert.equal(f.assets.has(old.id),false);
  assert.equal(f.assets.has(user.id),true);assert.equal(f.assets.has(other.id),true);
  assert.deepEqual(receipt.removedTemporaryAssets.map(x=>x.id),[old.id]);
  assert.match(receipt.removedTemporaryAssets[0].sha256,/^[a-f0-9]{64}$/);
});

test('concurrent stale upload edits stop cleanup while the release stays staged',async()=>{
  const f=fixture(),download=f.io.download;
  const stale=Buffer.from('old upload');
  const old=f.add('delivery.json.upload-'+digest(stale),stale);
  f.io.download=async(c,a)=>{
    const bytes=await download(c,a);
    if(a.id===old.id) f.assets.get(a.id).asset.name='user-renamed.txt';
    return bytes;
  };
  await assert.rejects(publish(ctx,metadata,files,'notes',f.io),/changed during cleanup/);
  assert.equal(f.release.draft,true);assert.equal(f.assets.has(old.id),true);
});

test('a reserved name with a different content digest is preserved for inspection',async()=>{
  const f=fixture();
  const old=f.add('ai_marker.user.js.upload-'+'c'.repeat(64),Buffer.from('different content'));
  await assert.rejects(publish(ctx,metadata,files,'notes',f.io),/digest differs from its CI name/);
  assert.equal(f.release.draft,true);assert.equal(f.assets.has(old.id),true);
  assert.equal(f.events.some(event=>event.method==='DELETE'&&event.route.endsWith('/'+old.id)),false);
});

test('a first preview verifies its draft assets before the leased tag update',async()=>{
  const f=fixture({existing:false});
  f.io.move=async()=>{
    assert.equal(f.release.draft,true);assert.equal(f.assets.size,3);f.counts.move++;
  };
  await publish(ctx,metadata,files,'notes',f.io);
  assert.equal(f.events.find(x=>x.method==='POST'&&x.route.endsWith('/releases')).data.draft,true);
  assert.equal(f.release.draft,false);
});

test('the tag hook sees only verified canonical assets after stale upload cleanup',async()=>{
  const f=fixture(),download=f.io.download;let moved=false;
  const stale=Buffer.from('old staged upload');f.add('delivery.json.upload-'+digest(stale),stale);
  f.io.move=async()=>{
    assert.equal(f.release.draft,true);assert.equal(f.assets.size,3);
    for(const name of Object.keys(files)) assert.deepEqual([...f.assets.values()].find(x=>x.asset.name===name).body,files[name]);
    moved=true;f.release.draft=false;
  };
  f.io.download=async(c,a)=>{assert.ok(f.release.draft||moved);return download(c,a);};
  await publish(ctx,metadata,files,'notes',f.io);
  assert.equal(f.release.draft,false);
});

test('a readback failure after the tag hook leaves complete verified assets',async()=>{
  const f=fixture(),api=f.io.api;let moved=false;
  const stale=Buffer.from('older staged upload');f.add('manifest.json.upload-'+digest(stale),stale);
  f.io.move=async()=>{moved=true;f.release.draft=false;};
  f.io.api=async(c,route,options)=>{
    if(moved && route.endsWith('/tags/preview-latest')) throw Error('tag readback unavailable');
    return api(c,route,options);
  };
  await assert.rejects(publish(ctx,metadata,files,'notes',f.io),/tag readback unavailable/);
  assert.equal(f.release.id,27);assert.equal(f.assets.size,3);
  for(const name of Object.keys(files)) assert.deepEqual([...f.assets.values()].find(x=>x.asset.name===name).body,files[name]);
});

test('failed uploaded digest retains previous attachment and staged release',async()=>{
  const f=fixture(),old=f.add('ai_marker.user.js',Buffer.from('old'));
  const download=f.io.download;
  f.io.download=async(c,a)=>a.name.includes('.upload-')?Buffer.from('bad'):download(c,a);
  await assert.rejects(publish(ctx,metadata,files,'notes',f.io),/Uploaded attachment digest/);
  assert.equal(f.assets.has(old.id),true);assert.equal(f.release.draft,true);
  assert.equal(f.counts.move,0);
  assert.equal(f.events.some(x=>x.method==='DELETE'),false);
});

test('retry resumes a verified staged attachment after interrupted rename',async()=>{
  const f=fixture(),json=f.io.json;let fail=true;
  f.add('ai_marker.user.js',Buffer.from('old'));
  f.io.json=async(c,r,m,d)=>{
    if(fail && /\/assets\/\d+$/.test(r)) {fail=false;throw Error('interrupted rename');}
    return json(c,r,m,d);
  };
  await assert.rejects(publish(ctx,metadata,files,'notes',f.io),/interrupted rename/);
  assert.equal(f.release.draft,true);
  await publish(ctx,metadata,files,'notes',f.io);
  assert.equal(f.release.id,27);assert.equal(f.release.draft,false);assert.equal(f.assets.size,3);
  assert.equal(f.events.filter(x=>x.method==='POST'&&x.route.includes('ai_marker.user.js')).length,1);
});

test('concurrent replacement retains both attachments and stops the release',async()=>{
  const f=fixture(),download=f.io.download;
  const old=f.add('ai_marker.user.js',Buffer.from('old'));let replaced=false;
  f.io.download=async(c,a)=>{
    const bytes=await download(c,a);
    if(a.name.includes('.upload-')&&!replaced) {
      replaced=true;f.assets.delete(old.id);f.add('ai_marker.user.js',Buffer.from('other editor'));
    }
    return bytes;
  };
  await assert.rejects(publish(ctx,metadata,files,'notes',f.io),/changed during replacement/);
  assert.equal(f.release.draft,true);assert.equal(f.assets.size,2);
  assert.equal(f.events.some(x=>x.method==='DELETE'),false);
});

test('a new source revision or rolling tag race prevents final publication',async()=>{
  for(const race of ['source','tag']) {
    const f=fixture();let reads=0;
    if(race==='source') f.io.current=async()=>{if(++reads===2) throw Error('new source revision');};
    else f.io.move=async()=>{f.setTag('b'.repeat(40));};
    await assert.rejects(publish(ctx,metadata,files,'notes',f.io),race==='source'?/new source/:/tag differs/);
    assert.equal(f.release.draft,true);
  }
});

test('stable requires its immutable matching tag and never invokes tag mutation',async()=>{
  const stable={...metadata,target:'stable',version:'1.2.3.0'};
  const context={...ctx,eventName:'push',ref:'refs/tags/v1.2.3.0'};
  const wrong=fixture({stable:true});wrong.setTag('b'.repeat(40));
  await assert.rejects(publish(context,stable,files,'notes',wrong.io),/tag differs/);
  assert.equal(wrong.events.some(x=>x.method!=='GET'),false);
  const f=fixture({stable:true});await publish(context,stable,files,'notes',f.io);
  assert.equal(f.counts.move,0);assert.equal(f.release.id,27);assert.equal(f.release.prerelease,false);
});

test('attachment downloads require the same HTTPS origin before credentials are used',async()=>{
  for(const url of ['https://other.example/asset','http://git.example.test/asset','https://user:pass@git.example.test/asset']) {
    await assert.rejects(downloadAsset(ctx,{browser_download_url:url,size:1}),/Forgejo HTTPS origin/);
  }
});

test('the attachment reader is injected only into trusted publication steps',()=>{
  for(const [file,step] of [['ci.yml','Publish preview release'],['release.yml','Publish Forgejo release']]) {
    const text=fs.readFileSync(path.join(__dirname,'../../.forgejo/workflows',file),'utf8');
    assert.equal((text.match(/MARKER_RELEASE_READ_TOKEN:/g)||[]).length,1);
    const start=text.indexOf('      - name: '+step);assert.ok(start>0);
    assert.equal(text.slice(0,start).includes('MARKER_RELEASE_READ_TOKEN'),false);
    assert.match(text.slice(start),/MARKER_RELEASE_READ_TOKEN: \$\{\{ secrets\.MARKER_RELEASE_READ_TOKEN \}\}/);
    if(file==='ci.yml') {
      assert.match(text,/deploy:\s+needs: build\s+if:.*github\.event_name == 'push'.*github\.event_name == 'workflow_dispatch'/);
      assert.match(text.slice(start),/if:.*github\.ref == 'refs\/heads\/preview'/);
    } else assert.match(text,/tags: \['v\*'\]/);
  }
});

test('attachment downloads use the dedicated reader, read binary bytes and reject truncated data',async t=>{
  const originalFetch=global.fetch,originalToken=process.env.MARKER_RELEASE_READ_TOKEN;
  t.after(()=>{global.fetch=originalFetch;if(originalToken===undefined) delete process.env.MARKER_RELEASE_READ_TOKEN;else process.env.MARKER_RELEASE_READ_TOKEN=originalToken;});
  process.env.MARKER_RELEASE_READ_TOKEN='fixture-read-token';
  const body=Buffer.from([0,255,31,128]);
  global.fetch=async(url,options)=>{
    assert.equal(url.origin,ctx.server);assert.equal(options.redirect,'error');
    assert.equal(url.pathname,'/attachments/00000000-0000-4000-8000-000000000001');
    assert.equal(options.headers.Authorization,'token fixture-read-token');
    return new Response(body);
  };
  const asset={uuid:'00000000-0000-4000-8000-000000000001',browser_download_url:ctx.server+'/fiveplusone-dev/AI-Marker-Suite/releases/download/preview-latest/ai_marker.user.js',size:body.length};
  assert.deepEqual(await downloadAsset(ctx,asset),body);
  await assert.rejects(downloadAsset(ctx,{...asset,size:5}),/size differs/);
  await assert.rejects(downloadAsset(ctx,{...asset,size:3}),/exceeds/);
  await assert.rejects(downloadAsset(ctx,{...asset,uuid:'../asset'}),/attachment UUID/);
});

function gitFixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'release-cas-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source=path.join(dir,'source'),remote=path.join(dir,'remote.git');fs.mkdirSync(source);
  const git=(args,cwd=source)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init']);git(['config','user.name','CI test']);git(['config','user.email','ci@example.test']);
  const commits=[];
  for(let i=0;i<3;i++) {git(['commit','--allow-empty','-m','commit '+i]);commits.push(git(['rev-parse','HEAD']));}
  git(['init','--bare',remote]);
  return {git,remote,commits};
}

test('real Git uses the raw annotated ref SHA as the preview lease',t=>{
  const {git,remote,commits:[a,b]}=gitFixture(t);
  git(['tag','-a','preview-latest',a,'-m','initial']);git(['push',remote,'refs/tags/preview-latest']);
  git(['push',remote,b+':refs/heads/preview']);
  const raw=git(['rev-parse','refs/tags/preview-latest']);assert.notEqual(raw,a);
  const result=advanceTag(git,remote,b);
  assert.equal(result.old,raw);assert.equal(git(['--git-dir='+remote,'rev-parse','refs/tags/preview-latest']),b);
});

test('real Git refuses a concurrent preview change and preserves the competing SHA',t=>{
  const {git,remote,commits:[a,b,c]}=gitFixture(t);
  git(['push',remote,a+':refs/tags/preview-latest',c+':refs/heads/available']);
  git(['push',remote,b+':refs/heads/preview']);
  const run=args=>{
    if(args[0]==='push') git(['--git-dir='+remote,'update-ref','refs/tags/preview-latest',c,a]);
    return git(args);
  };
  assert.throws(()=>advanceTag(run,remote,b));
  assert.equal(git(['--git-dir='+remote,'rev-parse','refs/tags/preview-latest']),c);
});

test('real Git leases an absent tag and an equal tag needs no write',t=>{
  const {git,remote,commits:[a]}=gitFixture(t);const calls=[];
  git(['push',remote,a+':refs/heads/preview']);
  advanceTag(args=>{calls.push(args);return git(args);},remote,a);
  assert.ok(calls.some(args=>args.includes('--force-with-lease=refs/tags/preview-latest:')));
  calls.length=0;
  advanceTag(args=>{calls.push(args);return git(args);},remote,a);
  assert.equal(calls.some(args=>args[0]==='push'),false);
});

test('real Git refuses a tag rewind even if the requested branch was rolled back',t=>{
  const {git,remote,commits:[a,b]}=gitFixture(t);
  git(['push',remote,b+':refs/tags/preview-latest',a+':refs/heads/preview']);
  assert.throws(()=>advanceTag(git,remote,a));
  assert.equal(git(['--git-dir='+remote,'rev-parse','refs/tags/preview-latest']),b);
});

test('real Git rejects an obsolete source and a branch advance during fetch',t=>{
  const {git,remote,commits:[a,b,c]}=gitFixture(t);
  git(['push',remote,a+':refs/tags/preview-latest',c+':refs/heads/preview',b+':refs/heads/available']);
  assert.throws(()=>advanceTag(git,remote,b),/newer preview branch/);
  git(['--git-dir='+remote,'update-ref','refs/heads/preview',b,c]);
  const run=args=>{
    const result=git(args);
    if(args[0]==='fetch') git(['--git-dir='+remote,'update-ref','refs/heads/preview',c,b]);
    return result;
  };
  assert.throws(()=>advanceTag(run,remote,b),/newer preview branch/);
  assert.equal(git(['--git-dir='+remote,'rev-parse','refs/tags/preview-latest']),a);
});
