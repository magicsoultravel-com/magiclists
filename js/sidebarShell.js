/** @module {"owns":"sidebar shell undock, minimal rail presentation", "related":["sidebarUndock.js","sidebarModules.js","sidebarPrefs.js","shellResize.js","hamburger.js"]} */
import { initSidebarUndock } from './sidebarUndock.js';
import { readShellDock, writeShellDock } from './sidebarPrefs.js';
import { SidePanel } from './hamburger.js';
import { onShellDockChanged } from './shellResize.js';
import { ClockStyle } from './clockStyle.js';
import { RadioPopover } from './radioPopover.js';
import { TvPopover } from './tvPopover.js';
import { CARD_ICONS } from './icons.js';

export const SIDEBAR_SHELL_UNDOCKED = 'side-panel--undocked';
export const SIDEBAR_SHELL_MINIMAL = 'side-panel--minimal';
export const SIDEBAR_SHELL_MODULES_EMPTY = 'side-panel--modules-empty';
export const SIDEBAR_SHELL_DRAGGING = 'side-panel--dragging';
export const SIDEBAR_SHELL_DOCK_SEL = '[data-sidebar-shell-dock]';

/** @type {ReturnType<typeof initSidebarUndock>|null} */
let shellUndock = null;
/** @type {Element|null} */
let dockInsertBefore = null;

function getPanel() {
    return document.getElementById('side-panel');
}

function countModulesInPanel() {
    const mount = document.querySelector('.side-panel-modules');
    if (!mount) return 0;
    return mount.querySelectorAll('.sidebar-module').length;
}

function captureDockAnchor() {
    const panel = getPanel();
    const shell = document.getElementById('workspace-shell');
    if (!panel || !shell || panel.parentElement !== shell) return;
    dockInsertBefore = panel.nextElementSibling;
}

function restoreShellToSidebar() {
    const panel = getPanel();
    const shell = document.getElementById('workspace-shell');
    if (!panel || !shell) return;

    if (dockInsertBefore && dockInsertBefore.parentElement === shell) {
        shell.insertBefore(panel, dockInsertBefore);
        return;
    }

    const fab = document.getElementById('nav-panel-toggle-fab');
    fab?.insertAdjacentElement('afterend', panel);
    captureDockAnchor();
}

function repositionAttachedPopovers() {
    ClockStyle.repositionPopover?.();
    RadioPopover.reposition?.();
    TvPopover.reposition?.();
}

export function isShellUndocked() {
    return shellUndock?.isUndocked() ?? false;
}

export function updateShellPresentation() {
    const panel = getPanel();
    if (!panel) return;

    const modulesInPanel = countModulesInPanel();
    const undocked = isShellUndocked();
    const emptyModules = modulesInPanel === 0;

    panel.classList.toggle(SIDEBAR_SHELL_MODULES_EMPTY, emptyModules);
    panel.classList.toggle(SIDEBAR_SHELL_MINIMAL, undocked && emptyModules);
    document.body.classList.toggle('shell-sidebar-floating', undocked);

    onShellDockChanged();
}

export function reattachSidebarShell() {
    if (!shellUndock?.isUndocked()) return;
    shellUndock.applyDockedState();
    shellUndock.updateDockButton();
    updateShellPresentation();
    repositionAttachedPopovers();
}

export function initSidebarShell() {
    const panel = getPanel();
    if (!panel || panel.dataset.shellUndockInit === 'true') return;
    panel.dataset.shellUndockInit = 'true';

    // Initialize undock button icon on load
    const dockBtn = panel.querySelector(SIDEBAR_SHELL_DOCK_SEL);
    if (dockBtn && !dockBtn.innerHTML.trim()) {
        dockBtn.innerHTML = CARD_ICONS.unpin;
    }

    captureDockAnchor();

    shellUndock = initSidebarUndock({
        getRoot: getPanel,
        undockedClass: SIDEBAR_SHELL_UNDOCKED,
        draggingClass: SIDEBAR_SHELL_DRAGGING,
        dockSelector: SIDEBAR_SHELL_DOCK_SEL,
        getHeader: () => document.getElementById('side-panel-brand-host'),
        readDock: readShellDock,
        writeDock: writeShellDock,
        restoreToSidebar: restoreShellToSidebar,
        onBeforeUndock: () => {
            if (panel.classList.contains('is-collapsed')) {
                SidePanel.setCollapsed(false, { persist: false });
            }
        },
        onPositionChange: repositionAttachedPopovers,
        onStateChange: () => {
            updateShellPresentation();
            window.dispatchEvent(new CustomEvent('floating:chrome_changed'));
        },
        dragBlockSelector: '.side-panel-toggle-btn, .sidebar-reattach-all, .sidebar-shell__dock'
    });

    shellUndock.applyInitialDockState();
    updateShellPresentation();

    window.addEventListener('floating:chrome_changed', updateShellPresentation);
    window.addEventListener('sidebar:shell_dock_requested', () => reattachSidebarShell());
}