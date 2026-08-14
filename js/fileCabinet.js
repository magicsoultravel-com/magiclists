/** @module {"owns":"file cabinet mode, drag-to-file, filed chip rail", "related":["noteSurface.js","dragdrop.js","layoutStorage.js"], "events":["filecabinet:layout_changed"]} */
import { UNCATEGORIZED_CATEGORY, UNCATEGORIZED_COLOR, resolveCategoryColor, isUncategorizedCategory, renameCategory } from './categories.js';
import { getItemCategoryName } from './focusFilter.js';
import { NoteSurface } from './noteSurface.js';
import { escapeAttr, escapeHTML } from './domEscape.js';
import { sortBoardItems } from './boardSort.js';
import { readBoardSort } from './sidebarPrefs.js';
import {
    isCollapsedSpatialSize,
    getLabelRect,
    getTileDefaultRect,
    resolveTileSize
} from './tileGeometry.js';
import { getSmallRect } from './tileGeometry.js';
import { readTileSmallFootprint } from './tileFootprint.js';
import { normalizeViewMode } from './viewSession.js';
import { syncCabinetSplitter, syncFileCabinetShutChrome, refreshFileCabinetUiScale } from './shellResize.js';
import { BoardOperations } from './boardOperations.js';
import { createCardComponent } from './noteSurfaceHtml.js';
import { CARD_ICONS } from './icons.js';
import { DesktopManager } from './desktopManager.js';
import {
    getDockButtonAt,
    setDesktopDockDragHighlight,
    clearDesktopDockDragHighlight
} from './desktopDockDrop.js';


export const FILE_CABINET_KEY = 'matrix_file_cabinet';
export const FILE_CABINET_ORDER_KEY = 'matrix_file_cabinet_order';
export const FILE_CABINET_FILED_CATEGORIES_KEY = 'matrix_file_cabinet_filed_categories';
export const FILE_CABINET_CATEGORY_ORDER_KEY = 'matrix_file_cabinet_category_order';
export const FILE_CABINET_HEIGHT_KEY = 'matrix_file_cabinet_height';
export const FILE_CABINET_SHUT_KEY = 'matrix_file_cabinet_shut';

export const FILE_CABINET_MIN_HEIGHT = 96;
export const FILE_CABINET_BOARD_MIN_HEIGHT = 200;
export const FILE_CABINET_REF_HEIGHT = 220;
export const FILE_CABINET_MIN_HEIGHT_RATIO = 0.5;
/** Drag/release below this snaps to shut (reopen via FC FAB). */
export const FILE_CABINET_SHUT_SNAP_PX = 8;

export function getFileCabinetDragMinHeight() {
    return FILE_CABINET_REF_HEIGHT * FILE_CABINET_MIN_HEIGHT_RATIO;
}

const FOLD_ICON = '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 7l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const EXPAND_ICON = '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function collapsedTabWidth() {
    return getLabelRect().w;
}

export const FILE_CABINET_STACK_OFFSET_Y = 18;
export const FILE_CABINET_STACK_OFFSET_X = 10;
const FILE_CABINET_CATEGORY_HEADER_PAD = 20;
const FILE_CABINET_SCROLL_EDGE = 36;
const FILE_CABINET_SCROLL_STEP = 18;

export const DRAG_THRESHOLD = 4;

export function isFileCabinetActive() {
    return localStorage.getItem(FILE_CABINET_KEY) === 'true';
}

export function setFileCabinetActive(active) {
    localStorage.setItem(FILE_CABINET_KEY, active ? 'true' : 'false');
    if (!active) {
        setFileCabinetShut(false);
        syncFileCabinetShutChrome();
    }
}

export function isFileCabinetShut() {
    return localStorage.getItem(FILE_CABINET_SHUT_KEY) === 'true';
}

export function setFileCabinetShut(shut) {
    if (shut) localStorage.setItem(FILE_CABINET_SHUT_KEY, 'true');
    else localStorage.removeItem(FILE_CABINET_SHUT_KEY);
}

