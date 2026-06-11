import {
    categoryKey,
    isUncategorizedCategory,
    UNCATEGORIZED_CATEGORY
} from './categories.js';
import { showAppToast } from './toast.js';
import { readViewSessions, writeViewSessions, VIEW_MODES } from './viewSession.js';

const FREEFORM_DEFAULT_W = 96;
const FREEFORM_DEFAULT_H = 56;
const COLUMN_GRID_CELL_W = FREEFORM_DEFAULT_W;
const COLUMN_GRID_CELL_H = FREEFORM_DEFAULT_H;
const COLUMN_GRID_GAP = 4;
const LEGACY_TILE_SIZE = 'compact';
const TILE_LABEL_H = 28;
const TILE_RESIZE_MIN_W = 48;
const TILE_RESIZE_MIN_H = 16;
const TILE_NOTE_W_CELLS = 2.5;
const TILE_NOTE_H_CELLS = 5;
const TILE_LABEL_COMPACT_H_UP = 40;
const TILE_LABEL_COMPACT_H_DOWN = 36;
const TILE_COMPACT_NOTE_W_UP = 104;
const TILE_COMPACT_NOTE_H_UP = 64;
const TILE_COMPACT_NOTE_W_DOWN = 100;
const TILE_COMPACT_NOTE_H_DOWN = 60;

function normalizeTileSize(tileSize) {
    if (tileSize === 'label' || tileSize === 'compact' || tileSize === 'note') return tileSize;
    return LEGACY_TILE_SIZE;
}

function resolveTileSize(item) {
    return normalizeTileSize(item?.tileSize);
}

const GRID_LAYOUT_KEY = 'matrix_grid_layout';
const GRID_PINS_KEY = 'matrix_grid_pins';
const GRID_EXPANDED_KEY = 'matrix_grid_expanded_id';
const SAVED_VIEWS_KEY = 'matrix_saved_views';
const LEGACY_EXPANDED_KEY = 'matrix_expanded_cards';

const LAYOUT_BACKUP_KEYS = [
    GRID_LAYOUT_KEY,
    GRID_PINS_KEY,
    GRID_EXPANDED_KEY,
    'matrix_freeform_positions',
    'matrix_freeform_sizes',
    'matrix_column_positions',
    'matrix_column_sizes',
    'matrix_column_note_layout',
    'matrix_columns_float_positions',
    'matrix_columns_float_sizes',
    'matrix_canvas_layout_order',
    'matrix_view_sessions',
    SAVED_VIEWS_KEY,
    LEGACY_EXPANDED_KEY,
    'matrix_hidden_board_ids',
    'matrix_calendar_hidden_ids',
    'matrix_collapsed_categories'
];

function readJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function writeJsonIfChanged(key, value) {
    const next = JSON.stringify(value);
    if (localStorage.getItem(key) === next) return false;
    localStorage.setItem(key, next);
    return true;
}

function cellsToSpanW(cells) {
    const n = Math.max(1, cells);
    return Math.round(n * COLUMN_GRID_CELL_W + (n - 1) * COLUMN_GRID_GAP);
}

function cellsToSpanH(cells) {
    const n = Math.max(1, cells);
    return Math.round(n * COLUMN_GRID_CELL_H + (n - 1) * COLUMN_GRID_GAP);
}

function softSnapPx(value) {
    return Math.round(Math.max(0, value) / 2) * 2;
}

function getTileDefaultRect(tileSize) {
    const size = normalizeTileSize(tileSize);
    if (size === 'label') {
        return { w: COLUMN_GRID_CELL_W, h: TILE_LABEL_H };
    }
    if (size === 'note') {
        return {
            w: cellsToSpanW(TILE_NOTE_W_CELLS),
            h: cellsToSpanH(TILE_NOTE_H_CELLS)
        };
    }
    return { w: COLUMN_GRID_CELL_W, h: COLUMN_GRID_CELL_H };
}

function isCustomTileRect(w, h, tileSize = LEGACY_TILE_SIZE) {
    const def = getTileDefaultRect(tileSize);
    return Math.abs(w - def.w) > 2 || Math.abs(h - def.h) > 2;
}

function getCollapsedTierExpandCap() {
    return {
        w: cellsToSpanW(2) - 1,
        h: cellsToSpanH(2) - 1
    };
}

