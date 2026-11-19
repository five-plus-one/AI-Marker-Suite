const MARKER_ACCOUNT_ORIGIN = 'https://api.ai.five-plus-one.com';
const MARKER_TOOLS_ORIGIN = 'https://tools.aimarking.five-plus-one.com';
const MARKER_ACCOUNT_GATEWAY = 'https://oauth.five-plus-one.com';
const MARKER_SERVICE_ORIGIN = 'https://api.aimarking.five-plus-one.com';
const MARKER_ACCOUNT_FLOW = 'aimarker-account-flow-';
const MARKER_ACCOUNT_RESULT = 'aimarker-account-result-';
const MARKER_UPLOAD_SESSION = 'aimarker-diagnostic-upload-session';
const MARKER_ACCOUNT_WINDOW = 'aimarker-active-connection';
const MARKER_OAUTH_PATH = '/oauth/5plus1-account';
const MARKER_FLOW_DURATION = 10 * 60 * 1000;

function markerRandomID() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function markerServiceRequest(path, method, token, body) {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method, url: MARKER_SERVICE_ORIGIN + path, anonymous: true, redirect: 'error', timeout: 30000,
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            data: body,
            onload(response) {
                try {
                    if (response.finalUrl && new URL(response.finalUrl).origin !== MARKER_SERVICE_ORIGIN) throw Error();
                    if (response.status < 200 || response.status >= 300) {
                        const error = Error('服务暂未完成，请稍后重试。');
                        error.status = response.status;
                        throw error;
                    }
                    resolve(response.status === 204 ? null : JSON.parse(response.responseText));
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
async function connectMarkerAccount() {
    if (markerAccountInProgress) throw Error('请在打开的五加一账号页面完成连接。');
    const claim = markerRandomID() + markerRandomID(), approval = markerRandomID() + markerRandomID();
    markerAccountInProgress = true;
    let id, received = false;
    try {
        if (typeof GM_listValues === 'function') {
            for (const key of GM_listValues()) {
                if ((key.startsWith(MARKER_ACCOUNT_FLOW) || key.startsWith(MARKER_ACCOUNT_RESULT))
                    && !(GM_getValue(key)?.expires > Date.now())) GM_deleteValue(key);
            }
        }
        const start = await markerServiceRequest('/v1/account/flows', 'POST', null, JSON.stringify({ claim, approval }));
        if (!/^[a-f0-9]{32}$/.test(start?.id || '') || !Number.isInteger(start.expiresAt)) throw Error('连接暂未开始，请重试。');
        id = start.id;
        const expires = Math.min(start.expiresAt * 1000, Date.now() + MARKER_FLOW_DURATION);
        GM_setValue(MARKER_ACCOUNT_FLOW + id, { expires, approval, status: 'pending' });
        const url = MARKER_TOOLS_ORIGIN + '/#aimarker-connect=' + id;
        const tab = typeof GM_openInTab === 'function' ? GM_openInTab(url, { active: true, setParent: true })
            : window.open(url, '_blank', 'noopener,noreferrer');
        let pollAfter = start.pollAfter;
        for (; Date.now() < expires;) {
            await new Promise(resolve => setTimeout(resolve, Math.max(2, Math.min(15, Number(pollAfter) || 2)) * 1000));
            if (markerFlow(id)?.status === 'cancelled' || tab?.closed === true) throw Error('本次连接已取消。');
            let outcome;
            try { outcome = await markerServiceRequest('/v1/account/flows/claim', 'POST', null, JSON.stringify({ id, proof: claim })); }
            catch (error) {
                if (error?.status === 404) throw Error('连接已失效，请重新连接。');
                if (!error?.status || error.status >= 500 || error.status === 429) { pollAfter = 4; continue; }
                throw error;
            }
            pollAfter = outcome?.pollAfter;
            if (pollAfter) continue;
            received = true;
            if (!/^sk-[a-zA-Z0-9_-]{16,256}$/.test(outcome?.apiKey || '') ||
                typeof outcome.uploadToken !== 'string' || !Number.isInteger(outcome.expiresAt) || outcome.expiresAt * 1000 <= Date.now() ||
                !ProviderManager.saveOfficialConnection(getOfficialApiLine(ProviderManager.getProvider('5plus1官方')), outcome.apiKey)) {
                throw Error('API Key 未能保存，请检查脚本存储后重试。');
            }
            GM_setValue(MARKER_UPLOAD_SESSION, { token: outcome.uploadToken, expiresAt: outcome.expiresAt });
            return { uploadReady: true };
        }
        throw Error('连接已超时，请重新打开五加一账号页面。');
    } finally {
        try {
            if (id) GM_deleteValue(MARKER_ACCOUNT_FLOW + id);
            if (id && !received) void markerServiceRequest('/v1/account/flows/cancel', 'POST', null, JSON.stringify({ id, proof: claim })).catch(() => {});
        } finally { markerAccountInProgress = false; }
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

function markerBridgeDialog(id, returning, reportCode = '', adminList = false) {
    const flow = markerFlow(id);
    const administrative = adminList || Boolean(reportCode);
    if ((!administrative && (flow?.status !== 'pending' || flow.approved !== true)) || document.getElementById('ai-marker-account-connection')) return;
    ensureModalStyles();
    const dialog = document.createElement('dialog');
    dialog.id = 'ai-marker-account-connection';
    styleNativeModal(dialog);
    dialog.setAttribute('aria-labelledby', 'ai-marker-account-title');
    dialog.innerHTML = `
        <div class="ai-modal-header" id="ai-marker-account-title">${administrative ? '查看诊断报告' : '连接五加一账号'}</div>
        <div class="ai-modal-body">
            <p>${administrative ? '使用管理员的五加一账号查看诊断资料。' : '请稍候，正在连接当前浏览器中的 AI 批改助手。'}</p>
            <p data-account-status role="status"></p>
            <section data-admin-diagnostics hidden aria-label="已上传的诊断包"></section>
        </div>
        <div class="ai-modal-footer">
            <button type="button" class="ai-modal-btn-cancel">取消</button>
            <button type="button" class="ai-modal-btn-confirm" data-account-continue>继续</button>
        </div>`;
    const status = dialog.querySelector('[data-account-status]');
    const confirm = dialog.querySelector('.ai-modal-btn-confirm');
    const finish = () => window.location.replace(MARKER_TOOLS_ORIGIN + '/#aimarker-connected=' + id);
    let complete = false;
    async function connect() {
        if (confirm.disabled || complete || (!administrative && markerFlow(id)?.status !== 'pending')) return;
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
            let approval;
            if (reportCode) {
                await markerViewDiagnostic(dialog, bundle.access_token, reportCode);
            } else if (adminList) {
                await markerViewDiagnostics(dialog, bundle.access_token);
            } else {
                approval = await markerServiceRequest('/v1/account/flows/approve', 'POST', bundle.access_token, JSON.stringify({ id, proof: flow.approval }));
                if (approval?.approved !== true) throw Error('Missing authorization receipt');
                GM_setValue(MARKER_ACCOUNT_RESULT + id, { expires: Date.now() + MARKER_FLOW_DURATION, administrator: approval.administrator === true });
            }
            sessionStorage.removeItem(MARKER_ACCOUNT_WINDOW);
            complete = true;
            status.textContent = '连接成功，可以返回阅卷页面。';
            confirm.textContent = '完成';
            dialog.querySelector('.ai-modal-btn-cancel').hidden = true;
            if (administrative) {
                status.textContent = '';
            } else finish();
        } catch (error) {
            status.textContent = administrative && error?.status === 403 ? '请使用管理员账号查看。'
                : reportCode && error?.status === 404 ? '没有找到这份诊断。' : '连接暂未完成，请重试。';
        } finally {
            confirm.disabled = false;
        }
    }
    confirm.onclick = () => complete ? (administrative ? dialog.close() : finish()) : void connect();
    dialog.querySelector('.ai-modal-btn-cancel').onclick = () => dialog.close();
    dialog.addEventListener('close', () => {
        if (!complete && markerFlow(id)?.status === 'pending') {
            GM_setValue(MARKER_ACCOUNT_FLOW + id, { expires: flow.expires, status: 'cancelled' });
            void markerServiceRequest('/v1/account/flows/cancel', 'POST', null, JSON.stringify({ id, proof: flow.approval })).catch(() => {});
        }
        sessionStorage.removeItem(MARKER_ACCOUNT_WINDOW);
        dialog.remove();
    }, { once: true });
    getUIRoot().appendChild(dialog);
    dialog.showModal();
    void connect();
}

function markerDownloadDiagnostic(code, token) {
    const url = MARKER_SERVICE_ORIGIN + '/v1/admin/diagnostics/archive?id=' + encodeURIComponent(code);
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'GET', url, anonymous: true, redirect: 'error', timeout: 180000,
            headers: { Authorization: 'Bearer ' + token }, responseType: 'blob',
            onload(response) {
                if (response.status !== 200 || (response.finalUrl && response.finalUrl !== url) || !response.response) {
                    reject(Error('无法下载诊断包。'));
                    return;
                }
                const objectURL = URL.createObjectURL(response.response);
                const link = document.createElement('a');
                link.href = objectURL;
                link.download = 'AI批改助手诊断-' + code + '.zip';
                link.click();
                setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
                resolve();
            },
            onerror: () => reject(Error('暂时无法连接服务。')),
            ontimeout: () => reject(Error('下载超时，请重试。')),
        });
    });
}

