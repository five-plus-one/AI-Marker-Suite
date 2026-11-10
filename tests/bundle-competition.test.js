// ========== #324 P0 教训：多适配器同 bundle 竞争矩阵 ==========
// 历史事故：huahanyun 无条件注册且在 bundle 末位，劫持所有平台页面（好分数等识别错平台）。
// 本文件在**单 VM 全量加载**（同 bundle 语义，按 build.js adapterModules 顺序）下断言：
//   1. 任意平台形态 → 唯一命中正确适配器（注册写计数=1，last-wins 不得劫持）
//   2. 无命中形态 → 注册槽为空（writes=0）
//   3. last-wins 劫持 / 重复注册 / 延迟注册覆盖 → 必红（含变异自检证明红度）
// 已知竞争缺陷（家族共享 DOM 签名、子串域名泄漏）单独固化在 KNOWN 块，src 收紧后翻转。
const test = require('node:test');
const assert = require('node:assert');
const M = require('./_adapter-matrix.js');

// near 形态在 bundle 级的期望：被兄弟适配器正确接管（串台对）；未列出的必须是空槽。
// 家族互串（原 KNOWN-2/3/5/6 源）已由 strict-a 附 A 修复：共享 DOM 不再互认，相关 near 形态恢复空槽。
const NEAR_BUNDLE_OWNER = {
    '串台对：yj5.7net.cc 归 qitian-new': 'qitian-new',
    '串台对：pj.yixx.cn 归 guangda（显式排除）': 'guangda',
    '串台对：jxp.jkxjxw.com 归九科星(作业)': 'jiukexing-homework',
    '串台对：ruiya.onlyets.com 归睿芽（精确租户匹配）': 'ruiya',
    '串台对：yuejuan.com 归正确阅卷': 'yuejuan',
    '串台对：yuejuan51.com 归睿芽（恒佳租户）': 'ruiya',
    '串台对：marking.jkxjxw.com 归九科星': 'jiukexing',
    '串台对：wyna.onlyets.com 归威科姆': 'wuyuetong',
    // 附 A 专有锚后：兄弟 DOM 形态 = 兄弟自己的"改名部署"兜底（专有锚命中，正当认领）
    '兄弟锚防串台：input.fenshu[fen]（xinkao-2 专有）不得命中 xinkao（附 A.1 排他）': 'xinkao-2',
    '兄弟签名防串台：xinkao 的 DOM（img.teaimg+input.fenshu[max]）不得命中': 'xinkao',
    '兄弟签名防串台：xinkao 的 DOM 不得命中': 'xinkao',
};

function run(form, opts) {
    const sb = M.makeStub(form);
    return M.loadAdapters(sb, opts);
}

function assertIdentity(winner, entry, ctx) {
    if (entry.id) {
        assert.strictEqual(winner && winner.id, entry.id, ctx + '：应由 ' + entry.id + ' 接管，实际 ' + JSON.stringify(winner && { id: winner.id, name: winner.name }));
    } else {
        assert.strictEqual(winner && winner.name, entry.name, ctx + '：应由 ' + entry.name + ' 接管，实际 ' + JSON.stringify(winner && { id: winner.id, name: winner.name }));
    }
}

// ---------- 0. 矩阵自身的完整性（防覆盖静默过期） ----------
test('矩阵完整性：每个适配器目录都已登记竞争矩阵形态', () => {
    const known = new Set(M.ADAPTERS.map(a => a.dir));
    const missing = M.allAdapterDirs().filter(d => !known.has(d));
    assert.deepStrictEqual(missing, [], '新适配器必须登记 own/near 平台形态进 _adapter-matrix.js: ' + missing.join(', '));
});

test('矩阵完整性：build.js adapterModules 每一项都有矩阵形态', () => {
    const known = new Set(M.ADAPTERS.map(a => a.dir));
    const missing = M.bundleOrder().map(p => p.split('/')[1]).filter(d => !known.has(d));
    assert.deepStrictEqual(missing, [], 'build.js 收录但矩阵未登记: ' + missing.join(', '));
});

