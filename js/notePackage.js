/** @module {"owns":"single-note ZIP export/import (item + media + layout slice)", "related":["backup.js","mediaBackup.js","layoutStorage.js","noteQuickActions.js"]} */
import {
    GRID_LAYOUT_KEY,
    GRID_PINS_KEY,
    GRID_EXPANDED_KEY,
    FREEFORM_POSITIONS_KEY,
    FREEFORM_SIZES_KEY
} from './board/layoutKeys.js';
import {
    categoryKey,
    normalizeCategories,
    readStoredCategories,
    writeStoredCategories
} from './categories.js';
import { normalizeAttachments } from './mediaAttachments.js';
import { collectNoteCanvasMediaIds } from './noteFieldOwnership.js';
import {
    applyMediaFromZipMap,
    buildZipStore,
    collectMediaZipEntries,
    readZip,
    triggerDownload
} from './mediaBackup.js';
import { showAppToast } from './toast.js';
import { getCreatedTimestamp, getUpdatedTimestamp } from './noteModel.js';

export const NOTE_PACKAGE_KIND = 'magicnotes_note';
export const NOTE_PACKAGE_FILE_PREFIX = 'magicnotes_note_';
export const NOTE_PACKAGE_VERSION = 1;

const LEGACY_EXPANDED_KEY = 'matrix_expanded_cards';
const FLOAT_POS_KEY = 'matrix_columns_float_positions';
const FLOAT_SIZES_KEY = 'matrix_columns_float_sizes';
const COLUMN_NOTE_LAYOUT_KEY = 'matrix_column_note_layout';
const HIDDEN_BOARD_KEY = 'matrix_hidden_board_ids';
const HIDDEN_CAL_KEY = 'matrix_calendar_hidden_ids';
const FILE_CABINET_ORDER_KEY = 'matrix_file_cabinet_order';

/**
 * Local copy of backup.migrateImportedItem — avoids a backup↔notePackage cycle.
 * @param {object} item
 * @returns {object}
 */
function migrateImportedItem(item) {
    if (!item || typeof item !== 'object') return item;
    const createdAt = getCreatedTimestamp(item);
    const updatedAt = getUpdatedTimestamp(item);
    return {
        ...item,
        hiddenFromBoard: item.hiddenFromBoard === true,
        hideFromCalendar: item.hideFromCalendar === true,
        startDateTime: item.startDateTime || '',
        endDateTime: item.endDateTime || '',
        backgroundColor: item.backgroundColor || '',
        isRecurring: item.isRecurring === true,
        attachments: item.attachments || [],
        planner: item.planner || null,
        created_at: createdAt,
        updated_at: updatedAt,
        desktopId: item.desktopId || 1
    };
}

function getFileCabinetOrder() {
    return readJson(FILE_CABINET_ORDER_KEY, {});
}

function saveFileCabinetOrder(order) {
    writeJson(FILE_CABINET_ORDER_KEY, order || {});
}

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

function readJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function writeJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

function safeFilenamePart(value) {
    const raw = String(value || '').trim() || 'note';
    return raw.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 48);
}

/**
 * Media ids referenced by attachments and note canvas images.
 * @param {object} item
 * @returns {string[]}
 */
export function collectNoteMediaIds(item) {
    const seen = new Set();
    const out = [];
    for (const att of normalizeAttachments(item?.attachments)) {
        if (att.mediaId && !seen.has(att.mediaId)) {
            seen.add(att.mediaId);
            out.push(att.mediaId);
        }
    }
    for (const id of collectNoteCanvasMediaIds(item?.canvas)) {
        if (!seen.has(id)) {
            seen.add(id);
            out.push(id);
        }
    }
    return out;
}

/**
 * Extract per-item layout fields (inverse of purgeLayoutForItem + file-cabinet order).
 * @param {string} itemId
 * @returns {object}
 */
