/** @module {"owns":"board px rulers chrome", "related":["displayOptions.js","desktopZoom.js","fileCabinet.js"], "events":[]} */
import { DesktopZoom } from './desktopZoom.js';

const RULER_SIZE_PX = 9;
const MINOR_STEP = 8;
const MAJOR_STEP = 32;
const MINOR_TICK = 2;
const MAJOR_TICK = 4;
const LABEL_MIN_GAP_PX = 20;

let frame = null;
let topRow = null;
let bodyRow = null;
let corner = null;
let rulerH = null;
let rulerV = null;
let canvasEl = null;
let readoutEl = null;
let bound = false;
let hoverBound = false;
let rafId = 0;
let resizeObserver = null;
let attrObserver = null;
/** @type {{ x: number|null, y: number|null }|null} */
let hoverCoord = null;

function rulersEnabled() {
    const root = document.documentElement;
    return root.dataset.showRulerH === '1' || root.dataset.showRulerV === '1';
}

function showH() {
    return document.documentElement.dataset.showRulerH === '1';
}

function showV() {
    return document.documentElement.dataset.showRulerV === '1';
}

function getZoom() {
    const fromCss = parseFloat(
        getComputedStyle(document.getElementById('workspace-main') || document.documentElement)
            .getPropertyValue('--desktop-zoom')
    );
    if (Number.isFinite(fromCss) && fromCss > 0) return fromCss;
    return DesktopZoom.getScale() || 1;
}

function rulerFontSpec() {
    const rootStyle = getComputedStyle(document.documentElement);
    const family = (
        rootStyle.getPropertyValue('--note-font-family').trim()
        || rootStyle.fontFamily
        || 'system-ui, sans-serif'
    );
    const scale = parseFloat(rootStyle.getPropertyValue('--note-font-scale')) || 1;
    const size = Math.max(4, Math.min(5, Math.round(4 * scale)));
    return { font: `${size}px ${family}` };
}

function cssColor(varName, fallback) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return raw || fallback;
}

function ensureFrame() {
    const surface = document.getElementById('desktop-surface');
    const canvas = document.getElementById('app-canvas');
    if (!surface || !canvas) return null;

    frame = document.getElementById('board-ruler-frame');
    const existingBody = frame?.querySelector('.board-ruler-body');
    const structureOk = Boolean(frame && existingBody?.contains(canvas));

    if (structureOk) {
        topRow = frame.querySelector('.board-ruler-top');
        bodyRow = existingBody;
        corner = frame.querySelector('.board-ruler-corner');
        rulerH = frame.querySelector('.board-ruler--h');
        rulerV = frame.querySelector('.board-ruler--v');
        canvasEl = canvas;
        ensureReadout();
        return frame;
    }

    if (frame) {
        if (frame.contains(canvas)) frame.before(canvas);
        frame.remove();
        frame = null;
    }

    frame = document.createElement('div');
    frame.id = 'board-ruler-frame';
    frame.className = 'board-ruler-frame';
    frame.setAttribute('aria-hidden', 'true');

    topRow = document.createElement('div');
    topRow.className = 'board-ruler-top';

    corner = document.createElement('div');
    corner.className = 'board-ruler-corner';

    rulerH = document.createElement('canvas');
    rulerH.className = 'board-ruler board-ruler--h';
    rulerH.setAttribute('aria-hidden', 'true');

    topRow.append(corner, rulerH);

    bodyRow = document.createElement('div');
    bodyRow.className = 'board-ruler-body';

    rulerV = document.createElement('canvas');
    rulerV.className = 'board-ruler board-ruler--v';
    rulerV.setAttribute('aria-hidden', 'true');

    canvas.parentNode.insertBefore(frame, canvas);
    bodyRow.append(rulerV, canvas);
    frame.append(topRow, bodyRow);
    canvasEl = canvas;
    ensureReadout();
    return frame;
}

function ensureReadout() {
    if (!frame) return null;
    readoutEl = frame.querySelector('.board-ruler-readout');
    if (readoutEl) return readoutEl;
    readoutEl = document.createElement('div');
    readoutEl.className = 'board-ruler-readout is-hidden';
    readoutEl.setAttribute('aria-hidden', 'true');
    frame.appendChild(readoutEl);
    return readoutEl;
}

function setHoverCoord(next) {
    const prev = hoverCoord;
    hoverCoord = next;
    const same = prev
        && next
        && prev.x === next.x
        && prev.y === next.y;
    if (same) return;
    if (!prev && !next) return;
    updateReadout();
    schedulePaint();
}

function clearHoverCoord() {
    setHoverCoord(null);
}

function contentXFromScreen(clientX, el) {
    if (!canvasEl) return 0;
    const zoom = getZoom();
    const rect = el.getBoundingClientRect();
    return Math.round(canvasEl.scrollLeft + (clientX - rect.left) / zoom);
}

function contentYFromScreen(clientY, el) {
    if (!canvasEl) return 0;
    const zoom = getZoom();
    const rect = el.getBoundingClientRect();
    return Math.round(canvasEl.scrollTop + (clientY - rect.top) / zoom);
}

