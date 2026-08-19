/** @module {"owns":"shared popout window helpers (PiP, browser popup, styles)", "related":["notePopoutBridge.js","sidebarModulePopout.js"]} */
import { showAppToast } from './toast.js';

export const POPOUT_MODE_KEY = 'matrix_display_options';

/** Note popout default sizes */
export const PIP_WINDOW_W = 520;
export const PIP_WINDOW_H = 680;
export const POPUP_WINDOW_W = 480;
export const POPUP_WINDOW_H = 640;

/** Tool panel popout default sizes */
export const TOOL_PIP_W = 380;
export const TOOL_PIP_H = 480;
export const TOOL_POPUP_W = 380;
export const TOOL_POPUP_H = 480;

/** Sidebar module popout default sizes */
export const MODULE_PIP_W = 260;
export const MODULE_PIP_H = 480;
export const MODULE_POPUP_W = 260;
export const MODULE_POPUP_H = 480;
export const MODULE_CLOCK_PIP_H = 180;
export const MODULE_CLOCK_POPUP_H = 180;

/** @type {Window|null} */
let activePipWindow = null;
/** @type {{ type: string, id: string }|null} */
let activePipOwner = null;

/** Directory URL of the current page, for resolving relative resources in popout windows. */
export function appDirectoryUrl() {
    try {
        const path = window.location.pathname || '/';
        const dir = path.endsWith('/') ? path : path.replace(/[^/]+$/, '');
        return new URL(dir, window.location.origin).href;
    } catch {
        return window.location.href;
    }
}

/** Document Picture-in-Picture — Chromium desktop (secure context) only. */
export function supportsDocumentPip() {
    try {
        return typeof window !== 'undefined'
            && window.isSecureContext !== false
            && !!(window.documentPictureInPicture
                && typeof window.documentPictureInPicture.requestWindow === 'function');
    } catch {
        return false;
    }
}

/** 'pip' = frameless floating window; 'window' = normal browser popup. */
export function readPopoutModePreference() {
    try {
        const raw = JSON.parse(localStorage.getItem(POPOUT_MODE_KEY) || '{}');
        return raw && raw.popoutMode === 'window' ? 'window' : 'pip';
    } catch {
        return 'pip';
    }
}

export function shouldUsePipPopout() {
    return readPopoutModePreference() === 'pip' && supportsDocumentPip();
}

export function isPipOccupied() {
    return !!(activePipWindow && !activePipWindow.closed);
}

export function getActivePipOwner() {
    return isPipOccupied() ? activePipOwner : null;
}

/**
 * @param {Window} win
 * @param {{ type: string, id: string }} owner
 */
export function registerPipWindow(win, owner) {
    if (!win) return;
    activePipWindow = win;
    activePipOwner = owner || null;
    const clear = () => {
        if (activePipWindow === win) {
            activePipWindow = null;
            activePipOwner = null;
        }
    };
    win.addEventListener('pagehide', clear);
}

export function unregisterPipWindow(win) {
    if (activePipWindow === win) {
        activePipWindow = null;
        activePipOwner = null;
    }
}

/** Clone stylesheets from the opener into a popout document. */
export function cloneAppStylesInto(targetDoc, sourceDoc = document) {
    if (!targetDoc?.head) return;
    const head = targetDoc.head;
    const base = targetDoc.createElement('base');
    base.href = appDirectoryUrl();
    head.prepend(base);
    sourceDoc.head.querySelectorAll('link, style').forEach((el) => {
        head.appendChild(el.cloneNode(true));
    });
}

/** Copy theme-related attributes from opener html element. */
export function copyThemeAttributes(sourceDoc, targetDoc) {
    const src = sourceDoc?.documentElement;
    const dst = targetDoc?.documentElement;
    if (!src || !dst) return;
    for (const attr of src.attributes) {
        if (attr.name.startsWith('data-') || attr.name === 'class' || attr.name === 'lang') {
            dst.setAttribute(attr.name, attr.value);
        }
    }
}

export function browserPopupFeatures(width, height) {
    return `popup=yes,width=${width},height=${height},menubar=no,toolbar=no,location=no,status=no`;
}

/**
 * Open a classic browser popup.
 * @param {string} url
 * @param {string} name
 * @param {number} width
 * @param {number} height
 * @returns {Window|null}
 */
export function openBrowserPopup(url, name, width, height) {
    const features = browserPopupFeatures(width, height);
    const win = window.open(url, name, features);
    if (!win) {
        showAppToast('Pop-out blocked — allow popups for this site');
        return null;
    }
    try {
        win.focus();
    } catch {
        /* ignore */
    }
    return win;
}

/**
 * Request a Document PiP window when available and not already occupied.
 * @param {{ width: number, height: number, owner: { type: string, id: string }, onPageHide?: () => void }} opts
 * @returns {Promise<Window|null>}
 */
export async function requestPipWindow({ width, height, owner, onPageHide }) {
    if (!supportsDocumentPip()) return null;
    if (isPipOccupied()) return null;

    let pipWin;
    try {
        pipWin = await window.documentPictureInPicture.requestWindow({ width, height });
    } catch (err) {
        console.warn('[PopoutWindows] Picture-in-Picture unavailable:', err);
        return null;
    }
    if (!pipWin?.document) return null;

    registerPipWindow(pipWin, owner);
    cloneAppStylesInto(pipWin.document);
    copyThemeAttributes(document, pipWin.document);
    pipWin.document.documentElement.dataset.popoutMode = 'pip';

    if (onPageHide) {
        pipWin.addEventListener('pagehide', onPageHide);
    }

    return pipWin;
}

/**
 * Prepare a blank popup document for DOM adoption (module popouts).
 * @param {Window} win
 * @param {string} bodyClass
 */
export function prepareBlankPopoutDocument(win, bodyClass = 'sidebar-module-popout-body') {
    if (!win?.document) return null;
    const doc = win.document;
    cloneAppStylesInto(doc);
    copyThemeAttributes(document, doc);
    doc.documentElement.dataset.popoutMode = 'window';
    doc.body.className = bodyClass;
    doc.body.innerHTML = '';
    return doc;
}

export function windowNameForModule(moduleId) {
    return `magiclists-module-${String(moduleId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export function windowNameForNote(noteId) {
    return `magiclists-note-${String(noteId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export function windowNameForTool(toolId) {
    return `magiclists-tool-${String(toolId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}
