import { categoryKey, readStoredCategories, UNCATEGORIZED_CATEGORY } from './categories.js';
import { isFocusActive } from './focusFilter.js';
import { positionPopoverBelowAnchor } from './popoverPosition.js';

const MAX_FOCUS = 3;

export const FocusMode = {
    triggerBtn: null,
    popover: null,
    outsideHandler: null,
    keyHandler: null,
    getState: null,
    setState: null,
    onChange: null,
    getHiddenCategories: null,

    init({ getState, setState, onChange, getHiddenCategories }) {
        this.getState = getState;
        this.setState = setState;
        this.onChange = onChange;
        this.getHiddenCategories = getHiddenCategories;

        this.triggerBtn = document.getElementById('btn-focus-mode');
        if (!this.triggerBtn) return;

        this.triggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePopover(this.getHiddenCategories?.() || []);
        });

        this.syncButtonState();
    },

    rebindTrigger() {
        this.triggerBtn = document.getElementById('btn-focus-mode');
        if (!this.triggerBtn) return;
        this.triggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePopover(this.getHiddenCategories?.() || []);
        });
        this.syncButtonState();
    },

    syncButtonState() {
        const btn = this.triggerBtn;
        if (!btn) return;
        const focus = this.getState?.() || [];
        const active = isFocusActive(focus);
        btn.classList.toggle('is-active', active);
        document.getElementById('workspace-shell')?.toggleAttribute('data-focus-active', active);

        if (!active) {
            btn.title = 'Focus mode';
            btn.setAttribute('aria-label', 'Focus mode');
            return;
        }
        const label = `Focus: ${focus.join(', ')}`;
        btn.title = label;
        btn.setAttribute('aria-label', label);
    },

    ensurePopover() {
        if (!this.popover) {
            this.popover = document.createElement('div');
            this.popover.className = 'focus-mode-popover clock-style-popover is-hidden';
            this.popover.setAttribute('role', 'menu');
            this.popover.setAttribute('aria-label', 'Focus mode');
            document.body.appendChild(this.popover);
        }
        return this.popover;
    },

    closePopover() {
        if (!this.popover) return;
        this.popover.classList.add('is-hidden');
        this.triggerBtn?.setAttribute('aria-expanded', 'false');
        if (this.outsideHandler) {
            document.removeEventListener('mousedown', this.outsideHandler, true);
            this.outsideHandler = null;
        }
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    },

    getSelectableCategories(hiddenCategories = []) {
        const hidden = new Set((hiddenCategories || []).map(categoryKey));
        const names = readStoredCategories()
            .map((c) => c.name)
            .filter((name) => name && !hidden.has(categoryKey(name)));
        return [UNCATEGORIZED_CATEGORY, ...names];
    },

    openPopover(hiddenCategories = []) {
        if (!this.triggerBtn) return;
        this.closePopover();

        const popover = this.ensurePopover();
        const selected = new Set((this.getState?.() || []).map(categoryKey));
        const options = this.getSelectableCategories(hiddenCategories);

        const resetRow = `<button type="button" class="focus-mode-reset focus-mode-row" role="menuitem">
            <span class="focus-mode-row-label">Reset</span>
            <span class="focus-mode-row-hint">Show all on desktop</span>
        </button>`;

        const checklist = options.map((name) => {
            const checked = selected.has(categoryKey(name));
            const atMax = selected.size >= MAX_FOCUS && !checked;
            return `<label class="focus-mode-row focus-mode-check${atMax ? ' is-disabled' : ''}">
                <input type="checkbox" class="focus-mode-checkbox" value="${escapeAttr(name)}"${checked ? ' checked' : ''}${atMax ? ' disabled' : ''}>
                <span class="focus-mode-row-label">${escapeHtml(name)}</span>
            </label>`;
        }).join('');

        popover.innerHTML = `
            <div class="focus-mode-list">
                ${resetRow}
                <div class="focus-mode-divider" role="separator"></div>
                ${checklist}
                <p class="focus-mode-footer">Select up to ${MAX_FOCUS} categories</p>
            </div>
        `;

        popover.querySelector('.focus-mode-reset')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.setState?.([]);
            this.onChange?.();
            this.syncButtonState();
            this.closePopover();
        });

        popover.querySelectorAll('.focus-mode-checkbox').forEach((input) => {
            input.addEventListener('change', () => {
                const checks = [...popover.querySelectorAll('.focus-mode-checkbox:checked')];
                if (checks.length > MAX_FOCUS) {
                    input.checked = false;
                    return;
                }
                const next = checks.map((el) => el.value);
                this.setState?.(next);
                this.onChange?.();
                this.syncButtonState();
                this.openPopover(hiddenCategories);
            });
        });

        popover.classList.remove('is-hidden');
        positionPopoverBelowAnchor(popover, this.triggerBtn);
        this.triggerBtn.setAttribute('aria-expanded', 'true');

        this.outsideHandler = (e) => {
            if (popover.contains(e.target) || this.triggerBtn.contains(e.target)) return;
            this.closePopover();
        };
        this.keyHandler = (e) => {
            if (e.key === 'Escape') this.closePopover();
        };
        requestAnimationFrame(() => {
            document.addEventListener('mousedown', this.outsideHandler, true);
            document.addEventListener('keydown', this.keyHandler);
        });
    },

    togglePopover(hiddenCategories = []) {
        if (this.popover && !this.popover.classList.contains('is-hidden')) {
            this.closePopover();
        } else {
            this.openPopover(hiddenCategories);
        }
    }
};

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
