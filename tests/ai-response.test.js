const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/core/ai-engine.js', 'utf8');
const transport = source.slice(source.indexOf('function callAIOnce('), source.indexOf('// ========== 双评引擎 =========='));
const config = { endpoint: 'https://example.test/chat/completions', apiKey: 'test', model: 'vision' };
const event = (choice, usage) => `data: ${JSON.stringify({ choices: [choice], usage })}\n\n`;

function setup(responses, cfg) {
    const requests = [];
    const context = {
        console: { log() {}, warn() {}, error() {} },
        window: { aiGradingState: { abortController: new AbortController() } },
        setTimeout: callback => callback(),
        GM_xmlhttpRequest(options) {
            requests.push(JSON.parse(options.data));
            const response = responses.shift();
            // 超出预置次数的请求按网络错误收尾，避免 undefined 挂起测试进程（PR 富评论验证）
            if (!response) {
                queueMicrotask(() => options.onerror && options.onerror());
                return { abort() {} };
            }
            queueMicrotask(() => {
                if (response.kind === 'timeout') options.ontimeout();
                else if (response.kind === 'network') options.onerror();
                else options.onload({ status: response.status || 200, responseText: response.body });
            });
            return { abort() {} };
        }
    };
    vm.createContext(context);
    vm.runInContext(transport, context);
    return { call: () => context.callAI('题目', ['image'], cfg || config), requests };
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

test('超时状态不明时不重复发送请求', async () => {
    const { call, requests } = setup([{ kind: 'timeout' }]);
    await assert.rejects(call(), /请求超时/);
    assert.equal(requests.length, 1);
});

test('明确的服务端错误至多重试一次', async () => {
    const body = event({ delta: { content: '完成' }, finish_reason: 'stop' });
    const { call, requests } = setup([{ status: 503, body: '忙' }, { body }]);
    assert.equal(await call(), '完成');
    assert.equal(requests.length, 2);
});

test('流式响应缺少结束标记时暂停', async () => {
    const { call } = setup([{ body: event({ delta: { content: '得分：1' }, finish_reason: null }) }]);
    await assert.rejects(call(), /未完整结束/);
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
