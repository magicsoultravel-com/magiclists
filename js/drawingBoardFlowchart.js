/** @module {"owns":"magicCanvas shapes and connectors - port magnet, routing, bend and endpoint drags, inline labels", "related":["drawingBoard.js","flowchart.js","flowchartGeometry.js","canvasBrushes.js"]} */
import {
    FLOWCHART_CONNECTOR_TOOL, FLOWCHART_DEFAULT_GRID_SIZE,
    FLOW_LABEL_DEFAULT, normalizeFlowLabelSize, fitFlowLabelFontSize,
    createFlowchartConnector, routeFlowchartConnector
} from './flowchart.js';
import {
    shapeBounds, nearestPort, portPointFor, snapEndpointToShapes, routeConnector,
    rerouteAttachedConnectors
} from './flowchartGeometry.js';
import { CanvasViewport } from './canvasViewport.js';
import { showAppToast } from './toast.js';
import { createId } from './canvasDocument.js';
import { isDragShape } from './drawingBoardCore.js';
import { writePrefs } from './drawingBoard/prefs.js';
import { textStyle } from './drawingBoard/text.js';

/**
 * Canvas grid preference. Shapes, connectors and the visible background all read
 * this one object, so the +/- stepper changes snapping and the grid together.
 */
export function canvasGrid(board) {
    const g = board.prefs?.grid;
    const size = Number(g?.size);
    return {
        size: Number.isFinite(size) && size > 0 ? size : FLOWCHART_DEFAULT_GRID_SIZE,
        snap: g?.snap === true
    };
}

/** Persist a grid patch into the shared drawing prefs. */
export function persistCanvasGrid(board, patch) {
    if (!board.prefs) return;
    board.prefs.grid = { ...canvasGrid(board), ...(patch || {}) };
    writePrefs(board.prefs);
    board.redrawBackground?.();
}

/** Persist the connector routing style ('straight' | 'elbow'). */
export function persistCanvasRouting(board, routing) {
    if (!board.prefs) return;
    board.prefs.routing = routing === 'elbow' ? 'elbow' : 'straight';
    writePrefs(board.prefs);
}

/** True when the given tool draws a shape that accepts connectors and text. */
export function isFlowShape(board, tool) {
    return isDragShape(tool) && tool !== FLOWCHART_CONNECTOR_TOOL;
}

/** True when the given tool drags a connector. */
export function isFlowConnector(board, tool) {
    return tool === FLOWCHART_CONNECTOR_TOOL;
}

/**
 * Shape strokes on the active layer (connector endpoints magnet to these).
 * Memoized on the strokes array identity: both the pointermove magnet and the
 * port overlay call this several times per frame, and a fresh filter on every
 * call allocates over every freehand stroke on the page.
 */
export function flowchartShapes(board) {
    const all = board.strokes();
    const cache = board.flowShapesCache;
    if (cache && cache.source === all) return cache.list;
    const list = all.filter((s) => s && s.flowchartKind === 'shape');
    board.flowShapesCache = { source: all, list };
    return list;
}

export function flowchartShapesById(board) {
    const map = new Map();
    for (const s of board.flowchartShapes()) {
        if (s.id != null) map.set(s.id, s);
    }
    return map;
}

/** World-space port magnet radius (constant on screen regardless of zoom). */
export function flowchartMagnetRadius(board) {
    const scale = CanvasViewport.scale || 1;
    return 18 / Math.max(0.1, scale);
}

/**
 * Snap a world point to the grid unless Shift is held or snap is off.
 * @param {number} x
 * @param {number} y
 * @param {boolean} bypass Shift-key override
 */
export function flowSnapPoint(board, x, y, bypass = false) {
    const grid = canvasGrid(board);
    if (bypass || !grid.snap) return { x, y };
    const size = grid.size > 0 ? grid.size : FLOWCHART_DEFAULT_GRID_SIZE;
    return { x: Math.round(x / size) * size, y: Math.round(y / size) * size };
}

