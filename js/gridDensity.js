export const FINENESS_STEPS = [32, 40, 48, 56, 64, 72, 80];
export const FIXED_FINENESS_STEP = 1;

/** User-adjustable snap ruler (px); note footprints stay on FIXED_FINENESS_STEP. */
export const PLACEMENT_STRIDE_STEPS = [8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64];
export const DEFAULT_PLACEMENT_STEP = 7;
export const PLACEMENT_STRIDE_STORAGE_KEY = 'matrix_placement_stride';
/** Target for migrateLegacyGridLayoutIfNeeded (old rect→square migration). */
export const LEGACY_MIGRATION_TARGET_STEP = 4;
/** Previous user-facing defaults before compact lock-in. */
export const PREVIOUS_DEFAULT_FINENESS_STEP = 4;
export const PREVIOUS_DEFAULT_PADDING_STEP = 5;

export const COMPACT_MIGRATION_FLAG = 'matrix_compact_defaults_migrated';
export const CARD_MINIMUM_MIGRATION_FLAG = 'matrix_card_minimum_migrated';
export const GRID_SPAN_CARD_MIGRATION_FLAG = 'matrix_grid_span_card_migrated';
export const LEGACY_MIGRATION_FLAG = 'matrix_grid_fineness_migrated';

export const CANVAS_LAYOUT_ORIGIN = 16;
export const COLUMN_GRID_GAP = 4;
export const COLUMN_MIN_COLS = 2;
export const COLUMN_INNER_PAD = 8;
export const COLUMN_HEADER_APPROX_H = 40;
export const CANVAS_COL_GAP = 8;

export const INSET_BASE_PX = 14;
export const PADDING_STEPS_PX = [2, 5, 8, 11, 14, 15, 17];
export const FIXED_PADDING_STEP = 1;

export const LEGACY_RECT_METRICS = {
    cellW: 96,
    cellH: 56,
    gap: 4,
    strideX: 100,
    strideY: 60,
    origin: CANVAS_LAYOUT_ORIGIN,
    largeWCells: 2.5,
    largeHCells: 5
};

const GRID_LAYOUT_KEY = 'matrix_grid_layout';
const FREEFORM_POSITIONS_KEY = 'matrix_freeform_positions';
const FREEFORM_SIZES_KEY = 'matrix_freeform_sizes';
const OBSOLETE_KEYS = [
    'matrix_tile_small_footprint',
    'matrix_grid_fineness',
    'matrix_board_padding'
];

function clampStep(step, fallback = FIXED_FINENESS_STEP) {
    const n = Number(step);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(FINENESS_STEPS.length, Math.round(n)));
}

function clampPaddingStep(step, fallback = FIXED_PADDING_STEP) {
    const n = Number(step);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(PADDING_STEPS_PX.length, Math.round(n)));
}

function clampPlacementStep(step, fallback = DEFAULT_PLACEMENT_STEP) {
    const n = Number(step);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(PLACEMENT_STRIDE_STEPS.length, Math.round(n)));
}

export function readPlacementStrideStep() {
    try {
        const raw = parseInt(localStorage.getItem(PLACEMENT_STRIDE_STORAGE_KEY), 10);
        return clampPlacementStep(raw);
    } catch {
        return DEFAULT_PLACEMENT_STEP;
    }
}

export function getPlacementStridePx(step = readPlacementStrideStep()) {
    return PLACEMENT_STRIDE_STEPS[clampPlacementStep(step) - 1];
}

export function getBoardPaddingScale(paddingStep = FIXED_PADDING_STEP) {
    const index = clampPaddingStep(paddingStep) - 1;
    return PADDING_STEPS_PX[index] / INSET_BASE_PX;
}

export function applyBoardPadding() {
    document.documentElement.style.setProperty(
        '--board-padding-scale',
        String(getBoardPaddingScale())
    );
}

export function getCanvasColGap() {
    const scale = getBoardPaddingScale();
    return Math.max(2, Math.round(CANVAS_COL_GAP * scale));
}

