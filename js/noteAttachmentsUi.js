/** @module {"owns":"note card attached-media section HTML and hydrate", "related":["noteAttachmentsUi/media.js","noteAttachmentsUi/canvas.js","noteAttachmentsUi/shared.js","noteAttachmentsUi/lightboxMath.js","mediaAttachments.js","mediaLibrary.js","noteSurfaceHtml.js","mediaLibraryOverlay.js","mediaQuickActions.js","scribbleInk.js"]} */
import { CARD_ICONS, ACTION_ICONS, DRAWING_ICONS } from './icons.js';
import { getMediaMeta, getObjectUrl, releaseObjectUrl } from './mediaLibrary.js';
import { drawBrushStroke } from './canvasBrushes.js';
import { showAppToast } from './toast.js';
import { ColorPicker, PALETTE_UNIFIED } from './colorPicker.js';
import {
    SCRIBBLE_WIDTH_DEFAULT,
    getScribbleColor,
    setScribbleCustomColor
} from './scribbleInk.js';
import {
    LIGHTBOX_ZOOM_MIN,
    LIGHTBOX_ZOOM_MAX,
    normalizeLightboxRotation,
    rotateLightboxStep,
    clampLightboxZoom,
    nextLightboxZoom,
    anchorLightboxPan,
    lightboxFitScaleForRotation,
    lightboxCanPan,
    LIGHTBOX_DOODLE_COLORS,
    LIGHTBOX_DOODLE_CUSTOM_INDEX,
    LIGHTBOX_DOODLE_WIDTH,
    LIGHTBOX_DOODLE_WIDTH_MIN,
    LIGHTBOX_DOODLE_WIDTH_MAX,
    LIGHTBOX_DOODLE_WIDTH_DEFAULT,
    clampLightboxDoodleWidth,
    stepLightboxDoodleWidth,
    normalizeLightboxDoodleColor,
    eraseLightboxDoodlesAt,
    normalizeLightboxDoodlePoint,
    lightboxDoodleToLayout,
    lightboxDoodleFromVisual,
    lightboxDoodleToVisual
} from './noteAttachmentsUi/lightboxMath.js';

// Facade: lightbox math lives in ./noteAttachmentsUi/lightboxMath.js. The
// public surface stays exported from this module so existing importers and
// tests keep resolving the same names.
export {
    LIGHTBOX_ZOOM_MIN,
    LIGHTBOX_ZOOM_MAX,
    normalizeLightboxRotation,
    rotateLightboxStep,
    clampLightboxZoom,
    nextLightboxZoom,
    anchorLightboxPan,
    lightboxFitScaleForRotation,
    lightboxCanPan,
    LIGHTBOX_DOODLE_COLORS,
    LIGHTBOX_DOODLE_CUSTOM_INDEX,
    LIGHTBOX_DOODLE_WIDTH,
    LIGHTBOX_DOODLE_WIDTH_MIN,
    LIGHTBOX_DOODLE_WIDTH_MAX,
    LIGHTBOX_DOODLE_WIDTH_DEFAULT,
    clampLightboxDoodleWidth,
    stepLightboxDoodleWidth,
    normalizeLightboxDoodleColor,
    eraseLightboxDoodlesAt,
    normalizeLightboxDoodlePoint,
    lightboxDoodleToLayout,
    lightboxDoodleFromVisual,
    lightboxDoodleToVisual
};

let lightboxEl = null;
let lightboxBound = false;
let lightboxZoom = LIGHTBOX_ZOOM_MIN;
let lightboxPanX = 0;
let lightboxPanY = 0;
let lightboxPanning = false;
let lightboxPanStartX = 0;
let lightboxPanStartY = 0;
let lightboxPanBaseX = 0;
let lightboxPanBaseY = 0;
/** Preview-only rotation in degrees (0/90/180/270). Never persisted. */
let lightboxRotation = 0;
/**
 * Auto-shrink so a rotated preview fits the viewport (1 = no shrink).
 * Wide panoramas at 90/270 would otherwise overflow and clip.
 */
let lightboxFitScale = 1;
/** Preview-only scribble state. Strokes live in memory; never persisted. */
let lightboxDoodleMode = false;
let lightboxDoodleColorIndex = 0;
/** @type {'pen'|'eraser'} */
let lightboxDoodleTool = 'pen';
/** Pen width in image-layout CSS px (same idea as magicCanvas brush width). */
let lightboxDoodleWidth = SCRIBBLE_WIDTH_DEFAULT;
let lightboxDoodles = [];
let lightboxActiveStroke = null;
/** Cached untransformed image layout box ({w,h} in CSS px). */
let lightboxLayoutCache = { w: 0, h: 0 };

function lightboxImg() {
    return lightboxEl?.querySelector?.('[data-lightbox-img]') || null;
}

