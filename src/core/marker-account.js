const MARKER_ACCOUNT_ORIGIN = 'https://api.ai.five-plus-one.com';
const MARKER_ACCOUNT_GATEWAY = 'https://oauth.five-plus-one.com';
const MARKER_SERVICE_ORIGIN = 'https://api.aimarking.five-plus-one.com';
const MARKER_ACCOUNT_FLOW = 'aimarker-account-flow-';
const MARKER_UPLOAD_SESSION = 'aimarker-diagnostic-upload-session';
const MARKER_ACCOUNT_WINDOW = 'aimarker-active-connection';
const MARKER_ACCOUNT_KEY_NAME = 'AI 批改助手浏览器脚本';
const MARKER_OAUTH_PATH = '/oauth/5plus1-account';
const MARKER_FLOW_DURATION = 10 * 60 * 1000;

function markerRandomID() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function markerServiceRequest(path, method, token, body) {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method, url: MARKER_SERVICE_ORIGIN + path, anonymous: true, redirect: 'error', timeout: 30000,
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            data: body,
            onload(response) {
                try {
                    if (response.finalUrl && new URL(response.finalUrl).origin !== MARKER_SERVICE_ORIGIN) throw Error();
                    const data = JSON.parse(response.responseText);
                    if (response.status < 200 || response.status >= 300) {
                        const error = Error('服务暂未完成，请稍后重试。');
                        error.status = response.status;
                        throw error;
                    }
                    resolve(data);
                } catch (error) { reject(error); }
            },
            onerror: () => reject(Error('暂时无法连接服务，请稍后重试。')),
            ontimeout: () => reject(Error('服务响应超时，请稍后重试。')),
        });
    });
}

async function markerOfficialRequest(path, method = 'GET', body, token) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await fetch(MARKER_ACCOUNT_ORIGIN + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw Error('账号连接暂未完成。');
    const result = await response.json();
    if (!result.success) throw Error('账号操作暂未完成。');
    return result.data;
}

function markerFlow(id) {
    if (!/^[a-f0-9]{32}$/.test(id || '')) return null;
    const value = GM_getValue(MARKER_ACCOUNT_FLOW + id, null);
    return value && value.expires > Date.now() ? value : null;
}

function markerUploadSession() {
    const session = GM_getValue(MARKER_UPLOAD_SESSION, null);
    return typeof session?.token === 'string' && Number(session.expiresAt) * 1000 > Date.now() ? session : null;
}

let markerAccountInProgress = false;
async function connectMarkerAccount({ provision = true } = {}) {
    if (markerAccountInProgress) throw Error('请在打开的五加一账号页面完成连接。');
    const id = markerRandomID();
    const storageKey = MARKER_ACCOUNT_FLOW + id;
    markerAccountInProgress = true;
    try {
        if (typeof GM_listValues === 'function') {
            for (const key of GM_listValues().filter(key => key.startsWith(MARKER_ACCOUNT_FLOW))) {
                if (!markerFlow(key.slice(MARKER_ACCOUNT_FLOW.length))) GM_deleteValue(key);
            }
        }
        const expires = Date.now() + MARKER_FLOW_DURATION;
        GM_setValue(storageKey, { expires, provision, status: 'pending' });
        window.open(MARKER_ACCOUNT_ORIGIN + '/about#aimarker-connect=' + id, '_blank', 'noopener,noreferrer');
        for (; Date.now() < expires;) {
            await new Promise(resolve => setTimeout(resolve, 550));
            const outcome = markerFlow(id);
            if (outcome?.status === 'cancelled') throw Error('本次连接已取消。');
            if (outcome?.status !== 'complete') continue;
            // The bridge can issue an upload-only session independently of model credentials.
            if (outcome.uploadSession) GM_setValue(MARKER_UPLOAD_SESSION, outcome.uploadSession);
            if (provision && (!outcome.apiKey || !ProviderManager.saveOfficialConnection(
                getOfficialApiLine(ProviderManager.getProvider('5plus1官方')), outcome.apiKey
            ))) throw Error('访问密钥未能保存，请检查脚本存储后重试。');
            return { uploadReady: Boolean(outcome.uploadSession) };
        }
        throw Error('连接已超时，请重新打开五加一账号页面。');
    } finally {
        try { GM_deleteValue(storageKey); } finally { markerAccountInProgress = false; }
    }
}

async function connectMarkerAccountButton(button, onConnected) {
    button.disabled = true;
    try {
        showToast('请在新标签页授权五加一账号。');
        await connectMarkerAccount();
        onConnected();
        showToast('已连接五加一账号并保存访问密钥。');
    } catch (error) {
        showToast(error.message || '账号暂未连接，请重试。');
    } finally {
        button.disabled = false;
    }
}

