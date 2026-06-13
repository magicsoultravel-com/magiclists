import { getItemCategoryName } from './focusFilter.js';
import {
    isAtLabelSize,
    getLabelRect,
    isAtOrBelowCompactZone,
    getTileDefaultRect,
    resolveTileSize
} from './tileGeometry.js';

export const FILE_CABINET_KEY = 'matrix_file_cabinet';
export const FILE_CABINET_ORDER_KEY = 'matrix_file_cabinet_order';
export const FILE_CABINET_FILED_CATEGORIES_KEY = 'matrix_file_cabinet_filed_categories';

const FOLD_ICON = '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 7l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const EXPAND_ICON = '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const FILE_CABINET_TAB_WIDTH = 160;
export const FILE_CABINET_TAB_HEIGHT = 28;
export const FILE_CABINET_STACK_OFFSET_Y = 18;
export const FILE_CABINET_STACK_OFFSET_X = 10;
export const FILE_CABINET_DRAWER_HEADER_PAD = 48;

const DRAG_THRESHOLD = 4;

export function isFileCabinetActive() {
    return localStorage.getItem(FILE_CABINET_KEY) === 'true';
}

export function setFileCabinetActive(active) {
    localStorage.setItem(FILE_CABINET_KEY, active ? 'true' : 'false');
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
        const beforeItem = UI.snapshotItem(item);
        const updated = {
            ...item,
            categories: toCat === 'Uncategorized' ? [] : [toCat]
        };
        UI.emitItemMutation(updated, { preserveView: true, beforeItem, skipRerender: false });
        return true;
    }
    return fromCat !== toCat;
}

export function getStoredItemSize(itemId, sortBy, UI) {
    if (!itemId || !UI) return null;
    if (sortBy === 'freeform') {
        const sizes = UI.getFreeformSizes()[itemId];
        if (sizes && Number.isFinite(sizes.w) && Number.isFinite(sizes.h)) {
            return { w: sizes.w, h: sizes.h };
        }
        return null;
    }
    const layout = UI.getGridLayout()[itemId];
    if (layout && Number.isFinite(layout.w) && Number.isFinite(layout.h)) {
        return { w: layout.w, h: layout.h };
    }
    return null;
}

export function shouldFileItem(item, sortBy, UI) {
    const tileSize = resolveTileSize(item);
    const size = getStoredItemSize(item.id, sortBy, UI) ?? getTileDefaultRect(tileSize);
    return isAtOrBelowCompactZone(size.w, size.h, tileSize);
}

export function isItemFiled(item, sortBy, UI) {
    return shouldFileItem(item, sortBy, UI);
}

export function partitionItemsForFileCabinet(items, sortBy, UI) {
    const filed = [];
    const expanded = [];
    (items || []).forEach((item) => {
        if (shouldFileItem(item, sortBy, UI)) filed.push(item);
        else expanded.push(item);
    });
    return { filed, expanded };
}

export function fileAllItemsToCabinet(items, sortBy, UI) {
    const label = getLabelRect();
    const snapLayout = sortBy !== 'freeform';

    (items || []).forEach((item) => {
        if (!item?.id) return;

        const tileSize = resolveTileSize(item);
        const stored = getStoredItemSize(item.id, sortBy, UI) ?? getTileDefaultRect(tileSize);
        const savedGrid = UI.getGridLayout()[item.id];
        const savedPos = UI.getFreeformPositions()[item.id];
        const x = savedGrid?.x ?? savedPos?.x ?? 8;
        const y = savedGrid?.y ?? savedPos?.y ?? 8;

        if (stored && !isAtLabelSize(stored.w, stored.h)) {
            UI.persistRememberedSpatialSize(item.id, stored.w, stored.h, tileSize);
        }

        const filedRect = { x, y, w: label.w, h: label.h };
        if (snapLayout) {
            UI.saveGridLayout(item.id, filedRect, { updateRemembered: true });
        } else {
            UI.saveFreeformSize(item.id, filedRect.w, filedRect.h, { updateRemembered: true });
            UI.saveFreeformPosition(item.id, x, y);
        }

        addToFileCabinetOrder(getItemCategoryName(item), item.id);
    });

    seedFileCabinetOrderFromItems(items);
}