export function readFileCabinetHeight() {
    const raw = parseFloat(localStorage.getItem(FILE_CABINET_HEIGHT_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
}

export function writeFileCabinetHeight(height) {
    if (!Number.isFinite(height) || height <= 0) {
        localStorage.removeItem(FILE_CABINET_HEIGHT_KEY);
        return;
    }
    localStorage.setItem(FILE_CABINET_HEIGHT_KEY, String(Math.round(height)));
}

/**
 * Collapse FC to height 0 (sidebar-style). Grabber hides; reopen via FC FAB.
 * Preserves last open height in storage (does not write 0).
 */
export function applyFileCabinetShut(mount) {
    if (!mount) return;
    setFileCabinetShut(true);
    mount.dataset.shut = 'true';
    mount.dataset.fixedHeight = 'true';
    mount.classList.add('is-file-cabinet-shut');
    mount.classList.remove('is-rollout-active');
    mount.style.flex = '0 0 auto';
    mount.style.height = '0px';
    mount.style.minHeight = '0px';
    mount.style.maxHeight = 'none';
    mount.style.setProperty('--file-cabinet-ui-scale', '1');
    syncFileCabinetShutChrome();
}

/**
 * Clear shut chrome and return the height that should be restored.
 */
export function clearFileCabinetShut(mount) {
    setFileCabinetShut(false);
    if (!mount) {
        syncFileCabinetShutChrome();
        return readFileCabinetHeight();
    }
    delete mount.dataset.shut;
    mount.classList.remove('is-file-cabinet-shut');
    mount.style.opacity = '';
    syncFileCabinetShutChrome();
    return readFileCabinetHeight();
}

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
    removeFromFileCabinetOrder(itemId);
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

function isCollapsedForFileCabinet(w, h, tileSize) {
    return isCollapsedSpatialSize(w, h, tileSize);
}

function isSpatiallyEligibleForFileCabinet(item, sortBy, UI) {
    if (!item?.id) return false;
    const tileSize = resolveTileSize(item);
    const size = getStoredItemSize(item.id, sortBy, UI) ?? getTileDefaultRect(tileSize);
    return isCollapsedForFileCabinet(size.w, size.h, tileSize);
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

function resolveFileCabinetItemPosition(item, sortBy, UI) {
    const savedGrid = UI.getGridLayout()[item.id];
    const savedPos = UI.getFreeformPositions()[item.id];
    return {
        x: savedGrid?.x ?? savedPos?.x ?? 8,
        y: savedGrid?.y ?? savedPos?.y ?? 8
    };
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

function sortItemsByFileCabinetOrder(items, category, order) {
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

export function ensureFileCabinetMount(active) {
    const surface = document.getElementById('desktop-surface');
    if (!surface) return null;
    let el = document.getElementById('file-cabinet');
    if (!active) {
        el?.remove();
        surface.classList.remove('desktop-surface--file-cabinet');
        return null;
    }
    surface.classList.add('desktop-surface--file-cabinet');
    if (!el) {
        el = document.createElement('header');
        el.id = 'file-cabinet';
        el.className = 'file-cabinet';
        el.setAttribute('aria-label', 'File Cabinet');
        const canvas = document.getElementById('app-canvas');
        const anchor = canvas?.closest('.board-ruler-frame') || canvas;
        if (anchor) surface.insertBefore(el, anchor);
        else surface.prepend(el);
    }
    return el;
}

function snapshotStackTabs(stackEl) {
    const map = new Map();
    if (!stackEl) return map;
    stackEl.querySelectorAll('.file-cabinet-tab').forEach((tab) => {
        const id = tab.dataset.id;
        if (!id) return;
        map.set(id, {
            left: tab.style.left,
            top: tab.style.top,
            position: tab.style.position,
            width: tab.style.width,
            height: tab.style.height,
            zIndex: tab.style.zIndex
        });
    });
    return map;
}

function restoreStackPreview(stackEl, baseline) {
    if (!stackEl || !baseline) return;
    baseline.forEach((pos, id) => {
        const tab = stackEl.querySelector(`.file-cabinet-tab[data-id="${CSS.escape(id)}"]`);
        if (!tab || tab.classList.contains('is-file-cabinet-dragging')) return;
        tab.style.position = pos.position || 'absolute';
        tab.style.left = pos.left;
        tab.style.top = pos.top;
        tab.style.width = pos.width;
        tab.style.height = pos.height;
        tab.style.zIndex = pos.zIndex;
        tab.classList.remove('layout-settling', 'layout-preview');
    });
    const layoutTabs = [...stackEl.querySelectorAll('.file-cabinet-tab')].filter(
        (tab) => !tab.classList.contains('is-file-cabinet-dragging')
    );
    if (layoutTabs.length) applyFileCabinetStackPositions(stackEl);
}

function beginFileCabinetDragGhost(card, stack) {
    if (!card || !stack) return null;
    const placeholder = document.createComment('fc-drag-placeholder');
    stack.insertBefore(placeholder, card);
    document.body.appendChild(card);
    return placeholder;
}

function endFileCabinetDragGhost(card, placeholder) {
    if (!card || !placeholder?.parentNode) return;
    placeholder.parentNode.insertBefore(card, placeholder);
    placeholder.remove();
}

/**
 * Lift a board card onto document.body as a fixed-position filing ghost.
 * Returns restore metadata so the card can be put back into the canvas.
 */
export function beginBoardFilingGhost(card, clientX, clientY) {
    if (!card) return null;
    const parent = card.parentNode;
    if (!parent) return null;
    const rect = card.getBoundingClientRect();
    const placeholder = document.createComment('board-filing-placeholder');
    parent.insertBefore(placeholder, card);
    document.body.appendChild(card);

    const label = getLabelRect();
    const offsetX = Math.min(Math.max(8, clientX - rect.left), Math.max(16, label.w - 8));
    const offsetY = Math.min(Math.max(8, clientY - rect.top), Math.max(12, label.h - 4));

    card.classList.add('spatial-at-small');
    card.style.position = 'fixed';
    card.style.left = `${clientX - offsetX}px`;
    card.style.top = `${clientY - offsetY}px`;
    card.style.width = `${label.w}px`;
    card.style.height = `${label.h}px`;
    card.style.margin = '0';
    card.style.zIndex = '10000';
    card.style.pointerEvents = 'none';

    return {
        placeholder,
        parent,
        offsetX,
        offsetY
    };
}

export function moveBoardFilingGhost(card, filingState, clientX, clientY) {
    if (!card || !filingState) return;
    card.style.left = `${clientX - filingState.offsetX}px`;
    card.style.top = `${clientY - filingState.offsetY}px`;
}

/**
 * Restore a board card from body ghost back into the canvas.
 * @param {Object} opts.filingPreview - { w, h } original size before morph
 * @param {Object} opts.canvasRect - { x, y } canvas-local position to restore
 */
export function endBoardFilingGhost(card, filingState, {
    filingPreview = null,
    canvasRect = null,
    keepCollapsed = false
} = {}) {
    if (!card || !filingState) return;
    const { placeholder } = filingState;
    if (placeholder?.parentNode) {
        placeholder.parentNode.insertBefore(card, placeholder);
        placeholder.remove();
    } else if (filingState.parent?.isConnected) {
        filingState.parent.appendChild(card);
    }

    card.style.position = '';
    card.style.left = '';
    card.style.top = '';
    card.style.width = '';
    card.style.height = '';
    card.style.margin = '';
    card.style.zIndex = '';
    card.style.pointerEvents = '';

    if (!keepCollapsed) {
        card.classList.remove('spatial-at-small');
    }

    if (canvasRect && Number.isFinite(canvasRect.x) && Number.isFinite(canvasRect.y)) {
        card.style.left = `${canvasRect.x}px`;
        card.style.top = `${canvasRect.y}px`;
    }
    if (filingPreview && Number.isFinite(filingPreview.w) && Number.isFinite(filingPreview.h)) {
        card.style.width = `${filingPreview.w}px`;
        card.style.height = `${filingPreview.h}px`;
    }
}

/**
 * Clear stack insert previews used during board→FC filing.
 */
export function clearFileCabinetFilingPreview(mount, previewState) {
    if (previewState?.targetStack && previewState?.targetBaseline) {
        restoreStackPreview(previewState.targetStack, previewState.targetBaseline);
    }
    if (previewState) {
        previewState.targetStack = null;
        previewState.targetBaseline = null;
        previewState._lastPreviewKey = '';
    }
    clearFileCabinetSurfaceHighlights(mount);
}

/**
 * Preview insert slot while dragging a board label over FC stacks.
 * Mutates previewState in place: { targetStack, targetBaseline }.
 */
export function previewFileCabinetTabDrop(mount, dragState, clientX, clientY, previewState = {}) {
    if (!mount || !dragState?.card) return null;
    const canvas = document.getElementById('app-canvas');
    const target = resolveCrossSurfaceDropTarget(clientX, clientY, {
        dragKind: 'board-card',
        mount,
        canvas,
        dragState
    });

    applyFileCabinetDropHighlight(mount, target?.kind === 'file-cabinet' ? target : null);
    autoScrollFileCabinetInner(mount, clientX);

    const draggedId = dragState.card.dataset.id;
    if (target?.kind === 'file-cabinet' && target.targetStack) {
        if (previewState.targetStack !== target.targetStack) {
            if (previewState.targetStack && previewState.targetBaseline) {
                restoreStackPreview(previewState.targetStack, previewState.targetBaseline);
            }
            previewState.targetStack = target.targetStack;
            previewState.targetBaseline = snapshotStackTabs(target.targetStack);
        }
        applyStackPreviewPositions(target.targetStack, {
            draggedId,
            insertIndex: target.insertIndex,
            settling: true
        });
    } else if (previewState.targetStack && previewState.targetBaseline) {
        restoreStackPreview(previewState.targetStack, previewState.targetBaseline);
        previewState.targetStack = null;
        previewState.targetBaseline = null;
    }

    return target;
}

function getFileCabinetHitRect(mount) {
    if (!mount) return null;
    const mountRect = mount.getBoundingClientRect();
    const splitter = document.getElementById('shell-splitter-h');
    const splitterRect = splitter?.getBoundingClientRect?.();
    if (!splitterRect) return mountRect;
    // Include the horizontal splitter band as FC-adjacent so filing doesn't flicker.
    return {
        left: Math.min(mountRect.left, splitterRect.left),
        right: Math.max(mountRect.right, splitterRect.right),
        top: Math.min(mountRect.top, splitterRect.top),
        bottom: Math.max(mountRect.bottom, splitterRect.bottom)
    };
}

function updateStackPreviewDimensions(stackEl, slotCount, { minSlotCount = 0 } = {}) {
    if (!stackEl) return;
    const label = getLabelRect();
    const count = Math.max(slotCount, minSlotCount, 1);
    const tabW = collapsedTabWidth();
    const stackWidth = tabW + (count - 1) * FILE_CABINET_STACK_OFFSET_X;
    const stackHeight = label.h + (count - 1) * FILE_CABINET_STACK_OFFSET_Y;
    stackEl.style.width = `${stackWidth}px`;
    stackEl.style.height = `${Math.max(stackHeight, label.h)}px`;
    const col = stackEl.closest('.file-cabinet-category');
    if (col) {
        col.style.width = `${stackWidth}px`;
        col.style.minWidth = `${stackWidth}px`;
        col.style.flexBasis = `${stackWidth}px`;
    }
    const rollout = stackEl.closest('.file-cabinet-filed-rollout');
    if (rollout) {
        rollout.style.width = `${stackWidth}px`;
        rollout.style.minWidth = `${stackWidth}px`;
        rollout.style.height = `${Math.max(stackHeight, label.h)}px`;
    }
}

function applyStackPreviewPositions(stackEl, { draggedId, insertIndex = null, settling = true, minSlotCount = 0 } = {}) {
    if (!stackEl) return;
    const tabs = [...stackEl.querySelectorAll('.file-cabinet-tab')].filter((t) => t.dataset.id !== draggedId);
    const label = getLabelRect();
    let visualIndex = 0;
    tabs.forEach((tab, i) => {
        if (insertIndex != null && i === insertIndex) visualIndex++;
        tab.style.position = 'absolute';
        tab.style.left = `${visualIndex * FILE_CABINET_STACK_OFFSET_X}px`;
        tab.style.top = `${visualIndex * FILE_CABINET_STACK_OFFSET_Y}px`;
        tab.style.width = `${collapsedTabWidth()}px`;
        tab.style.height = `${label.h}px`;
        tab.style.zIndex = String(visualIndex + 1);
        tab.classList.toggle('layout-settling', settling);
        tab.classList.toggle('layout-preview', settling);
        visualIndex++;
    });
    const slotCount = tabs.length + (insertIndex != null ? 1 : 0);
    updateStackPreviewDimensions(stackEl, slotCount, { minSlotCount });
}

function resolveFileCabinetDropTarget(clientX, clientY, dragState, mount) {
    if (!mount) return null;
    const prev = dragState?.card;
    const prevPe = prev?.style.pointerEvents;
    if (prev) prev.style.pointerEvents = 'none';
    const el = document.elementFromPoint(clientX, clientY);
    if (prev) prev.style.pointerEvents = prevPe || '';

    if (!el || !mount.contains(el)) return null;

    const chip = el.closest('.file-cabinet-filed-chip');
    if (chip) {
        const category = chip.dataset.category || 'Uncategorized';
        const order = getFileCabinetOrder();
        const count = (order[category] || []).filter((id) => id !== dragState?.card?.dataset?.id).length;
        return {
            kind: 'file-cabinet',
            targetStack: null,
            targetCategory: category,
            insertIndex: count,
            targetChip: chip,
            isFolded: true
        };
    }

    const stack = el.closest('.file-cabinet-tab-stack');
    if (stack) {
        const category = stack.dataset.category || 'Uncategorized';
        const rect = stack.getBoundingClientRect();
        const tabs = [...stack.querySelectorAll('.file-cabinet-tab')].filter(
            (t) => t.dataset.id !== dragState?.card?.dataset?.id
        );
        let insertIndex = Math.floor((clientY - rect.top) / FILE_CABINET_STACK_OFFSET_Y);
        insertIndex = Math.max(0, Math.min(tabs.length, insertIndex));
        const inRollout = !!stack.closest('.file-cabinet-filed-rollout');
        return {
            kind: 'file-cabinet',
            targetStack: stack,
            targetCategory: category,
            insertIndex,
            isFolded: inRollout
        };
    }

    const col = el.closest('.file-cabinet-category');
    if (col) {
        const category = col.dataset.category || 'Uncategorized';
        const stackEl = col.querySelector('.file-cabinet-tab-stack');
        return {
            kind: 'file-cabinet',
            targetStack: stackEl,
            targetCategory: category,
            insertIndex: 0,
            isFolded: false
        };
    }

    // Over FC mount but not a specific category — still a valid FC surface.
    return {
        kind: 'file-cabinet',
        targetStack: null,
        targetCategory: null,
        insertIndex: null,
        isFolded: false,
        isMountOnly: true
    };
}

/**
 * Resolve drop across FC and board surfaces.
 * Prefer geometry over elementFromPoint.contains — canvas uses CSS transform scale.
 * @param {'fc-tab'|'board-card'} dragKind
 */
export function resolveCrossSurfaceDropTarget(clientX, clientY, {
    dragKind = 'fc-tab',
    mount = null,
    canvas = null,
    dragState = null
} = {}) {
    const prev = dragState?.card;
    const prevPe = prev?.style.pointerEvents;
    if (prev) prev.style.pointerEvents = 'none';

    const pointInRect = (rect) => rect
        && clientX >= rect.left
        && clientX <= rect.right
        && clientY >= rect.top
        && clientY <= rect.bottom;

    const mountHitRect = getFileCabinetHitRect(mount);
    if (mount && pointInRect(mountHitRect)) {
        let fcTarget = resolveFileCabinetDropTarget(clientX, clientY, dragState, mount);
        if (!fcTarget?.targetCategory || fcTarget.isMountOnly) {
            const nearest = resolveNearestFileCabinetCategory(clientX, clientY, dragState, mount);
            if (nearest) fcTarget = nearest;
        }
        // Pointer over splitter band (inside extended hit rect but outside mount DOM)
        if (!fcTarget || fcTarget.isMountOnly) {
            const el = document.elementFromPoint(clientX, clientY);
            if (el?.closest?.('#shell-splitter-h')) {
                const nearest = resolveNearestFileCabinetCategory(clientX, clientY, dragState, mount);
                if (nearest) fcTarget = nearest;
                else {
                    fcTarget = {
                        kind: 'file-cabinet',
                        targetStack: null,
                        targetCategory: null,
                        insertIndex: null,
                        isMountOnly: true
                    };
                }
            }
        }
        if (prev) prev.style.pointerEvents = prevPe || '';
        return fcTarget || {
            kind: 'file-cabinet',
            targetStack: null,
            targetCategory: null,
            insertIndex: null,
            isMountOnly: true
        };
    }

    if (dragKind === 'fc-tab' && canvas) {
        const canvasRect = canvas.getBoundingClientRect();
        if (pointInRect(canvasRect)) {
            if (prev) prev.style.pointerEvents = prevPe || '';
            return { kind: 'board', clientX, clientY };
        }
    }

    // Secondary: elementsFromPoint can still help when geometry is ambiguous
    const stack = document.elementsFromPoint?.(clientX, clientY) || [];
    if (prev) prev.style.pointerEvents = prevPe || '';

    if (mount && stack.some((el) => el === mount || mount.contains(el) || el?.id === 'shell-splitter-h' || el?.closest?.('#shell-splitter-h'))) {
        return resolveFileCabinetDropTarget(clientX, clientY, dragState, mount)
            || resolveNearestFileCabinetCategory(clientX, clientY, dragState, mount)
            || {
                kind: 'file-cabinet',
                targetStack: null,
                targetCategory: null,
                insertIndex: null,
                isMountOnly: true
            };
    }
    if (dragKind === 'fc-tab' && canvas && stack.some((el) => el === canvas || canvas.contains(el))) {
        return { kind: 'board', clientX, clientY };
    }

    return null;
}

function resolveNearestFileCabinetCategory(clientX, clientY, dragState, mount) {
    if (!mount) return null;
    const candidates = [
        ...mount.querySelectorAll('.file-cabinet-category'),
        ...mount.querySelectorAll('.file-cabinet-filed-chip')
    ];
    let best = null;
    let bestDist = Infinity;
    candidates.forEach((el) => {
        const r = el.getBoundingClientRect();
        const cx = Math.max(r.left, Math.min(clientX, r.right));
        const cy = Math.max(r.top, Math.min(clientY, r.bottom));
        const dist = Math.hypot(clientX - cx, clientY - cy);
        if (dist < bestDist) {
            bestDist = dist;
            best = el;
        }
    });
    // ~half a column away is still a valid snap
    if (!best || bestDist > 96) return null;

    if (best.classList.contains('file-cabinet-filed-chip')) {
        const category = best.dataset.category || 'Uncategorized';
        const order = getFileCabinetOrder();
        const count = (order[category] || []).filter((id) => id !== dragState?.card?.dataset?.id).length;
        return {
            kind: 'file-cabinet',
            targetStack: null,
            targetCategory: category,
            insertIndex: count,
            targetChip: best,
            isFolded: true
        };
    }

    const category = best.dataset.category || 'Uncategorized';
    const stackEl = best.querySelector('.file-cabinet-tab-stack');
    if (!stackEl) {
        return {
            kind: 'file-cabinet',
            targetStack: null,
            targetCategory: category,
            insertIndex: 0,
            isFolded: false
        };
    }
    const rect = stackEl.getBoundingClientRect();
    const tabs = [...stackEl.querySelectorAll('.file-cabinet-tab')].filter(
        (t) => t.dataset.id !== dragState?.card?.dataset?.id
    );
    let insertIndex = Math.floor((clientY - rect.top) / FILE_CABINET_STACK_OFFSET_Y);
    insertIndex = Math.max(0, Math.min(tabs.length, insertIndex));
    return {
        kind: 'file-cabinet',
        targetStack: stackEl,
        targetCategory: category,
        insertIndex,
        isFolded: false
    };
}

let activeDropHighlightKey = '';

function clearFileCabinetDropTargets(mount) {
    mount?.querySelectorAll('.is-file-cabinet-drop-target').forEach((el) => {
        el.classList.remove('is-file-cabinet-drop-target');
    });
    mount?.classList.remove('is-file-cabinet-drop-target');
    document.getElementById('app-canvas')?.classList.remove('is-file-cabinet-board-drop-target');
    clearFileCabinetInsertMarker(mount);
    activeDropHighlightKey = '';
}

export function clearFileCabinetSurfaceHighlights(mount = document.getElementById('file-cabinet')) {
    clearFileCabinetDropTargets(mount);
}

function clearFileCabinetInsertMarker(mount) {
    mount?.querySelectorAll('.file-cabinet-insert-marker').forEach((el) => el.remove());
}

function ensureFileCabinetInsertMarker(stack, insertIndex) {
    if (!stack || !Number.isFinite(insertIndex)) return;
    const mount = stack.closest('#file-cabinet');
    let marker = stack.querySelector(':scope > .file-cabinet-insert-marker');
    if (!marker) {
        if (mount) {
            mount.querySelectorAll('.file-cabinet-insert-marker').forEach((el) => {
                if (el.parentElement !== stack) el.remove();
            });
        }
        marker = document.createElement('div');
        marker.className = 'file-cabinet-insert-marker';
        stack.appendChild(marker);
    }
    marker.style.top = `${Math.max(0, insertIndex) * FILE_CABINET_STACK_OFFSET_Y}px`;
}

/** Idempotent drop highlight — avoids blink from clear/re-add every frame. */
export function applyFileCabinetDropHighlight(mount, target) {
    if (!target) {
        clearFileCabinetDropTargets(mount);
        return;
    }

    const highlightKey = target.kind === 'board'
        ? 'board'
        : target.targetChip
            ? `chip:${target.targetCategory}`
            : target.isMountOnly
                ? 'mount'
                : `col:${target.targetCategory || ''}`;

    if (highlightKey !== activeDropHighlightKey) {
        mount?.querySelectorAll('.is-file-cabinet-drop-target').forEach((el) => {
            el.classList.remove('is-file-cabinet-drop-target');
        });
        mount?.classList.remove('is-file-cabinet-drop-target');
        document.getElementById('app-canvas')?.classList.remove('is-file-cabinet-board-drop-target');
        activeDropHighlightKey = highlightKey;

        if (target.kind === 'board') {
            document.getElementById('app-canvas')?.classList.add('is-file-cabinet-board-drop-target');
        } else if (target.targetChip) {
            target.targetChip.classList.add('is-file-cabinet-drop-target');
        } else if (target.isMountOnly) {
            mount?.classList.add('is-file-cabinet-drop-target');
        } else {
            const col = target.targetStack?.closest('.file-cabinet-category')
                || [...(mount?.querySelectorAll('.file-cabinet-category') || [])]
                    .find((c) => c.dataset.category === target.targetCategory);
            col?.classList.add('is-file-cabinet-drop-target');
        }
    }

    if (target.kind === 'file-cabinet' && target.targetStack && Number.isFinite(target.insertIndex)) {
        ensureFileCabinetInsertMarker(target.targetStack, target.insertIndex);
    } else {
        clearFileCabinetInsertMarker(mount);
    }
}

function setFileCabinetDropTarget(mount, target) {
    applyFileCabinetDropHighlight(mount, target);
}

function autoScrollFileCabinetInner(mount, clientX) {
    const inner = mount?.querySelector('.file-cabinet-inner');
    if (!inner) return;
    const rect = inner.getBoundingClientRect();
    if (clientX > rect.right - FILE_CABINET_SCROLL_EDGE) {
        inner.scrollLeft += FILE_CABINET_SCROLL_STEP;
    } else if (clientX < rect.left + FILE_CABINET_SCROLL_EDGE) {
        inner.scrollLeft = Math.max(0, inner.scrollLeft - FILE_CABINET_SCROLL_STEP);
    }
}

function clientToCanvasBoardPoint(canvas, clientX, clientY) {
    if (!canvas) return { x: 8, y: 8 };
    const zoom = parseFloat(canvas.dataset.desktopZoom);
    const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const rect = canvas.getBoundingClientRect();
    return {
        x: (clientX - rect.left) / scale + canvas.scrollLeft,
        y: (clientY - rect.top) / scale + canvas.scrollTop
    };
}

function ensureFileCabinetTabDragHandle(card) {
    if (!card || card.querySelector('.card-act--drag')) return;
    const actions = card.querySelector('.card-actions');
    if (!actions) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-act card-act--drag';
    btn.title = 'Drag to reorder';
    btn.setAttribute('aria-label', 'Drag to reorder');
    btn.innerHTML = CARD_ICONS.drag;
    const toggle = actions.querySelector('.card-act--toggle');
    if (toggle) actions.insertBefore(btn, toggle);
    else actions.appendChild(btn);
}

function updateFileCabinetCategoryCount(mount, category) {
    const col = mount?.querySelector(`.file-cabinet-category[data-category="${CSS.escape(category)}"]`);
    if (!col) return;
    const count = col.querySelectorAll('.file-cabinet-tab').length;
    const countEl = col.querySelector('.file-cabinet-category-count');
    if (countEl) countEl.textContent = String(count);
}

function flashFileCabinetDropRejected(card) {
    if (!card) return;
    card.classList.add('is-drop-rejected');
    window.setTimeout(() => card.classList.remove('is-drop-rejected'), 180);
}

/**
 * Expand a filed note onto the board at drop coords (or remembered position).
 * Preserves item.categories.
 */
export function expandFileCabinetItemToBoard({ item, dropX, dropY, UI, card = null }) {
    if (!item?.id || !UI) return false;
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

function resetDraggedTabStyles(card, stack) {
    if (!card) return;
    card.classList.remove('is-file-cabinet-dragging', 'layout-settling', 'layout-preview');
    card.style.position = '';
    card.style.left = '';
    card.style.top = '';
    card.style.width = '';
    card.style.height = '';
    card.style.margin = '';
    card.style.zIndex = '';
    card.style.pointerEvents = '';
    if (stack?.contains(card)) applyFileCabinetStackPositions(stack);
}

export function applyFileCabinetStackPositions(stackEl) {
    if (!stackEl) return;
    const tabs = [...stackEl.querySelectorAll('.file-cabinet-tab')];
    const label = getLabelRect();
    const count = tabs.length;
    const tabW = collapsedTabWidth();
    const stackWidth = count > 0
        ? tabW + (count - 1) * FILE_CABINET_STACK_OFFSET_X
        : tabW;
    const stackHeight = count > 0
        ? label.h + (count - 1) * FILE_CABINET_STACK_OFFSET_Y
        : label.h;

    stackEl.style.width = `${stackWidth}px`;
    stackEl.style.height = `${Math.max(stackHeight, label.h)}px`;

    const col = stackEl.closest('.file-cabinet-category');
    if (col) {
        col.style.width = `${stackWidth}px`;
        col.style.minWidth = `${stackWidth}px`;
        col.style.flexBasis = `${stackWidth}px`;
    }

    const rollout = stackEl.closest('.file-cabinet-filed-rollout');
    if (rollout) {
        rollout.style.width = `${stackWidth}px`;
        rollout.style.minWidth = `${stackWidth}px`;
        rollout.style.height = `${Math.max(stackHeight, label.h)}px`;
    }

    let layoutIndex = 0;
    tabs.forEach((card) => {
        if (card.classList.contains('is-file-cabinet-dragging')) return;
        card.style.position = 'absolute';
        card.style.left = `${layoutIndex * FILE_CABINET_STACK_OFFSET_X}px`;
        card.style.top = `${layoutIndex * FILE_CABINET_STACK_OFFSET_Y}px`;
        card.style.width = `${collapsedTabWidth()}px`;
        card.style.height = `${label.h}px`;
        card.style.zIndex = String(layoutIndex + 1);
        card.dataset.fileCabinetStackIndex = String(layoutIndex);
        layoutIndex++;
    });
}

export function getFileCabinetUiScale(mount) {
    if (!mount) return 1;
    const raw = parseFloat(getComputedStyle(mount).getPropertyValue('--file-cabinet-ui-scale'));
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

export function getFileCabinetContentMinHeight(mount) {
    if (!mount) return FILE_CABINET_MIN_HEIGHT;
    const label = getLabelRect();
    let maxStackH = label.h;
    mount.querySelectorAll('.file-cabinet-tab-stack').forEach((stack) => {
        if (stack.closest('.file-cabinet-filed-rollout')) return;
        const count = stack.querySelectorAll('.file-cabinet-tab').length;
        const stackH = count > 0
            ? label.h + (count - 1) * FILE_CABINET_STACK_OFFSET_Y
            : label.h;
        maxStackH = Math.max(maxStackH, stackH);
    });

    let contentH = maxStackH + FILE_CABINET_CATEGORY_HEADER_PAD;

    const rail = mount.querySelector('.file-cabinet-filed-rail');
    if (rail) {
        const scale = getFileCabinetUiScale(mount);
        const railNatural = rail.getBoundingClientRect().height / scale;
        if (Number.isFinite(railNatural) && railNatural > 0) {
            contentH = Math.max(contentH, railNatural);
        }
    }

    const styles = getComputedStyle(mount);
    const padY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
    return contentH + padY;
}

export function syncFileCabinetDrawerHeight(mount) {
    if (!mount) return;
    if (isFileCabinetShut() || mount.dataset.shut === 'true') {
        applyFileCabinetShut(mount);
        return;
    }
    const contentMin = getFileCabinetContentMinHeight(mount);
    const dragMin = getFileCabinetDragMinHeight();
    const savedHeight = readFileCabinetHeight();
    const inlineHeight = parseFloat(mount.style.height);
    const isFixed = savedHeight !== null || mount.dataset.fixedHeight === 'true';
    if (isFixed) {
        mount.dataset.fixedHeight = 'true';
        mount.style.flex = '0 0 auto';
        mount.style.maxHeight = 'none';
        mount.style.minHeight = '0px';
        const targetH = (Number.isFinite(inlineHeight) && inlineHeight > 0)
            ? inlineHeight
            : savedHeight;
        if (Number.isFinite(targetH) && targetH > 0) {
            mount.style.height = `${targetH}px`;
        }
        refreshFileCabinetUiScale(mount, targetH);
        return;
    }
    const targetH = Math.max(dragMin, contentMin);
    delete mount.dataset.fixedHeight;
    mount.style.flex = '';
    mount.style.height = `${targetH}px`;
    mount.style.minHeight = `${targetH}px`;
    mount.style.maxHeight = 'none';
    refreshFileCabinetUiScale(mount, targetH);
}

function buildFileCabinetCategoryColumn({
    catName,
    items,
    activeCategories,
    UI,
    showFoldButton = true,
    showGrabButton = true
}) {
    const label = getLabelRect();
    const color = resolveCategoryColor(catName, activeCategories);

    const col = document.createElement('div');
    col.className = 'file-cabinet-category';
    col.dataset.category = catName;
    col.style.setProperty('--file-cabinet-category-color', color);

    const header = document.createElement('div');
    header.className = 'file-cabinet-category-header';
    const canRename = !isUncategorizedCategory(catName);
    const nameAttrs = canRename
        ? ' class="file-cabinet-category-name u-truncate card-inline-edit" contenteditable="plaintext-only" spellcheck="false" data-placeholder="Category…"'
        : ' class="file-cabinet-category-name u-truncate"';
    const grabBtnHtml = showGrabButton
        ? `<button type="button" class="card-act file-cabinet-category-grab-btn grab-handle grab-handle--col" title="Drag to reorder category" aria-label="Drag to reorder category">${CARD_ICONS.drag}</button>`
        : '';
    const foldBtnHtml = showFoldButton
        ? `<button type="button" class="card-act file-cabinet-category-fold-btn" title="Fold category" aria-label="Fold category">${FOLD_ICON}</button>`
        : '';
    header.innerHTML = `<span class="file-cabinet-category-dot" style="background:${escapeAttr(color)}"></span><span${nameAttrs}>${escapeHTML(catName)}</span><span class="file-cabinet-category-count">${items.length}</span>${grabBtnHtml}${foldBtnHtml}`;
    col.appendChild(header);

    const stack = document.createElement('div');
    stack.className = 'file-cabinet-tab-stack';
    stack.dataset.category = catName;

    items.forEach((item, index) => {
        const card = createCardComponent(UI, item, activeCategories);
        card.classList.add('file-cabinet-tab', 'spatial-at-small');
        card.dataset.fileCabinetCategory = catName;
        card.dataset.fileCabinetStackIndex = String(index);
        ensureFileCabinetTabDragHandle(card);
        UI.applyNoteRect(card, { x: 0, y: 0, w: label.w, h: label.h }, { settling: false });
        UI.finalizeDesktopCard(card);
        UI.syncSpatialToggleButton(card);
        stack.appendChild(card);
    });

    applyFileCabinetStackPositions(stack);
    col.appendChild(stack);
    return col;
}

function buildFileCabinetRolloutStack({ catName, items, activeCategories, UI }) {
    const label = getLabelRect();

    const stack = document.createElement('div');
    stack.className = 'file-cabinet-tab-stack';
    stack.dataset.category = catName;

    items.forEach((item, index) => {
        const card = createCardComponent(UI, item, activeCategories);
        card.classList.add('file-cabinet-tab', 'spatial-at-small');
        card.dataset.fileCabinetCategory = catName;
        card.dataset.fileCabinetStackIndex = String(index);
        ensureFileCabinetTabDragHandle(card);
        UI.applyNoteRect(card, { x: 0, y: 0, w: label.w, h: label.h }, { settling: false });
        UI.finalizeDesktopCard(card);
        UI.syncSpatialToggleButton(card);
        stack.appendChild(card);
    });

    applyFileCabinetStackPositions(stack);
    return stack;
}

export function initFileCabinetFoldedHoverPreview(mount, getPreviewContext, signal) {
    if (!mount || !signal) return null;

    let activeSlot = null;
    let pinnedByDrag = false;
    let dragMode = false;

    const getSlotChip = (slot) => slot?.querySelector('.file-cabinet-filed-chip');
    const getSlotRollout = (slot) => slot?.querySelector('.file-cabinet-filed-rollout');

    const closeSlot = (slot) => {
        if (!slot?.isConnected) return;
        const rollout = getSlotRollout(slot);
        if (rollout) {
            rollout.innerHTML = '';
            rollout.removeAttribute('style');
            rollout.setAttribute('aria-hidden', 'true');
        }
        slot.classList.remove('is-fold-rollout-open');
        getSlotChip(slot)?.classList.remove('is-fold-preview-source');
    };

    const isInsidePreviewZone = (el) => {
        if (!el || !activeSlot?.isConnected) return false;
        return activeSlot.contains(el);
    };

    const hidePreview = (force = false) => {
        if (!force && pinnedByDrag) return;
        if (!force && dragMode) return;
        if (!force && document.body.classList.contains('is-file-cabinet-drag-active') && !dragMode) return;
        mount.querySelectorAll('.file-cabinet-filed-slot.is-fold-rollout-open').forEach((slot) => {
            closeSlot(slot);
        });
        mount.classList.remove('is-rollout-active');
        activeSlot = null;
    };

    const showPreview = (slot, { duringDrag = false } = {}) => {
        if (!duringDrag && document.body.classList.contains('is-file-cabinet-drag-active') && !dragMode) return;
        const ctx = getPreviewContext?.();
        if (!ctx || !slot) return;

        const catName = slot.dataset.category;
        if (!catName) return;

        const items = ctx.byCategory?.get(catName);
        if (!items?.length) return;

        const rollout = getSlotRollout(slot);
        const chip = getSlotChip(slot);
        if (!rollout) return;

        if (activeSlot === slot && rollout.querySelector('.file-cabinet-tab-stack')) {
            slot.classList.add('is-fold-rollout-open');
            chip?.classList.add('is-fold-preview-source');
            mount.classList.add('is-rollout-active');
            return;
        }

        if (activeSlot && activeSlot !== slot) closeSlot(activeSlot);
        activeSlot = slot;

        const sorted = sortItemsByFileCabinetOrder(items, catName, ctx.order || getFileCabinetOrder());
        rollout.innerHTML = '';
        rollout.appendChild(buildFileCabinetRolloutStack({
            catName,
            items: sorted,
            activeCategories: ctx.activeCategories,
            UI: ctx.UI
        }));
        rollout.setAttribute('aria-hidden', 'false');
        slot.classList.add('is-fold-rollout-open');
        chip?.classList.add('is-fold-preview-source');
        mount.classList.add('is-rollout-active');
    };

    const maybeHidePreview = (relatedTarget) => {
        if (isInsidePreviewZone(relatedTarget)) return;
        if (pinnedByDrag || dragMode) return;
        if (document.body.classList.contains('is-file-cabinet-drag-active')) return;
        hidePreview();
    };

    mount.addEventListener('pointerover', (e) => {
        const slot = e.target.closest('.file-cabinet-filed-slot');
        if (!slot || !mount.contains(slot)) return;
        if (e.relatedTarget && slot.contains(e.relatedTarget)) return;
        if (document.body.classList.contains('is-file-cabinet-drag-active') && !dragMode) return;
        showPreview(slot, { duringDrag: dragMode });
    }, { signal });

    mount.addEventListener('pointerout', (e) => {
        const slot = e.target.closest('.file-cabinet-filed-slot');
        const fromRollout = e.target.closest('.file-cabinet-filed-rollout');
        if (!slot && !fromRollout) return;
        maybeHidePreview(e.relatedTarget);
    }, { signal });

    mount.addEventListener('focusin', (e) => {
        const slot = e.target.closest('.file-cabinet-filed-slot');
        if (!slot) return;
        showPreview(slot);
    }, { signal });

    mount.addEventListener('focusout', (e) => {
        const slot = e.target.closest('.file-cabinet-filed-slot');
        const fromRollout = e.target.closest('.file-cabinet-filed-rollout');
        if (!slot && !fromRollout) return;
        requestAnimationFrame(() => {
            if (isInsidePreviewZone(document.activeElement)) return;
            if (pinnedByDrag || dragMode) return;
            if (document.body.classList.contains('is-file-cabinet-drag-active')) return;
            hidePreview();
        });
    }, { signal });

    return {
        onDragStart(stack) {
            dragMode = true;
            if (stack?.closest('.file-cabinet-filed-rollout')) pinnedByDrag = true;
        },
        onDragEnd() {
            const wasPinned = pinnedByDrag;
            pinnedByDrag = false;
            dragMode = false;
            if (wasPinned) hidePreview(true);
            else hidePreview(true);
        },
        showPreviewDuringDrag(slot) {
            dragMode = true;
            if (slot) showPreview(slot, { duringDrag: true });
        },
        hidePreview
    };
}

export function renderFileCabinet(mount, filedItems, activeCategories, UI) {
    if (!mount) return;
    mount.innerHTML = '';

    if (!filedItems.length) {
        mount.innerHTML = '<div class="file-cabinet-empty">No filed notes — use File away on a note to add tabs here.</div>';
        mount.style.minHeight = '';
        mount.style.maxHeight = '';
        delete mount.__fcPreviewContext;
        refreshFileCabinetUiScale(mount);
        return;
    }

    const order = getFileCabinetOrder();
    const byCategory = new Map();
    filedItems.forEach((item) => {
        const cat = getItemCategoryName(item);
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(item);
    });

    const allCategories = applyFileCabinetCategoryOrder((() => {
        const cats = [...byCategory.keys()];
        const boardSort = readBoardSort();
        if (boardSort.field === 'category') {
            const dir = boardSort.dir === 'asc' ? 1 : -1;
            return cats.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }) * dir);
        }
        return cats.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    })());
    const filedCategoryNames = applyFileCabinetCategoryOrder(
        getFileCabinetFiledCategories().filter((c) => byCategory.has(c))
    );
    const visibleCategories = allCategories.filter((c) => !isFileCabinetCategoryFiled(c));
    const hasRail = filedCategoryNames.length > 0;

    mount.__fcPreviewContext = {
        byCategory,
        activeCategories,
        order,
        UI
    };

    const inner = document.createElement('div');
    inner.className = 'file-cabinet-inner';

    if (hasRail) {
        const rail = document.createElement('aside');
        rail.className = 'file-cabinet-filed-rail';
        rail.setAttribute('aria-label', 'Folded categories');

        filedCategoryNames.forEach((catName) => {
            const items = byCategory.get(catName) || [];
            const color = resolveCategoryColor(catName, activeCategories);

            const slot = document.createElement('div');
            slot.className = 'file-cabinet-filed-slot';
            slot.dataset.category = catName;
            // Set on the slot so chip + hover rollout both inherit the tint
            // (rollout is a sibling of the chip, not a child).
            slot.style.setProperty('--card-category-color', color);
            slot.style.setProperty('--file-cabinet-category-color', color);

            const chip = document.createElement('div');
            chip.className = 'file-cabinet-filed-chip';
            chip.dataset.category = catName;

            const canRename = !isUncategorizedCategory(catName);
            const chipNameAttrs = canRename
                ? ' class="file-cabinet-filed-chip-name u-truncate card-inline-edit" contenteditable="plaintext-only" spellcheck="false" data-placeholder="Category…"'
                : ' class="file-cabinet-filed-chip-name u-truncate"';
            chip.innerHTML = `<span class="file-cabinet-category-dot" style="background:${escapeAttr(color)}"></span><span${chipNameAttrs}>${escapeHTML(catName)} (${items.length})</span><button type="button" class="card-act file-cabinet-filed-chip-grab grab-handle grab-handle--col" title="Drag to reorder category" aria-label="Drag to reorder category">${CARD_ICONS.drag}</button><button type="button" class="card-act file-cabinet-filed-chip-expand" title="Expand category" aria-label="Expand category">${EXPAND_ICON}</button>`;

            const rollout = document.createElement('div');
            rollout.className = 'file-cabinet-filed-rollout';
            rollout.setAttribute('aria-hidden', 'true');

            slot.appendChild(chip);
            slot.appendChild(rollout);
            rail.appendChild(slot);
        });

        inner.appendChild(rail);
    }

    const row = document.createElement('div');
    row.className = 'file-cabinet-row';

    visibleCategories.forEach((catName) => {
        const items = sortItemsByFileCabinetOrder(byCategory.get(catName), catName, order);
        row.appendChild(buildFileCabinetCategoryColumn({
            catName,
            items,
            activeCategories,
            UI,
            showFoldButton: true,
            showGrabButton: true
        }));
    });

    inner.appendChild(row);
    mount.appendChild(inner);
    refreshFileCabinetUiScale(mount);
}

export function initFileCabinetCategoryActions(mount, signal) {
    if (!mount || !signal) return;

    const nameSelector = '.file-cabinet-category-name.card-inline-edit, .file-cabinet-filed-chip-name.card-inline-edit';

    const commitNameEdit = (nameEl, { revert = false } = {}) => {
        if (!nameEl || nameEl.dataset.renaming !== '1') return;
        const oldName = nameEl.dataset.renameFrom || '';
        const displayBefore = nameEl.dataset.renameDisplay || oldName;
        delete nameEl.dataset.renaming;
        delete nameEl.dataset.renameFrom;
        delete nameEl.dataset.renameDisplay;

        if (revert || isUncategorizedCategory(oldName)) {
            nameEl.textContent = displayBefore;
            return;
        }

        let next = (nameEl.textContent || '').trim();
        if (nameEl.classList.contains('file-cabinet-filed-chip-name')) {
            next = next.replace(/\s*\(\d+\)\s*$/, '').trim();
        }
        if (!next || next === oldName) {
            nameEl.textContent = displayBefore;
            return;
        }
        const result = renameCategory(oldName, next);
        if (!result.ok) {
            alert(result.error || 'Could not rename category.');
            nameEl.textContent = displayBefore;
        }
        // category:renamed listener handles item patch + FC re-render
    };

    mount.addEventListener('focusin', (e) => {
        const nameEl = e.target.closest?.(nameSelector);
        if (!nameEl || !mount.contains(nameEl) || nameEl.dataset.renaming === '1') return;
        const host = nameEl.closest('.file-cabinet-category, .file-cabinet-filed-chip');
        const cat = host?.dataset.category;
        if (!cat || isUncategorizedCategory(cat)) return;
        nameEl.dataset.renaming = '1';
        nameEl.dataset.renameFrom = cat;
        nameEl.dataset.renameDisplay = nameEl.textContent || cat;
        if (nameEl.classList.contains('file-cabinet-filed-chip-name')) {
            nameEl.textContent = cat;
        }
    }, { signal });

    mount.addEventListener('keydown', (e) => {
        const nameEl = e.target.closest?.(nameSelector);
        if (!nameEl || !mount.contains(nameEl)) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            nameEl.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            commitNameEdit(nameEl, { revert: true });
            nameEl.blur();
        }
    }, { signal });

    mount.addEventListener('focusout', (e) => {
        const nameEl = e.target.closest?.(nameSelector);
        if (!nameEl || !mount.contains(nameEl)) return;
        // Defer so Escape can set revert before blur commit
        queueMicrotask(() => commitNameEdit(nameEl));
    }, { signal });

    mount.addEventListener('mousedown', (e) => {
        const nameEl = e.target.closest?.(nameSelector);
        if (nameEl && mount.contains(nameEl)) {
            e.stopPropagation();
        }
    }, { signal });

    mount.addEventListener('click', (e) => {
        const foldBtn = e.target.closest('.file-cabinet-category-fold-btn');
        if (foldBtn) {
            e.preventDefault();
            e.stopPropagation();
            const col = foldBtn.closest('.file-cabinet-category');
            const cat = col?.dataset.category;
            if (cat) {
                toggleFileCabinetCategoryFiled(cat);
                window.dispatchEvent(new CustomEvent('filecabinet:layout_changed', { detail: { flushLayout: false } }));
            }
            return;
        }
        const expandBtn = e.target.closest('.file-cabinet-filed-chip-expand');
        if (expandBtn) {
            e.preventDefault();
            e.stopPropagation();
            const chip = expandBtn.closest('.file-cabinet-filed-chip');
            const cat = chip?.dataset.category;
            if (cat) {
                toggleFileCabinetCategoryFiled(cat);
                window.dispatchEvent(new CustomEvent('filecabinet:layout_changed', { detail: { flushLayout: false } }));
            }
        }
    }, { signal });
}

function createCategoryChipGhost(dragEl) {
    const cat = dragEl.dataset.category || 'Uncategorized';
    const nameEl = dragEl.querySelector('.file-cabinet-category-name, .file-cabinet-filed-chip-name');
    let name = nameEl?.textContent?.trim() || cat;
    name = name.replace(/\s*\(\d+\)\s*$/, '').trim() || cat;
    const countEl = dragEl.querySelector('.file-cabinet-category-count');
    const count = countEl?.textContent?.trim()
        || (nameEl?.textContent?.match(/\((\d+)\)/)?.[1] ?? '');
    const dot = dragEl.querySelector('.file-cabinet-category-dot');
    const color = dragEl.style.getPropertyValue('--file-cabinet-category-color')?.trim()
        || dragEl.style.getPropertyValue('--card-category-color')?.trim()
        || dot?.style?.background
        || 'var(--accent-color)';

    const ghost = document.createElement('div');
    ghost.className = 'file-cabinet-category-chip-ghost';
    ghost.style.setProperty('--card-category-color', color);
    ghost.innerHTML = `<span class="file-cabinet-category-dot" style="background:${escapeAttr(color)}"></span><span class="file-cabinet-category-chip-ghost-name u-truncate">${escapeHTML(name)}${count ? ` (${escapeHTML(count)})` : ''}</span>`;
    return ghost;
}

function collectFileCabinetCategoryNoteIds(mount, category, items, activeDesktop) {
    if (!category) return [];
    const col = mount?.querySelector(`.file-cabinet-category[data-category="${CSS.escape(category)}"]`);
    if (col) {
        return [...col.querySelectorAll('.file-cabinet-tab')]
            .map((tab) => tab.dataset.id)
            .filter(Boolean);
    }
    const order = getFileCabinetOrder()[category] || [];
    const byId = new Map((items || []).map((item) => [item.id, item]));
    return order.filter((id) => {
        const item = byId.get(id);
        return item && (item.desktopId || 1) === activeDesktop;
    });
}

function assignFileCabinetItemsToDesktop(itemIds, targetDesktopId, items) {
    const byId = new Map((items || []).map((item) => [item.id, item]));
    let changed = false;
    (itemIds || []).forEach((id) => {
        const item = byId.get(id);
        if (!item) return;
        const current = item.desktopId || 1;
        if (current === targetDesktopId) return;
        DesktopManager.assignNoteToDesktop(item, targetDesktopId);
        changed = true;
    });
    if (changed) {
        window.dispatchEvent(new CustomEvent('desktop:changed', {
            detail: { desktopId: DesktopManager.getActiveDesktop() }
        }));
    }
    return changed;
}

function initFileCabinetCategoryColumnDrag(mount, getItems, signal) {
    if (!mount || !signal) return;

    mount.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const grab = e.target.closest('.file-cabinet-category-grab-btn, .file-cabinet-filed-chip-grab');
        if (!grab || !mount.contains(grab)) return;

        const col = grab.closest('.file-cabinet-category');
        const slot = grab.closest('.file-cabinet-filed-slot');
        const dragEl = col || slot;
        if (!dragEl) return;

        e.preventDefault();
        e.stopPropagation();

        const parent = col
            ? mount.querySelector('.file-cabinet-row')
            : mount.querySelector('.file-cabinet-filed-rail');
        if (!parent) return;

        const siblings = [...parent.children];
        const startIndex = siblings.indexOf(dragEl);
        if (startIndex < 0) return;
        const category = dragEl.dataset.category || 'Uncategorized';

        const startX = e.clientX;
        const startY = e.clientY;
        let active = false;
        let placeholder = null;
        let ghost = null;
        let offsetX = 0;
        let offsetY = 0;

        const onMove = (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (!active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

            if (!active) {
                active = true;
                // Measure WHILE still in the row — never after reparenting.
                const rect = dragEl.getBoundingClientRect();
                offsetX = Math.min(Math.max(8, ev.clientX - rect.left), Math.max(16, rect.width - 8));
                offsetY = Math.min(Math.max(8, ev.clientY - rect.top), 18);

                placeholder = document.createElement('div');
                placeholder.className = col
                    ? 'file-cabinet-category-placeholder'
                    : 'file-cabinet-filed-slot-placeholder';
                placeholder.style.width = `${rect.width}px`;
                placeholder.style.height = `${rect.height}px`;
                placeholder.style.minWidth = `${rect.width}px`;
                placeholder.style.flex = '0 0 auto';
                placeholder.dataset.category = dragEl.dataset.category || '';
                parent.insertBefore(placeholder, dragEl);
                dragEl.remove();

                ghost = createCategoryChipGhost(dragEl);
                document.body.appendChild(ghost);
                ghost.style.position = 'fixed';
                ghost.style.left = `${ev.clientX - offsetX}px`;
                ghost.style.top = `${ev.clientY - offsetY}px`;
                ghost.style.zIndex = '10000';
                ghost.style.pointerEvents = 'none';
                document.body.classList.add('is-file-cabinet-drag-active');
                try { grab.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
            }

            if (!ghost) return;
            ghost.style.left = `${ev.clientX - offsetX}px`;
            ghost.style.top = `${ev.clientY - offsetY}px`;

            const dockButtons = setDesktopDockDragHighlight(ev.clientX, ev.clientY);
            if (dockButtons.length > 0) return;

            const hit = document.elementFromPoint(ev.clientX, ev.clientY);
            const over = col
                ? hit?.closest?.('.file-cabinet-category, .file-cabinet-category-placeholder')
                : hit?.closest?.('.file-cabinet-filed-slot, .file-cabinet-filed-slot-placeholder');
            if (!over || over === placeholder || over === dragEl) return;
            if (!parent.contains(over) && over !== placeholder) return;

            const overRect = over.getBoundingClientRect();
            const before = col
                ? ev.clientX < overRect.left + overRect.width / 2
                : ev.clientY < overRect.top + overRect.height / 2;
            if (before) parent.insertBefore(placeholder, over);
            else parent.insertBefore(placeholder, over.nextSibling);
        };

        const onUp = (ev) => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            try { grab.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }

            document.body.classList.remove('is-file-cabinet-drag-active');
            clearDesktopDockDragHighlight();
            ghost?.remove();
            ghost = null;

            const dockButtons = getDockButtonAt(ev.clientX, ev.clientY);
            const targetDesktopId = dockButtons.length
                ? Number(dockButtons[0].dataset.desktopId)
                : null;
            const activeDesktop = DesktopManager.getActiveDesktop();

            if (
                active
                && Number.isInteger(targetDesktopId)
                && targetDesktopId !== activeDesktop
            ) {
                const items = typeof getItems === 'function' ? getItems() : [];
                const itemIds = collectFileCabinetCategoryNoteIds(mount, category, items, activeDesktop);
                if (placeholder?.parentNode) {
                    placeholder.parentNode.insertBefore(dragEl, placeholder);
                    placeholder.remove();
                } else if (!dragEl.isConnected) {
                    parent.appendChild(dragEl);
                }
                assignFileCabinetItemsToDesktop(itemIds, targetDesktopId, items);
                return;
            }

            if (!active || !placeholder?.parentNode) {
                if (placeholder?.parentNode) {
                    placeholder.parentNode.insertBefore(dragEl, placeholder);
                    placeholder.remove();
                } else if (!dragEl.isConnected) {
                    parent.appendChild(dragEl);
                }
                return;
            }

            placeholder.parentNode.insertBefore(dragEl, placeholder);
            placeholder.remove();
            persistFileCabinetCategoryOrderFromDom(mount);
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    }, { signal });
}

/**
 * @param {HTMLElement} mount
 * @param {Array|Function} currentItemsOrGetter - items array or () => items
 * @param {Object} UI
 * @param {AbortSignal} signal
 */
export function initFileCabinetDrag(mount, currentItemsOrGetter = [], UI, signal) {
    if (!mount || !signal) return;

    const getItems = typeof currentItemsOrGetter === 'function'
        ? currentItemsOrGetter
        : () => currentItemsOrGetter || [];

    initFileCabinetCategoryActions(mount, signal);
    initFileCabinetCategoryColumnDrag(mount, getItems, signal);

    const foldedHoverPreview = initFileCabinetFoldedHoverPreview(
        mount,
        () => mount.__fcPreviewContext,
        signal
    );

    const itemsById = () => new Map(getItems().map((item) => [item.id, item]));
    let dragState = null;
    let previewFrame = null;

    const cancelPreviewFrame = () => {
        if (!previewFrame) return;
        cancelAnimationFrame(previewFrame);
        previewFrame = null;
    };

    const restorePreviewFromState = (state) => {
        restoreStackPreview(state.sourceStack, state.sourceBaseline);
        if (state.targetStack && state.targetStack !== state.sourceStack) {
            restoreStackPreview(state.targetStack, state.targetBaseline);
        }
    };

    const applyPreviewAt = (clientX, clientY) => {
        if (!dragState?.active) return null;
        const dockButtons = setDesktopDockDragHighlight(clientX, clientY);
        if (dockButtons.length > 0) {
            restorePreviewFromState(dragState);
            clearFileCabinetDropTargets(mount);
            if (dragState.targetStack && dragState.targetStack !== dragState.sourceStack) {
                dragState.targetStack = null;
                dragState.targetBaseline = null;
            }
            dragState.currentTarget = { kind: 'desktop-dock' };
            return dragState.currentTarget;
        }

        const canvas = document.getElementById('app-canvas');
        const target = resolveCrossSurfaceDropTarget(clientX, clientY, {
            dragKind: 'fc-tab',
            mount,
            canvas,
            dragState
        });
        dragState.currentTarget = target;
        setFileCabinetDropTarget(mount, target);

        if (target?.kind === 'file-cabinet' && target.isFolded && target.targetChip) {
            const slot = target.targetChip.closest('.file-cabinet-filed-slot');
            foldedHoverPreview?.showPreviewDuringDrag(slot);
            const refreshed = resolveFileCabinetDropTarget(clientX, clientY, dragState, mount)
                || resolveNearestFileCabinetCategory(clientX, clientY, dragState, mount);
            if (refreshed?.targetStack) {
                Object.assign(target, refreshed);
                dragState.currentTarget = target;
                setFileCabinetDropTarget(mount, target);
            }
        }

        const draggedId = dragState.card.dataset.id;
        const sourceMinSlots = dragState.sourceTabCount || 0;
        const sameStack = target?.kind === 'file-cabinet'
            && target.targetStack
            && target.targetStack === dragState.sourceStack;
        const crossStack = target?.kind === 'file-cabinet'
            && target.targetStack
            && target.targetStack !== dragState.sourceStack;

        // Single preview pass — never collapse-then-reopen the same stack in one frame.
        if (sameStack) {
            applyStackPreviewPositions(dragState.sourceStack, {
                draggedId,
                insertIndex: target.insertIndex,
                settling: true,
                minSlotCount: sourceMinSlots
            });
            if (dragState.targetStack && dragState.targetStack !== dragState.sourceStack) {
                restoreStackPreview(dragState.targetStack, dragState.targetBaseline);
                dragState.targetStack = null;
                dragState.targetBaseline = null;
            }
        } else {
            applyStackPreviewPositions(dragState.sourceStack, {
                draggedId,
                insertIndex: null,
                settling: true,
                minSlotCount: sourceMinSlots
            });

            if (crossStack) {
                if (dragState.targetStack !== target.targetStack) {
                    if (dragState.targetStack && dragState.targetBaseline) {
                        restoreStackPreview(dragState.targetStack, dragState.targetBaseline);
                    }
                    dragState.targetStack = target.targetStack;
                    dragState.targetBaseline = snapshotStackTabs(target.targetStack);
                }
                applyStackPreviewPositions(target.targetStack, {
                    draggedId,
                    insertIndex: target.insertIndex,
                    settling: true
                });
            } else if (dragState.targetStack && dragState.targetStack !== dragState.sourceStack) {
                restoreStackPreview(dragState.targetStack, dragState.targetBaseline);
                dragState.targetStack = null;
                dragState.targetBaseline = null;
            }
        }

        autoScrollFileCabinetInner(mount, clientX);

        const slotKey = `${dragState.sourceStack?.querySelectorAll('.file-cabinet-tab').length || 0}:${target?.targetStack?.querySelectorAll('.file-cabinet-tab').length || 0}:${target?.insertIndex ?? ''}`;
        if (dragState._lastSlotKey !== slotKey) {
            dragState._lastSlotKey = slotKey;
            syncFileCabinetDrawerHeight(mount);
        }
        return target;
    };

    const runPreview = (clientX, clientY) => {
        if (!dragState?.active) return;
        dragState.lastX = clientX;
        dragState.lastY = clientY;
        if (previewFrame) return;
        previewFrame = requestAnimationFrame(() => {
            previewFrame = null;
            if (!dragState?.active) return;
            applyPreviewAt(dragState.lastX, dragState.lastY);
        });
    };

    const moveTabDomToCategory = (state, toCategory, toIndex, target) => {
        let destStack = target?.targetStack;
        if (!destStack) {
            destStack = mount.querySelector(
                `.file-cabinet-category[data-category="${CSS.escape(toCategory)}"] .file-cabinet-tab-stack`
            );
        }
        if (!destStack) return false;

        const destTabs = [...destStack.querySelectorAll('.file-cabinet-tab')]
            .filter((t) => t !== state.card);
        if (toIndex >= destTabs.length) destStack.appendChild(state.card);
        else destStack.insertBefore(state.card, destTabs[toIndex]);

        state.card.dataset.fileCabinetCategory = toCategory;
        const colorHost = destStack.closest('.file-cabinet-category');
        const color = colorHost?.style.getPropertyValue('--file-cabinet-category-color');
        if (color) {
            state.card.style.setProperty('--card-category-color', color);
            state.card.style.setProperty('--file-cabinet-category-color', color);
        }
        applyFileCabinetStackPositions(state.sourceStack);
        applyFileCabinetStackPositions(destStack);
        updateFileCabinetCategoryCount(mount, state.sourceCategory);
        updateFileCabinetCategoryCount(mount, toCategory);

        if (!state.sourceStack.querySelector('.file-cabinet-tab')) {
            const emptyCol = state.sourceStack.closest('.file-cabinet-category');
            emptyCol?.remove();
            return 'structural';
        }
        return true;
    };

    const finishDrag = (e) => {
        if (!dragState) return;
        const state = dragState;
        dragState = null;

        cancelPreviewFrame();

        if (!state.active) {
            document.body.classList.remove('is-file-cabinet-drag-active');
            mount.classList.remove('is-layout-active');
            clearFileCabinetDropTargets(mount);
            clearDesktopDockDragHighlight();
            foldedHoverPreview?.onDragEnd();
            resetDraggedTabStyles(state.card, state.sourceStack);
            return;
        }

        clearDesktopDockDragHighlight();

        const dockButtons = getDockButtonAt(e.clientX, e.clientY);
        const targetDesktopId = dockButtons.length
            ? Number(dockButtons[0].dataset.desktopId)
            : null;

        // Always resolve fresh at drop — never trust stale rAF currentTarget.
        const canvas = document.getElementById('app-canvas');
        const target = resolveCrossSurfaceDropTarget(e.clientX, e.clientY, {
            dragKind: 'fc-tab',
            mount,
            canvas,
            dragState: state
        });

        restorePreviewFromState(state);
        clearFileCabinetDropTargets(mount);
        document.body.classList.remove('is-file-cabinet-drag-active');
        mount.classList.remove('is-layout-active');
        foldedHoverPreview?.onDragEnd();

        const fromCategory = state.sourceCategory;
        const itemId = state.card.dataset.id;
        const item = itemsById().get(itemId) || UI?.resolveBoardItem?.(itemId);

        if (!itemId) {
            endFileCabinetDragGhost(state.card, state.placeholder);
            resetDraggedTabStyles(state.card, state.sourceStack);
            syncFileCabinetDrawerHeight(mount);
            return;
        }

        // FC tab → desktop dock (stay filed on target desktop)
        if (Number.isInteger(targetDesktopId)) {
            const currentDesktop = item?.desktopId || 1;
            endFileCabinetDragGhost(state.card, state.placeholder);
            resetDraggedTabStyles(state.card, state.sourceStack);
            if (targetDesktopId !== currentDesktop && item) {
                DesktopManager.assignNoteToDesktop(item, targetDesktopId);
                window.dispatchEvent(new CustomEvent('desktop:changed', {
                    detail: { desktopId: DesktopManager.getActiveDesktop() }
                }));
            }
            syncFileCabinetDrawerHeight(mount);
            return;
        }

        // FC tab → board
        if (target?.kind === 'board') {
            endFileCabinetDragGhost(state.card, state.placeholder);
            resetDraggedTabStyles(state.card, state.sourceStack);
            expandFileCabinetItemToBoard({
                item,
                dropX: e.clientX,
                dropY: e.clientY,
                UI,
                card: state.card
            });
            return;
        }

        if (!target || target.kind !== 'file-cabinet' || target.isMountOnly || !target.targetCategory) {
            endFileCabinetDragGhost(state.card, state.placeholder);
            resetDraggedTabStyles(state.card, state.sourceStack);
            flashFileCabinetDropRejected(state.card);
            syncFileCabinetDrawerHeight(mount);
            return;
        }

        const toCategory = target.targetCategory || 'Uncategorized';
        const toIndex = target.insertIndex ?? 0;

        endFileCabinetDragGhost(state.card, state.placeholder);

        if (fromCategory === toCategory) {
            const tabs = [...state.sourceStack.querySelectorAll('.file-cabinet-tab')];
            const startIndex = state.startIndex;
            const finalIndex = Math.max(0, Math.min(tabs.length - 1, toIndex));

            resetDraggedTabStyles(state.card, state.sourceStack);

            if (finalIndex !== startIndex) {
                reorderInCategory(fromCategory, startIndex, finalIndex);
                const moved = tabs.splice(startIndex, 1)[0];
                tabs.splice(finalIndex, 0, moved);
                tabs.forEach((tab) => state.sourceStack.appendChild(tab));
            }
            applyFileCabinetStackPositions(state.sourceStack);
            syncFileCabinetDrawerHeight(mount);
            return;
        }

        moveItemBetweenCategories({
            itemId,
            fromCategory,
            toCategory,
            toIndex,
            item,
            UI
        });

        // Folded chip without an open stack needs a full re-render.
        if (target.isFolded && !target.targetStack) {
            resetDraggedTabStyles(state.card, state.sourceStack);
            window.dispatchEvent(new CustomEvent('filecabinet:layout_changed', { detail: { flushLayout: false } }));
            return;
        }

        const moved = moveTabDomToCategory(state, toCategory, toIndex, target);
        resetDraggedTabStyles(state.card, state.sourceStack);
        if (moved === 'structural' || moved === false) {
            window.dispatchEvent(new CustomEvent('filecabinet:layout_changed', { detail: { flushLayout: false } }));
            return;
        }
        syncFileCabinetDrawerHeight(mount);
    };

    mount.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        // Restrict tab drag to the dedicated grab handle.
        const handle = e.target.closest('.card-act--drag');
        if (!handle) return;
        const card = handle.closest('.file-cabinet-tab');
        if (!card || !mount.contains(card)) return;
        const stack = card.closest('.file-cabinet-tab-stack');
        if (!stack) return;

        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startY = e.clientY;
        const tabs = [...stack.querySelectorAll('.file-cabinet-tab')];
        const startIndex = tabs.indexOf(card);
        if (startIndex < 0) return;

        const onMove = (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (!dragState?.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

            if (!dragState) {
                ev.preventDefault();
                window.getSelection?.()?.removeAllRanges?.();
                card.querySelector('.card-inline-edit:focus')?.blur?.();
                const rect = card.getBoundingClientRect();
                const colorHost = card.closest('.file-cabinet-category')
                    || card.closest('.file-cabinet-tab-stack');
                if (colorHost) {
                    card.style.setProperty(
                        '--file-cabinet-category-color',
                        colorHost.style.getPropertyValue('--file-cabinet-category-color')
                    );
                }
                const sourceBaseline = snapshotStackTabs(stack);
                const placeholder = beginFileCabinetDragGhost(card, stack);
                dragState = {
                    active: true,
                    card,
                    sourceStack: stack,
                    sourceCategory: stack.dataset.category || 'Uncategorized',
                    startIndex,
                    sourceTabCount: tabs.length,
                    sourceBaseline,
                    targetStack: null,
                    targetBaseline: null,
                    currentTarget: null,
                    placeholder,
                    fixedOffsetX: startX - rect.left,
                    fixedOffsetY: startY - rect.top
                };
                card.classList.add('is-file-cabinet-dragging');
                card.style.pointerEvents = 'none';
                document.body.classList.add('is-file-cabinet-drag-active');
                mount.classList.add('is-layout-active');
                card.style.position = 'fixed';
                card.style.left = `${rect.left}px`;
                card.style.top = `${rect.top}px`;
                card.style.width = `${rect.width}px`;
                card.style.height = `${rect.height}px`;
                card.style.margin = '0';
                card.style.zIndex = '9999';
                foldedHoverPreview?.onDragStart(stack);
            }

            card.style.left = `${ev.clientX - dragState.fixedOffsetX}px`;
            card.style.top = `${ev.clientY - dragState.fixedOffsetY}px`;
            runPreview(ev.clientX, ev.clientY);
        };

        function onKey(ev) {
            if (ev.key !== 'Escape' || !dragState) return;
            cancelPreviewFrame();
            const state = dragState;
            dragState = null;
            if (state.active) {
                restorePreviewFromState(state);
                endFileCabinetDragGhost(state.card, state.placeholder);
            }
            clearFileCabinetDropTargets(mount);
            clearDesktopDockDragHighlight();
            document.body.classList.remove('is-file-cabinet-drag-active');
            mount.classList.remove('is-layout-active');
            foldedHoverPreview?.onDragEnd();
            resetDraggedTabStyles(state.card, state.sourceStack);
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            document.removeEventListener('keydown', onKey);
        }

        function onUp(ev) {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            document.removeEventListener('keydown', onKey);
            if (!dragState) {
                dragState = {
                    active: false,
                    card,
                    sourceStack: stack,
                    sourceCategory: stack.dataset.category || 'Uncategorized',
                    startIndex
                };
            }
            finishDrag(ev);
        }

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
        document.addEventListener('keydown', onKey);
    }, { signal });
}

export function getFileCabinetToggleLabels(inFileCabinetStrip, atLabel) {
    if (inFileCabinetStrip || atLabel) {
        return { title: 'Open below', iconKey: 'expand' };
    }
    return { title: 'File away', iconKey: 'collapse' };
}

/**
 * Applies file cabinet zone toggle - moves item to/from file cabinet
 * @param {HTMLElement} card - The card element
 * @param {Object} item - The item
 * @param {Object} ctx - Context options
 * @param {Object} UI - The UI object with helper methods
 */
export function applyFileCabinetZoneToggle(card, item, ctx = {}, UI) {
    if (!UI) return;
    const inFileCabinet = !!card.closest('#file-cabinet');

    if (inFileCabinet) {
        removeFromFileCabinetOrder(item.id);
        let rect = UI.resolveBoardExpandRect(card, item);
        const savedGrid = UI.getGridLayout()[item.id];
        const savedPos = UI.getFreeformPositions()[item.id];
        const x = savedGrid?.x ?? savedPos?.x ?? 8;
        const y = savedGrid?.y ?? savedPos?.y ?? 8;
        rect = { x, y, w: rect.w, h: rect.h };
        UI.saveGridLayout(item.id, rect, { updateRemembered: true });
    } else {
        const pos = UI.readNoteRect(card);
        fileItemToCabinet(item, UI.activeBoardViewMode, UI, {
            x: pos.x ?? 8,
            y: pos.y ?? 8,
            rememberW: pos.w,
            rememberH: pos.h
        });
    }

    window.dispatchEvent(new CustomEvent('board:visibility_changed', { detail: { flushLayout: false } }));
}

/**
 * Saves layout for a filed cabinet item
 * @param {string} itemId - The item ID
 * @param {Object} rect - The rectangle with x, y, w, h
 * @param {string} sortBy - The sort mode
 */
export function saveFiledCabinetLayout(itemId, rect, sortBy) {
    if (!itemId || !rect) return;
    const mode = normalizeViewMode(sortBy);
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

/**
 * Resets file cabinet layout for items
 * @param {string} sortBy - The sort mode
 * @param {Array} items - Items to reset
 * @param {Object} UI - The UI object
 */
export function resetFileCabinetLayout(sortBy, items, UI) {
    const visibleItems = BoardOperations.getVisibleItems(items || []);
    const mode = normalizeViewMode(sortBy);

    const boardItems = visibleItems;
    const { expanded } = partitionItemsForFileCabinet(boardItems, mode, UI);
    expanded.forEach((item) => {
        const savedGrid = UI.getGridLayout()[item.id];
        const savedPos = UI.getFreeformPositions()[item.id];
        fileItemToCabinet(item, mode, UI, {
            x: savedGrid?.x ?? savedPos?.x ?? 8,
            y: savedGrid?.y ?? savedPos?.y ?? 8
        });
    });
    window.dispatchEvent(new CustomEvent('board:visibility_changed', { detail: { flushLayout: false } }));
}
/**
 * Prepares board items for rendering, handling file cabinet partitioning
 * @param {Array} visibleItems - Items to prepare
 * @param {boolean} fileCabinetActive - Whether file cabinet is active
 * @param {string} resolvedMode - The current view mode
 * @param {Array} activeCategories - Active categories
 * @param {Object} UI - The UI object (for passing to partitionItemsForFileCabinet)
 * @returns {Object} Object with boardItems and fileCabinetMount
 */
export function prepareBoardItems(visibleItems, fileCabinetActive, resolvedMode, activeCategories, UI) {
    let boardItems = visibleItems;
    let fileCabinetMount = null;
    
    if (fileCabinetActive) {
        const { filed, expanded } = partitionItemsForFileCabinet(visibleItems, resolvedMode, UI);
        seedFileCabinetOrderFromItems(filed);
        fileCabinetMount = ensureFileCabinetMount(true);
        renderFileCabinet(fileCabinetMount, filed, activeCategories, UI);
        syncCabinetSplitter();
        boardItems = expanded;
    } else {
        ensureFileCabinetMount(false);
        syncCabinetSplitter();
    }
    
    return { boardItems, fileCabinetMount };
}
/**
 * Orchestrates file cabinet sorting for board layout.
 * Partitions items into filed/expanded, sorts filed items, and returns expanded items for board.
 * @param {Array} visibleItems - Items to sort
 * @param {string} mode - Layout mode ('grid' or 'freeform')
 * @param {Object} sortPrefs - Sorting preferences
 * @param {Object} UI - UI context (this)
 * @returns {Array} Expanded items for the board
 */
export function sortBoardLayoutWithFileCabinet(visibleItems, mode, sortPrefs, UI) {
    if (!visibleItems?.length) return [];
    
    const fcActive = isFileCabinetActive();
    if (!fcActive) return visibleItems;
    
    const { filed, expanded } = partitionItemsForFileCabinet(visibleItems, mode, UI);
    sortFileCabinetItems(filed, sortPrefs);
    return expanded;
}
