// ========== 提示词组装与解析 ==========

// ---------- 字段数据工具函数 ----------

/**
 * 从字段数据中提取纯文本（兼容旧格式字符串和新格式对象）
 * @param {string|object} field - 旧格式字符串或 { text, images, format } 对象
 * @returns {string}
 */
function extractFieldText(field) {
    if (typeof field === 'string') return field;
    if (field && typeof field === 'object') {
        var t = field.text;
        if (typeof t === 'string') return t;
        // 递归处理：text 本身也可能是对象（双重嵌套）
        if (t && typeof t === 'object' && typeof t.text === 'string') return t.text;
        return '';
    }
    return '';
}

/**
 * 从字段数据中提取图片数组
 * @param {string|object} field
 * @returns {string[]}
 */
function extractFieldImages(field) {
    if (field && typeof field === 'object' && Array.isArray(field.images)) return field.images;
    return [];
}

// 编辑器保留原始图片数组及索引；请求只取正文实际引用的图片。
function extractReferencedFieldImages(field) {
    const images = extractFieldImages(field);
    const text = extractFieldText(field);
    // 早期仅图片的字段没有 Markdown 正文，继续保留其原有资料。
    if (!text.trim() && field?.format !== 'markdown') return images;
    const content = text.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[^\n]*(?=\n|$)|(`+)[\s\S]*?\2/g, '');
    const selected = new Set();
    for (const match of content.matchAll(/!\[[^\]]*\]\(ai-img:\/\/(\d+)\)/g)) {
        const escapes = content.slice(0, match.index).match(/\\+$/)?.[0].length || 0;
        if (escapes % 2 === 0) selected.add(Number(match[1]));
    }
    return images.filter((image, index) => image && selected.has(index));
}

/**
 * 从 config 中收集所有字段的图片（题目/答案/评分标准）
 * @param {object} config
 * @returns {string[]}
 */
function collectFieldImages(config) {
    var images = [];
    var qImg = extractReferencedFieldImages(config.question);
    var aImg = extractReferencedFieldImages(config.answer);
    var rImg = extractReferencedFieldImages(config.rubric);
    // 为每组图片添加标注，便于 AI 区分
    if (qImg.length) images.push.apply(images, qImg);
    if (aImg.length) images.push.apply(images, aImg);
    if (rImg.length) images.push.apply(images, rImg);
    return images;
}

/**
 * 构建图片归属说明（告知 AI 哪些图片属于题目/答案/评分标准）
 */
function buildImageAnnotation(config) {
    var qLen = extractReferencedFieldImages(config.question).length;
    var aLen = extractReferencedFieldImages(config.answer).length;
    var rLen = extractReferencedFieldImages(config.rubric).length;
    if (qLen + aLen + rLen === 0) return '';

    var parts = [];
    var idx = 1;
    if (qLen > 0) {
        parts.push('第' + idx + '-' + (idx + qLen - 1) + '张为题目配图');
        idx += qLen;
    }
    if (aLen > 0) {
        parts.push('第' + idx + '-' + (idx + aLen - 1) + '张为参考答案配图');
        idx += aLen;
    }
    if (rLen > 0) {
        parts.push('第' + idx + '-' + (idx + rLen - 1) + '张为评分标准配图');
        idx += rLen;
    }
    return '\n（图片说明：' + parts.join('，') + '。逐图用途以图片前的文字标签为准；参考资料不属于学生作答。）';
}

// ---------- 勤勉度 Prompt 片段 ----------
function buildDiligencePromptSection(config) {
    const diligence = config.scoring?.diligence;
    if (!diligence || !diligence.enabled) return '';

    const criteria = diligence.criteria || '字数较多(>15字)且书写较为工整';

    return `

【勤勉度】
等级：（1-5的整数，1=无勤勉/态度敷衍/未作答，2=一般，3=中等，4=较好，5=非常认真）
依据：（简述理由，参考标准：${criteria}）
注意：学生答案字数不超过15字或未作答时，必须给等级1`;
}

// ---------- 通用约束片段（所有评分 Prompt 共用） ----------
// startNum: 起始编号，避免各 Prompt 手动拼编号出错
// 小题分取整步长的文字描述（供提示词使用）
// step=1 时输出与历史完全一致（「一个整数」），保证默认配置下提示词逐字不变
// 是否启用「仅输出分数」精简输出模式
// 默认（undefined / 'detailed'）为详细模式，提示词与历史逐字一致
function isScoreOnlyMode(config) {
    return !!(config && (config.outputMode === 'score-only' || (config.scoring && config.scoring.outputMode === 'score-only')));
}

function describeScoreStep(step, maxScore) {
    const s = parseFloat(step) || 1;
    let text;
    if (s === 1) text = '（一个整数）';
    else if (s === 0.5) text = '（0.5 的倍数，如 0、0.5、1、1.5、2）';
    else if (s === 0.25) text = '（0.25 的倍数，如 0、0.25、0.5、0.75、1）';
    else text = '（' + s + ' 的倍数，如 0、' + s + '、' + (Math.round(s * 2 * 100) / 100) + '）';
    // 满分不整除步长时（如步长 1.5 / 满分 10），满分作为特例明确告知（#273）
    const max = parseFloat(maxScore);
    if (isFinite(max) && max > 0 && s > 0) {
        const ratio = max / s;
        if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
            text = text.slice(0, -1) + '，可给满分 ' + max + '）';
        }
    }
    return text;
}

function buildCommonConstraints(startNum, scoreOnly) {
    let n = startNum || 5;
    const lines = [];
    // 精简模式不输出【答案复述】，该约束会自相矛盾，须去掉
    if (!scoreOnly) {
        lines.push(n++ + '. 如果无法识别学生答案，在【答案复述】写"未能识别"');
    }
    lines.push(n++ + '. 严格按照评分标准打分，不要随意给分');
    lines.push(n++ + '. 被划掉、涂改、涂抹覆盖的内容视为无效，只评判最终保留的答案');
    lines.push(n++ + '. 只对学生在答卷上实际写出的内容评分；印刷题干、题号、预印图形、参考答案和评分标准均不属于学生作答。不得自行解题后将解答归给学生，也不得用参考答案补全学生未写的过程或结果');
    lines.push(n++ + '. 整张答卷没有学生作答，或仅有题号、抄写题干等没有有效作答时，得分必须为0，勤勉等级为1；不能因试卷自带文字或图形给分');
    lines.push(n++ + '. 有作答但无法辨认时，不得猜测其内容或照抄参考答案作为识别结果；仅给可以从学生原始作答确认的评分点打分');
    lines.push(n++ + '. 先判断【作答状态】：可辨认、部分不清、无法辨认、未作答，四选一。无法辨认不等于未作答，不能据此判零分；由教师核对。部分不清时保留可确认的作答与得分');
    lines.push(n++ + '. 逐项核对题号、原文和最终保留内容；不得将其他小题的结果挪来给分或凭结果补出未写的步骤。完整正确的等价方法按相同标准给分，不强求参考解答的形式');
    if (!scoreOnly) lines.push(n++ + '. 整张答卷未作答时，【答案复述】只写“未作答”；答案复述仅转录学生实际作答，不写示范解答');
    return lines.join('\n');
}

// ---------- 取总满分（units 优先，回退 scoring.maxScore） ----------
function resolveMaxScore(config) {
    // 优先从 scoring.units 计算
    const units = config.scoring?.units;
    if (units && units.length > 0) {
        return units.reduce((sum, u) => sum + (u.maxScore || 0), 0);
    }
    // 回退 scoring.maxScore 或顶层 maxScore（兼容旧字段）
    return config.scoring?.maxScore || config.maxScore || 0;
}

// ---------- 结构化评分 Prompt（新） ----------
function buildStructuredPrompt(config) {
    const maxScore = resolveMaxScore(config);
    const maxScoreText = maxScore > 0 ? `满分${maxScore}分` : '满分未指定，请根据常规满分评判';

    // 兼容新格式对象和旧格式字符串
    var questionText = extractFieldText(config.question);
    var answerText = extractFieldText(config.answer);
    var rubricText = extractFieldText(config.rubric);
    var imgAnnotation = buildImageAnnotation(config);

    let prompt = `你是一位严格的阅卷老师。请查看图片中的学生答案并评分。

===== 输入信息 =====`;
    if (imgAnnotation) prompt += imgAnnotation;
    if (questionText) prompt += `\n【题目】\n${questionText}`;
    if (answerText) prompt += `\n【参考答案】\n${answerText}`;
    if (rubricText) prompt += `\n【评分标准】\n${rubricText}`;
    prompt += `\n【满分】\n${maxScoreText}`;

    if (isScoreOnlyMode(config)) {
        // 精简模式：只输出分数，省去答案复述/评分依据/分数计算（教师实测约 3 倍提速）
        prompt += `

===== 输出要求 =====
只输出作答状态和分数，不要输出任何分析、评语或计算过程。严格按照以下格式：

【作答状态】
（可辨认、部分不清、无法辨认、未作答，四选一）

【得分】
（一个数字，可以是小数，表示准确性得分）${buildDiligencePromptSection(config)}

===== 重要约束 =====
1. 只输出【作答状态】和【得分】，以及启用的勤勉度，不要任何其他内容
2. 【得分】必须只有一行，只包含数字，可以是小数
${buildCommonConstraints(3, true)}`;
    } else {
        prompt += `

===== 输出要求 =====
你必须严格按照以下格式输出，不得添加任何额外内容：

【作答状态】
（可辨认、部分不清、无法辨认、未作答，四选一）

【答案复述】
（按题号逐字转录学生最终保留的作答，公式可用LaTeX；不改写、不补全，看不清处标注[无法辨认]，不抄参考答案或印刷题干）

【评分依据】
（逐项评分，每条格式：序号.评分项名(满分X分): 对应作答原文“…”；判定及得X分。没有原文依据的步骤不得补写给分，排除划去内容，接受完整正确的等价方法）

【分数计算】
（写出计算公式，如：1+2+0+2=5）

【得分】
（一个数字，可以是小数，表示准确性得分）${buildDiligencePromptSection(config)}

===== 重要约束 =====
1. 必须使用【】作为段落标记，不要省略任何段落
2. 【得分】必须只有一行，只包含数字，可以是小数
3. 可以在内容中使用 Markdown 格式（如 **加粗**、列表、$公式$），但【】段落标记必须保留
${buildCommonConstraints(4)}`;
    }
    return prompt;
}

// ---------- 旧格式兼容 Prompt ----------
function buildPrompt(config) {
    var _q = extractFieldText(config.question);
    var _a = extractFieldText(config.answer);
    var _r = extractFieldText(config.rubric);
    let prompt = `你是一位严格的阅卷老师，请根据以下信息对学生答案进行评分：\n\n`;
    if (_q) prompt += `**题目内容：**\n${_q}\n\n`;
    if (_a) prompt += `**标准答案：**\n${_a}\n\n`;
    if (_r) prompt += `**评分标准：**\n${_r}\n\n`;
    prompt += buildImageAnnotation(config) + '\n' + buildCommonConstraints(1, true) + '\n';
    prompt += `请仔细查看图片中的学生答案，并按照以下格式返回评分结果（必须严格按此格式）：\n\n学生答案：[OCR识别出的学生答案文字内容]\n分数：[数字]\n评语：[简短评语]\n\n注意：\n1. 先OCR识别图片中的文字，将识别结果写在"学生答案"后\n2. 只返回数字分数，不要带单位\n3. 评语控制在100字以内\n4. 严格按照评分标准打分\n5. 被划掉、涂改、涂抹覆盖的内容视为无效，只评判最终保留的答案`;
    return prompt;
}

// ---------- 结构化解析器（新） ----------
function parseStructuredResponse(text, maxScore) {
    const clean = text;  // 保留 markdown 格式，不再清除
    const scoreLimit = (maxScore && maxScore > 0) ? maxScore : 999;

    // Level 1: 按【】标记分段
    const sections = {};
    const regex = /【([^】]+)】\s*([\s\S]*?)(?=【|$)/g;
    let match;
    while ((match = regex.exec(clean)) !== null) {
        const key = match[1].trim();
        const value = match[2].trim();
        sections[key] = value;
    }

    // 检查是否成功解析到结构化内容
    const hasStructuredContent = sections['得分'] || sections['最终得分'] || sections['总分'] || sections['答案复述'];

    if (!hasStructuredContent) {
        // 结构化解析失败，回退到旧格式
        console.log('📝 [解析] 结构化解析失败，尝试旧格式解析...');
        return parseLegacyResponse(clean, maxScore);
    }

    // Level 2: 提取分数（优先级：【得分】> 【最终得分】> 【总分】）
    let rawScore = extractScore(sections['得分'], maxScore);
    if (rawScore === null) rawScore = extractScore(sections['最终得分'], maxScore);
    if (rawScore === null) rawScore = extractScore(sections['总分'], maxScore);
    // 回退：从【分数计算】提取（"0+4+4=8" / "总得分8分"，#287）——
    // 仅认等号结果/总得分，不取裸首数字，避免误抓算式里的小题分
    if (rawScore === null && sections['分数计算']) {
        const calc = normalizeScoreText(sections['分数计算']);
        const eq = calc.match(/=\s*(\d+\.?\d*)/g);
        if (eq && eq.length > 0) {
            const last = eq[eq.length - 1].match(/(\d+\.?\d*)/);
            if (last) rawScore = parseFloat(last[1]);
        }
        if (rawScore === null) {
            const ts = calc.match(/总得分[^0-9]*(\d+\.?\d*)/);
            if (ts) rawScore = parseFloat(ts[1]);
        }
    }
    let finalScore = rawScore;

    // Level 4: 分数范围校验（截断到有效范围，避免因AI给分超出满分导致null）
    if (finalScore !== null && finalScore < 0) {
        console.warn(`⚠️ [解析] 分数为负数(${finalScore})，修正为0`);
        finalScore = 0;
    }
    if (finalScore !== null && finalScore > scoreLimit) {
        console.warn(`⚠️ [解析] 分数超出满分(${finalScore} > ${scoreLimit})，截断为满分`);
        finalScore = scoreLimit;
    }

    // Level 5: 识别答案校验
    let studentAnswer = sections['答案复述'] || '未能识别';
    const invalidAnswers = ['非选择题', '选择题', '略', '无', '无法识别'];
    if (invalidAnswers.includes(studentAnswer.trim())) {
        console.warn(`⚠️ [解析] 识别答案可能是错误的: ${studentAnswer}`);
        studentAnswer = '未能识别';
    }

    // Level 6: 勤勉度提取
    let diligenceLevel = 0;
    let diligenceReason = '';
    if (sections['勤勉度']) {
        const levelMatch = sections['勤勉度'].match(/等级[：:]\s*(\d)/);
        if (levelMatch) diligenceLevel = Math.min(5, Math.max(1, parseInt(levelMatch[1])));
        const reasonMatch = sections['勤勉度'].match(/依据[：:]\s*(.+?)(?=\n|$)/);
        if (reasonMatch) diligenceReason = reasonMatch[1].trim();
    }

    return {
        studentAnswer: studentAnswer,
        answerStatus: sections['作答状态'] || '',
        _answerProvided: !!sections['答案复述'],
        score: finalScore,
        rawScore: rawScore,
        scoringBasis: sections['评分依据'] || '',
        calculation: sections['分数计算'] || '',
        comment: sections['评分依据'] || '',
        diligenceLevel: diligenceLevel,
        diligenceReason: diligenceReason,
        _sections: sections
    };
}

// 解析抗漂移（#287）：全角数字/小数点归一化、常见中文数字（0~99）转阿拉伯数字。
// 模型偶发输出「８分」「八分」「２.５」等变体，直接 \d 匹配会解析为 null 导致批改停摆。
// 注意（#297）：中文句号「。」**不做**小数点转换——实测「25(1)：3。4分」被并成 3.4 分属错分，
// 保守取整（3）优于错分（3.4）；仅全角点 U+FF0E 转半角
function normalizeScoreText(t) {
    let s = String(t)
        .replace(/[\uff10-\uff19]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
        .replace(/\uff0e/g, '.')
        .replace(/[\uff1a]/g, ':')
        .replace(/[\uff0d\u2212]/g, '-');
    // 混合小数变体（"二.五分" → "2.5"；中文句号形态"三。五分"同样按小数处理，#299）
    // 注意：数字。数字（"3。4"）**不**转换（#297 实测该形态是断句不是小数）
    s = s.replace(/([零〇一二三四五六七八九])[\.．。]([零〇一二三四五六七八九])/g, (m, a, b) => {
        const na = cnScoreToNumber(a);
        const nb = cnScoreToNumber(b);
        return (na === null || nb === null) ? m : na + '.' + nb;
    });
    s = s.replace(/([零〇一二两三四五六七八九十]+)(?=\s*分)/g, m => {
        const n = cnScoreToNumber(m);
        return n === null ? m : String(n);
    });
    return s;
}

function cnScoreToNumber(cn) {
    const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (!cn) return null;
    if (cn.length === 1) return digits[cn] != null ? digits[cn] : null;
    const tens = cn.indexOf('十');
    if (tens === -1) return null;
    const head = cn.slice(0, tens);
    const tail = cn.slice(tens + 1);
    const h = head ? (digits[head] != null ? digits[head] : null) : 1;
    const t = tail ? (digits[tail] != null ? digits[tail] : null) : 0;
    if (h === null || t === null) return null;
    return h * 10 + t;
}

function extractScore(text, maxScore) {
    if (!text) return null;
    // 抗格式漂移（#287）
    text = normalizeScoreText(text);
    // 优先取等号后的结果（如 "2+2=4" → 4），避免误取算式中的第一个数
    let num = null;
    const eqMatches = text.match(/=\s*(\d+\.?\d*)/g);
    if (eqMatches && eqMatches.length > 0) {
        const last = eqMatches[eqMatches.length - 1].match(/(\d+\.?\d*)/);
        if (last) num = parseFloat(last[1]);
    }
    // 回退：取第一个数字（"得分：4分" 这类纯数字场景）
    if (num === null || isNaN(num)) {
        const match = text.match(/(\d+\.?\d*)/);
        if (!match) return null;
        num = parseFloat(match[1]);
    }
    if (num < 0) num = 0;
    const upperLimit = (maxScore && maxScore > 0) ? maxScore : 999;
    if (num > upperLimit) num = upperLimit;
    return num;
}

// ---------- 旧格式解析器（兼容） ----------
function parseLegacyResponse(text, maxScore) {
    const clean = text.replace(/\*\*/g, '');
    const scoreLimit = maxScore || 999;

    // 提取学生答案
    const studentAnswerMatch = clean.match(/学生答案[：:]\s*(.+?)(?=\n.*?分数|$)/s);
    let studentAnswer = studentAnswerMatch ? studentAnswerMatch[1].trim() : '未能识别';

    // 识别答案校验
    const invalidAnswers = ['非选择题', '选择题', '略', '无', '无法识别'];
    if (invalidAnswers.includes(studentAnswer.trim())) {
        studentAnswer = '未能识别';
    }

    // 提取分数 - 多种格式兼容
    let score = null;

    // 格式1: "分数：8" 或 "分数:8"
    let scoreMatch = clean.match(/分数[：:]\s*(\d+\.?\d*)/);
    if (scoreMatch) score = parseFloat(scoreMatch[1]);

    // 格式2: "得分：8" 或 "得分:8"
    if (score === null) {
        scoreMatch = clean.match(/得分[：:]\s*(\d+\.?\d*)/);
        if (scoreMatch) score = parseFloat(scoreMatch[1]);
    }

    // 格式3: "8分" 或 "8 分"
    if (score === null) {
        scoreMatch = clean.match(/(\d+\.?\d*)\s*分/);
        if (scoreMatch) score = parseFloat(scoreMatch[1]);
    }

    // 格式4: 末尾纯数字
    if (score === null) {
        const lines = clean.trim().split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            const numMatch = line.match(/^(\d+\.?\d*)$/);
            if (numMatch) {
                let num = parseFloat(numMatch[1]);
                if (num < 0) num = 0;
                if (num > scoreLimit) num = scoreLimit;
                score = num;
                break;
            }
        }
    }

    // 提取评语
    const commentMatch = clean.match(/评语[：:]\s*(.+)/s);
    const comment = commentMatch ? commentMatch[1].trim() : '';

    return {
        studentAnswer: studentAnswer,
        score: score,
        rawScore: score,
        scoringBasis: '',
        calculation: '',
        comment: comment || text,
        diligenceLevel: 0,
        diligenceReason: '',
        _answerProvided: !!studentAnswerMatch,
        _sections: {}
    };
}

// ---------- 仲裁 Prompt ----------
function buildArbitrationPrompt(config, resultA, resultB, threshold) {
    var questionText = extractFieldText(config.question);
    var answerText = extractFieldText(config.answer);
    var rubricText = extractFieldText(config.rubric);
    var imgAnnotation = buildImageAnnotation(config);
    var maxScore = resolveMaxScore(config);
    var maxScoreText = maxScore > 0 ? `满分${maxScore}分` : '满分未指定，请根据常规满分评判';

    // 多小题判定
    const units = config.scoring?.units || [];
    const subQuestions = (units.length > 1 && resultA?.subScores && resultA.subScores.length > 0)
        ? resultA.subScores
        : [];
    const hasSub = subQuestions.length > 0;

    let prompt = `你是阅卷仲裁专家。两位老师对同一份试卷评分有分歧，请独立审阅学生作答图片后裁定。

===== 评分分歧 =====
老师A评分：${resultA.score}分
老师A评分依据：${resultA.comment || resultA.scoringBasis || '无'}
${resultA.calculation ? `老师A分数计算：${resultA.calculation}` : ''}

老师B评分：${resultB.score}分
老师B评分依据：${resultB.comment || resultB.scoringBasis || '无'}
${resultB.calculation ? `老师B分数计算：${resultB.calculation}` : ''}

分差：${Math.abs(resultA.score - resultB.score)}分（阈值：${threshold}分）`;

    // 多小题：展示 A/B 的逐小题分供仲裁模型参考
    if (hasSub) {
        prompt += `\n\n老师A各小题得分：`;
        for (const sq of resultA.subScores) {
            prompt += `\n${sq.label}：${sq.score ?? '—'}分 / 满分${sq.maxScore || '?'}分${sq.comment ? `（${sq.comment}）` : ''}`;
        }
        if (resultB?.subScores && resultB.subScores.length === resultA.subScores.length) {
            prompt += `\n\n老师B各小题得分：`;
            for (const sq of resultB.subScores) {
                prompt += `\n${sq.label}：${sq.score ?? '—'}分 / 满分${sq.maxScore || '?'}分${sq.comment ? `（${sq.comment}）` : ''}`;
            }
        }
    }

    prompt += `

===== 参考信息 =====`;
    if (imgAnnotation) prompt += imgAnnotation;
    if (questionText) prompt += `\n【题目】\n${questionText}`;
    if (answerText) prompt += `\n【参考答案】\n${answerText}`;
    if (rubricText) prompt += `\n【评分标准】\n${rubricText}`;
    prompt += `\n【满分】\n${maxScoreText}`;

    if (hasSub) {
        prompt += `\n【各小题评分要求】\n`;
        for (const sq of subQuestions) {
            prompt += `\n### ${sq.label}（满分${sq.maxScore || '?'}分）\n`;
        }
    }

    prompt += `
===== 输出要求 =====
请先独立分析学生答案，再对比两位老师的评分，最后给出你的裁定。严格按照以下格式输出：

【作答状态】
（可辨认、部分不清、无法辨认、未作答，四选一）

【答案复述】
（按题号逐字转录学生最终保留的作答，公式可用LaTeX；不改写、不补全，看不清处标注[无法辨认]，不抄参考答案或两位老师的复述）

【评分依据】
（抛开两位老师的评分，仅根据评分标准和学生实际作答内容，逐条分析应得分和扣分点）`;

    if (hasSub) {
        // resultA.subScores 不带 roundStep，从 scoring.units 按序取
        const arbUnits = config.scoring?.units || [];
        subQuestions.forEach((sq, i) => {
            const step = arbUnits[i]?.roundStep || config.scoring?.roundStep || 1;
            prompt += `\n\n${sq.label}分数：${describeScoreStep(step, arbUnits[i]?.maxScore)}`;
        });
    }

    prompt += `

【分数计算】
${hasSub ? '（写出各小题计算公式，各小题分数之和应等于总分）' : '（写出计算公式，如：1+2+0+2=5）'}

【最终得分】
${hasSub ? '（各小题分数之和，一个数字）' : '（一个整数，基于你的独立判断给出最终分数，不必局限于两位老师的分数范围）'}

【仲裁分析】
（对比你的独立判断与两位老师的评分，分析分歧原因：谁的评判更合理？哪里存在误判？）

===== 重要约束 =====
1. 必须使用【】作为段落标记
2. 【最终得分】必须只有一行，只包含${hasSub ? '数字' : '一个整数'}
3. 你必须独立审阅学生作答图片，不要被两位老师的分数左右
4. 可以在内容中使用 Markdown 格式（**加粗**、$公式$等），但【】段落标记必须保留
${buildCommonConstraints(5)}`;
    return prompt;
}

