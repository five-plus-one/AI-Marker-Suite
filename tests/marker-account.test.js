const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/core/marker-account.js'), 'utf8');
const accountOrigin = 'https://api.ai.five-plus-one.com';
const toolsOrigin = 'https://tools.aimarking.five-plus-one.com';
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

test('发起端轮询 API 领取一次性结果，并保留当前线路', async () => {
    const { context, values, window } = harness(() => { throw Error('no account requests expected'); });
    const saved = [];
    const id = 'e'.repeat(32);
    const expiresAt = Math.floor(Date.now() / 1000 + 60);
    let proofs, polls = 0;
    context.ProviderManager = {
        getProvider: () => ({ endpointLine: 'backup' }),
        saveOfficialConnection: (line, key) => { saved.push({ line, key }); return true; },
    };
    window.open = (raw, target, options) => {
        const url = new URL(raw);
        assert.equal(url.origin, toolsOrigin);
        assert.equal(target, '_blank');
        assert.match(options, /noopener/);
        assert.equal(url.hash, '#aimarker-connect=' + id);
        const pending = values.get('aimarker-account-flow-' + id);
        assert.equal(pending.status, 'pending');
        assert.equal(pending.approval, proofs.approval);
        assert.equal(pending.claim, undefined);
        assert.equal(pending.apiKey, undefined);
    };
    context.GM_xmlhttpRequest = request => {
        assert.equal(request.headers.Authorization, undefined);
        const input = JSON.parse(request.data);
        let status = 201, body = { id, expiresAt, pollAfter: 2 };
        if (request.url === serviceOrigin + '/v1/account/flows') {
            proofs = input;
            assert.match(proofs.claim, /^[a-f0-9]{64}$/);
            assert.match(proofs.approval, /^[a-f0-9]{64}$/);
            assert.notEqual(proofs.claim, proofs.approval);
        } else {
            assert.equal(request.url, serviceOrigin + '/v1/account/flows/claim');
            assert.deepEqual(input, { id, proof: proofs.claim });
            status = ++polls === 1 ? 202 : 200;
            body = status === 202 ? { pollAfter: 2 } : { apiKey: 'sk-synthetic-key-attr-value', uploadToken: 'synthetic-upload-lease', expiresAt };
        }
        request.onload({ status, finalUrl: request.url, responseText: JSON.stringify(body) });
    };
    const outcome = await vm.runInContext('connectMarkerAccount()', context);
    assert.equal(outcome.uploadReady, true);
    assert.equal(polls, 2);
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
