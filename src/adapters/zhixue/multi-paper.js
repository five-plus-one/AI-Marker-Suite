function readZhixueBatchNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && /^(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return Number(value);
    return NaN;
}

function readZhixueMultiPaper(adapter) {
    const root = adapter._multiPaperRoot();
    if (!root) return null;
    const imageView = root.__vue__;
    let host = imageView;
    while (host && !host.$refs?.scorearea) host = host.$parent;
    const grading = host?.$refs?.scorearea;
    const nav = host?.$refs?.navtools;
    const nativePapers = imageView?.topicImgTemplete?.multImgaeList;
    const markingPaperId = host?.$route?.query?.markingPaperId || grading?.markingPaperId;
    if (!imageView || !grading || !nav || !Array.isArray(nativePapers) || !nativePapers.length || !markingPaperId ||
        grading.isMarkBack || grading.isRemark || grading.isArbitration || grading.isTripleMark) return null;

    const form = grading.$el;
    const input = form?.querySelector('#mult-input input');
    const button = form?.querySelector('button#bnt_save');
    const label = String(grading.currentTopicTitle || '').trim();
    const maxScore = readZhixueBatchNumber(grading.currentStandardScore);
    const board = form?.querySelector('#exam_type .hd_step, .tsb__step-text');
    const step = readZhixueBatchNumber(board?.textContent);
    const split = grading.scorePlatObj?.isSplitScore ? grading.scorePlatObj.scoreArr : null;
    const allowedScores = Array.isArray(split) && split.length ?
        [...new Set(split.map(readZhixueBatchNumber))].sort((a, b) => a - b) : null;
    const marked = readZhixueBatchNumber(nav.countParams?.teacherMarked);
    const topic = String(nativePapers[0].topicNumStr || '');
    if (!form?.isConnected || !input || !button || !label || !topic || !(maxScore > 0) ||
        (!allowedScores && !(step > 0)) || allowedScores?.some(score => !Number.isFinite(score) || score < 0 || score > maxScore) ||
        !Number.isInteger(marked) || marked < 0) return null;

    const cards = Array.from(root.querySelectorAll(':scope > [name="topicImg"][data-num]'));
    const shown = imageView.curMultImgaeList || nativePapers;
    if (cards.length !== nativePapers.length || !Array.isArray(shown) || shown.length !== cards.length) return null;
    const keys = new Set();
    const papers = [];
    for (const [index, card] of cards.entries()) {
        const paper = nativePapers[index];
        const key = String(paper.itemId || '');
        const revision = adapter._answerResourceKey(paper.img);
        if (!key || keys.has(key) || !revision || String(paper.topicNumStr) !== topic ||
            card.getAttribute('data-num') !== String(index) || String(shown[index]?.itemId) !== key ||
            adapter._answerResourceKey(shown[index]?.img) !== revision) return null;
        keys.add(key);
        const image = Array.from(card.querySelectorAll('img')).find(element =>
            element.parentElement === card.firstElementChild && element.getAttribute('alt') === '');
        const expectedSrc = imageView.getReal?.(paper.img) || paper.img;
        const loaded = image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0 &&
            (image.src === expectedSrc || (!image.src.startsWith('data:') &&
                adapter._answerResourceKey(image.src) === adapter._answerResourceKey(expectedSrc)));
        papers.push({
            key, revision, imageUrls: loaded ? [image.src] : [],
            card, selected: Boolean(paper.isChecked), score: paper.score, markedType: paper.starfd
        });
    }

    return {
        taskKey: JSON.stringify([location.origin, markingPaperId, host.currentUser?.id ?? null, topic, label]),
        question: label, topic, maxScore, step: allowedScores ? undefined : step, allowedScores, papers,
        root, host, grading, nav, input, button, marked,
        writable: grading.autoCommitIsSelect === false &&
            !(grading.quickSubmit && grading.scorePlatStatus?.spotPlat === 'checked') && !grading.isSubmit &&
            !grading.exceptionStatus && !grading.aigradePaused && !host.aigradeBlocking &&
            !host.isShowOriginalMarking && !host.showTraceOriginalMarking && !host.isMultiPlat &&
            grading.canSave !== false && !(grading.markingLimitTime >= 1) &&
            !visibleZhixueDialogs().length,
        nativeScore: grading.scoreNumber
    };
}

