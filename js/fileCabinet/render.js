/** @module {"owns":"file cabinet rail rendering - the folded chip rail, empty-shelf group and the open drawer columns, plus the tab drag handle every rendered note carries", "related":["fileCabinet.js","fileCabinet/layout.js","fileCabinet/order.js","noteSurfaceHtml.js"]} */
import { resolveCategoryColor, isUncategorizedCategory } from '../categories.js';
import { getItemCategoryName } from '../focusFilter.js';
import { escapeAttr, escapeHTML } from '../domEscape.js';
import { readBoardSort } from '../sidebarPrefs.js';
import { getLabelRect } from '../tileGeometry.js';
import { createCardComponent } from '../noteSurfaceHtml.js';
import { ACTION_ICONS, CARD_ICONS } from '../icons.js';
import { refreshFileCabinetUiScale } from '../shellResize.js';
import {
    applyFileCabinetCategoryOrder,
    getFileCabinetFiledCategories,
    getFileCabinetOrder,
    isFileCabinetCategoryFiled,
    isFileCabinetEmptyShelvesCollapsed,
    sortItemsByFileCabinetOrder
} from './order.js';
import { applyFileCabinetStackPositions } from './layout.js';

const FOLD_ICON = '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 7l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const EXPAND_ICON = '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function buildFileCabinetCategoryActionButtons({ canManage = true } = {}) {
    if (!canManage) return '';
    return `<button type="button" class="card-act card-act--color file-cabinet-category-color-btn" title="Category color" aria-label="Category color">${CARD_ICONS.color}</button><button type="button" class="card-act card-act--hide file-cabinet-category-hide-btn" title="Hide category" aria-label="Hide category">${CARD_ICONS.hide}</button>`;
}

export function wrapFileCabinetCategoryActions(buttonsHtml) {
    if (!buttonsHtml?.trim()) return '';
    return `<div class="file-cabinet-category-actions">${buttonsHtml}</div>`;
}

/** Categories to render — filed-note categories plus active registry (empty ones included). */
export function buildFileCabinetCategoryNames(byCategory, activeCategories = []) {
    const fromNotes = [...byCategory.keys()];
    const fromRegistry = (Array.isArray(activeCategories) ? activeCategories : [])
        .map((cat) => (typeof cat === 'string' ? cat : cat?.name))
        .filter((name) => typeof name === 'string' && name.trim());
    const list = [...new Set([...fromNotes, ...fromRegistry])];
    const boardSort = readBoardSort();
    if (boardSort.field === 'category') {
        const dir = boardSort.dir === 'asc' ? 1 : -1;
        list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }) * dir);
    } else {
        list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }
    return applyFileCabinetCategoryOrder(list);
}

