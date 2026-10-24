/** @module {"owns":"every DOM/window listener the Application binds - the boot wiring in setupCoreListeners plus the undo, popout-claim, cross-tab-sync, quick-action, scribble, drawing and layout-reset setups, each moved together with the handlers it registers","related":["../app.js","state.js","services.js","drawingMode.js"],"events":["item:selected_for_edit","board:visibility_changed","editor:reveal_on_board","category:hide_requested","category:renamed","desktop:changed"]} */
import { API } from '../api.js';
import { applyUserTheme, readUserTheme } from '../appTheme.js';
import { BoardRulers } from '../boardRulers.js';
import { BoardSort } from '../boardSort.js';
import { Calendar } from '../calendar.js';
import {
    categoryKey,
    isUncategorizedCategory,
    readStoredCategories,
    updateCategoryColor,
    writeStoredCategories
} from '../categories.js';
import { CategoriesOverlay } from '../categoriesOverlay.js';
import { randomNoteColor } from '../colorPicker.js';
import { DesktopDock } from '../desktopDockComponent.js';
import { DesktopManager } from '../desktopManager.js';
import { DesktopZoom } from '../desktopZoom.js';
import { applyDisplayOptions, readDisplayOptions } from '../displayOptions.js';
import { DragDropEngine } from '../dragdrop.js';
import { DrawingBoard } from '../drawingBoard.js';
import { Editor } from '../editor.js';
import { applyCategoryColorLive, removeCategoryFromFileCabinetLayout } from '../fileCabinet.js';
import { getItemCategoryName } from '../focusFilter.js';
import { SidePanel } from '../hamburger.js';
import { ACTION_ICONS, CARD_ICONS } from '../icons.js';
import { LinksOverlay } from '../linksOverlay.js';
import { MagicFocus } from '../magicFocus.js';
import { createDefaultNote } from '../noteModel.js';
import { NotePopoutBridge } from '../notePopoutBridge.js';
import { NoteSurface } from '../noteSurface.js';
import { shouldRefreshPopoutLockedCard } from '../popoutLockRefresh.js';
import { QuickScribble } from '../quickScribble.js';
import { SearchBar } from '../searchBar.js';
import { SidebarHistory } from '../sidebarHistory.js';
import { SidebarLinks } from '../sidebarLinks.js';
import { initCrossTabSync } from '../sync.js';
import { showAppToast } from '../toast.js';
import { UI } from '../ui.js';
import { UndoManager, historyLabelForItem, mergeItemOntoExisting } from '../undo.js';
import { normalizeViewMode } from '../viewSession.js';
import { AppState } from './state.js';

