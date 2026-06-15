import { positionPopoverBelowAnchor } from './popoverPosition.js';

const CHEVRON = '<svg viewBox="0 0 12 12" width="10" height="10" focusable="false" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let menuEl = null;
let anchorEl = null;
let outsideHandler = null;
let keyHandler = null;
let menuState = null;

function ensureMenu() {
    if (!menuEl) {
        menuEl = document.createElement('div');
        menuEl.className = 'drawing-toolbar-menu clock-style-popover is-hidden';
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

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderItemsHtml(items, selected) {
    return items.map((item) => {
        if (item.heading) {
            return `<p class="drawing-menu-heading display-options-heading">${escapeHtml(item.heading)}</p>`;
        }
        if (item.divider) return '<div class="drawing-menu-divider" role="separator" aria-hidden="true"></div>';
        if (item.stepper) {
            return `<div class="display-options-stepper-row drawing-menu-stepper-row">
                <span class="display-options-stepper-label">${escapeHtml(item.label)}</span>
                <span class="display-options-stepper" aria-label="${escapeHtml(item.label)}">
                    <button type="button" class="btn btn--compact btn--icon display-options-stepper-btn drawing-menu-stepper-out" data-stepper-id="${item.id}" title="Decrease" aria-label="Decrease ${escapeHtml(item.label)}">−</button>
                    <span class="display-options-stepper-value drawing-menu-stepper-value">${escapeHtml(item.value)}</span>
                    <button type="button" class="btn btn--compact btn--icon display-options-stepper-btn drawing-menu-stepper-in" data-stepper-id="${item.id}" title="Increase" aria-label="Increase ${escapeHtml(item.label)}">+</button>
                </span>
            </div>`;
        }
        const isSelected = item.selected === true || item.id === selected;
        return `<button type="button" class="drawing-menu-option${isSelected ? ' is-selected' : ''}" data-id="${item.id}" role="menuitem"${item.disabled ? ' disabled' : ''}>
            <span class="drawing-menu-icon">${item.icon || ''}</span>
            <span class="drawing-menu-label">${escapeHtml(item.label)}</span>
            ${isSelected ? '<span class="drawing-menu-check" aria-hidden="true">✓</span>' : ''}
        </button>`;
    }).join('');
}

function bindMenuInteractions(menu, { onSelect, onStepper, closeOnSelect = true }) {
    menu.querySelectorAll('.drawing-menu-option:not([disabled])').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            if (closeOnSelect) DrawingToolbarMenu.close();
            onSelect?.(id);
        });
    });

    menu.querySelectorAll('.drawing-menu-stepper-out').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            onStepper?.(btn.dataset.stepperId, -1);
        });
    });

    menu.querySelectorAll('.drawing-menu-stepper-in').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            onStepper?.(btn.dataset.stepperId, 1);
        });
    });
}

export const DrawingToolbarMenu = {
    close() {
        detachListeners();
        if (menuEl) menuEl.classList.add('is-hidden');
        anchorEl?.setAttribute('aria-expanded', 'false');
        anchorEl = null;
        menuState = null;
    },

    isOpen() {
        return menuEl && !menuEl.classList.contains('is-hidden');
    },

    setItems(items, selected) {
        if (!menuState) return;
        menuState.items = items;
        if (selected !== undefined) menuState.selected = selected;
        this.refresh();
    },

    refresh() {
        if (!menuState || !anchorEl || !menuEl) return;
        const { items, selected, onSelect, onStepper, ariaLabel, closeOnSelect = true } = menuState;
        menuEl.setAttribute('aria-label', ariaLabel || 'Menu');
        menuEl.innerHTML = `<div class="drawing-menu-list">${renderItemsHtml(items, selected)}</div>`;
        bindMenuInteractions(menuEl, { onSelect, onStepper, closeOnSelect });
        positionPopoverBelowAnchor(menuEl, anchorEl);
    },

    toggle(state) {
        if (this.isOpen() && anchorEl === state.anchor) {
            this.close();
            return;
        }
        this.open(state);
    },

    open({ anchor, ariaLabel, items, selected, onSelect, onStepper, closeOnSelect = true }) {
        if (!anchor || !items?.length) return;

        const wasSameAnchor = anchorEl === anchor && this.isOpen();
        if (!wasSameAnchor) this.close();

        anchorEl = anchor;
        menuState = { anchor, ariaLabel, items, selected, onSelect, onStepper, closeOnSelect };
        const menu = ensureMenu();
        menu.setAttribute('aria-label', ariaLabel || 'Menu');
        menu.innerHTML = `<div class="drawing-menu-list">${renderItemsHtml(items, selected)}</div>`;
        bindMenuInteractions(menu, { onSelect, onStepper, closeOnSelect });

        menu.classList.remove('is-hidden');
        anchor.setAttribute('aria-expanded', 'true');
        positionPopoverBelowAnchor(menu, anchor);

        if (!wasSameAnchor) {
            detachListeners();
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
    }
};

export { CHEVRON };
