// ========== 懂你系统（dongni100.com）选择器 ==========
// 实测来源：2026-11-10 bsk 会话（教师端 李雨辰老师，考试 676984973「2026年11月4日数学模拟考试」）
// 实测证据见 tmp/agn_dongni_report.md；标注 [待复现] 的选择器未在批改工作台现场核对
const DONGNI_SELECTORS = {
    // ---------- 页面识别 ----------
    // 批改/阅卷 DOM 特征（实测：抽样详情页 https://www.dongni100.com/v2/exam/exam-management/detail/read-record 等）
    // [待复现] 批改工作台（阅卷老师打分页）的确切容器未实测，用「答案图 + 给分区」双特征兜底
    PAGE_DETECT_IMAGE: 'img.img-dom',
    PAGE_DETECT_SCORE: '.edit-score-box, .el-radio-group',
    PAGE_DETECT_INPUT: 'input.el-input__inner',

    // ---------- 答题卡图片 ----------
    // 实测（抽样详情页）：img.img-dom[src^="http"]，
    // URL 形态: https://cdn.dongni100.com/upload/answerCard/{年}/{月}/{日}/{examId}/{paperId}/{stuId}_{考号}/{题块}.jpg
    // 例: .../676984973/6418324/5761807_DN1104000603/2-1-1.jpg（5761807=内部ID，DN1104000603=考号）
    ANSWER_IMAGE: 'img.img-dom',

    // ---------- 评分控件 ----------
    // 实测（修订分数区）：满分档位 radio（el-radio__original[value=0..满分]），满分 3 分即 4 档
    // [待复现] 批改工作台给分板可能为打分板按钮/输入框，先按 radio 档位实现，detect 时多特征兜底
    // 面板容器（#298-③）：radio 必须收窄在给分面板内，全局裸 radio 会被无关单选误认
    SCORE_PANEL: '.edit-score-box, [class*="score-panel"], [class*="score-board"]',
    SCORE_RADIO_GROUP: '.edit-score-box .el-radio-group, [class*="score-panel"] .el-radio-group, [class*="score-board"] .el-radio-group, .el-radio-group',
    SCORE_RADIO: '.edit-score-box input.el-radio__original[type="radio"], [class*="score-panel"] input.el-radio__original[type="radio"], [class*="score-board"] input.el-radio__original[type="radio"]',
    SCORE_INPUT: '.edit-score-box input.el-input__inner, [class*="score-panel"] input.el-input__inner',
    // 评分明细（回评/抽样页）：满分/阅卷模式/最终得分
    SCORE_DETAIL: '.edit-score-box, .edit-score-header',

    // ---------- 提交 ----------
    // 精确匹配（#298-②）：strip 空白后全等，防「下一份/上一份/下一题/下一步」导航键被误点
    SUBMIT_BUTTON: 'button',
    SUBMIT_BUTTON_TEXT: /^(提交|保存并下一)$/,
    // 导航词显式排除（即使出现在自定义按钮上也绝不点）
    SUBMIT_NAV_RE: /下一份|上一份|下一题|上一题|下一步|上一步/,

    // ---------- 任务/学生标识 ----------
    // 实测：路由 query 含 examId/schoolId/examPaperId/courseId；学生标识在答案图 URL 的 {stuId}_{考号} 段
    // 题号维度只取 query（#298-①：禁 DOM 探测——填分点选 radio 会翻转 DOM 态，掺入会误触发任务切换）
    TASK_QUERY_KEYS: ['examId', 'courseId', 'examPaperId'],
    TASK_QID_QUERY_KEYS: ['questionId', 'questionNo', 'qid', 'itemId'],
    PAPER_ID_URL_RE: /\/answerCard\/[^]*?\/(\d+)_([A-Za-z0-9]+)\//,

    // ---------- 回评模式 ----------
    // 实测路由：review-list / review-detail / remark（修订分数）/ reset-read（打回重阅）
    REGRADE_PATH_RE: /review-list|review-detail|\/remark|reset-read/,

    // ---------- 多设备弹窗（lead 侦察情报，JS click 无效须真实点击）----------
    MULTI_DEVICE_OK_BTN: '#multi-device-online-iKnow-btn',
    // ⚠️ 「退出其他设备」绝对不可点击（会踢教师会话）
};
