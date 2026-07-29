import {
    applyNoteFont,
    isNoteFontCustomized,
    NOTE_FONTS,
    readNoteFont,
    writeNoteFont
} from './noteFont.js';
import { NoteFontScale } from './noteFontScale.js';
import { DesktopZoom } from './desktopZoom.js';
import { BoardPlacement } from './boardPlacement.js';
import { UI } from './ui.js';
import { isBoardOverlayEnabled } from './boardOverlay.js';
import { ChromeBackground } from './chromeBackground.js';
import { DesktopBackground } from './desktopBackground.js';
import { resetCustomizationToDefaults } from './customizationReset.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import { AppTheme, buildThemeOptionsHtml, isAppThemeCustomized, readAppTheme, getThemeById } from './appTheme.js';
import {
    applyBrandIcon,
    buildBrandIconOptionsHtml,
    isBrandIconCustomized,
    resolveBrandIconId
} from './brandIcon.js';
import { DesktopManager, MAX_DESKTOP_COUNT } from './desktopManager.js';
import { createThemePicker } from './themePicker.js';

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

/* Theme token storage keys and defaults */
const THEME_TOKEN_KEYS = [
    'themeToken_bg_primary',
    'themeToken_bg_surface',
    'themeToken_bg_card',
    'themeToken_text_main',
    'themeToken_text_muted',
    'themeToken_accent',
    'themeToken_border_color',
    'themeToken_desktop_bg',
    'themeToken_chrome_bg'
];

const THEME_TOKEN_DEFAULTS = {
    themeToken_bg_primary: '#121214',
    themeToken_bg_surface: '#121214',
    themeToken_bg_card: '#26262b',
    themeToken_text_main: '#e2e2e9',
    themeToken_text_muted: '#8b8b93',
    themeToken_accent: '#4f46e5',
    themeToken_border_color: '#323238',
    themeToken_desktop_bg: '#121214',
    themeToken_chrome_bg: '#151519'
};

const THEME_TOKEN_LABELS = {
    themeToken_bg_primary: 'Main background',
    themeToken_bg_surface: 'Surface background',
    themeToken_bg_card: 'Card background',
    themeToken_text_main: 'Primary text',
    themeToken_text_muted: 'Muted text',
    themeToken_accent: 'Accent color',
    themeToken_border_color: 'Border color',
    themeToken_desktop_bg: 'Desktop',
    themeToken_chrome_bg: 'Panel & header'
};

/* Mapping from theme token keys to CSS variable names */
const THEME_TOKEN_TO_CSS_VAR = {
    themeToken_bg_primary: '--bg-primary',
    themeToken_bg_surface: '--bg-surface',
    themeToken_bg_card: '--bg-card',
    themeToken_text_main: '--text-main',
    themeToken_text_muted: '--text-muted',
    themeToken_accent: '--accent',
    themeToken_border_color: '--border-color',
    themeToken_desktop_bg: '--desktop-bg',
    themeToken_chrome_bg: '--chrome-bg'
};

function readThemeToken(key) {
    try {
        const stored = localStorage.getItem(key);
        if (stored && /^#[0-9a-fA-F]{6}$/.test(stored)) return stored;
    } catch {
        /* ignore */
    }
    return THEME_TOKEN_DEFAULTS[key];
}

function writeThemeToken(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* ignore */
    }
}

function isThemeTokenCustomized(key) {
    return readThemeToken(key).toLowerCase() !== THEME_TOKEN_DEFAULTS[key].toLowerCase();
}