export function getGridMetrics(
    finenessStep = FIXED_FINENESS_STEP,
    paddingStep = FIXED_PADDING_STEP
) {
    const index = clampStep(finenessStep) - 1;
    const cellS = FINENESS_STEPS[index];
    const scale = getBoardPaddingScale(paddingStep);
    const gap = Math.max(0, Math.round(COLUMN_GRID_GAP * scale));
    const stride = cellS + gap;
    const edgePad = Math.max(1, Math.round((cellS / 8) * scale));
    const origin = Math.max(2, Math.round(CANVAS_LAYOUT_ORIGIN * scale));
    const columnMinInnerW = COLUMN_MIN_COLS * cellS + (COLUMN_MIN_COLS - 1) * gap;
    const canvasGridW = columnMinInnerW + COLUMN_INNER_PAD * 2;
    const placementStep = readPlacementStrideStep();
    const placementStride = getPlacementStridePx(placementStep);
    return {
        step: index + 1,
        cellS,
        cellW: cellS,
        cellH: cellS,
        gap,
        strideX: stride,
        strideY: stride,
        placementStep,
        placementStrideX: placementStride,
        placementStrideY: placementStride,
        edgePad,
        origin,
        columnMinInnerW,
        canvasGridW,
        columnMinCanvasH: COLUMN_HEADER_APPROX_H + COLUMN_INNER_PAD + cellS,
        packGap: gap
    };
}

export function cellsToSpanW(cells, metrics = getGridMetrics()) {
    const n = Math.max(1, cells);
    return Math.round(n * metrics.cellW + (n - 1) * metrics.gap);
}

export function cellsToSpanH(cells, metrics = getGridMetrics()) {
    const n = Math.max(1, cells);
    return Math.round(n * metrics.cellH + (n - 1) * metrics.gap);
}

export function spanToCellsW(span, metrics = getGridMetrics()) {
    return Math.max(1, Math.round((span + metrics.gap) / metrics.strideX));
}

export function spanToCellsH(span, metrics = getGridMetrics()) {
    return Math.max(1, Math.round((span + metrics.gap) / metrics.strideY));
}

export function getScaledFootprintRects(
    finenessStep = FIXED_FINENESS_STEP,
    paddingStep = FIXED_PADDING_STEP
) {
    const metrics = getGridMetrics(finenessStep, paddingStep);
    const { cellS } = metrics;
    const labelH = Math.max(20, Math.round(28 * cellS / 56));
    return {
        label: { w: cellsToSpanW(2, metrics), h: labelH },
        card: { w: cellsToSpanW(2, metrics), h: cellS },
        wide: {
            w: Math.round(128 * cellS / 56),
            h: Math.round(96 * cellS / 56)
        }
    };
}

function legacySpanToCellsW(span) {
    return Math.max(1, Math.round((span + LEGACY_RECT_METRICS.gap) / LEGACY_RECT_METRICS.strideX));
}

function legacySpanToCellsH(span) {
    return Math.max(1, Math.round((span + LEGACY_RECT_METRICS.gap) / LEGACY_RECT_METRICS.strideY));
}

function legacySnapCoord(value, origin, stride) {
    const rel = Math.max(0, value - origin);
    return origin + Math.round(rel / stride) * stride;
}

function remapLegacyLargeCells(wCells, hCells) {
    if (wCells >= 2 && hCells >= 4) return { wCells: 3, hCells: 4 };
    return {
        wCells: Math.max(1, Math.round(wCells)),
        hCells: Math.max(1, Math.round(hCells))
    };
}

export function migrateRectEntryToSquare(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    const x = Number(entry.x);
    const y = Number(entry.y);
    const w = Number(entry.w);
    const h = Number(entry.h);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return entry;

    const { origin, strideX, strideY } = LEGACY_RECT_METRICS;
    const hasPos = Number.isFinite(x) && Number.isFinite(y);
    let wCells = legacySpanToCellsW(w);
    let hCells = legacySpanToCellsH(h);
    if (wCells >= 2 || hCells >= 3) {
        ({ wCells, hCells } = remapLegacyLargeCells(wCells, hCells));
    }

    const metrics = getGridMetrics(LEGACY_MIGRATION_TARGET_STEP, PREVIOUS_DEFAULT_PADDING_STEP);
    const next = {
        w: cellsToSpanW(wCells, metrics),
        h: cellsToSpanH(hCells, metrics)
    };
    if (hasPos) {
        next.x = legacySnapCoord(x, origin, strideX);
        next.y = legacySnapCoord(y, origin, strideY);
        next.x = legacySnapCoord(next.x, metrics.origin, metrics.strideX);
        next.y = legacySnapCoord(next.y, metrics.origin, metrics.strideY);
    }

    const rw = Number(entry.rememberedW);
    const rh = Number(entry.rememberedH);
    if (Number.isFinite(rw) && Number.isFinite(rh)) {
        let memW = legacySpanToCellsW(rw);
        let memH = legacySpanToCellsH(rh);
        if (memW >= 2 || memH >= 3) {
            ({ wCells: memW, hCells: memH } = remapLegacyLargeCells(memW, memH));
        }
        next.rememberedW = cellsToSpanW(memW, metrics);
        next.rememberedH = cellsToSpanH(memH, metrics);
    }

    return next;
}