function lightboxFrame() {
    return lightboxEl?.querySelector?.('[data-lightbox-frame]') || null;
}

function lightboxZoomBadge() {
    return lightboxEl?.querySelector?.('[data-lightbox-zoom]') || null;
}

function applyLightboxTransform() {
    const img = lightboxImg();
    const frame = lightboxFrame();
    const badge = lightboxZoomBadge();
    if (!img || !frame) return;
    const rot = normalizeLightboxRotation(lightboxRotation);
    const rotated = rot !== 0;
    // Swap the CSS fit box only when the visual footprint is h×w.
    const swappedFootprint = rot === 90 || rot === 270;
    const zoomed = lightboxZoom > LIGHTBOX_ZOOM_MIN + 1e-9;
    const effectiveZoom = lightboxZoom * lightboxFitScale;
    if (!zoomed && !rotated) {
        img.style.transform = '';
        img.style.transformOrigin = '';
        img.style.cursor = '';
    } else if (rotated) {
        // Center-origin keeps 90/270-degree previews centered. Pan stays
        // outermost so drag deltas map 1:1 to screen axes at any rotation;
        // zoom-while-rotated anchors to the image center. Always keep an
        // explicit rotate(Ndeg) so wraparound never depends on clearing
        // the transform string (empty → 270deg would animate the long way).
        img.style.transformOrigin = 'center';
        img.style.transform = `translate(${lightboxPanX}px, ${lightboxPanY}px) rotate(${rot}deg) scale(${effectiveZoom})`;
        img.style.cursor = lightboxPanning ? 'grabbing' : 'grab';
    } else {
        img.style.transformOrigin = '0 0';
        img.style.transform = `translate(${lightboxPanX}px, ${lightboxPanY}px) scale(${lightboxZoom})`;
        img.style.cursor = lightboxPanning ? 'grabbing' : 'grab';
    }
    frame.classList.toggle('is-zoomed', zoomed);
    frame.classList.toggle('is-rotated', swappedFootprint);
    // The doodle overlay paints in pan-free frame coordinates; the canvas
    // element itself rides the same translate so ink tracks the image
    // during drag-pans without a repaint per pointermove.
    const doodle = lightboxDoodleCanvas();
    if (doodle) {
        doodle.style.transform = (lightboxPanX || lightboxPanY)
            ? `translate(${lightboxPanX}px, ${lightboxPanY}px)`
            : '';
    }
    if (badge) {
        const pct = Math.round(lightboxZoom * 100);
        badge.textContent = `${pct}%`;
        badge.classList.toggle('is-visible', zoomed);
    }
}

function measureLightboxFit() {
    const img = lightboxImg();
    const frame = lightboxFrame();
    if (!img || !frame) {
        lightboxFitScale = 1;
        return;
    }
    const rot = normalizeLightboxRotation(lightboxRotation);
    if (rot !== 90 && rot !== 270) {
        lightboxFitScale = 1;
        return;
    }
    // offsetWidth/Height are the untransformed layout box — never clear
    // style.transform to measure (that used to flash through CSS transitions).
    const w = img.offsetWidth || img.naturalWidth || 0;
    const h = img.offsetHeight || img.naturalHeight || 0;
    const fw = frame.clientWidth || frame.offsetWidth || 0;
    const fh = frame.clientHeight || frame.offsetHeight || 0;
    lightboxFitScale = lightboxFitScaleForRotation(rot, w, h, fw, fh);
}

/**
 * Untransformed image layout box in CSS px (cached for doodle mapping).
 * @returns {{ w: number, h: number }}
 */
export function measureLightboxLayout() {
    const img = typeof lightboxImg === 'function' ? lightboxImg() : null;
    // Prefer layout sizes that ignore CSS transforms; never toggle transform.
    let w = img?.offsetWidth || 0;
    let h = img?.offsetHeight || 0;
    if ((!w || !h) && img) {
        w = w || img.naturalWidth || img.width || 0;
        h = h || img.naturalHeight || img.height || 0;
    }
    lightboxLayoutCache = { w: Number(w) || 0, h: Number(h) || 0 };
    return lightboxLayoutCache;
}

function lightboxDoodleCanvas() {
    return lightboxEl?.querySelector?.('[data-lightbox-doodle]') || null;
}

function lightboxDoodleBar() {
    return lightboxEl?.querySelector?.('[data-lightbox-doodle-bar]') || null;
}

/**
 * Size the doodle canvas to the image's rendered (visual incl. zoom/fit,
 * excl. pan) footprint and position it over the image.
 * @returns {{ canvas: HTMLCanvasElement, dpr: number, w: number, h: number } | null}
 */
