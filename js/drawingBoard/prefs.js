/** @module {"owns":"magicCanvas brush style and tool preferences in localStorage (matrix_drawing_prefs)","related":["drawingBoard.js","drawingBoardCore.js","canvasBrushes.js"]} */
import { BRUSH_STYLES, DRAG_SHAPE_TOOLS } from '../canvasBrushes.js';
import { defaultWidthForStyle } from '../drawingBoardCore.js';

export const PREFS_KEY = 'matrix_drawing_prefs';

export function readPrefs() {
    try {
        const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        const styles = {};
        BRUSH_STYLES.forEach((s) => {
            styles[s] = {
                width: Number.isFinite(raw?.styles?.[s]?.width) ? raw.styles[s].width : defaultWidthForStyle(s),
                color: raw?.styles?.[s]?.color || '#f8fafc'
            };
        });
        return {
            activeStyle: BRUSH_STYLES.includes(raw?.activeStyle) ? raw.activeStyle : 'pen',
            activeTool: ['pointer', 'brush', 'eraser', 'pan', 'text', 'crop', ...DRAG_SHAPE_TOOLS].includes(raw?.activeTool) ? raw.activeTool : 'pointer',
            styles
        };
    } catch {
        const styles = {};
        BRUSH_STYLES.forEach((s) => { styles[s] = { width: defaultWidthForStyle(s), color: '#f8fafc' }; });
        return { activeStyle: 'pen', activeTool: 'pointer', styles };
    }
}

export function writePrefs(prefs) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
