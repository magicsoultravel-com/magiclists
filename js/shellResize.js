// js/shellResize.js — draggable sidebar / file-cabinet splitters
import {
    readSidebarWidth,
    writeSidebarWidth,
    SIDEBAR_DEFAULT_WIDTH,
    SIDEBAR_MIN_WIDTH
} from './sidebarPrefs.js';
import {
    readFileCabinetHeight,
    writeFileCabinetHeight,
    getFileCabinetDragMinHeight,
    getFileCabinetContentMinHeight,
    syncFileCabinetDrawerHeight,
    FILE_CABINET_BOARD_MIN_HEIGHT,
    FILE_CABINET_SHUT_SNAP_PX,
    isFileCabinetShut,
    isFileCabinetActive,
    applyFileCabinetShut,
    clearFileCabinetShut
} from './fileCabinet.js';
import { ACTION_ICONS } from './icons.js';

const DESKTOP_MIN_WIDTH = 280;

let verticalSplitter = null;
let horizontalSplitter = null;
let fileCabinetFab = null;
let sidebarPanel = null;
let bound = false;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function dispatchDesktopBoundsChanged() {
    window.dispatchEvent(new CustomEvent('tools:desktop_bounds_changed'));
}

function isSidebarCollapsed() {
    return sidebarPanel?.classList.contains('is-collapsed') ?? true;
}

function isSidebarInFlow() {
    return !isSidebarCollapsed();
}

function getSidebarWidthBounds() {
    const viewport = window.innerWidth;
    const maxByRatio = viewport * 0.5;
    const maxByDesktop = viewport - DESKTOP_MIN_WIDTH;
    const max = Math.max(SIDEBAR_MIN_WIDTH, Math.min(maxByRatio, maxByDesktop));
    return { min: SIDEBAR_MIN_WIDTH, max };
}

function getSidebarScaleBounds() {
    const { min, max } = getSidebarWidthBounds();
    return {
        min: min / SIDEBAR_DEFAULT_WIDTH,
        max: max / SIDEBAR_DEFAULT_WIDTH
    };
}

function clampSidebarWidth(width) {
    const { min, max } = getSidebarWidthBounds();
    return clamp(width, min, max);
}

function sidebarScaleForWidth(width) {
    const { min, max } = getSidebarScaleBounds();
    return clamp(width / SIDEBAR_DEFAULT_WIDTH, min, max);
}

function getCabinetHeightBounds(mount) {
    const surface = document.getElementById('desktop-surface');
    const surfaceH = surface?.clientHeight || window.innerHeight;
    // Allow 0 so the user can drag (or click) the drawer fully shut while
    // keeping the horizontal splitter.
    const min = 0;
    const splitterH = horizontalSplitter?.offsetHeight || 0;
    const max = Math.max(getFileCabinetDragMinHeight(), surfaceH - FILE_CABINET_BOARD_MIN_HEIGHT - splitterH);
    return { min, max };
}

function cabinetScaleForHeight(height, mount) {
    const contentMin = getFileCabinetContentMinHeight(mount);
    if (!contentMin || !height) return 1;
    const styles = getComputedStyle(mount);
    const padY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
    const innerH = Math.max(1, height - padY);
    const stackMin = Math.max(1, contentMin - padY);
    return Math.min(1, innerH / stackMin);
}

function applySidebarUiScale(width) {
    if (!sidebarPanel || !isSidebarInFlow()) return;
    const scale = sidebarScaleForWidth(width);
    sidebarPanel.style.setProperty('--sidebar-ui-scale', String(scale));
}

function applyCabinetUiScale(mount, height) {
    if (!mount) return;
    const effectiveHeight = height ?? mount.offsetHeight;
    if (!effectiveHeight) return;
    const scale = cabinetScaleForHeight(effectiveHeight, mount);
    mount.style.setProperty('--file-cabinet-ui-scale', String(scale));
}

function clearSidebarAppliedWidth() {
    sidebarPanel?.style.removeProperty('width');
}

function notifySidebarWidthChanged() {
    window.dispatchEvent(new CustomEvent('sidebar:width_changed'));
}

function applySidebarWidth(width) {
    if (!sidebarPanel || !isSidebarInFlow()) return;
    const clamped = clampSidebarWidth(width);
    sidebarPanel.style.setProperty('--sidebar-width', `${clamped}px`);
    applySidebarUiScale(clamped);
    notifySidebarWidthChanged();
    return clamped;
}

function clampCabinetHeight(height, mount) {
    const { min, max } = getCabinetHeightBounds(mount);
    return clamp(height, min, max);
}

