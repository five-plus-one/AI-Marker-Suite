// ========== 精斗云(大数据精准教学) DOM 选择器常量 ==========
// exam.wxy100.com — AngularJS 1.x + jQuery，hash 路由 SPA
// 批改页：#!/testCenter/paperMark?examId=...&itemid=...（按题批阅，一次一题）
// 答题卡：#imgBox 内 ng-repeat AllImages 渲染 img[questionid]（多图/合并图两种模式）
// 分数框：input#topic.qscore_input（ng-model=correctStatus.topicScore）
// 提交：button.qbtn-save（ng-click=markSave()，ng-disabled=markSaveVolid 校验）
// 注意：img.src 带 ?r= 随机缓存参数，任何 URL 比对都必须先剥离 query 只比路径
// 注意：div.qbtn.mt20 是「保存/清除」按钮容器，div.qbtn.right 是「自动提交」开关容器，
//       真正的保存按钮只有 button.qbtn-save，禁止泛匹配 .qbtn

const JINGDOUYUN_SELECTORS = {
    // 批改页 hash 路由（精确匹配 paperMark，避免任务列表页误判导致误弹配置引导）
    MARKING_HASH_REG: /\/testCenter\/paperMark(\?|$)/,

    // 答题卡图片（ng-repeat 渲染，img 带 questionid 属性；合并图模式在 #imgBox 内同样成立）
    ANSWER_IMAGE: '#imgBox img',
    ANSWER_IMAGE_ATTR: '#imgBox img[questionid]',

    // 分数输入框（AngularJS ng-model 绑定，inputmode=none 禁软键盘，仍可程序化填值）
    SCORE_INPUT: 'input.qscore_input',

    // 题号 / 满分显示（AngularJS ng-bind 渲染，如 17 / 14）
    QUESTION_LABEL: 'span[ng-bind="taskItemNo.itemNo"]',
    MAX_SCORE_LABEL: 'span[ng-bind="allFetchDatas.scoreMax"]',

    // 题号/满分兜底（div.qscore 内第1、2个 span.qscore_span）
    SCORE_ROW_SPANS: 'div.qscore > span.qscore_span',

    // 保存按钮（ng-click=markSave()）
    SAVE_BUTTON: 'button.qbtn-save',

    // 「自动提交」开关容器（ng-click=setSubmitAuto()，勾选时填分可能触发平台自动交卷）
    AUTO_SUBMIT_TOGGLE: 'div.qbtn',

    // 打分面板（页面检测锚点）
    SCORE_PANEL: '.scoring',
};
