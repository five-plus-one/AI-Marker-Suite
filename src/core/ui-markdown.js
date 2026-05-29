/**
 * ui-markdown.js — Markdown 渲染器 + 全屏编辑器 + AI 识别
 *
 * 依赖：marked.js, katex.js (已在构建时内联)
 * 依赖：ui-toast.js (showToast)
 * 依赖：ai-engine.js (callAI)
 * 依赖：prompt.js (buildRecognitionPrompt — 将在 prompt.js 中新增)
 */

// ========== 全局状态 ==========
window.__aiMarkdownData = window.__aiMarkdownData || {};
window.__aiMarkdownRenderer = null; // 供 ui-stream.js 使用

// ========== MarkdownRenderer ==========

/**
 * 将 ai-img://N 协议的图片引用替换为 data URI
 * @param {string} md - Markdown 文本
 * @param {string[]} images - base64 图片数组
 * @returns {string} 替换后的 Markdown
 */
function resolveMarkdownImages(md, images) {
    if (!images || !images.length) return md;
    return md.replace(/!\[([^\]]*)\]\(ai-img:\/\/(\d+)\)/g, function (match, alt, idx) {
        var i = parseInt(idx, 10);
        if (i >= 0 && i < images.length && images[i]) {
            return '![' + alt + '](data:image/png;base64,' + images[i] + ')';
        }
        return match;
    });
}

/**
 * 创建 Markdown 渲染器（marked + KaTeX）
 */
function createMarkdownRenderer() {
    if (!window.marked) {
        console.warn('[AI-Marker] marked.js 未加载，Markdown 渲染不可用');
        return null;
    }

    // KaTeX 渲染缓存：避免相同公式重复渲染（流式输出时尤为关键）
    const latexCache = new Map();
    const KATEX_CACHE_MAX = 500;
    function cachedKatexRender(text, options) {
        var key = (options.displayMode ? 'D' : 'I') + ':' + text;
        var cached = latexCache.get(key);
        if (cached !== undefined) return cached;
        var html = katex.renderToString(text, options);
        // 简易 LRU：缓存满时清空（避免内存无限增长）
        if (latexCache.size >= KATEX_CACHE_MAX) latexCache.clear();
        latexCache.set(key, html);
        return html;
    }

    // 自定义扩展：块级公式 $$...$$
    const latexBlockExt = {
        name: 'latexBlock',
        level: 'block',
        start(src) { return src.indexOf('$$'); },
        tokenizer(src) {
            var match = src.match(/^\$\$([\s\S]+?)\$\$/);
            if (match) {
                return { type: 'latexBlock', raw: match[0], text: match[1].trim() };
            }
        },
        renderer(token) {
            try {
                if (window.katex) {
                    return '<div class="katex-display">' +
                        cachedKatexRender(token.text, { displayMode: true, throwOnError: false, trust: true, strict: false }) +
                        '</div>';
                }
            } catch (e) { /* fallback */ }
            return '<pre class="katex-fallback"><code>' + escapeHtml(token.text) + '</code></pre>';
        },
    };

    // 自定义扩展：行内公式 $...$
    const latexInlineExt = {
        name: 'latexInline',
        level: 'inline',
        start(src) { return src.indexOf('$'); },
        tokenizer(src) {
            var match = src.match(/^\$([^\$\n]+?)\$/);
            if (match) {
                return { type: 'latexInline', raw: match[0], text: match[1].trim() };
            }
        },
        renderer(token) {
            try {
                if (window.katex) {
                    return cachedKatexRender(token.text, { displayMode: false, throwOnError: false, trust: true, strict: false });
                }
            } catch (e) { /* fallback */ }
            return '<code class="katex-fallback">' + escapeHtml(token.text) + '</code>';
        },
    };

    // 配置 marked（renderer 定义在扩展内部，不传给构造函数）
    var markedInstance = new marked.Marked({
        extensions: [latexBlockExt, latexInlineExt],
        breaks: true,
        gfm: true,
    });

    return {
        /**
         * 渲染 Markdown 文本为 HTML
         * @param {string} text - Markdown 文本（已解析 ai-img:// 引用）
         * @returns {string} HTML 字符串
         */
        render: function (text) {
            if (!text) return '';
            try {
                return markedInstance.parse(text);
            } catch (e) {
                console.error('[AI-Marker] Markdown 渲染错误:', e);
                return '<pre>' + escapeHtml(text) + '</pre>';
            }
        },

        /**
         * 渲染包含图片引用的 Markdown
         * @param {string} text - Markdown 文本（含 ai-img:// 引用）
         * @param {string[]} images - base64 图片数组
         * @returns {string} HTML 字符串
         */
        renderWithImages: function (text, images) {
            const resolved = resolveMarkdownImages(text, images || []);
            return this.render(resolved);
        },
    };
}

/**
 * HTML 转义
 */
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// 初始化渲染器
function initMarkdownRenderer() {
    window.__aiMarkdownRenderer = createMarkdownRenderer();
}

// ========== MarkdownEditor（全屏编辑器） ==========

/**
 * 打开全屏 Markdown 编辑器
 * @param {object} options
 * @param {string} options.field - 字段名 (question / answer / rubric)
 * @param {string} options.label - 显示标签
 * @param {string} options.initialText - 初始 Markdown 文本
 * @param {string[]} options.initialImages - 初始图片数组 (base64)
 * @param {function} options.onConfirm - 确认回调 (text, images) => void
 * @param {function} [options.onCancel] - 取消回调
 * @param {object} [options.callConfig] - AI 调用配置（用于 AI 识别）
 */
