/** @module {"owns":"magicCanvas clipboard session (Ctrl+C/X/V, Delete, selection serialization)", "related":["drawingBoard.js","mediaPasteCatcher.js","canvasDocument.js","flowchart.js"]} */
import { createId, getActiveTexts, setActiveTexts } from './canvasDocument.js';
import { getStrokesBounds } from './lassoGeometry.js';
import { CanvasViewport } from './canvasViewport.js';
import { FLOWCHART_CONNECTOR_TOOL, FLOWCHART_SHAPE_TOOLS, routeFlowchartConnector } from './flowchart.js';
import { showAppToast } from './toast.js';
import { drawBrushStroke, drawShapeStroke, drawTextObject } from './canvasBrushes.js';
import { drawImageObject } from './canvasImages.js';

/** Custom MIME carrying the serialized board payload (Chromium cross-tab path). */
export const CLIP_MIME = 'application/x-magiclists-drawing';
/** text/plain sentinel for browsers that drop custom MIME types (Firefox same-tab). */
const MARKER_PREFIX = '⟦MagicLists canvas⟧';
/** Keydown→paste delivery time; conservative upper bound on all browsers. */
const PASTE_ARM_WINDOW_MS = 250;
/** World-px diagonal step applied per consecutive paste of the same copy. */
const CASCADE_OFFSET = 20;
/** Local payload stays eligible as read-error fallback for this long. */
const FALLBACK_FRESH_MS = 5000;

/** @type {object|null} DrawingBoard singleton — bound once at drawingBoard.js load. */
let board = null;
let bound = false;
/** Armed timestamp for the next paste event; consumed on read (one-shot). */
let armedAt = 0;
/** Consecutive-paste cascade counter; reset on copy/cut and on any pointerdown. */
let cascadeN = 0;

function markerText(n) { return `${MARKER_PREFIX} ${n} object(s)`; }

function totalOf(payload) {
    return (payload?.strokes?.length || 0) + (payload?.texts?.length || 0) + (payload?.images?.length || 0);
}

function hasContent(payload) { return totalOf(payload) > 0; }

/**
 * True while a board Ctrl+C/X within the arm window is awaiting its paste event.
 * Peek — does NOT consume (used by mediaPasteCatcher's yield clause).
 */
export function peekBoardPasteArmed() {
    return !!armedAt && Date.now() - armedAt <= PASTE_ARM_WINDOW_MS;
}

function consumeArmed() {
    if (peekBoardPasteArmed()) { armedAt = 0; return true; }
    armedAt = 0;
    return false;
}

/** Arm the next paste event. Idempotent within the arm window. */
function arm() {
    if (!peekBoardPasteArmed()) armedAt = Date.now();
}

function resetCascade() { cascadeN = 0; }

/** Sync detection only — custom MIME presence on a paste event's clipboardData. */
export function eventHasBoardMime(e) {
    const types = e?.clipboardData?.types;
    if (!types) return false;
    return Array.from(types).includes(CLIP_MIME);
}

function eventHasMarker(e) {
    try {
        const text = e?.clipboardData?.getData?.('text/plain') || '';
        return text.startsWith(`${MARKER_PREFIX} `);
    } catch { return false; }
}

/** Marker's parsed object count must equal the local payload's total (anti-collision). */
function markerMatchesPayload(e, payload) {
    try {
        const text = e?.clipboardData?.getData?.('text/plain') || '';
        const m = text.match(/⟦MagicLists canvas⟧\s+(\d+)\s+object/);
        return !!m && Number(m[1]) === totalOf(payload);
    } catch { return false; }
}

/** Text inputs / contentEditable overlays own the clipboard while focused. */
export function isTextEditingTarget() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return !!el.isContentEditable;
}

function isConnector(s) {
    return !!s && (s.flowchartKind === 'connector' || s.tool === FLOWCHART_CONNECTOR_TOOL);
}

function isFlowShape(s) {
    if (!s) return false;
    if (s.flowchartKind === 'shape') return true;
    return FLOWCHART_SHAPE_TOOLS.includes(s.tool);
}

