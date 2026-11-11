const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('./_adapter-matrix.js');
const Q = require('./_qiguang-signature.js');

for (const form of Q.deployments) test(form.label + '：完整 bundle 使用单一适配器与对应平台名称', () => {
    const sb = M.makeStub(form), result = M.loadAdapters(sb);
    assert.deepEqual(result.errors, []); assert.equal(result.winner?.id, 'qiguang');
    assert.equal(result.winner?.name, form.name || '启光优测');
    assert.equal(result.writes.length, 1);
});

test('诊学平台名称按完整域名边界识别，同结构外站保留对应名称', () => {
    for (const [host, expectedName] of [['51zhenxue.com', '诊学网'], ['crock.51zhenxue.com', '诊学网'],
        ['crock.51zhenxue.com.example.org', '启光优测'], ['not51zhenxue.com', '启光优测']]) {
        const sb = M.makeStub({ host, path: Q.ROUTE, dom: Q.signature() });
        const result = M.loadAdapters(sb);
        assert.deepEqual(result.errors, []);
        assert.equal(result.winner?.name, expectedName);
        assert.equal(result.writes.length, 1);
    }
});
for (const form of Q.rejections()) test(form.label + '：不注册', () => {
    const result = M.loadAdapters(M.makeStub(form));
    assert.deepEqual(result.errors, []); assert.equal(result.winner, null); assert.equal(result.writes.length, 0);
});

test('启光特征分阶段出现后补注册，并保持幂等', () => {
    const sb = M.makeStub({ host: '10.15.0.8', path: Q.ROUTE });
    M.loadAdapters(sb); assert.equal(sb.__AI_MARKER_ADAPTER__, undefined);
    Object.assign(sb.__dom, Q.signature());
    sb.__observers.forEach(o => o.cb());
    assert.equal(sb.__AI_MARKER_ADAPTER__?.id, 'qiguang'); assert.equal(sb.__writes.length, 1);
    sb.__observers.forEach(o => o.cb()); assert.equal(sb.__writes.length, 1);
});

test('启光延迟注册遇到既有适配器时保留原对象并告警', () => {
    const sb = M.makeStub({ host: '10.15.0.8', path: Q.ROUTE }); const errors = [];
    sb.console.error = (...args) => errors.push(args);
    M.loadOne(sb, 'qiguang'); const existing = { id: 'existing' }; sb.__AI_MARKER_ADAPTER__ = existing;
    Object.assign(sb.__dom, Q.signature()); sb.__observers.forEach(o => o.cb());
    assert.equal(sb.__AI_MARKER_ADAPTER__, existing); assert.equal(sb.__writes.length, 1);
    assert.equal(errors.length, 1);
    // 已结束的回调不因后续槽位变化而重新争抢。
    sb.__AI_MARKER_ADAPTER__ = null; sb.__observers.forEach(o => o.cb());
    assert.equal(sb.__AI_MARKER_ADAPTER__, undefined); assert.equal(errors.length, 1);
});

test('启光即时注册遇到既有适配器时保持对象不变', () => {
    const sb = M.makeStub(Q.deployments[0]); const existing = { id: 'existing' }; sb.__AI_MARKER_ADAPTER__ = existing;
    M.loadOne(sb, 'qiguang'); assert.equal(sb.__AI_MARKER_ADAPTER__, existing); assert.equal(sb.__writes.length, 1);
});

test('启光延迟过程中离开阅卷路径即停止注册', () => {
    const sb = M.makeStub({ host: '10.15.0.8', path: Q.ROUTE }); M.loadOne(sb, 'qiguang');
    sb.location.pathname = '/Account/Login'; sb.__observers.forEach(o => o.cb());
    sb.location.pathname = Q.ROUTE; Object.assign(sb.__dom, Q.signature()); sb.__observers.forEach(o => o.cb());
    assert.equal(sb.__AI_MARKER_ADAPTER__, undefined); assert.equal(sb.__writes.length, 0);
});

test('不同部署的相同题号分别识别为独立任务', () => {
    const identifiers = Q.deployments.map(form => {
        const sb = M.makeStub({ ...form, search: '?SubjectId=test&questionGroupId=test' }); M.loadOne(sb, 'qiguang');
        return sb.__AI_MARKER_ADAPTER__.getTaskIdentifier();
    });
    assert.equal(new Set(identifiers).size, identifiers.length);
});

test('原部署继续使用已绑定方案的任务标识，其他地址不复用', () => {
    const legacy = 'qiguang_subject_group';
    const identifiers = Q.deployments.map(form => {
        const sb = M.makeStub({ ...form, search: '?SubjectId=subject&questionGroupId=group' });
        M.loadOne(sb, 'qiguang'); return sb.__AI_MARKER_ADAPTER__.getTaskIdentifier();
    });
    assert.equal(identifiers[0], legacy);
    assert.ok(identifiers.slice(1).every(id => id !== legacy));
    const bindings = { [legacy]: '教师方案' };
    assert.equal(bindings[identifiers[0]], '教师方案');
    assert.ok(identifiers.slice(1).every(id => !bindings[id]));
});

test('各平台页面带有启光控件时仍保留自身适配器', () => {
    for (const platform of M.ADAPTERS.filter(a => a.id !== 'qiguang')) {
        const sb = M.makeStub({ ...platform.own, dom: { ...Q.signature(), ...platform.own.dom } });
        const result = M.loadAdapters(sb);
        assert.deepEqual(result.errors, []);
        assert.equal(platform.id ? result.winner?.id : result.winner?.name, platform.id || platform.name, platform.dir);
        assert.equal(result.writes.length, 1, platform.dir);
    }
});

test('脚本匹配专用阅卷路径并覆盖任意部署主机', () => {
    const build = fs.readFileSync(path.join(__dirname, '../build.js'), 'utf8');
    assert.ok(build.includes("'*://*/OraOnlineCheck/OraCheck/Review*'"));
    assert.ok(!build.includes("'*://120.78.5.37/*'"));
});

test('入口模块识别的弱化能够被负例发现', () => {
    const sb = M.makeStub(Q.rejections().find(f => f.label === '启光缺少 script[src]'));
    const file = 'src/adapters/qiguang/adapter.js';
    const result = M.loadOne(sb, 'qiguang', { mutations: [{ file,
        find: 'if (!this._isReviewRoute()) return false;', replace: 'if (this._isReviewRoute()) return true;' }] });
    assert.equal(result.winner?.id, 'qiguang', '弱化平台指纹时反例会错误注册，应由上方矩阵检出');
});
