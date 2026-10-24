/**
 * @module {"owns":"detached (floating) sidebar mode: toggle, drag, corner resize, clamping, persisted geometry","related":["shellResize.js","sidebarPrefs.js","hamburger.js","sync.js","board/boardExtents.js"],"events":["sidebar:width_changed","tools:desktop_bounds_changed"]}
 */
import {
    readSidebarDetach,
    writeSidebarDetach,
    normalizeDetachedGeometry,
    SIDEBAR_DEFAULT_WIDTH,
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_DETACHED_KEY
} from './sidebarPrefs.js';
import {
    applyDetachedSidebarMetrics,
    clampSidebarWidth,
    onShellDockChanged,
    resetSidebarWidthToDefault
} from './shellResize.js';
import { CARD_ICONS } from './icons.js';

export const SIDEBAR_DETACHED_CLASS = 'is-detached';
export const SIDEBAR_DETACHED_SIZED_CLASS = 'is-detached--sized';
export const SIDEBAR_DETACH_TOGGLE_SEL = '[data-sidebar-detach-toggle]';
export const SIDEBAR_DETACH_HANDLE_SEL = '[data-sidebar-detach-resize]';
export const SIDEBAR_DETACHED_MIN_HEIGHT = 120;

/**
 * Build-time default for detached mode. `false` ships a build where the floating
 * sidebar cannot be entered at all: the toggle is hidden, resize handles are
 * dropped, no listeners are bound, and a persisted detached state is discarded
 * on boot (re-applying it from init() is what re-enters the #side-panel class
 * feedback loop and hangs the tab). Runtime-overridable via
 * setSidebarDetachEnabled() so tests can exercise both builds.
 *
 * Keep this as the emergency off switch: set it to false to ship detached mode
 * disabled without touching the rest of the module.
 */
export const SIDEBAR_DETACH_ENABLED = true;

const SURFACE_MARGIN = 8;
const DRAG_THRESHOLD = 4;
const DBLCLICK_GUARD_MS = 300;
/** Corner handles: [x direction, y direction] — -1 grows toward the origin. */
const HANDLE_DIRECTIONS = { nw: [-1, -1], ne: [1, -1], sw: [-1, 1], se: [1, 1] };
const HEADER_IGNORE_SEL = 'button, a, input, select, textarea, label';
const NAV_TOGGLE_SEL = '#nav-panel-toggle, #nav-panel-toggle-fab';
/** Upper bound on re-clamps per frame (see reclampDetachedPanel). */
const RECLAMP_MAX_PER_FRAME = 8;

let bound = false;
let interacting = false;
let lastDragEndAt = 0;
let detachEnabled = SIDEBAR_DETACH_ENABLED;
let reclamping = false;
let reclampBudget = 0;

export function isSidebarDetachEnabled() {
    return detachEnabled;
}