function openMarkdownEditor(options) {
    const { field, label, initialText, initialImages, onConfirm, onCancel, callConfig } = options;
    const images = (initialImages || []).slice(); // 复制一份，避免修改原数组

    // 清理之前的编辑器
    closeMarkdownEditor();

    // 创建遮罩
    const overlay = document.createElement('div');
    overlay.id = 'ai-md-editor-overlay';
    overlay.setAttribute('data-vendor', 'ai-marker');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:2147483647;display:flex;align-items:center;justify-content:center;';
    overlay.style.setProperty('z-index', '2147483647', 'important');

    // 主容器
    const container = document.createElement('div');
    container.id = 'ai-md-editor';
    container.setAttribute('data-vendor', 'ai-marker');

    // 标题栏
    const header = document.createElement('div');
    header.className = 'md-editor-header';
    header.innerHTML =
        '<span class="md-editor-title">编辑: ' + escapeHtml(label) + '</span>' +
        '<button class="md-editor-close" title="关闭">&times;</button>';

    // 工具栏
    const toolbar = document.createElement('div');
    toolbar.className = 'md-editor-toolbar';
    toolbar.innerHTML =
        '<button data-cmd="bold" title="加粗 (Ctrl+B)"><b>B</b></button>' +
        '<button data-cmd="italic" title="斜体 (Ctrl+I)"><i>I</i></button>' +
        '<button data-cmd="heading" title="标题">H</button>' +
        '<button data-cmd="list" title="列表">☰</button>' +
        '<button data-cmd="code" title="代码">&lt;/&gt;</button>' +
        '<span class="md-toolbar-sep"></span>' +
        '<button data-cmd="mathInline" title="行内公式 $...$">𝑥</button>' +
        '<button data-cmd="mathBlock" title="公式块 $$...$$">∑</button>' +
        '<span class="md-toolbar-sep"></span>' +
        '<button data-cmd="image" title="插入图片">🖼</button>' +
        '<span class="md-toolbar-sep"></span>' +
        '<button data-cmd="aiPolish" title="AI润色：将自然语言转换为标准Markdown/LaTeX">🪄AI润色</button>' +
        '<button data-cmd="aiRecognize" title="AI识别图片转Markdown">✨AI识别</button>';

    // 内容区（左编辑 + 右预览）
    const body = document.createElement('div');
    body.className = 'md-editor-body';

    // 左侧：编辑区
    const editPanel = document.createElement('div');
    editPanel.className = 'md-editor-edit';

    const textarea = document.createElement('textarea');
    textarea.className = 'md-editor-textarea';
    textarea.value = initialText || '';
    textarea.placeholder = '在此输入 Markdown 内容...\n\n支持语法：\n- **加粗** / *斜体*\n- # 标题\n- - 列表\n- $行内公式$ / $$公式块$$\n- Ctrl+V 粘贴图片';

    editPanel.appendChild(textarea);

    // 右侧：预览区
    const previewPanel = document.createElement('div');
    previewPanel.className = 'md-editor-preview';
    previewPanel.innerHTML = '<div class="md-preview-inner"></div>';

    body.appendChild(editPanel);
    body.appendChild(previewPanel);

    // 底部按钮
    const footer = document.createElement('div');
    footer.className = 'md-editor-footer';
    footer.innerHTML =
        '<span class="md-image-count"></span>' +
        '<div class="md-editor-actions">' +
        '<button class="md-btn md-btn-cancel">取消</button>' +
        '<button class="md-btn md-btn-confirm">确认</button>' +
        '</div>';

    // 组装
    container.appendChild(header);
    container.appendChild(toolbar);
    container.appendChild(body);
    container.appendChild(footer);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    // 隐藏的文件输入
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    fileInput.id = 'md-image-input';
    container.appendChild(fileInput);

    // ========== 事件绑定 ==========

    // 关闭
    header.querySelector('.md-editor-close').onclick = function () {
        if (onCancel) onCancel();
        closeMarkdownEditor();
    };
    footer.querySelector('.md-btn-cancel').onclick = function () {
        if (onCancel) onCancel();
        closeMarkdownEditor();
    };

    // 确认
    footer.querySelector('.md-btn-confirm').onclick = function () {
        if (onConfirm) onConfirm(textarea.value, images);
        closeMarkdownEditor();
    };

    // 实时预览（防抖）
    let previewTimer = null;
    function schedulePreview() {
        if (previewTimer) clearTimeout(previewTimer);
        previewTimer = setTimeout(function () {
            renderPreview();
        }, 150);
    }

    function renderPreview() {
        const inner = previewPanel.querySelector('.md-preview-inner');
        if (window.__aiMarkdownRenderer) {
            inner.innerHTML = window.__aiMarkdownRenderer.renderWithImages(textarea.value, images);
        } else {
            inner.textContent = textarea.value;
        }
        updateImageCount();
    }

    function updateImageCount() {
        const countEl = footer.querySelector('.md-image-count');
        if (images.length > 0) {
            countEl.textContent = '已附加 ' + images.length + ' 张图片';
        } else {
            countEl.textContent = '';
        }
    }

    textarea.addEventListener('input', schedulePreview);

    // 初始渲染
    renderPreview();

    // 工具栏按钮
    toolbar.addEventListener('click', function (e) {
        const btn = e.target.closest('button[data-cmd]');
        if (!btn) return;
        const cmd = btn.getAttribute('data-cmd');
        handleToolbarCommand(cmd, textarea, images, fileInput, callConfig, schedulePreview);
    });

    // 快捷键
    textarea.addEventListener('keydown', function (e) {
        // 阻止 Enter 键冒泡到宿主平台的全局监听器（避免触发表单提交）
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            e.stopPropagation();
        }
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'b') { e.preventDefault(); insertMarkdownSyntax(textarea, 'bold'); schedulePreview(); }
            if (e.key === 'i') { e.preventDefault(); insertMarkdownSyntax(textarea, 'italic'); schedulePreview(); }
            if (e.key === 'Enter') { e.preventDefault(); footer.querySelector('.md-btn-confirm').click(); }
        }
        // Tab 插入空格
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 2;
            schedulePreview();
        }
    });

    // 粘贴图片
    textarea.addEventListener('paste', function (e) {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                const file = items[i].getAsFile();
                addImageFromFile(file, textarea, images, schedulePreview);
                return;
            }
        }
    });

    // 拖拽图片
    textarea.addEventListener('dragover', function (e) { e.preventDefault(); });
    textarea.addEventListener('drop', function (e) {
        e.preventDefault();
        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files) return;
        for (let i = 0; i < files.length; i++) {
            if (files[i].type.indexOf('image') !== -1) {
                addImageFromFile(files[i], textarea, images, schedulePreview);
            }
        }
    });

    // 文件选择
    fileInput.addEventListener('change', function () {
        const files = fileInput.files;
        for (let i = 0; i < files.length; i++) {
            addImageFromFile(files[i], textarea, images, schedulePreview);
        }
        fileInput.value = '';
    });

    // 阻止背景滚动
    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
            // 点击遮罩不关闭（防止误操作）
        }
    });

    // 聚焦 textarea
    setTimeout(function () { textarea.focus(); }, 100);
}

