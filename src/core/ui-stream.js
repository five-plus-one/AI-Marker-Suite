// ========== 流式面板 UI ==========

function showStreamPanel() {
    let panel = document.getElementById('ai-stream-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'ai-stream-panel';
        panel.innerHTML = `
            <style>
                #ai-stream-panel {
                    position: fixed; bottom: 100px; right: 40px; width: 340px;
                    background: rgba(255, 255, 255, 0.92);
                    backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
                    border-radius: 14px;
                    box-shadow: 0 16px 40px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.03);
                    padding: 16px 18px; z-index: 99998;
                    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", sans-serif;
                    border: 1px solid rgba(0,0,0,0.06);
                    transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
                    transform: translateY(12px); opacity: 0;
                }
                #ai-stream-panel.show { transform: translateY(0); opacity: 1; }
                #ai-stream-panel .stream-header {
                    margin: 0 0 10px 0; color: #1a1a1a; font-size: 11px; font-weight: 600;
                    display: flex; align-items: center; justify-content: space-between;
                    letter-spacing: 0.5px; text-transform: uppercase;
                }
                #ai-stream-panel .stream-header-left { display: flex; align-items: center; gap: 8px; }
                #ai-stream-panel .pulse-dot {
                    width: 6px; height: 6px; border-radius: 50%; background: #0052FF;
                    animation: pulse-dot-stream 1.5s infinite;
                }
                @keyframes pulse-dot-stream { 0%,100% { opacity: 1; box-shadow: 0 0 0 0 rgba(0,82,255,0.3); } 50% { opacity: 0.7; box-shadow: 0 0 0 4px rgba(0,82,255,0); } }
                #ai-stream-panel .copy-btn {
                    background: none; border: 1px solid rgba(0,0,0,0.08); border-radius: 6px;
                    padding: 3px 8px; font-size: 10px; color: #86868b; cursor: pointer;
                    transition: all 0.2s; text-transform: uppercase; letter-spacing: 0.3px;
                }
                #ai-stream-panel .copy-btn:hover { background: rgba(0,0,0,0.04); color: #1a1a1a; }
                #ai-stream-content {
                    font-family: "SF Mono", "JetBrains Mono", Consolas, monospace;
                    font-size: 12px; color: #4a4a4a; line-height: 1.65;
                    max-height: 220px; overflow-y: auto; white-space: pre-wrap;
                    scrollbar-width: thin;
                }
            </style>
            <div class="stream-header">
                <div class="stream-header-left"><span class="pulse-dot"></span> AI 分析流输出</div>
                <button class="copy-btn" id="stream-copy-btn">复制</button>
            </div>
            <div id="ai-stream-content">正在感知和组装上下文...</div>
        `;
        getUIRoot().appendChild(panel);

        panel.querySelector('#stream-copy-btn').onclick = () => {
            // 复制纯文本（从 textContent 取，避免复制 HTML 标签）
            const text = document.getElementById('ai-stream-content')?.textContent || '';
            navigator.clipboard.writeText(text).then(() => {
                const btn = panel.querySelector('#stream-copy-btn');
                btn.textContent = '已复制';
                setTimeout(() => btn.textContent = '复制', 1500);
            }).catch(() => {});
        };
    }
    panel.style.display = 'block';
    requestAnimationFrame(() => panel.classList.add('show'));
    panel.querySelector('#ai-stream-content').textContent = '正在感知和组装上下文...';
}

// 流式输出节流：避免每个 token 都触发完整 Markdown + KaTeX 重渲染
var _streamThrottleTimer = null;
var _streamLastRenderTime = 0;
var _streamPendingText = null;
var STREAM_THROTTLE_MS = 100;

function _doRenderStream(text) {
    var content = document.getElementById('ai-stream-content');
    if (!content) return;
    if (window.__aiMarkdownRenderer) {
        content.innerHTML = window.__aiMarkdownRenderer.render(text);
    } else {
        content.textContent = text;
    }
    content.scrollTop = content.scrollHeight;
}

function updateStreamPanel(text) {
    var now = Date.now();
    var elapsed = now - _streamLastRenderTime;

    if (elapsed >= STREAM_THROTTLE_MS) {
        // 距上次渲染已超过节流间隔，立即渲染
        _streamLastRenderTime = now;
        _streamPendingText = null;
        if (_streamThrottleTimer) { clearTimeout(_streamThrottleTimer); _streamThrottleTimer = null; }
        _doRenderStream(text);
    } else {
        // 节流期内，暂存最新文本，安排延迟渲染（确保最后一帧不丢失）
        _streamPendingText = text;
        if (!_streamThrottleTimer) {
            _streamThrottleTimer = setTimeout(function () {
                _streamThrottleTimer = null;
                _streamLastRenderTime = Date.now();
                if (_streamPendingText !== null) {
                    _doRenderStream(_streamPendingText);
                    _streamPendingText = null;
                }
            }, STREAM_THROTTLE_MS - elapsed);
        }
    }
}

function hideStreamPanel() {
    // 隐藏前刷新节流期内未渲染的最终内容
    if (_streamThrottleTimer) {
        clearTimeout(_streamThrottleTimer);
        _streamThrottleTimer = null;
    }
    if (_streamPendingText !== null) {
        _doRenderStream(_streamPendingText);
        _streamPendingText = null;
    }
    const panel = document.getElementById('ai-stream-panel');
    if (panel) {
        panel.classList.remove('show');
        setTimeout(() => panel.style.display = 'none', 300);
    }
}
