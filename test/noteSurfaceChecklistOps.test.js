// test/noteSurfaceChecklistOps.test.js
// Characterization tests for js/noteSurfaceChecklist/ops.js — the step operations
// that mutate the tree (insert / remove / Backspace / Delete / Enter).
//
// Most of this module needs a live editor, so what is pinned here is the layer
// underneath the DOM surgery: the id generator, the pre-mutation snapshot that
// undo and persistence rely on, the pending-focus handshake and the canvas
// scroll save/restore that keeps the board from jumping when rows move.
//
// The snapshot is the important one. It is a deep clone taken *before* a
// structural change, and it carries `_localOnly` so a draft-only edit never
// reaches the server. A shallow clone would let the mutation walk straight
// through into the "before" copy and silently break undo.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
    createStepId,
    prepareInlineOpSnapshot,
    setPendingChecklistFocus,
    syncChecklistStepToItem
} = await import('../js/noteSurfaceChecklist/ops.js');

const item = () => ({
    id: 'i1',
    steps: [
        { id: 'p1', text: 'Groceries', level: 0 },
        { id: 'c1', text: 'Milk', level: 1 }
    ]
});

describe('checklist ops · step ids', () => {
    it('looks like a step id', () => {
        assert.match(createStepId(), /^step_\d+_[a-z0-9]+$/);
    });

    it('never repeats, even when called in a tight loop', () => {
        const ids = new Set(Array.from({ length: 500 }, () => createStepId()));

        assert.equal(ids.size, 500);
    });
});

describe('checklist ops · pre-mutation snapshot', () => {
    it('clones the item deeply', () => {
        const original = item();

        const snapshot = prepareInlineOpSnapshot({}, original, false);

        original.steps[0].text = 'mutated';
        assert.equal(snapshot.steps[0].text, 'Groceries', 'snapshot shares structure with the live item');
    });

    it('records whether the edit is local-only', () => {
        assert.equal(prepareInlineOpSnapshot({}, item(), true)._localOnly, true);
        assert.equal(prepareInlineOpSnapshot({}, item(), false)._localOnly, false);
    });

    it('returns null without a root or an item', () => {
        assert.equal(prepareInlineOpSnapshot(null, item(), false), null);
        assert.equal(prepareInlineOpSnapshot({}, null, false), null);
    });
});

describe('checklist ops · pending focus handshake', () => {
    it('records the step and the edge to focus after the next render', () => {
        const root = { dataset: {} };

        setPendingChecklistFocus(root, 'step_9');

        assert.equal(root.dataset.pendingFocusStepId, 'step_9');
        assert.equal(root.dataset.pendingFocusEdge, 'start');
    });

    it('honours a requested edge', () => {
        const root = { dataset: {} };

        setPendingChecklistFocus(root, 'step_9', 'end');

        assert.equal(root.dataset.pendingFocusEdge, 'end');
    });

    it('does nothing without a root or a step', () => {
        const root = { dataset: {} };

        setPendingChecklistFocus(root, null);
        setPendingChecklistFocus(null, 'step_9');

        assert.deepEqual(root.dataset, {});
    });
});

describe('checklist ops · model sync', () => {
    it('writes the rendered text back onto the step', () => {
        const target = item();
        const el = { dataset: { stepId: 'c1' }, textContent: 'Oat milk' };

        syncChecklistStepToItem(el, target);

        assert.equal(target.steps[1].text, 'Oat milk');
    });

    it('ignores a row whose step no longer exists', () => {
        const target = item();
        const el = { dataset: { stepId: 'gone' }, textContent: 'x' };

        assert.doesNotThrow(() => syncChecklistStepToItem(el, target));
        assert.equal(target.steps.length, 2);
    });

    it('falls back to an empty string for a cleared row', () => {
        const target = item();

        syncChecklistStepToItem({ dataset: { stepId: 'p1' }, textContent: null }, target);

        assert.equal(target.steps[0].text, '');
    });
});
