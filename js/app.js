/** @module {"owns":"application orchestration, event bus listeners, workspace init", "related":["api.js","ui.js","layoutStorage.js"], "events":["item:mutation_requested","item:selected_for_edit","board:visibility_changed","calendar:add_note"]} */
import { API } from './api.js';
import { AppState } from './app/state.js';
import { UI } from './ui.js';
import { BoardOperations } from './boardOperations.js';
import { Editor } from './editor.js';
import { ToolsManager } from './toolsManager.js';
import { Calendar } from './calendar.js';
import { SidePanel } from './hamburger.js';
import { reconcileLayoutStorage } from './layoutStorage.js';
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
import { initShellResize } from './shellResize.js';
import { initSidebarDetach } from './sidebarDetach.js';
import { initUndockedSidebarStacking } from './desktopStack.js';
import { BoardRulers } from './boardRulers.js';
import * as Listeners from './app/listeners.js';
import * as Services from './app/services.js';
import * as DrawingMode from './app/drawingMode.js';
import * as ViewChrome from './app/viewChrome.js';

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

    renderControlBar() { return ViewChrome.renderControlBar(this); }

    renderQuickActions() { return ViewChrome.renderQuickActions(this); }

    setupQuickActionsHeaderListeners() { return Listeners.setupQuickActionsHeaderListeners(this); }

    renderQuickActionsHeaderIcons() { return ViewChrome.renderQuickActionsHeaderIcons(this); }

    updateFabVisibility(opts = {}) { return ViewChrome.updateFabVisibility(this, opts); }

    onMagicFocusEnter(opts = {}) { return ViewChrome.onMagicFocusEnter(this, opts); }

    applyDesktopDockAfterFocusEnter() { return ViewChrome.applyDesktopDockAfterFocusEnter(this); }

    applyDesktopDockAfterFocusLeave() { return ViewChrome.applyDesktopDockAfterFocusLeave(this); }

    async onMagicFocusLeave(opts = {}) { return ViewChrome.onMagicFocusLeave(this, opts); }

    async exitDrawingForFocus() { return DrawingMode.exitDrawingForFocus(this); }

    isDrawingMode() {
        return AppState.workspaceMode === 'drawing';
    }

    stateWorkspaceMode() {
        return AppState.workspaceMode;
    }

    setupScribbleFab() { return Listeners.setupScribbleFab(this); }

    setupDrawingMode() { return Listeners.setupDrawingMode(this); }

    async switchWorkspaceMode(mode) { return DrawingMode.switchWorkspaceMode(this, mode); }

    async applyWorkspaceMode(mode, opts = {}) { return DrawingMode.applyWorkspaceMode(this, mode, opts); }

    async enterNoteCanvasMode(item) { return DrawingMode.enterNoteCanvasMode(this, item); }

    async enterFlowchartMode(item) { return DrawingMode.enterFlowchartMode(this, item); }

    async exitNoteCanvasMode(item) { return DrawingMode.exitNoteCanvasMode(this, item); }

    async executeDataBackupExport() { return Services.executeDataBackupExport(this); }

    async executeFullBackupExport() { return Services.executeFullBackupExport(this); }

    executeExportAllTxt() { return Services.executeExportAllTxt(this); }

    setupBackupInterface() { return Services.setupBackupInterface(this); }

    executeAddCategory(opts = {}) { return Services.executeAddCategory(this, opts); }

    executeAddCategoryPrompt(anchorEl = null) { return Services.executeAddCategoryPrompt(this, anchorEl); }

    executeLoginPrompt() { return Services.executeLoginPrompt(this); }

    executeLogout() { return Services.executeLogout(this); }

    migrateBoardOverlayFromFreeform() { return DrawingMode.migrateBoardOverlayFromFreeform(this); }

    async toggleBoardOverlay() { return ViewChrome.toggleBoardOverlay(this); }

    async toggleFileCabinet() { return ViewChrome.toggleFileCabinet(this); }

    updateViewToggleState() { return ViewChrome.updateViewToggleState(this); }

    updateDesktopZoomVisibility() { return ViewChrome.updateDesktopZoomVisibility(this); }

    setupLayoutResetButton() { return Listeners.setupLayoutResetButton(this); }

    setupSearchBar() { return Listeners.setupSearchBar(this); }

    updateLayoutResetVisibility() { return ViewChrome.updateLayoutResetVisibility(this); }

    setupCoreListeners() { return Listeners.setupCoreListeners(this); }
}

const CoreApp = new Application();
document.addEventListener('DOMContentLoaded', () => CoreApp.init());
