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

/**
 * 从 config 中收集所有字段的图片（题目/答案/评分标准）
 * @param {object} config
 * @returns {string[]}
 */
function collectFieldImages(config) {
    var images = [];
    var qImg = extractFieldImages(config.question);
    var aImg = extractFieldImages(config.answer);
    var rImg = extractFieldImages(config.rubric);
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
    var qLen = extractFieldImages(config.question).length;
    var aLen = extractFieldImages(config.answer).length;
    var rLen = extractFieldImages(config.rubric).length;
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
    return '\n（图片说明：' + parts.join('，') + '）';
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

// ---------- 结构化评分 Prompt（新） ----------
function buildStructuredPrompt(config) {
    const maxScore = config.maxScore || 0;
    const maxScoreText = maxScore > 0 ? `满分${maxScore}分` : '满分未指定，请根据常规满分评判';

    // 兼容新格式对象和旧格式字符串
    var questionText = extractFieldText(config.question);
    var answerText = extractFieldText(config.answer);
    var rubricText = extractFieldText(config.rubric);
    var imgAnnotation = buildImageAnnotation(config);

    let prompt = `你是一位严格的阅卷老师。请查看图片中的学生答案并评分。

===== 输入信息 =====`;
    if (questionText) prompt += `\n【题目】${imgAnnotation}\n${questionText}`;
    if (answerText) prompt += `\n【标准答案】\n${answerText}`;
    if (rubricText) prompt += `\n【评分标准】\n${rubricText}`;
    prompt += `\n【满分】\n${maxScoreText}`;

    prompt += `

===== 输出要求 =====
你必须严格按照以下格式输出，不得添加任何额外内容：

【答案复述】
（逐条列出学生答案要点，每条一行，用序号标注）

【评分依据】
（逐项评分，每条格式：序号.评分项名(满分X分): 得分理由）

【分数计算】
（写出计算公式，如：1+2+0+2=5）

【得分】
（一个数字，可以是小数，表示准确性得分）${buildDiligencePromptSection(config)}

===== 重要约束 =====
1. 必须使用【】作为段落标记，不要省略任何段落
2. 【得分】必须只有一行，只包含数字，可以是小数
3. 可以在内容中使用 Markdown 格式（如 **加粗**、列表、$公式$），但【】段落标记必须保留
4. 如果无法识别学生答案，在【答案复述】写"未能识别"
5. 严格按照评分标准打分，不要随意给分
6. 被划掉、涂改、涂抹覆盖的内容视为无效，只评判最终保留的答案`;
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
        score: finalScore,
        rawScore: rawScore,
        scoringBasis: sections['评分依据'] || '',
        calculation: sections['分数计算'] || '',
        comment: (sections['评分依据'] || '').substring(0, 500),
        diligenceLevel: diligenceLevel,
        diligenceReason: diligenceReason,
        _sections: sections
    };
}

function extractScore(text, maxScore) {
    if (!text) return null;
    const match = text.match(/(\d+\.?\d*)/);
    if (match) {
        let num = parseFloat(match[1]);
        if (num < 0) num = 0;
        const upperLimit = (maxScore && maxScore > 0) ? maxScore : 999;
        if (num > upperLimit) num = upperLimit;
        return num;
    }
    return null;
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
        _sections: {}
    };
}

// ---------- 仲裁 Prompt ----------
function buildArbitrationPrompt(config, resultA, resultB, threshold) {
    return `你是阅卷仲裁专家。两位老师对同一份试卷评分有分歧，请查看图片后裁定。

===== 评分分歧 =====
老师A评分：${resultA.score}分
老师A评语：${resultA.comment || '无'}

老师B评分：${resultB.score}分
老师B评语：${resultB.comment || '无'}

分差：${Math.abs(resultA.score - resultB.score)}分（阈值：${threshold}分）

===== 参考信息 =====
【题目】${extractFieldText(config.question) || '未提供'}
【标准答案】${extractFieldText(config.answer) || '未提供'}
【评分标准】${extractFieldText(config.rubric) || '未提供'}

===== 输出要求 =====
你必须严格按照以下格式输出：

【仲裁分析】
（分析两位老师评分差异的原因，逐条说明）

【最终得分】
（一个整数，你的裁定分数）

===== 重要约束 =====
1. 必须使用【】作为段落标记
2. 【最终得分】必须只有一行，只包含一个整数
3. 你必须在两个分数之间选择，或给出折中分数
4. 可以在内容中使用 Markdown 格式（**加粗**、$公式$等），但【】段落标记必须保留`;
}

