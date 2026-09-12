import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildNoteAttachmentsSectionHtml, syncNoteAttachmentsDom, syncNoteCanvasDom } from '../js/noteAttachmentsUi.js';
import { createDefaultNote } from '../js/noteModel.js';

describe('noteAttachmentsUi module loads and exports functions', () => {
    it('buildNoteAttachmentsSectionHtml returns empty for note without attachments or canvas', () => {
        const item = createDefaultNote();
        const html = buildNoteAttachmentsSectionHtml(item);
        assert.equal(html, '');
    });

    it('buildNoteAttachmentsSectionHtml renders canvas section for note with canvas', () => {
        const item = createDefaultNote();
        item.canvas = {
            version: 2,
            canvasMode: 'infinite',
            activePageId: 'p1',
            pages: [{ id: 'p1', format: 'a4', background: 'blank', backgroundColor: '', strokes: [], texts: [], images: [] }],
            infinite: { strokes: [], texts: [], images: [], background: 'blank', backgroundColor: '', bounds: { minX: 0, minY: 0, maxX: 3000, maxY: 3000 } },
            viewport: { scale: 1, offsetX: 0, offsetY: 0 }
        };
        const html = buildNoteAttachmentsSectionHtml(item);
        assert.ok(html.includes('Note canvas'));
        assert.ok(html.includes('data-enter-drawing'));
        assert.ok(html.includes('data-reset-media-canvas'));
        assert.ok(html.includes('data-note-canvas-preview'));
    });

    it('buildNoteAttachmentsSectionHtml renders media list and hides canvas when no canvas', () => {
        const item = createDefaultNote();
        item.attachments = [{ mediaId: 'm1', attachedAt: 1, expanded: false, scale: 1, x: null, y: null }];
        const html = buildNoteAttachmentsSectionHtml(item);
        assert.ok(html.includes('Media (1)'));
        assert.ok(html.includes('data-expand-media="m1"'));
        // Canvas area should be hidden when item.canvas is absent.
        assert.ok(html.includes('note-media-canvas is-hidden'));
    });

    it('buildNoteAttachmentsSectionHtml keeps section when canvas exists but is hidden', () => {
        const item = createDefaultNote();
        item.canvas = {
            version: 2,
            canvasMode: 'infinite',
            activePageId: 'p1',
            pages: [{ id: 'p1', format: 'a4', background: 'blank', backgroundColor: '', strokes: [{ id: 's' }], texts: [], images: [] }],
            infinite: { strokes: [], texts: [], images: [], background: 'blank', backgroundColor: '', bounds: { minX: 0, minY: 0, maxX: 3000, maxY: 3000 } },
            viewport: { scale: 1, offsetX: 0, offsetY: 0 }
        };
        item.canvasHidden = true;
        const html = buildNoteAttachmentsSectionHtml(item);
        assert.ok(html.includes('data-note-attachments'));
        assert.ok(html.includes('note-media-canvas is-hidden'));
    });
});
