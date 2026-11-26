function captureLeascentSchoolQuestions() {
    const w = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    if (w !== w.top || w.location.origin !== 'http://111.59.208.15:88'
        || !/^\/home\/index\/?$/i.test(w.location.pathname)) return null;
    const prototype = w.XMLHttpRequest?.prototype;
    if (!prototype) return null;

    const originalOpen = prototype.open;
    const observed = new WeakSet();
    const pending = [];
    let receive;
    function open(...args) {
        const result = originalOpen.apply(this, args);
        const url = new URL(args[1], w.location.href);
        if (url.origin !== w.location.origin || url.pathname.toLowerCase() !== '/home/getquestion' || observed.has(this)) {
            return result;
        }
        observed.add(this);
        this.addEventListener('load', () => {
            const responseUrl = new URL(this.responseURL || url.href);
            if (this.status !== 200 || responseUrl.origin !== url.origin || responseUrl.pathname !== url.pathname) return;
            try {
                const data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
                if (!Array.isArray(data)) return;
                if (receive) receive(data);
                else {
                    pending.push(data);
                    if (pending.length > 4) pending.shift();
                }
            } catch (_) { /* The native page handles invalid responses. */ }
        });
        return result;
    }
    prototype.open = open;
    return callback => {
        receive = callback;
        if (prototype.open === open) prototype.open = originalOpen;
        for (const data of pending.splice(0)) receive(data);
    };
}
