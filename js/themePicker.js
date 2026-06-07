import { ColorPicker } from './colorPicker.js';

export function createThemePicker({
    storageKey,
    defaultColor,
    presets,
    cssVar,
    buttonId,
    ariaLabel,
    iconHtml = '',
    onApply
}) {
    return {
        triggerBtn: null,

        init() {
            this.applyStored();
            this.triggerBtn = document.getElementById(buttonId);
            if (!this.triggerBtn) return;
            if (iconHtml) this.triggerBtn.innerHTML = iconHtml;
            this.triggerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                ColorPicker.open({
                    anchor: this.triggerBtn,
                    presets,
                    value: this.readStored(),
                    align: 'end',
                    onSelect: (color) => this.apply(color)
                });
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

        applyStored() {
            this.apply(this.readStored(), { silent: true });
        },

        apply(color, { silent = false } = {}) {
            const value = color || defaultColor;
            document.documentElement.style.setProperty(cssVar, value);
            onApply?.(value);
            if (!silent) localStorage.setItem(storageKey, value);
        }
    };
}
