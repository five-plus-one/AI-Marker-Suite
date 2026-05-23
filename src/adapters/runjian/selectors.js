// ========== 润建学情大数据精准分析平台 DOM 选择器常量 ==========
// aisusheng.runjian.com — Vue 2 + Element UI + fabric.js Canvas
// 图片通过 CSS background-image 渲染，评分通过点击按钮

const RUNJIAN_SELECTORS = {
    // 答题卡图片容器（CSS background-image，带 imageMogr2/cut 裁切参数）
    IMAGE_BOX: '.img-box',
    IMAGE_BOX_BG: '.read-paper__view .img-box',

    // 评分按钮（点击式，一键给分模式）
    SCORE_BUTTON: '.score-item-button',
    SCORE_BUTTON_SPAN: '.score-item-button span',

    // 满分/零分快捷按钮
    FULL_SCORE_BUTTON: 'button.el-button--success.is-plain',
    ZERO_SCORE_BUTTON: 'button.el-button--danger.is-plain',

    // 分数输入框（只读，显示满分信息）
    SCORE_INPUT: 'input.el-input__inner[placeholder*="满分"]',

    // 步长输入框
    STEP_INPUT: 'input.el-input__inner[placeholder="步长"]',

    // 提交按钮
    SUBMIT_BUTTON: '.score-footer .el-button--primary',

    // 自动提交复选框
    AUTO_SUBMIT_CHECKBOX: '.auto-submit__view .el-checkbox__original',

    // 给分面板
    SCORE_PANEL: '.dialog-score__view',
    SCORE_PANEL_CONTENT: '.dialog-panel-content',

    // 小题号标签（如 "2.23", "2.24"）
    QUESTION_LABEL: '.el-form-item__label',

    // 给分模式切换标签
    SCORE_TAB_ONE_KEY: '.radioBox:has(.radio:contains("一键给分"))',
    SCORE_TAB_ANNOTATION: '.radioBox:has(.radio:contains("批注给分"))',
    SCORE_TAB_KEYBOARD: '.radioBox:has(.radio:contains("键盘给分"))',

    // 主页面容器
    PAGE_CONTAINER: '#read-paper',

    // 页面检测
    PAGE_DETECT_CONTAINER: '#read-paper',
    PAGE_DETECT_SCORE: '.score-item-button',
    PAGE_DETECT_IMAGE: '.img-box',
    PAGE_DETECT_PANEL: '.dialog-score__view',

    // 确认弹窗（答卷标签/提交异常，非提交确认）
    DIALOG_CONFIRM_BUTTON: '.el-dialog__wrapper:not([style*="display: none"]) .el-button--primary',

    // 工具栏按钮
    SUBMIT_ABNORMAL_BUTTON: 'button:has(span:contains("提交异常"))',
    SAVE_IMAGE_BUTTON: 'button:has(span:contains("保存图片"))',
    PREV_PAPER_BUTTON: 'button:has(span:contains("上一份"))',
    NEXT_PAPER_BUTTON: 'button:has(span:contains("下一份"))',
};
