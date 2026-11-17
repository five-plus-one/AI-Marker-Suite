// Run isolated adapter probes with the deterministic fixture clock. No platform requests.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixture, waitingFixture, URL_A } = require('../tests/_platform-image-fixture');
const matrix = require('../tests/_adapter-matrix');

async function audit() {
    const results = [];
    const record = (platform, scenario, actual, expected) => results.push({ platform, scenario, actual, expected, finding: actual !== expected });
    for (const platform of ['c30', 'keewing']) {
        const e = waitingFixture(platform);
        e.next();
        record(platform, 'next-loaded-before-wait', await e.run(e.adapter.waitForNextPaper(e.oldUrl)), true);
    }
    for (const [platform, method] of [['guangda', '_getCurrentMh'], ['guangda-2', '_getCurrentPackage'],
        ['qitian-new', '_getCurrentId'], ['lehua', '_getCanvasHash']]) {
        const e = fixture(platform);
        e.adapter[method] = () => 'paper-B';
        e.adapter._autoRecoverCommitFail = () => {};
        e.sb.document.querySelector = () => null;
        record(platform, 'next-loaded-before-wait', await e.run(e.adapter.waitForNextPaper(URL_A, { paperId: 'paper-A' })), true);
    }
    for (const platform of ['hanhan', 'haofenshuyize', 'huixuexing', 'yuejiaoxiangyun', 'wuyuetong', 'xinjiaoyu']) {
        const e = waitingFixture(platform);
        e.image.src += '&timestamp=123';
        if (platform === 'xinjiaoyu') vm.runInContext('_xinjiaoyuCurrentImageUrl=' + JSON.stringify(e.image.src), e.sb);
        record(platform, 'same-paper-cache-refresh', await e.run(e.adapter.waitForNextPaper(e.oldUrl)), false);
    }
    for (const platform of ['yunyuejuan', 'xinkao', 'xinkao-2', 'xinkao-campus']) {
        const e = waitingFixture(platform), paperId = e.adapter.getPaperIdentity();
        e.next();
        record(platform, 'next-loaded-before-wait', await e.run(e.adapter.waitForNextPaper(e.oldUrl, { paperId })), true);
        const same = waitingFixture(platform); same.image.src += '&timestamp=123';
        record(platform, 'same-paper-cache-refresh', await same.run(same.adapter.waitForNextPaper(same.oldUrl)), false);
    }
    return { adapterDirectories: matrix.allAdapterDirs().length,
        bundledAdapters: new Set(matrix.bundleOrder().map(file => file.split('/')[1])).size,
        inspectedWaitMethods: new Set(matrix.ADAPTERS.map(entry => entry.dir)).size,
        findings: results.filter(result => result.finding).length, results };
}

if (require.main === module) audit().then(report => {
    const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
    const json = JSON.stringify(report, null, 2) + '\n';
    if (output) fs.writeFileSync(path.resolve(output), json);
    else process.stdout.write(json);
}).catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { audit };