// ---------- 旧格式 Prompt 解析（保留兼容） ----------
function parseAIResponseText(text) {
    return parseLegacyResponse(text);
}

function parsePromptModification(text) {
    const clean = text;

    function extract(fieldNames) {
        for (const name of fieldNames) {
            const pattern = new RegExp(name + '[：:]\\s*([\\s\\S]+?)(?=\\n[^\\S\\n]*(?:修改理由|新题目内容|新参考答案|新评分标准)[：:]|$)', 'i');
            const m = clean.match(pattern);
            if (m && m[1].trim()) {
                let val = m[1].trim();
                if (/^不变/.test(val)) return '不变';
                return val;
            }
        }
        return null;
    }

    const reason = extract(['修改理由']) || '';
    const question = extract(['新题目内容']) || '不变';
    const answer = extract(['新参考答案', '新答案']) || '不变';
    const rubric = extract(['新评分标准', '评分标准']) || '不变';

    if (answer === '不变' && rubric === '不变') {
        console.warn('[纠错] ⚠️ AI 响应中参考答案和评分标准均为"不变"，原文如下：\n' + text.slice(0, 500));
    }
    console.log(`[纠错] 解析结果 — 理由: ${reason.slice(0, 60)}... | 答案: ${answer === '不变' ? '不变' : answer.slice(0, 60) + '...'} | 标准: ${rubric === '不变' ? '不变' : rubric.slice(0, 60) + '...'}`);

    return { reason, question, answer, rubric };
}