export function setupUndo(app) {
    UndoManager.init({
        getToken: () => AppState.user.token,
        isEnabled: () => AppState.user.isLoggedIn && !DrawingBoard.active,
        onRestore: (item, { preserveView = false } = {}) => app.restoreItem(item, preserveView),
        onRemove: (itemId) => app.removeItemFromWorkspace(itemId),
        onBeforeUndoRedo: () => import('../plannerUi.js')
            .then(({ flushOpenPlannerCommits }) => flushOpenPlannerCommits())
            .catch(() => {}),
        onStackChange: () => {
            SidebarHistory.renderPanel();
            app.renderQuickActionsHeaderIcons();
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

export function setupNotePopoutBridge(app) {
    NotePopoutBridge.init({
        role: 'main',
        handlers: {
            onClaimChanged: (noteId, item) => app.handlePopoutClaimChanged(noteId, item),
            onClaimsStorageSync: () => app.handleClaimsStorageSync(),
            onNoteSaved: (noteId, item) => app.handlePopoutNoteSaved(noteId, item),
            onUndoChanged: () => {
                if (!UndoManager.isApplying) {
                    UndoManager.reloadFromStorage();
                    SidebarHistory.renderPanel();
                    app.renderQuickActionsHeaderIcons();
                }
            }
        }
    });
    // Refresh any notes already claimed by surviving popouts.
    NotePopoutBridge.syncAllPopoutButtons();
    app.refreshPopoutLockedCards();
}

export function handleClaimsStorageSync(app) {
    app.refreshPopoutLockedCards();
}

export function handlePopoutClaimChanged(app, noteId, closedItem = null) {
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
        app.refreshPopoutLockedCard(noteId);
        if (Editor.activeItem?.id === noteId && NotePopoutBridge.isClaimedByOther(noteId)) {
            Editor.close?.();
        }
        return;
    }
    app.handleClaimsStorageSync();
}

export function refreshPopoutLockedCards(app) {
    const canvas = document.getElementById('app-canvas');
    if (!canvas) return;
    canvas.querySelectorAll('.mini-card[data-id]').forEach((card) => {
        const id = card.dataset.id;
        if (!id || !shouldRefreshPopoutLockedCard(id, card, NotePopoutBridge)) return;
        const item = AppState.items.find((it) => it.id === id);
        if (item) UI.updateSingleCard(canvas, item, AppState.hiddenCategories);
    });
}

export function refreshPopoutLockedCard(app, noteId) {
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

export function handlePopoutNoteSaved(app, noteId, remoteItem) {
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
    app.updateWorkspaceCounter();
}

export function setupCrossTabSync(app) {
    let toastShown = false;
    initCrossTabSync({
        onBoardRefresh: (scopes, info) => app.refreshBoardFromSync(scopes, info),
        onVisualRefresh: (scope) => app.applyVisualFromSync(scope),
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
export async function refreshBoardFromSync(app, scopes, info) {
    const canvas = document.getElementById('app-canvas');
    if (!canvas) return;

    // Links are lightweight text content and must not rebuild the board.
    // A links-only batch is fully handled by the sidebar/manager refresh.
    if (scopes.includes('links')) {
        SidebarLinks.refresh();
        if (scopes.length === 1 && scopes[0] === 'links') return;
    }

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
        await app.applyWorkspaceMode(remoteWorkspaceMode, { skipPersist: true });
    }

    if (AppState.workspaceMode === 'drawing') return;

    const data = API._getLocalDB();
    if (Array.isArray(data?.items)) {
        AppState.items = DesktopManager.sanitizeNotesDesktops(data.items);
    }
    app.applyPendingCategoryAliases();

    // Single-note saves hint a targeted card refresh — cheapest path. Any
    // other scope (or a structural change in the notes set) uses a full re-render.
    const isSingleNote = scopes.length === 1
        && scopes[0] === 'notes'
        && info?.noteId
        && !info?.deleted
        && AppState.items.some((i) => i.id === info.noteId);
    if (isSingleNote && !app.isUserBusyOnCard(info.noteId)) {
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
    DragDropEngine.init(AppState.user, AppState.items, () => app.syncDataStore());

    app.refreshSidebarAfterSync();
}

/**
 * Note ids whose board mini-card DOM is stale because another host owns them.
 * Used to skip board flush so we do not clobber Focus / modal / popout saves.
 */
export function resolveStaleBoardFlushSkipIds(app) {
    const ids = new Set();
    const modalOpen = Editor.activeItem
        && Editor.overlay
        && (Editor.overlay.classList.contains('is-open') || !Editor.overlay.classList.contains('is-hidden'));
    if (modalOpen && Editor.activeItem?.id) ids.add(Editor.activeItem.id);
    if (MagicFocus.isOpen() && MagicFocus.getActiveItemId()) {
        ids.add(MagicFocus.getActiveItemId());
    }
    for (const id of NotePopoutBridge.listPoppedOutNoteIds()) {
        if (id) ids.add(id);
    }
    return [...ids];
}

/**
 * Persist active non-board hosts, then flush board cards with skip set.
 * Order: Focus → modal → board (matching plan lifecycle).
 */
export function flushPendingNoteHostsForLifecycle(app) {
    if (MagicFocus.isOpen()) {
        MagicFocus.flushPendingEdits();
    }
    const modalOpen = Editor.activeItem
        && Editor.overlay
        && (Editor.overlay.classList.contains('is-open') || !Editor.overlay.classList.contains('is-hidden'));
    if (modalOpen) {
        Editor.persistNote({ force: true, normalize: true });
    }
    const canvas = document.getElementById('app-canvas');
    if (canvas) {
        UI.flushAllInlineEditsFromCanvas(canvas, AppState.items, {
            skipItemIds: app.resolveStaleBoardFlushSkipIds()
        });
    }
}

/** True if this tab is actively editing the given card — don't clobber it. */
export function isUserBusyOnCard(app, noteId) {
    if (!noteId) return false;
    if (MagicFocus.isOpen() && MagicFocus.getActiveItemId() === noteId) return true;
    const active = document.activeElement?.closest?.('.card-inline-edit');
    if (!active) return false;
    if (active.closest?.('#magic-focus')) {
        // Focus pane edit for this note (or any Focus edit while that note is active).
        return MagicFocus.getActiveItemId() === noteId;
    }
    const card = active.closest?.('.mini-card');
    return !!card && card.dataset?.id === noteId;
}

export function refreshSidebarAfterSync(app) {
    app.updateWorkspaceCounter();
    DesktopDock.refreshButtons(AppState.items);
    NotePopoutBridge.syncAllPopoutButtons();
    SidebarHistory.renderPanel();
    app.renderQuickActionsHeaderIcons();
    BoardSort.refreshMenu();
    Calendar.refresh?.();
}

export function applyVisualFromSync(app, scope) {
    if (scope === 'theme') {
        applyUserTheme(readUserTheme());
    } else if (scope === 'display') {
        applyDisplayOptions(readDisplayOptions());
        DesktopZoom.apply();
        BoardRulers.sync?.();
        import('../plannerUi.js').then(({ refreshAllPlannerCharts }) => {
            refreshAllPlannerCharts(AppState.items || []);
        }).catch(() => {});
    }
}

export async function removeItemFromWorkspace(app, itemId) {
    AppState.items = AppState.items.filter((i) => i.id !== itemId);
    if (Editor.activeItem?.id === itemId) Editor.close();
    await app.syncDataStore();
}

export async function restoreItem(app, item, preserveView = false) {
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
            DragDropEngine.init(AppState.user, AppState.items, () => app.syncDataStore());
        }
        app.updateWorkspaceCounter();
        await app.refreshPlannerHostsAfterRestore(merged);
        return;
    }
    
    // Handle desktop switching for undo/redo
    const itemDesktop = item?.desktopId || 1;
    const currentDesktop = DesktopManager.getActiveDesktop();
    const needsDesktopSwitch = itemDesktop !== currentDesktop;
    
    if (needsDesktopSwitch) {
        DesktopManager.setActiveDesktop(itemDesktop);
    }
    
    await app.syncDataStore();
    await app.refreshPlannerHostsAfterRestore(merged);
    
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

export async function refreshPlannerHostsAfterRestore(app, item) {
    if (!item?.id || !item?.planner) return;
    try {
        const { syncNotePlannerDom } = await import('../plannerUi.js');
        syncNotePlannerDom(item);
    } catch (err) {
        console.warn('[Undo] syncNotePlannerDom failed:', err);
    }
    if (MagicFocus.isOpen() && MagicFocus.getActiveItemId() === item.id) {
        try {
            await MagicFocus.refreshPlannerPanes?.(item);
        } catch (err) {
            console.warn('[Undo] refreshPlannerPanes failed:', err);
        }
    }
}

export function setupQuickActionsHeaderListeners(app) {
    const headerFreeform = document.getElementById('qa-header-freeform-toggle');
    const headerCabinet = document.getElementById('qa-header-file-cabinet-toggle');
    const headerUndo = document.getElementById('qa-header-undo');
    const headerRedo = document.getElementById('qa-header-redo');

    // Bind once natively using dataset checks to prevent listener pileups
    if (headerFreeform && !headerFreeform.dataset.listenerBound) {
        headerFreeform.addEventListener('click', (e) => {
            e.stopPropagation();
            app.toggleBoardOverlay();
        });
        headerFreeform.dataset.listenerBound = 'true';
    }
    if (headerCabinet && !headerCabinet.dataset.listenerBound) {
        headerCabinet.addEventListener('click', (e) => {
            e.stopPropagation();
            app.toggleFileCabinet();
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

export function setupScribbleFab(app) {
    QuickScribble.init();
    const scribbleFab = document.getElementById('fab-scribble');
    if (!scribbleFab) return;
    scribbleFab.innerHTML = CARD_ICONS.drawingPencil;
    scribbleFab.addEventListener('click', () => {
        QuickScribble.toggleFromFab();
    });
}

export function setupDrawingMode(app) {
    document.addEventListener('keydown', (e) => {
        if (DrawingBoard.handleKeydown(e)) return;
    });
}

export function setupLayoutResetButton(app) {
    const btn = document.getElementById('btn-layout-reset');
    if (btn) btn.innerHTML = ACTION_ICONS.layoutReset;
    btn?.addEventListener('click', async () => {
        if (AppState.workspaceMode === 'drawing') {
            await app.switchWorkspaceMode('notes');
        }
        UI.resetBoardLayout(AppState.viewSettings.sortBy, AppState.items, {
            fileCabinetActive: AppState.viewSettings.fileCabinet
        });
    });
}

export function setupSearchBar(app) {
    SearchBar.init({
        getItems: () => AppState.items,
        onOpenItem: (item) => {
            window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: item }));
        }
    });
}

export function setupCoreListeners(app) {
    window.addEventListener('resize', () => {
        app.updateDesktopZoomVisibility();
        const canvas = document.getElementById('app-canvas');
        if (canvas) UI.updateBoardCanvasExtents(canvas);
    });
    window.addEventListener('desktop:zoom_changed', () => {
        const canvas = document.getElementById('app-canvas');
        if (canvas) {
            UI.updateBoardCanvasExtents(canvas);
        }
    });

    // Beforeunload: Focus → modal → board (skip hosts that own the note).
    window.addEventListener('beforeunload', () => {
        app.flushPendingNoteHostsForLifecycle();
    });

    // Visibilitychange: same flush order when tab hides (switch / minimize).
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            app.flushPendingNoteHostsForLifecycle();
        }
    });

    window.addEventListener('item:selected_for_edit', (e) => {
        if (!AppState.user.isLoggedIn) {
            alert("Authorization Blocked: Admin privileges required to edit workspace resources.");
            return;
        }
        const detail = e.detail;
        const item = detail?.item ?? detail;
        // Mutex: modal and Focus cannot co-edit the same note.
        if (item?.id && MagicFocus.isOpen() && MagicFocus.getActiveItemId() === item.id) {
            MagicFocus.close();
        }
        Editor.open(item, AppState.categories);
    });

    window.addEventListener('note:canvas_draw_requested', (e) => {
        const item = e.detail?.item;
        if (!item?.id) return;
        app.enterNoteCanvasMode(item);
    });

    window.addEventListener('note:flowchart_draw_requested', (e) => {
        const item = e.detail?.item;
        if (!item?.id) return;
        app.enterFlowchartMode(item);
    });

    window.addEventListener('note:canvas_draw_exited', (e) => {
        const item = e.detail?.item;
        app.exitNoteCanvasMode(item);
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
                DragDropEngine.init(AppState.user, AppState.items, () => app.syncDataStore());
            }
        } else {
            // New note (or card missing from this view): full sync so a board
            // card is created when the note belongs on the active desktop.
            await app.syncDataStore();
            card = canvas?.querySelector(`.mini-card[data-id="${item.id}"]`);
        }

        app.updateWorkspaceCounter();

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
        app._pendingItemSaves.add(saveTask);
        const success = await saveTask;
        app._pendingItemSaves.delete(saveTask);
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
                    DragDropEngine.init(AppState.user, AppState.items, () => app.syncDataStore());
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
                import('../noteAttachmentsUi.js').then(({ syncNoteAttachmentsDom, syncNoteCanvasDom }) => {
                    const current = AppState.items.find((i) => i.id === liveItem?.id) || liveItem;
                    syncNoteAttachmentsDom(current);
                    syncNoteCanvasDom(current);
                    const c = document.getElementById('app-canvas');
                    if (c) {
                        c.scrollTop = canvasScroll.scrollTop;
                        c.scrollLeft = canvasScroll.scrollLeft;
                    }
                }).catch(() => {});
            }
            app.updateWorkspaceCounter();
            return;
        }
        await app.syncDataStore();
    });

    window.addEventListener('board:visibility_changed', async (e) => {
        const canvas = document.getElementById('app-canvas');
        const skipFlush = e.detail?.flushLayout === false;
        const transition = e.detail?.transition;

        // Concurrent non-FC render while an FC expand is in flight → abort fly.
        if (transition?.kind !== 'fc-expand' && document.body.classList.contains('is-fc-transitioning')) {
            import('../uiTransitions.js').then(({ cancelAll }) => cancelAll()).catch(() => {});
        }

        if (canvas && !skipFlush) {
            UI.flushLayoutFromCanvas(canvas, AppState.viewSettings.sortBy);
        }
        UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories, {
            skipGridReflow: e.detail?.skipGridReflow === true
        });
        app.updateWorkspaceCounter();
        DragDropEngine.init(AppState.user, AppState.items, () => app.syncDataStore());

        if (transition?.kind === 'fc-expand' && transition.itemId && transition.sourceRect) {
            const itemId = transition.itemId;
            const pendingCard = canvas?.querySelector(`.mini-card[data-id="${CSS.escape(itemId)}"]`);
            pendingCard?.classList.add('ui-fc-expand-pending');
            requestAnimationFrame(() => {
                import('../uiTransitions.js').then(({ runFcExpandAfterRender, clearFcExpandTransition }) => {
                    runFcExpandAfterRender({
                        itemId,
                        sourceRect: transition.sourceRect,
                        UI
                    }).catch(() => clearFcExpandTransition());
                }).catch(() => {});
            });
        }
    });

    window.addEventListener('filecabinet:layout_changed', async (e) => {
        const canvas = document.getElementById('app-canvas');
        const skipFlush = e.detail?.flushLayout === false;
        if (canvas && !skipFlush) {
            UI.flushLayoutFromCanvas(canvas, AppState.viewSettings.sortBy);
        }
        UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
        DragDropEngine.init(AppState.user, AppState.items, () => app.syncDataStore());
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

        const noteCount = (AppState.items || []).filter((item) => {
            if (item.status === 'archived') return false;
            return getItemCategoryName(item) === catName;
        }).length;
        const warn = noteCount > 0
            ? `Hide "${catName}"? ${noteCount} note${noteCount === 1 ? '' : 's'} in this category will become Uncategorized.`
            : `Hide "${catName}"? Notes assigned to it later will not use this category until it is shown again.`;
        if (!confirm(warn)) return;

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
        app.syncDataStore();
    });

    window.addEventListener('category:add_requested', (e) => {
        const { name, color, anchor } = e.detail || {};
        app.executeAddCategory({
            name,
            color,
            anchor: anchor || null,
            openPicker: !!anchor
        });
    });

    window.addEventListener('categories:manage_requested', () => {
        CategoriesOverlay.open();
    });

    window.addEventListener('links:manage_requested', (e) => {
        LinksOverlay.open({ focusAdd: !!e.detail?.focusAdd });
    });

    window.addEventListener('category:add_prompt', () => {
        // FC Add opens the manager with the add field focused
        CategoriesOverlay.open({ focusAdd: true });
    });

    window.addEventListener('category:color_changed', (e) => {
        const { name, color } = e.detail || {};
        if (!name) return;
        const next = updateCategoryColor(name, color, AppState.categories);
        if (!next) return;
        AppState.categories = next;
        applyCategoryColorLive(name, color, AppState.items);
        SidePanel.updateCategories(AppState.categories, AppState.hiddenCategories, AppState.items);
        if (CategoriesOverlay.isOpen()) CategoriesOverlay.refresh();
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
        app.syncDataStore();
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
        await app.syncDataStore();
    });

    // Handle desktop switching - refresh workspace to show notes for active desktop
    window.addEventListener('desktop:changed', async (e) => {
        const canvas = document.getElementById('app-canvas');
        if (canvas && AppState.workspaceMode !== 'drawing') {
            UI.flushLayoutFromCanvas(canvas, AppState.viewSettings.sortBy);
            UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
            DragDropEngine.init(AppState.user, AppState.items, () => app.syncDataStore());
        }
        app.updateWorkspaceCounter();
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
