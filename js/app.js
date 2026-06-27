/** @module {"owns":"application orchestration, event bus listeners, workspace init", "related":["api.js","ui.js","layoutStorage.js"], "events":["item:mutation_requested","item:selected_for_edit","board:visibility_changed","calendar:add_note"]} */
import { API } from './api.js';
import { ACTION_ICONS } from './icons.js';
import { createNoteId } from './noteModel.js';
import { NoteSurface } from './noteSurface.js';
import { UI } from './ui.js';
import { Editor } from './editor.js';
import { DragDropEngine } from './dragdrop.js';
import { ToolsManager } from './toolsManager.js';
import { Calendar } from './calendar.js';
import { SidePanel } from './hamburger.js';
import { applyBackupToStorage, buildBackupPackage, parseBackupPackage, serializeBackupPackage, writeLastLocalExportAt } from './backup.js';
import { reconcileLayoutStorage } from './layoutStorage.js';
import {
    DEFAULT_CATEGORIES,
    isUncategorizedCategory,
    normalizeCategories,
    readStoredCategories,
    UNCATEGORIZED_COLOR,
    writeStoredCategories
} from './categories.js';
import { UndoManager, historyLabelForItem } from './undo.js';
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
import { AppTheme } from './appTheme.js';
import { DesktopZoom } from './desktopZoom.js';
import { NoteFontScale } from './noteFontScale.js';
import { readViewSessions, restoreViewSession, normalizeViewMode } from './viewSession.js';
import { DrawingBoard } from './drawingBoard.js';
import { SearchBar } from './searchBar.js';
import { Fullscreen } from './fullscreen.js';
import { SidebarRadio } from './sidebarRadio.js';
import { SidebarTv } from './sidebarTv.js';
import { SidebarWeather } from './sidebarWeather.js';
import { initAllSidebarModules } from './sidebarModules.js';
import { SidebarHistory } from './sidebarHistory.js';
import { SidebarStats } from './sidebarStats.js';
import { BoardSort } from './boardSort.js';
import { CloudBackup } from './cloudBackup.js';
import { BootProgress } from './bootProgress.js';
import { TemplatePicker } from './templatePicker.js';
import {
    migrateItemsToFileCabinet,
    pruneFileCabinetOrderByLayout,
    setFileCabinetActive
} from './fileCabinet.js';
import { initShellResize } from './shellResize.js';
import { initUndockedSidebarStacking } from './desktopStack.js';

