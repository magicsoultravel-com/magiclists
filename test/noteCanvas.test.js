import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyNoteCanvas, normalizeNoteCanvas } from '../js/noteModel.js';

describe('Note canvas schema helpers', () => {
    it('createEmptyNoteCanvas returns a valid canvasDocument v2 infinite doc', () => {
        const doc = createEmptyNoteCanvas();
        assert.equal(doc.version, 2);
        assert.equal(doc.canvasMode, 'infinite');
        assert.ok(Array.isArray(doc.pages));
        assert.ok(doc.pages.length > 0);
        assert.ok(doc.activePageId);
        assert.ok(doc.infinite);
        assert.ok(Array.isArray(doc.infinite.strokes));
        assert.ok(Array.isArray(doc.infinite.texts));
        assert.ok(Array.isArray(doc.infinite.images));
        assert.ok(doc.viewport);
    });

    it('normalizeNoteCanvas returns a fresh empty canvas for invalid input', () => {
        const doc = normalizeNoteCanvas(null);
        assert.equal(doc.version, 2);
        assert.equal(doc.canvasMode, 'infinite');
    });

    it('normalizeNoteCanvas preserves a valid document', () => {
        const original = createEmptyNoteCanvas();
        original.pages[0].strokes.push({
            style: 'pen',
            width: 10,
            color: '#fff',
            points: [{ x: 0, y: 0, p: 0.5 }, { x: 10, y: 10, p: 0.5 }]
        });
        const doc = normalizeNoteCanvas(original);
        assert.equal(doc.canvasMode, 'infinite');
        assert.equal(doc.pages[0].strokes.length, 1);
    });
});
