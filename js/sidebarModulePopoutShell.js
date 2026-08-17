/** @module {"owns":"sidebar module popout placeholder shell state transfer", "related":["sidebarModulePopout.js"]} */

export const SIDEBAR_MODULE_POPOUT_PLACEHOLDER = 'sidebar-module--popout-placeholder';
export const SIDEBAR_MODULE_POPOUT_LIVE = 'sidebar-module--popout';

export function copyInlineStyles(from, to, keys) {
    for (const key of keys) {
        const val = from.style.getPropertyValue(key);
        if (val) to.style.setProperty(key, val);
    }
}

export function transferShellState(from, to) {
    if (!from || !to) return;
    for (const cls of from.classList) {
        if (cls !== SIDEBAR_MODULE_POPOUT_PLACEHOLDER && cls !== SIDEBAR_MODULE_POPOUT_LIVE) {
            to.classList.add(cls);
        }
    }
    copyInlineStyles(from, to, ['left', 'top', 'z-index', '--sidebar-module-width', '--sidebar-clock-scale', 'width', 'height']);
}