// ========== 分小题提示词组装 ==========
function buildSubQuestionPrompt(config) {
    var questionText = extractFieldText(config.question);
    var answerText = extractFieldText(config.answer);
    var rubricText = extractFieldText(config.rubric);
    var imgAnnotation = buildImageAnnotation(config);
    var totalMaxScore = resolveMaxScore(config);

    let prompt = `你是一位严格的阅卷老师。请查看图片中的学生答案并评分。

===== 输入信息 =====`;
    if (imgAnnotation) prompt += imgAnnotation;
    if (questionText) prompt += `\n【题目】\n${questionText}`;
    // 顶层参考答案/评分标准（多小题共用；评分单元本身不携带答案/标准字段）
    if (answerText) prompt += `\n【参考答案】\n${answerText}`;
    if (rubricText) prompt += `\n【评分标准】\n${rubricText}`;
    if (totalMaxScore > 0) prompt += `\n【满分】\n满分${totalMaxScore}分`;

    prompt += `\n【各小题评分要求】\n`;
    for (const sq of config.subQuestions) {
        const maxScoreText = (sq.maxScore && sq.maxScore > 0) ? `满分${sq.maxScore}分` : '满分未指定，请根据常规满分评判';
        prompt += `\n### ${sq.label}（${maxScoreText}）`;
        if (sq.answer) prompt += `\n参考答案：${sq.answer}`;
        if (sq.rubric) prompt += `\n评分标准：${sq.rubric}`;
        prompt += '\n';
    }

    if (!isScoreOnlyMode(config)) {
        prompt += `
===== 输出要求 =====
你必须严格按照以下格式输出，不得添加任何额外内容：

【作答状态】
（可辨认、部分不清、无法辨认、未作答，四选一）

【答案复述】
（按题号逐字转录学生最终保留的作答，公式可用LaTeX；不改写、不补全，看不清处标注[无法辨认]，不抄参考答案或印刷题干）

【评分依据】
（逐项评分，每条格式：序号.评分项名(满分X分): 对应作答原文“…”；判定及得X分。排除划去内容，不跨题挪用或补写步骤，接受完整正确的等价方法）

【分数计算】
（写出各小题计算公式）`;
    } else {
        prompt += `
===== 输出要求 =====
只输出作答状态、各小题分数和总分，不要输出任何分析、评语或计算过程。

【作答状态】
（可辨认、部分不清、无法辨认、未作答，四选一）`;
    }

    for (const sq of config.subQuestions) {
        prompt += `\n\n${sq.label}分数：${describeScoreStep(sq.roundStep, sq.maxScore)}`;
        if (!isScoreOnlyMode(config)) {
            prompt += `\n${sq.label}评语：（简短评语）`;
        }
    }

    prompt += `\n\n【得分】
（各小题分数之和，一个数字）${buildDiligencePromptSection(config)}

===== 重要约束 =====
${isScoreOnlyMode(config)
        ? `1. 只输出【作答状态】、各小题分数和【得分】，以及启用的勤勉度，不要输出分析、评语或计算过程
2. 各小题分数和【得分】必须各只有一行，只包含数字
3. 各小题分数之和应等于【得分】`
        : `1. 必须使用【】作为段落标记
2. 各小题分数和【得分】必须各只有一行，只包含数字
3. 可以在内容中使用 Markdown 格式（**加粗**、$公式$等），但【】段落标记必须保留
4. 各小题分数之和应等于【得分】`}
${buildCommonConstraints(isScoreOnlyMode(config) ? 4 : 5, isScoreOnlyMode(config))}`;
    return prompt;
}

