/** @module {"owns":"sidebar search bar and results panel", "related":["searchFilter.js","hamburger.js"]} */
import { UNCATEGORIZED_COLOR } from './categories.js';
import { isSearchActive, querySearch } from './searchFilter.js';
import { CARD_ICONS } from './icons.js';
import { SidePanel } from './hamburger.js';
import { escapeAttr, escapeHTML } from './domEscape.js';

const DEBOUNCE_MS = 150;

export const SearchBar = {
    root: null,
    input: null,
    clearBtn: null,
    panel: null,
    debounceTimer: null,
    outsideHandler: null,
    keyHandler: null,
    globalKeyHandler: null,
    highlightedIndex: -1,
    resultRows: [],

    getItems: null,
    onOpenItem: null,

    init({ getItems, onOpenItem }) {
        this.getItems = getItems;
        this.onOpenItem = onOpenItem;

        this.root = document.getElementById('side-panel-search');
        this.input = document.getElementById('workspace-search-input');
        this.clearBtn = document.getElementById('workspace-search-clear');
        this.panel = document.getElementById('workspace-search-panel');

        if (!this.root || !this.input || !this.panel) return;

        this.input.addEventListener('input', () => this.onInput());
        this.input.addEventListener('keydown', (e) => this.onInputKeydown(e));
        this.input.addEventListener('focus', () => {
            if (isSearchActive(this.input.value)) this.runSearch();
        });

        this.clearBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.clear();
        });

        this.globalKeyHandler = (e) => {
            if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k') return;
            if (this.isEditableTarget(e.target)) return;
            e.preventDefault();
            if (SidePanel.panel?.classList.contains('is-collapsed')) {
                SidePanel.setCollapsed(false, { persist: false });
            }
            this.input.focus();
            this.input.select();
        };
        document.addEventListener('keydown', this.globalKeyHandler);
        window.addEventListener('resize', () => {
            if (!this.panel?.classList.contains('is-hidden')) this.positionPanel();
        });
    },

    isEditableTarget(target) {
        if (!target) return false;
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        return !!target.isContentEditable;
    },

    onInput() {
        const query = this.input.value;
        this.clearBtn?.classList.toggle('is-visible', !!query.trim());
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.runSearch(), DEBOUNCE_MS);
    },

    runSearch() {
        const query = this.input.value;
        if (!isSearchActive(query)) {
            this.closePanel();
            return;
        }

        const results = querySearch(this.getItems?.() || [], query);

        this.renderPanel(results, query);
        this.openPanel();
    },

    renderPanel(results, query) {
        const { titles, content } = results;
        const hasAny = titles.length || content.length;

        if (!hasAny) {
            this.panel.innerHTML = `<div class="search-results-empty">No matches for "${escapeHTML(query.trim())}"</div>`;
            this.resultRows = [];
            this.highlightedIndex = -1;
            return;
        }

        const sections = [];

        if (titles.length) {
            sections.push(`
                <div class="search-results-section">
                    <div class="search-results-section-title">Titles</div>
                    ${titles.map((hit) => this.renderTitleRow(hit)).join('')}
                </div>`);
        }

        if (content.length) {
            sections.push(`
                <div class="search-results-section">
                    <div class="search-results-section-title">Content</div>
                    ${content.map((hit) => this.renderContentRow(hit)).join('')}
                </div>`);
        }

        this.panel.innerHTML = sections.join('');
        this.bindRowClicks();
        this.resultRows = [...this.panel.querySelectorAll('.search-results-item')];
        this.highlightedIndex = -1;
    },

    isArchivedItem(item) {
        return item?.status === 'archived';
    },

    renderArchivedBadge(item) {
        if (!this.isArchivedItem(item)) return '';
        return `<span class="search-results-archived-badge" title="Archived" aria-hidden="true">${CARD_ICONS.delete}</span>`;
    },

    itemRowTitle(hit) {
        const base = escapeAttr(hit.title || 'Untitled');
        return this.isArchivedItem(hit.item) ? `${base} (Archived)` : base;
    },

    renderTitleRow(hit) {
        const typeLabel = hit.type === 'checklist' ? 'Checklist' : 'Note';
        const category = hit.category
            ? `<span class="search-results-meta">${escapeHTML(hit.category)}</span>`
            : '';
        const archivedClass = this.isArchivedItem(hit.item) ? ' search-results-item--archived' : '';
        return `
            <button type="button" class="search-results-item search-results-item--title${archivedClass}"
                data-action="open-item" data-item-id="${escapeAttr(hit.item.id)}"
                title="${this.itemRowTitle(hit)}"
                style="--note-accent:${escapeAttr(hit.item.backgroundColor || UNCATEGORIZED_COLOR)}">
                <span class="search-results-item-primary">${escapeHTML(hit.title)}</span>
                ${this.renderArchivedBadge(hit.item)}
                <span class="search-results-item-secondary">
                    <span class="search-results-badge">${typeLabel}</span>${category}
                </span>
            </button>`;
    },

    renderContentRow(hit) {
        const stepPrefix = hit.stepLabel
            ? `<span class="search-results-step-label">${hit.stepLabel}: </span>`
            : '';
        const archivedClass = this.isArchivedItem(hit.item) ? ' search-results-item--archived' : '';
        return `
            <button type="button" class="search-results-item search-results-item--content${archivedClass}"
                data-action="open-item" data-item-id="${escapeAttr(hit.item.id)}"
                title="${this.itemRowTitle(hit)}">
                <span class="search-results-item-primary">${escapeHTML(hit.title)}</span>
                ${this.renderArchivedBadge(hit.item)}
                <span class="search-results-item-snippet">${stepPrefix}${hit.snippetHtml}</span>
            </button>`;
    },

    bindRowClicks() {
        this.panel.querySelectorAll('.search-results-item').forEach((row) => {
            row.addEventListener('click', () => this.activateRow(row));
        });
    },

    activateRow(row) {
        if (!row) return;
        const action = row.dataset.action;
        if (action === 'open-item') {
            const itemId = row.dataset.itemId;
            const item = (this.getItems?.() || []).find((entry) => entry.id === itemId);
            if (item) {
                this.onOpenItem?.(item);
                this.closePanel(false);
            }
        }
    },

    onInputKeydown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            this.clear();
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.moveHighlight(1);
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.moveHighlight(-1);
            return;
        }

        if (e.key === 'Enter') {
            if (this.highlightedIndex >= 0 && this.resultRows[this.highlightedIndex]) {
                e.preventDefault();
                this.activateRow(this.resultRows[this.highlightedIndex]);
            }
        }
    },

    moveHighlight(delta) {
        if (!this.resultRows.length) return;
        this.highlightedIndex += delta;
        if (this.highlightedIndex < 0) this.highlightedIndex = this.resultRows.length - 1;
        if (this.highlightedIndex >= this.resultRows.length) this.highlightedIndex = 0;

        this.resultRows.forEach((row, idx) => {
            row.classList.toggle('is-highlighted', idx === this.highlightedIndex);
        });

        const active = this.resultRows[this.highlightedIndex];
        active?.scrollIntoView({ block: 'nearest' });
    },

    openPanel() {
        this.panel.classList.remove('is-hidden');
        this.input.setAttribute('aria-expanded', 'true');
        this.positionPanel();

        if (this.outsideHandler) {
            document.removeEventListener('mousedown', this.outsideHandler, true);
        }
        this.outsideHandler = (e) => {
            if (this.root.contains(e.target)) return;
            this.closePanel(false);
        };
        document.addEventListener('mousedown', this.outsideHandler, true);

        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
        }
        this.keyHandler = (e) => {
            if (e.key === 'Escape' && document.activeElement !== this.input) {
                this.closePanel(false);
            }
        };
        document.addEventListener('keydown', this.keyHandler);
    },

    positionPanel() {
        if (!this.root || !this.panel) return;
        const rect = this.root.getBoundingClientRect();
        this.panel.style.top = `${rect.bottom + 4}px`;
        this.panel.style.left = `${rect.left}px`;
        this.panel.style.minWidth = `${Math.max(rect.width, 280)}px`;
    },

    closePanel(clearHighlight = true) {
        this.panel?.classList.add('is-hidden');
        this.input?.setAttribute('aria-expanded', 'false');
        if (clearHighlight) {
            this.highlightedIndex = -1;
            this.resultRows = [];
        }
        if (this.outsideHandler) {
            document.removeEventListener('mousedown', this.outsideHandler, true);
            this.outsideHandler = null;
        }
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    },

    clear() {
        if (this.input) this.input.value = '';
        this.clearBtn?.classList.remove('is-visible');
        this.closePanel();
        this.panel.innerHTML = '';
        this.input?.blur();
    }
};
