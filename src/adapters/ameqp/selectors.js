// ========== AMEQP 网上评卷 DOM 选择器常量 ==========
// ASP.NET WebForms + jQuery + EasyUI，内网 IP 部署（地址不固定）
// 特征：题块裁剪图（img.ansImg）+ maxsco 属性分数框 + OnSubmit(1) 提交

const AMEQP_SELECTORS = {
    // 答题卡图片（tmpImg_* 是透明批注层，严禁取用）
    ANSWER_IMAGE: 'img.ansImg',
    // 题块视口容器（img 在其中以负偏移裁剪显示，AI 只需要可视区域）
    IMAGE_BOX: '.img_box',

    // 分数输入框（id/name 形如 txt_que_N，N 为内部序号，不是题号）
    SCORE_INPUT: 'input.mark_tbx',

    // 满分：input[maxsco] 属性 → hidden #max_sco_N → legend 文本
    SCORE_BOX: '.sco_box',
    MAX_SCORE_HIDDEN: 'input.maxSco',
    SCORE_LEGEND: 'legend.mark_leg',

    // 平台内部状态字段：OnSubmit 校验的就是它们，填分后必须同步
    SUB_SCORE_HIDDEN: 'MarQueSubSco_',   // #MarQueSubSco_N 存该题得分
    QUE_VAL: '#queVal',                  // 当前总分显示
    QUE_VAL_OLD: '#queVal_old',

    // 提交按钮（onclick="OnSubmit(1)"，无确认框）
    SUBMIT_BUTTON: '#btn_submit',

    // 页面检测（五特征，防内网串台）
    PAGE_MAIN: '#Mark_main',
    PAGE_QUE_TOTAL: '#queSco_all',

    // 回评状态标记（可见 = 回评模式）
    REVIEW_TIT: '#reviewTit',
};

