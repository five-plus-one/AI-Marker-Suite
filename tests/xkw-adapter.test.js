// ========== 学科网 e卷通 适配器行为级测试 ==========
// 对照 tests/huahanyun-adapter.test.js 的 vm + DOM 桩模式：
// 用桩加载真实适配器代码，覆盖 strict-b 随产随审 3 处缺口的回归面：
//   gap1 换卷证据降级（paperId 主判、resultId 仅 tiebreak、同卷重记不换卷）
//   gap2 scores.length > inputs.length 显式拒绝（禁静默截断）
//   gap3 submitGrade 禁用按钮显式失败（禁假成功）
// 加四级取图兜底 fail-closed 与写后验证面。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const test = require('node:test');

const SRC = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', 'adapters', 'xkw', p), 'utf8');

// ---------- DOM 桩 ----------
function fakeInput(placeholder = '满12分', opts = {}) {
    return {
        tagName: 'INPUT',
        getAttribute: (k) => (k === 'placeholder' ? placeholder : null),
        dispatchEvent: () => {},
        get value() { return opts.swallow ? '' : (this._v ?? ''); },
        set value(v) { this._v = String(v); },
    };
}

function fakeBlock(label, input) {
    const row = { querySelector: (sel) => (sel === 'p.ques-no' ? { textContent: label } : null) };
    return {
        querySelector: (sel) => (sel === 'input.el-input__inner' ? input : null),
        closest: (sel) => (sel === 'tr' ? row : null),
    };
}

function fakeButton(text, opts = {}) {
    return {
        tagName: 'BUTTON',
        textContent: text,
        disabled: !!opts.disabled,
        getAttribute: (k) => (k === 'aria-disabled' ? (opts.ariaDisabled ? 'true' : null) : null),
        getClientRects: () => (opts.visible === false ? [] : [{}]),
        click() { this.clicked = (this.clicked || 0) + 1; },
    };
}

function ossUrl(paperId, pos, quality) {
    return `https://oss-yuejuan-prod.oss-cn-hangzhou.aliyuncs.com/exam/0000486/2119983590628388864/${paperId}.jpg`
        + (pos ? `?x-oss-process=image/crop,${pos}${quality ? '/quality,q_80' : ''}` : '');
}

// resource timing 条目：startTime 用绝对量级（生产 timeOrigin+startTime 同为 epoch 毫秒）
function entry(name, offsetMs) {
    return { name, startTime: Date.now() + offsetMs };
}

function loadAdapter({ blocks = [], buttons = [], entries = [] } = {}) {
    const sb = {
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        location: {
            hostname: 'yuejuan.xkw.com',
            pathname: '/exam/marking/task/mark/2119983590628388864',
            search: '?readType=1&dpi=200&num=27&topic=27',
        },
        Event: class { constructor(t) { this.type = t; } },
        aiGradingState: { isRegrading: false },
        performance: { timeOrigin: 0, getEntriesByType: (t) => (t === 'resource' ? entries : []) },
        setInterval, clearInterval, setTimeout, clearTimeout,
        // 测试小窗口（生产默认 25s）
        __AI_MARKER_WAIT_WINDOW_MS__: 600,
    };
    sb.HTMLInputElement = {
        prototype: {
            get value() { return this._v; },
            set value(v) { this._v = String(v); },
        },
    };
    sb.document = {
        querySelectorAll: (sel) => {
            if (sel === 'p.ques-score') return blocks;
            if (sel === 'button') return buttons;
            return [];
        },
        querySelector: () => null,
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SRC('selectors.js'), sb);
    vm.runInContext(SRC('adapter.js'), sb);
    return sb.__AI_MARKER_ADAPTER__;
}

function ingest(a, { resultId, paperId, crops = [], full = [], isReview = 0 }) {
    // paperId 注入 OSS 文件名；paperId 为 '' 时用无文件名 URL（不可解析）
    const body = {
        isReview,
        studentPaperInfo: {
            resultId,
            paperOssUrls: (paperId ? [ossUrl(paperId)] : ['https://oss-yuejuan-prod.example/no-file'])
                .concat(full)
                .map(u => ({ absent: false, ossUrl: u })),
            paperQuestions: [{ num: 27, positions: crops.map((u, i) => ({ orderNum: i + 1, ossUrl: u })) }],
        },
    };
    a._ingestItem(JSON.stringify({ body }));
}

// vm realm 数组拷回主 realm（deepStrictEqual 会比原型，跨 realm 必挂）
const host = (arr) => Array.from(arr);

const P1 = 'x_137,y_1320,w_1410,h_171';
const P2 = 'x_3272,y_271,w_1330,h_730';

