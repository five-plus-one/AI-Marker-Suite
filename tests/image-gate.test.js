// ========== 工单①：废图闸（图片进 AI 请求前的尺寸护栏）回归测试 ==========
// 实测事故：取图链把 942×4 的裁剪残片发给 API，触发
// 「Image dimensions are too small. Minimum allowed dimension: 14 pixels」整单 400 暂停。
// 语义（先质疑再固化，改前已核对被测行为）：
//   - 宽或高 <15px（API 地板 14px +1 安全边距）→ 剔除
//   - 极端比例 >100:1 → 剔除（合法长条题块图比例远低于此，100:1 整比保留）
//   - 未知格式/尺寸不可解析 → 不误杀，保留
//   - 剔除后无图 = 显式失败（宁可不取，绝不让 AI 对空图盲评）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---------- 测试图片合成（PNG/GIF/JPEG 头，尺寸可控） ----------
function png(width, height) {
    const buf = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
    buf.writeUInt32BE(13, 8);                 // IHDR 长度
    Buffer.from('IHDR').copy(buf, 12);
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    return buf.toString('base64');
}
function gif(width, height) {
    const buf = Buffer.alloc(13);
    Buffer.from('GIF89a').copy(buf, 0);
    buf.writeUInt16LE(width, 6);
    buf.writeUInt16LE(height, 8);
    return buf.toString('base64');
}
function jpeg(width, height) {
    // SOF0：FF C0 len=17 precision=8 高(BE16) 宽(BE16) …
    const buf = Buffer.alloc(2 + 2 + 17 + 2);
    buf.writeUInt16BE(0xffd8, 0);
    buf.writeUInt16BE(0xffc0, 2);
    buf.writeUInt16BE(17, 4);
    buf[6] = 8;
    buf.writeUInt16BE(height, 7);
    buf.writeUInt16BE(width, 9);
    buf.writeUInt16BE(0xffd9, buf.length - 2);
    return buf.toString('base64');
}