function readJson(key, fallback = {}) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function writeJsonIfChanged(key, next, prev) {
    if (JSON.stringify(next) === JSON.stringify(prev)) return false;
    try {
        localStorage.setItem(key, JSON.stringify(next));
        return true;
    } catch {
        return false;
    }
}

function isAtAnySmallFootprintSize(w, h) {
    const rects = getScaledFootprintRects(PREVIOUS_DEFAULT_FINENESS_STEP, PREVIOUS_DEFAULT_PADDING_STEP);
    return ['label', 'card', 'wide'].some((tier) => {
        const r = rects[tier];
        return w <= r.w + 2 && h <= r.h + 2;
    });
}

export function remapLayoutRect(rect, prevMetrics, nextMetrics) {
    if (!rect || !Number.isFinite(rect.w) || !Number.isFinite(rect.h)) return rect;
    const wCells = Math.max(1, Math.round((rect.w + prevMetrics.gap) / prevMetrics.strideX));
    const hCells = Math.max(1, Math.round((rect.h + prevMetrics.gap) / prevMetrics.strideY));
    const next = {
        w: cellsToSpanW(wCells, nextMetrics),
        h: cellsToSpanH(hCells, nextMetrics)
    };
    if (Number.isFinite(rect.x) && Number.isFinite(rect.y)) {
        const xCells = Math.round((rect.x - prevMetrics.origin) / prevMetrics.strideX);
        const yCells = Math.round((rect.y - prevMetrics.origin) / prevMetrics.strideY);
        next.x = nextMetrics.origin + xCells * nextMetrics.strideX;
        next.y = nextMetrics.origin + yCells * nextMetrics.strideY;
    }
    if (Number.isFinite(rect.rememberedW) && Number.isFinite(rect.rememberedH)) {
        const rwCells = Math.max(1, Math.round((rect.rememberedW + prevMetrics.gap) / prevMetrics.strideX));
        const rhCells = Math.max(1, Math.round((rect.rememberedH + prevMetrics.gap) / prevMetrics.strideY));
        next.rememberedW = cellsToSpanW(rwCells, nextMetrics);
        next.rememberedH = cellsToSpanH(rhCells, nextMetrics);
    }
    return next;
}

function snapSmallRectToMinimum(rect) {
    if (!rect || !Number.isFinite(rect.w) || !Number.isFinite(rect.h)) return rect;
    const minimum = getScaledFootprintRects().card;
    const metrics = getGridMetrics();
    const legacyCardW = metrics.cellS * 2;
    const next = { ...rect };
    const atSmall = isAtAnySmallFootprintSize(rect.w, rect.h)
        || (rect.w <= legacyCardW + 2 && rect.h <= minimum.h + 2);
    if (atSmall) {
        next.w = minimum.w;
        next.h = minimum.h;
    }
    if (Number.isFinite(rect.rememberedW) && Number.isFinite(rect.rememberedH)
        && (isAtAnySmallFootprintSize(rect.rememberedW, rect.rememberedH)
            || (rect.rememberedW <= legacyCardW + 2 && rect.rememberedH <= minimum.h + 2))) {
        delete next.rememberedW;
        delete next.rememberedH;
    }
    return next;
}

/** @deprecated alias */
function snapSmallRectToLabel(rect, _nextMetrics) {
    return snapSmallRectToMinimum(rect);
}

