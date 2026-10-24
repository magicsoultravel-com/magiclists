/** @module {"owns":"application orchestration, event bus listeners, workspace init", "related":["api.js","ui.js","layoutStorage.js"], "events":["item:mutation_requested","item:selected_for_edit","board:visibility_changed","calendar:add_note"]} */
import { API } from './api.js';
import { AppState } from './app/state.js';
import { ACTION_ICONS } from './icons.js';
import { UI } from './ui.js';
import { BoardOperations } from './boardOperations.js';
import { Editor } from './editor.js';
import { DragDropEngine } from './dragdrop.js';
import { ToolsManager } from './toolsManager.js';
import { Calendar } from './calendar.js';
import { SidePanel } from './hamburger.js';
import { LoadingManager } from './loadingUtils.js';
import { reconcileLayoutStorage } from './layoutStorage.js';
import { UndoManager } from './undo.js';
import { DesktopBackground } from './desktopBackground.js';
import { ChromeBackground } from './chromeBackground.js';
import { ClockStyle } from './clockStyle.js';
import { DisplayOptions } from './displayOptions.js';
import { applyTileSmallFootprint } from './tileFootprint.js';
import {
    initGridMetrics,
    migrateCompactDefaultsIfNeeded,
    migrateCardMinimumFootprintIfNeeded,
    migrateGridSpanCardWidthIfNeeded,
    migrateLegacyGridLayoutIfNeeded
} from './gridDensity.js';
import { AppTheme } from './appTheme.js';
import { DesktopZoom } from './desktopZoom.js';
import { NoteFontScale } from './noteFontScale.js';
import { BoardOverlay } from './boardOverlay.js';
import { readViewSessions, restoreViewSession } from './viewSession.js';
import { DrawingBoard } from './drawingBoard.js';
import { MagicFocus } from './magicFocus.js';
import { Fullscreen } from './fullscreen.js';
import { SidebarRadio } from './sidebarRadio.js';
import { SidebarTv } from './sidebarTv.js';
import { SidebarWeather } from './sidebarWeather.js';
import { MediaLibraryOverlay, bindMediaFilePickers } from './mediaLibraryOverlay.js';
import { CategoriesOverlay } from './categoriesOverlay.js';
import { LinksOverlay } from './linksOverlay.js';
import { SidebarLinks } from './sidebarLinks.js';
import { MediaStagingDialog } from './mediaStagingDialog.js';
import { MediaPasteCatcher } from './mediaPasteCatcher.js';
import { registerLiveNoteSource, setModalEditorNoteIdResolver } from './notePasteContext.js';
import { dockSidebarModule, initAllSidebarModules } from './sidebarModules.js';
import { SidebarStats } from './sidebarStats.js';
import { SidebarHistory } from './sidebarHistory.js';
import { CloudBackup } from './cloudBackup.js';
import { ScheduledBackup } from './scheduledBackup.js';
import { BoardSort } from './boardSort.js';
import { BootProgress } from './bootProgress.js';
import { renderQuickActions, importNotePackageFromPicker } from './noteQuickActions.js';
import { DesktopDock } from './desktopDockComponent.js';
import { TemplatePicker } from './templatePicker.js';
import { readDisplayOptions } from './displayOptions.js';
import {
    isSidebarModuleEnabled,
    registerSidebarModuleLifecycle,
    SIDEBAR_MODULE_IDS,
    SIDEBAR_MODULES_CHANGED_EVENT,
    syncSidebarModuleLifecycle
} from './sidebarModulePrefs.js';
import { migrateItemsToFileCabinet, pruneFileCabinetOrderByLayout, setFileCabinetActive } from './fileCabinet.js';
import { initShellResize } from './shellResize.js';
import { initSidebarDetach } from './sidebarDetach.js';
import { initUndockedSidebarStacking } from './desktopStack.js';
import { BoardRulers } from './boardRulers.js';
import * as Listeners from './app/listeners.js';
import * as Services from './app/services.js';

function countHiddenFromBoard(items) {
    return items.filter(item => BoardOperations.isHiddenFromBoard(item)).length;
}

class Application {
    constructor() {
        this._syncQueue = Promise.resolve();
        this._pendingItemSaves = new Set();
    }

