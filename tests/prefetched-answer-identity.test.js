const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./_adapter-matrix.js');

const platforms = [
    {
        dir: 'guangda', current: '_getCurrentMh', endpoint: '/getDdb',
        imageHost: 'https://markpic.example',
        reply: url => ({ result: { vKs: [{ mh: '1', imageData: { vUrl: [url] } }] } }),
    },
    {
        dir: 'qitian-new', current: '_getCurrentId', endpoint: '/Review/ReviewData',
        imageHost: 'https://yjimage.oss.example',
        reply: url => ({ data: { list: [{ id: 1, image: { url } }] } }),
    },
];

for (const { dir, current, endpoint, imageHost, reply } of platforms) {
    test(`${dir} 等待已确认的当前答卷，预取记录不参与取图`, async () => {
        const sb = M.makeStub(M.ADAPTERS.find(entry => entry.dir === dir).own);
        const correct = imageHost + '/current.jpg';
        const prefetched = imageHost + '/next.jpg';
        let clock = 0;
        sb.Date = { now: () => clock };
        sb.setTimeout = (fn, ms) => { clock += ms; fn(); };
        sb.performance.getEntriesByType = () => [correct, prefetched].map(name => ({ name, initiatorType: 'img' }));
        sb.XMLHttpRequest = class {
            open() {}
            send() { this.load(); }
            addEventListener(type, listener) { if (type === 'load') this.load = listener; }
        };
        const adapter = M.loadOne(sb, dir).winner;
        const request = new sb.XMLHttpRequest();
        request.open('POST', endpoint);
        request.responseText = JSON.stringify(reply(correct));
        request.send();
        adapter[current] = () => '1';
        assert.deepEqual(Array.from(await adapter.gatherAnswerImages()), [correct]);
        adapter[current] = () => '3';
        assert.deepEqual(Array.from(await adapter.gatherAnswerImages()), []);
    });
}
