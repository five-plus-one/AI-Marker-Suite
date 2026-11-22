const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const core = path.join(__dirname, '../src/core');
const source = ['zip.js', 'diagnostic-export.js'].map(file => fs.readFileSync(path.join(core, file), 'utf8')).join('\n');

for (const withGradingEvents of [false, true]) {
    test(`诊断 ZIP 为${withGradingEvents ? '含批改过程的' : '常规'}报告保留足够的条目`, async () => {
        const image = new Uint8Array([0]);
        const context = vm.createContext({
            TextEncoder,
            navigator: {},
            window: { aiGradingState: {} },
            SCRIPT_CONFIG: { VERSION: '1' },
            DiagnosticLog: { read: () => ({ entries: [], gradingEvents: withGradingEvents ? [{}] : [] }) },
            PresetManager: { data: {} },
            WorkflowManager: { data: {} },
            ProviderManager: { data: {}, _getDefault: () => ({ providers: {} }) },
            HistoryManager: {
                _readReviewRecords: () => [{ timestamp: 1, imageBase64s: Array(65530).fill('AA==') }],
                _base64ToBytes: () => image,
            },
            diagnosticSecrets: () => [],
            diagnosticSnapshot: value => value,
        });
        const { archive, metadata } = await vm.runInContext(source + '\nexportDiagnosticPackage(0, 2)', context);
        const directory = new DataView(archive.buffer, archive.byteLength - 22, 22);
        assert.equal(directory.getUint32(0, true), 0x06054b50);
        assert.equal(directory.getUint16(10, true), 65535);
        assert.equal(metadata.imageCount, withGradingEvents ? 65529 : 65530);
        assert.equal(metadata.imagesLimited, withGradingEvents);
    });
}
