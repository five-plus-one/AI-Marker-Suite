// ========== 正确阅卷 DOM 选择器常量 ==========
// www.yuejuan.com — jQuery + layui 传统页面
// 答题卡：<img class="studentAnswerImg">（外层 .preview-box.ctrl-hover 有 transform 缩放/拖拽，
//        只影响显示不影响原图 URL；img 带 data-width/data-height/data-scale 属性）
// 评分：打分板点击式 #scoreItemBox div[data-score]（整数 0..满分）+ 小键盘输入框 #inp_singleTestScore
//       满分/零分快捷钮 #fullScoreBtn / #zeroScoreBtn，题号+满分显示 #sp_testScore（如「17(12分)」）
// 提交：「提交分数」按钮（submitScoreBtnClick）。「自动提交」「鼠标右键提交」为默认 OFF 的开关，
//       小键盘模式才有「输入分值+Enter 提交」，点击打分板本身不自动交卷
// 注意：layui 自绘 select 的 .layui-input 是只读下拉触发器，不是分数框，禁止泛匹配

const YUEJUAN_SELECTORS = {
    // 答题卡图片（唯一渲染点）
    ANSWER_IMAGE: '.studentAnswerImg',

    // 分数输入框（小键盘模式输入框，始终在 DOM 中；oninput=numberCheck 仅做数字净化）
    SCORE_INPUT: '#inp_singleTestScore',

    // 打分板点击式分值（整数 0..满分；不要匹配加分/减分区的 .partPointScoreingBox 按钮）
    SCORE_ITEM: '#scoreItemBox div[data-score]',

    // 满分/零分快捷按钮（data-score 分别为满分与 0）
    FULL_SCORE_BUTTON: '#fullScoreBtn',
    ZERO_SCORE_BUTTON: '#zeroScoreBtn',

    // 题号+满分显示（如「17(12分)」）
    QUESTION_LABEL: '#sp_testScore',

    // 提交按钮（「提交分数」，固定在 #submitScoreBox 内）
    SUBMIT_BUTTON: '#submitScoreBox button.layui-btn',

    // 打分板面板（页面检测锚点）
    SCORE_PANEL: '#scoringPlate',

    // 答题卡呈现区
    ANSWER_BOX: '#stuAnswerShowBox',

    // 回评模式：「退出回评」按钮可见 = 处于回评
    EXIT_REGRADE_TEXT: '退出回评',
};
