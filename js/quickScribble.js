/** @module {"owns":"site-wide freeze scribble overlay — draw / ink-visible / off", "related":["scribbleInk.js","noteAttachmentsUi.js","canvasBrushes.js","app.js","viewportCapture.js"]} */
import { drawBrushStroke } from './canvasBrushes.js';
import { ColorPicker, PALETTE_UNIFIED } from './colorPicker.js';
import { copyImageBlobToClipboard } from './clipboard.js';
import { ACTION_ICONS, CARD_ICONS, DRAWING_ICONS } from './icons.js';
import { showAppToast } from './toast.js';
import { captureViewportPngBlob } from './viewportCapture.js';
import {
    SCRIBBLE_COLORS,
    SCRIBBLE_COLOR_CUSTOM_INDEX,
    SCRIBBLE_WIDTH_DEFAULT,
    SCRIBBLE_WIDTH_MAX,
    SCRIBBLE_WIDTH_MIN,
    clampScribbleWidth,
    eraseScribbleStrokesAt,
    getScribbleColor,
    normalizeScribbleColorIndex,
    setScribbleCustomColor,
    stepScribbleWidth
} from './scribbleInk.js';

/** @typedef {'off'|'drawing'|'ink'} QuickScribbleMode */

const HISTORY_MAX = 80;
const DRAG_MARGIN = 8;

/** @type {QuickScribbleMode} */
let mode = 'off';
/** @type {'pen'|'eraser'} */
let tool = 'pen';
let colorIndex = 0;
let width = SCRIBBLE_WIDTH_DEFAULT;
/** @type {Array<{ color: string, width: number, points: Array<{x:number,y:number,p:number}> }>} */
let strokes = [];
/** @type {{ color: string, width: number, points: Array<{x:number,y:number,p:number}> }|null} */
let activeStroke = null;
let erasing = false;
/** Snapshot of strokes at erase-gesture start (null when not erasing). */
let eraseBaseline = null;
let rootEl = null;
let canvasEl = null;
let barEl = null;
let chromeEl = null;
let bound = false;
let resizeBound = false;
let copying = false;

/** @type {string[]} */
let undoStack = [];
/** @type {string[]} */
let redoStack = [];

let draggingBar = false;
let barDragOrigin = null;
let barDragPointerId = null;

function cloneStrokes(list) {
    return JSON.parse(JSON.stringify(Array.isArray(list) ? list : []));
}

function trimHistory(stack) {
    while (stack.length > HISTORY_MAX) stack.shift();
}

function pushHistory() {
    undoStack.push(JSON.stringify(strokes));
    trimHistory(undoStack);
    redoStack = [];
    syncHistoryUI();
}

function clearHistory() {
    undoStack = [];
    redoStack = [];
    syncHistoryUI();
}

function undoStrokes() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(strokes));
    trimHistory(redoStack);
    strokes = JSON.parse(undoStack.pop());
    activeStroke = null;
    paint();
    syncHistoryUI();
}

function redoStrokes() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(strokes));
    trimHistory(undoStack);
    strokes = JSON.parse(redoStack.pop());
    activeStroke = null;
    paint();
    syncHistoryUI();
}

function pressureOf(e) {
    const raw = Number(e?.pressure);
    if (Number.isFinite(raw) && raw > 0) return Math.min(1, raw);
    if (e?.pointerType === 'mouse') return 0.6;
    return 0.5;
}

function pointFromEvent(e) {
    const canvas = canvasEl;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect?.();
    if (!rect) return null;
    return {
        x: (Number(e?.clientX) || 0) - (rect.left || 0),
        y: (Number(e?.clientY) || 0) - (rect.top || 0)
    };
}

function sizeCanvas() {
    const canvas = canvasEl;
    if (!canvas) return null;
    const w = Math.max(1, Math.round(window.innerWidth || document.documentElement?.clientWidth || 1));
    const h = Math.max(1, Math.round(window.innerHeight || document.documentElement?.clientHeight || 1));
    const dpr = Math.min(3, Math.max(1, Number(window.devicePixelRatio) || 1));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
    }
    return { canvas, dpr, w, h };
}

