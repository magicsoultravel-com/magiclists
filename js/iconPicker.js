import { escapeAttr } from './domEscape.js';
import { EMOJI_TABS, getEmojiTab } from './noteEmojis.js';

export const EmojiPicker = {
    popover: null,
    anchor: null,
    onSelect: null,
    outsideHandler: null,
    keyHandler: null,
    align: 'end',
    activeTabId: 'smileys',

    ensurePopover() {
        if (!this._bodyPopover) {
            this._bodyPopover = document.createElement('div');
            this._bodyPopover.className = 'emoji-picker-popover is-hidden';
            this._bodyPopover.setAttribute('role', 'dialog');
            this._bodyPopover.setAttribute('aria-label', 'Insert emoji');
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

    renderGrid(tabId) {
        const tab = getEmojiTab(tabId);
        const grid = this.popover?.querySelector('[data-emoji-grid]');
        if (!grid || !tab) return;
        this.activeTabId = tab.id;
        grid.classList.toggle('emoji-picker-grid--flags', tab.id === 'flags');
        grid.innerHTML = tab.emojis.map((entry) => (
            `<button type="button" class="emoji-picker-tile" data-emoji="${escapeAttr(entry.char)}" title="${escapeAttr(entry.label)}" aria-label="${escapeAttr(entry.label)}">${entry.char}</button>`
        )).join('');
        this.popover?.querySelectorAll('.emoji-picker-tab').forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.emojiTab === tab.id);
            btn.setAttribute('aria-selected', btn.dataset.emojiTab === tab.id ? 'true' : 'false');
        });
    },

    bindPopoverEvents(onSelect) {
        const popover = this.popover;
        if (!popover || popover.dataset.emojiBound) return;
        popover.dataset.emojiBound = '1';

        popover.querySelector('.emoji-picker-tabs')?.addEventListener('mousedown', (e) => {
            if (e.target.closest('.emoji-picker-tab')) e.stopPropagation();
        });
        popover.querySelector('.emoji-picker-tabs')?.addEventListener('click', (e) => {
            const btn = e.target.closest('.emoji-picker-tab[data-emoji-tab]');
            if (!btn) return;
            e.stopPropagation();
            this.renderGrid(btn.dataset.emojiTab);
            this.positionPopover(this.anchor, this.align);
        });

        popover.querySelector('[data-emoji-grid]')?.addEventListener('mousedown', (e) => {
            if (e.target.closest('.emoji-picker-tile')) e.stopPropagation();
        });
        popover.addEventListener('click', (e) => {
            const btn = e.target.closest('.emoji-picker-tile[data-emoji]');
            if (!btn) return;
            e.stopPropagation();
            const emoji = btn.dataset.emoji;
            if (emoji) this.onSelect?.(emoji);
            this.close();
        });
    },

    open({ anchor, onSelect, align = 'end', tabId = 'smileys' }) {
        if (!anchor || typeof onSelect !== 'function') return;
        this.close();

        this.anchor = anchor;
        this.onSelect = onSelect;
        this.align = align;
        this.activeTabId = tabId;

        const popover = this.ensurePopover();
        if (!popover.dataset.emojiBound) {
            const tabsHtml = EMOJI_TABS.map((tab) => (
                `<button type="button" class="emoji-picker-tab${tab.id === tabId ? ' is-active' : ''}" data-emoji-tab="${escapeAttr(tab.id)}" role="tab" aria-selected="${tab.id === tabId ? 'true' : 'false'}">${escapeAttr(tab.label)}</button>`
            )).join('');
            popover.innerHTML = `<div class="emoji-picker-body">
                <div class="emoji-picker-tabs" role="tablist">${tabsHtml}</div>
                <div class="emoji-picker-grid" data-emoji-grid role="tabpanel"></div>
            </div>`;
            this.bindPopoverEvents(onSelect);
        }

        this.renderGrid(tabId);
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