async function markerBeginOAuth() {
    const status = await markerOfficialRequest('/api/status');
    const provider = status?.custom_oauth_providers?.find(provider => provider.slug === '5plus1-account');
    if (!provider?.client_id || !provider.authorization_endpoint) throw Error('五加一账号登录暂不可用。');
    const target = new URL(provider.authorization_endpoint);
    if (target.origin !== MARKER_ACCOUNT_GATEWAY || target.username || target.password) throw Error('登录地址暂不可用。');
    const flow = await markerOfficialRequest('/api/oauth/state', 'POST', { provider: '5plus1-account', intent: 'login' });
    const state = typeof flow === 'string' ? flow : flow?.flow_token;
    if (typeof state !== 'string' || !state) throw Error('登录暂未开始，请稍后重试。');
    target.searchParams.set('client_id', provider.client_id);
    target.searchParams.set('redirect_uri', MARKER_ACCOUNT_ORIGIN + MARKER_OAUTH_PATH);
    target.searchParams.set('response_type', 'code');
    target.searchParams.set('state', state);
    if (provider.scopes) target.searchParams.set('scope', provider.scopes);
    window.location.assign(target.href);
}

async function markerProvisionKey(accessToken) {
    const route = '/api/token/search?keyword=' + encodeURIComponent(MARKER_ACCOUNT_KEY_NAME) + '&p=1&page_size=100';
    const find = async () => (await markerOfficialRequest(route, 'GET', undefined, accessToken))?.items?.find(
        token => token.name === MARKER_ACCOUNT_KEY_NAME && token.status === 1 && token.group === 'default' &&
            (token.expired_time === -1 || token.expired_time * 1000 > Date.now()) && !token.model_limits_enabled
    );
    let token = await find();
    if (!token) {
        await markerOfficialRequest('/api/token/', 'POST', {
            name: MARKER_ACCOUNT_KEY_NAME, expired_time: -1, unlimited_quota: true, remain_quota: 0,
            group: 'default', model_limits_enabled: false, allow_user_quota_query: false,
        }, accessToken);
        token = await find();
    }
    if (!Number.isInteger(token?.id) || token.id <= 0) throw Error('AI 服务访问密钥暂未准备好。');
    const result = await markerOfficialRequest('/api/token/' + token.id + '/key', 'POST', undefined, accessToken);
    if (typeof result?.key !== 'string' || !/^(?:sk-)?[a-zA-Z0-9_-]{16,256}$/.test(result.key)) throw Error('AI 服务未返回有效密钥。');
    return result.key.startsWith('sk-') ? result.key : 'sk-' + result.key;
}

function markerBridgeDialog(id, returning) {
    const flow = markerFlow(id);
    if (flow?.status !== 'pending' || document.getElementById('ai-marker-account-connection')) return;
    ensureModalStyles();
    const dialog = document.createElement('dialog');
    dialog.id = 'ai-marker-account-connection';
    dialog.className = 'ai-modal-card';
    dialog.setAttribute('aria-labelledby', 'ai-marker-account-title');
    dialog.style.cssText = 'padding:0;min-width:0;width:min(92vw,460px);max-height:90vh;overflow:auto;';
    dialog.innerHTML = `
        <div class="ai-modal-header" id="ai-marker-account-title">连接 AI 批改助手</div>
        <div class="ai-modal-body">
            <p>使用五加一账号授权当前浏览器中的 AI 批改助手。</p>
            <p data-account-status role="status"></p>
            <section data-admin-diagnostics hidden aria-label="已上传的诊断包"></section>
        </div>
        <div class="ai-modal-footer">
            <button type="button" class="ai-modal-btn-cancel">取消</button>
            <button type="button" class="ai-modal-btn-cancel" data-view-diagnostics hidden>查看诊断包</button>
            <button type="button" class="ai-modal-btn-confirm">继续</button>
        </div>`;
    const status = dialog.querySelector('[data-account-status]');
    const confirm = dialog.querySelector('.ai-modal-btn-confirm');
    let complete = false;
    async function connect() {
        if (confirm.disabled || complete || markerFlow(id)?.status !== 'pending') return;
        confirm.disabled = true;
        status.textContent = '正在核对账号…';
        try {
            let bundle;
            try { bundle = await markerOfficialRequest('/api/user/auth/refresh', 'POST'); } catch (_) {}
            if (bundle?.session?.login_method !== 'oauth:5plus1-account' || typeof bundle.access_token !== 'string' ||
                !Number.isInteger(bundle.user?.id)) {
                if (returning) {
                    returning = false;
                    confirm.disabled = false;
                    status.textContent = '请重新完成五加一账号授权。';
                    return;
                }
                await markerBeginOAuth();
                return;
            }
            const provisionKey = () => markerProvisionKey(bundle.access_token);
            const apiKey = flow.provision
                ? await (navigator.locks ? navigator.locks.request('ai-marker-provision-api-key', provisionKey) : provisionKey())
                : undefined;
            let session;
            try { session = await markerServiceRequest('/v1/diagnostics/session', 'POST', bundle.access_token); }
            catch (error) { if (!flow.provision) throw error; }
            const uploadSession = typeof session?.uploadToken === 'string' && Number(session.expiresAt) * 1000 > Date.now()
                ? { token: session.uploadToken, expiresAt: session.expiresAt } : undefined;
            if (!flow.provision && !uploadSession) throw Error('诊断上传暂未连接，请重试。');
            if (markerFlow(id)?.status !== 'pending') return;
            GM_setValue(MARKER_ACCOUNT_FLOW + id, {
                expires: flow.expires, status: 'complete', apiKey, uploadSession,
            });
            sessionStorage.removeItem(MARKER_ACCOUNT_WINDOW);
            complete = true;
            status.textContent = '连接成功，可以返回阅卷页面。';
            confirm.textContent = '完成';
            dialog.querySelector('.ai-modal-btn-cancel').hidden = true;
            if (session?.administrator) {
                const view = dialog.querySelector('[data-view-diagnostics]');
                view.hidden = false;
                view.onclick = () => void markerViewDiagnostics(dialog, bundle.access_token);
            }
        } catch (_) {
            status.textContent = '连接暂未完成，请重试。';
        } finally {
            confirm.disabled = false;
        }
    }
    confirm.onclick = () => complete ? dialog.close() : void connect();
    dialog.querySelector('.ai-modal-btn-cancel').onclick = () => dialog.close();
    dialog.addEventListener('close', () => {
        if (!complete && markerFlow(id)?.status === 'pending') {
            GM_setValue(MARKER_ACCOUNT_FLOW + id, { expires: flow.expires, status: 'cancelled' });
        }
        sessionStorage.removeItem(MARKER_ACCOUNT_WINDOW);
        dialog.remove();
    }, { once: true });
    getUIRoot().appendChild(dialog);
    dialog.showModal();
    if (returning) void connect();
}

