/** @module {"owns":"grid note geometry, push layout, tile bounds", "related":["board/gridEngine.js","tileGeometry.js"]} */
import { getGridMetrics } from '../gridDensity.js';
import { readTileSmallFootprint } from '../tileFootprint.js';
import {
    FREEFORM_DEFAULT_W,
    FREEFORM_DEFAULT_H,
    FREEFORM_MIN_W,
    FREEFORM_MIN_H,
    CANVAS_LAYOUT_ORIGIN,
    cellsToSpanW as geoCellsToSpanW,
    cellsToSpanH as geoCellsToSpanH,
    spanToCellsW as geoSpanToCellsW,
    spanToCellsH as geoSpanToCellsH,
    getSmallRect,
    isCollapsedSpatialSize,
    getPackStrideYForRect
} from '../tileGeometry.js';

function isDesktopCard(card) {
    return card?.dataset?.desktop === '1';
}

export function rectsOverlap(a, b, gap) {
    const g = gap ?? getGridMetrics().gap;
    return !(
        a.x + a.w + g <= b.x
        || b.x + b.w + g <= a.x
        || a.y + a.h + g <= b.y
        || b.y + b.h + g <= a.y
    );
}

export function gridColumnStride(w, h, metrics = getGridMetrics()) {
    if (isCollapsedSpatialSize(w, h)) {
        return w + metrics.gap;
    }
    const wCells = Math.max(1, geoSpanToCellsW(w));
    return geoCellsToSpanW(wCells) + metrics.gap;
}

export function gridRowStride(w, h, metrics = getGridMetrics()) {
    if (isCollapsedSpatialSize(w, h)) {
        return h + metrics.gap;
    }
    const hCells = Math.max(1, geoSpanToCellsH(h));
    return geoCellsToSpanH(hCells) + metrics.gap;
}

export function snapPackCoord(value, origin, pad, packStride) {
    const anchor = origin + pad;
    const rel = Math.max(0, value - anchor);
    const step = packStride || getGridMetrics().strideX;
    return anchor + Math.round(rel / step) * step;
}

export function snapGridCoord(value, stride) {
    const step = stride ?? getGridMetrics().strideX;
    return Math.max(0, Math.round(value / step) * step);
}

export function snapCanvasCoord(value, origin = CANVAS_LAYOUT_ORIGIN, stride) {
    const step = stride ?? getGridMetrics().strideX;
    return origin + snapGridCoord(Math.max(0, value - origin), step);
}

export function clampNoteToBoardEdges(rect, { packW, maxH, origin, edgePad } = {}) {
    const metrics = getGridMetrics();
    const o = origin ?? metrics.origin;
    const pad = edgePad ?? metrics.edgePad;
    const minX = o + pad;
    const minY = o + pad;
    const rightLimit = o + pad + (packW ?? 0);
    const bottomLimit = (maxH ?? Infinity) - pad;
    let { x, y, w, h } = rect;
    x = Math.max(minX, x);
    y = Math.max(minY, y);
    if (Number.isFinite(rightLimit) && x + w > rightLimit) {
        x = Math.max(minX, rightLimit - w);
    }
    if (Number.isFinite(bottomLimit) && y + h > bottomLimit) {
        y = Math.max(minY, bottomLimit - h);
    }
    return { x, y, w, h };
}

export function clampManualNoteRect(rect, { maxW = Infinity, maxH = Infinity } = {}) {
    let w = Math.max(FREEFORM_MIN_W, Math.round(rect.w));
    let h = Math.max(FREEFORM_MIN_H, Math.round(rect.h));
    if (maxW < Infinity) w = Math.min(w, maxW);
    if (maxH < Infinity) h = Math.min(h, maxH);
    let x = Math.max(0, Math.round(rect.x));
    let y = Math.max(0, Math.round(rect.y));
    if (maxW < Infinity && x + w > maxW) x = Math.max(0, maxW - w);
    if (maxH < Infinity && y + h > maxH) y = Math.max(0, maxH - h);
    return { x, y, w, h };
}

