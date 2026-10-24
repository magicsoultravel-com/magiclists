/** @module {"owns":"the focus session - open/close/toggle, the morph shell in and out, the escape key, item resolution and the pending-edit flush that must happen before the workspace tears down", "related":["magicFocus.js","magicFocus/render.js","magicFocus/setup.js","uiTransitions.js","noteSurface.js"]} */
import { CARD_ICONS } from '../icons.js';
import { flushDesktopAutoSave } from '../noteSurface.js';
import { Editor } from '../editor.js';
import {
    isUiTransitionsEnabled,
    morphElements,
    setChromeVisible,
    UI_TRANSITION_MS
} from '../uiTransitions.js';
import { FOCUS_ZOOM_DEFAULT, asBlockList, normalizeFocus, focusIsConfigured } from './model.js';


export const MORPH_CLASS = 'ui-morph-hidden';

export const FOCUS_MORPH_BODY = 'is-focus-morphing';

export function forceReflow(el) {
    void el?.offsetWidth;
}

export function boardChromeEls() {
    return [
        document.getElementById('fab-create'),
        document.getElementById('desktop-dock'),
        document.getElementById('app-canvas'),
        document.getElementById('file-cabinet'),
        document.getElementById('shell-splitter-h'),
        document.getElementById('file-cabinet-toggle-fab')
    ].filter(Boolean);
}

export function init(magicFocus, app, ui) {
    magicFocus._app = app;
    magicFocus._ui = ui;
    magicFocus.root = document.getElementById('magic-focus');
    if (!magicFocus.root) return;
    magicFocus.headerEl = magicFocus.root.querySelector('[data-magic-focus-header]');
    magicFocus.bodyEl = magicFocus.root.querySelector('[data-magic-focus-body]');
    magicFocus.root.classList.add('is-hidden');
    magicFocus.root.setAttribute('aria-hidden', 'true');
    magicFocus._wireExitFab();
}

export function _wireExitFab(magicFocus) {
    magicFocus._exitFab = document.getElementById('fab-focus-exit');
    if (!magicFocus._exitFab || magicFocus._exitFab.dataset.focusExitWired === '1') return;
    magicFocus._exitFab.dataset.focusExitWired = '1';
    magicFocus._exitFab.innerHTML = CARD_ICONS.focus;
    magicFocus._exitFab.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (magicFocus.isOpen()) magicFocus.close();
    });
}

export function syncExitFabVisibility(magicFocus, { inDrawing = false, instant = false } = {}) {
    const fab = magicFocus._exitFab || document.getElementById('fab-focus-exit');
    if (!fab) return;
    const visible = !inDrawing && magicFocus.isOpen();
    if (isUiTransitionsEnabled() && !instant) {
        setChromeVisible(fab, visible);
        return;
    }
    fab.classList.toggle('is-hidden', !visible);
    fab.classList.remove(MORPH_CLASS);
}

export function isOpen(magicFocus) {
    return !!magicFocus.activeItemId && !magicFocus.root?.classList.contains('is-hidden');
}

export function getActiveItemId(magicFocus) {
    return magicFocus.activeItemId;
}

export function getLiveItem(magicFocus) {
    if (!magicFocus.activeItemId || !magicFocus._app?.state?.items) {
        // AppState is not always exposed; fall back via window event or app items
    }
    const items = magicFocus._app?.getItems?.() || magicFocus._resolveItems();
    return items.find((i) => i.id === magicFocus.activeItemId) || null;
}

export function _resolveItems(magicFocus) {
    try {
        return magicFocus._app?.constructor === Object ? [] : (window.__magicFocusItems?.() || []);
    } catch {
        return [];
    }
}

export function setItemResolver(magicFocus, fn) {
    magicFocus._itemResolver = fn;
}

export function resolveItem(magicFocus) {
    if (typeof magicFocus._itemResolver === 'function') {
        return magicFocus._itemResolver(magicFocus.activeItemId);
    }
    return null;
}

export async function open(magicFocus, item, { forceSetup = false } = {}) {
    if (!item?.id || !magicFocus.root) return;
    if (!(item.planner && !item.plannerHidden)) return;

    // Leave drawing workspace if needed
    if (magicFocus._app?.stateWorkspaceMode?.() === 'drawing' || magicFocus._app?.isDrawingMode?.()) {
        await magicFocus._app.exitDrawingForFocus?.();
    }

    // Mutex: same note cannot be edited in modal and Focus at once.
    const modalOpen = Editor.activeItem?.id === item.id
        && Editor.overlay
        && !Editor.overlay.classList.contains('is-hidden');
    if (modalOpen) {
        Editor.persistNote({ force: true, normalize: true });
        Editor.close();
    }

    magicFocus._clearSessionSpawn();
    magicFocus.activeItemId = item.id;
    const live = magicFocus.resolveItem() || item;
    const configured = focusIsConfigured(live.focus);

    await magicFocus._enterShell();
    magicFocus.applyNoteTheme(live);
    magicFocus.renderHeader(live);

    if (forceSetup || !configured) {
        magicFocus.showingSetup = true;
        magicFocus.setupStep = 'layout';
        magicFocus.setupDraft = null;
        magicFocus.renderSetup(live);
    } else {
        magicFocus.showingSetup = false;
        magicFocus.setupDraft = null;
        magicFocus.setupStep = 'layout';
        await magicFocus.renderWork(live);
    }

    magicFocus._bindEsc();
    magicFocus._syncFocusButtons();
}

