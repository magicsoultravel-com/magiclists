/** @module {"owns":"magicCanvas brush style, text style, shape fill, tool and canvas grid preferences in localStorage (matrix_drawing_prefs)","related":["drawingBoard.js","drawingBoardCore.js","drawingBoard/text.js","drawingBoard/fill.js","canvasBrushes.js","flowchart.js"]} */
import { BRUSH_STYLES, DRAG_SHAPE_TOOLS } from '../canvasBrushes.js';
import { defaultWidthForStyle } from '../drawingBoardCore.js';
import { normalizeFlowchartGrid, FLOWCHART_ROUTINGS } from '../flowchart.js';

export const PREFS_KEY = 'matrix_drawing_prefs';

/**
 * Text style preference. Sizes are CSS pixels, not canvas units: the editor
 * overlays are laid out in CSS px and the painter multiplies by dpr, so storing
 * the CSS value is the only unit both sides agree on. 40 CSS px matches the
 * old default (a 10px brush painted `width * 4` CSS px of text).
 */
export const TEXT_COLOR_DEFAULT = '#f8fafc';
export const TEXT_SIZE_DEFAULT = 40;
export const TEXT_SIZE_MIN = 8;
export const TEXT_SIZE_MAX = 72;
export const TEXT_SIZE_STEP = 4;

export function normalizeTextSize(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return TEXT_SIZE_DEFAULT;
    return Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, Math.round(n)));
}

export function normalizeTextColor(raw) {
    const c = typeof raw === 'string' ? raw.trim() : '';
    return c || TEXT_COLOR_DEFAULT;
}

/**
 * Shape fill preference: `''` means outline only. Anything that is not a plain
 * 6-digit hex is dropped rather than coerced, so a corrupt payload can never
 * reach `ctx.fillStyle` as garbage.
 */
export function normalizeShapeFill(raw) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : '';
}

/** Normalize the stored text style ({ color, size }) or fall back to defaults. */
export function readTextPrefs(raw) {
    return {
        color: normalizeTextColor(raw?.color),
        size: normalizeTextSize(raw?.size)
    };
}

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
            /** Independent text styling: colour + size (CSS px) for text boxes. */
            text: readTextPrefs(raw?.text),
            /** Shape fill for new shapes: '' = outline only. */
            shapeFill: normalizeShapeFill(raw?.shapeFill),
            /** One-shot hint flag: the snap tip is shown once per browser. */
            snapTipShown: raw?.snapTipShown === true,
            /** One-shot hint flag: the text-tool tip is shown once per browser. */
            textTipShown: raw?.textTipShown === true
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
            text: readTextPrefs(null),
            shapeFill: '',
            snapTipShown: false,
            textTipShown: false
        };
    }
}

export function writePrefs(prefs) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
