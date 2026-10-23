// test/drawingBoardUndoWiring.test.js
// Regression guards for the wiring between the history stacks and the toolbar.
// The reported bug: pushLayerHistory() moved the stacks but never the DOM, so
// #draw-undo stayed disabled until an unrelated click re-rendered the toolbar —
// undo looked broken, and the button silently no-opped when clicked.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DrawingBoard, DrawingHistory, wireHistoryToolbar } from '../js/drawingBoard.js';
import { eraseAt } from '../js/drawingBoardSelection.js';

function makeButton(disabled = true) {
    const attrs = new Set(disabled ? ['disabled'] : []);
    return {
        toggleAttribute(name, force) {
            if (force) attrs.add(name);
            else attrs.delete(name);
            return force;
        },
        hasAttribute: (name) => attrs.has(name),
        style: { setProperty() {}, background: '' },
        querySelector: () => null,
        textContent: ''
    };
}

function makeToolbar() {
    const undo = makeButton();
    const redo = makeButton();
    const bySelector = { '#draw-undo': undo, '#draw-redo': redo };
    return { undo, redo, querySelector: (sel) => bySelector[sel] || null };
}

function makeDoc() {
    return {
        version: 2,
        canvasMode: 'a4',
        activePageId: 'p1',
        pages: [
            { id: 'p1', format: 'a4', background: 'grid', backgroundColor: '', strokes: [{ id: 'a1' }], texts: [], images: [] },
            { id: 'p2', format: 'a4', background: 'dots', backgroundColor: '#ffffff', strokes: [{ id: 'b1' }], texts: [], images: [] }
        ]
    };
}

/** Board stub: real history + the real wiring, DOM reduced to observable bits. */
function makeBoard(doc = makeDoc()) {
    const board = Object.create(DrawingBoard);
    board.doc = doc;
    board.active = false;            // scheduleSave() must stay a no-op
    board.selectedStrokes = new Set();
    board.toolbarEl = makeToolbar();
    board.history = new DrawingHistory();
    board.updatePointerWidthLabel = () => {};
    board.updateFlowLabelControls = () => {};
    board.redraw = () => {};
    board.redrawBackground = () => {};
    wireHistoryToolbar(board);
    return board;
}

describe('history -> toolbar wiring', () => {
    it('pushLayerHistory enables undo without waiting for a toolbar render', () => {
        const board = makeBoard();
        assert.equal(board.toolbarEl.undo.hasAttribute('disabled'), true);

        board.pushLayerHistory();

        assert.equal(board.toolbarEl.undo.hasAttribute('disabled'), false, 'undo must be live after a push');
        assert.equal(board.toolbarEl.redo.hasAttribute('disabled'), true);
    });

    it('undo and redo move both buttons with the stacks', () => {
        const board = makeBoard();
        board.pushLayerHistory();

        const slice = board.history.undo(board.getSnapshot());
        assert.ok(slice, 'the snapshot must come back');
        board.applySnapshot(slice);
        assert.equal(board.toolbarEl.undo.hasAttribute('disabled'), true, 'nothing left to undo');
        assert.equal(board.toolbarEl.redo.hasAttribute('disabled'), false, 'redo must become available');

        const restored = board.history.redo(board.getSnapshot());
        assert.ok(restored);
        board.applySnapshot(restored);
        assert.equal(board.toolbarEl.undo.hasAttribute('disabled'), false);
        assert.equal(board.toolbarEl.redo.hasAttribute('disabled'), true);
    });
});

describe('applySnapshot is page-scoped', () => {
    it('restores the page the snapshot was taken on and leaves the other page alone', () => {
        const board = makeBoard();
        const pageOne = board.getLayerUndoSlice();
        assert.equal(pageOne.activePageId, 'p1');

        // User wipes page 1, walks to page 2, then hits undo.
        board.doc.pages[0].strokes = [];
        board.doc.activePageId = 'p2';

        board.applySnapshot(pageOne);

        assert.equal(board.doc.activePageId, 'p1', 'undo must land on the page it belongs to');
        assert.deepEqual(board.doc.pages[0].strokes, [{ id: 'a1' }], 'page 1 content is restored');
        assert.deepEqual(board.doc.pages[1].strokes, [{ id: 'b1' }], 'page 2 must not receive page 1 content');
    });

    it('restores the page background that the slice captured', () => {
        const board = makeBoard();
        const slice = board.getLayerUndoSlice();
        assert.equal(slice.background, 'grid');

        board.doc.pages[0].background = 'hex';
        board.doc.pages[0].backgroundColor = '#123456';
        board.applySnapshot(slice);

        assert.equal(board.doc.pages[0].background, 'grid');
        assert.equal(board.doc.pages[0].backgroundColor, '');
    });
});

describe('eraser history (Issue A)', () => {
    function eraseBoard() {
        const board = makeBoard();
        let pushes = 0;
        const push = board.pushLayerHistory.bind(board);
        board.pushLayerHistory = () => { pushes += 1; push(); };
        board.hitStroke = () => true;
        return { board, pushes: () => pushes };
    }

    it('a misclick on empty canvas records nothing', () => {
        const { board, pushes } = eraseBoard();
        board.doc.pages[0].strokes = [];

        assert.equal(eraseAt(board, 10, 10), false);
        assert.equal(pushes(), 0, 'a no-op erase must not push an undo entry');
        assert.equal(board.history.canUndo, false);
    });

    it('pushes once per gesture, starting at the first real removal', () => {
        const { board, pushes } = eraseBoard();

        assert.equal(eraseAt(board, 10, 10), true);
        assert.equal(pushes(), 1, 'first removal snapshots');
        assert.deepEqual(board.doc.pages[0].strokes, []);

        board.doc.pages[0].strokes = [{ id: 'a2' }];
        assert.equal(eraseAt(board, 11, 11), true);      // same drag
        assert.equal(pushes(), 1, 'the rest of the drag must not stack entries');

        board.doc.pages[0].strokes = [{ id: 'a3' }];
        board.eraseHistoryPushed = false;                // new press resets the flag
        assert.equal(eraseAt(board, 12, 12), true);
        assert.equal(pushes(), 2, 'the next gesture snapshots again');
    });
});
