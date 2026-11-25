// test/fcTransitionFly.test.js
// Tests for the File Cabinet fly transitions in js/uiTransitions.js:
//
//   expand   drawer tab -> board card   (raise + reveal, fly, expand)
//   collapse board card -> drawer tab   (mirror of expand)
//
// The reveal half of expand is what fixes "expanded note renders under its
// neighbours" and "expanded note landed off-screen": the card is raised and
// scrolled into view BEFORE the fly target is measured. The ordering assertions
// below pin exactly that, because a count-only check would let a future reorder
// pass silently.
//
// Run with: npm test  (node --test test/)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const FLY_MS = 180;
const SETTLE_MS = 160;
const OVERLAY_KEY = 'matrix_board_overlay';

let events = [];
let overlays = [];
let allElements = [];
let timers = [];
let timerSeq = 0;
let rafQueue = [];
let scrollCalls = [];
let card = null;
let canvas = null;
let cabinet = null;
let ui = null;

function makeEl(extra = {}) {
    const classes = new Set();
    const el = {
        dataset: {},
        removedClasses: [],
        isConnected: true,
        offsetWidth: 0,
        removed: false,
        attrs: {},
        className: '',
        style: {},
        classList: {
            add: (...names) => {
                names.forEach((name) => {
                    classes.add(name);
                    if (name === 'ui-fc-expand-pending' || name === 'ui-fc-collapse-pending') {
                        events.push('pending-add');
                    }
                });
            },
            remove: (...names) => names.forEach((name) => {
                classes.delete(name);
                el.removedClasses.push(name);
            }),
            contains: (name) => classes.has(name),
            toggle: (name, force) => {
                const want = force === undefined ? !classes.has(name) : !!force;
                if (want) classes.add(name);
                else classes.delete(name);
                return want;
            }
        },
        setAttribute(name, value) { el.attrs[name] = value; },
        removeAttribute(name) { delete el.attrs[name]; },
        addEventListener() {},
        removeEventListener() {},
        appendChild(child) { return child; },
        remove() {
            el.removed = true;
            overlays = overlays.filter((o) => o !== el);
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        closest: () => null,
        ...extra
    };
    allElements.push(el);
    return el;
}

function makeCanvas({ viewGrid = false } = {}) {
    const el = makeEl({
        querySelector: (selector) => {
            const match = /data-id="([^"]+)"/.exec(selector);
            if (!match || !card) return null;
            return match[1] === card.dataset.id ? card : null;
        }
    });
    el.classList.contains = (name) => (name === 'view-grid' ? viewGrid : false);
    return el;
}

function makeCabinet() {
    const el = makeEl({ tabs: [], chips: [] });
    el.querySelectorAll = (selector) => {
        if (selector === '.file-cabinet-tab') return el.tabs;
        if (selector === '.file-cabinet-filed-chip') return el.chips;
        return [];
    };
    return el;
}

function addTab({ id, width = 64 } = {}) {
    const tab = makeEl({
        dataset: { id },
        getBoundingClientRect: () => ({ left: 500, top: 320, width, height: 24, x: 500, y: 320 })
    });
    cabinet.tabs.push(tab);
    return tab;
}

function addChip({ category, width = 140 } = {}) {
    const chip = makeEl({
        dataset: { category },
        getBoundingClientRect: () => ({ left: 40, top: 340, width, height: 28, x: 40, y: 340 })
    });
    cabinet.chips.push(chip);
    return chip;
}

function makeCard({ id = 'a1' } = {}) {
    let measured = false;
    return makeEl({
        dataset: { id },
        getBoundingClientRect: () => {
            if (!measured) {
                measured = true;
                events.push('measure');
            }
            return { left: 100, top: 120, width: 120, height: 60, x: 100, y: 120 };
        },
        scrollIntoView: (opts) => {
            events.push('scroll');
            scrollCalls.push(opts);
        }
    });
}

function makeUI() {
    const calls = { raise: [], reflow: [], apply: [], finalize: 0 };
    const stub = {
        calls,
        frontOwner: null,
        readNoteRect: () => ({ x: 10, y: 20, w: 120, h: 60 }),
        applyNoteRect: (target, rect) => calls.apply.push(rect),
        finalizeDesktopCard: () => { calls.finalize += 1; },
        raiseDesktopCard: (target) => {
            events.push('raise');
            calls.raise.push(target);
            stub.frontOwner = target?.dataset?.id ?? null;
        },
        reflowGridBoard: () => calls.reflow.push(true)
    };
    return stub;
}

const RECT = { left: 500, top: 300, width: 65, height: 32, x: 500, y: 300 };