    async init() {
        BootProgress.init();
        BootProgress.set(8, 'Starting…');
        try {
            DesktopBackground.init();
            ChromeBackground.init();
            NoteFontScale.init();
            BoardOverlay.init();
            migrateLegacyGridLayoutIfNeeded();
            initGridMetrics();
            applyTileSmallFootprint();
            migrateCompactDefaultsIfNeeded();
            migrateCardMinimumFootprintIfNeeded();
            migrateGridSpanCardWidthIfNeeded();
            DisplayOptions.init({
                getLoggedIn: () => AppState.user.isLoggedIn,
                getItems: () => AppState.items
            });
            AppTheme.init();
            readViewSessions();
            localStorage.setItem('matrix_desktop_layout', AppState.viewSettings.sortBy);
            restoreViewSession(AppState.viewSettings.sortBy);
            BootProgress.set(20, 'Preferences…');
            this.checkAuthSession();
            this.logRepairDiagnostics();
            Editor.init();
            await ToolsManager.init(() => AppState.items);
            BootProgress.set(30, 'Tools…');
            Calendar.init();
            this.renderControlBar();
            this.loadCategoriesStore();
            // Layout repair must never gate boot: a quota prompt or a corrupt
            // layout key used to abort init() here, leaving a booted-but-empty
            // workspace (no board render at all). Boot continues either way.
            try {
                await reconcileLayoutStorage({
                    items: API._getLocalDB().items,
                    categories: AppState.categories
                });
            } catch (error) {
                console.warn('[app] layout reconcile skipped', error);
            }
            this.migrateBoardOverlayFromFreeform();
            BootProgress.set(60, 'Layout…');
            await this.syncDataStore();
BootProgress.set(85, 'Workspace…');
            this.setupCoreListeners();
            SidePanel.init(AppState);
            // Refresh desktop dock with note counts
            DesktopDock.refreshButtons(AppState.items);
            initShellResize();
            initSidebarDetach();
            BoardRulers.init();
            initUndockedSidebarStacking();
            BoardSort.init({
                getItems: () => AppState.items,
                getViewMode: () => AppState.viewSettings.sortBy,
                isOverlayEnabled: () => BoardOverlay.isEnabled(),
                getFileCabinet: () => AppState.viewSettings.fileCabinet,
                onSort: (prefs) => {
                    UI.sortBoardLayout(AppState.viewSettings.sortBy, AppState.items, prefs, {
                        fileCabinetActive: AppState.viewSettings.fileCabinet
                    });
                }
            });
            /* Radio/TV/Weather always build their shell (header, drag, dock and
               popout bindings need it) but only start playback / casting /
               polling when enabled in Display Options → Sidebar → Modules. */
            const sidebarModules = readDisplayOptions().sidebarModules;
            const isModuleOn = (id) => isSidebarModuleEnabled(id, sidebarModules);
            if (isModuleOn('radio')) SidebarRadio.init(); else SidebarRadio.initShell();
            if (isModuleOn('tv')) SidebarTv.init(); else SidebarTv.initShell();
            if (isModuleOn('weather')) SidebarWeather.init(); else SidebarWeather.initShell();
            MediaStagingDialog.init();
            registerLiveNoteSource((noteId) => AppState.items.find((i) => i.id === noteId) || null);
            registerLiveNoteSource((noteId) => (
                Editor.activeItem?.id === noteId ? Editor.activeItem : null
            ));
            setModalEditorNoteIdResolver(() => Editor.activeItem?.id || null);
            Editor.setLiveItemResolver((noteId) => AppState.items.find((i) => i.id === noteId) || null);
            MediaLibraryOverlay.init({
                getItems: () => AppState.items
            });
            CategoriesOverlay.init({
                getState: () => ({
                    categories: AppState.categories,
                    hiddenCategories: AppState.hiddenCategories,
                    items: AppState.items
                }),
                getUI: () => UI
            });
            LinksOverlay.init();
            SidebarLinks.init();
            MediaPasteCatcher.init();
            bindMediaFilePickers();
            this.setupScribbleFab();
            SidePanel.setupStatusClickHandlers(); /* after radio/tv/weather shells exist */
            this.renderQuickActionsHeaderIcons();
            SidebarHistory.init(AppState);
            SidebarStats.init();
            initAllSidebarModules();
            /* A module disabled at boot was never re-docked (the change listener
               registered below only sees later changes): pull any persisted
               undocked panel back into the sidebar so disabling cannot leave an
               empty floating frame behind. */
            SIDEBAR_MODULE_IDS.forEach((id) => {
                if (!isModuleOn(id)) dockSidebarModule(id);
            });
            /* Register lifecycles after initAllSidebarModules(): its
               sidebar:modules_changed listener re-docks/pops-in a disabled
               module first, so players stop with the root back in the sidebar.
               `started` mirrors boot state, making the sync below a no-op. */
            registerSidebarModuleLifecycle('radio', {
                start: () => SidebarRadio.activate(),
                stop: () => SidebarRadio.deactivate(),
                started: isModuleOn('radio')
            });
            registerSidebarModuleLifecycle('tv', {
                start: () => SidebarTv.activate(),
                stop: () => SidebarTv.deactivate(),
                started: isModuleOn('tv')
            });
            registerSidebarModuleLifecycle('weather', {
                start: () => SidebarWeather.activate(),
                stop: () => SidebarWeather.deactivate(),
                started: isModuleOn('weather')
            });
            /* Pull-based modules keep their DOM but re-render on enable. */
            registerSidebarModuleLifecycle('links', {
                start: () => SidebarLinks.refresh(),
                started: isModuleOn('links')
            });
            registerSidebarModuleLifecycle('history', {
                start: () => SidebarHistory.renderPanel(),
                started: isModuleOn('history')
            });
            registerSidebarModuleLifecycle('stats', {
                start: () => SidebarStats.update(),
                started: isModuleOn('stats')
            });
            window.addEventListener(SIDEBAR_MODULES_CHANGED_EVENT, (e) => {
                syncSidebarModuleLifecycle(e.detail?.modules);
            });
            syncSidebarModuleLifecycle(sidebarModules);
            this.setupLayoutResetButton();
            SidebarHistory.renderPanel();
            ClockStyle.init();
            DesktopZoom.init();
            this.setupSearchBar();
            this.setupBackupInterface();
            CloudBackup.init({
                getLoggedIn: () => AppState.user.isLoggedIn,
                getItems: () => AppState.items
            });
            CloudBackup.ensureConnected().finally(() => CloudBackup.updateButtons());
            ScheduledBackup.init({
                getItems: () => AppState.items,
                getLoggedIn: () => AppState.user.isLoggedIn
            });
            TemplatePicker.init();
            this.setupUndo();
            this.setupNotePopoutBridge();
            this.setupCrossTabSync();
            this.setupDrawingMode();
            Fullscreen.init();
            DrawingBoard.init(this);
            MagicFocus.init(this, UI);
            MagicFocus.setItemResolver((id) => AppState.items.find((i) => i.id === id) || null);
            window.__MagicFocusIsOpenFor = (id) => MagicFocus.isOpen() && MagicFocus.getActiveItemId() === id;
            if (AppState.workspaceMode === 'drawing') {
                await this.applyWorkspaceMode('drawing', { skipPersist: true });
            }

            // Initialize Desktop Dock after workspace is ready
            DesktopDock.init();
        } finally {
            await BootProgress.complete();
        }
    }

