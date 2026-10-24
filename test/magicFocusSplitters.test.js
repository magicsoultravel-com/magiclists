// test/magicFocusSplitters.test.js
// Characterization tests for js/magicFocus/splitters.js — the resize handles.
//
// Positioning is pure arithmetic on the measured work rect plus the split
// descriptor, which is exactly the part worth pinning: a wrong `top`/`bottom` puts
// the handle for a half-height pane across the full column, and a `left` computed
// from the wrong ratio makes the drag jump on first pointer move. The drag itself
// needs pointer geometry and a live board, so it is documented as browser-only.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as Splitters from '../js/magicFocus/splitters.js';

const styleStub = () => ({
    left: '', right: '', top: '', bottom: '',
    removed: [],
    removeProperty(k) { this[k] = ''; }
});

const elStub = (style = styleStub()) => ({ style, dataset: {}, className: '' });

const workStub = (rect = { width: 800, height: 600 }) => ({
    rect,
    getBoundingClientRect() { return this.rect; }
});

describe('focus splitters · positioning a column handle', () => {
    it('spans the full height at the split ratio', () => {
        const el = elStub();
        const work = workStub();

        Splitters._positionSplitter({}, el, { type: 'col', pos: 0.5 }, work);

        assert.equal(el.style.left, '50%');
        assert.equal(el.style.top, '0');
        assert.equal(el.style.bottom, '0');
        assert.equal(el.style.right, '');
    });

    it('bands a handle to the bottom row in 1-over-2', () => {
        const el = elStub();
        const work = workStub();

        Splitters._positionSplitter({}, el, { type: 'col', pos: 0.4, band: 'bottom' }, work, { ratios: [0.45] });

        assert.equal(el.style.top, '45%');
        assert.equal(el.style.bottom, '0');
    });

    it('bands a handle to the top row in 2-over-1', () => {
        const el = elStub();
        const work = workStub();

        Splitters._positionSplitter({}, el, { type: 'col', pos: 0.4, band: 'top' }, work, { ratios: [0.3] });

        assert.equal(el.style.top, '0');
        assert.equal(el.style.bottom, '70%');
    });

    it('falls back to the 45% row split when no focus is passed', () => {
        const el = elStub();

        Splitters._positionSplitter({}, el, { type: 'col', pos: 0.5, band: 'top' }, workStub(), null);

        assert.ok(Math.abs(parseFloat(el.style.bottom) - 55) < 1e-9, `bottom drifted to ${el.style.bottom}`);
    });
});

describe('focus splitters · positioning a row handle', () => {
    it('spans the full width at the split ratio', () => {
        const el = elStub();

        Splitters._positionSplitter({}, el, { type: 'row', pos: 0.25 }, workStub());

        assert.equal(el.style.top, '25%');
        assert.equal(el.style.left, '0');
        assert.equal(el.style.right, '0');
        assert.equal(el.style.bottom, '');
    });
});

describe('focus splitters · degenerate geometry', () => {
    it('leaves the handle alone while the workspace has no size', () => {
        const el = elStub();

        Splitters._positionSplitter({}, el, { type: 'col', pos: 0.5 }, workStub({ width: 0, height: 0 }));

        assert.equal(el.style.left, '');
        assert.equal(el.style.top, '');
    });
});

describe('focus splitters · mounting', () => {
    const withDocument = (fn) => {
        const prev = globalThis.document;
        const created = [];
        globalThis.document = {
            createElement: () => {
                const el = elStub();
                created.push(el);
                return el;
            }
        };
        try {
            return fn(created);
        } finally {
            globalThis.document = prev;
        }
    };

    it('removes the old handles and mounts one per descriptor', () => withDocument((created) => {
        const removed = [];
        const appended = [];
        const work = {
            getBoundingClientRect: () => ({ width: 800, height: 600 }),
            querySelectorAll: (sel) => {
                assert.equal(sel, '.magic-focus__splitter');
                return [
                    { remove: () => removed.push(1) },
                    { remove: () => removed.push(2) }
                ];
            },
            appendChild: (el) => appended.push(el)
        };
        const positioned = [];
        const bound = [];
        const magicFocus = {
            bodyEl: { querySelector: () => work },
            _positionSplitter: (el, split) => positioned.push(split.type),
            _bindSplitterDrag: (el, split) => bound.push(split.type)
        };
        const layout = { splitters: [{ type: 'col', pos: 0.5, ratioIndex: 0 }, { type: 'row', pos: 0.5, ratioIndex: 1 }] };

        Splitters._mountSplitters(magicFocus, null, layout);

        assert.equal(removed.length, 2, 'stale handles must go before re-mounting');
        assert.deepEqual(positioned, ['col', 'row']);
        assert.deepEqual(bound, ['col', 'row']);
        assert.equal(appended.length, 2);
        assert.equal(created[0].dataset.ratioIndex, '0');
        assert.match(created[1].className, /magic-focus__splitter--row/);
    }));

    it('does nothing without a workspace', () => withDocument(() => {
        assert.doesNotThrow(() => Splitters._mountSplitters({ bodyEl: null }, null, { splitters: [] }));
    }));
});
