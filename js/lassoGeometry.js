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

    // Brush stroke
    if (Array.isArray(item.points)) {
        return item.points.some(point => isPointInPolygon(point, polygon));
    }

    // Text object
    if (item.tool === 'text') {
        const bounds = getTextBounds(item);
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
    // A rectangle intersects a polygon if any corner is inside the polygon,
    // or any polygon vertex is inside the rectangle, or any edges cross.
    const corners = [
        { x: rect.minX, y: rect.minY },
        { x: rect.maxX, y: rect.minY },
        { x: rect.maxX, y: rect.maxY },
        { x: rect.minX, y: rect.maxY }
    ];
    if (corners.some(p => isPointInPolygon(p, polygon))) return true;
    if (polygon.some(p => p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY)) return true;
    // Edge intersection check is overkill for selection; corner/vertex test is enough in practice.
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
        } else if (item.x0 != null && item.y0 != null && item.x1 != null && item.y1 != null) {
            item.x0 = clamp(item.x0, minX, maxX);
            item.y0 = clamp(item.y0, minY, maxY);
            item.x1 = clamp(item.x1, minX, maxX);
            item.y1 = clamp(item.y1, minY, maxY);
        }
    }
}

/**
 * Calculate the centroid of a polygon.
 * 
 * @param {Array} polygon - Array of {x, y} points
 * @returns {Object} {x, y} centroid coordinates
 */
export function getPolygonCentroid(polygon) {
    if (!polygon || polygon.length === 0) {
        return { x: 0, y: 0 };
    }
    
    let sumX = 0;
    let sumY = 0;
    
    for (const point of polygon) {
        sumX += point.x;
        sumY += point.y;
    }
    
    const count = polygon.length;
    return {
        x: sumX / count,
        y: sumY / count
    };
}

/**
 * Translate all points in a polygon by a delta.
 * 
 * @param {Array} polygon - Array of {x, y} points
 * @param {number} dx - X translation
 * @param {number} dy - Y translation
 */
export function translatePolygon(polygon, dx, dy) {
    if (!polygon) return;
    
    for (const point of polygon) {
        point.x += dx;
        point.y += dy;
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
        } else if (item.tool === 'text') {
            item.x += dx;
            item.y += dy;
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