export function snapNotePosition(rect, { maxW = Infinity, maxH = Infinity, origin = CANVAS_LAYOUT_ORIGIN, edgePad } = {}) {
    const metrics = getGridMetrics();
    const pad = edgePad ?? metrics.edgePad;
    const w = Math.max(FREEFORM_MIN_W, Math.round(rect.w));
    const h = Math.max(FREEFORM_MIN_H, Math.round(rect.h));
    const atSmall = isCollapsedSpatialSize(w, h);
    let x;
    let y;
    if (atSmall) {
        const xPack = gridColumnStride(w, h, metrics);
        const yPack = gridRowStride(w, h, metrics);
        x = snapPackCoord(rect.x, origin, pad, xPack);
        y = snapPackCoord(rect.y, origin, pad, yPack);
    } else {
        x = snapGridCoord(rect.x, metrics.placementStrideX);
        y = snapGridCoord(rect.y, metrics.placementStrideY);
    }
    const minX = origin + pad;
    const minY = origin + pad;
    x = Math.max(minX, x);
    y = Math.max(minY, y);
    if (maxW < Infinity) {
        const rightLimit = origin + pad + maxW;
        if (x + w > rightLimit + 1) {
            x = Math.max(minX, rightLimit - w);
        }
    }
    if (maxH < Infinity) {
        const bottomLimit = maxH - pad;
        if (y + h > bottomLimit + 1) {
            y = Math.max(minY, bottomLimit - h);
        }
    }
    return { x, y, w, h };
}

export function snapNoteRect(rect, { maxW = Infinity, maxH = Infinity, origin = CANVAS_LAYOUT_ORIGIN, edgePad } = {}) {
    const metrics = getGridMetrics();
    const pad = edgePad ?? metrics.edgePad;
    const footprint = readTileSmallFootprint();
    if (isCollapsedSpatialSize(rect.w, rect.h)) {
        const small = getSmallRect(footprint);
        const xPack = gridColumnStride(small.w, small.h, metrics);
        const yPack = gridRowStride(small.w, small.h, metrics);
        const snapped = {
            x: snapPackCoord(rect.x, origin, pad, xPack),
            y: snapPackCoord(rect.y, origin, pad, yPack),
            w: small.w,
            h: small.h
        };
        return snapNotePosition(snapped, { maxW, maxH, origin, edgePad: pad });
    }

    const wCells = Math.max(1, geoSpanToCellsW(rect.w));
    const hCells = Math.max(1, geoSpanToCellsH(rect.h));
    let w = geoCellsToSpanW(wCells);
    let h = geoCellsToSpanH(hCells);
    if (maxW < Infinity) {
        const maxCells = Math.max(1, geoSpanToCellsW(maxW));
        w = geoCellsToSpanW(Math.min(wCells, maxCells));
    }
    if (maxH < Infinity) {
        const maxCells = Math.max(1, geoSpanToCellsH(maxH));
        h = geoCellsToSpanH(Math.min(hCells, maxCells));
    }
    const snapped = {
        x: snapGridCoord(rect.x, metrics.placementStrideX),
        y: snapGridCoord(rect.y, metrics.placementStrideY),
        w: Math.max(FREEFORM_MIN_W, w),
        h: Math.max(FREEFORM_MIN_H, h)
    };
    return snapNotePosition(snapped, { maxW, maxH, origin, edgePad: pad });
}

export function findFirstCanvasSlot(w, h, placed, canvasW, { origin = CANVAS_LAYOUT_ORIGIN, edgePad, yMin } = {}) {
    const metrics = getGridMetrics();
    const pad = edgePad ?? metrics.edgePad;
    const packW = Math.max(metrics.canvasGridW, canvasW - origin * 2 - pad * 2);
    const xOrigin = origin + pad;
    const yOrigin = Math.max(origin + pad, yMin ?? origin + pad);
    const rowStride = gridColumnStride(w, h, metrics);
    const yStride = getPackStrideYForRect(w, h);
    let y = yOrigin;
    while (true) {
        let x = xOrigin;
        while (x + w <= origin + pad + packW + 1) {
            const candidate = snapNoteRect(
                { x, y, w, h },
                { maxW: packW, origin, edgePad: pad }
            );
            if (!placed.some((p) => rectsOverlap(candidate, p, metrics.gap))) {
                return candidate;
            }
            x += rowStride;
        }
        y += yStride;
    }
}

