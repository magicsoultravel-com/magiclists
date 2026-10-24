/** @module {"owns":"magicCanvas shared board constants (brush widths, menu items)", "related":["drawingBoard.js","drawingBoardToolbar.js","canvasBrushes.js"]} */
import { DRAG_SHAPE_TOOLS } from './canvasBrushes.js';

export const WIDTH_MIN = 1;
export const WIDTH_MAX = 48;
export const DEFAULT_WIDTH = 10;
export const HIGHLIGHTER_WIDTH = 14;
export const HISTORY_MAX = 50;
export const SAVE_DEBOUNCE_MS = 400;
export const RESIZE_HANDLE_SIZE = 10;
export const RESIZE_HANDLE_HIT = 14;

/** Minimum world-space distance between recorded stroke points, by brush style. */
export const POINT_SPACING = {
    pen: 1.5,
    marker: 1.5,
    highlighter: 2,
    pencil: 3.5,
    spray: 4,
    calligraphy: 2,
    brush: 2.5
};

/** Minimum distance used when simplifying a finished stroke (drop near-collinear points). */
export const THIN_MIN_DIST = 2;
export const THIN_COLLINEAR_EPS = 0.35;

export const POINTER_ITEMS = [
    { id: 'pen', label: 'Pen' },
    { id: 'marker', label: 'Marker' },
    { id: 'highlighter', label: 'Highlighter' },
    { id: 'pencil', label: 'Pencil' },
    { id: 'spray', label: 'Spray' },
    { id: 'calligraphy', label: 'Broad nib' },
    { id: 'brush', label: 'Ink brush' }
];

export const SHAPE_ITEMS = [
    { id: 'line', label: 'Line' },
    { id: 'arrow', label: 'Arrow' },
    { id: 'rect', label: 'Rectangle' },
    { id: 'rounded_rect', label: 'Rounded rectangle' },
    { id: 'ellipse', label: 'Ellipse' },
    { id: 'triangle', label: 'Triangle' },
    { id: 'diamond', label: 'Diamond' },
    { id: 'star', label: 'Star' },
    { id: 'chevron', label: 'Chevron' },
    { id: 'trapezoid', label: 'Trapezoid' },
    { id: 'parallelogram', label: 'Parallelogram' },
    { id: 'cube', label: 'Cube' },
    { id: 'pyramid', label: 'Pyramid' },
    { id: 'cylinder', label: 'Cylinder' },
    { id: 'sphere', label: 'Sphere' },
    { id: 'text', label: 'Text' }
];

export const GRID_BACKGROUNDS = [
    { id: 'grid', label: 'Grid' },
    { id: 'dots', label: 'Dot grid' },
    { id: 'graph', label: 'Graph paper' },
    { id: 'coarse', label: 'Coarse grid' },
    { id: 'isometric', label: 'Isometric' },
    { id: 'hex', label: 'Hex grid' }
];

export const WRITING_BACKGROUNDS = [
    { id: 'ruled', label: 'Ruled' },
    { id: 'notebook', label: 'Notebook' },
    { id: 'staff', label: 'Staff' },
    { id: 'football', label: 'Football' }
];

export function isDragShape(tool) {
    return DRAG_SHAPE_TOOLS.includes(tool);
}

export const FORMAT_ITEMS = [
    { id: 'a2', label: 'A2 page' },
    { id: 'a3', label: 'A3 page' },
    { id: 'a4', label: 'A4 page' },
    { id: 'a5', label: 'A5 page' },
    { id: 'a6', label: 'A6 page' },
    { id: 'infinite', label: 'Infinite canvas' }
];

export function defaultWidthForStyle(style) {
    return style === 'highlighter' ? HIGHLIGHTER_WIDTH : DEFAULT_WIDTH;
}

export function pointSpacingForStyle(style) {
    return POINT_SPACING[style] ?? 2;
}