    setupUndo() { return Listeners.setupUndo(this); }

    setupNotePopoutBridge() { return Listeners.setupNotePopoutBridge(this); }

    handleClaimsStorageSync() { return Listeners.handleClaimsStorageSync(this); }

    handlePopoutClaimChanged(noteId, closedItem = null) {
        return Listeners.handlePopoutClaimChanged(this, noteId, closedItem);
    }

    refreshPopoutLockedCards() { return Listeners.refreshPopoutLockedCards(this); }

    refreshPopoutLockedCard(noteId) { return Listeners.refreshPopoutLockedCard(this, noteId); }

    handlePopoutNoteSaved(noteId, remoteItem) { return Listeners.handlePopoutNoteSaved(this, noteId, remoteItem); }

    setupCrossTabSync() { return Listeners.setupCrossTabSync(this); }

    async refreshBoardFromSync(scopes, info) { return Listeners.refreshBoardFromSync(this, scopes, info); }

    resolveStaleBoardFlushSkipIds() { return Listeners.resolveStaleBoardFlushSkipIds(this); }

    flushPendingNoteHostsForLifecycle() { return Listeners.flushPendingNoteHostsForLifecycle(this); }

    isUserBusyOnCard(noteId) { return Listeners.isUserBusyOnCard(this, noteId); }

