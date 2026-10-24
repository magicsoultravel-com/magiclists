/** @module {"owns":"file cabinet item transfers - filing a board note into a drawer, expanding a drawer note back onto the board, and moving a note between categories", "related":["fileCabinet.js","fileCabinet/order.js","noteSurface.js","uiTransitions.js"]} */
import { getItemCategoryName } from '../focusFilter.js';
import { NoteSurface } from '../noteSurface.js';
import { beginFcExpandTransition } from '../uiTransitions.js';
import {
    getFileCabinetOrder,
    saveFileCabinetOrder,
    removeFromFileCabinetOrder,
    getFileCabinetFiledCategories,
    saveFileCabinetFiledCategories,
    isFileCabinetCategoryFiled,
    fileItemToCabinet
} from './order.js';
export function moveItemBetweenCategories({ itemId, fromCategory, toCategory, toIndex, item, UI }) {
    if (!itemId) return false;
    const fromCat = fromCategory || 'Uncategorized';
    const toCat = toCategory || 'Uncategorized';
    const order = getFileCabinetOrder();

    if (order[fromCat]) {
        order[fromCat] = order[fromCat].filter((id) => id !== itemId);
        if (order[fromCat].length === 0) delete order[fromCat];
    }

    if (!order[toCat]) order[toCat] = [];
    const clampedIndex = Math.max(0, Math.min(toIndex, order[toCat].length));
    order[toCat].splice(clampedIndex, 0, itemId);
    saveFileCabinetOrder(order);

    if (fromCat !== toCat && item && UI) {
        const beforeItem = NoteSurface.snapshotItem(item);
        // Mutate live item so immediate re-renders / reconcile see the new category.
        item.categories = toCat === 'Uncategorized' ? [] : [toCat];
        NoteSurface.emitItemMutation(item, { preserveView: true, beforeItem, skipRerender: true });
        return true;
    }
    return fromCat !== toCat;
}

export function clientToCanvasBoardPoint(canvas, clientX, clientY) {
    if (!canvas) return { x: 8, y: 8 };
    const zoom = parseFloat(canvas.dataset.desktopZoom);
    const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const rect = canvas.getBoundingClientRect();
    return {
        x: (clientX - rect.left) / scale + canvas.scrollLeft,
        y: (clientY - rect.top) / scale + canvas.scrollTop
    };
}

