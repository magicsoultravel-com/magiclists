/**
 * @module {"owns":"cross-tab state sync — BroadcastChannel primary, storage-event insurance", "related":["app.js","api.js","layoutStorage.js","displayOptions.js","appTheme.js","popoutNote.js"]}
 *
 * Every stateful object in the app (notes, board layout, file cabinet, sidebar
 * modules, display options, theme, ...) is persisted to localStorage. This
 * module keeps other tabs/windows converged without a page reload:
 *
 *   1. BroadcastChannel('magiclists-state') is the primary, explicit signal —
 *      sent at the narrow save chokepoints (api.saveItem, safeSetItem,
 *      writeDisplayOptions, writeUserTheme) with a coarse scope + optional
 *      noteId hint.
 *   2. A `storage` event listener maps EVERY localStorage write to a scope and
 *      acts as insurance for the many write sites that are not instrumented
 *      (file cabinet drags, sidebar prefs, categories, ...). Browsers fire the
 *      event in every OTHER tab, so "after every save" is covered for free.
 *
 * Both funnels join one debounced, busy-guarded refresh pipeline. The receiving
 * tab decides weight per scope through the handlers wired in app.js:
 *
 *   onVisualRefresh  — non-destructive CSS/attribute re-apply (theme/display),
 *                      applied immediately with no DOM rebuild and no guards.
 *   onBoardRefresh   — debounced full board/sidebar refresh (or targeted card
 *                      refresh when a single noteId hint is available).
 *   onDeferred       — the refresh was parked because the user is busy.
 *   onRefreshed      — a parked refresh finally ran (reset any toast flag).
 */

export const SYNC_CHANNEL = 'magiclists-state';

/** Coalescing window for board-scope refreshes (ms). */
export const DEBOUNCE_MS = 400;
/** Retry cadence while the user is busy editing/dragging (ms). */
export const RETRY_MS = 1000;
/** Max retries before dropping a deferred batch (next write retries anyway). */
export const MAX_RETRIES = 5;

/**
 * localStorage key -> coarse sync scope. Any new persisted key only needs an
 * entry here to be picked up by the storage-event insurance path.
 *
 * Scopes:
 *   'notes'       -> board card refresh (targeted when noteId is known)
 *   'layout'      -> board re-render (positions/sizes)
 *   'filecabinet' -> board re-render (file cabinet order/visibility)
 *   'sidebar'     -> board + sidebar refresh
 *   'categories'  -> board + sidebar refresh (hidden/custom categories)
 *   'workspace'   -> full workspace re-render (mode / desktop layout)
 *   'media'       -> light media-module settings refresh (settings only)
 *   'theme'       -> CSS-only theme re-apply (non-destructive)
 *   'display'     -> attribute/CSS display-options re-apply (non-destructive)
 */
export const STORAGE_SCOPE_MAP = {
    // Notes + undo history
    matrix_database: 'notes',
    matrix_undo_history: 'notes',
    // Board layout
    matrix_grid_layout: 'layout',
    matrix_grid_pins: 'layout',
    matrix_grid_expanded_id: 'layout',
    matrix_freeform_positions: 'layout',
    matrix_freeform_sizes: 'layout',
    matrix_spatial_layout_schema: 'layout',
    matrix_view_sessions: 'layout',
    matrix_collapsed_categories: 'layout',
    // File cabinet
    matrix_file_cabinet: 'filecabinet',
    matrix_file_cabinet_order: 'filecabinet',
    matrix_file_cabinet_filed_categories: 'filecabinet',
    matrix_file_cabinet_category_order: 'filecabinet',
    matrix_file_cabinet_height: 'filecabinet',
    matrix_file_cabinet_shut: 'filecabinet',
    // Sidebar
    matrix_panel_collapsed: 'sidebar',
    matrix_sidebar_sections: 'sidebar',
    matrix_notes_list_sort: 'sidebar',
    matrix_board_sort: 'sidebar',
    matrix_sidebar_module_docks: 'sidebar',
    matrix_sidebar_width: 'sidebar',
    // Categories
    matrix_custom_categories: 'categories',
    matrix_hidden_categories: 'categories',
    // Display / appearance (visual-only, applied immediately)
    matrix_display_options: 'display',
    matrix_note_font_scale: 'display',
    matrix_note_font: 'display',
    matrix_editor_zoom: 'display',
    matrix_desktop_zoom: 'display',
    // Theme (visual-only, applied immediately)
    matrix_custom_theme_tokens: 'theme',
    // Workspace / global view
    matrix_workspace_mode: 'workspace',
    matrix_desktop_layout: 'workspace',
    matrix_preferred_view: 'workspace',
    // Media modules (settings/prefs only; play state stays per-tab)
    matrix_radio_state: 'media',
    matrix_tv_state: 'media',
    magiclists_weather_settings: 'media'
};

/**
 * Unique per JS context — every tab/window has its own module instance, so a
 * fresh UUID is enough to ignore our own channel messages. No sessionStorage
 * (which popouts inherit from their opener) is used, avoiding the id collision
 * pitfall documented in notePopoutBridge.js.
 */
