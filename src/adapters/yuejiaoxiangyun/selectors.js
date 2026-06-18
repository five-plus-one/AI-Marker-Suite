// ========== 粤教翔云智慧测评 DOM 选择器常量 ==========
// jQuery 传统页面，rrtcp.gdedu.gov.cn

const YUEJIAOXIANGYUN_SELECTORS = {
    // 答题卡图片
    ANSWER_IMAGE: '.dowebox img[order]',
    ANSWER_IMAGE_CONTAINER: '.dowebox',

    // 分数输入框
    SCORE_INPUT: '.inputText2',
    SCORE_INPUT_ALT: '.v3-score-val',

    // 确认分数按钮（部分页面可能有）
    SCORE_CONFIRM: '.v3-score-confirm',

    // 提交/下一个按钮
    SUBMIT_BUTTON: 'input.make_sure',
    SUBMIT_BUTTON_ALT: '.make_sure',

    // 满分信息容器
    MAX_SCORE_CONTAINER: '.fullScore',

    // 快速评分链接
    QUICK_SCORE_LINKS: '.v3-homework-fast-score a',

    // 满分/零分快捷按钮
    FULL_SCORE_BUTTON: '.v3-homework-fruit-got',
    ZERO_SCORE_BUTTON: '.v3-homework-fruit-error',

    // 半分复选框
    HALF_SCORE_CHECKBOX: '#halfScore',

    // 页面检测
    PAGE_DETECT_IMAGE: '.dowebox img[order]',
    PAGE_DETECT_INPUT: '.inputText2',
    PAGE_DETECT_SUBMIT: 'input.make_sure',

    // 主内容区域
    MAIN_CONTAINER: '.aix-content',

    // 题组批改 URL 特征
    MARKING_URL_PATTERN: 'evaluation/correct/quick',
    // 批量批改 URL 特征（暂不支持）
    BATCH_URL_PATTERN: 'evaluation/correct/QuickScore',
};
