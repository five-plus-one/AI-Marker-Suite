// ========== 睿芽考试服务云平台 DOM 选择器常量 ==========
// ASP.NET WebForms + jQuery + Bootstrap + iCheck，域名: ruiya.onlyets.com
// 阅卷页: /mark/v6/view/<32位GUID>
//
// 与威科姆（wyna.onlyets.com）同为厂商 CampusManage/MarkClient 代码，元素 ID 一致，
// 但本适配器独立维护，不修改 wuyuetong（多入口并存，参考 qitian / qitian-new）
//
// 范围：仅常规键盘打分模式（#rdKeyboard）；鼠标打分板 / 分步面板不实现
// 选择器来源：真实阅卷页 HTML（#panelKey 多小题并列、iCheck 代理控件、Bootstrap 弹窗）

const RUIYA_SELECTORS = {
    // ---------- 页面检测 ----------
    PAGE_DETECT_IMAGE: '#imageFullScreen',
    PAGE_DETECT_INPUT: '#panelKey input.ipt_score',
    PAGE_DETECT_SUBMIT: '#submitMark',

    // ---------- 答题卡图片 ----------
    // img.src 由 markDataNew.js 异步写入；#CardSpan 为多页叠放容器
    ANSWER_IMAGE: '#imageFullScreen',
    IMAGE_CONTAINER: '#imgSpan',
    IMAGE_STACK: '#CardSpan',

    // ---------- 分数输入（1..N 个评分单元）----------
    // 结构: #panelKey > .panel-item-input[data-key] > input.ipt_score + font.text-error
    SCORE_PANEL: '#panelKey',
    SCORE_INPUT: 'input.ipt_score',
    SCORE_ITEM: '.panel-item-input',
    SCORE_ITEM_KEY: 'data-key',
    SCORE_LABEL: 'label.control-label',
    SCORE_LABEL_FALLBACK: '.panel-item-title, .item-title',
    // font.text-error 的 textContent 形如 "<= 4"，纯数字在 span 内，故 span 优先
    MAX_SCORE_FONT: 'font.text-error',
    MAX_SCORE_SPAN: 'font.text-error span',

    // ---------- 提交 ----------
    SUBMIT_BUTTON: '#submitMark',          // value="提交(Enter)"，type=button
    SUBMIT_BUTTON_STEPS: '#submitSteps',   // 分步模式专用，本适配器不使用

    // ---------- 打分模式（iCheck 包裹）----------
    MODE_KEYBOARD: '#rdKeyboard',          // 默认勾选
    MODE_MOUSE: '#rdMouse',
    MODE_STEPS: '#rdSteps',
    ICHECK_PROXY: 'div[class*="iradio"], div[class*="icheckbox"]',
    ICHECK_HELPER: 'ins.iCheck-helper',

    // ---------- 快捷给分 ----------
    FULL_SCORE_BTN: '#btnFull',
    ZERO_SCORE_BTN: '#btnZero',

    // ---------- iCheck 复选框 ----------
    AUTO_SUBMIT_CHECKBOX: '#autoSubmit',   // 默认勾选（语义见 adapter 注释）
    ZERO_CONFIRM_CHECKBOX: '#lbl0OK',      // 默认勾选
    SCALE_CHECKBOX: '#scaleSubmit',

    // ---------- 鼠标板（仅用于模式判定，不实现打分逻辑）----------
    MOUSE_SCORE_LIST: 'ul.ul_score',
    MOUSE_SCORE_ITEM: 'ul.ul_score li.btn-group',

    // ---------- 弹窗 ----------
    ZERO_MODAL: '#zeroCheckModal',
    ZERO_MODAL_OK: '#btn_0_ok',
    ZERO_MODAL_CANCEL: '#btn_0_cancel',
    TIPS_MODAL: '#tipsModal',      // data-backdrop=static
    TIPS_MODAL_DISMISS: '#hidtips', // 「不再提示」按钮（关闭并记住偏好）
    TIPS_DP_MODAL: '#tipsDPModal', // 多评提示
    DIST_MODAL: '#myModal',        // 分数分布提示

    // ---------- 回评（判定用，绝不按文字匹配）----------
    REVIEW_PANEL: '#reviewPanel',                 // 平时 display:none
    REVIEW_LINK: 'a[onclick*="Mark.showReview"]', // 文本恒为「回 评」，不可作判据

    // ---------- 卷面身份 ----------
    PAPER_NO: '#span_mt_pwd',      // 密号，每生一换
    SUBJECT_LABEL: '#lblSub',
    QUESTION_LABEL: '#lblTSub',    // 与下拉按钮「14（一评）」对应

    // ---------- 隐藏字段 ----------
    HIDDEN_STEPS_SCORE: '#hndStepsScore',
    HIDDEN_STEPS_NO: '#hndStepsNo',
    HIDDEN_MARK_PIC: '#hdMarkPic',
    HIDDEN_MARK_TAG: '#hdMarkTag',

    // ---------- 平台自带 AI 面板（只读观测，不交互）----------
    PLATFORM_AI_TITLE: '#aiTitle',
};
