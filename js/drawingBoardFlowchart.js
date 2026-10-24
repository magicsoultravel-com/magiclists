/** @module {"owns":"magicCanvas flowchart session (shapes, connectors, labels)", "related":["drawingBoard.js","flowchart.js","flowchartGeometry.js"]} */
import { ColorPicker, PALETTE_UNIFIED } from './colorPicker.js';
import {
    FLOWCHART_SHAPE_TOOLS, FLOWCHART_CONNECTOR_TOOL,
    FLOW_LABEL_DEFAULT, FLOW_LABEL_MIN, FLOW_LABEL_MAX,
    FLOWCHART_DEFAULT_COLOR, FLOWCHART_WIDTH_STEPS,
    createFlowchartConnector, normalizeFlowLabelSize, clampFlowchartWidth,
    routeFlowchartConnector
} from './flowchart.js';
import {
    shapeBounds, nearestPort, portPointFor, snapEndpointToShapes, routeConnector,
    rerouteAttachedConnectors
} from './flowchartGeometry.js';
import { CanvasViewport } from './canvasViewport.js';
import { showAppToast } from './toast.js';
import { createId } from './canvasDocument.js';
export function flowchartGrid(board) {
        const fallback = { type: 'dots', size: 24, snap: true, visible: true };
        const g = board.flowchartItem?.flowchart?.grid;
        if (!g || typeof g !== 'object') return fallback;
        return {
            type: typeof g.type === 'string' ? g.type : fallback.type,
            size: Number.isFinite(Number(g.size)) ? Number(g.size) : fallback.size,
            snap: g.snap !== false,
            visible: g.visible !== false
        };
}

    /** Active flowchart stroke color, persisted per diagram. */
export function flowchartColor(board) {
        const c = board.flowchartItem?.flowchart?.flowchartColor;
        return typeof c === 'string' && c ? c : FLOWCHART_DEFAULT_COLOR;
}

    /** Active flowchart stroke width, persisted per diagram. */
export function flowchartWidth(board) {
        const w = Number(board.flowchartItem?.flowchart?.flowchartWidth);
        return clampFlowchartWidth(w);
}

    /** Set the flowchart stroke color on the live item + the toolbar chip. */
export function persistFlowchartColor(board, color) {
        if (typeof color !== 'string' || !color) return;
        board.flowchartItem.flowchart.flowchartColor = color;
        board.persistFlowchartPref({ flowchartColor: color });
}

    /** Set the flowchart stroke width on the live item + the toolbar readout. */
export function persistFlowchartWidth(board, width) {
        const w = clampFlowchartWidth(width);
        board.flowchartItem.flowchart.flowchartWidth = w;
        board.persistFlowchartPref({ flowchartWidth: w });
}

    /** Shared persist helper for flowchart prefs that live on item.flowchart. */
export function persistFlowchartPref(board, patch) {
        if (!board.flowchartItem?.flowchart) return;
        Object.assign(board.flowchartItem.flowchart, patch || {});
        // Mirror persistFlowchartGrid: mutateItem is fire-and-forget here so the
        // live item is updated immediately and the board re-render picks it up.
        import('./noteSurfaceMutations.js').then(({ mutateItem }) => {
            mutateItem(board.flowchartItem, (it) => {
                if (!it.flowchart) return;
                Object.assign(it.flowchart, patch || {});
            }, { preserveView: true, skipRerender: true, localOnly: true });
        }).catch(() => {});
        board.scheduleSave();
}

    /**
     * Flowchart stroke color picker. Same chrome as the brush color rollout but
     * persists to item.flowchart.flowchartColor so every shape and connector
     * repaints consistently.
     */
export function openFlowchartColorPicker(board, anchor) {
        if (board.flowchartColorOpen) { ColorPicker.close(); return; }
        ColorPicker.close();
        board.flowLabelColorOpen = false;
        ColorPicker.open({
            anchor,
            presets: PALETTE_UNIFIED,
            value: board.flowchartColor(),
            align: 'end',
            onSelect: (c) => {
                board.persistFlowchartColor(c);
                board.redraw();
                board.renderToolbar();
            },
            onClose: () => { board.flowchartColorOpen = false; }
        });
        board.flowchartColorOpen = true;
        anchor?.setAttribute('aria-expanded', 'true');
}

    /**
     * Label color picker. Persists to the selected shape/connector's label so a
     * label can be tinted independently of the stroke.
     */
