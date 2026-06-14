import { getScaledFootprintRects } from './gridDensity.js';

/** Grid-aligned minimum tile — one row tall (2×cellS × cellS), not the shorter title strip. */
export const DEFAULT_TILE_SMALL_FOOTPRINT = 'card';

export function readTileSmallFootprint() {
    return DEFAULT_TILE_SMALL_FOOTPRINT;
}

export function applyTileSmallFootprint() {
    document.documentElement.dataset.tileSmallFootprint = DEFAULT_TILE_SMALL_FOOTPRINT;
    const rect = getScaledFootprintRects().card;
    const root = document.documentElement.style;
    root.setProperty('--tile-small-w', `${rect.w}px`);
    root.setProperty('--tile-small-h', `${rect.h}px`);
    return DEFAULT_TILE_SMALL_FOOTPRINT;
}

export function getSmallFootprintRect(footprint = DEFAULT_TILE_SMALL_FOOTPRINT) {
    const rects = getScaledFootprintRects();
    if (footprint === 'label') return { ...rects.label };
    if (footprint === 'wide') return { ...rects.wide };
    return { ...rects.card };
}
