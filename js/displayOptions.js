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
import { ACTION_ICONS, CARD_ICONS } from './ui.js';
import { AppTheme, buildThemeOptionsHtml, isAppThemeCustomized, readAppTheme } from './appTheme.js';
import {
    applyTileSmallFootprint,
    getSmallFootprintRect,
    isTileSmallFootprintCustomized,
    readTileSmallFootprint,
    writeTileSmallFootprint
} from './tileFootprint.js';
import { GridFineness } from './gridDensity.js';

const STORAGE_KEY = 'matrix_display_options';

const DEFAULTS = {
    showCategoryName: true,
    showCreatedDate: true,
    showNoteSize: true,
    showLineCount: false,
    desktopGradient: false,
    desktopGridLines: false,
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
            desktopGridLines: raw.desktopGridLines === true,
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
    root.dataset.desktopGridLines = options.desktopGridLines ? '1' : '0';
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
        || options.desktopGridLines
        || !options.cardAnimations
        || isNoteFontCustomized(options.noteFontId)
        || isAppThemeCustomized()
        || NoteFontScale.isCustomized()
        || DesktopZoom.isCustomized()
        || ChromeBackground.isCustomized()
        || DesktopBackground.isCustomized()
        || isTileSmallFootprintCustomized()
        || GridFineness.isCustomized();
}

