// js/desktopStack.js — shared z-order for freeform notes, grid notes, tool panels, and undocked sidebar panels
/** Above .file-cabinet (30); below overlays / side-panel (~1000+). */
const DESKTOP_STACK_FLOOR = 100;
let seq = DESKTOP_STACK_FLOOR;

const UNDOCKED_SEL = '.sidebar-module--undocked';

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