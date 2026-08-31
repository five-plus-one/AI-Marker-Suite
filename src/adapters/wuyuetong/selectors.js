// ========== 威科姆（悦卷通）DOM 选择器常量 ==========
// jQuery 传统页面，域名: wyna.onlyets.com
// 特点：多小题输入框，OSS 图片，键盘/鼠标/步骤三种打分模式

const WUYUETONG_SELECTORS = {
    // 答题卡图片
    ANSWER_IMAGE: '#imageFullScreen',
    IMAGE_CONTAINER: '#imgSpan',

    // 分数输入框（多小题模式）
    SCORE_INPUT: '.ipt_score',
    SCORE_INPUT_CONTAINER: '.panel-item-input',
    SCORE_LABEL: 'label.control-label',
    MAX_SCORE_FONT: 'font.text-error span',

    // 快捷按钮
    FULL_SCORE_BTN: '#btnFull',
    ZERO_SCORE_BTN: '#btnZero',

    // 提交按钮
    SUBMIT_BUTTON: '#submitMark',
    SUBMIT_BUTTON_STEPS: '#submitSteps',

    // 打分模式切换
    KEYBOARD_MODE: '#rdKeyboard',
    MOUSE_MODE: '#rdMouse',
    STEPS_MODE: '#rdSteps',

    // 选项
    AUTO_SUBMIT_CHECKBOX: '#autoSubmit',
    ZERO_CONFIRM_CHECKBOX: '#lbl0OK',
    SCALE_CHECKBOX: '#scaleSubmit',

    // 鼠标打分模式下的分数按钮
    MOUSE_SCORE_LIST: '.ul_score',
    MOUSE_SCORE_ITEM: '.ul_score li.btn-group',

    // 页面检测
    PAGE_DETECT_IMAGE: '#imageFullScreen',
    PAGE_DETECT_INPUT: '.ipt_score',
    PAGE_DETECT_SUBMIT: '#submitMark',

    // 主容器
    MAIN_CONTAINER: '#markPanel',

    // 0分确认弹窗
    ZERO_MODAL: '#zeroCheckModal',
    ZERO_MODAL_OK: '#btn_0_ok',
    ZERO_MODAL_CANCEL: '#btn_0_cancel',

    // 隐藏字段
    HIDDEN_MARK_PIC: '#hdMarkPic',
    HIDDEN_MARK_TAG: '#hdMarkTag',
};
