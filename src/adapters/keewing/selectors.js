// ========== 科耘阅卷平台 DOM 选择器常量 ==========
// kaoshi.keewing.com — Vue + Element UI
// 图片通过 SVG <image> 标签渲染（xlink:href）
// 评分通过输入框 + 满分/零分快捷按钮

const KEEWING_SELECTORS = {
    // 答题卡图片容器
    IMAGE_CONTAINER: '.subjectmark_content_svg',
    // SVG 中的 image 标签
    SVG_IMAGE: '.subjectmark_content_svg image, .svg-wrapper image',

    // 分数输入框
    SCORE_INPUT: '.score-input',
    SCORE_INPUT_PLACEHOLDER: 'input.score-input[placeholder*="满分"]',

    // 满分/零分快捷按钮
    FULL_SCORE_BUTTON: 'button.bg-lightgreen.el-button--primary',
    ZERO_SCORE_BUTTON: 'button.bg-main.el-button--danger',

    // 提交按钮
    SUBMIT_BUTTON: 'button.submit-button.el-button--primary',

    // 自动提交复选框
    AUTO_SUBMIT_CHECKBOX: '.submit-auto .el-checkbox__original',

    // 打分栏容器
    SCORING_BOARD: '#scoringBoard.quick-mark',

    // 分数列表区域
    SCORE_LIST: '.score-list',
    SCORE_BTN_LAYOUT: '.score-btn-layout',

    // 页面检测
    PAGE_DETECT_IMAGE: '.subjectmark_content_svg image',
    PAGE_DETECT_SCORE: '.score-input',
    PAGE_DETECT_SUBMIT: 'button.submit-button',
    PAGE_DETECT_BOARD: '#scoringBoard',

    // 题号标签
    BLOCK_TITLE: '.block-title',

    // 暂不打分按钮
    SKIP_BUTTON: 'button:has(span:contains("暂不打分"))',

    // 确认弹窗
    CONFIRM_DIALOG: '.el-message-box__btns button, .el-dialog__footer button',

    // 回评模式检测
    REGRADE_INDICATOR: '.content-progress',
};