export function extractLayoutSliceForItem(itemId) {
    if (!itemId) return {};
    const slice = {};

    const grid = readJson(GRID_LAYOUT_KEY, {});
    if (grid[itemId] != null) slice.grid = grid[itemId];

    const freePos = readJson(FREEFORM_POSITIONS_KEY, {});
    if (freePos[itemId] != null) slice.freeformPos = freePos[itemId];

    const freeSizes = readJson(FREEFORM_SIZES_KEY, {});
    if (freeSizes[itemId] != null) slice.freeformSize = freeSizes[itemId];

    const floatPos = readJson(FLOAT_POS_KEY, {});
    if (floatPos[itemId] != null) slice.floatPos = floatPos[itemId];

    const floatSizes = readJson(FLOAT_SIZES_KEY, {});
    if (floatSizes[itemId] != null) slice.floatSize = floatSizes[itemId];

    const colLayout = readJson(COLUMN_NOTE_LAYOUT_KEY, {});
    const columnNoteLayout = {};
    Object.keys(colLayout).forEach((cat) => {
        if (colLayout[cat]?.[itemId] != null) {
            columnNoteLayout[cat] = colLayout[cat][itemId];
        }
    });
    if (Object.keys(columnNoteLayout).length) slice.columnNoteLayout = columnNoteLayout;

    const pins = readJson(GRID_PINS_KEY, []);
    slice.pinned = Array.isArray(pins) && pins.includes(itemId);

    const hiddenBoard = readJson(HIDDEN_BOARD_KEY, []);
    slice.hiddenBoard = Array.isArray(hiddenBoard) && hiddenBoard.includes(itemId);

    const hiddenCal = readJson(HIDDEN_CAL_KEY, []);
    slice.hiddenCalendar = Array.isArray(hiddenCal) && hiddenCal.includes(itemId);

    slice.gridExpanded = localStorage.getItem(GRID_EXPANDED_KEY) === itemId;

    const legacyExpanded = readJson(LEGACY_EXPANDED_KEY, {});
    if (legacyExpanded[itemId] != null) slice.legacyExpanded = legacyExpanded[itemId];

    const fcOrder = getFileCabinetOrder();
    for (const cat of Object.keys(fcOrder || {})) {
        const list = Array.isArray(fcOrder[cat]) ? fcOrder[cat] : [];
        const index = list.indexOf(itemId);
        if (index >= 0) {
            slice.fileCabinet = { category: cat, index };
            break;
        }
    }

    return slice;
}

function setIdInArray(list, itemId, include) {
    const arr = Array.isArray(list) ? [...list] : [];
    const has = arr.includes(itemId);
    if (include && !has) arr.push(itemId);
    if (!include && has) return arr.filter((id) => id !== itemId);
    return arr;
}

/**
 * Merge a layout slice for one item without clobbering other notes.
 * @param {string} itemId
 * @param {object} slice
 */