function inferCollapsedTileTier(w, h, prevTier = LEGACY_TILE_SIZE) {
    const prev = normalizeTileSize(prevTier);
    let inNoteZone;
    if (prev === 'note') {
        inNoteZone = !(w <= TILE_COMPACT_NOTE_W_DOWN && h <= TILE_COMPACT_NOTE_H_DOWN);
    } else {
        inNoteZone = w > TILE_COMPACT_NOTE_W_UP || h > TILE_COMPACT_NOTE_H_UP;
    }
    if (inNoteZone) return 'note';

    if (prev === 'label') {
        return h > TILE_LABEL_COMPACT_H_UP ? 'compact' : 'label';
    }
    if (prev === 'compact') {
        return h < TILE_LABEL_COMPACT_H_DOWN ? 'label' : 'compact';
    }
    return h < TILE_LABEL_COMPACT_H_DOWN ? 'label' : 'compact';
}

function resolveCollapsedTierRect(w, h, prevTier = LEGACY_TILE_SIZE) {
    const tier = inferCollapsedTileTier(w, h, prevTier);
    if (tier === 'note') {
        const cap = getCollapsedTierExpandCap();
        return {
            tier,
            w: softSnapPx(Math.max(TILE_RESIZE_MIN_W, Math.min(w, cap.w))),
            h: softSnapPx(Math.max(TILE_RESIZE_MIN_H, Math.min(h, cap.h)))
        };
    }
    if (tier === 'label') {
        return {
            tier,
            w: softSnapPx(Math.max(TILE_RESIZE_MIN_W, Math.min(w, COLUMN_GRID_CELL_W))),
            h: softSnapPx(Math.max(TILE_RESIZE_MIN_H, Math.min(h, TILE_LABEL_COMPACT_H_UP)))
        };
    }
    return {
        tier,
        w: COLUMN_GRID_CELL_W,
        h: COLUMN_GRID_CELL_H
    };
}

function isExpandedRect(w, h) {
    return w >= cellsToSpanW(2) - 2 && h >= cellsToSpanH(2) - 2;
}

export function normalizeSavedCardRect(saved, tileSize, { expanded = false } = {}) {
    if (!saved || typeof saved !== 'object') {
        return { changed: true, value: null };
    }

    const tier = normalizeTileSize(tileSize);
    let x = Number(saved.x);
    let y = Number(saved.y);
    let w = Number(saved.w);
    let h = Number(saved.h);
    const hasPos = Number.isFinite(x) && Number.isFinite(y);
    const hasSize = Number.isFinite(w) && Number.isFinite(h);

    if (!hasSize && !hasPos) {
        return { changed: true, value: null };
    }

    const defaults = getTileDefaultRect(tier);
    if (!hasSize) {
        w = defaults.w;
        h = defaults.h;
    }

    let customCompact = saved.customCompact === true;
    let changed = false;

    if (expanded || isExpandedRect(w, h)) {
        const minW = cellsToSpanW(2);
        const minH = cellsToSpanH(2);
        const nw = Math.max(minW, softSnapPx(w));
        const nh = Math.max(minH, softSnapPx(h));
        if (nw !== w || nh !== h) {
            w = nw;
            h = nh;
            changed = true;
        }
        if (customCompact) {
            customCompact = false;
            changed = true;
        }
    } else if (customCompact && isCustomTileRect(w, h, tier)) {
        const resolved = resolveCollapsedTierRect(w, h, tier);
        if (resolved.w !== w || resolved.h !== h) {
            w = resolved.w;
            h = resolved.h;
            changed = true;
        }
        if (resolved.tier !== tier) {
            w = defaults.w;
            h = defaults.h;
            customCompact = false;
            changed = true;
        } else if (!isCustomTileRect(w, h, tier)) {
            customCompact = false;
            changed = true;
        }
    } else {
        if (w !== defaults.w || h !== defaults.h) {
            w = defaults.w;
            h = defaults.h;
            changed = true;
        }
        if (customCompact) {
            customCompact = false;
            changed = true;
        }
    }

    if (hasPos) {
        const nx = Math.max(0, Math.round(x));
        const ny = Math.max(0, Math.round(y));
        if (nx !== x || ny !== y) {
            x = nx;
            y = ny;
            changed = true;
        }
    }

    const entry = {
        w: Math.round(w),
        h: Math.round(h)
    };
    if (hasPos) {
        entry.x = Math.round(x);
        entry.y = Math.round(y);
    }
    if (customCompact && isCustomTileRect(entry.w, entry.h, tier)) {
        entry.customCompact = true;
    }

    if (!changed) {
        changed = JSON.stringify(entry) !== JSON.stringify(saved);
    }

    return { changed, value: entry };
}

