/** @module {"owns":"sidebar module registry, undock wiring, re-dock slots", "related":["sidebarUndock.js","sidebarPrefs.js","desktopStack.js"]} */
import {
    initSidebarUndock,
    SIDEBAR_MODULE_UNDOCKED,
    SIDEBAR_MODULE_DRAGGING,
    SIDEBAR_MODULE_DOCK_SEL
} from './sidebarUndock.js';
import { readModuleDock, writeModuleDock, writeSidebarSection } from './sidebarPrefs.js';
import { RadioPopover } from './radioPopover.js';
import { TvPopover } from './tvPopover.js';

export { SIDEBAR_MODULE_UNDOCKED, SIDEBAR_MODULE_DRAGGING, SIDEBAR_MODULE_DOCK_SEL };

/** @type {ReadonlyArray<{ id: string, rootId: string, width: number, headerId?: string, sectionId?: string, expandOnUndock?: boolean, dragBlockSelector?: string, onPositionChange?: () => void }>} */
export const SIDEBAR_MODULES = [
    { id: 'quick-actions', rootId: 'sidebar-quick-actions', width: 200, headerId: 'quick-actions-header', sectionId: 'quick-actions-section', expandOnUndock: true },
    { id: 'radio', rootId: 'sidebar-radio', width: 220, headerId: 'radio-section-header', dragBlockSelector: '.sidebar-radio__compact', onPositionChange: () => RadioPopover.reposition() },
    { id: 'tv', rootId: 'sidebar-tv', width: 220, headerId: 'tv-section-header', dragBlockSelector: '.sidebar-tv__compact', onPositionChange: () => TvPopover.reposition() },
    { id: 'weather', rootId: 'sidebar-weather', width: 220, headerId: 'weather-section-header', sectionId: 'weather-section', expandOnUndock: true, dragBlockSelector: '.sidebar-weather__compact, .sidebar-weather__refresh' },
    { id: 'categories', rootId: 'sidebar-categories', width: 240, headerId: 'categories-section-header', sectionId: 'categories-section', expandOnUndock: true },
    { id: 'tools', rootId: 'sidebar-tools', width: 200, headerId: 'tools-section-header', sectionId: 'tools-section', expandOnUndock: true },
    { id: 'notes-list', rootId: 'sidebar-notes-list', width: 240, headerId: 'notes-list-section-header', sectionId: 'notes-list-section', expandOnUndock: true, dragBlockSelector: '.sidebar-notes-list-sort' },
    { id: 'history', rootId: 'sidebar-history-section', width: 220, headerId: 'history-section-header', sectionId: 'history-section', expandOnUndock: true },
    { id: 'stats', rootId: 'sidebar-stats-section', width: 220, headerId: 'stats-section-header', sectionId: 'stats-section', expandOnUndock: true }
];

export const SIDEBAR_MODULE_ORDER = SIDEBAR_MODULES.map((m) => m.id);

const moduleById = new Map(SIDEBAR_MODULES.map((m) => [m.id, m]));

export function getModuleConfig(id) {
    return moduleById.get(id) || null;
}

export function getModuleRoot(id) {
    const config = getModuleConfig(id);
    return config ? document.getElementById(config.rootId) : null;
}

export function getModuleMount() {
    return document.querySelector('.side-panel-modules');
}

export function expandModuleSection(id) {
    const config = getModuleConfig(id);
    if (!config?.sectionId || !config.headerId) return;
    const section = document.getElementById(config.sectionId);
    const header = document.getElementById(config.headerId);
    if (!section) return;
    section.classList.remove('collapsed');
    header?.querySelector('.collapsable-toggle')?.classList.remove('collapsed');
    writeSidebarSection(config.sectionId, false);
}

export function restoreModuleToSidebar(id) {
    const root = getModuleRoot(id);
    const mount = getModuleMount();
    if (!root || !mount || root.parentElement !== document.body) return;

    const order = SIDEBAR_MODULE_ORDER;
    const index = order.indexOf(id);
    if (index < 0) return;

    for (let i = index + 1; i < order.length; i += 1) {
        const nextRoot = getModuleRoot(order[i]);
        if (nextRoot && nextRoot.parentElement === mount) {
            nextRoot.insertAdjacentElement('beforebegin', root);
            return;
        }
    }

    mount.appendChild(root);
}

function applyModuleWidth(root, width) {
    if (!root || !width) return;
    root.style.setProperty('--sidebar-module-width', `${width}px`);
}

export function initAllSidebarModules() {
    SIDEBAR_MODULES.forEach((config) => {
        const root = document.getElementById(config.rootId);
        if (!root) return;

        applyModuleWidth(root, config.width);

        const undock = initSidebarUndock({
            getRoot: () => document.getElementById(config.rootId),
            undockedClass: SIDEBAR_MODULE_UNDOCKED,
            draggingClass: SIDEBAR_MODULE_DRAGGING,
            dockSelector: SIDEBAR_MODULE_DOCK_SEL,
            getHeader: () => (config.headerId ? document.getElementById(config.headerId) : null),
            readDock: () => readModuleDock(config.id),
            writeDock: (patch) => writeModuleDock(config.id, patch),
            restoreToSidebar: () => restoreModuleToSidebar(config.id),
            onBeforeUndock: config.expandOnUndock ? () => expandModuleSection(config.id) : undefined,
            onPositionChange: config.onPositionChange,
            dragBlockSelector: config.dragBlockSelector
        });

        undock.applyInitialDockState();
    });
}
