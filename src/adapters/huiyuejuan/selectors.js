// ========== 慧阅卷 DOM 选择器常量 ==========
// web.17yuejuan.cn — AngularJS
// 阅卷界面以弹窗形式呈现，评分通过点击分数按钮

const HUIYUEJUAN_SELECTORS = {
    // 答题卡图片
    ANSWER_IMAGE: '.ui-answer-sheet-image-img',
    ANSWER_IMAGE_CONTAINER: '.ui-answer-sheet-image',

    // 给分面板（弹窗检测核心）
    SCORE_PANEL: '.ui-exam-teacher-correct-score-box',
    SCORE_PANEL_CONTAINER: '.ui-exam-teacher-correct-score-panel',

    // 分数按钮（点击式，+0, +1, +2, ...）
    SCORE_BUTTON: '.ui-input-number-target[ng-repeat]',
    SCORE_BUTTON_SELECTED: '.ui-input-number-target.selected',

    // 满分/零分快捷按钮
    FULL_SCORE_BUTTON: '.ui-exam-teacher-correct-score-panel-score-box-btns .ui-red-text',
    ZERO_SCORE_BUTTON: '.ui-exam-teacher-correct-score-panel-score-box-btns .ui-success-text',

    // 自定义分值输入框
    CUSTOM_SCORE_INPUT: '.ui-exam-teacher-correct-score-panel-score-input',

    // 满分显示（"本题总分: 6分"）
    TOTAL_SCORE_TEXT: '.ui-exam-teacher-correct-total-score-text',

    // 得分显示（"本题得分：未评分" 或具体分数）
    CURRENT_SCORE_TEXT: '.ui-exam-teacher-correct-score .ui-red-text',

    // 扣分模式复选框
    DEDUCTION_CHECKBOX: 'input[ng-click*="change_score_type"]',

    // 面板标题（题号和满分，如 "16、(6分)"）
    PANEL_TITLE: '.ui-exam-teacher-correct-score-panel-title',

    // 页面检测
    PAGE_DETECT_PANEL: '.ui-exam-teacher-correct-score-box',
    PAGE_DETECT_IMAGE: '.ui-answer-sheet-image-img',
    PAGE_DETECT_BUTTONS: '.ui-input-number-target[ng-repeat]',

    // 提交/下一题按钮（如果有）
    SUBMIT_BUTTON: 'button[ng-click*="submit"], button[ng-click*="next"]',
};