function applyCabinetHeight(mount, height, { persist = false, allowShut = true } = {}) {
    if (!mount) return null;
    const clamped = clampCabinetHeight(height, mount);
    if (allowShut && clamped <= FILE_CABINET_SHUT_SNAP_PX) {
        applyFileCabinetShut(mount);
        syncFileCabinetShutChrome();
        return 0;
    }

    clearFileCabinetShut(mount);
    mount.dataset.fixedHeight = 'true';
    mount.style.flex = '0 0 auto';
    mount.style.height = `${clamped}px`;
    mount.style.maxHeight = 'none';
    mount.style.minHeight = '0px';
    mount.style.opacity = '';
    applyCabinetUiScale(mount, clamped);
    if (persist) writeFileCabinetHeight(clamped);
    syncFileCabinetShutChrome();
    return clamped;
}

function restoreCabinetFromShut(mount) {
    if (!mount) return null;
    clearFileCabinetShut(mount);
    const saved = readFileCabinetHeight();
    const contentMin = getFileCabinetContentMinHeight(mount);
    const target = saved
        ?? Math.max(getFileCabinetDragMinHeight(), contentMin || 0);
    return applyCabinetHeight(mount, target, { persist: true, allowShut: false });
}

function applyCabinetAutoHeight(mount) {
    if (!mount) return;
    if (isFileCabinetShut() || mount.dataset.shut === 'true') {
        applyFileCabinetShut(mount);
        syncFileCabinetShutChrome();
        return;
    }
    const saved = readFileCabinetHeight();
    const inlineH = parseFloat(mount.style.height);
    if (mount.dataset.fixedHeight === 'true' && Number.isFinite(inlineH) && inlineH > 0) {
        applyCabinetHeight(mount, inlineH, { allowShut: false });
        return;
    }
    if (saved !== null) {
        applyCabinetHeight(mount, saved, { allowShut: false });
        return;
    }
    delete mount.dataset.fixedHeight;
    mount.style.flex = '';
    syncFileCabinetDrawerHeight(mount);
    syncFileCabinetShutChrome();
}

function ensureSidebarScaleInner() {
    if (!sidebarPanel || sidebarPanel.querySelector('.side-panel-scale-inner')) return;
    const inner = document.createElement('div');
    inner.className = 'side-panel-scale-inner';
    while (sidebarPanel.firstChild) inner.appendChild(sidebarPanel.firstChild);
    sidebarPanel.appendChild(inner);
}

function ensureVerticalSplitter() {
    if (verticalSplitter?.isConnected) return verticalSplitter;
    if (!sidebarPanel) return null;

    verticalSplitter = document.createElement('div');
    verticalSplitter.id = 'shell-splitter-v';
    verticalSplitter.className = 'shell-splitter shell-splitter--v';
    verticalSplitter.setAttribute('role', 'separator');
    verticalSplitter.setAttribute('aria-orientation', 'vertical');
    verticalSplitter.setAttribute('aria-label', 'Resize or click to hide sidebar');
    verticalSplitter.tabIndex = 0;

    sidebarPanel.insertAdjacentElement('afterend', verticalSplitter);
    bindSplitterDrag(verticalSplitter, 'v');
    return verticalSplitter;
}

function ensureHorizontalSplitter() {
    const mount = document.getElementById('file-cabinet');
    const surface = document.getElementById('desktop-surface');
    if (!mount || !surface) {
        removeHorizontalSplitter();
        return null;
    }

    if (horizontalSplitter?.isConnected && horizontalSplitter.previousElementSibling === mount) {
        updateHorizontalSplitterVisibility();
        return horizontalSplitter;
    }

    removeHorizontalSplitter();

    horizontalSplitter = document.createElement('div');
    horizontalSplitter.id = 'shell-splitter-h';
    horizontalSplitter.className = 'shell-splitter shell-splitter--h';
    horizontalSplitter.setAttribute('role', 'separator');
    horizontalSplitter.setAttribute('aria-orientation', 'horizontal');
    horizontalSplitter.setAttribute('aria-label', 'Resize or click to shut file cabinet');
    horizontalSplitter.tabIndex = 0;

    mount.insertAdjacentElement('afterend', horizontalSplitter);
    bindSplitterDrag(horizontalSplitter, 'h');
    updateHorizontalSplitterVisibility();
    return horizontalSplitter;
}

function removeHorizontalSplitter() {
    horizontalSplitter?.remove();
    horizontalSplitter = null;
}

