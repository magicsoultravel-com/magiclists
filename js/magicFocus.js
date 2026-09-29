/** @module {"owns":"magic focus workspace mode — split panes, setup DnD, planner block hosting", "related":["app.js","noteQuickActions.js","drawingBoard.js","plannerUi.js","noteSurface.js"]} */

import { CARD_ICONS } from './icons.js';
import { buildNoteQuickActionsHtml, buildExpandedChecklistHtml, renderRichHtml, buildNoteTitleHtml } from './noteSurfaceHtml.js';
import { bindNoteQuickActions } from './noteQuickActions.js';
import { NoteSurface } from './noteSurface.js';
import { escapeAttr, escapeHTML } from './domEscape.js';
import { createEmptyNoteCanvas } from './noteModel.js';
import { hasRichMarkup } from './richText.js';
import { canInlineEditText } from './noteSurfaceEditing.js';
import { applyCardTheme } from './cardTheme.js';
import { resolveNoteColor } from './colorPicker.js';

const BLOCKS = [
    { id: 'text', label: 'Text' },
    { id: 'checklist', label: 'Checklist' },
    { id: 'table', label: 'Table' },
    { id: 'chart', label: 'Chart' },
    { id: 'canvas', label: 'Canvas' }
];

const PRESET_META = [
    { id: 'split2-v', label: 'Halves', hint: 'Left · Right' },
    { id: 'split2-h', label: 'Stack', hint: 'Top · Bottom' },
    { id: 'split3-cols', label: '3 columns', hint: 'Side by side' },
    { id: 'split3-rows', label: '3 rows', hint: 'Stacked' },
    { id: 'split3-1over2', label: '1 over 2', hint: 'Wide top' },
    { id: 'split3-2over1', label: '2 over 1', hint: 'Wide bottom' },
    { id: 'split4-grid', label: 'Quad', hint: '2 × 2' }
];

const BLOCK_ICONS = {
    text: '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false"><path d="M3 4h10M5 4v8M11 4v8M6.5 12h3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    checklist: '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false"><rect x="2.5" y="3" width="3" height="3" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3.2 4.5l.8.8 1.4-1.6M7.5 4.5h6M2.5 8.5h3v3h-3zM7.5 10h6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    table: '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false"><rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2 6h12M2 9.5h12M6 3v10M10 3v10" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
    chart: '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false"><path d="M2.5 13V3M2.5 13h11" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><rect x="4.2" y="7" width="2" height="4.5" rx="0.3" fill="none" stroke="currentColor" stroke-width="1.1"/><rect x="7.2" y="4.5" width="2" height="7" rx="0.3" fill="none" stroke="currentColor" stroke-width="1.1"/><rect x="10.2" y="6" width="2" height="5.5" rx="0.3" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
    canvas: '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false"><path d="M10.5 2.5 13.5 5.5 6 13H3v-3L10.5 2.5z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 4l3 3" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>'
};

const PRESET_ZONE_COUNTS = {
    'split2-v': 2,
    'split2-h': 2,
    'split3-cols': 3,
    'split3-rows': 3,
    'split3-1over2': 3,
    'split3-2over1': 3,
    'split4-grid': 4
};

function defaultRatios(preset) {
    switch (preset) {
        case 'split2-v':
        case 'split2-h':
            return [0.5];
        case 'split3-cols':
        case 'split3-rows':
            return [1 / 3, 2 / 3];
        case 'split3-1over2':
        case 'split3-2over1':
            return [0.45, 0.5];
        case 'split4-grid':
            return [0.5, 0.5];
        default:
            return [0.5];
    }
}

function emptyZones(count) {
    const zones = {};
    for (let i = 0; i < count; i += 1) zones[`z${i}`] = [];
    return zones;
}

function asBlockList(val) {
    if (Array.isArray(val)) {
        return val.filter((id) => BLOCKS.some((b) => b.id === id));
    }
    if (typeof val === 'string' && BLOCKS.some((b) => b.id === val)) return [val];
    return [];
}

function allPlacedBlocks(zones) {
    const seen = new Set();
    Object.values(zones || {}).forEach((val) => {
        asBlockList(val).forEach((id) => seen.add(id));
    });
    return seen;
}

function removeBlockFromZones(zones, blockId) {
    Object.keys(zones || {}).forEach((k) => {
        zones[k] = asBlockList(zones[k]).filter((id) => id !== blockId);
    });
}

export function createDefaultFocus(preset = 'split2-v') {
    const count = PRESET_ZONE_COUNTS[preset] || 2;
    return {
        version: 1,
        preset,
        ratios: defaultRatios(preset),
        zones: emptyZones(count)
    };
}

export function normalizeFocus(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const preset = PRESET_ZONE_COUNTS[raw.preset] ? raw.preset : 'split2-v';
    const count = PRESET_ZONE_COUNTS[preset];
    const ratios = Array.isArray(raw.ratios) && raw.ratios.length
        ? raw.ratios.map((n) => {
            const v = Number(n);
            return Number.isFinite(v) ? Math.min(0.92, Math.max(0.08, v)) : 0.5;
        })
        : defaultRatios(preset);
    const zones = emptyZones(count);
    const seen = new Set();
    if (raw.zones && typeof raw.zones === 'object') {
        for (let i = 0; i < count; i += 1) {
            const key = `z${i}`;
            asBlockList(raw.zones[key]).forEach((id) => {
                if (seen.has(id)) return;
                zones[key].push(id);
                seen.add(id);
            });
        }
    }
    return { version: 1, preset, ratios, zones };
}

export function focusIsConfigured(focus) {
    const n = normalizeFocus(focus);
    if (!n) return false;
    return Object.values(n.zones).some((list) => asBlockList(list).length > 0);
}

function frPair(ratio) {
    const a = Math.max(0.08, Math.min(0.92, ratio));
    return `${a}fr ${1 - a}fr`;
}