function updateReadout() {
    const el = ensureReadout();
    if (!el || !frame || !canvasEl) return;
    if (!hoverCoord || (!showH() && !showV())) {
        el.classList.add('is-hidden');
        el.textContent = '';
        return;
    }

    const hasX = showH() && hoverCoord.x != null;
    const hasY = showV() && hoverCoord.y != null;
    if (!hasX && !hasY) {
        el.classList.add('is-hidden');
        el.textContent = '';
        return;
    }

    /* Single-axis style: "128px". Both axes: "128, 64" (no ×). */
    if (hasX && hasY) el.textContent = `${hoverCoord.x}, ${hoverCoord.y}`;
    else if (hasX) el.textContent = `${hoverCoord.x}px`;
    else el.textContent = `${hoverCoord.y}px`;
    el.classList.remove('is-hidden');

    const zoom = getZoom();
    const frameRect = frame.getBoundingClientRect();
    let left = 8;
    let top = 8;

    if (hasX && rulerH) {
        const hr = rulerH.getBoundingClientRect();
        left = hr.left - frameRect.left + (hoverCoord.x - canvasEl.scrollLeft) * zoom + 6;
        top = hr.top - frameRect.top + hr.height + 3;
    } else if (hasY && rulerV) {
        const vr = rulerV.getBoundingClientRect();
        left = vr.left - frameRect.left + vr.width + 3;
        top = vr.top - frameRect.top + (hoverCoord.y - canvasEl.scrollTop) * zoom + 4;
    }

    const maxL = Math.max(0, frame.clientWidth - Math.max(el.offsetWidth, 32) - 4);
    const maxT = Math.max(0, frame.clientHeight - Math.max(el.offsetHeight, 16) - 4);
    el.style.left = `${Math.max(0, Math.min(maxL, left))}px`;
    el.style.top = `${Math.max(0, Math.min(maxT, top))}px`;
}

function drawHoverMarkerH(ctx, w, h, start, zoom, xPx) {
    if (xPx == null) return;
    const x = (xPx - start) * zoom + 0.5;
    if (x < -1 || x > w + 1) return;
    ctx.strokeStyle = cssColor('--accent', '#4f46e5');
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
}

function drawHoverMarkerV(ctx, w, h, start, zoom, yPx) {
    if (yPx == null) return;
    const y = (yPx - start) * zoom + 0.5;
    if (y < -1 || y > h + 1) return;
    ctx.strokeStyle = cssColor('--accent', '#4f46e5');
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
}

function resizeCanvas(el, cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(cssW));
    const h = Math.max(1, Math.round(cssH));
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (el.width !== pw || el.height !== ph) {
        el.width = pw;
        el.height = ph;
    }
    el.style.width = '100%';
    el.style.height = '100%';
    const ctx = el.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
}

function paintHorizontal(ctx, w, h, start, end, zoom) {
    const tick = cssColor('--text-muted', '#8b8b93');
    const { font } = rulerFontSpec();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = cssColor('--bg-surface', '#121214');
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = tick;
    ctx.fillStyle = tick;
    ctx.lineWidth = 1;
    ctx.font = font;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    let lastLabelX = -Infinity;
    const first = Math.floor(start / MINOR_STEP) * MINOR_STEP;
    const labelY = Math.max(3, Math.round((h - MAJOR_TICK) / 2));
    for (let px = first; px <= end + MINOR_STEP; px += MINOR_STEP) {
        const x = (px - start) * zoom + 0.5;
        if (x < -1 || x > w + 1) continue;
        const major = px % MAJOR_STEP === 0;
        const tickH = major ? MAJOR_TICK : MINOR_TICK;
        ctx.globalAlpha = major ? 0.9 : 0.4;
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x, h - tickH);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (major && w > 48 && x - lastLabelX >= LABEL_MIN_GAP_PX) {
            ctx.fillText(String(px), x - 1, labelY);
            lastLabelX = x;
        }
    }

    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (hoverCoord?.x != null) drawHoverMarkerH(ctx, w, h, start, zoom, hoverCoord.x);
}

