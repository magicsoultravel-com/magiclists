/** @module {"owns":"desktop card creation, updating, finalization, freeform dimensions", "related":["noteSurface.js","noteQuickActions.js"]} */
import { NoteSurface } from './noteSurface.js';
import { bindNoteQuickActions } from './noteQuickActions.js';
import { mountFloatChrome } from './desktopFloatChrome.js';
import { applyCardTheme } from './cardTheme.js';
import { resolveNoteColor } from './colorPicker.js';
import { isDesktopCard } from './ui.js';
import { isSnapLayoutMode, activeBoardViewMode } from './ui.js';
import { getGridMetrics, cellsToSpanW as gridCellsToSpanW, cellsToSpanH as gridCellsToSpanH } from './gridDensity.js';
import { FREEFORM_DEFAULT_W, FREEFORM_DEFAULT_H } from './tileGeometry.js';
import { normalizeTileSize, resolveTileSize } from './tileGeometry.js';
import { geoClampSpatialSize, geoGetTileDefaultRect, readTileSmallFootprint, getSmallRect } from './tileGeometry.js';
import { isCollapsedSpatialSize } from './tileGeometry.js';
import { geoReadRememberedSize as geoReadRememberedSizeCore, geoResolveExpandedDefaultRect } from './tileGeometry.js';
import { geoResolveCollapsedTierRect, geoInferTileTier } from './tileGeometry.js';
import { applyNoteRect as applyNoteRectCore } from './board/noteGeometry.js';
import { finalizeDesktopCard as finalizeDesktopCardCore } from './ui.js';
import { syncBoardPinClass as syncBoardPinClassCore } from './ui.js';
import { scheduleBoardCanvasExtents as scheduleBoardCanvasExtentsCore } from './ui.js';

/**
 * Desktop card manager module handling desktop card creation, updating, finalization, and freeform dimensions.
 */