// ---------- 旧格式 Prompt 解析（保留兼容） ----------
function parseAIResponseText(text) {
    return parseLegacyResponse(text);
}

function parsePromptModification(text) {
    const clean = text.replace(/\*\*/g, '');

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
    var imgAnnotation = buildImageAnnotation(config);

    let prompt = `你是一位严格的阅卷老师。请查看图片中的学生答案并评分。

===== 输入信息 =====`;
    if (questionText) prompt += `\n【题目】${imgAnnotation}\n${questionText}`;

    prompt += `\n【各小题评分要求】\n`;
    for (const sq of config.subQuestions) {
        const maxScoreText = (sq.maxScore && sq.maxScore > 0) ? `满分${sq.maxScore}分` : '满分未指定，请根据常规满分评判';
        prompt += `\n### ${sq.label}（${maxScoreText}）`;
        if (sq.answer) prompt += `\n参考答案：${sq.answer}`;
        if (sq.rubric) prompt += `\n评分标准：${sq.rubric}`;
        prompt += '\n';
    }

    prompt += `
===== 输出要求 =====
你必须严格按照以下格式输出：

【答案复述】
（逐条列出学生答案要点，每条一行，用序号标注）

【评分依据】
（逐项评分，每条格式：序号.评分项名(满分X分): 得分理由）

【分数计算】
（写出各小题计算公式）`;

    for (const sq of config.subQuestions) {
        prompt += `\n\n${sq.label}分数：（一个整数）`;
        prompt += `\n${sq.label}评语：（简短评语）`;
    }

    prompt += `\n\n【得分】
（各小题分数之和，一个数字）${buildDiligencePromptSection(config)}

===== 重要约束 =====
1. 必须使用【】作为段落标记
2. 各小题分数和【得分】必须各只有一行，只包含数字
3. 可以在内容中使用 Markdown 格式（**加粗**、$公式$等），但【】段落标记必须保留
4. 各小题分数之和应等于【得分】
5. 被划掉、涂改、涂抹覆盖的内容视为无效，只评判最终保留的答案`;
    return prompt;
}

