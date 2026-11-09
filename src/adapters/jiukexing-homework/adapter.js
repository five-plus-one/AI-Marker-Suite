// ========== 九科星(作业) 适配器 ==========
// jxp.jkxjxw.com — qiankun 微应用 (pc-homework) + Vue 3 + Element Plus
// 批改页: /homework/homework/mark/{作业ID}?classId=&questionId=（列表页 /correct/ 不激活）
//
// 答题卡（实测结论，勿改回猜测路径）：
// - Canvas 2788x1164 仅是查看器，画了跨域图 tainted，toDataURL/getImageData 全不可用
// - DOM <img> 全是 data: 图标，没有答题卡 <img>
// - 真身是华为 OBS 裁剪图（jty-datika|jty-scancard 桶），URL 自带
//   x-image-process=image/crop,... 参数，GM_xmlhttpRequest 直取即可
// - getMarkingStudents 等接口返回全班队列：markingUrlList[].markingUrlObj + score(满分)
//   + studentName/scanPaperId；平台会预加载邻座图片，PERF 里常见多张，不能全取
// - 当前学生：.student-list .list-item.active（打分栏 .common-name-ellipsis-mw-112 兜底）
//   与接口 studentName 匹配取图；匹配失败取「最近加载」一张，宁可不取不批错卷
//
// 任务标识只含作业+题目 ID（方案按题绑定），不含 scanPaperId（学生维度，换卷必变）

// ===== 模块级拦截器 =====
// 捕获 getMarkingStudents 等批改数据接口（缓存学生-图片-满分映射）
// 以及经 fetch/XHR 加载的 OBS 图片（补 document-idle 错过的初始加载时序）
(function () {
    if (window.__JXH_HW_INTERCEPTOR_INSTALLED__) return;
    window.__JXH_HW_INTERCEPTOR_INSTALLED__ = true;

    const state = {
        markingCache: [],      // [{studentName, studentNumber, scanPaperId, homeworkQuestionId, score, urls:[]}]
        obsLoadLog: [],        // OBS 图片加载时序（去重后保序，末位≈当前学生）
    };
    window.__JXH_HW_STATE__ = state;

    const API_REG = JIUKEXING_HW_SELECTORS.API_URL_REG;
    const OBS_REG = JIUKEXING_HW_SELECTORS.OBS_URL_REG;

    function pushObsUrl(url) {
        if (!url || !OBS_REG.test(url)) return;
        const path = url.split('?')[0];
        const log = state.obsLoadLog;
        const idx = log.findIndex(u => u.split('?')[0] === path);
        if (idx >= 0) log.splice(idx, 1);      // 已存在则挪到末位（最近加载）
        log.push(url);
        if (log.length > 20) log.shift();
    }

    function tryParseMarkingApi(url, text) {
        if (!url || !API_REG.test(url)) return;
        try {
            const json = JSON.parse(text);
            const data = json && json.data;
            const arr = Array.isArray(data) ? data : (data && Array.isArray(data.list) ? data.list : null);
            if (!arr) return;
            const entries = [];
            for (const item of arr) {
                if (!item || typeof item !== 'object') continue;
                const urls = [];
                if (Array.isArray(item.markingUrlList)) {
                    for (const u of item.markingUrlList) {
                        const urlStr = u && (u.markingUrlObj || u.markingUrl || u.url);
                        if (urlStr && typeof urlStr === 'string' && OBS_REG.test(urlStr)) {
                            // 只进匹配缓存，不推进加载时序——API 名册是全班清单，
                            // 不是「已加载图」，推进去会让兜底取到邻座的图
                            urls.push(urlStr);
                        }
                    }
                }
                if (urls.length) {
                    entries.push({
                        studentName: (item.studentName || '').trim(),
                        studentNumber: item.studentNumber || '',
                        scanPaperId: item.scanPaperId || '',
                        homeworkQuestionId: item.homeworkQuestionId || '',
                        score: typeof item.score === 'number' ? item.score : (parseFloat(item.score) || 0),
                        urls
                    });
                }
            }
            if (entries.length) {
                state.markingCache = entries;
                console.log(`📋 [九科星作业] 接口缓存更新: ${entries.length} 名学生`);
            }
        } catch (e) { /* 非 JSON 忽略 */ }
    }

    // ---- Fetch 拦截（数据接口 + OBS 图片）----
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
        window.fetch = async function (...args) {
            const url = (typeof args[0] === 'string') ? args[0] : (args[0] && args[0].url) || '';
            const resp = await origFetch.apply(this, args);
            try {
                if (API_REG.test(url)) {
                    const text = await resp.clone().text();
                    tryParseMarkingApi(url, text);
                } else if (OBS_REG.test(url)) {
                    pushObsUrl(url);
                }
            } catch (e) { /* 忽略 */ }
            return resp;
        };
    }

    // ---- XHR 拦截（不改 responseType，避免破坏平台 HTTP 库）----
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__jxhHwUrl = url;
        return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
        const xhr = this;
        const url = xhr.__jxhHwUrl || '';
        if (API_REG.test(url)) {
            xhr.addEventListener('readystatechange', function () {
                if (xhr.readyState !== 4) return;
                try {
                    if (xhr.response && typeof xhr.response === 'object' && xhr.response.data !== undefined) {
                        tryParseMarkingApi(url, JSON.stringify(xhr.response));
                    } else if (xhr.responseText) {
                        tryParseMarkingApi(url, xhr.responseText);
                    }
                } catch (e) { /* 忽略 */ }
            });
        } else if (OBS_REG.test(url)) {
            xhr.addEventListener('load', function () { pushObsUrl(url); });
        }
        return origSend.apply(this, args);
    };

    console.log('🔧 [九科星作业] 模块级拦截器已安装（fetch + XHR）');
})();