    /* Keep the sidebar/dock/history chrome in step after a sync refresh. */
    refreshSidebarAfterSync() { return Listeners.refreshSidebarAfterSync(this); }

    /* Immediate, non-destructive re-apply for theme/display scopes. */
    applyVisualFromSync(scope) { return Listeners.applyVisualFromSync(this, scope); }

    async removeItemFromWorkspace(itemId) { return Listeners.removeItemFromWorkspace(this, itemId); }

    async restoreItem(item, preserveView = false) { return Listeners.restoreItem(this, item, preserveView); }

    async refreshPlannerHostsAfterRestore(item) { return Listeners.refreshPlannerHostsAfterRestore(this, item); }

    checkAuthSession() { return Services.checkAuthSession(this); }

    logRepairDiagnostics() { return Services.logRepairDiagnostics(this); }

    loadCategoriesStore() { return Services.loadCategoriesStore(this); }

    applyPendingCategoryAliases() { return Services.applyPendingCategoryAliases(this); }

    async syncDataStore() { return Services.syncDataStore(this); }

    async _syncDataStoreInner() { return Services._syncDataStoreInner(this); }

    updateWorkspaceCounter() { return Services.updateWorkspaceCounter(this); }

    renderControlBar() {
        this.renderQuickActions();
        this.updateFabVisibility();
        this.updateLayoutResetVisibility();
        UndoManager.updateToolbar();
    }

renderQuickActions() {
        renderQuickActions({
            sortBy: AppState.viewSettings.sortBy,
            workspaceMode: AppState.workspaceMode,
            fileCabinet: AppState.viewSettings.fileCabinet,
            isLoggedIn: AppState.user.isLoggedIn,
            handlers: {
                onToggleOverlay: () => this.toggleBoardOverlay(),
                onToggleFileCabinet: () => this.toggleFileCabinet(),
                onToggleDrawing: async () => {
                    if (AppState.workspaceMode === 'drawing') await this.switchWorkspaceMode('notes');
                    else await this.switchWorkspaceMode('drawing');
                },
                onAddCategory: () => CategoriesOverlay.open({ focusAdd: true }),
                onCloudClick: (e) => CloudBackup.handleCloudClick(e.currentTarget),
                onCloudExport: (e) => CloudBackup.exportCheckpoint(e.currentTarget),
                onCloudImport: (e) => CloudBackup.handleImportClick(e.currentTarget),
                onExportDb: () => this.executeDataBackupExport(),
                onExportAll: () => this.executeFullBackupExport(),
                onExportAllTxt: () => this.executeExportAllTxt(),
                onScheduleExport: (e) => ScheduledBackup.handleClick(e.currentTarget),
                onImportDb: () => document.getElementById('system-import-file-picker').click(),
                onImportAll: () => document.getElementById('system-import-all-picker').click(),
                onImportNote: async () => {
                    const result = await importNotePackageFromPicker();
                    if (result?.status && result.status !== 'cancelled') {
                        await this.syncDataStore();
                    }
                },
                onLogout: () => this.executeLogout(),
                onLogin: () => this.executeLoginPrompt(),
                onLayoutReset: async () => {
                    if (AppState.workspaceMode === 'drawing') {
                        await this.switchWorkspaceMode('notes');
                    }
                    UI.resetBoardLayout(AppState.viewSettings.sortBy, AppState.items, {
                        fileCabinetActive: AppState.viewSettings.fileCabinet
                    });
                }
            }
        });

        ScheduledBackup.syncButton();

        // Bind header icons once during the initialization pipeline
        this.setupQuickActionsHeaderListeners();
        this.updateViewToggleState();
    }

    setupQuickActionsHeaderListeners() { return Listeners.setupQuickActionsHeaderListeners(this); }

