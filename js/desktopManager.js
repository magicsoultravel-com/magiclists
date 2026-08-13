/** @module {"owns":"multi-desktop state management, desktop assignment, persistence"} */

const STORAGE_KEY = 'magicnotes_desktops_config';
const DEFAULT_DESKTOP_COUNT = 3;
const MIN_DESKTOP_COUNT = 1;
const MAX_DESKTOP_COUNT = 9;
const DEFAULT_ACTIVE_DESKTOP = 1;

/** Default dock icon colors for desktops 1–9 (legacy letter palette + two extras). */
export const DEFAULT_DESKTOP_COLORS = [
    '#ff4d4d',
    '#4dff4d',
    '#4d4dff',
    '#ffff4d',
    '#ff4dff',
    '#ff804d',
    '#4dffff',
    '#4dffb8',
    '#b84dff'
];

// Internal state
let _desktopCount = DEFAULT_DESKTOP_COUNT;
let _activeDesktop = DEFAULT_ACTIVE_DESKTOP;
let _changeListeners = [];
let _isDockPinned = false;
let _pinListeners = [];
let _desktopColors = [...DEFAULT_DESKTOP_COLORS];

function clampDesktopCount(n) {
    return Math.min(MAX_DESKTOP_COUNT, Math.max(MIN_DESKTOP_COUNT, n));
}

