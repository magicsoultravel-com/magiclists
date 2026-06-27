/** @module {"owns":"sidebar undo history module", "related":["undo.js","popoverPosition.js","sidebarModules.js"]} */
import { escapeAttr, escapeHTML } from './domEscape.js';
import { describeHistoryEntry, UndoManager } from './undo.js';
import { positionPanelBelowElement } from './popoverPosition.js';

export const SidebarHistory = {
    appState: null,
    historyTipEl: null,
    historyTipHideTimer: null,
    historyTipBound: false,

    init(appState) {
        this.appState = appState;
        this.bindHistoryTipHandlers();
    },

    renderHistoryItem(entry, { redo = false, index = 0 } = {}) {
        const label = entry?.label || 'Edit';
        const safe = escapeHTML(label);
        const aria = escapeAttr(label);
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
        const titleHtml = escapeHTML(detail.title);
        const linesHtml = detail.lines
            .map((line) => `<div class="sidebar-history-tip__line">${escapeHTML(line)}</div>`)
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

    renderPanel() {
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
    }
};
