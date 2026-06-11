export const VIEW_MODES = ['grid', 'freeform'];
export const DEFAULT_VIEW_MODE = 'grid';

const SESSIONS_KEY = 'matrix_view_sessions';
const LEGACY_EXPANDED_KEY = 'matrix_expanded_cards';

function emptyBucket() {
    return {
        expandedCards: {},
        scroll: null
    };
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
                    store[mode] = {
                        ...emptyBucket(),
                        expandedCards: { ...(legacy.expandedCards || {}) },
                        scroll: legacy.scroll ?? null
                    };
                });
                return store;
            }
        }
    } catch {
        /* ignore */
    }

    let legacyExpanded = {};
    try {
        legacyExpanded = JSON.parse(localStorage.getItem(LEGACY_EXPANDED_KEY) || '{}');
    } catch {
        legacyExpanded = {};
    }

    const store = { version: 2 };
    VIEW_MODES.forEach((mode) => {
        store[mode] = { ...emptyBucket(), expandedCards: { ...legacyExpanded } };
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

export function getExpandedCards(mode) {
    const m = normalizeViewMode(mode);
    return { ...readViewSessions()[m]?.expandedCards };
}

export function setExpandedCard(mode, itemId, expanded) {
    if (!itemId) return;
    const m = normalizeViewMode(mode);
    const store = readViewSessions();
    const bucket = store[m] || emptyBucket();
    if (expanded) bucket.expandedCards[itemId] = true;
    else delete bucket.expandedCards[itemId];
    store[m] = bucket;
    writeViewSessions(store);
    syncWorkingExpandedCards(m, bucket.expandedCards);
}

export function setExpandedCardsMap(mode, map) {
    const m = normalizeViewMode(mode);
    const store = readViewSessions();
    const bucket = store[m] || emptyBucket();
    bucket.expandedCards = { ...(map || {}) };
    store[m] = bucket;
    writeViewSessions(store);
    syncWorkingExpandedCards(m, bucket.expandedCards);
}

export function clearExpandedCards(mode) {
    setExpandedCardsMap(mode, {});
}

export function isCardExpanded(mode, itemId) {
    if (!itemId) return false;
    const m = normalizeViewMode(mode);
    return readViewSessions()[m]?.expandedCards?.[itemId] === true;
}

function syncWorkingExpandedCards(mode, map) {
    try {
        localStorage.setItem(LEGACY_EXPANDED_KEY, JSON.stringify(map || {}));
    } catch {
        /* ignore */
    }
}

export function persistViewSession(mode, { canvas, flushLayout, captureScroll } = {}) {
    const m = normalizeViewMode(mode);
    const store = readViewSessions();
    const bucket = store[m] || emptyBucket();

    if (typeof flushLayout === 'function' && canvas) {
        flushLayout(canvas, m);
    }

    try {
        bucket.expandedCards = JSON.parse(localStorage.getItem(LEGACY_EXPANDED_KEY) || '{}');
    } catch {
        bucket.expandedCards = {};
    }

    if (typeof captureScroll === 'function' && canvas) {
        bucket.scroll = captureScroll(canvas);
    }

    store[m] = bucket;
    writeViewSessions(store);
}

export function restoreViewSession(mode) {
    const m = normalizeViewMode(mode);
    const store = readViewSessions();
    const bucket = store[m] || emptyBucket();
    syncWorkingExpandedCards(m, bucket.expandedCards || {});
    return bucket.scroll || null;
}

export function getViewSessionsForSnapshot() {
    const store = readViewSessions();
    return {
        version: 2,
        grid: store.grid,
        freeform: store.freeform
    };
}

export function applyViewSessionsFromSnapshot(viewSessions) {
    if (!viewSessions) return false;
    const store = { version: 2 };
    if (viewSessions.version === 2) {
        VIEW_MODES.forEach((mode) => {
            store[mode] = { ...emptyBucket(), ...(viewSessions[mode] || {}) };
        });
    } else if (viewSessions.version === 1) {
        VIEW_MODES.forEach((mode) => {
            const legacy = viewSessions[mode] || viewSessions[mode === 'grid' ? 'columns' : mode] || {};
            store[mode] = {
                ...emptyBucket(),
                expandedCards: { ...(legacy.expandedCards || {}) },
                scroll: legacy.scroll ?? null
            };
        });
    } else {
        return false;
    }
    writeViewSessions(store);
    return true;
}

export function clearViewSessionExpanded(mode) {
    clearExpandedCards(mode);
}