function paint() {
    const sized = sizeCanvas();
    if (!sized) return;
    const { canvas, dpr } = sized;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    const list = strokes.slice();
    if (activeStroke?.points?.length) list.push(activeStroke);
    for (const stroke of list) {
        const pts = Array.isArray(stroke?.points) ? stroke.points : [];
        if (!pts.length) continue;
        drawBrushStroke(ctx, {
            points: pts.map((pt) => ({
                x: Number(pt.x) || 0,
                y: Number(pt.y) || 0,
                p: Number.isFinite(Number(pt.p)) ? Number(pt.p) : 0.5
            })),
            color: stroke.color,
            width: Math.max(1, Number(stroke.width) || width || SCRIBBLE_WIDTH_DEFAULT),
            style: 'pen'
        });
    }
    ctx.restore();
}

function eraseAtEvent(e) {
    const pt = pointFromEvent(e);
    if (!pt) return;
    const radius = clampScribbleWidth(width);
    const next = eraseScribbleStrokesAt(strokes, pt.x, pt.y, radius);
    if (next.length !== strokes.length) {
        strokes = next;
        paint();
    }
}

function appendPoint(e) {
    const pt = pointFromEvent(e);
    if (!pt || !activeStroke) return;
    const prev = activeStroke.points[activeStroke.points.length - 1];
    if (prev && Math.abs(prev.x - pt.x) < 1e-6 && Math.abs(prev.y - pt.y) < 1e-6) return;
    activeStroke.points.push({ x: pt.x, y: pt.y, p: pressureOf(e) });
    paint();
}

function syncWidthUI() {
    width = clampScribbleWidth(width);
    const label = barEl?.querySelector?.('[data-qs-width]') || null;
    if (label) label.textContent = `${width}px`;
    const smaller = barEl?.querySelector?.('[data-qs-smaller]') || null;
    const larger = barEl?.querySelector?.('[data-qs-larger]') || null;
    if (smaller) smaller.disabled = width <= SCRIBBLE_WIDTH_MIN;
    if (larger) larger.disabled = width >= SCRIBBLE_WIDTH_MAX;
}