/**
 * Deep-clone the current selection into a portable payload.
 * Classification is by layer membership (reference identity), not tool sniffing.
 * Stale references (in no layer) are skipped — never copy ghosts.
 * @param {object} b
 * @returns {{ app: string, v: number, strokes: object[], texts: object[], images: object[] }}
 */
function serializeSelection(b) {
    const payload = { app: 'magiclists', v: 1, strokes: [], texts: [], images: [] };
    if (!b?.doc) return payload;
    const strokeSet = new Set(b.strokes());
    const textSet = new Set(getActiveTexts(b.doc));
    const imageSet = new Set(b.images());
    for (const item of b.getSelectedStrokesArray()) {
        if (!item) continue;
        const clone = JSON.parse(JSON.stringify(item));
        if (imageSet.has(item)) payload.images.push(clone);
        else if (textSet.has(item)) payload.texts.push(clone);
        else if (strokeSet.has(item)) payload.strokes.push(clone);
    }
    return payload;
}

/**
 * Render the selection payload to a PNG blob (white background, current zoom ×
 * devicePixelRatio, capped at 4096px per side). Reuses the board's own painters
 * so the picture matches what the user sees. Returns null when unavailable
 * (no DOM/canvas in Node, or rendering failed) — callers degrade gracefully.
 * @param {object} b board (unused beyond payload rendering surface — kept for symmetry)
 * @param {object} payload
 * @returns {Promise<Blob|null>}
 */
export async function renderSelectionPng(b, payload) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const items = [...(payload.strokes || []), ...(payload.texts || []), ...(payload.images || [])];
    if (!items.length) return null;
    const bounds = getStrokesBounds(items);
    if (!bounds || !Number.isFinite(bounds.minX) || bounds.width <= 0 || bounds.height <= 0) return null;
    const zoom = CanvasViewport.scale || 1;
    const dpr = window.devicePixelRatio || 1;
    let scale = zoom * dpr;
    let pxW = Math.ceil(bounds.width * scale);
    let pxH = Math.ceil(bounds.height * scale);
    const CAP = 4096;
    const fit = Math.min(1, CAP / Math.max(pxW, pxH, 1));
    if (fit < 1) scale *= fit;
    pxW = Math.max(1, Math.round(pxW * fit));
    pxH = Math.max(1, Math.round(pxH * fit));
    const canvas = document.createElement('canvas');
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pxW, pxH);
    ctx.scale(scale, scale);
    ctx.translate(-bounds.minX, -bounds.minY);
    for (const s of payload.strokes || []) {
        if (s.tool === 'brush') drawBrushStroke(ctx, s);
        else drawShapeStroke(ctx, s);
    }
    for (const t of payload.texts || []) drawTextObject(ctx, t);
    for (const im of payload.images || []) drawImageObject(ctx, im); // bitmap self-resolves from cache
    return await new Promise((resolve) => {
        try {
            canvas.toBlob((blob) => resolve(blob), 'image/png');
        } catch {
            resolve(null);
        }
    });
}

/**
 * Fire-and-forget OS clipboard write — ONE clipboard entry, three representations:
 *   custom MIME   → editable objects (magiclists round-trip)
 *   image/png     → portable picture (paste into any app)
 *   text/plain    → marker sentinel (Firefox same-tab path, plain-text targets)
 * If the composite write is rejected (browsers that refuse custom types), fall
 * back to a PNG-only item so the image stays portable. If the PNG render failed,
 * fall back to the custom MIME + marker pair (previous behavior). The local
 * payload is set by the caller synchronously first, so this promise never gates
 * the keydown tick.
 * @param {object} b
 * @param {object} payload
 */
export async function writePortableClipboard(b, payload) {
    let png = null;
    try { png = await renderSelectionPng(b, payload); } catch { png = null; }
    try {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return;
        const json = JSON.stringify(payload);
        const custom = new Blob([json], { type: CLIP_MIME });
        const marker = new Blob([markerText(totalOf(payload))], { type: 'text/plain' });
        try {
            const item = { [CLIP_MIME]: custom, 'text/plain': marker };
            if (png) item['image/png'] = png;
            await navigator.clipboard.write([new ClipboardItem(item)]);
            return;
        } catch (compositeErr) {
            if (png) {
                // Browsers that refuse custom types still take image/png — keep it portable.
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).catch(() => {});
                return;
            }
            // No PNG available: retry the custom pair alone (never write nothing).
            try {
                await navigator.clipboard.write([new ClipboardItem({ [CLIP_MIME]: custom, 'text/plain': marker })]);
            } catch { /* swallow — local payload covers same-tab */ }
        }
    } catch { /* unsupported context — local payload covers it */ }
}