/**
 * 关闭编辑器
 */
function closeMarkdownEditor() {
    var overlay = document.getElementById('ai-md-editor-overlay');
    if (overlay) overlay.remove();
}

// ========== 工具栏命令 ==========

function handleToolbarCommand(cmd, textarea, images, fileInput, callConfig, schedulePreview) {
    switch (cmd) {
        case 'bold':
            insertMarkdownSyntax(textarea, 'bold');
            schedulePreview();
            break;
        case 'italic':
            insertMarkdownSyntax(textarea, 'italic');
            schedulePreview();
            break;
        case 'heading':
            insertMarkdownSyntax(textarea, 'heading');
            schedulePreview();
            break;
        case 'list':
            insertMarkdownSyntax(textarea, 'list');
            schedulePreview();
            break;
        case 'code':
            insertMarkdownSyntax(textarea, 'code');
            schedulePreview();
            break;
        case 'mathInline':
            insertMarkdownSyntax(textarea, 'mathInline');
            schedulePreview();
            break;
        case 'mathBlock':
            insertMarkdownSyntax(textarea, 'mathBlock');
            schedulePreview();
            break;
        case 'image':
            fileInput.click();
            break;
        case 'aiRecognize':
            startAIRecognition(textarea, images, callConfig, schedulePreview);
            break;
        case 'aiPolish':
            startAIPolish(textarea, callConfig, schedulePreview);
            break;
    }
}

/**
 * 在 textarea 光标位置插入 Markdown 语法
 */
function insertMarkdownSyntax(textarea, type) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end);
    let before = '', after = '', replacement = '';

    switch (type) {
        case 'bold':
            before = '**'; after = '**';
            replacement = selected || '粗体文字';
            break;
        case 'italic':
            before = '*'; after = '*';
            replacement = selected || '斜体文字';
            break;
        case 'heading':
            before = '\n## '; after = '';
            replacement = selected || '标题';
            break;
        case 'list':
            before = '\n- '; after = '';
            replacement = selected || '列表项';
            break;
        case 'code':
            if (selected.indexOf('\n') !== -1) {
                before = '\n```\n'; after = '\n```\n';
            } else {
                before = '`'; after = '`';
            }
            replacement = selected || '代码';
            break;
        case 'mathInline':
            before = '$'; after = '$';
            replacement = selected || 'x^2';
            break;
        case 'mathBlock':
            before = '\n$$\n'; after = '\n$$\n';
            replacement = selected || 'E = mc^2';
            break;
    }

    const newText = before + replacement + after;
    textarea.value = textarea.value.substring(0, start) + newText + textarea.value.substring(end);
    // 将光标放在插入内容中间
    const cursorPos = start + before.length + replacement.length;
    textarea.selectionStart = start + before.length;
    textarea.selectionEnd = cursorPos;
    textarea.focus();
}

// ========== 图片裁切 ==========

/**
 * 显示图片裁切模态框
 * @param {string} base64 - 原始图片 base64
 * @param {function} callback - 裁切完成回调 (croppedBase64) => void
 */
