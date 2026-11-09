/** @module {"owns":"shape and connector model - grid prefs, label sizing, connector routing helpers", "related":["flowchartGeometry.js","drawingBoardFlowchart.js","drawingBoardCore.js"]} */
import { routeConnector } from './flowchartGeometry.js';

export const FLOWCHART_GRID_STEPS = Object.freeze([8, 12, 16, 24, 32, 48]);
export const FLOWCHART_DEFAULT_GRID_SIZE = 24;

/**
 * Tools whose strokes are connector targets: every drag shape can be attached
 * to and typed inside. The connector tool itself is the exception.
 */
export const FLOWCHART_SHAPE_TOOLS = Object.freeze([
    'rect',
    'rounded_rect',
    'diamond',
    'ellipse',
    'parallelogram',
    'triangle'
]);

export const FLOWCHART_CONNECTOR_TOOL = 'connector';
export const FLOWCHART_ROUTINGS = Object.freeze(['straight', 'elbow']);

export const FLOW_LABEL_DEFAULT = 20;
export const FLOW_LABEL_MIN = 12;
export const FLOW_LABEL_MAX = 72;
export const FLOW_LABEL_STEP = 2;

function clampGridSize(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return FLOWCHART_DEFAULT_GRID_SIZE;
    let best = FLOWCHART_GRID_STEPS[0];
    let bestDist = Math.abs(n - best);
    for (const step of FLOWCHART_GRID_STEPS) {
        const d = Math.abs(n - step);
        if (d < bestDist) { best = step; bestDist = d; }
    }
    return best;
}

/**
 * Normalize the canvas grid preference. Snap is opt-in: a fresh profile draws
 * freehand-smooth shapes until the user turns snap on in the toolbar.
 * @param {object} raw
 */
export function normalizeFlowchartGrid(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
        size: clampGridSize(src.size),
        snap: src.snap === true
    };
}

export function normalizeFlowchartLabel(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = String(raw.text ?? '').slice(0, 2000);
    if (!text.trim()) return null;
    const fs = Math.round(Number(raw.fontSize) || FLOW_LABEL_DEFAULT);
    return {
        text,
        fontSize: Math.min(FLOW_LABEL_MAX, Math.max(FLOW_LABEL_MIN, fs)),
        color: String(raw.color || '')
    };
}

export function normalizeFlowLabelSize(raw) {
    const n = Math.round(Number(raw) || FLOW_LABEL_DEFAULT);
    const snapped = Math.round(n / FLOW_LABEL_STEP) * FLOW_LABEL_STEP;
    return Math.min(FLOW_LABEL_MAX, Math.max(FLOW_LABEL_MIN, snapped));
}

/**
 * Font size (canvas units) that fits a label inside a box `boxH` units tall.
 * Never returns below FLOW_LABEL_MIN: a very small shape keeps 12px text and the
 * label clips inside the box rather than shrinking to unreadable 6px text, and a
 * stored size never drops under the floor.
 * @param {number} boxH box height in canvas units
 * @returns {number}
 */
export function fitFlowLabelFontSize(boxH) {
    const h = Number(boxH);
    if (!Number.isFinite(h) || h <= 0) return FLOW_LABEL_DEFAULT;
    const fitted = Math.round(h * 0.32);
    return Math.min(FLOW_LABEL_MAX, Math.max(FLOW_LABEL_MIN, fitted));
}

export function createFlowchartShape(opts) {
    const o = opts || {};
    const t = FLOWCHART_SHAPE_TOOLS.includes(o.tool) ? o.tool : 'rect';
    return {
        id: o.id || ('flow_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
        tool: t, flowchartKind: 'shape',
        x0: o.x0 || 0, y0: o.y0 || 0, x1: o.x1 || 0, y1: o.y1 || 0,
        color: o.color || '#f8fafc', width: o.width || 3, style: o.style || 'pen',
        label: null
    };
}

export function createFlowchartConnector(opts) {
    const o = opts || {};
    const r = FLOWCHART_ROUTINGS.includes(o.routing) ? o.routing : 'straight';
    const x0 = o.x0 || 0, y0 = o.y0 || 0, x1 = o.x1 || 0, y1 = o.y1 || 0;
    const conn = {
        id: o.id || ('flow_conn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
        tool: FLOWCHART_CONNECTOR_TOOL, flowchartKind: 'connector', routing: r,
        from: o.from && typeof o.from === 'object' ? { shapeId: o.from.shapeId || null, port: o.from.port || 'c' } : null,
        to: o.to && typeof o.to === 'object' ? { shapeId: o.to.shapeId || null, port: o.to.port || 'c' } : null,
        x0, y0, x1, y1,
        color: o.color || '#f8fafc', width: o.width || 3, style: o.style || 'pen',
        label: null
    };
    // Route through the shared router so midX/midY always match what the painter
    // and the hit tester expect; a naive midpoint desyncs both.
    return routeFlowchartConnector(conn);
}

/**
 * Recompute a connector's cached bend point with the shared router.
 * Mutates and returns the same object so it can be used inline.
 * @param {object} conn
 * @returns {object}
 */
export function routeFlowchartConnector(conn) {
    if (!conn || conn.flowchartKind !== 'connector') return conn;
    const routed = routeConnector(
        { x: conn.x0, y: conn.y0, port: conn.from?.port || 'c' },
        { x: conn.x1, y: conn.y1, port: conn.to?.port || 'c' },
        conn.routing
    );
    conn.midX = routed.midX;
    conn.midY = routed.midY;
    return conn;
}
