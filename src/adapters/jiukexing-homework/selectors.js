// ========== 九科星(作业) DOM 选择器常量 ==========
// jxp.jkxjxw.com — qiankun 微应用 (pc-homework) + Vue 3 + Element Plus
// 批改页: /homework/homework/mark/{作业ID}?classId=&questionId=（列表页 /correct/ 不激活）
// 答题卡: 华为 OBS 裁剪图（jty-datika|jty-scancard 桶，URL 自带 x-image-process 裁剪参数）
//         Canvas 仅是查看器（跨域 tainted，toDataURL 不可用），真身必须走 OBS URL
// 学生/题目: 左侧 div.student-list，当前学生 = .list-item.active

const JIUKEXING_HW_SELECTORS = {
    // 批改页路由特征（列表页是 /correct/，必须区分开）
    MARK_PATH_REG: /\/homework\/homework\/mark\//,

    // 学生/题目列表
    STUDENT_LIST: '.student-list',
    STUDENT_ITEM: '.student-list .list-item',
    STUDENT_ITEM_ACTIVE: '.student-list .list-item.active',
    STUDENT_NAME_EL: '.student-list .list-item.active .common-name-ellipsis',
    QUESTION_SELECT: '.student-list .student-select',

    // 分数输入框（placeholder 形如「≤16」，注意没有“分”字）
    SCORE_INPUT: 'input.el-input__inner[placeholder^="≤"]',

    // 提交按钮按文本匹配（页面可能存在隐藏的同名按钮，取可见的）
    SUBMIT_TEXT: '提交分数',

    // Canvas 查看器（污染，仅作存在性检测）
    ANSWER_CANVAS: 'canvas',

    // OBS 答题卡 URL 特征（Performance / img 兜底用）
    OBS_URL_REG: /jty-datika|jty-scancard|handled\/zuoye/,

    // 批改数据接口特征（XHR/fetch 拦截用），如 getMarkingStudents
    API_URL_REG: /jty-school-work\/api\//,
};