    renderQuickActionsHeaderIcons() {
        const headerIcons = document.querySelector('.quick-actions-header-icons');
        if (!headerIcons) return;

        const drawingActive = AppState.workspaceMode === 'drawing';
        const fileCabinetActive = !drawingActive && AppState.viewSettings.fileCabinet;
        const overlayActive = !drawingActive && BoardOverlay.isEnabled();

        // Update bento toggle button
        const ffHeaderBtn = document.getElementById('qa-header-freeform-toggle');
        if (ffHeaderBtn) {
            ffHeaderBtn.innerHTML = overlayActive ? ACTION_ICONS.viewGrid : ACTION_ICONS.viewFree;
            ffHeaderBtn.classList.toggle('active', overlayActive);
            ffHeaderBtn.setAttribute('aria-pressed', overlayActive ? 'true' : 'false');
        }

        // Update file cabinet button
        const fcHeaderBtn = document.getElementById('qa-header-file-cabinet-toggle');
        if (fcHeaderBtn) {
            fcHeaderBtn.innerHTML = ACTION_ICONS.viewFileCabinet;
            fcHeaderBtn.classList.toggle('active', fileCabinetActive);
            fcHeaderBtn.setAttribute('aria-pressed', fileCabinetActive ? 'true' : 'false');
        }

        // Update undo/redo buttons
        const undoHeaderBtn = document.getElementById('qa-header-undo');
        const redoHeaderBtn = document.getElementById('qa-header-redo');
        if (undoHeaderBtn) {
            undoHeaderBtn.innerHTML = ACTION_ICONS.undo;
            undoHeaderBtn.disabled = !AppState.user.isLoggedIn || UndoManager.undoStack.length === 0;
        }
        if (redoHeaderBtn) {
            redoHeaderBtn.innerHTML = ACTION_ICONS.redo;
            redoHeaderBtn.disabled = !AppState.user.isLoggedIn || UndoManager.redoStack.length === 0;
        }
    }

    updateFabVisibility({ instant = false } = {}) {
        const fab = document.getElementById('fab-create');
        const scribbleFab = document.getElementById('fab-scribble');
        const inDrawing = AppState.workspaceMode === 'drawing';
        const inFocus = MagicFocus.isOpen();
        const hideBoardFabs = inDrawing || inFocus;
        const useMorph = !instant && document.documentElement.dataset.uiTransitions !== 'off';

        if (fab) {
            if (useMorph) {
                import('./uiTransitions.js').then(({ setChromeVisible, isUiTransitionsEnabled }) => {
                    if (!isUiTransitionsEnabled()) {
                        fab.classList.toggle('is-hidden', hideBoardFabs);
                        return;
                    }
                    setChromeVisible(fab, !hideBoardFabs, { instant });
                }).catch(() => {
                    fab.classList.toggle('is-hidden', hideBoardFabs);
                });
            } else {
                fab.classList.remove('ui-morph-hidden');
                fab.classList.toggle('is-hidden', hideBoardFabs);
            }
            if (!hideBoardFabs) {
                const needsLogin = !AppState.user.isLoggedIn;
                fab.title = needsLogin ? 'New note (login required)' : 'New note';
                fab.setAttribute('aria-label', fab.title);
            }
        }
        if (scribbleFab) {
            // Keep scribble available in Focus; only hide during workspace drawing.
            scribbleFab.classList.remove('ui-morph-hidden');
            scribbleFab.classList.toggle('is-hidden', inDrawing);
        }
        MagicFocus.syncExitFabVisibility({ inDrawing, instant: instant || !useMorph });
    }

    onMagicFocusEnter({ deferChrome = false } = {}) {
        AppState.workspaceMode = 'focus';
        DesktopDock.setSuppressed(true, { apply: !deferChrome });
        DesktopZoom.apply({ enabled: false });
        if (!deferChrome) {
            this.updateFabVisibility({ instant: true });
        }
        this.updateLayoutResetVisibility();
        this.updateViewToggleState();
    }

    applyDesktopDockAfterFocusEnter() {
        DesktopDock.applySuppressedVisibility();
    }

    applyDesktopDockAfterFocusLeave() {
        DesktopDock.setSuppressed(false);
    }

    async onMagicFocusLeave({ deferChrome = false } = {}) {
        AppState.workspaceMode = 'notes';
        DesktopDock.setSuppressed(false, { apply: !deferChrome });
        this.updateDesktopZoomVisibility();
        if (AppState.items.length) {
            const canvas = document.getElementById('app-canvas');
            UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
            DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
        }
        if (!deferChrome) {
            this.updateFabVisibility({ instant: true });
        }
        this.updateLayoutResetVisibility();
        this.updateViewToggleState();
    }

