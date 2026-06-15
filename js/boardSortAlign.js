import { cellsToSpanH, getGridMetrics } from './gridDensity.js';
import {
    FILE_CABINET_STACK_OFFSET_X,
    FILE_CABINET_STACK_OFFSET_Y
} from './fileCabinet.js';

/** Minimum expanded-align region height (two grid rows). */
const MIN_REGION_ROWS = 2;

/** Inset from pack edges inside the expanded align zone. */
export const ALIGN_REGION_MARGIN = 8;

/** Extra spacing between aligned expanded notes (added to grid gap). */
export const ALIGN_NOTE_GAP_EXTRA = 4;

/** Max overlapping tiles per cascade stack (file-cabinet depth). */
export const CASCADE_PER_STACK = 4;

/** Max stacks per row (horizontal sort) or per column (vertical sort). */
export const CASCADE_STACKS_PER_LINE = 4;

/** @deprecated Use CASCADE_PER_STACK */
export const CASCADE_PER_LINE = CASCADE_PER_STACK;

export function chunkForStacks(items, maxPerStack = CASCADE_PER_STACK) {
    const chunks = [];
    const list = items || [];
    for (let i = 0; i < list.length; i += maxPerStack) {
        chunks.push(list.slice(i, i + maxPerStack));
    }
    return chunks;
}

export function computeStackFootprint(
    count,
    w,
    h,
    offsetX = FILE_CABINET_STACK_OFFSET_X,
    offsetY = FILE_CABINET_STACK_OFFSET_Y
) {
    const n = Math.max(0, Math.floor(count));
    const tileW = Math.max(1, Math.round(w));
    const tileH = Math.max(1, Math.round(h));
    if (n <= 0) return { w: tileW, h: tileH };
    return {
        w: tileW + Math.max(0, n - 1) * offsetX,
        h: tileH + Math.max(0, n - 1) * offsetY
    };
}

export function computeStackRects(
    sizes,
    baseX,
    baseY,
    {
        offsetX = FILE_CABINET_STACK_OFFSET_X,
        offsetY = FILE_CABINET_STACK_OFFSET_Y,
        zIndexBase = 0
    } = {}
) {
    return (sizes || []).map((size, index) => ({
        x: Math.round(baseX + index * offsetX),
        y: Math.round(baseY + index * offsetY),
        w: Math.max(1, Math.round(size.w)),
        h: Math.max(1, Math.round(size.h)),
        zIndex: zIndexBase + index + 1
    }));
}

export function layoutStackAnchors(
    stackFootprints,
    direction,
    startPos,
    gap = 4,
    stacksPerLine = CASCADE_STACKS_PER_LINE
) {
    const anchors = [];
    let cursorX = startPos?.x ?? 0;
    let cursorY = startPos?.y ?? 0;
    const rowStartX = cursorX;
    const colStartY = cursorY;
    let rowMaxH = 0;
    let colMaxW = 0;
    let lineIndex = 0;

    (stackFootprints || []).forEach((fp) => {
        if (direction === 'vertical') {
            if (lineIndex > 0 && lineIndex % stacksPerLine === 0) {
                cursorX += colMaxW + gap;
                cursorY = colStartY;
                colMaxW = 0;
            }
            anchors.push({ x: cursorX, y: cursorY });
            colMaxW = Math.max(colMaxW, fp.w);
            cursorY += fp.h + gap;
        } else {
            if (lineIndex > 0 && lineIndex % stacksPerLine === 0) {
                cursorY += rowMaxH + gap;
                cursorX = rowStartX;
                rowMaxH = 0;
            }
            anchors.push({ x: cursorX, y: cursorY });
            rowMaxH = Math.max(rowMaxH, fp.h);
            cursorX += fp.w + gap;
        }
        lineIndex += 1;
    });
    return anchors;
}

export function computeStackBounds(rects) {
    if (!rects?.length) return { x: 0, y: 0, w: 0, h: 0 };
    const minX = Math.min(...rects.map((rect) => rect.x));
    const minY = Math.min(...rects.map((rect) => rect.y));
    const maxX = Math.max(...rects.map((rect) => rect.x + rect.w));
    const maxY = Math.max(...rects.map((rect) => rect.y + rect.h));
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function centerStackInRegion(relRects, region) {
    if (!relRects?.length || !region) return relRects || [];
    const stackW = Math.max(...relRects.map((rect) => rect.x + rect.w), 1);
    const stackH = Math.max(...relRects.map((rect) => rect.y + rect.h), 1);
    const baseX = region.x + Math.max(0, (region.w - stackW) / 2);
    const baseY = region.y + Math.max(0, (region.h - stackH) / 2);
    return relRects.map((rect) => ({
        ...rect,
        x: Math.round(baseX + rect.x),
        y: Math.round(baseY + rect.y)
    }));
}

export function computeCascadeStackRects(sizes, region, { zIndexBase = 0 } = {}) {
    const rel = computeStackRects(sizes, 0, 0, { zIndexBase });
    return centerStackInRegion(rel, region);
}

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
    startX,
    startY,
    regionW,
    viewportBottom,
    origin,
    edgePad,
    metrics = getGridMetrics()
} = {}) {
    const pad = edgePad ?? metrics.edgePad;
    const o = origin ?? metrics.origin;
    const margin = ALIGN_REGION_MARGIN;
    const minX = o + pad;
    const minRegionH = cellsToSpanH(MIN_REGION_ROWS, metrics);
    const x = (startX ?? minX) + margin;
    const y = startY + margin;
    const w = Math.max(1, (regionW ?? packW ?? metrics.canvasGridW) - margin * 2);
    const availableH = Math.max(0, (viewportBottom ?? minRegionH) - startY - pad - margin);
    const h = Math.max(minRegionH, availableH - margin);
    return { x, y, w, h };
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
    const gridW = cols * cellW + Math.max(0, cols - 1) * slotGap;
    const gridH = rows * cellH + Math.max(0, rows - 1) * slotGap;
    const originX = region.x + Math.max(0, (region.w - gridW) / 2);
    const originY = region.y + Math.max(0, (region.h - gridH) / 2);

    const rowCounts = new Map();
    slots.forEach((slot) => {
        rowCounts.set(slot.row, (rowCounts.get(slot.row) || 0) + 1);
    });

    return slots.map((slot) => {
        const rowCount = rowCounts.get(slot.row) || 1;
        const rowOffset = rowCount < cols
            ? ((cols - rowCount) * (cellW + slotGap)) / 2
            : 0;
        const x = originX + rowOffset + slot.col * (cellW + slotGap);
        const y = originY + slot.row * (cellH + slotGap);
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
