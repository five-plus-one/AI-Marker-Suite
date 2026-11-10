// ========== 学科网 e卷通 DOM 选择器常量 ==========
// 实测来源：yuejuan.xkw.com 批改页（2026-11-10，契约详情见 tmp/agn_xkw_report.md）

const XKW_SELECTORS = {
    // 批改页路由（强信号，路径级）：/exam/marking/task/mark/{examId}
    MARK_ROUTE_PATTERN: /\/exam\/marking\/task\/mark\//,

    // 打分表行（el-table）：每题一行
    //   <tr class="el-table__row">
    //     <td><p class="ques-no"><span>2.11.12</span></p></td>
    //     <td><p class="ques-score"><div class="el-input"><input class="el-input__inner" type="number" placeholder="满12分"></div></p></td>
    //     <td><span class="set-btn">优解</span><span class="set-btn">异常</span></td>
    //   </tr>
    SCORE_ROW: 'tr.el-table__row',
    QUESTION_LABEL: 'p.ques-no',
    SCORE_BLOCK: 'p.ques-score',
    SCORE_INPUT: 'p.ques-score input.el-input__inner',
    // 满分提取：placeholder "满12分"
    MAX_SCORE_PLACEHOLDER_RE: /满\s*([\d.]+)\s*分/,

    // 提交按钮（<button>，纯文本）
    SUBMIT_BUTTON_TEXT: '提交分数',

    // 答题区（fabric canvas 容器，每切题一块；canvas 跨域污染不可 toDataURL）
    ANSWER_BLOCK: '.mark-image',
    ANSWER_CANVAS: '.mark-image canvas.lower-canvas',

    // 答题图 OSS（resource timing / API 契约过滤用）
    OSS_HOST_HINT: 'oss-yuejuan-prod',
    OSS_CROP_HINT: 'image/crop',
    // 同一张切题图存在无后缀与 /quality,q_80 两个加载变体，比较/去重只认 paperId+position
    OSS_PAPER_ID_RE: /\/(\d+)\.jpg/,
    OSS_POSITION_RE: /x_\d+,y_\d+,w_\d+,h_\d+/,

    // 取题/答卷数据 API（XHR/fetch 拦截目标）
    ITEM_API_HINT: 'question-group/item',
};
