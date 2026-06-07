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
        if (stored === 'true') {
            this.setCollapsed(true);
        }

        this.toggleBtn?.addEventListener('click', () => this.toggle());
    },

    setCollapsed(collapsed) {
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
        this.bindCollapsable('notes-list-section-header', 'notes-list-section', false, '.sidebar-notes-list-sort');
        this.bindCollapsable('notes-list-active-header', 'notes-list-active-section');
        this.bindCollapsable('notes-list-archived-header', 'notes-list-archived-section', true);
        this.bindCollapsable('status-panel-header', 'status-panel');
        this.bindCollapsable('objects-status-header', 'objects-status-detail', true);
        this.bindCollapsable('categories-status-header', 'categories-status-detail', true);
        this.bindCollapsable('tools-section-header', 'tools-section', true);
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

    renderNotesListZone(zoneId, listItems, allItems, { archived = false } = {}) {
        const zone = document.getElementById(zoneId);
        if (!zone) return;

        if (!listItems?.length) {
            zone.innerHTML = `<div class="sidebar-notes-list-empty">${archived ? 'No archived notes' : 'No active notes'}</div>`;
            return;
        }

        const sorted = this.sortNotesForList(listItems);
        zone.innerHTML = sorted.map((item) => {
            const accent = resolveNoteColor(item.backgroundColor);
            const accentStyle = ` style="--note-accent:${this.escapeAttr(accent)}"`;
            const dateLabel = UI.formatNoteListDate(item);
            const title = this.escapeHTML(item.title || 'Untitled');
            return `
            <button type="button" class="sidebar-notes-list-item has-note-color${archived ? ' is-archived' : ''}" data-id="${this.escapeAttr(item.id)}" title="${title}"${accentStyle}>
                <span class="sidebar-notes-list-date">${this.escapeHTML(dateLabel)}</span>
                <span class="sidebar-notes-list-item-title">${title}</span>
            </button>`;
        }).join('');

        zone.querySelectorAll('.sidebar-notes-list-item').forEach((btn) => {
            btn.addEventListener('click', () => {
                const item = allItems.find((entry) => entry.id === btn.dataset.id);
                if (!item) return;
                window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: item }));
            });
        });
    },

    updateNotesList(items) {
        const allItems = items || [];
        const activeItems = allItems.filter((item) => item.status !== 'archived');
        const archivedItems = allItems.filter((item) => item.status === 'archived');

        const activeCountEl = document.getElementById('notes-active-count');
        const archivedCountEl = document.getElementById('notes-archived-count');
        if (activeCountEl) activeCountEl.textContent = String(activeItems.length);
        if (archivedCountEl) archivedCountEl.textContent = String(archivedItems.length);

        this.renderNotesListZone('notes-list-active-zone', activeItems, allItems);
        this.renderNotesListZone('notes-list-archived-zone', archivedItems, allItems, { archived: true });
    },

    escapeAttr(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    },

    updateStatus(items, categories, hiddenCategories) {
        this.updateObjectsStatus(items);
        this.updateCategoriesStatus(categories, hiddenCategories);
    },

    updateObjectsStatus(items) {
        const visible = items.filter(item => {
            if (item.status === 'archived') return false;
            try {
                const hiddenIds = JSON.parse(localStorage.getItem('matrix_hidden_board_ids') || '[]');
                return !hiddenIds.includes(item.id) && !item.hiddenFromBoard;
            } catch {
                return !item.hiddenFromBoard;
            }
        });
        const hiddenCount = items.length - visible.length;

        document.getElementById('objects-count-badge').textContent = `${items.length} / ${hiddenCount}`;
        document.getElementById('objects-visible-count').textContent = visible.length;
        document.getElementById('objects-hidden-count').textContent = hiddenCount;

        this.populateHiddenObjects(items);
    },

    populateHiddenObjects(items) {
        const listContainer = document.getElementById('objects-hidden-list');
        const hiddenItems = items.filter(item => {
            try {
                const hiddenIds = JSON.parse(localStorage.getItem('matrix_hidden_board_ids') || '[]');
                return hiddenIds.includes(item.id) || item.hiddenFromBoard;
            } catch {
                return item.hiddenFromBoard;
            }
        });

        if (hiddenItems.length === 0) {
            listContainer.innerHTML = '';
            return;
        }

        listContainer.innerHTML = hiddenItems.map(item => `
            <div class="list-row--danger" data-id="${item.id}">
                <span class="hidden-item-title">${this.escapeHTML(item.title || 'Untitled')}</span>
                <button type="button" class="hidden-item-btn unhide-btn" data-id="${item.id}" title="Unhide">${CARD_ICONS.show}</button>
            </div>
        `).join('');

        listContainer.querySelectorAll('.unhide-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemId = btn.dataset.id;
                const item = items.find(i => i.id === itemId);
                if (item) {
                    import('./ui.js').then(module => {
                        module.UI.unhideFromBoard(item);
                    });
                }
            });
        });
    },

    updateCategoriesStatus(categories, hiddenCategories) {
        const activeCount = categories.filter(c => !hiddenCategories.includes(c.name)).length;
        const hiddenCount = hiddenCategories.length;

        document.getElementById('categories-count-badge').textContent = `${categories.length} / ${hiddenCount}`;
        document.getElementById('categories-active-count').textContent = activeCount;
        document.getElementById('categories-hidden-count').textContent = hiddenCount;

        this.populateHiddenCategories(categories, hiddenCategories);
    },

    populateHiddenCategories(categories, hiddenCategories) {
        const listContainer = document.getElementById('categories-hidden-list');

        if (hiddenCategories.length === 0) {
            listContainer.innerHTML = '';
            return;
        }

        listContainer.innerHTML = hiddenCategories.map(catName => {
            const cat = categories.find(c => c.name === catName);
            const color = cat?.color || '#64748b';
            return `
                <div class="list-row--danger" data-category="${this.escapeHTML(catName)}" style="border-left-color: ${color};">
                    <span class="hidden-item-title">${this.escapeHTML(catName)}</span>
                    <button type="button" class="hidden-item-btn show-category-btn" data-category="${this.escapeHTML(catName)}" title="Show">${CARD_ICONS.show}</button>
                </div>
            `;
        }).join('');

        listContainer.querySelectorAll('.show-category-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent('category:show_requested', { detail: { name: btn.dataset.category } }));
            });
        });
    },

    escapeHTML(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
};

/** @deprecated use SidePanel */
export const HamburgerMenu = SidePanel;
