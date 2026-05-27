// ========== 九科星 DOM 选择器常量 ==========
// Vue SPA 页面，答题卡使用 OBS 图片裁剪（多图拼接）
// 域名: marking.jkxjxw.com

const JIUKEXING_SELECTORS = {
    // 答题卡图片（多图拼接，需全部获取）
    ANSWER_IMAGE: '.examText .imgBG img',
    IMAGE_CONTAINER: '.examText .imgBG',

    // 分数输入框（多小题模式）
    SCORE_INPUT: '.input_btn.specialInput',

    // 小题容器（包含题号 h1 和输入框）
    QUESTION_GRADE: '.quesGrade',
    QUESTION_LABEL: '.quesGrade h1',

    // 提交按钮
    SUBMIT_BUTTON: '.submitbtn',

    // 页面检测
    PAGE_DETECT_IMAGE: '.examText .imgBG img',
    PAGE_DETECT_INPUT: '.input_btn.specialInput',
    PAGE_DETECT_SUBMIT: '.submitbtn',

    // 主容器
    MAIN_CONTAINER: '#app',

    // 满分/零分快捷按钮
    FULL_SCORE_BTN: '.grades .all',
    ZERO_SCORE_BTN: '.grades .zero',
};
