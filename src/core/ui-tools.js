// ========== 工具页面 UI ==========
// 用于 /tools 页面，提供历史记录、关于、检查更新等功能入口
// 使用标准弹窗组件，保持与阅卷平台一致的体验

function createToolsPageUI() {
    // 初始化历史管理器
    HistoryManager.init().then(() => {
        // 自动打开历史面板
        setTimeout(() => {
            showHistoryPanel();
            // 显示提示
            const container = document.getElementById('ai-tools-root');
            if (container) {
                container.innerHTML = `
                    <div style="text-align:center;padding:40px 20px;color:#86868b;">
                        <div style="font-size:48px;margin-bottom:16px;">✅</div>
                        <h2 style="font-size:18px;font-weight:600;color:#1a1a1a;margin-bottom:8px;">评阅历史已打开</h2>
                        <p style="font-size:13px;color:#aaa;margin-top:8px;">历史记录面板已在上方显示</p>
                        <div style="display:flex;gap:10px;justify-content:center;margin-top:20px;">
                            <button onclick="showHistoryPanel()" style="padding:10px 20px;background:#1a1a1a;color:white;border:none;border-radius:8px;cursor:pointer;font-size:13px;">重新打开历史</button>
                            <button onclick="checkForUpdate(true)" style="padding:10px 20px;background:white;color:#1a1a1a;border:1px solid rgba(0,0,0,0.12);border-radius:8px;cursor:pointer;font-size:13px;">检查更新</button>
                        </div>
                    </div>
                `;
            }
        }, 500);
    });
}
