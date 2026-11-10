// ========== 弱信号/半成功语义回归护栏（#289 二轮审计 C 层缺口） ==========
// 这些文本级护栏防"修复被回退无告警"：
//   1. 「'0' 当输入框清空」判空谓词不得回退（#285 修复 15 处，0 分卷必现串卷）
//   2. fillScores 半成功语义（successCount > 0）不得回流到已收口的适配器
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function listAdapters() {
    const dir = path.join(__dirname, '..', 'src', 'adapters');
    const out = [];
    for (const name of fs.readdirSync(dir)) {
        const f = path.join(dir, name, 'adapter.js');
        if (fs.existsSync(f)) out.push({ name, src: fs.readFileSync(f, 'utf8') });
    }
    return out;
}

const adapters = listAdapters();

// ---------- 检测器（W5/W6 变形抗性：改名/变形即穿透的正则升级为可复用检测函数）----------

// W5：「0 当输入框清空」判空谓词回退检测。
// 变形抗性：不限定变量名（val/it/el.value 均抓）、==/=== 均抓、String(x)/el.value 的括号形态均抓；
// 仍以清空语境窗口限定防误报。
function findZeroOffenders(name, src) {
    const offenders = [];
    const re = /(?:\w+|\))\s*==+\s*['"]0['"]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const ctx = src.slice(Math.max(0, m.index - 300), m.index + 300);
        if (/clear|empty|清空|翻卷|换卷/i.test(ctx)) {
            offenders.push(name + ' @' + m.index);
        }
    }
    return offenders;
}

// W6：fillScores 半成功语义回流检测。
// 变形抗性：不限定 successCount 名字（return filled > 0 / okCount > 0 均抓）、扫描全部 fillScores 出现处。
function findHalfSuccessOffenders(name, src) {
    const offenders = [];
    let i;
    while ((i = src.indexOf('fillScores(', i === -1 ? 0 : i + 1)) !== -1) {
        const body = src.slice(i, i + 2500);
        if (/return\s+\w+\s*>\s*0\b/.test(body)) offenders.push(name + ' @' + i);
    }
    return offenders;
}

test("「'0' 当输入框清空」判空谓词不得回退（#285）", () => {
    const offenders = adapters.flatMap(a => findZeroOffenders(a.name, a.src));
    assert.deepStrictEqual(offenders, [], '发现「0 当清空」回退: ' + offenders.join(', '));
});

test("已收口适配器的 fillScores 不得回流半成功语义（全量适配器，#299 扩面）", () => {
    const offenders = adapters.flatMap(a => findHalfSuccessOffenders(a.name, a.src));
    assert.deepStrictEqual(offenders, [], '半成功语义回流: ' + offenders.join(', '));
});

// 变异可红实证：检测器必须抓得住变形（否则护栏是纸老虎）
test('检测器自检 W5：变形「0 判空」（任意变量/括号形态）可检出', () => {
    const sample = "function snap(x){ if (String(x) === '0' && needClear) { clearBox(); } const v = val == '0' ? 1 : 2; }";
    assert.ok(findZeroOffenders('fake', sample).length >= 2,
        'String(x)===\'0\' 与 val==\'0\' 两种变形都必须被检出');
});

test('检测器自检 W6：变形半成功语义（改名 return okCount > 0）可检出', () => {
    const sample = 'function fillScores(s){ const okCount = 1; if (!s) return false; return okCount > 0; }';
    assert.ok(findHalfSuccessOffenders('fake', sample).length >= 1,
        'successCount 改名为 okCount 后仍必须被检出');
    assert.deepStrictEqual(findHalfSuccessOffenders('fake', 'function fillScores(s){ return s.length; }'), [],
        '全或无合法形态不得误报');
});

// ========== strict-a.md 附录 D.5 注册层文本护栏（防回退，冻结现存存量） ==========

// D.5-1：shouldInitialize 域名判定禁**新增** hostname.includes( / h.includes( 子串匹配
// （现存存量冻结为上限；新代码应使用精确 hostMatches 形态——includes 子串误伤矩阵见 strict-a.md 附 B）
// 计数=文件内该字面量出现次数（shouldInitialize 判定均在文件顶部，全文件计数是有效代理）
test('D.5-1 域名子串匹配只减不增：hostname.includes(/h.includes( 存量冻结（新代码禁用）', () => {
    // 冻结上限：2026-11 现存各适配器的 includes 判定计数（只允许下降，不允许新增）
    const FROZEN_MAX = {
        'ameqp': 0, 'ajia': 1, 'c30': 1, 'dongni': 0, 'guangda': 1, 'guangda-2': 1,
        'haiyun': 1, 'hanhan': 1, 'haofenshu': 1, 'haofenshuyize': 1, 'haoyuejuan': 1,
        'huahanyun': 1, 'huixuexing': 1, 'huiyuejuan': 2, 'jingdouyun': 1, 'jiukexing': 1,
        'jiukexing-homework': 1, 'jiuwuyouping': 1, 'keewing': 1, 'kuyuu': 1, 'kzedu': 1,
        'lehua': 1, 'nhcisc': 1, 'qitian': 4, 'qitian-new': 2, 'ruiya': 1, 'runjian': 3,
        'sipd': 1, 'wuyue': 1, 'wuyuetong': 1, 'xfkj': 1, 'xinjiaoyu': 2, 'xinkao': 0,
        'xinkao-2': 0, 'xinkao-campus': 0, 'xkw': 0, 'xueba54': 1, 'yuejiaoxiangyun': 1,
        'yuejuan': 1, 'yunyuejuan': 0, 'zhixue': 1,
    };
    const offenders = [];
    for (const a of adapters) {
        const count = (a.src.match(/\b(?:hostname|h)\b[^=;<>]*?\.includes\(/g) || []).length;
        const max = FROZEN_MAX[a.name] ?? 0;
        if (count > max) offenders.push(`${a.name}: ${count} > 冻结上限 ${max}`);
        if (!(a.name in FROZEN_MAX)) offenders.push(`${a.name}: 新适配器未登记子串匹配冻结表`);
    }
    assert.deepStrictEqual(offenders, [], '域名子串匹配新增（应改精确匹配）: ' + offenders.join('; '));
});

// D.5-2：注册尾必须被 shouldInitialize() 守卫包裹（#324 无守卫注册回退直接红）。
// 兼容两种守卫姿势：`if (X.shouldInitialize()) { 赋值 }` 与 strict-a 附 A.0 先到先得
// `if (!X.shouldInitialize()) return; … 赋值`（判定窗 800 字符覆盖冲突告警块）
test('D.5-2 __AI_MARKER_ADAPTER__ 赋值必须位于 shouldInitialize() 守卫内（#324 防回退）', () => {
    const offenders = [];
    for (const a of adapters) {
        const re = /window\.__AI_MARKER_ADAPTER__\s*=/g;
        let m;
        while ((m = re.exec(a.src)) !== null) {
            const before = a.src.slice(Math.max(0, m.index - 800), m.index);
            if (!/if\s*\([^)]*shouldInitialize\(\)/.test(before)) {
                offenders.push(a.name + ' @' + m.index);
            }
        }
    }
    assert.deepStrictEqual(offenders, [], '无守卫注册（会劫持所有平台页面）: ' + offenders.join(', '));
});

// D.5-3（暂缓，strict-a.md 标注"修 R1 后"）：多命中场景应有 console.warn 告警路径。
// 待 verifier 落地 R1 家族锚修复后补此断言（当前多命中无告警是已知缺陷）。
