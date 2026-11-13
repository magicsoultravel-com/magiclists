// test/toolPanelChipFlow.test.js
// End-to-end guard for the collapse-to-chip morph in js/toolPanelChrome.js.
// There is no browser (or jsdom) in this repo, so the panel runs against a tiny
// fake DOM that models the two things the behaviour depends on:
//   * `is-hidden` is display:none, so offsets/sizes report 0 while hidden;
//   * WAAPI `animate()` resolves through an explicit finish step.
// That is enough to prove the contract the UI depends on — the token sits on
// the panel's top-left, expanding reopened the panel at the token (clamped, no
// flip), and a collapse → expand pair is a positional no-op.
//
// Run with: npm test
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let reducedMotion = false;
const animations = [];

class FakeStyle {
    constructor() {
        this.width = '';
        this.height = '';
        this.left = '';
        this.top = '';
        this.visibility = '';
        this.transform = '';
        this.transformOrigin = '';
        this.opacity = '';
        this.pointerEvents = '';
        this.cursor = '';
        this.display = '';
    }

    setProperty(name, value) {
        this[name] = value;
    }
}

class FakeClassList {
    constructor() {
        this.names = new Set();
    }

    add(...names) {
        names.forEach((name) => this.names.add(name));
    }

    remove(...names) {
        names.forEach((name) => this.names.delete(name));
    }

    toggle(name, force) {
        const on = force === undefined ? !this.names.has(name) : !!force;
        if (on) this.names.add(name);
        else this.names.delete(name);
        return on;
    }

    contains(name) {
        return this.names.has(name);
    }
}

function findDescendant(el, predicate) {
    for (const child of el.children) {
        if (predicate(child)) return child;
        const nested = findDescendant(child, predicate);
        if (nested) return nested;
    }
    return null;
}

/** Flat parse is enough: every lookup here is a single class selector. */
const TAG_WITH_ATTRS = /<([a-z0-9-]+)([^>]*)>/gi;
const CLASS_ATTR = /class="([^"]*)"/i;
const ID_ATTR = /id="([^"]*)"/i;

class FakeElement {
    constructor(tag = 'div') {
        this.tagName = String(tag).toUpperCase();
        this.nodeType = 1;
        this.children = [];
        this.parentNode = null;
        this.classList = new FakeClassList();
        this.dataset = {};
        this.style = new FakeStyle();
        this.attributes = {};
        this.textContent = '';
        this.focused = false;
        this._markup = '';
        // CSS defaults the fake DOM does not model: the chip is 40×40 and panels
        // always get an explicit width/height from createToolPanel.
        this._contentWidth = 40;
        this._contentHeight = 40;
    }

    get className() {
        return [...this.classList.names].join(' ');
    }

    set className(value) {
        this.classList.names = new Set(String(value).split(/\s+/).filter(Boolean));
    }

    get innerHTML() {
        return this._markup;
    }

    set innerHTML(markup) {
        this._markup = String(markup);
        this.children = [];
        TAG_WITH_ATTRS.lastIndex = 0;
        let match;
        while ((match = TAG_WITH_ATTRS.exec(this._markup))) {
            const attrs = match[2] || '';
            if (attrs.trimEnd().endsWith('/')) continue;
            const child = new FakeElement(match[1]);
            const classMatch = CLASS_ATTR.exec(attrs);
            if (classMatch) child.className = classMatch[1];
            const idMatch = ID_ATTR.exec(attrs);
            if (idMatch) child.id = idMatch[1];
            child.parentNode = this;
            this.children.push(child);
        }
    }

    _isDisplayNone() {
        return this.classList.contains('is-hidden') || this.classList.contains('is-collapsed');
    }

    get offsetLeft() {
        return this._isDisplayNone() ? 0 : parseFloat(this.style.left) || 0;
    }

    get offsetTop() {
        return this._isDisplayNone() ? 0 : parseFloat(this.style.top) || 0;
    }

