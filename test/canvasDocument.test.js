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
    getActiveBackground,
    setActiveBackground,
    getPageDimensions,
    switchCanvasMode,
    expandInfiniteBounds,
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

    it('expandInfiniteBounds keeps top/left at 0 and grows right/bottom', () => {
        const doc = createEmptyDocument('infinite');
        doc.infinite.bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };

        assert.equal(expandInfiniteBounds(doc, 50, 50, 400), false);
        assert.equal(doc.infinite.bounds.minX, 0);
        assert.equal(doc.infinite.bounds.minY, 0);
        assert.equal(doc.infinite.bounds.maxX, 1000);
        assert.equal(doc.infinite.bounds.maxY, 1000);

        assert.equal(expandInfiniteBounds(doc, 1200, 1500, 400), true);
        assert.equal(doc.infinite.bounds.minX, 0);
        assert.equal(doc.infinite.bounds.minY, 0);
        assert.equal(doc.infinite.bounds.maxX, 1600);
        assert.equal(doc.infinite.bounds.maxY, 1900);

        // Negative drawing coords must not pull the origin past 0,0.
        expandInfiniteBounds(doc, -200, -300, 400);
        assert.equal(doc.infinite.bounds.minX, 0);
        assert.equal(doc.infinite.bounds.minY, 0);
    });

    it('migrateDocument pins legacy negative infinite mins to 0', () => {
        const raw = {
            version: 2,
            canvasMode: 'infinite',
            activePageId: 'p1',
            pages: [{ id: 'p1', format: 'a4', background: 'blank', strokes: [], texts: [], images: [] }],
            infinite: {
                strokes: [],
                texts: [],
                images: [],
                background: 'blank',
                backgroundColor: '',
                bounds: { minX: -400, minY: -200, maxX: 2000, maxY: 1800 }
            },
            viewport: { scale: 1, offsetX: 0, offsetY: 0 }
        };
        const doc = migrateDocument(raw);
        assert.equal(doc.infinite.bounds.minX, 0);
        assert.equal(doc.infinite.bounds.minY, 0);
        assert.ok(doc.infinite.bounds.maxX >= 2000);
        assert.ok(doc.infinite.bounds.maxY >= 1800);
    });

    it('switchCanvasMode keeps active strokes when moving a4 ↔ infinite', () => {
        const doc = createEmptyDocument('a4');
        const strokes = [{ id: 's1', tool: 'brush', points: [{ x: 10, y: 20 }] }];
        const texts = [{ id: 't1', tool: 'text', x: 1, y: 2, text: 'hi' }];
        setActiveStrokes(doc, strokes);
        setActiveTexts(doc, texts);
        setActiveBackground(doc, 'grid');

        assert.equal(switchCanvasMode(doc, 'infinite'), true);
        assert.equal(doc.canvasMode, 'infinite');
        assert.deepEqual(getActiveStrokes(doc), strokes);
        assert.deepEqual(getActiveTexts(doc), texts);
        assert.equal(getActiveBackground(doc), 'grid');

        assert.equal(switchCanvasMode(doc, 'a4'), true);
        assert.equal(doc.canvasMode, 'a4');
        assert.deepEqual(getActiveStrokes(doc), strokes);
        assert.deepEqual(getActiveTexts(doc), texts);
        assert.equal(getActiveBackground(doc), 'grid');
        assert.equal(doc.pages[0].format, 'a4');
    });

    it('infinite mode shares page content so pagination works', () => {
        const doc = createEmptyDocument('infinite');
        const page1Strokes = [{ id: 'p1', tool: 'brush', points: [{ x: 1, y: 1 }] }];
        setActiveStrokes(doc, page1Strokes);
        const page2 = doc.pages[0];
        // add second page via pages API shape used by addPage
        doc.pages.push({
            id: 'page_2',
            format: 'a4',
            background: 'blank',
            backgroundColor: '',
            strokes: [{ id: 'p2', tool: 'brush', points: [{ x: 2, y: 2 }] }],
            texts: [],
            images: []
        });
        assert.deepEqual(getActiveStrokes(doc), page1Strokes);
        doc.activePageId = 'page_2';
        assert.equal(getActiveStrokes(doc)[0].id, 'p2');
        doc.activePageId = page2.id;
        assert.equal(getActiveStrokes(doc)[0].id, 'p1');
    });

    it('migrateDocument promotes legacy infinite content onto the active page', () => {
        const raw = {
            version: 2,
            canvasMode: 'infinite',
            activePageId: 'p1',
            pages: [{ id: 'p1', format: 'a4', background: 'blank', strokes: [], texts: [], images: [] }],
            infinite: {
                strokes: [{ id: 'legacy', points: [{ x: 3, y: 4 }] }],
                texts: [],
                images: [],
                background: 'dots',
                backgroundColor: '',
                bounds: { minX: 0, minY: 0, maxX: 3000, maxY: 3000 }
            },
            viewport: { scale: 1, offsetX: 0, offsetY: 0 }
        };
        const doc = migrateDocument(raw);
        assert.equal(getActiveStrokes(doc)[0].id, 'legacy');
        assert.equal(getActiveBackground(doc), 'dots');
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