export function migrateItemsToFileCabinet(items, sortBy, UI) {
    const label = getLabelRect();
    const snapLayout = sortBy !== 'freeform';

    (items || []).forEach((item) => {
        if (!shouldFileItem(item, sortBy, UI)) return;

        const tileSize = resolveTileSize(item);
        const stored = getStoredItemSize(item.id, sortBy, UI);
        const savedGrid = UI.getGridLayout()[item.id];
        const savedPos = UI.getFreeformPositions()[item.id];
        const x = savedGrid?.x ?? savedPos?.x ?? 8;
        const y = savedGrid?.y ?? savedPos?.y ?? 8;

        if (stored && !isAtLabelSize(stored.w, stored.h)) {
            UI.persistRememberedSpatialSize(item.id, stored.w, stored.h, tileSize);
        }

        const filedRect = { x, y, w: label.w, h: label.h };
        if (snapLayout) {
            UI.saveGridLayout(item.id, filedRect, { updateRemembered: true });
        } else {
            UI.saveFreeformSize(item.id, filedRect.w, filedRect.h, { updateRemembered: true });
            UI.saveFreeformPosition(item.id, x, y);
        }

        addToFileCabinetOrder(getItemCategoryName(item), item.id);
    });

    const { filed } = partitionItemsForFileCabinet(items, sortBy, UI);
    seedFileCabinetOrderFromItems(filed);
}

export function reconcileFileCabinetOrderWithItems(filedItems) {
    const order = getFileCabinetOrder();
    const filedIds = new Set((filedItems || []).map((item) => item.id));
    let changed = false;

    Object.keys(order).forEach((cat) => {
        const next = (order[cat] || []).filter((id) => filedIds.has(id));
        if (next.length !== (order[cat] || []).length) {
            order[cat] = next;
            changed = true;
        }
        if (order[cat]?.length === 0) delete order[cat];
    });

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
        if (canvas) surface.insertBefore(el, canvas);
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
        if (!tab) return;
        tab.style.position = pos.position || 'absolute';
        tab.style.left = pos.left;
        tab.style.top = pos.top;
        tab.style.width = pos.width;
        tab.style.height = pos.height;
        tab.style.zIndex = pos.zIndex;
        tab.classList.remove('layout-settling', 'layout-preview');
    });
    applyFileCabinetStackPositions(stackEl);
}

function updateStackPreviewDimensions(stackEl, slotCount) {
    if (!stackEl) return;
    const label = getLabelRect();
    const count = Math.max(slotCount, 1);
    const stackWidth = FILE_CABINET_TAB_WIDTH + (count - 1) * FILE_CABINET_STACK_OFFSET_X;
    const stackHeight = label.h + (count - 1) * FILE_CABINET_STACK_OFFSET_Y;
    stackEl.style.width = `${stackWidth}px`;
    stackEl.style.height = `${Math.max(stackHeight, label.h)}px`;
    const col = stackEl.closest('.file-cabinet-category');
    if (col) {
        col.style.width = `${stackWidth}px`;
        col.style.minWidth = `${stackWidth}px`;
        col.style.flexBasis = `${stackWidth}px`;
    }
}

function applyStackPreviewPositions(stackEl, { draggedId, insertIndex = null, settling = true } = {}) {
    if (!stackEl) return;
    const tabs = [...stackEl.querySelectorAll('.file-cabinet-tab')].filter((t) => t.dataset.id !== draggedId);
    const label = getLabelRect();
    let visualIndex = 0;
    tabs.forEach((tab, i) => {
        if (insertIndex != null && i === insertIndex) visualIndex++;
        tab.style.position = 'absolute';
        tab.style.left = `${visualIndex * FILE_CABINET_STACK_OFFSET_X}px`;
        tab.style.top = `${visualIndex * FILE_CABINET_STACK_OFFSET_Y}px`;
        tab.style.width = `${FILE_CABINET_TAB_WIDTH}px`;
        tab.style.height = `${label.h}px`;
        tab.style.zIndex = String(visualIndex + 1);
        tab.classList.toggle('layout-settling', settling);
        tab.classList.toggle('layout-preview', settling);
        visualIndex++;
    });
    const slotCount = tabs.length + (insertIndex != null ? 1 : 0);
    updateStackPreviewDimensions(stackEl, slotCount);
}

