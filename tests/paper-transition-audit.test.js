const test = require('node:test');
const assert = require('node:assert/strict');
const { audit } = require('../scripts/audit-paper-transition.cjs');

test('提交前的旧卷基准支持快速换卷，缓存刷新不会冒充新卷', async () => {
    const { results, findings } = await audit();
    assert.equal(findings, 0, JSON.stringify(results.filter(result => result.finding), null, 2));
});
