// test/backupDelta.test.js
// Unit tests for the pure incremental-backup helpers (js/backupDelta.js).
//
// These guard the notes incremental chain: a changed note must never be
// silently skipped, a deleted note must appear in `removed`, and merging a
// patch onto the local database must never drop unrelated notes.
//
// Run with: npm test  (node --test test/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    NOTES_PATCH_KIND,
    buildItemRevisionMap,
    diffNotesAgainstSnapshot,
    hasNotesBaseline,
    hashExportFingerprint,
    isNotesPatchPackage,
    itemRevision,
    mergeNotesPatchDatabase,
    normalizeNotesSnapshot
} from '../js/backupDelta.js';

function note(overrides = {}) {
    return {
        id: 'item_1_a',
        title: 'Title',
        content: 'Body',
        categories: ['Inbox'],
        created_at: 100,
        updated_at: 100,
        ...overrides
    };
}

describe('backupDelta · fingerprint + revisions', () => {
    it('hashExportFingerprint is stable and change-sensitive', () => {
        assert.equal(hashExportFingerprint('abc'), hashExportFingerprint('abc'));
        assert.notEqual(hashExportFingerprint('abc'), hashExportFingerprint('abd'));
        assert.equal(hashExportFingerprint(undefined), hashExportFingerprint(''));
    });

    it('itemRevision is stable for identical payloads and changes with content', () => {
        const base = note();
        assert.equal(itemRevision(base), itemRevision(note()));
        assert.notEqual(itemRevision(base), itemRevision(note({ content: 'Body 2' })));
        assert.notEqual(itemRevision(base), itemRevision(note({ updated_at: 999 })));
        assert.equal(itemRevision(null), '0:0');
    });

    it('buildItemRevisionMap skips id-less entries', () => {
        const map = buildItemRevisionMap([note(), { title: 'no id' }]);
        assert.deepEqual(Object.keys(map), ['item_1_a']);
    });
});

describe('backupDelta · snapshot diff', () => {
    it('normalizes garbage snapshots', () => {
        assert.deepEqual(normalizeNotesSnapshot(null), {
            baseAt: null,
            items: {},
            categories: null,
            desktops: null
        });
        assert.equal(hasNotesBaseline({}), false);
        assert.equal(hasNotesBaseline({ baseAt: 10 }), true);
    });

    it('reports added, changed and removed notes', () => {
        const first = diffNotesAgainstSnapshot([note(), note({ id: 'item_2_b' })], {});
        assert.equal(first.changed.length, 2);
        assert.deepEqual(first.removed, []);

        const snapshot = { baseAt: 1000, items: first.revisions };
        const second = diffNotesAgainstSnapshot(
            [note({ content: 'edited' }), note({ id: 'item_3_c' })],
            snapshot
        );
        assert.deepEqual(second.changed.map((item) => item.id), ['item_1_a', 'item_3_c']);
        assert.deepEqual(second.removed, ['item_2_b']);
    });

    it('reports nothing to do when the workspace is unchanged', () => {
        const items = [note(), note({ id: 'item_2_b' })];
        const first = diffNotesAgainstSnapshot(items, {});
        const second = diffNotesAgainstSnapshot(items, { baseAt: 1, items: first.revisions });
        assert.deepEqual(second.changed, []);
        assert.deepEqual(second.removed, []);
    });
});

describe('backupDelta · patch merge', () => {
    it('detects patch packages by kind', () => {
        assert.equal(isNotesPatchPackage({ kind: NOTES_PATCH_KIND }), true);
        assert.equal(isNotesPatchPackage({ kind: 'other' }), false);
        assert.equal(isNotesPatchPackage(null), false);
    });

    it('upserts changed notes, drops removed ones and keeps the rest', () => {
        const current = {
            schemaVersion: 3,
            auth: { admin_token: 'tok' },
            settings: { categories: ['Inbox'] },
            items: [note(), note({ id: 'item_2_b' }), note({ id: 'item_3_c' })]
        };
        const patch = {
            kind: NOTES_PATCH_KIND,
            matrix_database: { items: [note({ title: 'Edited', content: 'Body 2' })] },
            delta: { upserted: ['item_1_a'], removed: ['item_2_b'], itemCount: 2 }
        };

        const merged = mergeNotesPatchDatabase(current, patch);
        assert.deepEqual(merged.items.map((item) => item.id), ['item_3_c', 'item_1_a']);
        assert.equal(merged.items.find((item) => item.id === 'item_1_a').title, 'Edited');
        assert.equal(merged.auth.admin_token, 'tok');
        assert.deepEqual(merged.settings.categories, ['Inbox']);
    });

    it('creates a database when there is no local one yet', () => {
        const merged = mergeNotesPatchDatabase(null, {
            matrix_database: { items: [note()] },
            delta: { removed: [] }
        });
        assert.equal(merged.items.length, 1);
    });
});