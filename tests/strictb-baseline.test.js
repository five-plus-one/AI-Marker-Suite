// ========== strict-b 33 桩交叉校验（audit-sweep 桩基线 × _adapter-matrix harness）==========
// 来源：tmp/strictb-fixtures.json（audit-sweep strict-b 矩阵桩，snapshot 内嵌防 tmp 漂移）。
// 演进：桩基线生成于 R1/R2/R3 修复前（RED-hijack/falsepos/conditional/YELLOW-multi 分类）。
// strict-a 附 A/附 B 修复落地后（专有锚 + 精确域名 + 先到先得注册 + 冲突告警），
// 本文件转为**修复验收**：
//   - ok 桩       → 严格断言 winner===expect、写集恰为 hits（正确命中或正确空槽）
//   - FIXED 桩    → 修复转绿后翻为严格断言（原 RED/YELLOW，测试名留历史分类）
//   - PERSISTENT  → 未修项锁现状（X02 guangda-2 单类名误注册=R4）
//     修复落地后 PERSISTENT 桩必红 → 翻转为 expect 严格断言。
//     （X08 campus 路径前缀正则吞 NormalReadPaper2 已补尾锚修复 → 移入 FIXED；
//       X05 产品裁决=收紧：宿主白名单+精确路由+三特征、删无宿主兜底 → 移入 FIXED，
//       严格断言「陌生同形 SPA 不得被 huahanyun 认领」）
// 语义等价映射：桩 domKeys（选择器精确字符串命中即存在）≡ _adapter-matrix.js dom 键控；
// 注册写计数（writes）= 实际赋值次数。⚠️ 与 audit-sweep「命中集」口径差异：附 A.0 先到先得下
// 冲突认领不再写注册槽（console.error 告警后让位），故 X07 写集为 [hanhan] 而非认领集 [hanhan,huahanyun]。
// 对应关系：S15≡bundle-competition 回归附 A.1、S16≡回归附 A.2、S17≡回归附 A.3、S22≡回归 R2。
const test = require('node:test');
const assert = require('node:assert');
const M = require('./_adapter-matrix.js');

// huahanyun 无 id 字段，按显示名归一到目录名
function dirOf(winner) {
    if (!winner) return null;
    return winner.id || (winner.name === '云阅卷(华翰云)' ? 'huahanyun' : winner.name);
}

// 修复转绿桩（原 RED/黄 → 附 A/附 B 修复后必须严格命中 expect）
const FIXED = new Set(['S14', 'S15', 'S16', 'S17', 'S22', 'X03', 'X04', 'X05', 'X06', 'X07', 'X08']);
// 未修项：锁现状写集（修复后此表必红 → 移入 FIXED 并翻严格断言）
const PERSISTENT = {
    X02: ['guangda-2'],        // R4：LI.f-csp 单类名任意宿主误注册（guangda-2 未修）
};