function buildContext(items = [], categories = []) {
    const liveIds = new Set();
    const tileSizeById = new Map();
    (items || []).forEach((item) => {
        if (!item?.id) return;
        liveIds.add(item.id);
        tileSizeById.set(item.id, resolveTileSize(item));
    });

    const catNames = new Set();
    (categories || []).forEach((cat) => {
        const name = typeof cat === 'string' ? cat : cat?.name;
        if (name) catNames.add(categoryKey(name));
    });
    catNames.add(categoryKey(UNCATEGORIZED_CATEGORY));

    return { liveIds, tileSizeById, catNames };
}

function pruneIdMap(map, liveIds, stats, label) {
    if (!map || typeof map !== 'object') return map;
    let changed = false;
    const next = { ...map };
    Object.keys(next).forEach((id) => {
        if (!liveIds.has(id)) {
            delete next[id];
            stats.removed += 1;
            changed = true;
        }
    });
    if (changed) stats.touched.add(label);
    return next;
}

function normalizeIdRectMap(map, liveIds, tileSizeById, stats, label) {
    if (!map || typeof map !== 'object') return map;
    let changed = false;
    const next = { ...map };
    Object.keys(next).forEach((id) => {
        if (!liveIds.has(id)) return;
        const tileSize = tileSizeById.get(id) || LEGACY_TILE_SIZE;
        const saved = next[id];
        const expanded = saved && isExpandedRect(Number(saved.w), Number(saved.h));
        const result = normalizeSavedCardRect(saved, tileSize, { expanded });
        if (result.value === null) {
            delete next[id];
            stats.removed += 1;
            changed = true;
            return;
        }
        if (result.changed) {
            next[id] = result.value;
            stats.normalized += 1;
            changed = true;
        }
    });
    if (changed) stats.touched.add(label);
    return next;
}

function normalizeSizeOnlyMap(map, liveIds, tileSizeById, stats, label) {
    if (!map || typeof map !== 'object') return map;
    let changed = false;
    const next = { ...map };
    Object.keys(next).forEach((id) => {
        if (!liveIds.has(id)) return;
        const tileSize = tileSizeById.get(id) || LEGACY_TILE_SIZE;
        const saved = next[id];
        const expanded = saved && isExpandedRect(Number(saved.w), Number(saved.h));
        const result = normalizeSavedCardRect(saved, tileSize, { expanded });
        if (result.value === null) {
            delete next[id];
            stats.removed += 1;
            changed = true;
            return;
        }
        const normalized = {
            w: result.value.w,
            h: result.value.h
        };
        if (result.value.customCompact) normalized.customCompact = true;
        if (JSON.stringify(normalized) !== JSON.stringify(saved)) {
            next[id] = normalized;
            stats.normalized += 1;
            changed = true;
        }
    });
    if (changed) stats.touched.add(label);
    return next;
}

function pruneCategoryMap(map, catNames, stats, label) {
    if (!map || typeof map !== 'object') return map;
    let changed = false;
    const next = { ...map };
    Object.keys(next).forEach((name) => {
        if (!catNames.has(categoryKey(name)) && !isUncategorizedCategory(name)) {
            delete next[name];
            stats.removed += 1;
            changed = true;
        }
    });
    if (changed) stats.touched.add(label);
    return next;
}