// ========== 分小题结果解析 ==========
function parseSubQuestionResponse(text, config) {
    // 计算总满分
    const maxScore = config.subQuestions
        ? config.subQuestions.reduce((sum, sq) => sum + (sq.maxScore || 0), 0)
        : (config.maxScore || 0);
    // 先尝试结构化解析
    const structured = parseStructuredResponse(text, maxScore);

    // 如果结构化解析成功提取到分数
    if (structured.score !== null) {
        // 尝试提取各小题分数
        const clean = text.replace(/\*\*/g, '').replace(/\*/g, '');
        const subScores = [];
        let calculatedTotal = 0;

        for (const sq of config.subQuestions) {
            const escapedLabel = sq.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            let score = null;

            // 改进的匹配逻辑：优先精确匹配，然后尝试模糊匹配
            // 策略1: 精确匹配 label + "分数" 格式（最可靠）
            // 格式1a: "25(1)分数：8" 或 "第1题分数：8"
            let scoreMatch = clean.match(new RegExp(escapedLabel + '分数[：:]\\s*(\\d+\\.?\\d*)'));
            if (scoreMatch) {
                score = parseFloat(scoreMatch[1]);
            }

            // 策略2: 如果精确匹配失败，尝试在文本中查找 label 后跟括号数字的格式
            // 例如：label="25"，文本="25(1)分数：2"，应该匹配 "25(1)" 而不是 "25"
            if (score === null) {
                // 检查文本中是否存在 label 后跟括号数字的模式
                const bracketPattern = new RegExp(escapedLabel + '\\((\\d+)\\)');
                const bracketMatch = clean.match(bracketPattern);
                if (bracketMatch) {
                    // 找到了括号格式，使用完整的 label（包括括号）进行匹配
                    const fullLabel = sq.label + '(' + bracketMatch[1] + ')';
                    const escapedFullLabel = fullLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                    // 尝试匹配 "25(1)分数：2"
                    const fullScoreMatch = clean.match(new RegExp(escapedFullLabel + '分数[：:]\\s*(\\d+\\.?\\d*)'));
                    if (fullScoreMatch) {
                        score = parseFloat(fullScoreMatch[1]);
                    }

                    // 如果还是没匹配到，尝试匹配 "25(1)：2"
                    if (score === null) {
                        const fullScoreMatch2 = clean.match(new RegExp(escapedFullLabel + '[：:]\\s*(\\d+\\.?\\d*)'));
                        if (fullScoreMatch2) {
                            score = parseFloat(fullScoreMatch2[1]);
                        }
                    }
                }
            }

            // 策略3: 直接匹配 label + 冒号格式（可能误匹配，所以放在后面）
            if (score === null) {
                scoreMatch = clean.match(new RegExp(escapedLabel + '[：:]\\s*(\\d+\\.?\\d*)'));
                if (scoreMatch) score = parseFloat(scoreMatch[1]);
            }

            // 策略4: 匹配 label + 空格 + 数字 + "分" 格式
            if (score === null) {
                scoreMatch = clean.match(new RegExp(escapedLabel + '\\s+(\\d+\\.?\\d*)\\s*分'));
                if (scoreMatch) score = parseFloat(scoreMatch[1]);
            }

            // 小题分数范围截断
            if (score !== null) {
                if (score < 0) score = 0;
                if (sq.maxScore > 0 && score > sq.maxScore) {
                    console.warn(`⚠️ [解析] ${sq.label}分数超出满分(${score} > ${sq.maxScore})，截断为满分`);
                    score = sq.maxScore;
                }
            }

            const commentMatch = clean.match(new RegExp(escapedLabel + '评语[：:]\\s*(.+?)(?=\\n|$)'));
            if (score !== null) calculatedTotal += score;
            subScores.push({
                id: sq.id,
                label: sq.label,
                score: score,
                maxScore: sq.maxScore,
                comment: commentMatch ? commentMatch[1].trim() : ''
            });
        }

        console.log(`🧠 [诊断] 分小题解析结果 — 总分: ${structured.score}, 各小题: ${subScores.map(s => s.label + '=' + s.score).join(', ')}`);
        return { ...structured, subScores };
    }

    // 回退到旧格式解析
    return parseLegacySubQuestionResponse(text, config);
}

