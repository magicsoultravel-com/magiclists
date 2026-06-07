import { isQuickLinksCategory, readStoredCategories } from './categories.js';
import { applyCardTheme } from './cardTheme.js';

export const FREEFORM_DEFAULT_W = 96;
export const FREEFORM_DEFAULT_H = 56;
export const FREEFORM_EXPANDED_W = 196;
export const FREEFORM_MIN_W = 72;
export const FREEFORM_MIN_H = 56;
export const FREEFORM_EXPANDED_DEFAULT_H = 120;

let freeformStackSeq = 1;

export const CARD_ICONS = {
    calendar: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><rect x="1.5" y="2.5" width="9" height="8" rx="0.8" fill="none" stroke="currentColor" stroke-width="1"/><path d="M1.5 5.2h9M4 1.5v1.6M8 1.5v1.6" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>',
    expand: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    collapse: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 7l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    hide: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M1.2 6s1.6-2.8 4.8-2.8S10.8 6 10.8 6 9.2 8.8 6 8.8 1.2 6 1.2 6z" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="6" cy="6" r="1.4" fill="none" stroke="currentColor" stroke-width="1"/><path d="M2 10L10 2" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>',
    show: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M1.2 6s1.6-2.8 4.8-2.8S10.8 6 10.8 6 9.2 8.8 6 8.8 1.2 6 1.2 6z" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="6" cy="6" r="1.4" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
    edit: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M8.2 1.8l2 2-6.4 6.4H1.8V8.2L8.2 1.8z" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>',
    save: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M2.2 6.2l2.6 2.6L9.8 3.8" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
    delete: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 3.2h6M4.2 3.2V2.4h3.6v.8M4.4 5v4.2M7.6 5v4.2M3.8 3.2l.5 6.3h3.4l.5-6.3" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bringFront: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><rect x="1.4" y="4.6" width="7.2" height="5.2" rx="0.55" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M3.4 2.4h7.2v5.2" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

export const ACTION_ICONS = {
    layoutReset: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.2 2.8h3.2M2.2 2.8V6M2.2 2.8l2.4 2.4M9.8 9.2H6.6M9.8 9.2V5.8M9.8 9.2 7.4 6.8" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/><rect x="4.2" y="4.2" width="3.6" height="3.6" rx="0.4" fill="none" stroke="currentColor" stroke-width="0.85"/></svg>',
    viewList: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.2 3.2h7.6M2.2 6h7.6M2.2 8.8h7.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
    viewCols: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.6" y="2.2" width="3.6" height="7.6" rx="0.5" fill="none" stroke="currentColor" stroke-width="0.95"/><rect x="6.8" y="2.2" width="3.6" height="7.6" rx="0.5" fill="none" stroke="currentColor" stroke-width="0.95"/></svg>',
    viewFree: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.5" y="2" width="3.2" height="2.6" rx="0.4" fill="none" stroke="currentColor" stroke-width="0.9"/><rect x="7.3" y="2" width="3.2" height="3.8" rx="0.4" fill="none" stroke="currentColor" stroke-width="0.9"/><rect x="2.8" y="7.2" width="4.4" height="2.8" rx="0.4" fill="none" stroke="currentColor" stroke-width="0.9"/></svg>',
    category: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.4" y="1.4" width="3.9" height="3.9" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.95"/><rect x="6.7" y="1.4" width="3.9" height="3.9" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.95"/><rect x="1.4" y="6.7" width="3.9" height="3.9" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.95"/><rect x="6.7" y="6.7" width="3.9" height="3.9" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.95"/></svg>',
    export: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 1.6v5.8M3.7 5.1 6 7.4 8.3 5.1" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.2 10.4h7.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
    import: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 10.4V4.6M3.7 6.9 6 4.6 8.3 6.9" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.2 10.4h7.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
    logout: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M4.6 2.1H3.1v7.8h1.5" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/><path d="M6.8 6 10 6M10 6 8.4 4.4M10 6 8.4 7.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    undo: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M3.4 5.6H7.2a2.4 2.4 0 1 1 0 4.8H6.6M3.4 5.6 5.1 3.9M3.4 5.6 5.1 7.3" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    redo: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M8.6 5.6H4.8a2.4 2.4 0 0 0 0 4.8h.6M8.6 5.6 6.9 3.9M8.6 5.6 6.9 7.3" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

export function itemHasCategory(item) {
    const name = item?.categories?.[0];
    return typeof name === 'string' && name.trim() !== '';
}

export function getStepLevel(step) {
    const n = Number(step?.level);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(4, Math.floor(n));
}

export function partitionChecklistSteps(steps) {
    const active = [];
    const done = [];
    (steps || []).forEach(step => {
        if (step.completed) done.push(step);
        else active.push(step);
    });
    return { active, done };
}

export function reorderStepsByCompletion(steps) {
    if (!steps?.length) return;
    const { active, done } = partitionChecklistSteps(steps);
    steps.splice(0, steps.length, ...active, ...done);
}

export function moveStepOnCompletionChange(steps, step, completed) {
    step.completed = completed;
    if (!completed) step.level = 0;
    reorderStepsByCompletion(steps);
}

export function stepHasDescendants(steps, index) {
    const level = getStepLevel(steps[index]);
    for (let i = index + 1; i < steps.length; i++) {
        const nextLevel = getStepLevel(steps[i]);
        if (nextLevel <= level) return false;
        if (nextLevel > level) return true;
    }
    return false;
}

export function levelListHasDescendants(levels, index) {
    const level = levels[index];
    for (let i = index + 1; i < levels.length; i++) {
        if (levels[i] <= level) return false;
        if (levels[i] > level) return true;
    }
    return false;
}

export function buildVisibleChecklistSteps(steps, itemId, collapsedKeys = {}) {
    const visible = [];
    let suppressBelow = -1;

    (steps || []).forEach((step, index) => {
        const level = getStepLevel(step);
        if (suppressBelow >= 0 && level > suppressBelow) return;

        suppressBelow = -1;
        const hasKids = stepHasDescendants(steps, index);
        const collapseKey = `${itemId}:${step.id}`;
        const isCollapsed = !!collapsedKeys[collapseKey];

        visible.push({ step, hasKids, isCollapsed, collapseKey });
        if (hasKids && isCollapsed) suppressBelow = level;
    });

    return visible;
}

export function computeNoteSizeKb(item) {
    if (!item) return '0';
    const payload = {
        title: item.title || '',
        content: item.content || '',
        steps: item.steps || [],
        type: item.type || 'note',
        categories: item.categories || []
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    if (bytes === 0) return '0';
    const kb = bytes / 1024;
    if (kb < 0.1) return '<0.1';
    return kb < 10 ? kb.toFixed(1) : String(Math.round(kb));
}

export function attachAutoGrow(textarea, { maxHeight = 120 } = {}) {
    if (!textarea) return;
    textarea.classList.add('input-grow');
    const grow = () => {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    };
    textarea.addEventListener('input', grow);
    grow();
}

export const UI = {
    getLocalHiddenIds() {
        try {
            return JSON.parse(localStorage.getItem('matrix_hidden_board_ids') || '[]');
        } catch {
            return [];
        }
    },

    isHiddenFromBoard(item) {
        if (item.hiddenFromBoard) return true;
        return this.getLocalHiddenIds().includes(item.id);
    },

    hideFromBoard(item) {
        if (localStorage.getItem('admin_token')) {
            window.dispatchEvent(new CustomEvent('item:mutation_requested', {
                detail: { ...item, hiddenFromBoard: true }
            }));
            return;
        }
        const ids = this.getLocalHiddenIds();
        if (!ids.includes(item.id)) ids.push(item.id);
        localStorage.setItem('matrix_hidden_board_ids', JSON.stringify(ids));
        window.dispatchEvent(new CustomEvent('board:visibility_changed'));
    },

    unhideFromBoard(item) {
        const ids = this.getLocalHiddenIds().filter(id => id !== item.id);
        localStorage.setItem('matrix_hidden_board_ids', JSON.stringify(ids));
        if (localStorage.getItem('admin_token')) {
            window.dispatchEvent(new CustomEvent('item:mutation_requested', {
                detail: { ...item, hiddenFromBoard: false }
            }));
            return;
        }
        window.dispatchEvent(new CustomEvent('board:visibility_changed'));
    },

    getLocalCalendarHiddenIds() {
        try {
            return JSON.parse(localStorage.getItem('matrix_calendar_hidden_ids') || '[]');
        } catch {
            return [];
        }
    },

    isHiddenFromCalendar(item) {
        if (item.hideFromCalendar) return true;
        return this.getLocalCalendarHiddenIds().includes(item.id);
    },

    toggleCardCalendar(item, btn) {
        const willHide = !this.isHiddenFromCalendar(item);
        const updated = { ...item, hideFromCalendar: willHide };
        item.hideFromCalendar = willHide;

        const ids = this.getLocalCalendarHiddenIds().filter(id => id !== item.id);
        if (willHide && !localStorage.getItem('admin_token')) ids.push(item.id);
        localStorage.setItem('matrix_calendar_hidden_ids', JSON.stringify(ids));

        if (localStorage.getItem('admin_token')) {
            window.dispatchEvent(new CustomEvent('item:mutation_requested', { detail: updated }));
        }

        window.dispatchEvent(new CustomEvent('calendar:items_changed', { detail: updated }));

        if (btn) {
            btn.title = willHide ? 'Hidden from calendar — click to show' : 'Shown on calendar — click to hide';
            btn.classList.toggle('is-off', willHide);
            btn.classList.toggle('is-on', !willHide);
        }
    },

    getVisibleItems(items) {
        return items.filter(item => !this.isHiddenFromBoard(item));
    },

    captureScrollState(canvas) {
        if (!canvas) return null;
        return {
            canvasScrollTop: canvas.scrollTop,
            cardBodies: [...canvas.querySelectorAll('.mini-card[data-id]')].map((card) => ({
                id: card.dataset.id,
                scrollTop: card.querySelector('.card-body')?.scrollTop ?? 0
            }))
        };
    },

    restoreScrollState(canvas, state) {
        if (!canvas || !state) return;
        canvas.scrollTop = state.canvasScrollTop ?? 0;
        state.cardBodies?.forEach(({ id, scrollTop }) => {
            const card = canvas.querySelector(`.mini-card[data-id="${id}"]`);
            const body = card?.querySelector('.card-body');
            if (body) body.scrollTop = scrollTop;
        });
    },

    emitItemMutation(item, { preserveView = false } = {}) {
        window.dispatchEvent(new CustomEvent('item:mutation_requested', {
            detail: preserveView ? { item, preserveView: true } : item
        }));
    },

    buildNoteSizeHtml(item) {
        const kb = computeNoteSizeKb(item);
        return `<span class="note-size" title="Note content size">${kb} KB</span>`;
    },

    createBlankChecklistStep() {
        return {
            id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            text: '',
            completed: false,
            level: 0,
            startDateTime: '',
            endDateTime: ''
        };
    },

    updateSingleCard(canvas, item, hiddenCategories = []) {
        if (!canvas || !item?.id) return false;
        const card = canvas.querySelector(`.mini-card[data-id="${item.id}"]`);
        if (!card) return false;

        const scrollState = this.captureScrollState(canvas);
        const activeCategories = readStoredCategories()
            .filter((cat) => !hiddenCategories.includes(cat.name));
        const { targetCatName, categoryColor, isQuickLinkType } = this.getCardRenderContext(item, activeCategories);

        if (card.classList.contains('expanded')) {
            this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType);
        } else {
            this.renderCompactCard(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType);
        }

        this.restoreScrollState(canvas, scrollState);
        return true;
    },

    render(canvas, items, viewMode, hiddenCategories = []) {
        if (!canvas) return;
        const scrollState = this.captureScrollState(canvas);
        canvas.innerHTML = '';

        const visibleItems = this.getVisibleItems(items);

        let activeCategories = readStoredCategories();

        activeCategories = activeCategories.filter(cat => !hiddenCategories.includes(cat.name));

        const viewClass = viewMode === 'columns' ? 'view-columns'
            : viewMode === 'freeform' ? 'view-freeform'
            : 'view-list';
        canvas.className = viewClass;

        if (visibleItems.length === 0) {
            const hiddenCount = items.length - visibleItems.length;
            if (items.length > 0 && hiddenCount === items.length) {
                canvas.innerHTML = `<div class="system-status-msg">All objects are hidden. Use the footer to restore them.</div>`;
            } else {
                canvas.innerHTML = `<div class="system-status-msg">Workspace clean. Click "+ New" to commit an entity.</div>`;
            }
            return;
        }

        if (viewMode === 'columns') {
            activeCategories.forEach(catObj => {
                const categoryName = typeof catObj === 'string' ? catObj : catObj.name;
                const catColor = catObj.color || '#64748b';

                const columnItems = visibleItems.filter(item => {
                    if (!itemHasCategory(item)) return false;
                    return item.categories.some(cat => String(cat).toLowerCase() === String(categoryName).toLowerCase());
                });

                canvas.appendChild(this.createColumnStructure(categoryName, catColor, columnItems, activeCategories));
            });

            visibleItems
                .filter(item => !itemHasCategory(item))
                .forEach(item => {
                    canvas.appendChild(this.createCardComponent(item, activeCategories));
                });
        } else if (viewMode === 'freeform') {
            const positions = this.getFreeformPositions();
            let autoX = 8;
            let autoY = 8;
            const cardStep = 104;
            const rowStep = 72;

            [...visibleItems]
                .sort((a, b) => {
                    const aTime = Number(a.created_at || a.updated_at || 0);
                    const bTime = Number(b.created_at || b.updated_at || 0);
                    return aTime - bTime;
                })
                .forEach((item, index) => {
                    const card = this.createCardComponent(item, activeCategories, { freeform: true });
                    const saved = positions[item.id];
                    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
                        card.style.left = `${saved.x}px`;
                        card.style.top = `${saved.y}px`;
                    } else {
                        card.style.left = `${autoX}px`;
                        card.style.top = `${autoY}px`;
                        autoX += cardStep;
                        if (autoX > Math.max(canvas.clientWidth, 320) - cardStep) {
                            autoX = 8;
                            autoY += rowStep;
                        }
                    }
                    card.removeAttribute('draggable');
                    this.applyFreeformSize(card);
                    this.initFreeformCardStack(card, index);
                    canvas.appendChild(card);
                });
        } else {
            [...visibleItems].sort((a, b) => {
                const aTime = Number(a.created_at || a.updated_at || 0);
                const bTime = Number(b.created_at || b.updated_at || 0);
                return aTime - bTime;
            }).forEach(item => {
                canvas.appendChild(this.createCardComponent(item, activeCategories));
            });
        }

        this.restoreScrollState(canvas, scrollState);
    },

    createColumnStructure(categoryName, catColor, columnItems, activeCategories) {
        const colWrapper = document.createElement('div');
        colWrapper.classList.add('canvas-column');
        colWrapper.dataset.category = categoryName;
        colWrapper.style.borderTop = `3px solid ${catColor}`;

        const isCollapsed = this.isCategoryCollapsed(categoryName);
        if (isCollapsed) colWrapper.classList.add('is-collapsed');

        colWrapper.innerHTML = `
            <div class="column-header" draggable="true" data-category="${this.escapeAttr(categoryName)}" style="color: ${catColor};">
                <span class="grab-handle grab-handle--col" title="Drag to reorder categories">⋮⋮</span>
                <span class="column-title">${this.escapeHTML(categoryName)} (${columnItems.length})</span>
                <span class="column-header-actions">
                    <button type="button" class="column-collapse-btn" title="${isCollapsed ? 'Expand category' : 'Collapse category'}" aria-label="${isCollapsed ? 'Expand category' : 'Collapse category'}">${isCollapsed ? '▶' : '▼'}</button>
                    <span class="column-hide-btn" title="Hide this category">×</span>
                </span>
            </div>
        `;

        const collapseBtn = colWrapper.querySelector('.column-collapse-btn');
        collapseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const nowCollapsed = this.toggleCategoryCollapsed(categoryName);
            colWrapper.classList.toggle('is-collapsed', nowCollapsed);
            collapseBtn.textContent = nowCollapsed ? '▶' : '▼';
            collapseBtn.title = nowCollapsed ? 'Expand category' : 'Collapse category';
            collapseBtn.setAttribute('aria-label', collapseBtn.title);
        });

        const hideBtn = colWrapper.querySelector('.column-hide-btn');
        hideBtn.addEventListener('mouseenter', () => hideBtn.style.opacity = '1');
        hideBtn.addEventListener('mouseleave', () => hideBtn.style.opacity = '0.6');
        hideBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            let currentHidden = JSON.parse(localStorage.getItem('matrix_hidden_categories') || '[]');
            if (!currentHidden.includes(categoryName)) {
                currentHidden.push(categoryName);
                localStorage.setItem('matrix_hidden_categories', JSON.stringify(currentHidden));
                window.location.reload();
            }
        });

        columnItems.forEach(item => {
            colWrapper.appendChild(this.createCardComponent(item, activeCategories));
        });

        return colWrapper;
    },

    buildCardActionsHtml(item, isExpanded = false) {
        const calHidden = this.isHiddenFromCalendar(item);
        const calTitle = calHidden ? 'Hidden from calendar — click to show' : 'Shown on calendar — click to hide';
        const expandTitle = isExpanded ? 'Collapse note' : 'Expand note';
        const expandIcon = isExpanded ? CARD_ICONS.collapse : CARD_ICONS.expand;
        return `<div class="card-actions">
            <button type="button" class="card-act card-act--toggle" title="${expandTitle}" aria-label="${expandTitle}">${expandIcon}</button>
            <button type="button" class="card-act card-act--cal ${calHidden ? 'is-off' : 'is-on'}" title="${calTitle}" aria-label="Toggle calendar">${CARD_ICONS.calendar}</button>
            <button type="button" class="card-act card-act--hide" title="Hide from board" aria-label="Hide from board">${CARD_ICONS.hide}</button>
            <button type="button" class="card-act card-act--edit" title="Edit note" aria-label="Edit note">${CARD_ICONS.edit}</button>
        </div>`;
    },

    attachCardActions(card, item, ctx) {
        const actions = card.querySelector('.card-actions');
        if (!actions) return;

        const toggleBtn = actions.querySelector('.card-act--toggle');
        const calBtn = actions.querySelector('.card-act--cal');
        const hideBtn = actions.querySelector('.card-act--hide');
        const editBtn = actions.querySelector('.card-act--edit');

        const consumeSkipExpand = () => {
            if (card.dataset.skipExpand) {
                delete card.dataset.skipExpand;
                return true;
            }
            return false;
        };

        toggleBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (consumeSkipExpand()) return;
            if (ctx) this.toggleCardExpanded(card, item, ctx);
        });

        calBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleCardCalendar(item, calBtn);
        });

        hideBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hideFromBoard(item);
        });

        editBtn?.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            if (card.dataset.freeform === '1') this.raiseFreeformCard(card);
        });

        editBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (consumeSkipExpand()) return;
            if (!localStorage.getItem('admin_token')) return;
            window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: item }));
        });
    },

    applyItemCardTheme(card, item) {
        if (item.backgroundColor) {
            card.style.backgroundColor = item.backgroundColor;
            card.style.borderColor = 'rgba(255,255,255,0.15)';
        }
        applyCardTheme(card, item.backgroundColor || '');
    },

    setupFreeformChrome(card) {
        let chrome = card.querySelector('.ff-chrome');
        if (!chrome) {
            chrome = document.createElement('div');
            chrome.className = 'ff-chrome';
            card.appendChild(chrome);
        }
        if (!chrome.querySelector('.ff-drag-gutter--edge')) {
            const gutter = document.createElement('span');
            gutter.className = 'ff-drag-gutter ff-drag-gutter--edge';
            gutter.title = 'Drag to move';
            chrome.insertBefore(gutter, chrome.firstChild);
        }
        if (!chrome.querySelector('.ff-drag-gutter--top')) {
            const topGutter = document.createElement('span');
            topGutter.className = 'ff-drag-gutter ff-drag-gutter--top';
            topGutter.title = 'Drag to move';
            chrome.appendChild(topGutter);
        }
        if (!chrome.querySelector('.ff-resize-se')) {
            chrome.insertAdjacentHTML('beforeend', `
                <span class="ff-resize ff-resize-n" data-axis="n" title="Resize"></span>
                <span class="ff-resize ff-resize-s" data-axis="s" title="Resize"></span>
                <span class="ff-resize ff-resize-e" data-axis="e" title="Resize"></span>
                <span class="ff-resize ff-resize-w" data-axis="w" title="Resize"></span>
                <span class="ff-resize ff-resize-nw" data-axis="nw" title="Resize"></span>
                <span class="ff-resize ff-resize-ne" data-axis="ne" title="Resize"></span>
                <span class="ff-resize ff-resize-sw" data-axis="sw" title="Resize"></span>
                <span class="ff-resize ff-resize-se" data-axis="se" title="Resize"></span>
            `);
        }
    },

    readFreeformCardSize(card) {
        const rect = card.getBoundingClientRect();
        return {
            w: Math.round(rect.width) || FREEFORM_DEFAULT_W,
            h: Math.round(rect.height) || FREEFORM_DEFAULT_H
        };
    },

    clearFreeformCustomSize(itemId) {
        const sizes = this.getFreeformSizes();
        if (!sizes[itemId]) return;
        delete sizes[itemId];
        localStorage.setItem('matrix_freeform_sizes', JSON.stringify(sizes));
    },

    applyFreeformDimensions(card, w, h) {
        card.style.setProperty('width', `${w}px`, 'important');
        card.style.setProperty('height', `${h}px`, 'important');
        card.style.setProperty('min-height', `${h}px`, 'important');
        card.style.setProperty('max-height', `${h}px`, 'important');
    },

    applyFreeformSize(card) {
        if (card.dataset.freeform !== '1') return;
        const saved = this.getFreeformSizes()[card.dataset.id];
        const isExpanded = card.classList.contains('expanded');
        let w;
        let h;
        if (isExpanded) {
            w = saved?.w ?? FREEFORM_EXPANDED_W;
            h = saved?.h ?? FREEFORM_EXPANDED_DEFAULT_H;
        } else {
            w = FREEFORM_DEFAULT_W;
            h = FREEFORM_DEFAULT_H;
        }
        this.applyFreeformDimensions(card, w, h);
    },

    finalizeFreeformCard(card) {
        if (card.dataset.freeform !== '1') return;
        this.setupFreeformChrome(card);
        this.applyFreeformSize(card);
    },

    getCardRenderContext(item, activeCategories) {
        const targetCatName = (item.categories && item.categories.length > 0) ? item.categories[0] : '';
        const isQuickLinkType = isQuickLinksCategory(targetCatName);
        const matchedCat = activeCategories.find(c => c.name?.toLowerCase() === targetCatName.toLowerCase());
        const categoryColor = matchedCat ? matchedCat.color : '#64748b';
        return { targetCatName, categoryColor, isQuickLinkType };
    },

    updateFreeformCard(card, item, { expanded, dimensions = null } = {}) {
        if (card.dataset.freeform !== '1') return;
        const expandedCards = JSON.parse(localStorage.getItem('matrix_expanded_cards') || '{}');
        expandedCards[item.id] = expanded;
        localStorage.setItem('matrix_expanded_cards', JSON.stringify(expandedCards));

        const activeCategories = readStoredCategories();
        const { targetCatName, categoryColor, isQuickLinkType } = this.getCardRenderContext(item, activeCategories);

        this.applyCardExpandCollapse(card, item, expanded, activeCategories, targetCatName, categoryColor, isQuickLinkType);

        if (dimensions) {
            this.applyFreeformDimensions(card, dimensions.w, dimensions.h);
        } else {
            this.applyFreeformSize(card);
        }
    },

    applyCardExpandCollapse(card, item, expanded, activeCategories, targetCatName, categoryColor, isQuickLinkType) {
        card.classList.add('card-state-changing');
        if (expanded) {
            card.classList.remove('compact');
            card.classList.add('expanded', 'card-animate-expand');
            this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType);
        } else {
            card.classList.remove('expanded', 'card-animate-expand');
            card.classList.add('compact', 'card-animate-collapse');
            this.renderCompactCard(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType);
        }
        const cleanup = () => {
            card.classList.remove('card-state-changing', 'card-animate-expand', 'card-animate-collapse');
        };
        card.addEventListener('animationend', cleanup, { once: true });
        setTimeout(cleanup, 400);
    },

    toggleCardExpanded(card, item, ctx) {
        const expandedCards = JSON.parse(localStorage.getItem('matrix_expanded_cards') || '{}');
        const willExpand = expandedCards[item.id] !== true;

        if (card.dataset.freeform === '1') {
            this.updateFreeformCard(card, item, { expanded: willExpand });
            return;
        }

        expandedCards[item.id] = willExpand;
        localStorage.setItem('matrix_expanded_cards', JSON.stringify(expandedCards));

        this.applyCardExpandCollapse(
            card,
            item,
            willExpand,
            ctx.activeCategories,
            ctx.targetCatName,
            ctx.categoryColor,
            ctx.isQuickLinkType
        );
    },

    createCardComponent(item, activeCategories, { freeform = false } = {}) {
        const card = document.createElement('div');
        card.classList.add('mini-card');
        card.classList.add('compact');
        
        const hasSession = !!localStorage.getItem('admin_token');
        if (hasSession && !freeform) {
            card.setAttribute('draggable', 'true');
        }
        
        card.dataset.id = item.id;
        if (freeform) card.dataset.freeform = '1';

        const targetCatName = (item.categories && item.categories.length > 0) ? item.categories[0] : '';
        const isQuickLinkType = isQuickLinksCategory(targetCatName);
        const matchedCat = activeCategories.find(c => c.name?.toLowerCase() === targetCatName.toLowerCase());
        const categoryColor = matchedCat ? matchedCat.color : '#64748b';

        if (item.backgroundColor) {
            this.applyItemCardTheme(card, item);
        } else {
            applyCardTheme(card, '');
            card.style.borderLeftColor = categoryColor;
        }

        const cardCtx = { activeCategories, targetCatName, categoryColor, isQuickLinkType };
        const expandedCards = JSON.parse(localStorage.getItem('matrix_expanded_cards') || '{}');
        const isExpanded = expandedCards[item.id] === true;

        if (isExpanded) {
            card.classList.remove('compact');
            card.classList.add('expanded');
            this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType);
        } else {
            card.classList.add('compact');
            card.classList.remove('expanded');
            this.renderCompactCard(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType);
        }

        if (freeform) {
            card.addEventListener('mousedown', () => this.raiseFreeformCard(card));
        }

        return card;
    },

    formatCreatedDate(timestamp) {
        if (!timestamp) return '';
        const d = new Date(Number(timestamp) * 1000);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },

    renderCompactCard(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType) {
        const fullTitle = item.title || '';
        const titleAttr = this.escapeHTML(fullTitle).replace(/"/g, '&quot;');

        const typeBadgeHtml = this.buildChecklistBadgeHtml(item, isQuickLinkType);

        let quickLinksHtml = '';
        if (isQuickLinkType && item.steps && item.steps.length > 0) {
            const activeLinks = item.steps.filter(step => step.completed);
            if (activeLinks.length > 0) {
                const firstLink = activeLinks[0];
                let url = firstLink.text.trim();
                if (!/^https?:\/\//i.test(url)) { url = 'https://' + url; }
                const cleanLabel = firstLink.text.replace(/^(https?:\/\/)?(www\.)?/, '');
                quickLinksHtml = `<a href="${url}" target="_blank" class="quicklink-anchor-row compact" title="Navigate to ${url}">${cleanLabel}</a>`;
                if (activeLinks.length > 1) {
                    quickLinksHtml += `<div class="more-links-badge">+${activeLinks.length - 1} more</div>`;
                }
            }
        }
        
        const visibilityBadgeColor = item.visibility === 'public' ? '#10b981' : '#f59e0b';
        
        const isExpanded = false;
        card.innerHTML = `
            <div class="card-header card-drag-zone">
                <div class="mini-card-title" title="${titleAttr}">${this.escapeHTML(fullTitle)}</div>
                ${this.buildCardActionsHtml(item, isExpanded)}
            </div>
            <div class="mini-card-meta compact card-drag-zone">
                <span class="badge-dot" style="background-color: ${visibilityBadgeColor};"></span>
                ${targetCatName ? `<span class="category-name">${this.escapeHTML(targetCatName)}</span>` : ''}
                ${typeBadgeHtml}
            </div>
            ${quickLinksHtml ? `<div class="compact-links">${quickLinksHtml}</div>` : ''}
        `;

        this.attachCardActions(card, item, {
            activeCategories,
            targetCatName,
            categoryColor,
            isQuickLinkType
        });
        this.finalizeFreeformCard(card);
    },

    canEditInline() {
        return !!localStorage.getItem('admin_token');
    },

    buildChecklistBadgeHtml(item, isQuickLinkType) {
        if (isQuickLinkType || item.type !== 'checklist' || !item.steps?.length) return '';
        const completedCount = item.steps.filter((s) => s.completed).length;
        return `<span class="checklist-badge">☑️ ${completedCount}/${item.steps.length}</span>`;
    },

    buildExpandedChecklistHtml(item, canEdit) {
        const collapsedKeys = this.getChecklistCollapsedKeys();
        const { active, done } = partitionChecklistSteps(item.steps);
        let html = '<div class="expanded-checklist">';

        const renderRow = (step, { hasKids = false, isCollapsed = false, collapseKey = '', isDoneSection = false } = {}) => {
            const level = isDoneSection ? 0 : getStepLevel(step);
            const collapseControl = !isDoneSection && hasKids
                ? `<button type="button" class="step-collapse-btn" data-collapse-key="${this.escapeAttr(collapseKey)}" title="${isCollapsed ? 'Expand group' : 'Collapse group'}" aria-label="${isCollapsed ? 'Expand group' : 'Collapse group'}">${isCollapsed ? '▶' : '▼'}</button>`
                : '<span class="step-collapse-spacer" aria-hidden="true"></span>';
            const nestControls = canEdit ? `
                    <button type="button" class="card-act step-outdent-btn" title="Outdent" aria-label="Outdent"${level === 0 ? ' disabled' : ''}>‹</button>
                    <button type="button" class="card-act step-indent-btn" title="Indent" aria-label="Indent"${level >= 4 ? ' disabled' : ''}>›</button>` : '';
            const deleteBtn = canEdit
                ? `<button type="button" class="card-act card-act--danger step-delete-btn" title="Remove item" aria-label="Remove item">${CARD_ICONS.close}</button>`
                : '';
            const textHtml = canEdit
                ? `<span class="step-text card-inline-edit ${step.completed ? 'completed' : ''}" contenteditable="plaintext-only" spellcheck="false" data-field="step-text" data-step-id="${step.id}">${this.escapeHTML(step.text)}</span>`
                : `<span class="step-text ${step.completed ? 'completed' : ''}">${this.escapeHTML(step.text)}</span>`;
            html += `
                <div class="step-row step-row--display${step.completed ? ' step-row--done' : ''}" data-step-id="${step.id}" data-level="${level}" style="padding-left:${level * 0.45}rem">
                    <div class="step-row-leading">
                        ${collapseControl}
                        <input type="checkbox" class="step-check" ${step.completed ? 'checked' : ''}>
                    </div>
                    ${textHtml}
                    <div class="step-row-actions">
                        ${canEdit ? `<span class="step-nest-controls">${nestControls}</span>` : ''}
                        ${deleteBtn}
                    </div>
                </div>
            `;
        };

        buildVisibleChecklistSteps(active, item.id, collapsedKeys)
            .forEach((row) => renderRow(row.step, row));
        done.forEach((step) => renderRow(step, { isDoneSection: true }));

        if (canEdit) {
            html += `<button type="button" class="card-act expanded-checklist-add-btn" title="Add checklist item" aria-label="Add checklist item">+</button>`;
        }

        html += '</div>';
        return html;
    },

    renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType) {
        const canEdit = this.canEditInline();
        const fullTitle = item.title || '';
        const titleAttr = this.escapeHTML(fullTitle).replace(/"/g, '&quot;');
        const titleHtml = canEdit
            ? `<div class="mini-card-title card-inline-edit" contenteditable="plaintext-only" spellcheck="false" data-field="title" data-placeholder="Title…" title="Click to edit">${this.escapeHTML(fullTitle)}</div>`
            : `<div class="mini-card-title" title="${titleAttr}">${this.escapeHTML(fullTitle)}</div>`;

        let bodyHtml = '';
        const hasContent = item.content && item.content.trim();
        if (hasContent || (canEdit && item.type === 'note')) {
            bodyHtml += canEdit
                ? `<div class="card-content-preview card-inline-edit" contenteditable="plaintext-only" spellcheck="false" data-field="content" data-placeholder="Add note…">${this.escapeHTML(item.content || '')}</div>`
                : `<div class="card-content-preview">${this.escapeHTML(item.content)}</div>`;
        }
        
        let checklistHtml = '';
        const showInlineChecklist = !isQuickLinkType && (
            canEdit || (item.type === 'checklist' && item.steps && item.steps.length > 0)
        );
        if (showInlineChecklist) {
            if (!item.steps) item.steps = [];
            checklistHtml = this.buildExpandedChecklistHtml(item, canEdit);
        }
        
        let quickLinksHtml = '';
        if (isQuickLinkType && item.steps && item.steps.length > 0) {
            const activeLinks = item.steps.filter(step => step.completed);
            if (activeLinks.length > 0) {
                const linksMarkup = activeLinks.map(link => {
                    let url = link.text.trim();
                    if (!/^https?:\/\//i.test(url)) { url = 'https://' + url; }
                    const cleanLabel = link.text.replace(/^(https?:\/\/)?(www\.)?/, '');
                    return `<a href="${url}" target="_blank" class="quicklink-anchor-row" title="Navigate to ${url}">${cleanLabel}</a>`;
                }).join('');
                quickLinksHtml = `<div class="expanded-links">${linksMarkup}</div>`;
            } else {
                quickLinksHtml = `<div class="expanded-links empty">No active links. Check boxes in editor to display.</div>`;
            }
        }
        
        const visibilityBadgeColor = item.visibility === 'public' ? '#10b981' : '#f59e0b';
        
        const typeBadgeHtml = this.buildChecklistBadgeHtml(item, isQuickLinkType);
        const bodyDragClass = card.dataset.freeform === '1' ? '' : ' card-drag-zone';
        const createdLabel = this.formatCreatedDate(item.created_at);
        const createdHtml = createdLabel ? `<span class="created-date" title="Created">${createdLabel}</span>` : '';
        const sizeHtml = this.buildNoteSizeHtml(item);

        card.innerHTML = `
            <div class="card-header card-drag-zone">
                ${titleHtml}
                ${this.buildCardActionsHtml(item, true)}
            </div>
            <div class="card-body${bodyDragClass}">
                ${bodyHtml}
                ${checklistHtml}
                ${quickLinksHtml}
            </div>
            <div class="mini-card-meta expanded card-drag-zone">
                <span class="badge-dot" style="background-color: ${visibilityBadgeColor};"></span>
                ${targetCatName ? `<span class="category-name">${this.escapeHTML(targetCatName)}</span>` : ''}
                ${typeBadgeHtml}
                ${sizeHtml}
                ${createdHtml}
            </div>
        `;

        this.attachCardActions(card, item, {
            activeCategories,
            targetCatName,
            categoryColor,
            isQuickLinkType
        });
        this.attachExpandedCardInteractions(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType);
        this.finalizeFreeformCard(card);
    },

    refreshExpandedCard(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType) {
        const body = card.querySelector('.card-body');
        const scrollTop = body?.scrollTop ?? 0;
        this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType);
        const newBody = card.querySelector('.card-body');
        if (newBody) newBody.scrollTop = scrollTop;
    },

    caretAtEdge(el, edge) {
        const sel = window.getSelection();
        if (!sel?.rangeCount) return true;
        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer)) return false;
        const probe = range.cloneRange();
        probe.selectNodeContents(el);
        if (edge === 'start') {
            probe.setEnd(range.startContainer, range.startOffset);
            return probe.toString().length === 0;
        }
        probe.setStart(range.endContainer, range.endOffset);
        return probe.toString().length === 0;
    },

    focusInlineEdit(el, edge = 'end') {
        if (!el) return;
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(edge === 'start');
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    },

    getExpandedInlineEditSequence(card) {
        const fields = [];
        const title = card.querySelector('[data-field="title"].card-inline-edit');
        const content = card.querySelector('[data-field="content"].card-inline-edit');
        if (title) fields.push(title);
        if (content) fields.push(content);
        card.querySelectorAll('[data-field="step-text"].card-inline-edit').forEach((el) => fields.push(el));
        return fields;
    },

    handleInlineEditArrowNav(e, card, fieldEl) {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
        const fields = this.getExpandedInlineEditSequence(card);
        const idx = fields.indexOf(fieldEl);
        if (idx < 0) return false;

        if (e.key === 'ArrowDown' && this.caretAtEdge(fieldEl, 'end') && idx < fields.length - 1) {
            e.preventDefault();
            this.focusInlineEdit(fields[idx + 1], 'start');
            return true;
        }
        if (e.key === 'ArrowUp' && this.caretAtEdge(fieldEl, 'start') && idx > 0) {
            e.preventDefault();
            this.focusInlineEdit(fields[idx - 1], 'end');
            return true;
        }
        return false;
    },

    attachExpandedCardInteractions(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType) {
        const refresh = () => {
            this.refreshExpandedCard(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType);
        };

        if (this.canEditInline()) {
            card.querySelectorAll('.card-inline-edit').forEach((el) => {
                el.addEventListener('click', (e) => e.stopPropagation());
                el.addEventListener('mousedown', (e) => e.stopPropagation());
                el.addEventListener('keydown', (e) => {
                    if (!this.handleInlineEditArrowNav(e, card, el)) e.stopPropagation();
                });
                el.addEventListener('blur', () => {
                    const field = el.dataset.field;
                    if (field === 'title') {
                        item.title = el.textContent.trim();
                    } else if (field === 'content') {
                        item.content = el.textContent;
                    } else if (field === 'step-text') {
                        const step = item.steps?.find(s => s.id === el.dataset.stepId);
                        if (step) step.text = el.textContent.trim();
                    }
                    this.emitItemMutation(item, { preserveView: true });
                });
            });
        }

        if (!isQuickLinkType && card.querySelector('.expanded-checklist')) {
            if (!item.steps) item.steps = [];

            card.querySelector('.expanded-checklist-add-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (item.type !== 'checklist') item.type = 'checklist';
                item.steps.push(this.createBlankChecklistStep());
                reorderStepsByCompletion(item.steps);
                this.emitItemMutation(item, { preserveView: true });
                refresh();
                requestAnimationFrame(() => {
                    const fields = card.querySelectorAll('[data-field="step-text"].card-inline-edit');
                    const last = fields[fields.length - 1];
                    if (last) this.focusInlineEdit(last, 'end');
                });
            });

            card.querySelectorAll('.step-row--display').forEach((row) => {
                const checkbox = row.querySelector('.step-check');
                const stepId = row.dataset.stepId;
                checkbox?.addEventListener('change', (e) => {
                    e.stopPropagation();
                    const step = item.steps.find(s => s.id === stepId);
                    if (!step) return;
                    row.classList.add('step-row--animating');
                    moveStepOnCompletionChange(item.steps, step, checkbox.checked);
                    this.emitItemMutation(item, { preserveView: true });
                    refresh();
                });
            });

            card.querySelectorAll('.step-indent-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const row = btn.closest('.step-row--display');
                    const step = item.steps.find(s => s.id === row?.dataset.stepId);
                    if (!step) return;
                    step.level = Math.min(4, getStepLevel(step) + 1);
                    this.emitItemMutation(item, { preserveView: true });
                    refresh();
                });
            });

            card.querySelectorAll('.step-outdent-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const row = btn.closest('.step-row--display');
                    const step = item.steps.find(s => s.id === row?.dataset.stepId);
                    if (!step) return;
                    step.level = Math.max(0, getStepLevel(step) - 1);
                    this.emitItemMutation(item, { preserveView: true });
                    refresh();
                });
            });

            card.querySelectorAll('.step-collapse-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const key = btn.dataset.collapseKey;
                    if (!key) return;
                    const collapsed = this.getChecklistCollapsedKeys();
                    collapsed[key] = !collapsed[key];
                    if (!collapsed[key]) delete collapsed[key];
                    localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
                    refresh();
                });
            });

            card.querySelectorAll('.step-delete-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const row = btn.closest('.step-row--display');
                    const stepId = row?.dataset.stepId;
                    if (!stepId || !item.steps) return;
                    if (!item.steps.some((s) => s.id === stepId)) return;
                    item.steps = item.steps.filter((s) => s.id !== stepId);
                    this.emitItemMutation(item, { preserveView: true });
                    refresh();
                });
            });
        }
    },

    getChecklistCollapsedKeys() {
        try {
            return JSON.parse(localStorage.getItem('matrix_checklist_collapsed') || '{}');
        } catch {
            return {};
        }
    },

    getFreeformPositions() {
        try {
            return JSON.parse(localStorage.getItem('matrix_freeform_positions') || '{}');
        } catch {
            return {};
        }
    },

    saveFreeformPosition(itemId, x, y) {
        const positions = this.getFreeformPositions();
        positions[itemId] = { x: Math.round(x), y: Math.round(y) };
        localStorage.setItem('matrix_freeform_positions', JSON.stringify(positions));
    },

    getFreeformSizes() {
        try {
            return JSON.parse(localStorage.getItem('matrix_freeform_sizes') || '{}');
        } catch {
            return {};
        }
    },

    saveFreeformSize(itemId, w, h) {
        const sizes = this.getFreeformSizes();
        sizes[itemId] = {
            w: Math.round(Math.max(FREEFORM_MIN_W, w)),
            h: Math.round(Math.max(FREEFORM_MIN_H, h))
        };
        localStorage.setItem('matrix_freeform_sizes', JSON.stringify(sizes));
    },

    saveFreeformSizeFromCard(card) {
        if (card.dataset.freeform !== '1') return;
        const { w, h } = this.readFreeformCardSize(card);
        this.saveFreeformSize(card.dataset.id, w, h);
    },

    resetFreeformLayout() {
        localStorage.removeItem('matrix_freeform_positions');
        localStorage.removeItem('matrix_freeform_sizes');
        window.dispatchEvent(new CustomEvent('board:visibility_changed'));
    },

    initFreeformCardStack(card, orderIndex = 0) {
        if (card.dataset.freeform !== '1') return;
        const z = orderIndex + 1;
        card.style.setProperty('z-index', String(z), 'important');
        if (z >= freeformStackSeq) freeformStackSeq = z + 1;
    },

    raiseFreeformCard(card) {
        if (!card || card.dataset.freeform !== '1') return;
        freeformStackSeq += 1;
        card.style.setProperty('z-index', String(freeformStackSeq), 'important');
        card.classList.add('is-freeform-front');
        card.closest('#app-canvas')?.querySelectorAll('.mini-card.is-freeform-front').forEach((other) => {
            if (other !== card) other.classList.remove('is-freeform-front');
        });
    },

    getCollapsedCategories() {
        try {
            return JSON.parse(localStorage.getItem('matrix_collapsed_categories') || '[]');
        } catch {
            return [];
        }
    },

    isCategoryCollapsed(categoryName) {
        return this.getCollapsedCategories().includes(categoryName);
    },

    toggleCategoryCollapsed(categoryName) {
        const collapsed = this.getCollapsedCategories();
        const idx = collapsed.indexOf(categoryName);
        if (idx >= 0) {
            collapsed.splice(idx, 1);
        } else {
            collapsed.push(categoryName);
        }
        localStorage.setItem('matrix_collapsed_categories', JSON.stringify(collapsed));
        return idx < 0;
    },

    escapeHTML(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    escapeAttr(str) {
        return this.escapeHTML(str).replace(/"/g, '&quot;');
    }
};