/** Runtime override of SIDEBAR_DETACH_ENABLED (tests, future settings switch). */
export function setSidebarDetachEnabled(enabled) {
    detachEnabled = enabled !== false;
    return detachEnabled;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function px(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function raf(callback) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(callback);
    else setTimeout(callback, 0);
}

/** Resolved lazily (never cached) so tests can swap the DOM between cases. */
function getPanel() {
    return typeof document !== 'undefined' ? document.getElementById('side-panel') : null;
}

function getBody() {
    return typeof document !== 'undefined' ? document.body : null;
}

export function isDetached() {
    return getPanel()?.classList.contains(SIDEBAR_DETACHED_CLASS) ?? false;
}

/**
 * Viewport-space rectangle the floating panel may occupy. `#workspace-shell`
 * sets no transform/contain/will-change, so `position: fixed` is viewport
 * relative and getBoundingClientRect() is in the same coordinate space.
 */
function getFloatingBounds() {
    const surface = typeof document !== 'undefined'
        ? document.getElementById('desktop-surface')
        : null;
    const rect = surface?.getBoundingClientRect?.();
    if (rect && Number.isFinite(rect.left) && Number.isFinite(rect.top)
        && rect.width > 0 && rect.height > 0) {
        return {
            left: rect.left + SURFACE_MARGIN,
            top: rect.top + SURFACE_MARGIN,
            right: rect.left + rect.width - SURFACE_MARGIN,
            bottom: rect.top + rect.height - SURFACE_MARGIN
        };
    }
    const viewportW = (typeof window !== 'undefined' && window.innerWidth) || 1280;
    const viewportH = (typeof window !== 'undefined' && window.innerHeight) || 800;
    return {
        left: SURFACE_MARGIN,
        top: SURFACE_MARGIN,
        right: viewportW - SURFACE_MARGIN,
        bottom: viewportH - SURFACE_MARGIN
    };
}

/**
 * Clamp a geometry request to the floating area. Width goes through the same
 * bounds as the docked splitter (clampSidebarWidth), height has its own floor,
 * and null height means "auto" (panel hugs its modules).
 * @param {{ width?: number|null, height?: number|null, x?: number|null, y?: number|null }} geometry
 */
export function clampDetachedGeometry(geometry = {}) {
    const bounds = getFloatingBounds();
    const maxWidth = Math.max(SIDEBAR_MIN_WIDTH, bounds.right - bounds.left);
    const requestedWidth = Number.isFinite(geometry.width) && geometry.width > 0
        ? geometry.width
        : SIDEBAR_DEFAULT_WIDTH;
    const width = clampSidebarWidth(clamp(requestedWidth, SIDEBAR_MIN_WIDTH, maxWidth));

    const maxHeight = Math.max(SIDEBAR_DETACHED_MIN_HEIGHT, bounds.bottom - bounds.top);
    const height = Number.isFinite(geometry.height) && geometry.height > 0
        ? clamp(geometry.height, SIDEBAR_DETACHED_MIN_HEIGHT, maxHeight)
        : null;

    // Clamp the offset against the panel's real footprint so the whole panel
    // stays inside the board area, not just its top-left corner.
    const el = getPanel();
    const footprintHeight = height ?? (el?.offsetHeight || SIDEBAR_DETACHED_MIN_HEIGHT);
    const maxX = Math.max(bounds.left, bounds.right - width);
    const maxY = Math.max(bounds.top, bounds.bottom - footprintHeight);

    return {
        width,
        height,
        x: Number.isFinite(geometry.x) ? clamp(geometry.x, bounds.left, maxX) : null,
        y: Number.isFinite(geometry.y) ? clamp(geometry.y, bounds.top, maxY) : null
    };
}

/** Clamp a free drag position for the given panel footprint. */
export function clampDetachedPosition(x, y, width = SIDEBAR_DEFAULT_WIDTH, height = SIDEBAR_DETACHED_MIN_HEIGHT) {
    const bounds = getFloatingBounds();
    const maxX = Math.max(bounds.left, bounds.right - Math.max(SIDEBAR_MIN_WIDTH, width));
    const maxY = Math.max(bounds.top, bounds.bottom - Math.max(SIDEBAR_DETACHED_MIN_HEIGHT, height));
    return {
        x: clamp(Number.isFinite(x) ? x : bounds.left, bounds.left, maxX),
        y: clamp(Number.isFinite(y) ? y : bounds.top, bounds.top, maxY)
    };
}

/** Geometry currently rendered by the panel (used when persisting). */
export function readDetachedGeometry() {
    const el = getPanel();
    if (!el) return normalizeDetachedGeometry(null);
    const rect = el.getBoundingClientRect?.() ?? {};
    // --sidebar-width / inline height are the values the panel actually paints
    // (offsetWidth would round-trip the clamp on every commit).
    const width = px(el.style.getPropertyValue('--sidebar-width'))
        ?? (el.offsetWidth || (Number.isFinite(rect.width) ? rect.width : null))
        ?? SIDEBAR_DEFAULT_WIDTH;
    const sized = el.classList.contains(SIDEBAR_DETACHED_SIZED_CLASS);
    const height = px(el.style.getPropertyValue('height'))
        ?? (sized ? (el.offsetHeight || (Number.isFinite(rect.height) ? rect.height : null)) : null);
    const x = px(el.style.getPropertyValue('left')) ?? (Number.isFinite(rect.left) ? rect.left : null);
    const y = px(el.style.getPropertyValue('top')) ?? (Number.isFinite(rect.top) ? rect.top : null);
    return normalizeDetachedGeometry({ width, height, x, y });
}

/** Write-if-changed: a redundant write re-notifies #side-panel class observers. */
function setStyleIfChanged(el, property, value) {
    if (el.style.getPropertyValue(property) === value) return false;
    el.style.setProperty(property, value);
    return true;
}

/**
 * Apply width/height/position to the floating panel. Width goes through
 * shellResize's metrics path (which fires sidebar:width_changed so modules
 * reflow) and is never persisted here.
 *
 * Every DOM write is conditional: toolsManager broadcasts
 * tools:desktop_bounds_changed on #side-panel class mutations, and this function
 * is what that broadcast ends up calling (reclampDetachedPanel). Unconditional
 * writes would let the broadcast re-arm itself forever — a silent freeze, since
 * MutationObserver callbacks run in the microtask queue and never throw.
 * Being idempotent makes the second pass a no-op and the cycle terminate.
 */
export function applyDetachedGeometry(geometry = null) {
    const el = getPanel();
    if (!el) return null;
    const next = clampDetachedGeometry(normalizeDetachedGeometry(geometry));
    const appliedWidth = applyDetachedSidebarMetrics(next.width) ?? next.width;

    const sized = el.classList.contains(SIDEBAR_DETACHED_SIZED_CLASS);
    if (next.height) {
        setStyleIfChanged(el, 'height', `${Math.round(next.height)}px`);
        if (!sized) el.classList.add(SIDEBAR_DETACHED_SIZED_CLASS);
    } else {
        if (el.style.getPropertyValue('height')) el.style.removeProperty('height');
        if (sized) el.classList.remove(SIDEBAR_DETACHED_SIZED_CLASS);
    }

    const bounds = getFloatingBounds();
    const x = next.x ?? bounds.left;
    const y = next.y ?? bounds.top;
    setStyleIfChanged(el, 'left', `${Math.round(x)}px`);
    setStyleIfChanged(el, 'top', `${Math.round(y)}px`);
    return { ...next, width: appliedWidth, x, y };
}

/** Reset the floating sidebar's width and height to their defaults. */
export function resetDetachedSize() {
    if (!isDetached()) return false;
    const current = readDetachedGeometry();
    const applied = applyDetachedGeometry({
        width: SIDEBAR_DEFAULT_WIDTH,
        height: null,
        x: current.x,
        y: current.y
    });
    writeSidebarDetach(true, applied ?? current);
    return true;
}

export const resetDetachedSizeToDefault = resetDetachedSize;
export const resetFloatingSidebarSize = resetDetachedSize;

/**
 * Remove every entry point into detached mode (kill-switch builds). Safe to call
 * repeatedly: it only touches the toggle button and any resize handles.
 */
function hideDetachAffordances() {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('sidebar-detach-toggle')
        ?? document.querySelector?.(SIDEBAR_DETACH_TOGGLE_SEL);
    if (btn) {
        btn.hidden = true;
        if (btn.style) btn.style.display = 'none';
        btn.setAttribute?.('aria-hidden', 'true');
        btn.setAttribute?.('tabindex', '-1');
    }
    const handles = getPanel()?.querySelectorAll?.(SIDEBAR_DETACH_HANDLE_SEL);
    handles?.forEach?.((handle) => handle.remove?.());
}

export function syncSidebarDetachToggle() {
    if (typeof document === 'undefined') return;
    if (!detachEnabled) {
        hideDetachAffordances();
        return;
    }
    const btn = document.getElementById('sidebar-detach-toggle')
        ?? document.querySelector?.(SIDEBAR_DETACH_TOGGLE_SEL);
    if (!btn) return;
    const detached = isDetached();
    btn.innerHTML = detached ? CARD_ICONS.attach : CARD_ICONS.detach;
    const label = detached ? 'Reattach sidebar' : 'Detach sidebar';
    btn.title = label;
    btn.setAttribute?.('aria-label', label);
    btn.setAttribute?.('aria-pressed', detached ? 'true' : 'false');
}

/**
 * Reset overrides (dblclick on the brand row): back to 220px, auto height and
 * the top-left default position.
 */
export function resetDetachedGeometry() {
    if (!isDetached()) return false;
    const applied = applyDetachedGeometry(null);
    writeSidebarDetach(true, applied);
    return true;
}

/**
 * Mirror SidePanel.setCollapsed(false) chrome without touching storage: a
 * restored "collapsed + detached" state must still show the floating panel.
 */
function syncNavToggleChrome() {
    if (typeof document === 'undefined') return;
    const toggle = document.getElementById('nav-panel-toggle');
    toggle?.setAttribute('aria-expanded', 'true');
    toggle?.setAttribute('title', 'Hide panel');
    toggle?.setAttribute('aria-label', 'Hide side panel');
    document.getElementById('nav-panel-toggle-fab')?.classList.add('is-hidden');
}

export function detachSidebar({ geometry = null, persist = true } = {}) {
    const el = getPanel();
    if (!el || isDetached()) return false;
    const body = getBody();

    // One frame with transitions off: the board has already reclaimed the flex
    // space by the time the panel paints at 220px, so there is no two-frame snap.
    body?.classList.add('is-sidebar-detached', 'is-sidebar-detaching');
    el.classList.remove('is-collapsed');
    el.classList.add(SIDEBAR_DETACHED_CLASS);
    syncNavToggleChrome();

    const applied = applyDetachedGeometry(geometry);
    if (persist) writeSidebarDetach(true, applied);
    syncSidebarDetachToggle();

    // Leaving the flow hides the splitter, resets the board packing width and
    // re-clamps the file cabinet; it also broadcasts tools:desktop_bounds_changed.
    onShellDockChanged();

    raf(() => body?.classList.remove('is-sidebar-detaching'));
    return true;
}

export function reattachSidebar({ persist = true } = {}) {
    const el = getPanel();
    if (!el || !isDetached()) return false;

    el.classList.remove(SIDEBAR_DETACHED_CLASS, SIDEBAR_DETACHED_SIZED_CLASS, 'is-detached-dragging');
    el.style.removeProperty('left');
    el.style.removeProperty('top');
    el.style.removeProperty('height');
    getBody()?.classList.remove(
        'is-sidebar-detached',
        'is-sidebar-detaching',
        'is-sidebar-detached-dragging',
        'is-sidebar-detached-resizing'
    );

    if (persist) writeSidebarDetach(false);
    syncSidebarDetachToggle();

    // Re-entering the flow restores the STORED docked width (applyStoredSidebarWidth
    // inside onShellDockChanged) and fires sidebar:width_changed for module reflow.
    onShellDockChanged();
    return true;
}

export function toggleSidebarDetach() {
    return isDetached() ? reattachSidebar() : detachSidebar();
}

/** Apply localStorage (init, cross-tab storage event, backup restore, reset). */
export function applyStoredDetachState() {
    const stored = readSidebarDetach();
    if (stored.detached) {
        if (isDetached()) {
            applyDetachedGeometry(stored.geometry);
            syncSidebarDetachToggle();
            return true;
        }
        return detachSidebar({ geometry: stored.geometry, persist: false });
    }
    if (isDetached()) return reattachSidebar({ persist: false });
    syncSidebarDetachToggle();
    return false;
}

function bindPointerListeners(onMove, onUp, event) {
    const target = event?.currentTarget ?? event?.target;
    try {
        target?.setPointerCapture?.(event.pointerId);
    } catch {
        /* pointer already released */
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
}

function releasePointerListeners(onMove, onUp) {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
}

function beginDrag(event) {
    const el = getPanel();
    if (!el || !isDetached()) return;

    const rect = el.getBoundingClientRect?.() ?? {};
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = px(el.style.getPropertyValue('left'))
        ?? (Number.isFinite(rect.left) ? rect.left : 0);
    const startTop = px(el.style.getPropertyValue('top'))
        ?? (Number.isFinite(rect.top) ? rect.top : 0);
    let dragging = false;
    interacting = true;

    const onMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!dragging) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            dragging = true;
            el.classList.add('is-detached-dragging');
            getBody()?.classList.add('is-sidebar-detached-dragging');
        }
        const next = clampDetachedPosition(
            startLeft + dx,
            startTop + dy,
            el.offsetWidth || SIDEBAR_DEFAULT_WIDTH,
            el.offsetHeight || SIDEBAR_DETACHED_MIN_HEIGHT
        );
        el.style.setProperty('left', `${Math.round(next.x)}px`);
        el.style.setProperty('top', `${Math.round(next.y)}px`);
    };

    const onUp = () => {
        releasePointerListeners(onMove, onUp);
        interacting = false;
        el.classList.remove('is-detached-dragging');
        getBody()?.classList.remove('is-sidebar-detached-dragging');
        if (!dragging) return;
        lastDragEndAt = Date.now();
        writeSidebarDetach(true, readDetachedGeometry());
    };

    bindPointerListeners(onMove, onUp, event);
}

