// js/desktopStack.js — shared z-order for freeform notes, grid notes, tool panels, and undocked sidebar panels
let seq = 1;

const UNDOCKED_SEL = '.sidebar-module--undocked, .side-panel--undocked';

export function syncDesktopStackSeq(z) {
    if (Number.isFinite(z) && z >= seq) seq = z + 1;
}

export function raiseDesktopElement(el) {
    if (!el) return;
    seq += 1;
    el.style.setProperty('z-index', String(seq), 'important');
}

export function initUndockedSidebarStacking() {
    document.addEventListener('pointerdown', (e) => {
        const panel = e.target.closest(UNDOCKED_SEL);
        if (panel) raiseDesktopElement(panel);
    }, true);
}