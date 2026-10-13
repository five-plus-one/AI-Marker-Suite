// ========== 南昊AI教学提分平台 DOM 选择器常量 ==========
// jQuery 传统页面，域名: nhcisc.com
// 特点：单页裁剪答题图（相对路径 showimage），键盘输入打分，
//       submitscore() 全局提交，clearNoNum 全局过滤分数格式

const NHCISC_SELECTORS = {
    // 答题卡图片（src 为相对路径，img.src 可取绝对 URL）
    ANSWER_IMAGE: '#taskimg',

    // 分数输入框（多小题时同 name 多个，按 li 遍历）
    SCORE_INPUT: 'input[name="score"]',
    SCORE_INPUT_VISIBLE: 'input[name="score"][class*="tc"]',
    SCORE_ITEM: 'li',
    SCORE_LABEL: '.subt-num',
    MAX_SCORE_PLACEHOLDER: /满分(\d+(?:\.\d+)?)/,

    // 提交按钮（可见主按钮；.tj-btn 为隐藏备用）
    SUBMIT_BUTTON: '.up-score',
    SUBMIT_BUTTON_ALT: '.tj-btn',

    // 任务标识相关
    TASK_ID_URL_PARAM: 'subid',
    TASK_ID_INPUT: '#subid',
    QUESTION_ID_INPUT: '#Que_ID',

    // 换卷信号字段
    EXAM_ID_INPUT: '#examid',
    SEC_ID_INPUT: '#secid',

    // 无任务提示
    NO_TASK_PANE: '.no-task-pane',

    // 页面检测
    PAGE_DETECT_IMAGE: '#taskimg',
    PAGE_DETECT_INPUT: 'input[name="score"]',
    PAGE_DETECT_SUBMIT: '.up-score',

    // 自动提交开关
    AUTO_SUBMIT_TOGGLE: '.auto-submit-r',
};