function beginResize(event, directionKey) {
    const el = getPanel();
    const direction = HANDLE_DIRECTIONS[directionKey];
    if (!el || !direction || !isDetached()) return;
    event.preventDefault?.();
    event.stopPropagation?.();

    const rect = el.getBoundingClientRect?.() ?? {};
    // --sidebar-width / inline height are authoritative (offsetWidth includes
    // borders, which would drift the anchored edge by a pixel per resize).
    const startWidth = px(el.style.getPropertyValue('--sidebar-width'))
        ?? (el.offsetWidth || (Number.isFinite(rect.width) ? rect.width : SIDEBAR_DEFAULT_WIDTH));
    const startHeight = px(el.style.getPropertyValue('height'))
        ?? (el.offsetHeight || (Number.isFinite(rect.height) ? rect.height : SIDEBAR_DETACHED_MIN_HEIGHT));
    const startLeft = Number.isFinite(rect.left)
        ? rect.left
        : (px(el.style.getPropertyValue('left')) ?? 0);
    const startTop = Number.isFinite(rect.top)
        ? rect.top
        : (px(el.style.getPropertyValue('top')) ?? 0);
    const startRight = startLeft + startWidth;
    const startBottom = startTop + startHeight;
    const startX = event.clientX;
    const startY = event.clientY;

    interacting = true;
    getBody()?.classList.add('is-sidebar-detached-resizing');

    const onMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const bounds = getFloatingBounds();
        const maxWidth = Math.max(SIDEBAR_MIN_WIDTH, bounds.right - bounds.left);
        const maxHeight = Math.max(SIDEBAR_DETACHED_MIN_HEIGHT, bounds.bottom - bounds.top);
        const requestedWidth = clamp(startWidth + dx * direction[0], SIDEBAR_MIN_WIDTH, maxWidth);
        const nextHeight = clamp(startHeight + dy * direction[1], SIDEBAR_DETACHED_MIN_HEIGHT, maxHeight);
        const width = applyDetachedSidebarMetrics(requestedWidth) ?? requestedWidth;

        el.style.setProperty('height', `${Math.round(nextHeight)}px`);
        el.classList.add(SIDEBAR_DETACHED_SIZED_CLASS);

        // North/west handles keep the opposite edge anchored.
        const left = direction[0] < 0 ? startRight - width : startLeft;
        const top = direction[1] < 0 ? startBottom - nextHeight : startTop;
        const position = clampDetachedPosition(left, top, width, nextHeight);
        el.style.setProperty('left', `${Math.round(position.x)}px`);
        el.style.setProperty('top', `${Math.round(position.y)}px`);
    };

    const onUp = () => {
        releasePointerListeners(onMove, onUp);
        interacting = false;
        getBody()?.classList.remove('is-sidebar-detached-resizing');
        writeSidebarDetach(true, readDetachedGeometry());
    };

    bindPointerListeners(onMove, onUp, event);
}