// ========== 分小题结果解析 ==========
// 得分字段允许数字、加减算式及等式；只计算明确的数值，不执行模型返回的代码。
function parseSubQuestionScoreValue(value, maxScore) {
    const clean = normalizeScoreText(value).trim()
        .replace(/＋/g, '+').replace(/＝/g, '=');
    const parts = clean.split('=');
    const values = [];
    for (const part of parts) {
        const match = part.trim().match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*[+-]\s*(?:\d+(?:\.\d*)?|\.\d+))*/);
        if (!match) return null;
        const rest = part.trim().slice(match[0].length).trim();
        // 算式未结束、未知运算或比值不能退回首项。普通说明与“3。4分”保留兼容。
        if (rest && !/^(?:分(?:\s|$|[，,。；;（(])|[，,。；;（(])/.test(rest)) return null;
        const terms = match[0].replace(/\s/g, '').match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/g);
        const number = terms.reduce((sum, term) => sum + Number(term), 0);
        if (!Number.isFinite(number)) return null;
        values.push(Math.round(number * 1e8) / 1e8);
    }
    if (values.some(number => Math.abs(number - values[0]) > 1e-8)) return null;
    const upper = maxScore > 0 ? maxScore : 999;
    return Math.max(0, Math.min(values[0], upper));
}

