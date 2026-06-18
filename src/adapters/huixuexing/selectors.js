// ========== 慧学星 DOM 选择器常量 ==========
// www.hxxai.com — jQuery 传统页面，分步骤评分模式
// 图片使用 OSS 托管（oss.hxxai.com / oss.jkydata.com），带裁剪参数

const HUIXUEXING_SELECTORS = {
    // 答题卡图片（OSS 托管，支持多域名）
    ANSWER_IMAGE: 'img[src*="oss.hxxai.com"], img[src*="oss.jkydata.com"]',
    // 答题卡图片（DOM 结构兜底，不依赖 OSS 域名）
    ANSWER_IMAGE_BY_STRUCTURE: '#wrapperPaper .papers-img img',

    // 总分输入框（自动汇总各步骤分数，readonly）
    SCORE_INPUT: '#scoreMine',

    // 分步骤输入框（readonly，通过满分/零分按钮或分数按钮设置）
    STEP_INPUT_PREFIX: '#stepScoreInput',
    STEP_INPUT_BY_INDEX: (i) => `#stepScoreInput${i}`,
    STEP_LI: '.step-li',

    // 步骤满分/零分按钮
    STEP_FULL_BTN: '.step-li .btn-green-o',
    STEP_ZERO_BTN: '.step-li .btn-red-o',

    // 满分/零分快捷按钮（顶部）
    TOP_FULL_BTN: '.top-btns .btn-green',
    TOP_ZERO_BTN: '.top-btns .btn-red',

    // 分数按钮区域（可点击的分数值）
    SCORE_BTNS_CONTAINER: '#scoreBtns',
    SCORE_BTNS_ITEM: '#scoreBtns .li .score',

    // 提交按钮（"提交分数"）
    SUBMIT_BUTTON: '.input-group-btn .btn-blue-all',

    // 问题卷按钮
    PROBLEM_PAPER_BUTTON: 'button.btn-blue-all.mr5',

    // 分数间隔选择器
    SCORE_INTERVAL_SELECT: '.score-order-box select',

    // 自动提交复选框
    AUTO_SUBMIT_CHECKBOX: 'input[name="autoSubmit"]',

    // 回评相关
    REGRADE_TEXT_CHECK: '回评',

    // 页面检测选择器
    PAGE_DETECT_IMAGE: 'img[src*="oss.hxxai.com"], img[src*="oss.jkydata.com"]',
    PAGE_DETECT_INPUT: '#scoreMine',
    PAGE_DETECT_STEP_INPUT: '#stepScoreInput0',
    PAGE_DETECT_SUBMIT: '.input-group-btn .btn-blue-all',
};
