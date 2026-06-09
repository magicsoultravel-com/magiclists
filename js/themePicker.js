import { ColorPicker } from './colorPicker.js';

export function createThemePicker({
    storageKey,
    defaultColor,
    presets,
    cssVar,
    buttonId = null,
    ariaLabel = '',
    iconHtml = '',
    onApply
}) {
    return {
        triggerBtn: null,
        storageKey,
        defaultColor,
        presets,
        cssVar,
        ariaLabel,
        onApply,

        init() {
            this.applyStored();
            if (!buttonId) return;
            this.triggerBtn = document.getElementById(buttonId);
            if (!this.triggerBtn) return;
            if (iconHtml) this.triggerBtn.innerHTML = iconHtml;
            this.triggerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openPicker(this.triggerBtn);
            });
        },

        readStored() {
            try {
                const stored = localStorage.getItem(storageKey);
                if (stored && /^#[0-9a-fA-F]{6}$/.test(stored)) return stored;
            } catch {
                /* ignore */
            }
            return defaultColor;
        },

        isCustomized() {
            return this.readStored().toLowerCase() !== defaultColor.toLowerCase();
        },

        applyStored() {
            this.apply(this.readStored(), { silent: true });
        },

        apply(color, { silent = false } = {}) {
            const value = color || defaultColor;
            document.documentElement.style.setProperty(cssVar, value);
            this.onApply?.(value);
            if (!silent) {
                localStorage.setItem(storageKey, value);
                window.dispatchEvent(new CustomEvent('appearance:color_changed', { detail: { cssVar } }));
            }
        },

        openPicker(anchor) {
            if (!anchor) return;
            ColorPicker.open({
                anchor,
                presets: this.presets,
                value: this.readStored(),
                align: 'end',
                onSelect: (color) => this.apply(color)
            });
        }
    };
}
