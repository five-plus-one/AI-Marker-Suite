// ========== A佳教育在线阅卷 DOM 选择器常量 ==========
// jQuery 传统页面（requirejs 模块化），y.ajia.cn/html/page/marking.html
// DOM 结构经两轮诊断脚本实测确认（2026-10）

const AJIA_SELECTORS = {
    // 页面检测
    PAGE_DETECT_IMAGE: '#markImageContainer .sub-img-container img',
    PAGE_DETECT_INPUT: '#markSubjectList input.num-source',
    PAGE_DETECT_SUBMIT: '#key_code_submit',

    // 答题卡图片（每个 .sub-img-container 一张裁剪图，与 #markSubjectList 行序号一一对应）
    // img.src 与 canvas[data-src] 解码后一致，统一取 img.src
    ANSWER_PANEL: '#markImageContainer .sub-img-container',
    ANSWER_IMAGE: '#markImageContainer .sub-img-container img',

    // 分数输入：常规打分板每行一个（多行 = 同一学生多个题）
    SCORE_ROW: '#markSubjectList tr',
    SCORE_ROW_ACTIVE: '#markSubjectList tr.active',
    SCORE_INPUT: '#markSubjectList input.num-source',
    QUESTION_LABEL: '.ellipsis',
    FULLSCORE: 'td.fullscore',

    // 小题输入（快捷/分步打分板模式下使用，常规模式 #subQuestionList 为空）
    SUB_SCORE_LIST: '#subQuestionList',
    SUB_SCORE_ITEM: '#subQuestionList li',
    SUB_SCORE_INPUT: '#subQuestionList li input.input',

    // 提交（数字键盘上的「确定」= 保存并自动翻卷）
    SUBMIT_BUTTON: '#key_code_submit',

    // 换卷检测（hidden 字段，每卷一份）
    STUDENT_ID: 'input.studentId',
    QUESTION_NO: 'input.questionNo',
    QUESTION_HISTORY: 'input.questionHistory',
    REVIEW: 'input.review',
    IS_FINAL: 'input.isFinal',

    // 回评模式：「退出回评」由 hidden 变可见
    LINK_OUT: '.link-out',
    LINK_HISTORY: '.link-history',
};
