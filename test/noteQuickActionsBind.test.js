// test/noteQuickActionsBind.test.js
// Regression guard for the board tray binding path.
//
// A `commit` option referencing an out-of-scope identifier threw a ReferenceError
// inside wireSharedActions on every board render, which surfaced as a fatal sync
// failure that wiped the whole board. The identifier was only reachable at call
// time, so module import and `node --check` both passed and unit tests on the
// flowchart model never noticed. This test binds the real board tray instead.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/** Minimal element stub: enough for querySelector/closest/addEventListener. */
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
        removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
        remove() {},
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
        removeAttribute(k) { delete this.attrs[k]; },
        toggleAttribute(k, force) {
            if (force) this.setAttribute(k, ''); else this.removeAttribute(k);
        },
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

/** Build the tray markup shape bindNoteQuickActions actually queries for. */
function buildTray(itemId) {
    const cls = {
        '.card-act--flowchart': 'flowchartBtn',
        '.card-act--planner': 'plannerBtn',
        '.card-act--draw': 'drawBtn'
    };
    const card = makeEl('div', { id: itemId });
    const actions = makeEl('div', { actions: '1' });
    const byClass = {};
    for (const selector of Object.keys(cls)) {
        const btn = makeEl('button');
        btn.matches = (s) => s === selector;
        btn.closest = (s) => (s === selector ? btn : null);
        byClass[selector] = btn;
        actions.children.push(btn);
    }
    card.querySelector = (sel) => {
        if (sel === '.card-actions') return actions;
        if (sel === '.editor-note-shell') return card;
        if (sel === '.note-editor-toolbar') return null;
        return null;
    };
    card.querySelectorAll = () => [];
    card.contains = () => true;
    actions.querySelectorAll = () => [];
    actions.querySelector = (sel) => byClass[sel] || null;
    actions.closest = () => null;
    return { card, actions, byClass };
}

afterEach(() => {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.localStorage;
});

describe('bindNoteQuickActions board tray', () => {
    it('binds the board tray without a ReferenceError', async () => {
        const { card, actions, byClass } = buildTray('note-1');
        globalThis.document = {
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => []
        };
        globalThis.window = { addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1 };
        globalThis.localStorage = {
            getItem: () => null,
            setItem() {},
            removeItem() {}
        };

        const { bindNoteQuickActions } = await import('../js/noteQuickActions.js');

        const item = { id: 'note-1', title: 'T', content: '', flowchart: null };
        // The crash happened at bind time, not click time, so simply binding is
        // the assertion surface. Anything out of scope in the handler options
        // throws here.
        assert.doesNotThrow(() => {
            bindNoteQuickActions(card, item, {
                surface: 'board',
                ui: {},
                card,
                ctx: {}
            });
        }, 'bindNoteQuickActions must not throw while wiring the flowchart tray button');

        // Every tray button got a mousedown listener (the commit-then-act path).
        for (const [selector, btn] of Object.entries(byClass)) {
            const bound = btn._listeners.mousedown || [];
            assert.ok(bound.length > 0, `${selector} should receive a mousedown listener`);
        }
        assert.ok(actions.children.length > 0);
    });
});
