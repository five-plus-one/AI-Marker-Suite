// 启光优测实测页面的匿名结构，仅保留平台识别所需关系。
const ROUTE = '/OraOnlineCheck/OraCheck/Review';
function signature(options = {}) {
    const form = {};
    const input = { form, getAttribute: key => ({ 'data-id': 'fixture', 'data-max': '5' }[key] ?? null) };
    const submit = { form };
    form.querySelector = selector => ({ 'input[name="score"][data-id][data-max]': input,
        'button#btn-submit-score[type="submit"]': submit }[selector] || null);
    const script = { getAttribute: key => ({ src: options.src || '/Scripts/require.js?version=fixture',
        'data-main': options.main ?? 'examOnlineOrc.js', 'data-requiremodule': options.module ?? null }[key] ?? null) };
    return { 'form#form-scoring': form, 'canvas#scoring-item': {}, '#paperID': {}, '#myRead': {}, 'script[src]': script };
}
const deployments = [
    { label: '启光原部署', host: '120.78.5.37', port: '8091', protocol: 'http:', path: ROUTE, dom: signature() },
    { label: '启光原部署端口变化', host: '120.78.5.37', port: '9091', protocol: 'http:', path: ROUTE, dom: signature() },
    { label: '启光其他公网 IP', host: '192.0.2.20', port: '8091', protocol: 'http:', path: ROUTE, dom: signature() },
    { label: '启光学校内网 IP', host: '10.15.0.8', port: '8089', protocol: 'http:', path: ROUTE, dom: signature() },
    { label: '启光学校域名 HTTPS', host: 'mark.school.example', protocol: 'https:', path: ROUTE, dom: signature() },
    { label: '启光 IPv6 部署', host: '[2001:db8::20]', port: '8091', protocol: 'http:', path: ROUTE, dom: signature() },
    { label: '启光模块加载签名', host: 'module.school.example', path: ROUTE,
      dom: signature({ src: '/Scripts/app/dev/examOnlineOrc.js?version=fixture', main: '', module: 'examOnlineOrc' }) },
    { label: '诊学网统考部署', host: 'crock.51zhenxue.com', protocol: 'https:', path: ROUTE, name: '诊学网',
      dom: signature({ src: '/Scripts/app/dev/examOnlineOrc.js?version=fixture', main: '', module: 'examOnlineOrc' }) },
    { label: '诊学网同结构部署', host: 'school.51zhenxue.com', protocol: 'https:', path: ROUTE, name: '诊学网', dom: signature() },
];
function rejections() {
    const missing = ['form#form-scoring', 'canvas#scoring-item', '#paperID', '#myRead', 'script[src]']
        .map(key => ({ label: '启光缺少 ' + key, dom: { ...signature(), [key]: null } }));
    const orphan = signature();
    orphan['form#form-scoring'].querySelector('button#btn-submit-score[type="submit"]').form = {};
    return [...missing,
        { label: '启光提交按钮属于其他表单', dom: orphan },
        { label: '启光模块指向外站', dom: signature({ src: 'https://foreign.example/Scripts/require.js' }) },
        { label: '启光近似启动模块名', dom: signature({ main: 'examOnlineOrc.js.other' }) },
        { label: '启光近似资源路径', dom: signature({ src: '/Scripts/require.js.other' }) },
        { label: '启光模块名仅在查询参数', dom: signature({ src: '/other.js?path=/Scripts/require.js' }) },
        { label: '启光模块元数据错误', dom: signature({ src: '/Scripts/app/dev/examOnlineOrc.js', main: '', module: 'other' }) },
        { label: '启光入口仅在 hash', path: '/', hash: '#' + ROUTE, dom: signature() },
        { label: '启光近似阅卷路径', path: ROUTE + 'History', dom: signature() },
        { label: '诊学网教师门户', host: 'lhljw.51zhenxue.com', path: '/SchVTeacherHome/TeacherView/6', dom: signature() },
        { label: '诊学网校内任务入口', host: 'lhtest.51zhenxue.com', path: '/markingEntrance', dom: signature() },
        { label: '诊学网统考工作台', host: 'credu.51zhenxue.com', path: '/Home/TeacherIndex3', dom: signature() },
        { label: '诊学网缺少评分表单', host: 'crock.51zhenxue.com', dom: { ...signature(), 'form#form-scoring': null } },
    ].map(form => ({ host: 'other.school.example', path: ROUTE, ...form }));
}
module.exports = { ROUTE, signature, deployments, rejections };
