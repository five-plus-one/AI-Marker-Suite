const MARKER_TOOLS_ORIGIN = 'https://tools.aimarking.five-plus-one.com';
const MARKER_SERVICE_ORIGIN = 'https://api.aimarking.five-plus-one.com';
const MARKER_ACCOUNT_KEY = 'aimarker-connected-account-v1';
const MARKER_ACTIVE_CONNECTION = 'aimarker-active-connection-v1';
const MARKER_CONNECTION_PREFIX = 'aimarker-portal-flow-';
const MARKER_CONNECTION_LIFETIME = 10 * 60 * 1000;
const MARKER_SCRIPT_FLOW = '/v1/account/script-flows';
const markerFlowID = /^[a-f0-9]{32}$/;
const markerServiceKey = /^sk-[A-Za-z0-9_-]{16,256}$/;
let markerConnection;

function markerRandomHex(bytes) {
    return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function markerManagedAccount() {
    try {
        const account = GM_getValue(MARKER_ACCOUNT_KEY, null);
        return Number.isSafeInteger(account?.accountId) && account.accountId > 0 &&
            markerServiceKey.test(account.apiKey || '') ? account : null;
    } catch (_) { return null; }
}

function markerUploadCredential() {
    const account = markerManagedAccount();
    return typeof account?.uploadToken === 'string' && account.expiresAt * 1000 > Date.now() ? account : null;
}

function markerServiceRequest(path, body, token, signal) {
    const url = MARKER_SERVICE_ORIGIN + path;
    return new Promise((resolve, reject) => {
        let request;
        const fail = error => {
            signal?.removeEventListener('abort', cancel);
            reject(error);
        };
        const cancel = () => {
            fail(Error('cancelled'));
            try { request?.abort?.(); } catch (_) { /* The caller is already released. */ }
        };
        if (signal?.aborted) return cancel();
        signal?.addEventListener('abort', cancel, { once: true });
        try {
            request = GM_xmlhttpRequest({
                method: 'POST', url, anonymous: true, redirect: 'error', timeout: path === '/v1/diagnostics' ? 45000 : 15000,
                headers: { Accept: 'application/json', 'Content-Type': 'application/json',
                    ...(token ? { Authorization: 'Bearer ' + token } : {}) },
                data: JSON.stringify(body),
                onload(response) {
                    signal?.removeEventListener('abort', cancel);
                    try {
                        if (response.finalUrl && response.finalUrl !== url) throw Error('unexpected_response');
                        const data = response.status === 204 ? null : JSON.parse(response.responseText);
                        if (response.status < 200 || response.status >= 300) {
                            throw Object.assign(Error('service_error'), { status: response.status, code: data?.error });
                        }
                        resolve(data);
                    } catch (error) { fail(error); }
                },
                onerror: () => fail(Error('network')),
                ontimeout: () => fail(Error('network')),
                onabort: () => fail(Error(signal?.aborted ? 'cancelled' : 'network')),
            });
        } catch (error) { fail(error); }
    });
}

function markerConnectionMessage(code) {
    return ({
        cancelled: '本次连接已取消。',
        expired: '授权已过期，请重新连接。',
        account_link_required: '这个邮箱已有服务账号。请先核对账号归属并完成关联，再回来连接。',
        account_unavailable: '此账号暂时无法使用 AI 服务。',
        key_limit: '此账号的 API 密钥数量已达上限。请在密钥管理中释放一个名额后重试。',
        account_service_unavailable: '账号连接服务暂不可用，请稍后重试。',
        login_failed: '五加一账号授权未完成，请重新连接。',
        tab_unavailable: '无法打开授权页，请检查脚本管理器后重试。',
        storage: '连接未能保存，请检查脚本管理器的存储权限后重试。',
        account_changed: '请授权当前已连接的五加一账号。',
        pending: '请在新标签页完成五加一账号授权。',
    })[code] || '账号连接未完成，请检查网络后重试。';
}

async function connectMarkerAccount({ expectedAccountId, onWaiting, signal } = {}) {
    if (signal?.aborted) throw Error('cancelled');
    if (markerConnection) throw Error('pending');
    const previous = expectedAccountId ? markerManagedAccount() : null;
    if (expectedAccountId && previous?.accountId !== expectedAccountId) throw Error('account_changed');
    const claim = markerRandomHex(32);
    const approval = markerRandomHex(32);
    const operation = { cancelled: false, controller: new AbortController() };
    markerConnection = operation;
    const cancel = () => cancelMarkerConnection(operation);
    signal?.addEventListener('abort', cancel, { once: true });
    let id, tab, saved = false;
    const checkCurrent = () => {
        if (operation.cancelled || GM_getValue(MARKER_ACTIVE_CONNECTION, '') !== claim) throw Error('cancelled');
    };
    try {
        if (typeof GM_openInTab !== 'function') throw Error('tab_unavailable');
        try {
            if (typeof GM_listValues === 'function') {
                for (const key of GM_listValues()) {
                    if (key.startsWith(MARKER_CONNECTION_PREFIX) && !(GM_getValue(key)?.expires > Date.now())) GM_deleteValue(key);
                }
            }
            GM_setValue(MARKER_ACTIVE_CONNECTION, claim);
        } catch (_) { throw Error('storage'); }
        checkCurrent();
        const start = await markerServiceRequest(MARKER_SCRIPT_FLOW, { claim, approval, expectedAccountId }, null, operation.controller.signal);
        if (!markerFlowID.test(start?.id || '') || !Number.isInteger(start.expiresAt)) throw Error('unexpected_response');
        id = start.id;
        checkCurrent();
        const expires = Math.min(start.expiresAt * 1000, Date.now() + MARKER_CONNECTION_LIFETIME);
        if (expires <= Date.now()) throw Error('expired');
        try { GM_setValue(MARKER_CONNECTION_PREFIX + id, { approval, expires }); }
        catch (_) { throw Error('storage'); }
        tab = GM_openInTab(MARKER_TOOLS_ORIGIN + '/oauth/start?connect=' + id, { active: true, setParent: true });
        onWaiting?.();
        let delay = start.pollAfter;
        while (Date.now() < expires) {
            await new Promise(resolve => {
                let timer;
                operation.wake = () => { clearTimeout(timer); resolve(); };
                timer = setTimeout(operation.wake, Math.min(expires - Date.now(), Math.max(2, Math.min(15, Number(delay) || 2)) * 1000));
            });
            checkCurrent();
            if (Date.now() >= expires) break;
            const flow = GM_getValue(MARKER_CONNECTION_PREFIX + id, null);
            let account;
            try { account = await markerServiceRequest(MARKER_SCRIPT_FLOW + '/claim', { id, proof: claim }, null, operation.controller.signal); }
            catch (error) {
                checkCurrent();
                if (flow?.failure) throw Error(flow.failure);
                if (tab?.closed === true) throw Error('cancelled');
                if (error.status === 404) throw Error('expired');
                if (error.status && error.status < 500 && error.status !== 429) throw error;
                delay = 4;
                continue;
            }
            checkCurrent();
            if (account?.pollAfter) {
                if (flow?.failure) throw Error(flow.failure);
                if (tab?.closed === true) throw Error('cancelled');
                delay = account.pollAfter;
                continue;
            }
            if (!Number.isSafeInteger(account?.accountId) || account.accountId <= 0 || !markerServiceKey.test(account.apiKey || '') ||
                typeof account.uploadToken !== 'string' || !account.uploadToken || !Number.isInteger(account.expiresAt) ||
                account.expiresAt * 1000 <= Date.now()) throw Error('unexpected_response');
            if (previous) {
                const current = markerManagedAccount();
                if (account.accountId !== previous.accountId || current?.accountId !== previous.accountId ||
                    current.apiKey !== previous.apiKey || current.uploadToken !== previous.uploadToken) throw Error('account_changed');
            }
            try {
                GM_setValue(MARKER_ACCOUNT_KEY, {
                    accountId: account.accountId, apiKey: account.apiKey, uploadToken: account.uploadToken, expiresAt: account.expiresAt,
                });
                if (markerManagedAccount()?.uploadToken !== account.uploadToken) throw Error('storage');
            } catch (_) { throw Error('storage'); }
            saved = true;
            return;
        }
        throw Error('expired');
    } finally {
        signal?.removeEventListener('abort', cancel);
        try {
            if (id) GM_deleteValue(MARKER_CONNECTION_PREFIX + id);
            if (GM_getValue(MARKER_ACTIVE_CONNECTION, '') === claim) GM_deleteValue(MARKER_ACTIVE_CONNECTION);
        } catch (_) { /* 授权会自行过期。 */ }
        if (id) void markerServiceRequest(MARKER_SCRIPT_FLOW + (saved ? '/complete' : '/cancel'), { id, proof: claim }).catch(() => {});
        if (saved || operation.cancelled) {
            try { tab?.close?.(); } catch (_) { /* 仍可手动切回阅卷页。 */ }
        }
        markerConnection = null;
    }
}

function cancelMarkerConnection(operation = markerConnection) {
    if (!operation) return;
    operation.cancelled = true;
    operation.controller.abort();
    operation.wake?.();
}

function disconnectMarkerAccount() {
    cancelMarkerConnection();
    try {
        GM_deleteValue(MARKER_ACTIVE_CONNECTION);
        GM_deleteValue(MARKER_ACCOUNT_KEY);
        return !GM_getValue(MARKER_ACCOUNT_KEY, null) && !GM_getValue(MARKER_ACTIVE_CONNECTION, null);
    } catch (_) { return false; }
}

function markerAccountPortalUrl(path = '/wallet') {
    const url = new URL('https://platform.ai.five-plus-one.com/sign-in');
    url.searchParams.set('provider', '5plus1-account');
    url.searchParams.set('redirect', path);
    return url.href;
}

function markerAccountControls() {
    return `<div data-marker-account-controls>
        <div class="fp-embedded-setting-row">
            <div class="marker-setting-heading">
                <strong>五加一账号</strong>
                <span class="marker-account-linked" data-marker-linked hidden>已连接</span>
            </div>
            <div class="fp-embedded-action-choices">
                <a class="preset-btn marker-balance-link" data-marker-billing hidden href="${markerAccountPortalUrl()}" target="_blank" rel="noopener noreferrer">余额与充值</a>
                <button type="button" class="preset-btn marker-acct-action" data-marker-login>登录五加一账号</button>
                <button type="button" class="fp-embedded-text-link" style="display:none;" data-marker-disconnect>解除连接</button>
                <button type="button" class="fp-embedded-text-link" style="display:none;" data-marker-cancel>取消授权</button>
            </div>
        </div>
        <p class="marker-setting-note" data-marker-status role="status"></p>
    </div>`;
}

function bindMarkerAccountControls(container, onChange) {
    const controls = container.querySelector('[data-marker-account-controls]');
    const login = controls.querySelector('[data-marker-login]');
    const disconnect = controls.querySelector('[data-marker-disconnect]');
    const cancel = controls.querySelector('[data-marker-cancel]');
    const status = controls.querySelector('[data-marker-status]');
    const billing = controls.querySelector('[data-marker-billing]');
    const linked = controls.querySelector('[data-marker-linked]');
    function refresh(message) {
        if (typeof message === 'string' && !controls.isConnected) return;
        const connected = Boolean(markerManagedAccount());
        login.style.display = connected ? 'none' : '';
        if (disconnect) disconnect.style.display = connected ? '' : 'none';
        status.textContent = message ?? (controls.dataset.markerAccountControls === 'onboarding' || connected
            ? '' : '登录后即可开通批改服务。');
        if (billing) {
            billing.hidden = !connected;
            linked.hidden = !connected;
        }
        onChange?.();
    }
    login.onclick = async event => {
        if (!event.isTrusted) return;
        login.disabled = true;
        cancel.style.display = '';
        status.textContent = '正在打开五加一账号授权页…';
        try {
            await connectMarkerAccount({ onWaiting: () => { status.textContent = markerConnectionMessage('pending'); } });
            refresh();
        } catch (error) { refresh(markerConnectionMessage(error.code || error.message)); }
        finally { login.disabled = false; cancel.style.display = 'none'; }
    };
    cancel.onclick = () => cancelMarkerConnection();
    if (billing) billing.onclick = () => { billing.href = markerAccountPortalUrl(); };
    if (disconnect) {
        disconnect.onclick = () => refresh(disconnectMarkerAccount() ? '已解除本机连接，可随时重新登录。' : markerConnectionMessage('storage'));
    }
    refresh();
    return refresh;
}

async function finishMarkerAccount() {
    if (window !== window.top || location.origin !== MARKER_TOOLS_ORIGIN || location.pathname !== '/') return;
    const match = /^#script-connect=([a-f0-9]{32})(&login-error=1)?$/.exec(location.hash);
    if (!match) return;
    const [, id, loginError] = match;
    const root = document.documentElement;
    const key = MARKER_CONNECTION_PREFIX + id;
    const flow = GM_getValue(key, null);
    if (!flow || flow.expires <= Date.now()) {
        root.dataset.markerAccount = 'expired';
        return;
    }
    function fail(code) {
        root.dataset.markerAccount = code;
        if (GM_getValue(key, null)?.approval === flow.approval) GM_setValue(key, { ...flow, failure: code });
    }
    if (loginError) { fail('login_failed'); return; }
    root.dataset.markerAccount = 'connecting';
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            if (GM_getValue(key, null)?.approval !== flow.approval || flow.expires <= Date.now()) {
                root.dataset.markerAccount = 'expired';
                return;
            }
            const response = await fetch(MARKER_TOOLS_ORIGIN + '/v1/portal/connect', {
                method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
                headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
                body: JSON.stringify({ id, proof: flow.approval }),
            });
            const result = await response.json();
            if (response.ok && result.approved === true) {
                root.dataset.markerAccount = 'approved';
                return;
            }
            if (response.status !== 429 && response.status < 500) {
                fail(response.status === 401 ? 'login_failed' : result.error === 'connection_unavailable' ? 'expired' : result.error);
                return;
            }
        } catch (_) { /* 短暂中断可以在相同授权内重试。 */ }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
    }
    fail('account_service_unavailable');
}