function parseLegacySubQuestionResponse(text, config) {
    const clean = text.replace(/\*\*/g, '');

    const studentAnswerMatch = clean.match(/学生答案[：:]\s*(.+?)(?=\n.*?分数|$)/s);
    const studentAnswer = studentAnswerMatch ? studentAnswerMatch[1].trim() : '未能识别';

    const subScores = [];
    let calculatedTotal = 0;
    for (const sq of config.subQuestions) {
        const escapedLabel = sq.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        let score = null;

        // 改进的匹配逻辑：优先精确匹配，然后尝试模糊匹配
        // 策略1: 精确匹配 label + "分数" 格式（最可靠）
        let scoreMatch = clean.match(new RegExp(escapedLabel + '分数[：:]\\s*(\\d+\\.?\\d*)'));
        if (scoreMatch) {
            score = parseFloat(scoreMatch[1]);
        }

        // 策略2: 如果精确匹配失败，尝试在文本中查找 label 后跟括号数字的格式
        if (score === null) {
            const bracketPattern = new RegExp(escapedLabel + '\\((\\d+)\\)');
            const bracketMatch = clean.match(bracketPattern);
            if (bracketMatch) {
                const fullLabel = sq.label + '(' + bracketMatch[1] + ')';
                const escapedFullLabel = fullLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                const fullScoreMatch = clean.match(new RegExp(escapedFullLabel + '分数[：:]\\s*(\\d+\\.?\\d*)'));
                if (fullScoreMatch) {
                    score = parseFloat(fullScoreMatch[1]);
                }

                if (score === null) {
                    const fullScoreMatch2 = clean.match(new RegExp(escapedFullLabel + '[：:]\\s*(\\d+\\.?\\d*)'));
                    if (fullScoreMatch2) {
                        score = parseFloat(fullScoreMatch2[1]);
                    }
                }
            }
        }

        // 策略3: 直接匹配 label + 冒号格式
        if (score === null) {
            scoreMatch = clean.match(new RegExp(escapedLabel + '[：:]\\s*(\\d+\\.?\\d*)'));
            if (scoreMatch) score = parseFloat(scoreMatch[1]);
        }

        // 策略4: 匹配 label + 空格 + 数字 + "分" 格式
        if (score === null) {
            scoreMatch = clean.match(new RegExp(escapedLabel + '\\s+(\\d+\\.?\\d*)\\s*分'));
            if (scoreMatch) score = parseFloat(scoreMatch[1]);
        }

        // 小题分数范围截断
        if (score !== null) {
            if (score < 0) score = 0;
            if (sq.maxScore > 0 && score > sq.maxScore) {
                console.warn(`⚠️ [解析] ${sq.label}分数超出满分(${score} > ${sq.maxScore})，截断为满分`);
                score = sq.maxScore;
            }
        }

        const commentMatch = clean.match(new RegExp(escapedLabel + '评语[：:]\\s*(.+?)(?=\\n|$)'));
        if (score !== null) calculatedTotal += score;
        subScores.push({
            id: sq.id,
            label: sq.label,
            score: score,
            maxScore: sq.maxScore,
            comment: commentMatch ? commentMatch[1].trim() : ''
        });
    }

    let totalScore = null;
    let totalMatch = clean.match(/总分[：:]\s*(\d+\.?\d*)/);
    if (totalMatch) totalScore = parseFloat(totalMatch[1]);
    if (totalScore === null) {
        totalMatch = clean.match(/总分\s*(\d+\.?\d*)\s*分/);
        if (totalMatch) totalScore = parseFloat(totalMatch[1]);
    }
    if (totalScore === null) totalScore = calculatedTotal;

    console.log(`🧠 [诊断] 分小题解析结果 — 总分: ${totalScore}, 各小题: ${subScores.map(s => s.label + '=' + s.score).join(', ')}`);
    return { studentAnswer, score: totalScore, rawScore: totalScore, comment: '', subScores, diligenceLevel: 0, diligenceReason: '', _sections: {} };
}

// ========== 打分专用函数 ==========
function callAIGrading(base64DataArray, config, onStreamUpdate) {
    // 从 scoring.units 派生 subQuestions（唯一数据源）
    const units = config.scoring?.units || [];
    const subQuestions = units.length > 1
        ? units.map((u, i) => ({ id: String.fromCharCode(97 + i), label: u.label, maxScore: u.maxScore }))
        : [];
    const hasSub = subQuestions.length > 0;

    // 将派生的 subQuestions 注入 config 供 prompt 函数使用
    const callConfig = { ...config, subQuestions: hasSub ? subQuestions : undefined };

    const prompt = hasSub ? buildSubQuestionPrompt(callConfig) : buildStructuredPrompt(callConfig);

    // 收集题目/答案/评分标准中的内嵌图片
    const fieldImages = collectFieldImages(config);

    // 计算总满分
    const maxScore = PresetManager.getMaxScore();

    if (hasSub) {
        console.log(`📋 [诊断] 评分单元配置 — 共 ${subQuestions.length} 个: ${subQuestions.map(sq => `${sq.label}(满分${sq.maxScore ?? '未设置'})`).join(', ')}`);
    }

    return callAIWithRetry(prompt, base64DataArray, callConfig, onStreamUpdate, fieldImages)
        .then(fullText => {
            console.log('📝 [诊断] AI原始返回内容：\n' + fullText);

            const parsed = hasSub
                ? parseSubQuestionResponse(fullText, callConfig)
                : parseStructuredResponse(fullText, maxScore);
            console.log(`🧠 [诊断] AI响应解析结果 — 分数: ${parsed.score}, 满分: ${maxScore}, 识别答案长度: ${(parsed.studentAnswer || '').length}字, 原始文本长度: ${fullText.length}字`);
            if (parsed._sections) {
                const sectionKeys = Object.keys(parsed._sections);
                console.log(`📋 [诊断] 解析到 ${sectionKeys.length} 个段落: ${sectionKeys.join(', ')}`);
            }
            if (parsed.score === null) {
                console.warn('⚠️ [诊断] 分数解析为 null，AI原始文本前200字: ' + fullText.substring(0, 200));
            }
            return parsed;
        });
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
