import { CARD_ICONS } from './ui.js';

export const SidePanel = {
    panel: null,
    toggleBtn: null,
    appState: null,

    init(appState) {
        this.appState = appState;
        this.panel = document.getElementById('side-panel');
        this.toggleBtn = document.getElementById('nav-panel-toggle');

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
        this.bindCollapsable('status-panel-header', 'status-panel');
        this.bindCollapsable('objects-status-header', 'objects-status-detail', true);
        this.bindCollapsable('categories-status-header', 'categories-status-detail', true);
        this.bindCollapsable('tools-section-header', 'tools-section', true);
    },

    bindCollapsable(headerId, sectionId, startCollapsed = false) {
        const header = document.getElementById(headerId);
        const section = document.getElementById(sectionId);
        if (!header || !section) return;

        const toggle = header.querySelector('.collapsable-toggle');
        if (startCollapsed) {
            section.classList.add('collapsed');
            toggle?.classList.add('collapsed');
        }

        header.addEventListener('click', () => {
            section.classList.toggle('collapsed');
            toggle?.classList.toggle('collapsed');
        });
    },

    updateStatus(items, categories, hiddenCategories) {
        this.updateObjectsStatus(items);
        this.updateCategoriesStatus(categories, hiddenCategories);
    },

    updateObjectsStatus(items) {
        const visible = items.filter(item => {
            try {
                const hiddenIds = JSON.parse(localStorage.getItem('matrix_hidden_board_ids') || '[]');
                return !hiddenIds.includes(item.id) && !item.hiddenFromBoard;
            } catch {
                return !item.hiddenFromBoard;
            }
        });
        const hiddenCount = items.length - visible.length;

        document.getElementById('objects-count-badge').textContent = items.length;
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

        document.getElementById('categories-count-badge').textContent = categories.length;
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
