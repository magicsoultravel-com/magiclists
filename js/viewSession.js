export const VIEW_MODES = ['grid'];
export const DEFAULT_VIEW_MODE = 'grid';

const SESSIONS_KEY = 'matrix_view_sessions';

function emptyBucket() {
    return {};
}

function stripScrollFromBucket(bucket) {
    if (!bucket || typeof bucket !== 'object') return emptyBucket();
    const next = { ...bucket };
    delete next.scroll;
    delete next.gridExpandedId;
    delete next.collapsedCategories;
    delete next.expandedCards;
    return next;
}

export function normalizeViewMode(mode) {
    if (mode === 'columns' || mode === 'list' || mode === 'freeform') return 'grid';
    return VIEW_MODES.includes(mode) ? mode : DEFAULT_VIEW_MODE;
}

export function readViewSessions() {
    try {
        const raw = localStorage.getItem(SESSIONS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.version === 1 || parsed?.version === 2 || parsed?.version === 3) {
                const legacyGrid = parsed.grid || parsed.columns || {};
                const legacyFreeform = parsed.freeform || {};
                const store = {
                    version: 3,
                    grid: stripScrollFromBucket({ ...legacyFreeform, ...legacyGrid })
                };
                writeViewSessions(store);
                return store;
            }
        }
    } catch {
        /* ignore */
    }

    const store = { version: 3, grid: emptyBucket() };
    writeViewSessions(store);
    return store;
}

export function writeViewSessions(store) {
    try {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify({ ...store, version: 3 }));
    } catch {
        /* ignore */
    }
}

export function persistViewSession(mode, { canvas, flushLayout } = {}) {
    const m = normalizeViewMode(mode);
    const store = readViewSessions();
    const bucket = stripScrollFromBucket(store[m] || emptyBucket());

    if (typeof flushLayout === 'function' && canvas) {
        flushLayout(canvas, m);
    }

    store[m] = bucket;
    writeViewSessions(store);
}

export function restoreViewSession(_mode) {
    /* layout persistence handled via layoutStorage flush on persistViewSession */
}

export function getViewSessionsForSnapshot() {
    const store = readViewSessions();
    return {
        version: 3,
        grid: stripScrollFromBucket(store.grid)
    };
}

export function applyViewSessionsFromSnapshot(viewSessions) {
    if (!viewSessions) return false;
    const store = { version: 3 };
    if (viewSessions.version === 3) {
        store.grid = stripScrollFromBucket(viewSessions.grid);
    } else if (viewSessions.version === 2 || viewSessions.version === 1) {
        const legacyGrid = viewSessions.grid || viewSessions.columns || {};
        const legacyFreeform = viewSessions.freeform || {};
        store.grid = stripScrollFromBucket({ ...legacyFreeform, ...legacyGrid });
    } else {
        return false;
    }
    writeViewSessions(store);
    return true;
}
