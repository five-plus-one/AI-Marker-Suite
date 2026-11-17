const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, URL_A, URL_B } = require('./_platform-image-fixture');

function setup(dir = 'yunyuejuan') {
    const e = fixture(dir), { sb, adapter: a } = e;
    let saves = 0, clicks = 0, keys = 0;
    const inputs = [4, 3, 3].map((max, index) => Object.assign(Object.create(sb.HTMLInputElement.prototype), {
        _v: '0', id: `fenshu${index}`, disabled: false, readOnly: false,
        getAttribute: name => ['data-score', 'fen'].includes(name) ? String(max) : null,
        getClientRects: () => [{}],
        focus() { sb.document.activeElement = this; sb.unsafeWindow.o = this; this.onFocus?.(); },
        addEventListener(name, fn) { if (name === 'focus') this.onFocus = fn; },
        removeEventListener(name) { if (name === 'focus') this.onFocus = null; },
        dispatchEvent(event) { if (event.type === 'focus') sb.unsafeWindow.o = this; }, closest() { return rows[index]; }
    }));
    const rows = inputs.map((input, index) => ({
        querySelector: selector => selector === 'input.fenshu' ? input : { textContent: String(19 + index) }
    }));
    const image = (src = URL_A) => ({ src, id: 'pic0', complete: true, naturalWidth: 1000, naturalHeight: 800,
        getAttribute(name) { return name === 'src' ? this.src : null; }, getClientRects: () => [{}] });
    const images = [image()];
    const page = { inputkey(value) {
        keys++;
        assert.equal(value, ']');
        if (this.o !== inputs.at(-1)) { inputs[1].focus(); return; }
        saves++;
    } };
    const button = { textContent: '提交分数', disabled: false, getAttribute: () => null, getClientRects: () => [{}],
        click() { clicks++; return page.inputkey(']'); } };
    sb.unsafeWindow = page;
    sb.document.activeElement = inputs[0]; page.o = inputs[0];
    sb.document.querySelectorAll = selector => {
        if ([e.selectors.ANSWER_IMAGE, e.selectors.ANSWER_IMAGE_CLASS].includes(selector)) return images;
        if (selector === 'input.fenshu') return inputs;
        if (selector === 'tbody.xtlist tr') return rows;
        if (selector === 'button') return [button];
        return [];
    };
    sb.document.querySelector = selector => {
        if ([e.selectors.ANSWER_IMAGE, e.selectors.ANSWER_IMAGE_CLASS].includes(selector)) return images[0] || null;
        if (selector === e.selectors.SUBMIT_BUTTON) return button;
        if (selector === 'input.fenshu') return inputs[0];
        return null;
    };
    return { ...e, inputs, images, image, rows, page, button,
        saves: () => saves, clicks: () => clicks, keys: () => keys,
        next() { images.forEach(img => img.src = img.src.replaceAll('100001', '100002').replaceAll('paper-a', 'paper-b')); } };
}

for (const dir of ['yunyuejuan', 'xinkao-campus', 'xinkao-2']) {
    test(`${dir}: 三小题全零分时聚焦末项，通过原站确认一次`, async () => {
        const e = setup(dir);
        assert.equal(e.adapter.fillScores([0, 0, 0]), true);
        assert.equal(e.adapter.submitGrade(), true);
        assert.equal(e.sb.document.activeElement, e.inputs.at(-1));
        assert.equal(e.saves(), 1);
        assert.equal(e.keys(), 1);
        assert.equal(e.clicks(), dir === 'xinkao-campus' ? 0 : 1);
    });

    test(`${dir}: 原站交卷返回 false 表示事件已处理，异常后不再尝试第二入口`, () => {
        const e = setup(dir);
        const original = e.page.inputkey;
        e.page.inputkey = function (key) { original.call(this, key); return false; };
        assert.equal(e.adapter.submitGrade(), true);
        assert.equal(e.saves(), 1);
        assert.equal(e.clicks(), dir === 'xinkao-campus' ? 0 : 1);
        e.page.inputkey = () => { throw Error('native failure'); };
        assert.equal(e.adapter.submitGrade(), false);
        assert.equal(e.saves(), 1);
    });

    test(`${dir}: 后台页 focus 未派发事件时执行原站焦点处理`, () => {
        const e = setup(dir);
        e.inputs.at(-1).focus = () => { e.sb.document.activeElement = e.inputs.at(-1); };
        assert.equal(e.adapter.submitGrade(), true);
        assert.equal(e.saves(), 1);
    });

    test(`${dir}: 空分、无效分、超上限、取消与焦点改变答卷时停止提交`, () => {
        for (const value of ['', 'NaN', 'Infinity', '-1', '5']) {
            const e = setup(dir); e.inputs[0]._v = value;
            assert.equal(e.adapter.submitGrade(), false, value);
            assert.equal(e.keys(), 0);
        }
        const e = setup(dir);
        assert.equal(e.adapter.submitGrade({ signal: { aborted: true } }), false);
        e.inputs.at(-1).focus = () => { e.sb.document.activeElement = e.inputs.at(-1); e.next(); };
        assert.equal(e.adapter.submitGrade(), false);
        assert.equal(e.keys(), 0);
    });

    test(`${dir}: 提交同步换卷与稍后重试均使用提交前的整组基线`, async () => {
        const e = setup(dir);
        e.images.push(e.image(URL_A.replace('answer.jpg', 'second.jpg')));
        const urls = await e.run(e.adapter.gatherAnswerImages()), old = e.adapter.getPaperIdentity();
        e.page.inputkey = () => { e.next(); return true; };
        assert.equal(e.adapter.submitGrade(), true);
        assert.equal(await e.run(e.adapter.waitForNextPaper(urls[0], { paperId: old })), true);
        assert.equal(await e.run(e.adapter.waitForNextPaper(urls[0])), true);
    });
}

