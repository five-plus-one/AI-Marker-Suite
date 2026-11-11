const test = require('node:test');
const assert = require('node:assert/strict');
const { env, load, vm } = require('./_audit-harness');

const notice = '精简模式仅输出分数，省略识别答案、评分依据、分数计算和评语。';

test('精简输出解释省略项，详细输出与实际返回内容保持原样', () => {
    const { sb } = env();
    for (const config of [{ outputMode: 'score-only' }, { scoring: { outputMode: 'score-only' } }]) {
        for (const value of ['', '  ', undefined, '未能识别', '未能识别答案']) {
            assert.equal(sb.getGradingOutputText(value, config, '识别答案', '未能识别'), notice);
        }
        assert.equal(sb.getGradingOutputText('', config, '评分依据'), '精简模式下不提供评分依据。');
        assert.equal(sb.getGradingOutputText('机械能', config, '识别答案'), '机械能');
        assert.equal(sb.getGradingOutputText('教师确认', config, '评语'), '教师确认');
        assert.equal(sb.getGradingOutputText(0, config, '识别答案'), '0');
    }
    for (const config of [undefined, {}, { outputMode: 'detailed' }]) {
        assert.equal(sb.getGradingOutputText('', config, '识别答案', '未能识别'), '未能识别');
        assert.equal(sb.getGradingOutputText('未能识别', config, '识别答案'), '未能识别');
        assert.equal(sb.getGradingOutputText('', config, '评语', '无'), '无');
    }
});

test('确认界面和入库模式取本次配置快照，切换方案后仍正确解释精简结果', async () => {
    const e = env();
    e.cfg.outputMode = 'score-only';
    e.state.currentStudentAnswer = '未能识别';
    load(e, 'src/core/main.js');
    load(e, 'src/core/ui-submit-dialog.js');
    const dialog = e.sb.showAutoSubmitDialog(4, '', null, {
        dualEval: { scoreA: 4, scoreB: 4, diff: 0, result: 'consensus', detailA: {}, detailB: {} }
    });
    assert.ok(dialog.innerHTML.includes(notice));
    assert.equal((dialog.innerHTML.match(/精简模式下不提供评分依据。/g) || []).length, 2);
    e.cfg.outputMode = 'detailed';
    await dialog.confirmSubmit();
    assert.equal(e.calls.history.length, 1);
    assert.equal(e.calls.history[0].outputMode, 'score-only');
    assert.equal(e.calls.history[0].studentAnswer, '未能识别', '展示提示不写回原始答案');
    assert.equal(e.calls.history[0].finalScore, 4);
    assert.equal(e.calls.submit.length, 1);
});

test('历史阅读型导出按记录自身模式解释缺省值，原始导出保留数据与模式', async () => {
    const e = env(), files = [];
    e.cfg.outputMode = 'score-only';
    load(e, 'src/core/history.js');
    const manager = vm.runInContext('HistoryManager', e.sb);
    manager._download = (content, name) => files.push({ content, name });
    const compact = { id: 'compact', timestamp: 1, outputMode: 'score-only', studentAnswer: '未能识别',
        aiComment: '', aiScore: 4, finalScore: 4, dualEval: { scoreA: 4, scoreB: 4, diff: 0, result: 'consensus', detailA: {}, detailB: {} } };
    const legacy = { id: 'legacy', timestamp: 1, studentAnswer: '未能识别', aiComment: '' };
    const original = JSON.stringify([compact, legacy]);
    manager.exportCSV([compact, legacy]);
    assert.ok(files[0].content.includes(notice));
    assert.ok(files[0].content.includes('精简模式下不提供评语。'));
    assert.ok(files[0].content.includes('精简模式下不提供分数计算。'));
    assert.ok(files[0].content.split('\n').at(-1).includes('未能识别'));
    await manager.exportHTML([compact, legacy], { includeImages: false });
    assert.ok(files[1].content.includes(notice));
    assert.ok(files[1].content.includes('精简模式下不提供评分依据。'));
    assert.ok(files[1].content.includes('>未能识别</div>'), '旧记录不根据当前方案推断输出模式');
    manager.exportJSON([compact, legacy]);
    assert.equal(JSON.stringify(JSON.parse(files[2].content)), original);
    assert.equal(JSON.stringify([compact, legacy]), original);
});