/** Resolve a free connector end to a port when it lands inside the magnet. */
export function flowResolveEndpoint(board, x, y, excludeShapeId) {
    const shapes = board.flowchartShapes().filter((s) => s.id !== excludeShapeId);
    return snapEndpointToShapes(x, y, shapes, board.flowchartMagnetRadius());
}

/** Recompute cached endpoints for every connector attached to the moved shapes. */
export function flowReroute(board, movedShapeIds) {
    const byId = board.flowchartShapesById();
    const connectors = board.strokes().filter((s) => s && s.flowchartKind === 'connector');
    const moved = new Set(movedShapeIds || []);
    const changed = rerouteAttachedConnectors(connectors, byId);
    // Ports on moved shapes must follow the shape, otherwise an elbow loses
    // its H/V orientation and collapses to the centre port.
    if (moved.size) {
        for (const c of connectors) {
            if (!c.from || !c.to) continue;
            const a = byId.get(c.from.shapeId);
            const b = byId.get(c.to.shapeId);
            if (a && moved.has(a.id)) c.from.port = nearestPort(a, c.x0, c.y0).port;
            if (b && moved.has(b.id)) c.to.port = nearestPort(b, c.x1, c.y1).port;
        }
        rerouteAttachedConnectors(connectors, byId);
        return true;
    }
    return changed > 0;
}

/** Topmost shape/connector under the pointer. */
export function flowHit(board, x, y) {
    const tol = 10 / Math.max(0.1, CanvasViewport.scale || 1);
    const all = board.strokes();
    for (let i = all.length - 1; i >= 0; i -= 1) {
        const s = all[i];
        if (!s) continue;
        if (s.flowchartKind === 'connector') {
            if (board.flowConnectorHit(s, x, y, tol)) return s;
        } else if (s.flowchartKind === 'shape') {
            const b = shapeBounds(s);
            if (b && x >= b.minX - tol && x <= b.maxX + tol && y >= b.minY - tol && y <= b.maxY + tol) return s;
        }
    }
    return null;
}

/** Point-to-segment hit test across a straight or single-bend elbow path. */
export function flowConnectorHit(board, conn, x, y, tol) {
    const midX = Number(conn.midX);
    const midY = Number(conn.midY);
    const legs = conn.routing === 'elbow' && Number.isFinite(midX) && Number.isFinite(midY)
        ? [[{ x: conn.x0, y: conn.y0 }, { x: midX, y: midY }],
           [{ x: midX, y: midY }, { x: conn.x1, y: conn.y1 }]]
        : [[{ x: conn.x0, y: conn.y0 }, { x: conn.x1, y: conn.y1 }]];
    return legs.some(([a, b]) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        let t = len2 > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)) <= tol;
    });
}

/**
 * Which endpoint ('from' or 'to') of a connector the pointer is on, or null.
 * Hit radius scales with zoom so the grab target stays a comfortable size.
 * @param {object} conn
 * @param {number} x
 * @param {number} y
 * @returns {string|null}
 */
export function hitFlowEndpoint(board, conn, x, y) {
    if (!conn) return null;
    const scale = CanvasViewport.scale || 1;
    const r = 8 / scale;
    const ends = [
        { name: 'from', x: conn.x0, y: conn.y0 },
        { name: 'to', x: conn.x1, y: conn.y1 }
    ];
    for (const e of ends) {
        if (Math.hypot(e.x - x, e.y - y) <= r) return e.name;
    }
    return null;
}

/**
 * Test if pointer is over a connector elbow bend point (within tolerance).
 * Returns { kind: 'bend', connector, point: {x,y} } or null.
 */
