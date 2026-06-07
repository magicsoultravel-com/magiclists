import { readStoredCategories } from './categories.js';
import { applyCardTheme } from './cardTheme.js';
import { ColorPicker, PALETTE_NOTE, resolveNoteColor, THEME_DEFAULT_COLOR } from './colorPicker.js';

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
    color: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M6 1.8c-2.3 0-4.2 1.7-4.2 3.9 0 1.4.9 2.5 2.1 3.1L4.8 10h2.4l.9-1.2c1.2-.6 2.1-1.7 2.1-3.1C10.2 3.5 8.3 1.8 6 1.8z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/><circle cx="4.4" cy="4.8" r="0.75" fill="currentColor"/><circle cx="6.2" cy="3.8" r="0.65" fill="currentColor" opacity="0.75"/><circle cx="7.5" cy="5.2" r="0.6" fill="currentColor" opacity="0.55"/></svg>',
    delete: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 3.2h6M4.2 3.2V2.4h3.6v.8M4.4 5v4.2M7.6 5v4.2M3.8 3.2l.5 6.3h3.4l.5-6.3" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    archive: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M2.2 4.4h7.6v5.4H2.2z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/><path d="M2 4.4h8V3.5H7.5L6.7 2.5H5.3L4.5 3.5H2v.9z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/><path d="M5 6.2v2.2M7 6.2v2.2" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/></svg>',
    unarchive: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M2.2 5.8h7.6v4H2.2z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/><path d="M2 5.8h8V4.9H7.5L6.7 3.9H5.3L4.5 4.9H2v.9z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/><path d="M6 3.2V6.4M6 3.2 4.6 4.6M6 3.2 7.4 4.6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
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
    redo: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M8.6 5.6H4.8a2.4 2.4 0 0 0 0 4.8h.6M8.6 5.6 6.9 3.9M8.6 5.6 6.9 7.3" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sortAlpha: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M1.8 3.2h3.4M1.8 8.4h3.4M1.8 3.2l3.4 5.2" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.4 3v6M7.5 4.1l0.9-1.1 0.9 1.1M7.5 7.9l0.9 1.1 0.9-1.1" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sortDate: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><circle cx="4.8" cy="6" r="3.1" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M4.8 4.4V6l1.3 0.9" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.2 3v6M8.3 4.1l0.9-1.1 0.9 1.1M8.3 7.9l0.9 1.1 0.9-1.1" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    desktopBg: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.4" y="2.2" width="9.2" height="6.8" rx="0.7" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M2.2 8.4h7.6" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/><circle cx="4.1" cy="5.4" r="1.1" fill="currentColor" opacity="0.85"/><circle cx="6.6" cy="4.6" r="0.85" fill="currentColor" opacity="0.65"/><circle cx="8.1" cy="6.2" r="0.75" fill="currentColor" opacity="0.5"/></svg>',
    chromeBg: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.3" y="1.8" width="3.6" height="8.4" rx="0.5" fill="none" stroke="currentColor" stroke-width="0.9"/><rect x="5.5" y="1.8" width="5.2" height="2.4" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.9"/><rect x="5.5" y="5" width="5.2" height="5.2" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.9"/></svg>',
    clockStyle: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M6 3.2V6l2 1.2" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

export function itemHasCategory(item) {
    const name = item?.categories?.[0];
    return typeof name === 'string' && name.trim() !== '';
}

export function deriveNoteTitle({ title = '', content = '', steps = [] } = {}) {
    const trimmedTitle = String(title || '').trim();
    if (trimmedTitle) return trimmedTitle;

    const contentLine = String(content || '')
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
    if (contentLine) return contentLine.slice(0, 72);

    for (const step of steps || []) {
        const text = String(step?.text || '').trim();
        if (!text) continue;
        const label = text.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
        return (label || text).slice(0, 72);
    }

    return 'Untitled';
}

