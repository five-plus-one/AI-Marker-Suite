// ========== 光大阅卷 V2 DOM 选择器常量 ==========
// IP:端口 部署版本 — 非标准 Vue 2 + Canvas 渲染
// 与 guangda (pj.yixx.cn) 是同一平台的不同部署版本

const GUANGDA2_SELECTORS = {
    // ========== Canvas ==========
    // canvas#0 是 tainted（跨域图片），不可导出
    // canvas#1, #2 是答题卡（1580x1210），canvas#3 可能是缩略图
    ANSWER_CANVAS: 'canvas',
    ANSWER_CANVAS_FIRST: 'canvas:not([id="0"])',  // 跳过 tainted canvas

    // ========== 分数选择 ==========
    // LI.f-csp 是分数选项，如 "0~10", "0", "1", "2"... "10"
    // "0~10" 是范围指示器（第一个），不是可点击的分数
    SCORE_ITEM: 'LI.f-csp',
    SCORE_ITEM_ACTIVE: 'LI.f-csp.activeB',  // 当前选中的分数
    SCORE_ITEM_CLICKABLE: 'LI.f-csp:not(:first-child)',  // 排除范围指示器

    // ========== 提交 ==========
    // 提交按钮是 <input type="submit" value="提交分数"> 包裹在 .button 容器中
    SUBMIT_INPUT: 'input[type="submit"][value="提交分数"]',
    SUBMIT_CONTAINER: '.button.iconfont input[type="submit"]',

    // ========== 确认弹窗 ==========
    DIALOG_CONFIRM: 'BUTTON.sure',
    DIALOG_CANCEL: 'BUTTON.cancel',
    DIALOG_WRAP: '.dialog-btns',

    // ========== 包号（替代密号） ==========
    // 界面显示 "包号：179 - 1" 格式
    PACKAGE_LABEL: '.jl label',
    PACKAGE_CONTAINER: '.jl',

    // ========== 题目信息 ==========
    QUESTION_NUM: 'SPAN.tz.f-pr.f-csp',  // "第 13 题"
    SCORE_DISPLAY: '.jl',  // 包号和分数显示区域

    // ========== 回评 ==========
    REGRADE_LIST: '.hp_list ul li.row',
    REGRADE_ACTIVE: '.hp_list ul li.row.active',
    REGRADE_BTN: 'SPAN.plhp.f-csp',
    REGRADE_EXIT_BTN: 'SPAN.plhp.f-csp.backhp',

    // ========== 页面容器 ==========
    PAGE_CONTAINER: '.page',
    CONTENT_CONTAINER: '.content',
};
