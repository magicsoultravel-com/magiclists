const STORAGE_KEY = 'matrix_tile_small_footprint';

export const TILE_SMALL_FOOTPRINTS = ['label', 'card', 'wide'];
export const DEFAULT_TILE_SMALL_FOOTPRINT = 'card';

export const SMALL_FOOTPRINT_RECTS = {
    label: { w: 96, h: 28 },
    card: { w: 96, h: 56 },
    wide: { w: 128, h: 96 }
};

export function normalizeTileSmallFootprint(value) {
    if (value === 'label' || value === 'card' || value === 'wide') return value;
    return DEFAULT_TILE_SMALL_FOOTPRINT;
}

export function readTileSmallFootprint() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return normalizeTileSmallFootprint(raw);
    } catch {
        /* ignore */
    }
    return DEFAULT_TILE_SMALL_FOOTPRINT;
}

export function writeTileSmallFootprint(footprint) {
    const next = normalizeTileSmallFootprint(footprint);
    try {
        localStorage.setItem(STORAGE_KEY, next);
    } catch {
        /* ignore */
    }
    return next;
}

export function isTileSmallFootprintCustomized(footprint = readTileSmallFootprint()) {
    return footprint !== DEFAULT_TILE_SMALL_FOOTPRINT;
}

export function applyTileSmallFootprint(footprint = readTileSmallFootprint()) {
    const next = normalizeTileSmallFootprint(footprint);
    document.documentElement.dataset.tileSmallFootprint = next;
    const rect = SMALL_FOOTPRINT_RECTS[next];
    const root = document.documentElement.style;
    root.setProperty('--tile-small-w', `${rect.w}px`);
    root.setProperty('--tile-small-h', `${rect.h}px`);
    return next;
}

export function getSmallFootprintRect(footprint = readTileSmallFootprint()) {
    return { ...SMALL_FOOTPRINT_RECTS[normalizeTileSmallFootprint(footprint)] };
}