/** Async custom-MIME read via the Clipboard API. Rejects when unavailable/absent. */
function readPayloadAsync() {
    if (!navigator.clipboard?.read) return Promise.reject(new Error('clipboard-read-unavailable'));
    return navigator.clipboard.read().then((items) => {
        const item = (items || []).find((it) => (it.types || []).includes(CLIP_MIME));
        if (!item) return Promise.reject(new Error('no-board-mime'));
        return item.getType(CLIP_MIME).then((blob) => blob.text()).then(JSON.parse);
    });
}

function localPayloadFresh() {
    return !!(board?._boardClipboard && Date.now() - (board._clipboardTimestamp || 0) <= FALLBACK_FRESH_MS);
}

/** Visible world rect of the board canvas, or null when unavailable. */
function visibleWorldRect(b) {
    const el = b.canvas;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const a = CanvasViewport.screenToWorld(r.left, r.top, el);
    const c = CanvasViewport.screenToWorld(r.right, r.bottom, el);
    return { minX: Math.min(a.x, c.x), minY: Math.min(a.y, c.y), maxX: Math.max(a.x, c.x), maxY: Math.max(a.y, c.y) };
}

function shiftItem(o, dx, dy) {
    if (Array.isArray(o.points)) {
        for (const p of o.points) { p.x += dx; p.y += dy; }
    }
    if (o.x0 != null && o.y0 != null && o.x1 != null && o.y1 != null) {
        o.x0 += dx; o.y0 += dy; o.x1 += dx; o.y1 += dy;
    }
    if (o.x != null && o.y != null) { o.x += dx; o.y += dy; }
}

/**
 * Paste a payload onto the active board document.
 * Rules: one atomic history entry; fresh ids everywhere (mediaId never touched);
 * connector ends remapped into the pasted set, kept when at least one end
 * resolves (live original allowed), dropped only when both ends dangle;
 * +20·n diagonal cascade (reset on copy/cut/pointerdown), viewport-center
 * when the source bounds are entirely offscreen; selection replaced by pastes.
 * @param {object} b
 * @param {object} payload
 */