function resolveFileCabinetDropTarget(clientX, clientY, dragState, mount) {
    if (!mount) return null;
    const prev = dragState?.card;
    if (prev) prev.style.pointerEvents = 'none';
    const el = document.elementFromPoint(clientX, clientY);
    if (prev) prev.style.pointerEvents = '';

    if (!el || !mount.contains(el)) return null;

    const chip = el.closest('.file-cabinet-filed-chip');
    if (chip) {
        const category = chip.dataset.category || 'Uncategorized';
        const order = getFileCabinetOrder();
        const count = (order[category] || []).filter((id) => id !== dragState?.card?.dataset?.id).length;
        return {
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
        return { targetStack: stack, targetCategory: category, insertIndex, isFolded: false };
    }

    const col = el.closest('.file-cabinet-category');
    if (col) {
        const category = col.dataset.category || 'Uncategorized';
        const stackEl = col.querySelector('.file-cabinet-tab-stack');
        return {
            targetStack: stackEl,
            targetCategory: category,
            insertIndex: 0,
            isFolded: false
        };
    }

    return null;
}

function clearFileCabinetDropTargets(mount) {
    mount?.querySelectorAll('.is-file-cabinet-drop-target').forEach((el) => {
        el.classList.remove('is-file-cabinet-drop-target');
    });
}

function setFileCabinetDropTarget(mount, target) {
    clearFileCabinetDropTargets(mount);
    if (!target) return;
    if (target.targetChip) {
        target.targetChip.classList.add('is-file-cabinet-drop-target');
        return;
    }
    const col = target.targetStack?.closest('.file-cabinet-category')
        || [...(mount?.querySelectorAll('.file-cabinet-category') || [])]
            .find((c) => c.dataset.category === target.targetCategory);
    col?.classList.add('is-file-cabinet-drop-target');
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
    const stackWidth = count > 0
        ? FILE_CABINET_TAB_WIDTH + (count - 1) * FILE_CABINET_STACK_OFFSET_X
        : FILE_CABINET_TAB_WIDTH;
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

    tabs.forEach((card, index) => {
        card.style.position = 'absolute';
        card.style.left = `${index * FILE_CABINET_STACK_OFFSET_X}px`;
        card.style.top = `${index * FILE_CABINET_STACK_OFFSET_Y}px`;
        card.style.width = `${FILE_CABINET_TAB_WIDTH}px`;
        card.style.height = `${label.h}px`;
        card.style.zIndex = String(index + 1);
        card.dataset.fileCabinetStackIndex = String(index);
    });
}

export function syncFileCabinetDrawerHeight(mount) {
    if (!mount) return;
    const label = getLabelRect();
    let maxStackH = label.h;
    mount.querySelectorAll('.file-cabinet-tab-stack').forEach((stack) => {
        maxStackH = Math.max(maxStackH, stack.offsetHeight || 0);
    });
    mount.style.minHeight = `${maxStackH + FILE_CABINET_DRAWER_HEADER_PAD}px`;
    mount.style.maxHeight = 'none';
}

export function renderFileCabinet(mount, filedItems, activeCategories, UI) {
    if (!mount) return;
    mount.innerHTML = '';

    if (!filedItems.length) {
        mount.innerHTML = '<div class="file-cabinet-empty">No filed notes — use File away on a note to add tabs here.</div>';
        mount.style.minHeight = '';
        mount.style.maxHeight = '';
        return;
    }

    const order = getFileCabinetOrder();
    const byCategory = new Map();
    filedItems.forEach((item) => {
        const cat = getItemCategoryName(item);
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(item);
    });

    const allCategories = [...byCategory.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const filedCategoryNames = getFileCabinetFiledCategories().filter((c) => byCategory.has(c));
    const visibleCategories = allCategories.filter((c) => !isFileCabinetCategoryFiled(c));
    const hasRail = filedCategoryNames.length > 0;
    const label = getLabelRect();

    let rowParent = mount;
    if (hasRail) {
        const inner = document.createElement('div');
        inner.className = 'file-cabinet-inner';

        const rail = document.createElement('aside');
        rail.className = 'file-cabinet-filed-rail';
        rail.setAttribute('aria-label', 'Folded categories');

        filedCategoryNames
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
            .forEach((catName) => {
                const items = byCategory.get(catName) || [];
                const matched = activeCategories.find((c) => c.name?.toLowerCase() === catName.toLowerCase());
                const color = matched?.color || '#64748b';

                const chip = document.createElement('div');
                chip.className = 'file-cabinet-filed-chip';
                chip.dataset.category = catName;
                chip.style.setProperty('--file-cabinet-category-color', color);
                chip.innerHTML = `<span class="file-cabinet-category-dot" style="background:${UI.escapeAttr(color)}"></span><span class="file-cabinet-filed-chip-name">${UI.escapeHTML(catName)}</span><span class="file-cabinet-filed-chip-count">${items.length}</span><button type="button" class="card-act file-cabinet-filed-chip-expand" title="Expand category" aria-label="Expand category">${EXPAND_ICON}</button>`;
                rail.appendChild(chip);
            });

        inner.appendChild(rail);
        rowParent = inner;
        mount.appendChild(inner);
    }

    const row = document.createElement('div');
    row.className = 'file-cabinet-row';

    visibleCategories.forEach((catName) => {
        const items = sortItemsByFileCabinetOrder(byCategory.get(catName), catName, order);
        const matched = activeCategories.find((c) => c.name?.toLowerCase() === catName.toLowerCase());
        const color = matched?.color || '#64748b';

        const col = document.createElement('div');
        col.className = 'file-cabinet-category';
        col.dataset.category = catName;
        col.style.setProperty('--file-cabinet-category-color', color);

        const header = document.createElement('div');
        header.className = 'file-cabinet-category-header';
        header.innerHTML = `<span class="file-cabinet-category-dot" style="background:${UI.escapeAttr(color)}"></span><span class="file-cabinet-category-name">${UI.escapeHTML(catName)}</span><span class="file-cabinet-category-count">${items.length}</span><button type="button" class="card-act file-cabinet-category-fold-btn" title="Fold category" aria-label="Fold category">${FOLD_ICON}</button>`;
        col.appendChild(header);

        const stack = document.createElement('div');
        stack.className = 'file-cabinet-tab-stack';
        stack.dataset.category = catName;

        items.forEach((item, index) => {
            const card = UI.createCardComponent(item, activeCategories, { desktop: true });
            card.classList.add('file-cabinet-tab');
            card.dataset.fileCabinetCategory = catName;
            card.dataset.fileCabinetStackIndex = String(index);
            UI.applyNoteRect(card, { x: 0, y: 0, w: label.w, h: label.h }, { settling: false });
            UI.applyDesktopTilePresentation(card, item);
            UI.finalizeDesktopCard(card);
            card.classList.add('spatial-at-small', 'tile-small');
            UI.syncSpatialToggleButton(card);
            stack.appendChild(card);
        });

        applyFileCabinetStackPositions(stack);
        col.appendChild(stack);
        row.appendChild(col);
    });

    rowParent.appendChild(row);
    syncFileCabinetDrawerHeight(mount);
}

export function initFileCabinetCategoryActions(mount, signal) {
    if (!mount || !signal) return;

    mount.addEventListener('click', (e) => {
        const foldBtn = e.target.closest('.file-cabinet-category-fold-btn');
        if (foldBtn) {
            e.preventDefault();
            e.stopPropagation();
            const col = foldBtn.closest('.file-cabinet-category');
            const cat = col?.dataset.category;
            if (cat) {
                toggleFileCabinetCategoryFiled(cat);
                window.dispatchEvent(new CustomEvent('filecabinet:layout_changed'));
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
                window.dispatchEvent(new CustomEvent('filecabinet:layout_changed'));
            }
        }
    }, { signal });
}

export function initFileCabinetDrag(mount, currentItems = [], UI, signal) {
    if (!mount || !signal) return;

    initFileCabinetCategoryActions(mount, signal);

    const itemsById = () => new Map((currentItems || []).map((item) => [item.id, item]));
    let dragState = null;
    let previewFrame = null;

    const restorePreviewFromState = (state) => {
        restoreStackPreview(state.sourceStack, state.sourceBaseline);
        if (state.targetStack && state.targetStack !== state.sourceStack) {
            restoreStackPreview(state.targetStack, state.targetBaseline);
        }
    };

    const finishDrag = (e) => {
        if (!dragState) return;
        const state = dragState;
        dragState = null;

        document.body.classList.remove('is-file-cabinet-drag-active');
        mount.classList.remove('is-layout-active');
        clearFileCabinetDropTargets(mount);

        if (!state.active) {
            if (state.sourceBaseline) restorePreviewFromState(state);
            resetDraggedTabStyles(state.card, state.sourceStack);
            return;
        }

        const target = state.currentTarget
            || resolveFileCabinetDropTarget(e.clientX, e.clientY, state, mount);
        const fromCategory = state.sourceCategory;
        const itemId = state.card.dataset.id;
        const item = itemsById().get(itemId);

        restorePreviewFromState(state);

        if (!target || !itemId) {
            resetDraggedTabStyles(state.card, state.sourceStack);
            syncFileCabinetDrawerHeight(mount);
            return;
        }

        const toCategory = target.targetCategory || 'Uncategorized';
        const toIndex = target.insertIndex ?? 0;

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
                applyFileCabinetStackPositions(state.sourceStack);
            } else {
                applyFileCabinetStackPositions(state.sourceStack);
            }
            syncFileCabinetDrawerHeight(mount);
            return;
        }

        resetDraggedTabStyles(state.card, state.sourceStack);
        moveItemBetweenCategories({
            itemId,
            fromCategory,
            toCategory,
            toIndex,
            item,
            UI
        });
    };
    const runPreview = (clientX, clientY) => {
        if (!dragState?.active) return;
        if (previewFrame) return;
        previewFrame = requestAnimationFrame(() => {
            previewFrame = null;
            if (!dragState?.active) return;

            const target = resolveFileCabinetDropTarget(clientX, clientY, dragState, mount);
            dragState.currentTarget = target;
            setFileCabinetDropTarget(mount, target);

            const draggedId = dragState.card.dataset.id;
            applyStackPreviewPositions(dragState.sourceStack, { draggedId, insertIndex: null, settling: true });

            if (target?.targetStack && target.targetStack !== dragState.sourceStack) {
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
            } else if (target?.targetStack === dragState.sourceStack) {
                applyStackPreviewPositions(dragState.sourceStack, {
                    draggedId,
                    insertIndex: target.insertIndex,
                    settling: true
                });
            }

            syncFileCabinetDrawerHeight(mount);
        });
    };

    mount.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.card-act, .card-inline-edit, button, input, textarea, a')) return;
        const card = e.target.closest('.file-cabinet-tab');
        if (!card) return;
        const stack = card.closest('.file-cabinet-tab-stack');
        if (!stack) return;

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
                const rect = card.getBoundingClientRect();
                dragState = {
                    active: true,
                    card,
                    sourceStack: stack,
                    sourceCategory: stack.dataset.category || 'Uncategorized',
                    startIndex,
                    sourceBaseline: snapshotStackTabs(stack),
                    targetStack: null,
                    targetBaseline: null,
                    currentTarget: null,
                    fixedOffsetX: startX - rect.left,
                    fixedOffsetY: startY - rect.top
                };
                card.classList.add('is-file-cabinet-dragging');
                document.body.classList.add('is-file-cabinet-drag-active');
                mount.classList.add('is-layout-active');
                card.style.position = 'fixed';
                card.style.left = `${rect.left}px`;
                card.style.top = `${rect.top}px`;
                card.style.width = `${rect.width}px`;
                card.style.height = `${rect.height}px`;
                card.style.margin = '0';
                card.style.zIndex = '9999';
            }

            card.style.left = `${ev.clientX - dragState.fixedOffsetX}px`;
            card.style.top = `${ev.clientY - dragState.fixedOffsetY}px`;
            runPreview(ev.clientX, ev.clientY);
        };

        const onUp = (ev) => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
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
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, { signal });

    mount.addEventListener('mouseover', (e) => {
        const tab = e.target.closest('.file-cabinet-tab');
        if (!tab || tab.classList.contains('is-file-cabinet-dragging')) return;
        tab.style.zIndex = '100';
    }, { signal });

    mount.addEventListener('mouseout', (e) => {
        const tab = e.target.closest('.file-cabinet-tab');
        if (!tab || tab.classList.contains('is-file-cabinet-dragging')) return;
        const stack = tab.closest('.file-cabinet-tab-stack');
        if (stack && !dragState?.active) applyFileCabinetStackPositions(stack);
    }, { signal });
}

export function getFileCabinetToggleLabels(inFileCabinetStrip, atLabel) {
    if (inFileCabinetStrip || atLabel) {
        return { title: 'Open below', iconKey: 'expand' };
    }
    return { title: 'File away', iconKey: 'collapse' };
}
