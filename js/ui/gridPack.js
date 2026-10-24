/** @module {"owns":"the grid packer - expansion classification, item sizing, the deterministic zero-gap rect solver behind sort/reset, and the spatial sort both the packer and the legacy migration use; no DOM writes, no state","related":["ui.js","ui/spatial.js","ui/render.js"]} */
import { getLiveBoardBounds } from '../board/boardExtents.js';
import { GRID_LAYOUT_KEY, GRID_PINS_KEY } from '../board/layoutKeys.js';
import {
    findFirstCanvasSlot as findFirstCanvasSlotCore,
    rectsOverlap as rectsOverlapCore
} from '../board/noteGeometry.js';
import { BoardOperations } from '../boardOperations.js';
import { sortBoardItems } from '../boardSort.js';
import {
    getStoredItemSize,
    isFileCabinetActive,
    resetFileCabinetLayout,
    sortBoardLayoutWithFileCabinet
} from '../fileCabinet.js';
import { cellsToSpanW as gridCellsToSpanW, getGridMetrics } from '../gridDensity.js';
import { readTileSmallFootprint } from '../tileFootprint.js';
import {
    CANVAS_LAYOUT_ORIGIN,
    getLargeDefaultRect,
    getSmallRect,
    isCollapsedSpatialSize,
    resolveTileSize
} from '../tileGeometry.js';
import { normalizeViewMode } from '../viewSession.js';

/** How much of the available space the aligned expanded block should cover (tunable). */
const ALIGN_SIZE_FACTOR = 0.8;

export function sortItemsSpatially(items, getRect) {
    return [...items].sort((a, b) => {
        const ra = getRect(a) || { x: 0, y: 0 };
        const rb = getRect(b) || { x: 0, y: 0 };
        const ay = Number.isFinite(ra.y) ? ra.y : 0;
        const ax = Number.isFinite(ra.x) ? ra.x : 0;
        const by = Number.isFinite(rb.y) ? rb.y : 0;
        const bx = Number.isFinite(rb.x) ? rb.x : 0;
        return ay - by || ax - bx;
    });
}

export function isItemLayoutExpanded(ui, item, mode) {
    if (!item?.id) return false;
    const tileSize = resolveTileSize(item);
    const saved = getStoredItemSize(item.id, mode, ui);
    if (!saved || !Number.isFinite(saved.w) || !Number.isFinite(saved.h)) return false;
    return !isCollapsedSpatialSize(saved.w, saved.h, tileSize);
}

export function resolveSortItemSize(ui, item, mode, isExpanded, alignedSize = null) {
    const tileSize = resolveTileSize(item);
    const saved = getStoredItemSize(item.id, mode, ui);
    if (isExpanded) {
        if (alignedSize) return { w: alignedSize.w, h: alignedSize.h };
        if (saved && Number.isFinite(saved.w) && !isCollapsedSpatialSize(saved.w, saved.h, tileSize)) {
            return { w: saved.w, h: saved.h };
        }
        const target = ui.resolveRememberedSpatialSize(saved, item);
        return { w: target.w, h: target.h };
    }
    if (saved && Number.isFinite(saved.w) && isCollapsedSpatialSize(saved.w, saved.h, tileSize)) {
        const small = getSmallRect(readTileSmallFootprint());
        return { w: small.w, h: small.h };
    }
    const small = getSmallRect(readTileSmallFootprint());
    return { w: small.w, h: small.h };
}

/**
 * Compute one uniform size for every expanded note so the expanded block
 * fills the page as a symmetric grid. The number of columns adapts to how
 * many expanded notes there are (2 → split screen, 4 → 2×2, 9 → 3×3, …)
 * while each note stays above a usable minimum width and fits packW.
 * Returns a cell-aligned size (plus the column count) so the grid can be
 * placed deterministically without grid-snap drift.
 */