function frTriple(r0, r1) {
    const a = Math.max(0.08, Math.min(0.84, r0));
    const b = Math.max(a + 0.08, Math.min(0.92, r1));
    const p0 = a;
    const p1 = b - a;
    const p2 = 1 - b;
    return `${p0}fr ${p1}fr ${p2}fr`;
}

function layoutForFocus(focus) {
    const f = normalizeFocus(focus) || createDefaultFocus();
    const r = f.ratios;
    switch (f.preset) {
        case 'split2-v':
            return {
                columns: frPair(r[0] ?? 0.5),
                rows: '1fr',
                areas: '"z0 z1"',
                splitters: [{ type: 'col', ratioIndex: 0, pos: r[0] ?? 0.5 }]
            };
        case 'split2-h':
            return {
                columns: '1fr',
                rows: frPair(r[0] ?? 0.5),
                areas: '"z0" "z1"',
                splitters: [{ type: 'row', ratioIndex: 0, pos: r[0] ?? 0.5 }]
            };
        case 'split3-cols':
            return {
                columns: frTriple(r[0] ?? 1 / 3, r[1] ?? 2 / 3),
                rows: '1fr',
                areas: '"z0 z1 z2"',
                splitters: [
                    { type: 'col', ratioIndex: 0, pos: r[0] ?? 1 / 3 },
                    { type: 'col', ratioIndex: 1, pos: r[1] ?? 2 / 3 }
                ]
            };
        case 'split3-rows':
            return {
                columns: '1fr',
                rows: frTriple(r[0] ?? 1 / 3, r[1] ?? 2 / 3),
                areas: '"z0" "z1" "z2"',
                splitters: [
                    { type: 'row', ratioIndex: 0, pos: r[0] ?? 1 / 3 },
                    { type: 'row', ratioIndex: 1, pos: r[1] ?? 2 / 3 }
                ]
            };
        case 'split3-1over2':
            return {
                columns: frPair(r[1] ?? 0.5),
                rows: frPair(r[0] ?? 0.45),
                areas: '"z0 z0" "z1 z2"',
                splitters: [
                    { type: 'row', ratioIndex: 0, pos: r[0] ?? 0.45 },
                    { type: 'col', ratioIndex: 1, pos: r[1] ?? 0.5, band: 'bottom' }
                ]
            };
        case 'split3-2over1':
            return {
                columns: frPair(r[1] ?? 0.5),
                rows: frPair(r[0] ?? 0.45),
                areas: '"z0 z1" "z2 z2"',
                splitters: [
                    { type: 'row', ratioIndex: 0, pos: r[0] ?? 0.45 },
                    { type: 'col', ratioIndex: 1, pos: r[1] ?? 0.5, band: 'top' }
                ]
            };
        case 'split4-grid':
        default:
            return {
                columns: frPair(r[0] ?? 0.5),
                rows: frPair(r[1] ?? 0.5),
                areas: '"z0 z1" "z2 z3"',
                splitters: [
                    { type: 'col', ratioIndex: 0, pos: r[0] ?? 0.5 },
                    { type: 'row', ratioIndex: 1, pos: r[1] ?? 0.5 }
                ]
            };
    }
}

function blockLabel(id) {
    return BLOCKS.find((b) => b.id === id)?.label || id || 'Empty';
}

function buildChecklistPaneHtml(item) {
    if (!item.steps) item.steps = [];
    return buildExpandedChecklistHtml(item, true, { richEdit: false });
}

async function buildTablePaneHtml(item) {
    const { normalizePlanner } = await import('./planner.js');
    const { renderPlannerTableHtml } = await import('./plannerUi.js');
    if (!item.planner) return '<p class="magic-focus__empty">No planner table</p>';
    item.planner = normalizePlanner(item.planner) || item.planner;
    return `<div data-note-planner data-focus-table-only="1">${renderPlannerTableHtml(item.planner, { canEdit: true })}</div>`;
}

async function buildChartPaneHtml(item) {
    const { normalizePlanner } = await import('./planner.js');
    const { renderPlannerGanttHtml } = await import('./plannerUi.js');
    if (!item.planner) return '<p class="magic-focus__empty">No planner chart</p>';
    item.planner = normalizePlanner(item.planner) || item.planner;
    // Force chart visible in focus pane
    const planner = { ...item.planner, chartCollapsed: false };
    const { html } = renderPlannerGanttHtml(planner);
    return `<div data-note-planner data-focus-chart-only="1">${html}</div>`;
}

function presetGlyphHtml(presetId) {
    // Stroke-based SVGs using currentColor — survives every theme.
    const icons = {
        'split2-v': `<svg class="magic-focus__preset-glyph" viewBox="0 0 40 28" width="40" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="37" height="25" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M20 2v24" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
        'split2-h': `<svg class="magic-focus__preset-glyph" viewBox="0 0 40 28" width="40" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="37" height="25" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2 14h36" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
        'split3-cols': `<svg class="magic-focus__preset-glyph" viewBox="0 0 40 28" width="40" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="37" height="25" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M14 2v24M26 2v24" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
        'split3-rows': `<svg class="magic-focus__preset-glyph" viewBox="0 0 40 28" width="40" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="37" height="25" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2 10h36M2 18h36" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
        'split3-1over2': `<svg class="magic-focus__preset-glyph" viewBox="0 0 40 28" width="40" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="37" height="25" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2 13h36M20 13v13" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
        'split3-2over1': `<svg class="magic-focus__preset-glyph" viewBox="0 0 40 28" width="40" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="37" height="25" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2 15h36M20 2v13" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
        'split4-grid': `<svg class="magic-focus__preset-glyph" viewBox="0 0 40 28" width="40" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="37" height="25" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M20 2v24M2 14h36" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`
    };
    return icons[presetId] || icons['split2-v'];
}

