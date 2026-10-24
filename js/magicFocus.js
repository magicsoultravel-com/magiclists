/** @module {"owns":"magic focus workspace mode — split panes, setup DnD, planner block hosting (table/chart/kanban/wbs)", "related":["app.js","noteQuickActions.js","drawingBoard.js","plannerUi.js","noteSurface.js"]} */

import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { buildNoteQuickActionsHtml, buildNoteTitleHtml, buildNoteContentFieldHtml } from './noteSurfaceHtml.js';
import { bindNoteQuickActions } from './noteQuickActions.js';
import { NoteSurface, clearDesktopAutoSaveTimer, flushDesktopAutoSave } from './noteSurface.js';
import { escapeAttr } from './domEscape.js';
import { createEmptyNoteCanvas } from './noteModel.js';
import { focusInlineEdit } from './noteSurfaceEditing.js';
import { applyCardTheme } from './cardTheme.js';
import { resolveNoteColor } from './colorPicker.js';
import { Editor } from './editor.js';
import {
    isUiTransitionsEnabled,
    morphElements,
    setChromeVisible,
    UI_TRANSITION_MS
} from './uiTransitions.js';
import { PRESET_ZONE_COUNTS, FOCUS_ZOOM_MIN, FOCUS_ZOOM_MAX, FOCUS_ZOOM_STEP, FOCUS_ZOOM_DEFAULT, clampFocusZoom, defaultRatios, asBlockList, createDefaultFocus, normalizeFocus, focusIsConfigured } from './magicFocus/model.js';
import { layoutForFocus } from './magicFocus/layout.js';
import { buildChecklistPaneHtml, buildTablePaneHtml, buildChartPaneHtml, buildKanbanPaneHtml, buildWbsPaneHtml, buildMediaPaneHtml } from './magicFocus/paneMarkup.js';
import * as SetupSession from './magicFocus/setup.js';
export { createDefaultFocus, normalizeFocus, focusIsConfigured };

const MORPH_CLASS = 'ui-morph-hidden';
const FOCUS_MORPH_BODY = 'is-focus-morphing';

function forceReflow(el) {
    void el?.offsetWidth;
}

