// ========== 适配器注册/分派矩阵 —— 共享测试基建 ==========
// 供 bundle-competition.test.js 与 adapter-registration.test.js 共用：
//   - makeStub(form)：DOM 桩（选择器精确键控）+ MutationObserver 捕获 + 注册写计数
//   - loadAdapters/loadOne：按 build.js bundle 顺序（同 bundle 语义）或单适配器加载
//   - ADAPTERS：41 适配器的自家平台形态（own）与近似域名/部分签名（near）
// 约定：dom 的值仅作存在性桩（shouldInitialize 只看 querySelector 真值）；
// 真实 DOM 中同一元素可命中多个选择器时，在 dom 里给多个键映射到同一桩对象。
'use strict';
const fs = require('fs');
const path = require('path');
const QIGUANG = require('./_qiguang-signature.js');

const ROOT = path.join(__dirname, '..');
const AD_DIR = path.join(ROOT, 'src', 'adapters');

// ---------- 源码读取（带缓存）与变异注入 ----------
const srcCache = new Map();
function readSrc(rel) {
    if (!srcCache.has(rel)) {
        srcCache.set(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    }
    return srcCache.get(rel);
}

function applyMutations(code, rel, mutations) {
    for (const m of (mutations || [])) {
        if (m.file === rel) {
            if (!code.includes(m.find)) throw new Error('变异目标未命中: ' + rel + ' :: ' + m.find);
            code = code.split(m.find).join(m.replace);
        }
    }
    return code;
}

// ---------- bundle 顺序（与 build.js adapterModules 一致，运行时解析防漂移）----------
function bundleOrder() {
    const build = readSrc('build.js');
    const m = build.match(/adapterModules:\s*\[([\s\S]*?)\]/);
    if (!m) throw new Error('build.js 中未找到 adapterModules 列表');
    return [...m[1].matchAll(/'(adapters\/[^']+)'/g)].map(x => x[1]);
}

// 全部适配器目录（有 adapter.js 的）
function allAdapterDirs() {
    return fs.readdirSync(AD_DIR).filter(d => fs.existsSync(path.join(AD_DIR, d, 'adapter.js'))).sort();
}

// 未入 build.js 的开发中适配器（登记制：交付合入 build.js 后即可从这里删除）
const KNOWN_UNBUNDLED = ['dongni', 'xkw'];

// 加载顺序 = build.js 顺序（每项是一个模块文件，selectors 与 adapter 分列），
// 兜底追加未入 bundle 的目录（selectors+adapter 成对），保持矩阵全覆盖
function loadOrder() {
    const order = bundleOrder();
    const bundled = new Set(order.map(p => p.split('/')[1]));
    const tail = [];
    for (const d of allAdapterDirs().filter(d => !bundled.has(d)).sort()) {
        if (fs.existsSync(path.join(AD_DIR, d, 'selectors.js'))) tail.push('adapters/' + d + '/selectors.js');
        tail.push('adapters/' + d + '/adapter.js');
    }
    return order.concat(tail);
}

// ---------- DOM 桩（strict-a.md 附录 D.1 补桩清单：加载错误=注册失明，桩必须让全量适配器零错误求值）----------
function makeStub(form = {}) {
    const dom = {};
    for (const [sel, v] of Object.entries(form.dom || {})) dom[sel] = v && typeof v === 'object' ? v : (v ? {} : null);
    const writes = [];
    const observers = [];
    const storage = () => {
        const m = new Map();
        return {
            getItem: (k) => (m.has(k) ? m.get(k) : null),
            setItem: (k, v) => m.set(k, String(v)),
            removeItem: (k) => m.delete(k),
            clear: () => m.clear(),
        };
    };
    const fakeEl = () => ({
        style: {}, classList: { add() {}, remove() {}, toggle() {} },
        setAttribute() {}, getAttribute() { return null; }, appendChild() {}, remove() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
        getContext: () => ({ drawImage() {}, getImageData: () => ({ data: [] }) }),
        getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0 }),
    });
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        location: {
            hostname: form.host || 'example.com',
            pathname: form.path || '/',
            hash: form.hash || '',
            search: form.search || '',
            href: (form.protocol || 'https:') + '//' + (form.host || 'example.com')
                + (form.port ? ':' + form.port : '') + (form.path || '/') + (form.search || '') + (form.hash || ''),
        },
        getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
        Event: class { constructor(t) { this.type = t; } },
        CustomEvent: class { constructor(t) { this.type = t; } },
        MutationObserver: class {
            constructor(cb) { this.cb = cb; observers.push(this); }
            observe() {} disconnect() {} takeRecords() { return []; }
        },
        XMLHttpRequest: class {
            open() {} send() {} setRequestHeader() {} abort() {}
            addEventListener() {} removeEventListener() {}
            upload = {}; readyState = 0; status = 0; responseText = '';
        },
        fetch: () => new Promise(() => {}),
        performance: { getEntriesByType: () => [], now: () => 0 },
        sessionStorage: storage(),
        localStorage: storage(),
        requestAnimationFrame: (cb) => { return 0; },
        cancelAnimationFrame: () => {},
        CSS: { supports: () => true },
        addEventListener: () => {}, removeEventListener: () => {},
        setTimeout: (fn) => { return 0; }, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
        navigator: { userAgent: 'test' },
        URL, URLSearchParams,
    };
    sb.HTMLInputElement = {
        prototype: {
            get value() { return this._v; },
            set value(v) { this._v = String(v); },
        },
    };
    sb.document = {
        // 逗号选择器按 OR 拆分逐段匹配（精确键控）；属性选择器（input.fenshu[fen] 等）作为整键
        querySelector: (sel) => {
            for (const part of String(sel).split(',')) {
                const key = part.trim();
                if (dom[key]) return dom[key];
            }
            return null;
        },
        querySelectorAll: (sel) => {
            for (const part of String(sel).split(',')) {
                const key = part.trim();
                if (dom[key]) return [dom[key]];
            }
            return [];
        },
        addEventListener: () => {},
        removeEventListener: () => {},
        createElement: () => fakeEl(),
        createElementNS: () => fakeEl(),
        head: { appendChild: () => {} },
        body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {} } },
        documentElement: { classList: { add: () => {}, remove: () => {} } },
    };
    sb.window = sb;
    sb.top = sb;
    sb.self = sb;
    sb.unsafeWindow = sb;
    sb.GM_info = { script: { version: 'test' } };
    // 注册写计数：捕获每次 window.__AI_MARKER_ADAPTER__ 赋值（重复注册/劫持的探针）
    Object.defineProperty(sb, '__AI_MARKER_ADAPTER__', {
        configurable: true,
        get() { return this.___reg || undefined; },
        set(v) { this.___reg = v; writes.push({ id: v && v.id, name: v && v.name }); },
    });
    sb.__writes = writes;
    sb.__observers = observers;
    sb.__dom = dom;
    return sb;
}