export function openFlowLabelColorPicker(board, anchor) {
        const target = board.flowLabelTargetShape();
        if (!target) { showAppToast('Select a shape or connector first'); return; }
        if (board.flowLabelColorOpen) { ColorPicker.close(); return; }
        ColorPicker.close();
        board.flowchartColorOpen = false;
        ColorPicker.open({
            anchor,
            presets: PALETTE_UNIFIED,
            value: target.label?.color || board.flowchartColor(),
            align: 'end',
            onSelect: (c) => {
                board.pushLayerHistory();
                target.label = { ...(target.label || { text: '', fontSize: FLOW_LABEL_DEFAULT, color: '' }), color: c };
                board.scheduleSave();
                board.redraw();
                board.renderToolbar();
            },
            onClose: () => { board.flowLabelColorOpen = false; }
        });
        board.flowLabelColorOpen = true;
        anchor?.setAttribute('aria-expanded', 'true');
}

    /**
     * Adjust the flowchart stroke width (1-16px, snapped to the allowed steps).
     * @param {number} delta
     */
export function adjustFlowchartWidth(board, delta) {
        const steps = FLOWCHART_WIDTH_STEPS;
        const cur = board.flowchartWidth();
        let idx = steps.indexOf(cur);
        if (idx < 0) {
            let best = 0;
            let bestD = Infinity;
            steps.forEach(function (s, i) {
                const d = Math.abs(s - cur);
                if (d < bestD) { bestD = d; best = i; }
            });
            idx = best;
        }
        const next = steps[Math.max(0, Math.min(steps.length - 1, idx + delta))];
        if (next === cur) return;
        board.persistFlowchartWidth(next);
        board.redraw();
        board.renderToolbar();
}

export async function persistFlowchartGrid(board, patch) {
        const item = board.flowchartItem;
        if (!item?.flowchart) return;
        Object.assign(item.flowchart.grid, patch || {});
        try {
            const { mutateItem } = await import('./noteSurfaceMutations.js');
            mutateItem(item, (it) => {
                if (!it.flowchart) return;
                if (!it.flowchart.grid) it.flowchart.grid = {};
                Object.assign(it.flowchart.grid, patch || {});
            }, { preserveView: true, skipRerender: true, localOnly: true });
        } catch { /* grid already set on live item */ }
        board.scheduleSave();
}

    /** True when the given tool draws a flowchart shape. */
export function isFlowShape(board, tool) {
        return FLOWCHART_SHAPE_TOOLS.includes(tool);
}

    /** True when the given tool drags a flowchart connector. */
export function isFlowConnector(board, tool) {
        return tool === FLOWCHART_CONNECTOR_TOOL;
}

    /**
     * Shape strokes on the active layer (connector endpoints magnet to these).
     * Ports only bind to shapes, never to other connectors.
     */
export function flowchartShapes(board) {
        if (!board.isFlowchartMode) return [];
        return board.strokes().filter((s) => s && s.flowchartKind === 'shape');
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
        if (!board.isFlowchartMode) return { x, y };
        const grid = board.flowchartGrid();
        if (bypass || !grid.snap) return { x, y };
        const size = grid.size > 0 ? grid.size : 24;
        return { x: Math.round(x / size) * size, y: Math.round(y / size) * size };
}

    /** Resolve a free connector end to a port when it lands inside the magnet. */
export function flowResolveEndpoint(board, x, y, excludeShapeId) {
        const shapes = board.flowchartShapes().filter((s) => s.id !== excludeShapeId);
        return snapEndpointToShapes(x, y, shapes, board.flowchartMagnetRadius());
}

    /** Recompute cached endpoints for every connector attached to the moved shapes. */
export function flowReroute(board, movedShapeIds) {
        if (!board.isFlowchartMode) return false;
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
        return changed;
}

    /** Topmost flowchart stroke under the pointer (shapes and connectors). */
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
     * Flowchart overlay: live connector drag with its port magnet, plus port dots
     * on every shape while connecting so targets are discoverable.
     */
    
    /**
     * Test if pointer is over a connector elbow bend point (within tolerance).
     * Returns { kind: 'bend', connector, point: {x,y} } or null.
     */
