const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/core/ai-engine.js', 'utf8');
// 切片从废图闸开始（callAIOnce 依赖 filterUsableImagesForAI，工单①）——
// 切片加载器对源码结构的耦合点：新增被调函数时必须同步扩展起点
const transport = source.slice(source.indexOf('function probeImageDimensions('), source.indexOf('// ========== 双评引擎 =========='));
const config = { endpoint: 'https://example.test/chat/completions', apiKey: 'test', model: 'vision' };
const event = (choice, usage) => `data: ${JSON.stringify({ choices: [choice], usage })}\n\n`;

// —— mock 已知盲区（审计 C1-M1/M2/M3/M4，勿当真实时序/传输语义的证明）——
//  1. setTimeout 是同步桩：退避等待（callAIOnceWithTransientRetry / callAI 服务端重试）
//     实际永不等待，延迟值与并发时序缺陷不可见 —— 只断言重试次数，不断言耗时。
//  2. onprogress 按 Tampermonkey 语义传「累计全文 responseText」（callAIOnce 依赖
//     累计重解析）；真实 GM_xmlhttpRequest 各版本行为差异需浏览器实测（审计 R5）。
//  3. onload 只给 {status, responseText}，无 statusText —— `responseText || res.statusText`
//     与 HTML 错误页清理分支未覆盖；abort/用户主动暂停路径亦未覆盖。
function setup(responses, cfg) {
    const requests = [];
    const updates = [];
    const context = {
        console: { log() {}, warn() {}, error() {} },
        window: { aiGradingState: { abortController: new AbortController() } },
        setTimeout: callback => callback(),
        GM_xmlhttpRequest(options) {
            requests.push(JSON.parse(options.data));
            const response = responses.shift();
            // 超出预置次数的请求按网络错误收尾，避免 undefined 挂起测试进程
            if (!response) {
                queueMicrotask(() => options.onerror && options.onerror());
                return { abort() {} };
            }
            queueMicrotask(() => {
                if (response.kind === 'timeout') options.ontimeout();
                else if (response.kind === 'network') options.onerror();
                else if (response.chunks) {
                    // 流式响应：逐片触发 onprogress（responseText 为累计全文），
                    // 最后 onload 收尾 —— 复现「流式增量」真实调用序列
                    let acc = '';
                    for (const chunk of response.chunks) {
                        acc += chunk;
                        if (options.onprogress) options.onprogress({ responseText: acc });
                    }
                    options.onload({ status: response.status || 200, responseText: acc });
                } else {
                    options.onload({ status: response.status || 200, responseText: response.body });
                }
            });
            return { abort() {} };
        }
    };
    vm.createContext(context);
    vm.runInContext(transport, context);
    return {
        call: () => context.callAI('题目', ['image'], cfg || config, (text) => updates.push(text)),
        requests,
        updates,
    };
}

test('默认请求携带输出上限并取得思考后的评分正文', async () => {
    const body = event({ delta: { reasoning_content: '思考'.repeat(6000) }, finish_reason: null }) +
        event({ delta: { content: '得分：12' }, finish_reason: null }) +
        event({ delta: {}, finish_reason: 'stop' }) + 'data: [DONE]\n\n';
    const { call, requests } = setup([{ body }]);
    assert.equal(await call(), '得分：12');
    assert.equal(requests[0].max_tokens, 2048);
    assert.equal(requests.length, 1);
});

test('输出上限截断时升级为接口额度重试一次', async () => {
    const truncated = event({ delta: { content: '得分：1' }, finish_reason: 'length' });
    const full = event({ delta: { content: '得分：8' }, finish_reason: null }) +
        event({ delta: {}, finish_reason: 'stop' }) + 'data: [DONE]\n\n';
    const { call, requests } = setup([{ body: truncated }, { body: full }]);
    assert.equal(await call(), '得分：8');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].max_tokens, 2048);
    assert.equal(Object.hasOwn(requests[1], 'max_tokens'), false);
});

test('升级重试后仍截断则停止并报结果不完整', async () => {
    const truncated = event({ delta: { content: '得分：1' }, finish_reason: 'length' });
    const { call, requests } = setup([{ body: truncated }, { body: truncated }]);
    await assert.rejects(call(), /结果不完整/);
    assert.equal(requests.length, 2);
});

test('接口默认额度截断时不使用部分评分或重复请求', async () => {
    const body = event({ delta: { content: '得分：1' }, finish_reason: 'length' });
    const { call, requests } = setup([{ body }], { ...config, outputLimitEnabled: false });
    await assert.rejects(call(), /结果不完整/);
    assert.equal(requests.length, 1);
});

test('关闭超时重试时保持旧行为：状态不明不重复发送请求', async () => {
    const { call, requests } = setup([{ kind: 'timeout' }], { ...config, retryPolicy: { retryOnTimeout: false } });
    await assert.rejects(call(), /请求超时/);
    assert.equal(requests.length, 1);
});

test('超时默认退避重试，全部失败后抛出超时错误', async () => {
    const { call, requests } = setup([
        { kind: 'timeout' }, { kind: 'timeout' }, { kind: 'timeout' }, { kind: 'timeout' }
    ]);
    await assert.rejects(call(), /请求超时/);
    assert.equal(requests.length, 4, '应为 1 次原始请求 + 3 次退避重试');
});

test('超时重试后成功则返回结果', async () => {
    const body = event({ delta: { content: '得分：9' }, finish_reason: null }) +
        event({ delta: {}, finish_reason: 'stop' }) + 'data: [DONE]\n\n';
    const { call, requests } = setup([{ kind: 'timeout' }, { body }]);
    assert.equal(await call(), '得分：9');
    assert.equal(requests.length, 2);
});

