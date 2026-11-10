const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const candidates = [process.env.CHROME_BIN, process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome', '/usr/bin/chromium'];
const browser = candidates.find(candidate => candidate && fs.existsSync(candidate));
if (!browser) throw Error('Chrome is required for browser acceptance');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(url) {
    const socket = new WebSocket(url); let sequence = 0;
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const pending = new Map();
    socket.onclose = () => { for (const handler of pending.values()) handler.reject(Error("Browser connection closed")); pending.clear(); };
    socket.onmessage = event => {
        const reply = JSON.parse(event.data), handler = pending.get(reply.id);
        if (handler) { pending.delete(reply.id); reply.error ? handler.reject(Error(reply.error.message)) : handler.resolve(reply.result); }
    };
    return { socket, send(method, params = {}) { return new Promise((resolve, reject) => {
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
        for (const fixture of ['workflow', 'renderer', 'bundle']) for (const width of [1280, 420]) for (const theme of ['light', 'dark']) {
            await client.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
            await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
            const runId = `${fixture}-${width}-${theme}-${Date.now()}`;
            await client.send('Page.navigate', { url: pathToFileURL(path.join(root, `tests/fixtures/${fixture}.html`)).href + '?run=' + runId });
            let result;
            for (let count = 0; count < 200; count++) {
                const reply = await client.send('Runtime.evaluate', { expression: "document.getElementById('result')?.textContent || ''", returnByValue: true });
                if (reply.result?.value) {
                    const candidate = JSON.parse(Buffer.from(reply.result.value, 'base64').toString());
                    if (candidate.runId === runId) { result = candidate; break; }
                }
                await pause(50);
            }
            if (!result?.passed || Math.abs(result.width - width) > 1) throw Error(JSON.stringify(result || { error: 'No browser result' }));
            results.push({ fixture, width, theme, ...result });
        }
        console.log(JSON.stringify({ passed: true, results }));
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
