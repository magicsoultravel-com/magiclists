// test/notesBackupStreams.test.js
// Integration tests for the split scheduled-backup streams in js/backup.js.
//
// Guards the regression this change fixes:
//   - the (frequent) notes content export must not carry media binaries,
//     layout keys or the magicCanvas document,
//   - unchanged workspaces must not re-download anything,
//   - only changed notes land in an incremental patch, and importing that
//     patch merges instead of replacing the workspace.
//
// Run with: npm test  (node --test test/)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage polyfill: js/backup.js only touches storage at call time.
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

const {
    NOTES_BASELINE_FILE_PREFIX,
    NOTES_PATCH_FILE_PREFIX,
    BOARD_FILE_PREFIX,
    BOARD_PACKAGE_KIND,
    CANVAS_FILE_PREFIX,
    CANVAS_PACKAGE_KIND,
    applyBackupToStorage,
    buildNotesExportPayload,
    buildBoardExportPayload,
    buildBoardBackupPackage,
    buildCanvasExportPayload,
    buildCanvasBackupPackage,
    buildBackupPackage,
    parseBackupPackage,
    resolveImportedPackage
} = await import('../js/backup.js');
const { NOTES_PATCH_KIND } = await import('../js/backupDelta.js');

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
    localStorage.setItem('magicnotes_desktops_config', JSON.stringify({ activeDesktopId: 1 }));
}

function readStored() {
    return JSON.parse(localStorage.getItem('matrix_database') || '{}');
}

describe('backup streams · package scoping', () => {
    beforeEach(() => {
        localStorage.clear();
        seed([note()]);
    });

    it('content packages carry notes only (no media, layout or canvas)', async () => {
        const pkg = await buildBackupPackage({ include: 'content' });
        assert.ok(pkg.matrix_database);
        assert.ok(Array.isArray(pkg.matrix_custom_categories));
        assert.equal(pkg.kind, undefined);
        assert.equal('media_library' in pkg, false);
        assert.equal('matrix_global_drawing' in pkg, false);
        assert.equal('matrix_drawing_prefs' in pkg, false);
        assert.equal('matrix_workspace_mode' in pkg, false);
    });

    it('board packages carry positions + chrome, never the canvas document', async () => {
        localStorage.setItem('matrix_grid_layout', JSON.stringify({ item_1_a: { x: 1, y: 2 } }));
        localStorage.setItem('matrix_panel_collapsed', 'false');
        const pkg = await buildBoardBackupPackage();
        assert.equal(pkg.kind, BOARD_PACKAGE_KIND);
        assert.equal('matrix_database' in pkg, false);
        assert.equal('matrix_global_drawing' in pkg, false);
        assert.equal('matrix_drawing_prefs' in pkg, false);
        assert.deepEqual(pkg.matrix_grid_layout, { item_1_a: { x: 1, y: 2 } });
        assert.equal(pkg.matrix_panel_collapsed, false);
    });

    it('canvas packages carry the document + prefs, never board geometry', async () => {
        localStorage.setItem('matrix_grid_layout', JSON.stringify({ item_1_a: { x: 1, y: 2 } }));
        const pkg = await buildCanvasBackupPackage();
        assert.equal(pkg.kind, CANVAS_PACKAGE_KIND);
        assert.equal('matrix_database' in pkg, false);
        assert.equal('matrix_grid_layout' in pkg, false);
        assert.ok('matrix_global_drawing' in pkg);
        assert.ok(Array.isArray(pkg.referencedMediaIds));
    });

    it('legacy all-in-one packages still include media and canvas', async () => {
        const pkg = await buildBackupPackage({ embed: false });
        assert.ok(pkg.matrix_database);
        assert.ok('media_library' in pkg);
        assert.ok('matrix_global_drawing' in pkg);
    });
});