export function migrateCompactDefaultsIfNeeded() {
    try {
        if (localStorage.getItem(COMPACT_MIGRATION_FLAG) === '1') return false;
    } catch {
        return false;
    }

    const prevMetrics = getGridMetrics(PREVIOUS_DEFAULT_FINENESS_STEP, PREVIOUS_DEFAULT_PADDING_STEP);
    const nextMetrics = getGridMetrics();
    let changed = false;

    const grid = readJson(GRID_LAYOUT_KEY);
    const gridNext = {};
    Object.keys(grid).forEach((id) => {
        let entry = remapLayoutRect(grid[id], prevMetrics, nextMetrics);
        entry = snapSmallRectToMinimum(entry);
        gridNext[id] = entry;
        if (JSON.stringify(entry) !== JSON.stringify(grid[id])) changed = true;
    });
    if (changed) writeJsonIfChanged(GRID_LAYOUT_KEY, gridNext, grid);

    const positions = readJson(FREEFORM_POSITIONS_KEY);
    const positionsNext = {};
    Object.keys(positions).forEach((id) => {
        const entry = positions[id];
        if (!entry || typeof entry !== 'object') {
            positionsNext[id] = entry;
            return;
        }
        const x = Number(entry.x);
        const y = Number(entry.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            positionsNext[id] = entry;
            return;
        }
        const xCells = Math.round((x - prevMetrics.origin) / prevMetrics.strideX);
        const yCells = Math.round((y - prevMetrics.origin) / prevMetrics.strideY);
        const next = {
            ...entry,
            x: nextMetrics.origin + xCells * nextMetrics.strideX,
            y: nextMetrics.origin + yCells * nextMetrics.strideY
        };
        positionsNext[id] = next;
        if (JSON.stringify(next) !== JSON.stringify(entry)) changed = true;
    });
    if (Object.keys(positionsNext).length) {
        changed = writeJsonIfChanged(FREEFORM_POSITIONS_KEY, positionsNext, positions) || changed;
    }

    const sizes = readJson(FREEFORM_SIZES_KEY);
    const sizesNext = {};
    Object.keys(sizes).forEach((id) => {
        let entry = remapLayoutRect(sizes[id], prevMetrics, nextMetrics);
        entry = snapSmallRectToMinimum(entry);
        sizesNext[id] = entry;
        if (JSON.stringify(entry) !== JSON.stringify(sizes[id])) changed = true;
    });
    if (Object.keys(sizesNext).length) {
        changed = writeJsonIfChanged(FREEFORM_SIZES_KEY, sizesNext, sizes) || changed;
    }

    OBSOLETE_KEYS.forEach((key) => {
        try {
            localStorage.removeItem(key);
        } catch { /* ignore */ }
    });

    try {
        localStorage.setItem(COMPACT_MIGRATION_FLAG, '1');
    } catch { /* ignore */ }

    return changed;
}

export function migrateCardMinimumFootprintIfNeeded() {
    try {
        if (localStorage.getItem(CARD_MINIMUM_MIGRATION_FLAG) === '1') return false;
    } catch {
        return false;
    }

    let changed = false;

    const grid = readJson(GRID_LAYOUT_KEY);
    const gridNext = {};
    Object.keys(grid).forEach((id) => {
        const entry = snapSmallRectToMinimum(grid[id]);
        gridNext[id] = entry;
        if (JSON.stringify(entry) !== JSON.stringify(grid[id])) changed = true;
    });
    if (changed) writeJsonIfChanged(GRID_LAYOUT_KEY, gridNext, grid);

    const sizes = readJson(FREEFORM_SIZES_KEY);
    const sizesNext = {};
    Object.keys(sizes).forEach((id) => {
        const entry = snapSmallRectToMinimum(sizes[id]);
        sizesNext[id] = entry;
        if (JSON.stringify(entry) !== JSON.stringify(sizes[id])) changed = true;
    });
    if (Object.keys(sizesNext).length) {
        changed = writeJsonIfChanged(FREEFORM_SIZES_KEY, sizesNext, sizes) || changed;
    }

    try {
        localStorage.setItem(CARD_MINIMUM_MIGRATION_FLAG, '1');
    } catch { /* ignore */ }

    return changed;
}