test('矩阵完整性：未入 bundle 的适配器必须显式登记（防"目录存在但永不打包"）', () => {
    const bundled = new Set(M.bundleOrder().map(p => p.split('/')[1]));
    const unbundled = M.allAdapterDirs().filter(d => !bundled.has(d));
    const unregistered = unbundled.filter(d => !M.KNOWN_UNBUNDLED.includes(d));
    assert.deepStrictEqual(unregistered, [], '未入 build.js 且未登记 KNOWN_UNBUNDLED: ' + unregistered.join(', '));
});

test('bundle 全量加载零错误（防桩盲区掩盖适配器求值失败）', () => {
    const { errors } = run({ host: 'example.com', path: '/' });
    assert.deepStrictEqual(errors, [], '适配器加载报错会掩盖未注册/劫持问题: ' + errors.join(' | '));
});

// ---------- 1. 竞争矩阵：自家形态唯一命中（先到先得 + 专有锚，任何连带注册/劫持必红） ----------
for (const a of M.ADAPTERS) {
    test(`竞争矩阵：${a.name}（${a.dir}）自家形态唯一命中`, () => {
        const r = run(a.own);
        assert.strictEqual(r.errors.length, 0, '加载错误: ' + r.errors.join(' | '));
        assertIdentity(r.winner, a, a.dir + ' 自家形态');
        assert.strictEqual(r.writes.length, 1,
            '必须唯一注册（重复注册/劫持）: ' + JSON.stringify(r.writes));
    });
}

test('竞争矩阵：ruiya 恒佳租户形态唯一命中且显示名切换', () => {
    const r = run({ host: 'www.yuejuan51.com', path: '/mark/v1/view/1' });
    assert.strictEqual(r.writes.length, 1, '必须唯一注册: ' + JSON.stringify(r.writes));
    assert.strictEqual(r.winner && r.winner.id, 'ruiya');
    assert.strictEqual(r.winner.name, '恒佳阅卷', '租户显示名应为恒佳阅卷');
});

// ---------- 2. 空槽矩阵：无命中 = 注册槽为空 / 串台对正确分派 ----------
const allLabels = new Set(M.ADAPTERS.flatMap(a => a.near.map(n => n.label)));
for (const [label, owner] of Object.entries(NEAR_BUNDLE_OWNER)) {
    if (!allLabels.has(label)) throw new Error('NEAR_BUNDLE_OWNER 引用了不存在的形态标签: ' + label);
}
for (const a of M.ADAPTERS) {
    for (const n of a.near) {
        const owner = NEAR_BUNDLE_OWNER[n.label];
        test(`近似形态：${a.dir} — ${n.label}`, () => {
            const r = run(n.form);
            assert.strictEqual(r.errors.length, 0, '加载错误: ' + r.errors.join(' | '));
            if (owner) {
                assert.strictEqual(r.winner && r.winner.id, owner, '应由串台对适配器接管: ' + JSON.stringify(r.writes));
            } else {
                assert.strictEqual(r.winner, null, '无命中形态必须是空槽，实际: ' + JSON.stringify(r.writes));
                assert.strictEqual(r.writes.length, 0, '空槽不得有任何注册写');
            }
        });
    }
}

// ---------- 3. DOM 签名防串台（bundle 级） ----------
test('DOM 签名：huahanyun 陌生宿主三特征齐备 → 空槽（X05 收紧：无宿主兜底已删，改名部署需加宿主白名单）', () => {
    // X05 产品裁决（#324 铁律：宁可保守不劫持）：非白名单宿主不得认领，即使路由+DOM 全对
    const r = run({ host: 'rename.example', path: '/', hash: '#/marking/grading', dom: { '#compuinput': 1, 'button.submitscorebtn': 1 } });
    assert.strictEqual(r.winner, null);
    assert.strictEqual(r.writes.length, 0);
});

test('DOM 签名：huahanyun 缺给分按钮 → 空槽（白名单域内 DOM 闸）', () => {
    const r = run({ host: 'yj.lcedu.net.cn', path: '/', hash: '#/marking/grading', dom: { '#compuinput': 1 } });
    assert.strictEqual(r.winner, null);
    assert.strictEqual(r.writes.length, 0);
});

test('DOM 签名：huahanyun 路由 hash 缺失 → 空槽（三特征缺一不可，白名单域内路由闸）', () => {
    const r = run({ host: 'yj.lcedu.net.cn', path: '/', hash: '#/other', dom: { '#compuinput': 1, 'button.submitscorebtn': 1 } });
    assert.strictEqual(r.winner, null);
    assert.strictEqual(r.writes.length, 0);
});