export function findFirstCanvasSlotVertical(w, h, placed, canvasW, { origin = CANVAS_LAYOUT_ORIGIN, edgePad, xMin, yMin, maxH } = {}) {
    const metrics = getGridMetrics();
    const pad = edgePad ?? metrics.edgePad;
    const packW = Math.max(metrics.canvasGridW, canvasW - origin * 2 - pad * 2);
    const xOrigin = Math.max(origin + pad, xMin ?? origin + pad);
    const yOrigin = Math.max(origin + pad, yMin ?? origin + pad);
    const colStride = gridColumnStride(w, h, metrics);
    const yStride = getPackStrideYForRect(w, h);
    const bottomLimit = (maxH ?? origin + metrics.strideY * 40) + 1;
    let x = xOrigin;
    let guard = 0;
    while (guard < 800) {
        let y = yOrigin;
        while (y + h <= bottomLimit) {
            const candidate = snapNoteRect(
                { x, y, w, h },
                { maxW: packW, origin, edgePad: pad, maxH }
            );
            if (!placed.some((p) => rectsOverlap(candidate, p, metrics.gap))) {
                return candidate;
            }
            y += yStride;
        }
        x += colStride;
        guard += 1;
    }
    return { x: xOrigin, y: yOrigin, w, h };
}

export function readNoteRect(card, { normalizeCollapsed = false, getTileSize = null, isActivelyResizing = false } = {}) {
    const styleW = parseFloat(card.style.width);
    const styleH = parseFloat(card.style.height);
    const hasInlineW = Number.isFinite(styleW) && styleW > 0;
    const hasInlineH = Number.isFinite(styleH) && styleH > 0;
    const offsetW = card.offsetWidth || 0;
    const offsetH = card.offsetHeight || 0;

    let w = hasInlineW ? styleW : (offsetW || FREEFORM_DEFAULT_W);
    let h = hasInlineH ? styleH : (offsetH || FREEFORM_DEFAULT_H);

    if (normalizeCollapsed && isDesktopCard(card) && !isActivelyResizing && getTileSize) {
        const tileSize = getTileSize(card);
        if (isCollapsedSpatialSize(w, h, tileSize)) {
            const small = getSmallRect(readTileSmallFootprint());
            w = small.w;
            h = small.h;
        }
    }

    return {
        x: parseFloat(card.style.left) || 0,
        y: parseFloat(card.style.top) || 0,
        w,
        h
    };
}

export function applyNoteRect(card, rect, { settling = false, applyDimensions = null } = {}) {
    card.style.position = 'absolute';
    card.style.left = `${rect.x}px`;
    card.style.top = `${rect.y}px`;
    if (applyDimensions) {
        applyDimensions(card, rect.w, rect.h);
    } else {
        card.style.width = `${rect.w}px`;
        card.style.height = `${rect.h}px`;
    }
    card.classList.toggle('layout-settling', settling);
}

