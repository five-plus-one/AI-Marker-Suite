const { parse } = require('acorn');

const levels = new Set(['debug', 'info', 'log', 'warn', 'error']);

function messageOf(node) {
    if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node.type === 'TemplateLiteral') return node.quasis.map(part => part.value.cooked ?? '').join('…');
    if (node.type === 'BinaryExpression' && node.operator === '+') {
        return messageOf(node.left) + messageOf(node.right);
    }
    return '…';
}

// Attach source metadata. The runtime serializes diagnostic arguments and forwards the originals to the console.
function instrumentDiagnosticLogs(source, moduleName) {
    const edits = [];
    function visit(node) {
        if (typeof node?.type !== 'string') return;
        const callee = node.callee;
        if (node.type === 'CallExpression' && !node.optional && callee?.type === 'MemberExpression'
            && !callee.computed && !callee.optional && callee.object.name === 'console' && levels.has(callee.property.name)) {
            const message = node.arguments.map(messageOf).join(' ').trim().slice(0, 400);
            const metadata = [callee.property.name, `${moduleName}:${node.loc.start.line}`, message];
            edits.push({
                start: callee.start,
                end: callee.end,
                text: `DiagnosticLog.write.bind(null,${metadata.map(value => JSON.stringify(value)).join(',')})`,
            });
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(visit);
            else visit(value);
        }
    }
    visit(parse(source, { ecmaVersion: 'latest', locations: true }));
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
        source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    }
    return source;
}

module.exports = { instrumentDiagnosticLogs };