function updateVerticalSplitterVisibility() {
    if (!verticalSplitter) return;
    const hidden = isSidebarCollapsed();
    verticalSplitter.classList.toggle('is-hidden', hidden);
    verticalSplitter.setAttribute('aria-hidden', hidden ? 'true' : 'false');
}

function updateHorizontalSplitterVisibility() {
    if (!horizontalSplitter) return;
    const hidden = isFileCabinetShut();
    horizontalSplitter.classList.toggle('is-hidden', hidden);
    horizontalSplitter.setAttribute('aria-hidden', hidden ? 'true' : 'false');
}

function ensureFileCabinetFab() {
    const surface = document.getElementById('desktop-surface');
    if (!surface) return null;
    if (fileCabinetFab?.isConnected) return fileCabinetFab;

    fileCabinetFab = document.createElement('button');
    fileCabinetFab.type = 'button';
    fileCabinetFab.id = 'file-cabinet-toggle-fab';
    fileCabinetFab.className = 'file-cabinet-toggle-fab is-hidden';
    fileCabinetFab.title = 'Show File Cabinet';
    fileCabinetFab.setAttribute('aria-label', 'Show File Cabinet');
    fileCabinetFab.innerHTML = ACTION_ICONS.viewFileCabinet;
    fileCabinetFab.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const mount = document.getElementById('file-cabinet');
        if (!mount || !isFileCabinetShut()) return;
        restoreCabinetFromShut(mount);
        dispatchDesktopBoundsChanged();
    });
    surface.insertBefore(fileCabinetFab, surface.firstChild);
    return fileCabinetFab;
}

function removeFileCabinetFab() {
    fileCabinetFab?.remove();
    fileCabinetFab = null;
}

/**
 * Sync H-splitter + reopen FAB with shut / FC-active state (sidebar-style).
 */
export function syncFileCabinetShutChrome() {
    const active = isFileCabinetActive() && !!document.getElementById('file-cabinet');
    const shut = active && isFileCabinetShut();

    if (!active) {
        removeFileCabinetFab();
        updateHorizontalSplitterVisibility();
        return;
    }

    ensureFileCabinetFab();
    updateHorizontalSplitterVisibility();
    if (fileCabinetFab) {
        fileCabinetFab.classList.toggle('is-hidden', !shut);
        fileCabinetFab.setAttribute('aria-hidden', shut ? 'false' : 'true');
    }
}

function bindSplitterDrag(handle, axis) {
    let resizing = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startSize = 0;
    let lastSize = 0;

    const beginResize = () => {
        document.body.classList.add('is-shell-resizing');
        document.body.classList.toggle('is-shell-resizing--v', axis === 'v');
        document.body.classList.toggle('is-shell-resizing--h', axis === 'h');
        handle.classList.add('is-active');
    };

    const endResize = (e) => {
        if (!resizing) return;
        resizing = false;
        handle.classList.remove('is-active');
        try {
            handle.releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }

        if (!moved) {
            document.body.classList.remove('is-shell-resizing', 'is-shell-resizing--v', 'is-shell-resizing--h');
            // Horizontal click shuts FC (reopen via FAB). Vertical click hides sidebar.
            if (axis === 'h') {
                const mount = document.getElementById('file-cabinet');
                if (!mount || isFileCabinetShut() || mount.dataset.shut === 'true') return;
                const openH = mount.offsetHeight;
                if (openH > FILE_CABINET_SHUT_SNAP_PX) writeFileCabinetHeight(openH);
                applyFileCabinetShut(mount);
                syncFileCabinetShutChrome();
                dispatchDesktopBoundsChanged();
            } else if (axis === 'v' && !isSidebarCollapsed()) {
                document.getElementById('nav-panel-toggle')?.click();
            }
            return;
        }

        if (axis === 'v') {
            // Commit the final width while the transition is still disabled
            // (body.is-shell-resizing is still set), then re-enable transitions.
            const clamped = applySidebarWidth(lastSize || sidebarPanel?.offsetWidth);
            if (clamped) writeSidebarWidth(clamped);
        } else {
            const mount = document.getElementById('file-cabinet');
            const height = lastSize ?? mount?.offsetHeight ?? 0;
            if (mount) {
                applyCabinetHeight(mount, height, { persist: true });
            }
        }
        dispatchDesktopBoundsChanged();

        // Drop the resize lock on the next frame so the re-enabled panel
        // width/height transition starts from a fully settled value (zero
        // delta) and never animates on release.
        requestAnimationFrame(() => {
            document.body.classList.remove('is-shell-resizing', 'is-shell-resizing--v', 'is-shell-resizing--h');
        });
    };

    handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        if (axis === 'v') {
            if (!isSidebarInFlow()) return;
            startSize = sidebarPanel.offsetWidth;
        } else {
            const mount = document.getElementById('file-cabinet');
            if (!mount) return;
            startSize = (isFileCabinetShut() || mount.dataset.shut === 'true')
                ? 0
                : mount.offsetHeight;
            // Remember open height before a possible shut so restore works.
            if (startSize > FILE_CABINET_SHUT_SNAP_PX) writeFileCabinetHeight(startSize);
        }

        resizing = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        lastSize = startSize;
        handle.setPointerCapture(e.pointerId);
        beginResize();
    });

    handle.addEventListener('pointermove', (e) => {
        if (!resizing) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        // Ignore sub-threshold movement so a click with a tiny tremor never
        // applies a size change (prevents the click "bounce").
        if (!moved && Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return;
        moved = true;

        if (axis === 'v') {
            // Single source of truth: applySidebarWidth sets --sidebar-width,
            // applies the UI scale and dispatches the change notification.
            lastSize = applySidebarWidth(startSize + dx);
        } else {
            const mount = document.getElementById('file-cabinet');
            if (!mount) return;
            // Leaving shut on first move: clear shut chrome so height can grow.
            if (mount.dataset.shut === 'true' && startSize + dy > FILE_CABINET_SHUT_SNAP_PX) {
                clearFileCabinetShut(mount);
            }
            const next = clampCabinetHeight(startSize + dy, mount);
            lastSize = next;
            applyCabinetHeight(mount, next, { allowShut: true });
        }
    });

    handle.addEventListener('pointerup', endResize);
    handle.addEventListener('pointercancel', endResize);
}

