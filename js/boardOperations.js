/** @module {"owns":"item visibility, archiving, calendar integration, card actions", "related":["noteSurface.js","noteQuickActions.js"]} */
import { NoteSurface } from './noteSurface.js';
import { CARD_ICONS } from './icons.js';

/**
 * Board operations module handling item visibility, archiving, calendar integration, and card actions.
 * Note: Some methods require UI context and may need to be moved to the UI module or refactored.
 */
export const BoardOperations = {
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
            NoteSurface.emitItemMutation(
                { ...item, hiddenFromBoard: true },
                { beforeItem: NoteSurface.snapshotItem(item) }
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
            NoteSurface.emitItemMutation(
                { ...item, hiddenFromBoard: false },
                { beforeItem: NoteSurface.snapshotItem(item) }
            );
            return;
        }
        window.dispatchEvent(new CustomEvent('board:visibility_changed'));
    },

    getVisibleItems(items) {
        return items.filter((item) => !this.isHiddenFromBoard(item) && !this.isArchived(item));
    },

    flushAllInlineEditsFromCanvas(canvas, items) {
        if (!canvas || !Array.isArray(items)) return;
        const byId = new Map(items.map((item) => [item.id, item]));
        canvas.querySelectorAll('.mini-card[data-desktop="1"]').forEach((card) => {
            const item = byId.get(card.dataset.id);
            if (!item) return;
            NoteSurface.commitFocusedInlineField(card, item);
            if (card.dataset.pendingFocusStepId) return;
            const shell = card.querySelector('.editor-note-shell');
            if (!shell) return;
            const beforeItem = NoteSurface.snapshotItem(item);
            NoteSurface.syncItemBodyFromDom(shell, item);
            if (JSON.stringify(beforeItem) !== JSON.stringify(NoteSurface.snapshotItem(item))) {
                NoteSurface.emitItemMutation(item, { preserveView: true, beforeItem, skipRerender: true });
            }
        });
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
        const beforeItem = NoteSurface.snapshotItem(item);
        const willHide = !this.isHiddenFromCalendar(item);
        const updated = { ...item, hideFromCalendar: willHide };
        item.hideFromCalendar = willHide;

        const ids = this.getLocalCalendarHiddenIds().filter(id => id !== item.id);
        if (willHide && !localStorage.getItem('admin_token')) ids.push(item.id);
        localStorage.setItem('matrix_calendar_hidden_ids', JSON.stringify(ids));

        if (localStorage.getItem('admin_token')) {
            NoteSurface.emitItemMutation(updated, { beforeItem });
        }

        window.dispatchEvent(new CustomEvent('calendar:items_changed', { detail: updated }));

        if (btn) {
            btn.title = willHide ? 'Hidden from calendar — click to show' : 'Shown on calendar — click to hide';
            btn.classList.toggle('is-off', willHide);
            btn.classList.toggle('is-on', !willHide);
        }
    },

    syncCalendarButtonUI(item, btn) {
        if (!btn || !item) return;
        const hidden = this.isHiddenFromCalendar(item);
        btn.innerHTML = CARD_ICONS.calendar;
        const title = hidden
            ? 'Hidden from calendar — click to show'
            : 'Shown on calendar — click to hide';
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.classList.toggle('is-off', hidden);
        btn.classList.toggle('is-on', !hidden);
    },

    // Note: These methods require UI context and will need to be implemented differently
    // For now, we'll leave them as stubs that should be implemented by the UI module
    // or we'll need to pass UI dependencies differently
    getCardActionsOptions(card) {
        // This method needs UI context to work properly
        // It should be moved to UI module or refactored to accept dependencies
        const hasSession = !!localStorage.getItem('admin_token');
        const spatial = card?.dataset?.desktop === '1'; // isDesktopCard(card)
        const opts = {
            pinned: false, // Placeholder - should call isBoardPinned
            showDrag: hasSession && spatial
        };
        if (spatial && card) {
            opts.spatialTile = true;
            // These would need UI context to work properly
            opts.tileSize = 'medium'; // Placeholder
            opts.tileW = 0;
            opts.tileH = 0;
        }
        return opts;
    },

    buildCardActionsHtml(item, isExpanded = false, options = {}) {
        return NoteSurface.buildNoteQuickActionsHtml(item, {
            surface: 'board',
            isExpanded,
            calHidden: this.isHiddenFromCalendar(item),
            ...options
        });
    }
};
</task_progress>
- [x] Fixed syntax errors in unhideFromBoard method
- [x] Corrected the malformed object literal in NoteSurface.emitItemMutation call
</task_progress>
</write_to_file>