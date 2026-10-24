/** @module {"owns":"the view chrome - the control bar, the quick-actions header, FAB and zoom/layout-reset visibility, the board-overlay and file-cabinet toggles, and the desktop dock sync around MagicFocus enter/leave","related":["../app.js","state.js","listeners.js","drawingMode.js"],"events":["board:visibility_changed","desktop:changed"]} */
import { BoardOverlay } from '../boardOverlay.js';
import { BoardSort } from '../boardSort.js';
import { CategoriesOverlay } from '../categoriesOverlay.js';
import { CloudBackup } from '../cloudBackup.js';
import { DesktopDock } from '../desktopDockComponent.js';
import { DesktopZoom } from '../desktopZoom.js';
import { DragDropEngine } from '../dragdrop.js';
import { migrateItemsToFileCabinet, pruneFileCabinetOrderByLayout, setFileCabinetActive } from '../fileCabinet.js';
import { ACTION_ICONS } from '../icons.js';
import { LoadingManager } from '../loadingUtils.js';
import { MagicFocus } from '../magicFocus.js';
import { importNotePackageFromPicker, renderQuickActions as renderQuickActionsCore } from '../noteQuickActions.js';
import { ScheduledBackup } from '../scheduledBackup.js';
import { UI } from '../ui.js';
import { UndoManager } from '../undo.js';
import { AppState } from './state.js';

export function renderControlBar(app) {
    app.renderQuickActions();
    app.updateFabVisibility();
    app.updateLayoutResetVisibility();
    UndoManager.updateToolbar();
}

export function renderQuickActions(app) {
    renderQuickActionsCore({
        sortBy: AppState.viewSettings.sortBy,
        workspaceMode: AppState.workspaceMode,
        fileCabinet: AppState.viewSettings.fileCabinet,
        isLoggedIn: AppState.user.isLoggedIn,
        handlers: {
            onToggleOverlay: () => app.toggleBoardOverlay(),
            onToggleFileCabinet: () => app.toggleFileCabinet(),
            onToggleDrawing: async () => {
                if (AppState.workspaceMode === 'drawing') await app.switchWorkspaceMode('notes');
                else await app.switchWorkspaceMode('drawing');
            },
            onAddCategory: () => CategoriesOverlay.open({ focusAdd: true }),
            onCloudClick: (e) => CloudBackup.handleCloudClick(e.currentTarget),
            onCloudExport: (e) => CloudBackup.exportCheckpoint(e.currentTarget),
            onCloudImport: (e) => CloudBackup.handleImportClick(e.currentTarget),
            onExportDb: () => app.executeDataBackupExport(),
            onExportAll: () => app.executeFullBackupExport(),
            onExportAllTxt: () => app.executeExportAllTxt(),
            onScheduleExport: (e) => ScheduledBackup.handleClick(e.currentTarget),
            onImportDb: () => document.getElementById('system-import-file-picker').click(),
            onImportAll: () => document.getElementById('system-import-all-picker').click(),
            onImportNote: async () => {
                const result = await importNotePackageFromPicker();
                if (result?.status && result.status !== 'cancelled') {
                    await app.syncDataStore();
                }
            },
            onLogout: () => app.executeLogout(),
            onLogin: () => app.executeLoginPrompt(),
            onLayoutReset: async () => {
                if (AppState.workspaceMode === 'drawing') {
                    await app.switchWorkspaceMode('notes');
                }
                UI.resetBoardLayout(AppState.viewSettings.sortBy, AppState.items, {
                    fileCabinetActive: AppState.viewSettings.fileCabinet
                });
            }
        }
    });

    ScheduledBackup.syncButton();

    // Bind header icons once during the initialization pipeline
    app.setupQuickActionsHeaderListeners();
    app.updateViewToggleState();
}

