import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    MODAL_OWNED_FIELDS,
    SHARED_FIELDS,
    mergeModalOwnedOntoLive,
    patchSharedFieldsOntoDraft,
    sharedFieldsDiffer,
    noteCanvasHasContent,
    removeMediaIdFromNoteCanvas,
    collectNoteCanvasMediaIds
} from '../js/noteFieldOwnership.js';
import { noteHasSavableContent, createEmptyNoteCanvas } from '../js/noteModel.js';
import { reconcileItemMediaCanvas } from '../js/api.js';

describe('noteFieldOwnership contract', () => {
    it('lists modal-owned and shared field sets', () => {
        assert.ok(MODAL_OWNED_FIELDS.includes('title'));
        assert.ok(MODAL_OWNED_FIELDS.includes('content'));
        assert.ok(SHARED_FIELDS.includes('attachments'));
        assert.ok(SHARED_FIELDS.includes('canvas'));
        assert.ok(!MODAL_OWNED_FIELDS.includes('canvas'));
        assert.ok(!SHARED_FIELDS.includes('title'));
    });

    it('mergeModalOwnedOntoLive overlays ModalOwned without clobbering Shared', () => {
        const live = {
            id: 'n1',
            title: 'Live title',
            content: 'live body',
            attachments: [{ mediaId: 'm1', attachedAt: 1, expanded: false, scale: 1, x: null, y: null }],
            canvas: { version: 2, pages: [{ id: 'p', strokes: [{ id: 's1' }] }], activePageId: 'p' },
            canvasHidden: false,
            desktopId: 'desk-live',
            tileSize: 'large'
        };
        const draft = {
            id: 'n1',
            title: 'Draft title',
            content: 'draft body',
            steps: [],
            categories: ['Work'],
            visibility: 'private',
            status: 'active',
            backgroundColor: '#fff',
            startDateTime: '2026-01-01T10:00',
            endDateTime: '',
            editorBodyLayout: 'both',
            isRecurring: false,
            hideFromCalendar: true,
            hiddenFromBoard: false,
            // Stale Shared on draft — must not win
            attachments: [],
            canvas: null,
            canvasHidden: true,
            desktopId: 'desk-stale',
            tileSize: 'small'
        };

        const merged = mergeModalOwnedOntoLive(live, draft);
        assert.equal(merged.title, 'Draft title');
        assert.equal(merged.content, 'draft body');
        assert.equal(merged.hideFromCalendar, true);
        assert.deepEqual(merged.attachments, live.attachments);
        assert.equal(merged.canvas, live.canvas);
        assert.equal(merged.canvasHidden, false);
        assert.equal(merged.desktopId, 'desk-live');
        assert.equal(merged.tileSize, 'large');
    });

    it('mergeModalOwnedOntoLive uses draft when there is no live item', () => {
        const draft = { id: 'new', title: 'New', attachments: [], canvas: null };
        const merged = mergeModalOwnedOntoLive(null, draft);
        assert.equal(merged.title, 'New');
        assert.equal(merged.id, 'new');
    });

    it('patchSharedFieldsOntoDraft copies Shared and deep-clones canvas', () => {
        const draft = {
            id: 'n1',
            title: 'Keep me',
            attachments: [],
            canvas: null,
            canvasHidden: true
        };
        const live = {
            id: 'n1',
            title: 'Live title ignored',
            attachments: [{ mediaId: 'm2', attachedAt: 2, expanded: false, scale: 1, x: null, y: null }],
            canvas: { version: 2, pages: [{ id: 'p', images: [{ mediaId: 'm2' }] }], activePageId: 'p' },
            canvasHidden: false
        };

        const changed = patchSharedFieldsOntoDraft(draft, live);
        assert.equal(changed, true);
        assert.equal(draft.title, 'Keep me');
        assert.equal(draft.attachments.length, 1);
        assert.equal(draft.attachments[0].mediaId, 'm2');
        assert.equal(draft.canvasHidden, false);
        assert.notEqual(draft.canvas, live.canvas);
        assert.deepEqual(draft.canvas, live.canvas);
        draft.canvas.pages[0].images.push({ mediaId: 'other' });
        assert.equal(live.canvas.pages[0].images.length, 1);
    });

    it('sharedFieldsDiffer detects canvas changes', () => {
        const a = { attachments: [], canvas: null };
        const b = { attachments: [], canvas: { version: 2, pages: [] } };
        assert.equal(sharedFieldsDiffer(a, b), true);
        assert.equal(sharedFieldsDiffer(a, { attachments: [], canvas: null }), false);
    });

    it('noteCanvasHasContent and removeMediaIdFromNoteCanvas', () => {
        assert.equal(noteCanvasHasContent(null), false);
        assert.equal(noteCanvasHasContent(createEmptyNoteCanvas()), false);

        const doc = createEmptyNoteCanvas();
        doc.pages[0].images.push({ mediaId: 'm1', tool: 'image' });
        doc.pages[0].images.push({ mediaId: 'm2', tool: 'image' });
        assert.equal(noteCanvasHasContent(doc), true);

        assert.equal(removeMediaIdFromNoteCanvas(doc, 'm1'), true);
        assert.equal(doc.pages[0].images.length, 1);
        assert.equal(doc.pages[0].images[0].mediaId, 'm2');
        assert.equal(removeMediaIdFromNoteCanvas(doc, 'missing'), false);
    });

    it('collectNoteCanvasMediaIds returns unique media ids', () => {
        const doc = createEmptyNoteCanvas();
        doc.pages[0].images.push({ mediaId: 'm1' }, { mediaId: 'm1' }, { mediaId: 'm2' });
        assert.deepEqual(collectNoteCanvasMediaIds(doc), ['m1', 'm2']);
    });
});

