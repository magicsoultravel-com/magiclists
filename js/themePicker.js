import { ColorPicker } from './colorPicker.js';

export function createThemePicker({
    storageKey,
    tokenKey,
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
        tokenKey,
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
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (typeof parsed === 'object' && parsed !== null && tokenKey in parsed) {
                        const value = parsed[tokenKey];
                        if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
                            return value;
                        }
                    }
                }
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
                /* Update consolidated theme tokens object */
                try {
                    const stored = localStorage.getItem(storageKey);
                    let tokens = {};
                    if (stored) {
                        try {
                            const parsed = JSON.parse(stored);
                            if (typeof parsed === 'object' && parsed !== null) {
                                tokens = parsed;
                            }
                        } catch {
                            tokens = {};
                        }
                    }
                    tokens[tokenKey] = value;
                    localStorage.setItem(storageKey, JSON.stringify(tokens));
                } catch {
                    /* ignore */
                }
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