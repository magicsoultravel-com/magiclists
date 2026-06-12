import {
    applyNoteFont,
    isNoteFontCustomized,
    NOTE_FONTS,
    readNoteFont,
    writeNoteFont
} from './noteFont.js';
import { NoteFontScale } from './noteFontScale.js';
import { DesktopZoom } from './desktopZoom.js';
import { ChromeBackground } from './chromeBackground.js';
import { DesktopBackground } from './desktopBackground.js';
import { resetCustomizationToDefaults } from './customizationReset.js';
import { ACTION_ICONS } from './ui.js';
import { AppTheme, buildThemeOptionsHtml, isAppThemeCustomized, readAppTheme } from './appTheme.js';
import { positionPopoverBelowAnchor } from './popoverPosition.js';
import {
    applyTileSmallFootprint,
    DEFAULT_TILE_SMALL_FOOTPRINT,
    isTileSmallFootprintCustomized,
    readTileSmallFootprint,
    writeTileSmallFootprint
} from './tileFootprint.js';

const STORAGE_KEY = 'matrix_display_options';

const DEFAULTS = {
    showCategoryName: true,
    showCreatedDate: true,
    showNoteSize: true,
    showLineCount: false,
    desktopGradient: false,
    cardAnimations: true,
    noteFontId: 'default'
};

export function readDisplayOptions() {
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        const noteFontId = NOTE_FONTS.some((f) => f.id === raw.noteFontId)
            ? raw.noteFontId
            : readNoteFont();
        return {
            showCategoryName: raw.showCategoryName !== false,
            showCreatedDate: raw.showCreatedDate !== false,
            showNoteSize: raw.showNoteSize !== false,
            showLineCount: raw.showLineCount === true,
            desktopGradient: raw.desktopGradient === true,
            cardAnimations: raw.cardAnimations !== false,
            noteFontId
        };
    } catch {
        return { ...DEFAULTS, noteFontId: readNoteFont() };
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
    root.dataset.showNoteSize = options.showNoteSize ? '1' : '0';
    root.dataset.showNoteLines = options.showLineCount ? '1' : '0';
    root.dataset.desktopGradient = options.desktopGradient ? '1' : '0';
    root.dataset.cardAnimations = options.cardAnimations ? '1' : '0';
    applyNoteFont(options.noteFontId);
    applyTileSmallFootprint(readTileSmallFootprint());
}

function isCustomized(options) {
    return !options.showCategoryName
        || !options.showCreatedDate
        || !options.showNoteSize
        || options.showLineCount
        || options.desktopGradient
        || !options.cardAnimations
        || isNoteFontCustomized(options.noteFontId)
        || isAppThemeCustomized()
        || NoteFontScale.isCustomized()
        || DesktopZoom.isCustomized()
        || ChromeBackground.isCustomized()
        || DesktopBackground.isCustomized()
        || isTileSmallFootprintCustomized();
}

