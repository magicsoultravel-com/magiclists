export const STORAGE_KEY = 'matrix_grid_fineness';
export const LEGACY_MIGRATION_FLAG = 'matrix_grid_fineness_migrated';
export const FINENESS_STEPS = [32, 40, 48, 56, 64, 72, 80];
export const DEFAULT_FINENESS_STEP = 4;
export const CANVAS_LAYOUT_ORIGIN = 16;
export const COLUMN_GRID_GAP = 4;
export const COLUMN_MIN_COLS = 2;
export const COLUMN_INNER_PAD = 8;
export const COLUMN_HEADER_APPROX_H = 40;
export const CANVAS_COL_GAP = 8;

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

function clampStep(step) {
    const n = Number(step);
    if (!Number.isFinite(n)) return DEFAULT_FINENESS_STEP;
    return Math.max(1, Math.min(FINENESS_STEPS.length, Math.round(n)));
}

export function readGridFinenessStep() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw == null) return null;
        return clampStep(parseInt(raw, 10));
    } catch {
        return null;
    }
}

export function writeGridFinenessStep(step) {
    const next = clampStep(step);
    try {
        localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
        /* ignore */
    }
    return next;
}

export function isGridFinenessCustomized(step = readGridFinenessStep()) {
    return step != null && step !== DEFAULT_FINENESS_STEP;
}

export function getGridMetrics(step = readGridFinenessStep() ?? DEFAULT_FINENESS_STEP) {
    const index = clampStep(step) - 1;
    const cellS = FINENESS_STEPS[index];
    const gap = COLUMN_GRID_GAP;
    const stride = cellS + gap;
    const edgePad = Math.round(cellS / 8);
    const origin = CANVAS_LAYOUT_ORIGIN;
    const columnMinInnerW = COLUMN_MIN_COLS * cellS + (COLUMN_MIN_COLS - 1) * gap;
    const canvasGridW = columnMinInnerW + COLUMN_INNER_PAD * 2;
    return {
        step: index + 1,
        cellS,
        cellW: cellS,
        cellH: cellS,
        gap,
        strideX: stride,
        strideY: stride,
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

export function getScaledFootprintRects(step = readGridFinenessStep() ?? DEFAULT_FINENESS_STEP) {
    const { cellS } = getGridMetrics(step);
    const labelH = Math.max(20, Math.round(28 * cellS / 56));
    return {
        label: { w: cellS * 2, h: labelH },
        card: { w: cellS * 2, h: cellS },
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

    const metrics = getGridMetrics(DEFAULT_FINENESS_STEP);
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

export function migrateLegacyGridLayoutIfNeeded() {
    try {
        if (localStorage.getItem(LEGACY_MIGRATION_FLAG) === '1') return false;
        if (readGridFinenessStep() != null) {
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
        writeGridFinenessStep(DEFAULT_FINENESS_STEP);
        localStorage.setItem(LEGACY_MIGRATION_FLAG, '1');
        return changed;
    } catch {
        return false;
    }
}

export function applyGridFineness(step = readGridFinenessStep() ?? DEFAULT_FINENESS_STEP) {
    const metrics = getGridMetrics(step);
    const footprints = getScaledFootprintRects(step);
    const largeW = cellsToSpanW(3, metrics);
    const largeH = cellsToSpanH(4, metrics);
    const root = document.documentElement;
    const style = root.style;

    root.dataset.gridFineness = String(metrics.step);
    style.setProperty('--grid-cell-s', `${metrics.cellS}px`);
    style.setProperty('--grid-gap', `${metrics.gap}px`);
    style.setProperty('--grid-stride-x', `${metrics.strideX}px`);
    style.setProperty('--grid-stride-y', `${metrics.strideY}px`);
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
    style.setProperty('--tile-label-h', `${footprints.label.h}px`);
    style.setProperty('--tile-note-w', `${largeW}px`);
    style.setProperty('--tile-note-h', `${largeH}px`);

    return metrics;
}

export const GridFineness = {
    FINENESS_STEPS,
    DEFAULT_FINENESS_STEP,
    STEP_MIN: 1,
    STEP_MAX: FINENESS_STEPS.length,

    getStep() {
        return readGridFinenessStep() ?? DEFAULT_FINENESS_STEP;
    },

    getCellLabel(step = this.getStep()) {
        const { cellS } = getGridMetrics(step);
        return `${cellS}px`;
    },

    setStep(step) {
        const prev = getGridMetrics();
        const nextStep = writeGridFinenessStep(step);
        const next = applyGridFineness(nextStep);
        window.dispatchEvent(new CustomEvent('appearance:grid_fineness_changed', {
            detail: { step: nextStep, prevMetrics: prev, nextMetrics: next }
        }));
        return nextStep;
    },

    step(delta) {
        return this.setStep(this.getStep() + delta);
    },

    apply() {
        return applyGridFineness(this.getStep());
    },

    isCustomized() {
        return isGridFinenessCustomized();
    }
};
