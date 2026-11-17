// ========== 鑫考(内网版) DOM 选择器常量 ==========
// /biluo/display.jsp — jQuery 传统页面，内网裸 IP 部署
// 与现有 xinkao (/Marking/DisPlay) 是两套系统：满分在 fen 属性、提交走 inputkey(']')
// 提交按钮 onclick="inputkey(']')"，与云阅卷(yunyuejuan)同源

const XINKAO2_SELECTORS = {
    // 答题卡图片（相对路径 image?type=jpeg&p=TOKEN，需拼绝对 URL）
    ANSWER_IMAGE: '#pic, img.teaimg',
    ANSWER_IMAGE_CLASS: 'img.teaimg',

    // 小题分数输入（多小题时多个，id 形如 fenshu0/fenshu1...）
    SCORE_INPUTS: 'input.fenshu',
    SCORE_ROW: '#xtlist tr',
    SCORE_LABEL: '#btag',  // 实际用 #btag{i} 对应 fenshu{i}

    // 附加分输入框（默认隐藏 #fjfenbox）
    BONUS_INPUT: '#fjf',
    BONUS_BOX: '#fjfenbox',

    // 满分显示
    MAX_SCORE_DISPLAY: '#teafen',

    // 提交按钮（onclick="inputkey(']')"）与隐藏提交 input
    SUBMIT_BUTTON: '#submitbtn',
    SUBMIT_HIDDEN: '#submit',

    // 回评入口
    REGRADE_LINK: '#caidan2',

    // 页面检测
    PAGE_DETECT_IMAGE: '#pic',
    PAGE_DETECT_INPUT: 'input.fenshu',
    PAGE_DETECT_SUBMIT: '#submitbtn',
};
