// ========== 注册/互串集群回归（strict-a R1 附录 A + strict-b S15/S16/S22） ==========
// 目标：
//   1. 四方互串消解：xinkao / xinkao-2 / xinkao-campus / yunyuejuan 在各自真实页面形态
//      上「恰好一家命中」（strict-b 活体格 S15/S16 + S17/S21/S22）；
//   2. huahanyun 不再全域激活：gradingList/非 lcedu 无路由页不得被认领；
//   3. 多命中显式告警：双命中时保留先到者 + console.error 红灯（静默劫持变可见）；
//   4. 文本护栏防回退（变异可红）：hostMatches 纪律 / 注册尾守卫形态 / 家族排他锚。
//
// 方法（strict-a S4 教训）：
//   - 按 build.js **生产装载顺序**加载（字母序会把赢家语义测反）；
//   - VM 沙箱补 XMLHttpRequest/fetch 等桩——否则 c30/guangda/guangda-2/jiukexing-homework
//     模块级 XHR 拦截器安装即抛，注册行从不执行（守卫失明）；
//   - 加载错误升级为失败条件（在途适配器 xkw/dongni 除外）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const ADAPTER_DIRS = ['xinkao', 'xinkao-2', 'xinkao-campus', 'yunyuejuan', 'huahanyun', 'haofenshu', 'yuejuan'];
// 在途适配器（其他开发流负责，加载错误不判失败）
const IN_FLIGHT = ['xkw', 'dongni'];

