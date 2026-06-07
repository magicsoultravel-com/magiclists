const GRID_SLOTS = 16;
const USER_SLOTS = 4;
const USER_PALETTE_KEY = 'matrix_user_palette';
/** Shared default for desktop, chrome, and note reset. */
export const THEME_DEFAULT_COLOR = '#121214';

export const PALETTE_UNIFIED = [
    { value: '#000000', label: 'Black' },
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

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function normalizeHex(value) {
    if (!value) return '';
    const v = String(value).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
    if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v}`;
    return '';
}

function readUserPalette() {
    try {
        const raw = localStorage.getItem(USER_PALETTE_KEY);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const slots = parsed.slice(0, USER_SLOTS).map((c) => normalizeHex(c) || '');
            while (slots.length < USER_SLOTS) slots.push('');
            return slots;
        }
    } catch {
        /* ignore */
    }
    return Array(USER_SLOTS).fill('');
}

function saveUserPalette(slots) {
    try {
        localStorage.setItem(USER_PALETTE_KEY, JSON.stringify(slots.slice(0, USER_SLOTS)));
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
    align: 'end',
    selectedColor: '',

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

    closeSubPicker({ persist = false } = {}) {
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
        this.popover?.querySelector('.color-picker-body')?.classList.remove('color-picker-body--editing');
        this.subPicker = null;
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
        this.closeSubPicker({ persist: true });
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

    open({ anchor, presets = PALETTE_NOTE, value = '', onSelect, align = 'end' }) {
        if (!anchor || typeof onSelect !== 'function') return;
        this.close();

        this.anchor = anchor;
        this.onSelect = onSelect;
        this.align = align;
        this.presets = presets.slice(0, GRID_SLOTS);
        while (this.presets.length < GRID_SLOTS) {
            this.presets.push({ value: '#26262b', label: 'Color' });
        }
        this.userPalette = readUserPalette();
        this.selectedColor = normalizeHex(value)?.toLowerCase() || '';

        const popover = this.ensurePopover();
        const current = this.selectedColor;

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

        popover.innerHTML = `<div class="color-picker-body">
            <div class="color-picker-main">
                <div class="color-picker-grid color-picker-grid--presets">${presetHtml}</div>
                <div class="color-picker-divider" aria-hidden="true"></div>
                <div class="color-picker-grid color-picker-grid--user">${userHtml}</div>
            </div>
            <div class="color-picker-subpanel is-hidden" role="dialog" aria-label="Pick a custom color">
                <button type="button" class="color-picker-back" aria-label="Back to color grid">
                    <span class="color-picker-back-icon" aria-hidden="true">←</span>
                </button>
                <div class="color-picker-subpanel-content">
                    <div class="color-picker-sv" tabindex="0" aria-label="Saturation and brightness">
                        <span class="color-picker-sv-cursor" aria-hidden="true"></span>
                    </div>
                    <input type="range" class="color-picker-hue" min="0" max="360" value="240" aria-label="Hue">
                    <div class="color-picker-hex-row">
                        <div class="color-picker-preview" aria-hidden="true"></div>
                        <input type="text" class="color-picker-hex" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex color" inputmode="text">
                    </div>
                </div>
            </div>
        </div>`;

        const body = popover.querySelector('.color-picker-body');
        const subpanel = popover.querySelector('.color-picker-subpanel');

        const presetGrid = popover.querySelector('.color-picker-grid--presets');
        presetGrid?.addEventListener('mousedown', (e) => {
            if (e.target.closest('.color-picker-tile[data-color]')) e.stopPropagation();
        });
        presetGrid?.addEventListener('click', (e) => {
            const btn = e.target.closest('.color-picker-tile[data-color]');
            if (!btn) return;
            e.stopPropagation();
            this.closeSubPicker({ persist: true });
            this.selectColor(btn.dataset.color || '', onSelect);
            this.close();
        });

        popover.querySelectorAll('.color-picker-tile--user').forEach((btn) => {
            btn.addEventListener('mousedown', (e) => e.stopPropagation());
            this.attachUserSlotHandlers(btn, body, subpanel, onSelect);
        });

        popover.classList.remove('is-hidden');
        this.positionPopover(anchor, align);
        anchor.setAttribute('aria-expanded', 'true');

        this.outsideHandler = (e) => {
            if (popover.contains(e.target) || anchor.contains(e.target)) return;
            this.close();
        };
        this.keyHandler = (e) => {
            if (e.key !== 'Escape') return;
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

    attachUserSlotHandlers(btn, body, subpanel, onSelect) {
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
            this.openSubPicker(body, subpanel, btn, slotIndex, initial);
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
        const presetMatch = [...this.popover.querySelectorAll('.color-picker-tile[data-color]:not([data-user-slot])')].find(
            (el) => (el.dataset.color || '').toLowerCase() === normalized
        );
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

    openSubPicker(body, subpanel, anchorTile, slotIndex, initialColor = '#4f46e5') {
        if (this.subPicker?.slotIndex === slotIndex) return;
        this.closeSubPicker({ persist: true });

        this.popover?.querySelectorAll('.color-picker-tile--user.is-active-slot').forEach((el) => {
            el.classList.remove('is-active-slot');
        });
        anchorTile.classList.add('is-active-slot');

        const sv = subpanel.querySelector('.color-picker-sv');
        const hueInput = subpanel.querySelector('.color-picker-hue');
        const hexInput = subpanel.querySelector('.color-picker-hex');
        const preview = subpanel.querySelector('.color-picker-preview');
        const cursor = subpanel.querySelector('.color-picker-sv-cursor');

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

        const commitHex = () => {
            if (syncingHex) return;
            const hex = normalizeHex(hexInput.value);
            if (!hex) {
                hexInput.value = this.subPicker?.lastHex || hsvToHex(h, s, v);
                return;
            }
            ({ h, s, v } = hexToHsv(hex));
            syncUi();
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

        const onSubpanelClick = (e) => e.stopPropagation();

        const backBtn = subpanel.querySelector('.color-picker-back');
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
        subpanel.addEventListener('mousedown', onSubpanelClick);
        backBtn?.addEventListener('click', onBack);

        this.subPicker = {
            el: subpanel,
            slotIndex,
            lastHex: normalizeHex(initialColor) || '#4f46e5',
            cleanup: () => {
                hueInput.removeEventListener('input', onHueInput);
                hexInput.removeEventListener('change', onHexChange);
                hexInput.removeEventListener('keydown', onHexKeydown);
                sv.removeEventListener('pointerdown', onSvPointerDown);
                subpanel.removeEventListener('mousedown', onSubpanelClick);
                backBtn?.removeEventListener('click', onBack);
            }
        };

        body.classList.add('color-picker-body--editing');
        subpanel.classList.remove('is-hidden');
        syncUi();
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