export function renderQuickActionsHeaderIcons(app) {
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

export function updateFabVisibility(app, { instant = false } = {}) {
    const fab = document.getElementById('fab-create');
    const scribbleFab = document.getElementById('fab-scribble');
    const inDrawing = AppState.workspaceMode === 'drawing';
    const inFocus = MagicFocus.isOpen();
    const hideBoardFabs = inDrawing || inFocus;
    const useMorph = !instant && document.documentElement.dataset.uiTransitions !== 'off';

    if (fab) {
        if (useMorph) {
            import('../uiTransitions.js').then(({ setChromeVisible, isUiTransitionsEnabled }) => {
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

export function onMagicFocusEnter(app, { deferChrome = false } = {}) {
    AppState.workspaceMode = 'focus';
    DesktopDock.setSuppressed(true, { apply: !deferChrome });
    DesktopZoom.apply({ enabled: false });
    if (!deferChrome) {
        app.updateFabVisibility({ instant: true });
    }
    app.updateLayoutResetVisibility();
    app.updateViewToggleState();
}

export function applyDesktopDockAfterFocusEnter(app) {
    DesktopDock.applySuppressedVisibility();
}

export function applyDesktopDockAfterFocusLeave(app) {
    DesktopDock.setSuppressed(false);
}

export async function onMagicFocusLeave(app, { deferChrome = false } = {}) {
    AppState.workspaceMode = 'notes';
    DesktopDock.setSuppressed(false, { apply: !deferChrome });
    app.updateDesktopZoomVisibility();
    if (AppState.items.length) {
        const canvas = document.getElementById('app-canvas');
        UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
        DragDropEngine.init(AppState.user, AppState.items, () => app.syncDataStore());
    }
    if (!deferChrome) {
        app.updateFabVisibility({ instant: true });
    }
    app.updateLayoutResetVisibility();
    app.updateViewToggleState();
}

export async function toggleBoardOverlay(app) {
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
            skipItemIds: app.resolveStaleBoardFlushSkipIds()
        });
        if (canvas) {
            UI.flushLayoutFromCanvas(canvas, AppState.viewSettings.sortBy);
        }
        const next = BoardOverlay.toggle();
        if (wasEnabled && !next && canvas) {
            UI.reflowGridBoard(canvas, null, { animate: true });
        }
        DragDropEngine.init(AppState.user, AppState.items, () => app.syncDataStore());
        app.updateViewToggleState();
        BoardSort.refreshMenu();
    } finally {
        // Hide loading indicator
        const toggleBtn = document.getElementById('btn-freeform-toggle');
        if (toggleBtn) {
            LoadingManager.hide(toggleBtn);
        }
    }
}

export async function toggleFileCabinet(app) {
    // Show loading indicator on the file cabinet toggle button
    const toggleBtn = document.getElementById('btn-file-cabinet-toggle');
    if (toggleBtn) {
        LoadingManager.show(toggleBtn, 'Toggling file cabinet...');
    }
    
    try {
        if (AppState.workspaceMode === 'drawing') {
            await app.switchWorkspaceMode('notes');
        }
        const next = !AppState.viewSettings.fileCabinet;
        const canvas = document.getElementById('app-canvas');
        if (MagicFocus.isOpen()) MagicFocus.flushPendingEdits();
        UI.flushAllInlineEditsFromCanvas(canvas, AppState.items, {
            skipItemIds: app.resolveStaleBoardFlushSkipIds()
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
        app.updateViewToggleState();
        app.updateLayoutResetVisibility();
        await app.syncDataStore();
    } finally {
        // Hide loading indicator
        const toggleBtn = document.getElementById('btn-file-cabinet-toggle');
        if (toggleBtn) {
            LoadingManager.hide(toggleBtn);
        }
    }
}

export function updateViewToggleState(app) {
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
    app.updateDesktopZoomVisibility();
    app.renderQuickActionsHeaderIcons();
    BoardSort.refreshMenu();
}

export function updateDesktopZoomVisibility(app) {
    if (AppState.workspaceMode === 'drawing' || MagicFocus.isOpen()) {
        DesktopZoom.apply({ enabled: false });
        return;
    }
    const show = AppState.user.isLoggedIn && DesktopZoom.isDesktopViewport();
    DesktopZoom.apply({ enabled: show });
}

export function updateLayoutResetVisibility(app) {
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
    app.updateDesktopZoomVisibility();
}
