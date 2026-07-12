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
        
        // Check if point is on the edge
        const edgeMinY = Math.min(yi, yj);
        const edgeMaxY = Math.max(yi, yj);
        const edgeMinX = Math.min(xi, xj);
        const edgeMaxX = Math.max(xi, xj);
        
        // Point outside edge bounding box
        if (point.x < edgeMinX || point.x > edgeMaxX || point.y < edgeMinY || point.y > edgeMaxY) {
            continue;
        }
        
        // Skip vertical edges (no intersection with horizontal ray)
        if (xi === xj) continue;
        
        // Calculate intersection point
        const intersectY = yi + (point.x - xi) * (yj - yi) / (xj - xi);
        
        // Point is on the edge
        if (Math.abs(intersectY - point.y) < 0.001) return true;
        
        // Ray crosses edge
        if (intersectY > point.y) {
            inside = !inside;
        }
    }
    
    return inside;
}

/**
 * Check if a stroke (with points array) has any points inside the polygon.
 * Uses "at least one point" threshold for selection.
 * 
 * @param {Object} stroke - Stroke object with points: [{x, y}, ...]
 * @param {Array} polygon - Array of {x, y} points forming the polygon
 * @returns {boolean} true if at least one point is inside
 */
export function strokeHasPointInPolygon(stroke, polygon) {
    if (!stroke || !stroke.points || !Array.isArray(stroke.points)) return false;
    if (!polygon || polygon.length < 3) return false;
    
    return stroke.points.some(point => isPointInPolygon(point, polygon));
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
 * Calculate the bounding box that encompasses all selected strokes.
 * 
 * @param {Array} strokes - Array of stroke objects with points
 * @returns {Object} {minX, minY, maxX, maxY, width, height}
 */
export function getStrokesBounds(strokes) {
    if (!strokes || strokes.length === 0) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }
    
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    for (const stroke of strokes) {
        if (!stroke.points) continue;
        for (const point of stroke.points) {
            if (point.x < minX) minX = point.x;
            if (point.x > maxX) maxX = point.x;
            if (point.y < minY) minY = point.y;
            if (point.y > maxY) maxY = point.y;
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
 * Clamp stroke coordinates to page boundaries.
 * Used for A4/A5 fixed page modes.
 * 
 * @param {Array} strokes - Array of stroke objects
 * @param {Object} pageBounds - {minX, minY, maxX, maxY} page boundaries
 */
export function clampStrokesToBounds(strokes, pageBounds) {
    if (!strokes || !pageBounds) return;
    
    const { minX, minY, maxX, maxY } = pageBounds;
    
    for (const stroke of strokes) {
        if (!stroke.points) continue;
        for (const point of stroke.points) {
            point.x = clamp(point.x, minX, maxX);
            point.y = clamp(point.y, minY, maxY);
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
 * Translate all points in strokes by a delta.
 * 
 * @param {Array} strokes - Array of stroke objects
 * @param {number} dx - X translation
 * @param {number} dy - Y translation
 */
export function translateStrokes(strokes, dx, dy) {
    if (!strokes) return;
    
    for (const stroke of strokes) {
        if (!stroke.points) continue;
        for (const point of stroke.points) {
            point.x += dx;
            point.y += dy;
        }
    }
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