function showCropModal(base64, callback) {
    // 清理之前的裁切框
    var old = document.getElementById('ai-crop-overlay');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'ai-crop-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:2147483647;display:flex;align-items:center;justify-content:center;';

    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:90vw;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;font-family:-apple-system,SF Pro Display,Helvetica Neue,sans-serif;';

    // 标题
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(0,0,0,0.08);';
    header.innerHTML = '<span style="font-size:15px;font-weight:600;color:#1a1a1a;">裁切图片</span><button id="ai-crop-close" style="width:28px;height:28px;border:none;background:rgba(0,0,0,0.05);border-radius:50%;font-size:18px;cursor:pointer;color:#666;display:flex;align-items:center;justify-content:center;">&times;</button>';

    // Canvas 容器
    var canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'flex:1;overflow:auto;padding:16px;display:flex;align-items:center;justify-content:center;min-height:300px;';

    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'max-width:100%;max-height:60vh;cursor:crosshair;display:block;';
    canvasWrap.appendChild(canvas);

    // 提示
    var hint = document.createElement('div');
    hint.style.cssText = 'text-align:center;font-size:12px;color:#888;padding:0 16px 4px;';
    hint.textContent = '拖拽鼠标选择裁切区域，或直接点击「使用原图」';

    // 底部按钮
    var footer = document.createElement('div');
    footer.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:10px 16px;border-top:1px solid rgba(0,0,0,0.08);';
    footer.innerHTML = '<button id="ai-crop-skip" style="padding:7px 20px;border-radius:8px;border:none;font-size:13px;font-weight:500;cursor:pointer;background:rgba(0,0,0,0.05);color:#666;">使用原图</button><button id="ai-crop-confirm" style="padding:7px 20px;border-radius:8px;border:none;font-size:13px;font-weight:500;cursor:pointer;background:#007aff;color:#fff;">确认裁切</button>';

    card.appendChild(header);
    card.appendChild(canvasWrap);
    card.appendChild(hint);
    card.appendChild(footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // 加载图片
    var img = new Image();
    img.onload = function () {
        var ctx = canvas.getContext('2d');
        // 限制显示尺寸
        var maxW = Math.min(window.innerWidth * 0.7, 800);
        var maxH = Math.min(window.innerHeight * 0.6, 600);
        var scale = Math.min(maxW / img.width, maxH / img.height, 1);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // 拖拽选区
        var dragging = false;
        var startX = 0, startY = 0, endX = 0, endY = 0;
        var selRect = null;

        function drawWithSelection() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            if (selRect) {
                // 半透明遮罩
                ctx.fillStyle = 'rgba(0,0,0,0.4)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                // 清除选区内的遮罩
                ctx.save();
                ctx.beginPath();
                ctx.rect(selRect.x, selRect.y, selRect.w, selRect.h);
                ctx.clip();
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                ctx.restore();
                // 选区边框
                ctx.strokeStyle = '#007aff';
                ctx.lineWidth = 2;
                ctx.strokeRect(selRect.x, selRect.y, selRect.w, selRect.h);
            }
        }

        function getCanvasPos(e) {
            var rect = canvas.getBoundingClientRect();
            return {
                x: (e.clientX - rect.left) * (canvas.width / rect.width),
                y: (e.clientY - rect.top) * (canvas.height / rect.height)
            };
        }

        canvas.addEventListener('mousedown', function (e) {
            dragging = true;
            var pos = getCanvasPos(e);
            startX = pos.x; startY = pos.y;
            endX = pos.x; endY = pos.y;
            selRect = null;
        });

        canvas.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            var pos = getCanvasPos(e);
            endX = pos.x; endY = pos.y;
            var x = Math.min(startX, endX);
            var y = Math.min(startY, endY);
            var w = Math.abs(endX - startX);
            var h = Math.abs(endY - startY);
            if (w > 5 && h > 5) {
                selRect = { x: x, y: y, w: w, h: h };
            }
            drawWithSelection();
        });

        canvas.addEventListener('mouseup', function () {
            dragging = false;
        });

        // 关闭
        function close() { overlay.remove(); }
        header.querySelector('#ai-crop-close').onclick = close;

        // 使用原图
        footer.querySelector('#ai-crop-skip').onclick = function () {
            close();
            callback(base64);
        };

        // 确认裁切
        footer.querySelector('#ai-crop-confirm').onclick = function () {
            if (!selRect) {
                close();
                callback(base64);
                return;
            }
            // 裁切：将选区坐标转换回原始图片尺寸
            var sx = selRect.x / scale;
            var sy = selRect.y / scale;
            var sw = selRect.w / scale;
            var sh = selRect.h / scale;

            var cropCanvas = document.createElement('canvas');
            cropCanvas.width = sw;
            cropCanvas.height = sh;
            var cropCtx = cropCanvas.getContext('2d');
            cropCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

            var croppedDataUrl = cropCanvas.toDataURL('image/png');
            var croppedBase64 = croppedDataUrl.split(',')[1] || croppedDataUrl;
            close();
            callback(croppedBase64);
        };
    };
    img.src = 'data:image/png;base64,' + base64;
}

/**
 * 从文件添加图片到编辑器（先弹裁切框）
 */
function addImageFromFile(file, textarea, images, schedulePreview) {
    if (!file || file.type.indexOf('image') === -1) return;

    var processFn = file.size > 2 * 1024 * 1024
        ? function (cb) { compressImage(file, 1200, cb); }
        : function (cb) { fileToBase64(file, cb); };

    processFn(function (base64) {
        showCropModal(base64, function (croppedBase64) {
            insertImageRef(croppedBase64, textarea, images, schedulePreview);
        });
    });
}

/**
 * File 转 base64
 */
