// 原站公开 Vue 前端 + 合成 API/答卷 + 完整安装包的端到端验收。
// 所有页面请求均被拦截；仅静态前端资源允许下载，生产 API 永不放行。
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { chromium, request } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const origin = 'https://yuejuan.wzedu.cn';
const appPath = '/static-v2/exam/';
const assets = path.resolve(process.argv.find(x => x.startsWith('--assets='))?.slice(9)
    || path.join(os.tmpdir(), 'ai-marker-wzedu-assets'));
const cases = [
    { name: 'trial-two', mode: 'trial', count: 2, score: 3, delay: 300 },
    { name: 'keyboard-zero', mode: 'trial', count: 1, score: 0, keyboard: true },
    { name: 'decimal', mode: 'trial', count: 1, score: 2.5 },
    { name: 'unattended-two', mode: 'unattended', count: 2, score: 3 },
    { name: 'server-rejection', mode: 'trial', count: 1, score: 3, failure: 'server' },
    { name: 'business-rejection', mode: 'trial', count: 1, score: 3, failure: 'business' },
    { name: 'network-error', mode: 'trial', count: 1, score: 3, failure: 'network' },
    { name: 'cancel-during-ai', mode: 'trial', count: 1, score: 3, cancel: true },
    { name: 'switch-during-ai', mode: 'trial', count: 1, score: 3, switchPaper: true }
];

function seedUserscript({ spec, png }) {
    const config = { provider: '验收', model: 'replay-model', workflowId: 'replay', gradingMode: spec.mode,
        question: '31(1) 指出商鞅变法并说明影响。',
        answer: '事件：商鞅变法（1分）；影响：使秦国国力增强，为秦统一全国奠定基础（2分）。',
        rubric: '事件1分，当时影响1分，未来影响1分。',
        scoring: { maxScore: 3, units: [{ label: '31(1)', maxScore: 3, index: 0, roundStep: 0.5 }],
            roundStep: 0.5, roundMethod: 'round' },
        questionGuard: { enabled: false }, blankDetection: { enabled: false }, humanPacing: { enabled: false },
        batchConfig: { enabled: true, targetCount: spec.count } };
    const values = {
        'ai-grading-show-onboarding': false,
        'ai-grading-presets': JSON.stringify({ list: { 验收: config }, active: '验收', bindings: { 'huahanyun#wzedu#42#0': '验收' } }),
        'ai-grading-providers-v2': JSON.stringify({ providers: { 验收: { endpoint: 'https://replay.invalid/v1/chat/completions',
            apiKey: 'replay-only', models: { 'replay-model': { label: '验收模型' } } } }, activeProvider: '验收', activeModel: 'replay-model' }),
        'ai-grading-workflows': JSON.stringify({ workflows: { replay: { id: 'replay', name: '验收',
            model: { provider: '验收', model: 'replay-model' }, dualEval: { enabled: false } } } })
    };
    window.GM_getValue = (key, fallback) => values[key] ?? fallback;
    window.GM_setValue = (key, value) => { values[key] = value; };
    window.GM_registerMenuCommand = () => {};
    window.__replayAiRequests = [];
    window.GM_xmlhttpRequest = options => {
        let cancelled = false;
        const timer = setTimeout(() => {
            if (cancelled) return;
            if (options.url.startsWith('https://replay.invalid/')) {
                const content = `【答案复述】\n商鞅变法。使秦国国力增强，为秦统一全国奠定基础。\n【作答状态】\n已作答\n【评分依据】\n依据参考答案评分。\n【分数计算】\n${spec.score}\n【最终得分】\n${spec.score}分`;
                const responseText = 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] })
                    + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
                options.onload?.({ status: 200, responseText });
            } else if (options.url.startsWith(location.origin + '/r/acceptance:') && options.responseType === 'arraybuffer') {
                options.onload?.({ status: 200, response: Uint8Array.from(atob(png), c => c.charCodeAt(0)).buffer });
            } else options.onerror?.({ error: 'unexpected GM request' });
        }, options.url.startsWith('https://replay.invalid/') && (spec.cancel || spec.switchPaper) ? 800 : 0);
        if (options.url.startsWith('https://replay.invalid/')) window.__replayAiRequests.push(JSON.parse(options.data));
        return { abort() { cancelled = true; clearTimeout(timer); options.onabort?.(); } };
    };
}