export function flowConnectorBendHit(board, conn, x, y, tol) {
        if (conn.routing !== 'elbow') return null;
        const bend = { x: conn.midX ?? (conn.x0 + conn.x1) / 2, y: conn.midY ?? (conn.y0 + conn.y1) / 2 };
        const dx = x - bend.x;
        const dy = y - bend.y;
        return Math.hypot(dx, dy) <= tol ? { kind: 'bend', connector: conn, point: bend } : null;
}

    /**
     * Live bend-drag state while pointer moves over a connector.
     */

    /**
     * Render live bend preview while dragging a connector elbow.
     */
export function renderFlowBendPreview(board) {
        if (!board.flowBendDrag || !board.isFlowchartMode) return;
        const { connector, startX, startY, startMidX, startMidY } = board.flowBendDrag;
        const scale = CanvasViewport.scale || 1;
        const ctx = board.ctx;
        ctx.save();
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2 * scale;
        ctx.globalAlpha = 0.6;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.beginPath();
        ctx.moveTo(connector.x0, connector.y0);
        ctx.lineTo(startMidX, startMidY);
        ctx.lineTo(connector.x1, connector.y1);
        ctx.stroke();
        ctx.restore();
}

    /**
     * Clear the live bend preview state.
     */
export function clearFlowBendPreview(board) {
        if (!board.isFlowchartMode) return;
        board.flowBendDrag = null;
}

    /**
     * Called on pointerdown over a connector bend: start the drag capture.
     */
export function startFlowBendDrag(board, x, y) {
        if (!board.isFlowchartMode) return;
        const conn = board.flowHit(x, y);
        if (!conn || conn.flowchartKind !== 'connector') return;
        const bend = board.flowConnectorBendHit(conn, x, y, 12 / Math.max(0.1, CanvasViewport.scale || 1));
        if (!bend) return;
        board.flowBendDrag = {
            connector: conn,
            startX: x,
            startY: y,
            startMidX: bend.connector.midX ?? (bend.connector.x0 + bend.connector.x1) / 2,
            startMidY: bend.connector.midY ?? (bend.connector.y0 + bend.connector.y1) / 2,
        };
        board.requestRedraw();
}

    /**
     * Called on pointerup after starting a bend drag: commit the new midpoint.
     */
export function finishFlowBendDrag(board) {
        if (!board.flowBendDrag) return;
        const { connector, startX, startY } = board.flowBendDrag;
        const grid = board.flowchartGrid();
        const snap = grid?.snap !== false;
        const size = grid?.size > 0 ? grid.size : 24;
        let newMidX = Math.round((startX) / size) * size;
        let newMidY = Math.round((startY) / size) * size;
        if (!snap) {
            newMidX = startX;
            newMidY = startY;
        }
        connector.midX = Math.max(connector.x0, Math.min(connector.x1, newMidX));
        connector.midY = Math.max(connector.y0, Math.min(connector.y1, newMidY));
        board.flowReroute([connector.id]);
        board.flowBendDrag = null;
        board.scheduleSave();
        board.redraw();
}

    /**
     * Bind bend-drag pointer events into the canvas overlay.
     */
export function bindFlowBendEvents(board) {
        if (!board.toolbarEl) return;
        const overlay = board.canvas?.parentElement?.querySelector?.('[data-flow-overlay]');
        if (!overlay) return;

        const onBendDown = (e) => {
            e.stopPropagation();
            const { x, y } = board.clientToCanvas(e.clientX, e.clientY);
            board.startFlowBendDrag(x, y);
        };

        const onMove = (e) => {
            if (!board.flowBendDrag) return;
            e.stopPropagation();
            const { x, y } = board.clientToCanvas(e.clientX, e.clientY);
            board.flowBendDrag.x = x;
            board.flowBendDrag.y = y;
            board.requestRedraw();
        };

        const onUp = (e) => {
            e.stopPropagation();
            board.finishFlowBendDrag();
            board.flowBendDrag = null;
        };

        overlay.addEventListener('pointerdown', onBendDown, { capture: true });
        document.addEventListener('pointermove', onMove, { capture: true });
        document.addEventListener('pointerup', onUp, { capture: true });
        document.addEventListener('pointercancel', onUp, { capture: true });
}

    /**
     * Called each render to draw live bend preview and update bend-hit state.
     */