describe('backup streams · incremental notes payload', () => {
    beforeEach(() => {
        localStorage.clear();
        seed([note(), note({ id: 'item_2_b', title: 'Second' })]);
    });

    it('writes a full baseline when no snapshot exists', async () => {
        const payload = await buildNotesExportPayload({ incremental: true, snapshot: {} });
        assert.equal(payload.skipped, false);
        assert.equal(payload.isIncremental, false);
        assert.ok(payload.filename.startsWith(NOTES_BASELINE_FILE_PREFIX));
        assert.ok(payload.nextSnapshot.baseAt > 0);
        assert.deepEqual(
            Object.keys(payload.nextSnapshot.items).sort(),
            ['item_1_a', 'item_2_b']
        );
        const parsed = JSON.parse(payload.text);
        assert.equal('media_library' in parsed, false);
        assert.equal('matrix_global_drawing' in parsed, false);
    });

    it('skips the whole export when nothing changed', async () => {
        const base = await buildNotesExportPayload({ incremental: true });
        const again = await buildNotesExportPayload({ incremental: true, snapshot: base.nextSnapshot });
        assert.equal(again.skipped, true);
        assert.equal(again.text, null);
    });

    it('writes only the changed note in a patch', async () => {
        const base = await buildNotesExportPayload({ incremental: true });
        seed([note({ content: 'Edited body' }), note({ id: 'item_2_b', title: 'Second' })]);

        const patch = await buildNotesExportPayload({ incremental: true, snapshot: base.nextSnapshot });
        assert.equal(patch.skipped, false);
        assert.equal(patch.isIncremental, true);
        assert.ok(patch.filename.startsWith(NOTES_PATCH_FILE_PREFIX));

        const parsed = JSON.parse(patch.text);
        assert.equal(parsed.kind, NOTES_PATCH_KIND);
        assert.equal(parsed.baseAt, base.nextSnapshot.baseAt);
        assert.equal(parsed.matrix_database.items.length, 1);
        assert.equal(parsed.matrix_database.items[0].id, 'item_1_a');
        assert.deepEqual(parsed.delta.upserted, ['item_1_a']);
        assert.deepEqual(parsed.delta.removed, []);
        assert.equal(parsed.delta.itemCount, 2);
        // The baseline stays the anchor for every later patch.
        assert.equal(patch.nextSnapshot.baseAt, base.nextSnapshot.baseAt);
    });

    it('reports deleted notes and exports a header-only patch', async () => {
        const base = await buildNotesExportPayload({ incremental: true });
        seed([note()]);

        const patch = await buildNotesExportPayload({ incremental: true, snapshot: base.nextSnapshot });
        const parsed = JSON.parse(patch.text);
        assert.deepEqual(parsed.delta.removed, ['item_2_b']);
        assert.deepEqual(parsed.delta.upserted, []);
        assert.equal(parsed.matrix_database.items.length, 0);
    });

    it('exports a patch when only categories or desktops changed', async () => {
        const base = await buildNotesExportPayload({ incremental: true });
        localStorage.setItem('matrix_custom_categories', JSON.stringify([
            { name: 'Inbox', color: '#ffffff' },
            { name: 'Later', color: '#000000' }
        ]));

        const patch = await buildNotesExportPayload({ incremental: true, snapshot: base.nextSnapshot });
        assert.equal(patch.skipped, false);
        const parsed = JSON.parse(patch.text);
        assert.equal(parsed.matrix_database.items.length, 0);
        // The new category is carried even though no note changed.
        assert.ok(parsed.matrix_custom_categories.some((cat) => cat.name === 'Later'));
    });

    it('always writes a full standalone file when incremental is off', async () => {
        const base = await buildNotesExportPayload({ incremental: true });
        const full = await buildNotesExportPayload({ incremental: false, snapshot: base.nextSnapshot });
        assert.equal(full.isIncremental, false);
        assert.ok(full.filename.startsWith(NOTES_BASELINE_FILE_PREFIX));
    });
});

describe('backup streams · board payload', () => {
    beforeEach(() => {
        localStorage.clear();
        seed([note()]);
        localStorage.setItem('matrix_freeform_positions', JSON.stringify({ item_1_a: { x: 3, y: 4 } }));
    });

    it('has its own filename prefix and stable fingerprint', async () => {
        const first = await buildBoardExportPayload();
        assert.ok(first.filename.startsWith(BOARD_FILE_PREFIX));
        const second = await buildBoardExportPayload();
        assert.equal(second.textForFingerprint, first.textForFingerprint);
    });

    it('restores board keys without touching notes or canvas', async () => {
        const payload = await buildBoardExportPayload();
        const parsed = parseBackupPackage(payload.text);
        assert.equal(parsed.kind, BOARD_PACKAGE_KIND);
        await applyBackupToStorage(parsed);
        assert.deepEqual(
            JSON.parse(localStorage.getItem('matrix_freeform_positions')),
            { item_1_a: { x: 3, y: 4 } }
        );
        assert.equal(localStorage.getItem('matrix_global_drawing'), null);
        const stored = readStored();
        assert.deepEqual(stored.items.map((item) => item.id), ['item_1_a']);
    });
});

