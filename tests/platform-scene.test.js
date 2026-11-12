const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { openScene, serveScene, adapterProbe } = require('../scripts/platform-scene.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function capturedScene(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-marker-scene-'));
    t.after(() => {
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        assert.ok(path.basename(root).startsWith('ai-marker-scene-'));
        fs.rmSync(root, { recursive: true });
    });
    fs.mkdirSync(path.join(root, 'resources'));
    const write = (file, value) => fs.writeFileSync(path.join(root, file), value);
    write('capture.json', JSON.stringify({platform: 'haofenshu', pageUrl: 'https://platform.example/mark'}));
    write('document.html', '<html><head><script src="https://platform.example/app.js"></script></head><body onload="submit()"><img src="/answer.png"><button onclick="submit()">提交</button></body></html>');
    write('resources/answer.png', 'captured-image');
    write('resources.json', JSON.stringify([{url:'https://platform.example/answer.png', path:'resources/answer.png', mimeType:'image/png', sha256:hash('captured-image')}]));
    write('files.json', JSON.stringify({files:['document.html','resources.json','capture.json'].map(file => ({path:file,sha256:hash(fs.readFileSync(path.join(root,file)))}))}));
    return { root, write };
}

test('现场完整性校验覆盖页面、资源和路径边界', t => {
    const {root, write} = capturedScene(t);
    assert.equal(openScene(root).sealed, true);
    write('resources/answer.png', 'modified');
    assert.throws(() => openScene(root), /checksum failed/);
    write('resources/answer.png', 'captured-image');
    write('document.html', '<html>modified</html>');
    assert.throws(() => openScene(root), /Scene checksum failed/);
    fs.unlinkSync(path.join(root, 'files.json'));
    write('resources.json', JSON.stringify([{path:'../outside',sha256:hash('outside')}]));
    assert.throws(() => openScene(root), /outside scene directory/);
});

test('冻结回放隔离平台脚本与写请求，只提供已归档资源', async t => {
    const {root} = capturedScene(t), scene = openScene(root);
    assert.match(scene.html, /img src="\/resources\/answer.png"/);
    assert.doesNotMatch(scene.html, /onload=|onclick=|src="https:\/\/platform.example\/app.js"/);
    assert.match(scene.html, /connect-src 'self'/);
    assert.match(scene.html, /form-action 'none'/);
    assert.throws(() => adapterProbe(scene, '../../secrets'), /Unsupported probe version/);
    const server = serveScene(scene, 0);
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base, {method:'POST'})).status, 405);
    assert.equal((await fetch(base + '/api/submit')).status, 404);
    const image = await fetch(base + '/resources/answer.png');
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(await image.text(), 'captured-image');
});