const STUBS = [
    // ---- ok：正确命中 ----
    { id: 'S01', name: '智学网首页', host: 'www.zhixue.com', path: '/homepage', hash: '', dom: [], expect: 'zhixue', v: 'ok', hits: ['zhixue'] },
    { id: 'S02', name: '智学网阅卷页', host: 'www.zhixue.com', path: '/examPaper/marking', hash: '', dom: ['input.score'], expect: 'zhixue', v: 'ok', hits: ['zhixue'] },
    { id: 'S03', name: '七天网络(7net.cc)', host: 'e.7net.cc', path: '/default/work', hash: '', dom: ['#img_container img', 'input.fenshu'], expect: 'qitian', v: 'ok', hits: ['qitian'] },
    { id: 'S04', name: '七天网络 qt7.cn', host: 'www.qt7.cn', path: '/', hash: '', dom: ['#img_container img', 'input.fenshu'], expect: 'qitian', v: 'ok', hits: ['qitian'] },
    { id: 'S05', name: '七天新UI yj5', host: 'yj5.7net.cc', path: '/', hash: '', dom: ['.exam-img img', 'input.score-input'], expect: 'qitian-new', v: 'ok', hits: ['qitian-new'] },
    { id: 'S06', name: '好分数阅卷', host: 'yue.haofenshu.com', path: '/minions/task/1', hash: '', dom: [], expect: 'haofenshu', v: 'ok', hits: ['haofenshu'] },
    { id: 'S07', name: '好分数(非 minions 路径)', host: 'yue.haofenshu.com', path: '/home', hash: '', dom: ['input.score', 'button.submit', 'img.answer'], expect: null, v: 'ok', hits: [] },
    { id: 'S08', name: '好分数一测', host: 'www.haofenshuyize.com', path: '/', hash: '', dom: [], expect: 'haofenshuyize', v: 'ok', hits: ['haofenshuyize'] },
    { id: 'S09', name: '五岳阅卷', host: 'www.wylkyj.com', path: '/', hash: '', dom: [], expect: 'wuyue', v: 'ok', hits: ['wuyue'] },
    { id: 'S10', name: '华翰云(hanhan 基 yunyuejuan.net)', host: 'www.yunyuejuan.net', path: '/', hash: '#/marking/grading?questionId=332228', dom: ['input.el-input__inner[placeholder="请给分!"]', '.el-button--primary', '.el-image.photo_bg img.el-image__inner'], expect: 'hanhan', v: 'ok', hits: ['hanhan'] },
    { id: 'S11', name: '华翰云(lcedu 基)', host: 'yj.lcedu.net.cn', path: '/', hash: '#/marking/grading?questionId=332228', dom: ['#compuinput', 'button.submitscorebtn', 'img.el-image__inner'], expect: 'huahanyun', v: 'ok', hits: ['huahanyun'] },
    { id: 'S12', name: '光大阅卷 V1', host: 'pj.yixx.cn', path: '/mar/task', hash: '', dom: [], expect: 'guangda', v: 'ok', hits: ['guangda'] },
    { id: 'S13', name: '光大阅卷 V2 裸IP', host: '192.168.1.50', path: '/vue/task', hash: '', dom: ['LI.f-csp', 'canvas:not([id="0"])'], expect: 'guangda-2', v: 'ok', hits: ['guangda-2'] },
    // S14 桩原为通用占位键；修复后 yunyuejuan 认领需 DOM 三锚（button.btn-standard-pri.phr15 + tbody.xtlist），
    // 按真实自家页面形态补锚（语义不变：云阅卷自家页必须命中 yunyuejuan）
    { id: 'S14', name: '云阅卷(/Marking/)', host: '10.0.0.8', path: '/Marking/TaskIndex', hash: '', dom: ['img.answerImg', 'input.score', 'button.btn-standard-pri.phr15', 'button.btn-standard-pri', 'tbody.xtlist'], expect: 'yunyuejuan', v: 'ok', hits: ['yunyuejuan'] },
    { id: 'S18', name: 'AMEQP 内网', host: '10.0.0.12', path: '/AMEQP/Webroot/mar/task', hash: '', dom: ['#Mark_main', 'img.ansImg', 'input.mark_tbx[maxsco]', 'input#btn_submit.mark_btn', '#queSco_all'], expect: 'ameqp', v: 'ok', hits: ['ameqp'] },
    { id: 'S19', name: '睿芽(ruiya.onlyets.com)', host: 'ruiya.onlyets.com', path: '/', hash: '', dom: [], expect: 'ruiya', v: 'ok', hits: ['ruiya'] },
    { id: 'S20', name: '威科姆(wyna.onlyets.com)', host: 'wyna.onlyets.com', path: '/', hash: '', dom: [], expect: 'wuyuetong', v: 'ok', hits: ['wuyuetong'] },
    { id: 'S21', name: '阅卷网(yuejuan.com)', host: 'www.yuejuan.com', path: '/', hash: '', dom: [], expect: 'yuejuan', v: 'ok', hits: ['yuejuan'] },
    { id: 'X01', name: '未知平台·通用阅卷形态', host: 'unknown-site.example', path: '/paper/view', hash: '', dom: ['input.score', 'button.submit', 'img.answer'], expect: null, v: 'ok', hits: [] },
    { id: 'X09', name: 'xkw 批改页(yuejuan.xkw.com)', host: 'yuejuan.xkw.com', path: '/exam/marking/task/mark/2119983590628388864', hash: '', dom: ['p.ques-score input.el-input__inner', '.mark-image', 'p.ques-no'], expect: 'xkw', v: 'ok', hits: ['xkw'] },
    { id: 'X10', name: 'xkw 门户 ejt.xkw.com', host: 'ejt.xkw.com', path: '/home/', hash: '', dom: [], expect: 'xkw', v: 'ok', hits: ['xkw'] },
    { id: 'X11', name: 'xkw 伪造后缀（期望无命中）', host: 'yuejuan.xkw.com.evil.com', path: '/exam/marking/task/mark/1', hash: '', dom: ['p.ques-score input.el-input__inner'], expect: null, v: 'ok', hits: [] },
    // ---- 原 RED-hijack：真实在产平台被错接管 → 修复后严格 ----
    { id: 'S15', name: '鑫考 /Marking/DisPlay[原RED-hijack]', host: '10.0.0.9', path: '/Marking/DisPlay', hash: '', dom: ['input.fenshu', 'img.teaimg', '#submitbtn'], expect: 'xinkao', v: 'RED-hijack', hits: ['yunyuejuan', 'xinkao', 'xinkao-2', 'xinkao-campus'] },
    { id: 'S16', name: '鑫考2 /biluo/display[原RED-hijack]', host: '10.0.0.10', path: '/biluo/display.jsp', hash: '', dom: ['img.teaimg', 'input.fenshu', '#submitbtn'], expect: 'xinkao-2', v: 'RED-hijack', hits: ['xinkao-2', 'xinkao-campus'] },
    { id: 'S22', name: '好阅卷 haoyuejuan.com[原RED-hijack]', host: 'www.haoyuejuan.com', path: '/', hash: '', dom: [], expect: 'haoyuejuan', v: 'RED-hijack', hits: ['haoyuejuan', 'yuejuan'] },
    // ---- 原 YELLOW-multi：胜出正确但多命中靠位序 → 修复后严格单命中 ----
    { id: 'S17', name: '鑫考校园 /Marking/NormalReadPaper[原YELLOW-multi]', host: '10.0.0.11', path: '/Marking/NormalReadPaper', hash: '', dom: ['img.teaimg', 'input.fenshu', '#div-readPaper'], expect: 'xinkao-campus', v: 'YELLOW-multi', hits: ['yunyuejuan', 'xinkao-2', 'xinkao-campus'] },
    // ---- 原 RED-falsepos：未知形态误注册 ----
    { id: 'X02', name: '未知平台·含 li.f-csp[未修·R4]', host: 'unknown2.example', path: '/x', hash: '', dom: ['LI.f-csp'], expect: null, v: 'RED-falsepos', hits: ['guangda-2'] },
    { id: 'X03', name: '未知平台·路径含 /Marking/[已修]', host: 'unknown3.example', path: '/Marking/Task', hash: '', dom: [], expect: null, v: 'RED-falsepos', hits: ['yunyuejuan'] },
    { id: 'X04', name: '未知平台·teaimg+fenshu(变体路径)[已修]', host: 'unknown4.example', path: '/paper/display2', hash: '', dom: ['img.teaimg', 'input.fenshu'], expect: null, v: 'RED-falsepos', hits: ['xinkao-2', 'xinkao-campus'] },
    { id: 'X05', name: '陌生 SPA·仿华翰云 hash+DOM[已修·X05 收紧裁决：陌生同形 SPA 不得被 huahanyun 认领]', host: 'anycorp.example', path: '/', hash: '#/marking/grading?x=1', dom: ['#compuinput', 'button.submitscorebtn'], expect: null, v: 'RED-falsepos', hits: [] },
    { id: 'X08', name: '未知平台·teaimg+fenshu(近似校园路径)[已修·路径尾锚(扩展名可选)]', host: '10.0.0.13', path: '/Marking/NormalReadPaper2', hash: '', dom: ['img.teaimg', 'input.fenshu'], expect: null, v: 'RED-falsepos', hits: ['yunyuejuan', 'xinkao-2', 'xinkao-campus'] },
    // ---- 原 RED-conditional：条件性命中 → 修复后严格 ----
    { id: 'X06', name: '七天域名+路径含 /Marking/[已修]', host: 'e.7net.cc', path: '/Marking/TaskIndex', hash: '', dom: ['#img_container img', 'input.fenshu'], expect: 'qitian', v: 'RED-conditional', hits: ['qitian', 'yunyuejuan'] },
    { id: 'X07', name: 'hanhan 页同时含华翰云 V2 DOM[已修·先到先得]', host: 'www.yunyuejuan.net', path: '/', hash: '#/marking/grading?questionId=1', dom: ['input.el-input__inner[placeholder="请给分!"]', '.el-button--primary', '.el-image.photo_bg img.el-image__inner', '#compuinput', 'button.submitscorebtn'], expect: 'hanhan', v: 'RED-conditional', hits: ['hanhan', 'huahanyun'] },
];

