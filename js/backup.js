/** @module {"owns":"local backup export/import, encrypted packages, notes content/layout streams", "related":["cloudBackup.js","api.js","backupDelta.js"]} */
import { repairDatabase } from './api.js';
import {
    ensureUncategorizedCategory,
    normalizeCategories,
    readStoredCategories,
    writeStoredCategories
} from './categories.js';
import { applyBoardBackupKeys, applyCanvasBackupKeys, applyLayoutBackupKeys, getBoardBackupKeys, getCanvasBackupKeys, getLayoutBackupKeys, repairSpatialLayoutStorage } from './layoutStorage.js';
import { applyDrawingBackupKeys, getCanvasDocumentBackupKeys } from './drawingBoard.js';
import { getCreatedTimestamp, getUpdatedTimestamp } from './noteModel.js';
import { applyMediaLibraryBackupSection, buildMediaLibraryBackupSection, applyMediaFromZipMap, collectMediaZipEntries, buildZipStore, readZip } from './mediaBackup.js';
import {
    NOTES_PATCH_KIND,
    diffNotesAgainstSnapshot,
    hashExportFingerprint,
    isNotesPatchPackage,
    mergeNotesPatchDatabase,
    normalizeNotesSnapshot
} from './backupDelta.js';

export { hashExportFingerprint } from './backupDelta.js';

export const BACKUP_FILE_PREFIX = 'magicnotes_backup_';
export const LEGACY_BACKUP_FILE_PREFIX = 'matrix_workspace_backup_';
export const TXT_FILE_PREFIX = 'magicnotes_notes_';
export const ENCRYPTED_BACKUP_MARKER = 'matrix_encrypted_backup';
export const LAST_LOCAL_EXPORT_KEY = 'matrix_last_local_export_at';
export const LAST_LOCAL_TXT_EXPORT_KEY = 'matrix_last_local_txt_export_at';
export const LAST_MEDIA_META_EXPORT_KEY = 'matrix_last_media_meta_export_at';
export const LAST_MEDIA_ZIP_EXPORT_KEY = 'matrix_last_media_zip_export_at';
const CLOUD_CONFIG_KEY = 'matrix_cloud_config';

/** Scheduled notes content streams (baseline full + incremental patches). */
export const NOTES_BASELINE_FILE_PREFIX = 'magicnotes_notes_backup_';
export const NOTES_PATCH_FILE_PREFIX = 'magicnotes_notes_incr_';
/** Board stream: note positions + board/sidebar chrome (tiny, high-frequency). */
export const BOARD_FILE_PREFIX = 'magicnotes_board_';
export const BOARD_PACKAGE_KIND = 'magicnotes_board';
/** Canvas stream: the magicCanvas document + its own prefs (large, low-frequency). */
export const CANVAS_FILE_PREFIX = 'magicnotes_canvas_';
export const CANVAS_PACKAGE_KIND = 'magicnotes_canvas';

export function formatExportTimestamp(timestamp) {
    if (!timestamp) return 'Never';
    return new Date(timestamp * 1000).toLocaleString();
}

export function readLastLocalExportAt() {
    try {
        const ts = Number(localStorage.getItem(LAST_LOCAL_EXPORT_KEY));
        return Number.isFinite(ts) ? ts : null;
    } catch {
        return null;
    }
}

export function writeLastLocalExportAt(timestamp) {
    if (!Number.isFinite(timestamp)) return;
    localStorage.setItem(LAST_LOCAL_EXPORT_KEY, String(timestamp));
}

export function readLastLocalTxtExportAt() {
    try {
        const ts = Number(localStorage.getItem(LAST_LOCAL_TXT_EXPORT_KEY));
        return Number.isFinite(ts) ? ts : null;
    } catch {
        return null;
    }
}

export function writeLastLocalTxtExportAt(timestamp) {
    if (!Number.isFinite(timestamp)) return;
    localStorage.setItem(LAST_LOCAL_TXT_EXPORT_KEY, String(timestamp));
}

