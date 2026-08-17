/** @module {"owns":"sidebar module registry, undock wiring, re-dock slots", "related":["sidebarUndock.js","sidebarPrefs.js","desktopStack.js","hamburger.js","sidebarModulePopout.js"]} */
import {
    initSidebarUndock,
    SIDEBAR_MODULE_UNDOCKED,
    SIDEBAR_MODULE_DRAGGING,
    SIDEBAR_MODULE_DOCK_SEL,
    SIDEBAR_MODULE_CHROME_IGNORE
} from './sidebarUndock.js';
import { readModuleDock, writeModuleDock, writeSidebarSection } from './sidebarPrefs.js';
import { bindToggleCollapsable } from './hamburger.js';
import { RadioPopover } from './radioPopover.js';
import { TvPopover } from './tvPopover.js';
import { ToolsManager } from './toolsManager.js';
import { ClockStyle } from './clockStyle.js';
import { CARD_ICONS } from './icons.js';
import { getAppElementById } from './appDocuments.js';
import { SidebarModulePopout, initAllModulePopouts } from './sidebarModulePopout.js';

export { SIDEBAR_MODULE_UNDOCKED, SIDEBAR_MODULE_DRAGGING, SIDEBAR_MODULE_DOCK_SEL };

/** Radio expanded layout defines minimum sidebar module column width. */
export const SIDEBAR_MODULE_WIDTH = 220;

const CLOCK_SCALE_MIN = 0.75;
const CLOCK_SCALE_MAX = 2.5;
const CLOCK_SCALE_DEFAULT = 1;

/** @type {ReadonlyArray<{ id: string, rootId: string, headerId: string, sectionId: string, startCollapsed?: boolean, expandOnUndock?: boolean, collapseIgnoreExtra?: string, dragBlockSelector?: string, onPositionChange?: () => void }>} */
export const SIDEBAR_MODULES = [
    { id: 'clock', rootId: 'sidebar-clock', headerId: 'clock-section-header', sectionId: 'clock-section', startCollapsed: false, collapseAlways: true, dragBlockSelector: '#digital-clock', onPositionChange: () => ClockStyle.repositionPopover?.() },
    { id: 'quick-actions', rootId: 'sidebar-quick-actions', headerId: 'quick-actions-header', sectionId: 'quick-actions-section', startCollapsed: true, expandOnUndock: true, collapseIgnoreExtra: '.quick-actions-header-icons' },
    { id: 'radio', rootId: 'sidebar-radio', headerId: 'radio-section-header', sectionId: 'radio-section', startCollapsed: true, dragBlockSelector: '.sidebar-radio__compact', onPositionChange: () => RadioPopover.reposition() },
    { id: 'tv', rootId: 'sidebar-tv', headerId: 'tv-section-header', sectionId: 'tv-section', startCollapsed: true, dragBlockSelector: '.sidebar-tv__compact', onPositionChange: () => TvPopover.reposition() },
    { id: 'weather', rootId: 'sidebar-weather', headerId: 'weather-section-header', sectionId: 'weather-section', startCollapsed: true, expandOnUndock: true, collapseIgnoreExtra: '.sidebar-weather__refresh, .sidebar-weather__extlink', dragBlockSelector: '.sidebar-weather__compact, .sidebar-weather__refresh, .sidebar-weather__extlink' },
    { id: 'tools', rootId: 'sidebar-tools', headerId: 'tools-section-header', sectionId: 'tools-section', startCollapsed: true, expandOnUndock: true },
    { id: 'notes-list', rootId: 'sidebar-notes-list', headerId: 'notes-list-section-header', sectionId: 'notes-list-section', startCollapsed: false, expandOnUndock: true },
    { id: 'history', rootId: 'sidebar-history-section', headerId: 'history-section-header', sectionId: 'history-section', startCollapsed: true, expandOnUndock: true },
    { id: 'stats', rootId: 'sidebar-stats-section', headerId: 'stats-section-header', sectionId: 'stats-section', startCollapsed: true, expandOnUndock: true }
];

export const SIDEBAR_MODULE_ORDER = SIDEBAR_MODULES.map((m) => m.id);

const moduleById = new Map(SIDEBAR_MODULES.map((m) => [m.id, m]));
/** @type {Map<string, ReturnType<typeof initSidebarUndock>>} */
const moduleUndockById = new Map();

function notifyFloatingChromeChanged() {
    window.dispatchEvent(new CustomEvent('floating:chrome_changed'));
}

function clampClockScale(scale) {
    if (!Number.isFinite(scale)) return CLOCK_SCALE_DEFAULT;
    return Math.min(CLOCK_SCALE_MAX, Math.max(CLOCK_SCALE_MIN, scale));
}

