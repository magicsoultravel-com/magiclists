/** @module {"owns":"file cabinet chrome state - active/shut flags, persisted drawer height, the mount element and the drawer-height sync that reads them", "related":["fileCabinet.js","fileCabinet/layout.js","shellResize.js"]} */
import { getFileCabinetContentMinHeight, getFileCabinetDragMinHeight } from './layout.js';
import { syncFileCabinetShutChrome, refreshFileCabinetUiScale } from '../shellResize.js';

export const FILE_CABINET_KEY = 'matrix_file_cabinet';
export const FILE_CABINET_HEIGHT_KEY = 'matrix_file_cabinet_height';
export const FILE_CABINET_SHUT_KEY = 'matrix_file_cabinet_shut';
export const FILE_CABINET_BOARD_MIN_HEIGHT = 200;
export const FILE_CABINET_SHUT_SNAP_PX = 8;

export function isFileCabinetActive() {
    return localStorage.getItem(FILE_CABINET_KEY) === 'true';
}

export function setFileCabinetActive(active) {
    localStorage.setItem(FILE_CABINET_KEY, active ? 'true' : 'false');
    if (!active) {
        setFileCabinetShut(false);
        syncFileCabinetShutChrome();
    }
}

export function isFileCabinetShut() {
    return localStorage.getItem(FILE_CABINET_SHUT_KEY) === 'true';
}

export function setFileCabinetShut(shut) {
    if (shut) localStorage.setItem(FILE_CABINET_SHUT_KEY, 'true');
    else localStorage.removeItem(FILE_CABINET_SHUT_KEY);
}

export function readFileCabinetHeight() {
    const raw = parseFloat(localStorage.getItem(FILE_CABINET_HEIGHT_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
}

export function writeFileCabinetHeight(height) {
    if (!Number.isFinite(height) || height <= 0) {
        localStorage.removeItem(FILE_CABINET_HEIGHT_KEY);
        return;
    }
    localStorage.setItem(FILE_CABINET_HEIGHT_KEY, String(Math.round(height)));
}

/**
 * Apply FC shut chrome (DOM only — height 0, reopen FAB visible).
 * Persisting the shut state is the CALLER's job: the user-intent sites
 * (splitter click / drag snap-to-shut) call setFileCabinetShut(true)
 * explicitly before calling this. This function must never write storage —
 * it also re-applies chrome during cross-tab refreshes, where localStorage
 * is already the fresher source of truth. Writing "shut" back from stale
 * DOM state here is what used to re-collapse a cabinet another tab had
 * just expanded (cross-tab ping-pong).
 * Preserves last open height in storage (does not write 0).
 */
export function applyFileCabinetShut(mount) {
    if (!mount) return;
    mount.dataset.shut = 'true';
    mount.dataset.fixedHeight = 'true';
    mount.classList.add('is-file-cabinet-shut');
    mount.classList.remove('is-rollout-active');
    mount.style.flex = '0 0 auto';
    mount.style.height = '0px';
    mount.style.minHeight = '0px';
    mount.style.maxHeight = 'none';
    mount.style.setProperty('--file-cabinet-ui-scale', '1');
    syncFileCabinetShutChrome();
}

/**
 * Clear shut chrome and return the height that should be restored.
 */
export function clearFileCabinetShut(mount) {
    setFileCabinetShut(false);
    if (!mount) {
        syncFileCabinetShutChrome();
        return readFileCabinetHeight();
    }
    delete mount.dataset.shut;
    mount.classList.remove('is-file-cabinet-shut');
    mount.style.opacity = '';
    syncFileCabinetShutChrome();
    return readFileCabinetHeight();
}

export function ensureFileCabinetMount(active) {
    const surface = document.getElementById('desktop-surface');
    if (!surface) return null;
    let el = document.getElementById('file-cabinet');
    if (!active) {
        el?.remove();
        surface.classList.remove('desktop-surface--file-cabinet');
        return null;
    }
    surface.classList.add('desktop-surface--file-cabinet');
    if (!el) {
        el = document.createElement('header');
        el.id = 'file-cabinet';
        el.className = 'file-cabinet';
        el.setAttribute('aria-label', 'File Cabinet');
        const canvas = document.getElementById('app-canvas');
        const anchor = canvas?.closest('.board-ruler-frame') || canvas;
        if (anchor) surface.insertBefore(el, anchor);
        else surface.prepend(el);
    }
    return el;
}

export function syncFileCabinetDrawerHeight(mount) {
    if (!mount) return;
    // localStorage is the single source of truth for shut state — never trust
    // the mount's dataset.shut (the element is reused across re-renders, so a
    // stale flag would re-persist "shut" over a fresher cross-tab expand).
    if (isFileCabinetShut()) {
        applyFileCabinetShut(mount);
        return;
    }
    // Open per storage — heal any stale shut chrome left by a previous shut
    // cycle (CSS pins height to 0 while the shut class/dataset linger).
    // clearFileCabinetShut's storage write is a no-op when the key is absent.
    if (mount.dataset.shut === 'true' || mount.classList.contains('is-file-cabinet-shut')) {
        clearFileCabinetShut(mount);
    }
    const contentMin = getFileCabinetContentMinHeight(mount);
    const dragMin = getFileCabinetDragMinHeight();
    const savedHeight = readFileCabinetHeight();
    const inlineHeight = parseFloat(mount.style.height);
    const isFixed = savedHeight !== null || mount.dataset.fixedHeight === 'true';
    if (isFixed) {
        mount.dataset.fixedHeight = 'true';
        mount.style.flex = '0 0 auto';
        mount.style.maxHeight = 'none';
        mount.style.minHeight = '0px';
        const targetH = (Number.isFinite(inlineHeight) && inlineHeight > 0)
            ? inlineHeight
            : savedHeight;
        if (Number.isFinite(targetH) && targetH > 0) {
            mount.style.height = `${targetH}px`;
        }
        refreshFileCabinetUiScale(mount, targetH);
        return;
    }
    const targetH = Math.max(dragMin, contentMin);
    delete mount.dataset.fixedHeight;
    mount.style.flex = '';
    mount.style.height = `${targetH}px`;
    mount.style.minHeight = `${targetH}px`;
    mount.style.maxHeight = 'none';
    refreshFileCabinetUiScale(mount, targetH);
}
