const test = require('node:test');
const assert = require('node:assert/strict');
const { isCancelledInterception } = require('../scripts/browser-interception.cjs');
test('late cancellation notification classifies a retired interception', async () => {
    let cancelled = false;
    setTimeout(() => { cancelled = true; }, 5);
    assert.equal(await isCancelledInterception(Error('Invalid InterceptionId.'), () => cancelled), true);
});
test('unexplained interception failures remain failures', async () => {
    assert.equal(await isCancelledInterception(Error('Invalid InterceptionId.'), () => false), false);
});
test('other protocol errors cannot be hidden by navigation', async () => {
    assert.equal(await isCancelledInterception(Error('Unknown method'), () => true), false);
});
