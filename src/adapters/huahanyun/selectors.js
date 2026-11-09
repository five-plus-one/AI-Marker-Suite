// 华翰云云阅卷（yj.lcedu.net.cn 等部署）选择器常量
// 批改页：/static-v2/exam/index.html#/marking/grading?questionId={题块ID}&thisType=2
// 契约来源：真机 DOM 实测（#301）——el-input 分数框 #compuinput + button.submitscorebtn（给分）
window.HUAHANYUN_SELECTORS = {
    // 分数输入框（计算器给分面板，placeholder 请给分）
    SCORE_INPUT: '#compuinput',
    // 给分提交按钮
    SUBMIT_BUTTON: 'button.submitscorebtn',
    // 答卷图（OBS 题块裁剪图；另有 data: 小图标需过滤）
    ANSWER_IMAGE: 'img.el-image__inner',
};
