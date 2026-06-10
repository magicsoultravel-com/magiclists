import { positionPopoverBelowAnchor } from './popoverPosition.js';

const CHEVRON = '<svg viewBox="0 0 12 12" width="10" height="10" focusable="false" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let menuEl = null;
let anchorEl = null;
let outsideHandler = null;
let keyHandler = null;

function ensureMenu() {
    if (!menuEl) {
        menuEl = document.createElement('div');
        menuEl.className = 'drawing-toolbar-menu is-hidden';
        menuEl.setAttribute('role', 'menu');
        document.body.appendChild(menuEl);
    }
    return menuEl;
}

function detachListeners() {
    if (outsideHandler) {
        document.removeEventListener('mousedown', outsideHandler, true);
        outsideHandler = null;
    }
    if (keyHandler) {
        document.removeEventListener('keydown', keyHandler);
        keyHandler = null;
    }
}

export const DrawingToolbarMenu = {
    close() {
        detachListeners();
        if (menuEl) menuEl.classList.add('is-hidden');
        anchorEl?.setAttribute('aria-expanded', 'false');
        anchorEl = null;
    },

    isOpen() {
        return menuEl && !menuEl.classList.contains('is-hidden');
    },

    toggle({ anchor, ariaLabel, items, selected, onSelect }) {
        if (this.isOpen() && anchorEl === anchor) {
            this.close();
            return;
        }
        this.open({ anchor, ariaLabel, items, selected, onSelect });
    },

    open({ anchor, ariaLabel, items, selected, onSelect }) {
        if (!anchor || !items?.length) return;
        this.close();

        anchorEl = anchor;
        const menu = ensureMenu();
        menu.setAttribute('aria-label', ariaLabel || 'Menu');

        const html = items.map((item) => {
            if (item.divider) return '<div class="drawing-menu-divider" role="separator" aria-hidden="true"></div>';
            const isSelected = item.selected === true || item.id === selected;
            return `<button type="button" class="drawing-menu-option${isSelected ? ' is-selected' : ''}" data-id="${item.id}" role="menuitem"${item.disabled ? ' disabled' : ''}>
                <span class="drawing-menu-icon">${item.icon || ''}</span>
                <span class="drawing-menu-label">${item.label}</span>
                ${isSelected ? '<span class="drawing-menu-check" aria-hidden="true">✓</span>' : ''}
            </button>`;
        }).join('');

        menu.innerHTML = `<div class="drawing-menu-list">${html}</div>`;

        menu.querySelectorAll('.drawing-menu-option:not([disabled])').forEach((btn) => {
            btn.addEventListener('mousedown', (e) => e.stopPropagation());
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                this.close();
                onSelect?.(id);
            });
        });

        menu.classList.remove('is-hidden');
        anchor.setAttribute('aria-expanded', 'true');
        positionPopoverBelowAnchor(menu, anchor);

        outsideHandler = (e) => {
            if (menu.contains(e.target) || anchor.contains(e.target)) return;
            this.close();
        };
        keyHandler = (e) => {
            if (e.key === 'Escape') this.close();
        };
        requestAnimationFrame(() => {
            document.addEventListener('mousedown', outsideHandler, true);
            document.addEventListener('keydown', keyHandler);
        });
    }
};

export { CHEVRON };