function boardChromeEls() {
    return [
        document.getElementById('fab-create'),
        document.getElementById('desktop-dock'),
        document.getElementById('app-canvas'),
        document.getElementById('file-cabinet'),
        document.getElementById('shell-splitter-h'),
        document.getElementById('file-cabinet-toggle-fab')
    ].filter(Boolean);
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
    /** @type {string[]|null} Ephemeral single-pane spawn; does not mutate item.focus */
    sessionSpawnBlocks: null,
    sessionSpawnZoom: FOCUS_ZOOM_DEFAULT,
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

    syncExitFabVisibility({ inDrawing = false, instant = false } = {}) {
        const fab = this._exitFab || document.getElementById('fab-focus-exit');
        if (!fab) return;
        const visible = !inDrawing && this.isOpen();
        if (isUiTransitionsEnabled() && !instant) {
            setChromeVisible(fab, visible);
            return;
        }
        fab.classList.toggle('is-hidden', !visible);
        fab.classList.remove(MORPH_CLASS);
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

        // Mutex: same note cannot be edited in modal and Focus at once.
        const modalOpen = Editor.activeItem?.id === item.id
            && Editor.overlay
            && !Editor.overlay.classList.contains('is-hidden');
        if (modalOpen) {
            Editor.persistNote({ force: true, normalize: true });
            Editor.close();
        }

        this._clearSessionSpawn();
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
        this._syncFocusButtons();
    },

    /**
     * Open Focus with an ephemeral single expanded pane for the given blocks.
     * Does not rewrite saved item.focus zones/preset/ratios.
     * @param {object} item
     * @param {string|string[]} blocks
     */
    async openExpandedBlocks(item, blocks) {
        if (!item?.id || !this.root) return;
        const list = asBlockList(blocks);
        if (!list.length) return;

        if (this._app?.stateWorkspaceMode?.() === 'drawing' || this._app?.isDrawingMode?.()) {
            await this._app.exitDrawingForFocus?.();
        }

        const modalOpen = Editor.activeItem?.id === item.id
            && Editor.overlay
            && !Editor.overlay.classList.contains('is-hidden');
        if (modalOpen) {
            Editor.persistNote({ force: true, normalize: true });
            Editor.close();
        }

        const alreadyOpenForItem = this.isOpen() && this.activeItemId === item.id;
        this.activeItemId = item.id;
        this.sessionSpawnBlocks = list;
        this.sessionSpawnZoom = FOCUS_ZOOM_DEFAULT;
        this.showingSetup = false;
        this.setupDraft = null;
        this.setupStep = 'layout';
        this.expandedPaneId = null;

        const live = this.resolveItem() || item;
        if (!alreadyOpenForItem) {
            await this._enterShell();
        }
        this.applyNoteTheme(live);
        await this.renderWork(live);
        this._bindEsc();
        this._syncFocusButtons();
    },

    _clearSessionSpawn() {
        this.sessionSpawnBlocks = null;
        this.sessionSpawnZoom = FOCUS_ZOOM_DEFAULT;
    },

    async openSettings() {
        const item = this.resolveItem();
        if (!item) return;
        this._clearSessionSpawn();
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

    /**
     * Flush Focus header + pane shells into the shared item (final write).
     * Clears the desktop autosave timer via flushDesktopAutoSave.
     */
    flushPendingEdits() {
        if (!this.activeItemId || !this.root || this.root.classList.contains('is-hidden')) return;
        const item = this.resolveItem();
        if (!item) return;
        const shells = [];
        const headerShell = this.headerEl?.querySelector?.('[data-magic-focus-shell]');
        if (headerShell) shells.push(headerShell);
        this.bodyEl?.querySelectorAll?.('.magic-focus__pane.editor-note-shell').forEach((pane) => {
            shells.push(pane);
        });
        // Deduplicate if header somehow nested (should not happen).
        const seen = new Set();
        for (const shell of shells) {
            if (!shell || seen.has(shell)) continue;
            seen.add(shell);
            flushDesktopAutoSave(shell, item, { mergeWindow: false });
        }
    },

    async close() {
        this.flushPendingEdits();
        // Release host ownership synchronously so modal open / busy guards /
        // skip lists see Focus as closed without awaiting unhost/teardown.
        const wasOpen = this.isOpen();
        this.activeItemId = null;
        this.setupDraft = null;
        this.setupStep = 'layout';
        this.showingSetup = false;
        this.expandedPaneId = null;
        this._clearSessionSpawn();

        const useMorph = wasOpen && isUiTransitionsEnabled() && this.root;
        const focusRoot = this.root;
        const exitFab = this._exitFab || document.getElementById('fab-focus-exit');
        const canvas = document.getElementById('app-canvas');
        const fab = document.getElementById('fab-create');
        const dock = document.getElementById('desktop-dock');
        const shell = document.getElementById('workspace-shell');

        if (useMorph) {
            document.body.classList.add(FOCUS_MORPH_BODY);
            // 1) Fade out focus chrome
            [focusRoot, exitFab].filter(Boolean).forEach((el) => {
                el.classList.remove(MORPH_CLASS);
                forceReflow(el);
                el.classList.add(MORPH_CLASS);
            });
            await new Promise((r) => window.setTimeout(r, UI_TRANSITION_MS));

            // 2) Teardown while returning board chrome stays opacity 0
            const returning = [
                canvas,
                fab,
                dock,
                document.getElementById('file-cabinet'),
                document.getElementById('shell-splitter-h'),
                document.getElementById('file-cabinet-toggle-fab')
            ].filter(Boolean);
            // Pre-arm opacity 0 before clearing data-magic-focus (avoids FC/canvas pop).
            returning.forEach((el) => el.classList.add(MORPH_CLASS));

            focusRoot.classList.add('is-hidden');
            focusRoot.setAttribute('aria-hidden', 'true');
            shell?.removeAttribute('data-magic-focus');
            await this._unhostDrawingBoard();
            if (this.bodyEl) this.bodyEl.innerHTML = '';
            if (this.headerEl) this.headerEl.innerHTML = '';
            this.applyNoteTheme(null);

            returning.forEach((el) => {
                el.classList.remove('is-hidden');
                el.classList.remove('is-suppressed');
            });
            canvas?.classList.remove('is-hidden');

            await this._app?.onMagicFocusLeave?.({ deferChrome: true });

            // 3) Fade canvas + chrome in together
            forceReflow(canvas || document.body);
            returning.forEach((el) => el.classList.remove(MORPH_CLASS));
            await new Promise((r) => window.setTimeout(r, UI_TRANSITION_MS));

            document.body.classList.remove(FOCUS_MORPH_BODY);
            focusRoot.classList.remove(MORPH_CLASS);
            exitFab?.classList.remove(MORPH_CLASS);
            this._app?.updateFabVisibility?.({ instant: true });
            this._app?.applyDesktopDockAfterFocusLeave?.();
            this._unbindEsc();
            this._syncFocusButtons();
            this.syncExitFabVisibility({ instant: true });
            return;
        }

        this.root?.classList.add('is-hidden');
        this.root?.setAttribute('aria-hidden', 'true');
        shell?.removeAttribute('data-magic-focus');
        await this._unhostDrawingBoard();
        if (this.bodyEl) this.bodyEl.innerHTML = '';
        if (this.headerEl) this.headerEl.innerHTML = '';
        this.applyNoteTheme(null);
        await this._leaveShell();
        this._unbindEsc();
        this._syncFocusButtons();
        this.syncExitFabVisibility({ instant: true });
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
        const exitFab = this._exitFab || document.getElementById('fab-focus-exit');

        if (!isUiTransitionsEnabled()) {
            shell?.setAttribute('data-magic-focus', '');
            canvas?.classList.add('is-hidden');
            this.root.classList.remove('is-hidden');
            this.root.setAttribute('aria-hidden', 'false');
            this._app?.onMagicFocusEnter?.();
            this.syncExitFabVisibility({ instant: true });
            return;
        }

        const hide = boardChromeEls();
        await morphElements({
            hide,
            show: [this.root, exitFab].filter(Boolean),
            mutate: () => {
                shell?.setAttribute('data-magic-focus', '');
                canvas?.classList.add('is-hidden');
                this.root.classList.remove('is-hidden');
                this.root.setAttribute('aria-hidden', 'false');
                exitFab?.classList.remove('is-hidden');
                this._app?.onMagicFocusEnter?.({ deferChrome: true });
            }
        });

        // Steady-state hard hide for board chrome (strip morph class after hard hide)
        this._app?.updateFabVisibility?.({ instant: true });
        this._app?.applyDesktopDockAfterFocusEnter?.();
        hide.forEach((el) => el.classList.remove(MORPH_CLASS));
        this.syncExitFabVisibility({ instant: true });
    },

    async _leaveShell() {
        const shell = document.getElementById('workspace-shell');
        const canvas = document.getElementById('app-canvas');
        shell?.removeAttribute('data-magic-focus');
        canvas?.classList.remove('is-hidden');
        await this._app?.onMagicFocusLeave?.();
        this.syncExitFabVisibility({ instant: true });
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
            // Spawn session is already a single pane — Esc exits Focus.
            if (this.sessionSpawnBlocks?.length) {
                e.preventDefault();
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
        const titleHtml = buildNoteTitleHtml(item, true, { richEdit: true });
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
                richEdit: true,
                localOnly: false,
                stopMousedownPropagation: true,
                refresh: () => this.refreshChecklistPane(shell),
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

    renderSetup(item) { return SetupSession.renderSetup(this, item); },

    _renderLayoutStep(item) { return SetupSession._renderLayoutStep(this, item); },

    _renderAssignStep(item) { return SetupSession._renderAssignStep(this, item); },

    _resetFocusConfig(item) { return SetupSession._resetFocusConfig(this, item); },

    _bindLayoutStepEvents(item) { return SetupSession._bindLayoutStepEvents(this, item); },

    _bindAssignStepEvents(item) { return SetupSession._bindAssignStepEvents(this, item); },

    async renderWork(item) {
        if (!this.bodyEl || !item) return;
        this.expandedPaneId = null;
        await this._unhostDrawingBoard();

        if (this.sessionSpawnBlocks?.length) {
            await this._renderSpawnWork(item);
            return;
        }

        const focus = normalizeFocus(item.focus) || createDefaultFocus();
        const layout = layoutForFocus(focus);
        const count = PRESET_ZONE_COUNTS[focus.preset] || 2;

        const panes = [];
        for (let i = 0; i < count; i += 1) {
            const zid = `z${i}`;
            const blocks = asBlockList(focus.zones[zid]);
            const empty = blocks.length === 0;
            const hasCanvas = blocks.includes('canvas');
            const zoomPct = clampFocusZoom(focus.zoom?.[zid] ?? FOCUS_ZOOM_DEFAULT);
            const zoomFactor = zoomPct / 100;
            const zoomOutDisabled = zoomPct <= FOCUS_ZOOM_MIN ? ' disabled' : '';
            const zoomInDisabled = zoomPct >= FOCUS_ZOOM_MAX ? ' disabled' : '';
            panes.push(`
                <section class="magic-focus__pane${empty ? ' magic-focus__pane--empty' : ''}${hasCanvas ? ' magic-focus__pane--canvas' : ''}"
                    data-focus-pane="${zid}" style="grid-area:${zid}; --focus-pane-zoom: ${zoomFactor}">
                    <div class="magic-focus__pane-chrome">
                        <button type="button" class="card-act" data-focus-pane-zoom-out
                            title="Zoom out" aria-label="Zoom out"${zoomOutDisabled}>${ACTION_ICONS.minus}</button>
                        <span class="magic-focus__pane-zoom-label" data-focus-pane-zoom-label>${zoomPct}%</span>
                        <button type="button" class="card-act" data-focus-pane-zoom-in
                            title="Zoom in" aria-label="Zoom in"${zoomInDisabled}>${ACTION_ICONS.plus}</button>
                        <button type="button" class="card-act magic-focus__pane-expand" data-focus-pane-expand
                            title="Expand pane" aria-label="Expand pane" aria-pressed="false">${CARD_ICONS.expandMedia}</button>
                    </div>
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
        this._bindPaneChromeControls();
        this.renderHeader(item);
    },

    /**
     * Ephemeral single full-bleed pane for section/subsection spawn.
     * @param {object} item
     */
    async _renderSpawnWork(item) {
        const zid = 'z0';
        const blocks = asBlockList(this.sessionSpawnBlocks);
        const empty = blocks.length === 0;
        const hasCanvas = blocks.includes('canvas');
        const zoomPct = clampFocusZoom(this.sessionSpawnZoom ?? FOCUS_ZOOM_DEFAULT);
        const zoomFactor = zoomPct / 100;
        const zoomOutDisabled = zoomPct <= FOCUS_ZOOM_MIN ? ' disabled' : '';
        const zoomInDisabled = zoomPct >= FOCUS_ZOOM_MAX ? ' disabled' : '';

        this.bodyEl.innerHTML = `
            <div class="magic-focus__work is-pane-expanded is-focus-spawn" data-magic-focus-work data-focus-spawn-work>
                <section class="magic-focus__pane${empty ? ' magic-focus__pane--empty' : ''}${hasCanvas ? ' magic-focus__pane--canvas' : ''} is-expanded"
                    data-focus-pane="${zid}" style="grid-area: 1 / 1 / -1 / -1; --focus-pane-zoom: ${zoomFactor}">
                    <div class="magic-focus__pane-chrome">
                        <button type="button" class="card-act" data-focus-pane-zoom-out
                            title="Zoom out" aria-label="Zoom out"${zoomOutDisabled}>${ACTION_ICONS.minus}</button>
                        <span class="magic-focus__pane-zoom-label" data-focus-pane-zoom-label>${zoomPct}%</span>
                        <button type="button" class="card-act" data-focus-pane-zoom-in
                            title="Zoom in" aria-label="Zoom in"${zoomInDisabled}>${ACTION_ICONS.plus}</button>
                        <button type="button" class="card-act magic-focus__pane-expand" data-focus-pane-expand
                            title="Restore pane" aria-label="Restore pane" aria-pressed="true">${CARD_ICONS.collapseMedia}</button>
                    </div>
                    <div class="magic-focus__pane-body editor-note-body" data-focus-pane-body="${zid}"></div>
                </section>
            </div>
        `;
        const workEl = this.bodyEl.querySelector('[data-magic-focus-work]');
        if (workEl) {
            workEl.style.gridTemplateColumns = '1fr';
            workEl.style.gridTemplateRows = '1fr';
            workEl.style.gridTemplateAreas = '"z0"';
        }

        const body = this.bodyEl.querySelector(`[data-focus-pane-body="${zid}"]`);
        if (body) {
            if (!blocks.length) {
                body.innerHTML = `<div class="magic-focus__pane-empty-msg">Empty</div>`;
            } else {
                await this._fillPane(body, item, blocks, zid);
            }
        }

        this.expandedPaneId = zid;
        this._bindPaneChromeControls();
        this._syncPaneExpandButtons();
        this.renderHeader(item);
    },

    _bindPaneChromeControls() {
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
        work.querySelectorAll('[data-focus-pane-zoom-out]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const pane = btn.closest('[data-focus-pane]');
                const zid = pane?.getAttribute('data-focus-pane');
                if (!zid) return;
                this._nudgePaneZoom(zid, -FOCUS_ZOOM_STEP);
            });
        });
        work.querySelectorAll('[data-focus-pane-zoom-in]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const pane = btn.closest('[data-focus-pane]');
                const zid = pane?.getAttribute('data-focus-pane');
                if (!zid) return;
                this._nudgePaneZoom(zid, FOCUS_ZOOM_STEP);
            });
        });
    },

    _nudgePaneZoom(zoneId, delta) {
        if (!zoneId) return;
        if (this.sessionSpawnBlocks?.length) {
            const next = clampFocusZoom((this.sessionSpawnZoom ?? FOCUS_ZOOM_DEFAULT) + delta);
            this.sessionSpawnZoom = next;
            this._applyPaneZoom(zoneId, next);
            this._refitHostedCanvas();
            return;
        }
        const item = this.resolveItem();
        if (!item) return;
        const focus = normalizeFocus(item.focus) || createDefaultFocus();
        const next = clampFocusZoom((focus.zoom?.[zoneId] ?? FOCUS_ZOOM_DEFAULT) + delta);
        const zoom = { ...focus.zoom, [zoneId]: next };
        NoteSurface.mutateItem(item, (it) => {
            if (!it.focus) it.focus = createDefaultFocus(focus.preset);
            it.focus = normalizeFocus({
                ...it.focus,
                ratios: focus.ratios,
                preset: focus.preset,
                zones: focus.zones,
                zoom
            });
        }, { preserveView: true, skipRerender: true });
        this._applyPaneZoom(zoneId, next);
        this._refitHostedCanvas();
    },

    _applyPaneZoom(zoneId, zoomPct) {
        const pane = this.bodyEl?.querySelector(`[data-focus-pane="${CSS.escape(zoneId)}"]`);
        if (!pane) return;
        const pct = clampFocusZoom(zoomPct);
        pane.style.setProperty('--focus-pane-zoom', String(pct / 100));
        const label = pane.querySelector('[data-focus-pane-zoom-label]');
        if (label) label.textContent = `${pct}%`;
        const outBtn = pane.querySelector('[data-focus-pane-zoom-out]');
        const inBtn = pane.querySelector('[data-focus-pane-zoom-in]');
        if (outBtn) outBtn.disabled = pct <= FOCUS_ZOOM_MIN;
        if (inBtn) inBtn.disabled = pct >= FOCUS_ZOOM_MAX;
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
            const textCollapsed = !!item.textCollapsed;
            // Reuse the canonical content-field builder so Focus renders text
            // exactly like the board/modal (rich edit, links, <br> line breaks).
            const field = buildNoteContentFieldHtml(item, { canEdit: true, richEdit: true });
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
        if (block === 'kanban') return buildKanbanPaneHtml(item);
        if (block === 'wbs') return buildWbsPaneHtml(item);
        if (block === 'media') return buildMediaPaneHtml(item);
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
        // Board checklist refresh syncs before rebuild; match that so collapse/
        // expand paths do not drop in-flight step/text edits.
        const pane = body.closest?.('.magic-focus__pane');
        const live = this.resolveItem() || item;
        if (pane && live && pane.querySelector('.card-inline-edit, .expanded-checklist, [data-note-text]')) {
            flushDesktopAutoSave(pane, live, { mergeWindow: false });
        } else {
            // No editable DOM yet (first mount) — still cancel any orphan timer.
            clearDesktopAutoSaveTimer();
        }
        // Checklist structural ops (indent/outdent/delete/drag) stash the step to
        // refocus; re-apply it once the fresh rows exist.
        const pendingStepId = body.dataset.pendingFocusStepId || '';
        const pendingEdge = body.dataset.pendingFocusEdge || 'end';
        if (pendingStepId) {
            delete body.dataset.pendingFocusStepId;
            delete body.dataset.pendingFocusEdge;
        }
        const parts = [];
        for (const block of list) {
            parts.push(await this._blockHtml(live || item, block, zoneId));
        }
        body.innerHTML = parts.join('');
        this._bindPaneInteractions(body, live || item);
        if (pendingStepId) {
            const stepTextEl = body.querySelector(`.step-text.card-inline-edit[data-step-id="${CSS.escape(pendingStepId)}"]`);
            if (stepTextEl) focusInlineEdit(stepTextEl, pendingEdge === 'start' ? 'start' : 'end');
        }

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
                if (!collapsed) this._relayoutFocusCanvas();
            });
        }
    },

    _relayoutFocusCanvas() {
        if (!this.drawingHosted) return;
        requestAnimationFrame(() => {
            import('./drawingBoard.js').then(({ DrawingBoard }) => {
                if (DrawingBoard.active) DrawingBoard.resize?.();
            });
            import('./drawingToolbarChrome.js').then(({ DrawingToolbarChrome }) => {
                if (DrawingToolbarChrome.collapsed) {
                    DrawingToolbarChrome.positionChip?.(false);
                    DrawingToolbarChrome.chip?.classList.remove('is-hidden');
                }
            });
        });
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
                richEdit: true,
                localOnly: false,
                stopMousedownPropagation: true,
                // Checklist structural ops call refresh() (delete/indent/outdent/
                // collapse/done). Focus owns the pane, so rebuild it in place.
                refresh: () => this.refreshChecklistPane(body),
                onChange: () => {}
            });
        } catch { /* ignore */ }

        // Each table/chart/kanban block is its own [data-note-planner] — bind every one.
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

        import('./noteAttachmentsUi.js').then(({ bindNoteAttachments }) => {
            body.querySelectorAll('[data-focus-media-sub]').forEach((sub) => {
                // Focus-local collapse: toggle the planner-sub body only.
                // Never writes item.attachmentsCollapsed (board state stays intact).
                const toggle = sub.querySelector('[data-focus-media-toggle]');
                const subBody = sub.querySelector('[data-focus-media-body]');
                if (toggle && subBody && !toggle.dataset.focusMediaToggleBound) {
                    toggle.dataset.focusMediaToggleBound = '1';
                    toggle.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const collapsed = subBody.classList.toggle('is-collapsed');
                        toggle.querySelector('.collapsable-toggle')?.classList.toggle('collapsed', !!collapsed);
                        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                        sub.dataset.mediaCollapsed = collapsed ? '1' : '0';
                    });
                }
                // Add-media CTA routes to the board entry point (library overlay).
                const addBtn = sub.querySelector('[data-focus-media-add]');
                if (addBtn && !addBtn.dataset.focusMediaAddBound) {
                    addBtn.dataset.focusMediaAddBound = '1';
                    addBtn.addEventListener('click', () => {
                        if (!localStorage.getItem('admin_token')) {
                            import('./toast.js').then(({ showAppToast }) => {
                                showAppToast('Login required to attach media');
                            }).catch(() => {});
                            return;
                        }
                        import('./mediaLibraryOverlay.js').then(({ MediaLibraryOverlay }) => {
                            MediaLibraryOverlay.open({ attachNoteId: item.id });
                        }).catch(() => {});
                    });
                }
                // Row bindings (hydrate, reorder via mutateItem, quick-actions)
                // attach to the inner host. bindNoteAttachments is idempotent
                // per root (dataset flags), so a re-bind after refresh is safe.
                const host = sub.querySelector('[data-note-attachments][data-focus-media-only]');
                if (host) bindNoteAttachments(host, item);
            });
        }).catch(() => {});

        import('./flowchartUi.js').then(({ attachFlowchartInteractions }) => {
            body.querySelectorAll('[data-note-flowchart]').forEach((sec) => {
                attachFlowchartInteractions(sec.closest('.editor-note-body') || sec.parentElement, item);
            });
        }).catch(() => {});
    },

    /**
     * Rebuild a Focus pane after a checklist structural mutation.
     * `bindChecklistInteractions` calls refresh() for delete / indent / outdent /
     * group-collapse / done-toggle / expand-all; the board and modal re-render
     * their checklist in response, so Focus must do the same or the rows go stale.
     * Every caller is click-initiated (fields already blurred), and _fillPane
     * clears any pending autosave, so a full pane rebuild is safe here.
     * @param {HTMLElement} body - the pane's .editor-note-body element
     */
    async refreshChecklistPane(body) {
        if (!this.isOpen() || this.showingSetup || !body?.isConnected) return;
        const zoneId = body.getAttribute('data-focus-pane-body');
        const item = this.resolveItem();
        if (!zoneId || !item) return;
        const blocks = this.sessionSpawnBlocks?.length
            ? asBlockList(this.sessionSpawnBlocks)
            : asBlockList(normalizeFocus(item.focus)?.zones?.[zoneId]);
        if (!blocks.length) return;
        await this._fillPane(body, item, blocks, zoneId);
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
                    it.focus = normalizeFocus({
                        ...it.focus,
                        ratios: focus.ratios,
                        preset: focus.preset,
                        zones: focus.zones,
                        zoom: focus.zoom
                    });
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
        // Layout may still be settling (multi-section flex); resize + re-seat chip.
        this._relayoutFocusCanvas();
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

    /**
     * Refresh only the planner sections of Focus panes.
     * Previously this re-filled whole panes, which destroyed sibling text /
     * checklist DOM (and any caret in it) whenever a table/chart shared a zone.
     * Now table markup is rebuilt in place and gantt/kanban/wbs/summary are refreshed via
     * plannerUi's in-place refresh, so text/checklist are never clobbered.
     * @param {object} item
     */
    async refreshPlannerPanes(item) {
        if (!this.isOpen() || !item || this.showingSetup) return;
        const live = this.resolveItem() || item;
        const { renderPlannerTableHtml, refreshPlannerDerivedViews, growPlannerTextareas } = await import('./plannerUi.js');
        const { normalizePlanner } = await import('./planner.js');
        if (live.planner) live.planner = normalizePlanner(live.planner) || live.planner;

        /** @type {{ zid: string, blocks: string[] }[]} */
        let paneSpecs;
        if (this.sessionSpawnBlocks?.length) {
            paneSpecs = [{ zid: 'z0', blocks: asBlockList(this.sessionSpawnBlocks) }];
        } else {
            const focus = normalizeFocus(live.focus);
            if (!focus) return;
            const count = PRESET_ZONE_COUNTS[focus.preset] || 2;
            paneSpecs = [];
            for (let i = 0; i < count; i += 1) {
                const zid = `z${i}`;
                paneSpecs.push({ zid, blocks: asBlockList(focus.zones[zid]) });
            }
        }

        for (const { zid, blocks } of paneSpecs) {
            if (!blocks.includes('table') && !blocks.includes('chart') && !blocks.includes('kanban') && !blocks.includes('wbs')) continue;
            const body = this.bodyEl.querySelector(`[data-focus-pane-body="${zid}"]`);
            if (!body) continue;
            const tableSec = body.querySelector('[data-note-planner][data-focus-table-only]');
            const chartSec = body.querySelector('[data-note-planner][data-focus-chart-only]');
            const kanbanSec = body.querySelector('[data-note-planner][data-focus-kanban-only]');
            const wbsSec = body.querySelector('[data-note-planner][data-focus-wbs-only]');
            if (!tableSec && !chartSec && !kanbanSec && !wbsSec) {
                // Planner section not mounted yet — render the pane from scratch.
                await this._fillPane(body, live, blocks, zid);
                continue;
            }
            if (tableSec && live.planner) {
                tableSec.innerHTML = renderPlannerTableHtml(live.planner, { canEdit: true });
                // Host stays bound; re-measure textareas so multi-line Comments/Name keep height.
                growPlannerTextareas(tableSec);
                requestAnimationFrame(() => {
                    if (tableSec.isConnected) growPlannerTextareas(tableSec);
                });
            }
        }
        // Gantt + kanban + wbs + summary refresh, in place across every host (board/modal/focus).
        refreshPlannerDerivedViews(live);
    }
};
