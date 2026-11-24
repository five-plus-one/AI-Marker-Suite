// One session owns its scoring queue and one teacher-confirmed write at a time.
function validMultiPaperScore(score, rules) {
    if (!Number.isFinite(score) || score < 0 || score > rules.maxScore) return false;
    if (rules.allowedScores) return rules.allowedScores.includes(score);
    const steps = score / rules.step;
    return Math.abs(steps - Math.round(steps)) < 1e-7;
}

function createMultiPaperGrader(adapter, config) {
    return async (paper, signal) => {
        const fetchImage = adapter.fetchImageAsBase64?.bind(adapter) ?? fetchImageAsBase64;
        const images = await Promise.all(paper.imageUrls.map(url => fetchImage(url, signal, { autoRefreshOn403: false })));
        if (signal.aborted) return;
        const { kept, removed } = filterUsableImagesForAI(images);
        if (!kept.length || removed.length) {
            return { reviewRequired: true, message: '答卷图片不完整，请核对原卷' };
        }

        const request = { ...config, signal, imageGateRemovedCount: 0, outputObservation: { upgraded: false } };
        let result;
        try {
            const evaluate = request.workflowSnapshot?.dualEval?.enabled ? callDualEvaluation : callAIGrading;
            result = await evaluate(kept, request);
            if (!Number.isFinite(result?.score)) return { reviewRequired: true, message: '请核对作答并给分' };
            requireGradingEvidence(result, [result.score, ...(result.subScores || []).map(unit => unit.score)]);
        } catch (error) {
            if (error?.code === 'GRADING_EVIDENCE_REVIEW') return { reviewRequired: true, message: error.message };
            throw error;
        }

        const { finalScore } = calculateGradingResult(result, request.scoring, request.scoring.maxScore);
        const basis = result._sections?.['评分依据'] || result.comment || '';
        if (getGradingAnswerStatus(result) === 'partial') {
            return { reviewRequired: true, basis, message: '部分作答不清，请核对原卷' };
        }
        return { score: finalScore, basis };
    };
}

