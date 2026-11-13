const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { isCancelledInterception } = require('./browser-interception.cjs');
const root = path.resolve(__dirname, '..');
const candidates = [process.env.CHROME_BIN, process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome', '/usr/bin/chromium'];
const browser = candidates.find(candidate => candidate && fs.existsSync(candidate));
if (!browser) throw Error('Chrome is required for browser acceptance');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(url) {
    const socket = new WebSocket(url); let sequence = 0;
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const pending = new Map(), listeners = new Set();
    socket.onclose = () => { for (const handler of pending.values()) handler.reject(Error("Browser connection closed")); pending.clear(); };
    socket.onmessage = event => {
        const reply = JSON.parse(event.data), handler = pending.get(reply.id);
        if (handler) { pending.delete(reply.id); reply.error ? handler.reject(Error(reply.error.message)) : handler.resolve(reply.result); }
        else if (reply.method) for (const listener of listeners) listener(reply);
    };
    return { socket, onEvent(listener) { listeners.add(listener); }, send(method, params = {}) { return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(Error("Browser command timed out: " + method)); }, 15000);
        pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
        socket.send(JSON.stringify({ id, method, params }));
    }); } };
}
(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aimarker-browser-'));
    const child = spawn(browser, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-background-networking',
        '--allow-file-access-from-files', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    const results = []; let browserClient, client;
    try {
        const activePort = path.join(profile, 'DevToolsActivePort');
        for (let count = 0; count < 200 && !fs.existsSync(activePort); count++) await pause(100);
        if (!fs.existsSync(activePort)) throw Error('Chrome debugging endpoint unavailable');
        const [port, browserPath] = fs.readFileSync(activePort, 'utf8').trim().split(/\r?\n/);
        browserClient = await connect('ws://127.0.0.1:' + port + browserPath);
        const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
        client = await connect(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
        await client.send('Page.enable');
        await client.send('Runtime.enable');
        await client.send('Network.enable');
        const selected = process.argv.find(arg => arg.startsWith('--fixture='))?.slice(10);
        const fixtures = ['workflow', 'renderer', 'bundle', 'output-mode', 'subscore', 'startup', 'startup-registration', 'startup-navigation', 'qiguang',
            'qiguang-original-deployment', 'qiguang-public-deployment', 'qiguang-private-deployment', 'qiguang-domain-deployment',
            'qiguang-late-deployment', 'qiguang-module-negative', 'qiguang-form-negative', 'ameqp-fast', 'ameqp-slow',
            'ameqp-multi', 'ameqp-unknown', 'ameqp-prefixed', 'ameqp-query', 'ameqp-unknown-multi', 'ameqp-mixed', 'zhixue', 'qiguang-zhenxue-deployment',
            'qiguang-zhenxue-late', 'qiguang-zhenxue-module-negative',
            'jzsmartedu-ready', 'jzsmartedu-scoreboard', 'jzsmartedu-late', 'jzsmartedu-spa', 'jzsmartedu-foreign-route',
            'jiukexing-ready', 'jiukexing-multi', 'jiukexing-late', 'jiukexing-spa', 'haofenshu']
            .filter(fixture => !selected || fixture === selected);
        if (!fixtures.length) throw Error('Unknown browser fixture');
        let consoleMessages = [];
        let interceptionEnabled = false, interceptionError, navigation = 0, cancelledInterceptions = 0;
        const cancelledRequests = new Set();
        const deploymentHtml = fs.readFileSync(path.join(root, 'tests/fixtures/qiguang-deployment.html'), 'utf8');
        const ameqpHtml = fs.readFileSync(path.join(root, 'tests/fixtures/ameqp.html'), 'utf8');
        const jzsmarteduHtml = fs.readFileSync(path.join(root, 'tests/fixtures/jzsmartedu.html'), 'utf8');
        const jiukexingHtml = fs.readFileSync(path.join(root, 'tests/fixtures/jiukexing.html'), 'utf8');
        const haofenshuHtml = fs.readFileSync(path.join(root, 'tests/fixtures/haofenshu.html'), 'utf8');
        const bundle = fs.readFileSync(path.join(root, 'dist/ai_marker.user.js'));
        const zhixueHtml = fs.readFileSync(path.join(root, 'tests/fixtures/zhixue.html'), 'utf8');
        client.onEvent(event => {
            if (event.method === 'Network.loadingFailed' && (event.params.canceled || event.params.errorText === 'net::ERR_ABORTED')) cancelledRequests.add(event.params.requestId);
            if (event.method === 'Runtime.exceptionThrown') {
                consoleMessages.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
            }
            if (event.method === 'Runtime.consoleAPICalled') {
                consoleMessages.push(event.params.args.map(arg => arg.value ?? arg.description).join(' ').slice(0, 1500));
                if (consoleMessages.length > 16) consoleMessages.shift();
            }
            if (event.method !== 'Fetch.requestPaused') return;
            const requestNavigation = navigation;
            (async () => {
                const url = new URL(event.params.request.url);
                let body = '', type = 'text/plain', status = 404;
                if (url.hostname === 'www.zhixue.com' && url.pathname === '/webmarking/marking/personal/') {
                    body = zhixueHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'yue.haofenshu.com' && url.pathname.startsWith('/minions/subject/')) {
                    body = haofenshuHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'yue.haofenshu.com' && url.pathname.startsWith('/v1/baidu-raw/')) {
                    body = '<svg xmlns="http://www.w3.org/2000/svg" width="1494" height="673"><text x="10" y="40">fixture answer</text></svg>';
                    type = 'image/svg+xml'; status = 200;
                } else if (url.hostname === 'marking.jkxjxw.com' && ['/marking', '/task/taskDetail'].includes(url.pathname)) {
                    body = jiukexingHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'jzjx.jzsmartedu.cn' && url.pathname === '/dnpc/') {
                    body = jzsmarteduHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.pathname === '/OraOnlineCheck/OraCheck/Review') {
                    body = deploymentHtml;
                    if (url.hostname === 'crock.51zhenxue.com') body = body.replace(
                        '<script src="/Scripts/require.js" data-main="examOnlineOrc.js"></script>',
                        '<script src="/Scripts/app/dev/examOnlineOrc.js" data-requiremodule="examOnlineOrc"></script>');
                    if (url.searchParams.get('mode') === 'foreign-main') body = body
                        .replace('data-main="examOnlineOrc.js"', 'data-main="other.js"')
                        .replace('data-requiremodule="examOnlineOrc"', 'data-requiremodule="other"');
                    type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.pathname === '/AMEQP/Webroot/mar/mar_mark.aspx') {
                    body = ameqpHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (/^\/answers\/(?:\d+|scan_\d+)_\d+_\d+_\d+\.svg$/.test(url.pathname)
                    || /^\/answers\/生物地理_\d+\.svg$/.test(decodeURIComponent(url.pathname)) || url.pathname === '/answers/image.ashx') {
                    body = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><text x="10" y="40">answer ' + url.pathname + '</text></svg>';
                    type = 'image/svg+xml'; status = 200;
                } else if (url.pathname === '/__fixture/ai_marker.user.js') {
                    body = bundle; type = 'text/javascript; charset=utf-8'; status = 200;
                } else if (url.pathname === '/Scripts/require.js' || url.pathname === '/Scripts/app/dev/examOnlineOrc.js') {
                    type = 'text/javascript'; status = 200;
                } else if (url.pathname === '/__fixture/answer.svg') {
                    body = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><text x="10" y="30">fixture answer</text></svg>';
                    type = 'image/svg+xml'; status = 200;
                }
                await client.send('Fetch.fulfillRequest', { requestId: event.params.requestId, responseCode: status,
                    responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Cache-Control', value: 'no-store' }],
                    body: Buffer.from(body).toString('base64') });
            })().catch(async error => {
                if (await isCancelledInterception(error, () => requestNavigation !== navigation || cancelledRequests.has(event.params.networkId))) {
                    cancelledInterceptions++;
                    return;
                }
                interceptionError = new Error(`${error.message} (${event.params.request.url}; request ${event.params.networkId}; navigation ${requestNavigation}/${navigation})`);
            });
        });
        for (const fixture of fixtures) for (const width of [1280, 420]) for (const theme of ['light', 'dark']) {
            consoleMessages = [];
            await client.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
            await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
            const runId = `${fixture}-${width}-${theme}-${Date.now()}`;
            const startup = fixture.startsWith('startup');
            const mode = fixture === 'startup-registration' ? 'late-registration' : fixture === 'startup-navigation' ? 'spa-entry' : 'late-dom';
            const deployment = fixture.startsWith('qiguang-');
            const ameqp = fixture.startsWith('ameqp-');
            const jzsmartedu = fixture.startsWith('jzsmartedu-');
            const jiukexing = fixture.startsWith('jiukexing-');
            const haofenshu = fixture === 'haofenshu';
            const zhixue = fixture === 'zhixue';
            let url = pathToFileURL(path.join(root, `tests/fixtures/${startup ? 'startup' : fixture}.html`)).href + '?run=' + runId + '&mode=' + mode;
            if (deployment || ameqp || jzsmartedu || jiukexing || haofenshu || zhixue) {
                if (!interceptionEnabled) { await client.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }); interceptionEnabled = true; }
                const origin = fixture.startsWith('qiguang-zhenxue-') ? 'https://crock.51zhenxue.com'
                    : fixture === 'qiguang-original-deployment' ? 'http://120.78.5.37:8091'
                    : fixture === 'qiguang-domain-deployment' ? 'https://mark.school.example'
                    : fixture === 'qiguang-private-deployment' ? 'http://10.15.0.8:8089' : 'http://192.0.2.20:8091';
                const deploymentMode = fixture === 'qiguang-late-deployment' || fixture === 'qiguang-zhenxue-late' ? 'late'
                    : fixture === 'qiguang-module-negative' || fixture === 'qiguang-zhenxue-module-negative' ? 'foreign-main'
                    : fixture === 'qiguang-form-negative' ? 'foreign-form' : 'ready';
                url = origin + '/OraOnlineCheck/OraCheck/Review?run=' + runId + '&mode=' + deploymentMode + '&SubjectId=subject&questionGroupId=group';
                if (ameqp) url = 'http://10.20.0.8/AMEQP/Webroot/mar/mar_mark.aspx?run=' + runId + '&mode=' + fixture.slice(6);
                if (jzsmartedu) {
                    const jzMode = fixture.slice(11);
                    const route = jzMode === 'spa' ? '/home' : jzMode === 'foreign-route' ? '/v2/read-paper/question-block' : '/v2/read-paper';
                    url = 'https://jzjx.jzsmartedu.cn/dnpc/?run=' + runId + '&mode=' + jzMode
                        + '#' + route + '?examPaperId=exam&readBlockId=block&readPaperType=1';
                }
                if (jiukexing) url = 'https://marking.jkxjxw.com/' + (fixture === 'jiukexing-spa' ? 'task/taskDetail' : 'marking')
                    + '?run=' + runId + '&mode=' + fixture.slice(10) + '&examId=exam&subjectId=subject&questionBlockId=block&isdp=1';
                if (haofenshu) url = 'https://yue.haofenshu.com/minions/subject/10500001/mark/1/normal/0?run=' + runId;
                if (zhixue) url = 'https://www.zhixue.com/webmarking/marking/personal/?run=' + runId;
            }
            navigation++;
            await client.send('Page.navigate', { url });
            let result;
            for (let count = 0; count < (ameqp || zhixue ? 650 : startup ? 400 : 200); count++) {
                if (interceptionError) throw interceptionError;
                const reply = await client.send('Runtime.evaluate', { expression: "document.getElementById('result')?.textContent || ''", returnByValue: true });
                if (reply.result?.value) {
                    const candidate = JSON.parse(Buffer.from(reply.result.value, 'base64').toString());
                    if (candidate.runId === runId) { result = candidate; break; }
                }
                await pause(50);
            }
            if (!result?.passed || Math.abs(result.width - width) > 1) {
                const page = await client.send('Runtime.evaluate', { expression: 'document.body.innerText.slice(-3000)', returnByValue: true });
                throw Error(JSON.stringify({ ...(result || { error: 'No browser result' }), consoleMessages, page: page.result?.value }));
            }
            results.push({ fixture, width, theme, ...result });
        }
        if (interceptionError) throw interceptionError;
        console.log(JSON.stringify({ passed: true, cancelledInterceptions, results }));
    } finally {
        client?.socket.close();
        if (browserClient) { try { await browserClient.send('Browser.close'); } catch (_) {} browserClient.socket.close(); }
        await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(2000)]);
        if (child.exitCode == null) child.kill();
        // The absolute target was created by mkdtemp directly under the OS temp directory.
        if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('aimarker-browser-')) {
            try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (_) {}
        }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