function sizeLightboxDoodleCanvas() {
    const canvas = lightboxDoodleCanvas();
    const img = lightboxImg();
    const frame = lightboxFrame();
    if (!canvas || !img || !frame) return null;
    if (lightboxEl?.classList?.contains('is-hidden')) return null;
    const layout = measureLightboxLayout();
    const rot = normalizeLightboxRotation(lightboxRotation);
    const effZoom = (Number(lightboxZoom) || 1) * (Number(lightboxFitScale) || 1);
    const baseW = (rot === 90 || rot === 270) ? layout.h : layout.w;
    const baseH = (rot === 90 || rot === 270) ? layout.w : layout.h;
    const w = Math.max(1, Math.round(baseW * effZoom));
    const h = Math.max(1, Math.round(baseH * effZoom));
    if (w <= 1 || h <= 1) return null;
    const dpr = Math.min(3, Math.max(1, Number(window?.devicePixelRatio) || 1));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const frameRect = frame.getBoundingClientRect?.();
    const imgRect = img.getBoundingClientRect?.();
    if (frameRect && imgRect) {
        // Visual rect includes pan; subtract it — pan rides on the canvas
        // element transform instead (see applyLightboxTransform).
        canvas.style.left = `${(imgRect.left - frameRect.left) - lightboxPanX}px`;
        canvas.style.top = `${(imgRect.top - frameRect.top) - lightboxPanY}px`;
    }
    return { canvas, dpr, w, h };
}

/**
 * Repaint preview-only doodles. Stored normalized (0..1); mapped here to
 * visual pixels (rotate then scale by effective zoom) so ink sits on the
 * displayed pixels exactly.
 */
function paintLightboxDoodles() {
    const sized = sizeLightboxDoodleCanvas();
    if (!sized) return;
    const { canvas, dpr, w, h } = sized;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;
    const layout = lightboxLayoutCache;
    if (!layout.w || !layout.h) return;
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    const rot = normalizeLightboxRotation(lightboxRotation);
    const effZoom = (Number(lightboxZoom) || 1) * (Number(lightboxFitScale) || 1);
    const strokes = Array.isArray(lightboxDoodles) ? lightboxDoodles.slice() : [];
    if (lightboxActiveStroke?.points?.length) strokes.push(lightboxActiveStroke);
    for (const stroke of strokes) {
        const pts = Array.isArray(stroke?.points) ? stroke.points : [];
        if (!pts.length) continue;
        const mapped = [];
        for (const pt of pts) {
            const base = lightboxDoodleToLayout(pt, layout.w, layout.h);
            const vis = lightboxDoodleToVisual(base.x, base.y, layout.w, layout.h, rot);
            mapped.push({
                x: vis.x * effZoom,
                y: vis.y * effZoom,
                p: Number.isFinite(Number(pt?.p)) ? Number(pt.p) : 0.5
            });
        }
        drawBrushStroke(ctx, {
            points: mapped,
            color: stroke.color,
            // Width is image-layout px; scale with zoom so thickness tracks the photo.
            width: Math.max(1, (Number(stroke.width) || lightboxDoodleWidth || LIGHTBOX_DOODLE_WIDTH_DEFAULT) * effZoom),
            style: 'pen'
        });
    }
    ctx.restore();
}

/**
 * Map a doodle-canvas pointer event to normalized (0..1) image coords.
 * Inverse of the paint path: unscale zoom, then unrotate.
 * @param {PointerEvent} e
 * @returns {{ x: number, y: number } | null}
 */
function lightboxDoodlePointFromEvent(e) {
    const canvas = lightboxDoodleCanvas();
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return null;
    const layout = (lightboxLayoutCache.w && lightboxLayoutCache.h)
        ? lightboxLayoutCache
        : measureLightboxLayout();
    if (!layout.w || !layout.h) return null;
    const rot = normalizeLightboxRotation(lightboxRotation);
    const effZoom = (Number(lightboxZoom) || 1) * (Number(lightboxFitScale) || 1) || 1;
    const visX = ((Number(e?.clientX) || 0) - rect.left) / effZoom;
    const visY = ((Number(e?.clientY) || 0) - rect.top) / effZoom;
    const base = lightboxDoodleFromVisual(visX, visY, layout.w, layout.h, rot);
    return normalizeLightboxDoodlePoint(base.x / layout.w, base.y / layout.h);
}