// ===== 适配器主体 =====
const JiukexingHomeworkAdapter = {
    name: '九科星(作业)',
    id: 'jiukexing-homework',
    urlPatterns: ['*://jxp.jkxjxw.com/*'],
    iconUrl: '',

    shouldInitialize() {
        return window.location.hostname.includes('jxp.jkxjxw.com');
    },

    // 精确匹配批改页；列表页 /correct/ 同域同前缀，绝不能误激活
    isMarkingPage() {
        return JIUKEXING_HW_SELECTORS.MARK_PATH_REG.test(window.location.pathname);
    },

    // 当前是否为「暂不支持的批改模式」（按学生批阅：一页多题）。
    // URL 信号为主：按题批阅 URL 带 questionId，按学生批阅带 studentNumber（无 questionId）。
    // 分数框数量只作兜底——按学生页可能只渲染出 1 个框，数框会漏报（#247）
    isUnsupportedMarkingMode() {
        if (!this.isMarkingPage()) return false;
        const qid = this._getUrlParam('questionId') || this._getUrlParam('homeworkQuestionId');
        if (!qid && this._getUrlParam('studentNumber')) return true;
        return document.querySelectorAll(JIUKEXING_HW_SELECTORS.SCORE_INPUT).length > 1;
    },

    // 供核心层在弹新试题 OOBE 前调用（幂等横幅）
    showUnsupportedModeNotice() {
        this._showMultiQuestionNotice();
    },

    async detectMarkingPage() {
        if (!this.isMarkingPage()) {
            console.log('[九科星作业] 当前不在批改页 (path:', window.location.pathname, ')');
            return false;
        }
        try {
            console.log('[九科星作业] 开始检测批改页面...');
            await waitForElement(JIUKEXING_HW_SELECTORS.STUDENT_LIST, 8000).catch(() => null);
            // 等渲染稳定后再数分数框（按学生批阅的多题输入框可能晚于首个出现）
            await new Promise(r => setTimeout(r, 300));

            // 多题并排（按学生批阅）暂不支持：提示并引导跳转按题批阅
            if (this.isUnsupportedMarkingMode()) {
                console.log('[九科星作业] 检测到按学生批阅（多题模式），暂不支持');
                this._showMultiQuestionNotice();
                return false;
            }
            this._removeMultiQuestionNotice();

            const scoreInput = document.querySelector(JIUKEXING_HW_SELECTORS.SCORE_INPUT);
            const submitBtn = this._findSubmitButton();
            const canvas = document.querySelector(JIUKEXING_HW_SELECTORS.ANSWER_CANVAS);
            const list = document.querySelector(JIUKEXING_HW_SELECTORS.STUDENT_LIST);
            const detected = !!((scoreInput || submitBtn) && (canvas || list));
            console.log(`[九科星作业] 分数框: ${!!scoreInput}, 提交按钮: ${!!submitBtn}, Canvas: ${!!canvas}, 学生列表: ${!!list}, 最终: ${detected}`);
            return detected;
        } catch (e) {
            console.error('[九科星作业] detectMarkingPage 异常:', e);
            return false;
        }
    },

    // 题目维度标识（换学生不变、换题变）：作业 ID + 题目 ID
    // 绝不含 scanPaperId/学生姓名，否则换卷误判新题、方案绑定失效
    getTaskIdentifier() {
        const m = window.location.pathname.match(/\/mark\/(\d+)/);
        const homeworkId = m ? m[1] : '';
        const qid = this._getUrlParam('questionId') || this._getUrlParam('homeworkQuestionId') || '';
        return `jiukexing-hw_${homeworkId}_${qid}`;
    },

    async gatherAnswerImages() {
        // 不在批改页（如退回列表页）：返回空列表，绝不能从缓存兜底出图——
        // 那会让答卷校验把「离开页面」误判成「换卷」
        if (!this.isMarkingPage()) {
            console.log('[九科星作业] 不在批改页，返回空图片列表');
            return [];
        }
        console.log('[九科星作业] 开始获取答题卡图片...');
        await new Promise(r => setTimeout(r, 400));

        const state = window.__JXH_HW_STATE__ || { markingCache: [], obsLoadLog: [] };
        const studentName = this._getCurrentStudentName();
        const qid = this._getUrlParam('questionId') || this._getUrlParam('homeworkQuestionId') || '';

        // 1. 接口缓存 × 当前学生姓名 精确匹配（最可靠）
        if (studentName && state.markingCache.length) {
            const byQ = qid
                ? state.markingCache.filter(e => !e.homeworkQuestionId || e.homeworkQuestionId === qid)
                : state.markingCache;
            const matched = byQ.find(e => e.studentName === studentName)
                || state.markingCache.find(e => e.studentName === studentName);
            if (matched && matched.urls.length) {
                console.log(`[九科星作业] 接口匹配「${studentName}」→ ${matched.urls.length} 张题块图`);
                return matched.urls.slice();
            }
            // 缓存在但匹配不上：宁可不取图（下游报「未找到答题卡」可重试），
            // 也绝不走「最近加载」兜底——平台预加载邻座图，兜底会把邻座的卷批了（#253）
            console.warn(`[九科星作业] 缓存中无「${studentName}」，拒绝兜底取图（防批错卷）`);
            return [];
        }

        // 2. 仅当拦截器完全错过接口（缓存为空）才允许加载时序兜底，
        //    且只在候选唯一时采用——多候选无法区分当前卷与邻座预加载
        const obsLog = (state.obsLoadLog && state.obsLoadLog.length)
            ? state.obsLoadLog.slice()
            : this._getObsUrlsFromPerformance();
        if (obsLog.length === 1) {
            console.log('[九科星作业] 无接口缓存，候选唯一，采用:', obsLog[0].split('?')[0]);
            return [obsLog[0]];
        }
        if (obsLog.length > 1) {
            console.warn(`[九科星作业] 无接口缓存且候选 ${obsLog.length} 张（含邻座预加载），无法安全区分，拒绝取图`);
            return [];
        }

        console.warn('[九科星作业] 未找到答题卡图片（接口未拦截到且无 OBS 资源记录）');
        return [];
    },

    async fetchImageAsBase64(url) {
        if (url.startsWith('data:')) return url.split(',')[1] || '';
        // OBS 跨域图走 GM_xmlhttpRequest（connect: '*' 已覆盖）
        return fetchImageAsBase64(url);
    },

    getScoreInputs() {
        const el = document.querySelector(JIUKEXING_HW_SELECTORS.SCORE_INPUT);
        if (!el) {
            console.warn('[九科星作业] 未找到分数输入框');
            return [];
        }

        // 满分：接口 score → placeholder「≤16」
        let maxScore = 0;
        const state = window.__JXH_HW_STATE__ || { markingCache: [] };
        const studentName = this._getCurrentStudentName();
        if (studentName && state.markingCache.length) {
            const matched = state.markingCache.find(e => e.studentName === studentName);
            if (matched && matched.score > 0) maxScore = Math.round(matched.score);
        }
        if (!maxScore) {
            const m = (el.placeholder || '').match(/≤\s*(\d+(?:\.\d+)?)/);
            if (m) maxScore = parseFloat(m[1]);
        }

        // 题号标签：选择器标题「第11题(0/52)」
        let label = '总分';
        const qEl = document.querySelector(JIUKEXING_HW_SELECTORS.QUESTION_SELECT);
        const labelEl = qEl ? qEl.querySelector('.common-name-ellipsis') : null;
        const labelText = labelEl ? labelEl.textContent.trim() : '';
        if (labelText) label = labelText;
        else {
            const m = (document.body.innerText || '').match(/第\s*\d+\s*题/);
            if (m) label = m[0].replace(/\s+/g, '');
        }

        const unit = { element: el, label, index: 0, maxScore };
        console.log(`[九科星作业] 评分单元 1 个: ${label} 满分${maxScore}`);
        return [unit];
    },

    fillScores(scores) {
        if (!scores || scores.length === 0) return false;
        // 数据安全：两遍式全或无（#296）——单题模式下多余分数=配置错位，显式拒绝（不静默忽略）
        if (scores.length > 1) {
            console.warn(`⚠️ [九科星作业] 分数个数(${scores.length})>1（单题模式配置错位）→ 拒绝`);
            return false;
        }
        const score = scores[0];
        if (score === null || score === undefined) {
            console.warn('⚠️ [九科星作业] 无 AI 分数（分数缺失）→ 拒绝');
            return false;
        }

        // 「自动提交」勾选时平台在填分后约 1s 自动交卷，会绕过确认弹窗与拟人延迟——必须先关掉
        this._disableAutoSubmit();

        const el = document.querySelector(JIUKEXING_HW_SELECTORS.SCORE_INPUT);
        if (el && el.getBoundingClientRect().width > 0) {
            // Vue 3 / Element Plus 受控输入：native setter + 事件链
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, String(score));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            console.log(`[九科星作业] 输入框已填入 ${score}`);
            return true;
        }

        // 兜底：分步打分模式点 step-dot 分值按钮
        const num = Number(score);
        const dots = Array.from(document.querySelectorAll('button.step-dot'));
        for (const d of dots) {
            const n = parseFloat((d.textContent || '').trim());
            if (!isNaN(n) && n === num && d.getBoundingClientRect().width > 0) {
                d.click();
                console.log(`[九科星作业] 点击 step-dot「${score}」`);
                return true;
            }
        }

        // 最后兜底：满分/0分快捷钮
        const fullBtn = this._findButtonByText('满分');
        if (num === maxScoreOf(this) && fullBtn) { fullBtn.click(); return true; }
        const zeroBtn = this._findButtonByText('0分');
        if (num === 0 && zeroBtn) { zeroBtn.click(); return true; }

        console.warn('[九科星作业] 未能填入分数');
        return false;
    },

    submitGrade() {
        const btn = this._findSubmitButton();
        if (!btn) {
            console.warn('[九科星作业] 未找到提交分数按钮');
            return false;
        }
        btn.click();
        console.log('[九科星作业] 已点击提交分数');
        return true;
    },

    async waitForNextPaper(oldImageUrl) {
        console.log('[九科星作业] 等待下一份试卷...');
        let oldName = this._getCurrentStudentName();
        const oldQ = this._getUrlParam('questionId') || this._getUrlParam('homeworkQuestionId') || '';
        const oldPath = (oldImageUrl || '').split('?')[0];
        const state = window.__JXH_HW_STATE__ || { obsLoadLog: [] };
        const oldObsCount = (state.obsLoadLog || []).length;
        const oldObsLast = oldObsCount ? (state.obsLoadLog[oldObsCount - 1] || '').split('?')[0] : '';

        const startTime = Date.now();
        while (Date.now() - startTime < 30000) {
            // 换题（按学生批阅模式下会切题）
            const curQ = this._getUrlParam('questionId') || this._getUrlParam('homeworkQuestionId') || '';
            if (curQ && oldQ && curQ !== oldQ) {
                console.log('✅ [九科星作业] 检测到题目切换');
                return true;
            }
            const curName = this._getCurrentStudentName();
            // 名条延迟渲染：进入等待时还没名字，等它出现后立即建立基线
            if (!oldName && curName) {
                console.log(`[九科星作业] 名条延迟出现，建立基线: ${curName}`);
                oldName = curName;
            }
            // 换学生：名条变化（名字可检测时以它为准——加载时序信号会被
            // 邻座预加载误触发，同卷重复批改的竞态就藏在这里，#253 复查补堵）
            if (oldName) {
                if (curName && curName !== oldName) {
                    console.log(`✅ [九科星作业] 检测到学生切换: ${oldName} → ${curName}`);
                    await new Promise(r => setTimeout(r, 300));
                    return true;
                }
                // 名字未变：不采信加载时序/PERF 信号，继续等名条更新
                await new Promise(r => setTimeout(r, 300));
                continue;
            }
            // 名条始终不可用时才用加载时序兜底（邻座预加载可能误触发，属已知弱点）
            const log = state.obsLoadLog || [];
            const curLast = log.length ? (log[log.length - 1] || '').split('?')[0] : '';
            if (curLast && oldObsLast && curLast !== oldObsLast) {
                console.log('✅ [九科星作业] 检测到新题块图加载');
                return true;
            }
            if (log.length > oldObsCount && oldObsCount > 0) {
                console.log('✅ [九科星作业] 检测到题块图加载数增加');
                return true;
            }
            // 兜底：Performance 里出现新 OBS 图
            const perfUrls = this._getObsUrlsFromPerformance();
            const curPerfLast = perfUrls.length ? perfUrls[perfUrls.length - 1].split('?')[0] : '';
            if (curPerfLast && oldPath && curPerfLast !== oldPath && curPerfLast !== oldObsLast) {
                console.log('✅ [九科星作业] 检测到 PERF 新题块图');
                return true;
            }
            await new Promise(r => setTimeout(r, 300));
        }
        console.warn('⚠️ [九科星作业] 等待下一份试卷超时');
        return false;
    },

    isRegradeMode() {
        const bodyText = document.body.innerText || '';
        return bodyText.includes('回评') || bodyText.includes('复核');
    },

    onPageLoad() {
        // Element Plus / qiankun 层叠上下文可能遮挡脚本 UI，统一拉高 z-index
        const style = document.createElement('style');
        style.id = 'jiukexing-hw-zindex-fix';
        style.textContent = `
            .ai-grade-btn, .ai-history-btn, .ai-settings-btn,
            .ai-toast, #ai-history-panel, #ai-grading-settings,
            .ai-modal-overlay, #correction-panel,
            #auto-submit-dialog, #asd-minimized-bar,
            #ai-stream-container, #ai-history-overlay, #ai-stream-panel {
                z-index: 2147483640 !important;
            }
        `;
        document.head.appendChild(style);
    },

    // ========== 内部工具 ==========

    // 按学生批阅暂不支持：固定横幅提示 + 跳转按题批阅链接（幂等，不重复弹）
    _showMultiQuestionNotice() {
        if (document.getElementById('jxh-hw-mode-notice')) return;

        const m = window.location.pathname.match(/\/mark\/(\d+)/);
        const homeworkId = m ? m[1] : '';
        const classId = this._getUrlParam('classId');

        // 优先直达按题批改页（从接口缓存取一个题目 ID）；拿不到就回列表页按题入口
        const cache = (window.__JXH_HW_STATE__ && window.__JXH_HW_STATE__.markingCache) || [];
        const qids = [];
        for (const e of cache) {
            if (e.homeworkQuestionId && qids.indexOf(e.homeworkQuestionId) < 0) qids.push(e.homeworkQuestionId);
        }
        let href;
        let linkText;
        if (qids.length && homeworkId) {
            href = `/homework/homework/mark/${homeworkId}?classId=${encodeURIComponent(classId)}&questionId=${encodeURIComponent(qids[0])}&showFullScreen=1`;
            linkText = '切换到按题批阅';
        } else {
            href = `/homework/homework/correct/${homeworkId}?classId=${encodeURIComponent(classId)}&type=question`;
            linkText = '前往按题批阅';
        }

        const banner = document.createElement('div');
        banner.id = 'jxh-hw-mode-notice';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647 !important;' +
            'background:#fff3e6;border-bottom:2px solid #f0b36d;color:#8a4b12;' +
            'padding:12px 20px;display:flex;align-items:center;justify-content:center;gap:14px;' +
            'font-size:14px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
            'box-shadow:0 4px 16px rgba(138,75,18,0.18);';
        banner.innerHTML = `
            <span>⚠️ 「按学生批阅」一页涉及多个题目，暂不支持自动批改。请使用「按题批阅」（一次一题）模式。</span>
            <a href="${href}" style="padding:6px 16px;background:#fff;border:1px solid #d4883a;color:#8a4b12;
                border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">${linkText}</a>
            <button id="jxh-hw-mode-notice-close" style="background:none;border:none;color:#8a4b12;
                font-size:18px;cursor:pointer;padding:0 6px;">×</button>
        `;
        document.body.appendChild(banner);
        banner.querySelector('#jxh-hw-mode-notice-close').addEventListener('click', () => banner.remove());
        console.log('[九科星作业] 已显示按学生批阅暂不支持提示');
    },

    _removeMultiQuestionNotice() {
        const el = document.getElementById('jxh-hw-mode-notice');
        if (el) el.remove();
    },

    // 填分前取消勾选「自动提交」：勾选时平台会在填分后约 1s 自动交卷，
    // 绕过提交确认弹窗与「批改节奏」拟人延迟。提交时机由脚本提交流程接管
    _disableAutoSubmit() {
        const labels = Array.from(document.querySelectorAll('label.el-checkbox'));
        for (const label of labels) {
            const text = (label.textContent || '').trim();
            if (!text.includes('自动提交')) continue;
            const cb = label.querySelector('input[type="checkbox"]');
            if (cb && cb.checked) {
                label.click();
                // Element Plus 受控组件：若点击后仍勾选，再点隐藏原生 input 兜底
                if (cb.checked) {
                    cb.click();
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (!cb.checked) {
                    console.log('[九科星作业] 已取消勾选「自动提交」（勾选时填分会触发平台自动提交）');
                } else {
                    console.warn('[九科星作业] 「自动提交」取消勾选失败，填分后可能被平台自动提交');
                }
            }
        }
    },

    _getUrlParam(name) {
        try {
            return new URLSearchParams(window.location.search).get(name) || '';
        } catch (e) {
            return '';
        }
    },

    // 当前学生：列表 active 名条优先，打分栏当前学生名兜底
    _getCurrentStudentName() {
        const el = document.querySelector(JIUKEXING_HW_SELECTORS.STUDENT_NAME_EL)
            || document.querySelector(JIUKEXING_HW_SELECTORS.STUDENT_ITEM_ACTIVE + ' [title]')
            || document.querySelector('.common-name-ellipsis-mw-112');
        if (!el) return '';
        return (el.getAttribute('title') || el.textContent || '').trim();
    },

    _getObsUrlsFromPerformance() {
        try {
            const seen = new Set();
            const urls = [];
            for (const e of performance.getEntriesByType('resource')) {
                const n = e.name || '';
                if (!OBS_REG_TEST(n)) continue;
                const p = n.split('?')[0];
                if (seen.has(p)) continue;
                seen.add(p);
                urls.push(n);
            }
            return urls;
        } catch (e) {
            return [];
        }
    },

    // 可见的「提交分数」按钮（页面可能存在隐藏同名按钮）
    _findSubmitButton() {
        const btns = Array.from(document.querySelectorAll('button'));
        for (const b of btns) {
            if ((b.textContent || '').trim() === JIUKEXING_HW_SELECTORS.SUBMIT_TEXT
                && b.getBoundingClientRect().width > 0) {
                return b;
            }
        }
        return null;
    },

    _findButtonByText(text) {
        const btns = Array.from(document.querySelectorAll('button'));
        for (const b of btns) {
            if ((b.textContent || '').trim() === text && b.getBoundingClientRect().width > 0) return b;
        }
        return null;
    },
};

// 供 fillScores 快捷钮兜底读满分（避免方法内自引用歧义）
function maxScoreOf(adapter) {
    try {
        const units = adapter.getScoreInputs();
        return units.length ? (units[0].maxScore || 0) : 0;
    } catch (e) {
        return 0;
    }
}

// OBS 正则的模块级引用（拦截器与工具函数共用）
function OBS_REG_TEST(url) {
    return JIUKEXING_HW_SELECTORS.OBS_URL_REG.test(url);
}

// 注册适配器
if (JiukexingHomeworkAdapter.shouldInitialize()) {
    window.__AI_MARKER_ADAPTER__ = JiukexingHomeworkAdapter;
    JiukexingHomeworkAdapter.onPageLoad();
    console.log('🚀 [九科星作业] 适配器已注册');
}
