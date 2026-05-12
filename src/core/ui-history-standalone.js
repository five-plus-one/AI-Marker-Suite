// ========== 独立历史查看页面UI ==========
// 用于文档站 (aimarking.five-plus-one.com/history) 的历史记录查看
// 只读模式：支持查看详情、导出，不支持批改操作

function createStandaloneHistoryUI() {
    // 注入样式 - 使用 VitePress CSS 变量适配深浅色主题
    const style = document.createElement('style');
    style.textContent = `
        #ai-history-standalone {
            font-family: var(--vp-font-family-base, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", sans-serif);
            max-width: 960px;
            margin: 0 auto;
            padding: 24px;
            color: var(--vp-c-text-1, #1a1a1a);
        }

        .aihs-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--vp-c-divider, rgba(0,0,0,0.08));
        }

        .aihs-header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 700;
            color: var(--vp-c-text-1, #1a1a1a);
        }

        .aihs-header .version-badge {
            font-size: 12px;
            color: var(--vp-c-text-2, #86868b);
            background: var(--vp-c-bg-soft, rgba(0,0,0,0.04));
            padding: 4px 10px;
            border-radius: 12px;
        }

        .aihs-tabs {
            display: flex;
            gap: 0;
            margin-bottom: 20px;
            border-bottom: 1px solid var(--vp-c-divider, rgba(0,0,0,0.08));
        }

        .aihs-tab {
            padding: 12px 24px;
            font-size: 14px;
            font-weight: 500;
            color: var(--vp-c-text-2, #86868b);
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
        }

        .aihs-tab:hover {
            color: var(--vp-c-text-1, #1a1a1a);
        }

        .aihs-tab.active {
            color: var(--vp-c-text-1, #1a1a1a);
            border-bottom-color: var(--vp-c-brand, #1a1a1a);
        }

        .aihs-content {
            display: none;
        }

        .aihs-content.active {
            display: block;
        }

        /* 存储状态栏 */
        .aihs-storage {
            display: flex;
            gap: 12px;
            margin-bottom: 16px;
            padding: 12px 16px;
            background: var(--vp-c-bg-soft, rgba(0,0,0,0.02));
            border-radius: 10px;
            border: 1px solid var(--vp-c-divider, rgba(0,0,0,0.06));
            flex-wrap: wrap;
        }

        .aihs-storage-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
        }

        .aihs-storage-item .label {
            color: var(--vp-c-text-2, #86868b);
        }

        .aihs-storage-item .value {
            font-weight: 600;
            color: var(--vp-c-text-1, #1a1a1a);
        }

        /* 工具栏 */
        .aihs-toolbar {
            display: flex;
            gap: 8px;
            margin-bottom: 16px;
            flex-wrap: wrap;
        }

        .aihs-btn {
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 500;
            border: 1px solid var(--vp-c-border, rgba(0,0,0,0.12));
            border-radius: 8px;
            background: var(--vp-c-bg, white);
            color: var(--vp-c-text-1, #1a1a1a);
            cursor: pointer;
            transition: all 0.2s;
        }

        .aihs-btn:hover {
            background: var(--vp-c-bg-soft, rgba(0,0,0,0.04));
            border-color: var(--vp-c-border-active, rgba(0,0,0,0.2));
        }

        .aihs-btn.primary {
            background: var(--vp-c-brand, #1a1a1a);
            color: var(--vp-c-white, white);
            border-color: var(--vp-c-brand, #1a1a1a);
        }

        .aihs-btn.primary:hover {
            opacity: 0.9;
        }

        /* 记录列表 */
        .aihs-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .aihs-item {
            padding: 16px;
            border: 1px solid var(--vp-c-divider, rgba(0,0,0,0.08));
            border-radius: 12px;
            transition: all 0.2s;
            background: var(--vp-c-bg, white);
        }

        .aihs-item:hover {
            border-color: var(--vp-c-border-active, rgba(0,0,0,0.15));
            box-shadow: 0 2px 12px rgba(0,0,0,0.06);
        }

        .aihs-item-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }

        .aihs-item-time {
            font-size: 12px;
            color: var(--vp-c-text-2, #86868b);
        }

        .aihs-item-score {
            font-size: 18px;
            font-weight: 700;
            color: var(--vp-c-text-1, #1a1a1a);
        }

        .aihs-item-meta {
            font-size: 12px;
            color: var(--vp-c-text-2, #86868b);
            margin-bottom: 8px;
        }

        .aihs-item-answer {
            font-size: 13px;
            color: var(--vp-c-text-2, #4a4a4a);
            line-height: 1.5;
            margin-bottom: 12px;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .aihs-item-actions {
            display: flex;
            gap: 8px;
        }

        .aihs-item-btn {
            padding: 6px 12px;
            font-size: 12px;
            font-weight: 500;
            border: 1px solid var(--vp-c-divider, rgba(0,0,0,0.1));
            border-radius: 6px;
            background: transparent;
            color: var(--vp-c-text-2, #666);
            cursor: pointer;
            transition: all 0.2s;
        }

        .aihs-item-btn:hover {
            background: var(--vp-c-bg-soft, rgba(0,0,0,0.04));
            color: var(--vp-c-text-1, #1a1a1a);
        }

        /* 空状态 */
        .aihs-empty {
            text-align: center;
            padding: 60px 20px;
            color: var(--vp-c-text-2, #86868b);
        }

        .aihs-empty .icon {
            font-size: 48px;
            margin-bottom: 16px;
        }

        /* 关于页面 */
        .aihs-about {
            max-width: 600px;
        }

        .aihs-about-section {
            margin-bottom: 24px;
        }

        .aihs-about-title {
            font-size: 12px;
            font-weight: 700;
            color: var(--vp-c-text-2, #86868b);
            text-transform: uppercase;
            letter-spacing: 0.8px;
            margin-bottom: 12px;
        }

        .aihs-about-card {
            padding: 16px;
            background: var(--vp-c-bg-soft, rgba(0,0,0,0.02));
            border: 1px solid var(--vp-c-divider, rgba(0,0,0,0.06));
            border-radius: 10px;
        }

        .aihs-about-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid var(--vp-c-divider, rgba(0,0,0,0.04));
        }

        .aihs-about-row:last-child {
            border-bottom: none;
        }

        .aihs-about-label {
            font-size: 13px;
            color: var(--vp-c-text-2, #86868b);
        }

        .aihs-about-value {
            font-size: 13px;
            font-weight: 500;
            color: var(--vp-c-text-1, #1a1a1a);
        }

        .aihs-about-value a {
            color: var(--vp-c-brand, #0052FF);
            text-decoration: none;
        }

        .aihs-about-value a:hover {
            text-decoration: underline;
        }

        .aihs-changelog {
            max-height: 400px;
            overflow-y: auto;
        }

        .aihs-changelog-version {
            margin-bottom: 16px;
        }

        .aihs-changelog-version h4 {
            font-size: 14px;
            font-weight: 600;
            margin: 0 0 8px;
            color: var(--vp-c-text-1, #1a1a1a);
        }

        .aihs-changelog-version ul {
            margin: 0;
            padding-left: 20px;
            font-size: 13px;
            color: var(--vp-c-text-2, #4a4a4a);
            line-height: 1.6;
        }
    `;
    document.head.appendChild(style);

    // 创建主容器
    const container = document.createElement('div');
    container.id = 'ai-history-standalone';
    container.innerHTML = `
        <div class="aihs-header">
            <h1>AI 批改助手</h1>
            <span class="version-badge">v${SCRIPT_CONFIG.VERSION}</span>
        </div>

        <div class="aihs-tabs">
            <div class="aihs-tab active" data-tab="history">评阅历史</div>
            <div class="aihs-tab" data-tab="about">关于</div>
        </div>

        <div class="aihs-content active" id="aihs-tab-history">
            <div class="aihs-storage" id="aihs-storage">
                <div class="aihs-storage-item">
                    <span class="label">记录</span>
                    <span class="value" id="aihs-count">--</span>
                </div>
                <div class="aihs-storage-item">
                    <span class="label">存储</span>
                    <span class="value" id="aihs-size">--</span>
                </div>
            </div>

            <div class="aihs-toolbar">
                <button class="aihs-btn" id="aihs-export-csv">导出 CSV</button>
                <button class="aihs-btn" id="aihs-export-json">导出 JSON</button>
                <button class="aihs-btn" id="aihs-export-html">导出 HTML</button>
                <button class="aihs-btn" id="aihs-refresh">刷新</button>
            </div>

            <div class="aihs-list" id="aihs-list"></div>
        </div>

        <div class="aihs-content" id="aihs-tab-about">
            <div class="aihs-about">
                <div class="aihs-about-section">
                    <div class="aihs-about-title">基本信息</div>
                    <div class="aihs-about-card">
                        <div class="aihs-about-row">
                            <span class="aihs-about-label">脚本版本</span>
                            <span class="aihs-about-value">v${SCRIPT_CONFIG.VERSION}</span>
                        </div>
                        <div class="aihs-about-row">
                            <span class="aihs-about-label">支持平台</span>
                            <span class="aihs-about-value">智学网、七天网络、好分数、五岳阅卷、华翰云、光大阅卷</span>
                        </div>
                        <div class="aihs-about-row">
                            <span class="aihs-about-label">开源协议</span>
                            <span class="aihs-about-value">GPL-3.0</span>
                        </div>
                    </div>
                </div>

                <div class="aihs-about-section">
                    <div class="aihs-about-title">链接</div>
                    <div class="aihs-about-card">
                        <div class="aihs-about-row">
                            <span class="aihs-about-label">帮助文档</span>
                            <span class="aihs-about-value"><a href="https://aimarking.five-plus-one.com/" target="_blank">aimarking.five-plus-one.com</a></span>
                        </div>
                        <div class="aihs-about-row">
                            <span class="aihs-about-label">GitHub</span>
                            <span class="aihs-about-value"><a href="https://github.com/five-plus-one/AI-Marker-Suite" target="_blank">AI-Marker-Suite</a></span>
                        </div>
                        <div class="aihs-about-row">
                            <span class="aihs-about-label">联系作者</span>
                            <span class="aihs-about-value"><a href="https://r-l.ink/contact" target="_blank">r-l.ink/contact</a></span>
                        </div>
                    </div>
                </div>

                <div class="aihs-about-section">
                    <div class="aihs-about-title">更新日志</div>
                    <div class="aihs-changelog" id="aihs-changelog"></div>
                </div>
            </div>
        </div>
    `;

    // 插入到页面
    const target = document.getElementById('ai-history-root') || document.querySelector('.theme-doc-markdown') || document.body;
    target.innerHTML = '';
    target.appendChild(container);

    // 绑定标签页切换
    container.querySelectorAll('.aihs-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            container.querySelectorAll('.aihs-tab').forEach(t => t.classList.remove('active'));
            container.querySelectorAll('.aihs-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`aihs-tab-${tab.dataset.tab}`).classList.add('active');
        });
    });

    // 加载历史记录
    renderHistoryList();

    // 加载更新日志
    renderChangelog();

    // 绑定按钮事件
    document.getElementById('aihs-export-csv').onclick = () => HistoryManager.exportCSV();
    document.getElementById('aihs-export-json').onclick = () => HistoryManager.exportJSON();
    document.getElementById('aihs-export-html').onclick = () => HistoryManager.exportHTML();
    document.getElementById('aihs-refresh').onclick = () => renderHistoryList();
}