function bindResizeHandles() {
    const el = getPanel();
    if (!el?.querySelector || el.querySelector(SIDEBAR_DETACH_HANDLE_SEL)) return;
    Object.keys(HANDLE_DIRECTIONS).forEach((direction) => {
        const handle = document.createElement('div');
        handle.className = `sidebar-detach-handle sidebar-detach-handle--${direction}`;
        handle.setAttribute('data-sidebar-detach-resize', direction);
        handle.setAttribute('aria-hidden', 'true');
        handle.addEventListener('pointerdown', (event) => beginResize(event, direction));
        el.appendChild(handle);
    });
}

function bindToggleButton() {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('sidebar-detach-toggle')
        ?? document.querySelector?.(SIDEBAR_DETACH_TOGGLE_SEL);
    if (!btn || btn.dataset?.sidebarDetachToggleBound === 'true') return;
    if (btn.dataset) btn.dataset.sidebarDetachToggleBound = 'true';
    btn.addEventListener('click', (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        toggleSidebarDetach();
    });
}

export function bindSidebarResetSize() {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('sidebar-reset-size')
        ?? document.querySelector?.('[data-sidebar-reset-size]');
    if (!btn || btn.dataset?.sidebarResetSizeBound === 'true') return;
    if (btn.dataset) btn.dataset.sidebarResetSizeBound = 'true';
    btn.innerHTML = CARD_ICONS.maximize ?? '';
    btn.addEventListener('click', (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (isDetached()) resetDetachedSize();
        else resetSidebarWidthToDefault();
    });
}