export async function openExpandedBlocks(magicFocus, item, blocks) {
    if (!item?.id || !magicFocus.root) return;
    const list = asBlockList(blocks);
    if (!list.length) return;

    if (magicFocus._app?.stateWorkspaceMode?.() === 'drawing' || magicFocus._app?.isDrawingMode?.()) {
        await magicFocus._app.exitDrawingForFocus?.();
    }

    const modalOpen = Editor.activeItem?.id === item.id
        && Editor.overlay
        && !Editor.overlay.classList.contains('is-hidden');
    if (modalOpen) {
        Editor.persistNote({ force: true, normalize: true });
        Editor.close();
    }

    const alreadyOpenForItem = magicFocus.isOpen() && magicFocus.activeItemId === item.id;
    magicFocus.activeItemId = item.id;
    magicFocus.sessionSpawnBlocks = list;
    magicFocus.sessionSpawnZoom = FOCUS_ZOOM_DEFAULT;
    magicFocus.showingSetup = false;
    magicFocus.setupDraft = null;
    magicFocus.setupStep = 'layout';
    magicFocus.expandedPaneId = null;

    const live = magicFocus.resolveItem() || item;
    if (!alreadyOpenForItem) {
        await magicFocus._enterShell();
    }
    magicFocus.applyNoteTheme(live);
    await magicFocus.renderWork(live);
    magicFocus._bindEsc();
    magicFocus._syncFocusButtons();
}

export function _clearSessionSpawn(magicFocus) {
    magicFocus.sessionSpawnBlocks = null;
    magicFocus.sessionSpawnZoom = FOCUS_ZOOM_DEFAULT;
}

export async function openSettings(magicFocus) {
    const item = magicFocus.resolveItem();
    if (!item) return;
    magicFocus._clearSessionSpawn();
    magicFocus.clearExpandedPane();
    magicFocus.showingSetup = true;
    const existing = normalizeFocus(item.focus);
    if (existing) {
        magicFocus.setupDraft = existing;
        magicFocus.setupStep = 'assign';
    } else {
        magicFocus.setupDraft = null;
        magicFocus.setupStep = 'layout';
    }
    // Tear down hosted drawing before setup
    await magicFocus._unhostDrawingBoard();
    magicFocus.renderSetup(item);
}

export function flushPendingEdits(magicFocus) {
    if (!magicFocus.activeItemId || !magicFocus.root || magicFocus.root.classList.contains('is-hidden')) return;
    const item = magicFocus.resolveItem();
    if (!item) return;
    const shells = [];
    const headerShell = magicFocus.headerEl?.querySelector?.('[data-magic-focus-shell]');
    if (headerShell) shells.push(headerShell);
    magicFocus.bodyEl?.querySelectorAll?.('.magic-focus__pane.editor-note-shell').forEach((pane) => {
        shells.push(pane);
    });
    // Deduplicate if header somehow nested (should not happen).
    const seen = new Set();
    for (const shell of shells) {
        if (!shell || seen.has(shell)) continue;
        seen.add(shell);
        flushDesktopAutoSave(shell, item, { mergeWindow: false });
    }
}

export async function close(magicFocus) {
    magicFocus.flushPendingEdits();
    // Release host ownership synchronously so modal open / busy guards /
    // skip lists see Focus as closed without awaiting unhost/teardown.
    const wasOpen = magicFocus.isOpen();
    magicFocus.activeItemId = null;
    magicFocus.setupDraft = null;
    magicFocus.setupStep = 'layout';
    magicFocus.showingSetup = false;
    magicFocus.expandedPaneId = null;
    magicFocus._clearSessionSpawn();

    const useMorph = wasOpen && isUiTransitionsEnabled() && magicFocus.root;
    const focusRoot = magicFocus.root;
    const exitFab = magicFocus._exitFab || document.getElementById('fab-focus-exit');
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
        await magicFocus._unhostDrawingBoard();
        if (magicFocus.bodyEl) magicFocus.bodyEl.innerHTML = '';
        if (magicFocus.headerEl) magicFocus.headerEl.innerHTML = '';
        magicFocus.applyNoteTheme(null);

        returning.forEach((el) => {
            el.classList.remove('is-hidden');
            el.classList.remove('is-suppressed');
        });
        canvas?.classList.remove('is-hidden');

        await magicFocus._app?.onMagicFocusLeave?.({ deferChrome: true });

        // 3) Fade canvas + chrome in together
        forceReflow(canvas || document.body);
        returning.forEach((el) => el.classList.remove(MORPH_CLASS));
        await new Promise((r) => window.setTimeout(r, UI_TRANSITION_MS));

        document.body.classList.remove(FOCUS_MORPH_BODY);
        focusRoot.classList.remove(MORPH_CLASS);
        exitFab?.classList.remove(MORPH_CLASS);
        magicFocus._app?.updateFabVisibility?.({ instant: true });
        magicFocus._app?.applyDesktopDockAfterFocusLeave?.();
        magicFocus._unbindEsc();
        magicFocus._syncFocusButtons();
        magicFocus.syncExitFabVisibility({ instant: true });
        return;
    }

    magicFocus.root?.classList.add('is-hidden');
    magicFocus.root?.setAttribute('aria-hidden', 'true');
    shell?.removeAttribute('data-magic-focus');
    await magicFocus._unhostDrawingBoard();
    if (magicFocus.bodyEl) magicFocus.bodyEl.innerHTML = '';
    if (magicFocus.headerEl) magicFocus.headerEl.innerHTML = '';
    magicFocus.applyNoteTheme(null);
    await magicFocus._leaveShell();
    magicFocus._unbindEsc();
    magicFocus._syncFocusButtons();
    magicFocus.syncExitFabVisibility({ instant: true });
}

