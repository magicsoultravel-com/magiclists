import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildNoteAttachmentsSectionHtml,
    sizeCanvasViewport,
    clampLightboxZoom,
    nextLightboxZoom,
    anchorLightboxPan,
    LIGHTBOX_ZOOM_MIN,
    LIGHTBOX_ZOOM_MAX
} from '../js/noteAttachmentsUi.js';
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
            pages: [{ id: 'p1', format: 'a4', background: 'blank', backgroundColor: '', strokes: [], texts: [], images: [] }],
            infinite: { strokes: [], texts: [], images: [], background: 'blank', backgroundColor: '', bounds: { minX: 0, minY: 0, maxX: 3000, maxY: 3000 } },
            viewport: { scale: 1, offsetX: 0, offsetY: 0 }
        };
        item.canvasHidden = true;
        const html = buildNoteAttachmentsSectionHtml(item);
        assert.ok(html.includes('data-note-attachments'));
        // An EMPTY canvas shell stays hidden so the draw toggle can reveal it later
        // (only canvases with real content are force-visible by the render choke point).
        assert.ok(html.includes('note-media-canvas is-hidden'));
    });

    it('buildNoteAttachmentsSectionHtml self-heals a canvas stuck hidden with content', () => {
        const item = createDefaultNote();
        item.canvas = {
            version: 2,
            canvasMode: 'infinite',
            activePageId: 'p1',
            pages: [{ id: 'p1', format: 'a4', background: 'blank', backgroundColor: '', strokes: [{ id: 's1' }], texts: [], images: [] }],
            infinite: { strokes: [], texts: [], images: [], background: 'blank', backgroundColor: '', bounds: { minX: 0, minY: 0, maxX: 3000, maxY: 3000 } },
            viewport: { scale: 1, offsetX: 0, offsetY: 0 }
        };
        item.canvasHidden = true; // stale flag with real content (drawn, then a full-board rebuild)
        const html = buildNoteAttachmentsSectionHtml(item, { canEdit: true, startCollapsed: false });
        assert.ok(html.includes('data-note-canvas-preview'));
        assert.ok(!html.includes('note-media-canvas is-hidden'));
        assert.ok(!/data-note-media-canvas[^>]*\shidden/.test(html));
        // The render choke point also fixes the in-memory flag so later renders agree.
        assert.equal(item.canvasHidden, false);
    });

    it('sizeCanvasViewport sets explicit width and height from the host card', () => {
        const viewport = { style: {} };
        const root = {
            querySelector(sel) {
                return String(sel).includes('data-note-media-viewport') ? viewport : null;
            }
        };
        const section = {
            clientWidth: 0,
            closest() {
                return { clientWidth: 440, clientHeight: 400 };
            },
            querySelector(sel) {
                return String(sel).includes('data-note-media-canvas') ? root : null;
            }
        };

        sizeCanvasViewport(section);

        assert.match(viewport.style.width, /^\d+px$/);
        assert.match(viewport.style.height, /^\d+px$/);
        assert.ok(parseFloat(viewport.style.width) >= 120);
        assert.ok(parseFloat(viewport.style.height) >= 120);
        assert.equal(viewport.style.width, '431px'); // min(440, 440*0.98) rounded
        assert.equal(viewport.style.height, '168px'); // min(260, 400*0.42) rounded
    });

    it('sizeCanvasViewport falls back when host metrics are missing', () => {
        const viewport = { style: {} };
        const root = {
            querySelector(sel) {
                return String(sel).includes('data-note-media-viewport') ? viewport : null;
            }
        };
        const section = {
            clientWidth: 0,
            closest() {
                return null;
            },
            querySelector(sel) {
                return String(sel).includes('data-note-media-canvas') ? root : null;
            }
        };

        sizeCanvasViewport(section);

        // No real card box yet — must NOT bake a stale explicit size; the CSS
        // natural viewport size (.note-media-canvas__viewport = 100% × 180px)
        // drives the preview until the card is actually laid out, then
        // refreshNoteCanvasPreview re-paints once layout settles.
        assert.equal(viewport.style.width, undefined);
        assert.equal(viewport.style.height, undefined);
    });

    it('clampLightboxZoom keeps zoom inside 1x..max', () => {
        assert.equal(clampLightboxZoom(0.2), LIGHTBOX_ZOOM_MIN);
        assert.equal(clampLightboxZoom(99), LIGHTBOX_ZOOM_MAX);
        assert.equal(clampLightboxZoom('nope'), LIGHTBOX_ZOOM_MIN);
        assert.equal(clampLightboxZoom(2.345), 2.35);
    });

    it('nextLightboxZoom scrolls up to zoom in and down to zoom out', () => {
        assert.ok(nextLightboxZoom(1, -100) > 1);
        assert.ok(nextLightboxZoom(2, 100) < 2);
        assert.equal(nextLightboxZoom(1, 0), 1);
        assert.equal(nextLightboxZoom(LIGHTBOX_ZOOM_MAX, -500), LIGHTBOX_ZOOM_MAX);
        assert.equal(nextLightboxZoom(LIGHTBOX_ZOOM_MIN, 500), LIGHTBOX_ZOOM_MIN);
        // Line-mode deltas (Firefox) behave like pixel deltas.
        assert.ok(nextLightboxZoom(1, -3, 1) > 1);
    });

    it('anchorLightboxPan keeps the cursor point stable when zooming', () => {
        const out = anchorLightboxPan({ panX: 0, panY: 0, cursorX: 100, cursorY: 50, prevZoom: 1, nextZoom: 2 });
        assert.equal(out.panX, -100);
        assert.equal(out.panY, -50);
    });
});
