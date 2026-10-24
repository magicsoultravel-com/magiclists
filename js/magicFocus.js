/** @module {"owns":"magic focus workspace mode — split panes, setup DnD, planner block hosting (table/chart/kanban/wbs)", "related":["app.js","noteQuickActions.js","drawingBoard.js","plannerUi.js","noteSurface.js"]} */

import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { buildNoteQuickActionsHtml, buildNoteTitleHtml } from './noteSurfaceHtml.js';
import { bindNoteQuickActions } from './noteQuickActions.js';
import { NoteSurface, flushDesktopAutoSave } from './noteSurface.js';
import { applyCardTheme } from './cardTheme.js';
import { resolveNoteColor } from './colorPicker.js';
import { Editor } from './editor.js';
import {
    isUiTransitionsEnabled,
    morphElements,
    setChromeVisible,
    UI_TRANSITION_MS
} from './uiTransitions.js';
import { PRESET_ZONE_COUNTS, FOCUS_ZOOM_MIN, FOCUS_ZOOM_MAX, FOCUS_ZOOM_DEFAULT, clampFocusZoom, asBlockList, createDefaultFocus, normalizeFocus, focusIsConfigured } from './magicFocus/model.js';
import { layoutForFocus } from './magicFocus/layout.js';
import * as SetupSession from './magicFocus/setup.js';
import * as PaneSession from './magicFocus/panes.js';
import * as SplitterSession from './magicFocus/splitters.js';
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

    _bindPaneChromeControls() { return PaneSession._bindPaneChromeControls(this); },

    _nudgePaneZoom(zoneId, delta) { return PaneSession._nudgePaneZoom(this, zoneId, delta); },

    _applyPaneZoom(zoneId, zoomPct) { return PaneSession._applyPaneZoom(this, zoneId, zoomPct); },

    setExpandedPane(zoneId) { return PaneSession.setExpandedPane(this, zoneId); },

    clearExpandedPane() { return PaneSession.clearExpandedPane(this); },

    _syncPaneExpandButtons() { return PaneSession._syncPaneExpandButtons(this); },

    _refitHostedCanvas() { return PaneSession._refitHostedCanvas(this); },

    async _blockHtml(item, block, zoneId) { return PaneSession._blockHtml(this, item, block, zoneId); },

    async _fillPane(body, item, blocks, zoneId) { return PaneSession._fillPane(this, body, item, blocks, zoneId); },

    _relayoutFocusCanvas() { return PaneSession._relayoutFocusCanvas(this); },

    _bindPaneInteractions(body, item) { return PaneSession._bindPaneInteractions(this, body, item); },

    /**
     * Rebuild a Focus pane after a checklist structural mutation.
     * `bindChecklistInteractions` calls refresh() for delete / indent / outdent /
     * group-collapse / done-toggle / expand-all; the board and modal re-render
     * their checklist in response, so Focus must do the same or the rows go stale.
     * Every caller is click-initiated (fields already blurred), and _fillPane
     * clears any pending autosave, so a full pane rebuild is safe here.
     * @param {HTMLElement} body - the pane's .editor-note-body element
     */
    async refreshChecklistPane(body) { return PaneSession.refreshChecklistPane(this, body); },

    _mountSplitters(focus, layout) { return SplitterSession._mountSplitters(this, focus, layout); },

    _positionSplitter(el, split, work, focus = null) { return SplitterSession._positionSplitter(this, el, split, work, focus); },

    _bindSplitterDrag(el, split, focus, work) { return SplitterSession._bindSplitterDrag(this, el, split, focus, work); },

    async _hostDrawingBoard(hostEl, item) { return PaneSession._hostDrawingBoard(this, hostEl, item); },

    async _unhostDrawingBoard() { return PaneSession._unhostDrawingBoard(this); },

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
    async refreshPlannerPanes(item) { return PaneSession.refreshPlannerPanes(this, item); },
};
