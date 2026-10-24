/** @module {"owns":"magic focus workspace mode — split panes, setup DnD, planner block hosting (table/chart/kanban/wbs)", "related":["app.js","magicFocus/lifecycle.js","magicFocus/render.js","magicFocus/setup.js","magicFocus/panes.js","magicFocus/splitters.js","magicFocus/model.js"], "events":[]} */
// Facade for the split-out focus workspace. The work lives in js/magicFocus/:
//
//   model.js     the layout model (blocks, presets, zone/ratio/zoom normalisation)
//   layout.js    preset -> CSS grid + splitter descriptors
//   paneMarkup.js the body markup one pane renders
//   setup.js     the two-step setup wizard
//   panes.js     pane chrome, zoom, expand, fill, hosted drawing board
//   splitters.js resize handles
//   render.js    header + work surface painting
//   lifecycle.js open/close/toggle, shell morph, escape key, item resolution
//
// Every method below is a one-line delegate: the session body takes this object as
// its first argument and calls back through it (`this.renderWork(...)` becomes
// `magicFocus.renderWork(...)`), so no session imports another and no cycle exists.

import { FOCUS_ZOOM_DEFAULT, createDefaultFocus, normalizeFocus, focusIsConfigured } from './magicFocus/model.js';
import * as SetupSession from './magicFocus/setup.js';
import * as PaneSession from './magicFocus/panes.js';
import * as SplitterSession from './magicFocus/splitters.js';
import * as RenderSession from './magicFocus/render.js';
import * as LifecycleSession from './magicFocus/lifecycle.js';
export { createDefaultFocus, normalizeFocus, focusIsConfigured };

export const MagicFocus = {
    // ---- session state; the session modules read and write it through the instance ----
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

    // ---- Lifecycle session — open/close, shell morph, escape key, item resolution ----

    init(app, ui) { return LifecycleSession.init(this, app, ui); },

    _wireExitFab() { return LifecycleSession._wireExitFab(this); },

    syncExitFabVisibility(opts = {}) { return LifecycleSession.syncExitFabVisibility(this, opts); },

    isOpen() { return LifecycleSession.isOpen(this); },

    getActiveItemId() { return LifecycleSession.getActiveItemId(this); },

    getLiveItem() { return LifecycleSession.getLiveItem(this); },

    _resolveItems() { return LifecycleSession._resolveItems(this); },

    setItemResolver(fn) { return LifecycleSession.setItemResolver(this, fn); },

    resolveItem() { return LifecycleSession.resolveItem(this); },

    async open(item, opts = {}) { return LifecycleSession.open(this, item, opts); },

    /**
     * Open Focus with an ephemeral single expanded pane for the given blocks.
     * Does not rewrite saved item.focus zones/preset/ratios.
     * @param {object} item
     * @param {string|string[]} blocks
     */
    async openExpandedBlocks(item, blocks) { return LifecycleSession.openExpandedBlocks(this, item, blocks); },

    _clearSessionSpawn() { return LifecycleSession._clearSessionSpawn(this); },

    async openSettings() { return LifecycleSession.openSettings(this); },

    /**
     * Flush Focus header + pane shells into the shared item (final write).
     * Clears the desktop autosave timer via flushDesktopAutoSave.
     */
    flushPendingEdits() { return LifecycleSession.flushPendingEdits(this); },

    async close() { return LifecycleSession.close(this); },

    async toggle(item) { return LifecycleSession.toggle(this, item); },

    async _enterShell() { return LifecycleSession._enterShell(this); },

    async _leaveShell() { return LifecycleSession._leaveShell(this); },

    _bindEsc() { return LifecycleSession._bindEsc(this); },

    _unbindEsc() { return LifecycleSession._unbindEsc(this); },

    _syncFocusButtons() { return LifecycleSession._syncFocusButtons(this); },

    /** Bodies hosted in focus panes — for planner/canvas sync. */
    noteBodiesForItem(itemId) { return LifecycleSession.noteBodiesForItem(this, itemId); },

    // ---- Painting — header, work surface, ephemeral spawn view ----

    applyNoteTheme(item) { return RenderSession.applyNoteTheme(this, item); },

    renderHeader(item) { return RenderSession.renderHeader(this, item); },

    async renderWork(item) { return RenderSession.renderWork(this, item); },

    /**
     * Ephemeral single full-bleed pane for section/subsection spawn.
     * @param {object} item
     */
    async _renderSpawnWork(item) { return RenderSession._renderSpawnWork(this, item); },

    // ---- Setup wizard — preset and assign steps ----

    renderSetup(item) { return SetupSession.renderSetup(this, item); },

    _renderLayoutStep(item) { return SetupSession._renderLayoutStep(this, item); },

    _renderAssignStep(item) { return SetupSession._renderAssignStep(this, item); },

    _resetFocusConfig(item) { return SetupSession._resetFocusConfig(this, item); },

    _bindLayoutStepEvents(item) { return SetupSession._bindLayoutStepEvents(this, item); },

    _bindAssignStepEvents(item) { return SetupSession._bindAssignStepEvents(this, item); },

    // ---- Panes — chrome, zoom, expand, fill, hosted canvas, planner refresh ----

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

    async _hostDrawingBoard(hostEl, item) { return PaneSession._hostDrawingBoard(this, hostEl, item); },

    async _unhostDrawingBoard() { return PaneSession._unhostDrawingBoard(this); },

    /**
     * Refresh only the planner sections of Focus panes.
     * Previously this re-filled whole panes, which destroyed sibling text /
     * checklist DOM (and any caret in it) whenever a table/chart shared a zone.
     * Now table markup is rebuilt in place and gantt/kanban/wbs/summary are refreshed via
     * plannerUi's in-place refresh, so text/checklist are never clobbered.
     * @param {object} item
     */
    async refreshPlannerPanes(item) { return PaneSession.refreshPlannerPanes(this, item); },

    // ---- Splitters — mount, position, drag ----

    _mountSplitters(focus, layout) { return SplitterSession._mountSplitters(this, focus, layout); },

    _positionSplitter(el, split, work, focus = null) { return SplitterSession._positionSplitter(this, el, split, work, focus); },

    _bindSplitterDrag(el, split, focus, work) { return SplitterSession._bindSplitterDrag(this, el, split, focus, work); },
};
