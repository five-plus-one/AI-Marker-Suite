// ========== 酷鱼网 DOM 选择器常量 ==========
// jQuery 传统页面 + Canvas 答题卡（ems-imageview 插件），域名: www.kuyuu.cn
// 特点：canvas.ems-iv-img 跨域 tainted 不可 toDataURL，答题卡真身在阿里云 OSS（ky-metacut），
//       取图走 Performance 条目 + 可见文本试卷号锁定；评分走键/鼠/批三模式切换

const KUYUU_SELECTORS = {
    // 页面检测
    PAGE_DETECT_CONTAINER: '#readView.ems-iv-container',
    PAGE_DETECT_SCORE_PANEL: '#scorePanel.plg-score-panel',

    // 答题卡 Canvas（跨域 tainted，不能 toDataURL）
    ANSWER_CANVAS: 'canvas.ems-iv-img',
    IMAGE_CONTAINER: '#readView',

    // 分数输入框（「键」模式表格）
    SCORE_INPUT: '#scorePanel table.plg-score-table tr.key-tr input[type="text"]',
    SCORE_ROW: '#scorePanel table.plg-score-table tr.key-tr',
    MAX_SCORE_CELL: 'td.first-td',

    // 打分模式切换（键/鼠/批）
    KEYBOARD_MODE: 'a[scoretype="key"]',

    // 快捷按钮
    FULL_SCORE_BUTTON: '#scorePanel a[btntype="full"]',
    ZERO_SCORE_BUTTON: '#scorePanel a[btntype="zero"]',

    // 提交按钮
    SUBMIT_BUTTON: '#scorePanel a[btntype="submit"]',

    // 分数确认开关（开启时提交可能弹确认）
    CONFIRM_SWITCH: '#scorePanel .plg-switch .switch',

    // 页脚当前试卷号（实测：#infoTasktype 文本形如「正常卷：5580018」）
    TASK_PAPER_ID: '#infoTasktype',

    // UI 资源前缀（过滤 Performance API 中的背景图）
    UI_ASSET_PREFIX: '/public/images/plugins/',
};