describe('backup streams · canvas payload', () => {
    beforeEach(() => {
        localStorage.clear();
        seed([note()]);
    });

    it('has its own filename prefix and stable fingerprint', async () => {
        const first = await buildCanvasExportPayload();
        assert.ok(first.filename.startsWith(CANVAS_FILE_PREFIX));
        const second = await buildCanvasExportPayload();
        assert.equal(second.textForFingerprint, first.textForFingerprint);
    });

    it('restores the document without touching board geometry', async () => {
        localStorage.setItem('matrix_grid_layout', JSON.stringify({ item_1_a: { moved: true } }));
        const payload = await buildCanvasExportPayload();
        const parsed = JSON.parse(payload.text);
        assert.equal(parsed.kind, CANVAS_PACKAGE_KIND);
        await applyBackupToStorage(parsed);
        assert.deepEqual(
            JSON.parse(localStorage.getItem('matrix_grid_layout')),
            { item_1_a: { moved: true } }
        );
        assert.ok(localStorage.getItem('matrix_global_drawing'));
        assert.ok(Array.isArray(parsed.referencedMediaIds));
    });

    it('restores cleanly even when referenced media ids are recorded', async () => {
        // Canvas packages never embed media — the manifest is advisory only, so
        // restoring one with unknown ids must not throw and must not invent
        // media records.
        const payload = await buildCanvasExportPayload();
        const parsed = JSON.parse(payload.text);
        parsed.referencedMediaIds = ['media_missing_1', 'media_missing_2'];
        await applyBackupToStorage(parsed);
        assert.ok(localStorage.getItem('matrix_global_drawing'));
    });
});

describe('backup streams · scheduler config migration', () => {
    it('migrates the old session toggle onto board + canvas', async () => {
        const { hashExportFingerprint } = await import('../js/backup.js');
        assert.equal(typeof hashExportFingerprint, 'function');

        const { normalizeConfig } = await import('../js/scheduledBackupConfig.js');
        // Old toggle on → both streams on.
        const on = normalizeConfig({ session: { enabled: true, lastFingerprint: 'old' } });
        assert.equal(on.board.enabled, true);
        assert.equal(on.canvas.enabled, true);
        // Old fingerprint must NOT carry over — the first tick re-exports both.
        assert.equal(on.board.lastFingerprint, null);
        assert.equal(on.canvas.lastFingerprint, null);
        // Old toggle off → both streams off.
        const off = normalizeConfig({ session: { enabled: false } });
        assert.equal(off.board.enabled, false);
        assert.equal(off.canvas.enabled, false);
    });
});

describe('backup streams · patch import', () => {
    beforeEach(() => {
        localStorage.clear();
        seed([note(), note({ id: 'item_2_b', title: 'Second' })]);
    });

    it('parses board, canvas and patch packages; rejects junk', async () => {
        const board = await buildBoardBackupPackage();
        assert.ok(parseBackupPackage(JSON.stringify(board)));
        const canvas = await buildCanvasBackupPackage();
        assert.ok(parseBackupPackage(JSON.stringify(canvas)));
        assert.throws(() => parseBackupPackage(JSON.stringify({ foo: 1 })));
    });

    it('merges a patch onto the live database instead of replacing it', async () => {
        const base = await buildNotesExportPayload({ incremental: true });
        seed([note({ title: 'Edited' })]); // item_2_b removed locally
        const patch = await buildNotesExportPayload({ incremental: true, snapshot: base.nextSnapshot });
        const parsedPatch = parseBackupPackage(patch.text);

        const resolved = resolveImportedPackage(parsedPatch);
        assert.deepEqual(resolved.matrix_database.items.map((item) => item.id), ['item_1_a']);
        assert.equal(resolved.matrix_database.items[0].title, 'Edited');
        assert.equal(resolved.kind, undefined);

        await applyBackupToStorage(parsedPatch);
        const stored = readStored();
        assert.deepEqual(stored.items.map((item) => item.id), ['item_1_a']);
        assert.equal(stored.items[0].title, 'Edited');
        assert.equal(stored.auth.admin_token, 'tok');
    });

    it('keeps notes the patch does not mention', async () => {
        const parsedPatch = {
            kind: NOTES_PATCH_KIND,
            baseAt: 1,
            matrix_database: { items: [note({ title: 'Touched' })] },
            delta: { upserted: ['item_1_a'], removed: [], itemCount: 2 }
        };
        await applyBackupToStorage(parsedPatch);
        const stored = readStored();
        assert.deepEqual(stored.items.map((item) => item.id).sort(), ['item_1_a', 'item_2_b']);
        assert.equal(stored.items.find((item) => item.id === 'item_1_a').title, 'Touched');
    });

    it('still replaces the workspace for full packages', async () => {
        const full = await buildNotesExportPayload({ incremental: false });
        await applyBackupToStorage(parseBackupPackage(full.text));
        assert.deepEqual(readStored().items.map((item) => item.id).sort(), ['item_1_a', 'item_2_b']);
    });
});
