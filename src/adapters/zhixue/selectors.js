// ========== 智学网 DOM 选择器常量 ==========
// 将在 Phase 4 中从各模块提取智学网特定的选择器到此处

const ZHIXUE_SELECTORS = {
    // ========== 旧版UI选择器 ==========
    // 答题卡图片
    ANSWER_IMAGE_CONTAINER: 'div[name="topicImg"]',
    ANSWER_IMAGE: 'div[name="topicImg"] img',

    // 分数输入框
    SCORE_INPUT: 'input[type="number"]',
    SCORE_INPUT_PLACEHOLDER: 'input[placeholder*="分"]',

    // 提交按钮
    SUBMIT_BUTTON_TEXT: '提交分数',

    // 题号标识
    TOPIC_INDEX: '#currentTopicIndex',
    TOPIC_TITLE: '.topic-title',

    // 页面检测
    PAGE_DETECT_IMAGE: 'div[name="topicImg"]',
    PAGE_DETECT_INPUT: 'input[placeholder*="分"]',

    // ========== 新版UI选择器 (2025年5月改版) ==========
    // 答题卡图片
    ANSWER_IMAGE_NEW: '.enhance-definition-bright',

    // 分数输入框
    SCORE_INPUT_NEW: '#txt_marking_17',           // 小题分输入框 (name="topicTxt")
    SCORE_INPUT_ALL_NEW: '#txt_marking_all',      // 总分输入框
    SCORE_INPUT_TOTAL_HIDDEN: '#markinTotalScore', // 隐藏的总分字段

    // 提交按钮
    SUBMIT_BUTTON_NEW: '#bnt_save',

    // 页面检测
    PAGE_DETECT_IMAGE_NEW: '.enhance-definition-bright',
    PAGE_DETECT_BUTTON_NEW: '#bnt_save',
};
