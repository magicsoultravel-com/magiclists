/** @module {"owns":"file cabinet drawer ordering and filing decisions - which note sits in which drawer, at which position, and when a note counts as filed", "related":["fileCabinet.js","tileGeometry.js","boardSort.js","notePackage.js"]} */
import { getItemCategoryName } from '../focusFilter.js';
import { sortBoardItems } from '../boardSort.js';
import {
    isCollapsedSpatialSize,
    getLabelRect,
    getTileDefaultRect,
    resolveTileSize
} from '../tileGeometry.js';

export const FILE_CABINET_ORDER_KEY = 'matrix_file_cabinet_order';
export const FILE_CABINET_FILED_CATEGORIES_KEY = 'matrix_file_cabinet_filed_categories';
export const FILE_CABINET_CATEGORY_ORDER_KEY = 'matrix_file_cabinet_category_order';
export const FILE_CABINET_EMPTY_SHELVES_COLLAPSED_KEY = 'matrix_file_cabinet_empty_shelves_collapsed';

export function getFileCabinetOrder() {
    try {
        const raw = localStorage.getItem(FILE_CABINET_ORDER_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

export function saveFileCabinetOrder(order) {
    try {
        localStorage.setItem(FILE_CABINET_ORDER_KEY, JSON.stringify(order || {}));
    } catch {
        /* ignore */
    }
}

export function removeFromFileCabinetOrder(itemId) {
    if (!itemId) return;
    const order = getFileCabinetOrder();
    let changed = false;
    Object.keys(order).forEach((cat) => {
        const next = (order[cat] || []).filter((id) => id !== itemId);
        if (next.length !== (order[cat] || []).length) {
            order[cat] = next;
            changed = true;
        }
        if (order[cat]?.length === 0) delete order[cat];
    });
    if (changed) saveFileCabinetOrder(order);
}

export function addToFileCabinetOrder(category, itemId) {
    if (!itemId) return;
    const cat = category || 'Uncategorized';
    const order = getFileCabinetOrder();
    // Drop the id from the other drawers on this same snapshot. Calling
    // removeFromFileCabinetOrder() here instead would work on a second snapshot
    // whose save is then overwritten by this one, leaving the note listed in
    // both the old and the new drawer. The target drawer is left alone so
    // re-filing into the same drawer keeps the note's position.
    Object.keys(order).forEach((name) => {
        if (name === cat || !Array.isArray(order[name]) || !order[name].includes(itemId)) return;
        order[name] = order[name].filter((id) => id !== itemId);
        if (order[name].length === 0) delete order[name];
    });
    if (!order[cat]) order[cat] = [];
    if (!order[cat].includes(itemId)) order[cat].push(itemId);
    saveFileCabinetOrder(order);
}

export function reorderInCategory(category, fromIndex, toIndex) {
    const cat = category || 'Uncategorized';
    const order = getFileCabinetOrder();
    const list = [...(order[cat] || [])];
    if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return;
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    order[cat] = list;
    saveFileCabinetOrder(order);
}

export function getFileCabinetFiledCategories() {
    try {
        const raw = localStorage.getItem(FILE_CABINET_FILED_CATEGORIES_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((c) => typeof c === 'string' && c.trim()) : [];
    } catch {
        return [];
    }
}

export function saveFileCabinetFiledCategories(categories) {
    try {
        localStorage.setItem(
            FILE_CABINET_FILED_CATEGORIES_KEY,
            JSON.stringify(Array.isArray(categories) ? categories : [])
        );
    } catch {
        /* ignore */
    }
}

export function isFileCabinetEmptyShelvesCollapsed() {
    try {
        const raw = localStorage.getItem(FILE_CABINET_EMPTY_SHELVES_COLLAPSED_KEY);
        if (raw == null) return true; // default collapsed
        return raw === 'true';
    } catch {
        return true;
    }
}

export function setFileCabinetEmptyShelvesCollapsed(collapsed) {
    try {
        localStorage.setItem(FILE_CABINET_EMPTY_SHELVES_COLLAPSED_KEY, collapsed ? 'true' : 'false');
    } catch {
        /* ignore */
    }
}

export function toggleFileCabinetEmptyShelvesCollapsed() {
    const next = !isFileCabinetEmptyShelvesCollapsed();
    setFileCabinetEmptyShelvesCollapsed(next);
    return next;
}

export function isFileCabinetCategoryFiled(categoryName) {
    return getFileCabinetFiledCategories().includes(categoryName || 'Uncategorized');
}

export function toggleFileCabinetCategoryFiled(categoryName) {
    const cat = categoryName || 'Uncategorized';
    const filed = getFileCabinetFiledCategories();
    const idx = filed.indexOf(cat);
    if (idx >= 0) {
        filed.splice(idx, 1);
    } else {
        filed.push(cat);
    }
    saveFileCabinetFiledCategories(filed);
    return idx < 0;
}

export function getFileCabinetCategoryOrder() {
    try {
        const raw = localStorage.getItem(FILE_CABINET_CATEGORY_ORDER_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((c) => typeof c === 'string' && c.trim()) : [];
    } catch {
        return [];
    }
}

export function saveFileCabinetCategoryOrder(categories) {
    try {
        localStorage.setItem(
            FILE_CABINET_CATEGORY_ORDER_KEY,
            JSON.stringify(Array.isArray(categories) ? categories : [])
        );
    } catch {
        /* ignore */
    }
}

export function appendFileCabinetCategoryOrder(name) {
    const cat = String(name || '').trim();
    if (!cat) return;
    const order = getFileCabinetCategoryOrder();
    if (order.includes(cat)) return;
    saveFileCabinetCategoryOrder([...order, cat]);
}

export function removeCategoryFromFileCabinetLayout(name) {
    const cat = String(name || '').trim();
    if (!cat) return;
    saveFileCabinetFiledCategories(getFileCabinetFiledCategories().filter((c) => c !== cat));
    saveFileCabinetCategoryOrder(getFileCabinetCategoryOrder().filter((c) => c !== cat));
}

/** Apply saved FC-only category order; append any new categories not yet saved. */
export function applyFileCabinetCategoryOrder(categories) {
    const cats = Array.isArray(categories) ? [...categories] : [];
    const saved = getFileCabinetCategoryOrder();
    if (!saved.length) return cats;
    const remaining = new Set(cats);
    const ordered = [];
    saved.forEach((name) => {
        if (!remaining.has(name)) return;
        ordered.push(name);
        remaining.delete(name);
    });
    cats.forEach((name) => {
        if (remaining.has(name)) ordered.push(name);
    });
    return ordered;
}

export function persistFileCabinetCategoryOrderFromDom(mount) {
    if (!mount) return;
    const visible = [...mount.querySelectorAll('.file-cabinet-row > .file-cabinet-category')]
        .map((el) => el.dataset.category)
        .filter(Boolean);
    const folded = [...mount.querySelectorAll('.file-cabinet-filed-slot')]
        .map((el) => el.dataset.category)
        .filter(Boolean);
    const prev = getFileCabinetCategoryOrder();
    const next = [];
    const seen = new Set();
    [...visible, ...folded].forEach((name) => {
        if (seen.has(name)) return;
        seen.add(name);
        next.push(name);
    });
    prev.forEach((name) => {
        if (seen.has(name)) return;
        seen.add(name);
        next.push(name);
    });
    saveFileCabinetCategoryOrder(next);
}

export function getStoredItemSize(itemId, sortBy, UI) {
    if (!itemId || !UI) return null;
    const layout = UI.getGridLayout()[itemId];
    if (layout && Number.isFinite(layout.w) && Number.isFinite(layout.h)) {
        return { w: layout.w, h: layout.h };
    }
    return null;
}

export function isItemInFileCabinetOrder(itemId) {
    if (!itemId) return false;
    const order = getFileCabinetOrder();
    return Object.values(order).some((ids) => Array.isArray(ids) && ids.includes(itemId));
}

/** Drop order entries for notes no longer at label/compact size in the current mode. */
export function pruneFileCabinetOrderByLayout(items, sortBy, UI) {
    const itemsById = new Map((items || []).map((item) => [item.id, item]));
    const order = getFileCabinetOrder();
    let changed = false;
    Object.keys(order).forEach((cat) => {
        const before = order[cat] || [];
        const next = before.filter((id) => {
            const item = itemsById.get(id);
            if (!item || !isSpatiallyEligibleForFileCabinet(item, sortBy, UI)) {
                changed = true;
                return false;
            }
            return true;
        });
        if (next.length === 0) delete order[cat];
        else order[cat] = next;
    });
    if (changed) saveFileCabinetOrder(order);
    return changed;
}

export function shouldFileItem(item, sortBy, UI) {
    if (!item?.id) return false;
    if (isItemInFileCabinetOrder(item.id)) return true;
    const tileSize = resolveTileSize(item);
    const size = getStoredItemSize(item.id, sortBy, UI) ?? getTileDefaultRect(tileSize);
    return isCollapsedForFileCabinet(size.w, size.h, tileSize);
}

export function isItemFiled(item, sortBy, UI) {
    return shouldFileItem(item, sortBy, UI);
}

export function partitionItemsForFileCabinet(items, sortBy, UI) {
    const filed = [];
    const expanded = [];
    (items || []).forEach((item) => {
        if (shouldFileItem(item, sortBy, UI) || isItemInFileCabinetOrder(item.id)) {
            filed.push(item);
        } else {
            expanded.push(item);
        }
    });
    return { filed, expanded };
}

export function fileItemToCabinet(item, sortBy, UI, { x = 8, y = 8, rememberW, rememberH } = {}) {
    if (!item?.id || !UI) return;

    const tileSize = resolveTileSize(item);
    const stored = getStoredItemSize(item.id, sortBy, UI);
    const rw = Number.isFinite(rememberW) ? rememberW : stored?.w;
    const rh = Number.isFinite(rememberH) ? rememberH : stored?.h;

    if (Number.isFinite(rw) && Number.isFinite(rh) && !isCollapsedSpatialSize(rw, rh, tileSize)) {
        UI.persistRememberedSpatialSize(item.id, rw, rh, tileSize);
    }

    const label = getLabelRect();
    saveFiledCabinetLayout(item.id, { x, y, w: label.w, h: label.h }, sortBy);
    addToFileCabinetOrder(getItemCategoryName(item), item.id);
}

export function fileAllItemsToCabinet(items, sortBy, UI) {
    (items || []).forEach((item) => {
        if (!item?.id) return;
        const { x, y } = resolveFileCabinetItemPosition(item, sortBy, UI);
        fileItemToCabinet(item, sortBy, UI, { x, y });
    });
    seedFileCabinetOrderFromItems(items);
}

export function migrateItemsToFileCabinet(items, sortBy, UI) {
    (items || []).forEach((item) => {
        if (!shouldFileItem(item, sortBy, UI)) return;
        const { x, y } = resolveFileCabinetItemPosition(item, sortBy, UI);
        fileItemToCabinet(item, sortBy, UI, { x, y });
    });

    const { filed } = partitionItemsForFileCabinet(items, sortBy, UI);
    seedFileCabinetOrderFromItems(filed);
}

export function reconcileFileCabinetOrderWithItems(filedItems) {
    const order = getFileCabinetOrder();
    let changed = false;

    (filedItems || []).forEach((item) => {
        const cat = getItemCategoryName(item);
        Object.keys(order).forEach((c) => {
            if (c === cat || !order[c]?.includes(item.id)) return;
            order[c] = order[c].filter((id) => id !== item.id);
            changed = true;
            if (order[c]?.length === 0) delete order[c];
        });
        if (!order[cat]) order[cat] = [];
        if (!order[cat].includes(item.id)) {
            order[cat].push(item.id);
            changed = true;
        }
    });

    if (changed) saveFileCabinetOrder(order);
    return order;
}

export function seedFileCabinetOrderFromItems(filedItems) {
    return reconcileFileCabinetOrderWithItems(filedItems);
}

export function seedFromCurrentLayout(items, sortBy, UI) {
    migrateItemsToFileCabinet(items, sortBy, UI);
}

export function applySortToFileCabinetOrder(filedItems, sortPrefs) {
    if (!filedItems?.length) return;
    const byCategory = new Map();
    filedItems.forEach((item) => {
        const cat = getItemCategoryName(item);
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(item);
    });
    const order = getFileCabinetOrder();
    byCategory.forEach((items, cat) => {
        order[cat] = sortBoardItems(items, sortPrefs).map((item) => item.id);
    });
    saveFileCabinetOrder(order);
}

export function pruneFileCabinetOrder(liveIds) {
    const live = liveIds instanceof Set ? liveIds : new Set(liveIds || []);
    const order = getFileCabinetOrder();
    let changed = false;
    Object.keys(order).forEach((cat) => {
        const next = (order[cat] || []).filter((id) => live.has(id));
        if (next.length !== (order[cat] || []).length) {
            order[cat] = next;
            changed = true;
        }
        if (order[cat]?.length === 0) delete order[cat];
    });
    if (changed) saveFileCabinetOrder(order);
    return changed;
}

/**
 * Saves layout for a filed cabinet item. Only the footprint is stored, so the
 * sort mode the callers still pass has no effect on the entry.
 * @param {string} itemId - The item ID
 * @param {Object} rect - The rectangle with x, y, w, h
 */
export function saveFiledCabinetLayout(itemId, rect) {
    if (!itemId || !rect) return;
    const entry = {
        w: Math.round(rect.w),
        h: Math.round(rect.h)
    };
    if (Number.isFinite(rect.x)) entry.x = Math.round(rect.x);
    if (Number.isFinite(rect.y)) entry.y = Math.round(rect.y);

    const layout = JSON.parse(localStorage.getItem('matrix_grid_layout') || '{}');
    const prev = layout[itemId] || {};
    layout[itemId] = { ...prev, ...entry };
    // Preserve rememberedW/H so that expand-from-cabinet can restore the old size.
    // These were written by fileItemToCabinet's persistRememberedSpatialSize call.
    localStorage.setItem('matrix_grid_layout', JSON.stringify(layout));
}

/**
 * Sorts items for file cabinet display
 * @param {Array} filedItems - Items to sort
 * @param {Object} sortPrefs - Sorting preferences
 */
export function sortFileCabinetItems(filedItems, sortPrefs) {
    if (!filedItems?.length) return;
    const byCategory = new Map();
    filedItems.forEach((item) => {
        const cat = getItemCategoryName(item);
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(item);
    });
    const order = getFileCabinetOrder();
    byCategory.forEach((items, cat) => {
        order[cat] = sortBoardItems(items, sortPrefs).map((item) => item.id);
    });
    saveFileCabinetOrder(order);
}

export function sortItemsByFileCabinetOrder(items, category, order) {
    const catOrder = order[category] || [];
    return [...items].sort((a, b) => {
        const ai = catOrder.indexOf(a.id);
        const bi = catOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) {
            const aTime = Number(a.created_at || a.updated_at || 0);
            const bTime = Number(b.created_at || b.updated_at || 0);
            return aTime - bTime;
        }
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
    });
}

function isCollapsedForFileCabinet(w, h, tileSize) {
    return isCollapsedSpatialSize(w, h, tileSize);
}

function isSpatiallyEligibleForFileCabinet(item, sortBy, UI) {
    if (!item?.id) return false;
    const tileSize = resolveTileSize(item);
    const size = getStoredItemSize(item.id, sortBy, UI) ?? getTileDefaultRect(tileSize);
    return isCollapsedForFileCabinet(size.w, size.h, tileSize);
}

function resolveFileCabinetItemPosition(item, sortBy, UI) {
    const savedGrid = UI.getGridLayout()[item.id];
    const savedPos = UI.getFreeformPositions()[item.id];
    return {
        x: savedGrid?.x ?? savedPos?.x ?? 8,
        y: savedGrid?.y ?? savedPos?.y ?? 8
    };
}