function loadGate() {
    // 提取废图闸纯函数（同 paper-guard 的 vm 提取模式）
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'ai-engine.js'), 'utf8');
    const grab = (name) => {
        const m = src.match(new RegExp('(?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));
        assert.ok(m, name + ' 函数未找到');
        return m[0];
    };
    const sandbox = {
        console: { log: () => {}, warn: () => {}, error: () => {} },
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        Math, JSON, String, Number, Array, Object, Error, isFinite,
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/core/runtime.js'), 'utf8'), sandbox);
    vm.runInContext(grab('probeImageDimensions') + '\n' + grab('filterUsableImagesForAI') +
        '\n;__exports__ = { probeImageDimensions, filterUsableImagesForAI };', sandbox);
    return sandbox.__exports__;
}

const { probeImageDimensions, filterUsableImagesForAI } = loadGate();

// ---------- 尺寸解析 ----------
test('尺寸解析：PNG / GIF / JPEG / data: URL', () => {
    // 跨 vm 域对象用 {...} 包装后再 deepStrictEqual（跨域原型会误报）
    assert.deepStrictEqual({ ...probeImageDimensions(png(942, 30)) }, { width: 942, height: 30 });
    assert.deepStrictEqual({ ...probeImageDimensions(gif(300, 200)) }, { width: 300, height: 200 });
    assert.deepStrictEqual({ ...probeImageDimensions(jpeg(640, 480)) }, { width: 640, height: 480 });
    assert.deepStrictEqual({ ...probeImageDimensions('data:image/png;base64,' + png(100, 80)) }, { width: 100, height: 80 });
});

// ---------- 过滤规则 ----------
test('事故形态：942×4 裁剪残片必须剔除（尺寸过小）', () => {
    const r = filterUsableImagesForAI([png(942, 4)]);
    assert.strictEqual(r.kept.length, 0);
    assert.strictEqual(r.removed.length, 1);
    assert.ok(r.removed[0].reason.includes('尺寸过小'), '实际: ' + r.removed[0].reason);
    assert.ok(r.removed[0].reason.includes('942×4'));
});

test('边界：<15px 一律剔除（14px 恰为 API 地板，本闸留 1px 安全边距）', () => {
    const r = filterUsableImagesForAI([png(14, 600), png(800, 14), gif(10, 10)]);
    assert.strictEqual(r.kept.length, 0);
    assert.strictEqual(r.removed.length, 3);
    assert.ok(r.removed.every(x => x.reason.includes('尺寸过小')));
    const keep = filterUsableImagesForAI([png(15, 600)]);
    assert.strictEqual(keep.kept.length, 1, '15px 起保留');
});

test('极端比例 >100:1 剔除；100:1 整比保留（别误杀合法长条题块图）', () => {
    const bad = filterUsableImagesForAI([png(2000, 15)]);          // 133:1
    assert.strictEqual(bad.kept.length, 0);
    assert.ok(bad.removed[0].reason.includes('极端比例'));

    const exact = filterUsableImagesForAI([png(1500, 15)]);        // 100:1 整比 → 保留
    assert.strictEqual(exact.kept.length, 1, '100:1 是边界值，不得误杀');
    const strip = filterUsableImagesForAI([png(942, 30)]);         // 合法长条题块 ~31:1
    assert.strictEqual(strip.kept.length, 1);
});

test('未知格式不误杀（尺寸不可解析按可用保留）', () => {
    const r = filterUsableImagesForAI([Buffer.from('不是图片').toString('base64'), png(800, 600)]);
    assert.strictEqual(r.kept.length, 2, '未知格式 + 合法图都保留');
    assert.strictEqual(r.removed.length, 0);
});

test('空图片数据剔除；混合列表 kept/removed 索引正确', () => {
    const r = filterUsableImagesForAI([png(800, 600), '', png(942, 4), null, png(100, 100)]);
    assert.strictEqual(r.kept.length, 2);
    assert.deepStrictEqual([...r.removed.map(x => x.index)], [1, 2, 3]);
    assert.ok(r.removed[0].reason.includes('空图片数据'));
});

// ---------- 行为：callAIOnce 请求组装汇聚点 ----------
function loadEngineForRequest() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'ai-engine.js'), 'utf8');
    const requests = [];
    const warns = [];
    const sandbox = {
        console: { log: () => {}, warn: (m) => warns.push(String(m)), error: () => {} },
        window: { aiGradingState: { abortController: new AbortController() } },
        document: null,
        SCRIPT_CONFIG: { DEFAULT_ENDPOINT: 'x', DEFAULT_MODEL: 'y', VERSION: '0' },
        GM_getValue: (k, d) => d, GM_setValue: () => {},
        fetch: async () => { throw new Error('no net'); },
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        setTimeout: (fn) => fn(), clearTimeout: () => {},
        AbortController, Math, JSON, Date, Error, RegExp, String, Number, Array, Object, Promise,
        parseFloat, parseInt, isNaN, isFinite,
        GM_xmlhttpRequest(options) {
            requests.push(JSON.parse(options.data));
            queueMicrotask(() => options.onload({
                status: 200,
                responseText: 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
            }));
            return { abort() {} };
        },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/core/runtime.js'), 'utf8'), sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/core/score.js'), 'utf8'), sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/core/prompt.js'), 'utf8'), sandbox);
    vm.runInContext(src + ';__exports__ = { callAIOnce };', sandbox);
    return { callAIOnce: sandbox.__exports__.callAIOnce, requests, warns, win: sandbox.window, sandbox };
}

test('行为：全部废图 → 显式失败，请求不得发出（宁可不取）', async () => {
    const { callAIOnce, requests, warns } = loadEngineForRequest();
    await assert.rejects(
        () => callAIOnce('题目', [png(942, 4), png(2000, 15)], { endpoint: 'https://e.test', apiKey: 'k', model: 'm' }, null, [], 2048),
        /废图剔除后无有效图片/
    );
    assert.strictEqual(requests.length, 0, '废图请求绝不能进 API');
    assert.ok(warns.some(w => w.includes('废图剔除')), '剔除必须 warn，实际: ' + warns.join(' | '));
});

test('参考答案图片不能替代缺失或全部不可用的学生答卷', async () => {
    const { callAIOnce, requests } = loadEngineForRequest();
    for (const students of [[png(942, 4)], []]) {
        await assert.rejects(() => callAIOnce('评分', students, { gradingRequest: true }, null, [png(800, 600)], 2048), /答题卡图片均不可用/);
    }
    assert.equal(requests.length, 0);
});

