import {
    getGridMetrics,
    cellsToSpanW,
    cellsToSpanH,
    spanToCellsW,
    spanToCellsH,
    CANVAS_LAYOUT_ORIGIN,
    COLUMN_GRID_GAP,
    CANVAS_COL_GAP,
    getCanvasColGap
} from './gridDensity.js';
import {
    getSmallFootprintRect,
    readTileSmallFootprint
} from './tileFootprint.js';

export {
    getGridMetrics,
    cellsToSpanW,
    cellsToSpanH,
    spanToCellsW,
    spanToCellsH,
    CANVAS_LAYOUT_ORIGIN,
    COLUMN_GRID_GAP,
    CANVAS_COL_GAP,
    getCanvasColGap
} from './gridDensity.js';

export const FREEFORM_EXPANDED_W = 196;
export const FREEFORM_MIN_W = 72;
export const FREEFORM_MIN_H = 28;
export const FREEFORM_EXPANDED_DEFAULT_H = 120;

export const TILE_LARGE_W_CELLS = 3;
export const TILE_LARGE_H_CELLS = 4;
/** @deprecated */
export const TILE_NOTE_W_CELLS = TILE_LARGE_W_CELLS;
/** @deprecated */
export const TILE_NOTE_H_CELLS = TILE_LARGE_H_CELLS;
export const TILE_RESIZE_MIN_W = 72;

export const TILE_SIZES = ['small', 'large'];
export const DEFAULT_TILE_SIZE = 'large';
export const LEGACY_TILE_SIZE = 'large';

const TIER_HYSTERESIS = 4;

export function getFreformDefaultW() {
    return getSmallFootprintRect('label').w;
}

export function getFreformDefaultH() {
    return getGridMetrics().cellS;
}

/** @deprecated use getFreformDefaultW */
export const FREEFORM_DEFAULT_W = 64;
/** @deprecated use getFreformDefaultH */
export const FREEFORM_DEFAULT_H = 20;

export function getTileLabelH() {
    return getSmallFootprintRect('label').h;
}

export const TILE_LABEL_H = 28;
export const TILE_RESIZE_MIN_H = TILE_LABEL_H;

export function normalizeTileSize(tileSize) {
    if (tileSize === 'small' || tileSize === 'large') return tileSize;
    if (tileSize === 'label') return 'small';
    if (tileSize === 'compact' || tileSize === 'note') return 'large';
    return LEGACY_TILE_SIZE;
}

export function resolveTileSize(item) {
    return normalizeTileSize(item?.tileSize);
}

export function softSnapPx(value) {
    return Math.round(Math.max(0, value) / 2) * 2;
}

export function getLargeDefaultRect() {
    return {
        w: cellsToSpanW(TILE_LARGE_W_CELLS),
        h: cellsToSpanH(TILE_LARGE_H_CELLS)
    };
}

export function getSmallRect(footprint = readTileSmallFootprint()) {
    return getSmallFootprintRect(footprint);
}

export function getLabelRect() {
    return getSmallFootprintRect('label');
}

export function getCollapsedFootprintRect() {
    return getLabelRect();
}

export function isCollapsedSpatialSize(
    w,
    h,
    tileSize = LEGACY_TILE_SIZE,
    footprint = readTileSmallFootprint()
) {
    return !isLargeRelativeToSmall(w, h, footprint, tileSize);
}

export function getTileDefaultRect(tileSize, footprint = readTileSmallFootprint()) {
    const size = normalizeTileSize(tileSize);
    if (size === 'small') return getSmallRect(footprint);
    return getLargeDefaultRect();
}

export function isCustomTileRect(w, h, tileSize = LEGACY_TILE_SIZE, footprint = readTileSmallFootprint()) {
    const def = getTileDefaultRect(tileSize, footprint);
    return Math.abs(w - def.w) > 2 || Math.abs(h - def.h) > 2;
}

export function isAtSmallSize(w, h, footprint = readTileSmallFootprint()) {
    const small = getSmallRect(footprint);
    return w <= small.w + 2 && h <= small.h + 2;
}