function fileToBase64(file, callback) {
    var reader = new FileReader();
    reader.onload = function (e) {
        // 去掉 data:image/xxx;base64, 前缀，只保留纯 base64
        var result = e.target.result;
        var base64 = result.indexOf(',') !== -1 ? result.split(',')[1] : result;
        callback(base64);
    };
    reader.readAsDataURL(file);
}

/**
 * 压缩图片
 */
function compressImage(file, maxWidth, callback) {
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
        URL.revokeObjectURL(url);
        var canvas = document.createElement('canvas');
        var w = img.width;
        var h = img.height;
        if (w > maxWidth) {
            h = Math.round(h * maxWidth / w);
            w = maxWidth;
        }
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        var base64 = dataUrl.indexOf(',') !== -1 ? dataUrl.split(',')[1] : dataUrl;
        callback(base64);
    };
    img.src = url;
}

/**
 * 将图片 base64 插入到 images 数组并在 textarea 中插入引用
 */
function insertImageRef(base64, textarea, images, schedulePreview) {
    var idx = images.length;
    images.push(base64);
    var ref = '![图片' + (idx + 1) + '](ai-img://' + idx + ')';
    var pos = textarea.selectionStart;
    textarea.value = textarea.value.substring(0, pos) + '\n' + ref + '\n' + textarea.value.substring(pos);
    textarea.selectionStart = textarea.selectionEnd = pos + ref.length + 2;
    textarea.focus();
    schedulePreview();
    // 立即更新图片计数（不等防抖）
    updateImageCount();
}

// ========== AI 识别 ==========

/**
 * 启动 AI 识别流程
 */
function startAIRecognition(textarea, images, callConfig, schedulePreview) {
    // 创建文件选择
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', function () {
        var files = input.files;
        if (!files || files.length === 0) {
            input.remove();
            return;
        }
        var base64Array = [];
        var processed = 0;
        var total = files.length;

        for (var i = 0; i < files.length; i++) {
            (function (file) {
                if (file.size > 2 * 1024 * 1024) {
                    compressImage(file, 800, function (b64) {
                        base64Array.push(b64);
                        processed++;
                        if (processed === total) doAIRecognition(base64Array, textarea, images, callConfig, schedulePreview);
                    });
                } else {
                    fileToBase64(file, function (b64) {
                        base64Array.push(b64);
                        processed++;
                        if (processed === total) doAIRecognition(base64Array, textarea, images, callConfig, schedulePreview);
                    });
                }
            })(files[i]);
        }
        input.remove();
    });

    input.click();
}

/**
 * 执行 AI 识别
 */
function doAIRecognition(imageBase64Array, textarea, images, callConfig, schedulePreview) {
    if (!callConfig) {
        if (typeof showToast === 'function') showToast('请先配置 AI 供应商和 API Key', 'error');
        return;
    }

    // 构建识别提示词
    var recognitionPrompt = buildRecognitionPrompt();

    // 显示加载状态
    var loadingText = '\n\n<!-- AI识别中... -->\n';
    var pos = textarea.selectionStart;
    textarea.value = textarea.value.substring(0, pos) + loadingText + textarea.value.substring(pos);
    textarea.scrollTop = textarea.scrollHeight;

    // 调用 AI（复用 callAI 的流式能力）
    if (typeof callAI === 'function') {
        callAI(recognitionPrompt, imageBase64Array, callConfig, function (fullText) {
            // 流式更新：替换加载状态为识别结果
            var cleaned = fullText.replace(/^```markdown\s*/i, '').replace(/\s*```\s*$/, '');
            textarea.value = textarea.value.substring(0, pos) + '\n' + cleaned + '\n' + textarea.value.substring(pos + loadingText.length);
            textarea.scrollTop = textarea.scrollHeight;
            schedulePreview();
        }).then(function (fullText) {
            // 完成：后处理 {{KEEP_IMAGE}} 标记
            var cleaned = fullText.replace(/^```markdown\s*/i, '').replace(/\s*```\s*$/, '');
            var processed = postProcessRecognition(cleaned, imageBase64Array, images);
            textarea.value = textarea.value.substring(0, pos) + '\n' + processed + '\n';
            schedulePreview();
            if (typeof showToast === 'function') showToast('AI识别完成，请检查并编辑', 'success');
        }).catch(function (err) {
            // 移除加载状态
            textarea.value = textarea.value.substring(0, pos) + textarea.value.substring(pos + loadingText.length);
            if (typeof showToast === 'function') showToast('AI识别失败: ' + (err.message || err), 'error');
        });
    }
}

// ========== AI 润色 ==========

/**
 * 启动 AI 润色流程：将自然语言转换为标准 Markdown/LaTeX
 */
