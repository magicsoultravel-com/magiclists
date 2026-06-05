import { isQuickLinksCategory, readStoredCategories } from './categories.js';

export const FREEFORM_DEFAULT_W = 96;
export const FREEFORM_DEFAULT_H = 65;
export const FREEFORM_MIN_W = 72;
export const FREEFORM_MIN_H = 56;
export const FREEFORM_MAX_W = 420;
export const FREEFORM_MAX_H = 520;

export const CARD_ICONS = {
    calendar: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><rect x="1.5" y="2.5" width="9" height="8" rx="0.8" fill="none" stroke="currentColor" stroke-width="1"/><path d="M1.5 5.2h9M4 1.5v1.6M8 1.5v1.6" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>',
    expand: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    collapse: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 7l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    hide: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M1.2 6s1.6-2.8 4.8-2.8S10.8 6 10.8 6 9.2 8.8 6 8.8 1.2 6 1.2 6z" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="6" cy="6" r="1.4" fill="none" stroke="currentColor" stroke-width="1"/><path d="M2 10L10 2" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>',
    show: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M1.2 6s1.6-2.8 4.8-2.8S10.8 6 10.8 6 9.2 8.8 6 8.8 1.2 6 1.2 6z" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="6" cy="6" r="1.4" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
    edit: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M8.2 1.8l2 2-6.4 6.4H1.8V8.2L8.2 1.8z" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>',
    save: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M2.2 6.2l2.6 2.6L9.8 3.8" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
    delete: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 3.2h6M4.2 3.2V2.4h3.6v.8M4.4 5v4.2M7.6 5v4.2M3.8 3.2l.5 6.3h3.4l.5-6.3" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

export const ACTION_ICONS = {
    layoutReset: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.2 2.8h3.2M2.2 2.8V6M2.2 2.8l2.4 2.4M9.8 9.2H6.6M9.8 9.2V5.8M9.8 9.2 7.4 6.8" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/><rect x="4.2" y="4.2" width="3.6" height="3.6" rx="0.4" fill="none" stroke="currentColor" stroke-width="0.85"/></svg>',
    category: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.4" y="1.4" width="3.9" height="3.9" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.95"/><rect x="6.7" y="1.4" width="3.9" height="3.9" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.95"/><rect x="1.4" y="6.7" width="3.9" height="3.9" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.95"/><rect x="6.7" y="6.7" width="3.9" height="3.9" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.95"/></svg>',
    export: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 1.6v5.8M3.7 5.1 6 7.4 8.3 5.1" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.2 10.4h7.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
    import: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 10.4V4.6M3.7 6.9 6 4.6 8.3 6.9" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.2 10.4h7.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
    logout: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M4.6 2.1H3.1v7.8h1.5" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/><path d="M6.8 6 10 6M10 6 8.4 4.4M10 6 8.4 7.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>'
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

export function sortStepsForDisplay(steps) {
    if (!steps?.length) return [];
    return steps
        .map((step, index) => ({ step, index }))
        .sort((a, b) => {
            if (!!a.step.completed !== !!b.step.completed) return a.step.completed ? 1 : -1;
            return a.index - b.index;
        })
        .map(({ step }) => step);
}

export function reorderStepsCompleted(steps) {
    if (!steps?.length) return;
    const active = steps.filter(s => !s.completed);
    const done = steps.filter(s => s.completed);
    steps.splice(0, steps.length, ...active, ...done);
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

export function buildVisibleChecklistSteps(steps, itemId, collapsedKeys = {}) {
    const sorted = sortStepsForDisplay(steps);
    const visible = [];
    let suppressBelow = -1;

    sorted.forEach((step, index) => {
        const level = getStepLevel(step);
        if (suppressBelow >= 0 && level > suppressBelow) return;

        suppressBelow = -1;
        const hasKids = stepHasDescendants(sorted, index);
        const collapseKey = `${itemId}:${step.id}`;
        const isCollapsed = !!collapsedKeys[collapseKey];

        visible.push({ step, hasKids, isCollapsed, collapseKey });
        if (hasKids && isCollapsed) suppressBelow = level;
    });

    return visible;
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

    render(canvas, items, viewMode, hiddenCategories = []) {
        if (!canvas) return;
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
                .forEach(item => {
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
    },

    createColumnStructure(categoryName, catColor, columnItems, activeCategories) {
        const colWrapper = document.createElement('div');
        colWrapper.classList.add('canvas-column');
        colWrapper.dataset.category = categoryName;
        colWrapper.style.borderTop = `3px solid ${catColor}`;

        colWrapper.innerHTML = `
            <div class="column-header" draggable="true" data-category="${this.escapeAttr(categoryName)}" style="color: ${catColor};">
                <span class="grab-handle grab-handle--col" title="Drag to reorder categories">⋮⋮</span>
                <span class="column-title">${this.escapeHTML(categoryName)} (${columnItems.length})</span>
                <span class="column-hide-btn" title="Hide this category">×</span>
            </div>
        `;

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

        toggleBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
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

        editBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!localStorage.getItem('admin_token')) return;
            window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: item }));
        });
    },

    getCardMount(card) {
        return card.querySelector('.ff-card-body') || card;
    },

    setupFreeformShell(card) {
        if (card.querySelector('.ff-card-body')) return;

        const body = document.createElement('div');
        body.className = 'ff-card-body';
        while (card.firstChild) body.appendChild(card.firstChild);
        card.appendChild(body);

        const chrome = document.createElement('div');
        chrome.className = 'ff-chrome';
        chrome.innerHTML = `
            <span class="ff-grab-strip ff-grab-n" title="Drag to move"></span>
            <span class="ff-grab-strip ff-grab-s" title="Drag to move"></span>
            <span class="ff-grab-strip ff-grab-w" title="Drag to move"></span>
            <span class="ff-grab-strip ff-grab-e" title="Drag to move"></span>
            <span class="ff-resize ff-resize-n" data-axis="n" title="Resize"></span>
            <span class="ff-resize ff-resize-s" data-axis="s" title="Resize"></span>
            <span class="ff-resize ff-resize-e" data-axis="e" title="Resize"></span>
            <span class="ff-resize ff-resize-w" data-axis="w" title="Resize"></span>
            <span class="ff-resize ff-resize-nw" data-axis="nw" title="Resize"></span>
            <span class="ff-resize ff-resize-ne" data-axis="ne" title="Resize"></span>
            <span class="ff-resize ff-resize-sw" data-axis="sw" title="Resize"></span>
            <span class="ff-resize ff-resize-se" data-axis="se" title="Resize"></span>
        `;
        card.insertBefore(chrome, body);
        card.classList.add('freeform-tile');
    },

    applyFreeformSize(card) {
        if (card.dataset.freeform !== '1') return;
        const sizes = this.getFreeformSizes();
        const saved = sizes[card.dataset.id];
        const w = saved?.w ?? FREEFORM_DEFAULT_W;
        const h = saved?.h ?? FREEFORM_DEFAULT_H;
        card.style.setProperty('width', `${w}px`, 'important');
        card.style.setProperty('height', `${h}px`, 'important');
    },

    toggleCardExpanded(card, item, ctx) {
        const expandedCards = JSON.parse(localStorage.getItem('matrix_expanded_cards') || '{}');
        const willExpand = !card.classList.contains('expanded');
        expandedCards[item.id] = willExpand;
        localStorage.setItem('matrix_expanded_cards', JSON.stringify(expandedCards));

        if (willExpand) {
            card.classList.remove('compact');
            card.classList.add('expanded');
            this.renderExpandedCard(card, item, ctx.activeCategories, ctx.targetCatName, ctx.categoryColor, ctx.isQuickLinkType);
        } else {
            card.classList.remove('expanded');
            card.classList.add('compact');
            this.renderCompactCard(card, item, ctx.activeCategories, ctx.targetCatName, ctx.categoryColor, ctx.isQuickLinkType);
        }

        if (card.dataset.freeform === '1') this.applyFreeformSize(card);
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
            card.style.backgroundColor = item.backgroundColor;
            card.style.borderColor = 'rgba(255,255,255,0.15)';
        } else {
            card.style.borderLeftColor = categoryColor;
        }

        if (freeform) this.setupFreeformShell(card);

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

        if (freeform) this.applyFreeformSize(card);

        card.addEventListener('click', (e) => {
            if (card.dataset.skipExpand) {
                delete card.dataset.skipExpand;
                return;
            }
            if (e.target.closest('.card-actions') ||
                e.target.classList.contains('step-check') ||
                e.target.classList.contains('quicklink-anchor-row') ||
                e.target.closest('.quicklink-anchor-row, .card-inline-edit, .step-nest-controls, .step-collapse-btn, .ff-chrome')) {
                return;
            }
            this.toggleCardExpanded(card, item, cardCtx);
        });

        return card;
    },

    renderCompactCard(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType) {
        const fullTitle = item.title || '';
        const titleAttr = this.escapeHTML(fullTitle).replace(/"/g, '&quot;');

        let typeBadgeHtml = '';
        if (!isQuickLinkType && item.type === 'checklist' && item.steps && item.steps.length > 0) {
            const completedCount = item.steps.filter(s => s.completed).length;
            typeBadgeHtml = `<span class="checklist-badge">☑️ ${completedCount}/${item.steps.length}</span>`;
        }
        
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
        
        const mount = this.getCardMount(card);
        const isExpanded = false;
        mount.innerHTML = `
            <div class="card-header">
                <div class="mini-card-title" title="${titleAttr}">${this.escapeHTML(fullTitle)}</div>
                ${this.buildCardActionsHtml(item, isExpanded)}
            </div>
            <div class="mini-card-meta compact">
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
    },

    canEditInline() {
        return !!localStorage.getItem('admin_token');
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
        if (!isQuickLinkType && item.type === 'checklist' && item.steps && item.steps.length > 0) {
            const collapsedKeys = this.getChecklistCollapsedKeys();
            checklistHtml = '<div class="expanded-checklist">';
            buildVisibleChecklistSteps(item.steps, item.id, collapsedKeys).forEach(({ step, hasKids, isCollapsed, collapseKey }) => {
                const level = getStepLevel(step);
                const collapseBtn = hasKids
                    ? `<button type="button" class="step-collapse-btn" data-collapse-key="${this.escapeAttr(collapseKey)}" title="${isCollapsed ? 'Expand group' : 'Collapse group'}" aria-label="${isCollapsed ? 'Expand group' : 'Collapse group'}">${isCollapsed ? '▶' : '▼'}</button>`
                    : '<span class="step-collapse-spacer" aria-hidden="true"></span>';
                const nestControls = canEdit ? `
                    <span class="step-nest-controls">
                        <button type="button" class="card-act step-outdent-btn" title="Outdent" aria-label="Outdent"${level === 0 ? ' disabled' : ''}>‹</button>
                        <button type="button" class="card-act step-indent-btn" title="Indent" aria-label="Indent"${level >= 4 ? ' disabled' : ''}>›</button>
                    </span>` : '';
                const textHtml = canEdit
                    ? `<span class="step-text card-inline-edit ${step.completed ? 'completed' : ''}" contenteditable="plaintext-only" spellcheck="false" data-field="step-text" data-step-id="${step.id}">${this.escapeHTML(step.text)}</span>`
                    : `<span class="step-text ${step.completed ? 'completed' : ''}">${this.escapeHTML(step.text)}</span>`;
                checklistHtml += `
                    <div class="step-row step-row--display" data-step-id="${step.id}" data-level="${level}" style="padding-left:${level * 0.45}rem">
                        ${collapseBtn}
                        <input type="checkbox" class="step-check" ${step.completed ? 'checked' : ''}>
                        ${textHtml}
                        ${nestControls}
                    </div>
                `;
            });
            checklistHtml += '</div>';
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
        
        const mount = this.getCardMount(card);
        mount.innerHTML = `
            <div class="card-header">
                ${titleHtml}
                ${this.buildCardActionsHtml(item, true)}
            </div>
            ${bodyHtml}
            ${checklistHtml}
            ${quickLinksHtml}
            <div class="mini-card-meta expanded">
                <span class="badge-dot" style="background-color: ${visibilityBadgeColor};"></span>
                ${targetCatName ? `<span class="category-name">${this.escapeHTML(targetCatName)}</span>` : ''}
            </div>
        `;

        this.attachCardActions(card, item, {
            activeCategories,
            targetCatName,
            categoryColor,
            isQuickLinkType
        });
        this.attachExpandedCardInteractions(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType);
    },

    attachExpandedCardInteractions(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType) {
        const refresh = () => {
            this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor, isQuickLinkType);
        };

        if (this.canEditInline()) {
            card.querySelectorAll('.card-inline-edit').forEach((el) => {
                el.addEventListener('click', (e) => e.stopPropagation());
                el.addEventListener('mousedown', (e) => e.stopPropagation());
                el.addEventListener('keydown', (e) => e.stopPropagation());
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
                    window.dispatchEvent(new CustomEvent('item:mutation_requested', { detail: item }));
                });
            });
        }

        if (!isQuickLinkType && item.type === 'checklist' && item.steps) {
            card.querySelectorAll('.step-row--display').forEach((row) => {
                const checkbox = row.querySelector('.step-check');
                const stepId = row.dataset.stepId;
                checkbox?.addEventListener('change', (e) => {
                    e.stopPropagation();
                    const step = item.steps.find(s => s.id === stepId);
                    if (!step) return;
                    step.completed = checkbox.checked;
                    reorderStepsCompleted(item.steps);
                    window.dispatchEvent(new CustomEvent('item:mutation_requested', { detail: item }));
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
                    window.dispatchEvent(new CustomEvent('item:mutation_requested', { detail: item }));
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
                    window.dispatchEvent(new CustomEvent('item:mutation_requested', { detail: item }));
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
            w: Math.round(Math.min(FREEFORM_MAX_W, Math.max(FREEFORM_MIN_W, w))),
            h: Math.round(Math.min(FREEFORM_MAX_H, Math.max(FREEFORM_MIN_H, h)))
        };
        localStorage.setItem('matrix_freeform_sizes', JSON.stringify(sizes));
    },

    resetFreeformLayout() {
        localStorage.removeItem('matrix_freeform_positions');
        localStorage.removeItem('matrix_freeform_sizes');
        window.dispatchEvent(new CustomEvent('board:visibility_changed'));
    },

    escapeHTML(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    escapeAttr(str) {
        return this.escapeHTML(str).replace(/"/g, '&quot;');
    }
};