function renderHistoryList() {
    const records = HistoryManager.records || [];
    const list = document.getElementById('aihs-list');
    const count = document.getElementById('aihs-count');
    const size = document.getElementById('aihs-size');

    if (!list) return;

    count.textContent = `${records.length} 条`;
    size.textContent = `${(JSON.stringify(records).length / 1024).toFixed(1)} KB`;

    if (records.length === 0) {
        list.innerHTML = `
            <div class="aihs-empty">
                <div class="icon">📝</div>
                <p>暂无评阅记录</p>
                <p style="font-size:13px;color:var(--vp-c-text-3, #aaa);margin-top:8px;">在阅卷平台使用 AI 批改助手后，记录将显示在这里</p>
            </div>
        `;
        return;
    }

    list.innerHTML = records.map(record => {
        const time = new Date(record.timestamp).toLocaleString('zh-CN');
        const mode = { normal: '普通', unattended: '无人', trial: '试改' }[record.gradingMode] || record.gradingMode;
        const scoreDisplay = record.isCorrected
            ? `<span>${record.aiScore}</span> → <span style="color:var(--vp-c-brand, #0052FF);">${record.finalScore} ✓</span>`
            : `<span>${record.finalScore}</span>`;

        return `
            <div class="aihs-item" data-id="${record.id}">
                <div class="aihs-item-header">
                    <span class="aihs-item-time">${time}</span>
                    <span class="aihs-item-score">${scoreDisplay}分</span>
                </div>
                <div class="aihs-item-meta">${record.presetName || '默认配置'} · ${mode}模式</div>
                <div class="aihs-item-answer">${record.studentAnswer || '未能识别'}</div>
                <div class="aihs-item-actions">
                    <button class="aihs-item-btn" onclick="showHistoryDetail('${record.id}')">查看详情</button>
                </div>
            </div>
        `;
    }).join('');
}

