/** @module {"owns":"side panel shell, notes list, category drawer, sort", "related":["searchBar.js","ui.js","sidebarHistory.js","sidebarStats.js"], "events":["category:show_requested","category:order_changed"]} */
import { UI } from './ui.js';
import { BoardOperations } from './boardOperations.js';
import { NoteSurface } from './noteSurface.js';
import { escapeAttr, escapeHTML } from './domEscape.js';
import { UNCATEGORIZED_CATEGORY, UNCATEGORIZED_COLOR } from './categories.js';
import { itemHasCategory } from './focusFilter.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import { resolveNoteColor } from './colorPicker.js';
import { hasRichMarkup, stripRichText } from './richText.js';
import {
    readNotesListSort as loadNotesListSort,
    readPanelCollapsed,
    readSidebarSections,
    writeNotesListSort as persistNotesListSort,
    writePanelCollapsed,
    writeSidebarSection
} from './sidebarPrefs.js';
import { onSidebarCollapseChanged } from './shellResize.js';

export function applySectionCollapse(sectionId, headerId, startCollapsed = false) {
    const header = document.getElementById(headerId);
    const section = document.getElementById(sectionId);
    if (!header || !section) return;

    const toggle = header.querySelector('.collapsable-toggle');
    const stored = readSidebarSections();
    const collapsed = Object.prototype.hasOwnProperty.call(stored, sectionId)
        ? !!stored[sectionId]
        : startCollapsed;

    section.classList.toggle('collapsed', collapsed);
    toggle?.classList.toggle('collapsed', collapsed);
}

/**
 * @param {{ headerId: string, sectionId: string, startCollapsed?: boolean, ignoreSelector?: string | null, toggleOnly?: boolean }} opts
 */
export function bindToggleCollapsable({
    headerId,
    sectionId,
    startCollapsed = false,
    ignoreSelector = null,
    toggleOnly = true
}) {
    const header = document.getElementById(headerId);
    const section = document.getElementById(sectionId);
    if (!header || !section) return;

    applySectionCollapse(sectionId, headerId, startCollapsed);

    if (header.dataset.collapsableBound === 'true') return;
    header.dataset.collapsableBound = 'true';

    const clickTarget = toggleOnly
        ? header.querySelector('.collapsable-toggle')
        : header;
    if (!clickTarget) return;

    clickTarget.addEventListener('click', (e) => {
        if (header.dataset.suppressClick === 'true') return;
        if (ignoreSelector && e.target.closest(ignoreSelector)) return;
        if (toggleOnly && !e.target.closest('.collapsable-toggle')) return;
        const toggle = header.querySelector('.collapsable-toggle');
        const nowCollapsed = !section.classList.contains('collapsed');
        section.classList.toggle('collapsed', nowCollapsed);
        toggle?.classList.toggle('collapsed', nowCollapsed);
        writeSidebarSection(sectionId, nowCollapsed);
        if (sectionId === 'quick-actions-section') {
            window.dispatchEvent(new CustomEvent('quick-actions:section_toggled', { detail: { collapsed: nowCollapsed } }));
        }
    });
}