const senderId = (() => {
    try {
        return crypto.randomUUID?.() || `sync_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    } catch {
        return `sync_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }
})();

let channel = null;
let handlers = {};
let pendingScopes = new Set();
let pendingInfo = null;
let debounceTimer = null;
let retries = 0;

/**
 * Initialize the sync pipeline. Safe to call once per context (app.js for the
 * main window, popoutNote.js for note popouts — the latter only wires visual
 * refresh and lets the note bridge handle note-level sync).
 *
 * @param {object} nextHandlers
 * @param {(scope: string, info: object) => void} [nextHandlers.onVisualRefresh]
 * @param {(scopes: string[], info: object) => void} [nextHandlers.onBoardRefresh]
 * @param {(scopes: string[]) => void} [nextHandlers.onDeferred]
 * @param {(scopes: string[]) => void} [nextHandlers.onRefreshed]
 */
export function initCrossTabSync(nextHandlers = {}) {
    handlers = nextHandlers || {};

    try {
        if (channel) {
            try { channel.close(); } catch { /* ignore */ }
        }
        channel = new BroadcastChannel(SYNC_CHANNEL);
        channel.onmessage = (event) => onChannelMessage(event.data);
    } catch (err) {
        // BroadcastChannel unavailable (private mode / legacy engine / Node).
        // The storage-event insurance path keeps cross-tab sync working.
        channel = null;
    }

    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('storage', (event) => {
            const scope = event.key ? STORAGE_SCOPE_MAP[event.key] : null;
            if (!scope) return;
            // The writing tab never receives its own storage event — only other
            // tabs do — so no sender filtering is needed on this path.
            queueRefresh(scope, { key: event.key });
        });
    }
}

/**
 * Send an explicit state-changed broadcast after a meaningful write. This is
 * the primary path; storage events are the insurance for uninstrumented sites.
 */
export function broadcastStateChange(scope, opts = {}) {
    if (!channel) return;
    const message = {
        type: 'state_changed',
        scope,
        key: opts.key || null,
        noteId: opts.noteId || null,
        at: Date.now(),
        senderId
    };
    try {
        channel.postMessage(message);
    } catch (err) {
        console.warn('[CrossTabSync] broadcast failed:', err);
    }
}

/** External escape hatch for app-side callbacks that need a fresh refresh. */
export function requestFullRefresh(scope = 'all', opts = {}) {
    queueRefresh(scope, { key: opts.key || null, noteId: opts.noteId || null });
}

function onChannelMessage(msg) {
    if (!msg || msg.type !== 'state_changed') return;
    if (msg.senderId === senderId) return;
    queueRefresh(msg.scope, { key: msg.key || null, noteId: msg.noteId || null });
}

function queueRefresh(scope, info) {
    if (!scope) return;
    // Visual-only scopes are non-destructive — apply immediately, no debounce,
    // no busy guard, no DOM rebuild.
    if (scope === 'theme' || scope === 'display') {
        handlers.onVisualRefresh?.(scope, info);
        return;
    }
    pendingScopes.add(scope);
    pendingInfo = info || null;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushRefresh, DEBOUNCE_MS);
}

function flushRefresh() {
    debounceTimer = null;
    if (!pendingScopes.size) return;

    // Nothing in this context consumes board scopes (e.g. note popouts) — drop..
    if (!handlers.onBoardRefresh) return;

    if (isBusy()) {
        if (retries < MAX_RETRIES) {
            retries += 1;
            handlers.onDeferred?.([...pendingScopes]);
            debounceTimer = setTimeout(flushRefresh, RETRY_MS);
        } else {
            retries = 0;
            // Give up on this batch —the user's next save/blur write will send
            // a fresh signal and retry from a clean slate. Drop the parked batch...
            pendingScopes.clear();
            pendingInfo = null;
        }
        return;
    }

    retries = 0;
    const scopes = [...pendingScopes];
    const info = pendingInfo;
    pendingScopes.clear();
    pendingInfo = null;
    handlers.onBoardRefresh(scopes, info);
    handlers.onRefreshed?.(scopes, info);
}

/**
 * True while a full re-render would interrupt the user: actively editing a card
 * inline, dragging a card, dragging a checklist step, or in drawing/note-canvas
 * mode. DOM-signal based so no state plumbing is needed across the app.
 */
function isBusy() {
    if (typeof document === 'undefined') return false;
    const active = document.activeElement;
    if (active?.closest?.('.card-inline-edit')) return true;
    const canvas = document.getElementById('app-canvas');
    if (canvas?.querySelector?.('.is-grid-dragging, .is-freeform-dragging')) return true;
    if (document.body?.classList?.contains('is-checklist-dragging')) return true;
    // Note-canvas and workspace magicCanvas both set data-drawing-mode on the shell.
    if (document.getElementById('workspace-shell')?.hasAttribute('data-drawing-mode')) return true;
    return false;
}