export function bindSidebarCollapseAll() {
    // Collapse-all is module-level; sidebarDetach only ensures binding hook exists.
}

function bindBrandRow() {
    const el = getPanel();
    const header = el?.querySelector?.('.control-bar-brand');
    if (!header || header.dataset?.sidebarDetachBound === 'true') return;
    if (header.dataset) header.dataset.sidebarDetachBound = 'true';

    header.addEventListener('pointerdown', (event) => {
        if (!isDetached() || event.button !== 0) return;
        if (event.target?.closest?.(HEADER_IGNORE_SEL)) return;
        if (event.target?.closest?.(SIDEBAR_DETACH_HANDLE_SEL)) return;
        beginDrag(event);
    });

    header.addEventListener('dblclick', (event) => {
        if (!isDetached()) return;
        if (event.target?.closest?.(HEADER_IGNORE_SEL)) return;
        // A double-click that ends a drag must not also reset the geometry.
        if (Date.now() - lastDragEndAt < DBLCLICK_GUARD_MS) return;
        resetDetachedGeometry();
    });
}

/**
 * Capture phase: hamburger's SidePanel.init() binds its toggle handler before
 * initSidebarDetach() runs, so reattaching must happen before that handler
 * collapses the (now docked) panel.
 */
function onDocumentClickCapture(event) {
    if (!isDetached()) return;
    if (!event.target?.closest?.(NAV_TOGGLE_SEL)) return;
    reattachSidebar();
}