function runStub(s) {
    const dom = {};
    for (const k of s.dom) dom[k] = 1;
    const sb = M.makeStub({ host: s.host, path: s.path, hash: s.hash, dom });
    return M.loadAdapters(sb);
}

// 快照自检：33 桩、分类齐全、FIXED/PERSISTENT 覆盖所有非 ok 桩（防删改漂移）
test('strict-b 快照完整：33 桩，非 ok 桩全部进 FIXED 或 PERSISTENT', () => {
    assert.strictEqual(STUBS.length, 33);
    const ids = new Set(STUBS.map(s => s.id));
    assert.strictEqual(ids.size, 33, '桩 id 不得重复');
    for (const s of STUBS) {
        assert.ok(['ok', 'RED-hijack', 'RED-falsepos', 'RED-conditional', 'YELLOW-multi'].includes(s.v), s.id + ' 分类非法: ' + s.v);
        if (s.v !== 'ok') {
            assert.ok(FIXED.has(s.id) || PERSISTENT[s.id], s.id + ' 非 ok 桩必须声明 FIXED 或 PERSISTENT');
        }
    }
});

for (const s of STUBS) {
    const kind = s.v === 'ok' ? 'ok' : (FIXED.has(s.id) ? `已修·原${s.v}` : `未修锁定·原${s.v}`);
    test(`strict-b ${s.id}（${kind}）${s.name}`, () => {
        const r = runStub(s);
        assert.deepStrictEqual(r.errors, [], '加载错误: ' + r.errors.join(' | '));
        const winnerDir = dirOf(r.winner);
        const writeDirs = r.writes.map(dirOf).slice().sort();

        if (s.v === 'ok' || FIXED.has(s.id)) {
            // 严格断言：修复后赢家与写集恰如期望
            const expectWrites = s.expect === null ? [] : [s.expect];
            assert.strictEqual(winnerDir, s.expect,
                `${s.id} 赢家应为 ${s.expect}，实际 ${winnerDir}；写集 ${JSON.stringify(writeDirs)}${FIXED.has(s.id) ? '（修复转绿项）' : ''}`);
            assert.deepStrictEqual(writeDirs, expectWrites, s.id + ' 写集不符（多命中/漏命中/冲突让位异常）');
        } else {
            // 未修/保留项锁现状；修复落地后 winner 翻为 expect → 此处必红 → 移入 FIXED
            const expectWrites = PERSISTENT[s.id];
            assert.deepStrictEqual(writeDirs, expectWrites.slice().sort(), s.id + ' 现状写集漂移');
            assert.strictEqual(winnerDir, expectWrites[expectWrites.length - 1], s.id + ' 现状赢家漂移');
            if (s.expect === null) {
                assert.ok(winnerDir !== null, `${s.id} 现状应为误注册（修复后移入 FIXED 翻转为 winner===null）`);
            } else {
                assert.notStrictEqual(winnerDir, s.expect, `${s.id} 现状应为错赢家（修复后移入 FIXED 翻转为 winner===${s.expect}）`);
            }
        }
    });
}
