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
import {
    AppTheme,
    buildThemeOptionsHtml,
    isAppThemeCustomized,
    getThemeById,
    TOKEN_KEYS,
    DEFAULT_TOKENS,
    THEME_TOKEN_LABELS,
    readUserTheme,
    writeUserTheme,
    isTokenCustomized,
    applyUserTheme,
    findMatchingThemeId,
    APP_THEMES
} from './appTheme.js';
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
    showRulerHorizontal: false,
    showRulerVertical: false,
    noteFontId: 'default',
    brandIconId: 'clipboard',
    useCategoryColors: true,
    undockedModuleOpacity: 1
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
            showRulerHorizontal: raw.showRulerHorizontal === true,
            showRulerVertical: raw.showRulerVertical === true,
            noteFontId,
            brandIconId: resolveBrandIconId(raw.brandIconId),
            useCategoryColors: raw.useCategoryColors !== false,
            undockedModuleOpacity: Math.min(1, Math.max(0.1, Number(raw.undockedModuleOpacity) || 1))
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
    root.dataset.showRulerH = options.showRulerHorizontal ? '1' : '0';
    root.dataset.showRulerV = options.showRulerVertical ? '1' : '0';
    root.dataset.useCategoryColors = options.useCategoryColors ? '1' : '0';
    root.style.setProperty('--sidebar-undock-opacity', String(options.undockedModuleOpacity ?? 1));
    applyNoteFont(options.noteFontId);
    applyBrandIcon(options.brandIconId);

    /* Apply user theme tokens */
    const userTheme = readUserTheme();
    applyUserTheme(userTheme);
}