export const DisplayOptions = {
    triggerBtn: null,
    activeAnchor: null,
    popover: null,
    outsideHandler: null,
    keyHandler: null,
    options: { ...DEFAULTS },
    onChange: null,
    getLoggedIn: null,

    init({ onChange, getLoggedIn } = {}) {
        this.onChange = onChange;
        this.getLoggedIn = getLoggedIn;
        this.options = readDisplayOptions();
        applyDisplayOptions(this.options);

        this.triggerBtn = document.getElementById('btn-display-options');
        if (!this.triggerBtn) return;

        this.triggerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePopover();
        });

        window.addEventListener('desktop:zoom_changed', () => this.syncButtonState());
        window.addEventListener('note:font_scale_changed', () => this.syncButtonState());
        window.addEventListener('appearance:color_changed', () => this.syncButtonState());
        window.addEventListener('app:theme_changed', () => this.syncButtonState());
        window.addEventListener('customization:reset', () => {
            this.options = readDisplayOptions();
            applyDisplayOptions(this.options);
            this.syncButtonState();
        });

        this.syncButtonState();
    },

    rebindTrigger() {
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
        if (partial.noteFontId != null) {
            writeNoteFont(partial.noteFontId);
        }
        applyDisplayOptions(this.options);
        this.syncButtonState();
        this.onChange?.(this.options);
    },

    setNoteFont(fontId) {
        this.setOptions({ noteFontId: fontId });
    },

    syncButtonState() {
        const btn = this.triggerBtn;
        if (!btn) return;
        const custom = isCustomized(this.options);
        btn.classList.toggle('is-active', custom);
        btn.title = custom ? 'Display options (customized)' : 'Display options';
        btn.setAttribute('aria-label', btn.title);
    },

    isDesktopZoomEnabled() {
        return Boolean(this.getLoggedIn?.()) && DesktopZoom.isDesktopViewport();
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
        this.activeAnchor?.setAttribute('aria-expanded', 'false');
        this.activeAnchor = null;
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

    stepperRow({ idPrefix, label, valuePercent, disabled = false, disabledHint = '' }) {
        const disabledClass = disabled ? ' is-disabled' : '';
        const disabledAttr = disabled ? ' disabled' : '';
        return `<div class="display-options-stepper-row${disabledClass}">
            <span class="display-options-stepper-label">${escapeHtml(label)}</span>
            ${disabled && disabledHint ? `<span class="focus-mode-row-hint">${escapeHtml(disabledHint)}</span>` : ''}
            <span class="display-options-stepper" aria-label="${escapeHtml(label)}">
                <button type="button" id="${idPrefix}-out" class="btn btn--compact btn--icon display-options-stepper-btn" title="Decrease" aria-label="Decrease ${escapeHtml(label)}"${disabledAttr}>−</button>
                <span id="${idPrefix}-label" class="display-options-stepper-value">${escapeHtml(valuePercent)}</span>
                <button type="button" id="${idPrefix}-in" class="btn btn--compact btn--icon display-options-stepper-btn" title="Increase" aria-label="Increase ${escapeHtml(label)}"${disabledAttr}>+</button>
            </span>
        </div>`;
    },

    bgRow(id, label, cssVar) {
        return `<button type="button" class="display-options-bg-row focus-mode-row" id="${id}" role="menuitem">
            <span class="focus-mode-row-label">${escapeHtml(label)}</span>
            <span class="display-options-swatch" style="background: var(${cssVar})" aria-hidden="true"></span>
        </button>`;
    },

    tileFootprintOptionsHtml(selectedId) {
        const options = [
            { id: 'label', label: 'Label', size: '96×28' },
            { id: 'card', label: 'Card', size: '96×56' },
            { id: 'wide', label: 'Wide card', size: '128×96' }
        ];
        return options.map((opt) => {
            const selected = opt.id === selectedId;
            return `<button type="button" class="tile-footprint-option${selected ? ' is-selected' : ''}" data-footprint="${opt.id}" role="menuitemradio" aria-checked="${selected}">
                <span class="tile-footprint-option-meta">
                    <span class="tile-footprint-option-label">${escapeHtml(opt.label)}</span>
                    <span class="tile-footprint-option-desc">${escapeHtml(opt.size)}</span>
                </span>
                ${selected ? '<span class="clock-style-check" aria-hidden="true">✓</span>' : ''}
            </button>`;
        }).join('');
    },

    setTileSmallFootprint(footprint) {
        const next = writeTileSmallFootprint(footprint);
        applyTileSmallFootprint(next);
        window.dispatchEvent(new CustomEvent('appearance:tile_footprint_changed', { detail: next }));
        this.syncButtonState();
    },

    noteFontOptionsHtml(selectedId) {
        return NOTE_FONTS.map((font) => {
            const selected = font.id === selectedId;
            const sampleFamily = font.family || "system-ui, sans-serif";
            const sampleClass = font.compact ? ' note-font-sample--compact' : '';
            return `<button type="button" class="note-font-option${selected ? ' is-selected' : ''}" data-font="${font.id}" role="menuitemradio" aria-checked="${selected}">
                <span class="note-font-option-meta">
                    <span class="note-font-option-label">${escapeHtml(font.label)}</span>
                    <span class="note-font-option-desc">${escapeHtml(font.desc)}</span>
                </span>
                <span class="note-font-sample${sampleClass}" style="font-family:${sampleFamily}">Aa</span>
                ${selected ? '<span class="clock-style-check" aria-hidden="true">✓</span>' : ''}
            </button>`;
        }).join('');
    },

    bindStepper(popover, { idPrefix, onOut, onIn, disabled = false }) {
        if (disabled) return;
        popover.querySelector(`#${idPrefix}-out`)?.addEventListener('click', (e) => {
            e.stopPropagation();
            onOut();
            this.openPopover();
        });
        popover.querySelector(`#${idPrefix}-in`)?.addEventListener('click', (e) => {
            e.stopPropagation();
            onIn();
            this.openPopover();
        });
    },

    openPopover(anchor) {
        const savedAnchor = anchor || this.activeAnchor;
        const target = savedAnchor || this.triggerBtn;
        if (!target) return;
        this.closePopover();
        this.activeAnchor = savedAnchor || null;

        const popover = this.ensurePopover();
        const opts = this.options;
        const noteScalePct = `${Math.round(NoteFontScale.getScale() * 100)}%`;
        const desktopZoomPct = `${Math.round(DesktopZoom.getScale() * 100)}%`;
        const desktopZoomEnabled = this.isDesktopZoomEnabled();
        const tileFootprint = readTileSmallFootprint();

        popover.innerHTML = `
            <div class="display-options-list focus-mode-list">
                <button type="button" class="focus-mode-row focus-mode-reset display-options-reset display-options-reset--top" id="display-opt-reset" role="menuitem">
                    <span class="focus-mode-row-label display-options-reset-label">${ACTION_ICONS.resetCustomization}<span>Reset to defaults</span></span>
                </button>
                <div class="focus-mode-divider" role="separator"></div>
                <p class="display-options-heading">Notes on desktop</p>
                ${this.optionRow('display-opt-category', 'Category name', '', opts.showCategoryName)}
                ${this.optionRow('display-opt-created', 'Created date', '', opts.showCreatedDate)}
                ${this.optionRow('display-opt-note-size', 'Note size', '', opts.showNoteSize)}
                ${this.optionRow('display-opt-note-lines', 'Number of lines', '', opts.showLineCount)}
                <p class="display-options-subheading">Collapsed note size</p>
                <div class="tile-footprint-list">${this.tileFootprintOptionsHtml(tileFootprint)}</div>
                <div class="focus-mode-divider" role="separator"></div>
                <p class="display-options-heading">Theme</p>
                <div class="display-options-theme-list clock-style-list app-theme-list">${buildThemeOptionsHtml(readAppTheme())}</div>
                <div class="focus-mode-divider" role="separator"></div>
                <p class="display-options-heading">Text</p>
                <div class="note-font-list">${this.noteFontOptionsHtml(opts.noteFontId)}</div>
                <div class="focus-mode-divider" role="separator"></div>
                <p class="display-options-heading">Scale</p>
                <div class="display-options-scale-group">
                    ${this.stepperRow({
                        idPrefix: 'display-opt-note-scale',
                        label: 'Text size',
                        valuePercent: noteScalePct
                    })}
                    ${this.stepperRow({
                        idPrefix: 'display-opt-desktop-zoom',
                        label: 'Desktop zoom',
                        valuePercent: desktopZoomPct,
                        disabled: !desktopZoomEnabled,
                        disabledHint: desktopZoomEnabled ? '' : 'Desktop only'
                    })}
                </div>
                <div class="focus-mode-divider" role="separator"></div>
                <p class="display-options-heading">Desktop</p>
                ${this.optionRow('display-opt-gradient', 'Gradient background', '', opts.desktopGradient)}
                ${this.optionRow('display-opt-animations', 'Card animations', '', opts.cardAnimations)}
                <div class="focus-mode-divider" role="separator"></div>
                <p class="display-options-heading">Backgrounds</p>
                ${this.bgRow('display-opt-chrome-bg', 'Panel & header', '--chrome-bg')}
                ${this.bgRow('display-opt-desktop-bg', 'Desktop', '--desktop-bg')}
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
        bindToggle('display-opt-note-size', 'showNoteSize');
        bindToggle('display-opt-note-lines', 'showLineCount');
        bindToggle('display-opt-gradient', 'desktopGradient');
        bindToggle('display-opt-animations', 'cardAnimations');

        popover.querySelectorAll('.app-theme-option').forEach((btn) => {
            btn.addEventListener('mousedown', (e) => e.stopPropagation());
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                AppTheme.setTheme(btn.dataset.theme);
                this.openPopover();
            });
        });

        popover.querySelectorAll('.tile-footprint-option').forEach((btn) => {
            btn.addEventListener('mousedown', (e) => e.stopPropagation());
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setTileSmallFootprint(btn.dataset.footprint);
                this.openPopover();
            });
        });

        popover.querySelectorAll('.note-font-option').forEach((btn) => {
            btn.addEventListener('mousedown', (e) => e.stopPropagation());
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setNoteFont(btn.dataset.font);
                this.openPopover();
            });
        });

        this.bindStepper(popover, {
            idPrefix: 'display-opt-note-scale',
            onOut: () => NoteFontScale.step(-NoteFontScale.SCALE_STEP),
            onIn: () => NoteFontScale.step(NoteFontScale.SCALE_STEP)
        });

        this.bindStepper(popover, {
            idPrefix: 'display-opt-desktop-zoom',
            disabled: !desktopZoomEnabled,
            onOut: () => DesktopZoom.step(-DesktopZoom.ZOOM_STEP),
            onIn: () => DesktopZoom.step(DesktopZoom.ZOOM_STEP)
        });

        popover.querySelector('#display-opt-chrome-bg')?.addEventListener('click', (e) => {
            e.stopPropagation();
            ChromeBackground.openPicker(e.currentTarget);
        });

        popover.querySelector('#display-opt-desktop-bg')?.addEventListener('click', (e) => {
            e.stopPropagation();
            DesktopBackground.openPicker(e.currentTarget);
        });

        popover.querySelector('#display-opt-reset')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!resetCustomizationToDefaults()) return;
            this.options = readDisplayOptions();
            applyDisplayOptions(this.options);
            this.onChange?.(this.options);
            this.openPopover();
        });

        popover.querySelectorAll('.display-options-row, .display-options-bg-row').forEach((row) => {
            row.addEventListener('mousedown', (e) => e.stopPropagation());
        });

        NoteFontScale.updateLabels();
        DesktopZoom.updateButtons();

        popover.classList.remove('is-hidden');
        positionPopoverBelowAnchor(popover, target);
        target.setAttribute('aria-expanded', 'true');

        this.outsideHandler = (e) => {
            if (popover.contains(e.target) || target.contains(e.target)) return;
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
        this.toggleFrom(this.triggerBtn);
    },

    toggleFrom(anchor) {
        if (!anchor) return;
        if (this.popover && !this.popover.classList.contains('is-hidden') && this.activeAnchor === anchor) {
            this.closePopover();
        } else {
            this.openPopover(anchor);
        }
    }
};

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
