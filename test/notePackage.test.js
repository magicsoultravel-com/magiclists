// test/notePackage.test.js
// Single-note ZIP export/import: media closure, layout slice merge, replace
// with safety backup, and new-id upsert without dropping other notes.
//
// Run with: npm test  (node --test test/)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.window === 'undefined') {
    globalThis.window = {
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true
    };
}
if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        body: {
            appendChild: () => {},
            removeChild: () => {}
        },
        createElement: () => ({
            style: {},
            classList: { add() {}, remove() {}, contains() { return false; } },
            setAttribute() {},
            appendChild() {},
            remove() {},
            addEventListener() {},
            click() {}
        }),
        getElementById: () => null
    };
}

const memory = new Map();
globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => void memory.set(key, String(value)),
    removeItem: (key) => void memory.delete(key),
    clear: () => memory.clear(),
    key: (index) => [...memory.keys()][index] ?? null,
    get length() {
        return memory.size;
    }
};

const { IndexedDBMediaStore } = await import('../js/storage/indexedDbMediaStore.js');
const { collectMediaZipEntries, readZip } = await import('../js/mediaBackup.js');
const {
    buildNotePackageZip,
    collectNoteMediaIds,
    extractLayoutSliceForItem,
    importNotePackage,
    mergeLayoutSliceForItem,
    NOTE_PACKAGE_KIND,
    readLiveNoteItem,
    upsertNoteItemInDatabase
} = await import('../js/notePackage.js');

function note(overrides = {}) {
    return {
        id: 'item_1_a',
        title: 'Alpha',
        content: 'Body',
        categories: ['Inbox'],
        attachments: [],
        canvas: null,
        created_at: 100,
        updated_at: 100,
        desktopId: 1,
        ...overrides
    };
}

function seedDb(items) {
    localStorage.setItem('matrix_database', JSON.stringify({
        auth: { admin_token: 'dev-admin-secret-2026' },
        settings: { categories: ['Inbox'] },
        items
    }));
    localStorage.setItem('matrix_custom_categories', JSON.stringify([
        { id: 'cat_inbox', name: 'Inbox', color: '#abc' }
    ]));
}

function makeRecord(id, updatedAt = 100, bytes = 8) {
    return {
        id,
        filename: `${id}.png`,
        mime: 'image/png',
        byteSize: bytes,
        title: id,
        description: '',
        source: 'test',
        createdAt: 1,
        updatedAt,
        blob: new Blob([new Uint8Array(bytes).fill(1)], { type: 'image/png' })
    };
}

describe('notePackage · media ids', () => {
    it('collects attachment and canvas media ids without duplicates', () => {
        const ids = collectNoteMediaIds({
            attachments: [
                { mediaId: 'm_a' },
                { mediaId: 'm_b' },
                { mediaId: 'm_a' }
            ],
            canvas: {
                pages: [{ images: [{ mediaId: 'm_b' }, { mediaId: 'm_c' }] }],
                infinite: { images: [{ mediaId: 'm_d' }] }
            }
        });
        assert.deepEqual(ids, ['m_a', 'm_b', 'm_c', 'm_d']);
    });
});

describe('notePackage · mediaIds allowlist', () => {
    beforeEach(async () => {
        await IndexedDBMediaStore.clear();
    });

    it('collectMediaZipEntries filters to requested media ids', async () => {
        await IndexedDBMediaStore.put(makeRecord('m_a'));
        await IndexedDBMediaStore.put(makeRecord('m_b'));
        await IndexedDBMediaStore.put(makeRecord('m_c'));

        const collected = await collectMediaZipEntries({
            incremental: false,
            pathPrefix: 'media/',
            mediaIds: ['m_a', 'm_c']
        });
        const manifest = JSON.parse(new TextDecoder().decode(
            collected.zipFiles.find((f) => f.name === 'media/manifest.json').data
        ));
        assert.deepEqual(manifest.items.map((i) => i.id).sort(), ['m_a', 'm_c']);
        assert.deepEqual(Object.keys(collected.nextSnapshot).sort(), ['m_a', 'm_c']);
    });
});

