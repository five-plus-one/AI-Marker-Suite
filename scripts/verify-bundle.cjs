const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const M = require(path.join(ROOT, 'tests/_adapter-matrix.js'));
const Q = require(path.join(ROOT, 'tests/_qiguang-signature.js'));
const bundle = fs.readFileSync(path.join(ROOT, 'dist/ai_marker.user.js'), 'utf8');
const header = bundle.split('// ==/UserScript==', 1)[0];
const matchingRules = [...header.matchAll(/^\/\/ @match\s+(\S+)$/gm)].map(([, rule]) => rule);
if (matchingRules.length === 0 || matchingRules.some(rule => !rule.startsWith('*://'))) {
    throw new Error('The userscript must use *:// for all @match rules');
}
for (const route of ['/AMEQP/Webroot/mar/', '/ameqp/Webroot/mar/']) {
    if (!matchingRules.includes(`*://*${route}*`)) throw new Error(`Missing AMEQP entry ${route}`);
}
const results = [];
const cases = [...M.ADAPTERS, ...Q.deployments.map(form => ({ dir: 'qiguang', id: 'qiguang', label: form.label, own: form })),
    ...Q.rejections().map(form => ({ dir: 'unknown', label: form.label, own: form })),
    { dir: 'leascent', id: 'leascent', label: '湖北丽升阅卷页',
        own: { host: 'hb.leascent.com', port: '84', protocol: 'http:', path: '/home/index' } },
    { dir: 'unknown', label: '湖北丽升登录页',
        own: { host: 'hb.leascent.com', port: '83', protocol: 'http:', path: '/' } },
    { dir: 'unknown', own: { host: 'example.com', path: '/' } }];
for (const item of cases) for (const storage of ['available', 'write-failure']) {
    const sb = M.makeStub(item.own), store = {};
    sb.document.readyState = 'interactive';
    sb.document.getElementById = () => null;
    sb.window.location = sb.location;
    sb.GM_getValue = (key, fallback) => store[key] ?? fallback;
    sb.GM_setValue = (key, value) => {
        if (storage === 'write-failure') throw Error('Storage write unavailable');
        store[key] = value;
    };
    sb.GM_registerMenuCommand = () => {};
    sb.URL = URL; sb.URLSearchParams = URLSearchParams;
    let error = null;
    try { vm.createContext(sb); vm.runInContext(bundle, sb, { timeout: 2000 }); }
    catch (e) { error = e.message; }
    const winner = sb.__AI_MARKER_ADAPTER__;
    const pass = !error && (item.dir === 'unknown' ? !winner : (item.id ? winner?.id === item.id : winner?.name === item.name));
    results.push({ adapter: item.dir, scenario: item.label || item.dir, storage, pass, winner: winner?.id || winner?.name || null, error });
}
console.log(JSON.stringify({ artifact: path.join(ROOT, 'dist/ai_marker.user.js'), cases: results.length, passed: results.filter(r => r.pass).length, results }, null, 2));
process.exitCode = results.every(r => r.pass) ? 0 : 1;