function installDom({ viewGrid = false, overlay = false } = {}) {
    events = [];
    overlays = [];
    allElements = [];
    timers = [];
    timerSeq = 0;
    rafQueue = [];
    scrollCalls = [];

    const body = makeEl();
    body.classList.add = (name) => events.push(`body-add:${name}`);
    body.classList.remove = (name) => events.push(`body-remove:${name}`);
    body.classList.contains = () => false;

    cabinet = makeCabinet();
    canvas = makeCanvas({ viewGrid });
    card = null;

    const doc = {
        documentElement: { dataset: {}, style: { setProperty() {} } },
        body,
        activeElement: null,
        addEventListener() {},
        getElementById: (id) => {
            if (id === 'app-canvas') return canvas;
            if (id === 'file-cabinet') return cabinet;
            return null;
        },
        createElement: () => {
            const el = makeEl();
            overlays.push(el);
            return el;
        },
        querySelectorAll: (selector) => {
            const names = selector.split(',').map((part) => part.trim().replace(/^\./, ''));
            return allElements.filter((el) => names.some((name) => el.classList.contains(name)));
        }
    };

    globalThis.document = doc;
    globalThis.localStorage = {
        getItem: (key) => (key === OVERLAY_KEY && overlay ? '1' : null),
        setItem() {},
        removeItem() {},
        clear() {}
    };
    globalThis.window = {
        setTimeout: (fn, ms) => {
            timerSeq += 1;
            timers.push({ id: timerSeq, fn, ms });
            return timerSeq;
        },
        clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); },
        matchMedia: () => ({ matches: false })
    };
    globalThis.CSS = { escape: (value) => String(value) };
    globalThis.requestAnimationFrame = (cb) => {
        rafQueue.push(cb);
        return rafQueue.length;
    };

    ui = makeUI();
    return doc;
}

function runTimers(ms) {
    const due = timers.filter((t) => t.ms === ms);
    timers = timers.filter((t) => t.ms !== ms);
    due.forEach((t) => t.fn());
}

function pendingTimers(ms) {
    return timers.filter((t) => t.ms === ms);
}

function flushRaf() {
    const queued = rafQueue.splice(0);
    queued.forEach((cb) => cb());
}

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

const bodyEvents = () => events.filter((e) => e.startsWith('body-')).map((e) => e.slice(5));

const UT = await import('../js/uiTransitions.js');

beforeEach(() => {
    installDom();
});



describe('fc collapse target resolution', () => {
    it('targets the laid-out tab of the destination drawer and hides it', () => {
        installDom();
        const tab = addTab({ id: 'a1' });

        const target = UT.resolveFileCabinetCollapseTarget('a1', 'Office');

        assert.equal(target.el, tab);
        assert.equal(target.hide, true);
    });

    it('skips a zero-width tab and falls back to the chip without hiding it', () => {
        installDom();
        addTab({ id: 'a1', width: 0 });
        const chip = addChip({ category: 'Office' });

        const target = UT.resolveFileCabinetCollapseTarget('a1', 'Office');

        assert.equal(target.el, chip);
        assert.equal(target.hide, false, 'the chip carries the category name and count');
    });

    it('returns null when neither a tab nor a chip is laid out', () => {
        installDom();
        addChip({ category: 'Office', width: 0 });

        assert.equal(UT.resolveFileCabinetCollapseTarget('a1', 'Office'), null);
        assert.equal(UT.resolveFileCabinetCollapseTarget('', 'Office'), null);
    });
});

describe('fc collapse fly', () => {
    it('flies the note into the tab and only reveals it on landing', async () => {
        installDom();
        const tab = addTab({ id: 'a1' });
        UT.beginFcTransition('a1');
        events = [];

        const run = UT.runFcCollapseAfterRender({ itemId: 'a1', category: 'Office', sourceRect: RECT });

        assert.equal(tab.classList.contains('ui-fc-collapse-pending'), true, 'tab hidden during the fly');
        assert.equal(overlays.length, 1, 'one overlay carries the flying note');
        assert.match(String(overlays[0].style.transform), /translate\(500px, 320px\)/);

        runTimers(FLY_MS);
        await run;

        assert.equal(tab.classList.contains('ui-fc-collapse-pending'), false, 'tab revealed on landing');
        assert.equal(overlays.length, 0);
        assert.equal(bodyEvents().includes('remove:is-fc-transitioning'), true);
        assert.equal(document.body.dataset.fcTransitionId, undefined);
    });

    it('skips the fly when Smooth is off', async () => {
        installDom();
        document.documentElement.dataset.uiTransitions = 'off';
        const tab = addTab({ id: 'a1' });
        UT.beginFcTransition('a1');

        await UT.runFcCollapseAfterRender({ itemId: 'a1', category: 'Office', sourceRect: RECT });

        assert.equal(tab.classList.contains('ui-fc-collapse-pending'), false);
        assert.equal(overlays.length, 0);
    });

    it('leaves the newer transition in charge when superseded', async () => {
        installDom();
        const tab = addTab({ id: 'a1' });
        UT.beginFcTransition('a1');
        const run = UT.runFcCollapseAfterRender({ itemId: 'a1', category: 'Office', sourceRect: RECT });
        assert.equal(tab.classList.contains('ui-fc-collapse-pending'), true);

        UT.beginFcTransition('other');
        runTimers(FLY_MS);
        await run;

        assert.equal(tab.classList.contains('ui-fc-collapse-pending'), false, 'own class cleared in finally');
        assert.equal(overlays.length, 0);
        assert.equal(document.body.dataset.fcTransitionId, 'other', 'gen guard keeps the newer body state');
        assert.equal(bodyEvents().includes('remove:is-fc-transitioning'), false);
    });
});

