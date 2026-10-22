/**
 * @module {"owns":"sidebar module enable/disable prefs, visibility DOM, lifecycle registry","related":["displayOptions.js","sidebarModules.js","app.js","customizationReset.js"],"events":["sidebar:modules_changed"]}
 */

/**
 * Display options blob holds the per-module flags (same key displayOptions.js
 * reads/writes; see popoutWindows.js for the same pattern).
 */
const DISPLAY_OPTIONS_KEY = 'matrix_display_options';

/** Fired after the hidden-module set is applied to the DOM. */
export const SIDEBAR_MODULES_CHANGED_EVENT = 'sidebar:modules_changed';

/**
 * Modules exposed in Display Options → Sidebar → Modules.
 * Order matches the sidebar order in index.html.
 */
export const SIDEBAR_MODULE_TOGGLES = [
    { id: 'radio', label: 'Radio' },
    { id: 'tv', label: 'TV' },
    { id: 'weather', label: 'Weather' },
    { id: 'links', label: 'Links' },
    { id: 'history', label: 'History' },
    { id: 'stats', label: 'Stats' }
];

export const SIDEBAR_MODULE_IDS = SIDEBAR_MODULE_TOGGLES.map((toggle) => toggle.id);

/** Every module is on unless explicitly disabled — no migration needed. */
export const DEFAULT_SIDEBAR_MODULES = Object.freeze(
    Object.fromEntries(SIDEBAR_MODULE_IDS.map((id) => [id, true]))
);

/**
 * Coerce a stored/partial map into a complete boolean map. Unknown keys are
 * dropped, missing keys default to enabled, non-booleans fall back to enabled.
 */
export function normalizeSidebarModules(value) {
    const source = value && typeof value === 'object' ? value : {};
    const normalized = {};
    SIDEBAR_MODULE_IDS.forEach((id) => {
        normalized[id] = source[id] !== false;
    });
    return normalized;
}

/** Read the module flags straight from the display options blob. */
export function readSidebarModules() {
    try {
        const raw = JSON.parse(localStorage.getItem(DISPLAY_OPTIONS_KEY) || '{}');
        return normalizeSidebarModules(raw.sidebarModules);
    } catch {
        return { ...DEFAULT_SIDEBAR_MODULES };
    }
}

/** Enabled unless a caller passes an explicit `false`. */
export function isSidebarModuleEnabled(id, modules = readSidebarModules()) {
    return modules?.[id] !== false;
}

/**
 * CSS token list for `html[data-sidebar-hidden~="radio"]`. Space delimited —
 * `~=` matches whole tokens, so JSON output would not work here.
 */
export function sidebarHiddenAttrValue(modules) {
    const normalized = normalizeSidebarModules(modules);
    return SIDEBAR_MODULE_IDS.filter((id) => !normalized[id]).join(' ');
}

/**
 * Hide/show module roots via `data-sidebar-hidden` on <html>, then notify
 * listeners so lifecycle + pull-based refreshes can follow. CSS (not the
 * `is-hidden` class) is used because roots move to popout windows/body while
 * undocked or popped out, and a single attribute rule covers all of them.
 */
export function applySidebarModuleVisibilityDom(modules) {
    const normalized = normalizeSidebarModules(modules);
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    if (root?.dataset) {
        root.dataset.sidebarHidden = sidebarHiddenAttrValue(normalized);
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function'
        && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent(SIDEBAR_MODULES_CHANGED_EVENT, {
            detail: { modules: normalized }
        }));
    }
    return normalized;
}

/** @type {Map<string, { start?: () => void, stop?: () => void, started: boolean }>} */
const lifecycleById = new Map();

/**
 * Register start/stop hooks for a module that owns background work (players,
 * network polling) or that needs a one-off refresh when it is re-enabled.
 * `started` records the boot state so the first `syncSidebarModuleLifecycle()`
 * call is a no-op instead of re-running boot work.
 */
export function registerSidebarModuleLifecycle(id, { start, stop, started = false } = {}) {
    lifecycleById.set(id, { start, stop, started: started === true });
}

/** Test/maintenance helper: forget every registration. */
export function resetSidebarModuleLifecycleRegistry() {
    lifecycleById.clear();
}

/**
 * Start newly enabled modules and stop newly disabled ones. Hooks only run on a
 * state transition, so repeated calls (local toggle + cross-tab sync) are free.
 * `started` is flipped before the hook runs so a hook that re-enters this
 * function cannot double-start or double-stop a module.
 */
export function syncSidebarModuleLifecycle(modules = readSidebarModules()) {
    const normalized = normalizeSidebarModules(modules);
    lifecycleById.forEach((hooks, id) => {
        const enabled = normalized[id] !== false;
        if (enabled === hooks.started) return;
        hooks.started = enabled;
        try {
            if (enabled) hooks.start?.();
            else hooks.stop?.();
        } catch (err) {
            /* One broken module must not block the others. */
            console.warn(`[sidebarModules] lifecycle ${enabled ? 'start' : 'stop'} failed for ${id}`, err);
        }
    });
}
