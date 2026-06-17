export const VIEW_MODES = ['grid', 'freeform'];
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
    if (mode === 'columns' || mode === 'list') return 'grid';
    return VIEW_MODES.includes(mode) ? mode : DEFAULT_VIEW_MODE;
}

export function readViewSessions() {
    try {
        const raw = localStorage.getItem(SESSIONS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.version === 1 || parsed?.version === 2) {
                const store = { version: 2 };
                VIEW_MODES.forEach((mode) => {
                    const legacy = parsed[mode] || parsed[mode === 'grid' ? 'columns' : mode] || {};
                    store[mode] = stripScrollFromBucket(legacy);
                });
                return store;
            }
        }
    } catch {
        /* ignore */
    }

    const store = { version: 2 };
    VIEW_MODES.forEach((mode) => {
        store[mode] = emptyBucket();
    });

    writeViewSessions(store);
    return store;
}

export function writeViewSessions(store) {
    try {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify({ ...store, version: 2 }));
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
        version: 2,
        grid: stripScrollFromBucket(store.grid),
        freeform: stripScrollFromBucket(store.freeform)
    };
}

export function applyViewSessionsFromSnapshot(viewSessions) {
    if (!viewSessions) return false;
    const store = { version: 2 };
    if (viewSessions.version === 2) {
        VIEW_MODES.forEach((mode) => {
            store[mode] = stripScrollFromBucket(viewSessions[mode]);
        });
    } else if (viewSessions.version === 1) {
        VIEW_MODES.forEach((mode) => {
            const legacy = viewSessions[mode] || viewSessions[mode === 'grid' ? 'columns' : mode] || {};
            store[mode] = stripScrollFromBucket(legacy);
        });
    } else {
        return false;
    }
    writeViewSessions(store);
    return true;
}
