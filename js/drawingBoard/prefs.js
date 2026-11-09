/** @module {"owns":"magicCanvas brush style, tool and canvas grid preferences in localStorage (matrix_drawing_prefs)","related":["drawingBoard.js","drawingBoardCore.js","canvasBrushes.js","flowchart.js"]} */
import { BRUSH_STYLES, DRAG_SHAPE_TOOLS } from '../canvasBrushes.js';
import { defaultWidthForStyle } from '../drawingBoardCore.js';
import { normalizeFlowchartGrid, FLOWCHART_ROUTINGS } from '../flowchart.js';

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
            styles,
            // Canvas grid + connector routing: one pref shared by the visible
            // background, shape snapping and connector snapping.
            grid: normalizeFlowchartGrid(raw?.grid),
            routing: FLOWCHART_ROUTINGS.includes(raw?.routing) ? raw.routing : 'straight',
            /** One-shot hint flag: the snap tip is shown once per browser. */
            snapTipShown: raw?.snapTipShown === true
        };
    } catch {
        const styles = {};
        BRUSH_STYLES.forEach((s) => { styles[s] = { width: defaultWidthForStyle(s), color: '#f8fafc' }; });
        return {
            activeStyle: 'pen',
            activeTool: 'pointer',
            styles,
            grid: normalizeFlowchartGrid(null),
            routing: 'straight',
            snapTipShown: false
        };
    }
}

export function writePrefs(prefs) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