export function captureClientRect(el) {
    if (!el?.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    if (!Number.isFinite(r.width) || r.width <= 0) return null;
    return { left: r.left, top: r.top, width: r.width, height: r.height, x: r.x, y: r.y };
}

export function dispatchBoardVisibility({ flushLayout = false, transition = null } = {}) {
    // Always bump fcGen (Smooth on or off) so post-expand bento push can cancel safely.
    if (transition?.kind === 'fc-expand' && transition.itemId) {
        beginFcExpandTransition(transition.itemId);
    }
    window.dispatchEvent(new CustomEvent('board:visibility_changed', {
        detail: { flushLayout, ...(transition ? { transition } : {}) }
    }));
}

/**
 * Expand a filed note onto the board at drop coords (or remembered position).
 * Preserves item.categories.
 * @param {{ silent?: boolean }} [opts] - When silent, skip board:visibility_changed (for bulk).
 */
export function expandFileCabinetItemToBoard({ item, dropX, dropY, UI, card = null, silent = false, sourceRect = null }) {
    if (!item?.id || !UI) return false;
    const fromRect = sourceRect || (!silent ? captureClientRect(card) : null);
    removeFromFileCabinetOrder(item.id);

    const canvas = document.getElementById('app-canvas');
    let sizeRect;
    if (card) {
        sizeRect = UI.resolveBoardExpandRect(card, item);
    } else {
        const saved = UI.getGridLayout()[item.id];
        const remembered = UI.resolveRememberedSpatialSize(saved, item);
        sizeRect = { x: 8, y: 8, w: remembered.w, h: remembered.h };
    }

    if (canvas && Number.isFinite(dropX) && Number.isFinite(dropY)) {
        const point = clientToCanvasBoardPoint(canvas, dropX, dropY);
        let placed = {
            x: Math.max(8, point.x - sizeRect.w / 2),
            y: Math.max(8, point.y - sizeRect.h / 2),
            w: sizeRect.w,
            h: sizeRect.h
        };
        const bounds = UI.getGridBoardBounds(canvas);
        placed = UI.snapNotePosition(placed, {
            maxW: bounds.packW,
            maxH: bounds.maxH,
            origin: bounds.origin,
            edgePad: bounds.edgePad
        });
        UI.saveGridLayout(item.id, placed, { updateRemembered: true });
    } else {
        const savedGrid = UI.getGridLayout()[item.id];
        const savedPos = UI.getFreeformPositions()[item.id];
        const x = savedGrid?.x ?? savedPos?.x ?? 8;
        const y = savedGrid?.y ?? savedPos?.y ?? 8;
        UI.saveGridLayout(item.id, { x, y, w: sizeRect.w, h: sizeRect.h }, { updateRemembered: true });
    }

    if (!silent) {
        const transition = fromRect
            ? { kind: 'fc-expand', itemId: item.id, sourceRect: fromRect }
            : null;
        dispatchBoardVisibility({ flushLayout: false, transition });
    }
    return true;
}

/**
 * Expand every filed note in a category onto the board (remembered positions/sizes).
 * Clears fold state for the category. Fires one board:visibility_changed.
 */
export function expandFileCabinetCategoryToBoard(categoryName, UI) {
    if (!UI) return false;
    const cat = categoryName || 'Uncategorized';
    const ids = [...(getFileCabinetOrder()[cat] || [])];
    if (!ids.length) return false;

    ids.forEach((id) => {
        expandFileCabinetItemToBoard({ item: { id }, UI, silent: true });
    });

    if (isFileCabinetCategoryFiled(cat)) {
        const filed = getFileCabinetFiledCategories().filter((c) => c !== cat);
        saveFileCabinetFiledCategories(filed);
    }

    window.dispatchEvent(new CustomEvent('board:visibility_changed', { detail: { flushLayout: false } }));
    return true;
}

/**
 * File a board note into the cabinet. Optionally switch category on drop.
 * Updates live item.categories synchronously before visibility render so reconcile
 * does not rewrite order back to the old category.
 */
export function fileBoardItemToCabinet({
    item,
    UI,
    card = null,
    targetCategory = null,
    insertIndex = null
} = {}) {
    if (!item?.id || !UI) return false;
    const rect = card ? UI.readNoteRect(card) : { x: 8, y: 8, w: 0, h: 0 };
    const fromCat = getItemCategoryName(item);
    const toCat = targetCategory || fromCat;

    if (toCat !== fromCat) {
        const beforeItem = NoteSurface.snapshotItem(item);
        item.categories = toCat === 'Uncategorized' ? [] : [toCat];
        NoteSurface.emitItemMutation(item, { preserveView: true, beforeItem, skipRerender: true });
    }

    fileItemToCabinet(item, UI.getActiveBoardViewMode?.() || UI.activeBoardViewMode || 'grid', UI, {
        x: rect.x ?? 8,
        y: rect.y ?? 8,
        rememberW: rect.w,
        rememberH: rect.h
    });

    if (Number.isFinite(insertIndex)) {
        const order = getFileCabinetOrder();
        const list = [...(order[toCat] || [])];
        const fromIdx = list.indexOf(item.id);
        if (fromIdx >= 0) {
            list.splice(fromIdx, 1);
            const clamped = Math.max(0, Math.min(insertIndex, list.length));
            list.splice(clamped, 0, item.id);
            order[toCat] = list;
            saveFileCabinetOrder(order);
        }
    }

    window.dispatchEvent(new CustomEvent('board:visibility_changed', { detail: { flushLayout: false } }));
    return true;
}