function applyStoredSidebarWidth() {
    const stored = readSidebarWidth();
    const width = stored ?? SIDEBAR_DEFAULT_WIDTH;
    const clamped = applySidebarWidth(width);
    if (stored !== null && clamped !== stored) writeSidebarWidth(clamped);
}

function reclampAll() {
    if (isSidebarInFlow()) {
        applyStoredSidebarWidth();
    } else {
        clearSidebarAppliedWidth();
    }
    const mount = document.getElementById('file-cabinet');
    if (mount && (isFileCabinetShut() || mount.dataset.shut === 'true')) {
        applyFileCabinetShut(mount);
        syncFileCabinetShutChrome();
    } else if (mount && mount.dataset.fixedHeight === 'true') {
        const inlineH = parseFloat(mount.style.height);
        const height = (Number.isFinite(inlineH) && inlineH > 0)
            ? inlineH
            : (readFileCabinetHeight() ?? mount.offsetHeight);
        const clamped = applyCabinetHeight(mount, height, { persist: true, allowShut: false });
        if (clamped !== height) dispatchDesktopBoundsChanged();
    } else if (mount) {
        applyCabinetAutoHeight(mount);
    } else {
        syncFileCabinetShutChrome();
    }
}

function onWindowResize() {
    reclampAll();
    dispatchDesktopBoundsChanged();
}

export function syncCabinetSplitter() {
    const mount = document.getElementById('file-cabinet');
    if (mount) {
        ensureHorizontalSplitter();
        applyCabinetAutoHeight(mount);
        syncFileCabinetShutChrome();
    } else {
        removeHorizontalSplitter();
        syncFileCabinetShutChrome();
    }
}

export function onShellDockChanged() {
    updateVerticalSplitterVisibility();
    if (isSidebarInFlow()) {
        applyStoredSidebarWidth();
    } else {
        clearSidebarAppliedWidth();
    }
    reclampAll();
    dispatchDesktopBoundsChanged();
}

export function onSidebarCollapseChanged() {
    updateVerticalSplitterVisibility();
    if (isSidebarInFlow()) {
        applyStoredSidebarWidth();
    } else {
        clearSidebarAppliedWidth();
    }
    reclampAll();
    dispatchDesktopBoundsChanged();
}

export function initShellResize() {
    sidebarPanel = document.getElementById('side-panel');
    if (!sidebarPanel) return;

    ensureSidebarScaleInner();

    if (bound) {
        reclampAll();
        syncCabinetSplitter();
        updateVerticalSplitterVisibility();
        return;
    }

    bound = true;
    clearSidebarAppliedWidth();
    if (isSidebarInFlow()) applyStoredSidebarWidth();
    ensureVerticalSplitter();
    updateVerticalSplitterVisibility();
    syncCabinetSplitter();

    window.addEventListener('resize', onWindowResize);
}