export function resolveAlignedExpandedSize(ui, packW, count, minNoteW = getLargeDefaultRect().w) {
    const metrics = getGridMetrics();
    const gap = metrics.gap;
    const n = Math.max(1, Number(count) || 1);
    const availW = Math.max(metrics.columnMinInnerW, packW * ALIGN_SIZE_FACTOR);

    let cols = Math.ceil(Math.sqrt(n));
    const maxCols = Math.max(1, Math.floor((availW + gap) / (minNoteW + gap)));
    cols = Math.max(1, Math.min(cols, maxCols));

    const maxSpan = Math.floor((availW - (cols - 1) * gap) / cols);
    const cellsPer = Math.max(1, Math.floor((maxSpan + gap) / (metrics.cellW + gap)));
    const w = gridCellsToSpanW(cellsPer);
    const large = getLargeDefaultRect();
    const h = Math.max(metrics.cellS, Math.round((w * large.h) / large.w));
    return { w, h, cols };
}

export function partitionCanvasItemsByExpansion(ui, items, mode) {
    const collapsed = [];
    const expanded = [];
    (items || []).forEach((item) => {
        if (ui.isItemLayoutExpanded(item, mode)) expanded.push(item);
        else collapsed.push(item);
    });
    return { collapsed, expanded };
}

export function packGridBoard(ui, canvas, collapsedItems, expandedItems, {
    pinnedIds = new Set(),
    layoutMode = 'grid',
    direction = 'horizontal',
    persistOnly = false,
    animate = true,
    save = true,
    itemsById = null,
    alignSize = false
} = {}) {
    const { origin, packW, maxH, edgePad } = ui.getLiveBoardBounds(canvas);
    const dir = direction === 'vertical' ? 'vertical' : 'horizontal';
    const placed = [];
    const layout = new Map();
    const snapBounds = { maxW: packW, maxH, origin, edgePad };
    const resolveItem = (id) => (itemsById?.get(id) ?? ui.resolveBoardItem(id));

    // When "Align size" is on, every expanded note shares one uniform size
    // computed to fill the page as a symmetric grid (see resolveAlignedExpandedSize).
    const alignedExpandedSize = alignSize
        ? ui.resolveAlignedExpandedSize(packW, expandedItems.length)
        : null;
    const expandedSizeFor = (item, isExp) => ui.resolveSortItemSize(item, layoutMode, isExp, alignedExpandedSize);

    pinnedIds.forEach((id) => {
        const card = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(id)}"]`);
        const saved = ui.getGridLayout()[id];
        if (!saved || !Number.isFinite(saved.x)) return;
        const item = resolveItem(id);
        const isExp = ui.isItemLayoutExpanded(item, layoutMode);
        const rect = ui.snapNoteRect(
            card
                ? ui.gridBoardRectForCard(card, saved, isExp)
                : { ...saved, ...expandedSizeFor(item, isExp) },
            snapBounds
        );
        layout.set(id, rect);
        placed.push({ ...rect });
    });

    const unpinnedCollapsed = collapsedItems.filter((item) => !pinnedIds.has(item.id));
    const unpinnedExpanded = expandedItems.filter((item) => !pinnedIds.has(item.id));

    // Unified layout: collapsed notes form a tight zero-gap grid, then the
    // expanded notes fill their own block after them (never covering them).
    // With Align size ON, expanded notes share one uniform size (alignedSize);
    // otherwise each keeps its real {w,h}.
    const collapsedSizeForSet = unpinnedCollapsed.map((item) => ({ id: item.id }));
    const expandedSizeForSet = unpinnedExpanded.map((item) => ({
        id: item.id,
        ...expandedSizeFor(item, ui.isItemLayoutExpanded(item, layoutMode))
    }));

    const packedBoardRects = ui.packBoardGridRects(collapsedSizeForSet, expandedSizeForSet, {
        alignedSize: alignSize && alignedExpandedSize ? alignedExpandedSize : null,
        placed,
        origin,
        packW,
        maxH,
        edgePad,
        direction: dir
    });
    packedBoardRects.forEach(({ id, rect }) => layout.set(id, rect));

    if (persistOnly) {
        if (!save) return layout;
        const layoutStore = ui.getGridLayout();
        layout.forEach((rect, id) => {
            const item = resolveItem(id);
            const isExp = item && ui.isItemLayoutExpanded(item, layoutMode);
            const freeSaved = layoutMode === 'freeform' ? ui.getFreeformSizes()[id] : null;
            const gridPrev = layoutStore[id] || {};
            layoutStore[id] = ui.mergeSpatialLayoutEntry(
                gridPrev,
                rect,
                resolveTileSize(item),
                {
                    updateRemembered: isExp,
                    rememberedW: freeSaved?.rememberedW ?? gridPrev.rememberedW,
                    rememberedH: freeSaved?.rememberedH ?? gridPrev.rememberedH
                }
            );
        });
        localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(layoutStore));
        return layout;
    }

    ui.applyGridBoardLayout(canvas, layout, { animate, save });
    if (unpinnedExpanded.length) {
        unpinnedExpanded.forEach((item) => {
            const rect = layout.get(item.id);
            if (rect) ui.saveGridLayout(item.id, rect, { updateRemembered: true });
        });
    }
    ui.updateGridScrollPolicy(canvas, { forcing: false });
    return layout;
}