export function readLastMediaMetaExportAt() {
    try {
        const ts = Number(localStorage.getItem(LAST_MEDIA_META_EXPORT_KEY));
        return Number.isFinite(ts) ? ts : null;
    } catch {
        return null;
    }
}

export function writeLastMediaMetaExportAt(timestamp) {
    if (!Number.isFinite(timestamp)) return;
    localStorage.setItem(LAST_MEDIA_META_EXPORT_KEY, String(timestamp));
}

export function readLastMediaZipExportAt() {
    try {
        const ts = Number(localStorage.getItem(LAST_MEDIA_ZIP_EXPORT_KEY));
        return Number.isFinite(ts) ? ts : null;
    } catch {
        return null;
    }
}

export function writeLastMediaZipExportAt(timestamp) {
    if (!Number.isFinite(timestamp)) return;
    localStorage.setItem(LAST_MEDIA_ZIP_EXPORT_KEY, String(timestamp));
}

export function readLastCloudExportAt() {
    try {
        const config = JSON.parse(localStorage.getItem(CLOUD_CONFIG_KEY) || 'null');
        const ts = Number(config?.lastCheckpointAt);
        return Number.isFinite(ts) ? ts : null;
    } catch {
        return null;
    }
}

export function backupFilename(timestamp = Math.floor(Date.now() / 1000)) {
    return `${BACKUP_FILE_PREFIX}${timestamp}.json`;
}

export function archiveFilename(timestamp = Math.floor(Date.now() / 1000)) {
    return `${BACKUP_FILE_PREFIX}${timestamp}.zip`;
}

export function txtExportFilename(date = new Date()) {
    const day = date instanceof Date ? date : new Date();
    return `${TXT_FILE_PREFIX}${day.toISOString().split('T')[0]}.txt`;
}

export function notesBaselineFilename(timestamp = Math.floor(Date.now() / 1000)) {
    return `${NOTES_BASELINE_FILE_PREFIX}${timestamp}.json`;
}

export function notesPatchFilename(timestamp = Math.floor(Date.now() / 1000)) {
    return `${NOTES_PATCH_FILE_PREFIX}${timestamp}.json`;
}

export function boardFilename(timestamp = Math.floor(Date.now() / 1000)) {
    return `${BOARD_FILE_PREFIX}${timestamp}.json`;
}

export function canvasFilename(timestamp = Math.floor(Date.now() / 1000)) {
    return `${CANVAS_FILE_PREFIX}${timestamp}.json`;
}