function parseSubQuestionScores(text, config, base) {
    const clean = normalizeScoreText(text.replace(/\*\*([^*\r\n]+)\*\*/g, '$1'));
    // OCR 复述可能包含“1：…”等学生原文，不作为模型给分字段。
    const scoreText = clean.replace(/【(?:答案复述|学生答案)】[\s\S]*?(?=【|$)/g, '')
        .replace(/(^|\n)[ \t]*学生答案[ \t]*:[\s\S]*?(?=\n[^\n]*分数[ \t]*:|【|$)/g, '$1')
        .replace(/【[^】]+】/g, '\n');
    const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const subScores = config.subQuestions.map(sq => {
        const label = normalizeScoreText(sq.label);
        const escapedLabel = escape(label);
        const prefix = '^\\s*(?:[-•]\\s*)?';
        const candidates = pattern => {
            const line = (prefix + pattern + '\\s*([^\\r\\n]*)$').replace(/\\s/g, '[^\\S\\r\\n]');
            return Array.from(scoreText.matchAll(new RegExp(line, 'gm')), m => m[1]);
        };
        let fields = candidates(escapedLabel + '\\s*分数\\s*:\\s*');
        // 保留旧模型将父题号写为单个括号子题的格式；多个子题时不把其中一个冒充父题。
        if (fields.length === 0) {
            const bracketLabels = Array.from(scoreText.matchAll(new RegExp(prefix + '(' + escapedLabel + '\\(\\d+\\))\\s*(?:分数\\s*)?:', 'gm')), m => m[1]);
            const labels = [...new Set(bracketLabels)];
            if (labels.length === 1 && !config.subQuestions.some(other => normalizeScoreText(other.label) === labels[0])) {
                fields = candidates(escape(labels[0]) + '\\s*(?:分数\\s*)?:\\s*');
            }
        }
        if (fields.length === 0) fields = candidates(escapedLabel + '\\s*:\\s*');
        if (fields.length === 0) fields = candidates(escapedLabel + '\\s+').filter(field => /分/.test(field));
        const scores = fields.map(field => parseSubQuestionScoreValue(field, sq.maxScore));
        // 缺失、无效或互相矛盾的重复字段保留待核查状态，不补零或取任意一条。
        const score = scores.length > 0 && scores.every(value => value !== null && value === scores[0]) ? scores[0] : null;
        const commentPattern = (prefix + escapedLabel + '\\s*评语\\s*:\\s*(.+?)(?=\\n|$)').replace(/\\s/g, '[^\\S\\r\\n]');
        const commentMatch = clean.match(new RegExp(commentPattern, 'm'));
        return { id: sq.id, label: sq.label, score, maxScore: sq.maxScore, comment: commentMatch ? commentMatch[1].trim() : '' };
    });
    const score = subScores.length > 0 && subScores.every(item => item.score !== null)
        ? Math.round(subScores.reduce((sum, item) => sum + item.score, 0) * 1e8) / 1e8 : null;
    if (score !== null && base.score !== null && Math.abs(score - base.score) > 1e-8) {
        console.warn(`⚠️ [解析] 模型总分(${base.score})与小题之和(${score})不一致，按小题汇总`);
    }
    console.log(`🧠 [诊断] 分小题解析结果 — 总分: ${score}, 各小题: ${subScores.map(s => s.label + '=' + s.score).join(', ')}`);
    return { ...base, score, rawScore: score, subScores };
}