function paintVertical(ctx, w, h, start, end, zoom) {
    const tick = cssColor('--text-muted', '#8b8b93');
    const { font } = rulerFontSpec();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = cssColor('--bg-surface', '#121214');
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = tick;
    ctx.fillStyle = tick;
    ctx.lineWidth = 1;
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    let lastLabelY = -Infinity;
    const first = Math.floor(start / MINOR_STEP) * MINOR_STEP;
    for (let px = first; px <= end + MINOR_STEP; px += MINOR_STEP) {
        const y = (px - start) * zoom + 0.5;
        if (y < -1 || y > h + 1) continue;
        const major = px % MAJOR_STEP === 0;
        const tickW = major ? MAJOR_TICK : MINOR_TICK;
        ctx.globalAlpha = major ? 0.9 : 0.4;
        ctx.beginPath();
        ctx.moveTo(w, y);
        ctx.lineTo(w - tickW, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (major && h > 48 && y - lastLabelY >= LABEL_MIN_GAP_PX) {
            ctx.fillText(String(px), 1, y - 1);
            lastLabelY = y;
        }
    }

    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(w - 0.5, 0);
    ctx.lineTo(w - 0.5, h);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (hoverCoord?.y != null) drawHoverMarkerV(ctx, w, h, start, zoom, hoverCoord.y);
}

function paint() {
    rafId = 0;
    if (!frame || !canvasEl) return;
    if (!rulersEnabled()) return;

    const zoom = getZoom();
    const startX = canvasEl.scrollLeft;
    const startY = canvasEl.scrollTop;
    const viewW = Math.max(1, canvasEl.clientWidth / zoom);
    const viewH = Math.max(1, canvasEl.clientHeight / zoom);

    if (showH() && rulerH) {
        const rect = rulerH.getBoundingClientRect();
        const cssW = Math.max(1, rect.width || rulerH.clientWidth || 1);
        const cssH = Math.max(1, rect.height || RULER_SIZE_PX);
        const { ctx, w, h } = resizeCanvas(rulerH, cssW, cssH);
        paintHorizontal(ctx, w, h, startX, startX + viewW, zoom);
    }

    if (showV() && rulerV) {
        const rect = rulerV.getBoundingClientRect();
        const cssW = Math.max(1, rect.width || RULER_SIZE_PX);
        const cssH = Math.max(1, rect.height || rulerV.clientHeight || 1);
        const { ctx, w, h } = resizeCanvas(rulerV, cssW, cssH);
        paintVertical(ctx, w, h, startY, startY + viewH, zoom);
    }

    if (hoverCoord) updateReadout();
}

function schedulePaint() {
    if (!rulersEnabled()) return;
    if (rafId) return;
    rafId = requestAnimationFrame(paint);
}

function onRulerHMove(e) {
    if (!showH() || !canvasEl) return;
    setHoverCoord({
        x: contentXFromScreen(e.clientX, rulerH),
        y: null
    });
}

function onRulerVMove(e) {
    if (!showV() || !canvasEl) return;
    setHoverCoord({
        x: null,
        y: contentYFromScreen(e.clientY, rulerV)
    });
}

function bindHover() {
    if (hoverBound) return;
    hoverBound = true;
    document.addEventListener('pointermove', (e) => {
        if (!rulersEnabled() || !canvasEl) return;
        const t = e.target;
        if (!(t instanceof Element)) return;
        if (rulerH?.isConnected && (t === rulerH || rulerH.contains(t))) {
            onRulerHMove(e);
            return;
        }
        if (rulerV?.isConnected && (t === rulerV || rulerV.contains(t))) {
            onRulerVMove(e);
            return;
        }
        /* Board / elsewhere: no cursor chip — only ruler hover shows readout */
        if (readoutEl && (t === readoutEl || readoutEl.contains(t))) return;
        clearHoverCoord();
    }, { passive: true });
}

function syncVisibility() {
    ensureFrame();
    if (!frame) return;
    frame.classList.toggle('is-ruler-h', showH());
    frame.classList.toggle('is-ruler-v', showV());
    frame.classList.toggle('is-active', rulersEnabled());
    if (!rulersEnabled()) clearHoverCoord();
    requestAnimationFrame(() => schedulePaint());
}

function onScroll() {
    schedulePaint();
}

function bindCanvas() {
    const canvas = document.getElementById('app-canvas');
    if (!canvas) return;
    if (canvasEl && canvasEl !== canvas) {
        canvasEl.removeEventListener('scroll', onScroll);
    }
    canvasEl = canvas;
    canvasEl.addEventListener('scroll', onScroll, { passive: true });
}

function observeRulers() {
    if (!resizeObserver) return;
    [frame, bodyRow, canvasEl, rulerH, rulerV].forEach((el) => {
        if (!el) return;
        try { resizeObserver.observe(el); } catch { /* already */ }
    });
}

export const BoardRulers = {
    init() {
        if (bound) {
            syncVisibility();
            return;
        }
        bound = true;
        ensureFrame();
        bindCanvas();
        bindHover();
        syncVisibility();

        resizeObserver = new ResizeObserver(() => schedulePaint());
        observeRulers();

        attrObserver = new MutationObserver(() => syncVisibility());
        attrObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-show-ruler-h', 'data-show-ruler-v']
        });

        window.addEventListener('resize', schedulePaint);
        window.addEventListener('desktop:zoom_changed', schedulePaint);
        window.addEventListener('tools:desktop_bounds_changed', schedulePaint);
        window.addEventListener('filecabinet:layout_changed', () => {
            ensureFrame();
            bindCanvas();
            observeRulers();
            syncVisibility();
        });
        window.addEventListener('customization:reset', syncVisibility);
        window.addEventListener('app:theme_changed', schedulePaint);
        window.addEventListener('note:font_scale_changed', schedulePaint);
    },

    sync: syncVisibility
};
