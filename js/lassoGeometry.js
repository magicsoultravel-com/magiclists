/** @module {"owns":"lasso geometry utilities - ray casting, bounding boxes", "related":["drawingBoard.js"]} */

/**
 * Ray-casting algorithm to determine if a point is inside a polygon.
 * Casts a ray from the point to the right and counts edge intersections.
 * Odd count = inside, even = outside.
 * 
 * @param {Object} point - {x, y} coordinates
 * @param {Array} polygon - Array of {x, y} points forming the polygon
 * @returns {boolean} true if point is inside polygon
 */
export function isPointInPolygon(point, polygon) {
    if (!polygon || polygon.length < 3) return false;
    if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return false;

    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x;
        const yi = polygon[i].y;
        const xj = polygon[j].x;
        const yj = polygon[j].y;

        // Check if point is on the vertex
        if (xi === point.x && yi === point.y) return true;

        // Edge must straddle the horizontal line at point.y for ray casting.
        if ((yi > point.y) === (yj > point.y)) continue;

        // Compute the x coordinate where the edge crosses the horizontal line at point.y.
        const intersectX = xj + (point.y - yj) * (xi - xj) / (yi - yj);

        // Point lies exactly on the edge
        if (Math.abs(intersectX - point.x) < 0.001) return true;

        // Cast a ray to the right; each crossing toggles inside/outside.
        if (intersectX > point.x) {
            inside = !inside;
        }
    }

    return inside;
}

/**
 * Axis-aligned rect intersection (inclusive edges).
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} a
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} b
 */