export function flowConnectorBendHit(board, conn, x, y, tol) {
    if (!conn || conn.routing !== 'elbow') return null;
    const bend = { x: conn.midX ?? (conn.x0 + conn.x1) / 2, y: conn.midY ?? (conn.y0 + conn.y1) / 2 };
    const dx = x - bend.x;
    const dy = y - bend.y;
    return Math.hypot(dx, dy) <= tol ? { kind: 'bend', connector: conn, point: bend } : null;
}

/** Render live bend preview while dragging a connector elbow. */
export function renderFlowBendPreview(board) {
    const st = board.flowBendDrag;
    if (!st) return;
    const { connector, startX, startY, startMidX, startMidY } = st;
    const scale = CanvasViewport.scale || 1;
    const ctx = board.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = '#3b82f6';
    // World-space painter (zoom is the innerEl CSS transform), so a screen-sized
    // 2px ghost is 2/scale world units.
    ctx.lineWidth = 2 / scale;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(connector.x0, connector.y0);
    ctx.lineTo(startX, startY);
    ctx.lineTo(connector.x1, connector.y1);
    ctx.stroke();
    ctx.restore();
    void startMidX; void startMidY;
}

/** Called on pointerdown over a connector bend: start the drag capture. */
export function startFlowBendDrag(board, x, y) {
    const conn = board.flowHit(x, y);
    if (!conn || conn.flowchartKind !== 'connector') return false;
    const bend = board.flowConnectorBendHit(conn, x, y, 12 / Math.max(0.1, CanvasViewport.scale || 1));
    if (!bend) return false;
    board.flowBendDrag = {
        connector: conn,
        startX: x,
        startY: y,
        startMidX: bend.connector.midX ?? (bend.connector.x0 + bend.connector.x1) / 2,
        startMidY: bend.connector.midY ?? (bend.connector.y0 + bend.connector.y1) / 2
    };
    board.requestRedraw();
    return true;
}

/** Called on pointermove while dragging a bend: track the pointer. */
export function moveFlowBendDrag(board, x, y) {
    if (!board.flowBendDrag) return false;
    board.flowBendDrag.x = x;
    board.flowBendDrag.y = y;
    board.flowBendDrag.startX = x;
    board.flowBendDrag.startY = y;
    board.requestRedraw();
    return true;
}

/** Called on pointerup after a bend drag: commit the new midpoint. */
export function finishFlowBendDrag(board) {
    const st = board.flowBendDrag;
    board.flowBendDrag = null;
    if (!st) return;
    const { connector, startX, startY } = st;
    const grid = canvasGrid(board);
    const size = grid.size > 0 ? grid.size : FLOWCHART_DEFAULT_GRID_SIZE;
    const newMidX = grid.snap ? Math.round(startX / size) * size : startX;
    const newMidY = grid.snap ? Math.round(startY / size) * size : startY;
    connector.midX = Math.max(Math.min(connector.x0, connector.x1), Math.min(Math.max(connector.x0, connector.x1), newMidX));
    connector.midY = Math.max(Math.min(connector.y0, connector.y1), Math.min(Math.max(connector.y0, connector.y1), newMidY));
    board.pushLayerHistory();
    board.scheduleSave();
    board.redraw();
}

/**
 * Overlays drawn on top of the strokes in every redraw: the live bend ghost,
 * the connector port dots and the endpoint handles of a selected connector.
 */
export function renderFlowchartOverlays(board) {
    board.renderFlowBendPreview();
    board.renderFlowchartOverlay();
    board.renderFlowchartEndpointHandles();
}

/**
 * Port dots for discoverability: every shape port while the connector tool is
 * armed, and all candidate ports plus a rubber band while a drag is in flight.
 */