describe('fc expand reveal', () => {
    it('raises and scrolls the card, then measures the fly target — in that order', async () => {
        installDom();
        card = makeCard({ id: 'a1' });
        UT.beginFcTransition('a1');
        events = [];

        const run = UT.runFcExpandAfterRender({ itemId: 'a1', sourceRect: RECT, UI: ui });
        assert.deepEqual(events.slice(0, 3), ['raise', 'scroll', 'pending-add']);
        assert.equal(card.classList.contains('ui-fc-expand-pending'), true);

        await flushMicrotasks();
        assert.deepEqual(events.slice(0, 4), ['raise', 'scroll', 'pending-add', 'measure']);
        assert.deepEqual(
            scrollCalls,
            [{ block: 'nearest', inline: 'nearest' }],
            'instant scroll, no behavior key: the fly target is measured after it'
        );

        runTimers(FLY_MS);
        await flushMicrotasks();

        assert.equal(card.classList.contains('ui-fc-expand-pending'), false);
        assert.equal(pendingTimers(SETTLE_MS).length, 1);
        assert.equal(ui.calls.raise.length, 1, 'the raise happens once, never from the settle timer');
        assert.equal(ui.calls.finalize, 2, 'saved size restored, then re-applied at landing');

        runTimers(SETTLE_MS);
        assert.equal(card.removedClasses.includes('layout-settling'), true);
        assert.equal(ui.calls.raise.length, 1, 'settle still does not re-raise');
    });

    it('keeps the ring with a card the user clicks during the fly', async () => {
        installDom();
        card = makeCard({ id: 'a1' });
        const other = makeCard({ id: 'c' });
        UT.beginFcTransition('a1');

        const run = UT.runFcExpandAfterRender({ itemId: 'a1', sourceRect: RECT, UI: ui });
        await flushMicrotasks();

        ui.raiseDesktopCard(other);
        runTimers(FLY_MS);
        await flushMicrotasks();
        runTimers(SETTLE_MS);

        assert.equal(ui.frontOwner, 'c');
        assert.equal(ui.calls.raise.length, 2, 'expand raised once; the click was the only later raise');
        void run;
    });

    it('raises and scrolls even when Smooth is off', async () => {
        installDom();
        document.documentElement.dataset.uiTransitions = 'off';
        card = makeCard({ id: 'a1' });
        UT.beginFcTransition('a1');

        await UT.runFcExpandAfterRender({ itemId: 'a1', sourceRect: RECT, UI: ui });

        assert.equal(ui.calls.raise.length, 1);
        assert.deepEqual(scrollCalls, [{ block: 'nearest', inline: 'nearest' }]);
        assert.equal(card.classList.contains('ui-fc-expand-pending'), false);
        assert.equal(overlays.length, 0);
        assert.equal(ui.calls.reflow.length, 0, 'no overlay mode → no bento push');
    });

    it('drops the bento push of a superseded expand', async () => {
        installDom({ viewGrid: true, overlay: true });
        card = makeCard({ id: 'a1' });
        UT.beginFcTransition('a1');

        const run = UT.runFcExpandAfterRender({ itemId: 'a1', sourceRect: RECT, UI: ui });
        await flushMicrotasks();
        runTimers(FLY_MS);
        await flushMicrotasks();
        assert.equal(rafQueue.length, 1, 'bento push scheduled at landing');

        UT.beginFcTransition('other');
        flushRaf();
        await run;

        assert.equal(ui.calls.reflow.length, 0, 'stale generation must not reflow the board');
        runTimers(SETTLE_MS);
    });
});