test('评分请求逐图注明参考资料与学生答卷，过滤后仍保留各自用途', async () => {
    const { callAIOnce, requests } = loadEngineForRequest();
    const reference = png(800, 600), student = png(900, 700);
    await callAIOnce('评分', [student], { gradingRequest: true }, null, [png(942, 4), reference], 2048);
    const content = requests[0].messages[0].content;
    const indexes = content.flatMap((item, i) => item.type === 'image_url' ? [i] : []);
    assert.equal(indexes.length, 2);
    assert.match(content[indexes[0] - 1].text, /参考资料/); assert.ok(content[indexes[0]].image_url.url.includes(reference));
    assert.match(content[indexes[1] - 1].text, /学生答卷/); assert.ok(content[indexes[1]].image_url.url.includes(student));
});

test('真实双评及第三模型仲裁均接收同一参考资料和学生答卷', async () => {
    const { sandbox, requests } = loadEngineForRequest();
    sandbox.__provider = (_provider, model) => ({ endpoint: 'https://e.test', apiKey: 'k', model });
    sandbox.PresetManager = { getMaxScore: () => 10 };
    sandbox.GM_xmlhttpRequest = options => {
        const request = JSON.parse(options.data); requests.push(request);
        const score = request.model === 'secondary' ? 5 : 0;
        const response = `【答案复述】\n${score ? 'I=3A' : '未作答'}\n【评分依据】\n依据实际书写\n【得分】\n${score}`;
        queueMicrotask(() => options.onload({ status: 200, responseText: 'data: ' + JSON.stringify({ choices: [{
            delta: { content: response }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n' }));
        return { abort() {} };
    };
    sandbox.__config = { answer: { text: '', images: [png(700, 600)] }, scoring: { maxScore: 10, roundStep: 1 },
        workflowSnapshot: { model: { provider: 'p', model: 'primary' }, dualEval: { enabled: true, threshold: 2,
            secondary: { provider: 'p', model: 'secondary' }, arbitration: { provider: 'p', model: 'arbitration' } } } };
    sandbox.__students = [png(900, 700)];
    vm.runInContext('ProviderManager.getCallConfig = __provider;', sandbox);
    const result = await vm.runInContext('callDualEvaluation(__students, __config)', sandbox);
    assert.equal(result.score, 0); assert.equal(requests.length, 3);
    for (const request of requests) {
        const content = request.messages[0].content;
        assert.equal(content.filter(item => item.type === 'image_url').length, 2);
        assert.ok(content.some(item => item.type === 'text' && item.text.includes('教师提供的参考资料')));
        assert.ok(content.some(item => item.type === 'text' && item.text.includes('本次待批改的学生答卷')));
    }
});

test('行为：一好一废 → 废图剔除后仅好图进请求，且提示词注明剔除（残卷不得照常出分）', async () => {
    const { callAIOnce, requests, warns } = loadEngineForRequest();
    const good = png(800, 600);
    const result = await callAIOnce('题目', [png(942, 4), good], { endpoint: 'https://e.test', apiKey: 'k', model: 'm' }, null, [], 2048);
    assert.strictEqual(result, 'ok');
    assert.strictEqual(requests.length, 1);
    const images = requests[0].messages[0].content.filter(c => c.type === 'image_url');
    assert.strictEqual(images.length, 1, '只应发出 1 张好图');
    assert.ok(images[0].image_url.url.includes(good));
    assert.ok(warns.some(w => w.includes('废图剔除')));
    // 返修②：部分剔除必须告知 AI 只剩残卷
    const promptText = requests[0].messages[0].content.find(c => c.type === 'text').text;
    assert.ok(promptText.includes('已剔除 1 张废图'), '部分剔除必须进提示词，实际: ' + promptText);
    assert.ok(promptText.includes('请基于剩余图片评判'));
});

test('行为：零图片（纯文本调用）不受闸影响（纠错等文本链路兼容）', async () => {
    const { callAIOnce, requests } = loadEngineForRequest();
    const result = await callAIOnce('题目', [], { endpoint: 'https://e.test', apiKey: 'k', model: 'm' }, null, [], 2048);
    assert.strictEqual(result, 'ok');
    assert.strictEqual(requests.length, 1, '无图输入应照常发起文本请求');
    const promptText = requests[0].messages[0].content.find(c => c.type === 'text').text;
    assert.ok(!promptText.includes('图片说明'), '无剔除不得注入注记');
});

test('行为：前置剔除经 state 通道进提示词（回评/纠错链，correction.js 自建 config 无通道）', async () => {
    const { callAIOnce, requests, win } = loadEngineForRequest();
    win.aiGradingState.imageGateRemovedCount = 2;
    await callAIOnce('题目', [png(800, 600)], { endpoint: 'https://e.test', apiKey: 'k', model: 'm' }, null, [], 2048);
    const promptText = requests[0].messages[0].content.find(c => c.type === 'text').text;
    assert.ok(promptText.includes('已剔除 2 张废图'), 'state 通道剔除数必须进提示词，实际: ' + promptText);
});

test('行为：config 通道优先，显式 0 权威（过期 state 不误报）', async () => {
    const { callAIOnce, requests, win } = loadEngineForRequest();
    win.aiGradingState.imageGateRemovedCount = 5;   // 过期残留
    await callAIOnce('题目', [png(800, 600)], { endpoint: 'https://e.test', apiKey: 'k', model: 'm', imageGateRemovedCount: 0 }, null, [], 2048);
    let promptText = requests[0].messages[0].content.find(c => c.type === 'text').text;
    assert.ok(!promptText.includes('图片说明'), 'config 显式 0 必须压过期 state，不得误报');

    await callAIOnce('题目', [png(800, 600)], { endpoint: 'https://e.test', apiKey: 'k', model: 'm', imageGateRemovedCount: 3 }, null, [], 2048);
    promptText = requests[1].messages[0].content.find(c => c.type === 'text').text;
    assert.ok(promptText.includes('已剔除 3 张废图'), 'config 通道剔除数必须进提示词');
});

// ---------- 行为：main.js 下载循环（startAutoGrading 真实主流程） ----------
async function runMainFlowWithImages(base64List) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'main.js'), 'utf8');
    const grab = (name) => {
        const m = src.match(new RegExp('(?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));
        assert.ok(m, name + ' 函数未找到');
        return m[0];
    };
    const parts = [
        grab('normalizePaperImageUrl'), grab('paperUrlSetContains'),
        grab('snapshotScoreInputs'), grab('scoreInputsTransitionedEmpty'),
        grab('verifyPaperUnchanged'), grab('confirmLeftMarkingPage'),
        grab('validateScoresForFill'), grab('safeFillScores'),   // N5 数值闸（startAutoGrading 填分依赖）
        grab('startAutoGrading'),
    ];
    const calls = { ai: 0, fill: 0, alerts: [], toasts: [], warns: [] };
    // 逐张 URL 对应 base64List 同下标图片（模拟多图答卷，其中可混入废图）
    const adapter = {
        isMarkingPage: () => true,
        gatherAnswerImages: async () => base64List.map((_, i) => `https://x.com/i${i}.png`),
        fetchImageAsBase64: async (url) => base64List[parseInt(url.match(/i(\d+)\.png$/)[1], 10)],
        getScoreInputs: () => [],
        fillScores: () => { calls.fill++; return true; },
    };
    const presetConfig = {
        question: { text: '', images: [], format: 'plain' },
        answer: { text: '答案', images: [], format: 'plain' },
        rubric: { text: '标准', images: [], format: 'plain' },
        scoring: { roundStep: 1, roundMethod: 'round' },
    };
    const sandbox = {
        console: { log: () => {}, warn: (m) => calls.warns.push(String(m)), error: () => {} },
        window: {
            __AI_MARKER_ADAPTER__: adapter,
            aiGradingState: {
                isRunning: true, isPaused: false, gradingMode: 'normal',
                errorRetryCount: 0, currentBase64DataArray: [], currentImageUrls: [],
                blankDetection: { skipOnce: false, blankCount: 0 },
            },
        },
        document: { querySelector: () => null, getElementById: () => null },
        AbortController, JSON, Math, Date, Error, RegExp, String, Number, Array, Object, Promise,
        parseFloat, parseInt, isNaN, isFinite,
        setTimeout: (fn) => fn(), clearTimeout: () => {},
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        filterUsableImagesForAI: (list) => filterUsableImagesForAI(list),   // 复用被测真实闸
        PresetManager: {
            data: { active: '默认配置' },
            getActiveCallConfig: () => ({ apiKey: 'k', model: 'm', endpoint: 'https://e.test' }),
            getCurrentConfig: () => presetConfig,
            validateScoringUnits: () => ({ valid: true, missingMaxScore: [] }),
            getMaxScore: () => 10,
        },
        WorkflowManager: { getWorkflow: () => null },
        extractFieldText: (f) => (f && f.text) || '',
        callAIGrading: async (imgs, cfg) => { calls.ai++; calls.aiConfig = cfg; return { score: 8, rawScore: 8, comment: '', studentAnswer: '作答内容足够长', diligenceLevel: 0, subScores: null }; },
        callDualEvaluation: async (imgs, cfg) => { calls.ai++; calls.aiConfig = cfg; return { score: 8, rawScore: 8, comment: '', studentAnswer: '作答内容足够长', diligenceLevel: 0, subScores: null }; },
        recordOutputLimitOutcome: () => {},
        ScoreCalculator: { calculate: () => ({ finalScore: 8, finalUnitScores: null, bonus: 0, breakdown: { decayFactor: 0, accuracyScore: 8 } }) },
        showStreamPanel: () => {}, updateStreamPanel: () => {}, hideStreamPanel: () => {},
        showToast: (m) => { calls.toasts.push(String(m)); },
        safeAlert: (m) => { calls.alerts.push(String(m)); },
        showAlertModal: (m) => { calls.alerts.push(String(m)); return Promise.resolve(); },
        openSettingsPanel: () => {}, stopAutoGrading: () => {}, handleLeaveMarkingPage: () => {},
        showAutoSubmitDialog: () => {},
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/core/runtime.js'), 'utf8'), sandbox);
    vm.runInContext(parts.join('\n') + '\n;__run = startAutoGrading;', sandbox);
    await sandbox.__run();
    calls.gateCount = sandbox.window.aiGradingState.imageGateRemovedCount;
    return calls;
}

test('行为：下载后全为废图 → 主流程显式失败，AI 与填分都不得执行', async () => {
    const calls = await runMainFlowWithImages([png(942, 4)]);
    assert.strictEqual(calls.ai, 0, '废图卷绝不能进 AI');
    assert.strictEqual(calls.fill, 0);
    assert.ok(calls.alerts.some(a => a.includes('均不可用') || a.includes('尺寸异常')), '必须显式失败告警，实际: ' + calls.alerts.join(' | '));
    assert.ok(calls.warns.some(w => w.includes('废图剔除')));
});

test('行为：一好一废 → 好图照常批改，废图被剔除并告警，剔除数进 AI 链路（返修②）', async () => {
    const calls = await runMainFlowWithImages([png(942, 4), png(800, 600)]);
    assert.strictEqual(calls.ai, 1, '好图应照常进 AI');
    assert.strictEqual(calls.fill, 1);
    assert.ok(calls.warns.some(w => w.includes('废图剔除')));
    assert.ok(calls.toasts.some(t => t.includes('废图')), '剔除应有可见提示，实际: ' + calls.toasts.join(' | '));
    assert.strictEqual(calls.gateCount, 1, '剔除数应登记 aiGradingState（回评/纠错链注记来源）');
    assert.strictEqual(calls.aiConfig && calls.aiConfig.imageGateRemovedCount, 1, '剔除数应随 gradingConfig 传给 AI 调用');
});

test('行为：全部合法图 → 零影响（不误杀）', async () => {
    const calls = await runMainFlowWithImages([png(942, 30), png(800, 600)]);
    assert.strictEqual(calls.ai, 1);
    assert.strictEqual(calls.fill, 1);
    assert.ok(!calls.warns.some(w => w.includes('废图剔除')), '合法图不得触发剔除告警');
    assert.strictEqual(calls.gateCount, 0, '零剔除不得登记误报');
});