export function migrateGridSpanCardWidthIfNeeded() {
    try {
        if (localStorage.getItem(GRID_SPAN_CARD_MIGRATION_FLAG) === '1') return false;
    } catch {
        return false;
    }

    let changed = false;

    const grid = readJson(GRID_LAYOUT_KEY);
    const gridNext = {};
    Object.keys(grid).forEach((id) => {
        const entry = snapSmallRectToMinimum(grid[id]);
        gridNext[id] = entry;
        if (JSON.stringify(entry) !== JSON.stringify(grid[id])) changed = true;
    });
    if (changed) writeJsonIfChanged(GRID_LAYOUT_KEY, gridNext, grid);

    const sizes = readJson(FREEFORM_SIZES_KEY);
    const sizesNext = {};
    Object.keys(sizes).forEach((id) => {
        const entry = snapSmallRectToMinimum(sizes[id]);
        sizesNext[id] = entry;
        if (JSON.stringify(entry) !== JSON.stringify(sizes[id])) changed = true;
    });
    if (Object.keys(sizesNext).length) {
        changed = writeJsonIfChanged(FREEFORM_SIZES_KEY, sizesNext, sizes) || changed;
    }

    try {
        localStorage.setItem(GRID_SPAN_CARD_MIGRATION_FLAG, '1');
    } catch { /* ignore */ }

    return changed;
}

export function migrateLegacyGridLayoutIfNeeded() {
    try {
        if (localStorage.getItem(LEGACY_MIGRATION_FLAG) === '1') return false;
        if (localStorage.getItem('matrix_grid_fineness') != null) {
            localStorage.setItem(LEGACY_MIGRATION_FLAG, '1');
            return false;
        }
    } catch {
        return false;
    }

    let changed = false;
    try {
        const raw = localStorage.getItem(GRID_LAYOUT_KEY);
        if (raw) {
            const grid = JSON.parse(raw);
            const next = {};
            Object.keys(grid).forEach((id) => {
                const migrated = migrateRectEntryToSquare(grid[id]);
                next[id] = migrated;
                if (JSON.stringify(migrated) !== JSON.stringify(grid[id])) changed = true;
            });
            if (changed) {
                localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(next));
            }
        }
        localStorage.setItem(LEGACY_MIGRATION_FLAG, '1');
        return changed;
    } catch {
        return false;
    }
}

export function applyGridFineness() {
    const metrics = getGridMetrics();
    const footprints = getScaledFootprintRects();
    const largeW = cellsToSpanW(3, metrics);
    const largeH = cellsToSpanH(4, metrics);
    const root = document.documentElement;
    const style = root.style;

    root.dataset.gridFineness = String(metrics.step);
    style.setProperty('--grid-cell-s', `${metrics.cellS}px`);
    style.setProperty('--grid-gap', `${metrics.gap}px`);
    style.setProperty('--grid-stride-x', `${metrics.strideX}px`);
    style.setProperty('--grid-stride-y', `${metrics.strideY}px`);
    style.setProperty('--placement-stride-x', `${metrics.placementStrideX}px`);
    style.setProperty('--placement-stride-y', `${metrics.placementStrideY}px`);
    root.dataset.placementStride = String(metrics.placementStep);
    style.setProperty('--grid-origin', `${metrics.origin}px`);
    style.setProperty('--grid-edge-pad', `${metrics.edgePad}px`);

    style.setProperty('--tile-cell-w', `${metrics.cellS}px`);
    style.setProperty('--tile-cell-h', `${metrics.cellS}px`);
    style.setProperty('--tile-small-w-label', `${footprints.label.w}px`);
    style.setProperty('--tile-small-h-label', `${footprints.label.h}px`);
    style.setProperty('--tile-small-w-card', `${footprints.card.w}px`);
    style.setProperty('--tile-small-h-card', `${footprints.card.h}px`);
    style.setProperty('--tile-small-w-wide', `${footprints.wide.w}px`);
    style.setProperty('--tile-small-h-wide', `${footprints.wide.h}px`);
    style.setProperty('--tile-large-w', `${largeW}px`);
    style.setProperty('--tile-large-h', `${largeH}px`);
    style.setProperty('--tile-label-h', `${footprints.card.h}px`);
    style.setProperty('--tile-note-w', `${largeW}px`);
    style.setProperty('--tile-note-h', `${largeH}px`);

    return metrics;
}

export function initGridMetrics() {
    applyBoardPadding();
    return applyGridFineness();
}
