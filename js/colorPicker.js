import { escapeAttr } from './domEscape.js';

const GRID_SLOTS = 16;
const USER_SLOTS = 4;
const USER_PALETTE_KEY = 'matrix_user_palette';
/** Shared default for desktop, chrome, and note reset. */
export const THEME_DEFAULT_COLOR = '#121214';

let cachedPalette = null;

/** Modern, sensible presets — one palette everywhere (notes, chrome, desktop, drawing). */
export const PALETTE_UNIFIED = [
    { value: '#000000', label: 'Black' },
    { value: THEME_DEFAULT_COLOR, label: 'Default' },
    { value: '#2d3748', label: 'Slate' },
    { value: '#718096', label: 'Cool Gray' },
    { value: '#e53e3e', label: 'Muted Red' },
    { value: '#dd6b20', label: 'Warm Orange' },
    { value: '#d69e2e', label: 'Soft Amber' },
    { value: '#38a169', label: 'Sage Green' },
    { value: '#319795', label: 'Teal' },
    { value: '#3182ce', label: 'Soft Blue' },
    { value: '#805ad5', label: 'Muted Purple' },
    { value: '#b7791f', label: 'Sand' },
    { value: '#f7fafc', label: 'Off-White' },
    { value: '#edf2f7', label: 'Light Gray' },
    { value: '#feebc8', label: 'Soft Peach' },
    { value: '#ffffff', label: 'White' }
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

function normalizeHex(value) {
    if (!value) return '';
    const v = String(value).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
    if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v}`;
    return '';
}

function readUserPalette() {
    if (cachedPalette) return cachedPalette;
    try {
        const raw = localStorage.getItem(USER_PALETTE_KEY);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const slots = parsed.slice(0, USER_SLOTS).map((c) => normalizeHex(c) || '');
            while (slots.length < USER_SLOTS) slots.push('');
            cachedPalette = slots;
            return slots;
        }
    } catch {
        /* ignore */
    }
    cachedPalette = Array(USER_SLOTS).fill('');
    return cachedPalette;
}

function saveUserPalette(slots) {
    try {
        localStorage.setItem(USER_PALETTE_KEY, JSON.stringify(slots.slice(0, USER_SLOTS)));
        cachedPalette = slots.slice(0, USER_SLOTS);
    } catch {
        /* ignore */
    }
}

function hexToHsv(hex) {
    const n = normalizeHex(hex);
    if (!n) return { h: 240, s: 80, v: 90 };
    const r = parseInt(n.slice(1, 3), 16) / 255;
    const g = parseInt(n.slice(3, 5), 16) / 255;
    const b = parseInt(n.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : (d / max) * 100;
    const v = max * 100;
    if (d !== 0) {
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
            case g: h = ((b - r) / d + 2) * 60; break;
            default: h = ((r - g) / d + 4) * 60; break;
        }
    }
    return { h, s, v };
}

function cssColorToHex(css) {
    if (!css) return '';
    const value = String(css).trim().toLowerCase();
    if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') return '';
    if (/^#[0-9a-f]{6}$/i.test(value)) return value;
    const rgb = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
    if (rgb) {
        const toByte = (n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0');
        return `#${toByte(rgb[1])}${toByte(rgb[2])}${toByte(rgb[3])}`;
    }
    return '';
}

function sampleColorAt(clientX, clientY) {
    const skip = (el) => el?.closest?.('.color-picker-popover, .color-picker-eyedropper, .color-picker-eyedropper-hint');
    const elements = document.elementsFromPoint(clientX, clientY).filter((el) => !skip(el));
    const props = ['backgroundColor', 'color', 'borderTopColor', 'outlineColor'];
    for (const el of elements) {
        const style = getComputedStyle(el);
        for (const prop of props) {
            const hex = cssColorToHex(style[prop]);
            if (hex) return hex;
        }
    }
    return '';
}