export function rectsIntersect(a, b) {
    if (!a || !b) return false;
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Build a normalized AABB from two corners.
 */
export function rectFromPoints(x0, y0, x1, y1) {
    return {
        minX: Math.min(x0, x1),
        minY: Math.min(y0, y1),
        maxX: Math.max(x0, x1),
        maxY: Math.max(y0, y1)
    };
}

/**
 * Robust hit-test for rectangular marquee selection.
 * Brush points are inflated by stroke width/2; shapes/text/images use AABB overlap.
 *
 * @param {Object} item
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} rect
 * @returns {boolean}
 */
export function itemIntersectsRect(item, rect) {
    if (!item || !rect) return false;

    if (Array.isArray(item.points)) {
        const pad = Math.max(0, (item.width || 0) / 2);
        for (const point of item.points) {
            if (
                point.x >= rect.minX - pad && point.x <= rect.maxX + pad
                && point.y >= rect.minY - pad && point.y <= rect.maxY + pad
            ) {
                return true;
            }
        }
        return false;
    }

    if (item.tool === 'text') {
        return rectsIntersect(getTextBounds(item), rect);
    }

    if (item.tool === 'image' || (item.mediaId && item.width != null && item.height != null)) {
        return rectsIntersect(getImageBounds(item), rect);
    }

    if (item.x0 != null && item.y0 != null && item.x1 != null && item.y1 != null) {
        return rectsIntersect(getShapeBounds(item), rect);
    }

    return false;
}

/**
 * Check if a drawing item (brush stroke, shape, or text) has any part inside the polygon.
 * Brush strokes use "at least one point" threshold; shapes use bounding-box overlap;
 * text objects use a simple glyph bounds box.
 *
 * @param {Object} item - Stroke/shape/text object
 * @param {Array} polygon - Array of {x, y} points forming the polygon
 * @returns {boolean} true if the item intersects the polygon
 */
export function strokeHasPointInPolygon(item, polygon) {
    if (!item || !polygon || polygon.length < 3) return false;

    // Rectangular polygons: use robust AABB path (marquee select).
    if (polygon.length === 4) {
        const bounds = getPolygonBounds(polygon);
        const isAxisAligned = polygon.every((p) =>
            (Math.abs(p.x - bounds.minX) < 0.001 || Math.abs(p.x - bounds.maxX) < 0.001)
            && (Math.abs(p.y - bounds.minY) < 0.001 || Math.abs(p.y - bounds.maxY) < 0.001)
        );
        if (isAxisAligned) {
            return itemIntersectsRect(item, {
                minX: bounds.minX,
                minY: bounds.minY,
                maxX: bounds.maxX,
                maxY: bounds.maxY
            });
        }
    }

    // Brush stroke
    if (Array.isArray(item.points)) {
        return item.points.some((point) => isPointInPolygon(point, polygon));
    }

    // Text object
    if (item.tool === 'text') {
        const bounds = getTextBounds(item);
        return rectIntersectsPolygon(bounds, polygon);
    }

    // Image placement
    if (item.tool === 'image' || (item.mediaId && item.width != null && item.height != null)) {
        const bounds = getImageBounds(item);
        return rectIntersectsPolygon(bounds, polygon);
    }

    // Shape stroke
    if (item.x0 != null && item.y0 != null && item.x1 != null && item.y1 != null) {
        const bounds = getShapeBounds(item);
        return rectIntersectsPolygon(bounds, polygon);
    }

    return false;
}

function rectIntersectsPolygon(rect, polygon) {
    if (!rect || !polygon || polygon.length < 3) return false;
    // Prefer AABB intersection when the polygon is an axis-aligned rectangle.
    if (polygon.length === 4) {
        const polyBounds = getPolygonBounds(polygon);
        return rectsIntersect(rect, {
            minX: polyBounds.minX,
            minY: polyBounds.minY,
            maxX: polyBounds.maxX,
            maxY: polyBounds.maxY
        });
    }
    const corners = [
        { x: rect.minX, y: rect.minY },
        { x: rect.maxX, y: rect.minY },
        { x: rect.maxX, y: rect.maxY },
        { x: rect.minX, y: rect.maxY }
    ];
    if (corners.some(p => isPointInPolygon(p, polygon))) return true;
    if (polygon.some(p => p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY)) return true;
    return false;
}

function getShapeBounds(item) {
    return {
        minX: Math.min(item.x0, item.x1),
        minY: Math.min(item.y0, item.y1),
        maxX: Math.max(item.x0, item.x1),
        maxY: Math.max(item.y0, item.y1)
    };
}

function getTextBounds(item) {
    // Approximate text box: use a stored width/height when available, else a
    // heuristic based on font size. Matches the hit area used in drawingBoard.js.
    const fontSize = item.fontSize || 16;
    const width = item.width || Math.max(200, (item.text || '').length * fontSize * 0.6);
    const height = item.height || Math.max(60, fontSize * 1.4);
    return {
        minX: item.x,
        minY: item.y,
        maxX: item.x + width,
        maxY: item.y + height
    };
}

function getImageBounds(item) {
    const width = Math.max(1, item.width || 1);
    const height = Math.max(1, item.height || 1);
    return {
        minX: item.x ?? 0,
        minY: item.y ?? 0,
        maxX: (item.x ?? 0) + width,
        maxY: (item.y ?? 0) + height
    };
}

export { getImageBounds };

/**
 * Calculate the bounding box of a polygon.
 * 
 * @param {Array} polygon - Array of {x, y} points
 * @returns {Object} {minX, minY, maxX, maxY, width, height}
 */
export function getPolygonBounds(polygon) {
    if (!polygon || polygon.length === 0) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }
    
    let minX = polygon[0].x;
    let minY = polygon[0].y;
    let maxX = polygon[0].x;
    let maxY = polygon[0].y;
    
    for (let i = 1; i < polygon.length; i++) {
        const p = polygon[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    
    return {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX,
        height: maxY - minY
    };
}

/**
 * Calculate the bounding box that encompasses all selected drawing items
 * (brush strokes, shapes, and text objects).
 *
 * @param {Array} items - Array of stroke/shape/text objects
 * @returns {Object} {minX, minY, maxX, maxY, width, height}
 */
export function getStrokesBounds(items) {
    if (!items || items.length === 0) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const item of items) {
        if (!item) continue;
        if (Array.isArray(item.points)) {
            for (const point of item.points) {
                if (point.x < minX) minX = point.x;
                if (point.x > maxX) maxX = point.x;
                if (point.y < minY) minY = point.y;
                if (point.y > maxY) maxY = point.y;
            }
        } else if (item.tool === 'text') {
            const bounds = getTextBounds(item);
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
        } else if (item.tool === 'image' || (item.mediaId && item.width != null && item.height != null)) {
            const bounds = getImageBounds(item);
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
        } else if (item.x0 != null && item.y0 != null && item.x1 != null && item.y1 != null) {
            const bounds = getShapeBounds(item);
            minX = Math.min(minX, bounds.minX);
            minY = Math.min(minY, bounds.minY);
            maxX = Math.max(maxX, bounds.maxX);
            maxY = Math.max(maxY, bounds.maxY);
        }
    }

    // Handle empty case
    if (minX === Infinity) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }

    return {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX,
        height: maxY - minY
    };
}

/**
 * Clamp a value to a range.
 * 
 * @param {number} value - The value to clamp
 * @param {number} min - Minimum bound
 * @param {number} max - Maximum bound
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Clamp drawing item coordinates to page boundaries.
 * Used for A4/A5 fixed page modes.
 *
 * @param {Array} items - Array of stroke/shape/text objects
 * @param {Object} pageBounds - {minX, minY, maxX, maxY} page boundaries
 */