// ---------- 最小 DOM 匹配器（tag#id.class[attr(=val)] 子集，支持逗号列表） ----------
function el(tag, id, classes, attrs) {
    return { tag, id: id || '', classes: classes || [], attrs: attrs || {} };
}
function matchPart(e, part) {
    const m = part.trim().match(/^([a-zA-Z][a-zA-Z0-9]*)?((?:[#.\[].*)?)$/s);
    if (!m || (!m[1] && !m[2])) return false;   // 支持裸 #id / .class 形态
    if (m[1] && e.tag !== m[1].toLowerCase()) return false;
    const tokens = (m[2] || '').match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g) || [];
    for (const t of tokens) {
        if (t[0] === '#') { if (e.id !== t.slice(1)) return false; }
        else if (t[0] === '.') { if (!e.classes.includes(t.slice(1))) return false; }
        else {
            const am = t.slice(1, -1).match(/^([\w-]+)(?:=("[^"]*"|'[^']*'|[^\]]*))?$/);
            if (!am) return false;
            const key = am[1];
            if (!(key in e.attrs)) return false;
            if (am[2] !== undefined) {
                const val = am[2].replace(/^["']|["']$/g, '');
                if (String(e.attrs[key]) !== val) return false;
            }
        }
    }
    return true;
}
function makeDom(elements) {
    return {
        querySelector: (sel) => elements.find(e => sel.split(',').some(p => matchPart(e, p))) || null,
        querySelectorAll: (sel) => elements.filter(e => sel.split(',').some(p => matchPart(e, p))),
    };
}

// ---------- 沙箱（补桩清单见 strict-a 附 D.1，按"errors 为空"迭代） ----------
function makeStub({ hostname, pathname = '/', hash = '', elements = [], inputkey = false }) {
    const errors = [];
    const sb = {
        console: {
            log: () => {}, warn: () => {}, error: (msg) => errors.push(String(msg)), debug: () => {},
        },
        location: {
            hostname, pathname, hash,
            href: 'https://' + hostname + pathname + hash,
            search: '', origin: 'https://' + hostname,
            assign: () => {}, replace: () => {},
        },
        navigator: { userAgent: 'test' },
        Event: class { constructor(t) { this.type = t; } },
        CustomEvent: class { constructor(t) { this.type = t; } },
        MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
        XMLHttpRequest: class {
            open() {} send() {} setRequestHeader() {} abort() {}
            addEventListener() {} removeEventListener() {}
            upload = {}; readyState = 0; status = 0; responseText = '';
        },
        fetch: () => new Promise(() => {}),
        performance: { getEntriesByType: () => [], now: () => 0 },
        requestAnimationFrame: (cb) => setTimeout(cb, 0),
        cancelAnimationFrame: clearTimeout,
        setTimeout, clearTimeout, setInterval, clearInterval,
        CSS: { supports: () => true },
        GM_info: { script: { version: 'test' } },
        GM_getValue: () => undefined,
        GM_setValue: () => {},
        GM_deleteValue: () => {},
        GM_listValues: () => [],
        GM_addStyle: () => {},
        GM_xmlhttpRequest: () => ({ abort() {} }),
    };
    sb.HTMLInputElement = {
        prototype: {
            get value() { return this._v; },
            set value(v) { this._v = String(v); },
        },
    };
    const dom = makeDom(elements);
    sb.document = {
        querySelector: dom.querySelector,
        querySelectorAll: dom.querySelectorAll,
        addEventListener: () => {},
        removeEventListener: () => {},
        createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
        body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {} } },
        documentElement: { classList: { add: () => {}, remove: () => {} } },
    };
    if (inputkey) sb.inputkey = function inputkey() {};
    sb.window = sb;
    sb.top = sb;
    sb.self = sb;
    sb.unsafeWindow = sb;
    sb.__errors = errors;
    return sb;
}

// ---------- 生产顺序全量加载（strict-a 附 D.3） ----------
function productionOrder() {
    const build = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
    return [...build.matchAll(/'adapters\/([a-z0-9-]+)\/adapter\.js'/g)].map(m => m[1]);
}

function loadAllAdapters(sb) {
    const order = productionOrder();
    vm.createContext(sb);
    const errors = [];
    for (const d of order) {
        for (const f of ['selectors.js', 'adapter.js']) {
            const p = path.join(ROOT, 'src', 'adapters', d, f);
            if (!fs.existsSync(p)) continue;
            try {
                vm.runInContext(fs.readFileSync(p, 'utf8'), sb, { filename: d + '/' + f });
            } catch (e) {
                errors.push(d + '/' + f + ': ' + e.message);
            }
        }
    }
    return { order, errors };
}

// 单适配器隔离加载：claimant = 该适配器在该页面形态上是否认领（注册槽是否被它写入）
function claims(fixture, dir) {
    const sb = makeStub(fixture);
    vm.createContext(sb);
    for (const f of ['selectors.js', 'adapter.js']) {
        const p = path.join(ROOT, 'src', 'adapters', dir, f);
        if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), sb, { filename: dir + '/' + f });
    }
    return !!sb.__AI_MARKER_ADAPTER__;
}

// ---------- 页面形态夹具（strict-a 附 A 决策树 / strict-b 矩阵 / 附 D.4） ----------
const F_XINKAO = {
    hostname: '10.0.0.9:9090', pathname: '/Marking/DisPlay.aspx',
    elements: [
        el('img', '', ['teaimg']),
        el('input', 'fenshu0', ['fenshu'], { max: '4' }),
        el('button', 'submitbtn'),
    ],
};
const F_XINKAO2 = {
    hostname: '192.168.5.2:8080', pathname: '/biluo/display.jsp',
    elements: [
        el('img', '', ['teaimg']),
        el('input', 'fenshu0', ['fenshu'], { fen: '4' }),
        el('img', 'pic'),
    ],
};
const F_CAMPUS = {
    hostname: '172.16.3.4:8888', pathname: '/Marking/NormalReadPaper',
    inputkey: true,
    elements: [
        el('img', '', ['teaimg']),
        el('input', 'fenshu0', ['fenshu'], { 'data-score': '12' }),
    ],
};
const F_YUNYUEJUAN_SAAS = {
    hostname: '10.1.2.3:8080', pathname: '/Marking/NormalReadPaper',
    elements: [
        el('input', 'fenshu0', ['fenshu'], { 'data-score': '12' }),
        el('button', '', ['btn-standard-pri', 'phr15']),
        el('tbody', '', ['xtlist']),
    ],
};
const F_HAOYUEJUAN = {
    hostname: 'www.haoyuejuan.com', pathname: '/',
    elements: [el('input', '', ['ipt-score']), el('button', '', ['submit'])],
};
const F_YUEJUAN = {
    hostname: 'www.yuejuan.com', pathname: '/',
    elements: [el('img', '', ['studentAnswerImg'])],
};
const F_HY = {
    hostname: 'yj.lcedu.net.cn', pathname: '/', hash: '#/marking/grading?questionId=1',
    elements: [el('input', 'compuinput'), el('button', '', ['submitscorebtn'])],
};
const F_HY_GRADING_LIST = {
    hostname: 'yj.lcedu.net.cn', pathname: '/', hash: '#/marking/gradingList/list',
    elements: [el('input', 'compuinput'), el('button', '', ['submitscorebtn'])],
};
const F_HY_NOLCEDU = {
    hostname: 'example.com', pathname: '/', hash: '#/home',
    elements: [el('input', 'compuinput'), el('button', '', ['submitscorebtn'])],
};
const F_HY_GLUE = {
    hostname: 'xlcedu.net.cn', pathname: '/', hash: '#/marking/grading?questionId=1',
    elements: [],
};
const F_X05_RENAME = {
    hostname: 'rename.example', pathname: '/', hash: '#/marking/grading?questionId=1',
    elements: [el('input', 'compuinput'), el('button', '', ['submitscorebtn'])],
};
const F_X07 = {
    // X05 裁决后 huahanyun 不再认领非 lcedu；双命中真实残余面改为
    // yunyuejuan.net（hanhan 域名认领）× 云阅卷三锚页（yunyuejuan DOM 认领）
    hostname: 'yunyuejuan.net', pathname: '/Marking/NormalReadPaper',
    elements: [
        el('input', 'fenshu0', ['fenshu'], { 'data-score': '12' }),
        el('button', '', ['btn-standard-pri', 'phr15']),
        el('tbody', '', ['xtlist']),
    ],
};

// winner（生产顺序全量加载下的注册槽赢家）
function winner(fixture) {
    const sb = makeStub(fixture);
    const { errors } = loadAllAdapters(sb);
    const fatal = errors.filter(e => !IN_FLIGHT.some(d => e.startsWith(d + '/')));
    assert.deepStrictEqual(fatal, [], '适配器加载不得抛错（抛错=注册行未执行=守卫失明）: ' + fatal.join('; '));
    return { id: sb.__AI_MARKER_ADAPTER__ ? (sb.__AI_MARKER_ADAPTER__.id || sb.__AI_MARKER_ADAPTER__.platformKey) : null, sb };
}

// ================= 1. 活体格：四方互串消解（strict-b S15/S16/S22） =================

test('S15 活体格：/Marking/DisPlay 鑫考页恰好 xinkao 命中，xinkao-campus 不得再劫持', () => {
    const claimants = ADAPTER_DIRS.filter(d => claims(F_XINKAO, d));
    assert.deepStrictEqual(claimants, ['xinkao'], 'S15 命中集必须恰为 xinkao，实际: ' + claimants.join(','));
    assert.strictEqual(winner(F_XINKAO).id, 'xinkao');
});

test('S16 活体格：/biluo/display.jsp 鑫考2页恰好 xinkao-2 命中，xinkao-campus 不得再劫持', () => {
    const claimants = ADAPTER_DIRS.filter(d => claims(F_XINKAO2, d));
    assert.deepStrictEqual(claimants, ['xinkao-2'], 'S16 命中集必须恰为 xinkao-2，实际: ' + claimants.join(','));
    assert.strictEqual(winner(F_XINKAO2).id, 'xinkao-2');
});

test('S22 活体格：www.haoyuejuan.com 好阅卷不被 yuejuan 吞并（includes 子串回退必红）', () => {
    assert.strictEqual(claims(F_HAOYUEJUAN, 'yuejuan'), false, 'yuejuan 不得认领 haoyuejuan.com');
    assert.strictEqual(claims(F_HAOYUEJUAN, 'haoyuejuan'), true, 'haoyuejuan 自家页必须认领');
    assert.strictEqual(winner(F_HAOYUEJUAN).id, 'haoyuejuan', '好阅卷页赢家必须是 haoyuejuan');
});

test('S21 对照：www.yuejuan.com 仍归 yuejuan（精确匹配不误伤自家）', () => {
    assert.strictEqual(claims(F_YUEJUAN, 'yuejuan'), true);
    assert.strictEqual(winner(F_YUEJUAN).id, 'yuejuan');
});

test('S17：/Marking/NormalReadPaper 校园页恰好 xinkao-campus 命中（多命中🟡已消解）', () => {
    const claimants = ADAPTER_DIRS.filter(d => claims(F_CAMPUS, d));
    assert.deepStrictEqual(claimants, ['xinkao-campus'], 'S17 命中集必须恰为 xinkao-campus，实际: ' + claimants.join(','));
    assert.strictEqual(winner(F_CAMPUS).id, 'xinkao-campus');
});

test('附 A.4：yunyuejuan SaaS 形态（btn-standard-pri.phr15 + xtlist 三锚）恰好 yunyuejuan 命中', () => {
    const claimants = ADAPTER_DIRS.filter(d => claims(F_YUNYUEJUAN_SAAS, d));
    assert.deepStrictEqual(claimants, ['yunyuejuan'], '云阅卷 SaaS 页命中集必须恰为 yunyuejuan，实际: ' + claimants.join(','));
    assert.strictEqual(winner(F_YUNYUEJUAN_SAAS).id, 'yunyuejuan');
});

test('X03 回归：未知平台路径仅含 /Marking/ 不得再被 yunyuejuan 裸判定认领', () => {
    assert.strictEqual(claims({ hostname: '1.2.3.4', pathname: '/Marking/TaskIndex' }, 'yunyuejuan'), false);
});

// ================= 2. huahanyun 过度激活收窄 =================

test('S11：yj.lcedu.net.cn 批改路由正常认领（不得误伤自家）', () => {
    assert.strictEqual(claims(F_HY, 'huahanyun'), true);
    assert.strictEqual(winner(F_HY).id, 'huahanyun');
});

test('R3：gradingList 路由页不得被华翰云认领（indexOf 子串回退必红）', () => {
    assert.strictEqual(claims(F_HY_GRADING_LIST, 'huahanyun'), false, 'gradingList 不是批改页');
});

test('R2：lcedu 全域激活已消除——无关门户/粘连域不得认领', () => {
    assert.strictEqual(claims(F_HY_NOLCEDU, 'huahanyun'), false, '非 lcedu 无批改路由不得激活');
    assert.strictEqual(claims(F_HY_GLUE, 'huahanyun'), false, 'xlcedu.net.cn 粘连域 + 无 DOM 不得激活');
});

test('X05 裁决：宿主无关三特征兜底已删除——改名部署形态（非 lcedu + 路由 + 三特征）不得认领', () => {
    // 产品裁决（#324 铁律：宁可保守不劫持）：改名部署需加宿主白名单，不再走无宿主兜底
    assert.strictEqual(claims(F_X05_RENAME, 'huahanyun'), false, 'X05 改名部署形态不得再被认领');
    assert.strictEqual(claims(F_X05_RENAME, 'hanhan'), false, '对照：hanhan 亦不认领');
});

// ================= 3. 多命中显式告警（静默劫持变红灯） =================

test('多命中冲突必须 console.error 红灯且保留先到者（X07 形态）', () => {
    // yunyuejuan.net 云阅卷三锚页：hanhan（域名，先）与 yunyuejuan（DOM 三锚，后）同时认领
    const sb = makeStub(F_X07);
    loadAllAdapters(sb);
    assert.strictEqual(claims(F_X07, 'hanhan'), true);
    assert.strictEqual(claims(F_X07, 'yunyuejuan'), true);
    assert.strictEqual(sb.__AI_MARKER_ADAPTER__.id, 'hanhan', '先到先得：hanhan 先于 yunyuejuan 加载');
    assert.ok(sb.__errors.some(e => e.includes('注册冲突')), '多命中必须打红灯日志，实际: ' + sb.__errors.join('|'));
});

// ================= 4. 好分数 586e544 补强（strict-a H1） =================

test('H1：单张图片身份忽略签名与裁切变化，图片序号变化时区分图片', () => {
    const { id } = winner({
        hostname: 'yue.haofenshu.com', pathname: '/minions/subject/10501730/mark/27228560/normal/4',
        elements: [],
    });
    assert.strictEqual(id, 'haofenshu');
    const sb = makeStub({
        hostname: 'yue.haofenshu.com', pathname: '/minions/subject/10501730/mark/27228560/normal/4',
        elements: [],
    });
    loadAllAdapters(sb);
    const a = sb.__AI_MARKER_ADAPTER__;
    const u1 = 'https://yj-oss.yunxiao.com/v1/baidu-raw/cutimage/10501730/66880/10/000117/7D3D0C34-AB12_1158_84_988_303.jpg?authorization=bce-auth-v1/x';
    const u2 = 'https://yj-oss.yunxiao.com/v1/baidu-raw/cutimage/10501730/66880/10/000117/7D3D0C34-AB12_10_50_1000_400.jpg?authorization=bce-auth-v1/OTHER';
    const u3 = 'https://yj-oss.yunxiao.com/v1/baidu-raw/cutimage/10501730/66880/10/000118/99AA0C34-CD77_1158_84_988_303.jpg?authorization=bce-auth-v1/x';
    assert.strictEqual(a._sheetIdentity(u1), a._sheetIdentity(u2), '同图签名更新与裁切调整保持图片身份');
    assert.notStrictEqual(a._sheetIdentity(u1), a._sheetIdentity(u3), '不同图片序号具有不同图片身份，任务关系由原生任务核对');
    assert.strictEqual(a._sheetIdentity('https://x.com/a/b_1_2_3_4.jpg?q=1'), 'https://x.com/a/b.jpg', '非 cutimage 回退去 query+裁切后缀');
});

// ================= 4b. 好分数 fillScores 三遍式（strict-b §6.5） =================

function haofenshuWithInputs(inputDefs) {
    const sb = makeStub({
        hostname: 'yue.haofenshu.com', pathname: '/minions/subject/10501730/mark/27228560/normal/4',
        elements: [],
    });
    loadAllAdapters(sb);
    const a = sb.__AI_MARKER_ADAPTER__;
    a.getScoreInputs = () => inputDefs.map((d, i) => {
        // stuck 模拟 Vue 受控输入回写/清空：native setter 写入后读回仍为空
        const fake = d.stuck
            ? { _v: '', get value() { return ''; }, dispatchEvent() {} }
            : { _v: '', get value() { return this._v; }, dispatchEvent() {} };
        return { element: fake, label: d.label || `第${i + 1}题`, index: i, maxScore: d.maxScore || 0 };
    });
    return a;
}

test('H2/§6.5：fillScores 三遍式——NaN/负分/越界拒绝，写后回读不符拒绝', () => {
    const a = haofenshuWithInputs([{ maxScore: 10 }, { maxScore: 6 }]);
    assert.strictEqual(a.fillScores([NaN, 3]), false, 'NaN 分必须拒绝');
    assert.strictEqual(a.fillScores([-1, 3]), false, '负分必须拒绝');
    assert.strictEqual(a.fillScores([99, 3]), false, '超出满分必须拒绝');
    assert.strictEqual(a.fillScores([8, null]), false, '缺分必须拒绝');
    assert.strictEqual(a.fillScores([8]), false, '分数少于输入框必须拒绝');
    const ok = haofenshuWithInputs([{ maxScore: 10 }, { maxScore: 6 }]);
    assert.strictEqual(ok.fillScores([8, 4]), true, '合法分数必须全量写入');
    const stuck = haofenshuWithInputs([{ maxScore: 10, stuck: true }, { maxScore: 6 }]);
    assert.strictEqual(stuck.fillScores([8, 4]), false, '写后回读不符（受控输入回写）必须拒绝');
});

// ================= 5. 文本护栏（防回退，变异可红） =================

test('护栏1：触碰的适配器禁 hostname.includes( 裸子串（hostMatches 纪律，ruiya 姿势）', () => {
    const offenders = [];
    for (const d of ADAPTER_DIRS) {
        const src = fs.readFileSync(path.join(ROOT, 'src', 'adapters', d, 'adapter.js'), 'utf8');
        if (/hostname\.includes\(/.test(src)) offenders.push(d);
    }
    assert.deepStrictEqual(offenders, [], '发现裸子串 hostname 匹配: ' + offenders.join(','));
});

test('护栏2：注册尾必须被 shouldInitialize 守卫 + 多命中 console.error + fail-closed', () => {
    const offenders = [];
    for (const d of ADAPTER_DIRS) {
        const src = fs.readFileSync(path.join(ROOT, 'src', 'adapters', d, 'adapter.js'), 'utf8');
        const guarded = /shouldInitialize\(\)\)[\s\S]{0,600}?__AI_MARKER_ADAPTER__\s*=/.test(src);
        const alarm = src.includes('注册冲突') && src.includes('console.error');
        const failClosed = src.includes('fail-closed');
        if (!(guarded && alarm && failClosed)) offenders.push(d);
    }
    assert.deepStrictEqual(offenders, [], '注册尾形态回退: ' + offenders.join(','));
});

test('护栏3：家族排他锚/路由精确化不得回退（互串放大器防线）', () => {
    const read = (d) => fs.readFileSync(path.join(ROOT, 'src', 'adapters', d, 'adapter.js'), 'utf8');
    assert.ok(read('xinkao').includes("input.fenshu[max]"), 'xinkao 必须带 max/data-max 专有锚');
    assert.ok(read('xinkao').includes("!document.querySelector('input.fenshu[fen]')"), 'xinkao 必须排 fen');
    assert.ok(read('xinkao-2').includes("input.fenshu[fen]"), 'xinkao-2 必须带 fen 专有锚');
    assert.ok(read('xinkao-2').includes("!document.querySelector('input.fenshu[data-score]')"), 'xinkao-2 必须排 data-score');
    assert.ok(read('xinkao-campus').includes("input.fenshu[data-score]"), 'xinkao-campus 必须带 data-score 专有锚');
    assert.ok(read('xinkao-campus').includes("button.btn-standard-pri"), 'xinkao-campus 必须按提交形态排 yunyuejuan');
    const yyj = read('yunyuejuan');
    assert.ok(!/return window\.location\.pathname\.includes\('\/Marking\/'\);\s*\}/.test(yyj), 'yunyuejuan 不得回退裸 /Marking/ 判定');
    assert.ok(yyj.includes('btn-standard-pri.phr15') && yyj.includes('tbody.xtlist'), 'yunyuejuan 必须带 DOM 三锚');
    const hy = read('huahanyun');
    assert.ok(!hy.includes("indexOf('/marking/grading')"), 'huahanyun 路由不得回退 indexOf 子串');
    assert.ok(hy.includes("#\\/marking\\/grading(\\?|$)"), 'huahanyun 路由必须精确正则（gradingList 不得命中）');
    assert.ok(read('yuejuan').includes("h === 'yuejuan.com'"), 'yuejuan 必须精确域匹配（S22）');
});