function normalizeColumnNoteLayout(all, liveIds, tileSizeById, catNames, stats) {
    if (!all || typeof all !== 'object') return all;
    let changed = false;
    const next = pruneCategoryMap({ ...all }, catNames, stats, 'matrix_column_note_layout');
    Object.keys(next).forEach((cat) => {
        const bucket = { ...next[cat] };
        let bucketChanged = false;
        Object.keys(bucket).forEach((id) => {
            if (!liveIds.has(id)) {
                delete bucket[id];
                stats.removed += 1;
                bucketChanged = true;
                return;
            }
            const tileSize = tileSizeById.get(id) || LEGACY_TILE_SIZE;
            const saved = bucket[id];
            const expanded = saved && isExpandedRect(Number(saved.w), Number(saved.h));
            const result = normalizeSavedCardRect(saved, tileSize, { expanded });
            if (result.value === null) {
                delete bucket[id];
                stats.removed += 1;
                bucketChanged = true;
                return;
            }
            if (result.changed) {
                bucket[id] = result.value;
                stats.normalized += 1;
                bucketChanged = true;
            }
        });
        if (bucketChanged) {
            next[cat] = bucket;
            changed = true;
        }
        if (next[cat] && Object.keys(next[cat]).length === 0) {
            delete next[cat];
            changed = true;
        }
    });
    if (changed) stats.touched.add('matrix_column_note_layout');
    return next;
}

function pruneIdArray(list, liveIds, stats, label) {
    if (!Array.isArray(list)) return list;
    const next = list.filter((id) => liveIds.has(id));
    if (next.length !== list.length) {
        stats.removed += list.length - next.length;
        stats.touched.add(label);
    }
    return next;
}

function sanitizeExpandedMap(map, liveIds, stats, label) {
    if (!map || typeof map !== 'object') return map;
    let changed = false;
    const next = { ...map };
    Object.keys(next).forEach((id) => {
        if (!liveIds.has(id)) {
            delete next[id];
            stats.removed += 1;
            changed = true;
        }
    });
    if (changed) stats.touched.add(label);
    return next;
}

function sanitizeViewSessions(store, liveIds, stats) {
    if (!store || store.version !== 1) return store;
    let changed = false;
    const next = { version: 1 };
    VIEW_MODES.forEach((mode) => {
        const bucket = { ...(store[mode] || {}) };
        if (bucket.expandedCards) {
            const cleaned = sanitizeExpandedMap(bucket.expandedCards, liveIds, stats, `view_sessions.${mode}.expanded`);
            if (cleaned !== bucket.expandedCards) {
                bucket.expandedCards = cleaned;
                changed = true;
            }
        }
        if (mode === 'grid' && bucket.gridExpandedId && !liveIds.has(bucket.gridExpandedId)) {
            bucket.gridExpandedId = null;
            stats.removed += 1;
            changed = true;
        }
        next[mode] = bucket;
    });
    return changed ? next : store;
}

function purgeItemFromSnapshot(snap, itemId) {
    if (!snap || typeof snap !== 'object') return snap;
    const next = { ...snap };
    ['freeformPositions', 'columnsFloatPositions'].forEach((key) => {
        if (next[key]?.[itemId]) delete next[key][itemId];
    });
    ['freeformSizes', 'columnsFloatSizes', 'gridLayout'].forEach((key) => {
        if (next[key]?.[itemId]) delete next[key][itemId];
    });
    if (Array.isArray(next.gridPins)) {
        next.gridPins = next.gridPins.filter((id) => id !== itemId);
    }
    if (next.gridExpandedId === itemId) next.gridExpandedId = null;
    if (next.expandedCards?.[itemId]) delete next.expandedCards[itemId];
    if (next.columnNoteLayout) {
        const layout = { ...next.columnNoteLayout };
        Object.keys(layout).forEach((cat) => {
            if (layout[cat]?.[itemId]) {
                layout[cat] = { ...layout[cat] };
                delete layout[cat][itemId];
            }
        });
        next.columnNoteLayout = layout;
    }
    if (next.viewSessions) {
        const sessions = { ...next.viewSessions };
        VIEW_MODES.forEach((mode) => {
            if (!sessions[mode]) return;
            const bucket = { ...sessions[mode] };
            if (bucket.expandedCards?.[itemId]) {
                bucket.expandedCards = { ...bucket.expandedCards };
                delete bucket.expandedCards[itemId];
            }
            if (mode === 'grid' && bucket.gridExpandedId === itemId) {
                bucket.gridExpandedId = null;
            }
            sessions[mode] = bucket;
        });
        next.viewSessions = sessions;
    }
    return next;
}

function readReconcileContext(context) {
    if (context) return context;
    const db = readJson('matrix_database', {});
    const categories = readJson('matrix_custom_categories', []);
    return buildContext(db.items || [], categories);
}

