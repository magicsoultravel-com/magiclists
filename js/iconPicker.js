import { escapeAttr } from './domEscape.js';
import { NOTE_ICONS, pickerTileSvg } from './noteIcons.js';

export const IconPicker = {
    popover: null,
    anchor: null,
    onSelect: null,
    outsideHandler: null,
    keyHandler: null,
    align: 'end',

    ensurePopover() {
        if (!this._bodyPopover) {
            this._bodyPopover = document.createElement('div');
            this._bodyPopover.className = 'icon-picker-popover is-hidden';
            this._bodyPopover.setAttribute('role', 'dialog');
            this._bodyPopover.setAttribute('aria-label', 'Insert icon');
            document.body.appendChild(this._bodyPopover);
        }
        this.popover = this._bodyPopover;
        return this.popover;
    },

    close() {
        if (!this.popover) return;
        this.popover.classList.add('is-hidden');
        this.anchor?.setAttribute('aria-expanded', 'false');
        this.anchor = null;
        this.onSelect = null;
        if (this.outsideHandler) {
            document.removeEventListener('mousedown', this.outsideHandler, true);
            this.outsideHandler = null;
        }
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    },

    open({ anchor, onSelect, align = 'end' }) {
        if (!anchor || typeof onSelect !== 'function') return;
        this.close();

        this.anchor = anchor;
        this.onSelect = onSelect;
        this.align = align;

        const popover = this.ensurePopover();
        const tilesHtml = NOTE_ICONS.map((icon) => (
            `<button type="button" class="icon-picker-tile" data-note-icon-id="${escapeAttr(icon.id)}" title="${escapeAttr(icon.label)}" aria-label="${escapeAttr(icon.label)}">${pickerTileSvg(icon)}</button>`
        )).join('');

        popover.innerHTML = `<div class="icon-picker-body"><div class="icon-picker-grid">${tilesHtml}</div></div>`;

        popover.querySelector('.icon-picker-grid')?.addEventListener('mousedown', (e) => {
            if (e.target.closest('.icon-picker-tile')) e.stopPropagation();
        });
        popover.querySelector('.icon-picker-grid')?.addEventListener('click', (e) => {
            const btn = e.target.closest('.icon-picker-tile[data-note-icon-id]');
            if (!btn) return;
            e.stopPropagation();
            const id = btn.dataset.noteIconId;
            if (id) onSelect(id);
            this.close();
        });

        popover.classList.remove('is-hidden');
        this.positionPopover(anchor, align);
        anchor.setAttribute('aria-expanded', 'true');
        this._attachDismissHandlers(anchor, popover);
    },

    _attachDismissHandlers(anchor, popover) {
        this.outsideHandler = (e) => {
            if (popover.contains(e.target)) return;
            if (anchor?.contains(e.target)) return;
            this.close();
        };
        this.keyHandler = (e) => {
            if (e.key !== 'Escape') return;
            this.close();
        };
        requestAnimationFrame(() => {
            document.addEventListener('mousedown', this.outsideHandler, true);
            document.addEventListener('keydown', this.keyHandler);
        });
    },

    positionPopover(anchor, align = 'end') {
        if (!this.popover || !anchor?.isConnected) return;
        const rect = anchor.getBoundingClientRect();
        const gap = 8;
        const margin = 8;
        const popRect = this.popover.getBoundingClientRect();

        let top = rect.bottom + gap;
        let left = align === 'start' ? rect.left : rect.right - popRect.width;
        if (align === 'center') left = rect.left + (rect.width - popRect.width) / 2;

        left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));
        if (top + popRect.height > window.innerHeight - margin) {
            top = rect.top - popRect.height - gap;
        }
        top = Math.max(margin, top);

        this.popover.style.top = `${top}px`;
        this.popover.style.left = `${left}px`;
    }
};
