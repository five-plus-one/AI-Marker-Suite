// ========== 54学霸 DOM 选择器常量 ==========
// jQuery + layui 传统页面，答题卡使用 Canvas 渲染

const XUEBA54_SELECTORS = {
    // 答题卡图片
    CANVAS: '#canvas1',
    BASE64_IMG: '#py_pic_div img[src^="data:image"]',
    IMAGE_CONTAINER: '#py_pic_div',

    // 分数输入框（多小题模式）
    SCORE_INPUT_PREFIX: 'input[id^="zdyScore_"]',
    SCORE_INPUT_BY_INDEX: (i) => `#zdyScore_${i}`,

    // 满分隐藏框
    MAX_SCORE_PREFIX: 'input[id^="tgmf_"]',
    MAX_SCORE_BY_INDEX: (i) => `#tgmf_${i}`,

    // 小题标签
    QUESTION_LABEL_PREFIX: 'span[id^="tiganSpan_"]',
    QUESTION_LABEL_BY_INDEX: (i) => `#tiganSpan_${i}`,

    // 提交按钮
    SUBMIT_BUTTON: 'button.layui-btn:not(.layui-btn-primary):not(.layui-btn-xs)',
    SUBMIT_BUTTON_ALT: '.layui-btn-sm',

    // 页面检测
    PAGE_DETECT_CANVAS: '#canvas1',
    PAGE_DETECT_IMG: '#py_pic_div img[src^="data:image"]',
    PAGE_DETECT_INPUT: 'input[id^="zdyScore_"]',
    PAGE_DETECT_SUBMIT: 'button.layui-btn:not(.layui-btn-primary)',

    // 主容器
    MAIN_CONTAINER: '#tiganDiv',
};
