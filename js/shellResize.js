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
    FILE_CABINET_BOARD_MIN_HEIGHT
} from './fileCabinet.js';

const DESKTOP_MIN_WIDTH = 280;

let verticalSplitter = null;
let horizontalSplitter = null;
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
    const min = getFileCabinetDragMinHeight();
    const splitterH = horizontalSplitter?.offsetHeight || 0;
    const max = Math.max(min, surfaceH - FILE_CABINET_BOARD_MIN_HEIGHT - splitterH);
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

function applyCabinetHeight(mount, height, { persist = false } = {}) {
    if (!mount) return null;
    const clamped = clampCabinetHeight(height, mount);
    mount.dataset.fixedHeight = 'true';
    mount.style.flex = '0 0 auto';
    mount.style.height = `${clamped}px`;
    mount.style.maxHeight = 'none';
    mount.style.minHeight = `${getFileCabinetDragMinHeight()}px`;
    applyCabinetUiScale(mount, clamped);
    if (persist) writeFileCabinetHeight(clamped);
    return clamped;
}

function applyCabinetAutoHeight(mount) {
    if (!mount) return;
    const saved = readFileCabinetHeight();
    const inlineH = parseFloat(mount.style.height);
    if (mount.dataset.fixedHeight === 'true' && Number.isFinite(inlineH) && inlineH > 0) {
        applyCabinetHeight(mount, inlineH);
        return;
    }
    if (saved !== null) {
        applyCabinetHeight(mount, saved);
        return;
    }
    delete mount.dataset.fixedHeight;
    mount.style.flex = '';
    syncFileCabinetDrawerHeight(mount);
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
    verticalSplitter.setAttribute('aria-label', 'Resize sidebar');
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
        return horizontalSplitter;
    }

    removeHorizontalSplitter();

    horizontalSplitter = document.createElement('div');
    horizontalSplitter.id = 'shell-splitter-h';
    horizontalSplitter.className = 'shell-splitter shell-splitter--h';
    horizontalSplitter.setAttribute('role', 'separator');
    horizontalSplitter.setAttribute('aria-orientation', 'horizontal');
    horizontalSplitter.setAttribute('aria-label', 'Resize file cabinet');
    horizontalSplitter.tabIndex = 0;

    mount.insertAdjacentElement('afterend', horizontalSplitter);
    bindSplitterDrag(horizontalSplitter, 'h');
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

function bindSplitterDrag(handle, axis) {
    let resizing = false;
    let startX = 0;
    let startY = 0;
    let startSize = 0;

    const beginResize = () => {
        document.body.classList.add('is-shell-resizing');
        document.body.classList.toggle('is-shell-resizing--v', axis === 'v');
        document.body.classList.toggle('is-shell-resizing--h', axis === 'h');
        handle.classList.add('is-active');
    };

    const endResize = (e) => {
        if (!resizing) return;
        resizing = false;
        document.body.classList.remove('is-shell-resizing', 'is-shell-resizing--v', 'is-shell-resizing--h');
        handle.classList.remove('is-active');
        try {
            handle.releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }

        if (axis === 'v') {
            const width = sidebarPanel?.offsetWidth;
            if (width) {
                const clamped = applySidebarWidth(width);
                if (clamped) writeSidebarWidth(clamped);
            }
            dispatchDesktopBoundsChanged();
        } else {
            const mount = document.getElementById('file-cabinet');
            const height = mount?.offsetHeight;
            if (mount && height) {
                applyCabinetHeight(mount, height, { persist: true });
            }
        }
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
            startSize = mount.offsetHeight;
        }

        resizing = true;
        startX = e.clientX;
        startY = e.clientY;
        handle.setPointerCapture(e.pointerId);
        beginResize();
    });

    handle.addEventListener('pointermove', (e) => {
        if (!resizing) return;

        if (axis === 'v') {
            const next = clampSidebarWidth(startSize + (e.clientX - startX));
            sidebarPanel.style.setProperty('--sidebar-width', `${next}px`);
            applySidebarUiScale(next);
            notifySidebarWidthChanged();
        } else {
            const mount = document.getElementById('file-cabinet');
            if (!mount) return;
            const next = clampCabinetHeight(startSize + (e.clientY - startY), mount);
            applyCabinetHeight(mount, next);
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
    if (mount && mount.dataset.fixedHeight === 'true') {
        const inlineH = parseFloat(mount.style.height);
        const height = (Number.isFinite(inlineH) && inlineH > 0)
            ? inlineH
            : (readFileCabinetHeight() ?? mount.offsetHeight);
        const clamped = applyCabinetHeight(mount, height, { persist: true });
        if (clamped !== height) dispatchDesktopBoundsChanged();
    } else if (mount) {
        applyCabinetAutoHeight(mount);
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
    } else {
        removeHorizontalSplitter();
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