function syncClockUndockLayout(root) {
    const clock = root?.querySelector('#digital-clock');
    if (!root || !clock) return;
    const scale = clampClockScale(
        parseFloat(root.style.getPropertyValue('--sidebar-clock-scale')) || CLOCK_SCALE_DEFAULT
    );
    // transform does not affect offsetWidth/Height — multiply by scale for the hit box.
    root.style.width = `${clock.offsetWidth * scale}px`;
    root.style.height = `${clock.offsetHeight * scale}px`;
}

function applyClockUndockChrome(root) {
    if (!root) return;
    const saved = readModuleDock('clock');
    const scale = clampClockScale(saved.scale ?? CLOCK_SCALE_DEFAULT);
    root.style.setProperty('--sidebar-clock-scale', String(scale));
    syncClockUndockLayout(root);
}

function clearClockUndockChrome(root) {
    if (!root) return;
    root.style.removeProperty('--sidebar-clock-scale');
    root.style.removeProperty('width');
    root.style.removeProperty('height');
    root.classList.remove('is-resizing');
}

function bindClockUndockResize(root) {
    if (!root || root.dataset.clockResizeBound === 'true') return;
    const handle = root.querySelector('[data-sidebar-clock-resize]');
    if (!handle) return;
    root.dataset.clockResizeBound = 'true';

    handle.addEventListener('pointerdown', (e) => {
        if (!root.classList.contains(SIDEBAR_MODULE_UNDOCKED)) return;
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startY = e.clientY;
        const startScale = clampClockScale(
            parseFloat(root.style.getPropertyValue('--sidebar-clock-scale')) || CLOCK_SCALE_DEFAULT
        );
        const clock = root.querySelector('#digital-clock');
        const rect = clock?.getBoundingClientRect();
        const baseW = Math.max(1, (rect?.width || 1) / startScale);
        const baseH = Math.max(1, (rect?.height || 1) / startScale);
        const startVisual = Math.max(baseW, baseH) * startScale;

        root.classList.add('is-resizing');
        handle.setPointerCapture(e.pointerId);

        const onMove = (ev) => {
            const delta = Math.max(ev.clientX - startX, ev.clientY - startY);
            const nextVisual = Math.max(1, startVisual + delta);
            const nextScale = clampClockScale(nextVisual / Math.max(baseW, baseH));
            root.style.setProperty('--sidebar-clock-scale', String(nextScale));
            syncClockUndockLayout(root);
            ClockStyle.repositionPopover?.();
        };

        const onUp = (ev) => {
            root.classList.remove('is-resizing');
            try {
                handle.releasePointerCapture(ev.pointerId);
            } catch {
                /* not captured */
            }
            const scale = clampClockScale(
                parseFloat(root.style.getPropertyValue('--sidebar-clock-scale')) || CLOCK_SCALE_DEFAULT
            );
            writeModuleDock('clock', { scale });
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            ClockStyle.repositionPopover?.();
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    });
}

export function countModulesInPanel() {
    const mount = getModuleMount();
    if (!mount) return 0;
    return mount.querySelectorAll('.sidebar-module').length;
}

export function getModuleConfig(id) {
    return moduleById.get(id) || null;
}

export function getModuleUndock(id) {
    return moduleUndockById.get(id) || null;
}

function resolveModuleRoot(id) {
    const placeholder = SidebarModulePopout.getPlaceholder(id);
    if (placeholder) return placeholder;
    const config = getModuleConfig(id);
    return config ? document.getElementById(config.rootId) : null;
}

export function getModuleRoot(id) {
    return resolveModuleRoot(id);
}

export function getModuleMount() {
    return document.querySelector('.side-panel-modules');
}

export function renderSidebarModuleHeaderHtml({ headerId, title, extrasHtml = '' }) {
    return `
            <div class="collapsable-header" id="${headerId}">
                <span class="collapsable-heading"><span class="collapsable-toggle">${CARD_ICONS.chevronDown}</span>${title}</span>
                ${extrasHtml}
                <span class="sidebar-module__chrome">
                    <button type="button" class="card-act sidebar-module__popout" data-sidebar-popout title="Pop out module" aria-label="Pop out module"></button>
                    <button type="button" class="card-act sidebar-module__dock" data-sidebar-dock title="Undock to canvas" aria-label="Undock to canvas"></button>
                </span>
            </div>`;
}

export function expandModuleSection(id) {
    const config = getModuleConfig(id);
    if (!config?.sectionId || !config.headerId) return;
    const section = getAppElementById(config.sectionId);
    const header = getAppElementById(config.headerId);
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
        const root = resolveModuleRoot(config.id);
        // Only docked modules should track the sidebar width. Undocked windows
        // keep the width they had at the moment they were detached; resizing
        // the sidebar must not resize floating modules.
        if (!root || root.classList.contains(SIDEBAR_MODULE_UNDOCKED)) return;
        if (root.classList.contains('sidebar-module--popout-placeholder')) return;
        applyModuleWidth(root, width);
    });
}

