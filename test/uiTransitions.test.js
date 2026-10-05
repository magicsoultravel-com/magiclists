// Unit tests for Display options transitionsMode + uiTransitions gates.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); }
};

if (typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis;
}
if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        documentElement: { dataset: {} },
        body: {
            classList: {
                _s: new Set(),
                add(c) { this._s.add(c); },
                remove(c) { this._s.delete(c); },
                contains(c) { return this._s.has(c); }
            },
            dataset: {}
        },
        querySelectorAll: () => [],
        getElementById: () => null
    };
}
if (typeof globalThis.matchMedia === 'undefined') {
    globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
}
if (typeof globalThis.CustomEvent === 'undefined') {
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, init = {}) {
            this.type = type;
            this.detail = init.detail;
        }
    };
}

const { readDisplayOptions } = await import('../js/displayOptions.js');
const { isUiTransitionsEnabled, prefersReducedMotion, cancelAll } = await import('../js/uiTransitions.js');

const STORAGE_KEY = 'matrix_display_options';

describe('transitionsMode display option', () => {
    beforeEach(() => {
        store.clear();
    });

    afterEach(() => {
        store.clear();
        document.documentElement.dataset = document.documentElement.dataset || {};
        delete document.documentElement.dataset.uiTransitions;
        cancelAll();
    });

    it('defaults to smooth when unset', () => {
        const opts = readDisplayOptions();
        assert.equal(opts.transitionsMode, 'smooth');
    });

    it('normalizes unknown values to smooth', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ transitionsMode: 'fancy' }));
        assert.equal(readDisplayOptions().transitionsMode, 'smooth');
    });

    it('preserves off', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ transitionsMode: 'off' }));
        assert.equal(readDisplayOptions().transitionsMode, 'off');
    });
});

describe('uiTransitions gates', () => {
    afterEach(() => {
        document.documentElement.dataset.uiTransitions = 'smooth';
        cancelAll();
    });

    it('is disabled when dataset is off', () => {
        document.documentElement.dataset.uiTransitions = 'off';
        assert.equal(isUiTransitionsEnabled(), false);
    });

    it('is enabled when dataset is smooth (unless reduced-motion)', () => {
        document.documentElement.dataset.uiTransitions = 'smooth';
        assert.equal(isUiTransitionsEnabled(), !prefersReducedMotion());
    });
});

describe('layout-settling supports small→large', () => {
    it('board CSS transitions width and height on layout-settling', () => {
        const css = readFileSync(join(HERE, '../css/board.css'), 'utf8');
        const block = css.match(/#app-canvas\.view-grid \.layout-settling\s*\{[^}]+\}/);
        assert.ok(block, 'expected #app-canvas.view-grid .layout-settling rule');
        assert.match(block[0], /width/);
        assert.match(block[0], /height/);
    });
});
