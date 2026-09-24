/** @module {"owns":"categories manager floating panel", "related":["categories.js","fileCabinet.js","noteQuickActions.js","hamburger.js"], "events":["category:hide_requested","category:show_requested","category:color_changed","category:add_requested","categories:toggled"]} */
import { escapeAttr, escapeHTML } from './domEscape.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import {
    UNCATEGORIZED_CATEGORY,
    UNCATEGORIZED_COLOR,
    isUncategorizedCategory,
    renameCategory,
    resolveCategoryColor,
    resolveCategoryCreatedAt,
    validateNewCategoryName
} from './categories.js';
import { getItemCategoryName } from './focusFilter.js';
import { ColorPicker, PALETTE_NOTE } from './colorPicker.js';
import { noteDisplayTitle } from './mediaAttachments.js';
import { bindFloatResize, mountFloatChrome } from './desktopFloatChrome.js';
import { raiseDesktopElement } from './desktopStack.js';
import { buildFileCabinetRolloutStack } from './fileCabinet.js';

const PANEL_STORAGE_KEY = 'matrix_categories_panel';
const SORT_STORAGE_KEY = 'matrix_categories_panel_sort';
const DEFAULT_W = 480;
const DEFAULT_H = 520;
const MIN_W = 320;
const MIN_H = 280;

const SORT_OPTIONS = [
    { value: 'name-asc', label: 'Name A–Z' },
    { value: 'name-desc', label: 'Name Z–A' },
    { value: 'date-desc', label: 'Newest' },
    { value: 'date-asc', label: 'Oldest' },
    { value: 'notes-desc', label: 'Most notes' },
    { value: 'notes-asc', label: 'Fewest notes' }
];

let panel = null;
/** @type {null | (() => { categories: Array, hiddenCategories: string[], items: object[] })} */
let getState = null;
/** @type {null | (() => object|null)} */
let getUI = null;
/** @type {Set<string>} session-local expanded drawer keys (`active:Name` / `hidden:Name`) */
const expandedKeys = new Set();
let floatChromeBound = false;
let focusAddOnOpen = false;
/** @type {HTMLElement|null} */
let previewTile = null;
let currentSort = 'name-asc';
/** Empty-shelves subsection starts collapsed */
let emptyShelvesCollapsed = true;

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function loadSort() {
    try {
        const raw = localStorage.getItem(SORT_STORAGE_KEY) || 'name-asc';
        return SORT_OPTIONS.some((o) => o.value === raw) ? raw : 'name-asc';
    } catch {
        return 'name-asc';
    }
}

function saveSort(value) {
    currentSort = value;
    try {
        localStorage.setItem(SORT_STORAGE_KEY, value);
    } catch {
        /* ignore */
    }
}

