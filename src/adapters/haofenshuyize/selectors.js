// ========== 好分数书仪泽 DOM 选择器常量 ==========
// haofenshuyize.com — Vue 3 + Element Plus

const HAOFENSHUYIZE_SELECTORS = {
    // 答题卡图片（Element Plus el-image 组件）
    ANSWER_IMAGE: '.el-image__inner',

    // 分数输入框（Element Plus el-input）
    // 注意：el-input 的 input 元素在 .el-input__wrapper 内部
    SCORE_INPUT: 'input[placeholder="请给分"]',
    SCORE_INPUT_WRAPPER: '.el-input__wrapper',

    // 其他输入框（可能干扰，需要排除）
    SCORE_INPUT_FILTER: 'input[placeholder="请输入"]',

    // 提交按钮
    SUBMIT_BUTTON: '.submitscorebtn',
    SUBMIT_BUTTON_TEXT: '给分',

    // 一键给分下拉
    QUICK_SCORE_DROPDOWN: '.el-dropdown-link',

    // 页面检测
    PAGE_DETECT_IMAGE: '.el-image__inner',
    PAGE_DETECT_INPUT: 'input[placeholder="请给分"]',
    PAGE_DETECT_SUBMIT: '.submitscorebtn',

    // 主容器
    MAIN_CONTAINER: '.aix-content',
};
