/** @module {"owns":"application orchestration, event bus listeners, workspace init", "related":["api.js","ui.js","layoutStorage.js"], "events":["item:mutation_requested","item:selected_for_edit","board:visibility_changed","calendar:add_note"]} */
import { API } from './api.js';
import { ACTION_ICONS } from './icons.js';
import { createDefaultNote } from './noteModel.js';
import { NoteSurface } from './noteSurface.js';
import { UI } from './ui.js';
import { BoardOperations } from './boardOperations.js';
import { Editor } from './editor.js';
import { DragDropEngine } from './dragdrop.js';
import { ToolsManager } from './toolsManager.js';
import { Calendar } from './calendar.js';
import { SidePanel } from './hamburger.js';
import { LoadingManager } from './loadingUtils.js';
import { applyBackupToStorage, backupFilename, buildBackupPackage, buildFullBackupArchivePayload, importFullBackupArchive, parseBackupPackage, serializeBackupPackage, txtExportFilename, writeLastLocalExportAt, writeLastLocalTxtExportAt, writeLastMediaZipExportAt } from './backup.js';
import { reconcileLayoutStorage } from './layoutStorage.js';
import {
    DEFAULT_CATEGORIES,
    isUncategorizedCategory,
    normalizeCategories,
    readStoredCategories,
    UNCATEGORIZED_COLOR,
    writeStoredCategories,
    categoryKey,
    getLastCategoryWriteAliases,
    applyCategoryAliasesToItems,
    validateNewCategoryName,
    addCategoryToRegistry,
    updateCategoryColor
} from './categories.js';
import { UndoManager, historyLabelForItem, mergeItemOntoExisting } from './undo.js';
import { NotePopoutBridge } from './notePopoutBridge.js';
import { shouldRefreshPopoutLockedCard } from './popoutLockRefresh.js';
import { DesktopBackground } from './desktopBackground.js';
import { ChromeBackground } from './chromeBackground.js';
import { ClockStyle } from './clockStyle.js';
import { ColorPicker, PALETTE_NOTE, randomNoteColor } from './colorPicker.js';
import { DisplayOptions } from './displayOptions.js';
import { applyTileSmallFootprint } from './tileFootprint.js';
import {
    initGridMetrics,
    migrateCompactDefaultsIfNeeded,
    migrateCardMinimumFootprintIfNeeded,
    migrateGridSpanCardWidthIfNeeded,
    migrateLegacyGridLayoutIfNeeded
} from './gridDensity.js';
import { AppTheme, readUserTheme, applyUserTheme } from './appTheme.js';
import { DesktopZoom } from './desktopZoom.js';
import { NoteFontScale } from './noteFontScale.js';
import { BoardOverlay } from './boardOverlay.js';
import { readViewSessions, restoreViewSession, normalizeViewMode } from './viewSession.js';
import { DrawingBoard } from './drawingBoard.js';
import { SearchBar } from './searchBar.js';
import { Fullscreen } from './fullscreen.js';
import { SidebarRadio } from './sidebarRadio.js';
import { SidebarTv } from './sidebarTv.js';
import { SidebarWeather } from './sidebarWeather.js';
import { MediaLibraryOverlay, bindMediaFilePickers } from './mediaLibraryOverlay.js';
import { MediaStagingDialog } from './mediaStagingDialog.js';
import { MediaPasteCatcher, readClipboardIntoStaging } from './mediaPasteCatcher.js';
import { registerLiveNoteSource, setModalEditorNoteIdResolver } from './notePasteContext.js';
import { initAllSidebarModules } from './sidebarModules.js';
import { SidebarStats } from './sidebarStats.js';
import { SidebarHistory } from './sidebarHistory.js';
import { CloudBackup } from './cloudBackup.js';
import { ScheduledBackup } from './scheduledBackup.js';
import { BoardSort } from './boardSort.js';
import { BootProgress } from './bootProgress.js';
import { renderQuickActions } from './noteQuickActions.js';
import { DesktopDock } from './desktopDockComponent.js';
import { DesktopManager } from './desktopManager.js';
import { TemplatePicker } from './templatePicker.js';
import { itemToTxtExportText, sortItemsForTxtExport } from './noteBodyConversion.js';
import { initCrossTabSync, broadcastStateChange } from './sync.js';
import { readDisplayOptions, applyDisplayOptions } from './displayOptions.js';
import { showAppToast } from './toast.js';
import {
    migrateItemsToFileCabinet,
    pruneFileCabinetOrderByLayout,
    setFileCabinetActive,
    appendFileCabinetCategoryOrder,
    removeCategoryFromFileCabinetLayout,
    applyCategoryColorLive
} from './fileCabinet.js';
import { getItemCategoryName } from './focusFilter.js';
import { initShellResize } from './shellResize.js';
import { initUndockedSidebarStacking } from './desktopStack.js';
import { BoardRulers } from './boardRulers.js';

function countHiddenFromBoard(items) {
    return items.filter(item => BoardOperations.isHiddenFromBoard(item)).length;
}

const AppState = {
    user: { isLoggedIn: false, token: null },
    items: [],
    categories: [...DEFAULT_CATEGORIES],
    hiddenCategories: JSON.parse(localStorage.getItem('matrix_hidden_categories') || '[]'),
    workspaceMode: (() => {
        const mode = localStorage.getItem('matrix_workspace_mode');
        return mode === 'drawing' ? 'drawing' : 'notes';
    })(),
    viewSettings: {
        sortBy: normalizeViewMode(
            localStorage.getItem('matrix_desktop_layout')
                || localStorage.getItem('matrix_preferred_view')
                || 'grid'
        ),
        fileCabinet: localStorage.getItem('matrix_file_cabinet') === 'true',
        currentView: 'active'
    }
};

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
            await reconcileLayoutStorage({
                items: API._getLocalDB().items,
                categories: AppState.categories
            });
            this.migrateBoardOverlayFromFreeform();
            BootProgress.set(60, 'Layout…');
            await this.syncDataStore();