export function pastePayload(b, payload) {
    // Guard: teardown/close may race an in-flight async clipboard read.
    if (!b || !b.active) return;
    if (!payload) return;
    if (!hasContent(payload)) return;

    // Clone + fresh ids; build oldId → newId for connector remapping.
    // mediaId rides along untouched inside the clone — only c.id is replaced.
    const idMap = new Map();
    const clone = (src, prefix) => {
        const c = JSON.parse(JSON.stringify(src));
        const nid = createId(prefix);
        if (src?.id != null) idMap.set(src.id, nid);
        c.id = nid;
        return c;
    };
    const strokes = (payload.strokes || []).map((s) => clone(s, 'stroke'));
    const texts = (payload.texts || []).map((t) => clone(t, 'text'));
    const images = (payload.images || []).map((i) => clone(i, 'img'));

    // Connector resolution against pasted ids and live originals (pre-append).
    const liveShapeIds = new Set(b.strokes().filter(isFlowShape).map((s) => s.id));
    const endResolves = (end) => {
        if (!end || end.shapeId == null) return true;     // free end — never dangles
        if (idMap.has(end.shapeId)) return true;          // pasted alongside → remapped below
        return liveShapeIds.has(end.shapeId);             // live original on this canvas
    };
    const keptStrokes = strokes.filter((s) => {
        if (!isConnector(s)) return true;
        const fromOk = endResolves(s.from);
        const toOk = endResolves(s.to);
        if (s.from?.shapeId != null && idMap.has(s.from.shapeId)) {
            s.from = { ...s.from, shapeId: idMap.get(s.from.shapeId) };
        }
        if (s.to?.shapeId != null && idMap.has(s.to.shapeId)) {
            s.to = { ...s.to, shapeId: idMap.get(s.to.shapeId) };
        }
        return fromOk || toOk;                            // drop only when BOTH ends dangle
    });

    const allItems = [...keptStrokes, ...texts, ...images];
    if (!allItems.length) return;                         // nothing renderable — no history entry

    b.pushLayerHistory();                                 // one atomic undo entry

    // Offset: cascade step, or viewport center when the source is entirely offscreen.
    cascadeN += 1;
    let dx = CASCADE_OFFSET * cascadeN;
    let dy = CASCADE_OFFSET * cascadeN;
    const bounds = getStrokesBounds(allItems);
    if (bounds && Number.isFinite(bounds.minX)) {
        const vis = visibleWorldRect(b);
        const offscreen = vis && (bounds.maxX < vis.minX || bounds.minX > vis.maxX
            || bounds.maxY < vis.minY || bounds.minY > vis.maxY);
        if (offscreen) {
            dx = (vis.minX + vis.maxX) / 2 - (bounds.minX + bounds.maxX) / 2;
            dy = (vis.minY + vis.maxY) / 2 - (bounds.minY + bounds.maxY) / 2;
        }
        // Keep pasted content inside the world origin wall (infinite canvas starts at 0).
        dx = Math.max(dx, -bounds.minX);
        dy = Math.max(dy, -bounds.minY);
    }

    for (const o of allItems) shiftItem(o, dx, dy);
    for (const s of keptStrokes) if (isConnector(s)) routeFlowchartConnector(s);

    if (keptStrokes.length) b.setStrokes(b.strokes().concat(keptStrokes));
    if (texts.length) setActiveTexts(b.doc, getActiveTexts(b.doc).concat(texts));
    if (images.length) b.setImages(b.images().concat(images));
    if (bounds && Number.isFinite(bounds.maxX)) {
        b.expandInfiniteIfNeeded(bounds.maxX + dx, bounds.maxY + dy);
    }

    // Paste replaces the selection — pasted items become the selection.
    b.selectedStrokes.clear();
    for (const o of allItems) b.selectedStrokes.add(o);

    b.scheduleSave();
    b.redraw();
    b.updateToolbarState();
}

/**
 * Persistent document capture-phase paste handler (registered once at bindBoard).
 * Order-independent vs mediaPasteCatcher: whichever runs first, the catcher's
 * yield clause and the token consumption keep a single owner per paste event.
 */
export function handlePasteEvent(e) {
    if (!board) return;
    // consume on any paste while armed — arm is one-shot regardless of payload type.
    // Do NOT move this below the MIME check: an image paste inside the arm window
    // must eat the token too, or the next paste event would double-fire.
    if (!consumeArmed()) return;

    if (eventHasBoardMime(e)) {
        e.preventDefault();                               // board payload — never let it hit text fields
        readPayloadAsync()
            .then((payload) => pastePayload(board, payload))
            .catch(() => {
                if (localPayloadFresh()) pastePayload(board, board._boardClipboard);
                else showAppToast('Couldn\'t read clipboard — copy again');
            });
        return;
    }

    // Firefox same-tab: custom MIME dropped, marker text survives + fresh local payload.
    if (eventHasMarker(e) && localPayloadFresh() && markerMatchesPayload(e, board._boardClipboard)) {
        e.preventDefault();
        pastePayload(board, board._boardClipboard);
    }
    // else: not ours — media catcher / browser default handles it (files, plain text…).
}

/** Ctrl+C — serialize selection, mirror to OS clipboard, one sync tick. */
export function handleCopyKey(b, e) {
    if (isTextEditingTarget()) return false;
    if (!b?.active) return false;
    const payload = serializeSelection(b);
    if (!hasContent(payload)) return false;               // no toast — browser default stands
    b._boardClipboard = payload;
    b._clipboardTimestamp = Date.now();
    resetCascade();
    writePortableClipboard(b, payload);                   // fire-and-forget
    e.preventDefault();
    showAppToast('Selection copied – press Ctrl+V to paste');
    return true;
}

