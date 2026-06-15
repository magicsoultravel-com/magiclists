import { cellsToSpanH, getGridMetrics } from './gridDensity.js';

/** Minimum expanded-align region height (two grid rows). */
const MIN_REGION_ROWS = 2;

/** Inset from pack edges inside the expanded align zone. */
export const ALIGN_REGION_MARGIN = 8;

/** Extra spacing between aligned expanded notes (added to grid gap). */
export const ALIGN_NOTE_GAP_EXTRA = 4;

export function getAlignGridDims(count, direction = 'horizontal') {
    const n = Math.max(0, Math.floor(count));
    if (n <= 0) return { cols: 0, rows: 0 };
    if (n === 1) return { cols: 1, rows: 1 };
    if (n === 2) return { cols: 2, rows: 1 };
    if (n === 3) {
        return direction === 'vertical'
            ? { cols: 1, rows: 3 }
            : { cols: 3, rows: 1 };
    }
    if (n === 4) return { cols: 2, rows: 2 };
    if (n <= 6) return { cols: 3, rows: 2 };
    if (n <= 8) return { cols: 4, rows: 2 };
    if (n === 9) return { cols: 3, rows: 3 };
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return { cols, rows };
}

export function getExpandedAlignSlots(count, direction = 'horizontal') {
    const n = Math.max(0, Math.floor(count));
    if (n === 0) return [];
    const { cols } = getAlignGridDims(n, direction);
    const slots = [];
    for (let i = 0; i < n; i += 1) {
        slots.push({
            col: i % cols,
            row: Math.floor(i / cols),
            colSpan: 1,
            rowSpan: 1
        });
    }
    return slots;
}

export function computeAlignRegion({
    packW,
    startY,
    viewportBottom,
    origin,
    edgePad,
    metrics = getGridMetrics()
} = {}) {
    const pad = edgePad ?? metrics.edgePad;
    const o = origin ?? metrics.origin;
    const margin = ALIGN_REGION_MARGIN;
    const minRegionH = cellsToSpanH(MIN_REGION_ROWS, metrics);
    const availableH = Math.max(0, (viewportBottom ?? minRegionH) - startY - pad - margin);
    const h = Math.max(minRegionH, availableH - margin);
    return {
        x: o + pad + margin,
        y: startY + margin,
        w: Math.max(1, (packW ?? metrics.canvasGridW) - margin * 2),
        h
    };
}

export function slotsToRegionRects(slots, region, { gap } = {}) {
    if (!slots.length) return [];
    const metrics = getGridMetrics();
    const slotGap = (gap ?? metrics.gap) + ALIGN_NOTE_GAP_EXTRA;
    let cols = 0;
    let rows = 0;
    slots.forEach((slot) => {
        cols = Math.max(cols, slot.col + slot.colSpan);
        rows = Math.max(rows, slot.row + slot.rowSpan);
    });
    const innerW = Math.max(1, region.w - slotGap * Math.max(0, cols - 1));
    const innerH = Math.max(1, region.h - slotGap * Math.max(0, rows - 1));
    const cellW = innerW / cols;
    const cellH = innerH / rows;

    return slots.map((slot) => {
        const x = region.x + slot.col * (cellW + slotGap);
        const y = region.y + slot.row * (cellH + slotGap);
        const w = slot.colSpan * cellW + (slot.colSpan - 1) * slotGap;
        const h = slot.rowSpan * cellH + (slot.rowSpan - 1) * slotGap;
        return {
            x: Math.round(x),
            y: Math.round(y),
            w: Math.max(1, Math.round(w)),
            h: Math.max(1, Math.round(h))
        };
    });
}