function formatCreatedDate(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '—';
    try {
        return new Date(n).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch {
        return '—';
    }
}

function sortCategories(cats, items) {
    const [field, dir] = String(currentSort || 'name-asc').split('-');
    const factor = dir === 'desc' ? -1 : 1;
    return [...cats].sort((a, b) => {
        if (field === 'notes') {
            const na = notesForCategory(items, a.name).length;
            const nb = notesForCategory(items, b.name).length;
            if (na !== nb) return (na - nb) * factor;
        } else if (field === 'date') {
            const da = resolveCategoryCreatedAt(a);
            const db = resolveCategoryCreatedAt(b);
            if (da !== db) return (da - db) * factor;
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * (field === 'name' ? factor : 1);
    });
}

function loadPanelGeom() {
    try {
        return JSON.parse(localStorage.getItem(PANEL_STORAGE_KEY) || 'null') || {};
    } catch {
        return {};
    }
}

function savePanelGeom(patch = {}) {
    if (!panel) return;
    const next = {
        ...loadPanelGeom(),
        x: panel.offsetLeft,
        y: panel.offsetTop,
        w: panel.offsetWidth,
        h: panel.offsetHeight,
        ...patch
    };
    try {
        localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(next));
    } catch {
        /* ignore quota */
    }
}

function viewportBounds() {
    return {
        left: 8,
        top: 8,
        right: window.innerWidth - 8,
        bottom: window.innerHeight - 8
    };
}

function clampPanelPos(x, y, w, h) {
    const b = viewportBounds();
    return {
        x: clamp(x, b.left, Math.max(b.left, b.right - w)),
        y: clamp(y, b.top, Math.max(b.top, b.bottom - h))
    };
}

function applySavedGeometry() {
    if (!panel) return;
    const saved = loadPanelGeom();
    const w = Number.isFinite(saved.w) ? saved.w : DEFAULT_W;
    const h = Number.isFinite(saved.h) ? saved.h : DEFAULT_H;
    const width = clamp(w, MIN_W, window.innerWidth - 16);
    const height = clamp(h, MIN_H, window.innerHeight - 16);
    const fallbackX = Math.max(16, (window.innerWidth - width) / 2);
    const fallbackY = Math.max(16, (window.innerHeight - height) / 5);
    const pos = clampPanelPos(
        Number.isFinite(saved.x) ? saved.x : fallbackX,
        Number.isFinite(saved.y) ? saved.y : fallbackY,
        width,
        height
    );
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    panel.style.left = `${pos.x}px`;
    panel.style.top = `${pos.y}px`;
}

function bringPanelFront() {
    if (!panel) return;
    raiseDesktopElement(panel);
}

function pointerDelta(clientX, clientY, startX, startY) {
    return { dx: clientX - startX, dy: clientY - startY };
}

function bindPanelDrag() {
    const header = panel.querySelector('[data-categories-header]');
    const dragHandle = panel.querySelector('[data-categories-drag]');
    const dragTargets = [header, dragHandle].filter(Boolean);
    if (!dragTargets.length) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let captureEl = null;

    const onPointerDown = (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, input, textarea, a, .btn')) return;
        if (e.target.closest('.card-act') && !e.target.closest('.categories-panel__drag')) return;
        e.preventDefault();
        dragging = true;
        captureEl = e.currentTarget;
        startX = e.clientX;
        startY = e.clientY;
        originLeft = panel.offsetLeft;
        originTop = panel.offsetTop;
        captureEl.setPointerCapture(e.pointerId);
        panel.classList.add('is-dragging');
        bringPanelFront();
    };

    const onPointerMove = (e) => {
        if (!dragging) return;
        const { dx, dy } = pointerDelta(e.clientX, e.clientY, startX, startY);
        const pos = clampPanelPos(
            originLeft + dx,
            originTop + dy,
            panel.offsetWidth,
            panel.offsetHeight
        );
        panel.style.left = `${pos.x}px`;
        panel.style.top = `${pos.y}px`;
    };

    const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        panel.classList.remove('is-dragging');
        try {
            captureEl?.releasePointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
        captureEl = null;
        savePanelGeom();
    };

    dragTargets.forEach((el) => {
        el.addEventListener('pointerdown', onPointerDown);
        el.addEventListener('pointermove', onPointerMove);
        el.addEventListener('pointerup', endDrag);
        el.addEventListener('pointercancel', endDrag);
    });
}

function setupFloatingChrome() {
    if (!panel || floatChromeBound) return;
    mountFloatChrome(panel, { resizable: true, mode: 'tool' });
    bindFloatResize(panel, {
        mins: { w: MIN_W, h: MIN_H },
        getBounds: viewportBounds,
        pointerDelta,
        clampPosition: (el, x, y) => clampPanelPos(x, y, el.offsetWidth, el.offsetHeight),
        onEnd: () => savePanelGeom(),
        onBringToFront: bringPanelFront
    });
    bindPanelDrag();
    panel.addEventListener('pointerdown', () => bringPanelFront());
    floatChromeBound = true;
}

function drawerKey(section, name) {
    return `${section}:${name}`;
}

function notesForCategory(items, catName) {
    return (items || []).filter((item) => {
        if (!item || item.status === 'archived') return false;
        return getItemCategoryName(item) === catName;
    });
}

function uncategorizedCount(items) {
    return notesForCategory(items, UNCATEGORIZED_CATEGORY).length;
}

function buildTileHtml(cat, { section, notes, expanded }) {
    const catName = cat.name;
    const color = isUncategorizedCategory(catName)
        ? UNCATEGORIZED_COLOR
        : (cat.color || resolveCategoryColor(catName, [cat]) || UNCATEGORIZED_COLOR);
    const canManage = !isUncategorizedCategory(catName);
    const count = notes.length;
    const createdLabel = formatCreatedDate(resolveCategoryCreatedAt(cat));
    const expandIcon = expanded ? CARD_ICONS.collapse : CARD_ICONS.expand;
    const expandTitle = expanded ? 'Collapse' : 'Expand';
    const hideOrShow = section === 'hidden'
        ? `<button type="button" class="card-act card-act--show" data-cat-show title="Show" aria-label="Show">${CARD_ICONS.show}</button>`
        : (canManage
            ? `<button type="button" class="card-act card-act--hide" data-cat-hide title="Hide category" aria-label="Hide category">${CARD_ICONS.hide}</button>`
            : '');
    const colorBtn = canManage
        ? `<button type="button" class="card-act card-act--color" data-cat-color title="Category color" aria-label="Category color">${CARD_ICONS.color}</button>`
        : '';
    const nameAttrs = canManage
        ? ' class="categories-panel__tile-name u-truncate card-inline-edit" contenteditable="plaintext-only" spellcheck="false" data-placeholder="Category…"'
        : ' class="categories-panel__tile-name u-truncate"';

    const notesHtml = count
        ? `<ul class="categories-panel__note-list">${notes.map((item) => `
            <li>
                <button type="button" class="categories-panel__note-item" data-note-id="${escapeAttr(item.id)}" title="${escapeAttr(noteDisplayTitle(item))}">
                    ${escapeHTML(noteDisplayTitle(item))}
                </button>
            </li>`).join('')}</ul>`
        : `<p class="categories-panel__note-empty">No notes</p>`;

    return `
    <div class="categories-panel__tile${expanded ? ' is-expanded' : ''}"
         data-category="${escapeAttr(catName)}"
         data-section="${escapeAttr(section)}"
         style="--card-category-color:${escapeAttr(color)}"
         role="group"
         aria-label="${escapeAttr(catName)}">
        <div class="categories-panel__tile-face" data-cat-face title="${expandTitle}">
            <div class="categories-panel__tile-actions">
                ${colorBtn}
                ${hideOrShow}
                <button type="button" class="card-act" data-cat-toggle title="${expandTitle}" aria-label="${expandTitle}" aria-expanded="${expanded ? 'true' : 'false'}">${expandIcon}</button>
            </div>
            <span${nameAttrs}>${escapeHTML(catName)}</span>
            <span class="categories-panel__tile-count">${count} note${count === 1 ? '' : 's'}</span>
            <span class="categories-panel__tile-date" title="Created">${escapeHTML(createdLabel)}</span>
        </div>
        <div class="categories-panel__tile-body">${notesHtml}</div>
    </div>`;
}

function buildTileGridHtml(section, cats, items) {
    const sorted = sortCategories(cats, items);
    return sorted.map((cat) => {
        const key = drawerKey(section, cat.name);
        const notes = notesForCategory(items, cat.name);
        return buildTileHtml(cat, {
            section,
            notes,
            expanded: expandedKeys.has(key)
        });
    }).join('');
}

function buildGroupHtml(title, section, cats, items, {
    collapsible = false,
    collapsed = false,
    groupId = '',
    emptyLabel = null
} = {}) {
    const tiles = cats.length ? buildTileGridHtml(section, cats, items) : '';
    const toggle = collapsible
        ? `<span class="collapsable-toggle${collapsed ? ' collapsed' : ''}" aria-hidden="true">${CARD_ICONS.chevronDown}</span>`
        : '';
    const headingClass = collapsible
        ? 'categories-panel__group-title categories-panel__group-title--toggle'
        : 'categories-panel__group-title';
    const bodyClass = collapsible && collapsed
        ? 'categories-panel__group-body is-collapsed'
        : 'categories-panel__group-body';
    const toggleAttrs = collapsible
        ? ` data-categories-group-toggle role="button" tabindex="0" aria-expanded="${collapsed ? 'false' : 'true'}"`
        : '';
    const emptyText = emptyLabel || `No ${title.toLowerCase()}`;

    return `
    <section class="categories-panel__group" data-section="${escapeAttr(section)}"${groupId ? ` data-group-id="${escapeAttr(groupId)}"` : ''}>
        <h3 class="${headingClass}"${toggleAttrs}>
            ${toggle}
            ${escapeHTML(title)}
            <span class="categories-panel__group-count">${cats.length}</span>
        </h3>
        <div class="${bodyClass}">
            ${cats.length
                ? `<div class="categories-panel__tile-grid">${tiles}</div>`
                : `<p class="categories-panel__empty">${escapeHTML(emptyText)}</p>`}
        </div>
    </section>`;
}

function buildActiveGroupsHtml(activeCats, items) {
    const withNotes = [];
    const empty = [];
    activeCats.forEach((cat) => {
        if (notesForCategory(items, cat.name).length > 0) withNotes.push(cat);
        else empty.push(cat);
    });

    return [
        buildGroupHtml('Active', 'active', withNotes, items, {
            groupId: 'active',
            emptyLabel: 'No categories with notes'
        }),
        buildGroupHtml('EMPTY', 'active', empty, items, {
            collapsible: true,
            collapsed: emptyShelvesCollapsed,
            groupId: 'empty',
            emptyLabel: 'No empty shelves'
        })
    ].join('');
}

function hideTilePreview() {
    if (!panel) return;
    panel.querySelectorAll('.categories-panel__tile.is-fold-preview').forEach((tile) => {
        tile.classList.remove('is-fold-preview');
    });
    const host = panel.querySelector('[data-categories-preview-host]');
    if (host) {
        host.innerHTML = '';
        host.classList.add('is-hidden');
        host.setAttribute('aria-hidden', 'true');
    }
    previewTile = null;
}

function showTilePreview(tile) {
    if (!panel || !tile || !tile.isConnected) return;
    if (tile.classList.contains('is-expanded')) return;
    const catName = tile.dataset.category;
    if (!catName) return;

    const state = getState?.() || {};
    const notes = notesForCategory(state.items || [], catName);
    if (!notes.length) return;

    const UI = getUI?.();
    if (!UI) return;

    let host = panel.querySelector('[data-categories-preview-host]');
    if (!host) {
        host = document.createElement('div');
        host.className = 'categories-panel__preview-host';
        host.dataset.categoriesPreviewHost = '';
        panel.appendChild(host);
    }

    if (previewTile && previewTile !== tile) {
        previewTile.classList.remove('is-fold-preview');
    }
    previewTile = tile;
    tile.classList.add('is-fold-preview');

    const rect = tile.getBoundingClientRect();
    const color = tile.style.getPropertyValue('--card-category-color') || UNCATEGORIZED_COLOR;
    host.style.setProperty('--card-category-color', color);
    host.style.left = `${Math.round(rect.left)}px`;
    host.style.top = `${Math.round(rect.bottom - 2)}px`;
    host.style.minWidth = `${Math.round(rect.width)}px`;
    host.classList.remove('is-hidden');
    host.setAttribute('aria-hidden', 'false');

    if (!host.querySelector('.file-cabinet-tab-stack') || host.dataset.previewCategory !== catName) {
        host.dataset.previewCategory = catName;
        host.innerHTML = '';
        host.appendChild(buildFileCabinetRolloutStack({
            catName,
            items: notes,
            activeCategories: state.categories || [],
            UI
        }));
    }
}

function commitNameEdit(nameEl, { revert = false } = {}) {
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

    const next = (nameEl.textContent || '').trim();
    if (!next || next === oldName) {
        nameEl.textContent = displayBefore;
        return;
    }
    const result = renameCategory(oldName, next);
    if (!result.ok) {
        alert(result.error || 'Could not rename category.');
        nameEl.textContent = displayBefore;
        return;
    }
    // Remap expanded keys for the renamed category
    ['active', 'hidden'].forEach((section) => {
        const from = drawerKey(section, oldName);
        const to = drawerKey(section, next);
        if (expandedKeys.has(from)) {
            expandedKeys.delete(from);
            expandedKeys.add(to);
        }
    });
}

export const CategoriesOverlay = {
    init(opts = {}) {
        panel = document.getElementById('categories-panel');
        if (!panel) return;
        getState = typeof opts.getState === 'function' ? opts.getState : () => ({
            categories: [],
            hiddenCategories: [],
            items: []
        });
        getUI = typeof opts.getUI === 'function' ? opts.getUI : () => null;
        currentSort = loadSort();

        applySavedGeometry();
        this.renderChrome();
        this.bindChrome();
        setupFloatingChrome();

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!this.isOpen()) return;
            if (document.activeElement?.closest?.('.categories-panel__tile-name.card-inline-edit')) return;
            e.preventDefault();
            this.close();
        });

        window.addEventListener('categories:toggled', () => {
            if (this.isOpen()) this.refresh();
        });
        window.addEventListener('category:renamed', () => {
            if (this.isOpen()) this.refresh();
        });
    },

    renderChrome() {
        if (!panel) return;
        const header = panel.querySelector('[data-categories-header]');
        if (header) {
            if (!header.querySelector('.categories-panel__title')) {
                header.innerHTML = `
                    <h2 class="categories-panel__title">Categories</h2>
                    <p class="categories-panel__summary" data-categories-summary></p>
                `;
            }
            if (!header.querySelector('[data-categories-sort]')) {
                header.insertAdjacentHTML('beforeend', `
                    <label class="categories-panel__sort">
                        <span class="categories-panel__sort-label">Sort</span>
                        <select class="categories-panel__sort-select" data-categories-sort aria-label="Sort categories">
                            ${SORT_OPTIONS.map((o) => `<option value="${escapeAttr(o.value)}">${escapeHTML(o.label)}</option>`).join('')}
                        </select>
                    </label>
                `);
            }
        }
        const sortSelect = panel.querySelector('[data-categories-sort]');
        if (sortSelect) sortSelect.value = currentSort;
        const drag = panel.querySelector('[data-categories-drag]');
        if (drag) drag.innerHTML = CARD_ICONS.drag;
        const closeBtn = panel.querySelector('[data-categories-close]');
        if (closeBtn) closeBtn.innerHTML = CARD_ICONS.close;

        const footer = panel.querySelector('[data-categories-footer]');
        if (footer) {
            footer.innerHTML = `
                <form class="categories-panel__add-form" data-categories-add-form>
                    <input type="text" class="categories-panel__add-input" data-categories-add-input
                        placeholder="New category name" aria-label="New category name" maxlength="80" autocomplete="off">
                    <button type="submit" class="btn btn--compact" data-categories-add-submit title="Add category" aria-label="Add category">
                        ${ACTION_ICONS.plus} Add
                    </button>
                </form>
            `;
        }
    },

    bindChrome() {
        if (!panel) return;
        panel.querySelector('[data-categories-close]')?.addEventListener('click', () => this.close());

        panel.querySelector('[data-categories-add-form]')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitAdd();
        });

        panel.querySelector('[data-categories-sort]')?.addEventListener('change', (e) => {
            const value = e.target?.value;
            if (!SORT_OPTIONS.some((o) => o.value === value)) return;
            saveSort(value);
            this.refresh();
        });

        panel.addEventListener('pointerover', (e) => {
            const tile = e.target.closest('.categories-panel__tile');
            const host = e.target.closest('[data-categories-preview-host]');
            if (host) return;
            if (!tile || !panel.contains(tile)) return;
            if (e.relatedTarget && tile.contains(e.relatedTarget)) return;
            showTilePreview(tile);
        });

        panel.addEventListener('pointerout', (e) => {
            const tile = e.target.closest('.categories-panel__tile');
            const host = e.target.closest('[data-categories-preview-host]');
            const related = e.relatedTarget;
            if (related?.closest?.('[data-categories-preview-host], .categories-panel__tile.is-fold-preview')) {
                return;
            }
            if (host || tile) hideTilePreview();
        });

        panel.addEventListener('click', (e) => {
            const groupToggle = e.target.closest('[data-categories-group-toggle]');
            if (groupToggle) {
                e.preventDefault();
                const group = groupToggle.closest('.categories-panel__group');
                if (group?.dataset.groupId === 'empty') {
                    emptyShelvesCollapsed = !emptyShelvesCollapsed;
                    this.refresh();
                }
                return;
            }

            const toggleBtn = e.target.closest('[data-cat-toggle]');
            const face = !toggleBtn && e.target.closest('[data-cat-face]');
            if (toggleBtn || face) {
                if (face && e.target.closest('.categories-panel__tile-name, .categories-panel__tile-actions, .card-act')) {
                    return;
                }
                e.preventDefault();
                const tile = (toggleBtn || face).closest('.categories-panel__tile');
                const name = tile?.dataset.category;
                const section = tile?.dataset.section;
                if (!name || !section) return;
                const key = drawerKey(section, name);
                if (expandedKeys.has(key)) expandedKeys.delete(key);
                else expandedKeys.add(key);
                hideTilePreview();
                this.refresh();
                return;
            }

            const colorBtn = e.target.closest('[data-cat-color]');
            if (colorBtn) {
                e.preventDefault();
                const tile = colorBtn.closest('.categories-panel__tile');
                const cat = tile?.dataset.category;
                if (!cat || isUncategorizedCategory(cat)) return;
                const state = getState?.() || {};
                ColorPicker.open({
                    anchor: colorBtn,
                    presets: PALETTE_NOTE,
                    value: resolveCategoryColor(cat, state.categories || []),
                    align: 'end',
                    onSelect: (color) => {
                        window.dispatchEvent(new CustomEvent('category:color_changed', {
                            detail: { name: cat, color }
                        }));
                    }
                });
                return;
            }

            const hideBtn = e.target.closest('[data-cat-hide]');
            if (hideBtn) {
                e.preventDefault();
                const tile = hideBtn.closest('.categories-panel__tile');
                const cat = tile?.dataset.category;
                if (!cat || isUncategorizedCategory(cat)) return;
                window.dispatchEvent(new CustomEvent('category:hide_requested', { detail: { name: cat } }));
                return;
            }

            const showBtn = e.target.closest('[data-cat-show]');
            if (showBtn) {
                e.preventDefault();
                const tile = showBtn.closest('.categories-panel__tile');
                const cat = tile?.dataset.category;
                if (!cat) return;
                window.dispatchEvent(new CustomEvent('category:show_requested', { detail: { name: cat } }));
                return;
            }

            const noteBtn = e.target.closest('[data-note-id]');
            if (noteBtn) {
                e.preventDefault();
                const noteId = noteBtn.dataset.noteId;
                if (!noteId) return;
                const state = getState?.() || {};
                const item = (state.items || []).find((it) => it.id === noteId);
                if (!item) return;
                window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: { item } }));
            }
        });

        const nameSelector = '.categories-panel__tile-name.card-inline-edit';
        panel.addEventListener('focusin', (e) => {
            const nameEl = e.target.closest?.(nameSelector);
            if (!nameEl || !panel.contains(nameEl) || nameEl.dataset.renaming === '1') return;
            const tile = nameEl.closest('.categories-panel__tile');
            const cat = tile?.dataset.category;
            if (!cat || isUncategorizedCategory(cat)) return;
            nameEl.dataset.renaming = '1';
            nameEl.dataset.renameFrom = cat;
            nameEl.dataset.renameDisplay = nameEl.textContent || cat;
        });

        panel.addEventListener('focusout', (e) => {
            const nameEl = e.target.closest?.(nameSelector);
            if (nameEl && panel.contains(nameEl)) commitNameEdit(nameEl);
        });

        panel.addEventListener('keydown', (e) => {
            const groupToggle = e.target.closest?.('[data-categories-group-toggle]');
            if (groupToggle && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                groupToggle.click();
                return;
            }
            const nameEl = e.target.closest?.(nameSelector);
            if (!nameEl || !panel.contains(nameEl)) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                nameEl.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                commitNameEdit(nameEl, { revert: true });
                nameEl.blur();
            }
        });
    },

    isOpen() {
        return !!(panel && !panel.classList.contains('is-hidden'));
    },

    /**
     * @param {{ focusAdd?: boolean, expandCategory?: string }} [opts]
     */
    open(opts = {}) {
        if (!panel) return;
        focusAddOnOpen = !!opts.focusAdd;
        if (opts.expandCategory) {
            expandedKeys.add(drawerKey('active', opts.expandCategory));
        }
        applySavedGeometry();
        panel.classList.remove('is-hidden');
        panel.classList.add('is-open');
        bringPanelFront();
        this.refresh();
        if (focusAddOnOpen) {
            focusAddOnOpen = false;
            requestAnimationFrame(() => {
                panel.querySelector('[data-categories-add-input]')?.focus();
            });
        }
    },

    close() {
        if (!panel) return;
        hideTilePreview();
        savePanelGeom();
        panel.classList.remove('is-open');
        panel.classList.add('is-hidden');
    },

    submitAdd() {
        const input = panel?.querySelector('[data-categories-add-input]');
        const name = (input?.value || '').trim();
        if (!name) {
            input?.focus();
            return;
        }
        const state = getState?.() || {};
        const validation = validateNewCategoryName(name, state.categories || []);
        if (!validation.ok) {
            alert(`Conflict: ${validation.error}`);
            input?.select();
            return;
        }
        expandedKeys.add(drawerKey('active', validation.cleanName));
        emptyShelvesCollapsed = false;
        window.dispatchEvent(new CustomEvent('category:add_requested', {
            detail: { name: validation.cleanName, color: UNCATEGORIZED_COLOR, anchor: input }
        }));
        if (input) input.value = '';
    },

    /**
     * Expand a newly added category drawer and optionally open a color picker.
     * @param {string} name
     * @param {HTMLElement|null} [colorAnchor]
     */
    afterCategoryAdded(name, colorAnchor = null) {
        if (!name) return;
        expandedKeys.add(drawerKey('active', name));
        emptyShelvesCollapsed = false;
        if (this.isOpen()) this.refresh();
        if (colorAnchor) {
            const state = getState?.() || {};
            ColorPicker.open({
                anchor: colorAnchor,
                presets: PALETTE_NOTE,
                value: resolveCategoryColor(name, state.categories || []) || UNCATEGORIZED_COLOR,
                align: 'end',
                onSelect: (color) => {
                    window.dispatchEvent(new CustomEvent('category:color_changed', {
                        detail: { name, color }
                    }));
                }
            });
        }
    },

    refresh() {
        if (!panel) return;
        hideTilePreview();
        const state = getState?.() || {};
        const categories = Array.isArray(state.categories) ? state.categories : [];
        const hiddenSet = Array.isArray(state.hiddenCategories) ? state.hiddenCategories : [];
        const items = Array.isArray(state.items) ? state.items : [];

        const active = categories.filter((cat) => cat?.name && !hiddenSet.includes(cat.name));
        const hidden = categories.filter((cat) => cat?.name && hiddenSet.includes(cat.name));
        const uncat = uncategorizedCount(items);

        const titleEl = panel.querySelector('.categories-panel__title');
        if (titleEl) {
            titleEl.textContent = categories.length
                ? `Categories (${categories.length})`
                : 'Categories';
        }
        const summaryEl = panel.querySelector('[data-categories-summary]');
        if (summaryEl) {
            summaryEl.textContent = `${active.length} active · ${hidden.length} hidden · ${uncat} uncategorized`;
        }
        const sortSelect = panel.querySelector('[data-categories-sort]');
        if (sortSelect && sortSelect.value !== currentSort) sortSelect.value = currentSort;

        const body = panel.querySelector('[data-categories-body]');
        if (body) {
            body.innerHTML = [
                buildActiveGroupsHtml(active, items),
                buildGroupHtml('Hidden', 'hidden', hidden, items, { groupId: 'hidden' })
            ].join('');
        }
    }
};