export function renderFlowchartOverlay(board) {
    const ctx = board.ctx;
    if (!ctx) return;
    const st = board.flowConnect;
    const scale = CanvasViewport.scale || 1;
    const dotR = 4 / scale;
    const shapes = board.flowchartShapes();
    if (!shapes.length) return;

    ctx.save();
    ctx.lineWidth = 1 / scale;

    // Connector tool selected, no drag in flight: show every port so the user
    // knows where they can start drawing from.
    if (!st && board.activeTool === FLOWCHART_CONNECTOR_TOOL) {
        for (const shape of shapes) {
            for (const port of ['n', 'e', 's', 'w']) {
                const p = portPointFor(shape, port);
                if (!p) continue;
                ctx.beginPath();
                ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(15, 23, 42, 0.6)';
                ctx.stroke();
            }
        }
        ctx.restore();
        return;
    }

    if (!st) { ctx.restore(); return; }

    const brush = board.currentBrush();
    const start = st.fromPt || { x: st.x, y: st.y };

    for (const shape of shapes) {
        if (shape.id === st.from?.shapeId) continue;
        for (const port of ['n', 'e', 's', 'w']) {
            const p = portPointFor(shape, port);
            if (!p) continue;
            const isTarget = st.hover && st.hover.shapeId === shape.id && st.hover.port === port;
            ctx.beginPath();
            ctx.arc(p.x, p.y, isTarget ? dotR * 1.6 : dotR, 0, Math.PI * 2);
            ctx.fillStyle = isTarget ? '#60a5fa' : 'rgba(148, 163, 184, 0.55)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(15, 23, 42, 0.6)';
            ctx.stroke();
        }
    }

    // Live rubber band from the anchor port to the cursor (or target port).
    const end = st.hover ? { x: st.hover.x, y: st.hover.y } : { x: st.x, y: st.y };
    const attached = !!(st.from && st.hover);
    const routed = attached && board.prefs?.routing === 'elbow'
        ? routeConnector(
            { x: start.x, y: start.y, port: st.from.port },
            { x: end.x, y: end.y, port: st.hover.port },
            'elbow'
        )
        : null;

    ctx.strokeStyle = brush.color;
    ctx.lineWidth = Math.max(1, brush.width);
    ctx.setLineDash([8 / scale, 6 / scale]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    if (routed && routed.midX != null) ctx.lineTo(routed.midX, routed.midY);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();
}

/**
 * When a connector is selected, draw grabbable handles on its two endpoints
 * so the user can re-attach an origin/terminus to a different port.
 * A no-op unless exactly one connector is selected.
 */
export function renderFlowchartEndpointHandles(board) {
    const ctx = board.ctx;
    if (!ctx) return;
    const sel = board.getSelectedStrokesArray();
    if (sel.length !== 1) return;
    const target = sel[0];
    if (!target || target.flowchartKind !== 'connector') return;

    const scale = CanvasViewport.scale || 1;
    const r = 6 / scale;
    const ends = [
        { name: 'from', x: target.x0, y: target.y0, port: target.from?.port },
        { name: 'to', x: target.x1, y: target.y1, port: target.to?.port }
    ];
    ctx.save();
    ctx.lineWidth = 1.5 / scale;
    for (const e of ends) {
        const active = board.flowEndpointDrag && board.flowEndpointDrag.end === e.name;
        ctx.beginPath();
        ctx.arc(e.x, e.y, active ? r * 1.4 : r, 0, Math.PI * 2);
        ctx.fillStyle = active ? '#fde047' : '#60a5fa';
        ctx.fill();
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.7)';
        ctx.stroke();
    }
    ctx.restore();
}

/** Start dragging an endpoint of the selected connector. */
export function startFlowEndpointDrag(board, conn, end, x, y) {
    board.flowEndpointDrag = { conn, end, moved: false, startX: x, startY: y };
}

/**
 * Move the dragged endpoint, snapping to the grid and magnetising onto a
 * shape port when one is close enough. Reroutes the connector live.
 */