function startAIPolish(textarea, callConfig, schedulePreview) {
    if (!callConfig) {
        if (typeof showToast === 'function') showToast('请先配置 AI 供应商和 API Key', 'error');
        return;
    }

    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var selected = textarea.value.substring(start, end);

    // 如果没有选中文本，提示教师选中或输入
    if (!selected.trim()) {
        // 弹出输入框让教师描述
        var desc = prompt('请输入要润色的内容描述（如：2倍根号下g乘d）：');
        if (!desc || !desc.trim()) return;
        selected = desc.trim();
    }

    var polishPrompt = '你是一位数学/科学公式排版专家。请将以下自然语言描述转换为标准的 Markdown 格式（含 LaTeX 公式）。\n\n' +
        '规则：\n' +
        '- 数学公式用 LaTeX：行内用 $...$ ，独立公式用 $$...$$\n' +
        '- 化学式用正确的符号表示\n' +
        '- 保持原文的语义和结构\n' +
        '- 只输出转换后的内容，不要添加任何解释或说明\n\n' +
        '原始描述：\n' + selected;

    // 标记正在润色
    var marker = '<!-- AI润色中... -->';
    if (start !== end) {
        textarea.value = textarea.value.substring(0, start) + marker + textarea.value.substring(end);
    } else {
        textarea.value = textarea.value.substring(0, start) + marker + textarea.value.substring(start);
    }

    callAI(polishPrompt, [], callConfig, function (fullText) {
        var cleaned = fullText.replace(/^```(?:markdown)?\s*/i, '').replace(/\s*```\s*$/, '');
        textarea.value = textarea.value.substring(0, start) + cleaned + textarea.value.substring(start + marker.length);
        textarea.scrollTop = textarea.scrollHeight;
        schedulePreview();
    }).then(function (fullText) {
        var cleaned = fullText.replace(/^```(?:markdown)?\s*/i, '').replace(/\s*```\s*$/, '');
        textarea.value = textarea.value.substring(0, start) + cleaned + textarea.value.substring(start + marker.length);
        textarea.selectionStart = start;
        textarea.selectionEnd = start + cleaned.length;
        schedulePreview();
        if (typeof showToast === 'function') showToast('AI润色完成', 'success');
    }).catch(function (err) {
        textarea.value = textarea.value.substring(0, start) + selected + textarea.value.substring(start + marker.length);
        if (typeof showToast === 'function') showToast('AI润色失败: ' + (err.message || err), 'error');
    });
}

/**
 * 后处理 AI 识别结果：将 {{KEEP_IMAGE}} 标记转换为图片引用
 */
function postProcessRecognition(text, sourceImages, targetImages) {
    // 将 {{KEEP_IMAGE}} 标记替换为实际图片引用
    // sourceImages 是识别用的源图片，targetImages 是编辑器中的图片数组
    var keepImageCount = 0;
    var result = text.replace(/\{\{KEEP_IMAGE\}\}\s*(.*)/g, function (match, desc) {
        // 将源图片（如果只有一张）或占位图添加到目标图片数组
        var srcIdx = keepImageCount < sourceImages.length ? keepImageCount : 0;
        var targetIdx = targetImages.length;
        targetImages.push(sourceImages[srcIdx]);
        keepImageCount++;
        return '![' + (desc || '保留的图片') + '](ai-img://' + targetIdx + ')';
    });
    return result;
}

/**
 * 构建识别提示词
 */
function buildRecognitionPrompt() {
    return '你是一位专业的教育内容识别专家。请将图片中的内容转换为结构化的 Markdown 格式。\n\n' +
        '要求：\n' +
        '1. 准确识别所有文字内容，保持原有的题目编号和层次结构\n' +
        '2. 数学公式使用 LaTeX 格式：行内用 $...$ ，独立公式用 $$...$$\n' +
        '3. 化学方程式使用正确的化学符号\n' +
        '4. 对于以下类型的图片，请用 {{KEEP_IMAGE}} 标记保留，并附上文字描述：\n' +
        '   - 有机化学结构式（如苯环、分子结构）\n' +
        '   - 电路图、实物连接图\n' +
        '   - 函数图像、几何图形\n' +
        '   - 复杂的表格或图表\n' +
        '   - 任何无法用纯文字准确表达的图示\n' +
        '   格式：{{KEEP_IMAGE}} 文字描述内容\n' +
        '5. 对于简单的示意图，用文字描述即可，无需保留图片\n' +
        '6. 如有无法识别的内容，用 [?] 标注\n\n' +
        '请直接输出 Markdown 内容，不要添加额外说明。';
}

// ========== 预览渲染工具函数 ==========

/**
 * 渲染指定字段的 Markdown 预览（用于设置面板中的预览区）
 * @param {string} fieldName - 字段名
 * @param {object} fieldData - { text, images, format }
 */
function renderMarkdownPreview(fieldName, fieldData) {
    var previewEl = document.querySelector('#' + fieldName + '-preview .md-preview-content');
    if (!previewEl) return;

    if (!fieldData || !fieldData.text) {
        previewEl.innerHTML = '<span class="md-placeholder">点击「编辑」添加内容（支持 Markdown + LaTeX 公式 + 图片）</span>';
        return;
    }

    if (window.__aiMarkdownRenderer) {
        previewEl.innerHTML = window.__aiMarkdownRenderer.renderWithImages(fieldData.text, fieldData.images);
    } else {
        previewEl.textContent = fieldData.text;
    }
}

/**
 * 规范化字段数据（兼容旧格式）
 * @param {string|object} field - 旧格式字符串或新格式对象
 * @returns {{ text: string, images: string[], format: string }}
 */
function normalizeMarkdownField(field) {
    if (typeof field === 'string') {
        return { text: field, images: [], format: 'plain' };
    }
    if (field && typeof field === 'object') {
        return {
            text: field.text || '',
            images: field.images || [],
            format: field.format || 'markdown',
        };
    }
    return { text: '', images: [], format: 'plain' };
}

// ========== 样式注入 ==========

