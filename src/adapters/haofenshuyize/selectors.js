// ========== 好分数书仪泽 DOM 选择器常量 ==========
// haofenshuyize.com — Vue 3 + Element Plus

const HAOFENSHUYIZE_SELECTORS = {
    // 答题卡图片（Element Plus el-image 组件）
    ANSWER_IMAGE: '.el-image__inner',

    // 分数输入框（Element Plus el-input，readonly，不能直接赋值）
    SCORE_INPUT: 'input[placeholder="请给分"]',

    // 快捷分数按钮（0, 1, 2, ..., maxScore）
    SCORE_ITEM_BUTTONS: '.scoreitem',

    // 满分/零分快捷按钮
    FULL_SCORE_BUTTON: '.el-button--success',
    ZERO_SCORE_BUTTON: '.el-button--danger',

    // 提交按钮
    SUBMIT_BUTTON: '.submitscorebtn',
    SUBMIT_BUTTON_TEXT: '给分',

    // 题目标题（含满分信息，如 "二、非选择题 35(8分)"）
    QUESTION_TITLE: '.questiontitle',

    // 一键给分下拉
    QUICK_SCORE_DROPDOWN: '.el-dropdown-link',

    // 页面检测
    PAGE_DETECT_IMAGE: '.el-image__inner',
    PAGE_DETECT_INPUT: 'input[placeholder="请给分"]',
    PAGE_DETECT_SUBMIT: '.submitscorebtn',

    // 主容器
    MAIN_CONTAINER: '.aix-content',
};