export function sanitizeLayoutSnapshot(snapshot, context) {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    const ctx = readReconcileContext(context);

    const next = { ...snapshot };
    const stats = { removed: 0, normalized: 0, clamped: 0, touched: new Set() };

    next.freeformPositions = pruneIdMap(next.freeformPositions || {}, ctx.liveIds, stats, 'snapshot.freeformPositions');
    next.freeformSizes = normalizeSizeOnlyMap(next.freeformSizes || {}, ctx.liveIds, ctx.tileSizeById, stats, 'snapshot.freeformSizes');
    next.columnPositions = pruneCategoryMap(next.columnPositions || {}, ctx.catNames, stats, 'snapshot.columnPositions');
    next.columnSizes = pruneCategoryMap(next.columnSizes || {}, ctx.catNames, stats, 'snapshot.columnSizes');
    next.columnNoteLayout = normalizeColumnNoteLayout(next.columnNoteLayout || {}, ctx.liveIds, ctx.tileSizeById, ctx.catNames, stats);
    next.columnsFloatPositions = pruneIdMap(next.columnsFloatPositions || {}, ctx.liveIds, stats, 'snapshot.columnsFloatPositions');
    next.columnsFloatSizes = normalizeSizeOnlyMap(next.columnsFloatSizes || {}, ctx.liveIds, ctx.tileSizeById, stats, 'snapshot.columnsFloatSizes');
    next.gridLayout = normalizeIdRectMap(next.gridLayout || {}, ctx.liveIds, ctx.tileSizeById, stats, 'snapshot.gridLayout');
    next.gridPins = pruneIdArray(next.gridPins || [], ctx.liveIds, stats, 'snapshot.gridPins');
    if (next.gridExpandedId && !ctx.liveIds.has(next.gridExpandedId)) {
        next.gridExpandedId = null;
    }
    if (next.expandedCards) {
        next.expandedCards = sanitizeExpandedMap(next.expandedCards, ctx.liveIds, stats, 'snapshot.expandedCards');
    }
    if (next.viewSessions) {
        next.viewSessions = sanitizeViewSessions(next.viewSessions, ctx.liveIds, stats);
    }
    return next;
}

function sanitizeSavedViewsStore(store, context) {
    if (!store?.slots?.length) return store;
    let changed = false;
    const slots = store.slots.map((slot) => {
        if (!slot?.snapshot) return slot;
        const cleaned = sanitizeLayoutSnapshot(slot.snapshot, context);
        if (JSON.stringify(cleaned) !== JSON.stringify(slot.snapshot)) {
            changed = true;
            return { ...slot, snapshot: cleaned };
        }
        return slot;
    });
    return changed ? { ...store, slots } : store;
}

export function migrateColumnLayoutKey(oldName, newName) {
    if (!oldName || !newName || categoryKey(oldName) === categoryKey(newName)) return false;
    let changed = false;
    ['matrix_column_positions', 'matrix_column_sizes'].forEach((key) => {
        const map = readJson(key, {});
        if (!map[oldName]) return;
        if (!map[newName]) map[newName] = map[oldName];
        delete map[oldName];
        changed = writeJsonIfChanged(key, map) || changed;
    });
    const layout = readJson('matrix_column_note_layout', {});
    if (layout[oldName]) {
        if (!layout[newName]) layout[newName] = layout[oldName];
        delete layout[oldName];
        changed = writeJsonIfChanged('matrix_column_note_layout', layout) || changed;
    }
    return changed;
}