for (const dir of ['yunyuejuan', 'xinkao-campus', 'xinkao-2', 'xinkao']) {
    test(`${dir}: 隐藏旧图退出取图与换卷检测`, async () => {
        const e = setup(dir), hidden = e.image(); hidden.getClientRects = () => [];
        e.images.unshift(hidden);
        assert.deepEqual(Array.from(await e.run(e.adapter.gatherAnswerImages())), [URL_A]);
        e.sb.setTimeout(() => { e.images[1].src = URL_B; }, 600);
        assert.equal(await e.run(e.adapter.waitForNextPaper(URL_A)), true);
    });

    test(`${dir}: 缓存刷新、空地址、占位图与未加载图继续等待`, async () => {
        for (const source of [URL_A + '&timestamp=123', '', 'https://images.example/loading.gif', URL_B]) {
            const e = setup(dir), old = e.adapter.getPaperIdentity();
            e.images[0].src = source;
            if (source === URL_B) e.images[0].complete = false;
            assert.equal(await e.run(e.adapter.waitForNextPaper(URL_A, { paperId: old })), false, source);
        }
    });

    test(`${dir}: 任一旧页仍可见或新页未加载时不接受整组换卷`, async () => {
        const e = setup(dir);
        const second = e.image(URL_A.replace('answer.jpg', 'second.jpg')); e.images.push(second);
        const old = e.adapter.getPaperIdentity(); e.images[0].src = URL_B;
        assert.equal(await e.run(e.adapter.waitForNextPaper(URL_A, { paperId: old })), false);
        second.src = second.src.replaceAll('paper-a', 'paper-b'); second.complete = false;
        assert.equal(await e.run(e.adapter.waitForNextPaper(URL_A, { paperId: old })), false);
        second.complete = true;
        assert.equal(await e.run(e.adapter.waitForNextPaper(URL_A, { paperId: old })), true);
    });

    test(`${dir}: 瞬态新图、缺失基线、取消和离开阅卷页面均不继续`, async () => {
        const e = setup(dir), old = e.adapter.getPaperIdentity();
        e.sb.setTimeout(() => { e.images[0].src = URL_B; }, 200);
        e.sb.setTimeout(() => { e.images[0].src = URL_A; }, 400);
        assert.equal(await e.run(e.adapter.waitForNextPaper(URL_A, { paperId: old })), false);
        assert.equal(await e.run(e.adapter.waitForNextPaper('')), false);
        const signal = new AbortController();
        const pending = e.adapter.waitForNextPaper(URL_A, { signal: signal.signal }); signal.abort();
        assert.equal(await e.run(pending), false);
        const taskId = e.adapter.getTaskIdentifier();
        e.sb.location.pathname = '/login'; e.sb.location.href = 'https://school.test/login'; e.next();
        assert.equal(await e.run(e.adapter.waitForNextPaper(URL_A, { paperId: old, taskId })), false);
    });
}

test('云阅卷: 原站按钮禁用、缺失、分数框无法聚焦时停止提交', () => {
    const e = setup(); e.button.disabled = true;
    assert.equal(e.adapter.submitGrade(), false); assert.equal(e.keys(), 0);
    e.button.disabled = false; e.inputs.at(-1).focus = () => {};
    assert.equal(e.adapter.submitGrade(), false); assert.equal(e.keys(), 0);
    e.sb.document.querySelectorAll = () => [];
    assert.equal(e.adapter.submitGrade(), false); assert.equal(e.keys(), 0);
});

test('云阅卷: 原站末项隐藏时停止提交，避免把前一小题当作末项', () => {
    const e = setup();
    e.inputs.push({ getClientRects: () => [] });
    assert.equal(e.adapter.submitGrade(), false); assert.equal(e.keys(), 0);
});

test('校园版: examcode 提前变化而图片未换卷时保持等待', async () => {
    const e = setup('xinkao-campus'); e.sb.examcode = 'A';
    e.sb.setTimeout(() => { e.sb.examcode = 'B'; }, 400);
    assert.equal(await e.run(e.adapter.waitForNextPaper(URL_A)), false);
});

test('内网版: 改变页面参数而图片未换卷时停止等待', async () => {
    const e = setup('xinkao-2');
    e.sb.setTimeout(() => { e.sb.location.href += '&subject=other'; }, 400);
    assert.equal(await e.run(e.adapter.waitForNextPaper(URL_A)), false);
});