export function createNoteId() {
    return `item_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function noteHasSavableContent({ title = '', content = '', steps = [] } = {}) {
    if (String(title || '').trim()) return true;
    if (String(content || '').trim()) return true;
    return (steps || []).some((step) => String(step?.text || '').trim());
}

export function normalizeItemForSave(item) {
    if (!item) return item;

    const content = String(item.content || '');
    const steps = (item.steps || []).filter((step) => String(step?.text || '').trim());
    const trimmedTitle = String(item.title || '').trim();

    return {
        ...item,
        steps,
        type: steps.length > 0 ? 'checklist' : 'note',
        title: trimmedTitle || deriveNoteTitle({ content, steps })
    };
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

/** UTF-16 estimate of all keys on this origin — cheap O(n) scan, no network. */
export function getLocalStorageUsedBytes() {
    let chars = 0;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const value = localStorage.getItem(key);
        chars += key.length + (value?.length ?? 0);
    }
    return chars * 2;
}

export function formatStorageSize(bytes) {
    if (!bytes) return '0 KB';
    const kb = bytes / 1024;
    if (kb < 0.1) return '<0.1 KB';
    if (kb < 10) return `${kb.toFixed(1)} KB`;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    const mb = kb / 1024;
    return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
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

    isArchived(item) {
        return item?.status === 'archived';
    },

    hideFromBoard(item) {
        if (localStorage.getItem('admin_token')) {
            this.emitItemMutation(
                { ...item, hiddenFromBoard: true },
                { beforeItem: this.snapshotItem(item) }
            );
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
            this.emitItemMutation(
                { ...item, hiddenFromBoard: false },
                { beforeItem: this.snapshotItem(item) }
            );
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
        const beforeItem = this.snapshotItem(item);
        const willHide = !this.isHiddenFromCalendar(item);
        const updated = { ...item, hideFromCalendar: willHide };
        item.hideFromCalendar = willHide;

        const ids = this.getLocalCalendarHiddenIds().filter(id => id !== item.id);
        if (willHide && !localStorage.getItem('admin_token')) ids.push(item.id);
        localStorage.setItem('matrix_calendar_hidden_ids', JSON.stringify(ids));

        if (localStorage.getItem('admin_token')) {
            this.emitItemMutation(updated, { beforeItem });
        }

        window.dispatchEvent(new CustomEvent('calendar:items_changed', { detail: updated }));

        if (btn) {
            btn.title = willHide ? 'Hidden from calendar — click to show' : 'Shown on calendar — click to hide';
            btn.classList.toggle('is-off', willHide);
            btn.classList.toggle('is-on', !willHide);
        }
    },

    getVisibleItems(items) {
        return items.filter((item) => !this.isHiddenFromBoard(item) && !this.isArchived(item));
    },

    captureScrollState(canvas) {
        if (!canvas) return null;
        return {
            canvasScrollTop: canvas.scrollTop,
            cardBodies: [...canvas.querySelectorAll('.mini-card[data-id]')].map((card) => ({
                id: card.dataset.id,
                scrollTop: (card.querySelector('.editor-note-body') || card.querySelector('.card-body'))?.scrollTop ?? 0
            }))
        };
    },

    restoreScrollState(canvas, state) {
        if (!canvas || !state) return;
        canvas.scrollTop = state.canvasScrollTop ?? 0;
        state.cardBodies?.forEach(({ id, scrollTop }) => {
            const card = canvas.querySelector(`.mini-card[data-id="${id}"]`);
            const body = card?.querySelector('.editor-note-body') || card?.querySelector('.card-body');
            if (body) body.scrollTop = scrollTop;
        });
    },

    snapshotItem(item) {
        return JSON.parse(JSON.stringify(item));
    },

    emitItemMutation(item, { preserveView = false, beforeItem = null, skipRerender = false } = {}) {
        const normalized = normalizeItemForSave(item);
        Object.assign(item, normalized);
        window.dispatchEvent(new CustomEvent('item:mutation_requested', {
            detail: { item: normalized, preserveView, beforeItem, skipRerender }
        }));
    },

    mutateItem(item, mutator, { preserveView = false, skipRerender = false, localOnly = false } = {}) {
        const beforeItem = this.snapshotItem(item);
        mutator(item);
        if (!localOnly) {
            this.emitItemMutation(item, { preserveView, beforeItem, skipRerender });
        }
    },

    syncInlineFieldToItem(el, item) {
        const field = el.dataset.field;
        if (field === 'title') {
            item.title = el.textContent.trim();
        } else if (field === 'content') {
            item.content = el.textContent;
        } else if (field === 'step-text') {
            const step = item.steps?.find(s => s.id === el.dataset.stepId);
            if (step) step.text = el.textContent;
        }
    },

    commitFocusedInlineField(card, item) {
        const active = document.activeElement;
        if (!active || !card.contains(active) || !active.classList.contains('card-inline-edit')) return;
        this.mutateItem(item, () => {
            this.syncInlineFieldToItem(active, item);
        }, { preserveView: true, skipRerender: true });
        active.dataset.skipBlurSave = '1';
    },

    syncCardDraggable(card) {
        const hasSession = !!localStorage.getItem('admin_token');
        const isFreeform = card.dataset.freeform === '1';
        if (!hasSession || isFreeform || card.classList.contains('expanded')) {
            card.removeAttribute('draggable');
            return;
        }
        card.setAttribute('draggable', 'true');
    },

    freeformDragZoneClass(card) {
        return card.dataset.freeform === '1' ? ' card-drag-zone' : '';
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
        const { targetCatName, categoryColor } = this.getCardRenderContext(item, activeCategories);

        if (card.classList.contains('expanded')) {
            this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor);
        } else {
            this.renderCompactCard(card, item, activeCategories, targetCatName, categoryColor);
        }
        this.applyItemCardTheme(card, item);
        card.style.borderLeftColor = categoryColor;

        this.restoreScrollState(canvas, scrollState);
        return true;
    },

    render(canvas, items, viewMode, hiddenCategories = []) {
        if (!canvas) return;
        const scrollState = this.captureScrollState(canvas);
        canvas.innerHTML = '';

        const safeItems = Array.isArray(items) ? items : [];
        const visibleItems = this.getVisibleItems(safeItems);

        let activeCategories = readStoredCategories();

        activeCategories = activeCategories.filter(cat => !hiddenCategories.includes(cat.name));

        const resolvedMode = viewMode === 'freeform' ? 'freeform' : 'columns';
        canvas.className = resolvedMode === 'freeform' ? 'view-freeform' : 'view-columns';

        if (visibleItems.length === 0) {
            const hiddenCount = safeItems.length - visibleItems.length;
            if (safeItems.length > 0 && hiddenCount === safeItems.length) {
                canvas.innerHTML = `<div class="system-status-msg">All objects are hidden. Use the footer to restore them.</div>`;
            } else {
                canvas.innerHTML = `<div class="system-status-msg">Workspace clean. Click "+ New" to commit an entity.</div>`;
            }
            return;
        }

        if (resolvedMode === 'columns') {
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
        } else if (resolvedMode === 'freeform') {
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
        const expandTitle = isExpanded ? 'Collapse note' : 'Expand note';
        const expandIcon = isExpanded ? CARD_ICONS.collapse : CARD_ICONS.expand;
        return `<div class="card-actions">
            <button type="button" class="card-act card-act--toggle" title="${expandTitle}" aria-label="${expandTitle}">${expandIcon}</button>
            <button type="button" class="card-act card-act--color" title="Note color" aria-label="Note color" aria-haspopup="dialog">${CARD_ICONS.color}</button>
            <button type="button" class="card-act card-act--hide" title="Hide from board" aria-label="Hide from board">${CARD_ICONS.hide}</button>
            <button type="button" class="card-act card-act--edit" title="Edit note" aria-label="Edit note">${CARD_ICONS.edit}</button>
        </div>`;
    },

    attachCardActionButton(btn, handler) {
        if (!btn) return;
        let handledByMouse = false;
        btn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            handledByMouse = true;
            handler(e);
        });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (handledByMouse) {
                handledByMouse = false;
                return;
            }
            handler(e);
        });
    },

    attachCardActions(card, item, ctx) {
        const actions = card.querySelector('.card-actions');
        if (!actions) return;

        const toggleBtn = actions.querySelector('.card-act--toggle');
        const colorBtn = actions.querySelector('.card-act--color');
        const hideBtn = actions.querySelector('.card-act--hide');
        const editBtn = actions.querySelector('.card-act--edit');

        const consumeSkipExpand = () => {
            if (card.dataset.skipExpand) {
                delete card.dataset.skipExpand;
                return true;
            }
            return false;
        };

        this.attachCardActionButton(toggleBtn, () => {
            if (consumeSkipExpand()) return;
            if (ctx) this.toggleCardExpanded(card, item, ctx);
        });

        this.attachCardActionButton(colorBtn, () => {
            if (card.dataset.freeform === '1') this.raiseFreeformCard(card);
            card.dataset.skipExpand = '1';
            if (!localStorage.getItem('admin_token')) return;
            ColorPicker.open({
                anchor: colorBtn,
                presets: PALETTE_NOTE,
                value: resolveNoteColor(item.backgroundColor),
                align: 'end',
                onSelect: (color) => {
                    this.mutateItem(item, (it) => {
                        it.backgroundColor = color || THEME_DEFAULT_COLOR;
                    }, { preserveView: true });
                    this.applyItemCardTheme(card, item);
                }
            });
        });

        this.attachCardActionButton(hideBtn, () => {
            this.hideFromBoard(item);
        });

        this.attachCardActionButton(editBtn, () => {
            if (card.dataset.freeform === '1') this.raiseFreeformCard(card);
            if (consumeSkipExpand()) return;
            if (!localStorage.getItem('admin_token')) return;
            window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: item }));
        });
    },

    applyItemCardTheme(card, item) {
        const color = resolveNoteColor(item.backgroundColor);
        card.style.backgroundColor = color;
        card.style.borderColor = 'rgba(255,255,255,0.15)';
        applyCardTheme(card, color);
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
        const matchedCat = activeCategories.find(c => c.name?.toLowerCase() === targetCatName.toLowerCase());
        const categoryColor = matchedCat ? matchedCat.color : '#64748b';
        return { targetCatName, categoryColor };
    },

    updateFreeformCard(card, item, { expanded, dimensions = null } = {}) {
        if (card.dataset.freeform !== '1') return;
        const expandedCards = JSON.parse(localStorage.getItem('matrix_expanded_cards') || '{}');
        expandedCards[item.id] = expanded;
        localStorage.setItem('matrix_expanded_cards', JSON.stringify(expandedCards));

        const activeCategories = readStoredCategories();
        const { targetCatName, categoryColor } = this.getCardRenderContext(item, activeCategories);

        this.applyCardExpandCollapse(card, item, expanded, activeCategories, targetCatName, categoryColor);

        if (dimensions) {
            this.applyFreeformDimensions(card, dimensions.w, dimensions.h);
        } else if (expanded) {
            this.applyFreeformSize(card);
        }
    },

    applyCardExpandCollapse(card, item, expanded, activeCategories, targetCatName, categoryColor) {
        const isFreeform = card.dataset.freeform === '1';
        card.classList.add('card-state-changing');

        const cleanup = () => {
            card.classList.remove('card-state-changing', 'card-animate-expand', 'card-animate-collapse');
        };

        if (expanded) {
            card.classList.remove('compact');
            card.classList.add('expanded', 'card-animate-expand');
            this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor);
            card.addEventListener('animationend', cleanup, { once: true });
            setTimeout(cleanup, 400);
            return;
        }

        if (isFreeform) {
            card.classList.add('card-animate-collapse');
            const finishCollapse = () => {
                card.classList.remove('expanded', 'card-animate-expand', 'card-animate-collapse');
                card.classList.add('compact');
                this.renderCompactCard(card, item, activeCategories, targetCatName, categoryColor);
                cleanup();
                this.applyFreeformSize(card);
            };
            card.addEventListener('animationend', finishCollapse, { once: true });
            setTimeout(finishCollapse, 400);
            return;
        }

        card.classList.remove('expanded', 'card-animate-expand');
        card.classList.add('compact', 'card-animate-collapse');
        this.renderCompactCard(card, item, activeCategories, targetCatName, categoryColor);
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
            ctx.categoryColor
        );
    },

    createCardComponent(item, activeCategories, { freeform = false } = {}) {
        const card = document.createElement('div');
        card.classList.add('mini-card');
        card.classList.add('compact');
        
        card.dataset.id = item.id;
        if (freeform) card.dataset.freeform = '1';

        const targetCatName = (item.categories && item.categories.length > 0) ? item.categories[0] : '';
        const matchedCat = activeCategories.find(c => c.name?.toLowerCase() === targetCatName.toLowerCase());
        const categoryColor = matchedCat ? matchedCat.color : '#64748b';

        this.applyItemCardTheme(card, item);
        card.style.borderLeftColor = categoryColor;

        const expandedCards = JSON.parse(localStorage.getItem('matrix_expanded_cards') || '{}');
        const isExpanded = expandedCards[item.id] === true;

        if (isExpanded) {
            card.classList.remove('compact');
            card.classList.add('expanded');
            this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor);
        } else {
            card.classList.add('compact');
            card.classList.remove('expanded');
            this.renderCompactCard(card, item, activeCategories, targetCatName, categoryColor);
        }

        if (freeform) {
            card.addEventListener('mousedown', () => this.raiseFreeformCard(card));
        }

        this.syncCardDraggable(card);
        return card;
    },

    formatCreatedDate(timestamp) {
        if (!timestamp) return '';
        const d = new Date(Number(timestamp) * 1000);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },

    formatNoteListDate(item) {
        const ts = Number(item?.updated_at || item?.created_at || 0);
        if (!ts) return '—';
        const d = new Date(ts * 1000);
        if (Number.isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },

    buildNoteBodyHtml(item, { canEdit = false, alwaysShowChecklist = false } = {}) {
        let html = '';
        const hasContent = item.content && item.content.trim();
        const showContent = hasContent
            || (canEdit && item.type === 'note')
            || (canEdit && alwaysShowChecklist);
        if (showContent) {
            html += canEdit
                ? `<div class="card-content-preview card-inline-edit" contenteditable="plaintext-only" spellcheck="false" data-field="content" data-placeholder="Add note…">${this.escapeHTML(item.content || '')}</div>`
                : `<div class="card-content-preview">${this.escapeHTML(item.content)}</div>`;
        }

        const showChecklist = (alwaysShowChecklist && canEdit)
            || (!alwaysShowChecklist && (canEdit || (item.type === 'checklist' && item.steps && item.steps.length > 0)));
        if (showChecklist) {
            if (!item.steps) item.steps = [];
            html += this.buildExpandedChecklistHtml(item, canEdit);
        }
        return html;
    },

    escapeQuotes(str) {
        return str ? str.replace(/"/g, '&quot;') : '';
    },

    buildNoteTitleHtml(item, canEdit) {
        const fullTitle = item.title || '';
        const titleAttr = this.escapeHTML(fullTitle).replace(/"/g, '&quot;');
        if (canEdit) {
            return `<div class="mini-card-title card-inline-edit" contenteditable="plaintext-only" spellcheck="false" data-field="title" data-placeholder="Title…">${this.escapeHTML(fullTitle)}</div>`;
        }
        return `<div class="mini-card-title" title="${titleAttr}">${this.escapeHTML(fullTitle)}</div>`;
    },

    buildNoteMetaFooterHtml(item, { mode = 'inline', targetCatName = '', visibilityBadgeColor = '#f59e0b' } = {}) {
        const createdLabel = this.formatCreatedDate(item.created_at);
        const sizeLabel = computeNoteSizeKb(item);
        const createdHtml = createdLabel
            ? `<span class="editor-created-date" title="Created">Created ${createdLabel}</span>`
            : '';
        const sizeHtml = `<span class="editor-note-size" title="Note content size">${sizeLabel} KB</span>`;

        if (mode === 'inline') {
            return `
                <div class="editor-meta-row editor-meta-row--footer editor-meta-row--inline">
                    <span class="editor-meta-badges">
                        <span class="badge-dot" style="background-color: ${visibilityBadgeColor};"></span>
                        ${targetCatName ? `<span class="category-name">${this.escapeHTML(targetCatName)}</span>` : ''}
                    </span>
                    <span class="editor-meta-stats">
                        ${createdHtml}
                        ${sizeHtml}
                    </span>
                </div>
            `;
        }

        return `
            <div class="editor-meta-row editor-meta-row--footer">
                ${createdHtml || '<span></span>'}
                ${sizeHtml}
            </div>
        `;
    },

    buildNoteConfigPanelHtml(item, { categoryOptionsHtml = '', startParts = {}, endParts = {} } = {}) {
        return `
            <div class="editor-panel editor-panel--config">
                <div class="collapsable-header" id="config-section-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle collapsed">▼</span>Configuration</span>
                </div>
                <div class="collapsable-section collapsed" id="config-section">
                    <div class="form-row-grid form-row-grid--2">
                        <div class="form-group form-group--compact">
                            <label>Visibility</label>
                            <select id="edit-visibility" class="form-input">
                                <option value="private" ${item.visibility === 'private' ? 'selected' : ''}>Private</option>
                                <option value="public" ${item.visibility === 'public' ? 'selected' : ''}>Public</option>
                            </select>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>Start</label>
                            <div class="datetime-input-row">
                                <input type="date" id="edit-start-date" class="form-input" value="${startParts.date || ''}">
                                <input type="time" id="edit-start-time" class="form-input form-input--optional-time" value="${startParts.time || ''}" step="60" title="Optional — leave blank for date only">
                            </div>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>End</label>
                            <div class="datetime-input-row">
                                <input type="date" id="edit-end-date" class="form-input" value="${endParts.date || ''}">
                                <input type="time" id="edit-end-time" class="form-input form-input--optional-time" value="${endParts.time || ''}" step="60" title="Optional — leave blank for date only">
                            </div>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>Category</label>
                            <select id="edit-category" class="form-input">${categoryOptionsHtml}</select>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>Status</label>
                            <select id="edit-status" class="form-input">
                                <option value="active" ${item.status === 'active' ? 'selected' : ''}>Active</option>
                                <option value="archived" ${item.status === 'archived' ? 'selected' : ''}>Archived</option>
                                <option value="completed" ${item.status === 'completed' ? 'selected' : ''}>Done</option>
                            </select>
                        </div>
                        <div class="form-group form-group--compact form-group--color">
                            <label>Card color</label>
                            <input type="hidden" id="edit-bg-color-value" value="${this.escapeQuotes(resolveNoteColor(item.backgroundColor))}">
                            <button type="button" id="edit-color-trigger" class="color-picker-trigger" title="Choose card color" aria-label="Choose card color" aria-haspopup="dialog">
                                <span class="color-picker-trigger-dot"></span>
                                <span class="color-picker-trigger-label">Choose color</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    buildNoteEditorShell(item, {
        canEdit = false,
        alwaysShowChecklist = false,
        showConfig = false,
        toolbarHtml = '',
        toolbarDragZone = '',
        footerDragZone = '',
        metaMode = 'inline',
        targetCatName = '',
        visibilityBadgeColor = '#f59e0b',
        categoryOptionsHtml = '',
        startParts = {},
        endParts = {},
        bodyId = ''
    } = {}) {
        const titleHtml = this.buildNoteTitleHtml(item, canEdit);
        const bodyHtml = this.buildNoteBodyHtml(item, {
            canEdit,
            alwaysShowChecklist: alwaysShowChecklist || canEdit
        });
        const configHtml = showConfig
            ? this.buildNoteConfigPanelHtml(item, { categoryOptionsHtml, startParts, endParts })
            : '';
        const metaHtml = this.buildNoteMetaFooterHtml(item, {
            mode: metaMode,
            targetCatName,
            visibilityBadgeColor
        });
        const bodyIdAttr = bodyId ? ` id="${bodyId}"` : '';

        return `
            <div class="editor-note-shell note-surface">
                ${toolbarHtml ? `<div class="note-editor-toolbar${toolbarDragZone}">${toolbarHtml}</div>` : ''}
                <div class="editor-note-header">
                    ${titleHtml}
                </div>
                ${configHtml}
                <div class="card-body editor-note-body"${bodyIdAttr}>
                    ${bodyHtml}
                </div>
                <div class="${footerDragZone ? `editor-meta-wrap${footerDragZone}` : 'editor-meta-wrap'}">
                    ${metaHtml}
                </div>
            </div>
        `;
    },

    markNoteExpanded(itemId) {
        if (!itemId) return;
        const expandedCards = JSON.parse(localStorage.getItem('matrix_expanded_cards') || '{}');
        expandedCards[itemId] = true;
        localStorage.setItem('matrix_expanded_cards', JSON.stringify(expandedCards));
    },

    revealNoteOnBoard(item) {
        if (!item?.id) return;
        window.dispatchEvent(new CustomEvent('editor:reveal_on_board', { detail: item }));
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

    bindNoteEditorShell(root, item, {
        showConfig = false,
        localOnly = false,
        refresh = () => {},
        onChange = () => {},
        onConfigChange = () => {},
        onStatusChange = () => {},
        bindDateDefaults = null,
        setupColorPalette = null,
        stopMousedownPropagation = false
    } = {}) {
        const shell = root?.querySelector?.('.editor-note-shell') || root;
        if (!shell || !item) return;

        const interactionOptions = {
            refresh,
            localOnly,
            onChange,
            stopMousedownPropagation
        };
        const header = shell.querySelector('.editor-note-header');
        const body = shell.querySelector('.editor-note-body');
        if (header) this.attachNoteBodyInteractions(header, item, interactionOptions);
        if (body) this.attachNoteBodyInteractions(body, item, interactionOptions);

        if (localOnly && onChange) {
            shell.querySelectorAll('.card-inline-edit').forEach((el) => {
                el.addEventListener('input', onChange);
            });
        }

        if (!showConfig) return;

        ['edit-visibility', 'edit-status', 'edit-category', 'edit-start-date', 'edit-start-time', 'edit-end-date', 'edit-end-time'].forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', onConfigChange);
            el.addEventListener('change', () => {
                onConfigChange();
                if (id === 'edit-status' && onStatusChange) onStatusChange();
            });
        });

        if (bindDateDefaults) {
            bindDateDefaults('edit-start-date', 'edit-start-time');
            bindDateDefaults('edit-end-date', 'edit-end-time');
        }
        this.bindCollapsable('config-section-header', 'config-section', true);
        if (setupColorPalette) setupColorPalette(item);
    },

    renderCompactCard(card, item, activeCategories, targetCatName, categoryColor) {
        card.classList.remove('note-surface');
        const fullTitle = item.title || '';
        const titleAttr = this.escapeHTML(fullTitle).replace(/"/g, '&quot;');
        const visibilityBadgeColor = item.visibility === 'public' ? '#10b981' : '#f59e0b';
        
        const isExpanded = false;
        const dragZone = this.freeformDragZoneClass(card);
        card.innerHTML = `
            <div class="card-header${dragZone}">
                <div class="mini-card-title" title="${titleAttr}">${this.escapeHTML(fullTitle)}</div>
                ${this.buildCardActionsHtml(item, isExpanded)}
            </div>
            <div class="mini-card-meta compact${dragZone}">
                <span class="badge-dot" style="background-color: ${visibilityBadgeColor};"></span>
                ${targetCatName ? `<span class="category-name">${this.escapeHTML(targetCatName)}</span>` : ''}
            </div>
        `;

        this.attachCardActions(card, item, {
            activeCategories,
            targetCatName,
            categoryColor
        });
        this.finalizeFreeformCard(card);
        this.syncCardDraggable(card);
    },

    canEditInline() {
        return !!localStorage.getItem('admin_token');
    },

    buildExpandedChecklistHtml(item, canEdit) {
        const collapsedKeys = this.getChecklistCollapsedKeys();
        const { active, done } = partitionChecklistSteps(item.steps);
        let html = '<div class="expanded-checklist">';

        const renderRow = (step, { hasKids = false, isCollapsed = false, collapseKey = '', isDoneSection = false } = {}) => {
            const level = getStepLevel(step);
            const collapseControl = !isDoneSection && hasKids
                ? `<button type="button" class="step-collapse-btn" data-collapse-key="${this.escapeAttr(collapseKey)}" title="${isCollapsed ? 'Expand group' : 'Collapse group'}" aria-label="${isCollapsed ? 'Expand group' : 'Collapse group'}">${isCollapsed ? '▶' : '▼'}</button>`
                : '<span class="step-collapse-spacer" aria-hidden="true"></span>';
            const dragHandle = !canEdit
                ? ''
                : isDoneSection
                    ? '<span class="grab-handle grab-handle--step grab-handle--spacer" aria-hidden="true">⋮⋮</span>'
                    : '<span class="grab-handle grab-handle--step" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span>';
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
                        ${dragHandle}
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
        if (active.length > 0 && done.length > 0) {
            html += '<div class="checklist-done-divider" role="separator" aria-hidden="true"></div>';
        }
        done.forEach((step) => renderRow(step, { isDoneSection: true }));

        if (canEdit) {
            html += `<button type="button" class="card-act expanded-checklist-add-btn" title="Add checklist item" aria-label="Add checklist item">+</button>`;
        }

        html += '</div>';
        return html;
    },

    renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor) {
        const canEdit = this.canEditInline();
        const visibilityBadgeColor = item.visibility === 'public' ? '#10b981' : '#f59e0b';
        const dragZone = this.freeformDragZoneClass(card);

        card.innerHTML = this.buildNoteEditorShell(item, {
            canEdit,
            toolbarHtml: this.buildCardActionsHtml(item, true),
            toolbarDragZone: dragZone,
            footerDragZone: dragZone,
            metaMode: 'inline',
            targetCatName,
            visibilityBadgeColor
        });

        this.attachCardActions(card, item, {
            activeCategories,
            targetCatName,
            categoryColor
        });
        this.bindNoteEditorShell(card, item, {
            refresh: () => this.refreshExpandedCard(card, item, activeCategories, targetCatName, categoryColor),
            stopMousedownPropagation: card.dataset.freeform === '1'
        });
        this.finalizeFreeformCard(card);
        this.syncCardDraggable(card);
    },

    refreshExpandedCard(card, item, activeCategories, targetCatName, categoryColor) {
        const body = card.querySelector('.editor-note-body') || card.querySelector('.card-body');
        const scrollTop = body?.scrollTop ?? 0;
        const pendingFocusStepId = card.dataset.pendingFocusStepId;
        this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor);
        const newBody = card.querySelector('.editor-note-body') || card.querySelector('.card-body');
        if (newBody) newBody.scrollTop = scrollTop;
        if (pendingFocusStepId) {
            card.dataset.pendingFocusStepId = pendingFocusStepId;
            this.focusPendingChecklistStep(card);
        }
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

    getInlineEditSequence(root) {
        const fields = [];
        const title = root.querySelector('[data-field="title"].card-inline-edit');
        const content = root.querySelector('[data-field="content"].card-inline-edit');
        if (title) fields.push(title);
        if (content) fields.push(content);
        root.querySelectorAll('[data-field="step-text"].card-inline-edit').forEach((el) => fields.push(el));
        return fields;
    },

    handleInlineEditArrowNav(e, root, fieldEl) {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
        const sequenceRoot = fieldEl.closest('.editor-note-shell') || root;
        const fields = this.getInlineEditSequence(sequenceRoot);
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

    insertChecklistStep(root, item, refresh, applyMutate, { afterStepId = null } = {}) {
        const newStep = this.createBlankChecklistStep();
        applyMutate((it) => {
            if (it.type !== 'checklist') it.type = 'checklist';
            if (!it.steps) it.steps = [];
            if (afterStepId) {
                const idx = it.steps.findIndex((s) => s.id === afterStepId);
                it.steps.splice(idx >= 0 ? idx + 1 : it.steps.length, 0, newStep);
            } else {
                it.steps.push(newStep);
            }
            reorderStepsByCompletion(it.steps);
        }, { persist: false });

        root.dataset.pendingFocusStepId = newStep.id;
        refresh();
        this.focusPendingChecklistStep(root);
    },

    focusPendingChecklistStep(root) {
        const focusNewStep = () => {
            const pendingId = root.dataset.pendingFocusStepId;
            if (!pendingId) return false;
            const newEl = root.querySelector(
                `[data-field="step-text"].card-inline-edit[data-step-id="${pendingId}"]`
            );
            if (!newEl) return false;
            delete root.dataset.pendingFocusStepId;
            this.focusInlineEdit(newEl, 'start');
            return true;
        };

        requestAnimationFrame(() => {
            if (!focusNewStep()) requestAnimationFrame(() => focusNewStep());
        });
    },

    handleChecklistEnter(root, item, el, refresh, { applyMutate } = {}) {
        el.dataset.skipBlurSave = '1';
        this.syncInlineFieldToItem(el, item);
        this.insertChecklistStep(root, item, refresh, applyMutate, { afterStepId: el.dataset.stepId });
    },

    attachNoteBodyInteractions(root, item, {
        refresh = () => {},
        localOnly = false,
        onChange = () => {},
        stopMousedownPropagation = false
    } = {}) {
        const applyMutate = (mutator, { persist = !localOnly } = {}) => {
            if (persist) {
                this.mutateItem(item, mutator, { preserveView: true, skipRerender: true, localOnly });
                if (localOnly) onChange();
            } else {
                mutator(item);
            }
        };

        if (this.canEditInline() || localOnly) {
            if (!root.dataset.noteInteractionsBound) {
                root.dataset.noteInteractionsBound = '1';
                root.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    const active = document.activeElement;
                    if (!active?.classList?.contains('card-inline-edit') || !root.contains(active)) return;
                    if (active === e.target || active.contains(e.target)) return;
                    applyMutate(() => this.syncInlineFieldToItem(active, item));
                    active.dataset.skipBlurSave = '1';
                }, true);
            }

            root.querySelectorAll('.card-inline-edit').forEach((el) => {
                el.addEventListener('click', (e) => e.stopPropagation());
                if (stopMousedownPropagation) {
                    el.addEventListener('mousedown', (e) => e.stopPropagation());
                }
                el.addEventListener('keydown', (e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        document.execCommand('undo');
                        return;
                    }
                    if (el.dataset.field === 'step-text' && e.key === 'Enter') {
                        if (e.shiftKey) {
                            e.preventDefault();
                            e.stopPropagation();
                            document.execCommand('insertLineBreak');
                            return;
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        this.handleChecklistEnter(root, item, el, refresh, { applyMutate });
                        return;
                    }
                    if (!this.handleInlineEditArrowNav(e, root, el)) e.stopPropagation();
                });
                el.addEventListener('blur', () => {
                    if (el.dataset.skipBlurSave) {
                        delete el.dataset.skipBlurSave;
                        return;
                    }
                    applyMutate(() => this.syncInlineFieldToItem(el, item));
                });
            });
        }

        if (root.querySelector('.expanded-checklist')) {
            if (!item.steps) item.steps = [];

            root.querySelector('.expanded-checklist-add-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.insertChecklistStep(root, item, refresh, applyMutate);
            });

            root.querySelectorAll('.step-row--display').forEach((row) => {
                const checkbox = row.querySelector('.step-check');
                const stepId = row.dataset.stepId;
                checkbox?.addEventListener('change', (e) => {
                    e.stopPropagation();
                    if (!item.steps.find(s => s.id === stepId)) return;
                    row.classList.add('step-row--animating');
                    applyMutate((it) => {
                        const s = it.steps.find(st => st.id === stepId);
                        if (!s) return;
                        moveStepOnCompletionChange(it.steps, s, checkbox.checked);
                    });
                    refresh();
                });
            });

            root.querySelectorAll('.step-indent-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const row = btn.closest('.step-row--display');
                    const stepId = row?.dataset.stepId;
                    if (!stepId) return;
                    applyMutate((it) => {
                        const step = it.steps.find(s => s.id === stepId);
                        if (!step) return;
                        step.level = Math.min(4, getStepLevel(step) + 1);
                    });
                    refresh();
                });
            });

            root.querySelectorAll('.step-outdent-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const row = btn.closest('.step-row--display');
                    const stepId = row?.dataset.stepId;
                    if (!stepId) return;
                    applyMutate((it) => {
                        const step = it.steps.find(s => s.id === stepId);
                        if (!step) return;
                        step.level = Math.max(0, getStepLevel(step) - 1);
                    });
                    refresh();
                });
            });

            root.querySelectorAll('.step-collapse-btn').forEach((btn) => {
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

            root.querySelectorAll('.step-delete-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const row = btn.closest('.step-row--display');
                    const stepId = row?.dataset.stepId;
                    if (!stepId || !item.steps) return;
                    if (!item.steps.some((s) => s.id === stepId)) return;
                    applyMutate((it) => {
                        it.steps = it.steps.filter((s) => s.id !== stepId);
                        if (!it.steps.length) it.type = 'note';
                    });
                    refresh();
                });
            });

            if (this.canEditInline() || localOnly) {
                this.attachChecklistDrag(root, item, applyMutate, refresh);
            }
        }
    },

    attachChecklistDrag(root, item, applyMutate, refresh) {
        if (!root.querySelector('.expanded-checklist')) return;
        if (root.dataset.checklistDragBound) return;
        root.dataset.checklistDragBound = '1';

        const DRAG_THRESHOLD = 4;
        let activeDrag = null;

        const getList = () => root.querySelector('.expanded-checklist');
        const getActiveRows = () => [...(getList()?.querySelectorAll('.step-row--display:not(.step-row--done)') || [])];

        const reorderAt = (clientY) => {
            const draggedRow = activeDrag?.row;
            const activeList = getList();
            if (!draggedRow || !activeList?.contains(draggedRow)) return;

            const siblings = getActiveRows().filter((row) => row !== draggedRow);
            const nextSibling = siblings.find((sibling) => {
                const box = sibling.getBoundingClientRect();
                return clientY <= box.top + box.height / 2;
            });
            if (nextSibling) activeList.insertBefore(draggedRow, nextSibling);
            else {
                const firstDone = activeList.querySelector('.step-row--done');
                if (firstDone) activeList.insertBefore(draggedRow, firstDone);
                else activeList.appendChild(draggedRow);
            }
        };

        const finishDrag = () => {
            if (!activeDrag) return;
            const { row, moved } = activeDrag;
            row.classList.remove('is-dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (moved) {
                applyMutate((it) => {
                    const activeIds = getActiveRows().map((r) => r.dataset.stepId);
                    const doneSteps = it.steps.filter((step) => step.completed);
                    const activeSteps = activeIds
                        .map((id) => it.steps.find((step) => step.id === id))
                        .filter(Boolean);
                    it.steps = [...activeSteps, ...doneSteps];
                });
                refresh();
            }
            activeDrag = null;
        };

        const onMove = (e) => {
            if (!activeDrag) return;
            if (!activeDrag.moved) {
                const dx = Math.abs(e.clientX - activeDrag.startX);
                const dy = Math.abs(e.clientY - activeDrag.startY);
                if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
                activeDrag.moved = true;
                activeDrag.row.classList.add('is-dragging');
            }
            e.preventDefault();
            reorderAt(e.clientY);
        };

        const onUp = () => finishDrag();

        root.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            const handle = e.target.closest('.grab-handle--step');
            if (!handle || !root.contains(handle)) return;
            const row = handle.closest('.step-row--display:not(.step-row--done)');
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();
            activeDrag = {
                row,
                startX: e.clientX,
                startY: e.clientY,
                moved: false
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
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
        localStorage.removeItem('matrix_expanded_cards');
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