    get offsetWidth() {
        if (this._isDisplayNone()) return 0;
        const w = parseFloat(this.style.width);
        return Number.isFinite(w) ? w : this._contentWidth;
    }

    get offsetHeight() {
        if (this._isDisplayNone()) return 0;
        const h = parseFloat(this.style.height);
        return Number.isFinite(h) ? h : this._contentHeight;
    }

    appendChild(node) {
        node.parentNode = this;
        this.children.push(node);
        return node;
    }

    querySelector(selector) {
        const match = /^\.([\w-]+)$/.exec(String(selector).trim());
        if (!match) return null;
        return findDescendant(this, (el) => el.classList.contains(match[1]));
    }

    querySelectorAll() {
        return [];
    }

    closest() {
        return null;
    }

    addEventListener() {}

    removeEventListener() {}

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    getAttribute(name) {
        return this.attributes[name] ?? null;
    }

    setPointerCapture() {}

    releasePointerCapture() {}

    focus() {
        this.focused = true;
    }

    remove() {
        if (this.parentNode) {
            this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
            this.parentNode = null;
        }
    }

    animate(keyframes, options) {
        const animation = {
            keyframes,
            options,
            cancelled: false,
            _finishHandlers: [],
            cancel() {
                this.cancelled = true;
            },
            addEventListener(type, handler) {
                if (type === 'finish') this._finishHandlers.push(handler);
            },
            finishNow() {
                if (this.cancelled) return;
                this._finishHandlers.forEach((handler) => handler());
            }
        };
        animations.push(animation);
        return animation;
    }
}

const storage = new Map();
const localStorageStub = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
};

globalThis.window = {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: reducedMotion }),
    localStorage: localStorageStub
};
globalThis.localStorage = localStorageStub;
globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    getElementById: () => null,
    querySelector: () => null,
    addEventListener() {}
};

const { createToolPanel } = await import('../js/toolPanelChrome.js');

function savedPanelState(toolId) {
    const all = JSON.parse(localStorageStub.getItem('magiclists_tool_panels') || '{}');
    return all[toolId] || {};
}

/** Complete the most recent in-flight WAAPI animation. */
function finishAnimation() {
    const animation = animations.pop();
    assert.ok(animation, 'expected an in-flight animation');
    animation.finishNow();
}

function makePanel(toolId = 'calendar', meta = {}) {
    const desktop = new FakeElement('div');
    desktop.id = 'tools-desktop';
    const callbacks = {};
    const chrome = createToolPanel(
        toolId,
        { label: 'Calendar', defaultSize: { w: 340, h: 380 }, resizable: false, ...meta },
        desktop,
        callbacks
    );
    chrome.show();
    chrome.panel.style.left = '400px';
    chrome.panel.style.top = '300px';
    const chip = () => desktop.children.find((el) => el.classList.contains('tool-chip'));
    return { chrome, desktop, chip, callbacks };
}

