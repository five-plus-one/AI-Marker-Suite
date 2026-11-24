let activeMultiPaperReview;

function multiPaperButton(label, action, primary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.fpTooltip = label;
    if (primary) button.dataset.variant = 'primary';
    button.addEventListener('click', action);
    return button;
}

function openMultiPaperReview(adapter) {
    if (!adapter?.isMultiPaperMode?.()) return false;
    if (activeMultiPaperReview && !activeMultiPaperReview.review.view().stopped) {
        activeMultiPaperReview.show();
        return true;
    }
    activeMultiPaperReview?.dispose();
    const snapshot = adapter.readMultiPaperSnapshot?.();
    if (!snapshot?.papers.length || !adapter.submitMultiPaperGroup) {
        showToast('请等待当前题目的答卷和打分板就绪');
        return true;
    }
    const preset = PresetManager.getCurrentConfig();
    let config;
    try {
        config = JSON.parse(JSON.stringify(PresetManager.getActiveCallConfig()));
    } catch (_) {
        showToast('请在设置中核对评分方案和模型');
        openSettingsPanel();
        return true;
    }
    if ((!config.apiKey && !config.officialAccountId) ||
        !extractFieldText(preset.answer).trim() || !extractFieldText(preset.rubric).trim() ||
        !PresetManager.validateScoringUnits().valid || PresetManager.getMaxScore() !== snapshot.maxScore) {
        showToast(`请核对参考答案、评分标准和本题满分 ${snapshot.maxScore} 分`);
        openSettingsPanel();
        return true;
    }
    config.scoring = { ...config.scoring, maxScore: snapshot.maxScore, units: JSON.parse(JSON.stringify(preset.scoring?.units || [])) };
    const sourceWorkflow = JSON.stringify(preset.workflowId ? WorkflowManager.getWorkflow(preset.workflowId) : null);
    if (sourceWorkflow) config.workflowSnapshot = JSON.parse(sourceWorkflow);
    const source = JSON.stringify(preset);
    const configMatches = () => source === JSON.stringify(PresetManager.getCurrentConfig()) &&
        sourceWorkflow === JSON.stringify(preset.workflowId ? WorkflowManager.getWorkflow(preset.workflowId) : null) &&
        !window.aiGradingState.hasUnsavedChanges;
    const storageKey = 'ai-multi-paper-pending:' + snapshot.taskKey;
    let pendingWrite = sessionStorage.getItem(storageKey) === '1';
    let plan;
    let notice = '';
    const items = new Map();
    const root = getUIRoot();
    const pane = FivePlusOneEmbeddedUI.createReviewPanel(document, {
        id: 'ai-multi-paper-review',
        title: snapshot.question + ' 批量批改',
        onClose: () => {
            pane.panel.hidden = true;
            document.querySelector('.ai-grade-btn')?.focus();
        }
    });
    pane.panel.setAttribute('data-follow-system', '');
    Object.assign(pane.panel.style, {
        position: 'fixed', insetInlineStart: '12px', insetBlockEnd: '12px',
        width: 'min(30rem, calc(100vw - 24px))', zIndex: '100002'
    });
    const continueButton = multiPaperButton('继续本题', () => {
        notice = '';
        if (!review.addVisiblePapers()) notice = '当前页暂无新的答卷';
        render(review.view());
    });
    const cancelButton = multiPaperButton('返回核对', () => {
        plan = undefined;
        render(review.view());
        confirmButton.focus();
    });
    const confirmButton = multiPaperButton('确认所选', async () => {
        notice = '';
        if (plan) {
            const submitted = plan;
            plan = undefined;
            const result = await review.submit(submitted);
            notice = result === 'saved' ? '已保存本次确认的分数' :
                result === 'unknown' ? `请在${adapter.name}阅卷记录核对本次给分` :
                    '请核对当前答卷、分数和平台的选择状态后再确认';
            render(review.view());
            return;
        }
        const selected = [...items].filter(([, item]) => item.check.checked && !item.check.disabled).map(([key]) => key);
        const batch = window.aiGradingState.batchProgress;
        if (batch.enabled && !batch.limitExempt && batch.targetCount > 0 &&
            selected.length > batch.targetCount - batch.currentCount) {
            notice = '所选份数超过剩余批阅目标，请调整选择或批阅份数';
        } else {
            plan = review.prepareConfirmation(selected);
            if (!plan) notice = `请在${adapter.name}核对当前答卷，清除已选项并关闭自动提交`;
        }
        render(review.view());
    }, true);
    const verifyButton = multiPaperButton('已核对阅卷记录', () => {
        sessionStorage.removeItem(storageKey);
        dispose();
        openMultiPaperReview(adapter);
    });
    const stopButton = multiPaperButton('结束批改', () => {
        dispose();
        document.querySelector('.ai-grade-btn')?.focus();
    });
    pane.footer.append(continueButton, stopButton, cancelButton, verifyButton, confirmButton);

    function render(state) {
        if (state.stopped) plan = undefined;
        for (const row of state.rows) {
            let item = items.get(row.key);
            if (!item) {
                const element = document.createElement('li');
                element.className = 'fp-embedded-review-item';
                const name = document.createElement('label');
                name.className = 'fp-embedded-action-choices';
                const check = document.createElement('input');
                check.type = 'checkbox';
                check.addEventListener('change', () => render(review.view()));
                name.append(check, row.label);
                const status = document.createElement('p');
                const score = document.createElement('input');
                score.type = 'number';
                score.min = '0';
                score.max = String(state.rules.maxScore);
                score.step = String(state.rules.step || 'any');
                score.setAttribute('aria-label', row.label + '分数');
                score.addEventListener('change', () => {
                    score.setCustomValidity('');
                    if (score.value.trim() !== '' && review.setScore(row.key, score.valueAsNumber)) return;
                    score.setCustomValidity('请输入平台允许的分数');
                    score.reportValidity();
                });
                score.addEventListener('input', () => score.setCustomValidity(''));
                const detail = document.createElement('details');
                const detailLabel = document.createElement('summary');
                detailLabel.textContent = '作答与依据';
                const basis = document.createElement('p');
                const images = document.createElement('div');
                detail.append(detailLabel, images, basis);
                detail.addEventListener('toggle', () => {
                    if (!detail.open || images.childElementCount) return;
                    const current = adapter.readMultiPaperSnapshot()?.papers.find(paper =>
                        paper.key === row.key && paper.revision === row.revision);
                    for (const src of current?.imageUrls || []) {
                        if (!/^(?:https?:|data:image\/(?:png|jpe?g|webp|gif);base64,)/i.test(src)) continue;
                        const preview = document.createElement('img');
                        preview.alt = row.label + '作答';
                        preview.src = src;
                        images.append(preview);
                    }
                });
                const retry = multiPaperButton('重试评分', () => review.retry(row.key));
                const controls = document.createElement('div');
                controls.className = 'fp-embedded-action-choices';
                controls.append(score, retry);
                element.append(name, status, controls, detail);
                pane.list.append(element);
                item = { check, status, score, retry, basis, detail, checkedOnce: false };
                items.set(row.key, item);
            }
            const editable = ['ready', 'failed', 'review'].includes(row.status);
            if (row.status === 'ready' && !item.checkedOnce) {
                item.check.checked = true;
                item.checkedOnce = true;
            }
            item.check.disabled = row.status !== 'ready' || state.submitting || !!plan || state.stopped;
            item.score.hidden = !editable;
            item.score.disabled = !!plan || state.submitting || state.stopped;
            if (document.activeElement !== item.score && !item.score.validity.customError) item.score.value = row.score ?? '';
            item.retry.hidden = row.status !== 'failed';
            item.retry.disabled = state.stopped;
            item.basis.textContent = row.basis || '';
            item.status.textContent = row.message || {
                queued: '待评分', scoring: '正在评分', ready: row.score + ' 分', failed: '评分未完成，可重试或手动给分',
                review: '请核对作答并给分', submitting: '正在保存', saved: '已保存 ' + row.score + ' 分',
                unknown: '请核对是否已保存', paused: '已暂停', stale: '答卷已变化'
            }[row.status];
        }
        const selectedCount = [...items.values()].filter(item => item.check.checked && !item.check.disabled).length;
        const saved = state.rows.filter(row => row.status === 'saved').length;
        const summary = state.submitting ? `正在通过${adapter.name}保存分数` : (plan ?
            '本次将提交 ' + plan.map(group => `${group.score} 分 × ${group.papers.length} 份`).join('、') :
            (state.stopped ? '阅卷任务已变化，请重新打开批量批改' : (notice ||
                (pendingWrite ? `请先查看${adapter.name}阅卷记录，核对上次提交` :
                    `已保存 ${saved} 份 · 选中 ${selectedCount} 份 · 本次 ${state.rows.length} 份`))));
        if (pane.summary.textContent !== summary) pane.summary.textContent = summary;
        const confirmationLabel = plan ? '提交这些分数' : '确认所选';
        confirmButton.textContent = confirmationLabel;
        confirmButton.dataset.fpTooltip = confirmationLabel;
        confirmButton.disabled = state.submitting || state.stopped || pendingWrite || (!plan && !selectedCount);
        cancelButton.hidden = !plan;
        verifyButton.hidden = !pendingWrite || state.submitting;
        continueButton.hidden = !!plan || pendingWrite;
        continueButton.disabled = state.submitting || state.stopped;
        stopButton.hidden = !!plan;
        stopButton.disabled = state.submitting;
    }

    const review = createMultiPaperReview({
        readSnapshot: () => adapter.readMultiPaperSnapshot(),
        grade: createMultiPaperGrader(adapter, config),
        concurrency: config.workflowSnapshot?.dualEval?.enabled ? 2 : 3,
        onChange: render,
        onError: error => console.warn('批量批改未完成', error),
        submitGroup(group) {
            const write = async () => {
                if (!configMatches() || pendingWrite) return 'blocked';
                sessionStorage.setItem(storageKey, '1');
                pendingWrite = true;
                const result = await adapter.submitMultiPaperGroup(group);
                if (result === 'saved' || result === 'blocked') {
                    sessionStorage.removeItem(storageKey);
                    pendingWrite = false;
                }
                if (result === 'saved') updateBatchProgress(group.papers.length);
                return result;
            };
            return navigator.locks ? navigator.locks.request(storageKey, { ifAvailable: true }, lock =>
                lock ? write() : 'blocked') : write();
        }
    });
    if (!review) return true;
    root.append(pane.panel);
    function show() { pane.panel.hidden = false; pane.close.focus(); }
    function dispose() {
        clearInterval(watch);
        review.stop();
        pane.panel.remove();
        if (activeMultiPaperReview?.review === review) activeMultiPaperReview = undefined;
    }
    const watch = setInterval(() => {
        if (!adapter.isMarkingPage?.() || !configMatches()) review.stop();
        else review.refresh();
    }, 600);
    activeMultiPaperReview = { review, show, dispose };
    if (!pendingWrite) review.addVisiblePapers();
    else render(review.view());
    show();
    return true;
}
