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
    clampFileCabinetScroll,
    syncFileCabinetDrawerHeight,
    FILE_CABINET_BOARD_MIN_HEIGHT,
    FILE_CABINET_REF_HEIGHT
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

function getCabinetScaleBounds(mount) {
    const { min, max } = getCabinetHeightBounds(mount);
    return {
        min: min / FILE_CABINET_REF_HEIGHT,
        max: max / FILE_CABINET_REF_HEIGHT
    };
}

function cabinetScaleForHeight(height, mount) {
    const { min, max } = getCabinetScaleBounds(mount);
    return clamp(height / FILE_CABINET_REF_HEIGHT, min, max);
}

function applySidebarUiScale(width) {
    if (!sidebarPanel || isSidebarCollapsed()) return;
    const scale = sidebarScaleForWidth(width);
    sidebarPanel.style.setProperty('--sidebar-ui-scale', String(scale));
}

function applyCabinetUiScale(mount, height) {
    if (!mount) return;
    const effectiveHeight = height ?? mount.offsetHeight;
    if (!effectiveHeight) return;
    const scale = cabinetScaleForHeight(effectiveHeight, mount);
    mount.style.setProperty('--file-cabinet-ui-scale', String(scale));
    syncFileCabinetDrawerHeight(mount);
    syncCabinetInnerLayout(mount);
    clampFileCabinetScroll(mount);
}

function syncCabinetInnerLayout(mount) {
    const inner = mount?.querySelector('.file-cabinet-inner');
    if (!inner) return;
    const scale = parseFloat(mount.style.getPropertyValue('--file-cabinet-ui-scale')) || 1;
    if (typeof CSS !== 'undefined' && CSS.supports('zoom', '1')) {
        inner.style.marginRight = '';
        inner.style.marginBottom = '';
        return;
    }
    if (Math.abs(scale - 1) < 0.001) {
        inner.style.marginRight = '';
        inner.style.marginBottom = '';
        return;
    }
    const w = inner.offsetWidth;
    const h = inner.offsetHeight;
    inner.style.marginRight = `${w * (scale - 1)}px`;
    inner.style.marginBottom = `${h * (scale - 1)}px`;
}

function clearSidebarAppliedWidth() {
    sidebarPanel?.style.removeProperty('width');
}

function applySidebarWidth(width) {
    if (!sidebarPanel || isSidebarCollapsed()) return;
    const clamped = clampSidebarWidth(width);
    sidebarPanel.style.setProperty('--sidebar-width', `${clamped}px`);
    applySidebarUiScale(clamped);
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
    mount.style.maxHeight = '';
    applyCabinetUiScale(mount, clamped);
    if (persist) writeFileCabinetHeight(clamped);
    return clamped;
}

function applyCabinetAutoHeight(mount) {
    if (!mount) return;
    const saved = readFileCabinetHeight();
    if (saved !== null) {
        applyCabinetHeight(mount, saved);
        return;
    }
    delete mount.dataset.fixedHeight;
    mount.style.flex = '';
    mount.style.height = '';
    mount.style.maxHeight = '';
    applyCabinetUiScale(mount, mount.offsetHeight || FILE_CABINET_REF_HEIGHT);
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
        applyCabinetAutoHeight(mount);
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
    applyCabinetAutoHeight(mount);
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
            if (isSidebarCollapsed()) return;
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
    if (!isSidebarCollapsed()) {
        applyStoredSidebarWidth();
    } else {
        clearSidebarAppliedWidth();
    }
    const mount = document.getElementById('file-cabinet');
    if (mount && mount.dataset.fixedHeight === 'true') {
        const height = readFileCabinetHeight() ?? mount.offsetHeight;
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
    } else {
        removeHorizontalSplitter();
    }
}

export function onSidebarCollapseChanged() {
    updateVerticalSplitterVisibility();
    if (isSidebarCollapsed()) {
        clearSidebarAppliedWidth();
    } else {
        applyStoredSidebarWidth();
    }
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
    if (!isSidebarCollapsed()) applyStoredSidebarWidth();
    ensureVerticalSplitter();
    updateVerticalSplitterVisibility();
    syncCabinetSplitter();

    window.addEventListener('resize', onWindowResize);
}
