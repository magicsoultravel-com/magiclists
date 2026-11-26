/** @module {"owns":"the grid packer - expansion classification, item sizing, the deterministic narrow-gutter rect solver behind sort/reset, and the spatial sort both the packer and the legacy migration use; no DOM writes, no state","related":["ui.js","ui/spatial.js","ui/render.js"]} */

import { GRID_LAYOUT_KEY, GRID_PINS_KEY } from '../board/layoutKeys.js';
import { DesktopManager } from '../desktopManager.js';
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

/**
 * Row budget used when no page height can be measured (vertical sort without a
 * live viewport). Matches the "40 strides" convention findFirstCanvasSlot uses.
 */
const FALLBACK_PAGE_ROWS = 40;

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
    const { origin, packW, maxH, edgePad, viewportH } = ui.getLiveBoardBounds(canvas);
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

    const activeDesktop = DesktopManager.getActiveDesktop();
    pinnedIds.forEach((id) => {
        const card = canvas.querySelector(`.mini-card[data-desktop="${activeDesktop}"][data-id="${CSS.escape(id)}"]`);
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

    // Unified layout: collapsed notes form a narrow-gutter grid, then the
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
        direction: dir,
        // Vertical sorts fill a column down to the visible page bottom before
        // starting the next one; this is what makes Vertical differ from
        // Horizontal on a board of collapsed notes.
        columnH: viewportH ?? null
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
 * sort/reset. Collapsed notes are placed on a compact grid separated by a
 * narrow gutter (`tileGap`, defaults to the board gap) so they read as one
 * block of tiles instead of a single fused slab.
 *
 * `direction` decides how that block fills the page:
 *  - horizontal → row-major: fill a row left→right, then wrap to the next row.
 *  - vertical   → column-major: fill a column top→bottom down to `columnH`,
 *                 then start the next column; once the columns fill the page the
 *                 block continues on a new page below, so vertical never spills
 *                 past the right edge.
 *
 * Page geometry — `columnH` is the page bottom edge, not a free height: every
 * position is absolute from the canvas top, so y = 0 is the page top and callers
 * pass the measured viewport height unchanged (getLiveBoardBounds().viewportH),
 * which is that same bottom edge. Rows start at startY = origin + edgePad, i.e.
 * inside the page, so the count is floor((columnH - startY + gap) / rowStride):
 * one subtraction for the padding above the first row, one addition of `gap`
 * because the last row needs no trailing gutter. That count is tight — the last
 * row ends exactly on `columnH` when it fits and no row ever crosses it.
 * Subtracting `startY` twice would waste a row; dropping it (using
 * floor((columnH + gap) / rowStride)) would push the last row below the page.
 *
 * Expanded notes always go in their own block *below* the collapsed set (both
 * directions) so they never cover collapsed notes; `direction` only orders the
 * tiles inside each block:
 *  - alignedSize provided → every expanded note gets that uniform size.
 *  - alignedSize null      → each expanded note keeps its real {w,h}.
 * Positions are computed directly on tile strides (no grid-snap drift).
 *
 * @param {Array<{id:string}>} collapsedItems
 * @param {Array<{id:string,w:number,h:number}>} expandedItems
 * @param {{w:number,h:number,cols:number}|null} alignedSize
 * @param {{
 *   placed?: Array<{x,y,w,h}>,
 *   origin?: number,
 *   packW: number,
 *   maxH?: number,
 *   edgePad?: number,
 *   direction?: 'horizontal'|'vertical',
 *   columnH?: number|null,
 *   tileGap?: number|null
 * }} opts
 * @returns {Array<{id:string, rect:{x,y,w,h}}>}
 */
export function packBoardGridRects(ui, collapsedItems, expandedItems, {
    alignedSize = null,
    placed = [],
    origin = CANVAS_LAYOUT_ORIGIN,
    packW,
    maxH = Infinity,
    edgePad = 0,
    direction = 'horizontal',
    columnH = null,
    tileGap = null
} = {}) {
    const metrics = getGridMetrics();
    // Narrow gutter between tiles: the board's own gap token, so the collapsed
    // grid is not a fused slab and stays consistent with the expanded block.
    const gap = Number.isFinite(tileGap) ? Math.max(0, tileGap) : metrics.gap;
    const startX = origin + edgePad;
    const startY = origin + edgePad;
    const small = getSmallRect(readTileSmallFootprint());
    const rects = [];
    const collapsedRects = [];
    // Pinned rects are the only obstacles for the collapsed grid: tiles are
    // placed on a flow cursor and never checked against each other.
    const pinnedRects = placed.slice();
    const allPlaced = [...pinnedRects];
    const dir = direction === 'vertical' ? 'vertical' : 'horizontal';

    const colStride = small.w + gap;
    const rowStride = small.h + gap;
    // Fit n tiles + (n-1) gutters inside packW: n*w + (n-1)*gap <= packW.
    const pageW = Number.isFinite(packW) && packW > 0 ? packW : small.w;
    const maxCols = Math.max(1, Math.floor((pageW + gap) / colStride));
    // Vertical sorts stop a column at the page bottom. `columnH` is that bottom
    // edge in layout px (y = 0 is the canvas top, so it equals the measured
    // viewport height rather than the free space below the padding); maxH is the
    // hard content bound and only serves as a fallback.
    const pageH = [columnH, maxH]
        .find((value) => Number.isFinite(value) && value > startY) ?? null;
    // A row r fits iff startY + r * rowStride + small.h <= pageH; solving for r
    // and adding `gap` (no gutter after the last row) gives the tight count.
    const maxRows = pageH != null
        ? Math.max(1, Math.floor((pageH - startY + gap) / rowStride))
        : FALLBACK_PAGE_ROWS;

    // One cursor for both directions: pos() is the next cell, advance() walks
    // the flow order (row-major when horizontal, column-major when vertical).
    let col = 0;
    let row = 0;
    let band = 0;
    const pos = () => ({
        x: startX + col * colStride,
        y: startY + (band * maxRows + row) * rowStride
    });
    const advance = () => {
        if (dir === 'vertical') {
            row += 1;
            if (row < maxRows) return pos();
            row = 0;
            col += 1;
            if (col < maxCols) return pos();
            col = 0;
            band += 1;
            return pos();
        }
        col += 1;
        if (col < maxCols) return pos();
        col = 0;
        row += 1;
        return pos();
    };
    // Cells to probe before declaring a page blocked by pins: one full page
    // plus room for the pins themselves. The note is still placed (next page).
    const probeLimit = Math.max(
        64,
        maxCols * Math.min(maxRows, FALLBACK_PAGE_ROWS) + pinnedRects.length * 2 + 8
    );

    // --- collapsed: cell flow with wrap ----------------------------------
    (collapsedItems || []).forEach((item) => {
        let probe = 0;
        while (probe < probeLimit) {
            const candidate = { ...pos(), w: small.w, h: small.h };
            if (!pinnedRects.some((p) => rectsOverlapCore(candidate, p, gap))) {
                collapsedRects.push(candidate);
                rects.push({ id: item.id, rect: candidate });
                allPlaced.push({ ...candidate });
                advance();
                return;
            }
            advance();
            probe += 1;
        }
        // A whole page is blocked by pinned notes: never drop a note — land it
        // on the next page and keep going.
        const fallback = { ...pos(), w: small.w, h: small.h };
        collapsedRects.push(fallback);
        rects.push({ id: item.id, rect: fallback });
        allPlaced.push({ ...fallback });
        advance();
    });

    const collapsedBottom = collapsedRects.length
        ? collapsedRects.reduce((m, r) => Math.max(m, r.y + r.h), startY)
        : startY;

    // Expanded block always starts below the collapsed set (left-aligned)
    // regardless of sort direction — direction only affects internal ordering.
    // The block is given a small inset for visual separation from the borders.
    const exStartX = startX + edgePad;
    const exStartY = collapsedBottom + gap + edgePad * 2;

    // --- expanded: own block after the collapsed set ----------------------
    if (alignedSize) {
        const { w, h } = alignedSize;
        const exColStride = w + gap;
        const exRowStride = h + gap;
        // Cap columns at the computed grid width (which already fits ~80% of
        // the available space) rather than letting it fill packW edge-to-edge.
        const exMaxCols = Math.max(1, alignedSize.cols);
        let ec = 0;
        let er = 0;
        (expandedItems || []).forEach((item) => {
            let probe = 0;
            while (probe < probeLimit) {
                const candidate = {
                    x: exStartX + ec * exColStride,
                    y: exStartY + er * exRowStride,
                    w,
                    h
                };
                ec += 1;
                if (ec >= exMaxCols) {
                    ec = 0;
                    er += 1;
                }
                if (candidate.x + candidate.w <= startX + pageW + 1
                    && !allPlaced.some((p) => rectsOverlapCore(candidate, p, gap))) {
                    rects.push({ id: item.id, rect: candidate });
                    allPlaced.push({ ...candidate });
                    return;
                }
                probe += 1;
            }
        });
    } else {
        (expandedItems || []).forEach((item) => {
            const slot = findFirstCanvasSlotCore(item.w, item.h, allPlaced, pageW + origin * 2, {
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
