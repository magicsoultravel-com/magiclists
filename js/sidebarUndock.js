/** @module {"owns":"shared undock/drag/clamp for sidebar panels", "related":["desktopStack.js","popoverPosition.js","sidebarPrefs.js"]} */
import { clampPanelToViewport } from './popoverPosition.js';
import { raiseDesktopElement } from './desktopStack.js';
import { CARD_ICONS } from './icons.js';

export const SIDEBAR_MODULE_UNDOCKED = 'sidebar-module--undocked';
export const SIDEBAR_MODULE_DRAGGING = 'sidebar-module--dragging';
export const SIDEBAR_MODULE_DOCK_SEL = '[data-sidebar-dock]';
export const SIDEBAR_MODULE_POPOUT_SEL = '[data-sidebar-popout]';
export const SIDEBAR_MODULE_POPIN_SEL = '[data-sidebar-popin]';
export const SIDEBAR_MODULE_CHROME_IGNORE = `${SIDEBAR_MODULE_DOCK_SEL}, ${SIDEBAR_MODULE_POPOUT_SEL}, ${SIDEBAR_MODULE_POPIN_SEL}`;

const DRAG_THRESHOLD = 4;

function ensureUndockedInBody(root) {
    if (root.parentElement !== document.body) {
        document.body.appendChild(root);
    }
}

function applyPosition(root, x, y) {
    const clamped = clampPanelToViewport(root, x, y);
    root.style.left = `${clamped.x}px`;
    root.style.top = `${clamped.y}px`;
    return clamped;
}

/**
 * @param {{
 *   getRoot: () => HTMLElement|null,
 *   undockedClass: string,
 *   draggingClass: string,
 *   dockSelector: string,
 *   getHeader: () => HTMLElement|null,
 *   readDock: () => { docked: boolean, x: number|null, y: number|null, scale?: number|null },
 *   writeDock: (patch: { docked?: boolean, x?: number|null, y?: number|null, scale?: number|null }) => void,
 *   restoreToSidebar: () => void,
 *   onBeforeUndock?: () => void,
 *   onPositionChange?: () => void,
 *   onStateChange?: () => void,
 *   applyUndockChrome?: (root: HTMLElement) => void,
 *   clearUndockChrome?: (root: HTMLElement) => void,
 * }} config
 */
