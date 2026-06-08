export const VIEW_MODES = ['freeform', 'columns', 'grid'];

const SESSIONS_KEY = 'matrix_view_sessions';
const LEGACY_EXPANDED_KEY = 'matrix_expanded_cards';
const COLLAPSED_CATEGORIES_KEY = 'matrix_collapsed_categories';
const GRID_EXPANDED_KEY = 'matrix_grid_expanded_id';

function emptyBucket(mode) {
    const base = {
        expandedCards: {},
        scroll: null
    };
    if (mode === 'columns') {
        base.collapsedCategories = [];
    }
    if (mode === 'grid') {
        base.gridExpandedId = null;
    }
    return base;
}

function normalizeMode(mode) {
    return VIEW_MODES.includes(mode) ? mode : 'columns';
}

export function readViewSessions() {
    try {
        const raw = localStorage.getItem(SESSIONS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.version === 1) {
                const store = { version: 1 };
                VIEW_MODES.forEach((mode) => {
                    store[mode] = {
                        ...emptyBucket(mode),
                        ...(parsed[mode] || {})
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

    let legacyCollapsed = [];
    try {
        legacyCollapsed = JSON.parse(localStorage.getItem(COLLAPSED_CATEGORIES_KEY) || '[]');
    } catch {
        legacyCollapsed = [];
    }

    let legacyGridExpanded = null;
    try {
        legacyGridExpanded = localStorage.getItem(GRID_EXPANDED_KEY);
    } catch {
        legacyGridExpanded = null;
    }

    const store = { version: 1 };
    VIEW_MODES.forEach((mode) => {
        const bucket = emptyBucket(mode);
        bucket.expandedCards = { ...legacyExpanded };
        if (mode === 'columns') bucket.collapsedCategories = [...legacyCollapsed];
        if (mode === 'grid') bucket.gridExpandedId = legacyGridExpanded || null;
        store[mode] = bucket;
    });

    writeViewSessions(store);
    return store;
}

export function writeViewSessions(store) {
    try {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(store));
    } catch {
        /* ignore */
    }
}

export function getExpandedCards(mode) {
    const m = normalizeMode(mode);
    return { ...readViewSessions()[m]?.expandedCards };
}

export function setExpandedCard(mode, itemId, expanded) {
    if (!itemId) return;
    const m = normalizeMode(mode);
    const store = readViewSessions();
    const bucket = store[m] || emptyBucket(m);
    if (expanded) bucket.expandedCards[itemId] = true;
    else delete bucket.expandedCards[itemId];
    store[m] = bucket;
    writeViewSessions(store);
    syncWorkingExpandedCards(m, bucket.expandedCards);
}

export function setExpandedCardsMap(mode, map) {
    const m = normalizeMode(mode);
    const store = readViewSessions();
    const bucket = store[m] || emptyBucket(m);
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
    const m = normalizeMode(mode);
    return readViewSessions()[m]?.expandedCards?.[itemId] === true;
}

function syncWorkingExpandedCards(mode, map) {
    try {
        localStorage.setItem(LEGACY_EXPANDED_KEY, JSON.stringify(map || {}));
    } catch {
        /* ignore */
    }
}

function syncWorkingCollapsedCategories(list) {
    try {
        localStorage.setItem(COLLAPSED_CATEGORIES_KEY, JSON.stringify(list || []));
    } catch {
        /* ignore */
    }
}

function syncWorkingGridExpandedId(id) {
    try {
        if (id) localStorage.setItem(GRID_EXPANDED_KEY, id);
        else localStorage.removeItem(GRID_EXPANDED_KEY);
    } catch {
        /* ignore */
    }
}

export function persistViewSession(mode, { canvas, flushLayout, captureScroll } = {}) {
    const m = normalizeMode(mode);
    const store = readViewSessions();
    const bucket = store[m] || emptyBucket(m);

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

    if (m === 'columns') {
        try {
            bucket.collapsedCategories = JSON.parse(localStorage.getItem(COLLAPSED_CATEGORIES_KEY) || '[]');
        } catch {
            bucket.collapsedCategories = [];
        }
    }

    if (m === 'grid') {
        bucket.gridExpandedId = localStorage.getItem(GRID_EXPANDED_KEY) || null;
    }

    store[m] = bucket;
    writeViewSessions(store);
}

export function restoreViewSession(mode) {
    const m = normalizeMode(mode);
    const store = readViewSessions();
    const bucket = store[m] || emptyBucket(m);

    syncWorkingExpandedCards(m, bucket.expandedCards || {});

    if (m === 'columns') {
        syncWorkingCollapsedCategories(bucket.collapsedCategories || []);
    }

    if (m === 'grid') {
        syncWorkingGridExpandedId(bucket.gridExpandedId || null);
    }

    return bucket.scroll || null;
}

export function getViewSessionsForSnapshot() {
    const store = readViewSessions();
    return {
        version: 1,
        freeform: store.freeform,
        columns: store.columns,
        grid: store.grid
    };
}

export function applyViewSessionsFromSnapshot(viewSessions) {
    if (!viewSessions || viewSessions.version !== 1) return false;
    const store = { version: 1 };
    VIEW_MODES.forEach((mode) => {
        store[mode] = {
            ...emptyBucket(mode),
            ...(viewSessions[mode] || {})
        };
    });
    writeViewSessions(store);
    return true;
}

export function clearViewSessionExpanded(mode) {
    clearExpandedCards(mode);
}

export function setGridExpandedIdForMode(mode, itemId) {
    const m = normalizeMode(mode);
    if (m !== 'grid') return;
    const store = readViewSessions();
    const bucket = store[m] || emptyBucket(m);
    bucket.gridExpandedId = itemId || null;
    store[m] = bucket;
    writeViewSessions(store);
    syncWorkingGridExpandedId(itemId || null);
}