BootProgress.set(85, 'Workspace…');
            this.setupCoreListeners();
            SidePanel.init(AppState);
            // Refresh desktop dock with note counts
            DesktopDock.refreshButtons(AppState.items);
            initShellResize();
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
            SidebarRadio.init();
            SidebarTv.init();
            SidebarWeather.init();
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
            MediaPasteCatcher.init();
            bindMediaFilePickers();
            this.setupMediaFab();
            SidePanel.setupStatusClickHandlers(); /* after radio/tv/weather shells exist */
            this.renderQuickActionsHeaderIcons();
            SidebarHistory.init(AppState);
            SidebarStats.init();
            initAllSidebarModules();
            this.setupLayoutResetButton();
            SidebarHistory.renderPanel();
            ClockStyle.init();
            DesktopZoom.init();
            this.setupSearchBar();
            this.setupBackupInterface();
            CloudBackup.init({ getLoggedIn: () => AppState.user.isLoggedIn });
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
            if (AppState.workspaceMode === 'drawing') {
                await this.applyWorkspaceMode('drawing', { skipPersist: true });
            }

            // Initialize Desktop Dock after workspace is ready
            DesktopDock.init();
        } finally {
            await BootProgress.complete();
        }
    }

    setupUndo() {
        UndoManager.init({
            getToken: () => AppState.user.token,
            isEnabled: () => AppState.user.isLoggedIn,
            onRestore: (item, { preserveView = false } = {}) => this.restoreItem(item, preserveView),
            onRemove: (itemId) => this.removeItemFromWorkspace(itemId),
            onStackChange: () => {
                SidebarHistory.renderPanel();
                this.renderQuickActionsHeaderIcons();
                NotePopoutBridge.broadcastUndoChanged();
            }
        });

        const entryNoteId = (entry) => entry?.before?.id || entry?.item?.id || entry?.after?.id || null;
        const guardPopoutHistory = (action) => {
            const original = UndoManager[action].bind(UndoManager);
            UndoManager[action] = async function guardedHistoryAction(...args) {
                const stack = action === 'undo' ? this.undoStack : this.redoStack;
                const entry = stack[stack.length - 1];
                const noteId = entryNoteId(entry);
                if (noteId && NotePopoutBridge.isClaimedByOther(noteId)) {
                    showAppToast('Undo/redo that note in its popout window');
                    NotePopoutBridge.openOrFocus(noteId);
                    return;
                }
                return original(...args);
            };
        };
        guardPopoutHistory('undo');
        guardPopoutHistory('redo');
    }

    setupNotePopoutBridge() {
        NotePopoutBridge.init({
            role: 'main',
            handlers: {
                onClaimChanged: (noteId, item) => this.handlePopoutClaimChanged(noteId, item),
                onClaimsStorageSync: () => this.handleClaimsStorageSync(),
                onNoteSaved: (noteId, item) => this.handlePopoutNoteSaved(noteId, item),
                onUndoChanged: () => {
                    if (!UndoManager.isApplying) {
                        UndoManager.reloadFromStorage();
                        SidebarHistory.renderPanel();
                        this.renderQuickActionsHeaderIcons();
                    }
                }
            }
        });
        // Refresh any notes already claimed by surviving popouts.
        NotePopoutBridge.syncAllPopoutButtons();
        this.refreshPopoutLockedCards();
    }

    handleClaimsStorageSync() {
        this.refreshPopoutLockedCards();
    }

    handlePopoutClaimChanged(noteId, closedItem = null) {
        NotePopoutBridge.syncAllPopoutButtons();
        if (noteId) {
            // Claim released (popped back in) — prefer snapshot from popout_closed,
            // else reload from disk so unlock paints latest content.
            if (!NotePopoutBridge.isClaimedByOther(noteId) && !NotePopoutBridge.isPoppedOut(noteId)) {
                const fresh = closedItem
                    || API._getLocalDB()?.items?.find((it) => it.id === noteId);
                if (fresh) {
                    const idx = AppState.items.findIndex((it) => it.id === noteId);
                    if (idx >= 0) Object.assign(AppState.items[idx], fresh);
                    else AppState.items.push(fresh);
                    UI.updateBoardItemsMap?.(idx >= 0 ? AppState.items[idx] : fresh);
                }
            }
            this.refreshPopoutLockedCard(noteId);
            if (Editor.activeItem?.id === noteId && NotePopoutBridge.isClaimedByOther(noteId)) {
                Editor.close?.();
            }
            return;
        }
        this.handleClaimsStorageSync();
    }

    refreshPopoutLockedCards() {
        const canvas = document.getElementById('app-canvas');
        if (!canvas) return;
        canvas.querySelectorAll('.mini-card[data-id]').forEach((card) => {
            const id = card.dataset.id;
            if (!id || !shouldRefreshPopoutLockedCard(id, card, NotePopoutBridge)) return;
            const item = AppState.items.find((it) => it.id === id);
            if (item) UI.updateSingleCard(canvas, item, AppState.hiddenCategories);
        });
    }

    refreshPopoutLockedCard(noteId) {
        if (!noteId) return;
        const canvas = document.getElementById('app-canvas');
        const item = AppState.items.find((it) => it.id === noteId);
        const card = canvas?.querySelector(`.mini-card[data-id="${CSS.escape(noteId)}"]`);
        if (!canvas || !item || !card || !shouldRefreshPopoutLockedCard(noteId, card, NotePopoutBridge)) {
            NotePopoutBridge.syncAllPopoutButtons();
            return;
        }
        UI.updateSingleCard(canvas, item, AppState.hiddenCategories);
        NotePopoutBridge.syncPopoutButtonUI(
            canvas.querySelector(`.mini-card[data-id="${CSS.escape(noteId)}"] .card-act--popout`),
            noteId
        );
    }

    handlePopoutNoteSaved(noteId, remoteItem) {
        if (!noteId) return;
        const idx = AppState.items.findIndex((it) => it.id === noteId);
        if (remoteItem) {
            if (idx >= 0) Object.assign(AppState.items[idx], remoteItem);
            else AppState.items.push(remoteItem);
            UI.updateBoardItemsMap?.(idx >= 0 ? AppState.items[idx] : remoteItem);
        } else if (idx >= 0) {
            // Reload from storage if payload missing
            const fresh = API._getLocalDB()?.items?.find((it) => it.id === noteId);
            if (fresh) Object.assign(AppState.items[idx], fresh);
        }
        const live = AppState.items.find((it) => it.id === noteId);
        if (!live) return;
        const canvas = document.getElementById('app-canvas');
        if (canvas) UI.updateSingleCard(canvas, live, AppState.hiddenCategories);
        if (Editor.activeItem?.id === noteId && !Editor.overlay?.classList.contains('is-hidden')) {
            Editor.activeItem = NoteSurface.snapshotItem(live);
            Editor.renderForm();
        }
        this.updateWorkspaceCounter();
    }

    setupCrossTabSync() {
        let toastShown = false;
        initCrossTabSync({
            onBoardRefresh: (scopes, info) => this.refreshBoardFromSync(scopes, info),
            onVisualRefresh: (scope) => this.applyVisualFromSync(scope),
            onDeferred: () => {
                if (!toastShown) {
                    toastShown = true;
                    showAppToast('Another window changed the workspace — will refresh when you finish');
                }
            },
            onRefreshed: () => {
                toastShown = false;
            }
        });
    }

    /** Re-sync cached AppState + re-render the board/sidebar from shared storage. */
    async refreshBoardFromSync(scopes, info) {
        const canvas = document.getElementById('app-canvas');
        if (!canvas) return;

        // Re-read the single source of truth (localStorage) into the cached state
        // so the UI paints whatever the other tab committed.
        AppState.hiddenCategories = JSON.parse(localStorage.getItem('matrix_hidden_categories') || '[]');
        const remoteWorkspaceMode = localStorage.getItem('matrix_workspace_mode') === 'drawing' ? 'drawing' : 'notes';
        AppState.viewSettings.sortBy = normalizeViewMode(
            localStorage.getItem('matrix_desktop_layout')
                || localStorage.getItem('matrix_preferred_view')
                || 'grid'
        );
        AppState.viewSettings.fileCabinet = localStorage.getItem('matrix_file_cabinet') === 'true';

        // If another tab changed the workspace mode, apply it before doing any
        // notes-board work (and skip the notes re-render while in drawing mode).
        // Note-canvas is a local-only session: it sets memory workspaceMode to
        // 'drawing' without persisting matrix_workspace_mode, so localStorage
        // still says 'notes'. Do not treat that mismatch as a remote switch.
        if (
            !DrawingBoard.isNoteCanvasMode
            && remoteWorkspaceMode !== AppState.workspaceMode
        ) {
            AppState.workspaceMode = remoteWorkspaceMode;
            await this.applyWorkspaceMode(remoteWorkspaceMode, { skipPersist: true });
        }

        if (AppState.workspaceMode === 'drawing') return;

        const data = API._getLocalDB();
        if (Array.isArray(data?.items)) {
            AppState.items = DesktopManager.sanitizeNotesDesktops(data.items);
        }
        this.applyPendingCategoryAliases();

        // Single-note saves hint a targeted card refresh — cheapest path. Any
        // other scope (or a structural change in the notes set) uses a full re-render.
        const isSingleNote = scopes.length === 1
            && scopes[0] === 'notes'
            && info?.noteId
            && !info?.deleted
            && AppState.items.some((i) => i.id === info.noteId);
        if (isSingleNote && !this.isUserBusyOnCard(info.noteId)) {
            const item = AppState.items.find((i) => i.id === info.noteId);
            if (item) UI.updateSingleCard(canvas, item, AppState.hiddenCategories);
        } else {
            UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
        }

        // A cross-tab refresh just rebuilt the board DOM (or replaced
        // AppState.items) — rebind drag/resize listeners and refresh the
        // engine's captured items, matching the render+init pairing used by
        // every other render site. Skipping this left new cards without
        // mousedown bindings (drag locked) and the engine on a stale array.
        DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());

        this.refreshSidebarAfterSync();
    }

    /** True if this tab is actively editing the given card — don't clobber it. */
    isUserBusyOnCard(noteId) {
        if (!noteId) return false;
        const active = document.activeElement?.closest?.('.card-inline-edit');
        if (!active) return false;
        const card = active.closest?.('.mini-card');
        return !!card && card.dataset?.id === noteId;
    }

    /* Keep the sidebar/dock/history chrome in step after a sync refresh. */
    refreshSidebarAfterSync() {
        this.updateWorkspaceCounter();
        DesktopDock.refreshButtons(AppState.items);
        NotePopoutBridge.syncAllPopoutButtons();
        SidebarHistory.renderPanel();
        this.renderQuickActionsHeaderIcons();
        BoardSort.refreshMenu();
        Calendar.refresh?.();
    }

    /* Immediate, non-destructive re-apply for theme/display scopes. */
    applyVisualFromSync(scope) {
        if (scope === 'theme') {
            applyUserTheme(readUserTheme());
        } else if (scope === 'display') {
            applyDisplayOptions(readDisplayOptions());
            DesktopZoom.apply();
            BoardRulers.sync?.();
        }
    }

    async removeItemFromWorkspace(itemId) {
        AppState.items = AppState.items.filter((i) => i.id !== itemId);
        if (Editor.activeItem?.id === itemId) Editor.close();
        await this.syncDataStore();
    }

    async restoreItem(item, preserveView = false) {
        // Undo/redo change entries carry only content fields + id (see
        // UndoManager.recordItemChange in js/undo.js). Merge those back onto the
        // existing full note so theme/color/category/layout metadata is never
        // dropped — otherwise an undo would re-render the note as black/default.
        const idx = AppState.items.findIndex((i) => i.id === item.id);
        const merged = idx >= 0 ? mergeItemOntoExisting(AppState.items[idx], item) : item;
        if (idx >= 0) AppState.items[idx] = merged;
        else AppState.items.push(merged);

        NotePopoutBridge.broadcastNoteSaved(merged.id, NoteSurface.snapshotItem(merged));

        if (Editor.activeItem?.id === item.id && !Editor.overlay?.classList.contains('is-hidden')) {
            Editor.activeItem = NoteSurface.snapshotItem(merged);
            Editor.renderForm();
            Editor.updateEditorSizeLabel();
        }

        if (preserveView) {
            const canvas = document.getElementById('app-canvas');
            UI.updateSingleCard(canvas, merged, AppState.hiddenCategories);
            if (AppState.viewSettings.sortBy === 'grid') {
                DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
            }
            this.updateWorkspaceCounter();
            return;
        }
        
        // Handle desktop switching for undo/redo
        const itemDesktop = item?.desktopId || 1;
        const currentDesktop = DesktopManager.getActiveDesktop();
        const needsDesktopSwitch = itemDesktop !== currentDesktop;
        
        if (needsDesktopSwitch) {
            DesktopManager.setActiveDesktop(itemDesktop);
        }
        
        await this.syncDataStore();
        
        // After sync, highlight and scroll to the card
        requestAnimationFrame(() => {
            const canvas = document.getElementById('app-canvas');
            if (!canvas) return;
            
            // Find the card - it may be on a different desktop now
            const card = canvas.querySelector(`.mini-card[data-id="${CSS.escape(item.id)}"]`);
            if (!card) return;
            
            // Add highlight class
            card.classList.add('card-highlighted');
            
            // Scroll to the card
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            
            // Remove highlight class after animation completes
            card.addEventListener('animationend', () => {
                card.classList.remove('card-highlighted');
            }, { once: true });
        });
    }

    checkAuthSession() {
        const cachedToken = localStorage.getItem('admin_token')?.trim() || '';
        const validToken = API._getLocalDB().auth?.admin_token || '';
        if (cachedToken && cachedToken === validToken) {
            AppState.user.isLoggedIn = true;
            AppState.user.token = cachedToken;
            return;
        }
        if (cachedToken) localStorage.removeItem('admin_token');
        AppState.user.isLoggedIn = false;
        AppState.user.token = null;
    }

    // Diagnostics from the latest repairDatabase() run (normal load or save).
    // Logged in the console for observability — no toast, no permanent UI.
    logRepairDiagnostics() {
        try {
            const diagnostics = API.getLastRepairDiagnostics();
            if (!diagnostics) return;
            if (diagnostics.schemaUpgraded
                || diagnostics.stepIdsMigrated > 0
                || diagnostics.duplicateCategoriesDetected.length > 0
                || diagnostics.warnings.length > 0) {
                console.info('[repairDatabase]', diagnostics);
            }
        } catch {
            /* diagnostics are best-effort */
        }
    }

    loadCategoriesStore() {
        const storedCats = localStorage.getItem('matrix_custom_categories');
        if (storedCats) {
            try {
                const parsed = normalizeCategories(JSON.parse(storedCats), { keepEmpty: true });
                if (parsed.length) {
                    AppState.categories = writeStoredCategories(parsed, { keepEmpty: true });
                    this._pendingCategoryAliases = getLastCategoryWriteAliases();
                    return;
                }
            } catch {
                /* ignore */
            }
        }

        if (!AppState.categories?.length) {
            const db = API._getLocalDB();
            AppState.categories = writeStoredCategories(normalizeCategories(db.settings?.categories || []));
            this._pendingCategoryAliases = getLastCategoryWriteAliases();
        }
    }

    applyPendingCategoryAliases() {
        const aliases = this._pendingCategoryAliases;
        this._pendingCategoryAliases = null;
        if (!aliases || !Object.keys(aliases).length) return;
        (AppState.items || []).forEach((item) => {
            if (!item?.categories?.length) return;
            const beforeItem = NoteSurface.snapshotItem(item);
            const changed = applyCategoryAliasesToItems([item], aliases);
            if (!changed) return;
            NoteSurface.emitItemMutation(item, {
                preserveView: true,
                beforeItem,
                skipRerender: true,
                skipUndo: true
            });
        });
    }

    async syncDataStore() {
        // Show loading indicator on app-canvas during sync
        const canvas = document.getElementById('app-canvas');
        if (canvas) {
            LoadingManager.show(canvas, 'Syncing data...');
        }
        
        const task = this._syncQueue.then(() => this._syncDataStoreInner());
        this._syncQueue = task.catch(() => {});
        task.finally(() => {
            if (canvas) {
                LoadingManager.hide(canvas);
            }
        });
        return task;
    }

    async _syncDataStoreInner() {
        const canvas = document.getElementById('app-canvas');
        try {
            if (canvas && AppState.workspaceMode !== 'drawing') {
                UI.flushLayoutFromCanvas(canvas, AppState.viewSettings.sortBy);
            }

            // Never re-read items from storage while a mutation save is still in
            // flight: a render rebuilt from stale ancestors (e.g. File Cabinet toggle
            // right after drawing) could otherwise make the freshly drawn note canvas
            // invisible on the board. Wait for pending saves to settle first.
            if (this._pendingItemSaves?.size) {
                await Promise.allSettled([...this._pendingItemSaves]);
            }

            const data = await API.fetchItems(AppState.user.token);
            AppState.items = Array.isArray(data?.items) ? data.items : [];
            AppState.items = DesktopManager.sanitizeNotesDesktops(AppState.items);
            this.applyPendingCategoryAliases();

            if (AppState.workspaceMode === 'drawing') {
                /* board hidden — skip note canvas rebuild */
            } else if (AppState.items.length === 0 && !data?.write_access && (data?.total_items || 0) > 0) {
                canvas.innerHTML = `<div class="system-status-msg">Notes are in local storage but require admin login. Use Quick actions → Login (default dev token: dev-admin-secret-2026).</div>`;
            } else {
                UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
            }

            DesktopZoom.apply();
            if (AppState.workspaceMode !== 'drawing') {
                DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
            }
        } catch (err) {
            console.error('[Fatal Sync Failure] Data sync broken:', err);
            if (canvas) {
                canvas.innerHTML = `<div class="system-status-msg">Failed to load workspace data. Try importing a backup or clearing site storage.</div>`;
            }
        } finally {
            this.updateWorkspaceCounter();
        }
    }

    updateWorkspaceCounter() {
        SidePanel.updateCategories(AppState.categories, AppState.hiddenCategories, AppState.items);
        SidePanel.updateNotesList(AppState.items);
        SidebarStats.update();
    }

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
                onAddCategory: (e) => this.executeAddCategoryPrompt(e?.currentTarget),
                onCloudClick: (e) => CloudBackup.handleCloudClick(e.currentTarget),
                onCloudExport: (e) => CloudBackup.exportCheckpoint(e.currentTarget),
                onCloudImport: (e) => CloudBackup.handleImportClick(e.currentTarget),
                onExportDb: () => this.executeDataBackupExport(),
                onExportAll: () => this.executeFullBackupExport(),
                onExportAllTxt: () => this.executeExportAllTxt(),
                onScheduleExport: (e) => ScheduledBackup.handleClick(e.currentTarget),
                onImportDb: () => document.getElementById('system-import-file-picker').click(),
                onImportAll: () => document.getElementById('system-import-all-picker').click(),
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

    setupQuickActionsHeaderListeners() {
        const headerFreeform = document.getElementById('qa-header-freeform-toggle');
        const headerCabinet = document.getElementById('qa-header-file-cabinet-toggle');
        const headerUndo = document.getElementById('qa-header-undo');
        const headerRedo = document.getElementById('qa-header-redo');

        // Bind once natively using dataset checks to prevent listener pileups
        if (headerFreeform && !headerFreeform.dataset.listenerBound) {
            headerFreeform.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleBoardOverlay();
            });
            headerFreeform.dataset.listenerBound = 'true';
        }
        if (headerCabinet && !headerCabinet.dataset.listenerBound) {
            headerCabinet.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleFileCabinet();
            });
            headerCabinet.dataset.listenerBound = 'true';
        }
        if (headerUndo && !headerUndo.dataset.listenerBound) {
            headerUndo.addEventListener('click', (e) => {
                e.stopPropagation();
                UndoManager.undo();
            });
            headerUndo.dataset.listenerBound = 'true';
        }
        if (headerRedo && !headerRedo.dataset.listenerBound) {
            headerRedo.addEventListener('click', (e) => {
                e.stopPropagation();
                UndoManager.redo();
            });
            headerRedo.dataset.listenerBound = 'true';
        }
    }

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

    updateFabVisibility() {
        const fab = document.getElementById('fab-create');
        const mediaFab = document.getElementById('fab-media');
        const inDrawing = AppState.workspaceMode === 'drawing';
        if (fab) {
            fab.classList.toggle('is-hidden', inDrawing);
            if (!inDrawing) {
                const needsLogin = !AppState.user.isLoggedIn;
                fab.title = needsLogin ? 'New note (login required)' : 'New note';
                fab.setAttribute('aria-label', fab.title);
            }
        }
        if (mediaFab) {
            mediaFab.classList.toggle('is-hidden', inDrawing);
        }
    }

    setupMediaFab() {
        const mediaFab = document.getElementById('fab-media');
        if (!mediaFab) return;
        mediaFab.innerHTML = ACTION_ICONS.mediaPaste;
        mediaFab.addEventListener('click', () => {
            readClipboardIntoStaging();
        });
    }

    setupDrawingMode() {
        document.addEventListener('keydown', (e) => {
            if (DrawingBoard.handleKeydown(e)) return;
        });
    }

    async switchWorkspaceMode(mode) {
        if (mode !== 'notes' && mode !== 'drawing') return;
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

    async exitNoteCanvasMode(item) {
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

    async executeDataBackupExport() {
        // Show loading indicator on the export button
        const exportBtn = document.getElementById('btn-export-db');
        if (exportBtn) {
            LoadingManager.show(exportBtn, 'Exporting backup...');
        }
        
        try {
            const backupPackage = await buildBackupPackage();
            const blob = new Blob([serializeBackupPackage(backupPackage)], { type: 'application/json' });
            const virtualLink = document.createElement('a');
            virtualLink.href = URL.createObjectURL(blob);
            virtualLink.download = backupFilename(backupPackage.timestamp);
            virtualLink.click();
            URL.revokeObjectURL(virtualLink.href);
            writeLastLocalExportAt(backupPackage.timestamp);
            SidebarStats.update();
        } finally {
            // Hide loading indicator
            const exportBtn = document.getElementById('btn-export-db');
            if (exportBtn) {
                LoadingManager.hide(exportBtn);
            }
        }
    }

    async executeFullBackupExport() {
        const exportBtn = document.getElementById('btn-export-all');
        if (exportBtn) {
            LoadingManager.show(exportBtn, 'Exporting all...');
        }
        try {
            const payload = await buildFullBackupArchivePayload();
            const virtualLink = document.createElement('a');
            virtualLink.href = URL.createObjectURL(payload.blob);
            virtualLink.download = payload.filename;
            virtualLink.click();
            URL.revokeObjectURL(virtualLink.href);
            writeLastLocalExportAt(payload.timestamp);
            writeLastMediaZipExportAt(payload.timestamp);
            SidebarStats.update();
            showAppToast('Exported full backup archive');
        } catch (err) {
            console.error('[Export all]', err);
            showAppToast(err?.message || 'Export all failed');
        } finally {
            const btn = document.getElementById('btn-export-all');
            if (btn) LoadingManager.hide(btn);
        }
    }

    executeExportAllTxt() {
        // Show loading indicator on the export button
        const exportBtn = document.getElementById('btn-export-txt');
        if (exportBtn) {
            LoadingManager.show(exportBtn, 'Exporting TXT...');
        }

        try {
            // Get all items (active, archived, hidden)
            const allItems = [...AppState.items];
            
            // Sort items by category (primary) and date (secondary, newest first)
            const sortedItems = sortItemsForTxtExport(allItems);
            
            // Build export content with section dividers
            const sections = [];
            let currentCategory = null;
            
            sortedItems.forEach((item) => {
                const categories = Array.isArray(item?.categories) ? item.categories.filter(Boolean) : [];
                const itemCategory = categories.length > 0 ? categories[0] : 'Uncategorized';
                
                // Add section divider when category changes
                if (itemCategory !== currentCategory) {
                    if (currentCategory !== null) {
                        sections.push('\n\n---\n\n');
                    }
                    currentCategory = itemCategory;
                }
                
                const itemText = itemToTxtExportText(item);
                if (itemText) {
                    sections.push(itemText);
                }
            });
            
            const content = sections.join('\n\n');

            // Report export size
            const lineCount = content.split('\n').length;
            showAppToast(`Exported ${lineCount} lines from ${sortedItems.length} notes`);

            const blob = new Blob([content], { type: 'text/plain' });
            const virtualLink = document.createElement('a');
            virtualLink.href = URL.createObjectURL(blob);
            virtualLink.download = txtExportFilename();
            virtualLink.click();
            URL.revokeObjectURL(virtualLink.href);
            writeLastLocalTxtExportAt(Math.floor(Date.now() / 1000));
            SidebarStats.update();
        } finally {
            // Hide loading indicator
            const exportBtn = document.getElementById('btn-export-txt');
            if (exportBtn) {
                LoadingManager.hide(exportBtn);
            }
        }
    }

    setupBackupInterface() {
        const filePicker = document.getElementById('system-import-file-picker');
        if (filePicker) {
            filePicker.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                // Show loading indicator on file picker
                LoadingManager.show(filePicker, 'Importing backup...');
                
                const reader = new FileReader();
                reader.onload = async (event) => {
                    try {
                        const parsedBackup = parseBackupPackage(event.target.result);
                        await applyBackupToStorage(parsedBackup);
                        const storedDb = JSON.parse(localStorage.getItem('matrix_database') || 'null');
                        const itemCount = Array.isArray(storedDb?.items) ? storedDb.items.length : 0;
                        const patchNote = parsedBackup.delta ? ' Applied an incremental patch.' : '';
                        const token = parsedBackup.matrix_database?.auth?.admin_token;
                        const tokenNote = token
                            ? ' Admin session restored from backup.'
                            : ' Log in with your admin token to see private notes.';
                        alert(`Restore successful (${itemCount} items).${tokenNote}${patchNote}`);
                        window.location.reload();
                    } catch (err) {
                        console.error('[Import]', err);
                        alert('Import Aborted: Invalid or unsupported backup file.');
                    } finally {
                        // Hide loading indicator
                        LoadingManager.hide(filePicker);
                        filePicker.value = '';
                    }
                };
                reader.readAsText(file);
            });
        }

        const archivePicker = document.getElementById('system-import-all-picker');
        if (archivePicker) {
            archivePicker.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const confirmed = confirm('Restore this full backup archive? Your current workspace and media library will be replaced.');
                if (!confirmed) {
                    archivePicker.value = '';
                    return;
                }
                LoadingManager.show(archivePicker, 'Importing all...');
                try {
                    const parsedBackup = await importFullBackupArchive(file);
                    // Two shapes come back: a checkpoint bundle ({ manifest, applied })
                    // and a legacy full archive (a package with matrix_database).
                    const isCheckpoint = parsedBackup?.manifest?.kind === 'magicnotes_checkpoint';
                    let itemCount = parsedBackup?.matrix_database?.items?.length ?? 0;
                    if (isCheckpoint) {
                        // Delta bundles may carry no notes part, so report what the
                        // library holds after the restore instead of the payload.
                        try {
                            itemCount = JSON.parse(localStorage.getItem('matrix_database') || '{}').items?.length ?? 0;
                        } catch {
                            itemCount = 0;
                        }
                    }
                    alert(isCheckpoint
                        ? `Checkpoint restored (${itemCount} notes). Reloading…`
                        : `Restore successful (${itemCount} items). Reloading…`);
                    window.location.reload();
                } catch (err) {
                    console.error('[Import all]', err);
                    alert(err?.message || 'Import Aborted: Invalid or unsupported archive.');
                } finally {
                    LoadingManager.hide(archivePicker);
                    archivePicker.value = '';
                }
            });
        }
    }

    executeAddCategoryPrompt(anchorEl = null) {
        const anchor = anchorEl || document.getElementById('btn-add-category');
        const nameInput = prompt('Enter Unique New Category Label Name:');
        if (!nameInput || !nameInput.trim()) return;
        const validation = validateNewCategoryName(nameInput, AppState.categories);
        if (!validation.ok) {
            alert(`Conflict: ${validation.error}`);
            return;
        }
        if (!anchor) return;
        ColorPicker.open({
            anchor,
            presets: PALETTE_NOTE,
            value: UNCATEGORIZED_COLOR,
            align: 'end',
            onSelect: (color) => {
                const next = addCategoryToRegistry(validation.cleanName, color, AppState.categories);
                if (!next) return;
                AppState.categories = next;
                appendFileCabinetCategoryOrder(validation.cleanName);
                window.dispatchEvent(new CustomEvent('categories:toggled'));
                window.dispatchEvent(new CustomEvent('filecabinet:layout_changed', { detail: { flushLayout: false } }));
                this.updateWorkspaceCounter();
                const canvas = document.getElementById('app-canvas');
                if (canvas && AppState.workspaceMode !== 'drawing') {
                    UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
                }
            }
        });
    }

    executeLoginPrompt() {
        // Show loading indicator on the login button
        const loginBtn = document.getElementById('btn-auth-login');
        if (loginBtn) {
            LoadingManager.show(loginBtn, 'Logging in...');
        }
        
        try {
            const secretInput = prompt("Enter Admin Security Token Code:");
            if (secretInput) {
                localStorage.setItem('admin_token', secretInput.trim());
                this.checkAuthSession();
                UndoManager.loadStacks();
                this.renderControlBar();
                SidebarHistory.renderPanel();
                this.syncDataStore();
            }
        } finally {
            // Hide loading indicator
            const loginBtn = document.getElementById('btn-auth-login');
            if (loginBtn) {
                LoadingManager.hide(loginBtn);
            }
        }
    }

    executeLogout() {
        // Show loading indicator on the logout button
        const logoutBtn = document.getElementById('btn-auth-logout');
        if (logoutBtn) {
            LoadingManager.show(logoutBtn, 'Logging out...');
        }
        
        try {
            localStorage.removeItem('admin_token');
            AppState.user.isLoggedIn = false;
            AppState.user.token = null;
            UndoManager.clear();
            this.renderControlBar();
            SidebarHistory.renderPanel();
            this.updateLayoutResetVisibility();
            this.syncDataStore();
        } finally {
            // Hide loading indicator
            const logoutBtn = document.getElementById('btn-auth-logout');
            if (logoutBtn) {
                LoadingManager.hide(logoutBtn);
            }
        }
    }

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
            UI.flushAllInlineEditsFromCanvas(canvas, AppState.items);
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
            UI.flushAllInlineEditsFromCanvas(canvas, AppState.items);
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
        if (AppState.workspaceMode === 'drawing') {
            DesktopZoom.apply({ enabled: false });
            return;
        }
        const show = AppState.user.isLoggedIn && DesktopZoom.isDesktopViewport();
        DesktopZoom.apply({ enabled: show });
    }

    setupLayoutResetButton() {
        const btn = document.getElementById('btn-layout-reset');
        if (btn) btn.innerHTML = ACTION_ICONS.layoutReset;
        btn?.addEventListener('click', async () => {
            if (AppState.workspaceMode === 'drawing') {
                await this.switchWorkspaceMode('notes');
            }
            UI.resetBoardLayout(AppState.viewSettings.sortBy, AppState.items, {
                fileCabinetActive: AppState.viewSettings.fileCabinet
            });
        });
    }

    setupSearchBar() {
        SearchBar.init({
            getItems: () => AppState.items,
            onOpenItem: (item) => {
                window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: item }));
            }
        });
    }

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

    setupCoreListeners() {
        window.addEventListener('resize', () => {
            this.updateDesktopZoomVisibility();
            const canvas = document.getElementById('app-canvas');
            if (canvas) UI.updateBoardCanvasExtents(canvas);
        });
        window.addEventListener('desktop:zoom_changed', () => {
            const canvas = document.getElementById('app-canvas');
            if (canvas) {
                UI.updateBoardCanvasExtents(canvas);
            }
        });

        // Beforeunload handler: flush all pending autosaves before page refresh
        // This ensures data is saved when user refreshes the browser
        window.addEventListener('beforeunload', () => {
            // Flush modal editor if open
            const modalOpen = Editor.activeItem && Editor.overlay?.classList.contains('is-open');
            if (modalOpen) {
                Editor.persistNote({ force: true, normalize: true });
            }
            const canvas = document.getElementById('app-canvas');
            if (canvas) {
                // Skip the open modal note — its board card DOM is stale and would
                // clobber the modal persist we just wrote.
                UI.flushAllInlineEditsFromCanvas(canvas, AppState.items, {
                    skipItemId: modalOpen ? Editor.activeItem.id : null
                });
            }
        });

        // Visibilitychange handler: flush pending autosaves when tab becomes hidden
        // This prevents data loss when user switches tabs or minimizes window
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                const modalOpen = Editor.activeItem && Editor.overlay?.classList.contains('is-open');
                if (modalOpen) {
                    Editor.persistNote({ force: true, normalize: true });
                }
                const canvas = document.getElementById('app-canvas');
                if (canvas) {
                    UI.flushAllInlineEditsFromCanvas(canvas, AppState.items, {
                        skipItemId: modalOpen ? Editor.activeItem.id : null
                    });
                }
            }
        });

        window.addEventListener('item:selected_for_edit', (e) => {
            if (!AppState.user.isLoggedIn) {
                alert("Authorization Blocked: Admin privileges required to edit workspace resources.");
                return;
            }
            const detail = e.detail;
            const item = detail?.item ?? detail;
            Editor.open(item, AppState.categories);
        });

        window.addEventListener('note:canvas_draw_requested', (e) => {
            const item = e.detail?.item;
            if (!item?.id) return;
            this.enterNoteCanvasMode(item);
        });

        window.addEventListener('note:canvas_draw_exited', (e) => {
            const item = e.detail?.item;
            this.exitNoteCanvasMode(item);
        });

        window.addEventListener('editor:reveal_on_board', async (e) => {
            const detail = e.detail;
            const item = detail?.item ?? detail;
            // { item, scrollToBoard } from modal close; plain item (legacy) scrolls.
            const shouldScroll = detail?.item
                ? detail.scrollToBoard === true
                : true;
            if (!item?.id) return;

            const idx = AppState.items.findIndex((i) => i.id === item.id);
            if (idx >= 0) {
                Object.assign(AppState.items[idx], item);
            } else {
                AppState.items.push(item);
            }
            const liveItem = idx >= 0 ? AppState.items[idx] : item;
            UI.updateBoardItemsMap(liveItem);

            const canvas = document.getElementById('app-canvas');
            let card = canvas?.querySelector(`.mini-card[data-id="${item.id}"]`);
            if (card) {
                UI.updateSingleCard(canvas, liveItem, AppState.hiddenCategories);
                if (AppState.viewSettings.sortBy === 'grid') {
                    DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
                }
            } else {
                // New note (or card missing from this view): full sync so a board
                // card is created when the note belongs on the active desktop.
                await this.syncDataStore();
                card = canvas?.querySelector(`.mini-card[data-id="${item.id}"]`);
            }

            this.updateWorkspaceCounter();

            if (shouldScroll) {
                requestAnimationFrame(() => {
                    card = canvas?.querySelector(`.mini-card[data-id="${item.id}"]`) || card;
                    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                });
            }
        });

        window.addEventListener('item:mutation_requested', async (e) => {
            if (!AppState.user.isLoggedIn) {
                alert('Login required to save notes. Use Quick actions → Login.');
                return;
            }
            const detail = e.detail;
            const item = detail?.item ?? detail;
            const preserveView = detail?.preserveView === true;
            if (!item?.id) return;

            // Popout owns exclusive edit — ignore main-window mutations for that note.
            if (NotePopoutBridge.isClaimedByOther(item.id) && detail?.fromPopoutSync !== true) {
                return;
            }

            const idx = AppState.items.findIndex((i) => i.id === item.id);
            const beforeSnapshot = detail?.beforeItem
                ? JSON.parse(JSON.stringify(detail.beforeItem))
                : idx >= 0
                    ? JSON.parse(JSON.stringify(AppState.items[idx]))
                    : null;

            const saveTask = API.saveItem(item, AppState.user.token);
            this._pendingItemSaves.add(saveTask);
            const success = await saveTask;
            this._pendingItemSaves.delete(saveTask);
            if (!success) {
                alert('Could not save note. Log in with the correct admin token (default dev: dev-admin-secret-2026).');
                return;
            }

            const skipUndo = detail?.skipUndo === true;
            if (!skipUndo && beforeSnapshot) {
                UndoManager.recordItemChange(beforeSnapshot, item, {
                    preserveView,
                    label: historyLabelForItem(item),
                    mergeKey: detail?.mergeKey,
                    mergeWindow: detail?.mergeWindow !== false
                });
            }

            if (idx !== -1) {
                // Keep the same object reference so board cards / boardItemsById
                // do not hold a zombie copy after modal (or any) skipRerender saves.
                Object.assign(AppState.items[idx], item);
                UI.updateBoardItemsMap(AppState.items[idx]);
            } else {
                AppState.items.push(item);
                UI.updateBoardItemsMap(item);
            }

            // Modal draft is a subscriber: patch Shared fields + refresh media/canvas
            // UI only (no full renderForm) when live Shared diverges from the draft.
            const liveItem = idx !== -1 ? AppState.items[idx] : item;
            const modalOpen = Editor.activeItem?.id === item.id
                && Editor.overlay
                && !Editor.overlay.classList.contains('is-hidden');
            if (modalOpen && detail?.mergeKey !== 'modal-owned-persist') {
                Editor.applySharedFromLive(liveItem);
            }

            if (detail?.skipRerender || detail?.preserveView) {
                if (!detail?.skipRerender) {
                    const canvas = document.getElementById('app-canvas');
                    UI.updateSingleCard(canvas, liveItem, AppState.hiddenCategories);
                    if (AppState.viewSettings.sortBy === 'grid') {
                        DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
                    }
                } else {
                    // skipRerender saves (drawing canvas, draw toggle, …) intentionally skip the
                    // single-card re-render, but the board card may have been rebuilt from a re-fetch
                    // while the save was in flight (File Cabinet toggle, category change) — leaving the
                    // media/canvas section stale, e.g. an invisible note canvas. Sync just that section
                    // so the board card always agrees with the persisted item.
                    // Capture board scroll: section remount must not yank #app-canvas to top.
                    const canvas = document.getElementById('app-canvas');
                    const canvasScroll = {
                        scrollTop: canvas?.scrollTop ?? 0,
                        scrollLeft: canvas?.scrollLeft ?? 0
                    };
                    import('./noteAttachmentsUi.js').then(({ syncNoteAttachmentsDom }) => {
                        const current = AppState.items.find((i) => i.id === liveItem?.id) || liveItem;
                        syncNoteAttachmentsDom(current);
                        const c = document.getElementById('app-canvas');
                        if (c) {
                            c.scrollTop = canvasScroll.scrollTop;
                            c.scrollLeft = canvasScroll.scrollLeft;
                        }
                    }).catch(() => {});
                }
                this.updateWorkspaceCounter();
                return;
            }
            await this.syncDataStore();
        });

        window.addEventListener('board:visibility_changed', async (e) => {
            const canvas = document.getElementById('app-canvas');
            const skipFlush = e.detail?.flushLayout === false;
            if (canvas && !skipFlush) {
                UI.flushLayoutFromCanvas(canvas, AppState.viewSettings.sortBy);
            }
            UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories, {
                skipGridReflow: e.detail?.skipGridReflow === true
            });
            this.updateWorkspaceCounter();
            DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
        });

        window.addEventListener('filecabinet:layout_changed', async (e) => {
            const canvas = document.getElementById('app-canvas');
            const skipFlush = e.detail?.flushLayout === false;
            if (canvas && !skipFlush) {
                UI.flushLayoutFromCanvas(canvas, AppState.viewSettings.sortBy);
            }
            UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
            DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
        });

        window.addEventListener('calendar:items_changed', (e) => {
            const sourceItem = Editor.activeItem || e.detail;
            if (sourceItem?.id) {
                const idx = AppState.items.findIndex(i => i.id === sourceItem.id);
                if (idx !== -1) {
                    AppState.items[idx] = {
                        ...AppState.items[idx],
                        hideFromCalendar: sourceItem.hideFromCalendar === true
                    };
                }
            }
            if (Calendar.isActive()) {
                Calendar.items = AppState.items;
                Calendar.refresh();
            }
        });

        window.addEventListener('calendar:add_note', (e) => {
            const defaultDate = e.detail;
            const newItem = createDefaultNote({
                startDateTime: defaultDate.toISOString(),
                editorBodyLayout: 'content',
                backgroundColor: randomNoteColor()
            });
            Editor.open(newItem, AppState.categories);
        });

        window.addEventListener('category:show_requested', (e) => {
            const catName = e.detail?.name;
            if (catName) {
                AppState.hiddenCategories = AppState.hiddenCategories.filter(c => c !== catName);
                localStorage.setItem('matrix_hidden_categories', JSON.stringify(AppState.hiddenCategories));
                window.dispatchEvent(new CustomEvent('categories:toggled'));
            }
        });

        window.addEventListener('category:hide_requested', (e) => {
            const catName = e.detail?.name;
            if (!catName || isUncategorizedCategory(catName)) return;
            if (AppState.hiddenCategories.includes(catName)) return;

            AppState.hiddenCategories = [...AppState.hiddenCategories, catName];
            localStorage.setItem('matrix_hidden_categories', JSON.stringify(AppState.hiddenCategories));
            removeCategoryFromFileCabinetLayout(catName);

            (AppState.items || []).forEach((item) => {
                if (item.status === 'archived') return;
                if (getItemCategoryName(item) !== catName) return;
                const beforeItem = NoteSurface.snapshotItem(item);
                item.categories = [];
                NoteSurface.emitItemMutation(item, {
                    preserveView: true,
                    beforeItem,
                    skipRerender: true,
                    skipUndo: true
                });
            });

            window.dispatchEvent(new CustomEvent('categories:toggled'));
            window.dispatchEvent(new CustomEvent('filecabinet:layout_changed', { detail: { flushLayout: false } }));
            this.syncDataStore();
        });

        window.addEventListener('category:color_changed', (e) => {
            const { name, color } = e.detail || {};
            if (!name) return;
            const next = updateCategoryColor(name, color, AppState.categories);
            if (!next) return;
            AppState.categories = next;
            applyCategoryColorLive(name, color, AppState.items);
            SidePanel.updateCategories(AppState.categories, AppState.hiddenCategories, AppState.items);
        });

        window.addEventListener('category:add_prompt', (e) => {
            this.executeAddCategoryPrompt(e.detail?.anchor || null);
        });

        window.addEventListener('categories:toggled', () => {
            const canvas = document.getElementById('app-canvas');
            if (canvas && AppState.workspaceMode !== 'drawing') {
                UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
            }
            SidePanel.updateCategories(AppState.categories, AppState.hiddenCategories, AppState.items);
        });