    async exitDrawingForFocus() {
        if (AppState.workspaceMode === 'drawing') {
            await this.switchWorkspaceMode('notes');
        }
    }

    isDrawingMode() {
        return AppState.workspaceMode === 'drawing';
    }

    stateWorkspaceMode() {
        return AppState.workspaceMode;
    }

    setupScribbleFab() { return Listeners.setupScribbleFab(this); }

    setupDrawingMode() { return Listeners.setupDrawingMode(this); }

    async switchWorkspaceMode(mode) {
        if (mode !== 'notes' && mode !== 'drawing') return;
        if (MagicFocus.isOpen()) {
            await MagicFocus.close();
        }
        if (AppState.workspaceMode === mode) return;
        await this.applyWorkspaceMode(mode);
    }

    async applyWorkspaceMode(mode, { skipPersist = false } = {}) {
        AppState.workspaceMode = mode;
        if (!skipPersist) {
            localStorage.setItem('matrix_workspace_mode', mode);
        }
        // Desktops only switch the notes board — hide the switcher on canvas.
        DesktopDock.setSuppressed(mode === 'drawing');

        const shell = document.getElementById('workspace-shell');
        const canvas = document.getElementById('app-canvas');
        const drawBtn = document.getElementById('btn-drawing-mode');

        if (mode === 'drawing') {
            shell?.setAttribute('data-drawing-mode', '');
            canvas?.classList.add('is-hidden');
            drawBtn?.classList.add('active');

            DesktopZoom.apply({ enabled: false });
            await DrawingBoard.activate();
        } else {
            shell?.removeAttribute('data-drawing-mode');
            canvas?.classList.remove('is-hidden');
            drawBtn?.classList.remove('active');

            await DrawingBoard.deactivate();
            this.updateDesktopZoomVisibility();

            if (AppState.items.length) {
                UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
                DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
            }
        }

        this.updateFabVisibility();
        this.updateLayoutResetVisibility();
        this.updateViewToggleState();
    }

    async enterNoteCanvasMode(item) {
        if (!item?.id) return;
        // Always bind DrawingBoard to the live AppState note (Shared SoT for canvas).
        const live = AppState.items.find((i) => i.id === item.id) || item;
        AppState.workspaceMode = 'drawing';
        DesktopDock.setSuppressed(true);
        const shell = document.getElementById('workspace-shell');
        const canvas = document.getElementById('app-canvas');
        const drawBtn = document.getElementById('btn-drawing-mode');
        shell?.setAttribute('data-drawing-mode', '');
        canvas?.classList.add('is-hidden');
        drawBtn?.classList.add('active');
        DesktopZoom.apply({ enabled: false });
        await DrawingBoard.activateForNote(live);
        this.updateFabVisibility();
    }

    async enterFlowchartMode(item) {
        if (!item?.id) return;
        // Bind to the live AppState note (Shared SoT) like enterNoteCanvasMode.
        const live = AppState.items.find((i) => i.id === item.id) || item;
        AppState.workspaceMode = 'drawing';
        DesktopDock.setSuppressed(true);
        const shell = document.getElementById('workspace-shell');
        const canvas = document.getElementById('app-canvas');
        const drawBtn = document.getElementById('btn-drawing-mode');
        shell?.setAttribute('data-drawing-mode', '');
        canvas?.classList.add('is-hidden');
        drawBtn?.classList.add('active');
        DesktopZoom.apply({ enabled: false });
        await DrawingBoard.openNoteFlowchart(live);
        this.updateFabVisibility();
    }