function syncLightboxDoodleUI() {
    const frame = lightboxFrame();
    const penBtn = lightboxEl?.querySelector?.('[data-lightbox-doodle-toggle]') || null;
    const bar = lightboxDoodleBar();
    const canvas = lightboxDoodleCanvas();
    const hint = lightboxEl?.querySelector?.('[data-lightbox-hint]') || null;
    frame?.classList.toggle('is-doodling', !!lightboxDoodleMode);
    frame?.classList.toggle('is-erasing', !!lightboxDoodleMode && lightboxDoodleTool === 'eraser');
    if (penBtn) {
        penBtn.classList.toggle('is-active', !!lightboxDoodleMode);
        penBtn.setAttribute('aria-pressed', lightboxDoodleMode ? 'true' : 'false');
    }
    if (bar) bar.hidden = !lightboxDoodleMode;
    if (canvas) {
        canvas.style.display = lightboxDoodleMode ? '' : 'none';
        canvas.style.pointerEvents = lightboxDoodleMode ? 'auto' : 'none';
    }
    syncLightboxDoodleWidthUI();
    syncLightboxDoodleToolUI();
    syncLightboxDoodleColorUI();
    if (hint) {
        hint.textContent = lightboxDoodleMode
            ? (lightboxDoodleTool === 'eraser'
                ? 'Erase scribbles · Scroll to zoom'
                : 'Draw to scribble (preview only) · Scroll to zoom · Pick a color below')
            : 'Scroll to zoom · Drag to pan · Double-click to reset';
    }
}

function syncLightboxDoodleWidthUI() {
    const width = clampLightboxDoodleWidth(lightboxDoodleWidth);
    lightboxDoodleWidth = width;
    const label = lightboxEl?.querySelector?.('[data-lightbox-doodle-width]') || null;
    if (label) label.textContent = `${width}px`;
    const smaller = lightboxEl?.querySelector?.('[data-lightbox-doodle-smaller]') || null;
    const larger = lightboxEl?.querySelector?.('[data-lightbox-doodle-larger]') || null;
    if (smaller) smaller.disabled = width <= LIGHTBOX_DOODLE_WIDTH_MIN;
    if (larger) larger.disabled = width >= LIGHTBOX_DOODLE_WIDTH_MAX;
}