function parseSubQuestionResponse(text, config) {
    const maxScore = config.subQuestions
        ? config.subQuestions.reduce((sum, sq) => sum + (sq.maxScore || 0), 0)
        : resolveMaxScore(config);
    return parseSubQuestionScores(text, config, parseStructuredResponse(text, maxScore));
}

function parseLegacySubQuestionResponse(text, config) {
    return parseSubQuestionScores(text, config, parseLegacyResponse(text));
}

// ========== 打分专用函数 ==========
async function callAIGrading(base64DataArray, config, onStreamUpdate) {
    // 从 scoring.units 派生 subQuestions（唯一数据源）
    const units = config.scoring?.units || [];
    const subQuestions = units.length > 1
        ? units.map((u, i) => ({
            id: String.fromCharCode(97 + i),
            label: u.label,
            maxScore: u.maxScore,
            roundStep: u.roundStep || config.scoring?.roundStep || 1
        }))
        : [];
    const hasSub = subQuestions.length > 0;

    // 将派生的 subQuestions 注入 config 供 prompt 函数使用
    const callConfig = { ...config, gradingRequest: true, subQuestions: hasSub ? subQuestions : undefined, requestBudget: { remaining: 3 } };

    const prompt = hasSub ? buildSubQuestionPrompt(callConfig) : buildStructuredPrompt(callConfig);

    // 收集题目/答案/评分标准中的内嵌图片
    const fieldImages = collectFieldImages(config);

    // 计算总满分
    const maxScore = config.scoring?.maxScore ?? PresetManager.getMaxScore();

    if (hasSub) {
        console.log(`📋 [诊断] 评分单元配置 — 共 ${subQuestions.length} 个: ${subQuestions.map(sq => `${sq.label}(满分${sq.maxScore ?? '未设置'})`).join(', ')}`);
    }

    for (let parseAttempt = 0; parseAttempt < 2; parseAttempt++) {
            const fullText = await callAIWithRetry(prompt, base64DataArray, callConfig, onStreamUpdate, fieldImages);
            console.log('📝 [诊断] AI返回内容长度:', fullText.length);

            const parsed = hasSub
                ? parseSubQuestionResponse(fullText, callConfig)
                : parseStructuredResponse(fullText, maxScore);
            console.log(`🧠 [诊断] AI响应解析结果 — 分数: ${parsed.score}, 满分: ${maxScore}, 识别答案长度: ${(parsed.studentAnswer || '').length}字, 原始文本长度: ${fullText.length}字`);
            if (parsed._sections) {
                const sectionKeys = Object.keys(parsed._sections);
                console.log(`📋 [诊断] 解析到 ${sectionKeys.length} 个段落: ${sectionKeys.join(', ')}`);
            }
            if (parsed.score === null) {
                console.warn('⚠️ [诊断] 分数解析为 null');
            }
            if (parsed.score !== null || callConfig.requestBudget.remaining === 0 || parseAttempt === 1 || callConfig.outputObservation?.upgraded) return parsed;
            console.warn('⚠️ [诊断] 正在重新获取可识别的评分结果');
    }
}

// ========== 分数计算函数（委托给 ScoreCalculator）==========

// 取整规则 — 委托给 ScoreCalculator.round()
function applyScoringRules(score, scoringConfig) {
    return ScoreCalculator.round(score, scoringConfig);
}

// 勤勉加分计算 — 委托给 ScoreCalculator.calcDiligenceBonus()
function applyDiligenceBonus(accuracyScore, diligenceLevel, maxScore, diligenceConfig) {
    return ScoreCalculator.calcDiligenceBonus(accuracyScore, diligenceLevel, maxScore, diligenceConfig);
}

// 勤勉加分分配到小题 — 委托给 ScoreCalculator.distributeBonus()
function distributeDiligenceBonus(subScores, bonus, roundFn) {
    return ScoreCalculator.distributeBonus(subScores, bonus, roundFn);
}
