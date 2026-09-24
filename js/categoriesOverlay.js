/** @module {"owns":"categories manager floating panel", "related":["categories.js","fileCabinet.js","noteQuickActions.js","hamburger.js"], "events":["category:hide_requested","category:show_requested","category:color_changed","category:add_requested","categories:toggled"]} */
import { escapeAttr, escapeHTML } from './domEscape.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import {
    UNCATEGORIZED_CATEGORY,
    UNCATEGORIZED_COLOR,
    isUncategorizedCategory,
    renameCategory,
    resolveCategoryColor,
    validateNewCategoryName
} from './categories.js';
import { getItemCategoryName } from './focusFilter.js';
import { ColorPicker, PALETTE_NOTE } from './colorPicker.js';
import { noteDisplayTitle } from './mediaAttachments.js';
import { bindFloatResize, mountFloatChrome } from './desktopFloatChrome.js';
import { raiseDesktopElement } from './desktopStack.js';

const PANEL_STORAGE_KEY = 'matrix_categories_panel';
const DEFAULT_W = 420;
const DEFAULT_H = 520;
const MIN_W = 320;
const MIN_H = 280;

let panel = null;
/** @type {null | (() => { categories: Array, hiddenCategories: string[], items: object[] })} */
let getState = null;
/** @type {Set<string>} session-local expanded drawer keys (`active:Name` / `hidden:Name`) */
const expandedKeys = new Set();
let floatChromeBound = false;
let focusAddOnOpen = false;

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
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

function buildDrawerHtml(cat, { section, notes, expanded }) {
    const catName = cat.name;
    const color = isUncategorizedCategory(catName)
        ? UNCATEGORIZED_COLOR
        : (cat.color || resolveCategoryColor(catName, [cat]) || UNCATEGORIZED_COLOR);
    const canManage = !isUncategorizedCategory(catName);
    const count = notes.length;
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
        ? ' class="categories-panel__drawer-name u-truncate card-inline-edit" contenteditable="plaintext-only" spellcheck="false" data-placeholder="Category…"'
        : ' class="categories-panel__drawer-name u-truncate"';

    const notesHtml = count
        ? `<ul class="categories-panel__note-list">${notes.map((item) => `
            <li>
                <button type="button" class="categories-panel__note-item" data-note-id="${escapeAttr(item.id)}" title="${escapeAttr(noteDisplayTitle(item))}">
                    ${escapeHTML(noteDisplayTitle(item))}
                </button>
            </li>`).join('')}</ul>`
        : `<p class="categories-panel__note-empty">No notes</p>`;

    return `
    <div class="categories-panel__drawer${expanded ? ' is-expanded' : ''}"
         data-category="${escapeAttr(catName)}"
         data-section="${escapeAttr(section)}"
         style="--card-category-color:${escapeAttr(color)}">
        <div class="categories-panel__drawer-header">
            <span class="categories-panel__drawer-dot" aria-hidden="true"></span>
            <span${nameAttrs}>${escapeHTML(catName)}</span>
            <span class="categories-panel__drawer-count">(${count})</span>
            <div class="categories-panel__drawer-actions">
                ${colorBtn}
                ${hideOrShow}
                <button type="button" class="card-act" data-cat-toggle title="${expandTitle}" aria-label="${expandTitle}" aria-expanded="${expanded ? 'true' : 'false'}">${expandIcon}</button>
            </div>
        </div>
        <div class="categories-panel__drawer-body">${notesHtml}</div>
    </div>`;
}

function buildGroupHtml(title, section, cats, items) {
    const drawers = cats.map((cat) => {
        const key = drawerKey(section, cat.name);
        const notes = notesForCategory(items, cat.name);
        return buildDrawerHtml(cat, {
            section,
            notes,
            expanded: expandedKeys.has(key)
        });
    }).join('');

    return `
    <section class="categories-panel__group" data-section="${escapeAttr(section)}">
        <h3 class="categories-panel__group-title">
            ${escapeHTML(title)}
            <span class="categories-panel__group-count">${cats.length}</span>
        </h3>
        ${cats.length ? drawers : `<p class="categories-panel__empty">No ${section} categories</p>`}
    </section>`;
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

        applySavedGeometry();
        this.renderChrome();
        this.bindChrome();
        setupFloatingChrome();

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!this.isOpen()) return;
            if (document.activeElement?.closest?.('.categories-panel__drawer-name.card-inline-edit')) return;
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
        if (header && !header.querySelector('.categories-panel__title')) {
            header.innerHTML = `
                <h2 class="categories-panel__title">Categories</h2>
                <p class="categories-panel__summary" data-categories-summary></p>
            `;
        }
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

        panel.addEventListener('click', (e) => {
            const toggleBtn = e.target.closest('[data-cat-toggle]');
            if (toggleBtn) {
                e.preventDefault();
                const drawer = toggleBtn.closest('.categories-panel__drawer');
                const name = drawer?.dataset.category;
                const section = drawer?.dataset.section;
                if (!name || !section) return;
                const key = drawerKey(section, name);
                if (expandedKeys.has(key)) expandedKeys.delete(key);
                else expandedKeys.add(key);
                this.refresh();
                return;
            }

            const colorBtn = e.target.closest('[data-cat-color]');
            if (colorBtn) {
                e.preventDefault();
                const drawer = colorBtn.closest('.categories-panel__drawer');
                const cat = drawer?.dataset.category;
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
                const drawer = hideBtn.closest('.categories-panel__drawer');
                const cat = drawer?.dataset.category;
                if (!cat || isUncategorizedCategory(cat)) return;
                window.dispatchEvent(new CustomEvent('category:hide_requested', { detail: { name: cat } }));
                return;
            }

            const showBtn = e.target.closest('[data-cat-show]');
            if (showBtn) {
                e.preventDefault();
                const drawer = showBtn.closest('.categories-panel__drawer');
                const cat = drawer?.dataset.category;
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

        const nameSelector = '.categories-panel__drawer-name.card-inline-edit';
        panel.addEventListener('focusin', (e) => {
            const nameEl = e.target.closest?.(nameSelector);
            if (!nameEl || !panel.contains(nameEl) || nameEl.dataset.renaming === '1') return;
            const drawer = nameEl.closest('.categories-panel__drawer');
            const cat = drawer?.dataset.category;
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

        const body = panel.querySelector('[data-categories-body]');
        if (body) {
            body.innerHTML = [
                buildGroupHtml('Active', 'active', active, items),
                buildGroupHtml('Hidden', 'hidden', hidden, items)
            ].join('');
        }
    }
};