export async function toggle(magicFocus, item) {
    if (magicFocus.isOpen() && magicFocus.activeItemId === item?.id) {
        await magicFocus.close();
        return;
    }
    await magicFocus.open(item);
}

export async function _enterShell(magicFocus) {
    const shell = document.getElementById('workspace-shell');
    const canvas = document.getElementById('app-canvas');
    const exitFab = magicFocus._exitFab || document.getElementById('fab-focus-exit');

    if (!isUiTransitionsEnabled()) {
        shell?.setAttribute('data-magic-focus', '');
        canvas?.classList.add('is-hidden');
        magicFocus.root.classList.remove('is-hidden');
        magicFocus.root.setAttribute('aria-hidden', 'false');
        magicFocus._app?.onMagicFocusEnter?.();
        magicFocus.syncExitFabVisibility({ instant: true });
        return;
    }

    const hide = boardChromeEls();
    await morphElements({
        hide,
        show: [magicFocus.root, exitFab].filter(Boolean),
        mutate: () => {
            shell?.setAttribute('data-magic-focus', '');
            canvas?.classList.add('is-hidden');
            magicFocus.root.classList.remove('is-hidden');
            magicFocus.root.setAttribute('aria-hidden', 'false');
            exitFab?.classList.remove('is-hidden');
            magicFocus._app?.onMagicFocusEnter?.({ deferChrome: true });
        }
    });

    // Steady-state hard hide for board chrome (strip morph class after hard hide)
    magicFocus._app?.updateFabVisibility?.({ instant: true });
    magicFocus._app?.applyDesktopDockAfterFocusEnter?.();
    hide.forEach((el) => el.classList.remove(MORPH_CLASS));
    magicFocus.syncExitFabVisibility({ instant: true });
}

export async function _leaveShell(magicFocus) {
    const shell = document.getElementById('workspace-shell');
    const canvas = document.getElementById('app-canvas');
    shell?.removeAttribute('data-magic-focus');
    canvas?.classList.remove('is-hidden');
    await magicFocus._app?.onMagicFocusLeave?.();
    magicFocus.syncExitFabVisibility({ instant: true });
}

export function _bindEsc(magicFocus) {
    magicFocus._unbindEsc();
    magicFocus._escHandler = (e) => {
        if (e.key !== 'Escape') return;
        if (magicFocus.showingSetup) {
            e.preventDefault();
            if (magicFocus.setupStep === 'assign' && magicFocus.setupDraft) {
                magicFocus.setupStep = 'layout';
                magicFocus.renderSetup(magicFocus.resolveItem());
                return;
            }
            if (focusIsConfigured(magicFocus.resolveItem()?.focus)) {
                magicFocus.showingSetup = false;
                magicFocus.renderWork(magicFocus.resolveItem());
                return;
            }
            magicFocus.close();
            return;
        }
        // Spawn session is already a single pane — Esc exits Focus.
        if (magicFocus.sessionSpawnBlocks?.length) {
            e.preventDefault();
            magicFocus.close();
            return;
        }
        if (magicFocus.expandedPaneId) {
            e.preventDefault();
            magicFocus.clearExpandedPane();
            return;
        }
        e.preventDefault();
        magicFocus.close();
    };
    window.addEventListener('keydown', magicFocus._escHandler);
}

export function _unbindEsc(magicFocus) {
    if (magicFocus._escHandler) {
        window.removeEventListener('keydown', magicFocus._escHandler);
        magicFocus._escHandler = null;
    }
}

export function _syncFocusButtons(magicFocus) {
    document.querySelectorAll('.card-act--focus').forEach((btn) => {
        const id = btn.getAttribute('data-note-id');
        const active = magicFocus.isOpen() && id === magicFocus.activeItemId;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

export function noteBodiesForItem(magicFocus, itemId) {
    if (!magicFocus.isOpen() || itemId !== magicFocus.activeItemId || !magicFocus.bodyEl) return [];
    return Array.from(magicFocus.bodyEl.querySelectorAll('.magic-focus__pane-body.editor-note-body'));
}
