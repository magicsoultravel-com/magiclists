/**
 * @module {"owns":"checkpoint bundle export — one ZIP per scheduled tick with the incremental parts inside","related":["backup.js","mediaBackup.js","scheduledBackupConfig.js","scheduledBackup.js"]}
 *
 * Packaging only: each part is built by the stream builders that already exist
 * (notes baseline/patch, board, canvas, media meta, incremental media files)
 * and folded into a single ZIP so the user downloads ONE file per checkpoint.
 * Per-part fingerprints still gate what goes in — a note-only change produces
 * a tiny bundle with just the notes part; nothing changed produces nothing.
 */
import {
    buildNotesExportPayload,
    buildBoardExportPayload,
    buildCanvasExportPayload,
    serializeBackupPackage
} from './backup.js';
import {
    buildMediaMetaExportPayload,
    collectMediaZipEntries,
    buildZipStore
} from './mediaBackup.js';
import { hashExportFingerprint } from './backupDelta.js';
import { checkpointFilename } from './scheduledBackupConfig.js';

const CHECKPOINT_MANIFEST_NAME = 'checkpoint.json';
export const CHECKPOINT_BUNDLE_KIND = 'magicnotes_checkpoint';

const encoder = new TextEncoder();
const encode = (text) => encoder.encode(text);

/**
 * Build the scheduled checkpoint bundle.
 *
 * @param {object} config normalized scheduler config (notes/media/board/canvas/tag)
 * @param {{ notesTxtPayload?: object }} [extras] TXT payload built by the
 *   scheduler (needs live items); omitted unless notes.format === 'txt'.
 * @returns {Promise<{
 *   skipped: boolean,
 *   blob: Blob|null,
 *   filename: string|null,
 *   timestamp: number,
 *   patches: { notes?: object, media?: object, board?: object, canvas?: object }
 * }>}
 */
export async function buildCheckpointExportPayload(config, extras = {}) {
    const timestamp = Math.floor(Date.now() / 1000);
    const parts = []; // [{ name, data }]
    const patches = {}; // per-stream results for finalizeClaim

    // Failure isolation: one broken stream must never sink the bundle. A part
    // that throws is dropped (and logged); every other part still ships.
    const safe = async (label, fn) => {
        try {
            return await fn();
        } catch (err) {
            console.warn(`[checkpointBundle] ${label} part failed`, err);
            return null;
        }
    };

    // ---- NOTES -------------------------------------------------------------
    if (config.notes?.enabled) {
        if (config.notes.format === 'txt') {
            const payload = extras.notesTxtPayload;
            const text = payload?.text ?? '';
            const fingerprint = hashExportFingerprint(payload?.textForFingerprint || text);
            if (text && fingerprint !== config.notes.lastFingerprint) {
                parts.push({ name: 'notes.txt', data: encode(text) });
                patches.notes = { lastFingerprint: fingerprint, lastExportAt: timestamp };
            }
        } else {
            const payload = await safe('notes', () => buildNotesExportPayload({
                incremental: !!config.notes.incremental,
                snapshot: config.notes.patchSnapshot
            }));
            if (payload && !payload.skipped) {
                const fingerprint = hashExportFingerprint(payload.textForFingerprint || payload.text);
                // Baselines dedupe by fingerprint; patches are already gated by
                // the revision snapshot, so never skip them by fingerprint.
                if (payload.isIncremental || fingerprint !== config.notes.lastFingerprint) {
                    parts.push({ name: 'notes.json', data: encode(payload.text) });
                    patches.notes = {
                        lastFingerprint: fingerprint,
                        lastExportAt: timestamp,
                        patchSnapshot: payload.nextSnapshot,
                        lastMode: payload.isIncremental ? 'incremental' : 'full'
                    };
                }
            }
        }
    }

    // ---- BOARD -------------------------------------------------------------
    if (config.board?.enabled) {
        const payload = await safe('board', () => buildBoardExportPayload());
        const fingerprint = payload
            ? hashExportFingerprint(payload.textForFingerprint || payload.text)
            : null;
        if (payload && fingerprint !== config.board.lastFingerprint) {
            parts.push({ name: 'board.json', data: encode(payload.text) });
            patches.board = { lastFingerprint: fingerprint, lastExportAt: timestamp };
        }
    }

    // ---- CANVAS ------------------------------------------------------------
    if (config.canvas?.enabled) {
        const payload = await safe('canvas', () => buildCanvasExportPayload());
        const fingerprint = payload
            ? hashExportFingerprint(payload.textForFingerprint || payload.text)
            : null;
        if (payload && fingerprint !== config.canvas.lastFingerprint) {
            parts.push({ name: 'canvas.json', data: encode(payload.text) });
            patches.canvas = { lastFingerprint: fingerprint, lastExportAt: timestamp };
        }
    }

    // ---- MEDIA -------------------------------------------------------------
    const mediaPatch = {};
    if (config.media?.enabled) {
        const metaPayload = await safe('media meta', () => buildMediaMetaExportPayload());
        const metaFp = metaPayload
            ? hashExportFingerprint(metaPayload.textForFingerprint || metaPayload.text)
            : null;
        if (metaPayload && metaFp !== config.media.lastMetaFingerprint) {
            parts.push({ name: 'media_meta.json', data: encode(metaPayload.text) });
            mediaPatch.lastMetaFingerprint = metaFp;
            mediaPatch.lastMetaExportAt = timestamp;
        }

        const zip = await safe('media zip', () => collectMediaZipEntries({
            incremental: !!config.media.incremental,
            zipSnapshot: config.media.zipSnapshot,
            pathPrefix: 'media/'
        }));
        if (zip && !zip.skipped) {
            const zipFp = hashExportFingerprint(zip.textForFingerprint);
            if (zipFp !== config.media.lastZipFingerprint) {
                parts.push(...zip.zipFiles);
                mediaPatch.lastZipFingerprint = zipFp;
                mediaPatch.lastZipExportAt = timestamp;
                mediaPatch.lastZipMode = zip.isIncremental ? 'incremental' : 'full';
                mediaPatch.zipSnapshot = zip.nextSnapshot;
            }
        }
    }
    if (Object.keys(mediaPatch).length) patches.media = mediaPatch;

    // ---- Nothing changed → no download at all ------------------------------
    if (!parts.length) {
        return { skipped: true, blob: null, filename: null, timestamp, patches: {} };
    }

    const manifest = {
        kind: CHECKPOINT_BUNDLE_KIND,
        version: 1,
        timestamp,
        parts: {}
    };
    for (const part of parts) {
        if (part.name === 'notes.json' || part.name === 'notes.txt') {
            manifest.parts.notes = part.name;
        } else if (part.name === 'board.json') {
            manifest.parts.board = part.name;
        } else if (part.name === 'canvas.json') {
            manifest.parts.canvas = part.name;
        } else if (part.name === 'media_meta.json') {
            manifest.parts.mediaMeta = part.name;
        }
    }
    if (parts.some((part) => part.name.startsWith('media/'))) {
        manifest.parts.mediaZip = true;
    }
    parts.unshift({
        name: CHECKPOINT_MANIFEST_NAME,
        data: encode(serializeBackupPackage(manifest))
    });

    return {
        skipped: false,
        blob: buildZipStore(parts),
        filename: checkpointFilename(config.tag, timestamp),
        timestamp,
        patches
    };
}