export function findNearestGridSlot(preferred, w, h, placed, { packW, origin = CANVAS_LAYOUT_ORIGIN, maxH = Infinity, edgePad } = {}) {
    const metrics = getGridMetrics();
    const pad = edgePad ?? metrics.edgePad;
    const bounds = { maxW: packW, maxH };
    const snapped = snapNoteRect({ x: preferred.x, y: preferred.y, w, h }, { ...bounds, origin, edgePad: pad });
    if (!placed.some((p) => rectsOverlap(snapped, p))) return snapped;

    const prefX = snapped.x;
    const prefY = snapped.y;
    const candidates = [];
    const minX = origin + pad;
    const minY = origin + pad;
    const maxRight = origin + pad + packW;
    const maxBottom = maxH - pad;

    const atSmall = isCollapsedSpatialSize(w, h);
    const xStep = atSmall ? gridColumnStride(w, h, metrics) : metrics.placementStrideX;
    const yStep = atSmall ? getPackStrideYForRect(w, h) : metrics.placementStrideY;

    for (let ring = 0; ring <= 32; ring++) {
        for (let dy = -ring; dy <= ring; dy++) {
            for (let dx = -ring; dx <= ring; dx++) {
                if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
                const x = prefX + dx * xStep;
                const y = prefY + dy * yStep;
                const c = snapNoteRect({ x, y, w, h }, { ...bounds, origin, edgePad: pad });
                if (c.x < minX - 1) continue;
                if (c.x + c.w > maxRight + 1) continue;
                if (c.y < minY - 1) continue;
                if (c.y + c.h > maxBottom + 1) continue;
                candidates.push({ rect: c, dist: Math.abs(c.x - prefX) + Math.abs(c.y - prefY) });
            }
        }
    }
    candidates.sort((a, b) => a.dist - b.dist || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    for (const { rect } of candidates) {
        if (!placed.some((p) => rectsOverlap(rect, p))) return rect;
    }
    return snapped;
}

export function pushGridCardRect(rect, placed, { packW, origin, maxH, edgePad }) {
    const metrics = getGridMetrics();
    const pad = edgePad ?? metrics.edgePad;
    const snapRect = (r) => snapNoteRect(r, { maxW: packW, maxH, origin, edgePad: pad });
    const colStride = gridColumnStride(rect.w, rect.h, metrics);
    let candidate = snapRect({ ...rect, x: rect.x + colStride });
    if (candidate.x + candidate.w <= origin + pad + packW + 1
        && !placed.some((p) => rectsOverlap(candidate, p))) {
        return candidate;
    }
    const blocker = placed.find((p) => rectsOverlap(rect, p));
    if (blocker) {
        candidate = snapRect({
            x: rect.x,
            y: blocker.y - rect.h - metrics.gap,
            w: rect.w,
            h: rect.h
        });
        if (candidate.y >= origin + pad - 1
            && !placed.some((p) => rectsOverlap(candidate, p))) {
            return candidate;
        }
        candidate = snapRect({
            x: rect.x,
            y: blocker.y + blocker.h + metrics.gap,
            w: rect.w,
            h: rect.h
        });
        if (!placed.some((p) => rectsOverlap(candidate, p))) return candidate;
    }
    const canvasW = packW + (origin ?? CANVAS_LAYOUT_ORIGIN) * 2;
    const nearSlot = findFirstCanvasSlot(
        rect.w,
        rect.h,
        placed,
        canvasW,
        { origin, edgePad: pad, yMin: Math.max(origin + pad, rect.y) }
    );
    if (!placed.some((p) => rectsOverlap(nearSlot, p))) return nearSlot;
    return findNearestGridSlot(rect, rect.w, rect.h, placed, { packW, origin, maxH, edgePad: pad });
}

export function resolveGridPushLayout({ cardEntries, actorId, actorRect, pinnedIds, packW, origin, maxH, edgePad }) {
    const pad = edgePad ?? getGridMetrics().edgePad;
    const layout = new Map();
    const placed = [];
    const snapOpts = { packW, origin, maxH, edgePad: pad };
    const snapBounds = { maxW: packW, maxH, origin, edgePad: pad };

    cardEntries.forEach(({ id, rect }) => {
        if (!id || !pinnedIds.has(id)) return;
        const snapped = snapNoteRect(rect, snapBounds);
        layout.set(id, snapped);
        placed.push({ ...snapped });
    });

    if (actorId && actorRect) {
        let snapped = snapNoteRect(actorRect, snapBounds);
        if (placed.some((p) => rectsOverlap(snapped, p))) {
            snapped = findNearestGridSlot(actorRect, actorRect.w, actorRect.h, placed, snapOpts);
        }
        layout.set(actorId, snapped);
        placed.push({ ...snapped });
    }

    const others = cardEntries
        .filter(({ id }) => id && id !== actorId && !pinnedIds.has(id))
        .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);

    others.forEach(({ id, rect }) => {
        let snapped = snapNoteRect(rect, snapBounds);
        if (placed.some((p) => rectsOverlap(snapped, p))) {
            snapped = pushGridCardRect(snapped, placed, snapOpts);
        }
        layout.set(id, snapped);
        placed.push({ ...snapped });
    });

    return layout;
}