export const MagicFocus = {
    root: null,
    headerEl: null,
    bodyEl: null,
    activeItemId: null,
    setupDraft: null,
    setupStep: 'layout', // 'layout' | 'assign'
    showingSetup: false,
    expandedPaneId: null,
    drawingHomeParent: null,
    drawingHosted: false,
    _escHandler: null,
    _exitFab: null,
    _ui: null,
    _app: null,

    init(app, ui) {
        this._app = app;
        this._ui = ui;
        this.root = document.getElementById('magic-focus');
        if (!this.root) return;
        this.headerEl = this.root.querySelector('[data-magic-focus-header]');
        this.bodyEl = this.root.querySelector('[data-magic-focus-body]');
        this.root.classList.add('is-hidden');
        this.root.setAttribute('aria-hidden', 'true');
        this._wireExitFab();
    },

    _wireExitFab() {
        this._exitFab = document.getElementById('fab-focus-exit');
        if (!this._exitFab || this._exitFab.dataset.focusExitWired === '1') return;
        this._exitFab.dataset.focusExitWired = '1';
        this._exitFab.innerHTML = CARD_ICONS.focus;
        this._exitFab.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.isOpen()) this.close();
        });
    },

    syncExitFabVisibility({ inDrawing = false } = {}) {
        const fab = this._exitFab || document.getElementById('fab-focus-exit');
        if (!fab) return;
        fab.classList.toggle('is-hidden', inDrawing || !this.isOpen());
    },

    isOpen() {
        return !!this.activeItemId && !this.root?.classList.contains('is-hidden');
    },

    getActiveItemId() {
        return this.activeItemId;
    },

    getLiveItem() {
        if (!this.activeItemId || !this._app?.state?.items) {
            // AppState is not always exposed; fall back via window event or app items
        }
        const items = this._app?.getItems?.() || this._resolveItems();
        return items.find((i) => i.id === this.activeItemId) || null;
    },

    _resolveItems() {
        try {
            return this._app?.constructor === Object ? [] : (window.__magicFocusItems?.() || []);
        } catch {
            return [];
        }
    },

    setItemResolver(fn) {
        this._itemResolver = fn;
    },

    resolveItem() {
        if (typeof this._itemResolver === 'function') {
            return this._itemResolver(this.activeItemId);
        }
        return null;
    },

    async open(item, { forceSetup = false } = {}) {
        if (!item?.id || !this.root) return;
        if (!(item.planner && !item.plannerHidden)) return;

        // Leave drawing workspace if needed
        if (this._app?.stateWorkspaceMode?.() === 'drawing' || this._app?.isDrawingMode?.()) {
            await this._app.exitDrawingForFocus?.();
        }

        this.activeItemId = item.id;
        const live = this.resolveItem() || item;
        const configured = focusIsConfigured(live.focus);

        await this._enterShell();
        this.applyNoteTheme(live);
        this.renderHeader(live);

        if (forceSetup || !configured) {
            this.showingSetup = true;
            this.setupStep = 'layout';
            this.setupDraft = null;
            this.renderSetup(live);
        } else {
            this.showingSetup = false;
            this.setupDraft = null;
            this.setupStep = 'layout';
            await this.renderWork(live);
        }

        this._bindEsc();
    },

    async openSettings() {
        const item = this.resolveItem();
        if (!item) return;
        this.clearExpandedPane();
        this.showingSetup = true;
        const existing = normalizeFocus(item.focus);
        if (existing) {
            this.setupDraft = existing;
            this.setupStep = 'assign';
        } else {
            this.setupDraft = null;
            this.setupStep = 'layout';
        }
        // Tear down hosted drawing before setup
        await this._unhostDrawingBoard();
        this.renderSetup(item);
    },

    async close() {
        await this._unhostDrawingBoard();
        this.activeItemId = null;
        this.setupDraft = null;
        this.setupStep = 'layout';
        this.showingSetup = false;
        this.expandedPaneId = null;
        if (this.bodyEl) this.bodyEl.innerHTML = '';
        if (this.headerEl) this.headerEl.innerHTML = '';
        this.applyNoteTheme(null);
        this.root?.classList.add('is-hidden');
        this.root?.setAttribute('aria-hidden', 'true');
        await this._leaveShell();
        this._unbindEsc();
        this._syncFocusButtons();
        this.syncExitFabVisibility();
    },

    async toggle(item) {
        if (this.isOpen() && this.activeItemId === item?.id) {
            await this.close();
            return;
        }
        await this.open(item);
    },

    async _enterShell() {
        const shell = document.getElementById('workspace-shell');
        const canvas = document.getElementById('app-canvas');
        shell?.setAttribute('data-magic-focus', '');
        canvas?.classList.add('is-hidden');
        this.root.classList.remove('is-hidden');
        this.root.setAttribute('aria-hidden', 'false');
        this._app?.onMagicFocusEnter?.();
        this.syncExitFabVisibility();
    },

    async _leaveShell() {
        const shell = document.getElementById('workspace-shell');
        const canvas = document.getElementById('app-canvas');
        shell?.removeAttribute('data-magic-focus');
        canvas?.classList.remove('is-hidden');
        await this._app?.onMagicFocusLeave?.();
        this.syncExitFabVisibility();
    },

    _bindEsc() {
        this._unbindEsc();
        this._escHandler = (e) => {
            if (e.key !== 'Escape') return;
            if (this.showingSetup) {
                e.preventDefault();
                if (this.setupStep === 'assign' && this.setupDraft) {
                    this.setupStep = 'layout';
                    this.renderSetup(this.resolveItem());
                    return;
                }
                if (focusIsConfigured(this.resolveItem()?.focus)) {
                    this.showingSetup = false;
                    this.renderWork(this.resolveItem());
                    return;
                }
                this.close();
                return;
            }
            if (this.expandedPaneId) {
                e.preventDefault();
                this.clearExpandedPane();
                return;
            }
            e.preventDefault();
            this.close();
        };
        window.addEventListener('keydown', this._escHandler);
    },

    _unbindEsc() {
        if (this._escHandler) {
            window.removeEventListener('keydown', this._escHandler);
            this._escHandler = null;
        }
    },

    applyNoteTheme(item) {
        if (!this.root) return;
        const color = item ? resolveNoteColor(item.backgroundColor) : '';
        applyCardTheme(this.root, color, { paintBackground: true });
    },

    renderHeader(item) {
        if (!this.headerEl) return;
        this.applyNoteTheme(item);
        const actions = buildNoteQuickActionsHtml(item, {
            surface: 'focus',
            isExpanded: true,
            showDrag: false,
            calHidden: !!item.hideFromCalendar,
            poppedOut: false
        });
        const titleHtml = buildNoteTitleHtml(item, true, { richEdit: false });
        this.headerEl.innerHTML = `
            <div class="editor-note-shell magic-focus__note-shell" data-magic-focus-shell>
                <div class="editor-note-topline">
                    <div class="editor-note-header">
                        ${titleHtml}
                    </div>
                    <div class="note-editor-toolbar" data-magic-focus-actions>${actions}</div>
                </div>
            </div>
        `;
        const shell = this.headerEl.querySelector('[data-magic-focus-shell]');
        const actionsRoot = this.headerEl.querySelector('[data-magic-focus-actions]');
        const cardActions = actionsRoot?.querySelector('.card-actions');
        if (cardActions) {
            const focusBtn = cardActions.querySelector('.card-act--focus');
            const cog = document.createElement('button');
            cog.type = 'button';
            cog.className = 'card-act card-act--focus-settings';
            cog.title = 'Focus layout settings';
            cog.setAttribute('aria-label', 'Focus layout settings');
            cog.innerHTML = CARD_ICONS.focusSettings;
            if (focusBtn) focusBtn.insertAdjacentElement('afterend', cog);
            else cardActions.prepend(cog);

            cog.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openSettings();
            });
        }

        if (shell) {
            NoteSurface.bindNoteEditorShell(shell, item, {
                richEdit: false,
                localOnly: false,
                stopMousedownPropagation: true,
                onChange: () => {}
            });
        }

        bindNoteQuickActions(actionsRoot, item, {
            surface: 'focus',
            ui: this._ui,
            editor: {
                syncActiveItemFromDom: () => {
                    const live = this.resolveItem() || item;
                    if (shell) NoteSurface.syncItemBodyFromDom(shell, live);
                    this.bodyEl?.querySelectorAll?.('.magic-focus__pane-body.editor-note-body').forEach((body) => {
                        NoteSurface.syncItemBodyFromDom(body, live);
                    });
                },
                openColorPicker: () => {},
                openEmojiPicker: () => {},
                markInteracted: () => {},
                triggerAutoSave: () => {},
                collectFormData: () => this.resolveItem() || item,
                persistNote: () => {},
                close: () => this.close(),
                applySharedFromLive: () => {},
                applyNoteTheme: () => {
                    this.applyNoteTheme(this.resolveItem() || item);
                }
            }
        });
    },

    renderSetup(item) {
        if (!this.bodyEl) return;
        if (this.setupStep === 'assign' && this.setupDraft) {
            this._renderAssignStep(item);
        } else {
            this._renderLayoutStep(item);
        }
    },

    _renderLayoutStep(item) {
        const selected = this.setupDraft?.preset || null;
        const presetsHtml = PRESET_META.map((p) => `
            <button type="button" class="magic-focus__preset${p.id === selected ? ' is-active' : ''}" data-focus-preset="${p.id}" title="${escapeAttr(p.label)}" aria-label="${escapeAttr(p.label)}">
                ${presetGlyphHtml(p.id)}
            </button>
        `).join('');

        this.bodyEl.innerHTML = `
            <div class="magic-focus__setup magic-focus__setup--layout">
                <div class="magic-focus__setup-hero">
                    <h2 class="magic-focus__setup-heading">Layout</h2>
                </div>
                <div class="magic-focus__presets" role="listbox" aria-label="Layout">${presetsHtml}</div>
                <div class="magic-focus__setup-actions">
                    <button type="button" class="btn btn--compact" data-focus-setup-reset>Reset</button>
                    <button type="button" class="btn btn--compact" data-focus-setup-cancel>Cancel</button>
                </div>
            </div>
        `;
        this._bindLayoutStepEvents(item);
    },

    _renderAssignStep(item) {
        const draft = this.setupDraft;
        if (!draft) {
            this.setupStep = 'layout';
            this._renderLayoutStep(item);
            return;
        }
        const count = PRESET_ZONE_COUNTS[draft.preset] || 2;
        const placed = allPlacedBlocks(draft.zones);
        const layout = layoutForFocus(draft);

        const paletteHtml = BLOCKS.map((b) => `
            <div class="magic-focus__tile${placed.has(b.id) ? ' is-placed' : ''}"
                 draggable="${placed.has(b.id) ? 'false' : 'true'}"
                 data-focus-tile="${b.id}"
                 title="${escapeAttr(b.label)}">
                <span class="magic-focus__tile-icon" aria-hidden="true">${BLOCK_ICONS[b.id] || ''}</span>
                <span class="magic-focus__tile-label">${escapeHTML(b.label)}</span>
            </div>
        `).join('');

        const zoneSlots = [];
        for (let i = 0; i < count; i += 1) {
            const zid = `z${i}`;
            const blocks = asBlockList(draft.zones[zid]);
            const tiles = blocks.map((block) => `
                <div class="magic-focus__tile magic-focus__tile--in-zone" draggable="true" data-focus-tile="${block}" data-from-zone="${zid}">
                    <span class="magic-focus__tile-icon" aria-hidden="true">${BLOCK_ICONS[block] || ''}</span>
                    <span class="magic-focus__tile-label">${escapeHTML(blockLabel(block))}</span>
                </div>
            `).join('');
            zoneSlots.push(`
                <div class="magic-focus__zone-slot${blocks.length ? ' has-block' : ''}" data-focus-zone="${zid}" style="grid-area:${zid}">
                    ${blocks.length
                        ? tiles
                        : `<span class="magic-focus__zone-placeholder">${escapeHTML(String.fromCharCode(65 + i))}</span>`}
                </div>
            `);
        }

        this.bodyEl.innerHTML = `
            <div class="magic-focus__setup magic-focus__setup--assign">
                <div class="magic-focus__assign-chrome">
                    <div class="magic-focus__palette magic-focus__palette--row" data-focus-palette aria-label="Blocks">
                        ${paletteHtml}
                    </div>
                    <div class="magic-focus__assign-tools">
                        <button type="button" class="btn btn--compact magic-focus__change-layout" data-focus-change-layout title="Change layout" aria-label="Change layout">
                            ${presetGlyphHtml(draft.preset)}
                        </button>
                        <button type="button" class="btn btn--compact" data-focus-setup-reset>Reset</button>
                        <button type="button" class="btn btn--compact" data-focus-setup-back>Back</button>
                        <button type="button" class="btn btn--compact" data-focus-setup-cancel>Cancel</button>
                        <button type="button" class="btn btn--compact magic-focus__btn-apply" data-focus-setup-apply>Apply</button>
                    </div>
                </div>
                <div class="magic-focus__layout-preview" data-focus-zones>
                    ${zoneSlots.join('')}
                </div>
            </div>
        `;
        const preview = this.bodyEl.querySelector('[data-focus-zones]');
        if (preview) {
            preview.style.gridTemplateColumns = layout.columns;
            preview.style.gridTemplateRows = layout.rows;
            preview.style.gridTemplateAreas = layout.areas;
        }
        this._bindAssignStepEvents(item);
    },

    _resetFocusConfig(item) {
        NoteSurface.mutateItem(item, (it) => {
            it.focus = null;
        }, { preserveView: true, skipRerender: true });
        this.setupDraft = null;
        this.setupStep = 'layout';
        this.renderSetup(this.resolveItem() || item);
    },

    _bindLayoutStepEvents(item) {
        const root = this.bodyEl;
        root.querySelectorAll('[data-focus-preset]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const preset = btn.getAttribute('data-focus-preset');
                const prevZones = this.setupDraft?.zones || {};
                const next = createDefaultFocus(preset);
                const seen = new Set();
                for (let i = 0; i < PRESET_ZONE_COUNTS[preset]; i += 1) {
                    const key = `z${i}`;
                    asBlockList(prevZones[key]).forEach((id) => {
                        if (seen.has(id)) return;
                        next.zones[key].push(id);
                        seen.add(id);
                    });
                }
                this.setupDraft = next;
                this.setupStep = 'assign';
                this.renderSetup(item);
            });
        });

        root.querySelector('[data-focus-setup-reset]')?.addEventListener('click', () => {
            this._resetFocusConfig(item);
        });

        root.querySelector('[data-focus-setup-cancel]')?.addEventListener('click', async () => {
            if (focusIsConfigured(item.focus)) {
                this.showingSetup = false;
                await this.renderWork(item);
            } else {
                await this.close();
            }
        });
    },

    _bindAssignStepEvents(item) {
        const root = this.bodyEl;

        root.querySelector('[data-focus-change-layout]')?.addEventListener('click', () => {
            this.setupStep = 'layout';
            this.renderSetup(item);
        });
        root.querySelector('[data-focus-setup-back]')?.addEventListener('click', () => {
            this.setupStep = 'layout';
            this.renderSetup(item);
        });
        root.querySelector('[data-focus-setup-reset]')?.addEventListener('click', () => {
            this._resetFocusConfig(item);
        });

        let dragTile = null;

        root.querySelectorAll('[data-focus-tile]').forEach((tile) => {
            tile.addEventListener('dragstart', (e) => {
                if (tile.classList.contains('is-placed')) {
                    e.preventDefault();
                    return;
                }
                dragTile = tile.getAttribute('data-focus-tile');
                tile.classList.add('is-dragging');
                e.dataTransfer?.setData('text/plain', dragTile);
                e.dataTransfer.effectAllowed = 'move';
            });
            tile.addEventListener('dragend', () => {
                tile.classList.remove('is-dragging');
                dragTile = null;
            });
        });

        const assignToZone = (zoneId, blockId) => {
            if (!this.setupDraft || !blockId) return;
            removeBlockFromZones(this.setupDraft.zones, blockId);
            const list = asBlockList(this.setupDraft.zones[zoneId]);
            list.push(blockId);
            this.setupDraft.zones[zoneId] = list;
            this.renderSetup(item);
        };

        root.querySelectorAll('[data-focus-zone]').forEach((slot) => {
            slot.addEventListener('dragover', (e) => {
                e.preventDefault();
                slot.classList.add('is-dragover');
            });
            slot.addEventListener('dragleave', () => slot.classList.remove('is-dragover'));
            slot.addEventListener('drop', (e) => {
                e.preventDefault();
                slot.classList.remove('is-dragover');
                const blockId = dragTile || e.dataTransfer?.getData('text/plain');
                assignToZone(slot.getAttribute('data-focus-zone'), blockId);
            });
            slot.addEventListener('dblclick', (e) => {
                // Double-click a tile to remove it; empty zone click clears nothing useful
                const tile = e.target.closest?.('[data-focus-tile][data-from-zone]');
                if (tile && this.setupDraft) {
                    removeBlockFromZones(this.setupDraft.zones, tile.getAttribute('data-focus-tile'));
                    this.renderSetup(item);
                }
            });
        });

        const palette = root.querySelector('[data-focus-palette]');
        palette?.addEventListener('dragover', (e) => e.preventDefault());
        palette?.addEventListener('drop', (e) => {
            e.preventDefault();
            const blockId = dragTile || e.dataTransfer?.getData('text/plain');
            if (!blockId || !this.setupDraft) return;
            removeBlockFromZones(this.setupDraft.zones, blockId);
            this.renderSetup(item);
        });

        root.querySelector('[data-focus-setup-cancel]')?.addEventListener('click', async () => {
            if (focusIsConfigured(item.focus)) {
                this.showingSetup = false;
                await this.renderWork(item);
            } else {
                await this.close();
            }
        });

        root.querySelector('[data-focus-setup-apply]')?.addEventListener('click', async () => {
            const draft = normalizeFocus(this.setupDraft);
            NoteSurface.mutateItem(item, (it) => {
                it.focus = draft;
            }, { preserveView: true, skipRerender: true });
            this.showingSetup = false;
            this.setupDraft = null;
            this.setupStep = 'layout';
            await this.renderWork(this.resolveItem() || item);
        });
    },

    async renderWork(item) {
        if (!this.bodyEl || !item) return;
        this.expandedPaneId = null;
        await this._unhostDrawingBoard();
        const focus = normalizeFocus(item.focus) || createDefaultFocus();
        const layout = layoutForFocus(focus);
        const count = PRESET_ZONE_COUNTS[focus.preset] || 2;

        const panes = [];
        for (let i = 0; i < count; i += 1) {
            const zid = `z${i}`;
            const blocks = asBlockList(focus.zones[zid]);
            const empty = blocks.length === 0;
            const hasCanvas = blocks.includes('canvas');
            panes.push(`
                <section class="magic-focus__pane${empty ? ' magic-focus__pane--empty' : ''}${hasCanvas ? ' magic-focus__pane--canvas' : ''}" data-focus-pane="${zid}" style="grid-area:${zid}">
                    <button type="button" class="card-act magic-focus__pane-expand" data-focus-pane-expand
                        title="Expand pane" aria-label="Expand pane" aria-pressed="false">${CARD_ICONS.expandMedia}</button>
                    <div class="magic-focus__pane-body editor-note-body" data-focus-pane-body="${zid}"></div>
                </section>
            `);
        }

        this.bodyEl.innerHTML = `
            <div class="magic-focus__work" data-magic-focus-work>
                ${panes.join('')}
            </div>
        `;
        const workEl = this.bodyEl.querySelector('[data-magic-focus-work]');
        if (workEl) {
            workEl.style.gridTemplateColumns = layout.columns;
            workEl.style.gridTemplateRows = layout.rows;
            workEl.style.gridTemplateAreas = layout.areas;
        }

        for (let i = 0; i < count; i += 1) {
            const zid = `z${i}`;
            const blocks = asBlockList(focus.zones[zid]);
            const body = this.bodyEl.querySelector(`[data-focus-pane-body="${zid}"]`);
            if (!body) continue;
            if (!blocks.length) {
                body.innerHTML = `<div class="magic-focus__pane-empty-msg">Empty</div>`;
                continue;
            }
            await this._fillPane(body, item, blocks, zid);
        }

        this._mountSplitters(focus, layout);
        this._bindPaneExpandControls();
        this.renderHeader(item);
    },

    _bindPaneExpandControls() {
        const work = this.bodyEl?.querySelector('[data-magic-focus-work]');
        if (!work) return;
        work.querySelectorAll('[data-focus-pane-expand]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const pane = btn.closest('[data-focus-pane]');
                const zid = pane?.getAttribute('data-focus-pane');
                if (!zid) return;
                if (this.expandedPaneId === zid) this.clearExpandedPane();
                else this.setExpandedPane(zid);
            });
        });
    },

    setExpandedPane(zoneId) {
        const work = this.bodyEl?.querySelector('[data-magic-focus-work]');
        if (!work || !zoneId) return;
        this.expandedPaneId = zoneId;
        work.classList.add('is-pane-expanded');
        work.querySelectorAll('[data-focus-pane]').forEach((pane) => {
            const id = pane.getAttribute('data-focus-pane');
            pane.classList.toggle('is-expanded', id === zoneId);
        });
        this._syncPaneExpandButtons();
        this._refitHostedCanvas();
    },

    clearExpandedPane() {
        const work = this.bodyEl?.querySelector('[data-magic-focus-work]');
        this.expandedPaneId = null;
        if (work) {
            work.classList.remove('is-pane-expanded');
            work.querySelectorAll('[data-focus-pane].is-expanded').forEach((pane) => {
                pane.classList.remove('is-expanded');
            });
        }
        this._syncPaneExpandButtons();
        this._refitHostedCanvas();
    },

    _syncPaneExpandButtons() {
        const work = this.bodyEl?.querySelector('[data-magic-focus-work]');
        if (!work) return;
        work.querySelectorAll('[data-focus-pane]').forEach((pane) => {
            const btn = pane.querySelector('[data-focus-pane-expand]');
            if (!btn) return;
            const zid = pane.getAttribute('data-focus-pane');
            const expanded = this.expandedPaneId === zid;
            btn.innerHTML = expanded ? CARD_ICONS.collapseMedia : CARD_ICONS.expandMedia;
            const label = expanded ? 'Restore pane' : 'Expand pane';
            btn.title = label;
            btn.setAttribute('aria-label', label);
            btn.setAttribute('aria-pressed', expanded ? 'true' : 'false');
        });
    },

    _refitHostedCanvas() {
        if (!this.drawingHosted) return;
        import('./drawingBoard.js').then(({ DrawingBoard }) => {
            if (DrawingBoard.active) DrawingBoard.resize?.();
        }).catch(() => {});
    },

    async _blockHtml(item, block, zoneId) {
        if (block === 'text') {
            const content = item.content || '';
            const rich = hasRichMarkup(content);
            const textCollapsed = !!item.textCollapsed;
            const field = canInlineEditText(content, { richEdit: false })
                ? `<div class="card-content-preview card-inline-edit" contenteditable="plaintext-only" spellcheck="false" data-field="content" data-placeholder="Add note…">${escapeHTML(content.replace(/\u2028/g, '\n'))}</div>`
                : `<div class="card-content-preview${rich ? ' rich-text' : ''}">${renderRichHtml(content)}</div>`;
            return `<div class="planner-sub" data-note-text data-text-collapsed="${textCollapsed ? '1' : '0'}">
                <div class="planner-sub__toolbar">
                    <button type="button" class="planner-sub__title" data-note-text-toggle aria-expanded="${textCollapsed ? 'false' : 'true'}">
                        <span class="collapsable-toggle${textCollapsed ? ' collapsed' : ''}" aria-hidden="true">▼</span>Text
                    </button>
                </div>
                <div class="planner-sub__body${textCollapsed ? ' is-collapsed' : ''}" data-note-text-body>${field}</div>
            </div>`;
        }
        if (block === 'checklist') {
            const checklistCollapsed = !!item.checklistCollapsed;
            if (!item.steps) item.steps = [];
            return `<div class="planner-sub" data-note-checklist-sub data-checklist-collapsed="${checklistCollapsed ? '1' : '0'}">
                <div class="planner-sub__toolbar">
                    <button type="button" class="planner-sub__title" data-note-checklist-toggle aria-expanded="${checklistCollapsed ? 'false' : 'true'}">
                        <span class="collapsable-toggle${checklistCollapsed ? ' collapsed' : ''}" aria-hidden="true">▼</span>Checklist
                    </button>
                </div>
                <div class="planner-sub__body${checklistCollapsed ? ' is-collapsed' : ''}" data-note-checklist-body>
                    ${buildChecklistPaneHtml(item)}
                </div>
            </div>`;
        }
        if (block === 'table') return buildTablePaneHtml(item);
        if (block === 'chart') return buildChartPaneHtml(item);
        if (block === 'canvas') {
            if (!item.canvas) {
                NoteSurface.mutateItem(item, (it) => {
                    it.canvas = createEmptyNoteCanvas();
                    it.canvasHidden = false;
                }, { preserveView: true, skipRerender: true });
            }
            return `<div class="planner-sub magic-focus__canvas-sub" data-focus-canvas-sub>
                <div class="planner-sub__toolbar">
                    <button type="button" class="planner-sub__title" data-focus-canvas-toggle aria-expanded="true">
                        <span class="collapsable-toggle" aria-hidden="true">▼</span>Canvas
                    </button>
                </div>
                <div class="planner-sub__body" data-focus-canvas-body>
                    <div class="magic-focus__canvas-host" data-focus-canvas-host="${escapeAttr(zoneId)}"></div>
                </div>
            </div>`;
        }
        return '';
    },

    async _fillPane(body, item, blocks, zoneId) {
        const list = Array.isArray(blocks) ? blocks : asBlockList(blocks);
        const parts = [];
        for (const block of list) {
            parts.push(await this._blockHtml(item, block, zoneId));
        }
        body.innerHTML = parts.join('');
        this._bindPaneInteractions(body, item);

        const canvasHost = body.querySelector('[data-focus-canvas-host]');
        if (canvasHost) {
            await this._hostDrawingBoard(canvasHost, item);
            const toggle = body.querySelector('[data-focus-canvas-toggle]');
            toggle?.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const sub = body.querySelector('[data-focus-canvas-sub]');
                const subBody = sub?.querySelector('[data-focus-canvas-body]');
                const chevron = toggle.querySelector('.collapsable-toggle');
                const collapsed = subBody?.classList.toggle('is-collapsed');
                chevron?.classList.toggle('collapsed', !!collapsed);
                toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            });
        }
    },

    _bindPaneInteractions(body, item) {
        const { bindNoteEditorShell } = NoteSurface;
        const pane = body.closest('.magic-focus__pane');
        if (!pane) return;
        if (!pane.classList.contains('editor-note-shell')) {
            pane.classList.add('editor-note-shell');
        }
        try {
            bindNoteEditorShell(pane, item, {
                richEdit: false,
                localOnly: false,
                stopMousedownPropagation: true,
                onChange: () => {}
            });
        } catch { /* ignore */ }

        // Each table/chart block is its own [data-note-planner] — bind every one.
        import('./plannerUi.js').then(({ attachPlannerInteractions }) => {
            body.querySelectorAll('[data-note-planner]').forEach((sec) => {
                attachPlannerInteractions(sec, item, {
                    localOnly: false,
                    onChange: () => {},
                    refresh: () => {
                        this.refreshPlannerPanes?.(item);
                    }
                });
            });
        }).catch(() => {});
    },

    _mountSplitters(focus, layout) {
        const work = this.bodyEl?.querySelector('[data-magic-focus-work]');
        if (!work) return;
        work.querySelectorAll('.magic-focus__splitter').forEach((el) => el.remove());

        (layout.splitters || []).forEach((split) => {
            const el = document.createElement('div');
            el.className = `magic-focus__splitter magic-focus__splitter--${split.type}`;
            el.dataset.ratioIndex = String(split.ratioIndex);
            this._positionSplitter(el, split, work, focus);
            work.appendChild(el);
            this._bindSplitterDrag(el, split, focus, work);
        });
    },

    _positionSplitter(el, split, work, focus = null) {
        const rect = work.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        if (split.type === 'col') {
            el.style.left = `${split.pos * 100}%`;
            el.style.right = '';
            if (split.band === 'bottom') {
                const rowPos = focus?.ratios?.[0] ?? 0.45;
                el.style.top = `${rowPos * 100}%`;
                el.style.bottom = '0';
            } else if (split.band === 'top') {
                const rowPos = focus?.ratios?.[0] ?? 0.45;
                el.style.top = '0';
                el.style.bottom = `${(1 - rowPos) * 100}%`;
            } else {
                el.style.top = '0';
                el.style.bottom = '0';
            }
        } else {
            el.style.top = `${split.pos * 100}%`;
            el.style.left = '0';
            el.style.right = '0';
            el.style.bottom = '';
        }
    },

    _bindSplitterDrag(el, split, focus, work) {
        el.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            el.classList.add('is-dragging');
            el.setPointerCapture?.(e.pointerId);
            const rect = work.getBoundingClientRect();
            // Only couple dual ratios when both splitters share an axis (3-col / 3-row).
            const sameAxisOrdered = focus.preset === 'split3-cols' || focus.preset === 'split3-rows';

            const onMove = (ev) => {
                let pos;
                if (split.type === 'col') {
                    pos = (ev.clientX - rect.left) / rect.width;
                } else {
                    pos = (ev.clientY - rect.top) / rect.height;
                }
                pos = Math.min(0.92, Math.max(0.08, pos));
                const ratios = [...(focus.ratios || defaultRatios(focus.preset))];
                ratios[split.ratioIndex] = pos;
                if (sameAxisOrdered && ratios.length >= 2) {
                    if (split.ratioIndex === 0 && ratios[1] != null) {
                        ratios[0] = Math.min(pos, (ratios[1] || 0.66) - 0.08);
                    }
                    if (split.ratioIndex === 1 && ratios[0] != null) {
                        ratios[1] = Math.max(pos, (ratios[0] || 0.33) + 0.08);
                    }
                }
                focus.ratios = ratios;
                const layout = layoutForFocus(focus);
                work.style.gridTemplateColumns = layout.columns;
                work.style.gridTemplateRows = layout.rows;
                split.pos = ratios[split.ratioIndex];
                this._positionSplitter(el, { ...split, pos: ratios[split.ratioIndex] }, work, focus);
                work.querySelectorAll('.magic-focus__splitter').forEach((sib) => {
                    if (sib === el) return;
                    const idx = Number(sib.dataset.ratioIndex);
                    const sibSplit = layout.splitters.find((s) => s.ratioIndex === idx);
                    if (sibSplit) this._positionSplitter(sib, sibSplit, work, focus);
                });
            };

            const onUp = () => {
                el.classList.remove('is-dragging');
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                const item = this.resolveItem();
                if (!item) return;
                NoteSurface.mutateItem(item, (it) => {
                    if (!it.focus) it.focus = createDefaultFocus(focus.preset);
                    it.focus = normalizeFocus({ ...it.focus, ratios: focus.ratios, preset: focus.preset, zones: focus.zones });
                }, { preserveView: true, skipRerender: true });
                import('./drawingBoard.js').then(({ DrawingBoard }) => {
                    if (DrawingBoard.active) DrawingBoard.resize?.();
                }).catch(() => {});
            };

            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });
    },

    async _hostDrawingBoard(hostEl, item) {
        const board = document.getElementById('drawing-board');
        if (!board || !hostEl) return;
        const { DrawingBoard } = await import('./drawingBoard.js');
        const { DrawingToolbarChrome } = await import('./drawingToolbarChrome.js');

        if (!this.drawingHomeParent) {
            this.drawingHomeParent = board.parentElement;
        }
        hostEl.appendChild(board);
        board.classList.add('magic-focus-canvas-board');
        board.classList.remove('is-hidden');
        board.setAttribute('aria-hidden', 'false');
        this.drawingHosted = true;

        DrawingToolbarChrome.setHostBounds?.(board, {
            storageKey: 'matrix_focus_drawing_toolbar',
            defaultCollapsed: true
        });

        // Activate note canvas without leaving focus / setting data-drawing-mode
        await DrawingBoard.activateForNote(item);
        // Force collapsed toolbar for focus default
        if (!DrawingToolbarChrome.collapsed) {
            DrawingToolbarChrome.collapse?.();
        }
    },

    async _unhostDrawingBoard() {
        if (!this.drawingHosted) return;
        const board = document.getElementById('drawing-board');
        const { DrawingBoard } = await import('./drawingBoard.js');
        const { DrawingToolbarChrome } = await import('./drawingToolbarChrome.js');

        if (DrawingBoard.active || DrawingBoard.isNoteCanvasMode || DrawingBoard.docOwner) {
            await DrawingBoard.deactivate();
        }

        DrawingToolbarChrome.clearHostBounds?.();

        if (board && this.drawingHomeParent) {
            board.classList.remove('magic-focus-canvas-board');
            board.classList.add('is-hidden');
            board.setAttribute('aria-hidden', 'true');
            this.drawingHomeParent.appendChild(board);
        }
        this.drawingHosted = false;
    },

    _syncFocusButtons() {
        document.querySelectorAll('.card-act--focus').forEach((btn) => {
            const id = btn.getAttribute('data-note-id');
            const active = this.isOpen() && id === this.activeItemId;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    },

    /** Bodies hosted in focus panes — for planner/canvas sync. */
    noteBodiesForItem(itemId) {
        if (!this.isOpen() || itemId !== this.activeItemId || !this.bodyEl) return [];
        return Array.from(this.bodyEl.querySelectorAll('.magic-focus__pane-body.editor-note-body'));
    },

    async refreshPlannerPanes(item) {
        if (!this.isOpen() || !item || this.showingSetup) return;
        const focus = normalizeFocus(item.focus);
        if (!focus) return;
        const count = PRESET_ZONE_COUNTS[focus.preset] || 2;
        for (let i = 0; i < count; i += 1) {
            const zid = `z${i}`;
            const blocks = asBlockList(focus.zones[zid]);
            if (!blocks.includes('table') && !blocks.includes('chart')) continue;
            const body = this.bodyEl.querySelector(`[data-focus-pane-body="${zid}"]`);
            if (!body) continue;
            await this._fillPane(body, item, blocks, zid);
        }
    }
};
