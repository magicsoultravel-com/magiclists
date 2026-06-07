import { ACTION_ICONS, CARD_ICONS, UI } from './ui.js';
import { resolveNoteColor } from './colorPicker.js';

const NOTES_LIST_SORT_KEY = 'matrix_notes_list_sort';

export const SidePanel = {
    panel: null,
    toggleBtn: null,
    appState: null,
    notesListSort: null,
    notesListSortBound: false,

    init(appState) {
        this.appState = appState;
        this.panel = document.getElementById('side-panel');
        this.toggleBtn = document.getElementById('nav-panel-toggle');
        this.notesListSort = this.readNotesListSort();

        const stored = localStorage.getItem('matrix_panel_collapsed');
        const collapsed = stored === 'true';
        this.setCollapsed(collapsed);

        this.toggleBtn?.addEventListener('click', () => this.toggle());
    },

    moveBrand(collapsed) {
        const brandWrap = document.querySelector('.control-bar-brand');
        const sidebarHost = document.getElementById('side-panel-brand-host');
        const controlHost = document.getElementById('control-bar-brand-host');
        if (!brandWrap || !sidebarHost || !controlHost) return;
        const target = collapsed ? controlHost : sidebarHost;
        if (brandWrap.parentElement !== target) {
            target.appendChild(brandWrap);
        }
        sidebarHost.classList.toggle('is-visible', !collapsed);
        controlHost.classList.toggle('is-visible', collapsed);
    },

    setCollapsed(collapsed) {
        this.moveBrand(collapsed);
        this.panel?.classList.toggle('is-collapsed', collapsed);
        this.toggleBtn?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        localStorage.setItem('matrix_panel_collapsed', collapsed ? 'true' : 'false');
    },

    toggle() {
        const collapsed = !this.panel?.classList.contains('is-collapsed');
        this.setCollapsed(collapsed);
    },

    setupStatusClickHandlers() {
        this.bindCollapsable('quick-actions-header', 'quick-actions-section');
        this.bindCollapsable('view-section-header', 'view-section');
        this.bindCollapsable('categories-section-header', 'categories-section');
        this.bindCollapsable('categories-list-active-header', 'categories-list-active-section');
        this.bindCollapsable('categories-list-hidden-header', 'categories-list-hidden-section', true);
        this.bindCollapsable('tools-section-header', 'tools-section', true);
        this.bindCollapsable('notes-list-section-header', 'notes-list-section', false, '.sidebar-notes-list-sort');
        this.bindCollapsable('notes-list-active-header', 'notes-list-active-section');
        this.bindCollapsable('notes-list-hidden-header', 'notes-list-hidden-section', true);
        this.bindCollapsable('notes-list-archived-header', 'notes-list-archived-section', true);
        this.setupNotesListSortControls();
    },

    bindCollapsable(headerId, sectionId, startCollapsed = false, ignoreSelector = null) {
        const header = document.getElementById(headerId);
        const section = document.getElementById(sectionId);
        if (!header || !section) return;

        const toggle = header.querySelector('.collapsable-toggle');
        if (startCollapsed) {
            section.classList.add('collapsed');
            toggle?.classList.add('collapsed');
        }

        header.addEventListener('click', (e) => {
            if (ignoreSelector && e.target.closest(ignoreSelector)) return;
            section.classList.toggle('collapsed');
            toggle?.classList.toggle('collapsed');
        });
    },

    readNotesListSort() {
        try {
            const stored = JSON.parse(localStorage.getItem(NOTES_LIST_SORT_KEY) || 'null');
            if (stored?.field === 'title' || stored?.field === 'date') {
                return {
                    field: stored.field,
                    dir: stored.dir === 'asc' ? 'asc' : 'desc'
                };
            }
        } catch {
            /* ignore */
        }
        return { field: 'date', dir: 'desc' };
    },

    writeNotesListSort(sort) {
        this.notesListSort = sort;
        localStorage.setItem(NOTES_LIST_SORT_KEY, JSON.stringify(sort));
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
            const current = this.readNotesListSort();
            if (current.field === 'title') {
                this.writeNotesListSort({ field: 'title', dir: current.dir === 'asc' ? 'desc' : 'asc' });
            } else {
                this.writeNotesListSort({ field: 'title', dir: 'asc' });
            }
            if (this.appState?.items) this.updateNotesList(this.appState.items);
        });

        dateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const current = this.readNotesListSort();
            if (current.field === 'date') {
                this.writeNotesListSort({ field: 'date', dir: current.dir === 'asc' ? 'desc' : 'asc' });
            } else {
                this.writeNotesListSort({ field: 'date', dir: 'desc' });
            }
            if (this.appState?.items) this.updateNotesList(this.appState.items);
        });
    },

    updateNotesListSortButtons() {
        const sort = this.readNotesListSort();
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
        const sort = this.readNotesListSort();
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
            const accentStyle = ` style="--note-accent:${this.escapeAttr(accent)}"`;
            const dateLabel = UI.formatNoteListDate(item);
            const title = this.escapeHTML(item.title || 'Untitled');

            if (variant === 'hidden') {
                return `
                <div class="sidebar-notes-list-item has-note-color sidebar-notes-list-item--with-act"${accentStyle}>
                    <button type="button" class="sidebar-notes-list-item-main" data-id="${this.escapeAttr(item.id)}" title="${title}">
                        <span class="sidebar-notes-list-item-title">${title}</span>
                        <span class="sidebar-notes-list-date">${this.escapeHTML(dateLabel)}</span>
                    </button>
                    <button type="button" class="card-act card-act--show unhide-btn" data-id="${this.escapeAttr(item.id)}" title="Unhide" aria-label="Unhide">${CARD_ICONS.show}</button>
                </div>`;
            }

            return `
            <button type="button" class="sidebar-notes-list-item has-note-color${variant === 'archived' ? ' is-archived' : ''}" data-id="${this.escapeAttr(item.id)}" title="${title}"${accentStyle}>
                <span class="sidebar-notes-list-item-title">${title}</span>
                <span class="sidebar-notes-list-date">${this.escapeHTML(dateLabel)}</span>
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
                if (item) UI.unhideFromBoard(item);
            });
        });
    },

    updateNotesList(items) {
        const allItems = items || [];
        const activeItems = allItems.filter((item) => item.status !== 'archived' && !UI.isHiddenFromBoard(item));
        const hiddenItems = allItems.filter((item) => item.status !== 'archived' && UI.isHiddenFromBoard(item));
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

    renderCategoryListZone(zoneId, names, categories, hiddenCategories, { hidden = false } = {}) {
        const zone = document.getElementById(zoneId);
        if (!zone) return;

        if (!names?.length) {
            zone.innerHTML = `<div class="sidebar-notes-list-empty">${hidden ? 'No hidden categories' : 'No active categories'}</div>`;
            return;
        }

        const sorted = [...names].sort((a, b) => a.localeCompare(b));
        zone.innerHTML = sorted.map((catName) => {
            const cat = categories.find((entry) => entry.name === catName);
            const color = cat?.color || '#64748b';
            const accentStyle = ` style="--note-accent:${this.escapeAttr(color)}"`;
            const title = this.escapeHTML(catName);

            if (hidden) {
                return `
                <div class="sidebar-notes-list-item sidebar-notes-list-item--category sidebar-notes-list-item--with-act has-note-color"${accentStyle}>
                    <span class="sidebar-notes-list-item-title">${title}</span>
                    <button type="button" class="card-act card-act--show show-category-btn" data-category="${this.escapeAttr(catName)}" title="Show" aria-label="Show">${CARD_ICONS.show}</button>
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

    updateCategories(categories, hiddenCategories) {
        const allCategories = categories || [];
        const hiddenSet = hiddenCategories || [];
        const activeNames = allCategories
            .map((cat) => cat.name)
            .filter((name) => name && !hiddenSet.includes(name));
        const hiddenNames = hiddenSet.filter((name) => allCategories.some((cat) => cat.name === name));

        const activeCountEl = document.getElementById('categories-active-count');
        const hiddenCountEl = document.getElementById('categories-hidden-count');
        if (activeCountEl) activeCountEl.textContent = String(activeNames.length);
        if (hiddenCountEl) hiddenCountEl.textContent = String(hiddenNames.length);

        this.renderCategoryListZone('categories-list-active-zone', activeNames, allCategories, hiddenSet);
        this.renderCategoryListZone('categories-list-hidden-zone', hiddenNames, allCategories, hiddenSet, { hidden: true });
    },

    /** @deprecated use updateCategories */
    updateStatus(_items, categories, hiddenCategories) {
        this.updateCategories(categories, hiddenCategories);
    },

    escapeAttr(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    },

    escapeHTML(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
};

/** @deprecated use SidePanel */
export const HamburgerMenu = SidePanel;
