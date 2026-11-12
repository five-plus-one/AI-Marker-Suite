// Inspect or replay a local browser capture. Capture itself is performed through the browser tools.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');

function openScene(directory) {
    const root = path.resolve(directory);
    const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
    const capture = read('capture.json'), resources = read('resources.json');
    const inside = relative => {
        const file = path.resolve(root, relative);
        if (!file.startsWith(root + path.sep)) throw Error('File outside scene directory');
        return file;
    };
    const checksum = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
    // A complete capture also seals DOM, API samples, state descriptions and screenshots.
    const manifestPath = path.join(root, 'files.json');
    if (fs.existsSync(manifestPath)) {
        for (const item of read('files.json').files) {
            if (checksum(fs.readFileSync(inside(item.path))) !== item.sha256) throw Error(`Scene checksum failed: ${item.path}`);
        }
    }
    const files = new Map();
    for (const resource of resources.filter(item => item.path)) {
        const bytes = fs.readFileSync(inside(resource.path));
        if (checksum(bytes) !== resource.sha256) throw Error(`Resource checksum failed: ${resource.path}`);
        files.set('/' + resource.path.replaceAll('\\', '/'), { ...resource, bytes });
    }
    const byUrl = new Map(resources.filter(item => item.path).map(item => [item.url, '/' + item.path]));
    function localUrl(value, base = capture.pageUrl) {
        if (value.startsWith('/resources/')) return value;
        try {
            const url = new URL(value.replaceAll('&amp;', '&'), base);
            if (byUrl.has(url.href)) return byUrl.get(url.href);
            // Signed URLs have already been replaced in the HTML; static relative assets use their full URL.
            const found = resources.find(item => item.path && item.url === url.href);
            return found ? '/' + found.path : value;
        } catch (_) { return value; }
    }
    const rewriteCss = (css, base) => css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (_, quote, value) => `url("${localUrl(value, base)}")`);
    let html = fs.readFileSync(path.join(root, 'document.html'), 'utf8')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
        .replace(/<base\b[^>]*>/gi, '')
        .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, '')
        .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
        .replace(/\b(src|href|xlink:href)\s*=\s*(["'])(.*?)\2/gi, (_, key, quote, value) => `${key}=${quote}${localUrl(value)}${quote}`);
    const policy = "default-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'";
    html = html.replace(/<head([^>]*)>/i, `<head$1><meta http-equiv="Content-Security-Policy" content="${policy}">`)
        .replace('</body>', '<script src="/adapter-probe.js"></script></body>');
    return { root, capture, resources, files, html, rewriteCss, sealed: fs.existsSync(manifestPath) };
}

function adapterProbe(scene, ref = 'working') {
    const allowed = new Set(['working', 'v1.21.19.0', 'v1.21.20.0', 'origin/stable']);
    if (!allowed.has(ref)) throw Error('Unsupported probe version');
    if (scene.capture.platform !== 'haofenshu') throw Error('Adapter replay needs a platform-specific harness');
    const source = ['selectors.js', 'adapter.js'].map(file => {
        const rel = `src/adapters/haofenshu/${file}`;
        return ref === 'working' ? fs.readFileSync(path.join(ROOT, rel), 'utf8')
            : cp.execFileSync('git', ['show', `${ref}:${rel}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 5e6 });
    }).join('\n');
    const sourceUrls = Object.fromEntries([...scene.files].map(([key, item]) => [key, item.url]));
    // The actual captured DOM supplies layout and visibility. Resource URLs retain their original identity.
    return `(() => {
        const originalUrls = ${JSON.stringify(sourceUrls)};
        const nativeDocument = document;
        const wrap = element => new Proxy(element, { get(target, key) {
            if (key === 'getAttribute') return name => {
                const value = target.getAttribute(name);
                return /^(src|href|xlink:href)$/.test(name) ? originalUrls[value] || value : value;
            };
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        }});
        const capturedDocument = new Proxy(nativeDocument, { get(target, key) {
            if (key === 'querySelectorAll') return selector => Array.from(target.querySelectorAll(selector), wrap);
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        }});
        const capturedWindow = {location:new URL(${JSON.stringify(scene.capture.pageUrl)}), aiGradingState:{}, __AI_MARKER_WAIT_WINDOW_MS__:80};
        (function(window, document, location) { ${source}\n })(capturedWindow, capturedDocument, capturedWindow.location);
        window.sceneProbe = {version:${JSON.stringify(ref)},run:async()=>({version:${JSON.stringify(ref)},images:(await capturedWindow.__AI_MARKER_ADAPTER__.gatherAnswerImages()).length,identity:capturedWindow.__AI_MARKER_ADAPTER__.getPaperIdentity?.()||null})};
    })();`;
}

function serveScene(scene, port = 10452) {
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        if (request.method !== 'GET') { response.writeHead(405); response.end('Offline scene: read only'); return; }
        try {
            if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(scene.html); return; }
            if (url.pathname === '/adapter-probe.js') {
                response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
                response.end(adapterProbe(scene, url.searchParams.get('ref') || 'working')); return;
            }
            const resource = scene.files.get(url.pathname);
            if (resource) {
                response.setHeader('Content-Type', resource.mimeType || 'application/octet-stream');
                response.end(/css/i.test(resource.mimeType || '') ? scene.rewriteCss(resource.bytes.toString(), resource.url) : resource.bytes); return;
            }
            response.writeHead(404); response.end('Resource not present in captured scene');
        } catch (_) { response.writeHead(400); response.end('Scene request unavailable'); }
    });
    server.listen(port, '127.0.0.1', () => console.log(`Scene replay: http://127.0.0.1:${server.address().port}/`));
    return server;
}

if (require.main === module) {
    const [command, directory, port] = process.argv.slice(2);
    if (!directory || !['verify', 'serve'].includes(command)) throw Error('Usage: node scripts/platform-scene.cjs verify|serve <local-scene-directory> [port]');
    const scene = openScene(directory);
    if (command === 'serve') serveScene(scene, port ? Number(port) : 10452);
    else console.log(JSON.stringify({ platform: scene.capture.platform, resources: scene.files.size, checksums: 'passed', fullManifest: scene.sealed, captureCoverage: scene.capture.coverage }, null, 2));
}
module.exports = { openScene, adapterProbe, serveScene };