function applyThemeToken(key, value) {
    const root = document.documentElement;
    const cssVar = key.replace('themeToken_', '--');
    root.style.setProperty(cssVar, value);
}

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

    /* Apply theme tokens */
    THEME_TOKEN_KEYS.forEach((key) => {
        applyThemeToken(key, readThemeToken(key));
    });
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
        || BoardPlacement.isCustomized()
        || ChromeBackground.isCustomized()
        || DesktopBackground.isCustomized()
        || isBrandIconCustomized(options.brandIconId)
        || THEME_TOKEN_KEYS.some(isThemeTokenCustomized);
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
    getItems: null,

    init({ onChange, getLoggedIn, getItems } = {}) {
        this.onChange = onChange;
        this.getLoggedIn = getLoggedIn;
        this.getItems = getItems;
        this.options = readDisplayOptions();
        applyDisplayOptions(this.options);

        this.triggerBtn = document.getElementById('btn-display-options');
        if (this.triggerBtn) {
            this.bindTriggerClick(this.triggerBtn);
        }

        window.addEventListener('note:font_scale_changed', () => this.syncButtonState());
        window.addEventListener('appearance:color_changed', () => this.syncButtonState());
        window.addEventListener('app:theme_changed', () => this.syncButtonState());
        window.addEventListener('board:placement_stride_changed', () => this.syncButtonState());
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

    themeTokenRow(id, key, label) {
        const value = readThemeToken(key);
        return `<button type="button" class="theme-token-btn" id="${id}" title="${escapeHtml(label)}: ${value}" aria-label="${escapeHtml(label)}">
            <span class="display-options-swatch" style="background: ${value}" aria-hidden="true"></span>
        </button>`;
    },

    noteFontSelectHtml(selectedId) {
        return `<select id="display-opt-note-font" class="note-font-select" aria-label="Note font">
            ${NOTE_FONTS.map((font) => {
                const selected = font.id === selectedId;
                const style = font.family ? ` style="font-family:${font.family}"` : '';
                return `<option value="${font.id}"${selected ? ' selected' : ''}${style}>${escapeHtml(font.label)}</option>`;
            }).join('')}
        </select>`;
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

    setSelectSelection(root, selector, selectedId) {
        const select = root.querySelector(selector);
        if (select) {
            select.value = selectedId;
        }
    },

    syncModalUi(root = this.overlay) {
        if (!root) return;

        this.setRadioGroupSelection(root, '.app-theme-option', readAppTheme(), 'theme');
        this.setSelectSelection(root, '#display-opt-note-font', this.options.noteFontId);
        this.setRadioGroupSelection(root, '.brand-icon-option', this.options.brandIconId, 'brandIcon');

        /* Sync theme token pickers */
        THEME_TOKEN_KEYS.forEach((key, index) => {
            const btn = root.querySelector(`#theme-token-${index}`);
            if (btn) {
                const value = readThemeToken(key);
                btn.querySelector('.display-options-swatch').style.background = value;
                btn.title = `${THEME_TOKEN_LABELS[key]}: ${value}`;
            }
        });

        NoteFontScale.updateLabels();
        DesktopZoom.updateButtons();
        BoardPlacement.updateLabels();

        // Update desktop count stepper label
        const desktopCountLabel = root.querySelector('#display-opt-desktop-count-label');
        if (desktopCountLabel) {
            desktopCountLabel.textContent = String(DesktopManager.getDesktopCount());
        }

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
        const placementStridePx = `${BoardPlacement.getStridePx()}px`;
        const desktopZoomEnabled = this.isDesktopZoomEnabled();

        /* Build theme token rows */
        const themeTokenRows = THEME_TOKEN_KEYS.map((key, index) => {
            return this.themeTokenRow(`theme-token-${index}`, key, THEME_TOKEN_LABELS[key]);
        }).join('');

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
                            <p class="display-options-subheading">Colors</p>
                            <div class="display-options-bg-row-group">
                                ${themeTokenRows}
                            </div>
                            <p class="display-options-subheading">Site icon</p>
                            <div class="brand-icon-list">${buildBrandIconOptionsHtml(opts.brandIconId)}</div>
                        </section>
                        <section class="display-options-section display-options-section--typography">
                            <h3 class="display-options-heading">Typography</h3>
                            <div class="note-font-select-wrapper">${this.noteFontSelectHtml(opts.noteFontId)}</div>
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
                            <div class="display-options-scale-row">
                                ${this.stepperRow({
                                    idPrefix: 'display-opt-placement-stride',
                                    label: 'Snap spacing',
                                    valuePercent: placementStridePx
                                })}
                            </div>
                            <p class="display-options-row-hint">Snap ruler for moving notes (8–64px). Card size unchanged.</p>
                            <p class="display-options-subheading">Desktop count</p>
                            <div class="display-options-scale-row">
                                ${this.stepperRow({
                                    idPrefix: 'display-opt-desktop-count',
                                    label: 'Number of desktops',
                                    valuePercent: `${DesktopManager.getDesktopCount()}`
                                })}
                            </div>
                        </section>
                    </div>
                </div>
                <div class="display-options-footer">
                    <button type="button" class="btn btn--compact btn--icon display-options-reset-theme" id="display-opt-reset-theme" title="Reset theme" aria-label="Reset theme">${ACTION_ICONS.appTheme}</button>
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
                const newThemeId = btn.dataset.theme;
                const newTheme = getThemeById(newThemeId);
                
                /* Reset theme tokens to the new theme's defaults */
                if (newTheme && newTheme.tokens) {
                    THEME_TOKEN_KEYS.forEach((key) => {
                        const cssVar = THEME_TOKEN_TO_CSS_VAR[key];
                        if (cssVar && newTheme.tokens[cssVar]) {
                            writeThemeToken(key, newTheme.tokens[cssVar]);
                        }
                    });
                }
                
                AppTheme.setTheme(newThemeId);
                this.syncModalUi(root);
            });
        });

        root.querySelector('#display-opt-note-font')?.addEventListener('change', (e) => {
            e.stopPropagation();
            this.setNoteFont(e.target.value);
            this.syncModalUi(root);
        });

        root.querySelectorAll('.brand-icon-option').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setOptions({ brandIconId: btn.dataset.brandIcon });
                this.syncModalUi(root);
            });
        });

        /* Theme token color pickers */
        THEME_TOKEN_KEYS.forEach((key, index) => {
            const btn = root.querySelector(`#theme-token-${index}`);
            if (btn) {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const picker = createThemePicker({
                        storageKey: key,
                        defaultColor: THEME_TOKEN_DEFAULTS[key],
                        presets: [
                            { value: '#000000', label: 'Black' },
                            { value: '#121214', label: 'Default' },
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
                        ],
                        cssVar: key.replace('themeToken_', '--'),
                        ariaLabel: THEME_TOKEN_LABELS[key],
                        onApply: (value) => {
                            applyThemeToken(key, value);
                            this.syncButtonState();
                        }
                    });
                    picker.openPicker(btn);
                });
            }
        });

        /* Reset theme button - resets to default theme */
        root.querySelector('#display-opt-reset-theme')?.addEventListener('click', (e) => {
            e.stopPropagation();
            AppTheme.setTheme('dark');
            /* Reset theme tokens to default theme values */
            THEME_TOKEN_KEYS.forEach((key) => {
                writeThemeToken(key, THEME_TOKEN_DEFAULTS[key]);
            });
            this.rebuildModal();
        });

        this.bindStepper(root, {
            idPrefix: 'display-opt-placement-stride',
            onOut: () => {
                BoardPlacement.step(-1);
                const canvas = document.getElementById('app-canvas');
                if (canvas) {
                    UI.resnapBoardPositions(canvas, { reflow: !isBoardOverlayEnabled() });
                }
            },
            onIn: () => {
                BoardPlacement.step(1);
                const canvas = document.getElementById('app-canvas');
                if (canvas) {
                    UI.resnapBoardPositions(canvas, { reflow: !isBoardOverlayEnabled() });
                }
            }
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
            idPrefix: 'display-opt-desktop-count',
            onOut: () => {
                DesktopManager.setDesktopCount(DesktopManager.getDesktopCount() - 1, this.getItems?.() || []);
            },
            onIn: () => {
                DesktopManager.setDesktopCount(DesktopManager.getDesktopCount() + 1, this.getItems?.() || []);
            }
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
        BoardPlacement.updateLabels();
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
        BoardPlacement.updateLabels();

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
    return str.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
}