export function mergeLayoutSliceForItem(itemId, slice) {
    if (!itemId || !slice || typeof slice !== 'object') return;

    if (Object.prototype.hasOwnProperty.call(slice, 'grid')) {
        const grid = readJson(GRID_LAYOUT_KEY, {});
        if (slice.grid == null) delete grid[itemId];
        else grid[itemId] = slice.grid;
        writeJson(GRID_LAYOUT_KEY, grid);
    }

    if (Object.prototype.hasOwnProperty.call(slice, 'freeformPos')) {
        const map = readJson(FREEFORM_POSITIONS_KEY, {});
        if (slice.freeformPos == null) delete map[itemId];
        else map[itemId] = slice.freeformPos;
        writeJson(FREEFORM_POSITIONS_KEY, map);
    }

    if (Object.prototype.hasOwnProperty.call(slice, 'freeformSize')) {
        const map = readJson(FREEFORM_SIZES_KEY, {});
        if (slice.freeformSize == null) delete map[itemId];
        else map[itemId] = slice.freeformSize;
        writeJson(FREEFORM_SIZES_KEY, map);
    }

    if (Object.prototype.hasOwnProperty.call(slice, 'floatPos')) {
        const map = readJson(FLOAT_POS_KEY, {});
        if (slice.floatPos == null) delete map[itemId];
        else map[itemId] = slice.floatPos;
        writeJson(FLOAT_POS_KEY, map);
    }

    if (Object.prototype.hasOwnProperty.call(slice, 'floatSize')) {
        const map = readJson(FLOAT_SIZES_KEY, {});
        if (slice.floatSize == null) delete map[itemId];
        else map[itemId] = slice.floatSize;
        writeJson(FLOAT_SIZES_KEY, map);
    }

    if (slice.columnNoteLayout && typeof slice.columnNoteLayout === 'object') {
        const colLayout = readJson(COLUMN_NOTE_LAYOUT_KEY, {});
        Object.keys(colLayout).forEach((cat) => {
            if (colLayout[cat]?.[itemId]) {
                delete colLayout[cat][itemId];
                if (!Object.keys(colLayout[cat]).length) delete colLayout[cat];
            }
        });
        Object.entries(slice.columnNoteLayout).forEach(([cat, value]) => {
            if (!colLayout[cat] || typeof colLayout[cat] !== 'object') colLayout[cat] = {};
            colLayout[cat][itemId] = value;
        });
        writeJson(COLUMN_NOTE_LAYOUT_KEY, colLayout);
    }

    if (typeof slice.pinned === 'boolean') {
        writeJson(GRID_PINS_KEY, setIdInArray(readJson(GRID_PINS_KEY, []), itemId, slice.pinned));
    }

    if (typeof slice.hiddenBoard === 'boolean') {
        writeJson(HIDDEN_BOARD_KEY, setIdInArray(readJson(HIDDEN_BOARD_KEY, []), itemId, slice.hiddenBoard));
    }

    if (typeof slice.hiddenCalendar === 'boolean') {
        writeJson(HIDDEN_CAL_KEY, setIdInArray(readJson(HIDDEN_CAL_KEY, []), itemId, slice.hiddenCalendar));
    }

    if (typeof slice.gridExpanded === 'boolean') {
        if (slice.gridExpanded) localStorage.setItem(GRID_EXPANDED_KEY, itemId);
        else if (localStorage.getItem(GRID_EXPANDED_KEY) === itemId) {
            localStorage.removeItem(GRID_EXPANDED_KEY);
        }
    }

    if (Object.prototype.hasOwnProperty.call(slice, 'legacyExpanded')) {
        const map = readJson(LEGACY_EXPANDED_KEY, {});
        if (slice.legacyExpanded == null) delete map[itemId];
        else map[itemId] = slice.legacyExpanded;
        writeJson(LEGACY_EXPANDED_KEY, map);
    }

    if (Object.prototype.hasOwnProperty.call(slice, 'fileCabinet')) {
        const order = getFileCabinetOrder();
        Object.keys(order).forEach((cat) => {
            order[cat] = (order[cat] || []).filter((id) => id !== itemId);
            if (!order[cat].length) delete order[cat];
        });
        const fc = slice.fileCabinet;
        if (fc && typeof fc === 'object' && fc.category) {
            const cat = String(fc.category);
            const list = Array.isArray(order[cat]) ? [...order[cat]] : [];
            const index = Number.isFinite(Number(fc.index)) ? Math.max(0, Number(fc.index)) : list.length;
            list.splice(Math.min(index, list.length), 0, itemId);
            order[cat] = list;
        }
        saveFileCabinetOrder(order);
    }
}

/**
 * Categories from the workspace that the note references.
 * @param {object} item
 * @returns {object[]}
 */
export function collectNoteCategoriesSubset(item) {
    const names = new Set(
        (Array.isArray(item?.categories) ? item.categories : [])
            .map((n) => String(n || '').trim())
            .filter(Boolean)
    );
    if (!names.size) return [];
    const keys = new Set([...names].map(categoryKey));
    return readStoredCategories({ keepEmpty: true }).filter((cat) => keys.has(categoryKey(cat.name)));
}

function mergeCategoriesSubset(incoming) {
    if (!Array.isArray(incoming) || !incoming.length) return;
    const current = readStoredCategories({ keepEmpty: true });
    const byKey = new Map(current.map((cat) => [categoryKey(cat.name), cat]));
    let changed = false;
    for (const cat of normalizeCategories(incoming, { keepEmpty: true })) {
        const key = categoryKey(cat.name);
        if (!byKey.has(key)) {
            current.push(cat);
            byKey.set(key, cat);
            changed = true;
        }
    }
    if (changed) writeStoredCategories(current, { keepEmpty: true });
}

