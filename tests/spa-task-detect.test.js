const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const test = require('node:test');

// ---------- #304 SPA 渲染竞态：待重试判定 ----------
function loadHelper() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'main.js'), 'utf8');
    const m = src.match(/function shouldRetryPendingTaskFlow\([\s\S]*?\n\}/);
    assert.ok(m, 'shouldRetryPendingTaskFlow 未找到');
    const sb = {};
    vm.createContext(sb);
    vm.runInContext(m[0] + '\n;__f = shouldRetryPendingTaskFlow;', sb);
    return sb.__f;
}

test('待重试判定矩阵（#304/#315）：同任务+未批改+未暂停才补跑新题引导', () => {
    const f = loadHelper();
    assert.strictEqual(f('hy#332228', 'hy#332228', false, false), true, '同任务+未批改+未暂停 → 重试');
    assert.strictEqual(f('hy#332228', 'hy#332228', true, false), false, '批改运行中 → 不重试（防打断）');
    assert.strictEqual(f('hy#332228', 'hy#332228', false, true), false, '暂停期 → 不重试（#315 G7 防暂停期换方案）');
    assert.strictEqual(f('hy#332228', 'hy#332229', false, false), false, '任务已变化 → 交给切换流程');
    assert.strictEqual(f(null, 'hy#332228', false, false), false, '无登记 → 不重试');
    assert.strictEqual(f('', 'hy#332228', false, false), false, '空登记 → 不重试');
});

test('新题引导流程已抽取为单一函数（#304 双路径复用，防行为分叉）', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'main.js'), 'utf8');
    const fnCount = (src.match(/function runNewTaskOnboardingFlow/g) || []).length;
    assert.strictEqual(fnCount, 1, 'runNewTaskOnboardingFlow 应恰好定义一次');
    const callCount = (src.match(/await runNewTaskOnboardingFlow\(/g) || []).length;
    assert.strictEqual(callCount, 2, '切换即命中与竞态重试两条路径都应调用');
});