/** Parse a raw localStorage value into JSON, falling back to the raw string. */
function parseStoredValue(raw) {
    if (raw == null) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

/** Turn a `{ key: rawString }` map into a `{ key: parsedValue }` map. */
function parseKeyMap(keyMap) {
    return Object.fromEntries(
        Object.entries(keyMap).map(([key, raw]) => [key, parseStoredValue(raw)])
    );
}

function readDesktopsConfig() {
    const raw = localStorage.getItem('magicnotes_desktops_config');
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/** Notes content + categories + desktop config. No media, no layout/canvas. */
export async function buildContentBackupPackage() {
    return buildBackupPackage({ include: 'content' });
}

/** Board stream: note positions + board/sidebar chrome only. No canvas document. */
export async function buildBoardBackupPackage() {
    return buildBackupPackage({ include: 'board' });
}

/** Canvas stream: magicCanvas document + its own prefs only. No board geometry. */
export async function buildCanvasBackupPackage() {
    return buildBackupPackage({ include: 'canvas' });
}

/**
 * Build a backup package.
 *
 * `include` keeps the export concerns separate so the frequent (scheduled)
 * notes file never carries binaries, layout or canvas state:
 *   - `all`     (default, legacy) — notes + media_library + layout + canvas
 *   - `content` — notes db + categories + desktops only
 *   - `board`   — note positions + board/sidebar chrome only
 *   - `canvas`  — magicCanvas document + its own prefs only
 *
 * @param {{ embed?: boolean, include?: 'all'|'content'|'board'|'canvas' }} [opts]
 */
export async function buildBackupPackage(opts = {}) {
    const embed = opts.embed !== false;
    const includeRaw = opts.include;
    const include = includeRaw === 'content'
        || includeRaw === 'board'
        || includeRaw === 'canvas'
        ? includeRaw : 'all';
    const timestamp = Math.floor(Date.now() / 1000);
    const pkg = { timestamp };

    // Notes content only rides the content + all streams. Board/canvas/session
    // packages must never carry the whole note database next to a few keys.
    if (include === 'content' || include === 'all') {
        const categories = readStoredCategories({ keepEmpty: true });
        writeStoredCategories(categories, { keepEmpty: true });

        const databasePayload = localStorage.getItem('matrix_database');
        let matrix_database = parseStoredValue(databasePayload);
        if (matrix_database) {
            // Run the shared non-destructive repair so exports are always clean:
            // drops id-less structural-twin duplicates and backfills missing
            // id/schema metadata. This prevents a malformed local state (e.g. an
            // id-less snapshot pushed as a new item) from being serialized as
            // authoritative.
            matrix_database = repairDatabase(matrix_database);
            matrix_database = {
                ...matrix_database,
                settings: {
                    ...(matrix_database.settings || {}),
                    categories: categories.map((cat) => cat.name)
                }
            };
        }

        pkg.matrix_database = matrix_database;
        pkg.matrix_custom_categories = categories;
        pkg.desktopsConfig = readDesktopsConfig();

        // Media binaries belong to the media stream (meta JSON + ZIP), never to
        // the notes content file — embedding them here duplicated the library.
        if (include === 'all') {
            try {
                pkg.media_library = await buildMediaLibraryBackupSection({ embed });
            } catch (err) {
                console.warn('[Backup] media_library section skipped', err);
                pkg.media_library = { version: 1, exportedAt: timestamp, items: [] };
            }
        }
    }

    if (include === 'board') {
        pkg.kind = BOARD_PACKAGE_KIND;
        Object.assign(pkg, parseKeyMap(getBoardBackupKeys()));
    }

    if (include === 'canvas') {
        pkg.kind = CANVAS_PACKAGE_KIND;
        Object.assign(pkg, parseKeyMap(getCanvasBackupKeys()));
        Object.assign(pkg, parseKeyMap(await getCanvasDocumentBackupKeys()));
    }

    if (include === 'all') {
        // Manual / cloud / combined-archive shape: everything except binaries.
        Object.assign(pkg, parseKeyMap(getLayoutBackupKeys()));
        Object.assign(pkg, parseKeyMap(getCanvasBackupKeys()));
        Object.assign(pkg, parseKeyMap(await getCanvasDocumentBackupKeys()));
    }

    return pkg;
}

/** Stable fingerprint text for a backup package (strips wall-clock fields). */
export function stableBackupFingerprintText(backupPackage) {
    const { timestamp: _ts, media_library: mediaLib, ...stableRest } = backupPackage || {};
    const stableMedia = mediaLib && typeof mediaLib === 'object'
        ? (() => {
            const { exportedAt: _exportedAt, ...restMedia } = mediaLib;
            return restMedia;
        })()
        : mediaLib;
    return serializeBackupPackage({
        ...stableRest,
        media_library: stableMedia
    });
}

/**
 * Full restore archive: workspace.json + media/ tree.
 * @returns {Promise<{
 *   blob: Blob,
 *   filename: string,
 *   timestamp: number,
 *   textForFingerprint: string,
 *   nextSnapshot: Record<string, number>
 * }>}
 */
export async function buildFullBackupArchivePayload() {
    const backupPackage = await buildBackupPackage({ embed: false });
    const encoder = new TextEncoder();
    const workspaceText = serializeBackupPackage(backupPackage);
    const media = await collectMediaZipEntries({
        incremental: false,
        pathPrefix: 'media/'
    });

    const zipFiles = [
        { name: 'workspace.json', data: encoder.encode(workspaceText) },
        ...media.zipFiles
    ];

    const timestamp = backupPackage.timestamp || media.timestamp || Math.floor(Date.now() / 1000);
    const textForFingerprint = JSON.stringify({
        workspace: stableBackupFingerprintText(backupPackage),
        media: media.textForFingerprint
    });

    return {
        blob: buildZipStore(zipFiles),
        filename: archiveFilename(timestamp),
        timestamp,
        textForFingerprint,
        nextSnapshot: media.nextSnapshot || {}
    };
}

/**
 * Build the scheduled notes export payload — a full content baseline the first
 * time (and whenever incremental is off), otherwise a patch with just the notes
 * that changed since the stored snapshot. Mirrors the media ZIP stream:
 * `skipped` means there is nothing to write, and `nextSnapshot` is persisted by
 * the caller so the next patch stays relative to the previous one.
 *
 * @param {{ incremental?: boolean, snapshot?: object }} [opts]
 * @returns {Promise<{
 *   skipped: boolean,
 *   isIncremental: boolean,
 *   nextSnapshot: object,
 *   text: string|null,
 *   textForFingerprint: string|null,
 *   blob: Blob|null,
 *   filename: string|null,
 *   timestamp: number
 * }>}
 */
export async function buildNotesExportPayload(opts = {}) {
    const incremental = !!opts.incremental;
    const snapshot = normalizeNotesSnapshot(opts.snapshot);
    const hasBaseline = snapshot.baseAt != null;
    const timestamp = Math.floor(Date.now() / 1000);

    const pkg = await buildContentBackupPackage();
    pkg.timestamp = timestamp;

    const items = Array.isArray(pkg.matrix_database?.items) ? pkg.matrix_database.items : [];
    const { changed, removed, revisions } = diffNotesAgainstSnapshot(items, snapshot);
    const categoriesFp = hashExportFingerprint(JSON.stringify(pkg.matrix_custom_categories || []));
    const desktopsFp = hashExportFingerprint(JSON.stringify(pkg.desktopsConfig ?? null));
    const headerChanged = categoriesFp !== snapshot.categories || desktopsFp !== snapshot.desktops;

    if (!incremental || !hasBaseline) {
        const text = serializeBackupPackage(pkg);
        return {
            skipped: false,
            isIncremental: false,
            nextSnapshot: {
                baseAt: timestamp,
                items: revisions,
                categories: categoriesFp,
                desktops: desktopsFp
            },
            text,
            textForFingerprint: stableBackupFingerprintText(pkg),
            blob: new Blob([text], { type: 'application/json' }),
            filename: notesBaselineFilename(timestamp),
            timestamp
        };
    }

    if (!changed.length && !removed.length && !headerChanged) {
        return {
            skipped: true,
            isIncremental: true,
            nextSnapshot: { ...snapshot, items: revisions },
            text: null,
            textForFingerprint: null,
            blob: null,
            filename: null,
            timestamp
        };
    }

    const patch = {
        kind: NOTES_PATCH_KIND,
        version: 1,
        timestamp,
        baseAt: snapshot.baseAt,
        matrix_custom_categories: pkg.matrix_custom_categories,
        desktopsConfig: pkg.desktopsConfig,
        matrix_database: { ...(pkg.matrix_database || {}), items: changed },
        delta: {
            upserted: changed.map((item) => item?.id).filter(Boolean),
            removed,
            itemCount: items.length
        }
    };
    const text = serializeBackupPackage(patch);

    return {
        skipped: false,
        isIncremental: true,
        nextSnapshot: {
            baseAt: snapshot.baseAt,
            items: revisions,
            categories: categoriesFp,
            desktops: desktopsFp
        },
        text,
        textForFingerprint: stableBackupFingerprintText(patch),
        blob: new Blob([text], { type: 'application/json' }),
        filename: notesPatchFilename(timestamp),
        timestamp
    };
}

/** Board stream payload: positions + chrome, no canvas document. */
export async function buildBoardExportPayload() {
    const pkg = await buildBoardBackupPackage();
    const text = serializeBackupPackage(pkg);
    return {
        text,
        textForFingerprint: stableBackupFingerprintText(pkg),
        blob: new Blob([text], { type: 'application/json' }),
        filename: boardFilename(pkg.timestamp),
        timestamp: pkg.timestamp
    };
}

/** Canvas stream payload: the drawing document on its own fingerprint. */
export async function buildCanvasExportPayload() {
    const pkg = await buildCanvasBackupPackage();
    const text = serializeBackupPackage(pkg);
    return {
        text,
        textForFingerprint: stableBackupFingerprintText(pkg),
        blob: new Blob([text], { type: 'application/json' }),
        filename: canvasFilename(pkg.timestamp),
        timestamp: pkg.timestamp
    };
}

/**
 * Restore a full archive ZIP (workspace.json + media/).
 * @param {File|Blob} file
 */
export async function importFullBackupArchive(file) {
    const buffer = await file.arrayBuffer();
    const files = await readZip(buffer);
    const workspaceBytes = files.get('workspace.json');
    if (!workspaceBytes) {
        throw new Error('Not a Magic Notes full backup (missing workspace.json)');
    }
    const parsed = parseBackupPackage(new TextDecoder().decode(workspaceBytes));
    await applyBackupToStorage(parsed);
    if (files.has('media/manifest.json')) {
        await applyMediaFromZipMap(files, {
            manifestPath: 'media/manifest.json',
            filesPrefix: 'media/'
        });
    }
    return parsed;
}

export function serializeBackupPackage(pkg) {
    return JSON.stringify(pkg, null, 2);
}

/** Any package this app produced (full, legacy, content, patch or session). */
export function isRecognizedBackupPackage(parsed) {
    if (!parsed || typeof parsed !== 'object') return false;
    if (parsed.matrix_database || parsed.matrix_custom_categories) return true;
    if (parsed.desktopsConfig || parsed.media_library) return true;
    if (parsed.kind === BOARD_PACKAGE_KIND || parsed.kind === CANVAS_PACKAGE_KIND || isNotesPatchPackage(parsed)) return true;
    // Layout/canvas-only payloads are just a set of `matrix_*` keys.
    return Object.keys(parsed).some((key) => key.startsWith('matrix_'));
}

export function parseBackupPackage(text) {
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid backup package');
    }
    if (parsed[ENCRYPTED_BACKUP_MARKER]) {
        throw new Error('Encrypted backup — passphrase required.');
    }
    if (!isRecognizedBackupPackage(parsed)) {
        throw new Error('Not a Magic Lists backup file (missing matrix_database).');
    }
    return parsed;
}

export function isEncryptedBackupPackage(parsed) {
    return !!(parsed && typeof parsed === 'object' && parsed[ENCRYPTED_BACKUP_MARKER]);
}

function bytesToBase64(bytes) {
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary);
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function deriveKey(passphrase, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptBackupPackage(jsonString, passphrase) {
    const clean = String(passphrase || '').trim();
    if (!clean) throw new Error('Passphrase is required for encryption.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(clean, salt);
    const enc = new TextEncoder();
    const cipher = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        enc.encode(jsonString)
    );
    return JSON.stringify({
        [ENCRYPTED_BACKUP_MARKER]: true,
        v: 1,
        salt: bytesToBase64(salt),
        iv: bytesToBase64(iv),
        data: bytesToBase64(new Uint8Array(cipher))
    });
}

export async function decryptBackupPackage(text, passphrase) {
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;
    if (!isEncryptedBackupPackage(parsed)) {
        return parseBackupPackage(parsed);
    }
    const clean = String(passphrase || '').trim();
    if (!clean) throw new Error('Passphrase required for encrypted backup.');
    const salt = base64ToBytes(parsed.salt);
    const iv = base64ToBytes(parsed.iv);
    const data = base64ToBytes(parsed.data);
    const key = await deriveKey(clean, salt);
    const dec = new TextDecoder();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return parseBackupPackage(dec.decode(plain));
}

export function isBackupFilename(name) {
    if (typeof name !== 'string' || !name.endsWith('.json')) return false;
    return name.startsWith(BACKUP_FILE_PREFIX) || name.startsWith(LEGACY_BACKUP_FILE_PREFIX);
}

export function timestampFromBackupFilename(name) {
    if (!isBackupFilename(name)) return null;
    const prefix = name.startsWith(BACKUP_FILE_PREFIX)
        ? BACKUP_FILE_PREFIX
        : LEGACY_BACKUP_FILE_PREFIX;
    const raw = name.slice(prefix.length, -'.json'.length);
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : null;
}

function migrateImportedStep(step) {
    // Step IDs are ensured by repairDatabase() before import normalization
    // runs; this helper only fills defensive shape defaults. Existing step
    // IDs (added upstream) are preserved via ...step.
    if (!step || typeof step !== 'object') return step;
    return {
        startDateTime: '',
        endDateTime: '',
        level: 0,
        parentId: null,
        order: 0,
        completed: false,
        text: '',
        ...step,
        level: Number.isFinite(Number(step.level)) ? Number(step.level) : 0,
        completed: step.completed === true
    };
}

export function migrateImportedItem(item) {
    if (!item || typeof item !== 'object') return item;
    
    // Backfill created_at/updated_at using centralized helpers
    const createdAt = getCreatedTimestamp(item);
    const updatedAt = getUpdatedTimestamp(item);
    
    const migrated = {
        ...item,
        hiddenFromBoard: item.hiddenFromBoard === true,
        hideFromCalendar: item.hideFromCalendar === true,
        startDateTime: item.startDateTime || '',
        endDateTime: item.endDateTime || '',
        backgroundColor: item.backgroundColor || '',
        isRecurring: item.isRecurring === true,
        attachments: item.attachments || [],
        created_at: createdAt,
        updated_at: updatedAt,
        // Ensure desktopId defaults to 1 for backward compatibility
        desktopId: item.desktopId || 1
    };
    if (Array.isArray(item.steps)) {
        migrated.steps = item.steps.map(migrateImportedStep);
    }
    return migrated;
}

export function migrateImportedDatabase(db, categories = []) {
    if (!db || typeof db !== 'object') return db;

    // Unify with the normal load path: apply the shared non-destructive
    // repair first (schemaVersion metadata, step ID normalization, duplicate
    // category detection), then apply import-specific normalization on top.
    const repaired = repairDatabase(db);
    if (!repaired || typeof repaired !== 'object') return db;

    const names = ensureUncategorizedCategory(normalizeCategories(categories, { keepEmpty: true }))
        .map((c) => c.name);
    return {
        ...repaired,
        auth: {
            admin_token: 'dev-admin-secret-2026',
            ...(repaired.auth || {})
        },
        settings: {
            ...(repaired.settings || {}),
            categories: names.length ? names : (repaired.settings?.categories || [])
        },
        items: Array.isArray(repaired.items) ? repaired.items.map(migrateImportedItem) : []
    };
}

/**
 * Turn an imported package into the replace-style snapshot the rest of this
 * module expects. Notes patches are merged onto the current local database
 * (upsert changed notes, drop removed ones) so incremental files compose.
 *
 * @param {object} parsedBackup
 * @returns {object}
 */
export function resolveImportedPackage(parsedBackup) {
    if (!isNotesPatchPackage(parsedBackup)) return parsedBackup;

    let currentDb = null;
    try {
        const raw = localStorage.getItem('matrix_database');
        currentDb = raw ? JSON.parse(raw) : null;
    } catch {
        currentDb = null;
    }

    const merged = mergeNotesPatchDatabase(currentDb, parsedBackup);
    return { ...parsedBackup, kind: undefined, matrix_database: merged };
}

/**
 * Canvas-only restores can reference media files that live in the media
 * library, not in the canvas package. Surface that honestly instead of leaving
 * the user with silent blank images. Best-effort: never blocks the restore.
 *
 * @param {object} pkg parsed canvas package
 */
async function warnCanvasMediaGaps(pkg) {
    const referenced = Array.isArray(pkg?.referencedMediaIds) ? pkg.referencedMediaIds : [];
    if (!referenced.length) return;
    try {
        const { getMediaMeta } = await import('./mediaLibrary.js');
        const missing = [];
        for (const mediaId of referenced) {
            try {
                const meta = await getMediaMeta(mediaId);
                if (!meta || meta.blobPresent === false) missing.push(mediaId);
            } catch {
                missing.push(mediaId);
            }
        }
        if (!missing.length) return;
        const message = `Canvas restored, but ${missing.length} image${missing.length === 1 ? '' : 's'} need their media files. Import the media ZIP (magicnotes_media_backup_*) to fill them in.`;
        console.warn('[Backup] canvas media gaps:', missing);
        const { showAppToast } = await import('./toast.js');
        showAppToast(message);
    } catch {
        // Headless / offline restore — the console warn above still fired.
    }
}

export async function applyBackupToStorage(parsedBackup) {
    const incoming = resolveImportedPackage(parsedBackup);
    const categories = incoming.matrix_custom_categories
        ? ensureUncategorizedCategory(normalizeCategories(incoming.matrix_custom_categories, { keepEmpty: true }))
        : [];

    if (categories.length) {
        writeStoredCategories(categories, { keepEmpty: true });
    }

    if (incoming.matrix_database) {
        let existingDb = null;
        try {
            const raw = localStorage.getItem('matrix_database');
            existingDb = raw ? JSON.parse(raw) : null;
        } catch {
            /* ignore */
        }

        const db = migrateImportedDatabase(incoming.matrix_database, categories);
        if (!Array.isArray(incoming.matrix_database.items) && Array.isArray(existingDb?.items)) {
            db.items = existingDb.items.map(migrateImportedItem);
        }

        localStorage.setItem('matrix_database', JSON.stringify(db));
        if (db.auth?.admin_token) {
            localStorage.setItem('admin_token', db.auth.admin_token);
        }
        if (!categories.length && Array.isArray(db.settings?.categories) && db.settings.categories.length) {
            writeStoredCategories(normalizeCategories(db.settings.categories, { keepEmpty: true }), { keepEmpty: true });
        }
    }

    // Restore desktop configuration if present in backup
    if (incoming.desktopsConfig) {
        try {
            localStorage.setItem('magicnotes_desktops_config', JSON.stringify(incoming.desktopsConfig));
        } catch {
            // Ignore errors
        }
    }

    // UI-only hide lists from a prior session can hide imported items by id.
    localStorage.removeItem('matrix_hidden_board_ids');
    localStorage.removeItem('matrix_calendar_hidden_ids');

    if (incoming.kind === BOARD_PACKAGE_KIND) {
        applyBoardBackupKeys(incoming);
        return;
    }
    if (incoming.kind === CANVAS_PACKAGE_KIND) {
        applyCanvasBackupKeys(incoming);
        try {
            await applyDrawingBackupKeys(incoming);
        } catch (err) {
            console.warn('[Backup] canvas section restore failed', err);
        }
        await warnCanvasMediaGaps(incoming);
        return;
    }
    applyLayoutBackupKeys(incoming);

    try {
        await applyDrawingBackupKeys(incoming);
    } catch (err) {
        console.warn('[Backup] drawing section restore failed', err);
    }

    if (incoming.media_library) {
        try {
            await applyMediaLibraryBackupSection(incoming.media_library);
        } catch (err) {
            console.warn('[Backup] media_library restore failed', err);
        }
    }

    try {
        const db = JSON.parse(localStorage.getItem('matrix_database') || '{}');
        const categories = readStoredCategories({ keepEmpty: true });
        repairSpatialLayoutStorage({ items: db.items || [], categories });
    } catch {
        /* ignore layout repair failures on import */
    }
}
