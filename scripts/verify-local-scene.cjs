const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { isCancelledInterception } = require('./browser-interception.cjs');
const root = path.resolve(__dirname, '..');
const candidates = [process.env.CHROME_BIN, process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome', '/usr/bin/chromium'];
const browser = candidates.find(candidate => candidate && fs.existsSync(candidate));
if (!browser) throw Error('Chrome is required for browser acceptance');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(url) {
    const socket = new WebSocket(url); let sequence = 0;
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const pending = new Map(), listeners = new Set();
    socket.onclose = () => { for (const handler of pending.values()) handler.reject(Error("Browser connection closed")); pending.clear(); };
    socket.onmessage = event => {
        const reply = JSON.parse(event.data), handler = pending.get(reply.id);
        if (handler) { pending.delete(reply.id); reply.error ? handler.reject(Error(reply.error.message)) : handler.resolve(reply.result); }
        else if (reply.method) for (const listener of listeners) listener(reply);
    };
    return { socket, onEvent(listener) { listeners.add(listener); }, send(method, params = {}) { return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(Error("Browser command timed out: " + method)); }, 15000);
        pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
        socket.send(JSON.stringify({ id, method, params }));
    }); } };
}

(async()=>{
 const {openScene,serveScene}=require('./platform-scene.cjs');
 const scene=openScene(path.resolve(root,'../LocalPlatformScenes/haofenshu/2026-11-12'));
 const server=serveScene(scene,0);await new Promise(r=>server.listening?r():server.once('listening',r));
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'aimarker-scene-'));
 const child=spawn(browser,['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let c;try{
 const active=path.join(profile,'DevToolsActivePort');for(let i=0;i<200&&!fs.existsSync(active);i++)await pause(100);
 const [port]=fs.readFileSync(active,'utf8').split(/\r?\n/);const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();c=await connect(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await c.send('Page.enable');
 await c.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});await pause(1500);
 const results=[];
 for(const ref of ['v1.21.19.0','v1.21.20.0','v1.21.21.0','origin/stable','working']){
 const result=await c.send('Runtime.evaluate',{expression:`(async()=>{await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/adapter-probe.js?ref=${ref}';script.onload=resolve;script.onerror=reject;document.body.appendChild(script);});const r=await sceneProbe.run();return {version:r.version,images:r.images,hasIdentity:!!r.identity};})()`,awaitPromise:true,returnByValue:true});
 if(result.exceptionDetails)throw Error(result.exceptionDetails.text);results.push(result.result.value);
 }
 console.log(JSON.stringify({results}));if(!results.at(-1)?.images)throw Error('Candidate did not retrieve scene images');
 }finally{c?.socket.close();child.kill();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