function createMultiPaperReview({ readSnapshot, grade, submitGroup, onChange, onError, concurrency = 3 }) {
    const initial = readSnapshot();
    if (!initial?.taskKey || !Number.isFinite(initial.maxScore) || initial.maxScore <= 0 ||
        (initial.allowedScores?.length ?
            !initial.allowedScores.every(score => Number.isFinite(score) && score >= 0 && score <= initial.maxScore) :
            !Number.isFinite(initial.step) || initial.step <= 0)) return null;

    const rules = Object.freeze({
        maxScore: initial.maxScore,
        step: initial.step,
        allowedScores: initial.allowedScores?.length ? Object.freeze([...initial.allowedScores]) : null
    });
    const controller = new AbortController();
    const rows = new Map();
    const queue = [];
    const slots = Math.max(1, Math.min(4, Math.trunc(concurrency) || 1));
    const rulesKey = value => JSON.stringify([value.maxScore, value.step, value.allowedScores?.length ? value.allowedScores : null]);
    let working = 0;
    let stopped = false;
    let submitting = false;
    let needsVerification = false;
    let confirmation;

    function view() {
        return {
            question: initial.question,
            rules,
            stopped,
            submitting,
            needsVerification,
            rows: Array.from(rows.values(), row => ({ ...row }))
        };
    }

    function changed() {
        onChange?.(view());
    }

    function stop() {
        if (stopped) return;
        stopped = true;
        controller.abort();
        confirmation = undefined;
        for (const row of rows.values()) {
            if (row.status === 'queued' || row.status === 'scoring') row.status = 'paused';
        }
        queue.length = 0;
        changed();
    }

    function current() {
        if (stopped) return null;
        const snapshot = readSnapshot();
        if (!snapshot || !Array.isArray(snapshot.papers)) return null;
        if (snapshot.taskKey !== initial.taskKey || rulesKey(snapshot) !== rulesKey(rules)) {
            stop();
            return null;
        }
        const papers = new Map();
        for (const paper of snapshot.papers) {
            if (!paper.key || !paper.revision || papers.has(paper.key)) return null;
            papers.set(paper.key, paper);
        }
        return { snapshot, papers };
    }

    function refresh() {
        const present = current();
        if (!present) return false;
        let updated = false;
        for (const row of rows.values()) {
            if (['saved', 'submitting', 'unknown', 'stale'].includes(row.status)) continue;
            if (present.papers.get(row.key)?.revision === row.revision) continue;
            row.status = 'stale';
            updated = true;
        }
        if (updated) changed();
        return true;
    }

    async function evaluate(row) {
        try {
            const paper = current()?.papers.get(row.key);
            if (!paper || paper.revision !== row.revision || !paper.imageUrls?.length) {
                if (row.status === 'scoring') row.status = 'failed';
                return;
            }
            const result = await grade(paper, controller.signal);
            if (row.status !== 'scoring' || stopped) return;
            if (current()?.papers.get(row.key)?.revision !== row.revision) {
                if (!stopped) row.status = 'failed';
                return;
            }
            row.basis = result?.basis || '';
            row.message = result?.message || '';
            if (result?.reviewRequired || !validMultiPaperScore(result?.score, rules)) {
                row.status = 'review';
                return;
            }
            row.score = result.score;
            row.status = 'ready';
        } catch (error) {
            if (row.status !== 'scoring' || stopped) return;
            row.status = 'failed';
            onError?.(error);
        }
    }

    function pump() {
        while (!stopped && working < slots && queue.length) {
            const row = queue.shift();
            if (row.status !== 'queued') continue;
            working++;
            row.status = 'scoring';
            evaluate(row).finally(() => {
                working--;
                pump();
                changed();
            });
        }
    }

    function addVisiblePapers() {
        const present = current();
        if (!present || submitting) return 0;
        let added = 0;
        for (const paper of present.papers.values()) {
            if (rows.has(paper.key)) continue;
            const row = {
                key: paper.key,
                revision: paper.revision,
                label: paper.label || `第 ${rows.size + 1} 份`,
                status: 'queued'
            };
            rows.set(row.key, row);
            queue.push(row);
            added++;
        }
        pump();
        changed();
        return added;
    }

    function retry(key) {
        const row = rows.get(key);
        if (!row || row.status !== 'failed' || current()?.papers.get(key)?.revision !== row.revision) return false;
        row.status = 'queued';
        queue.push(row);
        pump();
        changed();
        return true;
    }

    function setScore(key, score) {
        const row = rows.get(key);
        if (!row || !['ready', 'review', 'failed'].includes(row.status) ||
            !validMultiPaperScore(score, rules) || current()?.papers.get(key)?.revision !== row.revision) return false;
        row.score = score;
        row.status = 'ready';
        row.message = '';
        changed();
        return true;
    }

    function prepareConfirmation(keys) {
        if (submitting || needsVerification) return null;
        confirmation = undefined;
        const present = current();
        if (!present?.snapshot.submissionReady || !keys.length || new Set(keys).size !== keys.length) return null;
        const groups = new Map();
        for (const key of keys) {
            const row = rows.get(key);
            if (row?.status !== 'ready' || present.papers.get(key)?.revision !== row.revision ||
                !validMultiPaperScore(row.score, rules)) return null;
            if (!groups.has(row.score)) groups.set(row.score, []);
            groups.get(row.score).push(Object.freeze({ key, revision: row.revision }));
        }
        confirmation = Object.freeze(Array.from(groups, ([score, papers]) =>
            Object.freeze({ score, papers: Object.freeze(papers) })).sort((a, b) => b.score - a.score));
        return confirmation;
    }

    async function submit(plan) {
        if (!plan || plan !== confirmation || submitting || needsVerification || stopped) return 'blocked';
        confirmation = undefined;
        submitting = true;
        changed();
        try {
            // Check all scores again before dispatch, including changes made while the confirmation was open.
            if (plan.some(group => group.papers.some(({ key }) => rows.get(key)?.score !== group.score))) return 'blocked';
            for (const group of plan) {
                const present = current();
                if (!present?.snapshot.submissionReady || group.papers.some(({ key, revision }) =>
                    present.papers.get(key)?.revision !== revision || rows.get(key)?.status !== 'ready' ||
                    rows.get(key)?.score !== group.score)) return 'blocked';

                const affected = group.papers.map(({ key }) => rows.get(key));
                for (const row of affected) row.status = 'submitting';
                changed();
                let result;
                try {
                    result = await submitGroup({
                        taskKey: initial.taskKey,
                        score: group.score,
                        papers: group.papers,
                        signal: controller.signal,
                        isCurrent: () => !stopped && current()?.snapshot.taskKey === initial.taskKey
                    });
                } catch (error) {
                    onError?.(error);
                }
                if (result === 'saved' || result === 'blocked') {
                    for (const row of affected) row.status = result === 'saved' ? 'saved' : 'ready';
                    changed();
                    if (result === 'blocked') return result;
                    continue;
                }
                needsVerification = true;
                for (const row of affected) row.status = 'unknown';
                changed();
                return 'unknown';
            }
            return 'saved';
        } finally {
            submitting = false;
            refresh();
            changed();
        }
    }

    return { view, refresh, addVisiblePapers, retry, setScore, prepareConfirmation, submit, stop };
}
