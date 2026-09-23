// test/backupFilename.test.js
// Cloud + local checkpoint listing must accept both legacy JSON packages and
// magicnotes_*_export_*.zip checkpoint bundles.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    BACKUP_FILE_PREFIX,
    isBackupFilename,
    timestampFromBackupFilename
} from '../js/backup.js';
import {
    checkpointFilename,
    normalizeNotesSection,
    normalizeBoardSection,
    normalizeCanvasSection,
    normalizeMediaSection,
    sanitizeFilenameTag
} from '../js/scheduledBackupConfig.js';

describe('isBackupFilename / timestampFromBackupFilename', () => {
    it('accepts legacy and current JSON backup names', () => {
        assert.equal(isBackupFilename('magicnotes_backup_1710000000.json'), true);
        assert.equal(isBackupFilename('matrix_workspace_backup_1710000000.json'), true);
        assert.equal(timestampFromBackupFilename('magicnotes_backup_1710000000.json'), 1710000000);
    });

    it('accepts checkpoint ZIP names with and without a personal tag', () => {
        assert.equal(isBackupFilename('magicnotes_export_1710000000.zip'), true);
        assert.equal(isBackupFilename('magicnotes_luna_export_1710000000.zip'), true);
        assert.equal(isBackupFilename(checkpointFilename('luna', 1710000000)), true);
        assert.equal(timestampFromBackupFilename('magicnotes_luna_export_1710000000.zip'), 1710000000);
        assert.equal(timestampFromBackupFilename('magicnotes_export_1710000000.zip'), 1710000000);
    });

    it('accepts magicnotes_backup_*.zip archive names', () => {
        assert.equal(isBackupFilename(`${BACKUP_FILE_PREFIX}1710000000.zip`), true);
        assert.equal(timestampFromBackupFilename(`${BACKUP_FILE_PREFIX}1710000000.zip`), 1710000000);
    });

    it('rejects unrelated files', () => {
        assert.equal(isBackupFilename('notes.txt'), false);
        assert.equal(isBackupFilename('magicnotes_notes_backup_1.json'), false);
        assert.equal(isBackupFilename('random.zip'), false);
        assert.equal(timestampFromBackupFilename('random.zip'), null);
    });
});

describe('cloud parts config normals', () => {
    it('defaults notes/board/canvas enabled and media off', () => {
        assert.equal(normalizeNotesSection(undefined).enabled, true);
        assert.equal(normalizeBoardSection(undefined).enabled, true);
        assert.equal(normalizeCanvasSection(undefined).enabled, true);
        assert.equal(normalizeMediaSection(undefined).enabled, false);
        assert.equal(sanitizeFilenameTag('Lu Na!!'), 'luna');
    });
});