export function ensureFileCabinetTabDragHandle(card) {
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

export function buildFileCabinetCategoryColumn({
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
    // Match folded slots so expanded wash + drop highlight share the same tint vars.
    col.style.setProperty('--card-category-color', color);
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
    const openAllBtnHtml = `<button type="button" class="card-act file-cabinet-category-open-all-btn" title="Open all below" aria-label="Open all below">${ACTION_ICONS.expandAll}</button>`;
    const foldBtnHtml = showFoldButton
        ? `<button type="button" class="card-act file-cabinet-category-fold-btn" title="Fold category" aria-label="Fold category">${FOLD_ICON}</button>`
        : '';
    const manageBtnsHtml = buildFileCabinetCategoryActionButtons({ canManage: canRename });
    const actionsHtml = wrapFileCabinetCategoryActions(`${grabBtnHtml}${manageBtnsHtml}${openAllBtnHtml}${foldBtnHtml}`);
    header.innerHTML = `<span class="file-cabinet-category-dot" style="background:${escapeAttr(color)}"></span><span${nameAttrs}>${escapeHTML(catName)}</span><span class="file-cabinet-category-count">${items.length}</span>${actionsHtml}`;
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

    col.appendChild(stack);
    // Position after append so the column itself receives the note-count inline
    // width (pre-append the closest('.file-cabinet-category') lookup fails and
    // CSS width:auto would let a long title stretch the drawer).
    applyFileCabinetStackPositions(stack);
    return col;
}

export function renderFileCabinet(mount, filedItems, activeCategories, UI, { allItems = null } = {}) {
    if (!mount) return;
    mount.innerHTML = '';

    const safeFiledItems = Array.isArray(filedItems) ? filedItems : [];
    const order = getFileCabinetOrder();
    const byCategory = new Map();
    safeFiledItems.forEach((item) => {
        const cat = getItemCategoryName(item);
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(item);
    });

    const allCategories = buildFileCabinetCategoryNames(byCategory, activeCategories);

    if (!safeFiledItems.length && !allCategories.length) {
        mount.innerHTML = '<div class="file-cabinet-empty">No filed notes — use File away on a note to add tabs here.</div>';
        mount.style.minHeight = '';
        mount.style.maxHeight = '';
        delete mount.__fcPreviewContext;
        refreshFileCabinetUiScale(mount);
        return;
    }

    const allCategorySet = new Set(allCategories);
    const filedCategoryNames = applyFileCabinetCategoryOrder(
        getFileCabinetFiledCategories().filter((c) => allCategorySet.has(c))
    );
    const visibleCategories = allCategories.filter((c) => !isFileCabinetCategoryFiled(c));

    const isEmptyShelf = (name) => !(byCategory.get(name)?.length);
    // Empty shelves (0 filed notes on this desktop) group together — not open columns.
    const emptyShelfNames = applyFileCabinetCategoryOrder(
        allCategories.filter((c) => isEmptyShelf(c))
    );
    const filedWithNotes = filedCategoryNames.filter((c) => !isEmptyShelf(c));
    const visibleWithNotes = visibleCategories.filter((c) => !isEmptyShelf(c));
    const emptyShelvesCollapsed = isFileCabinetEmptyShelvesCollapsed();

    mount.__fcPreviewContext = {
        byCategory,
        activeCategories,
        order,
        UI
    };

    const inner = document.createElement('div');
    inner.className = 'file-cabinet-inner';

    const rail = document.createElement('aside');
    rail.className = 'file-cabinet-filed-rail';
    rail.setAttribute('aria-label', 'Folded categories');

    const appendFiledSlot = (catName, parent, { emptyShelf = false } = {}) => {
        const items = byCategory.get(catName) || [];
        const color = resolveCategoryColor(catName, activeCategories);

        const slot = document.createElement('div');
        slot.className = 'file-cabinet-filed-slot';
        slot.dataset.category = catName;
        if (emptyShelf) slot.dataset.emptyShelf = '1';
        slot.style.setProperty('--card-category-color', color);
        slot.style.setProperty('--file-cabinet-category-color', color);

        const chip = document.createElement('div');
        chip.className = 'file-cabinet-filed-chip';
        chip.dataset.category = catName;

        const canRename = !isUncategorizedCategory(catName);
        const chipNameAttrs = canRename
            ? ' class="file-cabinet-filed-chip-name u-truncate card-inline-edit" contenteditable="plaintext-only" spellcheck="false" data-placeholder="Category…"'
            : ' class="file-cabinet-filed-chip-name u-truncate"';
        const manageBtnsHtml = buildFileCabinetCategoryActionButtons({ canManage: canRename });
        const expandBtns = emptyShelf
            ? ''
            : `<button type="button" class="card-act file-cabinet-category-open-all-btn" title="Open all below" aria-label="Open all below">${ACTION_ICONS.expandAll}</button><button type="button" class="card-act file-cabinet-filed-chip-expand" title="Expand category" aria-label="Expand category">${EXPAND_ICON}</button>`;
        const chipActionsHtml = wrapFileCabinetCategoryActions(`<button type="button" class="card-act file-cabinet-filed-chip-grab grab-handle grab-handle--col" title="Drag to reorder category" aria-label="Drag to reorder category">${CARD_ICONS.drag}</button>${manageBtnsHtml}${expandBtns}`);
        chip.innerHTML = `<span class="file-cabinet-category-dot" style="background:${escapeAttr(color)}"></span><span${chipNameAttrs}>${escapeHTML(catName)} (${items.length})</span>${chipActionsHtml}`;

        const rollout = document.createElement('div');
        rollout.className = 'file-cabinet-filed-rollout';
        rollout.setAttribute('aria-hidden', 'true');

        slot.appendChild(chip);
        slot.appendChild(rollout);
        parent.appendChild(slot);
    };

    filedWithNotes.forEach((catName) => appendFiledSlot(catName, rail));

    const emptyGroup = document.createElement('div');
    emptyGroup.className = `file-cabinet-empty-shelves${emptyShelvesCollapsed ? ' is-collapsed' : ''}`;
    emptyGroup.dataset.emptyShelves = '1';

    const emptyHeader = document.createElement('button');
    emptyHeader.type = 'button';
    emptyHeader.className = 'file-cabinet-empty-shelves__toggle';
    emptyHeader.setAttribute('aria-expanded', emptyShelvesCollapsed ? 'false' : 'true');
    emptyHeader.title = emptyShelvesCollapsed ? 'Show empty' : 'Hide empty';
    emptyHeader.innerHTML = `<span class="file-cabinet-empty-shelves__chevron" aria-hidden="true">${CARD_ICONS.chevronDown}</span><span class="file-cabinet-empty-shelves__label">EMPTY</span><span class="file-cabinet-empty-shelves__count">${emptyShelfNames.length}</span>`;
    emptyGroup.appendChild(emptyHeader);

    const emptyBody = document.createElement('div');
    emptyBody.className = 'file-cabinet-empty-shelves__body';
    emptyBody.hidden = emptyShelvesCollapsed;

    // EMPTY is display-only from emptyShelfNames — do not write fold state here.
    emptyShelfNames.forEach((catName) => appendFiledSlot(catName, emptyBody, { emptyShelf: true }));
    if (!emptyShelfNames.length) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'file-cabinet-empty-shelves__none';
        emptyMsg.textContent = 'No empty shelves';
        emptyBody.appendChild(emptyMsg);
    }
    emptyGroup.appendChild(emptyBody);
    rail.appendChild(emptyGroup);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'file-cabinet-add-category-btn';
    addBtn.title = 'Add category';
    addBtn.setAttribute('aria-label', 'Add category');
    addBtn.innerHTML = '<svg viewBox="0 0 16 16" width="18" height="18" focusable="false" aria-hidden="true"><path d="M8 2.5v11M2.5 8h11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    rail.appendChild(addBtn);

    inner.appendChild(rail);

    const row = document.createElement('div');
    row.className = 'file-cabinet-row';

    visibleWithNotes.forEach((catName) => {
        const items = sortItemsByFileCabinetOrder(byCategory.get(catName) || [], catName, order);
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
    mount.style.minHeight = '';
    mount.style.maxHeight = '';
    refreshFileCabinetUiScale(mount);
}
