/** @module {"owns":"sidebar module registry, undock wiring, re-dock slots", "related":["sidebarUndock.js","sidebarPrefs.js","desktopStack.js","hamburger.js"]} */
import {
    initSidebarUndock,
    SIDEBAR_MODULE_UNDOCKED,
    SIDEBAR_MODULE_DRAGGING,
    SIDEBAR_MODULE_DOCK_SEL
} from './sidebarUndock.js';
import { readModuleDock, writeModuleDock, writeSidebarSection } from './sidebarPrefs.js';
import { bindToggleCollapsable } from './hamburger.js';
import { RadioPopover } from './radioPopover.js';
import { TvPopover } from './tvPopover.js';
import { CARD_ICONS } from './icons.js';

export { SIDEBAR_MODULE_UNDOCKED, SIDEBAR_MODULE_DRAGGING, SIDEBAR_MODULE_DOCK_SEL };

/** Radio expanded layout defines minimum sidebar module column width. */
export const SIDEBAR_MODULE_WIDTH = 220;

/** @type {ReadonlyArray<{ id: string, rootId: string, headerId: string, sectionId: string, startCollapsed?: boolean, expandOnUndock?: boolean, collapseIgnoreExtra?: string, dragBlockSelector?: string, onPositionChange?: () => void }>} */
export const SIDEBAR_MODULES = [
    { id: 'quick-actions', rootId: 'sidebar-quick-actions', headerId: 'quick-actions-header', sectionId: 'quick-actions-section', startCollapsed: true, expandOnUndock: true },
    { id: 'radio', rootId: 'sidebar-radio', headerId: 'radio-section-header', sectionId: 'radio-section', startCollapsed: true, dragBlockSelector: '.sidebar-radio__compact', onPositionChange: () => RadioPopover.reposition() },
    { id: 'tv', rootId: 'sidebar-tv', headerId: 'tv-section-header', sectionId: 'tv-section', startCollapsed: true, dragBlockSelector: '.sidebar-tv__compact', onPositionChange: () => TvPopover.reposition() },
    { id: 'weather', rootId: 'sidebar-weather', headerId: 'weather-section-header', sectionId: 'weather-section', startCollapsed: true, expandOnUndock: true, collapseIgnoreExtra: '.sidebar-weather__refresh', dragBlockSelector: '.sidebar-weather__compact, .sidebar-weather__refresh' },
    { id: 'categories', rootId: 'sidebar-categories', headerId: 'categories-section-header', sectionId: 'categories-section', startCollapsed: true, expandOnUndock: true },
    { id: 'tools', rootId: 'sidebar-tools', headerId: 'tools-section-header', sectionId: 'tools-section', startCollapsed: true, expandOnUndock: true },
    { id: 'notes-list', rootId: 'sidebar-notes-list', headerId: 'notes-list-section-header', sectionId: 'notes-list-section', startCollapsed: false, expandOnUndock: true, collapseIgnoreExtra: '.sidebar-notes-list-sort', dragBlockSelector: '.sidebar-notes-list-sort' },
    { id: 'history', rootId: 'sidebar-history-section', headerId: 'history-section-header', sectionId: 'history-section', startCollapsed: true, expandOnUndock: true },
    { id: 'stats', rootId: 'sidebar-stats-section', headerId: 'stats-section-header', sectionId: 'stats-section', startCollapsed: true, expandOnUndock: true }
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

export function renderSidebarModuleHeaderHtml({ headerId, title, extrasHtml = '' }) {
    return `
            <div class="collapsable-header" id="${headerId}">
                <span class="collapsable-heading"><span class="collapsable-toggle">${CARD_ICONS.chevronDown}</span>${title}</span>
                ${extrasHtml}
                <button type="button" class="card-act sidebar-module__dock" data-sidebar-dock title="Undock to canvas" aria-label="Undock to canvas"></button>
            </div>`;
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

export function getSidebarModuleWidth() {
    const panel = document.querySelector('.side-panel');
    const raw = panel ? parseFloat(getComputedStyle(panel).getPropertyValue('--sidebar-width')) : NaN;
    return Number.isFinite(raw) && raw >= SIDEBAR_MODULE_WIDTH ? raw : SIDEBAR_MODULE_WIDTH;
}

export function applyAllModuleWidths() {
    const width = getSidebarModuleWidth();
    SIDEBAR_MODULES.forEach((config) => {
        applyModuleWidth(document.getElementById(config.rootId), width);
    });
}

function normalizeModuleHeadings() {
    SIDEBAR_MODULES.forEach((config) => {
        const header = document.getElementById(config.headerId);
        if (!header) return;
        const toggle = header.querySelector('.collapsable-toggle');
        if (!toggle) return;
        const label = toggle.textContent.trim();
        if (label === '▼' || label === 'undefined' || !toggle.querySelector('svg')) {
            toggle.innerHTML = CARD_ICONS.chevronDown;
        }
        toggle.dataset.normalized = 'true';
    });
}

function moduleCollapseIgnoreSelector(config) {
    return config.collapseIgnoreExtra
        ? `${SIDEBAR_MODULE_DOCK_SEL}, ${config.collapseIgnoreExtra}`
        : SIDEBAR_MODULE_DOCK_SEL;
}

export function bindModuleCollapsable(config) {
    bindToggleCollapsable({
        headerId: config.headerId,
        sectionId: config.sectionId,
        startCollapsed: config.startCollapsed ?? false,
        ignoreSelector: moduleCollapseIgnoreSelector(config),
        toggleOnly: true
    });
}

export function bindAllModuleCollapseHandlers() {
    SIDEBAR_MODULES.forEach((config) => bindModuleCollapsable(config));
}

export function initAllSidebarModules() {
    normalizeModuleHeadings();
    bindAllModuleCollapseHandlers();
    applyAllModuleWidths();
    window.addEventListener('sidebar:width_changed', applyAllModuleWidths);

    SIDEBAR_MODULES.forEach((config) => {
        const root = document.getElementById(config.rootId);
        if (!root) return;

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