function normalizeModuleHeadings() {
    SIDEBAR_MODULES.forEach((config) => {
        const header = getAppElementById(config.headerId);
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
        ? `${SIDEBAR_MODULE_CHROME_IGNORE}, ${config.collapseIgnoreExtra}`
        : SIDEBAR_MODULE_CHROME_IGNORE;
}

export function bindModuleCollapsable(config) {
    // Clock should not be collapsible (always expanded, no toggle)
    if (config.collapseAlways) {
        return;
    }
    
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

export function reattachAllSidebarModules() {
    SIDEBAR_MODULE_ORDER.forEach((id) => {
        const undock = moduleUndockById.get(id);
        if (!undock?.isUndocked()) return;
        undock.applyDockedState();
        undock.updateDockButton();
        getModuleConfig(id)?.onPositionChange?.();
    });
}

export function reattachAllFloatingChrome() {
    SIDEBAR_MODULE_ORDER.forEach((id) => {
        if (SidebarModulePopout.isPoppedOut(id)) SidebarModulePopout.popIn(id);
    });
    reattachAllSidebarModules();
    ToolsManager.closeAll();
    updateReattachAllButton();
}

function poppedModuleCount() {
    let count = 0;
    SIDEBAR_MODULES.forEach((config) => {
        if (SidebarModulePopout.isPoppedOut(config.id)) count += 1;
    });
    return count;
}

export function updateReattachAllButton() {
    const btn = document.getElementById('sidebar-reattach-all');
    if (!btn) return;
    const undocked = document.querySelectorAll(`.sidebar-module.${SIDEBAR_MODULE_UNDOCKED}`).length;
    const popped = poppedModuleCount();
    const toolsOpen = ToolsManager.openPanels?.size ?? 0;
    const active = undocked > 0 || popped > 0 || toolsOpen > 0;
    btn.classList.toggle('is-hidden', !active);
    btn.disabled = !active;
}

export function bindSidebarReattachAll() {
    const btn = document.getElementById('sidebar-reattach-all');
    if (!btn || btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.innerHTML = CARD_ICONS.pin;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        reattachAllFloatingChrome();
    });
    window.addEventListener('floating:chrome_changed', updateReattachAllButton);
    updateReattachAllButton();
}

export function initAllSidebarModules() {
    normalizeModuleHeadings();
    bindAllModuleCollapseHandlers();
    applyAllModuleWidths();
    window.addEventListener('sidebar:width_changed', applyAllModuleWidths);

    SIDEBAR_MODULES.forEach((config) => {
        const root = document.getElementById(config.rootId);
        if (!root) return;
        root.dataset.moduleId = config.id;

        const isClock = config.id === 'clock';
        const undock = initSidebarUndock({
            getRoot: () => resolveModuleRoot(config.id),
            undockedClass: SIDEBAR_MODULE_UNDOCKED,
            draggingClass: SIDEBAR_MODULE_DRAGGING,
            dockSelector: SIDEBAR_MODULE_DOCK_SEL,
            getHeader: () => {
                const placeholder = SidebarModulePopout.getPlaceholder(config.id);
                if (placeholder) {
                    return placeholder.querySelector('.sidebar-module-popout-placeholder__header');
                }
                return config.headerId ? getAppElementById(config.headerId) : null;
            },
            readDock: () => readModuleDock(config.id),
            writeDock: (patch) => writeModuleDock(config.id, patch),
            restoreToSidebar: () => restoreModuleToSidebar(config.id),
            onBeforeUndock: config.expandOnUndock ? () => expandModuleSection(config.id) : undefined,
            onPositionChange: config.onPositionChange,
            onStateChange: notifyFloatingChromeChanged,
            dragBlockSelector: config.dragBlockSelector,
            applyUndockChrome: isClock ? applyClockUndockChrome : undefined,
            clearUndockChrome: isClock ? clearClockUndockChrome : undefined
        });

        moduleUndockById.set(config.id, undock);
        if (isClock) bindClockUndockResize(root);
        undock.applyInitialDockState();
        undock.updateDockButton();
    });

    initAllModulePopouts(resolveModuleRoot, (id) => moduleUndockById.get(id));
    SidebarModulePopout.syncAllPopoutButtons();

    bindSidebarReattachAll();
}
