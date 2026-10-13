// ========== 江西上进教育服务云平台 DOM 选择器常量 ==========
// jQuery + ASP.NET WebForms 传统页面，域名: www.sipd.cn
// 特点：与威科姆悦卷通 (wuyuetong) 同一套阅卷系统，OSS 裁剪图，
//       键盘/鼠标/步骤三种打分模式，0分确认弹窗，data-stu 标识学生答卷

const SIPD_SELECTORS = {
    // 答题卡图片（单页，容器内仅此一张业务图）
    ANSWER_IMAGE: '#imageFullScreen',
    IMAGE_CONTAINER: '#imgSpan',

    // 分数输入框（键盘打分模式，每小题一个）
    SCORE_INPUT: '.ipt_score',
    SCORE_INPUT_CONTAINER: '.panel-item-input',
    SCORE_LABEL_SPAN: '.panel-item-input > span:first-child',
    MAX_SCORE_FONT: 'font.text-error span',

    // 题目标题（如 "20(1-2) 试题答案"）
    QUESTION_TITLE: '#answerPanel .panel-heading span',

    // 提交按钮
    SUBMIT_BUTTON: '#submitMark',
    SUBMIT_BUTTON_STEPS: '#submitSteps',

    // 打分模式切换
    KEYBOARD_MODE: '#rdKeyboard',

    // 页面检测
    PAGE_DETECT_IMAGE: '#imageFullScreen',
    PAGE_DETECT_INPUT: '.ipt_score',
    PAGE_DETECT_SUBMIT: '#submitMark',

    // 0分确认弹窗
    ZERO_MODAL: '#zeroCheckModal',
    ZERO_MODAL_OK: '#btn_0_ok',
    ZERO_MODAL_CANCEL: '#btn_0_cancel',

    // 隐藏字段
    HIDDEN_MARK_PIC: '#hdMarkPic',
    HIDDEN_MARK_TAG: '#hdMarkTag',
};