function syncToolUI() {
    const eraser = barEl?.querySelector?.('[data-qs-eraser]') || null;
    if (eraser) {
        const on = tool === 'eraser';
        eraser.classList.toggle('is-active', on);
        eraser.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    rootEl?.classList.toggle('is-erasing', mode === 'drawing' && tool === 'eraser');
}

function syncColorUI() {
    barEl?.querySelectorAll?.('[data-qs-color]')?.forEach?.((btn) => {
        const idx = Number(btn?.dataset?.qsColor);
        const active = idx === colorIndex && tool === 'pen';
        btn.classList.toggle('is-active', active);
        if (active) btn.setAttribute('aria-pressed', 'true');
        else btn.removeAttribute('aria-pressed');
        if (idx === SCRIBBLE_COLOR_CUSTOM_INDEX) {
            btn.style.setProperty('--doodle-color', getScribbleColor(SCRIBBLE_COLOR_CUSTOM_INDEX));
        } else if (Number.isFinite(idx) && SCRIBBLE_COLORS[idx]) {
            btn.style.setProperty('--doodle-color', SCRIBBLE_COLORS[idx]);
        }
    });
}

function syncHistoryUI() {
    const undoBtn = barEl?.querySelector?.('[data-qs-undo]') || null;
    const redoBtn = barEl?.querySelector?.('[data-qs-redo]') || null;
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function syncUI() {
    if (!rootEl) return;
    rootEl.dataset.mode = mode;
    rootEl.classList.toggle('is-off', mode === 'off');
    rootEl.classList.toggle('is-drawing', mode === 'drawing');
    rootEl.classList.toggle('is-ink', mode === 'ink');
    rootEl.hidden = mode === 'off';
    if (canvasEl) {
        canvasEl.style.pointerEvents = mode === 'drawing' ? 'auto' : 'none';
    }
    if (barEl) {
        barEl.hidden = mode !== 'drawing';
    }
    syncWidthUI();
    syncToolUI();
    syncColorUI();
    syncHistoryUI();
    syncFab();
}

function syncFab() {
    const fab = document.getElementById('fab-scribble');
    if (!fab) return;
    const active = mode === 'drawing' || mode === 'ink';
    fab.classList.toggle('is-active', active);
    fab.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (mode === 'drawing') {
        fab.title = 'Done scribbling (keep ink)';
        fab.setAttribute('aria-label', fab.title);
    } else if (mode === 'ink') {
        fab.title = 'Resume scribble';
        fab.setAttribute('aria-label', fab.title);
    } else {
        fab.title = 'Scribble';
        fab.setAttribute('aria-label', 'Scribble');
    }
}

function openCustomColorPicker() {
    const chip = barEl?.querySelector?.(`[data-qs-color="${SCRIBBLE_COLOR_CUSTOM_INDEX}"]`) || null;
    if (!chip) return;
    ColorPicker.open({
        anchor: chip,
        presets: PALETTE_UNIFIED,
        value: getScribbleColor(SCRIBBLE_COLOR_CUSTOM_INDEX),
        align: 'center',
        onSelect: (hex) => {
            setScribbleCustomColor(hex);
            syncColorUI();
        }
    });
}

function setTool(next) {
    tool = next === 'eraser' ? 'eraser' : 'pen';
    if (tool === 'pen') ColorPicker.close();
    syncUI();
}

/**
 * @param {unknown} index
 * @param {{ openPicker?: boolean }} [opts]
 */
function setColor(index, opts = {}) {
    const next = normalizeScribbleColorIndex(index);
    const wasActive = next === colorIndex && tool === 'pen';
    colorIndex = next;
    tool = 'pen';
    syncUI();
    const wantPicker = !!opts.openPicker
        || (wasActive && next === SCRIBBLE_COLOR_CUSTOM_INDEX);
    if (wantPicker && next === SCRIBBLE_COLOR_CUSTOM_INDEX) {
        openCustomColorPicker();
    } else if (next !== SCRIBBLE_COLOR_CUSTOM_INDEX) {
        ColorPicker.close();
    }
}

function clearInk() {
    if (!strokes.length && !activeStroke) return;
    pushHistory();
    strokes = [];
    activeStroke = null;
    paint();
}

function resetBarPosition() {
    const chrome = chromeEl;
    if (!chrome) return;
    chrome.classList.remove('is-dragged');
    chrome.style.left = '';
    chrome.style.top = '';
    chrome.style.right = '';
    chrome.style.bottom = '';
    chrome.style.transform = '';
}

function clampBarPosition(x, y) {
    const chrome = chromeEl;
    if (!chrome) return { x, y };
    const rect = chrome.getBoundingClientRect();
    const w = rect.width || chrome.offsetWidth || 1;
    const h = rect.height || chrome.offsetHeight || 1;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    return {
        x: Math.max(DRAG_MARGIN, Math.min(x, vw - w - DRAG_MARGIN)),
        y: Math.max(DRAG_MARGIN, Math.min(y, vh - h - DRAG_MARGIN))
    };
}

function applyBarPosition(x, y) {
    const chrome = chromeEl;
    if (!chrome) return;
    const pos = clampBarPosition(x, y);
    chrome.classList.add('is-dragged');
    chrome.style.left = `${pos.x}px`;
    chrome.style.top = `${pos.y}px`;
    chrome.style.right = 'auto';
    chrome.style.bottom = 'auto';
    chrome.style.transform = 'none';
}

function setMode(next) {
    if (next === mode) {
        syncUI();
        return;
    }
    if (mode === 'drawing' && activeStroke?.points?.length) {
        strokes.push(activeStroke);
        activeStroke = null;
    }
    activeStroke = null;
    erasing = false;
    eraseBaseline = null;
    mode = next;
    if (mode === 'off') {
        strokes = [];
        clearHistory();
        ColorPicker.close();
        resetBarPosition();
    }
    if (mode === 'drawing') {
        resetBarPosition();
    }
    if (mode === 'ink') {
        resetBarPosition();
        ColorPicker.close();
    }
    if (mode !== 'off') paint();
    else if (canvasEl) {
        const ctx = canvasEl.getContext?.('2d');
        ctx?.clearRect(0, 0, canvasEl.width, canvasEl.height);
    }
    syncUI();
}

async function copyViewportSnapshot() {
    if (copying || mode !== 'drawing') return;
    copying = true;
    const copyBtn = barEl?.querySelector?.('[data-qs-copy]') || null;
    if (copyBtn) copyBtn.disabled = true;
    try {
        if (activeStroke?.points?.length) {
            strokes.push(activeStroke);
            activeStroke = null;
            paint();
        }
        const blob = await captureViewportPngBlob({
            exclude: rootEl,
            overlayCanvas: canvasEl,
            hideDuringCapture: chromeEl
        });
        if (!blob) {
            showAppToast('Could not capture viewport');
            return;
        }
        const ok = await copyImageBlobToClipboard(blob);
        showAppToast(ok ? 'Snapshot copied to clipboard' : 'Could not copy snapshot');
    } catch {
        showAppToast('Could not copy snapshot');
    } finally {
        copying = false;
        if (copyBtn) copyBtn.disabled = false;
    }
}

function ensureDom() {
    if (rootEl) return rootEl;
    rootEl = document.createElement('div');
    rootEl.id = 'quick-scribble';
    rootEl.className = 'quick-scribble is-off';
    rootEl.hidden = true;
    rootEl.setAttribute('aria-hidden', 'true');
    rootEl.innerHTML = `
        <canvas class="quick-scribble__canvas" data-qs-canvas></canvas>
        <div class="quick-scribble__chrome" data-qs-chrome>
            <div class="quick-scribble__bar" data-qs-bar hidden>
                <button type="button" class="media-lightbox__doodle-tool quick-scribble__grab" data-qs-grab title="Drag toolbar" aria-label="Drag toolbar">${CARD_ICONS.drag}</button>
                <button type="button" class="media-lightbox__doodle-dot is-active" data-qs-color="0" style="--doodle-color:#ff00ff" title="Pink" aria-label="Pink pen" aria-pressed="true"></button>
                <button type="button" class="media-lightbox__doodle-dot" data-qs-color="1" style="--doodle-color:#00ff00" title="Green" aria-label="Green pen"></button>
                <button type="button" class="media-lightbox__doodle-dot" data-qs-color="2" style="--doodle-color:#00ffff" title="Cyan" aria-label="Cyan pen"></button>
                <button type="button" class="media-lightbox__doodle-dot media-lightbox__doodle-dot--custom" data-qs-color="3" style="--doodle-color:#ffaa00" title="Custom color" aria-label="Custom pen color">${CARD_ICONS.color}</button>
                <button type="button" class="media-lightbox__doodle-tool" data-qs-eraser title="Eraser" aria-label="Eraser" aria-pressed="false">${DRAWING_ICONS.eraser}</button>
                <span class="media-lightbox__doodle-size" aria-label="Pen size">
                    <button type="button" class="media-lightbox__doodle-size-btn" data-qs-smaller title="Decrease pen size" aria-label="Decrease pen size">${ACTION_ICONS.minus}</button>
                    <span class="media-lightbox__doodle-size-value" data-qs-width aria-live="polite">6px</span>
                    <button type="button" class="media-lightbox__doodle-size-btn" data-qs-larger title="Increase pen size" aria-label="Increase pen size">${ACTION_ICONS.plus}</button>
                </span>
                <button type="button" class="media-lightbox__doodle-tool" data-qs-undo title="Undo scribble" aria-label="Undo scribble" disabled>${ACTION_ICONS.undo}</button>
                <button type="button" class="media-lightbox__doodle-tool" data-qs-redo title="Redo scribble" aria-label="Redo scribble" disabled>${ACTION_ICONS.redo}</button>
                <button type="button" class="media-lightbox__doodle-tool" data-qs-copy title="Copy viewport snapshot" aria-label="Copy viewport snapshot">${CARD_ICONS.copy}</button>
                <button type="button" class="media-lightbox__doodle-tool" data-qs-clear title="Clear scribbles" aria-label="Clear scribbles">${CARD_ICONS.delete}</button>
                <button type="button" class="media-lightbox__doodle-tool quick-scribble__done" data-qs-done title="Done — keep ink, unfreeze" aria-label="Done — keep ink, unfreeze">${CARD_ICONS.save}</button>
                <button type="button" class="media-lightbox__doodle-tool quick-scribble__exit" data-qs-exit title="Exit and flush scribbles" aria-label="Exit and flush scribbles">${ACTION_ICONS.drawingExit}</button>
            </div>
        </div>
    `;
    document.body.appendChild(rootEl);
    canvasEl = rootEl.querySelector('[data-qs-canvas]');
    barEl = rootEl.querySelector('[data-qs-bar]');
    chromeEl = rootEl.querySelector('[data-qs-chrome]');
    return rootEl;
}

function bindBarDrag() {
    const grab = barEl?.querySelector?.('[data-qs-grab]');
    if (!grab || !chromeEl) return;

    grab.addEventListener('pointerdown', (e) => {
        if (mode !== 'drawing') return;
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = chromeEl.getBoundingClientRect();
        draggingBar = true;
        barDragPointerId = e.pointerId;
        barDragOrigin = {
            px: e.clientX,
            py: e.clientY,
            left: rect.left,
            top: rect.top
        };
        chromeEl.classList.add('is-dragging');
        grab.classList.add('is-dragging');
        try { grab.setPointerCapture(e.pointerId); } catch { /* noop */ }
        applyBarPosition(rect.left, rect.top);
    });

    grab.addEventListener('pointermove', (e) => {
        if (!draggingBar || e.pointerId !== barDragPointerId || !barDragOrigin) return;
        e.preventDefault();
        const dx = e.clientX - barDragOrigin.px;
        const dy = e.clientY - barDragOrigin.py;
        applyBarPosition(barDragOrigin.left + dx, barDragOrigin.top + dy);
    });

    const endDrag = (e) => {
        if (!draggingBar) return;
        if (e && barDragPointerId != null && e.pointerId !== barDragPointerId) return;
        draggingBar = false;
        barDragOrigin = null;
        barDragPointerId = null;
        chromeEl?.classList.remove('is-dragging');
        grab.classList.remove('is-dragging');
    };
    grab.addEventListener('pointerup', endDrag);
    grab.addEventListener('pointercancel', endDrag);
}

function bindEvents() {
    if (bound || !rootEl) return;
    bound = true;

    bindBarDrag();

    rootEl.addEventListener('click', (e) => {
        if (e.target.closest('[data-qs-grab]')) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        const colorBtn = e.target.closest('[data-qs-color]');
        if (colorBtn) {
            e.preventDefault();
            e.stopPropagation();
            const idx = Number(colorBtn.dataset?.qsColor);
            const already = idx === colorIndex && tool === 'pen';
            setColor(idx, { openPicker: already && idx === SCRIBBLE_COLOR_CUSTOM_INDEX });
            return;
        }
        if (e.target.closest('[data-qs-eraser]')) {
            e.preventDefault();
            e.stopPropagation();
            setTool(tool === 'eraser' ? 'pen' : 'eraser');
            return;
        }
        if (e.target.closest('[data-qs-smaller]')) {
            e.preventDefault();
            e.stopPropagation();
            width = stepScribbleWidth(width, -1);
            syncWidthUI();
            return;
        }
        if (e.target.closest('[data-qs-larger]')) {
            e.preventDefault();
            e.stopPropagation();
            width = stepScribbleWidth(width, 1);
            syncWidthUI();
            return;
        }
        if (e.target.closest('[data-qs-undo]')) {
            e.preventDefault();
            e.stopPropagation();
            undoStrokes();
            return;
        }
        if (e.target.closest('[data-qs-redo]')) {
            e.preventDefault();
            e.stopPropagation();
            redoStrokes();
            return;
        }
        if (e.target.closest('[data-qs-copy]')) {
            e.preventDefault();
            e.stopPropagation();
            void copyViewportSnapshot();
            return;
        }
        if (e.target.closest('[data-qs-clear]')) {
            e.preventDefault();
            e.stopPropagation();
            clearInk();
            return;
        }
        if (e.target.closest('[data-qs-done]')) {
            e.preventDefault();
            e.stopPropagation();
            ColorPicker.close();
            setMode(strokes.length || activeStroke?.points?.length ? 'ink' : 'off');
            return;
        }
        if (e.target.closest('[data-qs-exit]')) {
            e.preventDefault();
            e.stopPropagation();
            exit();
        }
    });

    canvasEl?.addEventListener('pointerdown', (e) => {
        if (mode !== 'drawing') return;
        if (e.button !== undefined && e.button !== 0) return;
        try { canvasEl.setPointerCapture(e.pointerId); } catch { /* noop */ }
        if (tool === 'eraser') {
            erasing = true;
            activeStroke = null;
            eraseBaseline = cloneStrokes(strokes);
            eraseAtEvent(e);
            e.preventDefault();
            return;
        }
        if (activeStroke?.points?.length) strokes.push(activeStroke);
        pushHistory();
        activeStroke = {
            color: getScribbleColor(colorIndex),
            width: clampScribbleWidth(width),
            points: []
        };
        appendPoint(e);
        e.preventDefault();
    });

    canvasEl?.addEventListener('pointermove', (e) => {
        if (mode !== 'drawing') return;
        if (tool === 'eraser' && erasing) {
            const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
            for (const sub of events.length ? events : [e]) eraseAtEvent(sub);
            e.preventDefault();
            return;
        }
        if (!activeStroke) return;
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
        for (const sub of events.length ? events : [e]) appendPoint(sub);
        e.preventDefault();
    });

    const endStroke = () => {
        if (erasing) {
            erasing = false;
            if (eraseBaseline != null) {
                const before = eraseBaseline;
                eraseBaseline = null;
                if (JSON.stringify(before) !== JSON.stringify(strokes)) {
                    undoStack.push(JSON.stringify(before));
                    trimHistory(undoStack);
                    redoStack = [];
                    syncHistoryUI();
                }
            }
            return;
        }
        if (!activeStroke) return;
        if (activeStroke.points.length) strokes.push(activeStroke);
        else if (undoStack.length) {
            // Empty stroke — drop the history push from pointerdown.
            undoStack.pop();
            syncHistoryUI();
        }
        activeStroke = null;
        paint();
    };
    canvasEl?.addEventListener('pointerup', endStroke);
    canvasEl?.addEventListener('pointercancel', endStroke);

    if (!resizeBound) {
        resizeBound = true;
        window.addEventListener('resize', () => {
            if (mode === 'off') return;
            if (chromeEl?.classList.contains('is-dragged')) {
                const rect = chromeEl.getBoundingClientRect();
                applyBarPosition(rect.left, rect.top);
            }
            paint();
        });
        document.addEventListener('keydown', (e) => {
            if (mode !== 'drawing') return;
            const mod = e.ctrlKey || e.metaKey;
            if (mod && !e.altKey) {
                const key = String(e.key || '').toLowerCase();
                if (key === 'z' && e.shiftKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    redoStrokes();
                    return;
                }
                if (key === 'y') {
                    e.preventDefault();
                    e.stopPropagation();
                    redoStrokes();
                    return;
                }
                if (key === 'z') {
                    e.preventDefault();
                    e.stopPropagation();
                    undoStrokes();
                    return;
                }
            }
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            // Esc unfreezes and keeps ink when present.
            ColorPicker.close();
            setMode(strokes.length || activeStroke?.points?.length ? 'ink' : 'off');
        }, true);
    }
}

/**
 * Enter drawing (freeze) mode, or resume from ink-visible.
 */
export function enter() {
    ensureDom();
    bindEvents();
    setMode('drawing');
    rootEl?.setAttribute('aria-hidden', 'false');
}

/**
 * Unfreeze and keep ink visible (or exit if empty).
 */
export function done() {
    if (mode !== 'drawing') return;
    ColorPicker.close();
    setMode(strokes.length || activeStroke?.points?.length ? 'ink' : 'off');
    if (mode === 'off') rootEl?.setAttribute('aria-hidden', 'true');
}

/**
 * Flush strokes and leave scribble entirely.
 */
export function exit() {
    ColorPicker.close();
    setMode('off');
    rootEl?.setAttribute('aria-hidden', 'true');
}

/**
 * FAB click: Off → Drawing; Drawing → Ink (or Off if empty); Ink → Drawing.
 */
export function toggleFromFab() {
    ensureDom();
    bindEvents();
    if (mode === 'off') {
        enter();
        return;
    }
    if (mode === 'drawing') {
        done();
        return;
    }
    enter();
}

export function getMode() {
    return mode;
}

export function init() {
    ensureDom();
    bindEvents();
    syncUI();
}

export const QuickScribble = {
    init,
    enter,
    done,
    exit,
    toggleFromFab,
    getMode
};