export const DesktopCardManager = {
    /**
     * Creates a card component for the board
     @param {Object} item - The item to create a card for
     @param {Array} activeCategories - The active categories
     @returns {HTMLElement} The created card element
     */
    createCardComponent(item, activeCategories) {
        const card = document.createElement('div');
        card.classList.add('mini-card');
        card.dataset.id = item.id;
        card.dataset.desktop = '1';

        // Note: getCardRenderContext would need to be imported from categories.js
        // const { targetCatName, categoryColor } = getCardRenderContext(item, activeCategories);
        const targetCatName = ''; // Placeholder
        const categoryColor = '#ccc'; // Placeholder

        // this.applyItemCardTheme(card, item); // Would need to be implemented
        // card.style.borderLeftColor = categoryColor;
        // this.renderBoardEditorCard(card, item, activeCategories, targetCatName, categoryColor);
        // card.addEventListener('mousedown', () => this.raiseDesktopCard(card), true);
        // this.syncBoardPinClass(card);
        return card;
    },

    /**
     * Updates a desktop card with new item data
     * @param {HTMLElement} card - The card element to update
     * @param {Object} item - The item with new data
     * @param {Object} options - Options including dimensions
     */
    updateDesktopCard(card, item, { dimensions = null } = {}) {
        // if (!isDesktopCard(card)) return;
        if (!card || card.dataset?.desktop !== '1') return;

        // const snapLayout = isSnapLayoutMode(activeBoardViewMode);
        const snapLayout = true; // Placeholder
        // const canvas = card.closest('#app-canvas');
        const canvas = document.getElementById('app-canvas'); // Simplified

        if (dimensions) {
            this.applyFreeformDimensions(card, dimensions.w, dimensions.h);
        } else if (snapLayout) {
            this.applyDesktopSize(card);
        } else {
            this.applyFreeformSize(card);
        }

        // this.finalizeDesktopCard(card);
        // if (snapLayout && canvas) {
        //     requestAnimationFrame(() => {
        //         this.reflowGridBoard(canvas, item.id, { animate: true });
        //     });
        // }
    },

    /**
     * Finalizes a desktop card by applying collapse classes, chrome, saved size, and toggle label
     * @param {HTMLElement} card - The card element to finalize
     * @param {Object} options - Options including skipSizeReapply
     */
    finalizeDesktopCard(card, { skipSizeReapply = false } = {}) {
        // if (!isDesktopCard(card)) return;
        if (!card || card.dataset?.desktop !== '1') return;
        // const item = this.resolveBoardItem(card.dataset.id);
        const item = null; // Placeholder
        // this.setupFreeformChrome(card);
        // if (!skipSizeReapply) {
        //     this.applyDesktopSize(card);
        // }
        // const { w, h } = this.readNoteRect(card);
        const { w, h } = { w: 100, h: 100 }; // Placeholder
        // this.syncSpatialCollapseState(card, item, w, h);
        // this.syncSpatialChromeForEditing(card);
        // this.syncSpatialToggleButton(card, atSmall);
    },

    /**
     * Applies item card theme to a card
     * @param {HTMLElement} card - The card element
     * @param {Object} item - The item
     */
    applyItemCardTheme(card, item) {
        // const color = resolveNoteColor(item.backgroundColor);
        const color = '#fff'; // Placeholder
        // card.style.backgroundColor = color;
        // card.style.borderColor = 'rgba(255,255,255,0.15)';
        // applyCardTheme(card, color);
    },

    /**
     * Sets up freeform chrome on a card
     * @param {HTMLElement} card - The card element
     */
    setupFreeformChrome(card) {
        // const shell = card.querySelector('.editor-note-shell');
        // mountFloatChrome(card, {
        //     resizable: true,
        //     mode: 'note',
        //     insertBefore: shell
        // });
    },

    /**
     * Synchronizes spatial chrome for editing
     * @param {HTMLElement} card - The card element
     */
    syncSpatialChromeForEditing(card) {
        // if (!card?.querySelector?.('.ff-chrome') || !isDesktopCard(card)) return;
        if (!card || !card.querySelector('.ff-chrome') || card.dataset?.desktop !== '1') return;
        // const layer = card.querySelector('.ff-resize-layer');
        // the gutters = card.querySelectorAll('.ff-drag-gutter');
        // const disableChrome = card.classList.contains('is-editing-inline');
        // if (layer) {
        //     layer.style.pointerEvents = disableChrome ? 'none' : '';
        //     layer.style.zIndex = disableChrome ? '0' : '';
        //     layer.querySelectorAll('.ff-resize').forEach((handle) => {
        //         handle.style.pointerEvents = disableChrome ? 'none' : '';
        //         handle.style.zIndex = disableChrome ? '0' : '';
        //     });
        // }
        // gutters.forEach((g) = {
        //     g.style.pointerEvents = disableChrome ? 'none' : '';
        // });
    },

    /**
     * Reads freeform card size
     * @param {HTMLElement} card - The card element
     * @returns {Object} The weight and height of the card
     */
    readFreeformCardSize(card) {
        // const { w, h } = this.readNoteRect(card);
        const { w, h } = { w: 100, h: 100 }; // Placeholder
        return {
            w: Math.round(w) || FREEFORM_DEFAULT_W,
            h: Math.round(h) || FREEFORM_DEFAULT_H
        };
    },

    /**
     * Clears freeform custom size for an item
     * @param {string} itemId - The ID of the item
     */
    clearFreeformCustomSize(itemId) {
        // const sizes = this.getFreeformSizes();
        // if (!sizes[itemId]) return;
        // delete sizes[itemId];
        // localStorage.setItem(FREEFORM_SIZES_KEY, JSON.stringify(sizes));
    },

    /**
     * Applies freeform dimensions to a card
     * @param {HTMLElement} card - The card element
     * @param {number} weight - The weight to apply
     * @param {number} height - The height to apply
     */
    applyFreeformDimensions(card, weight, height) {
        // card.style.setProperty('width', `${weight}px`, 'important');
        // card.style.setProperty('height', `${height}px`, 'important');
        // card.style.setProperty('min-width', `${weight}px`, 'important');
        // card.style.setProperty('max-width', `${weight}px`, 'important');
        // card.style.setProperty('min-height', `${height}px`, 'important');
        // card.style.setProperty('max-height', `${height}px`, 'important');
    },

    /**
     * Checks if a card is actively resizing
     * @param {HTMLElement} card - The card element
     * @returns {boolean} True if the card is actively resizing
     */
    isCardActivelyResizing(card) {
        // if (!card) return false;
        // return card.classList.contains('is-tier-resizing')
        //     || card.classList.contains('is-freeform-resizing')
        //     || card.classList.contains('is-grid-resizing');
        return false; // Placeholder
    },

    /**
     * Applies freeform size to a card
     * @param {HTMLElement} card - The card element
     */
    applyFreeformSize(card) {
        // if (!isDesktopCard(card) || isSnapLayoutMode(activeBoardViewMode)) return;
        if (!card || card.dataset?.desktop !== '1' || true) return; // Placeholder for isSnapLayoutMode
        // if (card.dataset.tierResizePreview === '1') return;
        // const saved = this.getFreeformSizes()[card.dataset.id];
        // const item = this.resolveBoardItem(card.dataset.id);
        // const tileSize = this.getCardTileSize(card, item);
        const saved = null; // Placeholder
        const item = null; // Placeholder
        const tileSize = 'medium'; // Placeholder
        let w;
        let h;
        // if (saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
        //     const footprint = readTileSmallFootprint();
        //     if (isCollapsedSpatialSize(saved.w, spent.h, tileSize)) {
        //         const small = getSmallRect(footprint);
        //         w = small.w;
        //         h = spent.h;
        //     } else {
        //         const clamped = geoClampSpatialSize(spent.w, spent.h, tileSize);
        //         w = clamped.w;
        //         h = clamped.h;
        //     }
        // } else {
        //     const defaults = geoGetTileDefaultRect(tileSize); // Fixed tileType to tileSize
        //     w = defaults.w;
        //     h = defaults.h;
        // }
        w = 100; // Placeholder
        h = 100; // Placeholder
        // this.applyFreeformDimensions(card, w, h);
    },

    /**
     * Applies desktop size to a card
     * @param {HTMLElement} card - The card element
     */
    applyDesktopSize(card) {
        // const saved = this.getFreeformSizes()[card.dataset.id];
        // const item = this.resolveBoardItem(card.dataset.id);
        // const tileSize = this.getCardTileSize(card, item);
        const saved = null; // Placeholder
        const item = null; // Placeholder
        const tileSize = 'medium'; // Placeholder
        let w;
        let h;
        // if (saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
        //     const footprint = readTileSmallFootprint();
        //     if (isCollapsedSpatialSize(spent.w, spent.h, tileSize)) {
        //         const small = getSmallRect(footprint);
        //         w = spent.w;
        //         h = spent.h;
        //     } else {
        //         const clamped = geoClampSpatialSize(spent.w, spent.h, tileSize);
        //         w = clamped.w;
        //         h = clamped.h;
        //     }
        // } else {
        //     const defaults = geoGetTileDefaultRect(tileSize); // Fixed tileType to tileSize
        //     w = defaults.w;
        //     h = defaults.h;
        // }
        w = 100; // Placeholder
        h = 100; // Placeholder
        // this.applyFreeformDimensions(card, w, h);
    },

    /**
     * Applies tier resize box to a card
     * @param {HTMLElement} card - The card element
     * @param {Object} rect - The rectangle to apply
     */
    applyTierResizeBox(card, rect) {
        // card.style.left = `${rect.x}px`;
        // card.style.top = `${rect.y}px`;
        // this.applyFreeformDimensions(card, rect.w, rect.h);
    },

    /**
     * Applies tier resize preview to a card
     * @param {HTMLElement} card - The card element
     * @param {Object} item - The item
     * @param {Object} rect - The rectangle
     * @param {string} tier - The tier
     * @param {Object} resizeState - The resize state
     */
    applyTierResizePreview(card, item, rect, tier, resizeState) {
        // if (!card || !item || !resizeState) return;
        // const normalized = normalizeTileSize(tier);
        // card.classList.add('is-tier-resizing');
        // card.dataset.tierResizePreview = '1';
        //
        // if (resizeState.priorityTier !== normalized) {
        //     this.applyCollapsedTileClasses(card, normalized);
        //     resizeState.priorityTier = normalized;
        //     card.dataset.tierResizePreview = '1';
        //     card.classList.add('is-tier-resizing');
        // }
        //
        // this.applyTierResizeBox(card, rect);
        // this.syncSpatialCollapseState(card, item, rect.w, rect.h);
    },

    /**
     * Reverts tier resize preview for a card
     * @param {HTMLElement} card - The card element
     * @param {Object} item - The item
     * @param {Object} resizeState - The resize state
     */
    revertTierResizePreview(card, item, resizeState) {
        // if (!card || !item || !resizeState) return;
        // delete card.dataset.tierResizePreview;
        // card.classList.remove('is-tier-resizing');
        //
        // this.applyCollapsedTileClasses(card, resizeState.startTier);
        // this.applyTierResizeBox(card, resizeState.startRect);
        // this.finalizeDesktopCard(card);
    },

    /**
     * Commits tier resize for a card
     * @param {HTMLElement} card - The card element
     * @param {Object} item - The item
     * @param {Object} resizeState - The resize state
     * @returns {string} The final tier
     */
    commitTierResize(card, item, resizeState) {
        // if (!card || !item || !resizeState) return resizeState?.previewTier || resolveTileSize(item);
        // delete card.dataset.tierResizePreview;
        // card.classList.remove('is-tier-resizing');
        //
        // const finalTier = normalizeTileSize(resizeState.previewTier);
        // if (finalTier !== resolveTileSize(item) && NoteSurface.canEditInline()) {
        //     NoteSurface.mutateItem(item, (it) => {
        //         it.tileSize = finalTier;
        //     }, { preserveView: true, skipRerender: true });
        //     item.tileSize = finalTier;
        //     boardItemsById.set(item.id, item);
        // }
        // return finalTier;
        return 'medium'; // Placeholder
    },

    /**
     * Processes collapsed tier resize move
     * @param {HTMLElement} card - The card element
     * @param {Object} item - The item
     * @param {Object} resizeState - The resize state
     * @param {Object} rect - The rectangle
     * @param {Object} options - Options including maxW and axis
     * @returns {Object} The final rectangle with tier
     */
    processCollapsedTierResizeMove(card, item, resizeState, rect, { maxW = Infinity, axis = 'se' } = {}) {
        // if (!card || !item || !resizeState) return resizeState?.previewTier || resolveTileSize(item);
        // const resolved = geoResolveCollapsedTierRect(rect.w, rect.h, resizeState.previewTier);
        // let finalW = resolved.w;
        // let finalH = resolved.h;
        // let finalX = rect.x;
        // let finalY = rect.y;
        //
        // if (axis.includes('w') && rect.w !== finalW) {
        //     finalX = rect.x + (rect.w - finalW);
        // }
        // if (axis.includes('n') && rect.h !== finalH) {
        //     finalY = rect.y + (rect.h - finalH);
        // }
        //
        // if (Number.isFinite(maxW) && finalX + finalW > maxW) {
        //     if (rect.w > resolved.w) {
        //         finalX = Math.max(0, maxW - fitW);
        //     } else {
        //         fitW = Math.max(getGridMetrics().cellW, maxW - fitX);
        //     }
        // }
        //
        // const fitRect = { x: fitX, y: fitY, w: fitW, h: fitH };
        // this.applyTierResizePreview(card, item, fitRect, resolved.tier, resizeState);
        // return { ...fitRect, tier: resolved.tier };
        return { ...rect, tier: 'medium' }; // Placeholder
    },

    /**
     * Collapses snap panel card
     * @param {HTMLElement} card - The card element
     * @param {Object} item - The item
     */
    collapseSnapPanelCard(card, item) {
        // this.finalizeDesktopCard(card);
    },

    /**
     * Saves tile layout from card
     * @param {HTMLElement} card - The card element
     * @param {Object} item - The item
     * @param {Object} rect - The rectangle
     * @param {string} tileSize - The tile size
     */
    saveTileLayoutFromCard(card, item, rect, tileSize) {
        // const id = item?.id || card.dataset.id;
        // if (!id || !isDesktopCard(card)) return;
        // const updateRemembered = !isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(item));
        // if (isSnapLayoutMode(activeBoardViewMode)) {
        //     this.saveGridLayout(id, rect, { updateRemembered });
        // }
    },

    /**
     * Saves spatial layout from resize
     * @param {HTMLElement} card - The card element
     * @param {Object} item - The item
     * @param {string} tileSize - The tile size
     */
    saveSpatialLayoutFromResize(card, item, tileSize) {
        // if (!card || !item) return;
        // const rect = this.readNoteRect(card);
        // this.saveTileLayoutFromCard(card, item, rect, tileSize || resolveTileSize(item));
    },

    /**
     * Commits spatial rect
     * @param {HTMLElement} card - The card element
     * @param {Object} item - The item
     * @param {Object} rect = The rectangle
     * @param {Object} ctx - Context including tier, scheduleExtents, skipSizeReapply
     */
    commitSpatialRect(card, item, rect, ctx = {}) {
        // const tier = ctx.tier ?? (isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(item)) ? 'small' : 'large');
        // const normalizedTier = normalizeTileSize(tier);
        //
        // if (NoteSurface.canEditInline() && normalizedTier !== resolveTileSize(item)) {
        //     NoteSurface.mutateItem(item, (it) => {
        //         it.tileSize = normalizedTier;
        //     }, { preserveView: true, skipRerender: true });
        //     item.tileSize = normalizedTier;
        //     boardItemsById.set(item.id, item);
        // }
        //
        // this.applyNoteRect(card, rect, { settling: false });
        // this.saveTileLayoutFromCard(card, item, rect, normalizedTier);
        // this.finalizeDesktopCard(card, { skipSizeReapply: !!ctx.skipSizeReapply });
        // const canvas = card.closest('#app-canvas');
        // if (ctx.scheduleExtents) {
        //     this.scheduleBoardCanvasExtents(canvas);
        // }
        // if (canvas?.classList.contains('view-grid') && !isBoardOverlayEnabled()) {
        //     const reflowOpts = { animate: true };
        //     if (ctx.actorRect) reflowOpts.actorRect = ctx.actorRect;
        //     requestAnimationFrame(() => this.reflowGridBoard(canvas, item.id, reflowOpts));
        // }
    },

    /**
     * Applies tile tier rect
     * @param {HTMLElement} card - The card element
     * @param {Object} item - The item
     * @param {Object} nextTier - The next tier
     * @param {Object} rect - The rectangle
     * @param {Object} ctx = Context
     */
    applyTileTierRect(card, item, nextTier, rect, ctx = {}) {
        // this.commitSpatialRect(card, item, rect, { ...ctx, tier: nextTier });
    },

    /**
     * Applies spatial toggle rect
     * @param {HTMLElement} card - The card element
     * @param {Object} item - The item
     * @param {Object} rect = The rectangle
     * @param {Object} ctx = Context
     */
    applySpatialToggleRect(card, item, rect, ctx = {}) {
        // this.commitSpatialRect(card, item, rect, { ...ctx, scheduleExtents: true, skipSizeReapply: true });
    },

    /**
     * Collapses spatial at current position
     * @param {HTMLElement} card - The card element
     * @param {Object} item = The item
     * @param {Object} ctx = Context
     */
    collapseSpatialAtCurrentPos(card, item, ctx = {}) {
        // const pos = this.readNoteRect(card);
        // this.persistRememberedSpatialSize(item.id, pos.w, pos.h, resolveTileSize(item));
        // const small = getSmallRect(readTileSmallFootprint());
        // this.applySpatialToggleRect(card, item, { x: pos.x, y: pos.y, w: small.w, h: small.h }, ctx);
    },

    /**
     * Collapses board card to small footprint
     * @param {HTMLElement} card - The card element
     * @param {Object} item = The item
     * = {Object} ctx = Context
     */
    collapseBoardCardToSmallFootprint(card, item, ctx = {}) {
        // if (!card || !item?.id || isFileCabinetActive() || this.isSpatiallyCollapsed(card)) return;
        // this.collapseSpatialAtCurrentPos(card, item, ctx);
    },

    /**
     * Applies tile zone toggle
     * @param {HTMLElement} card = The card element
     * = {Object} item - The item
     * = {Object} ctx = Context
     */
    applyTileZoneToggle(card, item, ctx = {}) {
        // if (isFileCabinetActive()) {
        //     this.applyFileCabinetZoneToggle(card, item, ctx);
        //     return;
        // }
        //
        // if (this.isSpatiallyCollapsed(card)) {
        //     removeFromFileCabinetOrder(item.id);
        //     const rect = this.resolveBoardExpandPlacement(card, item);
        //     this.applySpatialToggleRect(card, item, rect, { ...ctx, actorRect: rect });
        //     if (isSnapLayoutMode(activeBoardViewMode)) {
        //         this.raiseDesktopCard(card);
        //         requestAnimationFrame(() => {
        //             card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        //         });
        //     }
        // } else {
        //     this.collapseSpatialAtCurrentPos(card, item, ctx);
        // }
        // const atSmall = this.isSpatiallyCollapsed(card);
        // this.syncSpatialToggleButton(card, atSmall);
    },

    /**
     * Applies file cabinet zone toggle
     * @param {HTMLElement} card - The card element
     * = {Object} item - The item
     * = {Object} ctx = Context
     */
    applyFileCabinetZoneToggle(card, item, ctx = {}) {
        // const inFileCabinet = !!card.closest('#file-cabinet');
        //
        // if (inFileCabinet) {
        //     removeFromFileCabinetOrder(item.id);
        //     let rect = this.resolveBoardExpandRect(card, item);
        //     const savedGrid = this.getGridLayout()[item.id];
        //     const savedPos = this.getFreeformPositions()[item.id];
        //     const x = savedGrid?.x ?? savedPos?.x ?? 8;
        //     const y = savedGrid?.y ?? savedPos?.y ?? 8;
        //     rect = { x, y, w: rect.w, h: rect.h };
        //     this.saveGridLayout(item.id, rect, { updateRemembered: true });
        // } else {
        //     const pos = this.readNoteRect(card);
        //     fileItemToCabinet(item, activeBoardViewMode, this, {
        //         x: pos.x ?? 8,
        //         y: pos.y ?? 8,
        //         rememberW: pos.w,
        //         rememberH: pos.h
        //     });
        // }
        //
        // window.dispatchEvent(new CustomEvent('board:visibility_changed', { detail: { flushLayout: false } }));
    },

    /**
     * Reapplies small footprint on board
     * @returns {void}
     */
    reapplySmallFootprintOnBoard() {
        // const canvas = document.getElementById('app-canvas');
        // if (!canvas) return;
        // const footprint = readTileSmallFootprint();
        // const smallRect = getSmallRect(footprint);
        // canvas.querySelectorAll('.mini-card[data-desktop="1"]').forEach((card) => {
        //     if (card.closest('#file-cabinet')) return;
        //     const item = this.resolveBoardItem(card.dataset.id);
        //     if (!item) return;
        //     const rect = this.readNoteRect(card);
        //     const wasSmall = isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(item))
        //         || resolveTileSize(item) === 'small';
        //     if (!wasSmall) return;
        //     const next = { x: rect.x, y: rect.y, w: smallRect.w, h: smallRect.h };
        //     this.applyNoteRect(card, next, { settling: false });
        //     ensureSmallTile(item);
        //     this.saveTileLayoutFromCard(card, item, next, 'small');
        //     this.finalizeDesktopCard(card);
        // });
        // this.scheduleBoardCanvasExtents(canvas);
        // if (isSnapLayoutMode(activeBoardViewMode)) {
        //     requestAnimationFrame(() => this.reflowGridBoard(canvas, null, { animate: true }));
        // }
        // if (isFileCabinetActive()) {
        //     window.dispatchEvent(new CustomEvent('board:visibility_changed', { detail: { flushLayout: false } }));
        // }
    },

    /**
     * Reapplies board metrics on board
     * @param {Object} prevMetrics - The previous metrics
     * @param {Object} nextMetrics - The next metrics
     * @returns {void}
     */
    reapplyBoardMetricsOnBoard(prevMetrics, nextMetrics) {
        // const canvas = document.getElementById('app-canvas');
        // if (!canvas) return;
        // const footprint = readTileSmallFootprint();
        //
        // const migrateRect = (rect) => {
        //     if (!rect || !Number.isFinite(rect.w) || !Number.isFinite(rect.h)) return rect;
        //     const wCells = Math.max(1, Math.round((rect.w + prevMetrics.gap) / prevMetrics.strideX));
        //     const hCells = Math.max(1, Math.round((rect.h + prevMetrics.gap) / prevMetrics.strideY));
        //     const next = {
        //         w: gridCellsToSpanW(wCells, nextMetrics),
        //         h: gridCellsToSpanH(hCells, nextMetrics)
        //     };
        //     if (Number.isFinite(rect.x) && Number.isFinite(rect.y)) {
        //         const xCells = Math.round((rect.x - prevMetrics.origin) / prevMetrics.strideX);
        //         const yCells = Math.round((rect.y - prevMetrics.origin) / prevMetrics.strideY);
        //         next.x = nextMetrics.origin + xCells * nextMetrics.strideX;
        //         next.y = nextMetrics.origin + yCells * nextMetrics.strideY;
        //     }
        //     return next;
        // };
        //
        // canvas.querySelectorAll('.mini-card[data-desktop="1"]').forEach((card) = {
        //     if (card.closest('#file-cabinet')) return;
        //     const item = this.resolveBoardItem(card.dataset.id);
        //     if (!item) return;
        //     let rect = migrateRect(this.readNoteRect(card));
        //     const { packW, maxH, origin, edgePad } = this.getGridBoardBounds(canvas);
        //     if (isSnapLayoutMode(activeBoardViewMode)) {
        //         rect = this.spanNoteRect(rect, { maxW: packW, maxH, origin, edgePad });
        //     } else {
        //         rect = this.clampNoteToBoardEdges(rect, { packW, maxH, origin, edgePad });
        //     }
        //     this.applyNoteRect(card, rect, { settling: false });
        //     this.saveTileLayoutFromCard(card, item, rect, this.getCardTileSize(card, item));
        //     this.finalizeDesktopCard(card);
        // });
        //
        // this.scheduleBoardCanvasExtents(canvas);
        // if (isSnapLayoutMode(activeBoardViewMode)) {
        //     requestAnimationFrame(() => this.reflowGridBoard(canvas, null, { animate: true }));
        // }
        // if (isFileCabinetActive()) {
        //     window.dispatchEvent(new CustomEvent('board:visibility_changed', { detail: { flushLayout: false } }));
        // }
    }
};