const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function compareVersions(left, right) {
    const parse = version => {
        if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) throw Error('Invalid release version: ' + version);
        return version.split('.').map(Number);
    };
    const a = parse(left), b = parse(right);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (a[i] || 0) - (b[i] || 0);
        if (diff) return Math.sign(diff);
    }
    return 0;
}
function verifyStableVersion(version, previous) {
    compareVersions(version, version);
    if (previous && compareVersions(version, previous) <= 0) throw Error(`Release version ${version} must exceed ${previous}`);
    return true;
}
if (require.main === module) {
    const root = path.resolve(__dirname, '..');
    const source = fs.readFileSync(path.join(root, 'src/core/config.js'), 'utf8');
    const version = source.match(/VERSION\s*:\s*'([^']+)'/)[1];
    const tags = execFileSync('git', ['tag', '--merged', 'HEAD', '--list', 'v*'], { cwd: root, encoding: 'utf8' })
        .trim().split(/\r?\n/).filter(tag => /^v\d+\.\d+\.\d+(?:\.\d+)?$/.test(tag)).map(tag => tag.slice(1));
    tags.sort((a, b) => compareVersions(b, a));
    verifyStableVersion(version, tags[0]);
    console.log(`Version verified: ${version}; previous release: ${tags[0] || 'none'}`);
}
module.exports = { compareVersions, verifyStableVersion };