function readDatabase() {
    try {
        const raw = localStorage.getItem('matrix_database');
        return raw ? JSON.parse(raw) : { items: [] };
    } catch {
        return { items: [] };
    }
}

function writeDatabase(db) {
    localStorage.setItem('matrix_database', JSON.stringify(db));
}

/**
 * @param {string} itemId
 * @returns {object|null}
 */
export function readLiveNoteItem(itemId) {
    if (!itemId) return null;
    const db = readDatabase();
    const items = Array.isArray(db.items) ? db.items : [];
    return items.find((item) => item?.id === itemId) || null;
}

/**
 * Upsert one note into matrix_database without wiping other items.
 * @param {object} item
 */
export function upsertNoteItemInDatabase(item) {
    if (!item?.id) throw new Error('Note package item is missing id');
    const db = readDatabase();
    if (!Array.isArray(db.items)) db.items = [];
    const idx = db.items.findIndex((entry) => entry?.id === item.id);
    if (idx >= 0) db.items[idx] = item;
    else db.items.push(item);
    writeDatabase(db);
}

/**
 * Build note.json payload (no media).
 * @param {object} item
 * @returns {object}
 */
export function buildNotePackageJson(item) {
    if (!item || typeof item !== 'object' || !item.id) {
        throw new Error('Cannot export note without a valid item');
    }
    const cloned = JSON.parse(JSON.stringify(item));
    return {
        kind: NOTE_PACKAGE_KIND,
        version: NOTE_PACKAGE_VERSION,
        exportedAt: nowSeconds(),
        item: cloned,
        categories: collectNoteCategoriesSubset(cloned),
        layout: extractLayoutSliceForItem(cloned.id)
    };
}

/**
 * @param {object} item
 * @returns {Promise<{ blob: Blob, filename: string, packageJson: object }>}
 */
export async function buildNotePackageZip(item) {
    const packageJson = buildNotePackageJson(item);
    const encoder = new TextEncoder();
    const mediaIds = collectNoteMediaIds(packageJson.item);
    const media = await collectMediaZipEntries({
        incremental: false,
        pathPrefix: 'media/',
        mediaIds
    });
    const zipFiles = [
        { name: 'note.json', data: encoder.encode(JSON.stringify(packageJson, null, 2)) },
        ...media.zipFiles
    ];
    const timestamp = packageJson.exportedAt || media.timestamp || nowSeconds();
    const slug = safeFilenamePart(packageJson.item.title || packageJson.item.id);
    return {
        blob: buildZipStore(zipFiles),
        filename: `${NOTE_PACKAGE_FILE_PREFIX}${slug}_${timestamp}.zip`,
        packageJson
    };
}

/**
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadNotePackageBlob(blob, filename) {
    triggerDownload(blob, filename);
}

/**
 * @param {Map<string, Uint8Array>} files
 * @returns {object}
 */
export function parseNotePackageFromZipMap(files) {
    const bytes = files.get('note.json');
    if (!bytes) throw new Error('Not a Magic Lists note package (missing note.json)');
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || parsed.kind !== NOTE_PACKAGE_KIND) {
        throw new Error('Not a Magic Lists note package');
    }
    if (!parsed.item || typeof parsed.item !== 'object' || !parsed.item.id) {
        throw new Error('Note package is missing item data');
    }
    return parsed;
}

/**
 * @param {File|Blob|ArrayBuffer} fileOrBuffer
 * @returns {Promise<{ files: Map<string, Uint8Array>, packageJson: object }>}
 */
export async function parseNotePackage(fileOrBuffer) {
    let buffer;
    if (fileOrBuffer instanceof ArrayBuffer) buffer = fileOrBuffer;
    else if (fileOrBuffer?.arrayBuffer) buffer = await fileOrBuffer.arrayBuffer();
    else throw new Error('Invalid note package input');
    const files = await readZip(buffer);
    const packageJson = parseNotePackageFromZipMap(files);
    return { files, packageJson };
}