export function initSidebarUndock(config) {
    const {
        getRoot,
        undockedClass,
        draggingClass,
        dockSelector,
        getHeader,
        readDock,
        writeDock,
        restoreToSidebar,
        onBeforeUndock,
        onPositionChange,
        onStateChange,
        applyUndockChrome,
        clearUndockChrome
    } = config;

    function isUndocked() {
        return getRoot()?.classList.contains(undockedClass) ?? false;
    }

    function updateDockButton() {
        const root = getRoot();
        const btn = root?.querySelector(dockSelector);
        if (!btn) return;
        const undocked = isUndocked();
        btn.innerHTML = undocked ? CARD_ICONS.pin : CARD_ICONS.unpin;
        const label = undocked ? 'Dock in sidebar' : 'Undock to canvas';
        btn.setAttribute('title', label);
        btn.setAttribute('aria-label', label);
    }

    function applyDockedState() {
        const root = getRoot();
        if (!root) return;
        root.classList.remove(undockedClass, draggingClass);
        root.style.left = '';
        root.style.top = '';
        root.style.removeProperty('z-index');
        root.style.removeProperty('--sidebar-module-width');
        clearUndockChrome?.(root);
        restoreToSidebar();
        writeDock({ docked: true, x: null, y: null });
    }

    function applyUndockedState(persist = true) {
        const root = getRoot();
        if (!root) return;
        const rect = root.getBoundingClientRect();
        const saved = readDock();
        let x = saved.x ?? rect.left;
        let y = saved.y ?? rect.top;

        onBeforeUndock?.();
        ensureUndockedInBody(root);
        root.classList.add(undockedClass);
        root.style.left = `${x}px`;
        root.style.top = `${y}px`;
        root.style.removeProperty('--sidebar-module-width');
        applyUndockChrome?.(root);
        const clamped = applyPosition(root, x, y);
        raiseDesktopElement(root);

        if (persist) {
            writeDock({
                docked: false,
                x: clamped.x,
                y: clamped.y
            });
        }
    }

    function applyInitialDockState() {
        const root = getRoot();
        if (!root) return;
        const { docked, x, y } = readDock();
        if (docked !== false) {
            updateDockButton();
            onStateChange?.();
            return;
        }

        onBeforeUndock?.();
        ensureUndockedInBody(root);
        root.classList.add(undockedClass);
        applyUndockChrome?.(root);
        if (x != null && y != null) {
            root.style.left = `${x}px`;
            root.style.top = `${y}px`;
            requestAnimationFrame(() => {
                applyPosition(root, x, y);
                raiseDesktopElement(root);
            });
        } else {
            applyUndockedState(false);
        }
        updateDockButton();
        onStateChange?.();
    }

    function toggleDock() {
        if (isUndocked()) applyDockedState();
        else applyUndockedState();
        updateDockButton();
        onPositionChange?.();
        onStateChange?.();
    }

    function bindDockButton() {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest(dockSelector);
            if (!btn) return;
            const root = getRoot();
            if (!root?.contains(btn)) return;
            e.stopPropagation();
            toggleDock();
        });
    }

    function bindViewportClamp() {
        window.addEventListener('resize', () => {
            if (!isUndocked()) return;
            const root = getRoot();
            if (!root) return;
            const x = parseFloat(root.style.left) || 0;
            const y = parseFloat(root.style.top) || 0;
            applyPosition(root, x, y);
            onPositionChange?.();
        });
    }

    function beginDrag(e, header, root, { deferred }) {
        const startX = e.clientX;
        const startY = e.clientY;
        const startLeft = parseFloat(root.style.left) || 0;
        const startTop = parseFloat(root.style.top) || 0;
        let dragging = !deferred;
        let moved = false;

        if (!deferred) {
            e.preventDefault();
            e.stopPropagation();
            root.classList.add(draggingClass);
            header.setPointerCapture(e.pointerId);
        }

        const onMove = (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (!dragging) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
                dragging = true;
                moved = true;
                e.preventDefault();
                root.classList.add(draggingClass);
                try {
                    header.setPointerCapture(e.pointerId);
                } catch {
                    /* already captured or released */
                }
            }
            moved = true;
            applyPosition(root, startLeft + dx, startTop + dy);
            onPositionChange?.();
        };

        const onUp = (ev) => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            if (!dragging) return;
            dragging = false;
            root.classList.remove(draggingClass);
            try {
                header.releasePointerCapture(ev.pointerId);
            } catch {
                /* not captured */
            }
            if (moved) {
                header.dataset.suppressClick = 'true';
                setTimeout(() => {
                    delete header.dataset.suppressClick;
                }, 0);
                writeDock({
                    x: parseFloat(root.style.left) || 0,
                    y: parseFloat(root.style.top) || 0
                });
            }
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    }

    function bindDrag() {
        const header = getHeader();
        if (!header || header.dataset.sidebarUndockBound === 'true') return;
        header.dataset.sidebarUndockBound = 'true';

        header.addEventListener('pointerdown', (e) => {
            if (!isUndocked()) return;
            if (e.target.closest(dockSelector)
                || e.target.closest(SIDEBAR_MODULE_POPOUT_SEL)
                || e.target.closest(SIDEBAR_MODULE_POPIN_SEL)
                || e.target.closest('.collapsable-toggle')) return;
            if (e.target.closest('[data-sidebar-clock-resize]')) return;
            if (e.button !== 0) return;

            const root = getRoot();
            if (!root) return;

            // Defer the drag until the pointer moves past the threshold so a
            // plain click on the header/title can still toggle collapse/expand.
            beginDrag(e, header, root, { deferred: true });
        });
    }

    bindDockButton();
    bindDrag();
    bindViewportClamp();

    return {
        isUndocked,
        toggleDock,
        applyInitialDockState,
        applyDockedState,
        applyUndockedState,
        updateDockButton
    };
}