window.addEventListener('category:order_changed', (e) => {
            AppState.categories = writeStoredCategories(e.detail || AppState.categories, { keepEmpty: true });
            this.syncDataStore();
        });

        window.addEventListener('category:renamed', async (e) => {
            const oldName = e.detail?.oldName;
            const newName = e.detail?.newName;
            if (!oldName || !newName || oldName === newName) return;

            const fromKey = categoryKey(oldName);
            AppState.categories = readStoredCategories({ keepEmpty: true });
            AppState.hiddenCategories = AppState.hiddenCategories.map((c) => (
                categoryKey(c) === fromKey ? newName : c
            ));
            localStorage.setItem('matrix_hidden_categories', JSON.stringify(AppState.hiddenCategories));

            (AppState.items || []).forEach((item) => {
                if (!item?.categories?.length) return;
                let changed = false;
                const nextCats = item.categories.map((cat) => {
                    if (categoryKey(cat) !== fromKey) return cat;
                    changed = true;
                    return newName;
                });
                if (!changed) return;
                const beforeItem = NoteSurface.snapshotItem(item);
                item.categories = nextCats;
                NoteSurface.emitItemMutation(item, {
                    preserveView: true,
                    beforeItem,
                    skipRerender: true,
                    skipUndo: true
                });
            });

            SidePanel.updateCategories(AppState.categories, AppState.hiddenCategories, AppState.items);
            window.dispatchEvent(new CustomEvent('categories:toggled'));
            window.dispatchEvent(new CustomEvent('filecabinet:layout_changed', { detail: { flushLayout: false } }));
            await this.syncDataStore();
        });

        // Handle desktop switching - refresh workspace to show notes for active desktop
        window.addEventListener('desktop:changed', async (e) => {
            const canvas = document.getElementById('app-canvas');
            if (canvas && AppState.workspaceMode !== 'drawing') {
                UI.flushLayoutFromCanvas(canvas, AppState.viewSettings.sortBy);
                UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
                DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
            }
            this.updateWorkspaceCounter();
        });
        window.addEventListener('desktop:notes_migrated', (e) => {
            const { migratedCount, migratedIds } = e.detail || {};
            const ids = Array.isArray(migratedIds) ? migratedIds : [];
            // Persist each migrated note so shrink cannot leave orphan desktopIds in storage
            ids.forEach((id) => {
                const item = AppState.items.find((i) => i.id === id);
                if (!item) return;
                window.dispatchEvent(new CustomEvent('item:mutation_requested', {
                    detail: {
                        item,
                        desktopId: item.desktopId || 1,
                        preserveView: true,
                        skipUndo: true
                    }
                }));
            });
            if (migratedCount > 0) {
                showAppToast(`${migratedCount} note${migratedCount === 1 ? '' : 's'} moved to Desktop 1`);
            }
        });
    }
}

const CoreApp = new Application();
document.addEventListener('DOMContentLoaded', () => CoreApp.init());