describe('reconcileItemMediaCanvas', () => {
    it('keeps null canvas as null and does not invent an empty doc', () => {
        const item = { id: 'n1', canvas: null, attachments: [] };
        assert.equal(reconcileItemMediaCanvas(item), false);
        assert.equal(item.canvas, null);
    });

    it('drops empty canvas shells and clears canvasHidden', () => {
        const item = {
            id: 'n1',
            canvas: createEmptyNoteCanvas(),
            canvasHidden: true,
            attachments: []
        };
        assert.equal(reconcileItemMediaCanvas(item), true);
        assert.equal(item.canvas, null);
        assert.equal('canvasHidden' in item, false);
    });

    it('attaches canvas image mediaIds and unhides stuck hidden canvases', () => {
        const canvas = createEmptyNoteCanvas();
        canvas.pages[0].images.push({ mediaId: 'm9', tool: 'image' });
        const item = {
            id: 'n1',
            canvas,
            canvasHidden: true,
            attachments: [{ mediaId: 'm9', attachedAt: 1, expanded: true, scale: 1, x: null, y: null }]
        };
        assert.equal(reconcileItemMediaCanvas(item), true);
        assert.equal(item.canvasHidden, false);
        assert.equal(item.attachments.length, 1);
        assert.equal(item.attachments[0].mediaId, 'm9');
    });

    it('mergeModalOwnedOntoLive recovers draft canvas when live lost it', () => {
        const canvas = createEmptyNoteCanvas();
        canvas.pages[0].strokes.push({
            style: 'pen',
            width: 2,
            color: '#0f0',
            points: [{ x: 0, y: 0, p: 0.5 }, { x: 1, y: 1, p: 0.5 }]
        });
        const live = {
            id: 'n1',
            title: 'Live',
            content: '',
            attachments: [],
            canvas: null,
            canvasHidden: true
        };
        const draft = {
            id: 'n1',
            title: 'Draft',
            content: '',
            steps: [],
            categories: [],
            visibility: 'private',
            status: 'active',
            backgroundColor: '',
            startDateTime: '',
            endDateTime: '',
            editorBodyLayout: 'both',
            isRecurring: false,
            hideFromCalendar: false,
            hiddenFromBoard: false,
            attachments: [{ mediaId: 'm1', attachedAt: 1, expanded: true, scale: 1, x: null, y: null }],
            canvas,
            canvasHidden: false
        };
        const merged = mergeModalOwnedOntoLive(live, draft);
        assert.equal(merged.title, 'Draft');
        assert.ok(merged.canvas);
        assert.equal(merged.canvasHidden, false);
        assert.equal(merged.attachments.length, 1);
    });
});

describe('noteHasSavableContent with media/canvas', () => {
    it('returns true for attachments-only notes', () => {
        assert.equal(noteHasSavableContent({
            attachments: [{ mediaId: 'm1' }]
        }), true);
    });

    it('returns true for canvas-only notes with strokes', () => {
        const canvas = createEmptyNoteCanvas();
        canvas.pages[0].strokes.push({
            style: 'pen',
            width: 2,
            color: '#000',
            points: [{ x: 0, y: 0, p: 0.5 }, { x: 1, y: 1, p: 0.5 }]
        });
        assert.equal(noteHasSavableContent({ canvas }), true);
    });

    it('returns false for empty note without media or canvas content', () => {
        assert.equal(noteHasSavableContent({
            title: '',
            content: '',
            steps: [],
            attachments: [],
            canvas: createEmptyNoteCanvas()
        }), false);
    });
});