export function purgeLayoutForItem(itemId) {
    if (!itemId) return false;
    let changed = false;

    const grid = readJson(GRID_LAYOUT_KEY, {});
    if (grid[itemId]) {
        delete grid[itemId];
        changed = writeJsonIfChanged(GRID_LAYOUT_KEY, grid) || changed;
    }

    const freePos = readJson('matrix_freeform_positions', {});
    if (freePos[itemId]) {
        delete freePos[itemId];
        changed = writeJsonIfChanged('matrix_freeform_positions', freePos) || changed;
    }

    const freeSizes = readJson('matrix_freeform_sizes', {});
    if (freeSizes[itemId]) {
        delete freeSizes[itemId];
        changed = writeJsonIfChanged('matrix_freeform_sizes', freeSizes) || changed;
    }

    const floatPos = readJson('matrix_columns_float_positions', {});
    if (floatPos[itemId]) {
        delete floatPos[itemId];
        changed = writeJsonIfChanged('matrix_columns_float_positions', floatPos) || changed;
    }

    const floatSizes = readJson('matrix_columns_float_sizes', {});
    if (floatSizes[itemId]) {
        delete floatSizes[itemId];
        changed = writeJsonIfChanged('matrix_columns_float_sizes', floatSizes) || changed;
    }

    const colLayout = readJson('matrix_column_note_layout', {});
    let colChanged = false;
    Object.keys(colLayout).forEach((cat) => {
        if (colLayout[cat]?.[itemId]) {
            delete colLayout[cat][itemId];
            colChanged = true;
        }
    });
    if (colChanged) {
        changed = writeJsonIfChanged('matrix_column_note_layout', colLayout) || changed;
    }

    const pins = readJson(GRID_PINS_KEY, []);
    const nextPins = pins.filter((id) => id !== itemId);
    if (nextPins.length !== pins.length) {
        changed = writeJsonIfChanged(GRID_PINS_KEY, nextPins) || changed;
    }

    const hiddenBoard = readJson('matrix_hidden_board_ids', []);
    const nextHiddenBoard = hiddenBoard.filter((id) => id !== itemId);
    if (nextHiddenBoard.length !== hiddenBoard.length) {
        changed = writeJsonIfChanged('matrix_hidden_board_ids', nextHiddenBoard) || changed;
    }

    const hiddenCal = readJson('matrix_calendar_hidden_ids', []);
    const nextHiddenCal = hiddenCal.filter((id) => id !== itemId);
    if (nextHiddenCal.length !== hiddenCal.length) {
        changed = writeJsonIfChanged('matrix_calendar_hidden_ids', nextHiddenCal) || changed;
    }

    if (localStorage.getItem(GRID_EXPANDED_KEY) === itemId) {
        localStorage.removeItem(GRID_EXPANDED_KEY);
        changed = true;
    }

    const legacyExpanded = readJson(LEGACY_EXPANDED_KEY, {});
    if (legacyExpanded[itemId]) {
        delete legacyExpanded[itemId];
        changed = writeJsonIfChanged(LEGACY_EXPANDED_KEY, legacyExpanded) || changed;
    }

    const sessions = readViewSessions();
    let sessionChanged = false;
    const nextSessions = { version: 1 };
    VIEW_MODES.forEach((mode) => {
        const bucket = { ...(sessions[mode] || {}) };
        if (bucket.expandedCards?.[itemId]) {
            bucket.expandedCards = { ...bucket.expandedCards };
            delete bucket.expandedCards[itemId];
            sessionChanged = true;
        }
        if (mode === 'grid' && bucket.gridExpandedId === itemId) {
            bucket.gridExpandedId = null;
            sessionChanged = true;
        }
        nextSessions[mode] = bucket;
    });
    if (sessionChanged) {
        writeViewSessions(nextSessions);
        changed = true;
    }

    const savedViews = readJson(SAVED_VIEWS_KEY, null);
    if (savedViews?.slots) {
        let viewsChanged = false;
        const slots = savedViews.slots.map((slot) => {
            if (!slot?.snapshot) return slot;
            const cleaned = purgeItemFromSnapshot(slot.snapshot, itemId);
            if (JSON.stringify(cleaned) !== JSON.stringify(slot.snapshot)) {
                viewsChanged = true;
                return { ...slot, snapshot: cleaned };
            }
            return slot;
        });
        if (viewsChanged) {
            changed = writeJsonIfChanged(SAVED_VIEWS_KEY, { ...savedViews, slots }) || changed;
        }
    }

    return changed;
}