function showHistoryDetail(id) {
    const record = HistoryManager.getById(id);
    if (!record) return;

    const time = new Date(record.timestamp).toLocaleString('zh-CN');
    const mode = { normal: '普通', unattended: '无人', trial: '试改' }[record.gradingMode] || record.gradingMode;

    // 创建详情弹窗
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:100000;display:flex;justify-content:center;align-items:center;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    overlay.innerHTML = `
        <div style="background:var(--vp-c-bg, white);border-radius:16px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <h3 style="margin:0;font-size:18px;color:var(--vp-c-text-1, #1a1a1a);">评阅详情</h3>
                <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--vp-c-text-2, #666);">×</button>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
                <div>
                    <div style="font-size:11px;color:var(--vp-c-text-2, #86868b);text-transform:uppercase;margin-bottom:4px;">时间</div>
                    <div style="font-size:13px;color:var(--vp-c-text-1, #1a1a1a);">${time}</div>
                </div>
                <div>
                    <div style="font-size:11px;color:var(--vp-c-text-2, #86868b);text-transform:uppercase;margin-bottom:4px;">方案 / 模式</div>
                    <div style="font-size:13px;color:var(--vp-c-text-1, #1a1a1a);">${record.presetName || '默认配置'} · ${mode}</div>
                </div>
                <div>
                    <div style="font-size:11px;color:var(--vp-c-text-2, #86868b);text-transform:uppercase;margin-bottom:4px;">AI评分</div>
                    <div style="font-size:24px;font-weight:700;color:var(--vp-c-text-1, #1a1a1a);">${record.aiScore}</div>
                </div>
                <div>
                    <div style="font-size:11px;color:var(--vp-c-text-2, #86868b);text-transform:uppercase;margin-bottom:4px;">最终分数</div>
                    <div style="font-size:24px;font-weight:700;color:${record.isCorrected ? 'var(--vp-c-brand, #0052FF)' : 'var(--vp-c-text-1, #1a1a1a)'};">${record.finalScore}${record.isCorrected ? ' ✓' : ''}</div>
                </div>
            </div>

            ${record.isCorrected ? `
                <div style="background:var(--vp-c-bg-soft, rgba(0,82,255,0.04));border-left:3px solid var(--vp-c-brand, #0052FF);padding:12px;border-radius:0 8px 8px 0;margin-bottom:16px;font-size:13px;color:var(--vp-c-brand, #0052FF);">
                    纠错理由：${record.correctionReason || '无'}
                </div>
            ` : ''}

            <div style="margin-bottom:16px;">
                <div style="font-size:11px;color:var(--vp-c-text-2, #86868b);text-transform:uppercase;margin-bottom:6px;">识别答案</div>
                <div style="font-size:13px;color:var(--vp-c-text-2, #4a4a4a);line-height:1.6;background:var(--vp-c-bg-soft, rgba(0,0,0,0.02));padding:12px;border-radius:8px;white-space:pre-wrap;">${record.studentAnswer || '未能识别'}</div>
            </div>

            <div>
                <div style="font-size:11px;color:var(--vp-c-text-2, #86868b);text-transform:uppercase;margin-bottom:6px;">AI评语</div>
                <div style="font-size:13px;color:var(--vp-c-text-2, #4a4a4a);line-height:1.6;background:var(--vp-c-bg-soft, rgba(0,0,0,0.02));padding:12px;border-radius:8px;white-space:pre-wrap;">${record.aiComment || '无'}</div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
}

function renderChangelog() {
    const container = document.getElementById('aihs-changelog');
    if (!container) return;

    const changelog = SCRIPT_CONFIG.CHANGELOG || {};
    const versions = Object.keys(changelog).sort((a, b) => b.localeCompare(a));

    if (versions.length === 0) {
        container.innerHTML = '<div style="color:var(--vp-c-text-2, #86868b);font-size:13px;">暂无更新日志</div>';
        return;
    }

    container.innerHTML = versions.slice(0, 10).map(version => `
        <div class="aihs-changelog-version">
            <h4>v${version}</h4>
            <ul>
                ${changelog[version].map(item => `<li>${item}</li>`).join('')}
            </ul>
        </div>
    `).join('');
}
