// ========== C30教育云 DOM 选择器常量 ==========
// zy.iclass30.com — Vue + Element UI + Canvas 渲染答题卡
// 图片通过 <canvas id="canvasImg"> 渲染（Alibaba Cloud OSS）
// 评分通过 el-input 输入框 + .tab-score-btn 快捷分数按钮
// API: homeworkservice.iclass30.com/homework/cloudexam/getCorrectStuList

const C30_SELECTORS = {
    // ===== 答题卡图片 =====
    // 主内容区域 Canvas（用于判断页面是否加载）
    ANSWER_CANVAS: 'canvas#canvasImg',

    // ===== 分数输入 =====
    // Element UI 分数输入框（placeholder 含 "满分" 字样）
    SCORE_INPUT: 'input.el-input__inner[placeholder*="满分"]',
    // 所有 el-input 输入框（用于兜底查找）
    SCORE_INPUT_ALL: 'input.el-input__inner',

    // 快捷分数按钮
    SCORE_BTN: '.tab-score-btn',

    // ===== 题目切换 =====
    // 题目选择器输入框（placeholder="请选择题目"）
    QUESTION_SELECT: 'input.el-input__inner[placeholder="请选择题目"]',
    // 题目下拉项
    QUESTION_DROPDOWN_ITEM: '.el-select-dropdown__item .ques-title',

    // ===== 导航 =====
    // "下一人" 按钮
    NEXT_BUTTON: 'button.text-btn',

    // ===== 页面结构 =====
    // 主容器
    MAIN_CONTAINER: '.correct-main',

    // ===== 页面检测 =====
    PAGE_DETECT_CANVAS: 'canvas#canvasImg',
    PAGE_DETECT_SCORE: 'input.el-input__inner[placeholder*="满分"]',
    PAGE_DETECT_MAIN: '.correct-main',

    // ===== 回评模式 =====
    // URL 参数中 isReview=1 表示回评模式
    // 无专门的 DOM 选择器，通过 URL 判断
};
