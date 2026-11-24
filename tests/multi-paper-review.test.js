const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../src/core/multi-paper-review.js'), 'utf8');
const { createMultiPaperReview } = vm.runInNewContext(source + '\n({ createMultiPaperReview })', { AbortController });
const nextTick = () => new Promise(resolve => setImmediate(resolve));
const paper = (key, revision = key) => ({ key, revision, label: key, imageUrls: [key] });

function fixture(options = {}) {
    let snapshot = {
        taskKey: 'exam-1/question-1',
        question: '第1题',
        maxScore: 2,
        step: 0.5,
        submissionReady: true,
        papers: ['A', 'B', 'C', 'D'].map(key => paper(key))
    };
    const requests = new Map();
    const writes = [];
    const review = createMultiPaperReview({
        concurrency: 2,
        readSnapshot: () => snapshot,
        grade: (value, signal) => new Promise((resolve, reject) => {
            requests.set(value.key, { value, signal, resolve, reject });
        }),
        submitGroup: async group => {
            writes.push({ score: group.score, keys: Array.from(group.papers, value => value.key) });
            if (options.submitGroup) return options.submitGroup(group, update);
            update({ papers: snapshot.papers.filter(value => !group.papers.some(target => target.key === value.key)) });
            return 'saved';
        }
    });
    function update(fields) { snapshot = { ...snapshot, ...fields }; }
    function status(key) { return review.view().rows.find(row => row.key === key)?.status; }
    return { review, update, requests, writes, status };
}

test('限制并发并逐份发布，快速答卷可先确认', async () => {
    const { review, requests, status, writes } = fixture();
    assert.equal(review.addVisiblePapers(), 4);
    assert.deepEqual([...requests.keys()], ['A', 'B']);
    requests.get('B').resolve({ score: 0, basis: '未作答' });
    await nextTick();
    assert.deepEqual([...requests.keys()], ['A', 'B', 'C']);
    assert.deepEqual(Array.from(review.view().rows, row => row.key), ['A', 'B', 'C', 'D']);
    assert.equal(status('A'), 'scoring');
    const plan = review.prepareConfirmation(['B']);
    assert.equal(plan[0].score, 0);
    requests.get('C').resolve({ score: 2 });
    await nextTick();
    assert.equal(await review.submit(plan), 'saved');
    assert.deepEqual(writes, [{ score: 0, keys: ['B'] }]);
    assert.equal(status('B'), 'saved');
    assert.equal(status('C'), 'ready');
});

test('同一次确认按分值依次保存，保存中的重复请求被忽略', async () => {
    let finish;
    const { review, requests, writes, status } = fixture({
        submitGroup: (group, update) => group.score === 2 ?
            new Promise(resolve => {
                finish = () => { update({ papers: ['B', 'C', 'D'].map(key => paper(key)) }); resolve('saved'); };
            }) : 'saved'
    });
    review.addVisiblePapers();
    requests.get('A').resolve({ score: 2 });
    requests.get('B').resolve({ score: 0.5 });
    await nextTick();
    const plan = review.prepareConfirmation(['B', 'A']);
    assert(Object.isFrozen(plan) && Object.isFrozen(plan[0].papers[0]));
    const save = review.submit(plan);
    assert.equal(await review.submit(plan), 'blocked');
    assert.equal(status('A'), 'submitting');
    assert.deepEqual(writes, [{ score: 2, keys: ['A'] }]);
    finish();
    assert.equal(await save, 'saved');
    assert.deepEqual(writes, [{ score: 2, keys: ['A'] }, { score: 0.5, keys: ['B'] }]);
});

test('未知保存状态保留已保存组并停止后续组', async () => {
    const { review, requests, writes, status } = fixture({
        submitGroup: (group, update) => {
            if (group.score === 2) {
                update({ papers: ['B', 'C', 'D'].map(key => paper(key)) });
                return 'saved';
            }
            return 'unknown';
        }
    });
    review.addVisiblePapers();
    requests.get('A').resolve({ score: 2 });
    requests.get('B').resolve({ score: 1 });
    await nextTick();
    requests.get('C').resolve({ score: 0 });
    await nextTick();
    assert.equal(await review.submit(review.prepareConfirmation(['C', 'B', 'A'])), 'unknown');
    assert.deepEqual(writes, [{ score: 2, keys: ['A'] }, { score: 1, keys: ['B'] }]);
    assert.equal(status('A'), 'saved');
    assert.equal(status('B'), 'unknown');
    assert.equal(status('C'), 'ready');
    assert.equal(review.prepareConfirmation(['C']), null);
});

test('改分、切图变化和原生选卷变化要求重新核对', async () => {
    const { review, requests, update, writes, status } = fixture();
    review.addVisiblePapers();
    requests.get('A').resolve({ score: 1 });
    requests.get('B').resolve({ score: 2 });
    await nextTick();
    const plan = review.prepareConfirmation(['A', 'B']);
    assert.equal(review.setScore('A', 1.5), true);
    assert.equal(await review.submit(plan), 'blocked');
    const secondPlan = review.prepareConfirmation(['A']);
    update({ submissionReady: false });
    assert.equal(await review.submit(secondPlan), 'blocked');
    update({ submissionReady: true, papers: [paper('B', 'changed'), paper('A')] });
    review.refresh();
    assert.equal(status('B'), 'stale');
    assert.equal(review.prepareConfirmation(['B']), null);
    assert.deepEqual(writes, []);
});

test('识别失败可单独重试，疑难和非法分数需教师给分', async () => {
    const { review, requests, status } = fixture();
    review.addVisiblePapers();
    requests.get('A').reject(new Error('model unavailable'));
    requests.get('B').resolve({ score: 0, reviewRequired: true });
    await nextTick();
    assert.equal(status('A'), 'failed');
    assert.equal(status('B'), 'review');
    assert.equal(review.setScore('B', 0.2), false);
    assert.equal(review.setScore('B', 0), true);
    assert.equal(status('B'), 'ready');
    assert.equal(review.retry('A'), true);
    requests.get('C').resolve({ score: 2.5 });
    await nextTick();
    requests.get('A').resolve({ score: 1 });
    await nextTick();
    assert.equal(status('A'), 'ready');
    assert.equal(status('C'), 'review');
});

test('切题终止请求，同题下一批可追加且不复用先前答卷', async () => {
    const { review, requests, update, status, writes } = fixture();
    review.addVisiblePapers();
    update({ papers: [paper('B'), paper('E')] });
    review.refresh();
    assert.equal(status('A'), 'stale');
    assert.equal(review.addVisiblePapers(), 1);
    requests.get('A').resolve({ score: 2 });
    await nextTick();
    assert(requests.has('E'));
    update({ taskKey: 'exam-1/question-2' });
    review.refresh();
    assert.equal(requests.get('E').signal.aborted, true);
    requests.get('E').resolve({ score: 2 });
    await nextTick();
    assert.equal(status('E'), 'paused');
    assert.equal(review.addVisiblePapers(), 0);
    assert.deepEqual(writes, []);
});
