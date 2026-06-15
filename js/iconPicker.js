import { escapeAttr } from './domEscape.js';
import { NOTE_ICONS, pickerTileSvg } from './noteIcons.js';

export function buildIconBoardHtml() {
    const tilesHtml = NOTE_ICONS.map((icon) => (
        `<button type="button" class="icon-board-tile" data-note-icon-id="${escapeAttr(icon.id)}" title="${escapeAttr(icon.label)}" aria-label="${escapeAttr(icon.label)}">${pickerTileSvg(icon)}</button>`
    )).join('');
    return `<div class="icon-board is-hidden" data-icon-board role="region" aria-label="Insert icon" aria-hidden="true">
        <div class="icon-board__grid">${tilesHtml}</div>
    </div>`;
}

export const IconBoard = {
    closeStack(stack) {
        const board = stack?.querySelector('[data-icon-board]');
        const toggleBtn = stack?.querySelector('.card-act--icon');
        if (!board || board.classList.contains('is-hidden')) return;
        board.classList.add('is-hidden');
        board.setAttribute('aria-hidden', 'true');
        toggleBtn?.classList.remove('is-active');
        toggleBtn?.setAttribute('aria-expanded', 'false');
        stack.classList.remove('is-icon-board-open');
    },

    openStack(stack) {
        const board = stack?.querySelector('[data-icon-board]');
        const toggleBtn = stack?.querySelector('.card-act--icon');
        if (!board) return;
        board.classList.remove('is-hidden');
        board.setAttribute('aria-hidden', 'false');
        toggleBtn?.classList.add('is-active');
        toggleBtn?.setAttribute('aria-expanded', 'true');
        stack.classList.add('is-icon-board-open');
    },

    toggleStack(stack, { onOpen = () => {} } = {}) {
        const board = stack?.querySelector('[data-icon-board]');
        if (!board) return false;
        if (board.classList.contains('is-hidden')) {
            onOpen();
            this.openStack(stack);
            return true;
        }
        this.closeStack(stack);
        return false;
    },

    attach(stack, {
        getContext = () => null,
        insertIcon = () => {}
    } = {}) {
        if (!stack || stack.dataset.iconBoardBound) return;
        stack.dataset.iconBoardBound = '1';

        const board = stack.querySelector('[data-icon-board]');
        const grid = board?.querySelector('.icon-board__grid');
        if (!board || !grid) return;

        let savedContext = null;

        const refreshContext = () => {
            savedContext = getContext();
        };

        grid.addEventListener('mousedown', (e) => {
            if (e.target.closest('.icon-board-tile')) e.stopPropagation();
        });

        grid.addEventListener('click', (e) => {
            const btn = e.target.closest('.icon-board-tile[data-note-icon-id]');
            if (!btn) return;
            e.stopPropagation();
            const iconId = btn.dataset.noteIconId;
            if (!iconId || !savedContext?.target) return;
            insertIcon(savedContext, iconId);
            refreshContext();
        });

        const outsideHandler = (e) => {
            if (!stack.classList.contains('is-icon-board-open')) return;
            if (stack.contains(e.target)) return;
            this.closeStack(stack);
        };

        const keyHandler = (e) => {
            if (e.key !== 'Escape') return;
            if (!stack.classList.contains('is-icon-board-open')) return;
            this.closeStack(stack);
            e.stopPropagation();
        };

        document.addEventListener('mousedown', outsideHandler, true);
        document.addEventListener('keydown', keyHandler);

        stack._iconBoardRefreshContext = refreshContext;
        stack._iconBoardToggle = (onOpen) => {
            this.toggleStack(stack, {
                onOpen: () => {
                    refreshContext();
                    onOpen?.();
                }
            });
        };
        stack._iconBoardClose = () => this.closeStack(stack);
        stack._iconBoardCleanup = () => {
            document.removeEventListener('mousedown', outsideHandler, true);
            document.removeEventListener('keydown', keyHandler);
        };
    }
};
