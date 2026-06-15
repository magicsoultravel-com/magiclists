import { cellsToSpanH, getGridMetrics } from './gridDensity.js';
import { getLargeDefaultRect } from './tileGeometry.js';

export const MOSAIC_COLS = 6;
export const MOSAIC_ROWS = 4;

const TEMPLATES = {
    1: [{ col: 0, row: 0, colSpan: 6, rowSpan: 4 }],
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
        { col: 0, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 2, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 4, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 0, row: 4, colSpan: 6, rowSpan: 2 }
    ],
    8: [
        { col: 0, row: 0, colSpan: 2, rowSpan: 2 },
        { col: 2, row: 0, colSpan: 2, rowSpan: 2 },
        { col: 4, row: 0, colSpan: 2, rowSpan: 2 },
        { col: 0, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 2, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 4, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 0, row: 4, colSpan: 3, rowSpan: 2 },
        { col: 3, row: 4, colSpan: 3, rowSpan: 2 }
    ],
    9: [
        { col: 0, row: 0, colSpan: 2, rowSpan: 2 },
        { col: 2, row: 0, colSpan: 2, rowSpan: 2 },
        { col: 4, row: 0, colSpan: 2, rowSpan: 2 },
        { col: 0, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 2, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 4, row: 2, colSpan: 2, rowSpan: 2 },
        { col: 0, row: 4, colSpan: 2, rowSpan: 2 },
        { col: 2, row: 4, colSpan: 2, rowSpan: 2 },
        { col: 4, row: 4, colSpan: 2, rowSpan: 2 }
    ]
};

function autoGridSlots(count) {
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const colSpan = Math.max(1, Math.floor(MOSAIC_COLS / cols));
    const rowSpan = Math.max(1, Math.floor((MOSAIC_ROWS * 2) / rows));
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

export function getMosaicGridExtent(slots) {
    if (!slots.length) {
        return { cols: MOSAIC_COLS, rows: MOSAIC_ROWS };
    }
    let maxCol = 0;
    let maxRow = 0;
    slots.forEach((slot) => {
        maxCol = Math.max(maxCol, slot.col + slot.colSpan);
        maxRow = Math.max(maxRow, slot.row + slot.rowSpan);
    });
    return { cols: maxCol, rows: maxRow };
}

export function computeAlignRegion({
    packW,
    startY,
    maxH,
    origin,
    edgePad,
    metrics = getGridMetrics()
} = {}) {
    const pad = edgePad ?? metrics.edgePad;
    const minRegionH = cellsToSpanH(MOSAIC_ROWS, metrics);
    const availableH = Math.max(0, (maxH ?? minRegionH) - startY - pad);
    const h = Math.max(minRegionH, availableH);
    return {
        x: (origin ?? metrics.origin) + pad,
        y: startY,
        w: Math.max(1, packW ?? metrics.canvasGridW),
        h
    };
}

export function slotsToRegionRects(slots, region, { gap, slotCount } = {}) {
    const metrics = getGridMetrics();
    const slotGap = gap ?? metrics.gap;
    const { cols: mosaicCols, rows: mosaicRows } = getMosaicGridExtent(slots);
    const large = getLargeDefaultRect();
    const count = slotCount ?? slots.length;
    const minW = count <= 1
        ? Math.min(large.w, region.w * 0.5)
        : Math.min(large.w, (region.w / Math.max(1, mosaicCols)) * 0.85);
    const minH = count <= 1
        ? Math.min(large.h, region.h * 0.5)
        : Math.min(large.h, (region.h / Math.max(1, mosaicRows)) * 0.85);

    return slots.map((slot) => {
        const relX = slot.col / mosaicCols;
        const relY = slot.row / mosaicRows;
        const relW = slot.colSpan / mosaicCols;
        const relH = slot.rowSpan / mosaicRows;
        const x = region.x + relX * region.w + (relX > 0 ? slotGap * 0.5 : 0);
        const y = region.y + relY * region.h + (relY > 0 ? slotGap * 0.5 : 0);
        const w = Math.max(minW, Math.round(relW * region.w - slotGap));
        const h = Math.max(minH, Math.round(relH * region.h - slotGap));
        return { x: Math.round(x), y: Math.round(y), w, h };
    });
}
