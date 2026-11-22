const test = require('node:test');
const assert = require('node:assert/strict');
const { env, load } = require('./_audit-harness');

test('空白检测绕过模型时更新本卷识别答案，提交与历史只读取当前状态', async () => {
    for (const mode of ['trial', 'normal', 'unattended']) {
        const e = env();
        e.state.gradingMode = mode;
        e.state.currentStudentAnswer = '上一份答卷的答案';
        e.cfg.blankDetection = { enabled: true, threshold: 0.01 };
        e.sb.BlankDetector = { loadReference: () => ({ thresholds: [], ratios: [] }),
            calcBatchRatios: async () => [], isBlankSheet: () => ({ isBlank: true }) };
        e.sb.callAIGrading = async () => { throw Error('空白检测不请求模型'); };
        e.sb.showAutoSubmitDialog = score => e.calls.dialogs.push({ score, answer: e.state.currentStudentAnswer });
        load(e, 'src/core/main.js');
        await e.sb.startAutoGrading();
        assert.deepEqual(e.calls.dialogs, [{ score: 0, answer: '空白答题卡' }]);
        assert.equal(e.state.currentStudentAnswer, '空白答题卡');
        assert.equal(e.calls.submit.length, 0);
    }
});