async function markerViewDiagnostic(dialog, token, code) {
    const path = '/v1/admin/diagnostics/download?id=' + encodeURIComponent('reports/' + code + '.json');
    const { report } = await markerServiceRequest(path, 'GET', token);
    if (!report) throw Error('Missing diagnostic report');
    const section = dialog.querySelector('[data-admin-diagnostics]');
    const heading = document.createElement('h3');
    heading.textContent = '问题编号 ' + code;
    heading.style.overflowWrap = 'anywhere';
    const description = document.createElement('p');
    description.style.whiteSpace = 'pre-wrap';
    description.textContent = report.description || '用户未填写问题描述。';
    const details = document.createElement('p');
    details.textContent = [report.platform, report.version, new Date(report.start).toLocaleString() + ' 至 ' +
        new Date(report.end).toLocaleString()].filter(Boolean).join(' · ');
    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'ai-modal-btn-confirm';
    download.textContent = '下载完整诊断包';
    download.onclick = async () => {
        download.disabled = true;
        try { await markerDownloadDiagnostic(code, token); }
        catch (_) { dialog.querySelector('[data-account-status]').textContent = '下载暂未完成，请重试。'; }
        finally { download.disabled = false; }
    };
    section.replaceChildren(heading, description, details, download);
    section.hidden = false;
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
                    const code = /^reports\/([a-f0-9]{40})\.json$/.exec(report.id)?.[1];
                    if (!code) throw Error('Invalid diagnostic number');
                    await markerDownloadDiagnostic(code, token);
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

function markerToolsBridge() {
    if (window.location.pathname !== '/') return;
    const match = /^#aimarker-connect(ed)?=([a-f0-9]{32})$/.exec(window.location.hash);
    if (!match) return;
    const [, completed, id] = match;
    const root = document.documentElement;
    if (completed) {
        const key = MARKER_ACCOUNT_RESULT + id;
        const result = GM_getValue(key);
        if (result?.expires > Date.now()) {
            GM_deleteValue(key);
            root.dataset.markerAccount = result.administrator ? 'complete-admin' : 'complete';
        }
        history.replaceState(history.state, '', '/');
        return;
    }
    if (markerFlow(id)?.status !== 'pending') {
        root.dataset.markerAccount = 'expired';
        return;
    }
    root.dataset.markerAccount = 'ready';
    document.addEventListener('click', event => {
        if (!event.target.closest?.('[data-marker-connect]')) return;
        event.preventDefault();
        const flow = markerFlow(id);
        if (flow?.status !== 'pending') {
            root.dataset.markerAccount = 'expired';
            return;
        }
        GM_setValue(MARKER_ACCOUNT_FLOW + id, { ...flow, approved: true });
        window.location.assign(MARKER_ACCOUNT_ORIGIN + '/about#aimarker-connect=' + id);
    });
}

function markerAccountBridge() {
    if (window !== window.top) return;
    if (window.location.origin === MARKER_TOOLS_ORIGIN) {
        markerToolsBridge();
        return;
    }
    if (window.location.origin !== MARKER_ACCOUNT_ORIGIN) return;
    const { pathname, hash } = window.location;
    if (pathname === '/about') {
        const report = /^#aimarker-report=([a-f0-9]{40})$/.exec(hash)?.[1];
        if (report || hash === '#aimarker-diagnostics') {
            sessionStorage.setItem(MARKER_ACCOUNT_WINDOW, report ? 'report:' + report : 'diagnostics');
            history.replaceState(history.state, '', pathname);
            markerBridgeDialog(null, false, report, !report);
            return;
        }
        const match = /^#aimarker-connect=([a-f0-9]{32})$/.exec(hash);
        if (!match || markerFlow(match[1])?.approved !== true) return;
        sessionStorage.setItem(MARKER_ACCOUNT_WINDOW, match[1]);
        history.replaceState(history.state, '', pathname);
        markerBridgeDialog(match[1], false);
        return;
    }
    const id = sessionStorage.getItem(MARKER_ACCOUNT_WINDOW);
    const report = /^report:([a-f0-9]{40})$/.exec(id || '')?.[1];
    const adminList = id === 'diagnostics';
    if (!report && !adminList && !markerFlow(id)) return;
    // The official OAuth callback performs its normal exchange before returning to the dashboard.
    function afterCallback() {
        const onDashboard = /^\/dashboard(?:\/|$)/.test(window.location.pathname);
        if (onDashboard) markerBridgeDialog(id, true, report, adminList);
        return onDashboard || (!report && !adminList && !markerFlow(id));
    }
    if (pathname === MARKER_OAUTH_PATH && !afterCallback()) {
        const watcher = setInterval(() => { if (afterCallback()) clearInterval(watcher); }, 350);
    } else if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
        afterCallback();
    }
}
