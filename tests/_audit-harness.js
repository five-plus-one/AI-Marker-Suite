/* Local, deterministic audit probes. Runs unmodified project modules in a VM. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const results = [];
const quiet = { log() {}, warn() {}, error() {} };
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function env() {
    const ids = new Map(), intervals = new Map(), timeouts = new Map();
    let seq = 0;
    function node() {
        const children = new Map();
        return {
            style: { setProperty() {}, removeProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
            listeners: {}, setAttribute() {}, getAttribute() { return null; },
            appendChild(n) { n.parentNode = this; if (n.id) ids.set(n.id, n); },
            remove() { this.removed = true; ids.delete(this.id); this.parentNode = null; },
            querySelector(s) { if (!children.has(s)) children.set(s, node()); return children.get(s); },
            querySelectorAll() { return []; },
            addEventListener(t, f) { this.listeners[t] = f; }, removeEventListener() {},
            getBoundingClientRect() { return { width: 100, height: 100 }; },
        };
    }
    const root = node(), button = node();
    const state = { isRunning: true, isPaused: false, currentStudentAnswer: 'answer', currentImageUrls: ['https://x.test/A.png'],
        currentBase64DataArray: ['PNG'], gradingMode: 'unattended', errorRetryCount: 0,
        blankDetection: { blankCount: 0, skipOnce: false }, batchProgress: { enabled: false } };
    const cfg = { answer: { text: 'answer' }, rubric: { text: 'rubric' }, scoring: { maxScore: 10, roundStep: 1 }, paperGuard: { enabled: true } };
    const calls = { submit: [], fill: [], history: [], progress: 0, dialogs: [], toasts: [] };
    let paper = 'A';
    const adapter = { isMarkingPage: () => true, getPaperIdentity: () => paper,
        gatherAnswerImages: async () => [`https://x.test/${paper}.png`], getScoreInputs: () => [],
        fetchImageAsBase64: async () => 'PNG',
        fillScores: s => { calls.fill.push({ paper, scores: Array.from(s) }); return true; },
        submitGrade: async () => { calls.submit.push(paper); return true; } };
    const sb = { console: quiet, AbortController, URL, URLSearchParams, Event: class {},
        SCRIPT_CONFIG: { VERSION: 'audit', DEFAULT_ENDPOINT: 'x', DEFAULT_MODEL: 'y' }, navigator: { userAgent: 'Chrome/123' },
        setInterval: f => { const n = ++seq; intervals.set(n, f); return n; }, clearInterval: n => intervals.delete(n),
        setTimeout: f => { const n = ++seq; timeouts.set(n, f); return n; }, clearTimeout: n => timeouts.delete(n),
        requestAnimationFrame() {}, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        document: { readyState: 'loading', createElement: node, addEventListener() {}, removeEventListener() {},
            getElementById: s => ids.get(s) || null, querySelector: s => s === '.ai-grade-btn' ? button : null },
        __AI_MARKER_ADAPTER__: adapter, aiGradingState: state,
        location: { pathname: '/', hash: '', hostname: 'x.test' },
        getUIRoot: () => root,
        PresetManager: { data: { active: 'test', list: {}, bindings: {} }, getCurrentConfig: () => cfg,
            getMaxScore: () => 10, getTaskIdentifier: () => 'task', validateScoringUnits: () => ({ valid: true }),
            getActiveCallConfig: () => ({ apiKey: 'test', endpoint: 'https://api.test', model: 'test' }) },
        WorkflowManager: { getWorkflow: () => null }, extractFieldText: x => x.text,
        HistoryManager: { add: r => calls.history.push(r) }, updateBatchProgress: () => calls.progress++,
        showToast: m => calls.toasts.push(m), safeAlert: m => calls.toasts.push(m),
        closeSettingsPanel() {}, openSettingsPanel() {}, hideStreamPanel() {}, showStreamPanel() {}, updateStreamPanel() {}, startAutoGrading() {},
        checkConfigReady: () => ({ ready: true }), recordOutputLimitOutcome() {},
        filterUsableImagesForAI: x => ({ kept: x, removed: [] }),
        ScoreCalculator: { calculate: ({ aiScore }) => ({ finalScore: aiScore, finalUnitScores: null, bonus: 0, breakdown: {} }) },
        callAIGrading: async () => ({ score: 8, comment: 'test', studentAnswer: 'answer' }),
    };
    sb.window = sb; sb.top = sb;
    vm.createContext(sb);
    vm.runInContext(read('src/core/runtime.js'), sb);
    sb.PresetManager.data.list.test = cfg;
    return { sb, state, cfg, calls, adapter, intervals, timeouts, ids, setPaper: p => { paper = p; } };
}
function load(e, p) { vm.runInContext(read(p), e.sb, { filename: p }); }

module.exports={env,load,read,settle,ROOT,vm};
