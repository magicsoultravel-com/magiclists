/**
 * @module {"owns":"pure scheduled-backup config shape + old-session migration","related":["scheduledBackup.js","backupClaim.js","backupDelta.js"]}
 *
 * DOM-free so node --test can cover the config migration (old single LAYOUT &
 * CANVAS toggle → board/canvas streams) without loading the scheduler UI.
 */
import { normalizeClaim } from './backupClaim.js';
import { normalizeNotesSnapshot } from './backupDelta.js';

/** Max characters for the personal filename tag. */
export const FILENAME_TAG_MAX = 8;

/**
 * Personal tag that lands inside scheduled filenames —
 * `magicnotes_<tag>_export_<ts>.zip`. Kept boring on purpose: lowercase
 * letters, digits, dash and underscore only, capped at 8 chars, everything
 * else stripped (never rejected), so a user can paste anything safely.
 * Empty result → no tag, files fall back to `magicnotes_export_<ts>.zip`.
 * @param {unknown} raw
 * @returns {string}
 */
export function sanitizeFilenameTag(raw) {
    return String(raw ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '')
        .slice(0, FILENAME_TAG_MAX);
}

/**
 * Scheduled checkpoint bundle filename.
 * @param {string} tag sanitized personal tag (may be empty)
 * @param {number} [timestamp] unix seconds
 */
export function checkpointFilename(tag, timestamp = Math.floor(Date.now() / 1000)) {
    const clean = sanitizeFilenameTag(tag);
    return `magicnotes_${clean ? `${clean}_` : ''}export_${timestamp}.zip`;
}

export function clampAmount(value, { allowZero = false } = {}) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return allowZero ? 0 : 1;
    const min = allowZero ? 0 : 1;
    return Math.min(99, Math.max(min, n));
}

export function normalizeNotesSection(raw, legacy) {
    const format = raw?.format === 'txt' ? 'txt' : 'json';
    return {
        enabled: raw?.enabled !== undefined ? !!raw.enabled : true,
        format,
        // Incremental content: first run writes a full baseline, later runs write
        // only the notes that changed (magicnotes_notes_incr_*.json).
        incremental: raw?.incremental !== undefined ? !!raw.incremental : true,
        lastMode: raw?.lastMode === 'incremental' ? 'incremental' : (raw?.lastMode === 'full' ? 'full' : null),
        patchSnapshot: normalizeNotesSnapshot(raw?.patchSnapshot),
        lastFingerprint: typeof raw?.lastFingerprint === 'string'
            ? raw.lastFingerprint
            : (typeof legacy?.lastFingerprint === 'string' ? legacy.lastFingerprint : null),
        lastExportAt: Number.isFinite(Number(raw?.lastExportAt)) ? Number(raw.lastExportAt) : null
    };
}

/**
 * Board stream: note positions + board/sidebar chrome. Own stream so dragging
 * a card never rewrites (or re-downloads) the notes or canvas files.
 */
export function normalizeBoardSection(raw) {
    return {
        enabled: raw?.enabled !== undefined ? !!raw.enabled : true,
        lastFingerprint: typeof raw?.lastFingerprint === 'string' ? raw.lastFingerprint : null,
        lastExportAt: Number.isFinite(Number(raw?.lastExportAt)) ? Number(raw.lastExportAt) : null
    };
}

/**
 * Canvas stream: the magicCanvas document + its own prefs. Own stream so a
 * brush stroke never rewrites (or re-downloads) notes or board positions.
 */
export function normalizeCanvasSection(raw) {
    return {
        enabled: raw?.enabled !== undefined ? !!raw.enabled : true,
        lastFingerprint: typeof raw?.lastFingerprint === 'string' ? raw.lastFingerprint : null,
        lastExportAt: Number.isFinite(Number(raw?.lastExportAt)) ? Number(raw.lastExportAt) : null
    };
}

export function normalizeMediaSection(raw) {
    const zipSnapshot = raw?.zipSnapshot && typeof raw.zipSnapshot === 'object' ? raw.zipSnapshot : {};
    return {
        enabled: !!raw?.enabled,
        incremental: !!raw?.incremental,
        lastMetaFingerprint: typeof raw?.lastMetaFingerprint === 'string' ? raw.lastMetaFingerprint : null,
        lastMetaExportAt: Number.isFinite(Number(raw?.lastMetaExportAt)) ? Number(raw.lastMetaExportAt) : null,
        lastZipFingerprint: typeof raw?.lastZipFingerprint === 'string' ? raw.lastZipFingerprint : null,
        lastZipExportAt: Number.isFinite(Number(raw?.lastZipExportAt)) ? Number(raw.lastZipExportAt) : null,
        lastZipMode: raw?.lastZipMode === 'incremental' ? 'incremental' : (raw?.lastZipMode === 'full' ? 'full' : null),
        zipSnapshot
    };
}

export function normalizeConfig(raw) {
    const unit = raw?.unit === 'hours' ? 'hours' : 'minutes';
    const legacyFormat = raw?.format;
    const hasLegacyShape = legacyFormat != null && raw?.notes == null;
    return {
        enabled: !!raw?.enabled,
        paused: !!raw?.paused,
        amount: clampAmount(raw?.amount ?? 30, { allowZero: true }),
        unit,
        nextDueAt: Number.isFinite(Number(raw?.nextDueAt)) ? Number(raw.nextDueAt) : null,
        remainingMsWhenPaused: Number.isFinite(Number(raw?.remainingMsWhenPaused))
            ? Number(raw.remainingMsWhenPaused)
            : null,
        runningClaim: normalizeClaim(raw?.runningClaim),
        // Personal filename tag for the checkpoint bundle (sanitized on every
        // read so a hand-edited config can never poison a filename).
        tag: sanitizeFilenameTag(raw?.tag),
        notes: normalizeNotesSection(raw?.notes, hasLegacyShape ? raw : null),
        media: normalizeMediaSection(raw?.media),
        // One-way migration from the old single LAYOUT & CANVAS toggle. If the
        // user had explicitly disabled it, both new streams start disabled so we
        // never silently start downloading files they turned off. No fingerprint
        // is carried over, so the first enabled run writes both files once.
        board: raw?.board
            ? normalizeBoardSection(raw.board)
            // Migrating the legacy toggle: drop its fingerprint/timestamp so the
            // first enabled tick re-exports both streams under the new format.
            : normalizeBoardSection(
                raw?.session ? { enabled: raw.session.enabled } : undefined
            ),
        canvas: raw?.canvas
            ? normalizeCanvasSection(raw.canvas)
            : normalizeCanvasSection(
                raw?.session ? { enabled: raw.session.enabled } : undefined
            )
    };
}