export function snapRectToCollapsedFootprint(
    w,
    h,
    tileSize = LEGACY_TILE_SIZE,
    footprint = readTileSmallFootprint()
) {
    if (!isCollapsedSpatialSize(w, h, tileSize, footprint)) {
        return { w, h };
    }
    const small = getSmallRect(footprint);
    return { w: small.w, h: small.h };
}

export function readRememberedSize(saved, footprint = readTileSmallFootprint()) {
    if (!saved || typeof saved !== 'object') return null;
    const rw = Number(saved.rememberedW);
    const rh = Number(saved.rememberedH);
    if (Number.isFinite(rw) && Number.isFinite(rh) && !isAtSmallSize(rw, rh, footprint)) {
        return clampSpatialSize(rw, rh, 'large', footprint);
    }
    return null;
}

export function getPackStrideY(footprint = readTileSmallFootprint()) {
    const small = getSmallRect(footprint);
    const labelH = getTileLabelH();
    if (small.h <= labelH + 2) {
        return small.h + COLUMN_GRID_GAP;
    }
    return getGridMetrics().strideY;
}

export function getPackStrideYForRect(w, h, footprint = readTileSmallFootprint()) {
    if (isAtSmallSize(w, h, footprint)) {
        return getSmallRect(footprint).h + COLUMN_GRID_GAP;
    }
    return getGridMetrics().strideY;
}

export function getGridSnapMinH(footprint = readTileSmallFootprint()) {
    return getSmallRect(footprint).h;
}

/** @deprecated use isAtSmallSize */
export function isAtLabelSize(w, h) {
    return isAtSmallSize(w, h, 'label');
}

export function isLargeRelativeToSmall(w, h, footprint = readTileSmallFootprint(), prevTier = LEGACY_TILE_SIZE) {
    const small = getSmallRect(footprint);
    const tier = normalizeTileSize(prevTier);
    if (tier === 'large') {
        return !(w <= small.w + TIER_HYSTERESIS && h <= small.h + TIER_HYSTERESIS);
    }
    return w > small.w + TIER_HYSTERESIS || h > small.h + TIER_HYSTERESIS;
}

export function inferTileTier(w, h, prevTier = LEGACY_TILE_SIZE, footprint = readTileSmallFootprint()) {
    return isLargeRelativeToSmall(w, h, footprint, prevTier) ? 'large' : 'small';
}

/** @deprecated */
export function inferCollapsedTileTier(w, h, prevTier = LEGACY_TILE_SIZE, footprint = readTileSmallFootprint()) {
    return inferTileTier(w, h, prevTier, footprint);
}

export function resolveCollapsedTierRect(w, h, prevTier = LEGACY_TILE_SIZE, footprint = readTileSmallFootprint()) {
    const tier = inferTileTier(w, h, prevTier, footprint);
    return {
        tier,
        w: softSnapPx(Math.max(TILE_RESIZE_MIN_W, w)),
        h: softSnapPx(Math.max(TILE_RESIZE_MIN_H, h))
    };
}

export function clampSpatialSize(w, h, prevTier = LEGACY_TILE_SIZE, footprint = readTileSmallFootprint()) {
    const resolved = resolveCollapsedTierRect(w, h, prevTier, footprint);
    return { w: resolved.w, h: resolved.h };
}

export function resolveExpandedDefaultRect(tileSize, saved = null, footprint = readTileSmallFootprint()) {
    const tileDefault = getTileDefaultRect(tileSize, footprint);
    return {
        w: saved?.w ?? Math.max(FREEFORM_EXPANDED_W, tileDefault.w),
        h: saved?.h ?? Math.max(FREEFORM_EXPANDED_DEFAULT_H, tileDefault.h)
    };
}

export function resolveSpatialFallbackRect(tileSize = LEGACY_TILE_SIZE, footprint = readTileSmallFootprint()) {
    const size = normalizeTileSize(tileSize);
    return getTileDefaultRect(size === 'small' ? DEFAULT_TILE_SIZE : size, footprint);
}

/** @deprecated */
export function isAtOrBelowCompactZone(w, h, tileSize = LEGACY_TILE_SIZE, footprint = readTileSmallFootprint()) {
    return !isLargeRelativeToSmall(w, h, footprint, tileSize);
}
