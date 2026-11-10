// ========== 小帆智能阅卷 DOM 选择器常量 ==========
// xfkj.cc（安徽小帆智能科技）— layui + jQuery + ASP.NET WebForms 多页应用
// 批改页 /pages/exam/yuejuan/review.aspx（另有 review_online.aspx 变体）
// 答题卡：<img> 阿里云 OSS 裁剪图（src 带 x-oss-process=image/crop 签名参数）
// 评分：.quickmenu>.qlist>li 内 input.score-input（每小题一个），placeholder「满分N分」
// 提交：a.event-btn[data-action="14"]（「提交」）→ doSubmit() POST code=144 → 成功后自动 loadPaper(0) 翻卷
// 换卷信号：.review_body>ul>li>img 的 src 路径变化（OSS 签名 query 每次刷新会变，只比 pathname）
// 回评信号：.menu a[data-action="31"]（「结束回评」）可见 = 处于回评

const XFKJ_SELECTORS = {
    // 答题卡图片（可多页多张）
    ANSWER_IMAGE: '.review_body>ul>li>img',

    // 小题列表与分数输入框（li 的 id = 题目 id）
    SCORE_ITEM: '.quickmenu>.qlist>li',
    SCORE_INPUT: '.quickmenu>.qlist>li input.score-input',
    SCORE_LABEL: '.quickmenu>.qlist>li>div:first-child',

    // 满分提取：placeholder「满分N分」
    MAX_SCORE_PLACEHOLDER: /满分([\d.]+)分/,

    // 提交按钮（「提交」，data-action=14 → doSubmit）
    SUBMIT_BUTTON: 'a.event-btn[data-action="14"]',

    // 满分/零分快捷按钮（data-action=1/0）
    FULL_SCORE_BUTTON: '.scoremenu a[data-action="1"]',
    ZERO_SCORE_BUTTON: '.scoremenu a[data-action="0"]',

    // 回评：「结束回评」按钮可见 = 回评模式（pageIsNew=false）
    EXIT_REGRADE_BUTTON: '.menu a[data-action="31"]',

    // 页面检测
    PAGE_DETECT_IMAGE: '.review_body>ul>li>img',
    PAGE_DETECT_INPUT: '.quickmenu>.qlist>li input.score-input',
    PAGE_DETECT_PANEL: '.quickmenu',
};
