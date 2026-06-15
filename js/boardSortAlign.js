import { cellsToSpanW, cellsToSpanH, getGridMetrics } from './gridDensity.js';

export const MOSAIC_COLS = 6;
export const MOSAIC_ROWS = 4;

const TEMPLATES = {
    1: [{ col: 2, row: 0, colSpan: 3, rowSpan: 4 }],
    2: [
        { col: 0, row: 0, colSpan: 3, rowSpan: 4 },
        { col: 3, row: 0, colSpan: 3, rowSpan: 4 }
    ],
    3: [
        { col: 0, row: 0, colSpan: 4, rowSpan: 4 },
        { col: 4, row: 0, colSpan: 2, rowSpan: 2 },
        { col: 4, row: 2, colSpan: 2, rowSpan: 2 }
    ],
    4: [
        { col: 0, row: 0, colSpan: 3, rowSpan: 2 },
        { col: 3, row: 0, colSpan: 3, rowSpan: 2 },
        { col: 0, row: 2, colSpan: 3, rowSpan: 2 },
        { col: 3, row: 2, colSpan: 3, rowSpan: 2 }
    ],
    5: [
        { col: 0, row: 0, colSpan: 3, rowSpan: 2 },
        { col: 3, row: 0, colSpan: 3, rowSpan: 2 },
        { col: 0, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 2, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 4, row: 2, colSpan: 2, rowSpan: 2 }
    ],
    6: [
        { col: 0, row: 0, colSpan: 2, rowSpan: 2 },
        { col: 2, row: 0, colSpan: 2, rowSpan: 2 },
        { col: 4, row: 0, colSpan: 2, rowSpan: 2 },
        { col: 0, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 2, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 4, row: 2, colSpan: 2, rowSpan: 2 }
    ],
    7: [
        { col: 0, row: 0, colSpan: 2, rowSpan: 2 },
        { col: 2, row: 0, colSpan: 2, rowSpan: 2 },
        { col: 4, row: 0, colSpan: 2, rowSpan: 2 },
        { col: 0, row: 2, colSpan: 1, rowSpan: 2 },
        { col: 1, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 3, row: 2, colSpan: 1, rowSpan: 2 },
        { col: 4, row: 2, colSpan: 2, rowSpan: 2 }
    ],
    8: [
        { col: 0, row: 0, colSpan: 1, rowSpan: 2 },
        { col: 1, row: 0, colSpan: 2, rowSpan: 2 },
        { col: 3, row: 0, colSpan: 1, rowSpan: 2 },
        { col: 4, row: 0, colSpan: 2, rowSpan: 2 },
        { col: 0, row: 2, colSpan: 1, rowSpan: 2 },
        { col: 1, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 3, row: 2, colSpan: 1, rowSpan: 2 },
        { col: 4, row: 2, colSpan: 2, rowSpan: 2 }
    ],
    9: [
        { col: 0, row: 0, colSpan: 2, rowSpan: 1 },
        { col: 2, row: 0, colSpan: 2, rowSpan: 1 },
        { col: 4, row: 0, colSpan: 2, rowSpan: 1 },
        { col: 0, row: 1, colSpan: 2, rowSpan: 1 },
        { col: 2, row: 1, colSpan: 2, rowSpan: 1 },
        { col: 4, row: 1, colSpan: 2, rowSpan: 1 },
        { col: 0, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 2, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 4, row: 2, colSpan: 2, rowSpan: 2 }
    ]
};

function autoGridSlots(count) {
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const colSpan = Math.max(1, Math.floor(MOSAIC_COLS / cols));
    const rowSpan = Math.max(1, Math.floor(MOSAIC_ROWS / rows));
    const slots = [];
    for (let i = 0; i < count; i += 1) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        slots.push({
            col: Math.min(c * colSpan, MOSAIC_COLS - colSpan),
            row: r * rowSpan,
            colSpan,
            rowSpan
        });
    }
    return slots;
}

export function getExpandedAlignSlots(count) {
    const n = Math.max(0, Math.floor(count));
    if (n === 0) return [];
    if (n <= 9 && TEMPLATES[n]) return TEMPLATES[n].map((slot) => ({ ...slot }));
    return autoGridSlots(n);
}

export function getMosaicExtent(slots, metrics = getGridMetrics()) {
    if (!slots.length) {
        return { cols: MOSAIC_COLS, rows: MOSAIC_ROWS, w: 0, h: 0 };
    }
    let maxCol = 0;
    let maxRow = 0;
    slots.forEach((slot) => {
        maxCol = Math.max(maxCol, slot.col + slot.colSpan);
        maxRow = Math.max(maxRow, slot.row + slot.rowSpan);
    });
    const w = cellsToSpanW(maxCol, metrics);
    const h = cellsToSpanH(maxRow, metrics);
    return { cols: maxCol, rows: maxRow, w, h };
}

export function slotsToPixelRects(slots, region, metrics = getGridMetrics()) {
    const { strideX, strideY } = metrics;
    return slots.map((slot) => {
        const x = region.x + slot.col * strideX;
        const y = region.y + slot.row * strideY;
        const w = cellsToSpanW(slot.colSpan, metrics);
        const h = cellsToSpanH(slot.rowSpan, metrics);
        return { x: Math.round(x), y: Math.round(y), w, h };
    });
}

export function slotsToFreeformRects(slots, region) {
    const mosaicCols = MOSAIC_COLS;
    const mosaicRows = MOSAIC_ROWS;
    const gap = 8;
    return slots.map((slot) => {
        const relX = slot.col / mosaicCols;
        const relY = slot.row / mosaicRows;
        const relW = slot.colSpan / mosaicCols;
        const relH = slot.rowSpan / mosaicRows;
        const x = region.x + relX * region.w + (relX > 0 ? gap * 0.5 : 0);
        const y = region.y + relY * region.h + (relY > 0 ? gap * 0.5 : 0);
        const w = Math.max(120, relW * region.w - gap);
        const h = Math.max(80, relH * region.h - gap);
        return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    });
}

export function computeAlignRegion(packW, startY, origin, edgePad, metrics = getGridMetrics()) {
    const mosaicW = cellsToSpanW(MOSAIC_COLS, metrics);
    const mosaicH = cellsToSpanH(MOSAIC_ROWS, metrics);
    const regionW = Math.min(packW, mosaicW);
    const offsetX = origin + edgePad + Math.max(0, Math.floor((packW - regionW) / 2));
    return {
        x: offsetX,
        y: startY,
        w: regionW,
        h: mosaicH
    };
}
