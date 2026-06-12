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

    const categories = [...byCategory.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const label = getLabelRect();
    const row = document.createElement('div');
    row.className = 'file-cabinet-row';

    categories.forEach((catName) => {
        const items = sortItemsByFileCabinetOrder(byCategory.get(catName), catName, order);
        const matched = activeCategories.find((c) => c.name?.toLowerCase() === catName.toLowerCase());
        const color = matched?.color || '#64748b';

        const col = document.createElement('div');
        col.className = 'file-cabinet-category';
        col.dataset.category = catName;
        col.style.setProperty('--file-cabinet-category-color', color);

        const header = document.createElement('div');
        header.className = 'file-cabinet-category-header';
        header.innerHTML = `<span class="file-cabinet-category-dot" style="background:${UI.escapeAttr(color)}"></span><span class="file-cabinet-category-name">${UI.escapeHTML(catName)}</span><span class="file-cabinet-category-count">${items.length}</span>`;
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

    mount.appendChild(row);
    syncFileCabinetDrawerHeight(mount);
}

export function initFileCabinetDrag(mount, signal) {
    if (!mount || !signal) return;

    let dragState = null;

    const finishDrag = (e) => {
        if (!dragState) return;
        const { stack, category, card, startIndex } = dragState;
        card.classList.remove('is-file-cabinet-dragging');
        document.body.classList.remove('is-file-cabinet-drag-active');

        const tabs = [...stack.querySelectorAll('.file-cabinet-tab')];
        const rect = stack.getBoundingClientRect();
        const y = e.clientY - rect.top;
        let toIndex = Math.floor(y / FILE_CABINET_STACK_OFFSET_Y);
        toIndex = Math.max(0, Math.min(tabs.length - 1, toIndex));

        if (toIndex !== startIndex) {
            reorderInCategory(category, startIndex, toIndex);
            const moved = tabs.splice(startIndex, 1)[0];
            tabs.splice(toIndex, 0, moved);
            tabs.forEach((tab) => stack.appendChild(tab));
            applyFileCabinetStackPositions(stack);
        } else {
            applyFileCabinetStackPositions(stack);
        }

        const mount = stack.closest('#file-cabinet');
        if (mount) syncFileCabinetDrawerHeight(mount);

        dragState = null;
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
            if (!dragState && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            if (!dragState) {
                dragState = {
                    stack,
                    category: stack.dataset.category || 'Uncategorized',
                    card,
                    startIndex,
                    baseLeft: startIndex * FILE_CABINET_STACK_OFFSET_X,
                    baseTop: startIndex * FILE_CABINET_STACK_OFFSET_Y
                };
                card.classList.add('is-file-cabinet-dragging');
                document.body.classList.add('is-file-cabinet-drag-active');
            }
            const offsetX = ev.clientX - startX;
            const offsetY = ev.clientY - startY;
            card.style.left = `${dragState.baseLeft + offsetX}px`;
            card.style.top = `${dragState.baseTop + offsetY}px`;
            card.style.zIndex = '999';
        };

        const onUp = (ev) => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
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
        if (stack) applyFileCabinetStackPositions(stack);
    }, { signal });
}

export function getFileCabinetToggleLabels(inFileCabinetStrip, atLabel) {
    if (inFileCabinetStrip || atLabel) {
        return { title: 'Open below', iconKey: 'expand' };
    }
    return { title: 'File away', iconKey: 'collapse' };
}