describe('tool panel collapse → chip', () => {
    beforeEach(() => {
        animations.length = 0;
        reducedMotion = false;
        storage.clear();
    });

    it('parks the token on the panel top-left and scales the panel onto it', () => {
        const { chrome, chip } = makePanel();
        chrome.collapse();

        const token = chip();
        assert.ok(token, 'chip should be mounted');
        assert.equal(token.offsetLeft, 400);
        assert.equal(token.offsetTop, 300);
        assert.equal(chrome.panel.style.transformOrigin, '0px 0px');
        assert.equal(chrome.panel.style.pointerEvents, 'none');

        const morph = animations.at(-1);
        const [, sx, sy] = /scale\(([\d.e-]+), ([\d.e-]+)\)/.exec(morph.keyframes[1].transform);
        assert.ok(Math.abs(Number(sx) - 40 / 340) < 1e-9, 'x scale maps panel width onto the token');
        assert.ok(Math.abs(Number(sy) - 40 / 380) < 1e-9, 'y scale maps panel height onto the token');

        finishAnimation(); // panel morph done
        assert.equal(chrome.isCollapsed(), true);
        assert.ok(chrome.panel.classList.contains('is-hidden'));
        assert.ok(!token.classList.contains('is-hidden'));
        assert.equal(token.style.opacity, '0', 'token pops in; opacity is handed to WAAPI');
        assert.equal(token.style.pointerEvents, '');

        finishAnimation(); // token pop-in done
        assert.equal(token.style.opacity, '');

        const persisted = savedPanelState('calendar');
        assert.equal(persisted.collapsed, true);
        assert.equal(persisted.x, 400);
        assert.equal(persisted.w, 340, 'panel geometry survives the collapse');
        assert.equal(persisted.chipX, 400);
        assert.equal(persisted.chipY, 300);
    });

    it('expands at the dragged token, clamped with no flip', () => {
        const { chrome, chip } = makePanel();
        chrome.collapse();
        finishAnimation();
        finishAnimation();

        const token = chip();
        token.style.left = '900px';
        token.style.top = '600px';

        chrome.expand();
        assert.equal(chrome.panel.style.left, `${1200 - 340}px`, 'clamped to the right edge');
        assert.equal(chrome.panel.style.top, `${800 - 380}px`, 'clamped to the bottom edge');
        assert.equal(chrome.panel.style.transformOrigin, '40px 180px', 'grows from the token corner');
        assert.ok(token.classList.contains('is-hidden'));

        finishAnimation();
        assert.ok(!chrome.panel.classList.contains('is-hidden'));
        assert.equal(chrome.panel.style.transform, '');
        assert.equal(chrome.panel.style.visibility, '');
        assert.equal(chrome.panel.style.pointerEvents, '');
    });

    it('is a positional no-op when the token has not moved', () => {
        const { chrome, chip } = makePanel();
        chrome.collapse();
        finishAnimation();
        finishAnimation();

        const token = chip();
        assert.equal(token.offsetLeft, 400);

        chrome.expand();
        finishAnimation();
        assert.equal(chrome.panel.style.left, '400px');
        assert.equal(chrome.panel.style.top, '300px');

        chrome.collapse();
        assert.equal(token.offsetLeft, 400, 'collapsing again keeps the same anchor');
        assert.equal(token.offsetTop, 300);
        finishAnimation();
        finishAnimation();

        chrome.expand();
        finishAnimation();
        assert.equal(chrome.panel.style.left, '400px');
        assert.equal(chrome.panel.style.top, '300px');
    });

    it('swaps instantly when reduced motion is requested', () => {
        const { chrome, chip } = makePanel();
        reducedMotion = true;
        chrome.collapse();

        assert.equal(animations.length, 0, 'no morph under prefers-reduced-motion');
        assert.ok(chrome.panel.classList.contains('is-hidden'));
        const token = chip();
        assert.ok(!token.classList.contains('is-hidden'));
        assert.equal(token.style.opacity, '', 'no pop-in either');
        assert.equal(token.offsetLeft, 400);

        chrome.expand();
        assert.equal(animations.length, 0);
        assert.ok(!chrome.panel.classList.contains('is-hidden'));
        assert.equal(chrome.panel.style.left, '400px');
    });

    it('hands keyboard focus to the token and back to the panel', () => {
        const { chrome, chip } = makePanel();
        const collapseBtn = chrome.panel.querySelector('.card-act--collapse');

        chrome.collapse({ restoreFocus: true });
        finishAnimation();
        finishAnimation();
        assert.equal(chip().querySelector('.tool-chip__expand').focused, true);

        chrome.expand({ restoreFocus: true });
        finishAnimation();
        assert.equal(collapseBtn.focused, true);
    });

    it('does nothing when collapsed again while already at rest', () => {
        const { chrome, chip } = makePanel();
        chrome.collapse();
        finishAnimation();
        finishAnimation();
        const token = chip();

        chrome.collapse();
        assert.equal(animations.length, 0, 'second collapse is a no-op');
        assert.equal(token.offsetLeft, 400);
        assert.equal(savedPanelState('calendar').x, 400, 'saved rect is not zeroed');
    });
});