function hsvToHex(h, s, v) {
    const hh = ((h % 360) + 360) % 360;
    const ss = Math.max(0, Math.min(100, s)) / 100;
    const vv = Math.max(0, Math.min(100, v)) / 100;
    const c = vv * ss;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = vv - c;
    let r = 0; let g = 0; let b = 0;
    if (hh < 60) { r = c; g = x; }
    else if (hh < 120) { r = x; g = c; }
    else if (hh < 180) { g = c; b = x; }
    else if (hh < 240) { g = x; b = c; }
    else if (hh < 300) { r = x; b = c; }
    else { r = c; b = x; }
    const toByte = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
    return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

export const ColorPicker = {
    popover: null,
    anchor: null,
    onSelect: null,
    presets: [],
    userPalette: [],
    outsideHandler: null,
    keyHandler: null,
    subPicker: null,
    subDragCleanup: null,
    eyedropperCleanup: null,
    eyedropperClickHandler: null,
    align: 'end',
    selectedColor: '',
    mode: 'popover',
    closeOnSelect: true,
    onClose: null,

    ensurePopover() {
        if (!this._bodyPopover) {
            this._bodyPopover = document.createElement('div');
            this._bodyPopover.className = 'color-picker-popover is-hidden';
            this._bodyPopover.setAttribute('role', 'dialog');
            this._bodyPopover.setAttribute('aria-label', 'Choose color');
            document.body.appendChild(this._bodyPopover);
        }
        this.popover = this._bodyPopover;
        return this.popover;
    },

    cancelEyedropper() {
        if (!this.eyedropperCleanup) return;
        this.eyedropperCleanup();
        this.eyedropperCleanup = null;
        this.popover?.classList.remove('is-hidden');
        this.positionPopover(this.anchor, this.align);
    },

    async startEyedropper({ onPick } = {}) {
        if (typeof onPick !== 'function') return;
        this.cancelEyedropper();

        if (typeof window.EyeDropper === 'function') {
            try {
                this.popover?.classList.add('is-hidden');
                const result = await new window.EyeDropper().open();
                const hex = normalizeHex(result?.sRGBHex);
                this.popover?.classList.remove('is-hidden');
                this.positionPopover(this.anchor, this.align);
                if (hex) onPick(hex);
                return;
            } catch {
                this.popover?.classList.remove('is-hidden');
                this.positionPopover(this.anchor, this.align);
                return;
            }
        }

        this.popover?.classList.add('is-hidden');

        const overlay = document.createElement('div');
        overlay.className = 'color-picker-eyedropper';
        const hint = document.createElement('div');
        hint.className = 'color-picker-eyedropper-hint';
        hint.textContent = 'Click to pick a color · Esc to cancel';
        const swatch = document.createElement('span');
        swatch.className = 'color-picker-eyedropper-swatch';
        swatch.setAttribute('aria-hidden', 'true');
        hint.prepend(swatch);
        document.body.appendChild(overlay);
        document.body.appendChild(hint);

        const updateHint = (clientX, clientY) => {
            const hex = sampleColorAt(clientX, clientY);
            hint.style.left = `${clientX + 14}px`;
            hint.style.top = `${clientY + 14}px`;
            swatch.style.background = hex || 'transparent';
            hint.dataset.hex = hex || '';
        };

        const finish = (hex) => {
            if (this.eyedropperCleanup) {
                this.eyedropperCleanup();
                this.eyedropperCleanup = null;
            }
            if (hex) onPick(hex);
            this.popover?.classList.remove('is-hidden');
            this.positionPopover(this.anchor, this.align);
        };

        const onMove = (e) => updateHint(e.clientX, e.clientY);
        const onClick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            finish(sampleColorAt(e.clientX, e.clientY) || hint.dataset.hex);
        };
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            finish('');
        };

        overlay.addEventListener('pointermove', onMove);
        overlay.addEventListener('pointerdown', onClick);
        document.addEventListener('keydown', onKey, true);

        this.eyedropperCleanup = () => {
            overlay.removeEventListener('pointermove', onMove);
            overlay.removeEventListener('pointerdown', onClick);
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            hint.remove();
        };
    },

    closeSubPicker({ persist = false } = {}) {
        this.cancelEyedropper();
        if (this.subDragCleanup) {
            this.subDragCleanup();
            this.subDragCleanup = null;
        }
        if (this.subPicker?.cleanup) {
            this.subPicker.cleanup();
        }
        if (persist && this.subPicker?.slotIndex != null && this.subPicker.lastHex) {
            this.persistUserSlot(this.subPicker.slotIndex, this.subPicker.lastHex);
        }
        if (this.subPicker?.slotIndex != null) {
            const activeBtn = this.popover?.querySelector(`[data-user-slot="${this.subPicker.slotIndex}"]`);
            activeBtn?.classList.remove('is-active-slot');
        }
        if (this.subPicker?.el) {
            this.subPicker.el.classList.add('is-hidden');
        }
        this.subPicker = null;
        this.positionPopover(this.anchor, this.align);
    },

    persistUserSlot(slotIndex, hex) {
        const normalized = normalizeHex(hex);
        if (!normalized || slotIndex == null) return;
        const slots = readUserPalette();
        slots[slotIndex] = normalized;
        saveUserPalette(slots);
        this.userPalette = slots;
        this.updateUserTile(slotIndex, normalized);
    },

    updateUserTile(slotIndex, color) {
        if (!this.popover) return;
        const btn = this.popover.querySelector(`[data-user-slot="${slotIndex}"]`);
        if (!btn) return;
        const filled = !!color;
        btn.classList.toggle('color-picker-tile--user-empty', !filled);
        if (filled) {
            this.userPalette[slotIndex] = color;
            btn.dataset.color = color;
            btn.style.setProperty('--tile', color);
            btn.title = `Edit custom color ${slotIndex + 1}`;
            btn.setAttribute('aria-label', `Edit custom color ${slotIndex + 1}`);
            btn.innerHTML = '';
        } else {
            this.userPalette[slotIndex] = '';
            delete btn.dataset.color;
            btn.style.removeProperty('--tile');
            btn.title = 'Add custom color';
            btn.setAttribute('aria-label', 'Add custom color');
            btn.innerHTML = '<span class="color-picker-wheel" aria-hidden="true"></span>';
        }
    },

    close() {
        this.cancelEyedropper();
        this.closeSubPicker({ persist: true });
        if (this.mode === 'inline') {
            this.popover?.classList.remove('is-open', 'is-opening');
            this.popover?.setAttribute('aria-hidden', 'true');
            this.anchor?.setAttribute('aria-expanded', 'false');
            this.anchor = null;
            this.onSelect = null;
            const done = this.onClose;
            this.onClose = null;
            this.popover = this._bodyPopover || null;
            this.mode = 'popover';
            this.closeOnSelect = true;
            if (this.outsideHandler) {
                document.removeEventListener('mousedown', this.outsideHandler, true);
                this.outsideHandler = null;
            }
            if (this.keyHandler) {
                document.removeEventListener('keydown', this.keyHandler);
                this.keyHandler = null;
            }
            if (this.eyedropperClickHandler) {
                this._bodyPopover?.removeEventListener('click', this.eyedropperClickHandler);
                this.eyedropperClickHandler = null;
            }
            done?.();
            return;
        }
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
        if (this.eyedropperClickHandler) {
            this.popover.removeEventListener('click', this.eyedropperClickHandler);
            this.eyedropperClickHandler = null;
        }
    },

    open({ anchor, presets = PALETTE_NOTE, value = '', onSelect, align = 'end', mode = 'popover', container = null, onClose = null }) {
        if (typeof onSelect !== 'function') return;
        if (mode === 'inline') {
            if (!container) return;
            this.close();
            this.mode = 'inline';
            this.closeOnSelect = false;
            this.onClose = onClose;
            this.anchor = anchor || null;
            this.onSelect = onSelect;
            this.presets = presets.slice(0, GRID_SLOTS);
            while (this.presets.length < GRID_SLOTS) {
                this.presets.push({ value: '#26262b', label: 'Color' });
            }
            this.userPalette = readUserPalette();
            this.selectedColor = normalizeHex(value)?.toLowerCase() || '';
            this.popover = container;
            this._buildPickerContent(onSelect, { inline: true });
            container.classList.add('is-open', 'is-opening');
            container.setAttribute('aria-hidden', 'false');
            anchor?.setAttribute('aria-expanded', 'true');
            requestAnimationFrame(() => container.classList.remove('is-opening'));
            this._attachDismissHandlers(anchor, container);
            return;
        }
        if (!anchor) return;
        this.close();

        this.anchor = anchor;
        this.onSelect = onSelect;
        this.align = align;
        this.mode = 'popover';
        this.closeOnSelect = false;
        this.presets = presets.slice(0, GRID_SLOTS);
        while (this.presets.length < GRID_SLOTS) {
            this.presets.push({ value: '#26262b', label: 'Color' });
        }
        this.userPalette = readUserPalette();
        this.selectedColor = normalizeHex(value)?.toLowerCase() || '';

        const popover = this.ensurePopover();
        this._buildPickerContent(onSelect, { inline: false });
        popover.classList.remove('is-hidden');
        this.positionPopover(anchor, align);
        anchor.setAttribute('aria-expanded', 'true');
        this._attachDismissHandlers(anchor, popover);
    },

    _buildPickerContent(onSelect, { inline = false } = {}) {
        const popover = this.popover;
        if (!popover) return;
        const current = this.selectedColor;
        const gridClass = inline ? 'color-picker-grid color-picker-grid--inline' : 'color-picker-grid color-picker-grid--presets';

        const presetHtml = this.presets.map((preset) => {
            const selected = current === (preset.value || '').toLowerCase();
            const isNone = preset.value === '';
            const style = isNone ? '' : ` style="--tile:${preset.value}"`;
            return `<button type="button" class="color-picker-tile${isNone ? ' color-picker-tile--none' : ''}${selected ? ' is-selected' : ''}" data-color="${escapeAttr(preset.value)}" title="${escapeAttr(preset.label)}" aria-label="${escapeAttr(preset.label)}"${style}></button>`;
        }).join('');

        const userHtml = this.userPalette.map((color, index) => {
            const filled = !!color;
            const selected = filled && current === color.toLowerCase();
            if (filled) {
                return `<button type="button" class="color-picker-tile color-picker-tile--user${selected ? ' is-selected' : ''}" data-user-slot="${index}" data-color="${escapeAttr(color)}" title="Edit custom color ${index + 1}" aria-label="Edit custom color ${index + 1}" style="--tile:${color}"></button>`;
            }
            return `<button type="button" class="color-picker-tile color-picker-tile--user color-picker-tile--user-empty" data-user-slot="${index}" title="Add custom color" aria-label="Add custom color">
                <span class="color-picker-wheel" aria-hidden="true"></span>
            </button>`;
        }).join('');

        const mainInner = inline
            ? `<div class="${gridClass}">${presetHtml}</div>
               <div class="color-picker-divider color-picker-divider--inline" aria-hidden="true"></div>
               <div class="color-picker-label">Custom</div>
               <div class="color-picker-grid color-picker-grid--user color-picker-grid--inline-user">${userHtml}</div>`
            : `<div class="color-picker-grid color-picker-grid--presets">${presetHtml}</div>
               <div class="color-picker-divider" aria-hidden="true"></div>
               <div class="color-picker-label">Custom</div>
               <div class="color-picker-grid color-picker-grid--user">${userHtml}</div>
               <button type="button" class="color-picker-eyedropper-btn card-act" aria-label="Pick color from page" title="Pick color from page">
                   <svg viewBox="0 0 16 16" width="12" height="12" focusable="false" aria-hidden="true"><path d="M10.2 1.8a1.6 1.6 0 0 1 2.3 2.3l-1 1-2.3-2.3 1-1ZM3.4 8.6l4-4 2.3 2.3-4 4-2.5.2.2-2.5Z" fill="currentColor"/><path d="M2.5 11.8 4.2 10l2 2-1.7 1.7a.8.8 0 0 1-1.1 0l-.9-.9a.8.8 0 0 1 0-1.1Z" fill="currentColor"/></svg>
               </button>`;

        popover.innerHTML = `<div class="color-picker-body${inline ? ' color-picker-body--inline' : ''}">
            <div class="color-picker-main">${mainInner}</div>
            <div class="color-picker-editor is-hidden" role="group" aria-label="Fine-tune custom color">
                <button type="button" class="color-picker-back card-act" aria-label="Close color editor">
                    <svg viewBox="0 0 12 12" width="11" height="11" focusable="false" aria-hidden="true"><path d="M7 3L4 6l3 3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
                <div class="color-picker-editor-content">
                    <div class="color-picker-sv" tabindex="0" aria-label="Saturation and brightness">
                        <span class="color-picker-sv-cursor" aria-hidden="true"></span>
                    </div>
                    <input type="range" class="color-picker-hue" min="0" max="360" value="240" aria-label="Hue">
                    <div class="color-picker-hex-row">
                        <button type="button" class="color-picker-eyedropper-btn color-picker-eyedropper-btn--inline card-act" aria-label="Pick color from page" title="Pick color from page">
                            <svg viewBox="0 0 16 16" width="12" height="12" focusable="false" aria-hidden="true"><path d="M10.2 1.8a1.6 1.6 0 0 1 2.3 2.3l-1 1-2.3-2.3 1-1ZM3.4 8.6l4-4 2.3 2.3-4 4-2.5.2.2-2.5Z" fill="currentColor"/><path d="M2.5 11.8 4.2 10l2 2-1.7 1.7a.8.8 0 0 1-1.1 0l-.9-.9a.8.8 0 0 1 0-1.1Z" fill="currentColor"/></svg>
                        </button>
                        <div class="color-picker-preview" aria-hidden="true"></div>
                        <input type="text" class="color-picker-hex" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex color" inputmode="text">
                    </div>
                </div>
            </div>
        </div>`;

        const body = popover.querySelector('.color-picker-body');
        const editor = popover.querySelector('.color-picker-editor');

        // Store handler references for cleanup
        const onPresetClick = (e) => {
            const btn = e.target.closest('.color-picker-tile[data-color]');
            if (!btn) return;
            e.stopPropagation();
            this.closeSubPicker({ persist: true });
            this.selectColor(btn.dataset.color || '', onSelect);
        };
        const onPresetMousedown = (e) => {
            if (e.target.closest('.color-picker-tile[data-color]')) e.stopPropagation();
        };
        const onUserMousedown = (e) => e.stopPropagation();

        const presetGrid = popover.querySelector(inline ? '.color-picker-grid--inline' : '.color-picker-grid--presets');
        presetGrid?.addEventListener('mousedown', onPresetMousedown);
        presetGrid?.addEventListener('click', onPresetClick);

        popover.querySelectorAll('.color-picker-tile--user').forEach((btn) => {
            btn.addEventListener('mousedown', onUserMousedown);
            this.attachUserSlotHandlers(btn, body, editor, onSelect);
        });

        const handleEyedropperPick = (hex) => {
            if (!hex) return;
            if (this.subPicker?.setColorFromHex) {
                this.subPicker.setColorFromHex(hex);
                this.persistUserSlot(this.subPicker.slotIndex, hex);
                return;
            }
            this.selectColor(hex, onSelect);
        };

        // Single delegated handler for all eyedropper buttons
        this.eyedropperClickHandler = (e) => {
            const btn = e.target.closest('.color-picker-eyedropper-btn');
            if (!btn) return;
            e.stopPropagation();
            this.startEyedropper({ onPick: handleEyedropperPick });
        };
        popover.addEventListener('click', this.eyedropperClickHandler);
    },

    _attachDismissHandlers(anchor, popover) {
        this.outsideHandler = (e) => {
            const colorGroup = anchor?.closest?.('.drawing-color-group');
            if (popover.contains(e.target)) return;
            if (anchor?.contains(e.target)) return;
            if (colorGroup?.contains(e.target)) return;
            this.close();
        };
        this.keyHandler = (e) => {
            if (e.key !== 'Escape') return;
            if (this.eyedropperCleanup) {
                this.cancelEyedropper();
                e.stopPropagation();
                return;
            }
            if (this.subPicker) {
                this.closeSubPicker({ persist: true });
                e.stopPropagation();
                return;
            }
            this.close();
        };
        requestAnimationFrame(() => {
            document.addEventListener('mousedown', this.outsideHandler, true);
            document.addEventListener('keydown', this.keyHandler);
        });
    },

    attachUserSlotHandlers(btn, body, editor, onSelect) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const slotIndex = Number(btn.dataset.userSlot);
            if (this.subPicker?.slotIndex === slotIndex) return;
            this.closeSubPicker({ persist: true });
            const slotColor = btn.dataset.color;
            if (slotColor) {
                this.previewColor(slotColor, onSelect);
            }
            const initial = slotColor || this.selectedColor || '#4f46e5';
            this.openSubPicker(body, editor, btn, slotIndex, initial);
        });
    },

    previewColor(color, onSelect) {
        const normalized = normalizeHex(color);
        if (!normalized) return;
        onSelect?.(normalized);
    },

    selectColor(color, onSelect) {
        const normalized = normalizeHex(color);
        if (!normalized) return;
        this.selectedColor = normalized.toLowerCase();
        onSelect?.(normalized);
        this.syncSelection();
    },

    syncSelection() {
        if (!this.popover) return;
        const normalized = this.selectedColor;
        this.popover.querySelectorAll('.color-picker-tile.is-selected').forEach((el) => {
            el.classList.remove('is-selected');
        });
        if (!normalized) return;
        const presetMatch = this.popover.querySelector(`.color-picker-tile[data-color="${normalized}"]:not([data-user-slot])`);
        if (presetMatch) {
            presetMatch.classList.add('is-selected');
            return;
        }
        this.userPalette.forEach((color, index) => {
            if (color && color.toLowerCase() === normalized) {
                const btn = this.popover.querySelector(`[data-user-slot="${index}"][data-color]`);
                btn?.classList.add('is-selected');
            }
        });
    },

    openSubPicker(body, editor, anchorTile, slotIndex, initialColor = '#4f46e5') {
        if (this.subPicker?.slotIndex === slotIndex) return;
        this.closeSubPicker({ persist: true });

        this.popover?.querySelectorAll('.color-picker-tile--user.is-active-slot').forEach((el) => {
            el.classList.remove('is-active-slot');
        });
        anchorTile.classList.add('is-active-slot');

        const sv = editor.querySelector('.color-picker-sv');
        const hueInput = editor.querySelector('.color-picker-hue');
        const hexInput = editor.querySelector('.color-picker-hex');
        const preview = editor.querySelector('.color-picker-preview');
        const cursor = editor.querySelector('.color-picker-sv-cursor');

        const startHsv = hexToHsv(initialColor);
        let { h, s, v } = startHsv;
        let syncingHex = false;

        const applyColor = (hex) => {
            const normalized = normalizeHex(hex);
            if (!normalized) return;
            this.subPicker.lastHex = normalized;
            preview.style.background = normalized;
            this.updateUserTile(slotIndex, normalized);
            this.previewColor(normalized, this.onSelect);
        };

        const syncUi = () => {
            const hex = hsvToHex(h, s, v);
            sv.style.setProperty('--sv-hue', `${h}deg`);
            hueInput.value = String(Math.round(h));
            const rect = sv.getBoundingClientRect();
            const x = (s / 100) * rect.width;
            const y = (1 - v / 100) * rect.height;
            cursor.style.left = `${x}px`;
            cursor.style.top = `${y}px`;
            syncingHex = true;
            hexInput.value = hex;
            syncingHex = false;
            applyColor(hex);
        };

        const setColorFromHex = (hex) => {
            const normalized = normalizeHex(hex);
            if (!normalized) return;
            ({ h, s, v } = hexToHsv(normalized));
            syncUi();
        };

        const commitHex = () => {
            if (syncingHex) return;
            const hex = normalizeHex(hexInput.value);
            if (!hex) {
                hexInput.value = this.subPicker?.lastHex || hsvToHex(h, s, v);
                return;
            }
            setColorFromHex(hex);
        };

        const setFromSvEvent = (clientX, clientY) => {
            const rect = sv.getBoundingClientRect();
            const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
            const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
            s = (x / rect.width) * 100;
            v = (1 - y / rect.height) * 100;
            syncUi();
        };

        const onHueInput = () => {
            h = Number(hueInput.value);
            syncUi();
        };

        const onSvPointerDown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            setFromSvEvent(e.clientX, e.clientY);
            const onMove = (ev) => setFromSvEvent(ev.clientX, ev.clientY);
            const onUp = () => {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                this.persistUserSlot(slotIndex, this.subPicker?.lastHex);
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            this.subDragCleanup = () => {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
            };
        };

        const onEditorClick = (e) => e.stopPropagation();

        const backBtn = editor.querySelector('.color-picker-back');
        const onBack = (e) => {
            e.stopPropagation();
            this.closeSubPicker({ persist: true });
        };

        const onHexChange = () => commitHex();
        const onHexKeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitHex();
            }
        };

        hueInput.addEventListener('input', onHueInput);
        hexInput.addEventListener('change', onHexChange);
        hexInput.addEventListener('keydown', onHexKeydown);
        sv.addEventListener('pointerdown', onSvPointerDown);
        editor.addEventListener('mousedown', onEditorClick);
        backBtn?.addEventListener('click', onBack);

        this.subPicker = {
            el: editor,
            slotIndex,
            lastHex: normalizeHex(initialColor) || '#4f46e5',
            setColorFromHex,
            cleanup: () => {
                hueInput.removeEventListener('input', onHueInput);
                hexInput.removeEventListener('change', onHexChange);
                hexInput.removeEventListener('keydown', onHexKeydown);
                sv.removeEventListener('pointerdown', onSvPointerDown);
                editor.removeEventListener('mousedown', onEditorClick);
                backBtn?.removeEventListener('click', onBack);
            }
        };

        editor.classList.remove('is-hidden');
        syncUi();
        this.positionPopover(this.anchor, this.align);
    },

    positionPopover(anchor, align = 'end') {
        if (!this.popover || !anchor) return;
        if (!anchor.isConnected) return;
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
