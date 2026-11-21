const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const moduleCode = fs.readFileSync(path.join(root, 'src/core/marker-account.js'), 'utf8');
const expiresAt = Math.floor(Date.now() / 1000) + 600;
const id = 'a'.repeat(32);
const apiKey = 'sk-' + 'b'.repeat(24);
const tabURL = 'https://tools.aimarking.five-plus-one.com/oauth/start?connect=' + id;

function scenario(claimResponses) {
    const stored = new Map(), requests = [], tabs = [];
    const page = { document: { documentElement: { dataset: {} } } };
    page.window = page.top = page;
    const env = vm.createContext({
        window: page, document: page.document, crypto: webcrypto, structuredClone, AbortSignal, AbortController,
        setTimeout: callback => setTimeout(callback, 1), clearTimeout,
        location: { origin: 'https://tools.aimarking.five-plus-one.com', pathname: '/', hash: '#script-connect=' + id },
        GM_getValue: (name, fallback) => stored.has(name) ? structuredClone(stored.get(name)) : fallback,
        GM_setValue: (name, value) => stored.set(name, structuredClone(value)),
        GM_listValues: () => [...stored.keys()], GM_deleteValue: name => stored.delete(name),
        GM_openInTab: url => {
            const tab = { url, closed: false, close() { this.closed = true; } };
            tabs.push(tab);
            return tab;
        },
        GM_xmlhttpRequest: request => {
            const route = new URL(request.url).pathname;
            const body = JSON.parse(request.data);
            requests.push({ route, body, anonymous: request.anonymous });
            const finish = (status, data) => request.onload({ status, finalUrl: request.url, responseText: JSON.stringify(data) });
            queueMicrotask(() => {
                if (route === '/v1/account/script-flows') finish(201, { id, expiresAt, pollAfter: 2 });
                else if (route.endsWith('/claim')) {
                    const next = claimResponses.shift();
                    if (next === 'network') request.onerror();
                    else if (next === 'pending') finish(202, { pollAfter: 2 });
                    else if (next) finish(200, next);
                    else finish(404, { error: 'connection_expired' });
                } else finish(204, null);
            });
        },
    });
    vm.runInContext(moduleCode, env);
    const evaluate = expression => vm.runInContext(expression, env);
    return { env, evaluate, stored, requests, tabs };
}

test('工具站成功授权后可重领，脚本只保存一份专用连接', async () => {
    const account = { accountId: 15, apiKey, uploadToken: 'fixture-upload-token', expiresAt };
    const { evaluate, stored, requests, tabs } = scenario(['network', account]);
    stored.set('ai-grading-providers-v2', 'existing-manual-settings');
    await evaluate('connectMarkerAccount()');
    assert.equal(tabs[0].url, tabURL);
    assert.equal(tabs[0].closed, true);
    assert.equal(evaluate('markerManagedAccount().accountId'), 15);
    assert.equal(stored.get('ai-grading-providers-v2'), 'existing-manual-settings');
    assert.equal(requests[0].anonymous, true);
    assert.notEqual(requests[0].body.claim, requests[0].body.approval);
    assert.equal(requests[1].body.proof, requests[2].body.proof);
    assert.equal(requests.at(-1).route, '/v1/account/script-flows/complete');
    assert.equal(evaluate('disconnectMarkerAccount()'), true);
    assert.equal(evaluate('markerManagedAccount()'), null);
    assert.equal(stored.get('ai-grading-providers-v2'), 'existing-manual-settings');
});

test('关闭授权标签页后，领取尚未就绪的连接会取消', async () => {
    const { env, evaluate, requests, tabs } = scenario(['pending']);
    env.closeAuthorizationTab = () => { tabs[0].closed = true; };
    await assert.rejects(evaluate("connectMarkerAccount({ onWaiting: closeAuthorizationTab })"), /cancelled/);
    assert.equal(requests.at(-1).route, '/v1/account/script-flows/cancel');
});

test('授权服务未响应时取消立即中止请求，并可重新发起', async () => {
    const account = { accountId: 15, apiKey, uploadToken: 'fixture-upload-token', expiresAt };
    const { env, evaluate, stored, tabs } = scenario([account]);
    const normalRequest = env.GM_xmlhttpRequest;
    let aborted = false;
    env.GM_xmlhttpRequest = request => ({
        abort() { aborted = true; request.onabort(); },
    });
    const connection = evaluate('connectMarkerAccount()');
    evaluate('cancelMarkerConnection()');
    await assert.rejects(connection, /cancelled/);
    assert.equal(aborted, true);
    assert.equal(tabs.length, 0);
    assert.equal(stored.has('aimarker-active-connection-v1'), false);
    env.GM_xmlhttpRequest = normalRequest;
    await evaluate('connectMarkerAccount()');
    assert.equal(evaluate('markerManagedAccount().accountId'), account.accountId);
});

test('工具站回调只在对应的本地授权存在时提交，URL 不包含证明', async () => {
    const { env, evaluate, stored } = scenario([]);
    const proof = 'c'.repeat(64);
    let sent;
    env.fetch = async (url, init) => {
        sent = { url, init };
        return { ok: true, async json() { return { approved: true }; } };
    };
    await evaluate('finishMarkerAccount()');
    assert.equal(sent, undefined);
    stored.set('aimarker-portal-flow-' + id, { approval: proof, expires: expiresAt * 1000 });
    await evaluate('finishMarkerAccount()');
    assert.equal(sent.url, 'https://tools.aimarking.five-plus-one.com/v1/portal/connect');
    assert.equal(sent.init.credentials, 'same-origin');
    assert.equal(JSON.parse(sent.init.body).proof, proof);
    assert.equal(env.document.documentElement.dataset.markerAccount, 'approved');
});