export function clampStrokesToBounds(items, pageBounds) {
    if (!items || !pageBounds) return;

    const { minX, minY, maxX, maxY } = pageBounds;

    for (const item of items) {
        if (!item) continue;
        if (Array.isArray(item.points)) {
            for (const point of item.points) {
                point.x = clamp(point.x, minX, maxX);
                point.y = clamp(point.y, minY, maxY);
            }
        } else if (item.tool === 'text') {
            const bounds = getTextBounds(item);
            const width = bounds.maxX - bounds.minX;
            const height = bounds.maxY - bounds.minY;
            item.x = clamp(item.x, minX, maxX - width);
            item.y = clamp(item.y, minY, maxY - height);
        } else if (item.tool === 'image' || (item.mediaId && item.width != null && item.height != null)) {
            const width = Math.max(1, item.width || 1);
            const height = Math.max(1, item.height || 1);
            item.x = clamp(item.x ?? 0, minX, maxX - width);
            item.y = clamp(item.y ?? 0, minY, maxY - height);
        } else if (item.x0 != null && item.y0 != null && item.x1 != null && item.y1 != null) {
            item.x0 = clamp(item.x0, minX, maxX);
            item.y0 = clamp(item.y0, minY, maxY);
            item.x1 = clamp(item.x1, minX, maxX);
            item.y1 = clamp(item.y1, minY, maxY);
        }
    }
}

/**
 * Translate all drawing items by a delta.
 *
 * @param {Array} items - Array of stroke/shape/text objects
 * @param {number} dx - X translation
 * @param {number} dy - Y translation
 */
export function translateStrokes(items, dx, dy) {
    if (!items) return;

    for (const item of items) {
        if (!item) continue;
        if (Array.isArray(item.points)) {
            for (const point of item.points) {
                point.x += dx;
                point.y += dy;
            }
        } else if (item.tool === 'text' || item.tool === 'image' || (item.mediaId && item.width != null)) {
            item.x = (item.x ?? 0) + dx;
            item.y = (item.y ?? 0) + dy;
        } else if (item.x0 != null && item.y0 != null && item.x1 != null && item.y1 != null) {
            item.x0 += dx;
            item.y0 += dy;
            item.x1 += dx;
            item.y1 += dy;
        }
    }
}

/**
 * Convert a rectangle to a 4-point polygon.
 * 
 * @param {number} x0 - Start X
 * @param {number} y0 - Start Y
 * @param {number} x1 - End X
 * @param {number} y1 - End Y
 * @returns {Array} Array of 4 {x, y} points forming a rectangle
 */
export function rectToPolygon(x0, y0, x1, y1) {
    return [
        { x: Math.min(x0, x1), y: Math.min(y0, y1) },
        { x: Math.max(x0, x1), y: Math.min(y0, y1) },
        { x: Math.max(x0, x1), y: Math.max(y0, y1) },
        { x: Math.min(x0, x1), y: Math.max(y0, y1) }
    ];
}

/** CSS-pixel threshold below which a drag is treated as a click. */
export const BOX_SELECT_CLICK_THRESHOLD = 6;

/**
 * Convert a screen-space click threshold into world/bitmap units.
 * @param {number} [screenPx=BOX_SELECT_CLICK_THRESHOLD]
 * @param {number} [scale=1] viewport scale
 * @param {number} [dpr=1] device pixel ratio
 * @returns {number}
 */
export function boxSelectThresholdWorld(screenPx = BOX_SELECT_CLICK_THRESHOLD, scale = 1, dpr = 1) {
    const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    return (screenPx * d) / s;
}

/**
 * Build a selection polygon from two pointer points.
 * Tiny boxes become a click hit-area centered on the start point.
 *
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} [threshold=BOX_SELECT_CLICK_THRESHOLD] world/bitmap threshold
 * @returns {{ kind: 'click'|'drag', polygon: Array<{x:number,y:number}>, width: number, height: number, rect: {minX:number,minY:number,maxX:number,maxY:number} }}
 */
export function resolveBoxSelection(x0, y0, x1, y1, threshold = BOX_SELECT_CLICK_THRESHOLD) {
    const width = Math.abs(x1 - x0);
    const height = Math.abs(y1 - y0);
    if (width < threshold && height < threshold) {
        const half = threshold / 2;
        const polygon = rectToPolygon(x0 - half, y0 - half, x0 + half, y0 + half);
        return {
            kind: 'click',
            width,
            height,
            polygon,
            rect: rectFromPoints(x0 - half, y0 - half, x0 + half, y0 + half)
        };
    }
    const polygon = rectToPolygon(x0, y0, x1, y1);
    return {
        kind: 'drag',
        width,
        height,
        polygon,
        rect: rectFromPoints(x0, y0, x1, y1)
    };
}

