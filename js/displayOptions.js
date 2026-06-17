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
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import { AppTheme, buildThemeOptionsHtml, isAppThemeCustomized, readAppTheme } from './appTheme.js';
import {
    applyBrandIcon,
    buildBrandIconOptionsHtml,
    isBrandIconCustomized,
    resolveBrandIconId
} from './brandIcon.js';

const STORAGE_KEY = 'matrix_display_options';

const DEFAULTS = {
    showCategoryBand: true,
    showCategoryName: true,
    showCreatedDate: true,
    showNoteSize: true,
    showLineCount: false,
    desktopGradient: false,
    desktopGridLines: false,
    noteFontId: 'default',
    brandIconId: 'clipboard'
};

export function readDisplayOptions() {
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        const noteFontId = NOTE_FONTS.some((f) => f.id === raw.noteFontId)
            ? raw.noteFontId
            : readNoteFont();
        return {
            showCategoryBand: raw.showCategoryBand !== false,
            showCategoryName: raw.showCategoryName !== false,
            showCreatedDate: raw.showCreatedDate !== false,
            showNoteSize: raw.showNoteSize !== false,
            showLineCount: raw.showLineCount === true,
            desktopGradient: raw.desktopGradient === true,
            desktopGridLines: raw.desktopGridLines === true,
            noteFontId,
            brandIconId: resolveBrandIconId(raw.brandIconId)
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
    root.dataset.showCategoryBand = options.showCategoryBand ? '1' : '0';
    root.dataset.showNoteCategory = options.showCategoryName ? '1' : '0';
    root.dataset.showNoteCreated = options.showCreatedDate ? '1' : '0';
    root.dataset.showNoteSize = options.showNoteSize ? '1' : '0';
    root.dataset.showNoteLines = options.showLineCount ? '1' : '0';
    root.dataset.desktopGradient = options.desktopGradient ? '1' : '0';
    root.dataset.desktopGridLines = options.desktopGridLines ? '1' : '0';
    applyNoteFont(options.noteFontId);
    applyBrandIcon(options.brandIconId);
}

function isCustomized(options) {
    return !options.showCategoryBand
        || !options.showCategoryName
        || !options.showCreatedDate
        || !options.showNoteSize
        || options.showLineCount
        || options.desktopGradient
        || options.desktopGridLines
        || isNoteFontCustomized(options.noteFontId)
        || isAppThemeCustomized()
        || NoteFontScale.isCustomized()
        || DesktopZoom.isCustomized()
        || ChromeBackground.isCustomized()
        || DesktopBackground.isCustomized()
        || isBrandIconCustomized(options.brandIconId);
}

export const DisplayOptions = {
    triggerBtn: null,
    triggerAbort: null,
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
        if (this.triggerBtn) {
            this.bindTriggerClick(this.triggerBtn);
        }

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

    bindTriggerClick(btn) {
        this.triggerAbort?.abort();
        this.triggerAbort = new AbortController();
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleModal();
        }, { signal: this.triggerAbort.signal });
    },

    rebindTrigger() {
        this.triggerBtn = document.getElementById('btn-display-options');
        if (!this.triggerBtn) return;
        this.bindTriggerClick(this.triggerBtn);
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
        return `<button type="button" class="display-options-bg-btn btn btn--compact btn--icon" id="${id}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
            <span class="display-options-swatch" style="background: var(${cssVar})" aria-hidden="true"></span>
        </button>`;
    },

    noteFontOptionsHtml(selectedId) {
        return NOTE_FONTS.map((font) => {
            const selected = font.id === selectedId;
            const family = font.family || "system-ui, sans-serif";
            const compactClass = font.compact ? ' note-font-option-label--compact' : '';
            const styleAttr = font.id === 'default' ? '' : ` style="font-family:${family}"`;
            return `<button type="button" class="note-font-option${selected ? ' is-selected' : ''}" data-font="${font.id}" role="menuitemradio" aria-checked="${selected}" title="${escapeHtml(font.desc)}">
                <span class="note-font-option-label${compactClass}"${styleAttr}>${escapeHtml(font.label)}</span>
                ${selected ? '<span class="clock-style-check" aria-hidden="true">✓</span>' : ''}
            </button>`;
        }).join('');
    },

    setRadioGroupSelection(root, selector, selectedId, dataAttr) {
        root.querySelectorAll(selector).forEach((btn) => {
            const selected = btn.dataset[dataAttr] === selectedId;
            btn.classList.toggle('is-selected', selected);
            btn.setAttribute('aria-checked', String(selected));
            let check = btn.querySelector('.clock-style-check');
            if (selected && !check) {
                check = document.createElement('span');
                check.className = 'clock-style-check';
                check.setAttribute('aria-hidden', 'true');
                check.textContent = '✓';
                btn.appendChild(check);
            } else if (!selected && check) {
                check.remove();
            }
        });
    },

    syncModalUi(root = this.overlay) {
        if (!root) return;

        this.setRadioGroupSelection(root, '.app-theme-option', readAppTheme(), 'theme');
        this.setRadioGroupSelection(root, '.note-font-option', this.options.noteFontId, 'font');
        this.setRadioGroupSelection(root, '.brand-icon-option', this.options.brandIconId, 'brandIcon');

        NoteFontScale.updateLabels();
        DesktopZoom.updateButtons();

        this.syncButtonState();
    },

    bindStepper(root, { idPrefix, onOut, onIn, disabled = false }) {
        if (disabled) return;
        root.querySelector(`#${idPrefix}-out`)?.addEventListener('click', (e) => {
            e.stopPropagation();
            onOut();
            this.syncModalUi(root);
        });
        root.querySelector(`#${idPrefix}-in`)?.addEventListener('click', (e) => {
            e.stopPropagation();
            onIn();
            this.syncModalUi(root);
        });
    },

    buildModalHtml() {
        const opts = this.options;
        const noteScalePct = `${Math.round(NoteFontScale.getScale() * 100)}%`;
        const desktopZoomPct = `${Math.round(DesktopZoom.getScale() * 100)}%`;
        const desktopZoomEnabled = this.isDesktopZoomEnabled();

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
                            <div class="display-options-theme-grid app-theme-list">${buildThemeOptionsHtml(readAppTheme(), { compact: true })}</div>
                            <p class="display-options-subheading">Backgrounds</p>
                            <div class="display-options-bg-row-group">
                                ${this.bgRow('display-opt-chrome-bg', 'Panel & header', '--chrome-bg')}
                                ${this.bgRow('display-opt-desktop-bg', 'Desktop', '--desktop-bg')}
                            </div>
                            <p class="display-options-subheading">Site icon</p>
                            <div class="brand-icon-list">${buildBrandIconOptionsHtml(opts.brandIconId)}</div>
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
                                ${this.optionRow('display-opt-category-band', 'Category color band', opts.showCategoryBand)}
                                ${this.optionRow('display-opt-category', 'Category name', opts.showCategoryName)}
                                ${this.optionRow('display-opt-created', 'Created date', opts.showCreatedDate)}
                                ${this.optionRow('display-opt-note-size', 'Note size', opts.showNoteSize)}
                                ${this.optionRow('display-opt-note-lines', 'Number of lines', opts.showLineCount)}
                            </div>
                            <p class="display-options-subheading">Desktop appearance</p>
                            <div class="display-options-check-grid display-options-check-grid--inline">
                                ${this.optionRow('display-opt-gradient', 'Gradient background', opts.desktopGradient)}
                                ${this.optionRow('display-opt-grid-lines', 'Show grid lines', opts.desktopGridLines)}
                            </div>
                        </section>
                    </div>
                </div>
                <div class="display-options-footer">
                    <button type="button" class="btn btn--compact btn--icon display-options-reset" id="display-opt-reset" title="Reset to defaults" aria-label="Reset to defaults">${ACTION_ICONS.resetCustomization}</button>
                </div>
            </div>
        `;
    },

    bindModalInteractions(root) {
        const bindToggle = (id, key) => {
            root.querySelector(`#${id}`)?.addEventListener('change', (e) => {
                e.stopPropagation();
                this.setOptions({ [key]: e.target.checked });
            });
        };

        bindToggle('display-opt-category-band', 'showCategoryBand');
        bindToggle('display-opt-category', 'showCategoryName');
        bindToggle('display-opt-created', 'showCreatedDate');
        bindToggle('display-opt-note-size', 'showNoteSize');
        bindToggle('display-opt-note-lines', 'showLineCount');
        bindToggle('display-opt-gradient', 'desktopGradient');
        bindToggle('display-opt-grid-lines', 'desktopGridLines');

        root.querySelectorAll('.app-theme-option').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                AppTheme.setTheme(btn.dataset.theme);
                this.syncModalUi(root);
            });
        });

        root.querySelectorAll('.note-font-option').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setNoteFont(btn.dataset.font);
                this.syncModalUi(root);
            });
        });

        root.querySelectorAll('.brand-icon-option').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setOptions({ brandIconId: btn.dataset.brandIcon });
                this.syncModalUi(root);
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
            this.rebuildModal();
        });

        root.querySelector('#display-opt-close')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeModal();
        });
    },

    rebuildModal() {
        const overlay = this.ensureOverlay();
        const body = overlay.querySelector('.display-options-body');
        const scrollTop = body?.scrollTop ?? 0;

        overlay.innerHTML = this.buildModalHtml();
        this.bindModalInteractions(overlay);

        const newBody = overlay.querySelector('.display-options-body');
        if (newBody) {
            newBody.scrollTop = scrollTop;
        }

        NoteFontScale.updateLabels();
        DesktopZoom.updateButtons();
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
