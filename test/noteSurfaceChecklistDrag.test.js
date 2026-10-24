// test/noteSurfaceChecklistDrag.test.js
// Characterization tests for js/noteSurfaceChecklist/drag.js — pointer dragging of
// checklist steps.
//
// The whole gesture runs off pointer events and live geometry, so there is no
// meaningful way to drive a real drag here (no jsdom in this project). What is
// pinned instead is the binding contract, which is where regressions actually
// bite: the handler is bound per item id and *only* once, because a re-render
// that re-binds would stack a second set of document-level listeners and every
// drop would then be applied twice.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { attachChecklistDrag } = await import('../js/noteSurfaceChecklist/drag.js');

const item = () => ({ id: 'i1', steps: [{ id: 'p1', text: 'Groceries', level: 0 }] });

const stubRoot = () => {
    const listeners = [];
    return {
        dataset: {},
        listeners,
        addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
        querySelector: () => null,
        querySelectorAll: () => []
    };
};

describe('checklist drag · binding contract', () => {
    it('ignores a missing root or item', () => {
        assert.doesNotThrow(() => attachChecklistDrag(null, item()));
        assert.doesNotThrow(() => attachChecklistDrag(stubRoot(), null));
    });

    it('marks the root as bound to this item', () => {
        const root = stubRoot();

        attachChecklistDrag(root, item());

        assert.equal(root.dataset.checklistDragBound, 'i1');
    });

    it('binds a single capture-phase pointerdown listener', () => {
        const root = stubRoot();

        attachChecklistDrag(root, item());

        assert.equal(root.listeners.length, 1);
        assert.equal(root.listeners[0].type, 'pointerdown');
        assert.equal(root.listeners[0].capture, true, 'drag must win over the card drag handler');
    });

    it('does not stack listeners when the same item renders again', () => {
        const root = stubRoot();

        attachChecklistDrag(root, item());
        attachChecklistDrag(root, item());
        attachChecklistDrag(root, item());

        assert.equal(root.listeners.length, 1, 'a rebind would apply every drop twice');
    });

    it('rebinds when a different item takes over the root', () => {
        const root = stubRoot();
        const other = { id: 'i2', steps: [] };

        attachChecklistDrag(root, item());
        root._checklistDragData = null; // no stale document listeners in this stub
        attachChecklistDrag(root, other);

        assert.equal(root.dataset.checklistDragBound, 'i2');
        assert.equal(root.listeners.length, 2);
    });
});