async function markerViewDiagnostics(dialog, token, cursor = '') {
    const section = dialog.querySelector('[data-admin-diagnostics]');
    section.hidden = false;
    section.textContent = '正在读取诊断包…';
    try {
        const result = await markerServiceRequest('/v1/admin/diagnostics' + (cursor
            ? '?cursor=' + encodeURIComponent(cursor) : ''), 'GET', token);
        section.replaceChildren();
        const heading = document.createElement('strong');
        heading.textContent = result.reports.length ? '本页 ' + result.reports.length + ' 份诊断包' : '暂无诊断包';
        section.append(heading);
        const list = document.createElement('ul');
        list.style.cssText = 'max-height:220px;overflow:auto;';
        for (const report of result.reports) {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ai-modal-btn-cancel';
            button.textContent = '下载 ' + new Date(report.uploadedAt).toLocaleString();
            button.onclick = async () => {
                button.disabled = true;
                try {
                    const data = await markerServiceRequest('/v1/admin/diagnostics/download?id=' + encodeURIComponent(report.id), 'GET', token);
                    const file = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(file);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = 'AI批改助手诊断包.json';
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch (_) {
                    dialog.querySelector('[data-account-status]').textContent = '下载暂未完成。请重新连接账号后重试。';
                } finally { button.disabled = false; }
            };
            item.append(button);
            list.append(item);
        }
        section.append(list);
        if (result.nextCursor) {
            const next = document.createElement('button');
            next.type = 'button';
            next.className = 'ai-modal-btn-cancel';
            next.textContent = '下一页';
            next.onclick = () => void markerViewDiagnostics(dialog, token, result.nextCursor);
            section.append(next);
        }
    } catch (_) {
        section.textContent = '暂时无法读取诊断包。请重新连接账号后重试。';
    }
}

function markerAccountBridge() {
    if (window !== window.top || window.location.origin !== MARKER_ACCOUNT_ORIGIN) return;
    const { pathname, hash } = window.location;
    if (pathname === '/about') {
        const match = /^#aimarker-connect=([a-f0-9]{32})$/.exec(hash);
        if (!match || markerFlow(match[1])?.status !== 'pending') return;
        sessionStorage.setItem(MARKER_ACCOUNT_WINDOW, match[1]);
        history.replaceState(history.state, '', pathname);
        markerBridgeDialog(match[1], false);
        return;
    }
    const id = sessionStorage.getItem(MARKER_ACCOUNT_WINDOW);
    if (!markerFlow(id)) return;
    // The official OAuth callback performs its normal exchange before returning to the dashboard.
    function afterCallback() {
        const onDashboard = /^\/dashboard(?:\/|$)/.test(window.location.pathname);
        if (onDashboard) markerBridgeDialog(id, true);
        return onDashboard || !markerFlow(id);
    }
    if (pathname === MARKER_OAUTH_PATH && !afterCallback()) {
        const watcher = setInterval(() => { if (afterCallback()) clearInterval(watcher); }, 350);
    } else if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
        afterCallback();
    }
}