function zhixueBatchIdle(state) {
    return state.writable && !state.papers.some(paper => paper.selected || paper.markedType ||
        (paper.score !== '' && paper.score !== null && paper.score !== undefined)) &&
        (state.nativeScore === '' || state.nativeScore === null || state.nativeScore === undefined);
}

async function submitZhixueMultiPaperGroup(adapter, group) {
    const initial = readZhixueMultiPaper(adapter);
    if (!initial || initial.taskKey !== group.taskKey || !zhixueBatchIdle(initial) ||
        group.signal.aborted || !group.isCurrent() || !validMultiPaperScore(group.score, initial)) return 'blocked';

    const targets = new Map(group.papers.map(paper => [paper.key, paper.revision]));
    if (targets.size !== group.papers.length || !targets.size || group.papers.some(target =>
        !initial.papers.some(paper => paper.key === target.key && paper.revision === target.revision))) return 'blocked';
    const sameTask = state => state && state.host === initial.host && state.taskKey === initial.taskKey;
    const original = new Map(initial.papers.map(paper => [paper.key, paper.revision]));
    const matchesOriginal = state => sameTask(state) && state.papers.length === original.size &&
        state.papers.every(paper => original.get(paper.key) === paper.revision);
    const canPrepare = state => matchesOriginal(state) && state.writable && !group.signal.aborted && group.isCurrent();
    const selected = state => state.papers.filter(paper => paper.selected);
    const matchesSelection = state => selected(state).length === targets.size &&
        selected(state).every(paper => targets.get(paper.key) === paper.revision);
    const tick = () => new Promise(resolve => initial.grading.$nextTick(resolve));
    let dispatched = false;
    let userAction = false;
    const stopOnInput = event => {
        if (event.isTrusted && !event.target.closest?.('#ai-multi-paper-review, .ai-grade-btn') &&
            (event.type !== 'keydown' || ['Enter', ' ', 'Escape'].includes(event.key))) userAction = true;
    };
    const doc = initial.root.ownerDocument;
    const events = ['pointerdown', 'keydown', 'change'];
    for (const type of events) doc.addEventListener(type, stopOnInput, true);
    try {
        for (const paper of initial.papers) {
            if (targets.has(paper.key)) paper.card.click();
        }
        await tick();
        let state = readZhixueMultiPaper(adapter);
        if (userAction || !canPrepare(state) || !matchesSelection(state) || state.input.disabled) return 'blocked';

        const view = doc.defaultView;
        const setValue = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value').set;
        setValue.call(state.input, String(group.score));
        state.input.dispatchEvent(new view.Event('input', { bubbles: true }));
        await tick();
        state.input.dispatchEvent(new view.Event('change', { bubbles: true }));
        await tick();
        state = readZhixueMultiPaper(adapter);
        if (userAction || !canPrepare(state) || !matchesSelection(state) || state.button.disabled ||
            selected(state).some(paper => readZhixueBatchNumber(paper.score) !== group.score)) return 'blocked';

        dispatched = true;
        state.button.click();
        const deadline = Date.now() + 15000;
        do {
            await new Promise(resolve => setTimeout(resolve, 125));
            if (userAction) return 'unknown';
            const current = readZhixueMultiPaper(adapter);
            if (sameTask(current) && current.marked === initial.marked + targets.size &&
                (targets.size === original.size ||
                    current.papers.every(paper => !targets.has(paper.key)))) return 'saved';
            // The last group may finish at a quota prompt before native replacement images load.
            if (targets.size === original.size && initial.host.$refs?.navtools === initial.nav &&
                String(initial.nav.currentTopicNum) === initial.topic &&
                readZhixueBatchNumber(initial.nav.countParams?.teacherMarked) === initial.marked + targets.size) return 'saved';
            if (current && !sameTask(current) || group.signal.aborted || visibleZhixueDialogs().length) return 'unknown';
        } while (Date.now() < deadline);
        return 'unknown';
    } finally {
        for (const type of events) doc.removeEventListener(type, stopOnInput, true);
        if (!dispatched && !userAction) {
            // Revert only our selection while the complete original group is still on screen.
            const current = readZhixueMultiPaper(adapter);
            if (matchesOriginal(current) && selected(current).every(paper => targets.has(paper.key))) {
                for (const paper of selected(current)) paper.card.click();
            }
        }
    }
}
