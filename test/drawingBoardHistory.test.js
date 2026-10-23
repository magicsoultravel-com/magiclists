// test/drawingBoardHistory.test.js
// Unit guards for the drawing board's undo stacks: push/undo/redo round-trips,
// duplicate suppression, HISTORY_MAX trimming, and the onChange hook the toolbar
// depends on. A push that does not notify leaves Undo greyed out, which is the
// bug that made the toolbar look broken until some other click re-rendered it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DrawingHistory } from '../js/drawingBoard.js';
import { HISTORY_MAX } from '../js/drawingBoardCore.js';

function layer(n) {
    return { kind: 'layer', activePageId: 'p1', strokes: [{ id: 's' + n }] };
}

describe('DrawingHistory stacks', () => {
    it('round-trips a snapshot through undo and redo', () => {
        const h = new DrawingHistory();
        h.push(layer(1));
        assert.equal(h.canUndo, true);
        assert.equal(h.canRedo, false);

        assert.deepEqual(h.undo(layer(2)), layer(1));
        assert.equal(h.canUndo, false);
        assert.equal(h.canRedo, true);

        assert.deepEqual(h.redo(layer(1)), layer(2));
        assert.equal(h.canUndo, true);
        assert.equal(h.canRedo, false);
    });

    it('returns null instead of throwing on an empty stack', () => {
        const h = new DrawingHistory();
        assert.equal(h.undo(layer(1)), null);
        assert.equal(h.redo(layer(1)), null);
        assert.equal(h.canUndo, false);
        assert.equal(h.canRedo, false);
    });

    it('clears both stacks', () => {
        const h = new DrawingHistory();
        h.push(layer(1));
        h.undo(layer(2));
        h.clear();
        assert.equal(h.canUndo, false);
        assert.equal(h.canRedo, false);
    });

    it('suppresses a duplicate of the newest entry and keeps the redo stack', () => {
        const h = new DrawingHistory();
        h.push(layer(1));
        h.push(layer(2));
        h.undo(layer(3));            // undo stack: [1], redo stack: [3]
        h.push(layer(1));            // identical to the top -> ignored
        assert.equal(h.undoStack.length, 1);
        assert.equal(h.canRedo, true, 'a no-op push must not discard redo');
        assert.deepEqual(h.redo(layer(1)), layer(3));
    });

    it('trims to HISTORY_MAX and drops the oldest entry first', () => {
        const h = new DrawingHistory();
        const total = HISTORY_MAX + 5;
        for (let i = 1; i <= total; i += 1) h.push(layer(i));
        assert.equal(h.undoStack.length, HISTORY_MAX);

        const popped = [];
        let current = layer(total + 1);
        let next = h.undo(current);
        while (next) {
            popped.push(next);
            current = next;
            next = h.undo(current);
        }
        assert.equal(popped.length, HISTORY_MAX);
        assert.deepEqual(popped[0], layer(total), 'newest snapshot pops first');
        assert.deepEqual(popped[popped.length - 1], layer(6), 'oldest five were dropped');
    });

    it('notifies onChange on every real stack move only', () => {
        const h = new DrawingHistory();
        let calls = 0;
        h.onChange = () => { calls += 1; };

        h.push(layer(1));
        assert.equal(calls, 1);
        h.push(layer(1));            // duplicate
        assert.equal(calls, 1);
        h.undo(layer(2));
        assert.equal(calls, 2);
        h.redo(layer(1));
        assert.equal(calls, 3);
        h.clear();
        assert.equal(calls, 4);
        h.clear();                   // nothing to drop
        assert.equal(calls, 4);
    });
});
