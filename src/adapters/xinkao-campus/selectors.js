// ========== 鑫考校园 6.0 DOM 选择器常量 ==========
// /Marking/NormalReadPaper — jQuery 传统页面，内网裸 IP:端口部署（IP 不固定）
// 云阅卷家族分支（源码自证「云阅卷wx_自改」），与 xinkao-2 同底座不同补丁：
//   满分在 data-score 属性（xinkao-2 是 fen）、提交走 inputkey(']')，最后一个小题时调 submit() 交卷并自动换卷

const XINKAO_CAMPUS_SELECTORS = {
    // 答题卡图片（id 形如 pic0/pic1...，src 带 examcode/picName/path token，换卷时 token 变化）
    ANSWER_IMAGE: 'img.teaimg',

    // 小题分数输入（多小题时多个，id 形如 fenshu0/fenshu1...）
    SCORE_INPUTS: 'input.fenshu',
    SCORE_ROW: 'tr',  // 每个输入框所在行，label 取第一列文本（如 "13-17(+12)"）

    // 满分显示（合计分）
    MAX_SCORE_DISPLAY: '.teaScore',

    // 主容器
    MAIN_CONTAINER: '#div-readPaper',

    // 页面检测（无独立提交按钮，inputkey 函数存在即为阅卷页特征）
    PAGE_DETECT_IMAGE: 'img.teaimg',
    PAGE_DETECT_INPUT: 'input.fenshu',
};
