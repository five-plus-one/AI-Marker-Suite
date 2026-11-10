const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const M = require(path.join(ROOT, 'tests/_adapter-matrix.js'));
const bundle = fs.readFileSync(path.join(ROOT, 'dist/ai_marker.user.js'), 'utf8');
const results = [];
for (const item of [...M.ADAPTERS, { dir: 'unknown', own: { host: 'example.com', path: '/' } }]) {
    const sb = M.makeStub(item.own), store = {};
    sb.document.readyState = 'loading';
    sb.document.getElementById = () => null;
    sb.window.location = sb.location;
    sb.GM_getValue = (key, fallback) => store[key] ?? fallback;
    sb.GM_setValue = (key, value) => { store[key] = value; };
    sb.GM_registerMenuCommand = () => {};
    sb.URL = URL; sb.URLSearchParams = URLSearchParams;
    let error = null;
    try { vm.createContext(sb); vm.runInContext(bundle, sb, { timeout: 2000 }); }
    catch (e) { error = e.message; }
    const winner = sb.__AI_MARKER_ADAPTER__;
    const pass = !error && (item.dir === 'unknown' ? !winner : (item.id ? winner?.id === item.id : winner?.name === item.name));
    results.push({ adapter: item.dir, pass, winner: winner?.id || winner?.name || null, error });
}
console.log(JSON.stringify({ artifact: path.join(ROOT, 'dist/ai_marker.user.js'), cases: results.length, passed: results.filter(r => r.pass).length, results }, null, 2));
process.exitCode = results.every(r => r.pass) ? 0 : 1;
