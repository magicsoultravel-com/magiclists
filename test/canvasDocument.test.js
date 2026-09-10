// Unit tests for js/canvasDocument.js + js/storage/indexedDbCanvasStore.js.
// Run with: npm test
//
// Node has no IndexedDB, so the store transparently falls back to an in-memory
// Map. These tests verify the public document read/write/migrate API and the
// migration from a legacy localStorage key.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Provide a minimal localStorage polyfill for Node so migration paths can be tested.
if (typeof localStorage === 'undefined') {
    const store = new Map();
    globalThis.localStorage = {
        getItem: (key) => store.has(key) ? store.get(key) : null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: (key) => store.delete(key),
        clear: () => store.clear()
    };
}
import {
    readDocument,
    writeDocument,
    createEmptyDocument,
    migrateDocument,
    getActiveStrokes,
    setActiveStrokes,
    getActiveTexts,
    setActiveTexts,
    getActiveImages,
    setActiveImages,
    getPageDimensions,
    STORAGE_KEY
} from '../js/canvasDocument.js';
import { clearCanvasDocuments, getCanvasDocument, setCanvasDocument } from '../js/storage/indexedDbCanvasStore.js';

describe('canvasDocument', () => {
    beforeEach(async () => {
        await clearCanvasDocuments();
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {
            // Ignore in environments without localStorage.
        }
    });

    it('readDocument returns a migrated v2 document when empty', async () => {
        const doc = await readDocument();
        assert.equal(doc.version, 2);
        assert.equal(doc.canvasMode, 'a4');
        assert.ok(Array.isArray(doc.pages));
        assert.ok(Array.isArray(doc.pages[0].images));
        assert.ok(Array.isArray(doc.infinite.images));
        assert.ok(doc.infinite);
        assert.ok(doc.viewport);
    });

    it('writeDocument persists and readDocument round-trips', async () => {
        const doc = createEmptyDocument('infinite');
        const strokes = [{ id: 's1', tool: 'brush', points: [{ x: 1, y: 2 }] }];
        setActiveStrokes(doc, strokes);
        await writeDocument(doc);

        const loaded = await readDocument();
        assert.equal(loaded.canvasMode, 'infinite');
        assert.deepEqual(getActiveStrokes(loaded), strokes);
    });

    it('migrateDocument upgrades legacy v1 stroke data', () => {
        const legacy = {
            strokes: [{ id: 'old', tool: 'brush', points: [{ x: 5, y: 6 }] }]
        };
        const doc = migrateDocument(legacy);
        assert.equal(doc.version, 2);
        assert.equal(doc.canvasMode, 'infinite');
        const strokes = getActiveStrokes(doc);
        assert.equal(strokes.length, 1);
        assert.equal(strokes[0].id, 'old');
        assert.ok(Array.isArray(doc.infinite.images));
        assert.equal(doc.infinite.images.length, 0);
    });

    it('migrateDocument backfills images on legacy v2 pages', () => {
        const raw = {
            version: 2,
            canvasMode: 'a4',
            activePageId: 'p1',
            pages: [{ id: 'p1', format: 'a4', background: 'blank', strokes: [], texts: [] }],
            infinite: { strokes: [], texts: [], background: 'blank', bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } },
            viewport: { scale: 1, offsetX: 0, offsetY: 0 }
        };
        const doc = migrateDocument(raw);
        assert.ok(Array.isArray(doc.pages[0].images));
        assert.ok(Array.isArray(doc.infinite.images));
    });

    it('active text helpers work in page mode', () => {
        const doc = createEmptyDocument('a4');
        const texts = [{ id: 't1', tool: 'text', x: 10, y: 20, text: 'hello' }];
        setActiveTexts(doc, texts);
        assert.deepEqual(getActiveTexts(doc), texts);
    });

    it('active image helpers work in page and infinite modes', () => {
        const pageDoc = createEmptyDocument('a4');
        const images = [{ id: 'img1', tool: 'image', mediaId: 'media_1', x: 0, y: 0, width: 100, height: 80 }];
        setActiveImages(pageDoc, images);
        assert.deepEqual(getActiveImages(pageDoc), images);

        const infDoc = createEmptyDocument('infinite');
        setActiveImages(infDoc, images);
        assert.deepEqual(getActiveImages(infDoc), images);
    });

    it('getPageDimensions returns infinite bounds for infinite mode', () => {
        const doc = createEmptyDocument('infinite');
        const dims = getPageDimensions(doc);
        assert.ok(dims.width >= 800);
        assert.ok(dims.height >= 600);
    });

    it('legacy localStorage drawing is migrated to IndexedDB on read', async () => {
        const legacy = JSON.stringify({ strokes: [{ id: 'migrated', points: [{ x: 0, y: 0 }] }] });
        localStorage.setItem(STORAGE_KEY, legacy);

        const loaded = await readDocument();
        const strokes = getActiveStrokes(loaded);
        assert.equal(strokes.length, 1);
        assert.equal(strokes[0].id, 'migrated');

        // After migration, the document should also exist in the primary store.
        const fromStore = await getCanvasDocument(STORAGE_KEY);
        assert.ok(fromStore);
        assert.equal(fromStore.version, 2);
    });
});

describe('indexedDbCanvasStore (memory fallback)', () => {
    beforeEach(async () => {
        await clearCanvasDocuments();
    });

    it('round-trips values through the fallback store', async () => {
        await setCanvasDocument('key-a', { value: 123 });
        const got = await getCanvasDocument('key-a');
        assert.deepEqual(got, { value: 123 });
    });

    it('returns null for missing keys', async () => {
        assert.equal(await getCanvasDocument('missing'), null);
    });
});