function onStorageEvent(event) {
    if (event?.key != null && event.key !== SIDEBAR_DETACHED_KEY) return;
    applyStoredDetachState();
}

function onCustomizationReset() {
    applyStoredDetachState();
}

/**
 * Re-clamp the floating panel after any layout change.
 *
 * Guarded twice, because the observer chain that delivers this event is also
 * driven by the writes we are about to make (`#side-panel` class mutations →
 * toolsManager → tools:desktop_bounds_changed → here):
 *   1. re-entrancy — a synchronous dispatch from inside applyDetachedGeometry
 *      must not recurse;
 *   2. a per-frame budget — even an unforeseen feedback loop can then only
 *      waste a handful of frames, never starve the main thread into a freeze.
 * The write-if-changed geometry apply is the real terminator; these are the
 * belt and braces.
 */
function reclampDetachedPanel() {
    if (interacting || !isDetached()) return;
    if (reclamping) return;
    if (reclampBudget === 0) raf(() => { reclampBudget = 0; });
    reclampBudget += 1;
    if (reclampBudget > RECLAMP_MAX_PER_FRAME) return;
    reclamping = true;
    try {
        applyDetachedGeometry(readDetachedGeometry());
    } finally {
        reclamping = false;
    }
}

export const sidebarDetach = {
    isDetached,
    detach: detachSidebar,
    reattach: reattachSidebar,
    toggle: toggleSidebarDetach,
    applyStoredState: applyStoredDetachState,
    applyGeometry: applyDetachedGeometry,
    resetGeometry: resetDetachedGeometry,
    readGeometry: readDetachedGeometry,
    syncToggle: syncSidebarDetachToggle
};

/** Bound once after initShellResize(): the splitter + stored docked width exist. */
export function initSidebarDetach() {
    if (!getPanel()) return null;
    if (!detachEnabled) {
        // Kill switch: never bind the affordances, and never re-apply a persisted
        // detached state (that path runs synchronously from init() and re-clamps
        // the panel on every bounds broadcast). Dropping the stored flag keeps the
        // next boot clean even after a build with detached mode enabled.
        if (isDetached()) reattachSidebar({ persist: false });
        writeSidebarDetach(false);
        hideDetachAffordances();
        return null;
    }
    bindBrandRow();
    bindResizeHandles();
    bindToggleButton();
    bindSidebarResetSize();

    if (!bound) {
        bound = true;
        document.addEventListener('click', onDocumentClickCapture, true);
        window.addEventListener('storage', onStorageEvent);
        // Layout changes (window resize, cabinet open/shut, dock changes) move
        // the board rect, so the floating panel must follow. Surface scrolling
        // does not — that scrolls content inside a fixed-size box.
        window.addEventListener('resize', reclampDetachedPanel);
        window.addEventListener('tools:desktop_bounds_changed', reclampDetachedPanel);
        window.addEventListener('customization:reset', onCustomizationReset);
    }

    applyStoredDetachState();
    return sidebarDetach;
}