export function applyFlowEndpointDrag(board, x, y) {
    const st = board.flowEndpointDrag;
    if (!st) return;
    const conn = st.conn;
    if (!conn) return;

    const snapped = board.flowSnapPoint(x, y, false);
    const anchor = board.flowResolveEndpoint(snapped.x, snapped.y, null);
    const end = st.end;

    if (end === 'from') {
        conn.x0 = snapped.x;
        conn.y0 = snapped.y;
        conn.from = anchor ? { shapeId: anchor.shapeId, port: anchor.port } : null;
    } else {
        conn.x1 = snapped.x;
        conn.y1 = snapped.y;
        conn.to = anchor ? { shapeId: anchor.shapeId, port: anchor.port } : null;
    }
    routeFlowchartConnector(conn);
    st.moved = true;
    board.requestRedraw();
}

/** Finish the endpoint drag, pushing one undo step if anything moved. */
export function finishFlowEndpointDrag(board) {
    const st = board.flowEndpointDrag;
    board.flowEndpointDrag = null;
    if (!st) return;
    if (st.moved) {
        board.pushLayerHistory();
        board.scheduleSave();
    }
    board.redraw();
}

/**
 * Commit the in-flight connector drag.
 * Attached-to-port when the pointer lands inside the magnet radius, otherwise
 * a free-floating straight arrow. Self-loops are rejected; tiny drags dropped.
 */
export function commitFlowConnect(board) {
    const st = board.flowConnect;
    board.flowConnect = null;
    if (!st) return;

    const endAnchor = board.flowResolveEndpoint(st.x, st.y, st.from?.shapeId);
    const endPt = endAnchor ? { x: endAnchor.point.x, y: endAnchor.point.y } : { x: st.x, y: st.y };
    const startPt = st.fromPt || { x: st.x, y: st.y };

    // Degenerate drag (a click) is not a connector.
    if (Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y) < 4) {
        board.redraw();
        return;
    }
    // A connector must never attach to the same shape on both ends.
    if (st.from && endAnchor && st.from.shapeId === endAnchor.shapeId) {
        showAppToast('Connect two different shapes');
        board.redraw();
        return;
    }

    const brush = board.currentBrush();
    const routing = (st.from && endAnchor && board.prefs?.routing === 'elbow') ? 'elbow' : 'straight';
    const conn = createFlowchartConnector({
        id: createId('stroke'),
        from: st.from ? { shapeId: st.from.shapeId, port: st.from.port } : null,
        to: endAnchor ? { shapeId: endAnchor.shapeId, port: endAnchor.port } : null,
        x0: startPt.x, y0: startPt.y,
        x1: endPt.x, y1: endPt.y,
        routing,
        color: brush.color,
        width: brush.width
    });

    board.pushLayerHistory();
    const strokes = board.strokes();
    strokes.push(conn);
    board.setStrokes(strokes);
    board.scheduleSave();
    board.redraw();

    // One-time discoverability: connectors are only crisp when snap is on.
    if (board.prefs && !board.prefs.snapTipShown && canvasGrid(board).snap === false) {
        board.prefs.snapTipShown = true;
        writePrefs(board.prefs);
        showAppToast('Tip: turn on snap in the toolbar for straight connector lines');
    }
}

/**
 * Inline contentEditable editor for the label of a shape or connector.
 *
 * Shape path: the editor IS the shape box — absolute at the shape's top-left,
 * sized to its bounds, flex-centred with wrapping text, clipped on overflow.
 * Connector path: a fixed-width box centred on the bend midpoint, so a
 * zero-width (vertical) connector still gets a usable editor.
 *
 * Enter commits, Shift+Enter inserts a newline, Escape aborts, blur commits.
 * Committing empty text on an existing label deletes it as one undo step.
 * The editor never repaints the toolbar: label chrome is gone from it.
 */
