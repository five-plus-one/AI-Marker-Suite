const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/core/marker-account.js'), 'utf8');
const accountOrigin = 'https://api.ai.five-plus-one.com';
const serviceOrigin = 'https://api.aimarking.five-plus-one.com';
const authorization = 'https://oauth.five-plus-one.com/oauth/authorize';

function harness(callback) {
    const requests = [];
    const values = new Map();
    const window = { location: { origin: 'https://school.example', assign: url => requests.push({ navigate: url }) } };
    window.top = window;
    const context = vm.createContext({
        window, URL, AbortSignal, crypto: require('node:crypto').webcrypto,
        setTimeout: callback => queueMicrotask(callback),
        fetch: async (url, options) => {
            const request = { url, method: options.method, headers: options.headers, body: options.body };
            requests.push(request);
            const data = callback(request);
            return { ok: true, json: async () => ({ success: true, data }) };
        },
        getOfficialApiLine: () => 'backup',
        GM_getValue: (key, fallback) => values.get(key) ?? fallback,
        GM_setValue: (key, value) => values.set(key, value),
        GM_listValues: () => [...values.keys()],
        GM_deleteValue: key => values.delete(key),
    });
    vm.runInContext(source, context, { filename: 'marker-account.js' });
    return { context, requests, values, window };
}

test('账号授权只发往官方身份入口，回调地址固定', async () => {
    const { context, requests } = harness(({ url }) => {
        if (url.endsWith('/api/status')) return { custom_oauth_providers: [{
            slug: '5plus1-account', client_id: 'marker-test', authorization_endpoint: authorization,
        }] };
        return { flow_token: 'challenge-issued-by-account-service' };
    });
    await vm.runInContext('markerBeginOAuth()', context);
    const target = new URL(requests.at(-1).navigate);
    assert.equal(target.origin, new URL(authorization).origin);
    assert.equal(target.searchParams.get('redirect_uri'), accountOrigin + '/oauth/5plus1-account');
    assert.equal(target.searchParams.get('state'), 'challenge-issued-by-account-service');
    assert.deepEqual(JSON.parse(requests[1].body), { provider: '5plus1-account', intent: 'login' });
});

test('外部授权地址被拒绝，浏览器保持当前页面', async () => {
    const { context, requests } = harness(() => ({ custom_oauth_providers: [{
        slug: '5plus1-account', client_id: 'marker-test', authorization_endpoint: 'https://oauth.example/authorize',
    }] }));
    await assert.rejects(vm.runInContext('markerBeginOAuth()', context), /登录地址/);
    assert.equal(requests.length, 1);
});

test('仅复用脚本专用密钥，首次连接由同账号创建', async () => {
    let created = false;
    const { context, requests } = harness(({ url, method, body }) => {
        if (url.includes('/search?')) return { items: [
            { id: 20, name: '其他应用', status: 1, group: 'default', expired_time: -1 },
            ...(created ? [{ id: 21, name: 'AI 批改助手浏览器脚本', status: 1, group: 'default', expired_time: -1 }] : []),
        ] };
        if (method === 'POST' && url.endsWith('/api/token/')) {
            created = true;
            assert.equal(JSON.parse(body).name, 'AI 批改助手浏览器脚本');
            return {};
        }
        assert.equal(url, accountOrigin + '/api/token/21/key');
        return { key: 'synthetic-key-attr-value' };
    });
    const result = await vm.runInContext('markerProvisionKey("synthetic-session")', context);
    assert.equal(result, 'sk-synthetic-key-attr-value');
    assert.equal(requests.filter(request => request.url.endsWith('/api/token/')).length, 1);
    assert.ok(requests.every(request => request.headers.Authorization === 'Bearer synthetic-session'));
});

test('登录回执只从发起端脚本存储获取，并保留当前线路', async () => {
    const { context, values, window } = harness(() => { throw Error('no account requests expected'); });
    const saved = [];
    context.ProviderManager = {
        getProvider: () => ({ endpointLine: 'backup' }),
        saveOfficialConnection: (line, key) => { saved.push({ line, key }); return true; },
    };
    window.open = (raw, target, options) => {
        const url = new URL(raw);
        assert.equal(url.origin, accountOrigin);
        assert.equal(target, '_blank');
        assert.match(options, /noopener/);
        const id = url.hash.split('=')[1];
        assert.match(id, /^[a-f0-9]{32}$/);
        const key = 'aimarker-account-flow-' + id;
        assert.equal(values.get(key).status, 'pending');
        values.set(key, {
            expires: Date.now() + 1000, status: 'complete', apiKey: 'sk-synthetic-key-attr-value',
            uploadSession: { token: 'synthetic-upload-lease', expiresAt: Date.now() / 1000 + 60 },
        });
    };
    const outcome = await vm.runInContext('connectMarkerAccount()', context);
    assert.equal(outcome.uploadReady, true);
    assert.deepEqual(saved, [{ line: 'backup', key: 'sk-synthetic-key-attr-value' }]);
    assert.equal(values.size, 1);
    assert.ok(values.has('aimarker-diagnostic-upload-session'));
});

test('跨站重定向的诊断响应不可作为成功回执', async () => {
    const { context } = harness(() => {});
    context.GM_xmlhttpRequest = config => {
        assert.equal(config.url, serviceOrigin + '/v1/diagnostics');
        assert.equal(config.anonymous, true);
        assert.equal(config.redirect, 'error');
        config.onload({ status: 200, finalUrl: 'https://untrusted.example/', responseText: '{"receipt":"fake"}' });
    };
    await assert.rejects(vm.runInContext('markerServiceRequest("/v1/diagnostics", "POST", "upload-token", "{}")', context));
});