/**
 * @param {File|Blob|ArrayBuffer} fileOrBuffer
 * @returns {Promise<boolean>}
 */
export async function isNotePackageFile(fileOrBuffer) {
    try {
        await parseNotePackage(fileOrBuffer);
        return true;
    } catch {
        return false;
    }
}

function defaultConfirmReplace(message) {
    if (typeof globalThis.confirm === 'function') return globalThis.confirm(message);
    return false;
}

function defaultToast(message) {
    try {
        if (typeof document !== 'undefined' && document?.body) showAppToast(message);
    } catch {
        /* headless / early boot */
    }
}

function notifyBoardRefresh(item) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    try {
        window.dispatchEvent(new CustomEvent('item:mutation_requested', {
            detail: {
                item,
                skipUndo: true,
                preserveView: false
            }
        }));
    } catch {
        /* ignore */
    }
    try {
        window.dispatchEvent(new CustomEvent('board:visibility_changed', {
            detail: { flushLayout: false }
        }));
    } catch {
        /* ignore */
    }
}

/**
 * Import a single-note ZIP. Replaces same-id notes after downloading a safety backup.
 *
 * @param {File|Blob|ArrayBuffer} fileOrBuffer
 * @param {{
 *   confirmReplace?: (message: string) => boolean|Promise<boolean>,
 *   downloadSafetyBackup?: (blob: Blob, filename: string) => void,
 *   toast?: (message: string) => void,
 *   refreshBoard?: boolean
 * }} [opts]
 * @returns {Promise<{
 *   status: 'imported'|'replaced'|'cancelled',
 *   item: object|null,
 *   safetyBackupFilename?: string
 * }>}
 */
export async function importNotePackage(fileOrBuffer, opts = {}) {
    const confirmReplace = opts.confirmReplace || defaultConfirmReplace;
    const downloadSafety = opts.downloadSafetyBackup || downloadNotePackageBlob;
    const toast = opts.toast || defaultToast;
    const refreshBoard = opts.refreshBoard !== false;

    const { files, packageJson } = await parseNotePackage(fileOrBuffer);
    const migrated = migrateImportedItem(JSON.parse(JSON.stringify(packageJson.item)));
    const live = readLiveNoteItem(migrated.id);

    let safetyBackupFilename;
    if (live) {
        const title = live.title || migrated.title || migrated.id;
        const ok = await confirmReplace(
            `Replace existing note “${title}”? A backup of the current note will download first.`
        );
        if (!ok) {
            return { status: 'cancelled', item: null };
        }
        const safety = await buildNotePackageZip(live);
        downloadSafety(safety.blob, safety.filename);
        safetyBackupFilename = safety.filename;
        toast('Saved a backup of the existing note before replace');
    }

    mergeCategoriesSubset(packageJson.categories);
    if (files.has('media/manifest.json')) {
        await applyMediaFromZipMap(files, {
            manifestPath: 'media/manifest.json',
            filesPrefix: 'media/'
        });
    }
    mergeLayoutSliceForItem(migrated.id, packageJson.layout || {});
    upsertNoteItemInDatabase(migrated);

    if (refreshBoard) notifyBoardRefresh(migrated);

    toast(live
        ? `Replaced note “${migrated.title || migrated.id}”`
        : `Imported note “${migrated.title || migrated.id}”`);

    return {
        status: live ? 'replaced' : 'imported',
        item: migrated,
        safetyBackupFilename
    };
}

/**
 * Detect and import a note package from an already-read ZIP map (workspace import routing).
 * @param {Map<string, Uint8Array>} files
 * @param {object} [opts]
 */
export async function importNotePackageFromZipMap(files, opts = {}) {
    parseNotePackageFromZipMap(files);
    const zipFiles = [];
    for (const [name, data] of files.entries()) {
        zipFiles.push({ name, data });
    }
    return importNotePackage(buildZipStore(zipFiles), opts);
}
