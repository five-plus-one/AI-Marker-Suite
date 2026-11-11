const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/core/prompt.js'), 'utf8'), context);
const collect = field => Array.from(context.extractReferencedFieldImages(field));
const field = text => ({ text, images: ['A', 'B', 'C'], format: 'markdown' });

for (const [name, text, expected] of [
    ['转为纯文字', '识别后的参考答案', []],
    ['清空正文', '', []],
    ['保留一张配图', '答案 ![电路](ai-img://1)', ['B']],
    ['重复引用', '![图](ai-img://1) ![图](ai-img://1)', ['B']],
    ['引用数组中的部分图片', '![第三张](ai-img://2) ![第一张](ai-img://0)', ['A', 'C']],
    ['无效索引', '![图](ai-img://99) ![图](ai-img://-1)', []],
    ['普通文本中的协议名称', '例：ai-img://0', []],
    ['按预览显示的注释文本图片', '<!-- ![图](ai-img://0) -->', ['A']],
    ['行内代码中的图片', '`![图](ai-img://0)`', []],
    ['代码块中的图片', '```md\n![图](ai-img://0)\n```', []],
    ['波浪代码块中的图片', '~~~md\n![图](ai-img://0)\n~~~', []],
    ['转义后的图片语法', '\\![图](ai-img://0)', []],
    ['预览中的多张图片', '<!-- ![图](ai-img://0) -->\n![图](ai-img://2)', ['A', 'C']],
]) test(name + '只发送实际参考图片', () => assert.deepEqual(collect(field(text)), expected));

test('旧版仅图片字段保留参考资料', () => {
    assert.deepEqual(collect({ images: ['A'], text: '' }), ['A']);
    assert.deepEqual(collect({ images: ['A'], format: 'image' }), ['A']);
});
test('筛选请求图片不修改编辑数据和原始索引', () => {
    const input = field('![图](ai-img://2)');
    assert.deepEqual(collect(input), ['C']);
    assert.deepEqual(input.images, ['A', 'B', 'C']);
    assert.deepEqual(Array.from(context.extractFieldImages(input)), input.images);
});
test('参考图分组说明与实际发送数量一致', () => {
    const cfg = { question: field('转为文字'), answer: field('![图](ai-img://1)'), rubric: field('![图](ai-img://0)') };
    assert.deepEqual(Array.from(context.collectFieldImages(cfg)), ['B', 'A']);
    const annotation = context.buildImageAnnotation(cfg);
    assert.doesNotMatch(annotation, /题目配图/);
    assert.match(annotation, /第1-1张为参考答案配图/);
    assert.match(annotation, /第2-2张为评分标准配图/);
});
