// ========== 光大阅卷 DOM 选择器常量 ==========
// pj.yixx.cn — Vue 2 + Canvas 渲染

const GUANGDA_SELECTORS = {
    // 答题卡 Canvas（在 #painter 区域内）
    ANSWER_CANVAS: '#painter canvas',
    ANSWER_CANVAS_FIRST: '#painter canvas#1, #painter canvas#2',  // 跳过 tainted 的 canvas#0

    // 分数选择区域
    SCORE_LIST: '.scores',
    SCORE_ITEM: '.scores li',
    SCORE_ITEM_ACTIVE: '.scores li.active',  // 当前选中的分数

    // 得分显示
    SCORE_DISPLAY: '.df .fs label',
    SCORE_DISPLAY_WRAP: '.df .fs',

    // 提交按钮
    SUBMIT_BUTTON: 'span.submit-btn',
    SUBMIT_BUTTON_ALT: '.submit-btn',

    // 小题信息
    SUB_QUESTION_LIST: '.xtList',
    SUB_QUESTION_LABEL: '.xtList label',

    // 档次信息
    LEVEL_BUTTON: '.dc-btn.activeB',
    LEVEL_BOX: '.bzBox',

    // 给分模式
    SCORE_TYPE: '.score-type',
    SCORE_TYPE_ACTIVE: '.score-type.active-type',

    // 页面检测元素
    PAGE_DETECT_CANVAS: '#painter canvas',
    PAGE_DETECT_SCORE: '.scores li',
    PAGE_DETECT_SUBMIT: 'span.submit-btn',
    PAGE_DETECT_DISPLAY: '.df .fs label',

    // 画笔工具区域
    PAINTER_WRAP: '.painter-wrap',
    PAINTER: '#painter',

    // 题目信息
    QUESTION_INFO: '.hp-header',

    // 操作按钮
    PREV_BUTTON: 'button.mg-btn:has-text("上一份")',
    NEXT_BUTTON: 'button.mg-btn:has-text("下一份")',

    // 回评相关
    REGRADE_BUTTON: 'button.mg-btn:contains("回评")',

    // 评分标准
    SCORE_STANDARD: '.pfbzWrap',
};
