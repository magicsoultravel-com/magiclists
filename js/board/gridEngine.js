/**
 * Grid Board Engine
 * Handles spatial layout calculations, packing algorithms, and size resolution.
 */

export const GridEngine = {
    /**
     * Merges a spatial layout entry, clamping dimensions and handling remembered sizes.
     */
    mergeSpatialLayoutEntry(prev, rect, tileSize = LEGACY_TILE_SIZE, {
        updateRemembered = false,
        rememberedW = null,
        rememberedH = null
    } = {}) {
        const clamped = geoClampSpatialSize(rect.w, rect.h, tileSize);
        const entry = {
            w: Math.round(clamped.w),
            h: Math.round(clamped.h)
        };
        if (Number.isFinite(rect.x)) entry.x = Math.round(rect.x);
        if (Number.isFinite(rect.y)) entry.y = Math.round(rect.y);

        let rw = rememberedW;
        let rh = rememberedH;
        if (updateRemembered && !isCollapsedSpatialSize(entry.w, entry.h, tileSize)) {
            rw = entry.w;
            rh = entry.h;
        }
        if (!Number.isFinite(rw) || !Number.isFinite(rh)) {
            rw = prev?.rememberedW;
            rh = prev?.rememberedH;
        }
        if (Number.isFinite(rw) && Number.isFinite(rh) && !isCollapsedSpatialSize(rw, rh, tileSize)) {
            const mem = geoClampSpatialSize(rw, rh, tileSize);
            entry.rememberedW = Math.round(mem.w);
            entry.rememberedH = Math.round(mem.h);
        }
        if (isCollapsedSpatialSize(entry.w, entry.h, tileSize)) {
            const small = getSmallRect(readTileSmallFootprint());
            entry.w = small.w;
            entry.h = small.h;
        }
        return entry;
    },

    /**
     * Resolves the correct rectangle for a card based on the resolution mode.
     */
    resolveCardRect(card, item, { mode } = {}) {
        const pos = card ? this.readNoteRect(card) : { x: 0, y: 0, w: 0, h: 0 };
        const saved = this.getSavedLayoutRect(card, item);
        if (mode === 'small' || mode === 'label') {
            const small = getSmallRect(readTileSmallFootprint());
            return { x: pos.x, y: pos.y, w: small.w, h: small.h };
        }
        if (mode === 'editor' && saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
            return { x: pos.x, y: pos.y, w: saved.w, h: saved.h };
        }
        if (mode === 'remembered' || mode === 'toggleTarget' || mode === 'saved') {
            const size = mode === 'saved' && saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)
                ? geoClampSpatialSize(saved.w, saved.h, resolveTileSize(item))
                : this.resolveRememberedSpatialSize(saved, item);
            return { x: pos.x, y: pos.y, w: size.w, h: size.h };
        }
        if (saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
            const size = geoClampSpatialSize(saved.w, saved.h, resolveTileSize(item));
            return { x: pos.x, y: pos.y, w: size.w, h: size.h };
        }
        const fallback = geoResolveSpatialFallbackRect(resolveTileSize(item));
        return { x: pos.x, y: pos.y, w: fallback.w, h: fallback.h };
    },

    /**
     * Checks if a size exceeds a single grid cell.
     */
    isGridMultiCellSize(w, h) {
        const { cellW } = getGridMetrics();
        return w > cellW + 2 || h > cellW + 2;
    },

    /**
     * Checks if a saved layout is expanded.
     */
    isSavedLayoutExpanded(itemId, footprint = readTileSmallFootprint()) {
        const saved = this.getGridLayout()[itemId];
        if (!saved || !Number.isFinite(saved.w) || !Number.isFinite(saved.h)) return false;
        const item = this.resolveBoardItem(itemId);
        return !isCollapsedSpatialSize(saved.w, saved.h, resolveTileSize(item), footprint);
    }
};
</write_to_file>