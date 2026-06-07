const GRID_SLOTS = 15;

/** Shared default for desktop, chrome, and note reset. */
export const THEME_DEFAULT_COLOR = '#121214';

export const PALETTE_UNIFIED = [
    { value: THEME_DEFAULT_COLOR, label: 'Default' },
    { value: '#1e293b', label: 'Slate' },
    { value: '#312e81', label: 'Indigo' },
    { value: '#134e4a', label: 'Teal' },
    { value: '#365314', label: 'Olive' },
    { value: '#78350f', label: 'Amber' },
    { value: '#7f1d1d', label: 'Rose' },
    { value: '#4c1d95', label: 'Violet' },
    { value: '#1e3a5f', label: 'Navy' },
    { value: '#0f172a', label: 'Midnight' },
    { value: '#422006', label: 'Brown' },
    { value: '#0c4a6e', label: 'Sky' },
    { value: '#4a044e', label: 'Plum' },
    { value: '#14532d', label: 'Green' },
    { value: '#27272a', label: 'Zinc' }
];

export const PALETTE_NOTE = PALETTE_UNIFIED;
export const PALETTE_DESKTOP = PALETTE_UNIFIED;
export const PALETTE_CHROME = PALETTE_UNIFIED;

export function resolveNoteColor(value) {
    if (value && /^#[0-9a-fA-F]{6}$/.test(value)) return value;
    return THEME_DEFAULT_COLOR;
}

/** Random accent from the unified palette (excludes the default tile). */
export function randomNoteColor() {
    const accents = PALETTE_UNIFIED.slice(1).map((preset) => preset.value);
    return accents[Math.floor(Math.random() * accents.length)];
}

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function normalizeHex(value) {
    if (!value) return '';
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '';
}

function isPresetColor(value, presets) {
    const normalized = (value || '').toLowerCase();
    return presets.some((preset) => preset.value.toLowerCase() === normalized);
}

export const ColorPicker = {
    popover: null,
    anchor: null,
    onSelect: null,
    presets: [],
    outsideHandler: null,
    keyHandler: null,

    ensurePopover() {
        if (!this.popover) {
            this.popover = document.createElement('div');
            this.popover.className = 'color-picker-popover is-hidden';
            this.popover.setAttribute('role', 'dialog');
            this.popover.setAttribute('aria-label', 'Choose color');
            document.body.appendChild(this.popover);
        }
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

    open({ anchor, presets = PALETTE_NOTE, value = '', onSelect, align = 'end', allowCustom = true }) {
        if (!anchor || typeof onSelect !== 'function') return;
        this.close();

        this.anchor = anchor;
        this.onSelect = onSelect;
        this.presets = presets.slice(0, GRID_SLOTS);
        while (this.presets.length < GRID_SLOTS) {
            this.presets.push({ value: '#26262b', label: 'Color' });
        }

        const popover = this.ensurePopover();
        const current = value || '';
        const customSelected = allowCustom && current && !isPresetColor(current, this.presets);
        const customValue = customSelected ? current : '#4f46e5';

        const tilesHtml = this.presets.map((preset) => {
            const selected = current.toLowerCase() === (preset.value || '').toLowerCase();
            const isNone = preset.value === '';
            const style = isNone ? '' : ` style="--tile:${preset.value}"`;
            return `<button type="button" class="color-picker-tile${isNone ? ' color-picker-tile--none' : ''}${selected ? ' is-selected' : ''}" data-color="${escapeAttr(preset.value)}" title="${escapeAttr(preset.label)}" aria-label="${escapeAttr(preset.label)}"${style}></button>`;
        }).join('');

        const customHtml = allowCustom
            ? `<label class="color-picker-tile color-picker-tile--custom${customSelected ? ' is-selected' : ''}" title="Custom color" aria-label="Custom color">
                    <span class="color-picker-wheel" aria-hidden="true"></span>
                    <input type="color" class="color-picker-native" value="${escapeAttr(customValue)}">
               </label>`
            : '<span class="color-picker-tile color-picker-tile--spacer" aria-hidden="true"></span>';

        popover.innerHTML = `<div class="color-picker-grid">${tilesHtml}${customHtml}</div>`;

        popover.querySelectorAll('.color-picker-tile[data-color]').forEach((btn) => {
            btn.addEventListener('mousedown', (e) => e.stopPropagation());
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                onSelect(btn.dataset.color || '');
                this.close();
            });
        });

        const nativeInput = popover.querySelector('.color-picker-native');
        nativeInput?.addEventListener('mousedown', (e) => e.stopPropagation());
        nativeInput?.addEventListener('input', (e) => {
            e.stopPropagation();
            const hex = normalizeHex(nativeInput.value);
            if (!hex) return;
            onSelect(hex);
            popover.querySelectorAll('.color-picker-tile.is-selected').forEach((el) => el.classList.remove('is-selected'));
            nativeInput.closest('.color-picker-tile')?.classList.add('is-selected');
        });

        popover.classList.remove('is-hidden');
        this.positionPopover(anchor, align);
        anchor.setAttribute('aria-expanded', 'true');

        this.outsideHandler = (e) => {
            if (popover.contains(e.target) || anchor.contains(e.target)) return;
            this.close();
        };
        this.keyHandler = (e) => {
            if (e.key === 'Escape') this.close();
        };
        requestAnimationFrame(() => {
            document.addEventListener('mousedown', this.outsideHandler, true);
            document.addEventListener('keydown', this.keyHandler);
        });
    },

    positionPopover(anchor, align = 'end') {
        if (!this.popover || !anchor) return;
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
    },

    updateTriggerPreview(trigger, value) {
        if (!trigger) return;
        const dot = trigger.querySelector('.color-picker-trigger-dot') || trigger;
        if (value) {
            dot.style.setProperty('--tile', value);
            trigger.classList.remove('color-picker-trigger--empty');
        } else {
            dot.style.removeProperty('--tile');
            trigger.classList.add('color-picker-trigger--empty');
        }
    }
};
