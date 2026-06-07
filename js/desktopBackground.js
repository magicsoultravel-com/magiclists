import { ACTION_ICONS } from './ui.js';

const STORAGE_KEY = 'matrix_desktop_bg';
const DEFAULT_BG = '#121214';

const DESKTOP_BG_PRESETS = [
    { value: '#121214', label: 'Charcoal' },
    { value: '#0f172a', label: 'Slate' },
    { value: '#1e1b4b', label: 'Indigo' },
    { value: '#134e4a', label: 'Teal' },
    { value: '#365314', label: 'Olive' },
    { value: '#1e3a5f', label: 'Navy' },
    { value: '#292524', label: 'Stone' }
];

export const DesktopBackground = {
    popover: null,
    triggerBtn: null,
    isOpen: false,

    init() {
        this.applyStored();
        this.triggerBtn = document.getElementById('btn-desktop-bg');
        if (!this.triggerBtn) return;
        this.triggerBtn.innerHTML = ACTION_ICONS.desktopBg;
        this.triggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePopover();
        });
        document.addEventListener('click', (e) => {
            if (!this.isOpen) return;
            if (this.popover?.contains(e.target) || this.triggerBtn?.contains(e.target)) return;
            this.closePopover();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closePopover();
        });
    },

    readStored() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored && /^#[0-9a-fA-F]{6}$/.test(stored)) return stored;
        } catch {
            /* ignore */
        }
        return DEFAULT_BG;
    },

    applyStored() {
        this.apply(this.readStored(), { silent: true });
    },

    apply(color, { silent = false } = {}) {
        const value = color || DEFAULT_BG;
        document.documentElement.style.setProperty('--desktop-bg', value);
        document.body.style.backgroundColor = value;
        if (!silent) {
            localStorage.setItem(STORAGE_KEY, value);
        }
        this.updateSelection(value);
    },

    isPreset(value) {
        return DESKTOP_BG_PRESETS.some((preset) => preset.value.toLowerCase() === value.toLowerCase());
    },

    togglePopover() {
        if (this.isOpen) {
            this.closePopover();
            return;
        }
        this.openPopover();
    },

    openPopover() {
        if (!this.popover) {
            this.popover = document.createElement('div');
            this.popover.id = 'desktop-bg-popover';
            this.popover.className = 'desktop-bg-popover is-hidden';
            this.popover.setAttribute('role', 'dialog');
            this.popover.setAttribute('aria-label', 'Desktop background');
            document.body.appendChild(this.popover);
            this.renderPopover();
        }
        this.positionPopover();
        this.popover.classList.remove('is-hidden');
        this.triggerBtn?.setAttribute('aria-expanded', 'true');
        this.isOpen = true;
        this.updateSelection(this.readStored());
    },

    closePopover() {
        this.popover?.classList.add('is-hidden');
        this.triggerBtn?.setAttribute('aria-expanded', 'false');
        this.isOpen = false;
    },

    positionPopover() {
        if (!this.popover || !this.triggerBtn) return;
        const rect = this.triggerBtn.getBoundingClientRect();
        const popRect = this.popover.getBoundingClientRect();
        const margin = 6;
        let top = rect.bottom + margin;
        let left = rect.right - popRect.width;
        left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));
        if (top + popRect.height > window.innerHeight - margin) {
            top = rect.top - popRect.height - margin;
        }
        this.popover.style.top = `${top}px`;
        this.popover.style.left = `${left}px`;
    },

    renderPopover() {
        if (!this.popover) return;
        const stored = this.readStored();
        const customSelected = !this.isPreset(stored);
        const presetHtml = DESKTOP_BG_PRESETS.map((preset) => {
            const selected = stored.toLowerCase() === preset.value.toLowerCase();
            return `<button type="button" class="desktop-bg-swatch${selected ? ' is-selected' : ''}" data-color="${preset.value}" title="${preset.label}" aria-label="${preset.label}" style="--swatch:${preset.value}"></button>`;
        }).join('');

        this.popover.innerHTML = `
            <div class="desktop-bg-grid">
                ${presetHtml}
                <label class="desktop-bg-swatch desktop-bg-swatch--custom${customSelected ? ' is-selected' : ''}" title="Custom color" aria-label="Custom color">
                    <span class="desktop-bg-wheel" aria-hidden="true"></span>
                    <input type="color" id="desktop-bg-custom" value="${customSelected ? stored : '#26262b'}">
                </label>
            </div>
        `;

        this.popover.querySelectorAll('.desktop-bg-swatch[data-color]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.apply(btn.dataset.color || DEFAULT_BG);
            });
        });

        const customInput = this.popover.querySelector('#desktop-bg-custom');
        customInput?.addEventListener('input', (e) => {
            e.stopPropagation();
            this.apply(customInput.value);
        });
        customInput?.addEventListener('click', (e) => e.stopPropagation());
    },

    updateSelection(color) {
        if (!this.popover || this.popover.classList.contains('is-hidden')) return;
        const value = (color || this.readStored()).toLowerCase();
        const isCustom = !this.isPreset(value);
        this.popover.querySelectorAll('.desktop-bg-swatch').forEach((el) => {
            const preset = el.dataset.color?.toLowerCase();
            el.classList.toggle('is-selected', preset ? preset === value : isCustom);
        });
        const customInput = this.popover.querySelector('#desktop-bg-custom');
        if (customInput && isCustom) customInput.value = value;
    }
};