// ---------- gap2：fillScores 全或无（多给/少给/缺分/越界/写后验证） ----------
test('gap2 多给分数显式拒绝（不得静默截断），且不写入', () => {
    const i1 = fakeInput(), i2 = fakeInput();
    const a = loadAdapter({ blocks: [fakeBlock('2.11.12', i1), fakeBlock('2.11.13', i2)] });
    assert.strictEqual(a.fillScores([5, 6, 7]), false, '多给的分必须整体拒绝');
    assert.strictEqual(i1.value, '', '拒绝时不得写入');
    assert.strictEqual(i2.value, '', '拒绝时不得写入');
});

test('gap2 少给 / 含 null / NaN / 越界 一律整体拒绝且不写入', () => {
    const i1 = fakeInput('满12分'), i2 = fakeInput('满8分');
    const a = loadAdapter({ blocks: [fakeBlock('2.11.12', i1), fakeBlock('2.11.13', i2)] });
    assert.strictEqual(a.fillScores([5]), false, '少给拒绝');
    assert.strictEqual(a.fillScores([5, null]), false, '缺分拒绝（全或无）');
    assert.strictEqual(a.fillScores([5, undefined]), false, '缺分拒绝');
    assert.strictEqual(a.fillScores([5, NaN]), false, 'NaN 拒绝');
    assert.strictEqual(a.fillScores([5, 9]), false, '越界（>满分8）拒绝');
    assert.strictEqual(a.fillScores([-1, 5]), false, '负分拒绝');
    assert.strictEqual(i1.value, '', '任何拒绝路径都不得写入');
    assert.strictEqual(i2.value, '', '任何拒绝路径都不得写入');
});

test('fillScores 全合法 → 全部写入且写后验证通过', () => {
    const i1 = fakeInput('满12分'), i2 = fakeInput('满8分');
    const a = loadAdapter({ blocks: [fakeBlock('2.11.12', i1), fakeBlock('2.11.13', i2)] });
    assert.strictEqual(a.fillScores([3.5, 8]), true);
    assert.strictEqual(i1.value, '3.5');
    assert.strictEqual(i2.value, '8');
});

test('fillScores 写后验证：写入未落值时显式失败', () => {
    const swallow = fakeInput('满12分', { swallow: true });
    const a = loadAdapter({ blocks: [fakeBlock('2.11.12', swallow)] });
    assert.strictEqual(a.fillScores([5]), false, '写后验证失败必须显式失败');
});

test('fillScores 无输入框显式失败', () => {
    const a = loadAdapter({ blocks: [] });
    assert.strictEqual(a.fillScores([5]), false);
});

// ---------- gap1：waitForNextPaper 换卷证据（paperId 主判） ----------
test('gap1 同卷重记不换卷：同 paperId + 新 resultId 必须继续等（不得误判换卷）', async () => {
    const entries = [entry(ossUrl('111', P1), 5000)];
    const a = loadAdapter({ entries });
    ingest(a, { resultId: 'R1', paperId: '111', crops: [ossUrl('111', P1)] });
    // 同卷重记（重评/二评同卷新 resultId）
    setTimeout(() => ingest(a, { resultId: 'R2', paperId: '111', crops: [ossUrl('111', P1)] }), 100);
    const t0 = Date.now();
    assert.strictEqual(await a.waitForNextPaper(ossUrl('111', P1)), false, '同卷重记不得判换卷');
    assert.ok(Date.now() - t0 >= 500, '应等满窗口（阻塞式）而非瞬时返回');
});

test('gap1 paperId 主判：paperId 变化即换卷，且窗口内延迟换卷要等得到', async () => {
    const entries = [entry(ossUrl('111', P1), 5000)];
    const a = loadAdapter({ entries });
    ingest(a, { resultId: 'R1', paperId: '111', crops: [ossUrl('111', P1)] });
    setTimeout(() => {
        entries.push(entry(ossUrl('222', P1), 60000));
    }, 150);
    const t0 = Date.now();
    assert.strictEqual(await a.waitForNextPaper(ossUrl('111', P1)), true, 'paperId 变化必须判换卷');
    assert.ok(Date.now() - t0 >= 100, '必须体现阻塞等待');
});

test('gap1 空 oldImageUrl 宁等勿错（fail-open 会同卷重复批改）', async () => {
    const a = loadAdapter({ entries: [entry(ossUrl('222', P1), 5000)] });
    ingest(a, { resultId: 'R9', paperId: '222', crops: [ossUrl('222', P1)] });
    assert.strictEqual(await a.waitForNextPaper(''), false, '无旧证据无从比较 → 等待');
    assert.strictEqual(await a.waitForNextPaper(null), false);
});

test('gap1 resultId 仅 tiebreak：双侧全无 paperId 证据时 resultId 变化才兜底判换卷', async () => {
    const a = loadAdapter({ entries: [] });
    ingest(a, { resultId: 'R1', paperId: '' });  // URL 不可解析 → 无 paperId 证据
    setTimeout(() => ingest(a, { resultId: 'R2', paperId: '' }), 100);
    assert.strictEqual(await a.waitForNextPaper(''), true, '无 paperId 证据时 resultId 变化作 tiebreak 兜底');
});