describe('notePackage · layout slice', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('extract/merge does not clobber other notes’ positions', () => {
        localStorage.setItem('matrix_freeform_positions', JSON.stringify({
            item_1_a: { x: 10, y: 20 },
            item_2_b: { x: 30, y: 40 }
        }));
        localStorage.setItem('matrix_grid_pins', JSON.stringify(['item_1_a', 'item_2_b']));
        localStorage.setItem('matrix_file_cabinet_order', JSON.stringify({
            Inbox: ['item_2_b', 'item_1_a']
        }));

        const slice = extractLayoutSliceForItem('item_1_a');
        assert.deepEqual(slice.freeformPos, { x: 10, y: 20 });
        assert.equal(slice.pinned, true);
        assert.deepEqual(slice.fileCabinet, { category: 'Inbox', index: 1 });

        mergeLayoutSliceForItem('item_1_a', {
            freeformPos: { x: 99, y: 88 },
            pinned: false,
            fileCabinet: { category: 'Inbox', index: 0 }
        });

        const positions = JSON.parse(localStorage.getItem('matrix_freeform_positions'));
        assert.deepEqual(positions.item_1_a, { x: 99, y: 88 });
        assert.deepEqual(positions.item_2_b, { x: 30, y: 40 });

        const pins = JSON.parse(localStorage.getItem('matrix_grid_pins'));
        assert.deepEqual(pins, ['item_2_b']);

        const fc = JSON.parse(localStorage.getItem('matrix_file_cabinet_order'));
        assert.deepEqual(fc.Inbox, ['item_1_a', 'item_2_b']);
    });
});

describe('notePackage · import / replace', () => {
    beforeEach(async () => {
        localStorage.clear();
        await IndexedDBMediaStore.clear();
        seedDb([
            note({ id: 'item_keep', title: 'Keep me', content: 'stays' }),
            note({ id: 'item_1_a', title: 'Old', content: 'old body' })
        ]);
        localStorage.setItem('matrix_freeform_positions', JSON.stringify({
            item_1_a: { x: 1, y: 2 },
            item_keep: { x: 5, y: 6 }
        }));
    });

    it('new-id path upserts without dropping other items', async () => {
        const payload = await buildNotePackageZip(note({
            id: 'item_new',
            title: 'Fresh',
            content: 'imported'
        }));
        assert.ok(payload.filename.startsWith('magicnotes_note_'));

        const files = await readZip(await payload.blob.arrayBuffer());
        const pkg = JSON.parse(new TextDecoder().decode(files.get('note.json')));
        assert.equal(pkg.kind, NOTE_PACKAGE_KIND);
        assert.equal(pkg.item.id, 'item_new');

        const result = await importNotePackage(payload.blob, {
            toast: () => {},
            refreshBoard: false
        });
        assert.equal(result.status, 'imported');

        const db = JSON.parse(localStorage.getItem('matrix_database'));
        const ids = db.items.map((i) => i.id).sort();
        assert.deepEqual(ids, ['item_1_a', 'item_keep', 'item_new']);
        assert.equal(readLiveNoteItem('item_new')?.content, 'imported');
        assert.equal(readLiveNoteItem('item_keep')?.content, 'stays');
    });

    it('replace path downloads a safety backup before overwrite', async () => {
        const incoming = await buildNotePackageZip(note({
            id: 'item_1_a',
            title: 'New title',
            content: 'replaced body'
        }));

        const safetyDownloads = [];
        const toasts = [];
        const result = await importNotePackage(incoming.blob, {
            confirmReplace: () => true,
            downloadSafetyBackup: (blob, filename) => {
                safetyDownloads.push({ blob, filename });
            },
            toast: (msg) => toasts.push(msg),
            refreshBoard: false
        });

        assert.equal(result.status, 'replaced');
        assert.equal(safetyDownloads.length, 1);
        assert.ok(safetyDownloads[0].filename.startsWith('magicnotes_note_'));
        assert.ok(toasts.some((t) => /backup of the existing note/i.test(t)));

        const safetyFiles = await readZip(await safetyDownloads[0].blob.arrayBuffer());
        const safetyPkg = JSON.parse(new TextDecoder().decode(safetyFiles.get('note.json')));
        assert.equal(safetyPkg.item.content, 'old body');
        assert.equal(safetyPkg.item.title, 'Old');

        assert.equal(readLiveNoteItem('item_1_a')?.content, 'replaced body');
        assert.equal(readLiveNoteItem('item_keep')?.content, 'stays');
    });

    it('cancelled replace leaves the live note untouched', async () => {
        const incoming = await buildNotePackageZip(note({
            id: 'item_1_a',
            content: 'should not land'
        }));
        const result = await importNotePackage(incoming.blob, {
            confirmReplace: () => false,
            toast: () => {},
            refreshBoard: false
        });
        assert.equal(result.status, 'cancelled');
        assert.equal(readLiveNoteItem('item_1_a')?.content, 'old body');
    });

    it('upsertNoteItemInDatabase replaces only the target id', () => {
        upsertNoteItemInDatabase(note({ id: 'item_1_a', content: 'patched' }));
        const db = JSON.parse(localStorage.getItem('matrix_database'));
        assert.equal(db.items.length, 2);
        assert.equal(db.items.find((i) => i.id === 'item_1_a').content, 'patched');
        assert.equal(db.items.find((i) => i.id === 'item_keep').content, 'stays');
    });
});