// ---------- 加载 ----------
function runFile(sb, rel, mutations, errors) {
    const code = applyMutations(readSrc(rel), rel, mutations);
    try {
        vmRun(sb, code, rel);
    } catch (e) {
        errors.push(rel + ': ' + e.message);
    }
}

const vm = require('vm');
function vmRun(sb, code, filename) {
    if (!sb.__ctxReady) { vm.createContext(sb); sb.__ctxReady = true; }
    vm.runInContext(code, sb, { filename });
}

// 同 bundle 语义：按 build.js 模块序列（selectors+adapter 分列交错）全量加载
function loadAdapters(sb, opts = {}) {
    const errors = [];
    for (const mod of loadOrder()) {
        runFile(sb, 'src/' + mod, opts.mutations, errors);
    }
    return { errors, writes: sb.__writes, winner: sb.__AI_MARKER_ADAPTER__ || null };
}

// 单适配器隔离加载（注册层语义）
function loadOne(sb, dir, opts = {}) {
    const errors = [];
    const selRel = 'src/adapters/' + dir + '/selectors.js';
    if (fs.existsSync(path.join(ROOT, selRel))) runFile(sb, selRel, opts.mutations, errors);
    runFile(sb, 'src/adapters/' + dir + '/adapter.js', opts.mutations, errors);
    return { errors, writes: sb.__writes, winner: sb.__AI_MARKER_ADAPTER__ || null };
}