/**
 * Get page boundaries for clamping.
 * For infinite canvas, returns a large bounding area.
 * For fixed page modes (A4/A5), returns the page dimensions.
 * 
 * @param {Object} doc - The document object
 * @param {Object} pageDimensions - {width, height} from getPageDimensions
 * @returns {Object} {minX, minY, maxX, maxY}
 */
export function getPageBounds(doc, pageDimensions) {
    if (!doc || !pageDimensions) {
        return { minX: 0, minY: 0, maxX: 3000, maxY: 3000 };
    }
    
    if (doc.canvasMode === 'infinite') {
        const bounds = doc.infinite?.bounds || { minX: 0, minY: 0, maxX: 3000, maxY: 3000 };
        return {
            minX: bounds.minX,
            minY: bounds.minY,
            maxX: bounds.maxX,
            maxY: bounds.maxY
        };
    }
    
    // Fixed page mode (A4, A5, A3)
    // Position strokes within the page boundaries
    return {
        minX: 0,
        minY: 0,
        maxX: pageDimensions.width,
        maxY: pageDimensions.height
    };
}

/* ==========================================================================
   CLICK HIT-TESTING + PER-LAYER Z-ORDER
   The board paints images, then strokes, then texts (last painted = on top).
   These helpers let a click resolve the visually topmost object and raise it
   to the top of its own layer.
   ========================================================================== */

/**
 * Point-in-rect test with an optional tolerance radius.
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} rect
 * @param {number} x
 * @param {number} y
 * @param {number} [radius=0]
 * @returns {boolean}
 */
function rectContainsPoint(rect, x, y, radius = 0) {
    if (!rect) return false;
    return x >= rect.minX - radius && x <= rect.maxX + radius
        && y >= rect.minY - radius && y <= rect.maxY + radius;
}

/**
 * Hit-test a single canvas item (image, brush stroke, shape or text).
 * Mirrors the tolerance rules used by the board's eraser/selection so a click
 * and a marquee agree on what is "under" the pointer.
 *
 * @param {Object} item - stroke/shape/text/image object
 * @param {number} x
 * @param {number} y
 * @param {number} [radius=0] extra world-space tolerance
 * @returns {boolean}
 */
export function itemContainsPoint(item, x, y, radius = 0) {
    if (!item) return false;

    if (item.tool === 'image' || (item.mediaId && item.width != null && item.height != null)) {
        return rectContainsPoint(getImageBounds(item), x, y, radius);
    }

    if (Array.isArray(item.points) && item.points.length) {
        const pad = radius + (item.width || 0) / 2;
        return item.points.some((pt) => pt && Math.hypot(pt.x - x, pt.y - y) <= pad);
    }

    if (item.tool === 'text') {
        return rectContainsPoint(getTextBounds(item), x, y, radius);
    }

    if (item.x0 != null && item.y0 != null && item.x1 != null && item.y1 != null) {
        return rectContainsPoint(getShapeBounds(item), x, y, radius);
    }

    return false;
}

/**
 * Topmost item at a point, in paint order: texts over strokes over images, and
 * within a layer the last entry (painted last) wins.
 *
 * @param {number} x
 * @param {number} y
 * @param {{ strokes?: Array, texts?: Array, images?: Array }} [layers]
 * @param {number} [radius=0]
 * @returns {Object|null}
 */
export function findTopmostItemAt(x, y, layers = {}, radius = 0) {
    const groups = [
        Array.isArray(layers.texts) ? layers.texts : [],
        Array.isArray(layers.strokes) ? layers.strokes : [],
        Array.isArray(layers.images) ? layers.images : []
    ];

    for (const group of groups) {
        for (let i = group.length - 1; i >= 0; i -= 1) {
            if (itemContainsPoint(group[i], x, y, radius)) return group[i];
        }
    }
    return null;
}

/**
 * Move an item to the top of its own layer (last painted).
 * Returns the layer key plus a NEW array — the source array is never mutated,
 * so callers can snapshot undo history before assigning.
 *
 * @param {Object} item
 * @param {{ strokes?: Array, texts?: Array, images?: Array }} [layers]
 * @returns {{ kind: 'images'|'strokes'|'texts', items: Array }|null} null when
 *   the item is missing or already last in its layer.
 */
export function raiseItemInLayer(item, layers = {}) {
    if (!item) return null;

    const groups = [
        ['images', layers.images],
        ['strokes', layers.strokes],
        ['texts', layers.texts]
    ];

    for (const [kind, list] of groups) {
        if (!Array.isArray(list)) continue;
        const index = list.indexOf(item);
        if (index < 0) continue;
        if (index === list.length - 1) return null;
        const items = list.filter((entry) => entry !== item);
        items.push(item);
        return { kind, items };
    }

    return null;
}
