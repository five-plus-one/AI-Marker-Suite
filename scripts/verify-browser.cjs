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
(async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aimarker-browser-'));
    const flags = ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-background-networking',
        '--allow-file-access-from-files', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'];
    const useChildReaper = process.env.CI === 'true' && process.platform === 'linux' && process.arch === 'x64';
    const child = useChildReaper
        ? spawn('perl', [path.join(__dirname, 'ci', 'chromium-subreaper.pl'), browser, ...flags], { stdio: 'ignore' })
        : spawn(browser, flags, { windowsHide: true, stdio: 'ignore' });
    const results = []; let browserClient, client;
    try {
        const activePort = path.join(profile, 'DevToolsActivePort');
        let endpoint;
        for (let count = 0; count < 200; count++) {
            if (fs.existsSync(activePort)) {
                const fields = fs.readFileSync(activePort, 'utf8').trim().split(/\r?\n/);
                if (/^[1-9]\d*$/.test(fields[0]) && fields[1]?.startsWith('/devtools/browser/')) {
                    endpoint = fields;
                    break;
                }
            }
            await pause(100);
        }
        if (!endpoint) throw Error('Chrome debugging endpoint unavailable');
        const [port, browserPath] = endpoint;
        browserClient = await connect('ws://127.0.0.1:' + port + browserPath);
        const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
        client = await connect(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
        await client.send('Page.enable');
        await client.send('Runtime.enable');
        await client.send('Network.enable');
        const selected = process.argv.find(arg => arg.startsWith('--fixture='))?.slice(10);
        const fixtures = ['embedded-ui', 'diagnostic-export', 'workflow', 'api-endpoints', 'renderer', 'bundle', 'output-mode', 'subscore', 'xinkao-cloud', 'xinkao-campus', 'xinkao-intranet', 'xinkao-public', 'qitian', 'taowei', 'yuejuantong', 'bfzks', 'baishi', 'xkw-cloud', 'eiduo', 'dcesa', 'review-evidence', 'question-guard', 'startup', 'startup-registration', 'startup-navigation', 'qiguang',
            'qiguang-original-deployment', 'qiguang-public-deployment', 'qiguang-private-deployment', 'qiguang-domain-deployment',
            'qiguang-late-deployment', 'qiguang-module-negative', 'qiguang-form-negative', 'ameqp-fast', 'ameqp-slow',
            'ameqp-multi', 'ameqp-unknown', 'ameqp-prefixed', 'ameqp-query', 'ameqp-unknown-multi', 'ameqp-mixed', 'qiguang-zhenxue-deployment',
            'qiguang-zhenxue-late', 'qiguang-zhenxue-module-negative',
            'jzsmartedu-ready', 'jzsmartedu-scoreboard', 'jzsmartedu-late', 'jzsmartedu-spa', 'jzsmartedu-foreign-route',
            'jiukexing-ready', 'jiukexing-multi', 'jiukexing-late', 'jiukexing-spa', 'zhixue', 'zhixue-homework',
            'zhixue-continuity-exam', 'zhixue-continuity-homework', 'zhixue-multi-paper', 'zhixue-multi-paper-container', 'haofenshu', 'yuandingbang',
            'hanhan', 'xinjiaoyu', 'wzedu-ready', 'wzedu-keyboard', 'wzedu-late', 'wzedu-spa', 'wzedu-bound', 'wzedu-review', 'youfen-ready', 'xiaoleyouyue-ready', 'xiaoleyouyue-multi', 'xiaoleyouyue-late', 'xiaoxianai-ready', 'xiaoxianai-late', 'xiaoxianai-spa', 'xiaoxianai-exam', 'huixue-ready', 'huixue-late', 'huixue-spa', 'huizhou-ready', 'huizhou-late', 'huizhou-spa', 'xiangshangxue-ready', 'xiangshangxue-multi', 'xiangshangxue-late']
            .filter(fixture => !selected || fixture === selected || fixture.startsWith(selected + '-'));
        if (!fixtures.length) throw Error('Unknown browser fixture');
        let consoleMessages = [];
        let interceptionEnabled = false, interceptionError, navigation = 0, cancelledInterceptions = 0;
        const cancelledRequests = new Set();
        const deploymentHtml = fs.readFileSync(path.join(root, 'tests/fixtures/qiguang-deployment.html'), 'utf8');
        const ameqpHtml = fs.readFileSync(path.join(root, 'tests/fixtures/ameqp.html'), 'utf8');
        const jzsmarteduHtml = fs.readFileSync(path.join(root, 'tests/fixtures/jzsmartedu.html'), 'utf8');
        const jiukexingHtml = fs.readFileSync(path.join(root, 'tests/fixtures/jiukexing.html'), 'utf8');
        const haofenshuHtml = fs.readFileSync(path.join(root, 'tests/fixtures/haofenshu.html'), 'utf8');
        const yuandingbangHtml = fs.readFileSync(path.join(root, 'tests/fixtures/yuandingbang.html'), 'utf8');
        const yuandingbangJpeg = fs.readFileSync(path.join(root, 'tests/fixtures/yuandingbang-answer.jpg'));
        const wzeduHtml = fs.readFileSync(path.join(root, 'tests/fixtures/wzedu.html'), 'utf8');
        const zhixueHtml = fs.readFileSync(path.join(root, 'tests/fixtures/zhixue.html'), 'utf8');
        const zhixueHomeworkHtml = fs.readFileSync(path.join(root, 'tests/fixtures/zhixue-homework.html'), 'utf8');
        const zhixueContinuityHtml = fs.readFileSync(path.join(root, 'tests/fixtures/zhixue-continuity.html'), 'utf8');
        const zhixueMultiPaperHtml = fs.readFileSync(path.join(root, 'tests/fixtures/zhixue-multi-paper.html'), 'utf8');
        const xiangshangxueHtml = fs.readFileSync(path.join(root, 'tests/fixtures/xiangshangxue.html'), 'utf8');
        const huixueHtml = fs.readFileSync(path.join(root, 'tests/fixtures/huixue.html'), 'utf8');
        const youfenHtml = fs.readFileSync(path.join(root, 'tests/fixtures/youfen.html'), 'utf8');
        const xiaoleyouyueHtml = fs.readFileSync(path.join(root, 'tests/fixtures/xiaoleyouyue.html'), 'utf8');
        const xiaoxianaiHtml = fs.readFileSync(path.join(root, 'tests/fixtures/xiaoxianai.html'), 'utf8');
        const taoweiHtml = fs.readFileSync(path.join(root, 'tests/fixtures/taowei.html'), 'utf8');
        const taoweiPageHtml = fs.readFileSync(path.join(root, 'tests/fixtures/taowei-page.html'), 'utf8');
        const baishiHtml = fs.readFileSync(path.join(root, 'tests/fixtures/baishi.html'), 'utf8');
        const eiduoHtml = fs.readFileSync(path.join(root, 'tests/fixtures/eiduo.html'), 'utf8');
        const dcesaHtml = fs.readFileSync(path.join(root, 'tests/fixtures/dcesa.html'), 'utf8');
        const xkwCloudHtml = fs.readFileSync(path.join(root, 'tests/fixtures/xkw-cloud.html'), 'utf8');
        const qitianHtml = fs.readFileSync(path.join(root, 'tests/fixtures/qitian.html'), 'utf8');
        const xinjiaoyuHtml = fs.readFileSync(path.join(root, 'tests/fixtures/xinjiaoyu.html'), 'utf8');
        const hanhanHtml = fs.readFileSync(path.join(root, 'tests/fixtures/hanhan.html'), 'utf8');
        const xinkaoHtml = fs.readFileSync(path.join(root, 'tests/fixtures/xinkao.html'), 'utf8');
        const yuejuantongHtml = fs.readFileSync(path.join(root, 'tests/fixtures/yuejuantong.html'), 'utf8');
        const bundle = fs.readFileSync(path.join(root, 'dist/ai_marker.user.js'));
        client.onEvent(event => {
            if (event.method === 'Network.loadingFailed' && !event.params.canceled) {
                consoleMessages.push('Network: ' + JSON.stringify({ error: event.params.errorText,
                    blocked: event.params.blockedReason, cors: event.params.corsErrorStatus }));
                if (consoleMessages.length > 16) consoleMessages.shift();
            }
            if (event.method === 'Network.loadingFailed' && (event.params.canceled || event.params.errorText === 'net::ERR_ABORTED')) cancelledRequests.add(event.params.requestId);
            if (event.method === 'Runtime.exceptionThrown') {
                consoleMessages.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
            }
            if (event.method === 'Runtime.consoleAPICalled') {
                consoleMessages.push(event.params.args.map(arg => arg.value ?? arg.description).join(' ').slice(0, 1500));
                if (consoleMessages.length > 16) consoleMessages.shift();
            }
            if (event.method !== 'Fetch.requestPaused') return;
            const requestNavigation = navigation;
            (async () => {
                const url = new URL(event.params.request.url);
                let body = '', type = 'text/plain', status = 404;
                if (url.hostname === 'www.xinjiaoyu.com') {
                    if (url.pathname === '/teacher/grading_center/homework/2/class/3/grading_by_question/17') {
                        body = xinjiaoyuHtml; type = 'text/html; charset=utf-8'; status = 200;
                    } else if (url.pathname === '/dist/ai_marker.user.js') {
                        body = bundle; type = 'application/javascript'; status = 200;
                    }
                } else if (url.hostname === 'wz.yunyuejuan.net') {
                    if (url.pathname === '/index') {
                        body = hanhanHtml; type = 'text/html; charset=utf-8'; status = 200;
                    } else if (url.pathname === '/dist/ai_marker.user.js') {
                        body = bundle; type = 'application/javascript'; status = 200;
                    } else if (url.pathname === '/__fixture/answer.svg') {
                        body = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><text x="10" y="30">English practice</text></svg>';
                        type = 'image/svg+xml'; status = 200;
                    } else if (url.pathname === '/__fixture/save') {
                        const score = new URLSearchParams(event.params.request.postData).get('score');
                        status = event.params.request.method === 'POST' && score === '1' ? 200 : 400;
                    }
                } else if (url.hostname === '10.30.0.8' && ['/Marking/NormalReadPaper', '/Marking/DisPlay', '/biluo/display.jsp'].includes(url.pathname)) {
                    body = xinkaoHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (['www.yuejuantong.com', 'www.bfzks.com'].includes(url.hostname)
                    && url.pathname === '/mark/v6/view/fixture') {
                    body = yuejuantongHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 's3.taoweiedu.com' && url.pathname === '/web/main.jsp') {
                    body = taoweiHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 's3.taoweiedu.com' && url.pathname === '/web/mark/navi.jsp') {
                    body = taoweiPageHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 's3.taoweiedu.com' && url.pathname === '/dist/ai_marker.user.js') {
                    body = bundle; type = 'application/javascript'; status = 200;
                } else if (url.hostname === 'img-oss.sdzdf.com') {
                    body = '<svg xmlns="http://www.w3.org/2000/svg" width="1194" height="1428"><rect width="1194" height="1428" fill="white"/><text x="20" y="40">Composition practice</text></svg>'; type = 'image/svg+xml'; status = 200;
                } else if (url.hostname === 'ui.eiduo.com' && url.pathname === '/exam-webapp/marking/index') {
                    body = eiduoHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'ui.eiduo.com' && /^\/__fixture\/paper-[ab]\.svg$/.test(url.pathname)) {
                    body = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><text x="10" y="30">Physics practice</text></svg>';
                    type = 'image/svg+xml'; status = 200;
                } else if (url.hostname === 'dcesa.cn' && url.pathname === '/') {
                    body = dcesaHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'esabj.ks3-cn-beijing.ksyuncs.com' && /^\/__fixture\/paper-[ab]\.jpg$/.test(url.pathname)) {
                    body = yuandingbangJpeg; type = 'image/jpeg'; status = 200;
                } else if (url.hostname === 'dcesa.cn' && url.pathname === '/exam/area/marking/normal/saveMarkingGfbbz') {
                    const payload = JSON.parse(event.params.request.postData || '{}');
                    const outcome = url.searchParams.get('outcome');
                    const ok = event.params.request.method === 'POST' && payload.ksdyNo === 'sample-exam'
                        && payload.subjectId === 1 && payload.pjdId === 'sample-site'
                        && (payload.gfbbzList?.[0]?.score === 0 || payload.gfbbzList?.[0]?.score === 2) && outcome !== 'rejected';
                    body = JSON.stringify({ code: ok ? 1000 : 2000 });
                    type = 'application/json'; status = 200;
                } else if (url.hostname === 'xycp.xkw.com' && url.pathname === '/static-v2/exam/index.html') {
                    body = xkwCloudHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'xycp.xkw.com' && url.pathname === '/v2/exam/mark/submit') {
                    const payload = JSON.parse(event.params.request.postData || '{}');
                    const outcome = url.searchParams.get('outcome');
                    let result = { exist: false, resultType: 2 };
                    if (event.params.request.method === 'POST' && payload.questionId === 12) {
                        if (outcome === 'last' && payload.sheetId === 'sheet-b' && payload.score === 15) result = { exist: false, resultType: 1 };
                        if (['saved', 'shared-sheet'].includes(outcome) && payload.sheetId === 'sheet-a'
                            && payload.studentId === 'student-a' && payload.score === 3) {
                            const sheetId = outcome === 'shared-sheet' ? payload.sheetId : 'sheet-b';
                            result = { exist: true, resultType: 0, data: { questionId: 12, sheetId, studentId: 'student-b', urls: ['fixture'] } };
                        }
                    }
                    body = JSON.stringify(outcome === 'session-expired' ? { code: -2 } : { code: 200, data: result });
                    type = 'application/json'; status = 200;
                } else if (url.hostname === 'yyj-xkw-1357989693.cos.ap-beijing.myqcloud.com' && url.pathname.startsWith('/__fixture/')) {
                    body = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><text x="10" y="30">Math practice</text></svg>';
                    type = 'image/svg+xml'; status = 200;
                } else if (url.hostname === 'ebs.bsedu.com' && url.pathname === '/tasklist') {
                    body = baishiHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'ebs.bsedu.com' && url.pathname === '/stage-api/task/teacher/assignment') {
                    const payload = JSON.parse(event.params.request.postData || '{}');
                    const ok = event.params.request.method === 'PUT' && payload.id === 'paper-a' && payload.score === 1.5;
                    body = JSON.stringify({ code: ok ? 200 : 500 }); type = 'application/json'; status = 200;
                } else if (url.hostname === 'yj.7net.cc' && url.pathname === '/Review') {
                    body = qitianHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'yj.7net.cc' && /^\/src\/(?:adapters\/qitian\/(?:selectors|adapter)|core\/(?:score|prompt|runtime))\.js$/.test(url.pathname)) {
                    body = fs.readFileSync(path.join(root, url.pathname.slice(1))); type = 'application/javascript'; status = 200;
                } else if (url.hostname === 'yj.7net.cc' && url.pathname === '/Review/guid') {
                    body = url.searchParams.get('case') === 'failure' ? '-ERR rejected' : '+OK saved'; status = 200;
                } else if (url.hostname === 'yuejuan.yuandingbang.cn' && url.pathname === '/web/mark/sjpy/sjpy_kspy.jsp') {
                    body = yuandingbangHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'yuejuan-img.yuandingbang.cn') {
                    body = yuandingbangJpeg; type = 'image/jpeg'; status = 200;
                } else if (url.hostname === 'yuejuan.yuandingbang.cn' && url.pathname === '/dist/ai_marker.user.js') {
                    body = bundle; type = 'application/javascript'; status = 200;
                } else if (url.hostname === 'xinluolk.fjjxhl.com' && url.pathname === '/lypaper/Base/lyReadPaper.aspx') {
                    body = xiangshangxueHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'xinluolk.fjjxhl.com' && url.pathname === '/lypaper/Base/lyImage.aspx') {
                    body = '<svg xmlns="http://www.w3.org/2000/svg" width="1497" height="215"><rect width="1497" height="215" fill="white"/><text x="10" y="40">Fixture answer</text></svg>'; type = 'image/svg+xml'; status = 200;
                } else if (url.hostname === 'yy.eduer.co' && url.pathname === '/pages/exam/review/review.aspx') {
                    body = xiaoleyouyueHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'yyaitantao.oss-cn-shenzhen.aliyuncs.com') {
                    body = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect width="300" height="80" fill="white"/><text x="10" y="40">Fixture answer 17(3.4)</text></svg>';
                    type = 'image/svg+xml'; status = 200;
                } else if (['hx-webscan.tyhuixue.com', 'hx-webscan.hzjy.edu.cn'].includes(url.hostname) && ['/web-reviewer/', '/study-exam/'].includes(url.pathname)) {
                    body = huixueHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'liankao.1000cb.com' && url.pathname === '/Home/Mark') {
                    body = youfenHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'ls.xiaoxianai.cn' && ['/webPaper', '/webPaper/newMarkPaper'].includes(url.pathname)) {
                    body = xiaoxianaiHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'yue.haofenshu.com' && url.pathname.startsWith('/minions/subject/')) {
                    body = haofenshuHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'yue.haofenshu.com' && url.pathname.startsWith('/v1/baidu-raw/')) {
                    body = '<svg xmlns="http://www.w3.org/2000/svg" width="1494" height="673"><text x="10" y="40">fixture answer</text></svg>';
                    type = 'image/svg+xml'; status = 200;
                } else if (url.hostname === 'www.zhixue.com' && url.pathname === '/htm-container-web/index.html' && url.searchParams.has('multi-paper')) {
                    body = zhixueMultiPaperHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'www.zhixue.com' && url.pathname === '/webmarking/marking/personal/') {
                    body = url.searchParams.has('multi-paper') ? zhixueMultiPaperHtml :
                        url.searchParams.has('continuity') ? zhixueContinuityHtml : zhixueHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'www.zhixue.com' && url.pathname === '/tfbWowbookWeb/') {
                    body = url.searchParams.has('continuity') ? zhixueContinuityHtml : zhixueHomeworkHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'pyj.zhixue.com' && url.pathname === '/api-dihw-marking/online/sz/marking/modifyScore') {
                    const payload = JSON.parse(event.params.request.postData || '{}');
                    body = JSON.stringify({ code: payload.modifyScore === 7.5 ? '40000000' : '10000000' });
                    type = 'application/json'; status = 200;
                } else if (url.hostname === 'yuejuan.wzedu.cn' && url.pathname === '/static-v2/exam/index.html') {
                    body = wzeduHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'yuejuan.wzedu.cn' && url.pathname === '/v2/union/mark/submit') {
                    body = JSON.stringify({ code: 200, data: { exist: true } }); type = 'application/json'; status = 200;
                } else if (url.hostname === 'yuejuan.wzedu.cn' && url.pathname.startsWith('/r/deployment:/')) {
                    body = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><text x="10" y="40">fixture answer</text></svg>';
                    type = 'image/svg+xml'; status = 200;
                } else if (url.hostname === 'marking.jkxjxw.com' && ['/marking', '/task/taskDetail'].includes(url.pathname)) {
                    body = jiukexingHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.hostname === 'jzjx.jzsmartedu.cn' && url.pathname === '/dnpc/') {
                    body = jzsmarteduHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.pathname === '/OraOnlineCheck/OraCheck/Review') {
                    body = deploymentHtml;
                    if (url.hostname === 'crock.51zhenxue.com') body = body.replace(
                        '<script src="/Scripts/require.js" data-main="examOnlineOrc.js"></script>',
                        '<script src="/Scripts/app/dev/examOnlineOrc.js" data-requiremodule="examOnlineOrc"></script>');
                    if (url.searchParams.get('mode') === 'foreign-main') body = body
                        .replace('data-main="examOnlineOrc.js"', 'data-main="other.js"')
                        .replace('data-requiremodule="examOnlineOrc"', 'data-requiremodule="other"');
                    type = 'text/html; charset=utf-8'; status = 200;
                } else if (url.pathname === '/AMEQP/Webroot/mar/mar_mark.aspx') {
                    body = ameqpHtml; type = 'text/html; charset=utf-8'; status = 200;
                } else if (/^\/answers\/(?:\d+|scan_\d+)_\d+_\d+_\d+\.svg$/.test(url.pathname)
                    || /^\/answers\/生物地理_\d+\.svg$/.test(decodeURIComponent(url.pathname)) || url.pathname === '/answers/image.ashx') {
                    body = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><text x="10" y="40">answer ' + url.pathname + '</text></svg>';
                    type = 'image/svg+xml'; status = 200;
                } else if (url.pathname === '/__fixture/ai_marker.user.js') {
                    body = bundle; type = 'text/javascript; charset=utf-8'; status = 200;
                } else if (url.pathname === '/Scripts/require.js' || url.pathname === '/Scripts/app/dev/examOnlineOrc.js') {
                    type = 'text/javascript'; status = 200;
                } else if (url.pathname === '/__fixture/answer.svg'
                    || (url.hostname === 'bs-exam-bucket.oss-cn-beijing.aliyuncs.com' && url.pathname.startsWith('/__fixture/'))) {
                    body = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><text x="10" y="30">fixture answer</text></svg>';
                    type = 'image/svg+xml'; status = 200;
                }
                await client.send('Fetch.fulfillRequest', { requestId: event.params.requestId, responseCode: status,
                    responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Cache-Control', value: 'no-store' },
                        ...(['img-oss.sdzdf.com', 'bs-exam-bucket.oss-cn-beijing.aliyuncs.com', 'yyj-xkw-1357989693.cos.ap-beijing.myqcloud.com', 'esabj.ks3-cn-beijing.ksyuncs.com'].includes(url.hostname)
                            ? [{ name: 'Access-Control-Allow-Origin', value: '*' }] : []),
                        ...(url.hostname === 'pyj.zhixue.com' ? [
                            { name: 'Access-Control-Allow-Origin', value: 'https://www.zhixue.com' },
                            { name: 'Access-Control-Allow-Methods', value: 'POST,OPTIONS' },
                            { name: 'Access-Control-Allow-Headers', value: 'content-type' },
                        ] : []),
                        ...(url.hostname === 'yuejuan-img.yuandingbang.cn' ? [{ name: 'Access-Control-Allow-Origin', value: 'https://yuejuan.yuandingbang.cn' }] : [])],
                    body: Buffer.from(body).toString('base64') });
            })().catch(async error => {
                if (await isCancelledInterception(error, () => requestNavigation !== navigation || cancelledRequests.has(event.params.networkId))) {
                    cancelledInterceptions++;
                    return;
                }
                interceptionError = new Error(`${error.message} (${event.params.request.url}; request ${event.params.networkId}; navigation ${requestNavigation}/${navigation})`);
            });
        });
        for (const fixture of fixtures) for (const width of [1280, 420]) for (const theme of ['light', 'dark']) for (const touch of ['embedded-ui', 'diagnostic-export', 'zhixue-multi-paper', 'zhixue-multi-paper-container'].includes(fixture) ? [false, true] : [false]) {
            consoleMessages = [];
            await client.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
            await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
            await client.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 1 });
            const runId = `${fixture}-${width}-${theme}-${Date.now()}`;
            const startup = fixture.startsWith('startup');
            const mode = fixture === 'startup-registration' ? 'late-registration' : fixture === 'startup-navigation' ? 'spa-entry' : 'late-dom';
            const deployment = fixture.startsWith('qiguang-');
            const ameqp = fixture.startsWith('ameqp-');
            const jzsmartedu = fixture.startsWith('jzsmartedu-');
            const jiukexing = fixture.startsWith('jiukexing-');
            const haofenshu = fixture === 'haofenshu';
            const yuandingbang = fixture === 'yuandingbang';
            const qitian = fixture === 'qitian';
            const xinjiaoyu = fixture === 'xinjiaoyu';
            const hanhan = fixture === 'hanhan';
            const taowei = fixture === 'taowei';
            const markview = ['yuejuantong', 'bfzks'].includes(fixture);
            const baishi = fixture === 'baishi';
            const xkwCloud = fixture === 'xkw-cloud';
            const eiduo = fixture === 'eiduo';
            const dcesa = fixture === 'dcesa';
            const xinkao = fixture.startsWith('xinkao-');
            const zhixue = ['zhixue', 'zhixue-continuity-exam', 'zhixue-multi-paper', 'zhixue-multi-paper-container'].includes(fixture);
            const zhixueHomework = fixture === 'zhixue-homework' || fixture === 'zhixue-continuity-homework';
            const continuity = fixture.startsWith('zhixue-continuity-') ? '&continuity=1' : '';
            const wzedu = fixture.startsWith('wzedu-');
            const huizhou = fixture.startsWith('huizhou-');
            const huixue = fixture.startsWith('huixue-') || huizhou;
            const xiaoxianai = fixture.startsWith('xiaoxianai-');
            const xiangshangxue = fixture.startsWith('xiangshangxue-');
            const youfen = fixture.startsWith('youfen-');
            const xiaoleyouyue = fixture.startsWith('xiaoleyouyue-');
            let url = pathToFileURL(path.join(root, `tests/fixtures/${startup ? 'startup' : fixture}.html`)).href + '?run=' + runId + '&mode=' + mode;
            if (deployment || ameqp || jzsmartedu || jiukexing || zhixue || zhixueHomework || haofenshu || wzedu || xiaoxianai || huixue || youfen || xiaoleyouyue || xiangshangxue || yuandingbang || qitian || hanhan || xinjiaoyu || taowei || xinkao || markview || baishi || xkwCloud || eiduo || dcesa) {
                if (!interceptionEnabled) { await client.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }); interceptionEnabled = true; }
                const origin = zhixue ? 'https://www.zhixue.com' : fixture.startsWith('qiguang-zhenxue-') ? 'https://crock.51zhenxue.com'
                    : fixture === 'qiguang-original-deployment' ? 'http://120.78.5.37:8091'
                    : fixture === 'qiguang-domain-deployment' ? 'https://mark.school.example'
                    : fixture === 'qiguang-private-deployment' ? 'http://10.15.0.8:8089' : 'http://192.0.2.20:8091';
                const deploymentMode = fixture === 'qiguang-late-deployment' || fixture === 'qiguang-zhenxue-late' ? 'late'
                    : fixture === 'qiguang-module-negative' || fixture === 'qiguang-zhenxue-module-negative' ? 'foreign-main'
                    : fixture === 'qiguang-form-negative' ? 'foreign-form' : 'ready';
                url = origin + '/OraOnlineCheck/OraCheck/Review?run=' + runId + '&mode=' + deploymentMode + '&SubjectId=subject&questionGroupId=group';
                if (ameqp) url = 'http://10.20.0.8/AMEQP/Webroot/mar/mar_mark.aspx?run=' + runId + '&mode=' + fixture.slice(6);
                if (jzsmartedu) {
                    const jzMode = fixture.slice(11);
                    const route = jzMode === 'spa' ? '/home' : jzMode === 'foreign-route' ? '/v2/read-paper/question-block' : '/v2/read-paper';
                    url = 'https://jzjx.jzsmartedu.cn/dnpc/?run=' + runId + '&mode=' + jzMode
                        + '#' + route + '?examPaperId=exam&readBlockId=block&readPaperType=1';
                }
                if (jiukexing) url = 'https://marking.jkxjxw.com/' + (fixture === 'jiukexing-spa' ? 'task/taskDetail' : 'marking')
                    + '?run=' + runId + '&mode=' + fixture.slice(10) + '&examId=exam&subjectId=subject&questionBlockId=block&isdp=1';
            }
            if (haofenshu) url = 'https://yue.haofenshu.com/minions/subject/10500001/mark/1/normal/0?run=' + runId;
            if (yuandingbang) url = 'https://yuejuan.yuandingbang.cn/web/mark/sjpy/sjpy_kspy.jsp?ksdm=100&kmdm=B21&stbh=2&run=' + runId;
            if (taowei) url = 'http://s3.taoweiedu.com/web/main.jsp?run=' + runId;
            if (markview) url = (fixture === 'bfzks' ? 'https://www.bfzks.com' : 'http://www.yuejuantong.com')
                + '/mark/v6/view/fixture?run=' + runId;
            if (eiduo) url = 'https://ui.eiduo.com/exam-webapp/marking/index?examId=1&subjectId=2&isArbitrate=false&check=false&run=' + runId;
            if (dcesa) url = 'https://dcesa.cn/?run=' + runId + '#/exam/area/sample-exam';
            if (xkwCloud) url = 'https://xycp.xkw.com/static-v2/exam/index.html?run=' + runId + '#/exam/index';
            if (baishi) url = 'https://ebs.bsedu.com/tasklist?projectId=exercise&run=' + runId;
            if (qitian) url = 'https://yj.7net.cc/Review?th=15&km=chemistry&run=' + runId;
            if (xinjiaoyu) url = 'https://www.xinjiaoyu.com/teacher/grading_center/homework/2/class/3/grading_by_question/17?run=' + runId;
            if (hanhan) url = 'http://wz.yunyuejuan.net/index?run=' + runId + '#/marking/grading?questionId=72';
            if (xinkao) url = 'http://10.30.0.8' + (fixture === 'xinkao-intranet' ? '/biluo/display.jsp' : fixture === 'xinkao-public' ? '/Marking/DisPlay' : '/Marking/NormalReadPaper') + '?mode=' + fixture.slice(7) + '&run=' + runId;
            if (zhixue) url = 'https://www.zhixue.com/webmarking/marking/personal/?run=' + runId + continuity +
                (fixture === 'zhixue-multi-paper' ? '&multi-paper=1' : '');
            if (fixture === 'zhixue-multi-paper-container') url = 'https://www.zhixue.com/htm-container-web/index.html?run=' +
                runId + '&multi-paper=1&app-1=' + encodeURIComponent(encodeURIComponent('/webmarking/demo/#/marking/personal/'));
            if (zhixueHomework) url = 'https://www.zhixue.com/tfbWowbookWeb/?run=' + runId + continuity + '#/smarthw/?hwId=homework-fixture&classId=fixture-class';
            if (wzedu) url = 'https://yuejuan.wzedu.cn/static-v2/exam/index.html?run=' + runId + '&mode=' + fixture.slice(6)
                + (fixture === 'wzedu-spa' ? '#/marking/gradingList/list' : '#/marking/grading?questionId=42&choiceIndex=0')
                + (fixture === 'wzedu-review' ? '&review=true&thisType=2&toNext=false' : '');
            if (huixue) url = 'https://' + (huizhou ? 'hx-webscan.hzjy.edu.cn' : 'hx-webscan.tyhuixue.com')
                + '/web-reviewer/?run=' + runId + '&mode=' + fixture.slice(huizhou ? 8 : 7) + (fixture.endsWith('-spa') ? '#/home' : '#/generalReview');
            if (xiangshangxue) url = 'https://xinluolk.fjjxhl.com/lypaper/Base/lyReadPaper.aspx?run=' + runId + '&mode=' + fixture.slice(14);
            if (youfen) url = 'http://liankao.1000cb.com/Home/Mark?run=' + runId;
            if (xiaoleyouyue) url = 'https://yy.eduer.co/pages/exam/review/review.aspx?subjectid=10&blockid=20&id=30&type=0&run=' + runId + '&mode=' + fixture.slice(13);
            if (xiaoxianai) url = 'https://ls.xiaoxianai.cn/webPaper/newMarkPaper?run=' + runId + '&mode=' + fixture.slice(11);
            await client.send('Emulation.setFocusEmulationEnabled', { enabled: fixture === 'embedded-ui' || fixture.startsWith('zhixue-multi-paper') });
            navigation++;
            if (interceptionEnabled && url.startsWith('file:')) {
                await client.send('Fetch.disable');
                interceptionEnabled = false;
            }
            await client.send('Page.navigate', { url });
            let result;
            for (let count = 0; count < (ameqp || zhixue ? 650 : startup || eiduo ? 400 : 200); count++) {
                if (interceptionError) throw interceptionError;
                const reply = await client.send('Runtime.evaluate', { expression: "document.getElementById('result')?.textContent || ''", returnByValue: true });
                if (reply.result?.value) {
                    const candidate = JSON.parse(Buffer.from(reply.result.value, 'base64').toString());
                    if (candidate.runId === runId) { result = candidate; break; }
                }
                await pause(50);
            }
            if (!result?.passed || Math.abs(result.width - width) > 1) {
                const page = await client.send('Runtime.evaluate', { expression: 'document.body.innerText.slice(-3000)', returnByValue: true });
                throw Error(JSON.stringify({ ...(result || { error: 'No browser result' }), consoleMessages, page: page.result?.value }));
            }
            results.push({ fixture, width, theme, touch, ...result });
        }
        if (interceptionError) throw interceptionError;
        console.log(JSON.stringify({ passed: true, cancelledInterceptions, results }));
    } finally {
        client?.socket.close();
        if (browserClient) { try { await browserClient.send('Browser.close'); } catch (_) {} browserClient.socket.close(); }
        await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(2000)]);
        if (child.exitCode == null) child.kill();
        // The absolute target was created by mkdtemp directly under the OS temp directory.
        if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('aimarker-browser-')) {
            try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (_) {}
        }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });

