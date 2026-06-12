export const FREEFORM_DEFAULT_W = 96;
export const FREEFORM_DEFAULT_H = 56;
export const FREEFORM_EXPANDED_W = 196;
export const FREEFORM_MIN_W = 72;
export const FREEFORM_MIN_H = 56;
export const FREEFORM_EXPANDED_DEFAULT_H = 120;

export const COLUMN_GRID_CELL_W = FREEFORM_DEFAULT_W;
export const COLUMN_GRID_CELL_H = FREEFORM_DEFAULT_H;
export const COLUMN_GRID_GAP = 4;
export const COLUMN_MIN_COLS = 2;
export const COLUMN_INNER_PAD = 8;
export const COLUMN_MIN_INNER_W = COLUMN_MIN_COLS * COLUMN_GRID_CELL_W + (COLUMN_MIN_COLS - 1) * COLUMN_GRID_GAP;
export const COLUMN_HEADER_APPROX_H = 40;
export const COLUMN_MIN_CANVAS_H = COLUMN_HEADER_APPROX_H + COLUMN_INNER_PAD + COLUMN_GRID_CELL_H;
export const CANVAS_COL_GAP = 8;
export const CANVAS_GRID_W = COLUMN_MIN_INNER_W + COLUMN_INNER_PAD * 2;
export const COLUMN_STRIDE_X = COLUMN_GRID_CELL_W + COLUMN_GRID_GAP;
export const COLUMN_STRIDE_Y = COLUMN_GRID_CELL_H + COLUMN_GRID_GAP;
export const CANVAS_LAYOUT_ORIGIN = 16;
export const CANVAS_PACK_GAP = COLUMN_GRID_GAP;

export const TILE_LABEL_H = 28;
export const TILE_RESIZE_MIN_W = COLUMN_GRID_CELL_W;
export const TILE_RESIZE_MIN_H = TILE_LABEL_H;
export const TILE_NOTE_W_CELLS = 2.5;
export const TILE_NOTE_H_CELLS = 5;
export const TILE_LABEL_COMPACT_H_UP = 40;
export const TILE_LABEL_COMPACT_H_DOWN = 36;
export const TILE_COMPACT_NOTE_W_UP = 104;
export const TILE_COMPACT_NOTE_H_UP = 64;
export const TILE_COMPACT_NOTE_W_DOWN = 100;
export const TILE_COMPACT_NOTE_H_DOWN = 60;
export const TILE_SIZES = ['label', 'compact', 'note'];
export const DEFAULT_TILE_SIZE = 'note';
export const LEGACY_TILE_SIZE = 'compact';

const LABEL_RECT = { w: COLUMN_GRID_CELL_W, h: TILE_LABEL_H };

export function normalizeTileSize(tileSize) {
    if (tileSize === 'label' || tileSize === 'compact' || tileSize === 'note') return tileSize;
    return LEGACY_TILE_SIZE;
}

export function resolveTileSize(item) {
    return normalizeTileSize(item?.tileSize);
}

export function cellsToSpanW(cells) {
    const n = Math.max(1, cells);
    return Math.round(n * COLUMN_GRID_CELL_W + (n - 1) * COLUMN_GRID_GAP);
}

export function cellsToSpanH(cells) {
    const n = Math.max(1, cells);
    return Math.round(n * COLUMN_GRID_CELL_H + (n - 1) * COLUMN_GRID_GAP);
}

export function spanToCellsW(span) {
    return Math.max(1, Math.round((span + COLUMN_GRID_GAP) / COLUMN_STRIDE_X));
}

export function spanToCellsH(span) {
    return Math.max(1, Math.round((span + COLUMN_GRID_GAP) / COLUMN_STRIDE_Y));
}

export function softSnapPx(value) {
    return Math.round(Math.max(0, value) / 2) * 2;
}

export function getTileDefaultRect(tileSize) {
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

export function getLabelRect() {
    return { ...LABEL_RECT };
}

export function isCustomTileRect(w, h, tileSize = LEGACY_TILE_SIZE) {
    const def = getTileDefaultRect(tileSize);
    return Math.abs(w - def.w) > 2 || Math.abs(h - def.h) > 2;
}

export function isAtLabelSize(w, h) {
    return w <= LABEL_RECT.w + 2 && h <= LABEL_RECT.h + 2;
}

export function resolveExpandedDefaultRect(tileSize, saved = null) {
    const tileDefault = getTileDefaultRect(tileSize);
    return {
        w: saved?.w ?? Math.max(FREEFORM_EXPANDED_W, tileDefault.w),
        h: saved?.h ?? Math.max(FREEFORM_EXPANDED_DEFAULT_H, tileDefault.h)
    };
}

export function isAtOrBelowCompactZone(w, h, tileSize = LEGACY_TILE_SIZE) {
    const prev = normalizeTileSize(tileSize);
    if (prev === 'note') {
        return w <= TILE_COMPACT_NOTE_W_DOWN && h <= TILE_COMPACT_NOTE_H_DOWN;
    }
    return !(w > TILE_COMPACT_NOTE_W_UP || h > TILE_COMPACT_NOTE_H_UP);
}

export function inferCollapsedTileTier(w, h, prevTier = LEGACY_TILE_SIZE) {
    const prev = normalizeTileSize(prevTier);
    if (h <= TILE_LABEL_COMPACT_H_DOWN) return 'label';

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

export function resolveCollapsedTierRect(w, h, prevTier = LEGACY_TILE_SIZE) {
    const tier = inferCollapsedTileTier(w, h, prevTier);
    return {
        tier,
        w: softSnapPx(Math.max(TILE_RESIZE_MIN_W, w)),
        h: softSnapPx(Math.max(TILE_RESIZE_MIN_H, h))
    };
}

export function clampSpatialSize(w, h, prevTier = LEGACY_TILE_SIZE) {
    const resolved = resolveCollapsedTierRect(w, h, prevTier);
    return { w: resolved.w, h: resolved.h };
}

export function resolveSpatialFallbackRect(tileSize = LEGACY_TILE_SIZE) {
    const size = normalizeTileSize(tileSize);
    return getTileDefaultRect(size === 'label' ? DEFAULT_TILE_SIZE : size);
}

export function readRememberedSize(saved) {
    if (!saved || typeof saved !== 'object') return null;
    const rw = Number(saved.rememberedW);
    const rh = Number(saved.rememberedH);
    if (Number.isFinite(rw) && Number.isFinite(rh) && !(rw <= LABEL_RECT.w + 2 && rh <= LABEL_RECT.h + 2)) {
        return clampSpatialSize(rw, rh);
    }
    if (saved.customCompact === true
        && Number.isFinite(saved.w)
        && Number.isFinite(saved.h)
        && !isAtLabelSize(saved.w, saved.h)) {
        return clampSpatialSize(saved.w, saved.h);
    }
    return null;
}
