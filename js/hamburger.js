import { UNCATEGORIZED_CATEGORY } from './categories.js';
import { itemHasCategory } from './focusFilter.js';
import { ACTION_ICONS, CARD_ICONS, UI, formatStorageSize, getStorageBreakdown } from './ui.js';
import { getLocalStorageByteEstimate, getLocalStorageUsageBreakdown } from './layoutStorage.js';
import { resolveNoteColor } from './colorPicker.js';
import { hasRichMarkup, stripRichText } from './richText.js';
import { describeHistoryEntry, UndoManager } from './undo.js';
import { positionPanelBelowElement } from './popoverPosition.js';
import {
    readNotesListSort as loadNotesListSort,
    readPanelCollapsed,
    readSidebarSections,
    writeNotesListSort as persistNotesListSort,
    writePanelCollapsed,
    writeSidebarSection
} from './sidebarPrefs.js';

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

export const SidePanel = {
    panel: null,
    toggleBtn: null,
    toggleFab: null,
    appState: null,
    notesListSort: null,
    notesListSortBound: false,
    historyTipEl: null,
    historyTipHideTimer: null,
    historyTipBound: false,

    init(appState) {
        this.appState = appState;
        this.panel = document.getElementById('side-panel');
        this.toggleBtn = document.getElementById('nav-panel-toggle');
        this.toggleFab = document.getElementById('nav-panel-toggle-fab');
        this.notesListSort = loadNotesListSort();

        this.setCollapsed(readPanelCollapsed(), { persist: false });
        this.updateStorageFooter();

        this.toggleBtn?.addEventListener('click', () => this.toggle());
        this.toggleFab?.addEventListener('click', () => this.toggle());
    },

    updateStorageFooter() {
        const container = document.getElementById('sidebar-storage-stats');
        if (!container) return;

        const total = getLocalStorageByteEstimate();
        const mb = (total / (1024 * 1024)).toFixed(2);
        const pct = Math.min(100, Math.round((total / 5_000_000) * 100));
        const { notes, matrix, app } = getStorageBreakdown();
        const keyBreakdown = getLocalStorageUsageBreakdown(6);
        const totalLine = `Total: ${mb} MB (~${pct}%)`;
        const detail = keyBreakdown
            .map((row) => `${row.key}: ${(row.bytes / 1024).toFixed(1)} KB`)
            .join('\n');
        const fallbackDetail = 'Notes: note content · Matrix: categories, layouts, view state · App: theme, tools, session';

        const hintLine = keyBreakdown.length
            ? '<span class="sidebar-storage-stat sidebar-storage-stat--hint">Hover for largest items</span>'
            : '';

        container.innerHTML = `
            <span class="sidebar-storage-stat">Notes: ${formatStorageSize(notes)}</span>
            <span class="sidebar-storage-stat">Matrix: ${formatStorageSize(matrix)}</span>
            <span class="sidebar-storage-stat">App: ${formatStorageSize(app)}</span>
            <span class="sidebar-storage-stat">${totalLine}</span>
            ${hintLine}
        `;
        container.title = detail
            ? `${totalLine}\n${detail}`
            : `${totalLine}\n${fallbackDetail}`;
    },

    setCollapsed(collapsed, { persist = true } = {}) {
        this.panel?.classList.toggle('is-collapsed', collapsed);
        this.toggleBtn?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        this.toggleFab?.classList.toggle('is-hidden', !collapsed);
        if (persist) writePanelCollapsed(collapsed);
    },

    toggle() {
        const collapsed = !this.panel?.classList.contains('is-collapsed');
        this.setCollapsed(collapsed);
    },

    setupStatusClickHandlers() {
        this.bindCollapsable('radio-section-header', 'radio-section', true, '.sidebar-radio__dock', '.collapsable-toggle');
        this.bindCollapsable('tv-section-header', 'tv-section', true, '.sidebar-tv__dock', '.collapsable-toggle');
        this.bindCollapsable('quick-actions-header', 'quick-actions-section', true, '.sidebar-quick-actions__dock', '.collapsable-toggle');
        this.bindCollapsable('categories-section-header', 'categories-section', true);
        this.bindCollapsable('categories-list-active-header', 'categories-list-active-section', true);
        this.bindCollapsable('categories-list-hidden-header', 'categories-list-hidden-section', true);
        this.bindCollapsable('tools-section-header', 'tools-section', true);
        this.bindCollapsable('notes-list-section-header', 'notes-list-section', false, '.sidebar-notes-list-sort');
        this.bindCollapsable('notes-list-active-header', 'notes-list-active-section');
        this.bindCollapsable('notes-list-hidden-header', 'notes-list-hidden-section', true);
        this.bindCollapsable('notes-list-archived-header', 'notes-list-archived-section', true);
        this.bindCollapsable('history-section-header', 'history-section', true);
        this.bindCollapsable('stats-section-header', 'stats-section', true);
        this.setupNotesListSortControls();
        this.bindHistoryTipHandlers();
    },

    bindCollapsable(headerId, sectionId, startCollapsed = false, ignoreSelector = null, toggleSelector = null) {
        const header = document.getElementById(headerId);
        const section = document.getElementById(sectionId);
        if (!header || !section) return;

        applySectionCollapse(sectionId, headerId, startCollapsed);

        if (header.dataset.collapsableBound === 'true') return;
        header.dataset.collapsableBound = 'true';

        const clickTarget = toggleSelector
            ? header.querySelector(toggleSelector)
            : header;
        if (!clickTarget) return;

        clickTarget.addEventListener('click', (e) => {
            if (ignoreSelector && e.target.closest(ignoreSelector)) return;
            if (toggleSelector && !e.target.closest(toggleSelector)) return;
            const toggle = header.querySelector('.collapsable-toggle');
            const nowCollapsed = !section.classList.contains('collapsed');
            section.classList.toggle('collapsed', nowCollapsed);
            toggle?.classList.toggle('collapsed', nowCollapsed);
            writeSidebarSection(sectionId, nowCollapsed);
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
            ? UI.renderRichHtml(item.title || '')
            : this.escapeHTML(plainTitle);
        return {
            titleAttr: this.escapeAttr(plainTitle),
            titleHtml,
            richClass: titleRich ? ' rich-text' : ''
        };
    },

    renderHistoryItem(entry, { redo = false, index = 0 } = {}) {
        const label = entry?.label || 'Edit';
        const safe = this.escapeHTML(label);
        const aria = this.escapeAttr(label);
        const redoClass = redo ? ' sidebar-history-item--redo' : '';
        const stack = redo ? 'redo' : 'undo';
        return `<div class="sidebar-history-item${redoClass}" data-history-stack="${stack}" data-history-index="${index}" aria-label="${aria}">${safe}</div>`;
    },

    getHistoryEntryFromRow(row) {
        if (!row?.dataset) return null;
        const stack = row.dataset.historyStack;
        const index = Number(row.dataset.historyIndex);
        if (!stack || Number.isNaN(index)) return null;
        const entries = stack === 'redo'
            ? [...UndoManager.redoStack].reverse()
            : [...UndoManager.undoStack].reverse();
        return entries[index] || null;
    },

    ensureHistoryTip() {
        if (this.historyTipEl) return this.historyTipEl;
        const tip = document.createElement('div');
        tip.className = 'sidebar-history-tip clock-style-popover is-hidden';
        tip.setAttribute('role', 'tooltip');
        tip.setAttribute('aria-hidden', 'true');
        document.body.appendChild(tip);
        this.historyTipEl = tip;
        return tip;
    },

    hideHistoryTip() {
        if (this.historyTipHideTimer) {
            clearTimeout(this.historyTipHideTimer);
            this.historyTipHideTimer = null;
        }
        if (!this.historyTipEl) return;
        this.historyTipEl.classList.add('is-hidden');
        this.historyTipEl.setAttribute('aria-hidden', 'true');
    },

    showHistoryTip(entry, anchorEl) {
        if (!entry || !anchorEl) return;
        const tip = this.ensureHistoryTip();
        const detail = describeHistoryEntry(entry);
        const titleHtml = this.escapeHTML(detail.title);
        const linesHtml = detail.lines
            .map((line) => `<div class="sidebar-history-tip__line">${this.escapeHTML(line)}</div>`)
            .join('');
        tip.innerHTML = `<div class="sidebar-history-tip__title">${titleHtml}</div>${linesHtml}`;
        tip.classList.remove('is-hidden');
        tip.setAttribute('aria-hidden', 'false');
        positionPanelBelowElement(tip, anchorEl, { gap: 6, margin: 8 });
    },

    bindHistoryTipHandlers() {
        if (this.historyTipBound) return;
        const undoList = document.getElementById('sidebar-history-undo-list');
        const redoList = document.getElementById('sidebar-history-redo-list');
        if (!undoList && !redoList) return;
        this.historyTipBound = true;

        [undoList, redoList].forEach((list) => {
            if (!list) return;

            list.addEventListener('mouseover', (e) => {
                const row = e.target.closest('.sidebar-history-item');
                if (!row || !list.contains(row)) return;
                if (this.historyTipHideTimer) {
                    clearTimeout(this.historyTipHideTimer);
                    this.historyTipHideTimer = null;
                }
                const entry = this.getHistoryEntryFromRow(row);
                if (entry) this.showHistoryTip(entry, row);
            });

            list.addEventListener('mouseleave', () => {
                this.historyTipHideTimer = setTimeout(() => this.hideHistoryTip(), 80);
            });
        });

        document.addEventListener('scroll', () => this.hideHistoryTip(), true);
        window.addEventListener('resize', () => this.hideHistoryTip());
    },

    renderHistoryPanel() {
        const section = document.getElementById('sidebar-history-section');
        const undoList = document.getElementById('sidebar-history-undo-list');
        const redoList = document.getElementById('sidebar-history-redo-list');
        const badge = document.getElementById('history-count-badge');
        if (!section || !undoList || !redoList) return;

        const enabled = !!this.appState?.user?.isLoggedIn;
        section.classList.toggle('is-hidden', !enabled);
        if (!enabled) {
            this.hideHistoryTip();
            return;
        }

        const undoEntries = [...UndoManager.undoStack].reverse();
        const redoEntries = [...UndoManager.redoStack].reverse();

        if (badge) badge.textContent = String(undoEntries.length);

        if (!undoEntries.length && !redoEntries.length) {
            undoList.innerHTML = '<div class="sidebar-notes-list-empty">No history yet</div>';
            redoList.innerHTML = '';
            redoList.classList.add('is-hidden');
            this.hideHistoryTip();
            return;
        }

        undoList.innerHTML = undoEntries.length
            ? undoEntries.map((entry, index) => this.renderHistoryItem(entry, { index })).join('')
            : '<div class="sidebar-notes-list-empty">Nothing to undo</div>';

        if (redoEntries.length) {
            redoList.classList.remove('is-hidden');
            redoList.innerHTML = `<div class="sidebar-history-subheader">Redo</div>${redoEntries.map((entry, index) => this.renderHistoryItem(entry, { redo: true, index })).join('')}`;
        } else {
            redoList.innerHTML = '';
            redoList.classList.add('is-hidden');
        }
        this.hideHistoryTip();
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
            const { titleAttr, titleHtml, richClass } = this.buildSidebarNoteTitle(item);

            if (variant === 'hidden') {
                return `
                <div class="sidebar-notes-list-item has-note-color sidebar-notes-list-item--with-act"${accentStyle}>
                    <button type="button" class="sidebar-notes-list-item-main" data-id="${this.escapeAttr(item.id)}" title="${titleAttr}">
                        <span class="sidebar-notes-list-item-title${richClass}">${titleHtml}</span>
                        <span class="sidebar-notes-list-date">${this.escapeHTML(dateLabel)}</span>
                    </button>
                    <button type="button" class="card-act card-act--show unhide-btn" data-id="${this.escapeAttr(item.id)}" title="Unhide" aria-label="Unhide">${CARD_ICONS.show}</button>
                </div>`;
            }

            return `
            <button type="button" class="sidebar-notes-list-item has-note-color${variant === 'archived' ? ' is-archived' : ''}" data-id="${this.escapeAttr(item.id)}" title="${titleAttr}"${accentStyle}>
                <span class="sidebar-notes-list-item-title${richClass}">${titleHtml}</span>
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
                ? '#64748b'
                : (cat?.color || '#64748b');
            const accentStyle = ` style="--note-accent:${this.escapeAttr(color)}"`;
            const title = catName === UNCATEGORIZED_CATEGORY && uncatCount > 0
                ? this.escapeHTML(`${UNCATEGORIZED_CATEGORY} (${uncatCount})`)
                : this.escapeHTML(catName);

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

    updateCategories(categories, hiddenCategories, items = []) {
        const allCategories = categories || [];
        const hiddenSet = hiddenCategories || [];
        const activeNames = allCategories
            .map((cat) => cat.name)
            .filter((name) => name && !hiddenSet.includes(name));
        const uncatCount = (items || []).filter(
            (item) => item.status !== 'archived' && !UI.isHiddenFromBoard(item) && !itemHasCategory(item)
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
