// ========== 填充分数及弹窗 ==========
function fillScore(score, comment, subScores) {
    const adapter = window.__AI_MARKER_ADAPTER__;
    let filled = false;
    if (adapter) {
        if (adapter.fillScores && subScores && subScores.length > 0) {
            filled = adapter.fillScores(subScores.map(sq => sq.score));
        } else if (adapter.fillScores) {
            filled = adapter.fillScores([score]);
        } else if (adapter.fillScore) {
            filled = adapter.fillScore({ total: score, subScores });
        }
    }
    if (!filled) {
        console.warn('未找到分数输入框，将直接弹出确认窗口');
        safeAlert(`AI打分结果：\n分数：${score}\n请手动输入分数！`);
    }
    showAutoSubmitDialog(score, comment, subScores);
}

// 等待下一份试卷（带自动重试）
// 平台加载下一份常有瞬态失败（Promise 报错后稍后才加载出来），超时不直接暂停，自动重试几轮
async function waitForNextPaperWithRetry(adapter, oldImgUrl, maxRounds = 3) {
    for (let round = 1; round <= maxRounds; round++) {
        // 用户已停止/暂停则立即退出，避免长时间等待后误重启批改
        if (!window.aiGradingState.isRunning || window.aiGradingState.isPaused) return true;
        let hasNext = false;
        try {
            hasNext = await adapter.waitForNextPaper(oldImgUrl);
        } catch (e) {
            console.warn('⚠️ 等待下一份试卷异常，将重试:', e);
        }
        if (hasNext) return true;
        // 长等待期间状态可能已变，再次检查
        if (!window.aiGradingState.isRunning || window.aiGradingState.isPaused) return true;
        if (round < maxRounds) {
            console.warn(`⚠️ 第${round}次等待下一份试卷超时，自动重试中（${round}/${maxRounds - 1}）...`);
            showToast(`⚠️ 平台加载下一份试卷缓慢，自动重试中（${round}/${maxRounds - 1}）…`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    return false;
}

// 批改节奏：按「每 N 份」计数，到点则随机休息（均在「下一份已出现」之后调用）
async function pacingRestIfNeeded() {
    const hpCfg = (typeof PresetManager !== 'undefined' && PresetManager.getCurrentConfig)
        ? PresetManager.getCurrentConfig().humanPacing : null;
    if (!hpCfg || !hpCfg.enabled || !hpCfg.rest || !hpCfg.rest.enabled) return;

    const hpState = window.aiGradingState.humanPacing = window.aiGradingState.humanPacing || {};
    hpState.paperCount = (hpState.paperCount || 0) + 1;
    const every = Math.max(1, Math.floor(hpCfg.rest.everyCount) || 20);
    if (hpState.paperCount < every) return;

    hpState.paperCount = 0;
    const rMin = Math.max(1, Math.floor(hpCfg.rest.restMin) || 30);
    const rMax = Math.max(rMin, Math.floor(hpCfg.rest.restMax) || 180);
    const restSec = rMin + Math.floor(Math.random() * (rMax - rMin + 1));
    console.log(`☕ [批改节奏] 拟人休息 ${restSec}s`);
    await showPacingRestBanner(restSec);
}

// 拟人休息横幅（批改节奏 · 实验性）：固定顶栏显示剩余时间，可点「立即继续」跳过
// 停止/暂停批改时自动收起。休息放在下一份已出现之后，平台会把休息时间计入下一份用时
function showPacingRestBanner(seconds) {
    return new Promise((resolve) => {
        const old = document.getElementById('human-pacing-rest-banner');
        if (old) old.remove();

        let remain = Math.max(0, Math.floor(seconds));
        const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
        const banner = document.createElement('div');
        banner.id = 'human-pacing-rest-banner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647 !important;' +
            'background:#fff8e6;border-bottom:2px solid #f0c36d;color:#7a5b1e;' +
            'padding:12px 20px;display:flex;align-items:center;justify-content:center;gap:16px;' +
            'font-size:14px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
            'box-shadow:0 4px 16px rgba(122,91,30,0.18);';
        banner.innerHTML = `
            <span>☕ 拟人休息中</span>
            <span style="font-family:'SF Mono',monospace;font-size:16px;" id="hpr-remain">${fmt(remain)}</span>
            <span style="font-weight:400;font-size:12px;color:#9a7a3a;">后自动继续</span>
            <button id="hpr-continue" style="padding:6px 16px;border:1px solid #d4a94e;background:#fff3d6;
                color:#7a5b1e;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">立即继续</button>
        `;
        getUIRoot().appendChild(banner);

        let timer = null;
        const finish = () => {
            if (timer) clearInterval(timer);
            timer = null;
            if (banner.parentNode) banner.remove();
            resolve();
        };
        banner.querySelector('#hpr-continue').addEventListener('click', () => {
            console.log('☕ [批改节奏] 用户跳过休息');
            finish();
        });
        timer = setInterval(() => {
            // 停止/暂停批改时收起横幅（调用方会检查状态决定是否继续）
            if (!window.aiGradingState.isRunning || window.aiGradingState.isPaused) {
                finish();
                return;
            }
            remain--;
            const el = banner.querySelector('#hpr-remain');
            if (el) el.textContent = fmt(Math.max(0, remain));
            if (remain <= 0) {
                console.log('☕ [批改节奏] 休息结束');
                finish();
            }
        }, 1000);
    });
}

function showAutoSubmitDialog(score, comment, subScores, extraInfo) {
    const oldDialog = document.getElementById('auto-submit-dialog');
    if (oldDialog) oldDialog.remove();

    const mode = window.aiGradingState.gradingMode;
    const scoringDetails = extraInfo?.scoringDetails || null;
    const dualEval = extraInfo?.dualEval || null;
    const rawScore = extraInfo?.rawScore || score;
    const diligence = extraInfo?.diligence || null;

    console.log(`🪟 [诊断] showAutoSubmitDialog 调用 — 分数: ${score}, 模式: ${mode}, 双评: ${!!dualEval}`);

    // 小题之和与最终得分一致性检查（不一致时给教师醒目提示）
    let subSum = null;
    if (subScores && subScores.length > 0 && subScores.every(sq => sq.score !== null && sq.score !== undefined)) {
        subSum = subScores.reduce((s, u) => s + (u.score || 0), 0);
    }
    const scoreMismatch = subSum !== null && Math.abs(subSum - score) > 0.01;

    window.aiGradingState.countdownPaused = false;
    const studentAnswer = window.aiGradingState.currentStudentAnswer;
    const imageUrls = window.aiGradingState.currentImageUrls || [];
    const isUnattended = mode === 'unattended';
    const isTrial = mode === 'trial';

    // ===== 批改节奏（实验性）=====
    // 关闭时零行为变化（普通 5s / 无人 1s）；开启后普通/无人模式在配置区间内随机延迟，试改不参与
    const humanPacingCfg = (typeof PresetManager !== 'undefined' && PresetManager.getCurrentConfig)
        ? (PresetManager.getCurrentConfig().humanPacing || {}) : {};
    const pacingActive = humanPacingCfg.enabled === true && !isTrial;
    let countdownSeconds = isUnattended ? 1 : 5;
    let pacingDelaySeconds = 0;
    if (pacingActive) {
        const range = isUnattended ? humanPacingCfg.unattendedDelay : humanPacingCfg.normalDelay;
        const defMin = isUnattended ? 0 : 5;
        const defMax = isUnattended ? 8 : 15;
        const min = Math.max(0, Math.floor(range?.min ?? defMin));
        const max = Math.max(min, Math.floor(range?.max ?? defMax));
        pacingDelaySeconds = min + Math.floor(Math.random() * (max - min + 1));
        countdownSeconds = pacingDelaySeconds;
    }
    window.aiGradingState.humanPacing = window.aiGradingState.humanPacing || {};
    window.aiGradingState.humanPacing.lastDelayMs = pacingActive ? pacingDelaySeconds * 1000 : 0;

    const showCountdown = !isTrial;
    const showCorrectionBtn = !isUnattended;

    const headerLabel = isTrial ? '试改确认' : '批改完成';
    const modeTag = isUnattended ? '<span style="color:#888;font-weight:normal;font-size:12px;margin-left:8px;">[自动模式]</span>'
                   : isTrial ? '<span style="color:#7c3aed;font-weight:normal;font-size:12px;margin-left:8px;">[试改模式]</span>' : '';
    const pacingTag = pacingActive
        ? `<span style="color:#0f7b6c;font-weight:normal;font-size:12px;margin-left:8px;">[拟人节奏 · 延迟 ${pacingDelaySeconds}s]</span>`
        : '';
    const isBlankCard = extraInfo?.isBlankCard || false;
    const blankRatios = extraInfo?.blankRatios || null;
    const blankTag = isBlankCard ? '<span style="color:#E67E22;font-weight:normal;font-size:12px;margin-left:8px;">[空白卡]</span>' : '';

    const imagesHtml = imageUrls.map(url => `<img src="${url}" style="width: 100%; height: auto; display: block; border-bottom: 2px dashed rgba(0,0,0,0.06); margin-bottom: -2px;">`).join('');

    const correctionBtnHtml = showCorrectionBtn
        ? `<button class="asd-cancel-btn" id="correction-btn" style="color:#D93025;border-color:rgba(217,48,37,0.2);">分数有误</button>` : '';
    const pauseBtnHtml = isTrial ? '' : `<button class="asd-cancel-btn" id="pause-cancel-btn">暂停</button>`;
    const confirmLabel = isTrial ? '确认提交' : '立即提交';
    const cancelBtnHtml = `<button class="asd-cancel-btn" id="cancel-submit-btn">取消</button>`;
    // 空白卡相关按钮：自动检测为空白时显示「这不是空白卡」，否则显示「标记为空白卡」
    let blankBtnHtml = '';
    if (!isUnattended) {
        if (isBlankCard) {
            blankBtnHtml = `<button class="asd-cancel-btn" id="not-blank-btn" style="color:#2166ad;border-color:rgba(33,102,173,0.2);">这不是空白卡</button>`;
        } else {
            blankBtnHtml = `<button class="asd-cancel-btn" id="mark-blank-btn" style="color:#E67E22;border-color:rgba(230,126,34,0.2);">标记为空白卡</button>`;
        }
    }

    // 环形分数显示 — 根据分数计算百分比和颜色
    const maxScore = PresetManager.getMaxScore() || 100;  // UI 显示用，0 时回退 100 避免除零
    const pct = Math.min(score / maxScore, 1);
    const circumference = 2 * Math.PI * 44;
    const dashoffset = circumference * (1 - pct);
    const scoreColor = pct >= 0.6 ? '#1d1d1f' : '#D93025';

    const countdownHtml = showCountdown
        ? `<div class="asd-countdown" id="countdown-display">
                <svg class="asd-countdown-ring" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="2.5"/>
                    <circle id="countdown-ring-fill" cx="18" cy="18" r="16" fill="none" stroke="#1d1d1f" stroke-width="2.5"
                        stroke-dasharray="100.53" stroke-dashoffset="0" stroke-linecap="round"
                        transform="rotate(-90 18 18)" style="transition: stroke-dashoffset 0.9s linear;"/>
                </svg>
                <span class="asd-countdown-num" id="countdown-number">${countdownSeconds}</span>
            </div>`
        : `<div class="asd-countdown" style="color:#7c3aed;font-size:12px;font-weight:500;">等待教师确认</div>`;

    const dialog = document.createElement('div');
    dialog.id = 'auto-submit-dialog';
    dialog.innerHTML = `
        <style>
            #auto-submit-dialog {
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 2147483647 !important;
                background: rgba(255, 255, 255, 0.92);
                backdrop-filter: blur(32px) saturate(180%);
                -webkit-backdrop-filter: blur(32px) saturate(180%);
                border: 1px solid rgba(255, 255, 255, 0.6);
                border-radius: 24px;
                box-shadow: 0 40px 80px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.4);
                width: 880px; max-width: 94vw; max-height: 90vh; overflow: hidden;
                display: flex; flex-direction: column;
                font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", sans-serif;
                animation: asd-enter 0.35s cubic-bezier(0.16, 1, 0.3, 1);
            }
            @keyframes asd-enter { from { transform: translate(-50%, -50%) scale(0.96); opacity: 0; } to { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
            .asd-header { padding: 20px 32px; border-bottom: 1px solid rgba(0,0,0,0.06); font-size: 15px; font-weight: 600; color: #1d1d1f; display: flex; align-items: center; background: transparent; }
            .asd-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; overflow: hidden; flex: 1; }
            .asd-images { border-right: 1px solid rgba(0,0,0,0.06); overflow-y: auto; background: rgba(0,0,0,0.01); padding: 28px; max-height: 520px; }
            .asd-images img { border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); }
            .asd-result { padding: 28px 32px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; max-height: 520px; }

            .asd-score-wrap { display: flex; align-items: center; gap: 20px; }
            .asd-score-ring { width: 100px; height: 100px; position: relative; flex-shrink: 0; }
            .asd-score-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
            .asd-score-ring .ring-bg { fill: none; stroke: rgba(0,0,0,0.05); stroke-width: 5; }
            .asd-score-ring .ring-fill { fill: none; stroke: ${scoreColor}; stroke-width: 5; stroke-linecap: round; transition: stroke-dashoffset 0.8s cubic-bezier(0.16,1,0.3,1); }
            .asd-score-num { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 32px; font-weight: 700; color: ${scoreColor}; letter-spacing: -1px; }
            .asd-score-meta { display: flex; flex-direction: column; gap: 4px; }
            .asd-score-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: #86868b; font-weight: 600; }

            .asd-info-block { display: flex; flex-direction: column; gap: 6px; }
            .asd-info-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: #86868b; font-weight: 600; }
            .asd-info-content { font-size: 13px; color: #4a4a4a; line-height: 1.6; white-space: pre-wrap; font-family: "SF Mono", "JetBrains Mono", Consolas, monospace; background: rgba(0,0,0,0.02); padding: 14px; border-radius: 10px; border: 1px solid rgba(0,0,0,0.04); }

            .asd-footer { padding: 16px 32px 20px; border-top: 1px solid rgba(0,0,0,0.06); background: rgba(255,255,255,0.4); display: flex; justify-content: space-between; align-items: center; }
            .asd-countdown { position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; }
            .asd-countdown-ring { width: 36px; height: 36px; position: absolute; top: 0; left: 0; }
            .asd-countdown-num { font-size: 12px; font-weight: 600; color: #1d1d1f; font-family: "SF Mono", monospace; }
            .asd-buttons { display: flex; gap: 10px; }
            .asd-buttons button { padding: 10px 24px; border: none; border-radius: 10px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
            .asd-cancel-btn { background: rgba(0,0,0,0.05); color: #1d1d1f; }
            .asd-cancel-btn:hover { background: rgba(0,0,0,0.09); }
            .asd-confirm-btn { background: #1d1d1f; color: white; box-shadow: 0 6px 16px rgba(0,0,0,0.12); }
            .asd-confirm-btn:hover { background: #000; transform: translateY(-1px); box-shadow: 0 10px 24px rgba(0,0,0,0.18); }
            .asd-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.25); backdrop-filter: blur(6px); z-index: -1; animation: asd-overlay-in 0.3s ease-out; }
            @keyframes asd-overlay-in { from { opacity: 0; } to { opacity: 1; } }

            #auto-submit-dialog {
                background: #fff;
                border: 1px solid #e1e6ef;
                border-radius: 16px;
                box-shadow: 0 28px 80px rgba(18,28,45,0.22), 0 2px 8px rgba(18,28,45,0.08);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif;
                color: #172033;
                color-scheme: light only;
            }
            #auto-submit-dialog,
            #auto-submit-dialog * { box-sizing: border-box; }
            #auto-submit-dialog .asd-header {
                padding: 18px 24px;
                background: #fff;
                border-bottom: 1px solid #e1e6ef;
                color: #172033;
                font-size: 18px;
                font-weight: 750;
            }
            #auto-submit-dialog .asd-grid {
                grid-template-columns: minmax(360px, 1.05fr) minmax(340px, 0.95fr);
                background: #f7f8fa;
            }
            #auto-submit-dialog .asd-images {
                background: #f7f8fa;
                border-right: 1px solid #e1e6ef;
                padding: 20px;
            }
            #auto-submit-dialog .asd-images img {
                border-radius: 8px;
                border: 1px solid #e1e6ef;
                box-shadow: 0 8px 22px rgba(18,28,45,0.08);
            }
            #auto-submit-dialog .asd-result {
                background: #fff;
                padding: 22px 24px;
                gap: 16px;
            }
            #auto-submit-dialog .asd-score-ring { width: 92px; height: 92px; }
            #auto-submit-dialog .asd-score-num {
                color: ${scoreColor};
                font-size: 30px;
            }
            #auto-submit-dialog .asd-score-label,
            #auto-submit-dialog .asd-info-label {
                color: #667085;
                letter-spacing: 0.4px;
            }
            #auto-submit-dialog .asd-info-content {
                background: #f7f8fa;
                border: 1px solid #e1e6ef;
                border-radius: 8px;
                color: #344054;
                font-family: "SF Mono", "JetBrains Mono", Consolas, monospace;
            }
            #auto-submit-dialog .asd-footer {
                padding: 14px 24px 18px;
                background: #fff;
                border-top: 1px solid #e1e6ef;
            }
            #auto-submit-dialog .asd-buttons button {
                min-height: 36px;
                border-radius: 7px;
                font-weight: 700;
            }
            #auto-submit-dialog .asd-cancel-btn {
                background: #fff;
                border: 1px solid #d8dee8;
                color: #344054;
            }
            #auto-submit-dialog .asd-cancel-btn:hover { background: #f3f6fa; }
            #auto-submit-dialog .asd-confirm-btn {
                background: #172033;
                color: #fff;
                box-shadow: none;
            }
            #auto-submit-dialog .asd-confirm-btn:hover {
                background: #0f1726;
                box-shadow: 0 8px 18px rgba(18,28,45,0.18);
            }
            #auto-submit-dialog .asd-countdown-num { color: #172033; }
            @media (max-width: 760px) {
                #auto-submit-dialog { width: calc(100vw - 20px); max-height: calc(100vh - 20px); }
                #auto-submit-dialog .asd-grid { grid-template-columns: 1fr; }
                #auto-submit-dialog .asd-images { max-height: 34vh; border-right: none; border-bottom: 1px solid #e1e6ef; }
                #auto-submit-dialog .asd-result { max-height: 42vh; }
            }
        </style>
        <div class="asd-overlay"></div>
        <div class="asd-header" id="asd-drag-handle" style="cursor:move;">
            <span>${headerLabel} ${modeTag}${pacingTag}${blankTag}</span>
            <div style="display:flex;gap:6px;margin-left:auto;">
                <button id="minimize-btn" style="background:none;border:1px solid #d8dee8;border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:14px;color:#666;display:flex;align-items:center;justify-content:center;" title="最小化">—</button>
            </div>
        </div>
        <div class="asd-grid">
            <div class="asd-images">${imagesHtml}</div>
            <div class="asd-result">
                <div class="asd-score-wrap">
                    <div class="asd-score-ring">
                        <svg viewBox="0 0 100 100">
                            <circle class="ring-bg" cx="50" cy="50" r="44"/>
                            <circle class="ring-fill" cx="50" cy="50" r="44"
                                stroke-dasharray="${circumference}"
                                stroke-dashoffset="${circumference}"
                                style="transition: stroke-dashoffset 0.8s cubic-bezier(0.16,1,0.3,1) 0.2s;"/>
                        </svg>
                        <span class="asd-score-num">${score}</span>
                    </div>
                    <div class="asd-score-meta">
                        <div class="asd-score-label">最终得分</div>
                        ${subScores && subScores.length > 0 ? `<div style="font-size:12px;color:#86868b;">满分 ${maxScore}</div>` : ''}
                        ${diligence && diligence.bonus > 0 ? `<div style="font-size:12px;color:#34A853;font-weight:500;">准确性 ${diligence.accuracyScore} + 勤勉 +${diligence.bonus}</div>` : ''}
                    </div>
                </div>
                ${scoreMismatch ? `
                <div style="margin:8px 0 12px;padding:10px 14px;background:#FFF8E1;border:1px solid #FFE082;border-radius:8px;font-size:12px;color:#8D6E00;line-height:1.6;">
                    ⚠️ <b>分数不一致提示</b>：最终得分 ${score} 与各小题之和 ${subSum} 不一致（各小题会分别填入平台，请以小题为准，核对后再提交）
                </div>` : ''}
                ${subScores && subScores.length > 0 ? `
                <div class="asd-info-block">
                    <div class="asd-info-label">各小题得分</div>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        ${subScores.map(sq => `
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:rgba(0,0,0,0.02);border-radius:8px;border:1px solid rgba(0,0,0,0.04);">
                            <span style="font-size:13px;color:#1d1d1f;font-weight:500;">${sq.label}</span>
                            <span style="font-size:14px;font-weight:600;color:${sq.score >= sq.maxScore * 0.6 ? '#1d1d1f' : '#D93025'};">${sq.score !== null ? sq.score : '—'}<span style="font-size:11px;color:#86868b;font-weight:normal;">/${sq.maxScore}</span></span>
                        </div>
                        ${sq.comment ? `<div class="asd-md-content" style="font-size:12px;color:#666;padding:0 12px 2px;">${sq.comment}</div>` : ''}
                        `).join('')}
                    </div>
                </div>` : ''}
                ${scoringDetails && scoringDetails['评分依据'] ? `
                <div class="asd-info-block">
                    <div class="asd-info-label">评分依据</div>
                    <div class="asd-info-content" style="max-height:120px;overflow-y:auto;">${scoringDetails['评分依据']}</div>
                </div>` : ''}
                ${scoringDetails && scoringDetails['分数计算'] ? `
                <div class="asd-info-block">
                    <div class="asd-info-label">分数计算</div>
                    <div class="asd-info-content" style="font-weight:600;">${scoringDetails['分数计算']}</div>
                </div>` : ''}
                ${dualEval ? `
                <div class="asd-info-block">
                    <div class="asd-info-label">双评结果</div>
                    <div style="padding:10px 14px;background:rgba(0,0,0,0.02);border-radius:8px;border:1px solid rgba(0,0,0,0.04);">
                        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                            <span style="font-size:12px;color:#666;">模型A / 模型B</span>
                            <span style="font-size:13px;font-weight:600;color:#1d1d1f;">${dualEval.scoreA !== null && dualEval.scoreA !== undefined ? dualEval.scoreA : '—'} / ${dualEval.scoreB !== null && dualEval.scoreB !== undefined ? dualEval.scoreB : '—'}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                            <span style="font-size:12px;color:#666;">分差</span>
                            <span style="font-size:13px;font-weight:600;color:${(dualEval.diff || 0) > 2 ? '#D93025' : '#1d1d1f'};">${dualEval.diff !== null ? dualEval.diff + '分' : '—'}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;">
                            <span style="font-size:12px;color:#666;">判定结果</span>
                            <span style="font-size:12px;font-weight:500;color:${dualEval.result === 'consensus' ? '#34A853' : dualEval.result === 'arbitration' ? '#7c3aed' : '#86868b'};">${
                                dualEval.result === 'consensus' ? '✓ 共识' :
                                dualEval.result === 'arbitration' ? '⚠ 三评仲裁' :
                                dualEval.result === 'average-fallback' ? '取平均分' : dualEval.result
                            }</span>
                        </div>
                    </div>
                </div>
                <div class="asd-info-block">
                    <div class="asd-info-label">老师A 评分</div>
                    <div style="padding:10px 14px;background:rgba(0,0,0,0.02);border-radius:8px;border:1px solid rgba(0,0,0,0.04);">
                        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                            <span style="font-size:12px;color:#666;">得分</span>
                            <span style="font-size:14px;font-weight:600;">${dualEval.scoreA !== null ? dualEval.scoreA + '分' : '失败'}</span>
                        </div>
                        ${dualEval.detailA ? `
                        <div style="margin-bottom:6px;">
                            <div style="font-size:11px;color:#86868b;margin-bottom:4px;">评分依据</div>
                            <div class="asd-md-content" style="font-size:12px;line-height:1.5;font-family:'SF Mono',monospace;background:rgba(255,255,255,0.6);padding:8px;border-radius:6px;white-space:pre-wrap;border:1px solid rgba(0,0,0,0.04);max-height:100px;overflow-y:auto;">${dualEval.detailA['评分依据'] || '—'}</div>
                        </div>` : ''}
                        ${dualEval.detailA && dualEval.detailA['分数计算'] ? `
                        <div>
                            <div style="font-size:11px;color:#86868b;margin-bottom:4px;">分数计算</div>
                            <div class="asd-md-content" style="font-size:12px;font-weight:600;font-family:'SF Mono',monospace;background:rgba(255,255,255,0.6);padding:8px;border-radius:6px;border:1px solid rgba(0,0,0,0.04);">${dualEval.detailA['分数计算']}</div>
                        </div>` : ''}
                    </div>
                </div>
                <div class="asd-info-block">
                    <div class="asd-info-label">老师B 评分</div>
                    <div style="padding:10px 14px;background:rgba(0,0,0,0.02);border-radius:8px;border:1px solid rgba(0,0,0,0.04);">
                        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                            <span style="font-size:12px;color:#666;">得分</span>
                            <span style="font-size:14px;font-weight:600;">${dualEval.scoreB !== null ? dualEval.scoreB + '分' : '失败'}</span>
                        </div>
                        ${dualEval.detailB ? `
                        <div style="margin-bottom:6px;">
                            <div style="font-size:11px;color:#86868b;margin-bottom:4px;">评分依据</div>
                            <div class="asd-md-content" style="font-size:12px;line-height:1.5;font-family:'SF Mono',monospace;background:rgba(255,255,255,0.6);padding:8px;border-radius:6px;white-space:pre-wrap;border:1px solid rgba(0,0,0,0.04);max-height:100px;overflow-y:auto;">${dualEval.detailB['评分依据'] || '—'}</div>
                        </div>` : ''}
                        ${dualEval.detailB && dualEval.detailB['分数计算'] ? `
                        <div>
                            <div style="font-size:11px;color:#86868b;margin-bottom:4px;">分数计算</div>
                            <div class="asd-md-content" style="font-size:12px;font-weight:600;font-family:'SF Mono',monospace;background:rgba(255,255,255,0.6);padding:8px;border-radius:6px;border:1px solid rgba(0,0,0,0.04);">${dualEval.detailB['分数计算']}</div>
                        </div>` : ''}
                    </div>
                </div>
                ${dualEval.result === 'arbitration' ? `
                <div class="asd-info-block">
                    <div class="asd-info-label">仲裁结果</div>
                    <div style="padding:10px 14px;background:rgba(124,58,237,0.04);border-radius:8px;border:1px solid rgba(124,58,237,0.12);">
                        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                            <span style="font-size:12px;color:#7c3aed;">仲裁得分</span>
                            <span style="font-size:14px;font-weight:600;color:#7c3aed;">${dualEval.arbScore !== undefined ? dualEval.arbScore + '分' : '—'}</span>
                        </div>
                        ${dualEval.arbAnalysis ? `
                        <div>
                            <div style="font-size:11px;color:#86868b;margin-bottom:4px;">仲裁分析</div>
                            <div class="asd-md-content" style="font-size:12px;line-height:1.5;font-family:'SF Mono',monospace;background:rgba(255,255,255,0.6);padding:8px;border-radius:6px;white-space:pre-wrap;border:1px solid rgba(0,0,0,0.04);max-height:100px;overflow-y:auto;">${dualEval.arbAnalysis}</div>
                        </div>` : ''}
                    </div>
                </div>` : ''}
                ` : ''}
                ${diligence && diligence.bonus > 0 ? `
                <div class="asd-info-block">
                    <div class="asd-info-label">勤勉加分</div>
                    <div style="padding:10px 14px;background:rgba(0,0,0,0.02);border-radius:8px;border:1px solid rgba(0,0,0,0.04);">
                        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                            <span style="font-size:12px;color:#666;">勤勉度等级</span>
                            <span style="font-size:13px;font-weight:600;">${diligence.level}/5</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                            <span style="font-size:12px;color:#666;">衰减系数</span>
                            <span style="font-size:13px;">${diligence.decayFactor.toFixed(2)}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                            <span style="font-size:12px;color:#666;">加分</span>
                            <span style="font-size:14px;font-weight:600;color:#34A853;">+${diligence.bonus}</span>
                        </div>
                        ${diligence.reason ? `<div style="font-size:12px;color:#666;margin-top:4px;">${diligence.reason}</div>` : ''}
                    </div>
                </div>` : ''}
                ${blankRatios ? (() => {
                    const rows = blankRatios.current.map((c, i) => {
                        const ref = blankRatios.reference[i];
                        if (c.skipped || ref === undefined) return '';
                        const diff = Math.abs(c.ratio - ref);
                        const diffPct = (diff * 100).toFixed(3);
                        const thresholdPct = (blankRatios.threshold * 100).toFixed(1);
                        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;${i > 0 ? 'border-top:1px solid rgba(0,0,0,0.04);' : ''}">
                            <span style="font-size:12px;color:#666;">图${i + 1}</span>
                            <span style="font-family:monospace;font-size:12px;">
                                <span style="color:#172033;">当前 ${(c.ratio * 100).toFixed(3)}%</span>
                                <span style="color:#aaa;margin:0 4px;">|</span>
                                <span style="color:#86868b;">范本 ${(ref * 100).toFixed(3)}%</span>
                                <span style="color:#aaa;margin:0 4px;">|</span>
                                <span style="color:#34A853;font-weight:600;">差异 ${diffPct}%</span>
                            </span>
                        </div>`;
                    }).join('');
                    return `<div class="asd-info-block">
                        <div class="asd-info-label">空白卡检测详情 <span style="font-weight:normal;color:#34A853;">（阈值 ${(blankRatios.threshold * 100).toFixed(1)}%）</span></div>
                        <div style="padding:10px 14px;background:rgba(52,168,83,0.04);border-radius:8px;border:1px solid rgba(52,168,83,0.12);">${rows}</div>
                    </div>`;
                })() : ''}
                <div class="asd-info-block"><div class="asd-info-label">识别答案</div><div class="asd-info-content">${studentAnswer}</div></div>
                ${comment ? `<div class="asd-info-block"><div class="asd-info-label">评语</div><div class="asd-info-content" style="max-height:200px;overflow-y:auto;">${comment}</div></div>` : ''}
            </div>
        </div>
        <div class="asd-footer">
            ${countdownHtml}
            <div class="asd-buttons">
                ${cancelBtnHtml}
                ${blankBtnHtml}
                ${correctionBtnHtml}
                ${pauseBtnHtml}
                <button class="asd-confirm-btn" id="confirm-submit-btn">${confirmLabel}</button>
            </div>
        </div>
        <!-- 最小化后的浮动条 -->
        <div id="asd-minimized-bar" style="display:none; position:fixed; bottom:20px; left:50%; transform:translateX(-50%); z-index:2147483647; background:#fff; border:1px solid #e1e6ef; border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,0.12); padding:10px 20px; display:none; align-items:center; gap:12px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',sans-serif;">
            <span style="font-size:18px;font-weight:700;color:${scoreColor};">${score}分</span>
            <span style="font-size:12px;color:#86868b;">${headerLabel}${isBlankCard ? ' [空白卡]' : ''}</span>
            <button id="restore-btn" style="background:#172033;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;">恢复</button>
            <button id="minimized-cancel-btn" style="background:#fff;color:#344054;border:1px solid #d8dee8;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;">取消</button>
        </div>
    `;
    getUIRoot().appendChild(dialog);

    // Markdown+KaTeX 渲染：所有文本内容区域
    if (window.__aiMarkdownRenderer) {
        dialog.querySelectorAll('.asd-info-content, .asd-md-content').forEach(function (el) {
            var raw = el.textContent;
            if (raw) el.innerHTML = window.__aiMarkdownRenderer.render(raw);
        });
    }

    // 环形分数动画
    requestAnimationFrame(() => {
        const ringFill = dialog.querySelector('.ring-fill');
        if (ringFill) ringFill.style.strokeDashoffset = dashoffset;
    });

    // "分数有误" 按钮
    if (showCorrectionBtn) {
        dialog.querySelector('#correction-btn').addEventListener('click', () => {
            if (dialog.countdownTimer) clearInterval(dialog.countdownTimer);
            dialog.remove();
            showCorrectionPanel({
                score, comment, studentAnswer, imageUrls,
                base64DataArray: window.aiGradingState.currentBase64DataArray || [],
                config: PresetManager.getCurrentConfig(),
                callConfig: PresetManager.getActiveCallConfig(),
                subScores,
                onAccept(finalScore, correctionInfo) {
                    const correctedSubScores = correctionInfo.correctedSubScores || subScores;
                    HistoryManager.add({
                        presetName: PresetManager.data.active,
                        gradingMode: mode,
                        imageUrls, studentAnswer,
                        aiScore: score, aiComment: comment,
                        finalScore, isCorrected: correctionInfo.isCorrected,
                        correctionReason: correctionInfo.correctionReason,
                        imageBase64s: window.aiGradingState.currentBase64DataArray || [],
                        subScores: correctedSubScores,
                        dualEval: dualEval || null,
                        diligenceLevel: diligence?.level || 0,
                        diligenceBonus: diligence?.bonus || 0,
                        diligenceReason: diligence?.reason || ''
                    });
                    if (correctionInfo.newAnswer || correctionInfo.newRubric) {
                        const activeName = PresetManager.data.active;
                        const cfg = PresetManager.data.list[activeName];
                        if (cfg) {
                            if (correctionInfo.newAnswer) cfg.answer = correctionInfo.newAnswer;
                            if (correctionInfo.newRubric) cfg.rubric = correctionInfo.newRubric;
                            PresetManager.save();
                            showToast('提示词已更新');
                            // 同步更新 Markdown 数据和预览
                            if (typeof normalizeMarkdownField === 'function') {
                                window.__aiMarkdownData = window.__aiMarkdownData || {};
                                if (correctionInfo.newAnswer) {
                                    window.__aiMarkdownData.answer = normalizeMarkdownField(cfg.answer);
                                    if (typeof renderMarkdownPreview === 'function') renderMarkdownPreview('answer', window.__aiMarkdownData.answer);
                                }
                                if (correctionInfo.newRubric) {
                                    window.__aiMarkdownData.rubric = normalizeMarkdownField(cfg.rubric);
                                    if (typeof renderMarkdownPreview === 'function') renderMarkdownPreview('rubric', window.__aiMarkdownData.rubric);
                                }
                            }
                        }
                    }
                    fillScore(finalScore, comment, correctedSubScores);
                },
                onCancel() {
                    showAutoSubmitDialog(score, comment, subScores);
                }
            });
        });
    }

    // "暂停" 按钮
    if (!isTrial) {
        dialog.querySelector('#pause-cancel-btn').addEventListener('click', () => {
            if (!window.aiGradingState.countdownPaused) {
                window.aiGradingState.countdownPaused = true;
                dialog.querySelector('#pause-cancel-btn').textContent = '撤销并退出';
                const cdDisplay = dialog.querySelector('#countdown-display');
                if (cdDisplay) {
                    // 倒计时容器固定 36px 是给圆环用的，「已暂停」三个字会被挤成竖排
                    cdDisplay.style.setProperty('width', 'auto', 'important');
                    cdDisplay.innerHTML = '<span style="font-size:12px;color:#86868b;">已暂停</span>';
                }
            } else {
                if (dialog.countdownTimer) clearInterval(dialog.countdownTimer);
                dialog.remove();
                stopAutoGrading();
            }
        });
    }

    // "取消" 按钮 — 关闭对话框，不提交，恢复按钮状态
    dialog.querySelector('#cancel-submit-btn').addEventListener('click', () => {
        if (dialog.countdownTimer) clearInterval(dialog.countdownTimer);
        dialog.remove();
        window.aiGradingState.isRunning = false;
        window.aiGradingState.countdownPaused = false;
        const btn = document.querySelector('.ai-grade-btn');
        if (btn) {
            btn.textContent = 'AI 批改';
            btn.classList.remove('running', 'paused', 'unattended', 'trial');
        }
        showToast('已取消本次批改');
    });

    // "标记为空白卡" 按钮 — 采集范本 + 填0分 + 提交
    const markBlankBtn = dialog.querySelector('#mark-blank-btn');
    if (markBlankBtn) {
        markBlankBtn.addEventListener('click', async () => {
            if (dialog.countdownTimer) clearInterval(dialog.countdownTimer);
            dialog.remove();

            // 采集范本（如果没有的话）
            const base64Arr = window.aiGradingState.currentBase64DataArray || [];
            if (!BlankDetector.hasReference() && base64Arr.length > 0) {
                try {
                    const ratios = await BlankDetector.calcBatchRatios(base64Arr);
                    const validResults = ratios.filter(r => !r.skipped);
                    BlankDetector.saveReference(validResults.map(r => r.ratio), validResults.map(r => r.threshold));
                    showToast('📸 空白答题卡范本已采集');
                } catch (e) {
                    console.warn('⚠️ 范本采集失败:', e);
                }
            }

            // 填入 0 分
            const config = PresetManager.getCurrentConfig();
            const adapter = window.__AI_MARKER_ADAPTER__;
            if (adapter) {
                const units = config.scoring?.units || [];
                if (adapter.fillScores && units.length > 0) {
                    adapter.fillScores(units.map(() => 0));
                } else if (adapter.fillScores) {
                    adapter.fillScores([0]);
                }
            }

            // 更新批阅份数
            if (typeof updateBatchProgress === 'function') updateBatchProgress();

            // 保存历史记录
            try {
                HistoryManager.add({
                    presetName: PresetManager.data.active,
                    gradingMode: mode,
                    imageUrls, studentAnswer: '空白答题卡',
                    aiScore: 0, aiComment: '空白答题卡，手动标记',
                    finalScore: 0, isCorrected: false, correctionReason: '',
                    imageBase64s: base64Arr,
                    subScores: (config.scoring?.units || []).map(u => ({ label: u.label, score: 0, maxScore: u.maxScore })),
                    dualEval: null, diligenceLevel: 0, diligenceBonus: 0, diligenceReason: '',
                    durationMs: window.aiGradingState.cycleStartTime ? (Date.now() - window.aiGradingState.cycleStartTime) : null,
                    pacingDelayMs: 0
                });
            } catch (e) {
                console.error('⚠️ 历史记录保存失败:', e);
            }

            // 提交并进入下一份
            const submitted = adapter && adapter.submitGrade ? await adapter.submitGrade() : false;
            if (submitted) {
                window.aiGradingState.blankDetection.blankCount++;
                showToast(`⏭️ 空白卡已标记提交（第${window.aiGradingState.blankDetection.blankCount}张）`);
                if (window.aiGradingState.isRunning && !window.aiGradingState.isPaused) {
                    const oldImgUrl = window.aiGradingState.currentImageUrls[0];
                    if (adapter && adapter.waitForNextPaper) {
                        waitForNextPaperWithRetry(adapter, oldImgUrl).then(async (hasNext) => {
                            if (hasNext && window.aiGradingState.isRunning && !window.aiGradingState.isPaused) {
                                await pacingRestIfNeeded();
                                if (!window.aiGradingState.isRunning || window.aiGradingState.isPaused) return;
                                window.aiGradingState.cycleStartTime = Date.now();
                                setTimeout(startAutoGrading, 500);
                            } else if (!hasNext) {
                                window.aiGradingState.isRunning = false;
                                window.aiGradingState.isPaused = true;
                                const btn = document.querySelector('.ai-grade-btn');
                                if (btn) { btn.textContent = '继续批改'; btn.classList.remove('running', 'unattended', 'trial'); btn.classList.add('paused'); }
                                showToast('⚠️ 下一份试卷加载超时，已暂停');
                            }
                        });
                    } else {
                        setTimeout(startAutoGrading, 500);
                    }
                } else {
                    window.aiGradingState.isRunning = false;
                }
            } else {
                window.aiGradingState.isRunning = false;
                window.aiGradingState.isPaused = true;
                const btn = document.querySelector('.ai-grade-btn');
                if (btn) { btn.textContent = '继续批改'; btn.classList.remove('running', 'unattended', 'trial'); btn.classList.add('paused'); }
                showToast('⚠️ 未找到提交按钮，请手动提交后点击"继续批改"');
            }
        });
    }

    // "这不是空白卡" 按钮 — 撤销空白判定，重新进行 AI 批改
    const notBlankBtn = dialog.querySelector('#not-blank-btn');
    if (notBlankBtn) {
        notBlankBtn.addEventListener('click', () => {
            if (dialog.countdownTimer) clearInterval(dialog.countdownTimer);
            dialog.remove();
            showToast('已撤销空白判定，正在重新批改...');
            // 设置跳过标记，避免下一次检测又判为空白
            window.aiGradingState.blankDetection.skipOnce = true;
            window.aiGradingState.errorRetryCount = 0;
            setTimeout(() => startAutoGrading(), 300);
        });
    }

    // 最小化/恢复
    const minimizedBar = dialog.querySelector('#asd-minimized-bar');
    const overlay = dialog.querySelector('.asd-overlay');
    const grid = dialog.querySelector('.asd-grid');
    const footer = dialog.querySelector('.asd-footer');

    dialog.querySelector('#minimize-btn').addEventListener('click', () => {
        // 隐藏主对话框内容
        overlay.style.display = 'none';
        dialog.querySelector('.asd-header').style.display = 'none';
        if (grid) grid.style.display = 'none';
        if (footer) footer.style.display = 'none';
        // 防御样式对 width/maxWidth 用了 !important，内联必须同样带 important 才能覆盖
        dialog.style.setProperty('width', 'auto', 'important');
        dialog.style.setProperty('max-width', 'none', 'important');
        dialog.style.setProperty('overflow', 'visible', 'important');
        dialog.style.borderRadius = '16px';
        dialog.style.top = 'auto';
        dialog.style.left = '50%';
        dialog.style.transform = 'translateX(-50%)';
        dialog.style.bottom = '20px';
        dialog.style.animation = 'none';
        dialog.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)';
        // 显示最小化浮动条
        if (minimizedBar) {
            minimizedBar.style.display = 'flex';
        }
    });

    if (minimizedBar) {
        minimizedBar.querySelector('#restore-btn').addEventListener('click', () => {
            // 恢复主对话框
            overlay.style.display = '';
            dialog.querySelector('.asd-header').style.display = '';
            if (grid) grid.style.display = '';
            if (footer) footer.style.display = '';
            dialog.style.removeProperty('width');
            dialog.style.removeProperty('max-width');
            dialog.style.removeProperty('overflow');
            dialog.style.borderRadius = '';
            dialog.style.top = '';
            dialog.style.left = '';
            dialog.style.transform = '';
            dialog.style.bottom = '';
            dialog.style.animation = '';
            dialog.style.boxShadow = '';
            minimizedBar.style.display = 'none';
        });

        minimizedBar.querySelector('#minimized-cancel-btn').addEventListener('click', () => {
            if (dialog.countdownTimer) clearInterval(dialog.countdownTimer);
            dialog.remove();
            window.aiGradingState.isRunning = false;
            window.aiGradingState.countdownPaused = false;
            const btn = document.querySelector('.ai-grade-btn');
            if (btn) {
                btn.textContent = 'AI 批改';
                btn.classList.remove('running', 'paused', 'unattended', 'trial');
            }
            showToast('已取消本次批改');
        });
    }

    // 拖动功能
    const dragHandle = dialog.querySelector('#asd-drag-handle');
    if (dragHandle) {
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        dragHandle.addEventListener('mousedown', (e) => {
            if (e.target.id === 'minimize-btn' || e.target.closest('#minimize-btn')) return;
            isDragging = true;
            const rect = dialog.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            // 移除居中定位，使用绝对定位
            dialog.style.transform = 'none';
            dialog.style.left = rect.left + 'px';
            dialog.style.top = rect.top + 'px';
            getUIRoot().style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            let newLeft = e.clientX - dragOffsetX;
            let newTop = e.clientY - dragOffsetY;
            // 边界限制
            const maxLeft = window.innerWidth - dialog.offsetWidth;
            const maxTop = window.innerHeight - dialog.offsetHeight;
            newLeft = Math.max(0, Math.min(newLeft, maxLeft));
            newTop = Math.max(0, Math.min(newTop, maxTop));
            dialog.style.left = newLeft + 'px';
            dialog.style.top = newTop + 'px';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            getUIRoot().style.userSelect = '';
        });
    }

    const confirmSubmitFn = async () => {
        if (dialog.countdownTimer) clearInterval(dialog.countdownTimer);
        dialog.remove();

        console.log('📊 [诊断] confirmSubmitFn 调用');

        // 更新批阅份数进度（在历史记录之前，避免存储异常导致计数丢失）
        if (typeof updateBatchProgress === 'function') {
            console.log('📊 [诊断] 调用 updateBatchProgress');
            updateBatchProgress();
        }

        try {
            // 批改节奏：记录本卷用时（开始处理 → 提交，含随机延迟）与延迟时长
            const hpState = window.aiGradingState.humanPacing || {};
            const humanPacingRecordCfg = humanPacingCfg || {};
            const durationMs = window.aiGradingState.cycleStartTime
                ? (Date.now() - window.aiGradingState.cycleStartTime) : null;
            HistoryManager.add({
                presetName: PresetManager.data.active,
                gradingMode: mode,
                imageUrls, studentAnswer,
                aiScore: score, aiComment: comment,
                finalScore: score, isCorrected: false, correctionReason: '',
                imageBase64s: window.aiGradingState.currentBase64DataArray || [],
                subScores: subScores,
                dualEval: dualEval || null,
                diligenceLevel: diligence?.level || 0,
                diligenceBonus: diligence?.bonus || 0,
                diligenceReason: diligence?.reason || '',
                durationMs: humanPacingRecordCfg.recordDuration !== false ? durationMs : null,
                pacingDelayMs: hpState.lastDelayMs || 0
            });
        } catch (e) {
            console.error('⚠️ [诊断] 历史记录保存失败（不影响批阅进度）:', e);
        }
        window.aiGradingState.cycleStartTime = null;

        const adapter = window.__AI_MARKER_ADAPTER__;
        const submitted = adapter && adapter.submitGrade ? await adapter.submitGrade() : false;

        if (submitted) {
            if (window.aiGradingState.isRunning && !window.aiGradingState.isPaused) {
                console.log('已点击提交，正在等待下一份试卷...');
                const oldImgUrl = window.aiGradingState.currentImageUrls[0];

                if (adapter && adapter.waitForNextPaper) {
                    waitForNextPaperWithRetry(adapter, oldImgUrl).then(async (hasNext) => {
                        if (hasNext && window.aiGradingState.isRunning && !window.aiGradingState.isPaused) {
                            // 批改节奏：随机休息（实验性）——休息放在下一份已出现之后，
                            // 平台侧会把休息时间计入下一份的「批改用时」，拟真度更高
                            await pacingRestIfNeeded();
                            if (!window.aiGradingState.isRunning || window.aiGradingState.isPaused) return;
                            console.log('继续批改...');
                            window.aiGradingState.cycleStartTime = Date.now();
                            setTimeout(startAutoGrading, 500);
                        } else if (!hasNext) {
                            // 不停止，改为暂停让用户决定
                            console.warn('⚠️ 加载下一份试卷超时，暂停批改');
                            window.aiGradingState.isRunning = false;
                            window.aiGradingState.isPaused = true;
                            const btn = document.querySelector('.ai-grade-btn');
                            if (btn) {
                                btn.textContent = '继续批改';
                                btn.classList.remove('running', 'unattended', 'trial');
                                btn.classList.add('paused');
                            }
                            showToast('⚠️ 下一份试卷加载超时，已暂停。点击"继续批改"可重试');
                        }
                    });
                } else {
                    setTimeout(startAutoGrading, 500);
                }
            } else {
                window.aiGradingState.isRunning = false;
            }
        } else {
            console.warn('未找到提交按钮，无法自动提交');
            // 不停止，改为暂停让用户手动提交后继续
            window.aiGradingState.isRunning = false;
            window.aiGradingState.isPaused = true;
            const btn = document.querySelector('.ai-grade-btn');
            if (btn) {
                btn.textContent = '继续批改';
                btn.classList.remove('running', 'unattended', 'trial');
                btn.classList.add('paused');
            }
            showToast('⚠️ 未找到提交按钮，请手动提交后点击"继续批改"');
        }
    };

    dialog.querySelector('#confirm-submit-btn').addEventListener('click', confirmSubmitFn);

    // 倒计时（环形进度）。拟人节奏抽到 0 秒时无等待直接提交
    if (showCountdown) {
        if (countdownSeconds <= 0) {
            confirmSubmitFn();
        } else {
            let countdown = countdownSeconds;
            const ringFill = dialog.querySelector('#countdown-ring-fill');
            const totalDash = 100.53; // 2 * PI * 16
            dialog.countdownTimer = setInterval(() => {
                if (window.aiGradingState.countdownPaused) return;
                countdown--;
                const span = dialog.querySelector('#countdown-number');
                if (span) span.textContent = countdown;
                if (ringFill) ringFill.style.strokeDashoffset = totalDash * (1 - countdown / countdownSeconds);
                if (countdown <= 0) confirmSubmitFn();
            }, 1000);
        }
    }
}
