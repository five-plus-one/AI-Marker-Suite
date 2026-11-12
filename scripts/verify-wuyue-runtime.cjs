// 五岳公开前端在隔离浏览器中的合成答卷验收，生产 API 始终拦截。
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium, request } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const origin = 'https://www.wylkyj.com';
const assets = path.resolve(process.env.WUYUE_ASSETS || path.join(os.tmpdir(), 'ai-marker-wuyue-assets'));
const caseName = process.argv.find(x => x.startsWith('--case='))?.slice(7) || 'total';
function seedUserscript({ chemistry, spec, png, count }) {
    const config = { provider: '验收', model: 'replay-model', workflowId: 'replay', gradingMode: 'trial',
        question: chemistry.question, answer: chemistry.answer, rubric: chemistry.rubric,
        scoring: { maxScore: 6, units: chemistry.units, roundStep: 1, roundMethod: 'round' },
        questionGuard: { enabled: false }, blankDetection: { enabled: false }, humanPacing: { enabled: false },
        batchConfig: { enabled: true, targetCount: count } };
    const values = { 'ai-grading-show-onboarding': false,
        'ai-grading-presets': JSON.stringify({ list: { 验收: config }, active: '验收',
            bindings: { 'wuyue#replay-exam#replay-subject#replay-question#0': '验收' } }),
        'ai-grading-providers-v2': JSON.stringify({ providers: { 验收: { endpoint: 'https://replay.invalid/v1/chat/completions',
            apiKey: 'replay-only', models: { 'replay-model': { label: '验收模型' } } } }, activeProvider: '验收', activeModel: 'replay-model' }),
        'ai-grading-workflows': JSON.stringify({ workflows: { replay: { id: 'replay', name: '验收',
            model: { provider: '验收', model: 'replay-model' }, dualEval: { enabled: false } } } }) };
    window.GM_getValue = (key, fallback) => values[key] ?? fallback;
    window.GM_setValue = (key, value) => { values[key] = value; };
    window.GM_registerMenuCommand = () => {};
    window.__replayAiRequests = [];
    window.GM_xmlhttpRequest = options => {
        let cancelled = false;
        const timer = setTimeout(() => {
            if (cancelled) return;
            if (options.url.startsWith('https://replay.invalid/')) {
                let content = `【作答状态】\n可辨认\n【答案复述】\n${spec.answer}\n【评分依据】\n按各问评分标准评分。`;
                if (spec.scores) content += '\n' + spec.scores.map((score,i)=>spec.heading
                    ? `【${chemistry.units[i].label}分数】\n${score}` : `${chemistry.units[i].label}分数：${score}`).join('\n')
                    + '\n【得分】\n' + spec.scores.reduce((sum,score)=>sum+score,0);
                options.onload?.({ status: 200, responseText: 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] })
                    + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n' });
            } else if (options.url.startsWith(location.origin + '/replay/') && options.responseType === 'arraybuffer') {
                options.onload?.({ status: 200, response: Uint8Array.from(atob(png), c => c.charCodeAt(0)).buffer });
            } else options.onerror?.({ error: 'unexpected GM request' });
        }, 0);
        if (options.url.startsWith('https://replay.invalid/')) window.__replayAiRequests.push(JSON.parse(options.data));
        return { abort() { cancelled = true; clearTimeout(timer); options.onabort?.(); } };
    };
}
const fixtures = {
    '/api/v1/ProductModule/GetOemInfo': { companyShortName: '验收平台', websiteTitle: '五岳验收',
        companyLogo: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        navigationLogo: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        websiteLogo: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' },
    '/api/v1/ProductModule/GetCurrentUserPers': [{ perms: 'marking' }],
    '/api/v1/user/GetUserInfoByToken': { userName: '验收教师', userNo: 'replay-teacher' },
    '/api/v1/marking/QueInfo': { scoreValue: 6, stepValue: 0.5, stepDataList: [],
        markedQualityData: { tchMarkCount: 0, tchTaskCount: 100 }, markMintime: 0,
        markType: 1, permission: 'replay', markLocation: 1, picConstr: 0,
        isOnlineExam: 0, isShowSheet: true,
        imgDataList: [{ old_width: 900, old_height: 320, x: 0, y: 0, width: 900, height: 320 }] }
};
const task = { examNo: 'replay-exam', esubNo: 'replay-subject', queNo: 'replay-question',
    IsArb: false, isTest: true, esubName: '化学', queName: '16(4-6)' };
if(caseName==='steps') fixtures['/api/v1/marking/QueInfo'].stepDataList=[4,5,6].map((n,index)=>({
    stepNo:index+1,stepName:`（${n}）`,stepScore:2,isDed:false
}));

if (caseName === 'all') (async () => {
    const names=['total','compact','auto','steps','late-load','delayed-save','server-failure','business-failure','network-failure',
        'workflow-solid','workflow-fraction','workflow-solution','workflow-heading','workflow-partial','workflow-zero',
        'workflow-no-score','workflow-business-failure'];
    await fs.mkdir(assets,{recursive:true}); const results=[];
    for(const name of names) {
        const result=await new Promise(resolve=>{
            const child=spawn(process.execPath,[__filename,'--case='+name],{env:process.env,windowsHide:true});
            let output=''; child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
            child.on('error',error=>resolve({name,passed:false,error:error.message}));
            child.on('exit',code=>resolve({name,passed:code===0,output}));
        });
        await fs.writeFile(path.join(assets,name+'.json'),result.output||result.error||'');
        results.push({name,passed:result.passed}); console.log(name+': '+(result.passed?'passed':'FAILED'));
    }
    const bundle=await fs.readFile(path.join(root,'dist/ai_marker.user.js'));
    const staticAssets=[];
    for(const name of (await fs.readdir(assets)).filter(name=>/^(?:www|oss)\.wylkyj\.com/.test(name))) {
        const body=await fs.readFile(path.join(assets,name));staticAssets.push({name,sha256:createHash('sha256').update(body).digest('hex')});
    }
    const report={source:origin+'/yuejuan/',aiResponseMode:'deterministic',productionApiRequests:0,
        bundleSha256:createHash('sha256').update(bundle).digest('hex'),passed:results.every(x=>x.passed),results,staticAssets};
    await fs.writeFile(path.join(assets,'wuyue-runtime-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({passed:report.passed,cases:results.length,report:path.join(assets,'wuyue-runtime-report.json')}));
    if(!report.passed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
else (async () => {
    await fs.mkdir(assets, { recursive: true });
    const downloader = await request.newContext({ ignoreHTTPSErrors: true });
    const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN
        || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const chemistry = JSON.parse(await fs.readFile(path.join(root, 'tests/fixtures/wuyue-chemistry.json'), 'utf8'));
    const spec = chemistry.cases[caseName], count = caseName === 'workflow-solid' ? 2 : 1;
    const generator = await browser.newPage();
    const png = await generator.evaluate(text => {
        const canvas = document.createElement('canvas'); canvas.width=1200; canvas.height=450;
        const ctx=canvas.getContext('2d'); ctx.fillStyle='#fff';ctx.fillRect(0,0,1200,450);
        ctx.fillStyle='#111';ctx.font='28px sans-serif'; let y=55;
        for(const line of text.split('\n')) for(let i=0;i<line.length;i+=35) {ctx.fillText(line.slice(i,i+35),20,y);y+=45;}
        return canvas.toDataURL('image/png').split(',')[1];
    }, spec?.answer || chemistry.cases['workflow-solid'].answer);
    await generator.close();
    async function asset(url) {
        const u = new URL(url);
        assert.ok(['www.wylkyj.com', 'oss.wylkyj.com'].includes(u.hostname));
        assert.ok(u.pathname === '/yuejuan/' || /\.(js|css|woff2?|ttf|png|jpg|svg|ico)$/.test(u.pathname), url);
        const target = path.join(assets, u.hostname + u.pathname.replace(/\//g, '_'));
        if(u.pathname!=='/yuejuan/')try { return await fs.readFile(target); } catch (_) {}
        const response = await downloader.get(url);
        assert.equal(response.status(), 200, url);
        const body = await response.body(); await fs.writeFile(target, body); return body;
    }
    const context = await browser.newContext({ viewport: { width: 1720, height: 1000 } });
    const errors = [], unknown = [], submissions = [];
    let paper = 0;
    const answer = () => { const stuNo = 'replay-student-' + ++paper; return {
        id: stuNo, info: { id: stuNo, stuNo, secNo: stuNo, markType: 1, markedTchList: [] },
        imageDatas: [{ imageData: origin + '/replay/' + stuNo + '.svg', inPage: 1,
            x: 0, y: 0, width: 900, height: 320 }], postilDatas: []
    }; };
    await context.route('**/*', async route => {
        const req = route.request(), u = new URL(req.url());
        const json = datas => route.fulfill({ json: { code: 200, datas } });
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204,
            headers: { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*' } });
        if (u.pathname.startsWith('/replay/')) return route.fulfill({ contentType: 'image/png', body: Buffer.from(png,'base64') });
        if (req.method()==='GET' && ['/paywx1','/payzfb1','/wxmp1'].includes(u.pathname)) {
            return route.fulfill({contentType:'image/png',body:Buffer.from(png,'base64')});
        }
        if (fixtures[u.pathname]) return json(fixtures[u.pathname]);
        if (u.pathname === '/api/v2/marking/Init') return json(answer());
        if (/\/api\/v1\/marking\/Save(?:AndInit)?$/.test(u.pathname)) {
            submissions.push(req.postDataJSON());
            if(caseName==='network-failure')return route.abort('failed');
            if(caseName==='server-failure')return route.fulfill({json:{code:500,message:'保存失败',datas:{}}});
            if(caseName==='business-failure'||spec?.failure)return json({saveResponse:{code:500,message:'保存失败',datas:{}}});
            if(caseName==='delayed-save')await new Promise(resolve=>setTimeout(resolve,600));
            return json({ saveResponse: { code: 200, datas: { markedQualityData: {} } },
                initResponse: { code: 200, datas: answer() } });
        }
        if ((u.hostname === 'www.wylkyj.com' && u.pathname.startsWith('/yuejuan/'))
            || (u.hostname === 'oss.wylkyj.com' && u.pathname.startsWith('/NewStatic2026/'))) {
            if (req.method() !== 'GET') return route.abort();
            const body = await asset(req.url());
            return route.fulfill({ contentType: u.pathname.endsWith('.js') ? 'text/javascript'
                : u.pathname.endsWith('.css') ? 'text/css' : u.pathname === '/yuejuan/' ? 'text/html' : 'application/octet-stream', body });
        }
        unknown.push({ method: req.method(), path: u.pathname });
        return route.fulfill({ status: 404, body: '' });
    });
    await context.addInitScript(task => {
        localStorage.setItem('token', 'synthetic-replay-only');
        sessionStorage.setItem('TaskParams', JSON.stringify(task));
    }, task);
    if (spec) {
        await context.addInitScript(seedUserscript, { chemistry, spec, png, count });
        await context.addInitScript({ content: "document.addEventListener('DOMContentLoaded', () => {\n"
            + await fs.readFile(path.join(root, 'dist/ai_marker.user.js'), 'utf8') + "\n}, {once:true});" });
    } else if(caseName!=='late-load') await context.addInitScript({ content: (await fs.readFile(path.join(root, 'src/adapters/wuyue/selectors.js'), 'utf8'))
        + '\n' + await fs.readFile(path.join(root, 'src/adapters/wuyue/adapter.js'), 'utf8') });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    try {
        await page.goto(origin + '/yuejuan/#/reading');
        await page.waitForSelector('.computeItem input.el-input__inner:not([disabled])', { timeout: 30000 });
        if(caseName==='late-load') {
            await page.addScriptTag({content:(await fs.readFile(path.join(root,'src/adapters/wuyue/selectors.js'),'utf8'))
                +'\n'+await fs.readFile(path.join(root,'src/adapters/wuyue/adapter.js'),'utf8')});
            const result=await page.evaluate(()=>({filled:__AI_MARKER_ADAPTER__.fillScores([2,2,2]),
                error:__AI_MARKER_ADAPTER__.lastFillError}));
            assert.equal(result.filled,false);assert.match(result.error,/退出阅卷后重新进入/);
            assert.equal(await page.locator('#inputOne').inputValue(),'');assert.equal(submissions.length,0);
            assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);
            console.log(JSON.stringify({caseName,passed:true,productionApiRequests:0}));return;
        }
        if (spec) {
            await page.waitForSelector('.ai-grade-btn'); await page.locator('.ai-grade-btn').click();
            if (spec.scores) {
                for(let n=0;n<count;n++) {
                    await page.waitForSelector('#confirm-submit-btn', { timeout: 15000 });
                    assert.equal(submissions.length,n,'试改等待教师确认');
                    const total=spec.scores.reduce((sum,score)=>sum+score,0);
                    assert.equal(await page.locator('#inputOne').inputValue(),String(total));
                    await page.locator('#confirm-submit-btn').evaluate(el=>{el.click();el.click();});
                    if(spec.failure)break;
                    await page.waitForFunction(n=>JSON.parse(GM_getValue('ai-grading-history','[]')).length===n+1,n);
                    assert.equal(submissions[n].id,'replay-student-'+(n+1));
                    assert.equal(Number(submissions[n].score),total);
                }
            }
            await page.waitForFunction(()=>aiGradingState.isPaused&&!aiGradingState.isRunning,null,{timeout:15000});
            const result=await page.evaluate(()=>({count:aiGradingState.batchProgress.currentCount,
                history:JSON.parse(GM_getValue('ai-grading-history','[]')).map(x=>({score:x.finalScore,status:x.status})),
                aiCalls:__replayAiRequests.length, request:__replayAiRequests[0]}));
            const successful=spec.scores&&!spec.failure?count:0;
            assert.equal(result.count,successful); assert.equal(result.history.length,successful);
            assert.equal(submissions.length,spec.scores?count:0);
            const prompt=JSON.stringify(result.request);
            for(const required of ['2.5','5/2','MnSO4','等量蒸馏水']) assert.ok(prompt.includes(required));
            assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);
            delete result.request;
            console.log(JSON.stringify({caseName,passed:true,aiResponseMode:'deterministic',productionApiRequests:0,...result}));
            return;
        }
        if (caseName === 'compact') {
            await page.locator('.simplifyBase').click();
            await page.locator('.giveCard').waitFor({ state: 'detached' });
        }
        if (caseName === 'auto') await page.locator('.giveCard .auto .el-switch').nth(1).click();
        const adapterState = await page.evaluate(() => ({
            regrade: __AI_MARKER_ADAPTER__.isRegradeMode(),
            filled: __AI_MARKER_ADAPTER__.fillScores([1, 2, 1]),
            error: __AI_MARKER_ADAPTER__.lastFillError,
            inputs: __AI_MARKER_ADAPTER__.getScoreInputs().map(x=>({ label:x.label,maxScore:x.maxScore,value:x.element.value }))
        }));
        assert.equal(adapterState.regrade, false, '正常评卷中的回评入口不代表处于回评');
        assert.equal(adapterState.filled, true, '小题分应汇总到平台总分框');
        await page.waitForTimeout(400);
        assert.equal(submissions.length, 0, '填分必须等待确认，原生自动提交不得抢先保存');
        if(caseName==='steps')assert.deepEqual(await page.locator('.computeItem input.el-input__inner').evaluateAll(xs=>xs.map(x=>x.value)),['1','2','1']);
        else assert.equal(await page.locator('#inputOne').inputValue(), '4');
        let settled=false;
        const pending=page.evaluate(()=>__AI_MARKER_ADAPTER__.submitGrade());pending.then(()=>settled=true);
        if(caseName==='delayed-save'){
            await page.waitForTimeout(150);assert.equal(settled,false,'等待真实回执');
        }
        assert.equal(await pending,!caseName.endsWith('failure'));
        await page.waitForTimeout(600);
        assert.equal(submissions.length, 1);
        assert.equal(Number(submissions[0].score), 4);
        assert.equal(submissions[0].id, 'replay-student-1');
        if(caseName==='server-failure')assert.deepEqual(errors,["Cannot read properties of undefined (reading 'code')"]);
        else if(caseName==='network-failure')assert.ok(errors.some(error=>error.includes("reading 'status'")));
        else assert.deepEqual(errors, []);
        assert.deepEqual(unknown, []);
        console.log(JSON.stringify({ ready: true, errors, unknown, submissions,
            caseName, adapterState }, null, 2));
    } catch (e) {
        await page.screenshot({ path: path.join(assets, 'runtime-failure.png') });
        console.error(JSON.stringify({ error: e.message, errors, unknown, text: await page.locator('body').innerText() }, null, 2));
        process.exitCode = 1;
    } finally { await context.close(); await browser.close(); await downloader.dispose(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