function injectMarkdownStyles() {
    if (document.getElementById('ai-markdown-styles')) return;
    var style = document.createElement('style');
    style.id = 'ai-markdown-styles';
    style.textContent = [
        /* ---------- 设置面板中的预览区 ---------- */
        '.md-preview-container {',
        '  position: relative;',
        '  min-height: 72px;',
        '  max-height: 200px;',
        '  overflow-y: auto;',
        '  padding: 9px 12px;',
        '  background: rgba(0,0,0,0.02);',
        '  border: 1px solid rgba(0,0,0,0.08);',
        '  border-radius: 8px;',
        '  font-size: 13px;',
        '  line-height: 1.6;',
        '  color: #1a1a1a;',
        '  word-break: break-word;',
        '  cursor: pointer;',
        '  transition: border-color 0.2s, box-shadow 0.2s;',
        '}',
        '.md-preview-container:hover {',
        '  border-color: rgba(0,122,255,0.3);',
        '  box-shadow: 0 0 0 2px rgba(0,122,255,0.08);',
        '}',
        '.md-preview-container .md-placeholder { color: #999; font-style: italic; }',
        '.md-preview-container .md-edit-btn {',
        '  display: none; pointer-events: none;', /* 纯装饰，点击由容器处理 */
        '}',
        '.md-preview-container:hover .md-edit-btn {',
        '  display: inline-flex;',
        '  position: absolute;',
        '  top: 6px; right: 6px;',
        '  padding: 3px 10px;',
        '  font-size: 12px;',
        '  background: rgba(0,122,255,0.9);',
        '  color: #fff;',
        '  border: none;',
        '  border-radius: 6px;',
        '  pointer-events: none;',
        '  z-index: 1;',
        '}',
        /* 预览区内的 Markdown 样式 */
        '.md-preview-content h1, .md-preview-content h2, .md-preview-content h3 {',
        '  margin: 8px 0 4px; font-weight: 600;',
        '}',
        '.md-preview-content h1 { font-size: 16px; }',
        '.md-preview-content h2 { font-size: 14px; }',
        '.md-preview-content h3 { font-size: 13px; }',
        '.md-preview-content p { margin: 4px 0; }',
        '.md-preview-content ul, .md-preview-content ol { padding-left: 20px; margin: 4px 0; }',
        '.md-preview-content code {',
        '  background: rgba(0,0,0,0.05);',
        '  padding: 1px 4px;',
        '  border-radius: 3px;',
        '  font-family: SF Mono, JetBrains Mono, Consolas, monospace;',
        '  font-size: 12px;',
        '}',
        '.md-preview-content pre {',
        '  background: rgba(0,0,0,0.04);',
        '  padding: 8px;',
        '  border-radius: 6px;',
        '  overflow-x: auto;',
        '}',
        '.md-preview-content pre code { background: none; padding: 0; }',
        '.md-preview-content img {',
        '  max-width: 100%;',
        '  max-height: 150px;',
        '  border-radius: 4px;',
        '  margin: 4px 0;',
        '}',
        '.md-preview-content .katex-display { margin: 8px 0; overflow-x: auto; }',
        '.md-preview-content table {',
        '  border-collapse: collapse;',
        '  margin: 8px 0;',
        '  font-size: 12px;',
        '}',
        '.md-preview-content th, .md-preview-content td {',
        '  border: 1px solid rgba(0,0,0,0.1);',
        '  padding: 4px 8px;',
        '}',

        /* ---------- 全屏编辑器 ---------- */
        '#ai-md-editor-overlay {',
        '  position: fixed !important;',
        '  top: 0; left: 0; right: 0; bottom: 0;',
        '  background: rgba(0,0,0,0.5);',
        '  backdrop-filter: blur(4px);',
        '  -webkit-backdrop-filter: blur(4px);',
        '  z-index: 2147483647 !important;',
        '  display: flex;',
        '  align-items: center;',
        '  justify-content: center;',
        '}',
        '#ai-md-editor {',
        '  width: 90vw;',
        '  max-width: 1200px;',
        '  height: 85vh;',
        '  background: #fff;',
        '  border-radius: 16px;',
        '  box-shadow: 0 20px 60px rgba(0,0,0,0.3);',
        '  display: flex;',
        '  flex-direction: column;',
        '  overflow: hidden;',
        '  font-family: -apple-system, SF Pro Display, Helvetica Neue, sans-serif;',
        '}',

        /* 标题栏 */
        '.md-editor-header {',
        '  display: flex;',
        '  align-items: center;',
        '  justify-content: space-between;',
        '  padding: 12px 16px;',
        '  border-bottom: 1px solid rgba(0,0,0,0.08);',
        '}',
        '.md-editor-title { font-size: 15px; font-weight: 600; color: #1a1a1a; }',
        '.md-editor-close {',
        '  width: 28px; height: 28px;',
        '  border: none; background: rgba(0,0,0,0.05);',
        '  border-radius: 50%; font-size: 18px;',
        '  cursor: pointer; color: #666;',
        '  display: flex; align-items: center; justify-content: center;',
        '}',
        '.md-editor-close:hover { background: rgba(255,59,48,0.1); color: #ff3b30; }',

        /* 工具栏 */
        '.md-editor-toolbar {',
        '  display: flex;',
        '  align-items: center;',
        '  gap: 2px;',
        '  padding: 6px 12px;',
        '  border-bottom: 1px solid rgba(0,0,0,0.06);',
        '  background: rgba(0,0,0,0.02);',
        '  flex-shrink: 0;',
        '}',
        '.md-editor-toolbar button {',
        '  padding: 4px 8px;',
        '  border: none;',
        '  background: transparent;',
        '  border-radius: 6px;',
        '  cursor: pointer;',
        '  font-size: 13px;',
        '  color: #444;',
        '  transition: background 0.15s;',
        '}',
        '.md-editor-toolbar button:hover { background: rgba(0,122,255,0.1); color: #007aff; }',
        '.md-toolbar-sep {',
        '  width: 1px;',
        '  height: 18px;',
        '  background: rgba(0,0,0,0.1);',
        '  margin: 0 4px;',
        '}',

        /* 内容区 */
        '.md-editor-body {',
        '  display: flex;',
        '  flex: 1;',
        '  overflow: hidden;',
        '}',
        '.md-editor-edit {',
        '  flex: 1;',
        '  display: flex;',
        '  border-right: 1px solid rgba(0,0,0,0.06);',
        '}',
        '.md-editor-textarea {',
        '  flex: 1;',
        '  border: none;',
        '  outline: none;',
        '  padding: 12px 16px;',
        '  font-family: SF Mono, JetBrains Mono, Consolas, monospace;',
        '  font-size: 13px;',
        '  line-height: 1.6;',
        '  color: #1a1a1a;',
        '  resize: none;',
        '  background: #fafafa;',
        '}',
        '.md-editor-preview {',
        '  flex: 1;',
        '  overflow-y: auto;',
        '  padding: 12px 16px;',
        '  background: #fff;',
        '}',
        '.md-preview-inner {',
        '  font-size: 14px;',
        '  line-height: 1.7;',
        '  color: #1a1a1a;',
        '  word-break: break-word;',
        '}',

        /* 预览区内的 Markdown 样式（全屏编辑器） */
        '.md-preview-inner h1, .md-preview-inner h2, .md-preview-inner h3 {',
        '  margin: 12px 0 6px; font-weight: 600;',
        '}',
        '.md-preview-inner h1 { font-size: 20px; }',
        '.md-preview-inner h2 { font-size: 17px; }',
        '.md-preview-inner h3 { font-size: 15px; }',
        '.md-preview-inner p { margin: 6px 0; }',
        '.md-preview-inner ul, .md-preview-inner ol { padding-left: 24px; margin: 6px 0; }',
        '.md-preview-inner code {',
        '  background: rgba(0,0,0,0.05);',
        '  padding: 1px 4px;',
        '  border-radius: 3px;',
        '  font-family: SF Mono, JetBrains Mono, Consolas, monospace;',
        '  font-size: 13px;',
        '}',
        '.md-preview-inner pre {',
        '  background: rgba(0,0,0,0.04);',
        '  padding: 10px;',
        '  border-radius: 8px;',
        '  overflow-x: auto;',
        '}',
        '.md-preview-inner pre code { background: none; padding: 0; }',
        '.md-preview-inner img {',
        '  max-width: 100%;',
        '  max-height: 300px;',
        '  border-radius: 6px;',
        '  margin: 8px 0;',
        '}',
        '.md-preview-inner .katex-display { margin: 12px 0; overflow-x: auto; }',
        '.md-preview-inner table {',
        '  border-collapse: collapse;',
        '  margin: 8px 0;',
        '}',
        '.md-preview-inner th, .md-preview-inner td {',
        '  border: 1px solid rgba(0,0,0,0.1);',
        '  padding: 6px 10px;',
        '}',
        '.md-preview-inner blockquote {',
        '  border-left: 3px solid rgba(0,122,255,0.3);',
        '  padding-left: 12px;',
        '  color: #666;',
        '  margin: 8px 0;',
        '}',

        /* 底部 */
        '.md-editor-footer {',
        '  display: flex;',
        '  align-items: center;',
        '  justify-content: space-between;',
        '  padding: 10px 16px;',
        '  border-top: 1px solid rgba(0,0,0,0.08);',
        '}',
        '.md-image-count { font-size: 12px; color: #888; }',
        '.md-editor-actions { display: flex; gap: 8px; }',
        '.md-btn {',
        '  padding: 7px 20px;',
        '  border-radius: 8px;',
        '  border: none;',
        '  font-size: 13px;',
        '  font-weight: 500;',
        '  cursor: pointer;',
        '  transition: all 0.15s;',
        '}',
        '.md-btn-cancel { background: rgba(0,0,0,0.05); color: #666; }',
        '.md-btn-cancel:hover { background: rgba(0,0,0,0.1); }',
        '.md-btn-confirm { background: #007aff; color: #fff; }',
        '.md-btn-confirm:hover { background: #0066d6; }',

        /* KaTeX 公式 fallback */
        '.katex-fallback {',
        '  background: rgba(255,200,0,0.1);',
        '  padding: 2px 4px;',
        '  border-radius: 3px;',
        '  font-family: SF Mono, JetBrains Mono, Consolas, monospace;',
        '  font-size: 0.9em;',
        '}',

        /* 响应式：窄屏改为上下布局 */
        '@media (max-width: 760px) {',
        '  .md-editor-body { flex-direction: column; }',
        '  .md-editor-edit { border-right: none; border-bottom: 1px solid rgba(0,0,0,0.06); flex: 1; }',
        '  .md-editor-preview { flex: 1; }',
        '}',
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
}

// ========== 初始化 ==========

// 在 DOM 就绪后初始化渲染器和样式
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
        initMarkdownRenderer();
        injectMarkdownStyles();
    });
} else {
    initMarkdownRenderer();
    injectMarkdownStyles();
}