/**
 * Unified board-layout packer used whenever the board is re-arranged by
 * sort/reset. Collapsed notes are placed on a strict zero-gap compact grid
 * (adjacent tiles, rows and columns) so they read as one solid block in
 * both horizontal and vertical sort directions. Expanded notes are placed
 * in their own block after the collapsed set (below for horizontal, right
 * for vertical) so they never cover collapsed notes:
 *  - alignedSize provided → every expanded note gets that uniform size.
 *  - alignedSize null      → each expanded note keeps its real {w,h}.
 * Positions are computed directly on tile strides (no grid-snap drift).
 *
 * @param {Array} collapsedItems
 * @param {Array<{id:string,w:number,h:number}>} expandedItems
 * @param {{w:number,h:number,cols:number}|null} alignedSize
 * @param {{placed?:Array<{x,y,w,h}>, origin?:number, packW:number, maxH?:number, edgePad?:number, direction?:string}} opts
 * @returns {Array<{id:string, rect:{x,y,w,h}}>}
 */
export function packBoardGridRects(ui, collapsedItems, expandedItems, {
    alignedSize = null,
    placed = [],
    origin = CANVAS_LAYOUT_ORIGIN,
    packW,
    maxH = Infinity,
    edgePad = 0,
    direction = 'horizontal'
} = {}) {
    const metrics = getGridMetrics();
    const gap = metrics.gap;
    const startX = origin + edgePad;
    const startY = origin + edgePad;
    const small = getSmallRect(readTileSmallFootprint());
    const rects = [];
    const collapsedRects = [];
    // Pinned rects are the only obstacles for the collapsed grid: collapsed
    // tiles sit edge-to-edge (zero gap) and would falsely self-overlap under
    // rectsOverlap, so they are never checked against each other.
    const pinnedRects = placed.slice();
    const allPlaced = [...pinnedRects];

    // --- collapsed: strict zero-gap compact grid -------------------------
    const maxCols = Math.max(1, Math.floor(packW / small.w));
    let col = 0;
    let row = 0;
    (collapsedItems || []).forEach((item) => {
        let guard = 0;
        while (guard < 100000) {
            const candidate = {
                x: startX + col * small.w,
                y: startY + row * small.h,
                w: small.w,
                h: small.h
            };
            if (!pinnedRects.some((p) => rectsOverlapCore(candidate, p, gap))) {
                collapsedRects.push(candidate);
                rects.push({ id: item.id, rect: candidate });
                allPlaced.push({ ...candidate });
                col += 1;
                break;
            }
            col += 1;
            if (col >= maxCols) {
                col = 0;
                row += 1;
            }
            guard += 1;
        }
    });

    const collapsedBottom = collapsedRects.length
        ? collapsedRects.reduce((m, r) => Math.max(m, r.y + r.h), startY)
        : startY;
    const collapsedRight = collapsedRects.length
        ? collapsedRects.reduce((m, r) => Math.max(m, r.x + r.w), startX)
        : startX;
    const dir = direction === 'vertical' ? 'vertical' : 'horizontal';

    // Expanded block always starts below the collapsed set (left-aligned)
    // regardless of sort direction — direction only affects internal ordering.
    // The block is given a small inset for visual separation from the borders.
    const exStartX = startX + edgePad;
    const exStartY = collapsedBottom + gap + edgePad * 2;

    // --- expanded: own block after the collapsed set ----------------------
    if (alignedSize) {
        const { w, h } = alignedSize;
        const colStride = w + gap;
        const rowStride = h + gap;
        // Cap columns at the computed grid width (which already fits ~80% of
        // the available space) rather than letting it fill packW edge-to-edge.
        const exMaxCols = Math.max(1, alignedSize.cols);
        let ec = 0;
        let er = 0;
        (expandedItems || []).forEach((item) => {
            let guard = 0;
            while (guard < 20000) {
                const candidate = {
                    x: exStartX + ec * colStride,
                    y: exStartY + er * rowStride,
                    w,
                    h
                };
                if (candidate.x + candidate.w <= startX + packW + 1
                    && !allPlaced.some((p) => rectsOverlapCore(candidate, p, gap))) {
                    rects.push({ id: item.id, rect: candidate });
                    allPlaced.push({ ...candidate });
                    ec += 1;
                    if (ec >= exMaxCols) {
                        ec = 0;
                        er += 1;
                    }
                    break;
                }
                ec += 1;
                if (ec >= exMaxCols) {
                    ec = 0;
                    er += 1;
                }
                guard += 1;
            }
        });
    } else {
        (expandedItems || []).forEach((item) => {
            const slot = findFirstCanvasSlotCore(item.w, item.h, allPlaced, packW + origin * 2, {
                origin,
                edgePad,
                xMin: exStartX,
                yMin: exStartY,
                maxH,
                direction: dir
            });
            rects.push({ id: item.id, rect: slot });
            allPlaced.push({ ...slot });
        });
    }

    return rects;
}

