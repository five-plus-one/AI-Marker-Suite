const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { verifyStableVersion, compareVersions } = require('../scripts/verify-stable-version.cjs');

test('稳定版版本必须高于上一发布，包括四段版本与三段历史标签', () => {
    for (const [current, previous] of [['1.21.18.0','1.21.18'], ['1.21.18.3','1.21.18.3'], ['1.21.17.9','1.21.18.0']]) {
        assert.throws(() => verifyStableVersion(current, previous));
    }
    assert.equal(verifyStableVersion('1.21.19.0', '1.21.18.3'), true);
    assert.equal(verifyStableVersion('1.21.18.4', '1.21.18'), true);
    assert.equal(compareVersions('1.21.10', '1.21.9.9'), 1);
    assert.throws(() => verifyStableVersion('1.21.18-preview.2', '1.21.17'));
});

test('每个发布入口在构建和发布前运行回归与实际产物验证', () => {
    for (const file of ['build-dev.yml', 'build-preview.yml', 'build.yml', 'release.yml', 'pr-test-build.yml']) {
        const source = fs.readFileSync(path.join(__dirname, '../.github/workflows', file), 'utf8');
        assert.ok(source.indexOf('npm test') > 0, file);
        assert.ok(source.indexOf('npm test') < source.indexOf('npm run build'), file);
        assert.ok(source.indexOf('npm run verify:bundle') > source.indexOf('npm run build'), file);
        assert.ok(source.includes('npm run verify:browser'), file);
        assert.ok(source.includes('npm audit --audit-level=low'), file);
    }
});
