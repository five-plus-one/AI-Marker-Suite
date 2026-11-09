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

test("「'0' 当输入框清空」判空谓词不得回退（#285）", () => {
    const offenders = [];
    for (const a of adapters) {
        // 命中形如 value === '0' / value === "0" 出现在清空判定语境（== '' 附近或 cleared/empty 变量）
        const re = /(value\s*===\s*['"]0['"]|value\s*==\s*['"]0['"])/g;
        let m;
        while ((m = re.exec(a.src)) !== null) {
            const ctx = a.src.slice(Math.max(0, m.index - 200), m.index + 200);
            if (/clear|empty|清空|翻卷|换卷/i.test(ctx)) {
                offenders.push(a.name + ' @' + m.index);
            }
        }
    }
    assert.deepStrictEqual(offenders, [], '发现「0 当清空」回退: ' + offenders.join(', '));
});

test("已收口适配器的 fillScores 不得回流半成功语义（successCount > 0）", () => {
    // 两遍式全或无已收口：guangda、guangda-2、ameqp、qitian、qitian-new
    const sealed = ['guangda', 'guangda-2', 'ameqp', 'qitian', 'qitian-new', 'ruiya'];
    const offenders = [];
    for (const a of adapters) {
        if (!sealed.includes(a.name)) continue;
        const i = a.src.indexOf('fillScores(');
        if (i === -1) continue;
        const body = a.src.slice(i, i + 2500);
        if (/return successCount\s*>\s*0/.test(body)) offenders.push(a.name);
    }
    assert.deepStrictEqual(offenders, [], '半成功语义回流: ' + offenders.join(', '));
});