export const DisplayOptions = {
    triggerBtn: null,
    activeAnchor: null,
    overlay: null,
    backdropHandler: null,
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
            this.toggleModal();
        });

        window.addEventListener('appearance:grid_fineness_changed', () => this.syncButtonState());
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
            this.toggleModal();
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

    isOpen() {
        return this.overlay && !this.overlay.classList.contains('is-hidden');
    },

    ensureOverlay() {
        if (!this.overlay) {
            this.overlay = document.createElement('div');
            this.overlay.className = 'overlay display-options-overlay is-hidden';
            this.overlay.setAttribute('role', 'dialog');
            this.overlay.setAttribute('aria-modal', 'true');
            this.overlay.setAttribute('aria-labelledby', 'display-options-title');
            document.body.appendChild(this.overlay);
        }
        return this.overlay;
    },

    closeModal() {
        if (!this.overlay) return;
        this.overlay.classList.add('is-hidden');
        this.triggerBtn?.setAttribute('aria-expanded', 'false');
        this.activeAnchor?.setAttribute('aria-expanded', 'false');
        this.activeAnchor = null;
        if (this.backdropHandler) {
            this.overlay.removeEventListener('mousedown', this.backdropHandler);
            this.backdropHandler = null;
        }
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    },

    optionRow(id, label, checked) {
        return `<label class="display-options-row" for="${id}">
            <input type="checkbox" class="display-options-checkbox" id="${id}"${checked ? ' checked' : ''}>
            <span class="display-options-row-label">${escapeHtml(label)}</span>
        </label>`;
    },

    stepperRow({ idPrefix, label, valuePercent, disabled = false, disabledHint = '' }) {
        const disabledClass = disabled ? ' is-disabled' : '';
        const disabledAttr = disabled ? ' disabled' : '';
        return `<div class="display-options-stepper-row${disabledClass}">
            <span class="display-options-stepper-label">${escapeHtml(label)}</span>
            ${disabled && disabledHint ? `<span class="display-options-row-hint">${escapeHtml(disabledHint)}</span>` : ''}
            <span class="display-options-stepper" aria-label="${escapeHtml(label)}">
                <button type="button" id="${idPrefix}-out" class="btn btn--compact btn--icon display-options-stepper-btn" title="Decrease" aria-label="Decrease ${escapeHtml(label)}"${disabledAttr}>−</button>
                <span id="${idPrefix}-label" class="display-options-stepper-value">${escapeHtml(valuePercent)}</span>
                <button type="button" id="${idPrefix}-in" class="btn btn--compact btn--icon display-options-stepper-btn" title="Increase" aria-label="Increase ${escapeHtml(label)}"${disabledAttr}>+</button>
            </span>
        </div>`;
    },

    bgRow(id, label, cssVar) {
        return `<button type="button" class="display-options-bg-row" id="${id}">
            <span class="display-options-row-label">${escapeHtml(label)}</span>
            <span class="display-options-swatch" style="background: var(${cssVar})" aria-hidden="true"></span>
        </button>`;
    },

    tileFootprintOptionsHtml(selectedId) {
        const options = [
            { id: 'label', label: 'Label', size: getSmallFootprintRect('label') },
            { id: 'card', label: 'Card', size: getSmallFootprintRect('card') },
            { id: 'wide', label: 'Wide card', size: getSmallFootprintRect('wide') }
        ];
        return options.map((opt) => {
            const selected = opt.id === selectedId;
            const sizeLabel = `${opt.size.w}×${opt.size.h}`;
            return `<button type="button" class="tile-footprint-option${selected ? ' is-selected' : ''}" data-footprint="${opt.id}" role="menuitemradio" aria-checked="${selected}">
                <span class="tile-footprint-option-meta">
                    <span class="tile-footprint-option-label">${escapeHtml(opt.label)}</span>
                    <span class="tile-footprint-option-desc">${escapeHtml(sizeLabel)}</span>
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

    bindStepper(root, { idPrefix, onOut, onIn, disabled = false }) {
        if (disabled) return;
        root.querySelector(`#${idPrefix}-out`)?.addEventListener('click', (e) => {
            e.stopPropagation();
            onOut();
            this.openModal();
        });
        root.querySelector(`#${idPrefix}-in`)?.addEventListener('click', (e) => {
            e.stopPropagation();
            onIn();
            this.openModal();
        });
    },

    buildModalHtml() {
        const opts = this.options;
        const noteScalePct = `${Math.round(NoteFontScale.getScale() * 100)}%`;
        const desktopZoomPct = `${Math.round(DesktopZoom.getScale() * 100)}%`;
        const desktopZoomEnabled = this.isDesktopZoomEnabled();
        const tileFootprint = readTileSmallFootprint();
        const gridFinenessLabel = GridFineness.getCellLabel();

        return `
            <div class="modal modal--wide display-options-modal">
                <div class="display-options-header">
                    <h2 id="display-options-title" class="display-options-title">Display options</h2>
                    <button type="button" class="card-act card-act--close display-options-close" id="display-opt-close" title="Close" aria-label="Close">${CARD_ICONS.close}</button>
                </div>
                <div class="display-options-body modal-body">
                    <div class="display-options-grid">
                        <section class="display-options-section display-options-section--theme">
                            <h3 class="display-options-heading">Theme</h3>
                            <div class="display-options-theme-grid app-theme-list">${buildThemeOptionsHtml(readAppTheme())}</div>
                        </section>
                        <section class="display-options-section display-options-section--typography">
                            <h3 class="display-options-heading">Typography</h3>
                            <div class="display-options-font-grid">${this.noteFontOptionsHtml(opts.noteFontId)}</div>
                            <div class="display-options-scale-row">
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
                        </section>
                        <section class="display-options-section display-options-section--notes">
                            <h3 class="display-options-heading">Notes on desktop</h3>
                            <div class="display-options-check-grid">
                                ${this.optionRow('display-opt-category', 'Category name', opts.showCategoryName)}
                                ${this.optionRow('display-opt-created', 'Created date', opts.showCreatedDate)}
                                ${this.optionRow('display-opt-note-size', 'Note size', opts.showNoteSize)}
                                ${this.optionRow('display-opt-note-lines', 'Number of lines', opts.showLineCount)}
                            </div>
                            <p class="display-options-subheading">Collapsed note size</p>
                            <div class="tile-footprint-list">${this.tileFootprintOptionsHtml(tileFootprint)}</div>
                        </section>
                        <section class="display-options-section display-options-section--desktop">
                            <h3 class="display-options-heading">Desktop</h3>
                            <div class="display-options-scale-row">
                                ${this.stepperRow({
                                    idPrefix: 'display-opt-grid-fineness',
                                    label: 'Grid fineness',
                                    valuePercent: gridFinenessLabel
                                })}
                            </div>
                            <div class="display-options-check-grid display-options-check-grid--inline">
                                ${this.optionRow('display-opt-gradient', 'Gradient background', opts.desktopGradient)}
                                ${this.optionRow('display-opt-grid-lines', 'Show grid lines', opts.desktopGridLines)}
                                ${this.optionRow('display-opt-animations', 'Card animations', opts.cardAnimations)}
                            </div>
                        </section>
                        <section class="display-options-section display-options-section--backgrounds display-options-section--full">
                            <h3 class="display-options-heading">Backgrounds</h3>
                            <div class="display-options-bg-row-group">
                                ${this.bgRow('display-opt-chrome-bg', 'Panel & header', '--chrome-bg')}
                                ${this.bgRow('display-opt-desktop-bg', 'Desktop', '--desktop-bg')}
                            </div>
                        </section>
                    </div>
                </div>
                <div class="display-options-footer">
                    <button type="button" class="btn display-options-reset" id="display-opt-reset">
                        <span class="display-options-reset-label">${ACTION_ICONS.resetCustomization}<span>Reset to defaults</span></span>
                    </button>
                </div>
            </div>
        `;
    },

    bindModalInteractions(root) {
        const bindToggle = (id, key) => {
            root.querySelector(`#${id}`)?.addEventListener('change', (e) => {
                e.stopPropagation();
                this.setOptions({ [key]: e.target.checked });
                this.openModal();
            });
        };

        bindToggle('display-opt-category', 'showCategoryName');
        bindToggle('display-opt-created', 'showCreatedDate');
        bindToggle('display-opt-note-size', 'showNoteSize');
        bindToggle('display-opt-note-lines', 'showLineCount');
        bindToggle('display-opt-gradient', 'desktopGradient');
        bindToggle('display-opt-grid-lines', 'desktopGridLines');
        bindToggle('display-opt-animations', 'cardAnimations');

        root.querySelectorAll('.app-theme-option').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                AppTheme.setTheme(btn.dataset.theme);
                this.openModal();
            });
        });

        root.querySelectorAll('.tile-footprint-option').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setTileSmallFootprint(btn.dataset.footprint);
                this.openModal();
            });
        });

        root.querySelectorAll('.note-font-option').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setNoteFont(btn.dataset.font);
                this.openModal();
            });
        });

        this.bindStepper(root, {
            idPrefix: 'display-opt-note-scale',
            onOut: () => NoteFontScale.step(-NoteFontScale.SCALE_STEP),
            onIn: () => NoteFontScale.step(NoteFontScale.SCALE_STEP)
        });

        this.bindStepper(root, {
            idPrefix: 'display-opt-desktop-zoom',
            disabled: !this.isDesktopZoomEnabled(),
            onOut: () => DesktopZoom.step(-DesktopZoom.ZOOM_STEP),
            onIn: () => DesktopZoom.step(DesktopZoom.ZOOM_STEP)
        });

        this.bindStepper(root, {
            idPrefix: 'display-opt-grid-fineness',
            onOut: () => GridFineness.step(-1),
            onIn: () => GridFineness.step(1)
        });

        root.querySelector('#display-opt-chrome-bg')?.addEventListener('click', (e) => {
            e.stopPropagation();
            ChromeBackground.openPicker(e.currentTarget);
        });

        root.querySelector('#display-opt-desktop-bg')?.addEventListener('click', (e) => {
            e.stopPropagation();
            DesktopBackground.openPicker(e.currentTarget);
        });

        root.querySelector('#display-opt-reset')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!resetCustomizationToDefaults()) return;
            this.options = readDisplayOptions();
            applyDisplayOptions(this.options);
            this.onChange?.(this.options);
            this.openModal();
        });

        root.querySelector('#display-opt-close')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeModal();
        });
    },

    openModal(anchor) {
        const savedAnchor = anchor || this.activeAnchor;
        const target = savedAnchor || this.triggerBtn;
        if (!target && !this.isOpen()) return;

        const wasOpen = this.isOpen();
        if (!wasOpen) {
            this.activeAnchor = savedAnchor || null;
        }

        const overlay = this.ensureOverlay();
        overlay.innerHTML = this.buildModalHtml();
        this.bindModalInteractions(overlay);

        NoteFontScale.updateLabels();
        DesktopZoom.updateButtons();

        overlay.classList.remove('is-hidden');
        target?.setAttribute('aria-expanded', 'true');

        if (!this.backdropHandler) {
            this.backdropHandler = (e) => {
                if (e.target !== overlay) return;
                this.closeModal();
            };
            overlay.addEventListener('mousedown', this.backdropHandler);
        }

        if (!this.keyHandler) {
            this.keyHandler = (e) => {
                if (e.key === 'Escape') this.closeModal();
            };
            document.addEventListener('keydown', this.keyHandler);
        }

        if (!wasOpen) {
            overlay.querySelector('#display-opt-close')?.focus();
        }
    },

    toggleModal() {
        this.toggleFrom(this.triggerBtn);
    },

    togglePopover() {
        this.toggleModal();
    },

    toggleFrom(anchor) {
        if (!anchor) return;
        if (this.isOpen() && this.activeAnchor === anchor) {
            this.closeModal();
        } else {
            this.openModal(anchor);
        }
    },

    closePopover() {
        this.closeModal();
    },

    openPopover(anchor) {
        this.openModal(anchor);
    }
};

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
