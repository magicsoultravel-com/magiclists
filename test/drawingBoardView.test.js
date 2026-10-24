// test/drawingBoardView.test.js
// js/drawingBoard/view.js owns the redraw loop and the page chrome. The two
// pieces that decide *what colour* the page shows and *which* page is labelled
// are pure lookups over the document, so they get direct guards: the note-canvas
// colour must not leak into a workspace page, and an explicit page background
// always outranks the note tint.
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pageBackgroundFill, pageLabel } from '../js/drawingBoard/view.js';
import { resolveNoteColor } from '../js/colorPicker.js';

function makeDoc(overrides = {}) {
    return {
        activePageId: 'p2',
        pages: [
            { id: 'p1', ...overrides.firstPage },
            { id: 'p2', ...overrides.activePage },
            { id: 'p3' }
        ],
        ...overrides.doc
    };
}

describe('pageLabel', () => {
    it('reports the active page as one-based position over the page count', () => {
        assert.equal(pageLabel({ doc: makeDoc() }), '2 / 3');
    });

    it('follows the active page when it changes', () => {
        const doc = makeDoc();
        doc.activePageId = 'p3';
        assert.equal(pageLabel({ doc }), '3 / 3');
    });
});

describe('pageBackgroundFill', () => {
    it('prefers an explicit page colour over the note tint', () => {
        const board = {
            doc: makeDoc({ activePage: { backgroundColor: '#123456' } }),
            isNoteCanvasMode: true,
            noteCanvasItem: { backgroundColor: 'yellow' }
        };
        assert.equal(pageBackgroundFill(board), '#123456');
    });

    it('tints the page with the note colour in note-canvas mode', () => {
        const board = {
            doc: makeDoc(),
            isNoteCanvasMode: true,
            noteCanvasItem: { backgroundColor: 'yellow' }
        };
        assert.equal(pageBackgroundFill(board), resolveNoteColor('yellow'));
    });

    it('leaves a workspace page unpainted when it has no colour', () => {
        const board = {
            doc: makeDoc(),
            isNoteCanvasMode: false,
            noteCanvasItem: { backgroundColor: 'yellow' }
        };
        assert.equal(pageBackgroundFill(board), '');
    });
});