export function renderFlowchartOverlays(board) {
        if (!board.isFlowchartMode) return;
        board.renderFlowBendPreview();
        board.clearFlowBendPreview();
}

export function renderFlowchartOverlay(board) {
        const ctx = board.ctx;
        if (!ctx || !board.isFlowchartMode) return;
        const st = board.flowConnect;
        const scale = CanvasViewport.scale || 1;
        const dotR = 4 / scale;
        const shapes = board.flowchartShapes();
        if (!shapes.length) return;

        ctx.save();
        ctx.lineWidth = 1 / scale;

        // --- Connector tool selected, no drag in flight: show every port so the
        //     user knows where they can start drawing from. -------------------
        if (!st && board.activeTool === FLOWCHART_CONNECTOR_TOOL) {
            for (const shape of shapes) {
                for (const port of ['n', 'e', 's', 'w']) {
                    const p = portPointFor(shape, port);
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

        // No drag in flight and the tool is not the connector: nothing to draw.
        if (!st) { ctx.restore(); return; }

        const brush = board.currentBrush();
        const start = st.fromPt || { x: st.x, y: st.y };

        // Port dots on all candidate shapes (skip the one we started from).
        for (const shape of shapes) {
            if (shape.id === st.from?.shapeId) continue;
            for (const port of ['n', 'e', 's', 'w']) {
                const p = portPointFor(shape, port);
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
        const routed = attached && board.flowchartRouting === 'elbow'
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
     * Runs in redraw() after the flowchart overlay; a no-op unless exactly one
     * connector is selected.
     */
export function renderFlowchartEndpointHandles(board) {
        const ctx = board.ctx;
        if (!ctx || !board.isFlowchartMode) return;
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
            // Tiny port label so the user knows which side they are grabbing.
            ctx.fillStyle = '#ffffff';
            ctx.font = `${Math.max(9, 10 / scale)}px Inter, system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(e.port || 'c', e.x, e.y - r - 1 / scale);
        }
        ctx.restore();
}

    /**
     * Start dragging an endpoint of the selected connector.
     * @param {object} conn
     * @param {'from'|'to'} end
     * @param {number} x
     * @param {number} y
     */
export function startFlowEndpointDrag(board, conn, end, x, y) {
        board.flowEndpointDrag = { conn, end, moved: false, startX: x, startY: y };
}

    /**
     * Move the dragged endpoint, snapping to the grid and magnetising onto a
     * shape port when one is close enough. Reroutes the connector live.
     * @param {number} x
     * @param {number} y
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

    /**
     * Finish the endpoint drag, pushing one undo step if anything moved.
     */
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
     * Commit the in-flight connector drag.    /**
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

        const conn = createFlowchartConnector({
            id: createId('stroke'),
            from: st.from ? { shapeId: st.from.shapeId, port: st.from.port } : null,
            to: endAnchor ? { shapeId: endAnchor.shapeId, port: endAnchor.port } : null,
            x0: startPt.x, y0: startPt.y,
            x1: endPt.x, y1: endPt.y,
            routing: (st.from && endAnchor) ? board.flowchartRouting : 'straight',
            color: board.flowchartColor(),
            width: board.flowchartWidth()
        });

        board.pushLayerHistory();
        const strokes = board.strokes();
        strokes.push(conn);
        board.setStrokes(strokes);
        board.scheduleSave();
        board.redraw();
}
    /**
     * Inline contentEditable editor for the label of a shape/connector.
     * Commits on blur or Enter, clears on Escape, and pushes a single undo step
     * so label edits never tear the shape and its text apart.
     */
export function flowEditLabel(board, target) {
        if (!board.isFlowchartMode || !target) return;
        board.flowCloseLabel();
        // CanvasViewport has no worldToScreen — position like placeTextBox():
        // world coords are dpr-scaled, innerEl's CSS transform carries the zoom.
        const dpr = window.devicePixelRatio || 1;
        const isConnector = target.flowchartKind === 'connector';
        const cx = isConnector
            ? (Number.isFinite(Number(target.midX)) ? Number(target.midX) : (target.x0 + target.x1) / 2)
            : (Math.min(target.x0, target.x1) + Math.abs(target.x1 - target.x0) / 2);
        const cy = isConnector
            ? (Number.isFinite(Number(target.midY)) ? Number(target.midY) : (target.y0 + target.y1) / 2)
            : (Math.min(target.y0, target.y1) + Math.abs(target.y1 - target.y0) / 2);
        const existing = target.label && target.label.text ? String(target.label.text) : '';
        const fontSize = Math.max(10, Number(target.label?.fontSize) || FLOW_LABEL_DEFAULT);

        const el = document.createElement('div');
        el.className = 'flow-label-editor';
        el.contentEditable = 'true';
        el.spellcheck = false;
        el.dataset.placeholder = 'Label\u2026';
        const cssFont = Math.max(11, fontSize / dpr);
        const boxW = isConnector
            ? Math.max(90, cssFont * 6)
            : Math.max(60, Math.abs(target.x1 - target.x0) / dpr);
        el.style.left = (cx / dpr - boxW / 2) + 'px';
        el.style.top = (cy / dpr - cssFont * 0.75) + 'px';
        el.style.width = boxW + 'px';
        el.style.fontSize = cssFont + 'px';
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
        board.renderToolbar();

        const commit = () => {
            const text = String(el.innerText || '').replace(/\u00a0/g, ' ').trim();
            const prevLabel = target.label || null;
            const prevJson = JSON.stringify(prevLabel);
            const nextLabel = text ? { text, fontSize, color: prevLabel?.color || '' } : null;
            el.remove();
            if (board.flowLabelEl === el) { board.flowLabelEl = null; board.flowLabelTarget = null; }
            if (JSON.stringify(nextLabel) !== prevJson) {
                board.pushLayerHistory();
                target.label = nextLabel;
                board.scheduleSave();
            }
            board.redraw();
            board.renderToolbar();
        };
        el.addEventListener('blur', commit, { once: true });
        el.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); el.innerText = ''; el.blur(); }
            else if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); el.blur(); }
            else ev.stopPropagation();
        });
}

export function flowCloseLabel(board) {
        if (board.flowLabelEl) board.flowLabelEl.blur();
}

    /**
     * The stroke the label toolbar acts on: the open editor's target, else the
     * current selection when it is a flowchart shape/connector.
     */
export function flowLabelTargetShape(board) {
        if (!board.isFlowchartMode) return null;
        const t = board.flowLabelTarget || board.getSelectedStrokesArray()[0];
        if (!t) return null;
        return (t.flowchartKind === 'shape' || t.flowchartKind === 'connector') ? t : null;
}

    /** Current label size of the toolbar target, clamped to the allowed range. */
export function flowLabelFontSize(board) {
        const n = Number(board.flowLabelTargetShape()?.label?.fontSize) || FLOW_LABEL_DEFAULT;
        return Math.min(FLOW_LABEL_MAX, Math.max(FLOW_LABEL_MIN, Math.round(n)));
}

    /** Toolbar "text" action: open the label editor on the selection. */
export function editSelectedFlowchartLabel(board) {
        const target = board.flowLabelTargetShape();
        if (!target) { showAppToast('Select a shape or connector first'); return; }
        board.flowEditLabel(target);
}

    /** Toolbar A- / A+: resize the selected shape's label as one undo step. */
export function nudgeSelectedFlowchartLabel(board, delta) {
        const target = board.flowLabelTargetShape();
        if (!target) { showAppToast('Select a shape or connector first'); return; }
        const cur = target.label || { text: '', fontSize: FLOW_LABEL_DEFAULT, color: '' };
        const next = normalizeFlowLabelSize((Number(cur.fontSize) || FLOW_LABEL_DEFAULT) + delta);
        if (next === (Number(cur.fontSize) || FLOW_LABEL_DEFAULT)) return;
        board.pushLayerHistory();
        target.label = { ...cur, fontSize: next };
        board.scheduleSave();
        board.redraw();
        board.renderToolbar();
}