/** Ctrl+X — copy + delete in ONE history entry. */
export function handleCutKey(b, e) {
    if (isTextEditingTarget()) return false;
    if (!b?.active) return false;
    const selected = b.getSelectedStrokesArray();
    if (!selected.length) return false;
    const payload = serializeSelection(b);
    if (!hasContent(payload)) return false;
    b._boardClipboard = payload;
    b._clipboardTimestamp = Date.now();
    resetCascade();
    writePortableClipboard(b, payload);
    b.pushLayerHistory();                                 // atomic: copy + removal undo together
    removeItems(b, selected);
    b.selectedStrokes.clear();
    b.scheduleSave();
    b.redraw();
    e.preventDefault();
    showAppToast('Cut – press Ctrl+V to paste');
    return true;
}

/**
 * Ctrl+V — arms the next paste event only. NEVER preventDefault here: doing so
 * would suppress the paste event itself (and the media catcher's file path).
 */
export function handlePasteKey(b, e) {
    if (isTextEditingTarget()) return false;
    if (!b?.active) return false;
    void e;
    arm();
    return true;
}

/** Delete/Backspace — remove selection (plus connectors on deleted shapes), one entry. */
export function handleDeleteKey(b, e) {
    if (isTextEditingTarget()) return false;
    if (!b?.active) return false;
    const selected = b.getSelectedStrokesArray();
    if (!selected.length) return false;
    b.pushLayerHistory();
    removeItems(b, selected);
    b.selectedStrokes.clear();
    b.scheduleSave();
    b.redraw();
    e.preventDefault();
    return true;
}

/**
 * Remove items from their layers, then drop connectors whose attached shape
 * was deleted (either end) so no connector is left referencing a dead shape.
 */
function removeItems(b, items) {
    const sel = new Set(items);
    const deletedIds = new Set(items.map((i) => i?.id).filter((id) => id != null));
    b.setStrokes(b.strokes().filter((s) => !sel.has(s)));
    setActiveTexts(b.doc, getActiveTexts(b.doc).filter((t) => !sel.has(t)));
    b.setImages(b.images().filter((i) => !sel.has(i)));
    const remaining = b.strokes();
    const cleaned = remaining.filter((s) => {
        if (!isConnector(s)) return true;
        const fromGone = s.from?.shapeId != null && deletedIds.has(s.from.shapeId);
        const toGone = s.to?.shapeId != null && deletedIds.has(s.to.shapeId);
        return !fromGone && !toGone;
    });
    if (cleaned.length !== remaining.length) b.setStrokes(cleaned);
}

/**
 * After undo/redo the layers are fresh deep clones — re-point the selection
 * by id to the restored objects and drop items that no longer exist.
 * Prevents ghost lasso frames around orphaned references.
 */
export function pruneSelection(b) {
    if (!b?.doc || !b.selectedStrokes?.size) return;
    const byId = new Map();
    for (const list of [b.strokes(), getActiveTexts(b.doc), b.images()]) {
        for (const o of list) if (o && o.id != null) byId.set(o.id, o);
    }
    for (const item of Array.from(b.selectedStrokes)) {
        const fresh = item && item.id != null ? byId.get(item.id) : null;
        if (!fresh) b.selectedStrokes.delete(item);
        else if (fresh !== item) { b.selectedStrokes.delete(item); b.selectedStrokes.add(fresh); }
    }
}

/** Bind the DrawingBoard singleton and register app-lifetime listeners once. */
export function bindBoard(b) {
    board = b;
    if (bound) return;
    bound = true;
    // Node test env: no DOM, or a stub document without event APIs.
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    document.addEventListener('paste', handlePasteEvent, true);
    // Gap 6: cascade resets on any pointerdown (click elsewhere = fresh +20 next paste).
    document.addEventListener('pointerdown', () => { cascadeN = 0; }, true);
}

/** Test-only: reset armed token, cascade counter, and board binding. */
export function resetClipboardSessionForTests() {
    armedAt = 0;
    cascadeN = 0;
    board = null;
    bound = false;
}



