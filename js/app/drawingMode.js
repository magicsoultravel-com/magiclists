/** @module {"owns":"the workspace-mode switches - notes board, file cabinet, note-canvas and flowchart - plus leaving drawing when the focus editor opens and migrating a freeform overlay layout on the way out","related":["../app.js","state.js","listeners.js","../drawingBoard.js"],"events":["board:visibility_changed","workspace:mode_changed"]} */
import { BoardOverlay } from '../boardOverlay.js';
import { DesktopDock } from '../desktopDockComponent.js';
import { DesktopZoom } from '../desktopZoom.js';
import { DragDropEngine } from '../dragdrop.js';
import { DrawingBoard } from '../drawingBoard.js';
import { Editor } from '../editor.js';
import { MagicFocus } from '../magicFocus.js';
import { UI } from '../ui.js';
import { AppState } from './state.js';

export async function exitDrawingForFocus(app) {
    if (AppState.workspaceMode === 'drawing') {
        await app.switchWorkspaceMode('notes');
    }
}

export async function switchWorkspaceMode(app, mode) {
    if (mode !== 'notes' && mode !== 'drawing') return;
    if (MagicFocus.isOpen()) {
        await MagicFocus.close();
    }
    if (AppState.workspaceMode === mode) return;
    await app.applyWorkspaceMode(mode);
}

export async function applyWorkspaceMode(app, mode, { skipPersist = false } = {}) {
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
        app.updateDesktopZoomVisibility();

        if (AppState.items.length) {
            UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
            DragDropEngine.init(AppState.user, AppState.items, () => app.syncDataStore());
        }
    }

    app.updateFabVisibility();
    app.updateLayoutResetVisibility();
    app.updateViewToggleState();
}

export async function enterNoteCanvasMode(app, item) {
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
    app.updateFabVisibility();
}

export async function enterFlowchartMode(app, item) {
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
    app.updateFabVisibility();
}

export async function exitNoteCanvasMode(app, item) {
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
    app.updateDesktopZoomVisibility();

    if (AppState.items.length) {
        UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
        DragDropEngine.init(AppState.user, AppState.items, () => app.syncDataStore());
    }

    app.updateFabVisibility();
    app.updateLayoutResetVisibility();
    app.updateViewToggleState();

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

export function migrateBoardOverlayFromFreeform(app) {
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