export const SidePanel = {
    panel: null,
    toggleBtn: null,
    toggleFab: null,
    appState: null,
    notesListSort: null,
    notesListSortBound: false,

    init(appState) {
        this.appState = appState;
        this.panel = document.getElementById('side-panel');
        this.toggleBtn = document.getElementById('nav-panel-toggle');
        this.toggleFab = document.getElementById('nav-panel-toggle-fab');
        this.notesListSort = loadNotesListSort();

        this.setCollapsed(readPanelCollapsed(), { persist: false });

        this.toggleBtn?.addEventListener('click', () => this.toggle());
        this.toggleFab?.addEventListener('click', () => this.toggle());
    },

    setCollapsed(collapsed, { persist = true } = {}) {
        if (collapsed && this.panel?.classList.contains('side-panel--undocked')) {
            window.dispatchEvent(new CustomEvent('sidebar:shell_dock_requested'));
        }
        this.panel?.classList.toggle('is-collapsed', collapsed);
        this.toggleBtn?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        this.toggleBtn?.setAttribute('title', collapsed ? 'Show panel' : 'Hide panel');
        this.toggleBtn?.setAttribute('aria-label', collapsed ? 'Show side panel' : 'Hide side panel');
        this.toggleFab?.classList.toggle('is-hidden', !collapsed);
        this.toggleFab?.setAttribute('title', collapsed ? 'Show panel' : 'Hide panel');
        this.toggleFab?.setAttribute('aria-label', collapsed ? 'Show side panel' : 'Hide side panel');
        if (persist) writePanelCollapsed(collapsed);
        onSidebarCollapseChanged();
    },

    toggle() {
        const collapsed = !this.panel?.classList.contains('is-collapsed');
        this.setCollapsed(collapsed);
    },

    setupStatusClickHandlers() {
        this.bindCollapsable('categories-list-active-header', 'categories-list-active-section', true);
        this.bindCollapsable('categories-list-hidden-header', 'categories-list-hidden-section', true);
        this.bindCollapsable('notes-list-active-header', 'notes-list-active-section', false, '.sidebar-notes-list-sort');
        this.bindCollapsable('notes-list-hidden-header', 'notes-list-hidden-section', true);
        this.bindCollapsable('notes-list-archived-header', 'notes-list-archived-section', true);
        this.bindCollapsable('quick-actions-header', 'quick-actions-section', true);
        this.setupNotesListSortControls();
    },

    bindCollapsable(headerId, sectionId, startCollapsed = false, ignoreSelector = null, toggleSelector = null) {
        bindToggleCollapsable({
            headerId,
            sectionId,
            startCollapsed,
            ignoreSelector,
            toggleOnly: toggleSelector !== null ? !!toggleSelector : false
        });
    },

    writeNotesListSort(sort) {
        this.notesListSort = sort;
        persistNotesListSort(sort);
        this.updateNotesListSortButtons();
    },

    setupNotesListSortControls() {
        if (this.notesListSortBound) return;
        const titleBtn = document.getElementById('notes-sort-title');
        const dateBtn = document.getElementById('notes-sort-date');
        if (!titleBtn || !dateBtn) return;

        titleBtn.innerHTML = `${ACTION_ICONS.sortAlpha}<span class="sidebar-sort-arrow" aria-hidden="true"></span>`;
        dateBtn.innerHTML = `${ACTION_ICONS.sortDate}<span class="sidebar-sort-arrow" aria-hidden="true"></span>`;
        this.notesListSortBound = true;
        this.updateNotesListSortButtons();

        titleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const current = loadNotesListSort();
            if (current.field === 'title') {
                this.writeNotesListSort({ field: 'title', dir: current.dir === 'asc' ? 'desc' : 'asc' });
            } else {
                this.writeNotesListSort({ field: 'title', dir: 'asc' });
            }
            if (this.appState?.items) this.updateNotesList(this.appState.items);
        });

        dateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const current = loadNotesListSort();
            if (current.field === 'date') {
                this.writeNotesListSort({ field: 'date', dir: current.dir === 'asc' ? 'desc' : 'asc' });
            } else {
                this.writeNotesListSort({ field: 'date', dir: 'desc' });
            }
            if (this.appState?.items) this.updateNotesList(this.appState.items);
        });
    },

    updateNotesListSortButtons() {
        const sort = loadNotesListSort();
        const titleBtn = document.getElementById('notes-sort-title');
        const dateBtn = document.getElementById('notes-sort-date');
        if (!titleBtn || !dateBtn) return;

        titleBtn.classList.toggle('is-active', sort.field === 'title');
        dateBtn.classList.toggle('is-active', sort.field === 'date');

        const titleArrow = titleBtn.querySelector('.sidebar-sort-arrow');
        const dateArrow = dateBtn.querySelector('.sidebar-sort-arrow');
        if (titleArrow) {
            titleArrow.textContent = sort.field === 'title' ? (sort.dir === 'asc' ? '↑' : '↓') : '';
        }
        if (dateArrow) {
            dateArrow.textContent = sort.field === 'date' ? (sort.dir === 'asc' ? '↑' : '↓') : '';
        }

        titleBtn.title = sort.field === 'title'
            ? `Sorted by title (${sort.dir === 'asc' ? 'A→Z' : 'Z→A'})`
            : 'Sort by title';
        dateBtn.title = sort.field === 'date'
            ? `Sorted by date (${sort.dir === 'asc' ? 'oldest first' : 'newest first'})`
            : 'Sort by date';
    },

    sortNotesForList(items) {
        const sort = loadNotesListSort();
        const dir = sort.dir === 'asc' ? 1 : -1;
        return [...items].sort((a, b) => {
            if (sort.field === 'title') {
                const left = (a.title || '').trim().toLowerCase();
                const right = (b.title || '').trim().toLowerCase();
                const emptyRank = (value) => (value ? 0 : 1);
                const rank = emptyRank(left) - emptyRank(right);
                if (rank !== 0) return rank * dir;
                return left.localeCompare(right) * dir;
            }
            const leftTime = Number(a.updated_at || a.created_at || 0);
            const rightTime = Number(b.updated_at || b.created_at || 0);
            return (leftTime - rightTime) * dir;
        });
    },

    buildSidebarNoteTitle(item) {
        const plainTitle = stripRichText(item.title || '') || 'Untitled';
        const titleRich = hasRichMarkup(item.title);
        const titleHtml = titleRich
            ? NoteSurface.renderRichHtml(item.title || '')
            : escapeHTML(plainTitle);
        return {
            titleAttr: escapeAttr(plainTitle),
            titleHtml,
            richClass: titleRich ? ' rich-text' : ''
        };
    },

    renderNotesListZone(zoneId, listItems, allItems, { variant = 'active' } = {}) {
        const zone = document.getElementById(zoneId);
        if (!zone) return;

        const emptyLabels = {
            active: 'No active notes',
            hidden: 'No hidden notes',
            archived: 'No archived notes'
        };

        if (!listItems?.length) {
            zone.innerHTML = `<div class="sidebar-notes-list-empty">${emptyLabels[variant] || 'No notes'}</div>`;
            return;
        }

        const sorted = this.sortNotesForList(listItems);
        zone.innerHTML = sorted.map((item) => {
            const accent = resolveNoteColor(item.backgroundColor);
            const accentStyle = ` style="--note-accent:${escapeAttr(accent)}"`;
            const dateLabel = NoteSurface.formatNoteListDate(item);
            const { titleAttr, titleHtml, richClass } = this.buildSidebarNoteTitle(item);

            if (variant === 'hidden') {
                return `
                <div class="sidebar-notes-list-item has-note-color sidebar-notes-list-item--with-act"${accentStyle}>
                    <button type="button" class="sidebar-notes-list-item-main" data-id="${escapeAttr(item.id)}" title="${titleAttr}">
                        <span class="sidebar-notes-list-item-title${richClass}">${titleHtml}</span>
                        <span class="sidebar-notes-list-date">${escapeHTML(dateLabel)}</span>
                    </button>
                    <button type="button" class="card-act card-act--show unhide-btn" data-id="${escapeAttr(item.id)}" title="Unhide" aria-label="Unhide">${CARD_ICONS.show}</button>
                </div>`;
            }

            return `
            <button type="button" class="sidebar-notes-list-item has-note-color${variant === 'archived' ? ' is-archived' : ''}" data-id="${escapeAttr(item.id)}" title="${titleAttr}"${accentStyle}>
                <span class="sidebar-notes-list-item-title${richClass}">${titleHtml}</span>
                <span class="sidebar-notes-list-date">${escapeHTML(dateLabel)}</span>
            </button>`;
        }).join('');

        zone.querySelectorAll('.sidebar-notes-list-item[data-id]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const item = allItems.find((entry) => entry.id === btn.dataset.id);
                if (!item) return;
                window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: item }));
            });
        });

        zone.querySelectorAll('.sidebar-notes-list-item-main[data-id]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const item = allItems.find((entry) => entry.id === btn.dataset.id);
                if (!item) return;
                window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: item }));
            });
        });

        zone.querySelectorAll('.unhide-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = allItems.find((entry) => entry.id === btn.dataset.id);
                if (item) BoardOperations.unhideFromBoard(item);
            });
        });
    },

    updateNotesList(items) {
        const allItems = items || [];
        const activeItems = allItems.filter((item) => item.status !== 'archived' && !BoardOperations.isHiddenFromBoard(item));
        const hiddenItems = allItems.filter((item) => item.status !== 'archived' && BoardOperations.isHiddenFromBoard(item));
        const archivedItems = allItems.filter((item) => item.status === 'archived');

        const activeCountEl = document.getElementById('notes-active-count');
        const hiddenCountEl = document.getElementById('notes-hidden-count');
        const archivedCountEl = document.getElementById('notes-archived-count');
        if (activeCountEl) activeCountEl.textContent = String(activeItems.length);
        if (hiddenCountEl) hiddenCountEl.textContent = String(hiddenItems.length);
        if (archivedCountEl) archivedCountEl.textContent = String(archivedItems.length);

        this.renderNotesListZone('notes-list-active-zone', activeItems, allItems, { variant: 'active' });
        this.renderNotesListZone('notes-list-hidden-zone', hiddenItems, allItems, { variant: 'hidden' });
        this.renderNotesListZone('notes-list-archived-zone', archivedItems, allItems, { variant: 'archived' });
    },

    renderCategoryListZone(zoneId, names, categories, hiddenCategories, { hidden = false, uncatCount = 0 } = {}) {
        const zone = document.getElementById(zoneId);
        if (!zone) return;

        if (!names?.length) {
            zone.innerHTML = `<div class="sidebar-notes-list-empty">${hidden ? 'No hidden categories' : 'No active categories'}</div>`;
            return;
        }

        const sorted = [...names].sort((a, b) => a.localeCompare(b));
        zone.innerHTML = sorted.map((catName) => {
            const cat = categories.find((entry) => entry.name === catName);
            const color = catName === UNCATEGORIZED_CATEGORY
                ? UNCATEGORIZED_COLOR
                : (cat?.color || UNCATEGORIZED_COLOR);
            const accentStyle = ` style="--note-accent:${escapeAttr(color)}"`;
            const title = catName === UNCATEGORIZED_CATEGORY && uncatCount > 0
                ? escapeHTML(`${UNCATEGORIZED_CATEGORY} (${uncatCount})`)
                : escapeHTML(catName);

            if (hidden) {
                return `
                <div class="sidebar-notes-list-item sidebar-notes-list-item--category sidebar-notes-list-item--with-act has-note-color"${accentStyle}>
                    <span class="sidebar-notes-list-item-title">${title}</span>
                    <button type="button" class="card-act card-act--show show-category-btn" data-category="${escapeAttr(catName)}" title="Show" aria-label="Show">${CARD_ICONS.show}</button>
                </div>`;
            }

            return `
            <div class="sidebar-notes-list-item sidebar-notes-list-item--category sidebar-notes-list-item--label has-note-color"${accentStyle}>
                <span class="sidebar-notes-list-item-title">${title}</span>
            </div>`;
        }).join('');

        zone.querySelectorAll('.show-category-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent('category:show_requested', { detail: { name: btn.dataset.category } }));
            });
        });
    },

    updateCategories(categories, hiddenCategories, items = []) {
        const allCategories = categories || [];
        const hiddenSet = hiddenCategories || [];
        const activeNames = allCategories
            .map((cat) => cat.name)
            .filter((name) => name && !hiddenSet.includes(name));
        const uncatCount = (items || []).filter(
            (item) => item.status !== 'archived' && !BoardOperations.isHiddenFromBoard(item) && !itemHasCategory(item)
        ).length;
        if (uncatCount > 0 && !activeNames.includes(UNCATEGORIZED_CATEGORY)) {
            activeNames.push(UNCATEGORIZED_CATEGORY);
        }
        const hiddenNames = hiddenSet.filter((name) => allCategories.some((cat) => cat.name === name));

        const activeCountEl = document.getElementById('categories-active-count');
        const hiddenCountEl = document.getElementById('categories-hidden-count');
        if (activeCountEl) activeCountEl.textContent = String(activeNames.length);
        if (hiddenCountEl) hiddenCountEl.textContent = String(hiddenNames.length);

        this.renderCategoryListZone('categories-list-active-zone', activeNames, allCategories, hiddenSet, { uncatCount });
        this.renderCategoryListZone('categories-list-hidden-zone', hiddenNames, allCategories, hiddenSet, { hidden: true });
    },

    /** @deprecated use updateCategories */
    updateStatus(_items, categories, hiddenCategories) {
        this.updateCategories(categories, hiddenCategories);
    }
};

/** @deprecated use SidePanel */
export const HamburgerMenu = SidePanel;
