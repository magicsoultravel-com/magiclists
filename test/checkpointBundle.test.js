// test/checkpointBundle.test.js
// One ZIP per scheduled checkpoint. Guards:
//   - the personal filename tag is sanitized (never corrupts a filename),
//   - the bundle carries ONLY the parts that changed,
//   - nothing changed → no file at all,
//   - media inside a bundle stays incremental (only changed files),
//   - a bundle round-trips through importFullBackupArchive
//     (notes baseline replace / patch merge, scoped board+canvas, media files).
//
// Run with: npm test  (node --test test/)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser polyfills: backup modules touch localStorage, js/noteSurface.js
// registers a board listener at import time, and the media library emits a
// CustomEvent on write — all no-ops in a headless test run.
if (typeof globalThis.window === 'undefined') {
    globalThis.window = {
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true
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

const { sanitizeFilenameTag, checkpointFilename, normalizeConfig } =
    await import('../js/scheduledBackupConfig.js');
const { buildCheckpointExportPayload } = await import('../js/checkpointBundle.js');
const { importFullBackupArchive } = await import('../js/backup.js');
const { readZip } = await import('../js/mediaBackup.js');
const { IndexedDBMediaStore } = await import('../js/storage/indexedDbMediaStore.js');

/** Names of the entries actually written inside a bundle ZIP. */
async function zipNames(blob) {
    const files = await readZip(await blob.arrayBuffer());
    return [...files.keys()];
}

function note(overrides = {}) {
    return {
        id: 'item_1_a',
        title: 'Title',
        content: 'Body',
        categories: ['Inbox'],
        status: 'active',
        created_at: 100,
        updated_at: 100,
        ...overrides
    };
}

function seed(items) {
    localStorage.setItem('matrix_database', JSON.stringify({
        schemaVersion: 3,
        auth: { admin_token: 'tok' },
        settings: { categories: ['Inbox'] },
        items
    }));
    localStorage.setItem('matrix_custom_categories', JSON.stringify([
        { name: 'Inbox', color: '#ffffff' }
    ]));
}

function readStored() {
    return JSON.parse(localStorage.getItem('matrix_database') || '{}');
}

function makeMediaRecord(id, updatedAt, bytes = 8) {
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

/**
 * Commit a bundle's patches so the next build sees a quiet workspace.
 * The stream toggles live alongside the patches in the real config, so they are
 * carried over from the config that produced the bundle (media defaults to OFF,
 * unlike notes/board/canvas).
 */
function commit(base, cfg = {}) {
    localStorage.setItem('matrix_scheduled_export', JSON.stringify({
        notes: base.patches.notes || {},
        media: {
            ...(base.patches.media || {}),
            enabled: !!cfg.media?.enabled,
            incremental: !!cfg.media?.incremental
        },
        board: base.patches.board || {},
        canvas: base.patches.canvas || {}
    }));
    return normalizeConfig(JSON.parse(localStorage.getItem('matrix_scheduled_export')));
}

describe('checkpoint bundle · filename tag', () => {
    it('sanitizes the personal tag (safe signs only, 8 chars max)', () => {
        assert.equal(sanitizeFilenameTag('Luna42!'), 'luna42');
        assert.equal(sanitizeFilenameTag('a/bc:d*e?fg'), 'abcdefg');
        assert.equal(sanitizeFilenameTag('OK-tag_1'), 'ok-tag_1');
        assert.equal(sanitizeFilenameTag('123456789'), '12345678');
        assert.equal(sanitizeFilenameTag('   '), '');
        assert.equal(sanitizeFilenameTag(null), '');
    });

    it('composes the filename with and without the tag', () => {
        assert.equal(checkpointFilename('luna', 1000), 'magicnotes_luna_export_1000.zip');
        assert.equal(checkpointFilename('', 1000), 'magicnotes_export_1000.zip');
        assert.equal(checkpointFilename('bad/name', 1000), 'magicnotes_badname_export_1000.zip');
        assert.equal(normalizeConfig({ tag: 'Luna42' }).tag, 'luna42');
    });
});

describe('checkpoint bundle · build', () => {
    beforeEach(() => {
        localStorage.clear();
        seed([note()]);
    });

    it('ships only the parts that changed (notes-only change → no media files)', async () => {
        const base = await buildCheckpointExportPayload(normalizeConfig({}));
        assert.equal(base.skipped, false);
        assert.ok(base.filename.startsWith('magicnotes_export_'));
        assert.ok(base.patches.notes);

        const cfg = commit(base);
        seed([note({ content: 'Edited body' })]);

        const next = await buildCheckpointExportPayload(cfg);
        assert.equal(next.skipped, false);
        assert.ok(next.patches.notes);
        assert.equal(next.patches.notes.lastMode, 'incremental');
        assert.ok(next.filename.startsWith('magicnotes_export_'));
        assert.equal(next.patches.board, undefined);
        assert.equal(next.patches.canvas, undefined);
        assert.equal(next.patches.media, undefined);

        // The ZIP must physically contain only the checkpoint manifest + notes.
        const names = await zipNames(next.blob);
        assert.deepEqual(names.sort(), ['checkpoint.json', 'notes.json']);
    });

    it('skips the download entirely when nothing changed', async () => {
        const base = await buildCheckpointExportPayload(normalizeConfig({}));
        const cfg = commit(base);
        const again = await buildCheckpointExportPayload(cfg);
        assert.equal(again.skipped, true);
        assert.equal(again.blob, null);
    });

    it('carries incremental media files only when media changed', async () => {
        await IndexedDBMediaStore.clear();
        await IndexedDBMediaStore.put(makeMediaRecord('m_a', 100));
        const baseCfg = normalizeConfig({ media: { enabled: true, incremental: true } });
        const base = await buildCheckpointExportPayload(baseCfg);
        assert.ok(base.patches.media);
        assert.equal(base.patches.media.lastZipMode, 'full');

        const cfg = commit(base, baseCfg);
        await IndexedDBMediaStore.put(makeMediaRecord('m_b', 300));

        const next = await buildCheckpointExportPayload(cfg);
        assert.equal(next.patches.media.lastZipMode, 'incremental');
        const names = await zipNames(next.blob);
        assert.ok(names.some((name) => name.includes('m_b')), 'changed file must ride along');
        assert.ok(!names.some((name) => name.includes('m_a')), 'untouched file must not ride along');
    });

    it('embeds the sanitized personal tag in the downloaded filename', async () => {
        const payload = await buildCheckpointExportPayload(
            normalizeConfig({ tag: 'Luna 42!' })
        );
        assert.ok(
            payload.filename.startsWith('magicnotes_luna42_export_'),
            `unexpected filename ${payload.filename}`
        );
    });
});
describe('checkpoint bundle · import round-trip', () => {
    beforeEach(async () => {
        localStorage.clear();
        await IndexedDBMediaStore.clear();
        seed([note(), note({ id: 'item_2_b', title: 'Second' })]);
    });

    it('imports every part: notes, board, canvas and media files', async () => {
        localStorage.setItem('matrix_freeform_positions', JSON.stringify({ item_1_a: { x: 7, y: 9 } }));
        await IndexedDBMediaStore.put(makeMediaRecord('m_round', 100));

        const first = await buildCheckpointExportPayload(normalizeConfig({
            media: { enabled: true, incremental: true }
        }));
        assert.equal(first.skipped, false);

        const result = await importFullBackupArchive(first.blob);
        assert.equal(result.manifest.kind, 'magicnotes_checkpoint');
        assert.equal(result.applied.notes, true);
        assert.equal(result.applied.board, true);
        assert.equal(result.applied.canvas, true);
        assert.equal(result.applied.mediaZip, true);

        assert.deepEqual(readStored().items.map((item) => item.id).sort(), ['item_1_a', 'item_2_b']);
        assert.deepEqual(
            JSON.parse(localStorage.getItem('matrix_freeform_positions')),
            { item_1_a: { x: 7, y: 9 } }
        );
        assert.ok(localStorage.getItem('matrix_global_drawing'));
        assert.ok((await IndexedDBMediaStore.get('m_round'))?.blob);
    });

    it('merges a notes patch from a later bundle instead of replacing', async () => {
        const base = await buildCheckpointExportPayload(normalizeConfig({}));
        await importFullBackupArchive(base.blob);

        const cfg = commit(base);
        seed([note({ title: 'Edited' }), note({ id: 'item_2_b', title: 'Second' })]);
        const next = await buildCheckpointExportPayload(cfg);
        await importFullBackupArchive(next.blob);

        const stored = readStored();
        assert.deepEqual(stored.items.map((item) => item.id).sort(), ['item_1_a', 'item_2_b']);
        assert.equal(stored.items.find((item) => item.id === 'item_1_a').title, 'Edited');
    });
});
