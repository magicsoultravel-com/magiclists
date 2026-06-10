// js/desktopStack.js — shared z-order for freeform notes, grid notes, and tool panels
let seq = 1;

export function syncDesktopStackSeq(z) {
    if (Number.isFinite(z) && z >= seq) seq = z + 1;
}

export function raiseDesktopElement(el) {
    if (!el) return;
    seq += 1;
    el.style.setProperty('z-index', String(seq), 'important');
}