function normalizeHexColor(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const v = value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
    if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`;
    return fallback;
}

function normalizeColors(raw) {
    const next = [...DEFAULT_DESKTOP_COLORS];
    if (!Array.isArray(raw)) return next;
    for (let i = 0; i < MAX_DESKTOP_COUNT; i++) {
        next[i] = normalizeHexColor(raw[i], DEFAULT_DESKTOP_COLORS[i]);
    }
    return next;
}

// Load persisted state from localStorage
function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            _desktopCount = clampDesktopCount(parsed.desktopCount || DEFAULT_DESKTOP_COUNT);
            _activeDesktop = Math.min(
                Math.max(MIN_DESKTOP_COUNT, parsed.activeDesktop || DEFAULT_ACTIVE_DESKTOP),
                _desktopCount
            );
            _isDockPinned = parsed.dockPinned === true;
            _desktopColors = normalizeColors(parsed.colors);
        }
    } catch {
        // Ignore parse errors, use defaults
        _desktopCount = DEFAULT_DESKTOP_COUNT;
        _activeDesktop = DEFAULT_ACTIVE_DESKTOP;
        _isDockPinned = false;
        _desktopColors = [...DEFAULT_DESKTOP_COLORS];
    }
}

// Persist current state to localStorage
function persistState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            desktopCount: _desktopCount,
            activeDesktop: _activeDesktop,
            dockPinned: _isDockPinned,
            colors: _desktopColors
        }));
    } catch {
        // Ignore quota errors
    }
}

// Load state on module initialization
loadState();

// Notify listeners of desktop change
function notifyDesktopChange() {
    _changeListeners.forEach(callback => {
        try {
            callback(_activeDesktop);
        } catch (err) {
            console.error('[DesktopManager] Listener error:', err);
        }
    });
}

// Notify listeners of dock pin change
function notifyPinChange() {
    _pinListeners.forEach(callback => {
        try {
            callback(_isDockPinned);
        } catch (err) {
            console.error('[DesktopManager] Pin listener error:', err);
        }
    });
}

function isOutOfRangeDesktopId(desktopId) {
    const n = Number(desktopId);
    return !Number.isInteger(n) || n < MIN_DESKTOP_COUNT || n > _desktopCount;
}

export const DesktopManager = {
    // Get current active desktop ID (1-based)
    getActiveDesktop() {
        return _activeDesktop;
    },

    // Set active desktop (validates range, persists, notifies)
    setActiveDesktop(id) {
        const numId = Number(id);
        if (!Number.isInteger(numId) || numId < MIN_DESKTOP_COUNT || numId > _desktopCount) {
            console.warn(`[DesktopManager] Invalid desktop ID: ${id}`);
            return false;
        }
        if (_activeDesktop === numId) return true; // No change

        _activeDesktop = numId;
        persistState();
        notifyDesktopChange();
        return true;
    },

    // Get total number of desktops
    getDesktopCount() {
        return _desktopCount;
    },

    /**
     * Set desktop count (validates range, clamps active desktop, migrates orphaned notes).
     * @returns {{ ok: boolean, migratedIds?: string[], activeClamped?: boolean, fromCount?: number, toCount?: number }}
     */
    setDesktopCount(count, items = []) {
        const numCount = Number(count);
        if (!Number.isInteger(numCount) || numCount < MIN_DESKTOP_COUNT || numCount > MAX_DESKTOP_COUNT) {
            console.warn(`[DesktopManager] Invalid desktop count: ${count}`);
            return { ok: false };
        }
        if (_desktopCount === numCount) return { ok: true, migratedIds: [] };

        const oldCount = _desktopCount;
        const prevActive = _activeDesktop;
        _desktopCount = numCount;

        // Clamp active desktop if it exceeds new count
        if (_activeDesktop > _desktopCount) {
            _activeDesktop = _desktopCount;
        }
        const activeClamped = prevActive !== _activeDesktop;

        const migratedIds = [];
        // Migrate orphaned notes (notes on desktops that no longer exist) to desktop 1
        if (oldCount > numCount && Array.isArray(items)) {
            items.forEach(item => {
                if (!item?.id) return;
                const id = Number(item.desktopId);
                if (Number.isInteger(id) && id > numCount) {
                    item.desktopId = 1;
                    migratedIds.push(item.id);
                }
            });

            if (migratedIds.length > 0) {
                window.dispatchEvent(new CustomEvent('desktop:notes_migrated', {
                    detail: {
                        fromCount: oldCount,
                        toCount: numCount,
                        migratedCount: migratedIds.length,
                        migratedIds
                    }
                }));
            }
        }

        persistState();
        notifyDesktopChange();
        window.dispatchEvent(new CustomEvent('desktop:count_changed'));

        // Board must re-render when active desktop was clamped or notes moved,
        // otherwise orphaned cards stay visible as ghosts.
        if (activeClamped || migratedIds.length > 0) {
            window.dispatchEvent(new CustomEvent('desktop:changed', {
                detail: { desktopId: _activeDesktop, reason: 'count_changed' }
            }));
        }

        return {
            ok: true,
            migratedIds,
            activeClamped,
            fromCount: oldCount,
            toCount: numCount
        };
    },

    /**
     * Sequential toggle for prefs UI: enabled desktops are always 1..N.
     * - Only the last enabled slot (count) may be turned off — middle slots stay solid
     * - Click next available slot (count+1) → grow to that count
     * - Desktop 1 is always on; slots beyond count+1 are locked
     */
    toggleDesktopSlot(slot, items = []) {
        const k = Number(slot);
        if (!Number.isInteger(k) || k < MIN_DESKTOP_COUNT || k > MAX_DESKTOP_COUNT) {
            return { ok: false };
        }
        if (k === 1) {
            return { ok: true, migratedIds: [], locked: true };
        }
        // Middle enabled slots are solid — turn off only from the end
        if (k < _desktopCount) {
            return { ok: false, locked: true };
        }
        if (k === _desktopCount) {
            return this.setDesktopCount(k - 1, items);
        }
        if (k === _desktopCount + 1) {
            return this.setDesktopCount(k, items);
        }
        return { ok: false, locked: true };
    },

    /** Notes assigned to desktops above `desktopId` (exclusive of that id's floor). */
    countNotesOnDesktopsAbove(desktopId, items = []) {
        const floor = Number(desktopId) || 0;
        if (!Array.isArray(items)) return 0;
        return items.filter((item) => (item?.desktopId || 1) > floor).length;
    },

    /** Notes currently on a specific desktop. */
    countNotesOnDesktop(desktopId, items = []) {
        return this.getAllNotesForDesktop(desktopId, items).length;
    },

    getDesktopColor(desktopId) {
        const n = Number(desktopId);
        if (!Number.isInteger(n) || n < 1 || n > MAX_DESKTOP_COUNT) {
            return DEFAULT_DESKTOP_COLORS[0];
        }
        return _desktopColors[n - 1] || DEFAULT_DESKTOP_COLORS[n - 1];
    },

    getDesktopColors() {
        return _desktopColors.slice();
    },

    setDesktopColor(desktopId, color) {
        const n = Number(desktopId);
        if (!Number.isInteger(n) || n < 1 || n > MAX_DESKTOP_COUNT) return false;
        const hex = normalizeHexColor(color, null);
        if (!hex) return false;
        if (_desktopColors[n - 1] === hex) return true;
        _desktopColors[n - 1] = hex;
        persistState();
        window.dispatchEvent(new CustomEvent('desktop:colors_changed', {
            detail: { desktopId: n, color: hex }
        }));
        return true;
    },

    /**
     * Reset to default desktop count (3) and standard R/G/B… icon colors.
     * Migrates orphaned notes when shrinking.
     */
    resetDesktopsToDefaults(items = []) {
        _desktopColors = [...DEFAULT_DESKTOP_COLORS];
        persistState();
        const result = this.setDesktopCount(DEFAULT_DESKTOP_COUNT, items);
        window.dispatchEvent(new CustomEvent('desktop:colors_changed', {
            detail: { reset: true }
        }));
        // When count was already default, setDesktopCount is a no-op — still refresh dock.
        if (result?.ok && result.toCount === undefined) {
            window.dispatchEvent(new CustomEvent('desktop:count_changed'));
        }
        return result;
    },

    // Assign a note to a specific desktop, emitting mutation event
    // Returns true if successful, false otherwise
    // No Undo/Redo tracking — desktop moves are saved immediately
    async assignNoteToDesktop(item, desktopId) {
        const numDesktopId = Number(desktopId);
        if (!Number.isInteger(numDesktopId) || numDesktopId < MIN_DESKTOP_COUNT || numDesktopId > _desktopCount) {
            console.warn(`[DesktopManager] Invalid assignment desktop ID: ${desktopId}`);
            return false;
        }
        if (!item || !item.id) return false;

        const currentDesktop = item.desktopId || 1;
        if (currentDesktop === numDesktopId) return true; // Already on this desktop

        item.desktopId = numDesktopId;

        // Emit mutation event with skipUndo flag — desktop moves saved immediately
        window.dispatchEvent(new CustomEvent('item:mutation_requested', {
            detail: {
                item,
                desktopId: numDesktopId,
                preserveView: true,
                skipUndo: true
            }
        }));

        return true;
    },

    // Sanitize note object - ensure desktopId is a valid in-range id (default 1)
    // Safe for use with undo/redo snapshots
    sanitizeNoteDesktop(item) {
        if (!item) return item;
        if (item.desktopId === undefined || item.desktopId === null || isOutOfRangeDesktopId(item.desktopId)) {
            return { ...item, desktopId: 1 };
        }
        return item;
    },

    // Sanitize an array of notes (returns new array; does not mutate in place)
    sanitizeNotesDesktops(items) {
        if (!Array.isArray(items)) return items;
        return items.map(item => this.sanitizeNoteDesktop(item));
    },

    // Get all notes belonging to a specific desktop
    getAllNotesForDesktop(desktopId, items) {
        if (!Array.isArray(items)) return [];
        const numDesktopId = Number(desktopId) || 1;
        return items.filter(item => (item.desktopId || 1) === numDesktopId);
    },

    // Check if a note is visible on current desktop
    isNoteVisibleOnActiveDesktop(item) {
        if (!item) return false;
        return (item.desktopId || 1) === _activeDesktop;
    },

    // Subscribe to desktop change events
    onDesktopChange(callback) {
        if (typeof callback === 'function') {
            _changeListeners.push(callback);
        }
    },

    // Unsubscribe from desktop change events
    offDesktopChange(callback) {
        _changeListeners = _changeListeners.filter(cb => cb !== callback);
    },

    // Check if the desktop dock drawer is pinned open
    isDockPinned() {
        return _isDockPinned;
    },

    // Set the dock pin state (persists to localStorage, notifies listeners)
    setDockPinned(pinned) {
        const next = !!pinned;
        if (_isDockPinned === next) return _isDockPinned;
        _isDockPinned = next;
        persistState();
        notifyPinChange();
        return _isDockPinned;
    },

    // Toggle the dock pin state
    toggleDockPinned() {
        return this.setDockPinned(!_isDockPinned);
    },

    // Subscribe to dock pin change events
    onDockPinChange(callback) {
        if (typeof callback === 'function') {
            _pinListeners.push(callback);
        }
    },

    // Unsubscribe from dock pin change events
    offDockPinChange(callback) {
        _pinListeners = _pinListeners.filter(cb => cb !== callback);
    }
};

// Initialize - ensure defaults are loaded
export function initDesktopManager() {
    loadState();
}

// Export constants for external use
export {
    DEFAULT_DESKTOP_COUNT,
    MIN_DESKTOP_COUNT,
    MAX_DESKTOP_COUNT,
    DEFAULT_ACTIVE_DESKTOP
};