export function flowEditLabel(board, target) {
    if (!target) return;
    board.flowCloseLabel();
    // CanvasViewport has no worldToScreen — position like placeTextBox():
    // world coords are dpr-scaled, innerEl's CSS transform carries the zoom.
    const dpr = window.devicePixelRatio || 1;
    const isConnector = target.flowchartKind === 'connector';
    const minX = Math.min(target.x0, target.x1);
    const minY = Math.min(target.y0, target.y1);
    const boxW = Math.abs(target.x1 - target.x0);
    const boxH = Math.abs(target.y1 - target.y0);
    const existing = target.label && target.label.text ? String(target.label.text) : '';
    const hasPrev = !!(target.label && String(target.label.text || '').trim());
    const textPref = textStyle(board);
    // A brand-new label takes the text-colour pref; an existing one keeps
    // whatever the painter already draws it with (its own colour, else the
    // outline colour) so editing the words never silently restyles it.
    const labelFill = hasPrev
        ? (target.label.color || target.color || textPref.color)
        : textPref.color;
    // An explicit stored size always wins; only a brand-new label is fitted to
    // the box, and fitting never dips below the readable floor.
    const fontSize = target.label && target.label.fontSize
        ? normalizeFlowLabelSize(target.label.fontSize)
        : normalizeFlowLabelSize(isConnector ? FLOW_LABEL_DEFAULT : fitFlowLabelFontSize(boxH));
    const cssFont = Math.max(11, fontSize / dpr);

    const el = document.createElement('div');
    el.className = 'flow-label-editor' + (isConnector ? ' flow-label-editor--connector' : ' flow-label-editor--box');
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.dataset.placeholder = 'Type\u2026';
    el.style.fontSize = cssFont + 'px';
    // Same colour the painter will use for this label, so typed text does not
    // jump tone when it is committed.
    el.style.color = labelFill;

    if (isConnector) {
        const cx = Number.isFinite(Number(target.midX)) ? Number(target.midX) : (target.x0 + target.x1) / 2;
        const cy = Number.isFinite(Number(target.midY)) ? Number(target.midY) : (target.y0 + target.y1) / 2;
        const w = Math.max(90, cssFont * 6);
        el.style.left = (cx / dpr - w / 2) + 'px';
        el.style.top = (cy / dpr - cssFont * 0.75) + 'px';
        el.style.width = w + 'px';
    } else {
        const w = Math.max(60, boxW / dpr);
        const h = Math.max(cssFont * 1.2, boxH / dpr);
        el.style.left = (minX / dpr) + 'px';
        el.style.top = (minY / dpr) + 'px';
        el.style.width = w + 'px';
        el.style.height = h + 'px';
    }

    el.textContent = existing;
    board.textLayer.appendChild(el);
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel?.removeAllRanges();
    sel?.addRange(range);

    board.flowLabelEl = el;
    board.flowLabelTarget = target;
    board.selectedStrokes.clear();
    board.selectedStrokes.add(target);

    const commit = () => {
        const text = String(el.innerText || '').replace(/\u00a0/g, ' ').trim();
        const prevLabel = target.label || null;
        const prevJson = JSON.stringify(prevLabel);
        // Existing labels keep their stored colour ('' still means "inherit the
        // outline"); only a brand-new label is stamped with the text pref. Read
        // at commit time, not open time, so a pick during the edit still wins.
        const hadText = !!(prevLabel && String(prevLabel.text || '').trim());
        const nextLabel = text
            ? { text, fontSize, color: hadText ? String(prevLabel.color || '') : textStyle(board).color }
            : null;
        el.remove();
        if (board.flowLabelEl === el) { board.flowLabelEl = null; board.flowLabelTarget = null; }
        if (JSON.stringify(nextLabel) !== prevJson) {
            board.pushLayerHistory();
            target.label = nextLabel;
            board.scheduleSave();
        }
        board.redraw();
    };
    el.addEventListener('blur', commit, { once: true });
    el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); el.innerText = ''; el.blur(); }
        else if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ev.stopPropagation(); el.blur(); }
        else ev.stopPropagation();
    });
}

export function flowCloseLabel(board) {
    if (board.flowLabelEl) board.flowLabelEl.blur();
}
