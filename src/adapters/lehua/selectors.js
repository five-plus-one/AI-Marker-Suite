// ========== 乐华阅卷 DOM 选择器常量 ==========
// main.lhsvr.cn — Vue + Element UI + Canvas 渲染答题卡

const LEHUA_SELECTORS = {
    // 答题卡 Canvas（主内容区域）
    ANSWER_CANVAS: 'canvas',

    // 点击式评分按钮（0-N 分）
    SCORE_BUTTON: '.score-btn',
    SCORE_BUTTON_ACTIVE: '.score-btn.active, .score-btn.selected',
    SCORE_BUTTON_ZERO: '.score-btn.is-zero',
    // 满分按钮（文本含「满」，如 "15 满"，不能按纯数字全等匹配）
    SCORE_BUTTON_FULL: '.score-btn.is-full',

    // 分数输入框（备用；须限定 input，避免命中 el-input-number 的 DIV）
    SCORE_INPUT: 'input.score-input',

    // 提交按钮
    SUBMIT_BUTTON_PRIMARY: 'button.el-button--primary',

    // 页面检测元素
    PAGE_DETECT_CANVAS: 'canvas',
    PAGE_DETECT_SCORE: '.score-btn',
    PAGE_DETECT_SUBMIT: 'button.el-button--primary',

    // 回评相关（待确认）
    REGRADE_INDICATOR: '.back-up-btn, [class*="regrade"], [class*="review"]',
};
