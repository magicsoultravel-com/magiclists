/** @module {"owns":"multi-desktop state management, desktop assignment, persistence"} */

const STORAGE_KEY = 'magicnotes_desktops_config';
const DEFAULT_DESKTOP_COUNT = 3;
const MAX_DESKTOP_COUNT = 7;
const DEFAULT_ACTIVE_DESKTOP = 1;

// Internal state
let _desktopCount = DEFAULT_DESKTOP_COUNT;
let _activeDesktop = DEFAULT_ACTIVE_DESKTOP;
let _changeListeners = [];
let _isDockPinned = false;
let _pinListeners = [];

// Load persisted state from localStorage
function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            _desktopCount = Math.min(
                Math.max(1, parsed.desktopCount || DEFAULT_DESKTOP_COUNT),
                MAX_DESKTOP_COUNT
            );
            _activeDesktop = Math.min(
                Math.max(1, parsed.activeDesktop || DEFAULT_ACTIVE_DESKTOP),
                _desktopCount
            );
            _isDockPinned = parsed.dockPinned === true;
        }
    } catch {
        // Ignore parse errors, use defaults
        _desktopCount = DEFAULT_DESKTOP_COUNT;
        _activeDesktop = DEFAULT_ACTIVE_DESKTOP;
        _isDockPinned = false;
    }
}

// Persist current state to localStorage
function persistState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            desktopCount: _desktopCount,
            activeDesktop: _activeDesktop,
            dockPinned: _isDockPinned
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

export const DesktopManager = {
    // Get current active desktop ID (1-based)
    getActiveDesktop() {
        return _activeDesktop;
    },

    // Set active desktop (validates range, persists, notifies)
    setActiveDesktop(id) {
        const numId = Number(id);
        if (!Number.isInteger(numId) || numId < 1 || numId > _desktopCount) {
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

// Set desktop count (validates range, clamps active desktop, migrates orphaned notes)
    setDesktopCount(count, items = []) {
        const numCount = Number(count);
        if (!Number.isInteger(numCount) || numCount < 1 || numCount > MAX_DESKTOP_COUNT) {
            console.warn(`[DesktopManager] Invalid desktop count: ${count}`);
            return false;
        }
        if (_desktopCount === numCount) return true; // No change
        
        const oldCount = _desktopCount;
        _desktopCount = numCount;
        
        // Clamp active desktop if it exceeds new count
        if (_activeDesktop > _desktopCount) {
            _activeDesktop = _desktopCount;
        }
        
        // Migrate orphaned notes (notes on desktops that no longer exist) to desktop 1
        if (oldCount > numCount && Array.isArray(items)) {
            const migratedCount = items.filter(item => 
                item?.desktopId && item.desktopId > numCount
            ).length;
            
            if (migratedCount > 0) {
                // Mutate orphaned notes to desktop 1
                items.forEach(item => {
                    if (item?.desktopId && item.desktopId > numCount) {
                        item.desktopId = 1;
                    }
                });
                
                // Notify about the migration
                window.dispatchEvent(new CustomEvent('desktop:notes_migrated', {
                    detail: { 
                        fromCount: oldCount, 
                        toCount: numCount, 
                        migratedCount 
                    }
                }));
            }
        }
        
        persistState();
        notifyDesktopChange();
        // Notify about count change for UI refresh
        window.dispatchEvent(new CustomEvent('desktop:count_changed'));
        return true;
    },

    // Assign a note to a specific desktop, emitting mutation event
    // Returns true if successful, false otherwise
    // No Undo/Redo tracking — desktop moves are saved immediately
    async assignNoteToDesktop(item, desktopId) {
        const numDesktopId = Number(desktopId);
        if (!Number.isInteger(numDesktopId) || numDesktopId < 1 || numDesktopId > _desktopCount) {
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

    // Sanitize note object - ensure desktopId defaults to 1 if undefined

    // Safe for use with undo/redo snapshots
    sanitizeNoteDesktop(item) {
        if (!item) return item;
        if (item.desktopId === undefined || item.desktopId === null) {
            return { ...item, desktopId: 1 };
        }
        return item;
    },

    // Sanitize an array of notes
    sanitizeNotesDesktops(items) {
        if (!Array.isArray(items)) return items;
        return items.map(item => this.sanitizeNoteDesktop(item));
    },

    // Get all notes belonging to a specific desktop
    // Helper for Phase 2 integration
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
export { DEFAULT_DESKTOP_COUNT, MAX_DESKTOP_COUNT, DEFAULT_ACTIVE_DESKTOP };
