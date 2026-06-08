const STORAGE_KEY = 'matrix_display_options';

const DEFAULTS = {
    showCategoryName: true,
    showCreatedDate: true,
    desktopGradient: false
};

export function readDisplayOptions() {
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        return {
            showCategoryName: raw.showCategoryName !== false,
            showCreatedDate: raw.showCreatedDate !== false,
            desktopGradient: raw.desktopGradient === true
        };
    } catch {
        return { ...DEFAULTS };
    }
}

export function writeDisplayOptions(options) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
    } catch { /* ignore */ }
}

export function applyDisplayOptions(options = readDisplayOptions()) {
    const root = document.documentElement;
    root.dataset.showNoteCategory = options.showCategoryName ? '1' : '0';
    root.dataset.showNoteCreated = options.showCreatedDate ? '1' : '0';
    root.dataset.desktopGradient = options.desktopGradient ? '1' : '0';
}

function isCustomized(options) {
    return !options.showCategoryName || !options.showCreatedDate || options.desktopGradient;
}

export const DisplayOptions = {
    triggerBtn: null,
    popover: null,
    outsideHandler: null,
    keyHandler: null,
    options: { ...DEFAULTS },
    onChange: null,

    init({ onChange } = {}) {
        this.onChange = onChange;
        this.options = readDisplayOptions();
        applyDisplayOptions(this.options);

        this.triggerBtn = document.getElementById('btn-display-options');
        if (!this.triggerBtn) return;

        this.triggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePopover();
        });

        this.syncButtonState();
    },

    setOptions(partial) {
        this.options = { ...this.options, ...partial };
        writeDisplayOptions(this.options);
        applyDisplayOptions(this.options);
        this.syncButtonState();
        this.onChange?.(this.options);
    },

    syncButtonState() {
        const btn = this.triggerBtn;
        if (!btn) return;
        const custom = isCustomized(this.options);
        btn.classList.toggle('is-active', custom);
        btn.title = custom ? 'Display options (customized)' : 'Display options';
        btn.setAttribute('aria-label', btn.title);
    },

    ensurePopover() {
        if (!this.popover) {
            this.popover = document.createElement('div');
            this.popover.className = 'display-options-popover clock-style-popover is-hidden';
            this.popover.setAttribute('role', 'menu');
            this.popover.setAttribute('aria-label', 'Display options');
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

    optionRow(id, label, hint, checked) {
        return `<label class="focus-mode-row display-options-row" for="${id}">
            <input type="checkbox" class="display-options-checkbox" id="${id}"${checked ? ' checked' : ''}>
            <span class="focus-mode-row-label">${escapeHtml(label)}</span>
            ${hint ? `<span class="focus-mode-row-hint">${escapeHtml(hint)}</span>` : ''}
        </label>`;
    },

    openPopover() {
        if (!this.triggerBtn) return;
        this.closePopover();

        const popover = this.ensurePopover();
        const opts = this.options;

        popover.innerHTML = `
            <div class="display-options-list focus-mode-list">
                <p class="display-options-heading">Notes on desktop</p>
                ${this.optionRow('display-opt-category', 'Category name', 'Footer & compact', opts.showCategoryName)}
                ${this.optionRow('display-opt-created', 'Created date', 'Expanded notes', opts.showCreatedDate)}
                <div class="focus-mode-divider" role="separator"></div>
                <p class="display-options-heading">Desktop</p>
                ${this.optionRow('display-opt-gradient', 'Gradient background', 'Subtle depth', opts.desktopGradient)}
            </div>
        `;

        const bindToggle = (id, key) => {
            popover.querySelector(`#${id}`)?.addEventListener('change', (e) => {
                e.stopPropagation();
                this.setOptions({ [key]: e.target.checked });
                this.openPopover();
            });
        };

        bindToggle('display-opt-category', 'showCategoryName');
        bindToggle('display-opt-created', 'showCreatedDate');
        bindToggle('display-opt-gradient', 'desktopGradient');

        popover.querySelectorAll('.display-options-row').forEach((row) => {
            row.addEventListener('mousedown', (e) => e.stopPropagation());
        });

        popover.classList.remove('is-hidden');
        this.positionPopover(this.triggerBtn);
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

    togglePopover() {
        if (this.popover && !this.popover.classList.contains('is-hidden')) {
            this.closePopover();
        } else {
            this.openPopover();
        }
    },

    positionPopover(anchor) {
        if (!this.popover || !anchor) return;
        const rect = anchor.getBoundingClientRect();
        const gap = 8;
        const margin = 8;
        const popRect = this.popover.getBoundingClientRect();

        let top = rect.bottom + gap;
        let left = rect.right - popRect.width;

        left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));
        if (top + popRect.height > window.innerHeight - margin) {
            top = rect.top - popRect.height - gap;
        }
        top = Math.max(margin, top);

        this.popover.style.top = `${top}px`;
        this.popover.style.left = `${left}px`;
    }
};

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
