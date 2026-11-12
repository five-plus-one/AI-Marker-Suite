// 华翰云云阅卷（鹿城、温州部署）选择器常量
// 批改页：/static-v2/exam/index.html#/marking/grading?questionId={题块ID}&thisType=2
// 契约来源：真机 DOM 实测（#301）——el-input 分数框 #compuinput + button.submitscorebtn（给分）
window.HUAHANYUN_SELECTORS = {
    // 分数输入框（计算器给分面板，placeholder 请给分）
    SCORE_INPUT: '#compuinput',
    // 温州 Vue 3 单题面板：键盘给分、一键给分。步长输入框不参与评分。
    WENZHOU_SCORE_INPUT: 'input#compuinput, #compuinput input.el-input__inner, .redbiginput input.el-input__inner[placeholder="请给分"]',
    // 给分提交按钮
    SUBMIT_BUTTON: 'button.submitscorebtn',
    // 答卷图（OBS 题块裁剪图；另有 data: 小图标需过滤）
    ANSWER_IMAGE: 'img.el-image__inner',
};