function isCustomized(options) {
    return !options.showCategoryBand
        || !options.showCategoryName
        || !options.showCreatedDate
        || !options.showNoteSize
        || options.showLineCount
        || options.desktopGradient
        || options.desktopGridLines
        || options.showRulerHorizontal
        || options.showRulerVertical
        || !options.useCategoryColors
        || Math.abs((options.undockedModuleOpacity ?? 1) - 1) > 0.001
        || isNoteFontCustomized(options.noteFontId)
        || isAppThemeCustomized()
        || NoteFontScale.isCustomized()
        || DesktopZoom.isCustomized()
        || ChromeBackground.isCustomized()
        || DesktopBackground.isCustomized()
        || isBrandIconCustomized(options.brandIconId)
        || TOKEN_KEYS.some(isTokenCustomized);
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

    sliderRow({ id, label, valuePercent, min = 0.1, max = 1, step = 0.05 }) {
        return `<div class="display-options-slider-row">
            <span class="display-options-slider-label">${escapeHtml(label)}</span>
            <span class="display-options-slider-value" id="${id}-value">${valuePercent}</span>
            <input type="range" class="display-options-slider" id="${id}" min="${min}" max="${max}" step="${step}" value="${valuePercent}" aria-label="${escapeHtml(label)}">
        </div>`;
    },

    themeRowHtml(selectedId) {
        const buildButton = (theme) => {
            const selected = theme.id === selectedId;
            return `<button type="button" class="app-theme-option app-theme-option--compact${selected ? ' is-selected' : ''}" data-theme="${theme.id}" role="menuitemradio" aria-checked="${selected}" title="${escapeHtml(theme.label)}" aria-label="${escapeHtml(theme.label)}">
                <span class="app-theme-swatch" aria-hidden="true">${theme.swatch.map(c => `<span class="app-theme-swatch-chip" style="background:${c}"></span>`).join('')}</span>
                ${selected ? '<span class="app-theme-check" aria-hidden="true">✓</span>' : ''}
            </button>`;
        };

        const regular = APP_THEMES.filter(t => !t.special).map(buildButton).join('');
        const fancy = APP_THEMES.filter(t => t.special).map(buildButton).join('');

        return `
            <div class="display-options-theme-group">
                <span class="display-options-theme-group-label">Regular</span>
                <div class="display-options-theme-group-buttons">${regular}</div>
            </div>
            <div class="display-options-theme-group">
                <span class="display-options-theme-group-label">Fancy</span>
                <div class="display-options-theme-group-buttons">${fancy}</div>
            </div>
        `;
    },

    bgRow(id, label, cssVar) {
        return `<button type="button" class="display-options-bg-btn btn btn--compact btn--icon" id="${id}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
            <span class="display-options-swatch" style="background: var(${cssVar})" aria-hidden="true"></span>
        </button>`;
    },

    themeTokenRow(id, key, label) {
        const value = readUserTheme()[key] || DEFAULT_TOKENS[key];
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

        const matchingThemeId = findMatchingThemeId();
        this.setRadioGroupSelection(root, '.app-theme-option', matchingThemeId || 'dark', 'theme');
        this.setSelectSelection(root, '#display-opt-note-font', this.options.noteFontId);
        this.setRadioGroupSelection(root, '.brand-icon-option', this.options.brandIconId, 'brandIcon');

        /* Sync theme token pickers */
        TOKEN_KEYS.forEach((key, index) => {
            const btn = root.querySelector(`#theme-token-${index}`);
            if (btn) {
                const value = readUserTheme()[key] || DEFAULT_TOKENS[key];
                btn.querySelector('.display-options-swatch').style.background = value;
                btn.title = `${THEME_TOKEN_LABELS[key]}: ${value}`;
            }
        });

        NoteFontScale.updateLabels();
        DesktopZoom.updateButtons();

        // Update desktop count stepper label
        const desktopCountLabel = root.querySelector('#display-opt-desktop-count-label');
        if (desktopCountLabel) {
            desktopCountLabel.textContent = String(DesktopManager.getDesktopCount());
        }

        const undockOpacityInput = root.querySelector('#display-opt-undock-opacity');
        if (undockOpacityInput) {
            undockOpacityInput.value = String(this.options.undockedModuleOpacity ?? 1);
            const undockOpacityLabel = root.querySelector('#display-opt-undock-opacity-value');
            if (undockOpacityLabel) {
                undockOpacityLabel.textContent = `${Math.round((this.options.undockedModuleOpacity ?? 1) * 100)}%`;
            }
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
        const desktopZoomEnabled = this.isDesktopZoomEnabled();

        /* Build theme token rows */
        const themeTokenRows = TOKEN_KEYS.map((key, index) => {
            return this.themeTokenRow(`theme-token-${index}`, key, THEME_TOKEN_LABELS[key]);
        }).join('');

        const matchingThemeId = findMatchingThemeId();
        const selectedThemeId = matchingThemeId || 'dark';

        return `
            <div class="modal modal--wide display-options-modal">
                <div class="display-options-header">
                    <h2 id="display-options-title" class="display-options-title">Display options</h2>
                    <button type="button" class="card-act card-act--close display-options-close" id="display-opt-close" title="Close" aria-label="Close">${CARD_ICONS.close}</button>
                </div>
                <div class="display-options-body modal-body">
                    <div class="display-options-list">
                        <div class="display-options-section display-options-section--theme">
                            <h3 class="display-options-heading">Theme</h3>
                            ${this.themeRowHtml(selectedThemeId)}
                            <p class="display-options-subheading">Colors</p>
                            <div class="display-options-bg-row-group">
                                ${themeTokenRows}
                            </div>
                            <p class="display-options-subheading">Site icon</p>
                            <div class="brand-icon-list">${buildBrandIconOptionsHtml(opts.brandIconId)}</div>
                        </div>
                        <div class="display-options-section display-options-section--typography">
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
                        </div>
                        <div class="display-options-section display-options-section--notes">
                            <h3 class="display-options-heading">Notes on desktop</h3>
                            <div class="display-options-check-row">
                                ${this.optionRow('display-opt-category-band', 'Category color band', opts.showCategoryBand)}
                                ${this.optionRow('display-opt-category', 'Category name', opts.showCategoryName)}
                                ${this.optionRow('display-opt-use-category-colors', 'Use category colors', opts.useCategoryColors)}
                                ${this.optionRow('display-opt-created', 'Created date', opts.showCreatedDate)}
                                ${this.optionRow('display-opt-note-size', 'Note size', opts.showNoteSize)}
                                ${this.optionRow('display-opt-note-lines', 'Number of lines', opts.showLineCount)}
                            </div>
                            <p class="display-options-subheading">Desktop appearance</p>
                            <div class="display-options-check-row display-options-check-row--inline">
                                ${this.optionRow('display-opt-gradient', 'Gradient background', opts.desktopGradient)}
                                ${this.optionRow('display-opt-grid-lines', 'Show grid lines', opts.desktopGridLines)}
                                ${this.optionRow('display-opt-ruler-h', 'Horizontal ruler', opts.showRulerHorizontal)}
                                ${this.optionRow('display-opt-ruler-v', 'Vertical ruler', opts.showRulerVertical)}
                            </div>
                            <p class="display-options-subheading">Desktop count</p>
                            <div class="display-options-scale-row">
                                ${this.stepperRow({
                                    idPrefix: 'display-opt-desktop-count',
                                    label: 'Number of desktops',
                                    valuePercent: `${DesktopManager.getDesktopCount()}`
                                })}
                            </div>
                        </div>
                        <div class="display-options-section display-options-section--sidebar">
                            <h3 class="display-options-heading">Sidebar</h3>
                            ${this.sliderRow({
                                id: 'display-opt-undock-opacity',
                                label: 'Undocked module opacity',
                                valuePercent: `${Math.round((opts.undockedModuleOpacity ?? 1) * 100)}%`,
                                min: 0.1,
                                max: 1,
                                step: 0.05
                            })}
                        </div>
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
        bindToggle('display-opt-ruler-h', 'showRulerHorizontal');
        bindToggle('display-opt-ruler-v', 'showRulerVertical');
        bindToggle('display-opt-use-category-colors', 'useCategoryColors');

        const undockOpacityInput = root.querySelector('#display-opt-undock-opacity');
        if (undockOpacityInput) {
            const updateOpacity = () => {
                const value = parseFloat(undockOpacityInput.value);
                if (!Number.isFinite(value)) return;
                this.setOptions({ undockedModuleOpacity: value });
                const label = root.querySelector('#display-opt-undock-opacity-value');
                if (label) label.textContent = `${Math.round(value * 100)}%`;
            };
            undockOpacityInput.addEventListener('input', updateOpacity);
            undockOpacityInput.addEventListener('change', updateOpacity);
        }

        root.querySelectorAll('.app-theme-option').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const newThemeId = btn.dataset.theme;
                const newTheme = getThemeById(newThemeId);
                
                /* Overwrite user theme with preset tokens */
                if (newTheme && newTheme.tokens) {
                    writeUserTheme(newTheme.tokens);
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
        TOKEN_KEYS.forEach((key, index) => {
            const btn = root.querySelector(`#theme-token-${index}`);
            if (btn) {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const picker = createThemePicker({
                        storageKey: 'matrix_custom_theme_tokens',
                        tokenKey: key,
                        defaultColor: DEFAULT_TOKENS[key],
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
                        cssVar: key,
                        ariaLabel: THEME_TOKEN_LABELS[key],
                        onApply: (value) => {
                            const userTheme = readUserTheme();
                            userTheme[key] = value;
                            writeUserTheme(userTheme);
                            applyUserTheme({ [key]: value });
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
            this.rebuildModal();
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
    return str.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
}