/** @module {"owns":"flowchart note subsection model — per-note diagram doc, grid/snap prefs, attached labels, connectors", "related":["canvasDocument.js","noteModel.js","api.js","flowchartGeometry.js","flowchartUi.js"]} */
import { routeConnector } from './flowchartGeometry.js';
import { createEmptyDocument, migrateDocument } from './canvasDocument.js';

export const FLOWCHART_VERSION = 1;
export const FLOWCHART_GRID_STEPS = Object.freeze([8, 12, 16, 24, 32, 48]);
export const FLOWCHART_DEFAULT_GRID_SIZE = 24;
export const FLOWCHART_DEFAULT_GRID_TYPE = 'dots';

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

function normalizeGridType(raw) {
    const v = String(raw || '').toLowerCase();
    return ['dots', 'grid', 'graph'].includes(v) ? v : FLOWCHART_DEFAULT_GRID_TYPE;
}

export function normalizeFlowchartGrid(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
        type: normalizeGridType(src.type),
        size: clampGridSize(src.size),
        snap: src.snap !== false,
        visible: src.visible !== false
    };
}

export function snapFlowchartPoint(x, y, grid) {
    if (!grid || grid.snap === false) return { x, y };
    const size = clampGridSize(grid.size);
    if (!(size > 0)) return { x, y };
    return { x: Math.round(x / size) * size, y: Math.round(y / size) * size };
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

export function createEmptyFlowchart() {
    const doc = createEmptyDocument('infinite');
    const page = doc.pages && doc.pages[0];
    if (page) page.background = FLOWCHART_DEFAULT_GRID_TYPE;
    return {
        version: FLOWCHART_VERSION,
        doc,
        grid: {
            type: FLOWCHART_DEFAULT_GRID_TYPE,
            size: FLOWCHART_DEFAULT_GRID_SIZE,
            snap: true,
            visible: true
        },
        collapsed: false
    };
}

export function normalizeFlowchart(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const doc = raw.doc && typeof raw.doc === 'object'
        ? migrateDocument(raw.doc)
        : createEmptyDocument('infinite');
    doc.canvasMode = 'infinite';
    const grid = normalizeFlowchartGrid(raw.grid);
    const page = (doc.pages || []).find((p) => p.id === doc.activePageId) || doc.pages[0];
    if (page && !page.background) page.background = grid.type;
    return { version: FLOWCHART_VERSION, doc, grid, collapsed: !!raw.collapsed };
}

function isFlowStroke(s) {
    if (!s || typeof s !== 'object') return false;
    if (s.flowchartKind === 'shape' || s.flowchartKind === 'connector') return true;
    if (FLOWCHART_SHAPE_TOOLS.includes(s.tool)) return true;
    return s.tool === FLOWCHART_CONNECTOR_TOOL;
}

export function flowchartHasContent(flowchart) {
    if (!flowchart || typeof flowchart !== 'object') return false;
    const doc = flowchart.doc;
    if (!doc || typeof doc !== 'object') return false;
    const pages = Array.isArray(doc.pages) ? doc.pages : [];
    for (const page of pages) {
        if (!page || typeof page !== 'object') continue;
        if (Array.isArray(page.strokes) && page.strokes.some(isFlowStroke)) return true;
        if (Array.isArray(page.texts) && page.texts.some((t) => String(t.text || '').trim())) return true;
    }
    const inf = doc.infinite;
    if (inf && typeof inf === 'object') {
        if ((inf.strokes || []).length) return true;
        if ((inf.texts || []).length) return true;
    }
    return false;
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


