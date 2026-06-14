import { getScaledFootprintRects } from './gridDensity.js';

export const DEFAULT_TILE_SMALL_FOOTPRINT = 'label';

export function readTileSmallFootprint() {
    return DEFAULT_TILE_SMALL_FOOTPRINT;
}

export function applyTileSmallFootprint() {
    document.documentElement.dataset.tileSmallFootprint = DEFAULT_TILE_SMALL_FOOTPRINT;
    const rect = getScaledFootprintRects().label;
    const root = document.documentElement.style;
    root.setProperty('--tile-small-w', `${rect.w}px`);
    root.setProperty('--tile-small-h', `${rect.h}px`);
    return DEFAULT_TILE_SMALL_FOOTPRINT;
}

export function getSmallFootprintRect(footprint = DEFAULT_TILE_SMALL_FOOTPRINT) {
    const rects = getScaledFootprintRects();
    if (footprint === 'card') return { ...rects.card };
    if (footprint === 'wide') return { ...rects.wide };
    return { ...rects.label };
}
