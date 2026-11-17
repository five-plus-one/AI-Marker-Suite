// 云阅卷家族的原站键盘提交与答卷图片观察。
const MarkingPaper = {
    visible(element) {
        if (!element?.getClientRects().length) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
    },

    imageKey(value) {
        if (typeof value !== 'string' || !value.trim()) return null;
        try {
            const url = new URL(value, location.href);
            if (!/^https?:$/.test(url.protocol)) return null;
            if (/(?:^|\/)(?:loading(?:M)?|blank|spacer|transparent|placeholder)\.(?:gif|png|jpe?g|svg)$/i.test(url.pathname)) return null;
            // 保留答卷 token、裁切与页码参数，仅忽略已知缓存刷新参数。
            for (const name of [...url.searchParams.keys()]) {
                if (/^(?:_|t|ts|timestamp|random|rand|cachebust|cachebuster|cb)$/i.test(name)) url.searchParams.delete(name);
            }
            url.searchParams.sort();
            url.hash = '';
            return url.href;
        } catch (_) { return null; }
    },

    snapshot(selector) {
        const images = [...document.querySelectorAll(selector)].filter(image => this.visible(image));
        const keys = images.map(image => this.imageKey(image.getAttribute('src') ? image.src : ''));
        const ready = images.length > 0 && keys.every(Boolean)
            && images.every(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
        return { ready, keys, urls: images.map(image => image.src),
            identity: ready ? JSON.stringify([...new Set(keys)].sort()) : null };
    },

    async gather(adapter) {
        let previous = null;
        for (let count = 0; count < 125; count++) {
            if (window.aiGradingState?.abortController?.signal.aborted) return [];
            const snapshot = adapter._paperSnapshot();
            if (snapshot.ready && snapshot.identity === previous) {
                snapshot.taskId = adapter.getTaskIdentifier();
                adapter._gatheredPaperSnapshot = snapshot;
                return [...new Set(snapshot.urls)];
            }
            previous = snapshot.identity;
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return [];
    },

    submit(adapter, button, options = {}) {
        const current = () => !options.signal?.aborted && (!options.isCurrent || options.isCurrent());
        if (!current()) return false;
        const snapshot = adapter._paperSnapshot();
        snapshot.taskId = adapter.getTaskIdentifier();
        if (!snapshot.ready || (adapter._gatheredPaperSnapshot && adapter._gatheredPaperSnapshot.identity !== snapshot.identity)) return false;
        const inputs = adapter.getScoreInputs().map(input => input.element).filter(input => this.visible(input));
        if (!inputs.length || inputs.some(input => {
            const value = Number(input.value);
            const maximum = Number(input.getAttribute('data-score') || input.getAttribute('fen'));
            return input.disabled || input.readOnly || input.value.trim() === '' || !Number.isFinite(value) || value < 0
                || (maximum > 0 && value > maximum);
        })) return false;
        const last = [...document.querySelectorAll('input.fenshu')].at(-1);
        if (!last || !this.visible(last) || !inputs.includes(last)) return false;
        const pageWindow = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
        const nativeButton = button && this.visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
        // 禁用的原站按钮表示当前不可提交，不能绕过它调用键盘流。
        if (button && !nativeButton) return false;
        if (!nativeButton && typeof pageWindow.inputkey !== 'function') return false;
        const values = inputs.map(input => Number(input.value));
        try {
            let receivedFocus = false;
            const onFocus = () => { receivedFocus = true; };
            last.addEventListener('focus', onFocus);
            try { last.focus(); } finally { last.removeEventListener('focus', onFocus); }
            // 后台页或输入框已经聚焦时 focus() 可能不派发事件，原站仍须更新当前小题。
            if (document.activeElement === last && !receivedFocus) last.dispatchEvent(new Event('focus'));
            if (document.activeElement !== last || !current() || adapter._paperSnapshot().identity !== snapshot.identity) return false;
            if (inputs.some((input, index) => input.value.trim() === '' || Number(input.value) !== values[index])) return false;
            // 使用焦点事件前读取的旧卷，覆盖同步完成的原站换卷。
            adapter._submittedPaperSnapshot = snapshot;
            // 原站按钮处理校验与提交；无按钮的校园版使用页面上下文中的键盘确认流。
            if (nativeButton) button.click();
            else pageWindow.inputkey(']');
            // inputkey 在成功交卷后也返回 false，用于阻止默认键盘事件。
            return true;
        } catch (error) {
            console.warn(`[${adapter.name}] 原站提交失败:`, error);
            // 原站可能已发出请求；异常后不再调用第二个提交入口。
            return false;
        }
    },

    async wait(adapter, oldImageUrl, context = {}) {
        const saved = adapter._submittedPaperSnapshot || adapter._gatheredPaperSnapshot;
        let oldKeys = [];
        if (context.paperId) {
            try { oldKeys = JSON.parse(context.paperId); } catch (_) { return false; }
            if (!Array.isArray(oldKeys) || !oldKeys.length || oldKeys.some(key => typeof key !== 'string' || !key)) return false;
        } else if (saved?.ready) oldKeys = saved.keys;
        else {
            const key = this.imageKey(oldImageUrl);
            if (key) oldKeys = [key];
        }
        if (!oldKeys.length || context.signal?.aborted) return false;
        const task = context.taskId || saved?.taskId || adapter.getTaskIdentifier();
        return new Promise(resolve => {
            let checks = 0, candidate = null, stable = 0;
            const finish = value => {
                clearInterval(timer);
                context.signal?.removeEventListener?.('abort', abort);
                resolve(value);
            };
            const abort = () => finish(false);
            const timer = setInterval(() => {
                if (context.signal?.aborted || !adapter.isMarkingPage() || (task && adapter.getTaskIdentifier() !== task)) return finish(false);
                const snapshot = adapter._paperSnapshot();
                // 旧页全部退出可见集后，整组新图须连续两次就绪。
                const changed = snapshot.ready && !snapshot.keys.some(key => oldKeys.includes(key));
                stable = changed && candidate === snapshot.identity ? stable + 1 : changed ? 1 : 0;
                candidate = changed ? snapshot.identity : null;
                if (stable >= 2) return finish(true);
                if (++checks >= 125) {
                    console.warn(`[${adapter.name}] 等待下一份试卷超时`);
                    finish(false);
                }
            }, 200);
            context.signal?.addEventListener?.('abort', abort, { once: true });
            if (context.signal?.aborted) finish(false);
        });
    }
};
