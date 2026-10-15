// test/flowchartTrayToggle.test.js
// Regression guard for the flowchart tray toggle.
//
// Two bugs shipped here because only the *bind* path was ever tested:
//   1. `UndoManager.record(...)` — that method does not exist on UndoManager
//      (the real API is `push` / `recordItemChange`), so the handler threw a
//      TypeError the moment the button was pressed.
//   2. The toggle body was never executed in any test, so nothing verified the
//      click actually creates the doc and flips flowchartHidden.
// This test presses the button for real and asserts the resulting item state.
import { describe, it, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function makeEl(tag = 'div', dataset = {}) {
    const el = {
        tagName: String(tag).toUpperCase(),
        dataset: { ...dataset },
        classList: {
            _set: new Set(),
            add(...n) { n.forEach((c) => this._set.add(c)); },
            remove(...n) { n.forEach((c) => this._set.delete(c)); },
            toggle(c, force) {
                const on = force === undefined ? !this._set.has(c) : !!force;
                if (on) this._set.add(c); else this._set.delete(c);
                return on;
            },
            contains(c) { return this._set.has(c); }
        },
        children: [],
        attrs: {},
        style: { setProperty() {}, removeProperty() {} },
        _listeners: {},
        appendChild(c) { this.children.push(c); return c; },
        remove() {},
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
        removeAttribute(k) { delete this.attrs[k]; },
        toggleAttribute(k, force) { if (force) this.setAttribute(k, ''); else this.removeAttribute(k); },
        addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
        removeEventListener() {},
        dispatchEvent() { return true; },
        focus() {},
        blur() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        closest() { return null; },
        contains() { return false; },
        matches() { return false; },
        getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
    };
    return el;
}

function buildTray() {
    const card = makeEl('div', { id: 'note-1' });
    const actions = makeEl('div', { actions: '1' });
    const byClass = {};
    for (const selector of ['.card-act--flowchart', '.card-act--planner', '.card-act--draw']) {
        const btn = makeEl('button');
        btn.matches = (s) => s === selector;
        btn.closest = (s) => (s === selector ? btn : null);
        byClass[selector] = btn;
        actions.children.push(btn);
    }
    card.querySelector = (sel) => {
        if (sel === '.card-actions') return actions;
        if (sel === '.editor-note-shell') return card;
        return null;
    };
    card.querySelectorAll = () => [];
    card.contains = () => true;
    actions.querySelectorAll = () => [];
    actions.querySelector = (sel) => byClass[sel] || null;
    actions.closest = () => null;
    return { card, byClass };
}

function installGlobals() {
    globalThis.document = {
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        createElement: (t) => makeEl(t)
    };
    globalThis.window = {
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return true; },
        devicePixelRatio: 1
    };
    // attachCardActionButton defers the handler one frame so blur/autosave settles.
    globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
    globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
}

afterEach(() => {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.localStorage;
    delete globalThis.requestAnimationFrame;
});

describe('flowchart tray toggle', () => {
    it('creates the doc on first press and toggles visibility after', async () => {
        installGlobals();
        const { card, byClass } = buildTray();
        const { bindNoteQuickActions } = await import('../js/noteQuickActions.js');

        const item = { id: 'note-1', title: 'T', content: '' };
        bindNoteQuickActions(card, item, { surface: 'board', ui: {}, card, ctx: {} });

        const btn = byClass['.card-act--flowchart'];
        const press = () => {
            // attachCardActionButton acts on mousedown; click is a no-op after that.
            for (const fn of btn._listeners.mousedown || []) fn({ button: 0, stopPropagation() {}, preventDefault() {} });
        };

        // First press: doc is created and the section is shown.
        press();
        assert.ok(item.flowchart, 'first press should create item.flowchart');
        assert.equal(item.flowchartHidden, false, 'new flowchart should be visible');
        assert.equal(item.flowchart.grid.type, 'dots', 'new flowchart defaults to a dots grid');
        assert.equal(item.flowchart.grid.snap, true, 'new flowchart defaults to snap on');
        assert.equal(btn.getAttribute('aria-pressed'), 'true');
        assert.equal(btn.getAttribute('title'), 'Hide flowchart');

        // Second press: hides it, keeping the doc so drawings survive.
        press();
        assert.equal(item.flowchartHidden, true, 'second press should hide');
        assert.ok(item.flowchart, 'hiding must not discard the doc');
        assert.equal(btn.getAttribute('aria-pressed'), 'false');
        assert.equal(btn.getAttribute('title'), 'Show flowchart');

        // Third press: shows it again.
        press();
        assert.equal(item.flowchartHidden, false);
        assert.equal(btn.getAttribute('aria-pressed'), 'true');
    });
});
