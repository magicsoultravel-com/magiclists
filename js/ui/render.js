/** @module {"owns":"the board render pass - canvas prep, view state, item partitioning, layout and card creation, plus the post-render finalize; the only ui module that paints","related":["ui.js","ui/spatial.js","ui/gridPack.js"]} */
import { DESKTOP_BOARD_PANE_CLASS } from '../board/boardExtents.js';
import { computeBoardLayout } from '../board/gridEngine.js';
import { findFirstCanvasSlot as findFirstCanvasSlotCore } from '../board/noteGeometry.js';
import { BoardOperations } from '../boardOperations.js';
import { isBoardOverlayEnabled } from '../boardOverlay.js';
import { readStoredCategories } from '../categories.js';
import { isDesktopCard } from '../desktopManager.js';
import { isFileCabinetActive, prepareBoardItems as prepareBoardItemsCore } from '../fileCabinet.js';
import { CARD_ICONS } from '../icons.js';
import { NotePopoutBridge } from '../notePopoutBridge.js';
import { NoteSurface } from '../noteSurface.js';
import { createCardComponent } from '../noteSurfaceHtml.js';
import { getTileDefaultRect as geoGetTileDefaultRect, resolveTileSize } from '../tileGeometry.js';
import { clearBoardItems, replaceBoardItemsMap } from '../ui/boardState.js';

/**
 * The item partition belongs to the file cabinet - the facade used to carry a
 * byte-identical copy of it. Only the receiver differs: the cabinet code takes
 * the UI object as its fifth positional argument, this session takes it first.
 */
export function prepareBoardItems(ui, visibleItems, fileCabinetActive, resolvedMode, activeCategories, allItems = null) {
    return prepareBoardItemsCore(visibleItems, fileCabinetActive, resolvedMode, activeCategories, ui, allItems);
}

export function render(ui, canvas, items, viewMode, hiddenCategories = [], renderOptions = {}) {
    if (!canvas) return;
    // Clear stale map references before destroying DOM elements
    clearBoardItems();
    ui.prepareCanvas(canvas);
     
    const safeItems = Array.isArray(items) ? items : [];
    const visibleItems = BoardOperations.getVisibleItems(safeItems);
    replaceBoardItemsMap(new Map(visibleItems.map((item) => [item.id, item])));

    const activeCategories = ui.getActiveCategories(hiddenCategories);
     
    const { resolvedMode, fileCabinetActive } = ui.getViewState();
    ui.applyCanvasClasses(canvas, fileCabinetActive);

    // Always refresh FC for the active desktop before empty-state.
    // FC lives outside #app-canvas; skipping this left the previous desktop's tabs.
    const { boardItems } = ui.prepareBoardItems(
        visibleItems,
        fileCabinetActive,
        resolvedMode,
        activeCategories,
        safeItems
    );

    if (boardItems.length === 0) {
        ui.renderEmptyState(canvas, fileCabinetActive, visibleItems, safeItems);
        return;
    }

    const { boardPane } = ui.layoutBoard(canvas, boardItems, activeCategories);
    ui.finalizeRender(canvas, boardPane, renderOptions);
}

export function prepareCanvas(ui, canvas) {
    // Clean up document-level event listeners from checklist drag operations
    // before wiping the DOM to prevent memory leaks and orphaned handlers
    canvas.querySelectorAll('[data-checklistdrag-bound]').forEach((root) => {
        if (root._checklistDragData) {
            const { onMove, onUp } = root._checklistDragData;
            if (onMove) document.removeEventListener('pointermove', onMove);
            if (onUp) {
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
            }
            document.body.classList.remove('is-checklist-dragging');
            delete root._checklistDragData;
        }
    });
    canvas.innerHTML = '';
}

export function getActiveCategories(ui, hiddenCategories) {
    let activeCategories = readStoredCategories();
    return activeCategories.filter(cat => !hiddenCategories.includes(cat.name));
}

export function getViewState(ui) {
    const resolvedMode = 'grid';
    const snapLayout = true;
    const fileCabinetActive = isFileCabinetActive();
    const activeBoardViewMode = 'grid';
    return { resolvedMode, snapLayout, fileCabinetActive, activeBoardViewMode };
}

export function applyCanvasClasses(ui, canvas, fileCabinetActive) {
    canvas.className = 'view-grid';
    if (fileCabinetActive) canvas.classList.add('file-cabinet-bottom');
    delete canvas.dataset.focusActive;
}

