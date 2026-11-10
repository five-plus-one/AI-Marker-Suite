// ========== 云阅卷(开州) DOM 选择器常量 ==========
// yyj.kzedu.cn — Vue 3 + Element Plus SPA
// 答题卡：<img> 渲染（.svg-container 内，带 SVG 批注图层）
// 评分：点击式 button.scoreitem + readonly 分数框 + 「给分」提交
// 注意：el-id-XXXX-XX 形式的 id 每次刷新都会变，选择器只用类名/属性

const KZEDU_SELECTORS = {
    // 答题卡图片（只取 .svg-container 内的真实答案图，排除分数闪现 base64 小图）
    ANSWER_IMAGE: '.svg-container img.el-image__inner',
    ANSWER_IMAGE_FALLBACK: '.el-image.photo_bg img.el-image__inner',

    // 分数输入框（readonly；.redbiginput 内，带 max/min 属性）
    // 不能用 input[placeholder] 泛匹配：页面上还有步长框/取色器隐藏框
    SCORE_INPUT: '.redbiginput input',

    // 点击式评分按钮（0..满分）
    SCORE_ITEM: 'button.scoreitem',

    // 满分/零分快捷按钮
    FULL_SCORE_BUTTON: '.givescorebox button.el-button--success',
    ZERO_SCORE_BUTTON: '.givescorebox button.el-button--danger',

    // 提交按钮（「给分」，自定义类名稳定）
    SUBMIT_BUTTON: 'button.submitscorebtn',

    // 自动给分勾选框（勾选时点 scoreitem 会立即提交翻卷）
    AUTO_CHECKBOX_TEXT: '自动给分',

    // 给分面板
    SCORE_PANEL: '.givescorebox',

    // 题干标题（如「二、主观题 11-16(24分)」）
    QUESTION_TITLE: '.questiontitle',

    // 页面检测
    PAGE_DETECT_PANEL: '.givescorebox',
    PAGE_DETECT_IMAGE: '.svg-container img.el-image__inner',
    PAGE_DETECT_INPUT: '.redbiginput input',

    // 回评模式：「退出回评」按钮可见 = 处于回评
    EXIT_REGRADE_TEXT: '退出回评',
};