test('DOM 签名：ameqp 五特征完整 → 命中（改名部署）', () => {
    const r = run({ host: '10.1.1.12', path: '/x', dom: { '#Mark_main': 1, 'img.ansImg': 1, 'input.mark_tbx[maxsco]': 1, 'input#btn_submit.mark_btn': 1, '#queSco_all': 1 } });
    assert.strictEqual(r.writes.length, 1);
    assert.strictEqual(r.winner && r.winner.id, 'ameqp');
});

test('DOM 签名：ameqp 五缺一 → 空槽', () => {
    const r = run({ host: '10.1.1.12', path: '/x', dom: { '#Mark_main': 1, 'img.ansImg': 1, 'input.mark_tbx[maxsco]': 1, 'input#btn_submit.mark_btn': 1 } });
    assert.strictEqual(r.winner, null);
    assert.strictEqual(r.writes.length, 0);
});

test('DOM 签名：guangda-2 LI.f-csp 特征（任意部署域）→ 命中', () => {
    const r = run({ host: 'deploy.example', path: '/', dom: { 'LI.f-csp': 1 } });
    assert.strictEqual(r.writes.length, 1);
    assert.strictEqual(r.winner && r.winner.id, 'guangda-2');
});

test('DOM 签名：xinkao DOM 兜底（img.teaimg+input.fenshu[max] 专有锚，改名部署）→ 唯一命中', () => {
    const r = run({ host: 'rename2.example', path: '/', dom: { 'img.teaimg': 1, 'input.fenshu[max]': 1 } });
    assert.strictEqual(r.writes.length, 1);
    assert.strictEqual(r.winner && r.winner.id, 'xinkao');
});

test('DOM 签名：家族共享 class（img.teaimg+input.fenshu 无专有锚）不再互认 → 空槽', () => {
    const r = run({ host: 'rename4.example', path: '/', dom: { 'img.teaimg': 1, 'input.fenshu': 1 } });
    assert.strictEqual(r.winner, null, '共享 class 不得作为命中证据（附 A 专有锚原则）');
    assert.strictEqual(r.writes.length, 0);
});

test('DOM 签名：家族单特征不命中（img.teaimg 单独出现）→ 空槽', () => {
    const r = run({ host: 'rename3.example', path: '/', dom: { 'img.teaimg': 1 } });
    assert.strictEqual(r.winner, null);
    assert.strictEqual(r.writes.length, 0);
});

test('DOM 签名：家族单特征不命中（input.fenshu 单独出现）→ 空槽', () => {
    const r = run({ host: 'rename3.example', path: '/', dom: { 'input.fenshu': 1 } });
    assert.strictEqual(r.winner, null);
    assert.strictEqual(r.writes.length, 0);
});

// ---------- 4. 原「已知竞争缺陷」修复后严格回归 ----------
// 原 KNOWN-1..6/8（R1 家族互串 + R2 子串域名 + R3）已由 strict-a 附 A/附 B 修复落地
// （专有锚 + 精确域名 + 先到先得注册 + 冲突告警），此处翻转为严格唯一命中断言。
// 仅 KNOWN-7（guangda-2 即时注册无不覆盖守卫，R4 守卫不对称）未修，保持现状锁定。

test('回归 R2（原 KNOWN-1）：haoyuejuan.com 由 haoyuejuan 独家接管，yuejuan 不得子串吞域名', () => {
    const r = run({ host: 'www.haoyuejuan.com', path: '/' });
    assert.strictEqual(r.winner && r.winner.id, 'haoyuejuan', 'yuejuan 精确域匹配后不得吞 haoyuejuan.com');
    assert.strictEqual(r.writes.length, 1, '必须唯一注册: ' + JSON.stringify(r.writes));
});

test('回归 附 A.4（原 KNOWN-2）：yunyuejuan 自家形态三锚独家命中', () => {
    const r = run({ host: '10.1.1.8', path: '/Marking/NormalReadPaper', dom: { 'button.btn-standard-pri.phr15': 1, 'button.btn-standard-pri': 1, 'tbody.xtlist': 1 } });
    assert.strictEqual(r.winner && r.winner.id, 'yunyuejuan');
    assert.strictEqual(r.writes.length, 1, '家族互串已解，必须唯一注册: ' + JSON.stringify(r.writes));
});