function syncLightboxDoodleToolUI() {
    const bar = lightboxDoodleBar();
    const eraser = bar?.querySelector?.('[data-lightbox-doodle-eraser]') || null;
    if (eraser) {
        const on = lightboxDoodleTool === 'eraser';
        eraser.classList.toggle('is-active', on);
        eraser.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
}

function syncLightboxDoodleColorUI() {
    const bar = lightboxDoodleBar();
    bar?.querySelectorAll?.('[data-lightbox-doodle-color]')?.forEach?.((btn) => {
        const idx = Number(btn?.dataset?.lightboxDoodleColor);
        const active = idx === lightboxDoodleColorIndex && lightboxDoodleTool === 'pen';
        btn.classList.toggle('is-active', active);
        if (active) btn.setAttribute('aria-pressed', 'true');
        else btn.removeAttribute('aria-pressed');
        if (idx === LIGHTBOX_DOODLE_CUSTOM_INDEX) {
            btn.style.setProperty('--doodle-color', getScribbleColor(LIGHTBOX_DOODLE_CUSTOM_INDEX));
            btn.title = 'Custom color';
            btn.setAttribute('aria-label', 'Custom pen color');
        }
    });
}

function setLightboxDoodleWidth(next) {
    lightboxDoodleWidth = clampLightboxDoodleWidth(next);
    syncLightboxDoodleWidthUI();
}

function adjustLightboxDoodleWidth(delta) {
    setLightboxDoodleWidth(stepLightboxDoodleWidth(lightboxDoodleWidth, delta));
}

function setLightboxDoodleMode(on) {
    lightboxDoodleMode = !!on;
    if (!lightboxDoodleMode) {
        if (lightboxActiveStroke?.points?.length) {
            lightboxDoodles.push(lightboxActiveStroke);
        }
        lightboxActiveStroke = null;
        ColorPicker.close();
    }
    syncLightboxDoodleUI();
    paintLightboxDoodles();
}

function setLightboxDoodleTool(tool) {
    lightboxDoodleTool = tool === 'eraser' ? 'eraser' : 'pen';
    if (lightboxDoodleTool === 'pen') ColorPicker.close();
    syncLightboxDoodleUI();
}

/**
 * @param {unknown} index
 * @param {{ openPicker?: boolean }} [opts]
 */
function setLightboxDoodleColor(index, opts = {}) {
    const next = normalizeLightboxDoodleColor(index);
    const wasActive = next === lightboxDoodleColorIndex && lightboxDoodleTool === 'pen';
    lightboxDoodleColorIndex = next;
    lightboxDoodleTool = 'pen';
    syncLightboxDoodleUI();
    const wantPicker = !!opts.openPicker
        || (wasActive && next === LIGHTBOX_DOODLE_CUSTOM_INDEX);
    if (wantPicker && next === LIGHTBOX_DOODLE_CUSTOM_INDEX) {
        openLightboxCustomColorPicker();
    } else if (next !== LIGHTBOX_DOODLE_CUSTOM_INDEX) {
        ColorPicker.close();
    }
}

function openLightboxCustomColorPicker() {
    const bar = lightboxDoodleBar();
    const chip = bar?.querySelector?.(`[data-lightbox-doodle-color="${LIGHTBOX_DOODLE_CUSTOM_INDEX}"]`) || null;
    if (!chip) return;
    ColorPicker.open({
        anchor: chip,
        presets: PALETTE_UNIFIED,
        value: getScribbleColor(LIGHTBOX_DOODLE_CUSTOM_INDEX),
        align: 'center',
        onSelect: (hex) => {
            setScribbleCustomColor(hex);
            syncLightboxDoodleColorUI();
        }
    });
}

function eraseLightboxAtEvent(e) {
    const pt = lightboxDoodlePointFromEvent(e);
    if (!pt) return;
    const layout = (lightboxLayoutCache.w > 0 && lightboxLayoutCache.h > 0)
        ? lightboxLayoutCache
        : measureLightboxLayout();
    if (!layout.w || !layout.h) return;
    const lx = pt.x * layout.w;
    const ly = pt.y * layout.h;
    const radius = clampLightboxDoodleWidth(lightboxDoodleWidth);
    const next = eraseLightboxDoodlesAt(lightboxDoodles, lx, ly, radius, {
        scaleX: layout.w,
        scaleY: layout.h
    });
    if (next.length !== lightboxDoodles.length) {
        lightboxDoodles = next;
        paintLightboxDoodles();
    }
}

function clearLightboxDoodles() {
    lightboxDoodles = [];
    lightboxActiveStroke = null;
    paintLightboxDoodles();
}

function resetLightboxZoom() {
    lightboxZoom = LIGHTBOX_ZOOM_MIN;
    lightboxPanX = 0;
    lightboxPanY = 0;
    lightboxPanning = false;
    lightboxRotation = 0;
    lightboxFitScale = 1;
    // Preview-only scribbles never survive open/close.
    lightboxDoodleMode = false;
    lightboxDoodleTool = 'pen';
    lightboxDoodles = [];
    lightboxActiveStroke = null;
    lightboxLayoutCache = { w: 0, h: 0 };
    ColorPicker.close();
    applyLightboxTransform();
    syncLightboxDoodleUI();
    paintLightboxDoodles();
}

function rotateLightboxPreview(dir) {
    lightboxRotation = rotateLightboxStep(lightboxRotation, dir);
    // Recenter pan on rotation so the preview stays framed; drag re-pans.
    lightboxPanX = 0;
    lightboxPanY = 0;
    measureLightboxFit();
    applyLightboxTransform();
    paintLightboxDoodles();
}

function zoomLightboxAtPoint(clientX, clientY, nextZoom) {
    const img = lightboxImg();
    if (!img) return;
    const prevZoom = lightboxZoom;
    const clamped = clampLightboxZoom(nextZoom);
    if (clamped === prevZoom) {
        // Still re-apply so hitting the min snaps back to unzoomed layout.
        if (clamped <= LIGHTBOX_ZOOM_MIN + 1e-9) {
            lightboxPanX = 0;
            lightboxPanY = 0;
            lightboxZoom = clamped;
            applyLightboxTransform();
        }
        return;
    }
    if (lightboxRotation !== 0) {
        // While rotated, zoom anchors to the image center (cursor-anchored
        // zoom would need axis-swapped math for 90/270-degree previews).
        lightboxZoom = clamped;
        if (lightboxZoom <= LIGHTBOX_ZOOM_MIN + 1e-9) {
            lightboxPanX = 0;
            lightboxPanY = 0;
        }
        applyLightboxTransform();
        paintLightboxDoodles();
        return;
    }
    const rect = img.getBoundingClientRect();
    const cursorX = (Number(clientX) || 0) - (rect?.left || 0);
    const cursorY = (Number(clientY) || 0) - (rect?.top || 0);
    const anchored = anchorLightboxPan({
        panX: lightboxPanX,
        panY: lightboxPanY,
        cursorX,
        cursorY,
        prevZoom,
        nextZoom: clamped
    });
    lightboxZoom = clamped;
    if (lightboxZoom <= LIGHTBOX_ZOOM_MIN + 1e-9) {
        lightboxPanX = 0;
        lightboxPanY = 0;
    } else {
        lightboxPanX = anchored.panX;
        lightboxPanY = anchored.panY;
    }
    applyLightboxTransform();
    paintLightboxDoodles();
}

function ensureLightbox() {
    if (lightboxEl) return lightboxEl;
    lightboxEl = document.createElement('div');
    lightboxEl.id = 'media-lightbox';
    lightboxEl.className = 'media-lightbox is-hidden';
    lightboxEl.setAttribute('role', 'dialog');
    lightboxEl.setAttribute('aria-modal', 'true');
    lightboxEl.setAttribute('aria-label', 'Image preview');
    lightboxEl.innerHTML = `
        <button type="button" class="media-lightbox__backdrop" data-lightbox-close aria-label="Close"></button>
        <div class="media-lightbox__frame" data-lightbox-frame>
            <img class="media-lightbox__img" data-lightbox-img alt="" draggable="false">
            <canvas class="media-lightbox__doodle" data-lightbox-doodle style="display:none"></canvas>
            <div class="media-lightbox__chrome" data-lightbox-chrome>
                <div class="media-lightbox__doodle-bar" data-lightbox-doodle-bar hidden>
                    <button type="button" class="media-lightbox__doodle-dot is-active" data-lightbox-doodle-color="0" style="--doodle-color:#ff00ff" title="Pink" aria-label="Pink pen" aria-pressed="true"></button>
                    <button type="button" class="media-lightbox__doodle-dot" data-lightbox-doodle-color="1" style="--doodle-color:#00ff00" title="Green" aria-label="Green pen"></button>
                    <button type="button" class="media-lightbox__doodle-dot" data-lightbox-doodle-color="2" style="--doodle-color:#00ffff" title="Cyan" aria-label="Cyan pen"></button>
                    <button type="button" class="media-lightbox__doodle-dot media-lightbox__doodle-dot--custom" data-lightbox-doodle-color="3" style="--doodle-color:#ffaa00" title="Custom color" aria-label="Custom pen color">${CARD_ICONS.color}</button>
                    <button type="button" class="media-lightbox__doodle-tool" data-lightbox-doodle-eraser title="Eraser" aria-label="Eraser" aria-pressed="false">${DRAWING_ICONS.eraser}</button>
                    <span class="media-lightbox__doodle-size" aria-label="Pen size">
                        <button type="button" class="media-lightbox__doodle-size-btn" data-lightbox-doodle-smaller title="Decrease pen size" aria-label="Decrease pen size">${ACTION_ICONS.minus}</button>
                        <span class="media-lightbox__doodle-size-value" data-lightbox-doodle-width aria-live="polite">6px</span>
                        <button type="button" class="media-lightbox__doodle-size-btn" data-lightbox-doodle-larger title="Increase pen size" aria-label="Increase pen size">${ACTION_ICONS.plus}</button>
                    </span>
                    <button type="button" class="media-lightbox__doodle-clear" data-lightbox-doodle-clear title="Clear scribbles" aria-label="Clear scribbles">Clear</button>
                </div>
                <div class="media-lightbox__tools">
                    <button type="button" class="card-act" data-lightbox-doodle-toggle title="Scribble (preview only)" aria-label="Scribble (preview only)" aria-pressed="false">${CARD_ICONS.drawingPencil}</button>
                    <button type="button" class="card-act" data-lightbox-rotate-left title="Rotate left (preview only)" aria-label="Rotate left (preview only)">${CARD_ICONS.rotateLeft}</button>
                    <button type="button" class="card-act" data-lightbox-rotate-right title="Rotate right (preview only)" aria-label="Rotate right (preview only)">${CARD_ICONS.rotateRight}</button>
                    <button type="button" class="card-act media-lightbox__close" data-lightbox-close title="Close" aria-label="Close">${CARD_ICONS.close}</button>
                </div>
            </div>
            <div class="media-lightbox__zoom-badge" data-lightbox-zoom aria-hidden="true">100%</div>
            <div class="media-lightbox__hint" data-lightbox-hint aria-hidden="true">Scroll to zoom &middot; Drag to pan &middot; Double-click to reset</div>
        </div>
    `;
    document.body.appendChild(lightboxEl);

    if (!lightboxBound) {
        lightboxBound = true;
        lightboxEl.addEventListener('click', (e) => {
            const rotLeft = e.target.closest('[data-lightbox-rotate-left]');
            if (rotLeft) {
                e.preventDefault();
                e.stopPropagation();
                rotateLightboxPreview(-1);
                return;
            }
            const rotRight = e.target.closest('[data-lightbox-rotate-right]');
            if (rotRight) {
                e.preventDefault();
                e.stopPropagation();
                rotateLightboxPreview(1);
                return;
            }
            const doodleToggle = e.target.closest('[data-lightbox-doodle-toggle]');
            if (doodleToggle) {
                e.preventDefault();
                e.stopPropagation();
                setLightboxDoodleMode(!lightboxDoodleMode);
                return;
            }
            const doodleColor = e.target.closest('[data-lightbox-doodle-color]');
            if (doodleColor) {
                e.preventDefault();
                e.stopPropagation();
                const idx = Number(doodleColor.dataset?.lightboxDoodleColor);
                const already = idx === lightboxDoodleColorIndex && lightboxDoodleTool === 'pen';
                setLightboxDoodleColor(idx, {
                    openPicker: already && idx === LIGHTBOX_DOODLE_CUSTOM_INDEX
                });
                return;
            }
            if (e.target.closest('[data-lightbox-doodle-eraser]')) {
                e.preventDefault();
                e.stopPropagation();
                setLightboxDoodleTool(lightboxDoodleTool === 'eraser' ? 'pen' : 'eraser');
                return;
            }
            if (e.target.closest('[data-lightbox-doodle-clear]')) {
                e.preventDefault();
                e.stopPropagation();
                clearLightboxDoodles();
                return;
            }
            if (e.target.closest('[data-lightbox-doodle-smaller]')) {
                e.preventDefault();
                e.stopPropagation();
                adjustLightboxDoodleWidth(-1);
                return;
            }
            if (e.target.closest('[data-lightbox-doodle-larger]')) {
                e.preventDefault();
                e.stopPropagation();
                adjustLightboxDoodleWidth(1);
                return;
            }
            if (e.target.closest('[data-lightbox-close]')) {
                e.preventDefault();
                closeMediaLightbox();
            }
        });
        const frame = lightboxEl.querySelector('[data-lightbox-frame]');
        const zoomImg = lightboxEl.querySelector('[data-lightbox-img]');
        // Scroll over the image zooms in/out (page behind must not scroll).
        // Pen mode still zooms — scribble coords are normalized so ink stays put.
        frame?.addEventListener('wheel', (e) => {
            if (!lightboxEl || lightboxEl.classList.contains('is-hidden')) return;
            if (e.target?.closest?.('[data-lightbox-close],[data-lightbox-rotate-left],[data-lightbox-rotate-right],[data-lightbox-doodle-toggle],[data-lightbox-doodle-smaller],[data-lightbox-doodle-larger]')) return;
            e.preventDefault();
            e.stopPropagation();
            zoomLightboxAtPoint(e.clientX, e.clientY, nextLightboxZoom(lightboxZoom, e.deltaY, e.deltaMode));
        }, { passive: false });
        // Double-click resets; drag pans while zoomed or rotated (so a
        // rotated panorama can be dragged to reveal clipped edges).
        zoomImg?.addEventListener('dblclick', (e) => {
            // Pen mode locks the view; never reset away someone's ink.
            if (lightboxDoodleMode) return;
            e.preventDefault();
            resetLightboxZoom();
        });
        zoomImg?.addEventListener('pointerdown', (e) => {
            // Pen mode locks the view: the doodle canvas owns the pointer.
            if (lightboxDoodleMode) return;
            if (!lightboxCanPan(lightboxZoom, lightboxRotation)) return;
            if (e.button !== undefined && e.button !== 0) return;
            lightboxPanning = true;
            lightboxPanStartX = e.clientX;
            lightboxPanStartY = e.clientY;
            lightboxPanBaseX = lightboxPanX;
            lightboxPanBaseY = lightboxPanY;
            try { zoomImg.setPointerCapture(e.pointerId); } catch { /* noop */ }
            applyLightboxTransform();
            e.preventDefault();
        });
        zoomImg?.addEventListener('pointermove', (e) => {
            if (!lightboxPanning) return;
            lightboxPanX = lightboxPanBaseX + (e.clientX - lightboxPanStartX);
            lightboxPanY = lightboxPanBaseY + (e.clientY - lightboxPanStartY);
            applyLightboxTransform();
        });
        const endPan = () => {
            if (!lightboxPanning) return;
            lightboxPanning = false;
            applyLightboxTransform();
        };
        zoomImg?.addEventListener('pointerup', endPan);
        zoomImg?.addEventListener('pointercancel', endPan);
        // Preview-only scribble strokes (magic-canvas pen, neon + custom).
        const doodleCanvas = lightboxEl.querySelector('[data-lightbox-doodle]');
        let doodleErasing = false;
        const doodlePressure = (e) => {
            const raw = Number(e?.pressure);
            if (Number.isFinite(raw) && raw > 0) return Math.min(1, raw);
            if (e?.pointerType === 'mouse') return 0.6;
            return 0.5;
        };
        const doodleAppendPoint = (e) => {
            const pt = lightboxDoodlePointFromEvent(e);
            if (!pt || !lightboxActiveStroke) return;
            const prev = lightboxActiveStroke.points[lightboxActiveStroke.points.length - 1];
            // Drop exact duplicates (e.g. pointerdown + first move at rest).
            if (prev && Math.abs(prev.x - pt.x) < 1e-6 && Math.abs(prev.y - pt.y) < 1e-6) return;
            lightboxActiveStroke.points.push({ x: pt.x, y: pt.y, p: doodlePressure(e) });
            paintLightboxDoodles();
        };
        doodleCanvas?.addEventListener('pointerdown', (e) => {
            if (!lightboxDoodleMode) return;
            if (e.button !== undefined && e.button !== 0) return;
            try { doodleCanvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
            if (lightboxDoodleTool === 'eraser') {
                doodleErasing = true;
                lightboxActiveStroke = null;
                eraseLightboxAtEvent(e);
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (lightboxActiveStroke?.points?.length) {
                lightboxDoodles.push(lightboxActiveStroke);
            }
            lightboxActiveStroke = {
                color: getScribbleColor(lightboxDoodleColorIndex),
                width: clampLightboxDoodleWidth(lightboxDoodleWidth),
                points: []
            };
            doodleAppendPoint(e);
            e.preventDefault();
            e.stopPropagation();
        });
        doodleCanvas?.addEventListener('pointermove', (e) => {
            if (!lightboxDoodleMode) return;
            if (lightboxDoodleTool === 'eraser' && doodleErasing) {
                const events = typeof e.getCoalescedEvents === 'function'
                    ? e.getCoalescedEvents()
                    : [e];
                for (const sub of events.length ? events : [e]) eraseLightboxAtEvent(sub);
                e.preventDefault();
                return;
            }
            if (!lightboxActiveStroke) return;
            // coalesced events smooth fast strokes on high-Hz pointers.
            const events = typeof e.getCoalescedEvents === 'function'
                ? e.getCoalescedEvents()
                : [e];
            for (const sub of events.length ? events : [e]) doodleAppendPoint(sub);
            e.preventDefault();
        });
        const endDoodleStroke = () => {
            doodleErasing = false;
            if (!lightboxActiveStroke) return;
            if (lightboxActiveStroke.points.length) {
                lightboxDoodles.push(lightboxActiveStroke);
            }
            lightboxActiveStroke = null;
            paintLightboxDoodles();
        };
        doodleCanvas?.addEventListener('pointerup', endDoodleStroke);
        doodleCanvas?.addEventListener('pointercancel', endDoodleStroke);
        // Re-fit if the viewport resizes while rotated (e.g. window resize).
        window.addEventListener('resize', () => {
            if (!lightboxEl || lightboxEl.classList.contains('is-hidden')) return;
            const rot = normalizeLightboxRotation(lightboxRotation);
            if (rot === 90 || rot === 270) {
                measureLightboxFit();
                applyLightboxTransform();
            }
            // Keep scribbles aligned after layout changes at any rotation.
            paintLightboxDoodles();
        });
        document.addEventListener('keydown', (e) => {
            if (!lightboxEl || lightboxEl.classList.contains('is-hidden')) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeMediaLightbox();
                return;
            }
            if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '0') {
                // Reset (0) still clears scribbles — keep that out of pen mode.
                if (lightboxDoodleMode && e.key === '0') return;
                const img = lightboxImg();
                if (!img) return;
                const rect = img.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
                const cx = (rect.left || 0) + (rect.width || 0) / 2;
                const cy = (rect.top || 0) + (rect.height || 0) / 2;
                if (e.key === '0') resetLightboxZoom();
                else zoomLightboxAtPoint(cx, cy, clampLightboxZoom(lightboxZoom * (e.key === '-' ? 0.8 : 1.25)));
                e.preventDefault();
            }
        }, true);
    }
    return lightboxEl;
}

/**
 * Full-viewport image lightbox.
 * @param {string} mediaId
 */
export async function openMediaLightbox(mediaId) {
    if (!mediaId) return;
    closeMediaLightbox();
    const meta = await getMediaMeta(mediaId);
    if (!meta || meta.blobMissing || !String(meta.mime || '').startsWith('image/')) {
        showAppToast('Preview unavailable');
        return;
    }
    const url = await getObjectUrl(mediaId, 'blob');
    if (!url) {
        showAppToast('Preview unavailable');
        return;
    }
    const el = ensureLightbox();
    el.dataset.claimedMediaId = mediaId;
    const img = el.querySelector('[data-lightbox-img]');
    resetLightboxZoom();
    if (img) {
        img.src = url;
        img.alt = meta.title || meta.filename || 'Image';
    }
    el.classList.remove('is-hidden');
    el.classList.add('is-open');
}

export function closeMediaLightbox() {
    if (!lightboxEl) return;
    lightboxEl.classList.remove('is-open');
    lightboxEl.classList.add('is-hidden');
    resetLightboxZoom();
    const img = lightboxEl.querySelector('[data-lightbox-img]');
    if (img) {
        img.removeAttribute('src');
        img.alt = '';
    }
    const mediaId = lightboxEl.dataset.claimedMediaId || null;
    if (mediaId) {
        delete lightboxEl.dataset.claimedMediaId;
        releaseObjectUrl(mediaId, 'blob');
    }
}

export {
    buildNoteAttachmentsListHtml,
    buildNoteAttachmentsSectionHtml,
    syncNoteAttachmentsDom,
    bindNoteAttachments
} from './noteAttachmentsUi/media.js';
export {
    sizeCanvasViewport,
    buildNoteCanvasSectionHtml,
    syncNoteCanvasDom,
    bindNoteCanvas,
    dumpNoteCanvasState
} from './noteAttachmentsUi/canvas.js';