(async () => {
    const fixture = JSON.parse(await fs.readFile(path.join(root, 'tests/fixtures/wzedu-api.json'), 'utf8'));
    const bundle = await fs.readFile(path.join(root, 'dist/ai_marker.user.js'), 'utf8');
    await fs.mkdir(assets, { recursive: true });
    const downloader = await request.newContext({ ignoreHTTPSErrors: true });
    const executablePath = process.env.CHROME_BIN || (process.platform === 'win32'
        ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');
    const browser = await chromium.launch({ executablePath, headless: true });
    const results = [];
    async function asset(url) {
        const pathname = new URL(url).pathname;
        assert.ok(pathname.startsWith(appPath) && !pathname.includes('..'));
        const name = pathname.split('/').pop();
        const target = path.join(assets, name);
        try { return await fs.readFile(target); } catch (_) {}
        const response = await downloader.get(url);
        assert.equal(response.status(), 200, 'public static asset: ' + pathname);
        const body = await response.body(); await fs.writeFile(target, body); return body;
    }
    try {
        const generator = await browser.newPage();
        const png = await generator.evaluate(() => {
            const canvas = document.createElement('canvas'); canvas.width = 1030; canvas.height = 400;
            const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1030, 400);
            ctx.fillStyle = '#111'; ctx.font = '32px sans-serif';
            ctx.fillText('31(1) 商鞅变法。使秦国国力增强，', 20, 90);
            ctx.fillText('为秦统一全国奠定了基础。', 20, 150);
            return canvas.toDataURL('image/png').split(',')[1];
        });
        await generator.close();
        for (const spec of cases.filter(x => !process.argv.some(a => a.startsWith('--case='))
            || x.name === process.argv.find(a => a.startsWith('--case=')).slice(7))) {
            const context = await browser.newContext({ viewport: { width: 1720, height: 1000 } });
            let index = 0;
            const submissions = [], unknownApi = [], errors = [];
            const infoFor = student => {
                const body = structuredClone(fixture['/v2/union/mark/mark-page-info']);
                const info = body.data.data;
                info.studentId = student; info.sheetId = student - 900; info.teacherDoneNumber = index;
                info.urls = [`${origin}/r/acceptance:/union_new/10/20/30/student/${student}/hash/web/42.png`];
                info.question.markingType = spec.keyboard ? 1 : 2;
                info.questions[0].markingType = spec.keyboard ? 1 : 2;
                return body;
            };
            await context.route('**/*', async route => {
                const req = route.request(), url = new URL(req.url());
                if (url.origin !== origin) return route.fulfill({ status: 404, body: '' });
                if (/^\/v2\/(union|exam)\/mark\/submit$/.test(url.pathname)) {
                    submissions.push(req.postDataJSON());
                    if (spec.delay) await new Promise(resolve => setTimeout(resolve, spec.delay));
                    if (spec.failure === 'network') return route.abort('failed');
                    if (spec.failure === 'server') return route.fulfill({ json: { code: 500, msg: '保存失败', data: {} } });
                    if (spec.failure === 'business') return route.fulfill({ json: { code: 200,
                        data: { exist: false, resultType: 2, msg: '评分阶段已变化，请核对' } } });
                    index++; return route.fulfill({ json: infoFor(1001 + index) });
                }
                if (url.pathname === '/v2/union/mark/mark-page-info') return route.fulfill({ json: infoFor(1001 + index) });
                if (fixture[url.pathname]) return route.fulfill({ json: fixture[url.pathname] });
                if (url.pathname.startsWith('/r/acceptance:')) return route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') });
                if (url.pathname === appPath + 'index.html') {
                    const html = (await asset(origin + appPath + 'index.html')).toString().replace(/<link[^>]*rel="prefetch"[^>]*>/g, '');
                    return route.fulfill({ contentType: 'text/html', body: html });
                }
                if (url.pathname.startsWith(appPath) && /\.(js|css|woff2?|ttf|png|jpg|svg|ico)$/.test(url.pathname)) {
                    const body = await asset(req.url());
                    return route.fulfill({ contentType: url.pathname.endsWith('.js') ? 'text/javascript'
                        : url.pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream', body });
                }
                if (url.pathname.startsWith('/v2/') || url.pathname.startsWith('/login/')) unknownApi.push(url.pathname);
                return route.fulfill({ status: 404, body: '' });
            });
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            try {
                await page.goto(origin + appPath + 'index.html#/marking/grading?questionId=42&thisType=2&isSchool=1&choiceIndex=0');
                await page.waitForSelector('.submitscorebtn', { timeout: 20000 });
                await page.evaluate(seedUserscript, { spec, png });
                await page.addScriptTag({ content: bundle });
                await page.waitForSelector('.ai-grade-btn');
                await page.locator('.ai-grade-btn').click();
                if (spec.cancel || spec.switchPaper) {
                    await page.waitForFunction(() => window.__replayAiRequests.length === 1);
                    if (spec.cancel) await page.locator('.ai-grade-btn').click();
                    else await page.evaluate(info => {
                        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
                        store.commit('mark/SET_READOVER', info);
                        for (const img of document.querySelectorAll('img.el-image__inner')) {
                            if (img.src.includes('/student/')) img.src = info.urls[0];
                        }
                    }, infoFor(2001).data.data);
                    await page.waitForTimeout(1300);
                    assert.equal(submissions.length, 0);
                    assert.equal(await page.locator('#confirm-submit-btn').count(), 0);
                } else if (spec.mode === 'trial') {
                    for (let n = 0; n < spec.count; n++) {
                        await page.waitForSelector('#confirm-submit-btn', { timeout: 15000 });
                        assert.equal(submissions.length, n, 'trial must wait for confirmation');
                        assert.equal(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.mark.questionScore), spec.score);
                        await page.locator('#confirm-submit-btn').evaluate(el => { el.click(); el.click(); });
                        if (spec.delay) {
                            await page.waitForTimeout(100);
                            assert.equal(await page.evaluate(() => JSON.parse(GM_getValue('ai-grading-history', '[]')).length), n,
                                'history waits for server acknowledgment');
                        }
                        if (spec.failure) break;
                        await page.waitForFunction(n => JSON.parse(GM_getValue('ai-grading-history', '[]')).length === n + 1, n);
                    }
                }
                if (!(spec.cancel || spec.switchPaper)) {
                    await page.waitForFunction(() => aiGradingState.isPaused && !aiGradingState.isRunning, null, { timeout: 15000 });
                }
                const state = await page.evaluate(() => ({
                    history: JSON.parse(GM_getValue('ai-grading-history', '[]')).map(x => ({ score: x.finalScore, status: x.status })),
                    aiCalls: __replayAiRequests.length,
                    imagesPerCall: __replayAiRequests.map(x => x.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(x => x.type === 'image_url').length),
                    count: aiGradingState.batchProgress.currentCount,
                    identity: __AI_MARKER_ADAPTER__.getPaperIdentity()
                }));
                const successful = spec.failure || spec.cancel || spec.switchPaper ? 0 : spec.count;
                assert.equal(state.history.length, successful);
                assert.equal(state.count, successful);
                assert.equal(submissions.length, spec.cancel || spec.switchPaper ? 0 : spec.failure ? 1 : spec.count);
                assert.deepEqual(state.imagesPerCall, Array(state.aiCalls).fill(1));
                for (let n = 0; n < submissions.length; n++) {
                    assert.equal(submissions[n].studentId, 1001 + n);
                    assert.equal(submissions[n].sheetId, 101 + n);
                    assert.equal(submissions[n].questionId, 42);
                    assert.equal(submissions[n].score, spec.score);
                }
                for (const record of state.history) { assert.equal(record.score, spec.score); assert.equal(record.status, 'submitted'); }
                assert.deepEqual(unknownApi, []);
                if (!spec.failure) assert.deepEqual(errors, []);
                results.push({ name: spec.name, passed: true, ...state, nativeErrors: errors });
                console.error(spec.name + ': passed');
            } catch (error) {
                results.push({ name: spec.name, passed: false, error: error.stack, nativeErrors: errors });
                console.error(spec.name + ': FAILED ' + error.message);
                await page.screenshot({ path: path.join(assets, spec.name + '-failure.png') }).catch(() => {});
            } finally { await context.close(); }
        }
    } finally { await browser.close(); await downloader.dispose(); }
    console.log(JSON.stringify({ bundleSha256: createHash('sha256').update(bundle).digest('hex'),
        source: origin + appPath, productionApiRequests: 0, passed: results.every(x => x.passed), results }, null, 2));
    if (results.some(x => !x.passed)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