export function reconcileLayoutStorage({ items = [], categories = [], showToast = true } = {}) {
    const context = buildContext(items, categories);
    const stats = { removed: 0, normalized: 0, clamped: 0, touched: new Set() };

    writeJsonIfChanged(
        GRID_LAYOUT_KEY,
        normalizeIdRectMap(
            pruneIdMap(readJson(GRID_LAYOUT_KEY, {}), context.liveIds, stats, GRID_LAYOUT_KEY),
            context.liveIds,
            context.tileSizeById,
            stats,
            GRID_LAYOUT_KEY
        )
    );

    writeJsonIfChanged(
        'matrix_freeform_positions',
        pruneIdMap(readJson('matrix_freeform_positions', {}), context.liveIds, stats, 'matrix_freeform_positions')
    );

    writeJsonIfChanged(
        'matrix_freeform_sizes',
        normalizeSizeOnlyMap(
            pruneIdMap(readJson('matrix_freeform_sizes', {}), context.liveIds, stats, 'matrix_freeform_sizes'),
            context.liveIds,
            context.tileSizeById,
            stats,
            'matrix_freeform_sizes'
        )
    );

    writeJsonIfChanged(
        'matrix_columns_float_positions',
        pruneIdMap(readJson('matrix_columns_float_positions', {}), context.liveIds, stats, 'matrix_columns_float_positions')
    );

    writeJsonIfChanged(
        'matrix_columns_float_sizes',
        normalizeSizeOnlyMap(
            pruneIdMap(readJson('matrix_columns_float_sizes', {}), context.liveIds, stats, 'matrix_columns_float_sizes'),
            context.liveIds,
            context.tileSizeById,
            stats,
            'matrix_columns_float_sizes'
        )
    );

    writeJsonIfChanged(
        'matrix_column_positions',
        pruneCategoryMap(readJson('matrix_column_positions', {}), context.catNames, stats, 'matrix_column_positions')
    );

    writeJsonIfChanged(
        'matrix_column_sizes',
        pruneCategoryMap(readJson('matrix_column_sizes', {}), context.catNames, stats, 'matrix_column_sizes')
    );

    writeJsonIfChanged(
        'matrix_column_note_layout',
        normalizeColumnNoteLayout(
            readJson('matrix_column_note_layout', {}),
            context.liveIds,
            context.tileSizeById,
            context.catNames,
            stats
        )
    );

    writeJsonIfChanged(GRID_PINS_KEY, pruneIdArray(readJson(GRID_PINS_KEY, []), context.liveIds, stats, GRID_PINS_KEY));
    writeJsonIfChanged(
        'matrix_hidden_board_ids',
        pruneIdArray(readJson('matrix_hidden_board_ids', []), context.liveIds, stats, 'matrix_hidden_board_ids')
    );
    writeJsonIfChanged(
        'matrix_calendar_hidden_ids',
        pruneIdArray(readJson('matrix_calendar_hidden_ids', []), context.liveIds, stats, 'matrix_calendar_hidden_ids')
    );

    const gridExpanded = localStorage.getItem(GRID_EXPANDED_KEY);
    if (gridExpanded && !context.liveIds.has(gridExpanded)) {
        localStorage.removeItem(GRID_EXPANDED_KEY);
        stats.removed += 1;
        stats.touched.add(GRID_EXPANDED_KEY);
    }

    writeJsonIfChanged(
        LEGACY_EXPANDED_KEY,
        sanitizeExpandedMap(readJson(LEGACY_EXPANDED_KEY, {}), context.liveIds, stats, LEGACY_EXPANDED_KEY)
    );

    writeViewSessions(sanitizeViewSessions(readViewSessions(), context.liveIds, stats));

    const savedViews = readJson(SAVED_VIEWS_KEY, null);
    if (savedViews) {
        writeJsonIfChanged(SAVED_VIEWS_KEY, sanitizeSavedViewsStore(savedViews, context));
    }

    const total = stats.removed + stats.normalized + stats.clamped;
    if (total > 0) {
        console.info('[layoutStorage] reconciled', {
            removed: stats.removed,
            normalized: stats.normalized,
            clamped: stats.clamped,
            keys: [...stats.touched]
        });
        if (showToast) {
            showAppToast(`Adjusted ${total} layout ${total === 1 ? 'entry' : 'entries'}`);
        }
    }

    return stats;
}

export function getLayoutBackupKeys() {
    const payload = {};
    LAYOUT_BACKUP_KEYS.forEach((key) => {
        const raw = localStorage.getItem(key);
        if (raw != null) payload[key] = raw;
    });
    return payload;
}

export function applyLayoutBackupKeys(payload = {}) {
    if (!payload || typeof payload !== 'object') return;
    LAYOUT_BACKUP_KEYS.forEach((key) => {
        if (payload[key] == null) return;
        const value = typeof payload[key] === 'string' ? payload[key] : JSON.stringify(payload[key]);
        localStorage.setItem(key, value);
    });
}