test('回归 附 A.2（原 KNOWN-3）：xinkao-2 自家形态独家命中，campus 不得 DOM 兜底接管', () => {
    const r = run({ host: '10.1.1.10', path: '/biluo/display.jsp', dom: { 'img.teaimg': 1, 'input.fenshu': 1 } });
    assert.strictEqual(r.winner && r.winner.id, 'xinkao-2');
    assert.strictEqual(r.writes.length, 1, '必须唯一注册: ' + JSON.stringify(r.writes));
});

test('回归 附 A.0（原 KNOWN-4）：xinkao 自家形态唯一命中，yunyuejuan 不再连带注册', () => {
    const r = run({ host: '10.1.1.9', path: '/Marking/DisPlay', dom: { 'img.teaimg': 1, '#fenshu0': 1 } });
    assert.strictEqual(r.winner && r.winner.id, 'xinkao');
    assert.strictEqual(r.writes.length, 1, '必须唯一注册: ' + JSON.stringify(r.writes));
});

test('回归 附 A.1（原 KNOWN-5）：xinkao 真实 DOM（同框 id+class+max 锚）不再被 campus 劫持', () => {
    // 真实 xinkao 分数框：input#fenshu0.fenshu[max] —— 家族共享 class，满分锚 max 专有
    const e2 = {};
    const sb = M.makeStub({ host: '10.1.1.9', path: '/Marking/DisPlay', dom: { 'img.teaimg': 1 } });
    sb.__dom['#fenshu0'] = e2; sb.__dom['input.fenshu'] = e2; sb.__dom['input.fenshu[max]'] = e2;
    const r = M.loadAdapters(sb);
    assert.strictEqual(r.winner && r.winner.id, 'xinkao', '专有锚判别后不得被 xinkao-campus last-wins 劫持');
    assert.strictEqual(r.writes.length, 1, '必须唯一注册: ' + JSON.stringify(r.writes));
});

test('回归 附 A.3（原 KNOWN-6）：xinkao-campus 自家形态唯一命中，yunyuejuan 不再连带注册', () => {
    const r = run({ host: '10.1.1.11', path: '/Marking/NormalReadPaper', dom: {} });
    assert.strictEqual(r.winner && r.winner.id, 'xinkao-campus');
    assert.strictEqual(r.writes.length, 1, '必须唯一注册: ' + JSON.stringify(r.writes));
});

test('KNOWN-7 守卫不对称（未修，现状锁定）：guangda-2 即时注册无「不覆盖」守卫（延迟路径有 #297 F12 守卫）', () => {
    // 外平台页面加载时已含 LI.f-csp → guangda-2 即时注册覆盖 zhixue（R4 待修）
    const r = run({ host: 'www.zhixue.com', path: '/', dom: { 'LI.f-csp': 1 } });
    assert.strictEqual(r.winner && r.winner.id, 'guangda-2', '当前实际：即时注册劫持（待补 !window.__AI_MARKER_ADAPTER__ 守卫后翻转）');
    assert.strictEqual(r.writes.length, 2);
});

test('回归 R2（原 KNOWN-8）：yunyuejuan.com 形态域名空槽，yuejuan 精确匹配不得吞', () => {
    const r = run({ host: 'yunyuejuan.com', path: '/' });
    assert.strictEqual(r.winner, null, '精确域匹配后应为空槽');
    assert.strictEqual(r.writes.length, 0);
});

// ---------- 5. 延迟注册（guangda-2 MutationObserver 路径） ----------
test('延迟注册：加载时未命中、特征后现 → 补注册（writes=1）', () => {
    const sb = M.makeStub({ host: 'gz2.yixx.cn', path: '/', hash: '#/painter', dom: {} });
    const r = M.loadAdapters(sb);
    assert.strictEqual(r.winner, null, '初始应为空槽');
    assert.strictEqual(sb.__observers.length >= 1, true, '应有延迟注册观察器');
    sb.__dom['LI.f-csp'] = {};
    for (const o of sb.__observers) o.cb([]);
    assert.strictEqual(sb.__AI_MARKER_ADAPTER__ && sb.__AI_MARKER_ADAPTER__.id, 'guangda-2', '特征后现应补注册');
    assert.strictEqual(sb.__writes.length, 1);
});

