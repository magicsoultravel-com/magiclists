// test/drawingBoardDocument.test.js
// js/drawingBoard/document.js owns snapshots, undo/redo application and the
// debounced save. The subtle rule here is the one the comment in applySnapshot
// spells out: a layer snapshot must be restored on the page it was taken on, or
// undoing on page 2 silently swaps page 1's strokes into page 2.
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    applySnapshot,
    clearAll,
    getLayerUndoSlice,
    getSnapshot,
    redo,
    restoreSnapshotPage,
    undo
} from '../js/drawingBoard/document.js';
import { DrawingHistory } from '../js/drawingBoard/history.js';

function makeDoc() {
    return {
        canvasMode: 'pages',
        activePageId: 'p2',
        pages: [
            { id: 'p1', strokes: [{ id: 'a' }], texts: [], images: [], background: 'grid', backgroundColor: '#111111' },
            { id: 'p2', strokes: [{ id: 'b' }], texts: [{ id: 't1' }], images: [], background: 'blank', backgroundColor: '' }
        ]
    };
}

function makeBoard(overrides = {}) {
    const calls = {
        redraw: 0, redrawBackground: 0, resize: 0, scheduleSave: 0,
        renderToolbar: 0, updateToolbarState: 0, clearCrop: 0
    };
    const page = () => board.doc.pages.find((p) => p.id === board.doc.activePageId);
    const board = {
        doc: makeDoc(),
        docOwner: 'workspace',
        active: true,
        history: new DrawingHistory(),
        selectedStrokes: new Set(),
        strokes: () => page().strokes,
        setStrokes: (next) => { page().strokes = next; },
        images: () => [],
        setImages: () => {},
        redraw: () => { calls.redraw += 1; },
        redrawBackground: () => { calls.redrawBackground += 1; },
        resize: () => { calls.resize += 1; },
        scheduleSave: () => { calls.scheduleSave += 1; },
        renderToolbar: () => { calls.renderToolbar += 1; },
        updateToolbarState: () => { calls.updateToolbarState += 1; },
        clearCropSession: () => { calls.clearCrop += 1; },
        shrinkInfiniteIfNeeded: () => {},
        // The board's own delegating methods, wired to the module under test so
        // the session <-> facade round-trip is exercised for real.
        getSnapshot: () => getSnapshot(board),
        restoreSnapshotPage: (pageId) => restoreSnapshotPage(board, pageId),
        applySnapshot: (snapshot) => applySnapshot(board, snapshot),
        pushLayerHistory: () => board.history.push(getLayerUndoSlice(board)),
        ...overrides
    };
    return { board, calls };
}

describe('getSnapshot', () => {
    it('returns a deep copy that cannot alias the live document', () => {
        const { board } = makeBoard();
        const snapshot = getSnapshot(board);

        assert.deepEqual(snapshot, board.doc);
        snapshot.pages[0].strokes.push({ id: 'leak' });
        assert.equal(board.doc.pages[0].strokes.length, 1, 'history must not share page arrays');
    });
});

describe('getLayerUndoSlice', () => {
    it('tags the slice as a layer and copies the active page only', () => {
        const { board } = makeBoard();
        const slice = getLayerUndoSlice(board);

        assert.equal(slice.kind, 'layer');
        assert.equal(slice.activePageId, 'p2');
        assert.deepEqual(slice.strokes, [{ id: 'b' }]);
        assert.deepEqual(slice.texts, [{ id: 't1' }]);
        assert.equal(slice.canvasMode, 'pages');

        slice.strokes.push({ id: 'leak' });
        assert.equal(board.doc.pages[1].strokes.length, 1);
    });
});

describe('restoreSnapshotPage', () => {
    it('switches only to a known, different page', () => {
        const { board } = makeBoard();
        assert.equal(restoreSnapshotPage(board, 'p1'), true);
        assert.equal(board.doc.activePageId, 'p1');
        assert.equal(restoreSnapshotPage(board, 'p1'), false, 'already active');
        assert.equal(restoreSnapshotPage(board, 'nope'), false, 'unknown page');
        assert.equal(restoreSnapshotPage(board, null), false);
    });
});

describe('applySnapshot', () => {
    it('restores a layer snapshot on its own page', () => {
        const { board, calls } = makeBoard();
        const slice = { kind: 'layer', activePageId: 'p1', strokes: [{ id: 'restored' }], texts: [], images: [] };

        applySnapshot(board, slice);

        assert.equal(board.doc.activePageId, 'p1', 'the page the snapshot came from wins');
        assert.deepEqual(board.doc.pages[0].strokes, [{ id: 'restored' }]);
        assert.equal(calls.resize, 1, 'a page switch re-fits the viewport');
        assert.equal(calls.redraw, 1);
        assert.equal(calls.scheduleSave, 1);
    });

    it('replaces the whole document for a full snapshot', () => {
        const { board, calls } = makeBoard();
        const full = { canvasMode: 'pages', activePageId: 'p1', pages: [{ id: 'p1', strokes: [], texts: [], images: [] }] };

        applySnapshot(board, full);

        assert.equal(board.doc.pages.length, 1);
        assert.equal(calls.resize, 1);
        assert.equal(calls.redrawBackground, 0, 'no background keys means no background repaint');
    });

    it('repaints the background only when the snapshot carries one', () => {
        const { board, calls } = makeBoard();
        applySnapshot(board, {
            kind: 'layer', activePageId: 'p2', strokes: [], texts: [], images: [], background: 'grid'
        });
        assert.equal(calls.redrawBackground, 1);
    });
});

describe('undo / redo', () => {
    it('do nothing on an empty history', () => {
        const { board, calls } = makeBoard();
        undo(board);
        redo(board);
        assert.equal(calls.redraw, 0);
        assert.equal(calls.renderToolbar, 0);
    });

    it('apply the neighbouring snapshot and refresh the toolbar', () => {
        const { board, calls } = makeBoard();
        board.history.push(getLayerUndoSlice(board));
        board.doc.pages[1].strokes = [{ id: 'later' }];

        undo(board);

        assert.deepEqual(board.doc.pages[1].strokes, [{ id: 'b' }], 'strokes roll back');
        assert.equal(calls.renderToolbar, 1);
        assert.equal(calls.clearCrop, 1);

        redo(board);
        assert.deepEqual(board.doc.pages[1].strokes, [{ id: 'later' }], 'redo restores the newer layer');
        assert.equal(calls.renderToolbar, 2);
    });
});

describe('clearAll', () => {
    it('does nothing on an already empty page', () => {
        const { board, calls } = makeBoard();
        board.doc.pages[1].strokes = [];
        board.doc.pages[1].texts = [];

        clearAll(board);

        assert.equal(calls.redraw, 0);
        assert.equal(calls.scheduleSave, 0);
    });
});