function countHiddenFromBoard(items) {
    return items.filter(item => UI.isHiddenFromBoard(item)).length;
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
    }

    async init() {
        BootProgress.init();
        BootProgress.set(8, 'Starting…');
        try {
            DesktopBackground.init();
            ChromeBackground.init();
            NoteFontScale.init();
            migrateLegacyGridLayoutIfNeeded();
            initGridMetrics();
            applyTileSmallFootprint();
            migrateCompactDefaultsIfNeeded();
            migrateCardMinimumFootprintIfNeeded();
            migrateGridSpanCardWidthIfNeeded();
            DisplayOptions.init({
                getLoggedIn: () => AppState.user.isLoggedIn
            });
            AppTheme.init();
            readViewSessions();
            localStorage.setItem('matrix_desktop_layout', AppState.viewSettings.sortBy);
            restoreViewSession(AppState.viewSettings.sortBy);
            BootProgress.set(20, 'Preferences…');
            this.checkAuthSession();
            Editor.init();
            await ToolsManager.init(() => AppState.items);
            BootProgress.set(30, 'Tools…');
            Calendar.init();
            this.renderControlBar();
            this.loadCategoriesStore();
            BootProgress.set(40, 'Categories…');
            await reconcileLayoutStorage({
                items: API._getLocalDB().items,
                categories: AppState.categories
            });
            BootProgress.set(60, 'Layout…');
            await this.syncDataStore();
            BootProgress.set(85, 'Workspace…');
            this.setupCoreListeners();
            SidePanel.init(AppState);
            initShellResize();
            initUndockedSidebarStacking();
            BoardSort.init({
                getItems: () => AppState.items,
                getViewMode: () => AppState.viewSettings.sortBy,
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
            SidePanel.setupStatusClickHandlers(); /* after radio/tv/weather shells exist */
            SidebarHistory.init(AppState);
            SidebarStats.init();
            initAllSidebarModules();
            SidebarHistory.renderPanel();
            ClockStyle.init();
            DesktopZoom.init();
            this.setupSearchBar();
            this.setupBackupInterface();
            CloudBackup.init({ getLoggedIn: () => AppState.user.isLoggedIn });
            CloudBackup.ensureConnected().finally(() => CloudBackup.updateButtons());
            this.setupFab();
            TemplatePicker.init();
            this.setupUndo();
            this.setupDrawingMode();
            Fullscreen.init();
            DrawingBoard.init();
            if (AppState.workspaceMode === 'drawing') {
                requestAnimationFrame(() => this.applyWorkspaceMode('drawing', { skipPersist: true }));
            }
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
            onStackChange: () => SidebarHistory.renderPanel()
        });
    }

    async removeItemFromWorkspace(itemId) {
        AppState.items = AppState.items.filter((i) => i.id !== itemId);
        if (Editor.activeItem?.id === itemId) Editor.close();
        await this.syncDataStore();
    }

    async restoreItem(item, preserveView = false) {
        const idx = AppState.items.findIndex((i) => i.id === item.id);
        if (idx >= 0) AppState.items[idx] = item;
        else AppState.items.push(item);

        if (Editor.activeItem?.id === item.id && !Editor.overlay?.classList.contains('is-hidden')) {
            Editor.activeItem = NoteSurface.snapshotItem(item);
            Editor.renderForm();
            Editor.updateEditorSizeLabel();
        }

        if (preserveView) {
            const canvas = document.getElementById('app-canvas');
            UI.updateSingleCard(canvas, item, AppState.hiddenCategories);
            if (['freeform', 'grid'].includes(AppState.viewSettings.sortBy)) {
                DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
            }
            this.updateWorkspaceCounter();
            return;
        }
        await this.syncDataStore();
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

    loadCategoriesStore() {
        const storedCats = localStorage.getItem('matrix_custom_categories');
        if (storedCats) {
            try {
                const parsed = normalizeCategories(JSON.parse(storedCats), { keepEmpty: true });
                if (parsed.length) {
                    AppState.categories = writeStoredCategories(parsed, { keepEmpty: true });
                    return;
                }
            } catch {
                /* ignore */
            }
        }

        if (!AppState.categories?.length) {
            const db = API._getLocalDB();
            AppState.categories = writeStoredCategories(normalizeCategories(db.settings?.categories || []));
        }
    }

    async syncDataStore() {
        const task = this._syncQueue.then(() => this._syncDataStoreInner());
        this._syncQueue = task.catch(() => {});
        return task;
    }

    async _syncDataStoreInner() {
        const canvas = document.getElementById('app-canvas');
        try {
            if (canvas && AppState.workspaceMode !== 'drawing') {
                UI.flushLayoutFromCanvas(canvas, AppState.viewSettings.sortBy);
            }

            const data = await API.fetchItems(AppState.user.token);
            AppState.items = Array.isArray(data?.items) ? data.items : [];

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
        const zone = document.getElementById('quick-actions-zone');
        if (!zone) return;

        const mode = AppState.viewSettings.sortBy;
        const drawingActive = AppState.workspaceMode === 'drawing';
        const fileCabinetActive = !drawingActive && AppState.viewSettings.fileCabinet;
        const freeformActive = !drawingActive && mode === 'freeform';
        const fileCabinetTitle = fileCabinetActive ? 'Hide File Cabinet' : 'File Cabinet';
        const viewTitle = fileCabinetActive
            ? (freeformActive ? 'Snap bottom to grid' : 'Freeform bottom workspace')
            : (freeformActive ? 'Snap to bento grid' : 'Freeform layout');
        const viewIcon = freeformActive ? ACTION_ICONS.viewFree : ACTION_ICONS.viewGrid;

        const workspaceGroup = `
            <button class="btn btn--compact btn--icon ${freeformActive ? 'active' : ''}" id="btn-freeform-toggle" title="${viewTitle}" aria-label="${viewTitle}" aria-pressed="${freeformActive ? 'true' : 'false'}">${viewIcon}</button>
            <button class="btn btn--compact btn--icon ${fileCabinetActive ? 'active' : ''}" id="btn-file-cabinet-toggle" title="${fileCabinetTitle}" aria-label="${fileCabinetTitle}" aria-pressed="${fileCabinetActive ? 'true' : 'false'}">${ACTION_ICONS.viewFileCabinet}</button>
            <button class="btn btn--compact btn--icon ${drawingActive ? 'active' : ''}" id="btn-drawing-mode" title="magicCanvas" aria-label="magicCanvas">${ACTION_ICONS.drawingPencil}</button>
        `;

        const historyGroup = `
            <button type="button" id="btn-undo" class="btn btn--compact btn--icon is-hidden" disabled title="Undo (Ctrl+Z)" aria-label="Undo"></button>
            <button type="button" id="btn-redo" class="btn btn--compact btn--icon is-hidden" disabled title="Redo (Ctrl+Y)" aria-label="Redo"></button>
        `;

        const displayGroup = `
            <button type="button" id="btn-display-options" class="btn btn--compact btn--icon" title="Display options" aria-label="Display options" aria-expanded="false" aria-haspopup="menu"></button>
        `;

        const layoutGroup = `
            <button type="button" id="btn-board-sort" class="btn btn--compact btn--icon is-hidden" title="Sort board" aria-label="Sort board" aria-expanded="false" aria-haspopup="menu"></button>
            <button type="button" id="btn-layout-reset" class="btn btn--compact btn--icon is-hidden" title="Reset" aria-label="Reset"></button>
        `;

        const shellGroup = `
            <button type="button" id="btn-fullscreen" class="btn btn--compact btn--icon" title="Full screen" aria-label="Full screen" aria-pressed="false"></button>
            <button type="button" id="btn-show-clock" class="btn btn--compact btn--icon is-hidden" title="Show clock" aria-label="Show clock"></button>
        `;

        if (!AppState.user.isLoggedIn) {
            zone.innerHTML = `${workspaceGroup}${historyGroup}${displayGroup}${layoutGroup}${shellGroup}
                <button type="button" class="btn btn--compact btn--block" id="btn-auth-login">Login</button>`;
        } else {
            const accountGroup = `
                <button type="button" class="btn btn--compact btn--icon" id="btn-add-category" title="Add category" aria-label="Add category">${ACTION_ICONS.category}</button>
                <button type="button" class="btn btn--compact btn--icon" id="btn-cloud" title="Cloud backup" aria-label="Cloud backup">${ACTION_ICONS.cloud}</button>
                <button type="button" class="btn btn--compact btn--icon" id="btn-cloud-export" data-enabled-title="Export to cloud" title="Connect cloud first (Cloud icon)" aria-label="Export to cloud" disabled>${ACTION_ICONS.cloudExport}</button>
                <button type="button" class="btn btn--compact btn--icon" id="btn-cloud-import" data-enabled-title="Import from cloud" title="Connect cloud first (Cloud icon)" aria-label="Import from cloud" disabled>${ACTION_ICONS.cloudImport}</button>
                <button type="button" class="btn btn--compact btn--icon" id="btn-export-db" title="Export backup" aria-label="Export backup">${ACTION_ICONS.export}</button>
                <button type="button" class="btn btn--compact btn--icon" id="btn-import-db" title="Import backup" aria-label="Import backup">${ACTION_ICONS.import}</button>
                <button type="button" class="btn btn--compact btn--icon btn--icon-danger" id="btn-auth-logout" title="Logout" aria-label="Logout">${ACTION_ICONS.logout}</button>
            `;
            zone.innerHTML = `${workspaceGroup}${historyGroup}${displayGroup}${layoutGroup}${shellGroup}${accountGroup}`;
        }

        this.bindQuickActionHandlers();
    }

    bindQuickActionHandlers() {
        const undoBtn = document.getElementById('btn-undo');
        const redoBtn = document.getElementById('btn-redo');
        if (undoBtn) undoBtn.innerHTML = ACTION_ICONS.undo;
        if (redoBtn) redoBtn.innerHTML = ACTION_ICONS.redo;

        UndoManager.rebindToolbar();

        const displayBtn = document.getElementById('btn-display-options');
        if (displayBtn) displayBtn.innerHTML = ACTION_ICONS.displayOptions;
        DisplayOptions.rebindTrigger();
        ClockStyle.rebindTrigger();

        this.setupLayoutResetButton();
        const sortBtn = document.getElementById('btn-board-sort');
        if (sortBtn) sortBtn.innerHTML = ACTION_ICONS.sortAlpha;
        BoardSort.rebindTrigger();
        Fullscreen.rebindMainButton();

        document.getElementById('btn-freeform-toggle')?.addEventListener('click', () => this.toggleFreeformLayout());
        document.getElementById('btn-file-cabinet-toggle')?.addEventListener('click', () => this.toggleFileCabinet());
        document.getElementById('btn-drawing-mode')?.addEventListener('click', () => {
            if (AppState.workspaceMode === 'drawing') this.switchWorkspaceMode('notes');
            else this.switchWorkspaceMode('drawing');
        });

        document.getElementById('btn-add-category')?.addEventListener('click', () => this.executeAddCategoryPrompt());
        document.getElementById('btn-cloud')?.addEventListener('click', (e) => {
            CloudBackup.handleCloudClick(e.currentTarget);
        });
        document.getElementById('btn-cloud-export')?.addEventListener('click', (e) => {
            CloudBackup.exportCheckpoint(e.currentTarget);
        });
        document.getElementById('btn-cloud-import')?.addEventListener('click', (e) => {
            CloudBackup.handleImportClick(e.currentTarget);
        });
        document.getElementById('btn-export-db')?.addEventListener('click', () => this.executeDataBackupExport());
        document.getElementById('btn-import-db')?.addEventListener('click', () => document.getElementById('system-import-file-picker').click());
        document.getElementById('btn-auth-logout')?.addEventListener('click', () => this.executeLogout());
        document.getElementById('btn-auth-login')?.addEventListener('click', () => this.executeLoginPrompt());

        this.updateLayoutResetVisibility();
        this.updateViewToggleState();
        UndoManager.updateToolbar();
        CloudBackup.updateButtons();
    }

    setupFab() {
        const fab = document.getElementById('fab-create');
        if (!fab) return;
        fab.addEventListener('click', () => {
            if (!AppState.user.isLoggedIn) {
                this.executeLoginPrompt();
                return;
            }
            TemplatePicker.open(AppState.categories);
        });
    }

    updateFabVisibility() {
        const fab = document.getElementById('fab-create');
        if (!fab) return;
        const inDrawing = AppState.workspaceMode === 'drawing';
        fab.classList.toggle('is-hidden', inDrawing);
        if (inDrawing) return;
        const needsLogin = !AppState.user.isLoggedIn;
        fab.title = needsLogin ? 'New note (login required)' : 'New note';
        fab.setAttribute('aria-label', fab.title);
    }

    setupDrawingMode() {
        document.addEventListener('keydown', (e) => {
            if (DrawingBoard.handleKeydown(e)) return;
        });
    }

    switchWorkspaceMode(mode) {
        if (mode !== 'notes' && mode !== 'drawing') return;
        if (AppState.workspaceMode === mode) return;
        this.applyWorkspaceMode(mode);
    }

    applyWorkspaceMode(mode, { skipPersist = false } = {}) {
        AppState.workspaceMode = mode;
        if (!skipPersist) {
            localStorage.setItem('matrix_workspace_mode', mode);
        }

        const shell = document.getElementById('workspace-shell');
        const canvas = document.getElementById('app-canvas');
        const drawBtn = document.getElementById('btn-drawing-mode');

        if (mode === 'drawing') {
            shell?.setAttribute('data-drawing-mode', '');
            canvas?.classList.add('is-hidden');
            drawBtn?.classList.add('active');

            DesktopZoom.apply({ enabled: false });
            DrawingBoard.activate();
        } else {
            shell?.removeAttribute('data-drawing-mode');
            canvas?.classList.remove('is-hidden');
            drawBtn?.classList.remove('active');

            DrawingBoard.deactivate();
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

    executeDataBackupExport() {
        const backupPackage = buildBackupPackage();
        const blob = new Blob([serializeBackupPackage(backupPackage)], { type: 'application/json' });
        const virtualLink = document.createElement('a');
        virtualLink.href = URL.createObjectURL(blob);
        virtualLink.download = `matrix_workspace_backup_${backupPackage.timestamp}.json`;
        virtualLink.click();
        URL.revokeObjectURL(virtualLink.href);
        writeLastLocalExportAt(backupPackage.timestamp);
        SidebarStats.update();
    }

    setupBackupInterface() {
        const filePicker = document.getElementById('system-import-file-picker');
        if (!filePicker) return;
        filePicker.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const parsedBackup = parseBackupPackage(event.target.result);
                    applyBackupToStorage(parsedBackup);
                    const itemCount = parsedBackup.matrix_database?.items?.length ?? 0;
                    const token = parsedBackup.matrix_database?.auth?.admin_token;
                    const tokenNote = token
                        ? ' Admin session restored from backup.'
                        : ' Log in with your admin token to see private notes.';
                    alert(`Restore successful (${itemCount} items).${tokenNote}`);
                    window.location.reload();
                } catch (err) {
                    console.error('[Import]', err);
                    alert('Import Aborted: Invalid or unsupported backup file.');
                }
            };
            reader.readAsText(file);
        });
    }

    executeAddCategoryPrompt() {
        if (!AppState.user.isLoggedIn) return;
        const nameInput = prompt("Enter Unique New Category Label Name:");
        if (!nameInput || !nameInput.trim()) return;
        const cleanName = nameInput.trim();
        if (isUncategorizedCategory(cleanName)) {
            alert('Conflict: Uncategorized is reserved.');
            return;
        }
        if (AppState.categories.map(c => c.name.toLowerCase()).includes(cleanName.toLowerCase())) {
            alert("Conflict: That category tag layout already exists.");
            return;
        }
        const addBtn = document.getElementById('btn-add-category');
        if (!addBtn) return;
        ColorPicker.open({
            anchor: addBtn,
            presets: PALETTE_NOTE,
            value: UNCATEGORIZED_COLOR,
            align: 'end',
            onSelect: (color) => {
                const cleanColor = color && color.trim() ? color.trim() : UNCATEGORIZED_COLOR;
                AppState.categories = writeStoredCategories([
                    ...AppState.categories,
                    { name: cleanName, color: cleanColor }
                ], { keepEmpty: true });
                this.syncDataStore();
            }
        });
    }

    executeLoginPrompt() {
        const secretInput = prompt("Enter Admin Security Token Code:");
        if (secretInput) {
            localStorage.setItem('admin_token', secretInput.trim());
            this.checkAuthSession();
            UndoManager.loadStacks();
            this.renderControlBar();
            SidebarHistory.renderPanel();
            this.syncDataStore();
        }
    }

    executeLogout() {
        localStorage.removeItem('admin_token');
        AppState.user.isLoggedIn = false;
        AppState.user.token = null;
        UndoManager.clear();
        this.renderControlBar();
        SidebarHistory.renderPanel();
        this.updateLayoutResetVisibility();
        this.syncDataStore();
    }

    async toggleFreeformLayout() {
        const nextMode = AppState.viewSettings.sortBy === 'freeform' ? 'grid' : 'freeform';
        await this.setDesktopLayoutMode(nextMode);
    }

    async toggleFileCabinet() {
        if (AppState.workspaceMode === 'drawing') {
            this.switchWorkspaceMode('notes');
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
    }

    async setDesktopLayoutMode(mode) {
        if (mode !== 'grid' && mode !== 'freeform') return;
        if (AppState.workspaceMode === 'drawing') {
            this.switchWorkspaceMode('notes');
            if (AppState.viewSettings.sortBy === mode) return;
        }
        const prevMode = AppState.viewSettings.sortBy;
        if (prevMode === mode) return;

        const canvas = document.getElementById('app-canvas');
        UI.flushAllInlineEditsFromCanvas(canvas, AppState.items);
        UI.flushLayoutFromCanvas(canvas, prevMode);
        UI.persistViewSessionForMode(prevMode, canvas);
        UI.convertDesktopLayoutForModeChange(canvas, prevMode, mode, AppState.items);

        AppState.viewSettings.sortBy = mode;
        localStorage.setItem('matrix_desktop_layout', mode);
        localStorage.setItem('matrix_preferred_view', mode);
        UI.restoreViewSessionForMode(mode);

        UI.applyDesktopLayoutModeSwitch(canvas, mode);

        window.dispatchEvent(new CustomEvent('board:visibility_changed', {
            detail: {
                flushLayout: false,
                skipGridReflow: mode === 'grid' && prevMode === 'freeform'
            }
        }));
        window.dispatchEvent(new CustomEvent('view:mode_changed', { detail: mode }));
        this.updateViewToggleState();
        this.updateLayoutResetVisibility();
        this.updateWorkspaceCounter();
        BoardSort.refreshMenu();
    }

    updateViewToggleState() {
        const mode = AppState.viewSettings.sortBy;
        const drawing = AppState.workspaceMode === 'drawing';
        const fileCabinetActive = !drawing && AppState.viewSettings.fileCabinet;
        const freeformActive = !drawing && mode === 'freeform';
        const ffBtn = document.getElementById('btn-freeform-toggle');
        ffBtn?.classList.toggle('active', freeformActive);
        if (ffBtn) {
            const title = fileCabinetActive
                ? (freeformActive ? 'Snap bottom to grid' : 'Freeform bottom workspace')
                : (freeformActive ? 'Snap to bento grid' : 'Freeform layout');
            ffBtn.innerHTML = freeformActive ? ACTION_ICONS.viewFree : ACTION_ICONS.viewGrid;
            ffBtn.title = title;
            ffBtn.setAttribute('aria-label', title);
            ffBtn.setAttribute('aria-pressed', freeformActive ? 'true' : 'false');
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
        btn?.addEventListener('click', () => {
            if (AppState.workspaceMode === 'drawing') {
                this.switchWorkspaceMode('notes');
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
            UI.updateBoardCanvasExtents(canvas);
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

        window.addEventListener('editor:reveal_on_board', async (e) => {
            const item = e.detail;
            if (!item?.id) return;
            UI.markNoteCollapsed(item.id);

            const idx = AppState.items.findIndex((i) => i.id === item.id);
            if (idx >= 0) AppState.items[idx] = item;
            else AppState.items.push(item);

            const canvas = document.getElementById('app-canvas');
            let card = canvas?.querySelector(`.mini-card[data-id="${item.id}"]`);
            if (!card) {
                await this.syncDataStore();
                card = canvas?.querySelector(`.mini-card[data-id="${item.id}"]`);
            } else {
                UI.collapseBoardCardIfExpanded(card, item, AppState.hiddenCategories);
            }

            requestAnimationFrame(() => {
                card = canvas?.querySelector(`.mini-card[data-id="${item.id}"]`) || card;
                card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
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

            const idx = AppState.items.findIndex((i) => i.id === item.id);
            const beforeSnapshot = detail?.beforeItem
                ? JSON.parse(JSON.stringify(detail.beforeItem))
                : idx >= 0
                    ? JSON.parse(JSON.stringify(AppState.items[idx]))
                    : null;

            const success = await API.saveItem(item, AppState.user.token);
            if (!success) {
                alert('Could not save note. Log in with the correct admin token (default dev: dev-admin-secret-2026).');
                return;
            }

            if (beforeSnapshot) {
                UndoManager.recordItemChange(beforeSnapshot, item, {
                    preserveView,
                    label: historyLabelForItem(item),
                    mergeKey: detail?.mergeKey,
                    mergeWindow: detail?.mergeWindow !== false
                });
            }

            if (idx !== -1) AppState.items[idx] = item;
            else AppState.items.push(item);

            if (preserveView) {
                if (!detail?.skipRerender) {
                    const canvas = document.getElementById('app-canvas');
                    UI.updateSingleCard(canvas, item, AppState.hiddenCategories);
                    if (['freeform', 'grid'].includes(AppState.viewSettings.sortBy)) {
                        DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
                    }
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
            const newItem = {
                id: createNoteId(),
                owner_id: "admin",
                visibility: "private",
                type: "note",
                title: "",
                content: "",
                status: "active",
                categories: [],
                backgroundColor: randomNoteColor(),
                startDateTime: defaultDate.toISOString(),
                endDateTime: "",
                isRecurring: false,
                hideFromCalendar: false,
                hiddenFromBoard: false,
                steps: [],
                editorBodyLayout: 'content',
                tileSize: 'large'
            };
            Editor.open(newItem, AppState.categories);
        });

        window.addEventListener('category:show_requested', (e) => {
            const catName = e.detail?.name;
            if (catName) {
                AppState.hiddenCategories = AppState.hiddenCategories.filter(c => c !== catName);
                localStorage.setItem('matrix_hidden_categories', JSON.stringify(AppState.hiddenCategories));
                window.dispatchEvent(new CustomEvent('categories:toggled'));
                this.syncDataStore();
            }
        });

        window.addEventListener('category:order_changed', (e) => {
            AppState.categories = writeStoredCategories(e.detail || AppState.categories, { keepEmpty: true });
            this.syncDataStore();
        });
    }
}

const CoreApp = new Application();
document.addEventListener('DOMContentLoaded', () => CoreApp.init());