test('延迟注册：已有其他适配器注册后特征才现 → 不得覆盖（#297 F12）', () => {
    const sb = M.makeStub({ host: 'www.zhixue.com', path: '/', dom: {} });
    const r = M.loadAdapters(sb);
    assert.strictEqual(r.winner && r.winner.id, 'zhixue');
    assert.strictEqual(sb.__writes.length, 1);
    sb.__dom['LI.f-csp'] = {};
    for (const o of sb.__observers) o.cb([]);
    assert.strictEqual(sb.__AI_MARKER_ADAPTER__.id, 'zhixue', '延迟注册不得覆盖既有注册');
    assert.strictEqual(sb.__writes.length, 1, '不得产生第二次注册写: ' + JSON.stringify(sb.__writes));
});

// ---------- 6. 变异自检（证明「这类问题必红」的红度通道） ----------
test('变异自检 M1：放宽 zhixue 守卫吞全平台 → 竞争矩阵必红（先到先得下早期适配器劫持可检出）', () => {
    // 先到先得语义下，劫持风险从"末位覆盖"移到"早期适配器乱认领+first-wins 锁定"——
    // 首位适配器守卫放宽即劫持：haofenshu 的页面被 zhixue 认领后 haofenshu 反被冲突守卫挡下
    const r = run({ host: 'yue.haofenshu.com', path: '/minions/paper/1' }, {
        mutations: [{ file: 'src/adapters/zhixue/adapter.js', find: "return window.location.hostname.includes('zhixue.com');", replace: 'return true;' }],
    });
    assert.strictEqual(r.winner && r.winner.id, 'zhixue', '劫持形态可检出（矩阵断言将红）');
    assert.notStrictEqual(r.winner && r.winner.id, 'haofenshu');
});

test('变异自检 M2：去掉 qitian 的 yj5. 让位 → 重复注册可检出（writes=2）', () => {
    const r = run({ host: 'yj5.7net.cc', path: '/' }, {
        mutations: [{ file: 'src/adapters/qitian/adapter.js', find: "if (h.includes('yj5.')) return false;", replace: 'if (false) return false;' }],
    });
    assert.strictEqual(r.writes.length, 2, '双注册可检出（唯一命中断言将红）: ' + JSON.stringify(r.writes));
});

test('变异自检 M3：去掉 guangda-2 延迟注册「不覆盖」守卫 → 覆盖劫持可检出', () => {
    const sb = M.makeStub({ host: 'www.zhixue.com', path: '/', dom: {} });
    M.loadAdapters(sb, {
        mutations: [{ file: 'src/adapters/guangda-2/adapter.js', find: 'if (Guangda2Adapter.shouldInitialize() && !window.__AI_MARKER_ADAPTER__) {', replace: 'if (Guangda2Adapter.shouldInitialize()) {' }],
    });
    sb.__dom['LI.f-csp'] = {};
    for (const o of sb.__observers) o.cb([]);
    assert.strictEqual(sb.__writes.length, 2, '延迟覆盖可检出（守卫断言将红）: ' + JSON.stringify(sb.__writes));
    assert.strictEqual(sb.__AI_MARKER_ADAPTER__.id, 'guangda-2');
});

// ---------- 7. 跨平台冒烟：注册对象的协议方法契约 ----------
const CONTRACT_REQUIRED = ['shouldInitialize', 'detectMarkingPage', 'gatherAnswerImages', 'getScoreInputs', 'submitGrade'];
for (const a of M.ADAPTERS) {
    test(`协议契约：${a.dir} 注册对象实现核心方法`, () => {
        const sb = M.makeStub(a.own);
        const r = M.loadOne(sb, a.dir);
        assert.strictEqual(r.errors.length, 0, '加载错误: ' + r.errors.join(' | '));
        assert.ok(r.winner, a.dir + ' 自家形态必须注册');
        for (const m of CONTRACT_REQUIRED) {
            assert.strictEqual(typeof r.winner[m], 'function', a.dir + ' 缺协议方法 ' + m);
        }
        assert.ok(typeof r.winner.fillScores === 'function' || typeof r.winner.fillScore === 'function',
            a.dir + ' 必须实现 fillScores 或 fillScore');
    });
}
