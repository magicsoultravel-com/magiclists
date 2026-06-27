/** @module {"owns":"shared undock/drag/clamp for sidebar panels", "related":["desktopStack.js","popoverPosition.js","sidebarPrefs.js"]} */
import { clampPanelToViewport } from './popoverPosition.js';
import { raiseDesktopElement } from './desktopStack.js';
import { CARD_ICONS } from './icons.js';

export const SIDEBAR_MODULE_UNDOCKED = 'sidebar-module--undocked';
export const SIDEBAR_MODULE_DRAGGING = 'sidebar-module--dragging';
export const SIDEBAR_MODULE_DOCK_SEL = '[data-sidebar-dock]';

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
 *   readDock: () => { docked: boolean, x: number|null, y: number|null },
 *   writeDock: (patch: { docked?: boolean, x?: number|null, y?: number|null }) => void,
 *   restoreToSidebar: () => void,
 *   onBeforeUndock?: () => void,
 *   onPositionChange?: () => void,
 *   dragBlockSelector?: string,
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
        dragBlockSelector
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
            return;
        }

        onBeforeUndock?.();
        ensureUndockedInBody(root);
        root.classList.add(undockedClass);
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
    }

    function toggleDock() {
        if (isUndocked()) applyDockedState();
        else applyUndockedState();
        updateDockButton();
        onPositionChange?.();
    }

    function bindDockButton() {
        const root = getRoot();
        root?.querySelector(dockSelector)?.addEventListener('click', (e) => {
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

    function bindDrag() {
        const header = getHeader();
        if (!header || header.dataset.sidebarUndockBound === 'true') return;
        header.dataset.sidebarUndockBound = 'true';

        header.addEventListener('pointerdown', (e) => {
            if (!isUndocked()) return;
            if (e.target.closest(dockSelector) || e.target.closest('.collapsable-toggle')) return;
            if (dragBlockSelector && e.target.closest(dragBlockSelector)) return;
            if (e.button !== 0) return;

            const root = getRoot();
            if (!root) return;

            e.preventDefault();
            let dragging = true;
            let didDrag = false;
            const startX = e.clientX;
            const startY = e.clientY;
            const startLeft = parseFloat(root.style.left) || 0;
            const startTop = parseFloat(root.style.top) || 0;

            root.classList.add(draggingClass);
            header.setPointerCapture(e.pointerId);

            const onMove = (ev) => {
                if (!dragging) return;
                if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) {
                    didDrag = true;
                }
                applyPosition(
                    root,
                    startLeft + (ev.clientX - startX),
                    startTop + (ev.clientY - startY)
                );
                onPositionChange?.();
            };

            const onUp = (ev) => {
                if (!dragging) return;
                dragging = false;
                root.classList.remove(draggingClass);
                header.releasePointerCapture(ev.pointerId);
                if (didDrag) {
                    header.dataset.suppressClick = 'true';
                    requestAnimationFrame(() => {
                        delete header.dataset.suppressClick;
                    });
                }
                writeDock({
                    x: parseFloat(root.style.left) || 0,
                    y: parseFloat(root.style.top) || 0
                });
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
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