export function packSortGridBoard(ui, canvas, collapsedItems, expandedItems, sortPrefs, pinnedIds) {
    const direction = sortPrefs.direction === 'vertical' ? 'vertical' : 'horizontal';
    ui.packGridBoard(canvas, collapsedItems, expandedItems, {
        pinnedIds,
        layoutMode: 'grid',
        direction,
        persistOnly: false,
        animate: true,
        save: true,
        alignSize: sortPrefs.alignSize === true
    });
}

export function sortBoardLayout(ui, viewMode, items, sortPrefs, { fileCabinetActive } = {}) {
    const visibleItems = BoardOperations.getVisibleItems(items || []);
    if (!visibleItems.length) return;

    const mode = normalizeViewMode(viewMode);
    const canvas = document.getElementById('app-canvas');
    if (!canvas) return;

    const canvasItems = sortBoardLayoutWithFileCabinet(visibleItems, mode, sortPrefs, ui);

    if (!canvasItems.length) {
        window.dispatchEvent(new CustomEvent('board:visibility_changed', {
            detail: { flushLayout: false, skipGridReflow: true }
        }));
        return;
    }

    const { collapsed, expanded } = ui.partitionCanvasItemsByExpansion(canvasItems, mode);
    const sortedCollapsed = sortBoardItems(collapsed, sortPrefs);
    const sortedExpanded = sortBoardItems(expanded, sortPrefs);
    const pinnedIds = new Set(ui.getBoardPins());

    ui.packSortGridBoard(canvas, sortedCollapsed, sortedExpanded, sortPrefs, pinnedIds);

    window.dispatchEvent(new CustomEvent('board:visibility_changed', {
        detail: { flushLayout: false, skipGridReflow: true }
    }));
}

export function resetBoardLayout(ui, sortBy, items, { fileCabinetActive } = {}) {
    const visibleItems = BoardOperations.getVisibleItems(items || []);
    const mode = normalizeViewMode(sortBy);

    const boardItems = visibleItems;

    const fcActive = fileCabinetActive ?? isFileCabinetActive();

    if (fcActive) {
        resetFileCabinetLayout(sortBy, items, ui);
        return;
    }

    if (mode === 'grid') {
        try {
            localStorage.removeItem(GRID_PINS_KEY);
        } catch {
            /* ignore */
        }
    }

    const canvas = document.getElementById('app-canvas');
    ui.repackBoardLayoutStorage(mode, boardItems, canvas);
    window.dispatchEvent(new CustomEvent('board:visibility_changed', {
        detail: { flushLayout: false, skipGridReflow: true }
    }));
}