// ---------- 平台形态矩阵 ----------
// own: 自家平台最小形态（隔离加载必注册；bundle 下除已知竞争外必须唯一命中）
// near: 近似域名/缺条件形态（必须不注册 → 空槽）
const ADAPTERS = [
    { dir: 'wentongyun', id: 'wentongyun', name: '文通云',
      own: { host: 'www.wtjy.com', path: '/', hash: '#/mark/new-mark-question?examPaperId=exam&sheetDetailId=sheet&questionNum=20&type=1&again=0&isClass=0',
        dom: { '.mark .question-cotnent': 1, '.mark .score-board': 1 } },
      near: [{ label: '文通云近似域名不注册', form: { host: 'www.wtjy.com.example.com', path: '/', hash: '#/mark/new-mark-question?examPaperId=exam',
                dom: { '.mark .question-cotnent': 1, '.mark .score-board': 1 } } },
             { label: '文通云登录页不注册', form: { host: 'www.wtjy.com', path: '/', hash: '#/login',
                dom: { '.mark .question-cotnent': 1, '.mark .score-board': 1 } } },
             { label: '文通云阅卷页等待原生结构', form: { host: 'www.wtjy.com', path: '/', hash: '#/mark/new-mark-question?examPaperId=exam' } }] },
    { dir: 'jzsmartedu', id: 'jzsmartedu', name: '焦作精准教学',
      own: { host: 'jzjx.jzsmartedu.cn', path: '/dnpc/', hash: '#/v2/read-paper?examPaperId=exam&readBlockId=block&readPaperType=1',
        dom: { '#read-paper-score-board.page-read-paper-score-board': 1, '#tab-3': 1, '.body-center-main': 1 } },
      near: [{ label: '焦作近似域名不注册', form: { host: 'jzjx.jzsmartedu.cn.example.com', path: '/dnpc/', hash: '#/v2/read-paper' } },
             { label: '焦作题块列表不注册', form: { host: 'jzjx.jzsmartedu.cn', path: '/dnpc/', hash: '#/v2/read-paper/question-block',
                dom: { '#read-paper-score-board.page-read-paper-score-board': 1, '#tab-3': 1, '.body-center-main': 1 } } },
             { label: '焦作应用首页等待阅卷特征', form: { host: 'jzjx.jzsmartedu.cn', path: '/dnpc/', hash: '#/v2/read-paper' } }] },
    { dir: 'qiguang', id: 'qiguang', name: '启光优测',
      own: { host: '120.78.5.37', path: QIGUANG.ROUTE, dom: QIGUANG.signature() },
      near: [{ label: '启光登录页不注册', form: { host: '120.78.5.37', path: '/Account/Login' } },
             { label: '启光近似主机缺少平台特征', form: { host: '120.78.5.37.example.com', path: QIGUANG.ROUTE } },
             { label: '启光同路径缺少入口模块', form: { host: 'other.school.example', path: QIGUANG.ROUTE,
                 dom: { ...QIGUANG.signature(), 'script[src]': null } } }] },
    { dir: 'zhixue', id: 'zhixue', name: '智学网',
      own: { host: 'www.zhixue.com', path: '/' },
      near: [{ label: '近似域名 zhixue.cn', form: { host: 'zhixue.cn', path: '/' } }] },
    { dir: 'qitian', id: 'qitian', name: '七天网络',
      own: { host: 'yue.7net.cc', path: '/' },
      near: [{ label: '近似域名 7net.cn', form: { host: '7net.cn', path: '/' } },
             { label: '串台对：yj5.7net.cc 归 qitian-new', form: { host: 'yj5.7net.cc', path: '/' } }] },
    { dir: 'qitian-new', id: 'qitian-new', name: '七天网络(新UI)',
      own: { host: 'yj5.7net.cc', path: '/' },
      near: [{ label: '近似域名 yj5.7net.com（qitian 显式让位 yj5.）', form: { host: 'yj5.7net.com', path: '/' } }] },
    { dir: 'haofenshu', id: 'haofenshu', name: '好分数',
      own: { host: 'yue.haofenshu.com', path: '/minions/paper/1' },
      near: [{ label: '域名对但路径缺 /minions/', form: { host: 'yue.haofenshu.com', path: '/other/' } },
             { label: '近似域名 haofenshu.net', form: { host: 'yue.haofenshu.net', path: '/minions/paper/1' } }] },
    { dir: 'wuyue', id: 'wuyue', name: '五岳阅卷',
      own: { host: 'www.wylkyj.com', path: '/' },
      near: [{ label: '近似域名 wylkyj.net', form: { host: 'wylkyj.net', path: '/' } }] },
    { dir: 'hanhan', id: 'hanhan', name: '华翰云',
      own: { host: 'www.yunyuejuan.net', path: '/' },
      near: [{ label: '近似域名 yunyuejuan.org', form: { host: 'yunyuejuan.org', path: '/' } }] },
    { dir: 'guangda', id: 'guangda', name: '光大阅卷',
      own: { host: 'pj.yixx.cn', path: '/' },
      near: [{ label: '近似域名 yixx.cn', form: { host: 'yixx.cn', path: '/' } },
             { label: '串台对：gz2.yixx.cn 归 guangda-2', form: { host: 'gz2.yixx.cn', path: '/', dom: {} } }] },
    { dir: 'guangda-2', id: 'guangda-2', name: '光大阅卷',
      // X02 修（R4 ≥2 特征线）：LI.f-csp 须叠加答题卡 canvas（#0 tainted 排除）或 .dfBox .scores li 给分容器
      own: { host: 'gz2.yixx.cn', path: '/', hash: '#/painter', dom: { 'LI.f-csp': 1, 'canvas:not([id="0"])': 1 } },
      near: [{ label: '缺 LI.f-csp 特征不得注册（canvas 单特征）', form: { host: 'gz2.yixx.cn', path: '/', hash: '#/painter', dom: { 'canvas:not([id="0"])': 1 } } },
             { label: '单类名 LI.f-csp 不得注册（X02 修：≥2 特征线）', form: { host: 'gz2.yixx.cn', path: '/', hash: '#/painter', dom: { 'LI.f-csp': 1 } } },
             { label: '串台对：pj.yixx.cn 归 guangda（显式排除，双特征齐备也不认）', form: { host: 'pj.yixx.cn', path: '/', dom: { 'LI.f-csp': 1, 'canvas:not([id="0"])': 1 } } }] },
    { dir: 'yunyuejuan', id: 'yunyuejuan', name: '云阅卷',
      // 附 A.4 修复后：/Marking/ 路径 + 独立提交按钮 + 小题表格三锚（裸 /Marking/ 判定已废除）
      own: { host: '10.1.1.8', path: '/Marking/NormalReadPaper', dom: { 'button.btn-standard-pri.phr15': 1, 'button.btn-standard-pri': 1, 'tbody.xtlist': 1 } },
      near: [{ label: '路径缺 /Marking/ 即不注册（DOM 三锚齐备也不认）', form: { host: '10.1.1.8', path: '/Other/', dom: { 'button.btn-standard-pri.phr15': 1, 'button.btn-standard-pri': 1, 'tbody.xtlist': 1 } } },
             { label: '路径含 /Marking/ 但缺 DOM 三锚不注册（附 A.4 废除裸路径判定）', form: { host: '10.1.1.8', path: '/Marking/TaskIndex', dom: {} } }] },
    { dir: 'huahanyun', id: null, name: '云阅卷(华翰云)',
      // X05 收紧裁决后：宿主白名单（*.lcedu.net.cn）+ 精确路由 #/marking/grading(\?|$) + DOM 三特征，三闸全必要
      own: { host: 'yj.lcedu.net.cn', path: '/', hash: '#/marking/grading?questionId=1', dom: { '#compuinput': 1, 'button.submitscorebtn': 1 } },
      near: [{ label: '近似域名 lcedu.net（缺 .cn）不得注册（白名单域闸，三特征齐备也不认）', form: { host: 'yj.lcedu.net', path: '/', hash: '#/marking/grading', dom: { '#compuinput': 1, 'button.submitscorebtn': 1 } } },
             { label: '白名单域内缺给分按钮不注册（DOM 闸，三特征缺一不可）', form: { host: 'yj.lcedu.net.cn', path: '/', hash: '#/marking/grading', dom: { '#compuinput': 1 } } },
             { label: '陌生宿主三特征齐备不注册（X05 收紧：无宿主兜底已删，改名部署需加白名单）', form: { host: 'rename.example', path: '/', hash: '#/marking/grading?x=1', dom: { '#compuinput': 1, 'button.submitscorebtn': 1 } } }] },
    { dir: 'huahanyun', id: null, name: '温州云阅卷',
      own: { host: 'yuejuan.wzedu.cn', path: '/static-v2/exam/index.html', hash: '#/marking/grading?questionId=1',
          dom: { '.redbiginput input.el-input__inner[placeholder="请给分"]': 1, 'button.submitscorebtn': 1 } },
      near: [
          { label: '温州域名后缀边界', form: { host: 'yuejuan.wzedu.cn.example.com', hash: '#/marking/grading', dom: { 'input#compuinput': 1, 'button.submitscorebtn': 1 } } },
          { label: '温州同站其他子域', form: { host: 'other.wzedu.cn', hash: '#/marking/grading', dom: { 'input#compuinput': 1, 'button.submitscorebtn': 1 } } },
          { label: '温州任务列表', form: { host: 'yuejuan.wzedu.cn', hash: '#/marking/gradingList/list', dom: { 'input#compuinput': 1, 'button.submitscorebtn': 1 } } },
          { label: '温州步长控件', form: { host: 'yuejuan.wzedu.cn', hash: '#/marking/grading', dom: { 'input[type="number"]': 1, 'button.submitscorebtn': 1 } } },
      ] },
    { dir: 'xinjiaoyu', id: 'xinjiaoyu', name: '新教育',
      own: { host: 'www.xinjiaoyu.com', path: '/' },
      near: [{ label: '近似域名 xinjiaoyu.cn', form: { host: 'xinjiaoyu.cn', path: '/' } }] },
    { dir: 'xinkao', id: 'xinkao', name: '鑫考网上阅卷',
      own: { host: '10.1.1.9', path: '/Marking/DisPlay', dom: { 'img.teaimg': 1, '#fenshu0': 1 } },
      near: [{ label: '路径缺 /Marking/DisPlay 且 DOM 不全（只有图）', form: { host: '10.1.1.9', path: '/Other/', dom: { 'img.teaimg': 1 } } },
             { label: 'DOM 兜底缺满分锚（只有 #fenshu0）不注册', form: { host: '10.1.1.9', path: '/', dom: { '#fenshu0': 1 } } },
             { label: '兄弟锚防串台：input.fenshu[fen]（xinkao-2 专有）不得命中 xinkao（附 A.1 排他）', form: { host: '10.1.1.9', path: '/', dom: { 'img.teaimg': 1, 'input.fenshu[fen]': 1 } } }] },
    { dir: 'xinkao-2', id: 'xinkao-2', name: '鑫考(内网)',
      own: { host: '10.1.1.10', path: '/biluo/display.jsp', dom: { 'img.teaimg': 1, 'input.fenshu': 1 } },
      near: [{ label: '路径缺 /biluo/display 且 DOM 不全（只有 input.fenshu）', form: { host: '10.1.1.10', path: '/biluo/other', dom: { 'input.fenshu': 1 } } },
             { label: '兄弟签名防串台：xinkao 的 DOM（img.teaimg+input.fenshu[max]）不得命中', form: { host: '10.1.1.10', path: '/', dom: { 'img.teaimg': 1, 'input.fenshu[max]': 1 } } }] },
    { dir: 'xinkao-campus', id: 'xinkao-campus', name: '鑫考校园',
      own: { host: '10.1.1.11', path: '/Marking/NormalReadPaper', dom: {} },
      near: [{ label: '路径缺 /Marking/NormalReadPaper 且 DOM 不全', form: { host: '10.1.1.11', path: '/Marking/Other', dom: { 'img.teaimg': 1 } } },
             { label: '兄弟签名防串台：xinkao 的 DOM 不得命中', form: { host: '10.1.1.11', path: '/', dom: { 'img.teaimg': 1, 'input.fenshu[max]': 1 } } }] },
    { dir: 'runjian', id: 'runjian', name: '润建学情',
      own: { host: 'aisusheng.runjian.com', path: '/read-paper/1' },
      near: [{ label: '近似域名 runjian.com', form: { host: 'runjian.com', path: '/' } },
             { label: 'rjedu.runjian.com 子域不注册（shouldInitialize 只认 aisusheng）', form: { host: 'rjedu.runjian.com', path: '/' } }] },
    { dir: 'xueba54', id: 'xueba54', name: '54学霸',
      own: { host: 'www.54xueba.cn', path: '/' },
      near: [{ label: '近似域名 54xueba.com', form: { host: '54xueba.com', path: '/' } }] },
    { dir: 'jiukexing', id: 'jiukexing', name: '九科星',
      own: { host: 'marking.jkxjxw.com', path: '/marking' },
      near: [{ label: '近似域名 jkxjxw.com', form: { host: 'jkxjxw.com', path: '/' } },
             { label: '串台对：jxp.jkxjxw.com 归九科星(作业)', form: { host: 'jxp.jkxjxw.com', path: '/' } }] },
    { dir: 'huiyuejuan', id: 'huiyuejuan', name: '慧阅卷',
      own: { host: 'www.17yuejuan.cn', path: '/' },
      near: [{ label: '近似域名 yuejuan.cn（缺 17 前缀）', form: { host: 'yuejuan.cn', path: '/' } }] },
    { dir: 'lehua', id: 'lehua', name: '乐华阅卷',
      own: { host: 'main.lhsvr.cn', path: '/' },
      near: [{ label: '近似域名 lhsvr.cn（缺 main. 前缀）', form: { host: 'lhsvr.cn', path: '/' } }] },
    { dir: 'huixuexing', id: 'huixuexing', name: '慧学星',
      own: { host: 'www.hxxai.com', path: '/' },
      near: [{ label: '近似域名 hxxai.com（缺 www. 前缀）', form: { host: 'hxxai.com', path: '/' } }] },
    { dir: 'yuejiaoxiangyun', id: 'yuejiaoxiangyun', name: '粤教翔云智慧测评',
      own: { host: 'rrtcp.gdedu.gov.cn', path: '/' },
      near: [{ label: '近似域名 gdedu.gov.cn（缺 rrtcp. 前缀）', form: { host: 'gdedu.gov.cn', path: '/' } }] },
    { dir: 'haofenshuyize', id: 'haofenshuyize', name: '云阅卷(好分数)',
      own: { host: 'yue.haofenshuyize.com', path: '/' },
      near: [{ label: '串台对：yue.haofenshu.com 归好分数', form: { host: 'yue.haofenshu.com', path: '/' } }] },
    { dir: 'keewing', id: 'keewing', name: '科耘阅卷',
      own: { host: 'kaoshi.keewing.com', path: '/' },
      near: [{ label: '近似域名 keewing.com（缺 kaoshi. 前缀）', form: { host: 'keewing.com', path: '/' } }] },
    { dir: 'wuyuetong', id: 'wuyuetong', name: '威科姆阅卷',
      own: { host: 'wyna.onlyets.com', path: '/' },
      near: [{ label: '近似域名 onlyets.com', form: { host: 'onlyets.com', path: '/' } },
             { label: '串台对：ruiya.onlyets.com 归睿芽（精确租户匹配）', form: { host: 'ruiya.onlyets.com', path: '/' } }] },
    { dir: 'c30', id: 'c30', name: 'C30教育云',
      own: { host: 'zy.iclass30.com', path: '/' },
      near: [{ label: '近似域名 iclass30.com（缺 zy. 前缀）', form: { host: 'iclass30.com', path: '/' } }] },
    { dir: 'ameqp', id: 'ameqp', name: 'AMEQP网上评卷',
      own: { host: '10.1.1.12', path: '/AMEQP/Webroot/mar/t1', dom: { '#Mark_main': 1, 'img.ansImg': 1,
          'input.mark_tbx[maxsco]': 1, 'input#btn_submit.mark_btn': 1, '#queSco_all': 1 } },
      near: [{ label: '路径尾部缺 / 不算命中', form: { host: '10.1.1.12', path: '/AMEQP/Webroot/mar', dom: {} } },
             { label: 'AMEQP 路径就绪前等待完整页面特征', form: { host: '10.1.1.12', path: '/AMEQP/Webroot/mar/mar_mark.aspx' } },
             { label: 'DOM 五特征缺一不注册（4/5）', form: { host: '10.1.1.12', path: '/x', dom: { '#Mark_main': 1, 'img.ansImg': 1, 'input.mark_tbx[maxsco]': 1, 'input#btn_submit.mark_btn': 1 } } }] },
    { dir: 'haoyuejuan', id: 'haoyuejuan', name: '阅小二',
      own: { host: 'www.haoyuejuan.com', path: '/' },
      near: [{ label: '串台对：yuejuan.com 归正确阅卷', form: { host: 'www.yuejuan.com', path: '/' } }] },
    { dir: 'haiyun', id: 'haiyun', name: '海云智评',
      own: { host: 'www.kaow.cn', path: '/' },
      near: [{ label: '近似域名 kaow.com', form: { host: 'kaow.com', path: '/' } }] },
    { dir: 'jiuwuyouping', id: 'jiuwuyouping', name: '九五优评',
      own: { host: 'www.timesphoenix.com', path: '/' },
      near: [{ label: '近似域名 timesphoenix.cn', form: { host: 'timesphoenix.cn', path: '/' } }] },
    { dir: 'sipd', id: 'sipd', name: '江西上进教育服务云',
      own: { host: 'www.sipd.cn', path: '/' },
      near: [{ label: '近似域名 sipd.com', form: { host: 'sipd.com', path: '/' } }] },
    { dir: 'nhcisc', id: 'nhcisc', name: '南昊AI教学提分',
      own: { host: 'www.nhcisc.com', path: '/' },
      near: [{ label: '近似域名 nhcisc.cn', form: { host: 'nhcisc.cn', path: '/' } }] },
    { dir: 'kuyuu', id: 'kuyuu', name: '酷鱼网',
      own: { host: 'www.kuyuu.cn', path: '/' },
      near: [{ label: '近似域名 kuyuu.com', form: { host: 'kuyuu.com', path: '/' } }] },
    { dir: 'ajia', id: 'ajia', name: 'A佳教育',
      own: { host: 'y.ajia.cn', path: '/' },
      near: [{ label: '近似域名 ajia.cn（缺 y. 前缀）', form: { host: 'ajia.cn', path: '/' } }] },
    { dir: 'kzedu', id: 'kzedu', name: '云阅卷(开州)',
      own: { host: 'yyj.kzedu.cn', path: '/' },
      near: [{ label: '近似域名 kzedu.cn（缺 yyj. 前缀）', form: { host: 'kzedu.cn', path: '/' } }] },
    { dir: 'yuejuan', id: 'yuejuan', name: '正确阅卷',
      own: { host: 'www.yuejuan.com', path: '/' },
      near: [{ label: '串台对：yuejuan51.com 归睿芽（恒佳租户）', form: { host: 'www.yuejuan51.com', path: '/' } }] },
    { dir: 'jiukexing-homework', id: 'jiukexing-homework', name: '九科星(作业)',
      own: { host: 'jxp.jkxjxw.com', path: '/' },
      near: [{ label: '串台对：marking.jkxjxw.com 归九科星', form: { host: 'marking.jkxjxw.com', path: '/' } }] },
    { dir: 'jingdouyun', id: 'jingdouyun', name: '精斗云(大数据精准教学)',
      own: { host: 'exam.wxy100.com', path: '/' },
      near: [{ label: '近似域名 wxy100.com（缺 exam. 前缀）', form: { host: 'wxy100.com', path: '/' } }] },
    { dir: 'xfkj', id: 'xfkj', name: '小帆智能阅卷',
      own: { host: 'www.xfkj.cc', path: '/' },
      near: [{ label: '近似域名 xfkj.com', form: { host: 'xfkj.com', path: '/' } }] },
    { dir: 'ruiya', id: 'ruiya', name: '睿芽阅卷',
      own: { host: 'ruiya.onlyets.com', path: '/mark/v1/view/1' },
      near: [{ label: '近似域名 xruiya.onlyets.com（精确租户不得吞）', form: { host: 'xruiya.onlyets.com', path: '/' } },
             { label: '串台对：wyna.onlyets.com 归威科姆', form: { host: 'wyna.onlyets.com', path: '/' } }] },
    { dir: 'dongni', id: 'dongni', name: '懂你系统',
      own: { host: 'www.dongni100.com', path: '/v2/exam/p1' },
      near: [{ label: '裸域 dongni100.com 不算 www 精确匹配', form: { host: 'dongni100.com', path: '/v2/exam/p1' } },
             { label: '路径缺 /v2/exam/ 不注册', form: { host: 'www.dongni100.com', path: '/other/' } }] },
    { dir: 'xiaoxianai', id: 'xiaoxianai', name: '小闲 AI 网上阅卷',
      own: { host: 'ls.xiaoxianai.cn', path: '/webPaper' },
      near: [{ label: '近似域名', form: { host: 'ls.xiaoxianai.cn.example.com', path: '/webPaper' } },
             { label: '登录页', form: { host: 'ls.xiaoxianai.cn', path: '/' } },
             { label: '近似路径', form: { host: 'ls.xiaoxianai.cn', path: '/webPapers' } }] },
    { dir: 'yuandingbang', id: 'yuandingbang', name: '园丁邦云阅卷',
      own: { host: 'yuejuan.yuandingbang.cn', path: '/web/main.jsp' },
      near: [{ label: '近似域名', form: { host: 'yuejuan.yuandingbang.cn.example.com', path: '/web/main.jsp' } },
             { label: '登录页', form: { host: 'yuejuan.yuandingbang.cn', path: '/' } }] },
    { dir: 'xkw', id: 'xkw', name: '学科网e卷通',
      own: { host: 'ejt.xkw.com', path: '/' },
      near: [{ label: '近似域名 xkw.com', form: { host: 'xkw.com', path: '/' } },
             { label: '近似域名 ejt.xkw.com.cn（子域规则不得吞后缀域）', form: { host: 'ejt.xkw.com.cn', path: '/' } }] },
];

// 竞争矩阵中走「已知竞争」而非严格唯一命中断言的目录（见 bundle-competition.test.js KNOWN 块）
const FAMILY_COMPETITION = ['yunyuejuan', 'xinkao', 'xinkao-2', 'xinkao-campus', 'haoyuejuan'];

module.exports = {
    ROOT, AD_DIR, KNOWN_UNBUNDLED, ADAPTERS, FAMILY_COMPETITION,
    readSrc, applyMutations, bundleOrder, allAdapterDirs, loadOrder,
    makeStub, loadAdapters, loadOne,
};