    async exitNoteCanvasMode(item) {
        // Focus hosts note-canvas in-pane — don't tear down the Focus shell.
        if (MagicFocus.isOpen()) {
            if (DrawingBoard.active || DrawingBoard.isNoteCanvasMode || DrawingBoard.docOwner) {
                await DrawingBoard.flushSave?.();
            }
            DrawingBoard.hideToolbar?.();
            return;
        }
        // Sole owner of DrawingBoard.deactivate for note-canvas exit (exitNoteCanvas
        // only dispatches). Skip if already torn down.
        if (DrawingBoard.active || DrawingBoard.isNoteCanvasMode || DrawingBoard.docOwner) {
            await DrawingBoard.deactivate();
        }
        AppState.workspaceMode = 'notes';
        localStorage.setItem('matrix_workspace_mode', 'notes');
        DesktopDock.setSuppressed(false);

        const shell = document.getElementById('workspace-shell');
        const canvas = document.getElementById('app-canvas');
        const drawBtn = document.getElementById('btn-drawing-mode');
        shell?.removeAttribute('data-drawing-mode');
        canvas?.classList.remove('is-hidden');
        drawBtn?.classList.remove('active');
        this.updateDesktopZoomVisibility();

        if (AppState.items.length) {
            UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
            DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
        }

        this.updateFabVisibility();
        this.updateLayoutResetVisibility();
        this.updateViewToggleState();

        // Modal stays open underneath drawing — refresh Shared media/canvas UI from live.
        const noteId = item?.id;
        if (noteId && Editor.activeItem?.id === noteId && !Editor.overlay?.classList.contains('is-hidden')) {
            const live = AppState.items.find((i) => i.id === noteId);
            if (live) Editor.applySharedFromLive(live);
        }

        if (item?.id) {
            requestAnimationFrame(() => {
                const card = canvas?.querySelector(`.mini-card[data-id="${CSS.escape(item.id)}"]`);
                card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
        }
    }

    async executeDataBackupExport() { return Services.executeDataBackupExport(this); }

    async executeFullBackupExport() { return Services.executeFullBackupExport(this); }

    executeExportAllTxt() { return Services.executeExportAllTxt(this); }

    setupBackupInterface() { return Services.setupBackupInterface(this); }

    executeAddCategory(opts = {}) { return Services.executeAddCategory(this, opts); }

    executeAddCategoryPrompt(anchorEl = null) { return Services.executeAddCategoryPrompt(this, anchorEl); }

    executeLoginPrompt() { return Services.executeLoginPrompt(this); }

    executeLogout() { return Services.executeLogout(this); }

    migrateBoardOverlayFromFreeform() {
        if (BoardOverlay.isMigrationComplete()) {
            AppState.viewSettings.sortBy = 'grid';
            return;
        }
        const wasFreeform = AppState.viewSettings.sortBy === 'freeform'
            || localStorage.getItem('matrix_desktop_layout') === 'freeform'
            || Object.keys(UI.getFreeformPositions()).length > 0;
        if (wasFreeform) {
            BoardOverlay.setEnabled(true);
            UI.migrateFreeformLayoutToGrid(AppState.items);
        }
        AppState.viewSettings.sortBy = 'grid';
        localStorage.setItem('matrix_desktop_layout', 'grid');
        localStorage.setItem('matrix_preferred_view', 'grid');
        BoardOverlay.markMigrationComplete();
    }

    async toggleBoardOverlay() {
        // Show loading indicator on the board overlay toggle button
        const toggleBtn = document.getElementById('btn-freeform-toggle');
        if (toggleBtn) {
            LoadingManager.show(toggleBtn, 'Toggling board overlay...');
        }
        
        try {
            const canvas = document.getElementById('app-canvas');
            const wasEnabled = BoardOverlay.isEnabled();
            if (MagicFocus.isOpen()) MagicFocus.flushPendingEdits();
            UI.flushAllInlineEditsFromCanvas(canvas, AppState.items, {
                skipItemIds: this.resolveStaleBoardFlushSkipIds()
            });
            if (canvas) {
                UI.flushLayoutFromCanvas(canvas, AppState.viewSettings.sortBy);
            }
            const next = BoardOverlay.toggle();
            if (wasEnabled && !next && canvas) {
                UI.reflowGridBoard(canvas, null, { animate: true });
            }
            DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
            this.updateViewToggleState();
            BoardSort.refreshMenu();
        } finally {
            // Hide loading indicator
            const toggleBtn = document.getElementById('btn-freeform-toggle');
            if (toggleBtn) {
                LoadingManager.hide(toggleBtn);
            }
        }
    }

    async toggleFileCabinet() {
        // Show loading indicator on the file cabinet toggle button
        const toggleBtn = document.getElementById('btn-file-cabinet-toggle');
        if (toggleBtn) {
            LoadingManager.show(toggleBtn, 'Toggling file cabinet...');
        }
        
        try {
            if (AppState.workspaceMode === 'drawing') {
                await this.switchWorkspaceMode('notes');
            }
            const next = !AppState.viewSettings.fileCabinet;
            const canvas = document.getElementById('app-canvas');
            if (MagicFocus.isOpen()) MagicFocus.flushPendingEdits();
            UI.flushAllInlineEditsFromCanvas(canvas, AppState.items, {
                skipItemIds: this.resolveStaleBoardFlushSkipIds()
            });
            AppState.viewSettings.fileCabinet = next;
            setFileCabinetActive(next);
            if (next) {
                UI.flushLayoutFromCanvas(canvas, AppState.viewSettings.sortBy);
                pruneFileCabinetOrderByLayout(AppState.items, AppState.viewSettings.sortBy, UI);
                migrateItemsToFileCabinet(AppState.items, AppState.viewSettings.sortBy, UI);
            } else {
                pruneFileCabinetOrderByLayout(AppState.items, AppState.viewSettings.sortBy, UI);
            }
            this.updateViewToggleState();
            this.updateLayoutResetVisibility();
            await this.syncDataStore();
        } finally {
            // Hide loading indicator
            const toggleBtn = document.getElementById('btn-file-cabinet-toggle');
            if (toggleBtn) {
                LoadingManager.hide(toggleBtn);
            }
        }
    }

    updateViewToggleState() {
        const drawing = AppState.workspaceMode === 'drawing';
        const fileCabinetActive = !drawing && AppState.viewSettings.fileCabinet;
        const overlayActive = !drawing && BoardOverlay.isEnabled();
        const ffBtn = document.getElementById('btn-freeform-toggle');
        ffBtn?.classList.toggle('active', overlayActive);
        if (ffBtn) {
            const title = fileCabinetActive
                ? (overlayActive ? 'Snap bottom to bento' : 'Allow overlap on bottom')
                : (overlayActive ? 'Snap to bento grid' : 'Allow overlap');
            ffBtn.innerHTML = overlayActive ? ACTION_ICONS.viewGrid : ACTION_ICONS.viewFree;
            ffBtn.title = title;
            ffBtn.setAttribute('aria-label', title);
            ffBtn.setAttribute('aria-pressed', overlayActive ? 'true' : 'false');
        }
        const fcBtn = document.getElementById('btn-file-cabinet-toggle');
        fcBtn?.classList.toggle('active', fileCabinetActive);
        if (fcBtn) {
            const fcTitle = fileCabinetActive ? 'Hide File Cabinet' : 'File Cabinet';
            fcBtn.innerHTML = ACTION_ICONS.viewFileCabinet;
            fcBtn.title = fcTitle;
            fcBtn.setAttribute('aria-label', fcTitle);
            fcBtn.setAttribute('aria-pressed', fileCabinetActive ? 'true' : 'false');
        }
        document.getElementById('btn-drawing-mode')?.classList.toggle('active', drawing);
        this.updateDesktopZoomVisibility();
        this.renderQuickActionsHeaderIcons();
        BoardSort.refreshMenu();
    }

    updateDesktopZoomVisibility() {
        if (AppState.workspaceMode === 'drawing' || MagicFocus.isOpen()) {
            DesktopZoom.apply({ enabled: false });
            return;
        }
        const show = AppState.user.isLoggedIn && DesktopZoom.isDesktopViewport();
        DesktopZoom.apply({ enabled: show });
    }

    setupLayoutResetButton() { return Listeners.setupLayoutResetButton(this); }

    setupSearchBar() { return Listeners.setupSearchBar(this); }

    updateLayoutResetVisibility() {
        const show = AppState.user.isLoggedIn && AppState.workspaceMode !== 'drawing';
        const btn = document.getElementById('btn-layout-reset');
        const sortBtn = document.getElementById('btn-board-sort');
        btn?.classList.toggle('is-hidden', !show);
        sortBtn?.classList.toggle('is-hidden', !show);
        if (btn && show) {
            const fc = AppState.viewSettings.fileCabinet && AppState.workspaceMode !== 'drawing';
            const title = fc ? 'File all to cabinet' : 'Reset layout';
            btn.title = title;
            btn.setAttribute('aria-label', title);
        }
        if (sortBtn && show) BoardSort.syncButtonState();
        this.updateDesktopZoomVisibility();
    }

    setupCoreListeners() { return Listeners.setupCoreListeners(this); }
}

const CoreApp = new Application();
document.addEventListener('DOMContentLoaded', () => CoreApp.init());