// ---------- 取图四级兜底 fail-closed ----------
test('取图 fail-closed：无任何证据返回空数组（宁可不取）', async () => {
    const a = loadAdapter({ entries: [] });
    assert.deepStrictEqual(host(await a.gatherAnswerImages()), []);
});

test('取图一级：API 切题图优先（fresh item）', async () => {
    const c1 = ossUrl('111', P1), c2 = ossUrl('111', P2);
    const entries = [entry(c1, 5000), entry(c2, 5100)];
    const a = loadAdapter({ entries });
    ingest(a, { resultId: 'R1', paperId: '111', crops: [c1, c2] });
    assert.deepStrictEqual(host(await a.gatherAnswerImages()), [c1, c2], 'API positions 图应原序返回');
});

test('取图二级：resource 兜底并去 /quality,q_80 变体（同 position 只留原图）', async () => {
    const plain = ossUrl('222', P1, false), q80 = ossUrl('222', P1, true), p2 = ossUrl('222', P2, false);
    const a = loadAdapter({ entries: [entry(q80, 5000), entry(plain, 5100), entry(p2, 5200)] });
    const out = await a.gatherAnswerImages();
    assert.strictEqual(out.length, 2, '同 position 的 q_80 变体必须去重');
    assert.ok(out.every(u => u.indexOf('/quality') === -1), '优先不带 /quality 的原切图');
});

test('取图防错卷：陈旧 item 不得覆盖新卷证据（双源不一致取更晚者）', async () => {
    const oldC = ossUrl('111', P1), newC = ossUrl('222', P1);
    // item 是旧卷 111（时间早），resource 证据是新卷 222（时间晚）
    const a = loadAdapter({ entries: [entry(newC, 60000)] });
    ingest(a, { resultId: 'R1', paperId: '111', crops: [oldC] });
    const out = host(await a.gatherAnswerImages());
    assert.deepStrictEqual(out, [newC], '必须取当前卷（222）图，不得把旧卷图喂 AI');
});

test('取图三级：fresh item 无切题图时整卷图兜底', async () => {
    const full = ossUrl('333', null, false);
    const a = loadAdapter({ entries: [entry(full, 5000)] });
    ingest(a, { resultId: 'R1', paperId: '333', crops: [], full: [] });
    // paperOssUrls 由 ingest 注入 ossUrl('333')（整卷，无 crop 参数）
    const out = await a.gatherAnswerImages();
    assert.strictEqual(out.length, 1);
    assert.ok(out[0].indexOf('333.jpg') >= 0, '整卷图兜底应为本卷文件');
    assert.ok(out[0].indexOf('image/crop') === -1);
});

// ---------- gap3：submitGrade 禁用按钮 / 空框 / 正常提交 ----------
test('gap3 disabled 按钮显式失败（不得假成功）', () => {
    const i1 = fakeInput();
    const btn = fakeButton('提交分数', { disabled: true });
    const a = loadAdapter({ blocks: [fakeBlock('2.11.12', i1)], buttons: [btn] });
    a.fillScores([5]);
    assert.strictEqual(a.submitGrade(), false, '禁用按钮必须显式失败');
    assert.ok(!btn.clicked, '禁用按钮不得点击');
});

test('gap3 aria-disabled 同样显式失败', () => {
    const i1 = fakeInput();
    const btn = fakeButton('提交分数', { ariaDisabled: true });
    const a = loadAdapter({ blocks: [fakeBlock('2.11.12', i1)], buttons: [btn] });
    a.fillScores([5]);
    assert.strictEqual(a.submitGrade(), false);
    assert.ok(!btn.clicked);
});

test('submitGrade 空框拒绝（空分进平台=事故）', () => {
    const i1 = fakeInput();
    const btn = fakeButton('提交分数');
    const a = loadAdapter({ blocks: [fakeBlock('2.11.12', i1)], buttons: [btn] });
    assert.strictEqual(a.submitGrade(), false, '空框必须拒绝提交');
    assert.ok(!btn.clicked);
});

test('submitGrade 正常提交：点击可用按钮', () => {
    const i1 = fakeInput();
    const btn = fakeButton('提交分数');
    const a = loadAdapter({ blocks: [fakeBlock('2.11.12', i1)], buttons: [btn] });
    assert.strictEqual(a.fillScores([5]), true);
    assert.strictEqual(a.submitGrade(), true);
    assert.strictEqual(btn.clicked, 1);
});

test('submitGrade 无提交按钮显式失败', () => {
    const i1 = fakeInput();
    const a = loadAdapter({ blocks: [fakeBlock('2.11.12', i1)], buttons: [fakeButton('别的按钮')] });
    a.fillScores([5]);
    assert.strictEqual(a.submitGrade(), false);
});