export function renderEmptyState(ui, canvas, fileCabinetActive, visibleItems, safeItems) {
    if (fileCabinetActive && visibleItems.length > 0) {
        return;
    }
    const hiddenCount = safeItems.length - BoardOperations.getVisibleItems(safeItems).length;
    if (safeItems.length > 0 && hiddenCount === safeItems.length) {
        canvas.innerHTML = `<div class="system-status-msg">Add new note</div>`;
    } else {
        canvas.innerHTML = `<div class="system-status-msg">Workspace clean. Click "+ New" to commit an entity.</div>`;
    }
}

export function layoutBoard(ui, canvas, boardItems, activeCategories) {
    const bounds = ui.getGridBoardBounds(canvas);
    const boardPane = document.createElement('div');
    boardPane.className = DESKTOP_BOARD_PANE_CLASS;
    canvas.appendChild(boardPane);

    // Compute layout using pure function
    const { layout, placed, placedById } = computeBoardLayout(ui, boardItems, bounds, {
        getLayout: () => ui.getGridLayout(),
        isExpanded: (id) => ui.isSavedLayoutExpanded(id),
        resolveSpatialSize: (card, item) => ui.resolveRememberedSpatialSize(card, item),
        getTileDefaultRect: geoGetTileDefaultRect,
        resolveTileSize,
        findSlot: findFirstCanvasSlotCore,
        snapRect: (rect, opts) => ui.snapNoteRect(
            ui.gridBoardRectForCard(null, rect, ui.isSavedLayoutExpanded(opts.itemId), opts.itemId),
            opts
        ),
        clampRect: (rect) => ui.preserveSavedBoardRect(rect)
    });

    // Apply layout to DOM — look up by id, never by list index.
    // `placed` is spatially sorted; `boardItems` is not, so zipping them
    // would swap every card the moment the item list order diverged
    // (e.g. dragging a note in from the File Cabinet).
    boardItems.forEach((item, index) => {
        const card = createCardComponent(ui, item, activeCategories);
        const rect = placedById.get(item.id) ?? placed[index];
        const saved = layout[item.id];

        ui.applyNoteRect(card, rect, { settling: false });
        if (!saved) {
            ui.saveGridLayout(item.id, rect);
        }

        card.removeAttribute('draggable');
        ui.finalizeDesktopCard(card);
        ui.initDesktopCardStack(card, index);
        ui.syncBoardPinClass(card);
        boardPane.appendChild(card);
    });

    return { layout, placed, boardPane };
}

export function renderCards(ui, boardItems, activeCategories, layout, placed, boardPane) {
    // This is handled in layoutBoard now
}

export function finalizeRender(ui, canvas, boardPane, renderOptions) {
    ui.updateBoardCanvasExtents(canvas);
    // Cards are already placed at their saved positions by layoutBoard.
    // Do NOT run the push-resolution reflow here: with actorId=null it
    // re-packs every card and re-saves, clobbering the user's saved
    // positions on every reload. Only update scroll policy (non-destructive).
    if (!renderOptions.skipGridReflow && !isBoardOverlayEnabled()) {
        ui.updateGridScrollPolicy(canvas, { forcing: false });
    }
}

export function buildCardActionsHtml(ui, item, isExpanded = false, options = {}) {
    return NoteSurface.buildNoteQuickActionsHtml(item, {
        surface: 'board',
        isExpanded,
        calHidden: BoardOperations.isHiddenFromCalendar(item),
        poppedOut: NotePopoutBridge.isPoppedOut(item?.id),
        ...options
    });
}

export function syncCalendarButtonUI(ui, item, btn) {
    if (!btn || !item) return;
    const hidden = BoardOperations.isHiddenFromCalendar(item);
    btn.innerHTML = CARD_ICONS.calendar;
    const title = hidden
        ? 'Hidden from calendar — click to show'
        : 'Shown on calendar — click to hide';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.classList.toggle('is-off', hidden);
    btn.classList.toggle('is-on', !hidden);
}

export function getCardActionsOptions(ui, card) {
    const hasSession = !!localStorage.getItem('admin_token');
    const spatial = isDesktopCard(card);
    const opts = {
        pinned: ui.isBoardPinned(card?.dataset?.id),
        showDrag: hasSession && spatial
    };
    if (spatial && card) {
        opts.spatialTile = true;
        const item = ui.resolveBoardItem(card.dataset.id);
        let { w, h } = ui.readNoteRect(card);
        opts.tileSize = ui.getCardTileSize(card, item);
        if (!(w > 0 && h > 0)) {
            const saved = ui.getSavedLayoutRect(card, item);
            w = saved?.w ?? 0;
            h = saved?.h ?? 0;
        }
        opts.tileW = w;
        opts.tileH = h;
    }
    return opts;
}

export function syncBoardPinClass(ui, card) {
    if (!card?.dataset?.id) return;
    card.classList.toggle('is-board-pinned', ui.isBoardPinned(card.dataset.id));
}
