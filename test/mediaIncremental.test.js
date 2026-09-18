// test/mediaIncremental.test.js
// Guards the core promise of the media stream: once a full ZIP baseline exists,
// scheduled ZIPs carry ONLY the files that changed since the stored snapshot —
// never the whole library again.
//
// Node has no IndexedDB, so IndexedDBMediaStore falls back to an in-memory Map;
// blobs are real Blobs, which Node 22 provides natively.
//
// Run with: npm test  (node --test test/)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { IndexedDBMediaStore } from '../js/storage/indexedDbMediaStore.js';
import { buildMediaZipExportPayload, collectMediaZipEntries } from '../js/mediaBackup.js';

function makeRecord(id, updatedAt, bytes = 8) {
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

async function manifestOf(opts) {
    const collected = await collectMediaZipEntries(opts);
    return JSON.parse(new TextDecoder().decode(
        collected.zipFiles.find((f) => f.name.endsWith('manifest.json')).data
    ));
}

describe('media stream · incremental ZIP chain', () => {
    beforeEach(async () => {
        await IndexedDBMediaStore.clear();
    });

    it('writes a full baseline ZIP when no snapshot exists', async () => {
        await IndexedDBMediaStore.put(makeRecord('m_a', 100));
        await IndexedDBMediaStore.put(makeRecord('m_b', 100));

        const payload = await buildMediaZipExportPayload({ incremental: true, zipSnapshot: {} });
        assert.equal(payload.skipped, false);
        assert.equal(payload.isIncremental, false);
        assert.ok(payload.filename.startsWith('magicnotes_media_backup_'));

        const manifest = await manifestOf({ incremental: true, zipSnapshot: {} });
        assert.equal(manifest.incremental, false);
        assert.deepEqual(manifest.items.map((i) => i.id).sort(), ['m_a', 'm_b']);
        assert.deepEqual(Object.keys(payload.nextSnapshot).sort(), ['m_a', 'm_b']);
    });

    it('skips entirely when nothing changed since the snapshot', async () => {
        await IndexedDBMediaStore.put(makeRecord('m_a', 100));
        const full = await buildMediaZipExportPayload({ incremental: true, zipSnapshot: {} });

        const again = await buildMediaZipExportPayload({
            incremental: true,
            zipSnapshot: full.nextSnapshot
        });
        assert.equal(again.skipped, true);
        assert.equal(again.blob, null);
    });

    it('carries only changed + new files in an incremental ZIP', async () => {
        await IndexedDBMediaStore.put(makeRecord('m_a', 100));
        await IndexedDBMediaStore.put(makeRecord('m_b', 100));
        const full = await buildMediaZipExportPayload({ incremental: true, zipSnapshot: {} });
        assert.equal(full.isIncremental, false);

        // One file updated, one file added, one untouched.
        await IndexedDBMediaStore.put(makeRecord('m_b', 300));
        await IndexedDBMediaStore.put(makeRecord('m_c', 250));

        const incr = await buildMediaZipExportPayload({
            incremental: true,
            zipSnapshot: full.nextSnapshot
        });
        assert.equal(incr.skipped, false);
        assert.equal(incr.isIncremental, true);
        assert.ok(incr.filename.startsWith('magicnotes_media_incr_'));

        const manifest = await manifestOf({
            incremental: true,
            zipSnapshot: full.nextSnapshot
        });
        assert.equal(manifest.incremental, true);
        assert.deepEqual(manifest.items.map((i) => i.id).sort(), ['m_b', 'm_c']);
        // The untouched file is NOT re-downloaded.
        assert.equal(manifest.items.some((i) => i.id === 'm_a'), false);
        assert.deepEqual(Object.keys(incr.nextSnapshot).sort(), ['m_a', 'm_b', 'm_c']);
    });

    it('treats a deleted file as no longer in the snapshot', async () => {
        await IndexedDBMediaStore.put(makeRecord('m_a', 100));
        await IndexedDBMediaStore.put(makeRecord('m_gone', 100));
        const full = await buildMediaZipExportPayload({ incremental: true, zipSnapshot: {} });

        await IndexedDBMediaStore.remove('m_gone');
        const incr = await buildMediaZipExportPayload({
            incremental: true,
            zipSnapshot: full.nextSnapshot
        });
        // Nothing changed among surviving files → skipped (the deletion shows
        // up in the next meta JSON, which is always full).
        assert.equal(incr.skipped, true);
        assert.equal('m_gone' in incr.nextSnapshot, false);
    });
});