test('模型返回空内容默认退避重试', async () => {
    const empty = event({ delta: {}, finish_reason: 'stop' }) + 'data: [DONE]\n\n';
    const body = event({ delta: { content: '得分：5' }, finish_reason: null }) +
        event({ delta: {}, finish_reason: 'stop' }) + 'data: [DONE]\n\n';
    const { call, requests } = setup([{ body: empty }, { body }]);
    assert.equal(await call(), '得分：5');
    assert.equal(requests.length, 2);
});

test('关闭空响应重试时不重复发送请求', async () => {
    const empty = event({ delta: {}, finish_reason: 'stop' }) + 'data: [DONE]\n\n';
    const { call, requests } = setup([{ body: empty }], { ...config, retryPolicy: { retryOnEmpty: false } });
    await assert.rejects(call(), /未返回可用内容/);
    assert.equal(requests.length, 1);
});

test('maxRetries 可配置为 0 时等价于不重试', async () => {
    const { call, requests } = setup([{ kind: 'timeout' }], { ...config, retryPolicy: { maxRetries: 0 } });
    await assert.rejects(call(), /请求超时/);
    assert.equal(requests.length, 1);
});

test('明确的服务端错误退避重试（实现上限 2 次，#C1-A8 修正旧名「至多一次」）', async () => {
    const body = event({ delta: { content: '完成' }, finish_reason: 'stop' });
    const { call, requests } = setup([{ status: 503, body: '忙' }, { body }]);
    assert.equal(await call(), '完成');
    assert.equal(requests.length, 2);
});

test('服务端错误重试耗尽后抛出（1 次原始 + 2 次退避，共 3 次请求）', async () => {
    const { call, requests } = setup([
        { status: 503, body: '忙' }, { status: 503, body: '忙' }, { status: 503, body: '忙' },
    ]);
    await assert.rejects(call(), /API报错 \(503\)/);
    assert.equal(requests.length, 3, 'serverRetried<2 的上限 = 最多 2 次服务端重试');
});

test('流式响应缺少结束标记时退避重试，耗尽后仍报未完整结束', async () => {
    const incomplete = event({ delta: { content: '得分：1' }, finish_reason: null });
    const { call, requests } = setup([
        { body: incomplete }, { body: incomplete }, { body: incomplete }, { body: incomplete }
    ]);
    await assert.rejects(call(), /未完整结束/);
    assert.equal(requests.length, 4, '应为 1 次原始请求 + 3 次退避重试');
});

test('限流后截断时停止请求并保留待核查状态', async () => {
    const truncated = event({ delta: { reasoning_content: '思考' }, finish_reason: 'length' });
    const { call, requests } = setup([
        { status: 429, body: JSON.stringify({ error: { message: 'rate limit' } }) },
        { body: truncated }
    ], { ...config, outputLimitEnabled: false });
    await assert.rejects(call(), /结果不完整/);
    assert.equal(requests.length, 2);
});

test('普通 JSON 响应的截断标记同样阻止评分', async () => {
    const body = JSON.stringify({ choices: [{ message: { content: '得分：1' }, finish_reason: 'length' }] });
    const { call, requests } = setup([{ body }], { ...config, outputLimitEnabled: false });
    await assert.rejects(call(), /结果不完整/);
    assert.equal(requests.length, 1);
});

// ---------- 流式增量路径（onprogress，审计 C1-M1 补覆盖）----------
test('流式增量：多分片 onprogress 累计拼接出完整评分（分片拼接）', async () => {
    // 分片边界故意切在一条 data: JSON 中间，验证跨片拼接；
    // onprogress 每次传累计全文，实现应重解析累计文本而非增量追加（否则会拼出重复文本）
    const c1 = 'data: {"choices":[{"delta":{"content":"得分："}';
    const c2 = ',"finish_reason":null}]}\n\n' +
        event({ delta: { content: '12' }, finish_reason: null }) +
        event({ delta: {}, finish_reason: 'stop' }) + 'data: [DONE]\n\n';
    const { call, requests, updates } = setup([{ chunks: [c1, c2] }]);
    assert.equal(await call(), '得分：12', '两个 delta 跨分片应拼接为完整正文');
    assert.equal(requests.length, 1);
    assert.ok(updates.includes('得分：'), 'onprogress 阶段应推送中间进度，实际: ' + JSON.stringify(updates));
    assert.equal(updates[updates.length - 1], '得分：12', '最后一条流式进度应为完整正文');
    assert.ok(updates.every(u => !u.includes('得分：得分')), '累计重解析不得产生重复拼接: ' + JSON.stringify(updates));
});

test('流式中断（缺结束标记）→ 瞬态退避重试后恢复（中断恢复）', async () => {
    // 第一请求：有正文但无 finish_reason / [DONE]（流式中断）→ 报「未完整结束」
    // → 瞬态退避重试（#211）→ 第二请求完整流式成功。验证中断后的自动恢复链路。
    const partial = event({ delta: { content: '得分：9' }, finish_reason: null });
    const good = event({ delta: { content: '得分：9' }, finish_reason: null }) +
        event({ delta: {}, finish_reason: 'stop' }) + 'data: [DONE]\n\n';
    const { call, requests, updates } = setup([{ chunks: [partial.slice(0, 30), partial.slice(30)] }, { chunks: [good] }]);
    assert.equal(await call(), '得分：9', '中断重试成功后应返回第二次的完整结果');
    assert.equal(requests.length, 2, '中断应触发 1 次瞬态退避重试');
    assert.ok(updates.some(u => u.includes('响应未完整结束')), '应向 UI 通知中断并自动重试，实际: ' + JSON.stringify(updates));
});
