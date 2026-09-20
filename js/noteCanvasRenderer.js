/** @module {"owns":"inline note canvas rendering from item.canvas", "related":["noteAttachmentsUi.js","drawingBoard.js","canvasDocument.js"]} */
import { renderBackground } from './canvasBackgrounds.js';
import { drawBrushStroke, drawShapeStroke, drawTextObject, DRAG_SHAPE_TOOLS } from './canvasBrushes.js';
import { ensureImagesLoaded, drawImageObject } from './canvasImages.js';
import { getActivePage } from './canvasDocument.js';
import {
    paintNoteTextOverlay,
    estimateNoteTextOverlayBounds,
    noteHasTextOverlayEnabled,
    migrateNoteCanvasTextFlags,
    activePageIndex
} from './noteCanvasTextOverlay.js';
import { resolveNoteColor } from './colorPicker.js';

const IS_DRAG_SHAPE = new Set(DRAG_SHAPE_TOOLS);

function getActiveLayer(doc) {
    if (!doc || typeof doc !== 'object') return null;
    // drawingBoard canonicalizes infinite content onto the active page; use it for rendering.
    return getActivePage(doc) || null;
}

function updateBounds(bounds, x, y, w, h) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x + w);
    bounds.maxY = Math.max(bounds.maxY, y + h);
}

function getLayerBounds(layer) {
    if (!layer) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    // For inline preview, compute tight content bounds so media/drawings fill the viewport.
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

    for (const img of layer.images || []) {
        if (img == null) continue;
        updateBounds(bounds, img.x ?? 0, img.y ?? 0, img.width ?? 1, img.height ?? 1);
    }

    for (const text of layer.texts || []) {
        if (text == null) continue;
        const fs = text.fontSize || 24;
        const lines = String(text.text || '').split('\n').length || 1;
        updateBounds(bounds, text.x ?? 0, text.y ?? 0, (text.width ?? fs * 8), fs * 1.25 * lines);
    }

    for (const stroke of layer.strokes || []) {
        if (stroke == null) continue;
        if (Array.isArray(stroke.points)) {
            for (const pt of stroke.points) {
                if (!pt) continue;
                const w = stroke.width || 2;
                updateBounds(bounds, pt.x - w, pt.y - w, w * 2, w * 2);
            }
        } else if (stroke.tool && IS_DRAG_SHAPE.has(stroke.tool)) {
            const x0 = stroke.x0 ?? 0;
            const y0 = stroke.y0 ?? 0;
            const x1 = stroke.x1 ?? x0;
            const y1 = stroke.y1 ?? y0;
            updateBounds(bounds, Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        }
    }

    if (!Number.isFinite(bounds.minX)) {
        // Empty layer: use declared bounds if available, else a modest default.
        if (layer.bounds && typeof layer.bounds === 'object') {
            const { minX = 0, minY = 0, maxX = 1000, maxY = 1000 } = layer.bounds;
            return { minX, minY, maxX, maxY };
        }
        return { minX: 0, minY: 0, maxX: layer.width || 1000, maxY: layer.height || 1000 };
    }

    // Add padding around content.
    const pad = 24;
    return {
        minX: Math.max(0, bounds.minX - pad),
        minY: Math.max(0, bounds.minY - pad),
        maxX: bounds.maxX + pad,
        maxY: bounds.maxY + pad
    };
}

function fitTransform(cssW, cssH, bounds) {
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    // Allow upscale so stroke-only doodles fill the preview (images still fit via min).
    // Top-left align so preview matches magicCanvas page origin (not centered).
    const scale = Math.min(cssW / width, cssH / height);
    const offsetX = -bounds.minX * scale;
    const offsetY = -bounds.minY * scale;
    return { scale, offsetX, offsetY };
}

/** Resolve drawable CSS size; prefer explicit viewport style, then laid-out box. */
function resolvePreviewSize(canvasEl) {
    const viewport = canvasEl.closest('[data-note-media-viewport]') || canvasEl.parentElement;
    const styledW = parseFloat(viewport?.style?.width);
    const styledH = parseFloat(viewport?.style?.height);
    const hasStyledW = Number.isFinite(styledW) && styledW >= 2;
    const hasStyledH = Number.isFinite(styledH) && styledH >= 2;

    // Board grid can collapse the canvas to ~2px before layout settles. Prefer the
    // explicit viewport size set by sizeCanvasViewport when available.
    if (hasStyledW && hasStyledH) {
        return { cssW: styledW, cssH: styledH, ready: true };
    }

    const rect = canvasEl.getBoundingClientRect();
    let cssW = rect.width;
    let cssH = rect.height;
    if (cssW >= 2 && cssH >= 2) return { cssW, cssH, ready: true };

    cssW = viewport?.clientWidth || 0;
    cssH = viewport?.clientHeight || 0;
    if (cssH < 2 && hasStyledH) cssH = styledH;
    if (cssW < 2 && hasStyledW) cssW = styledW;
    return {
        cssW: Math.max(1, cssW),
        cssH: Math.max(1, cssH),
        ready: cssW >= 2 && cssH >= 2
    };
}

/** Match the host note card color so blank previews don't paint desktop black. */
function resolveHostNoteFill(canvasEl) {
    const host = canvasEl?.closest?.('.mini-card, .editor-note-shell');
    if (!host) return '';
    const bg = getComputedStyle(host).backgroundColor;
    if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return '';
    return bg;
}

function drawLayer(ctx, layer) {
    const images = layer.images || [];
    const strokes = layer.strokes || [];
    const texts = layer.texts || [];

    for (const img of images) {
        drawImageObject(ctx, img);
    }

    for (const stroke of strokes) {
        if (stroke.tool && IS_DRAG_SHAPE.has(stroke.tool)) {
            drawShapeStroke(ctx, stroke);
        } else {
            drawBrushStroke(ctx, stroke);
        }
    }

    for (const text of texts) {
        drawTextObject(ctx, text);
    }
}

function unionBounds(a, b) {
    if (!a) return b;
    if (!b) return a;
    return {
        minX: Math.min(a.minX, b.minX),
        minY: Math.min(a.minY, b.minY),
        maxX: Math.max(a.maxX, b.maxX),
        maxY: Math.max(a.maxY, b.maxY)
    };
}

/**
 * Render a note canvas document into a target HTML canvas element.
 * The document is scaled to fit inside the element while preserving aspect ratio.
 * @param {HTMLCanvasElement} canvasEl
 * @param {object} doc - canvasDocument v2
 * @param {{ onLoaded?: () => void, item?: object }} [opts]
 */
export function renderNoteCanvas(canvasEl, doc, { onLoaded, item } = {}) {
    if (!canvasEl || !doc) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const layer = getActiveLayer(doc);
    if (!layer) return;

    if (item) migrateNoteCanvasTextFlags(item);

    const dpr = window.devicePixelRatio || 1;
    const { cssW, cssH } = resolvePreviewSize(canvasEl);

    // Ensure the bitmap size matches the displayed size for crisp rendering.
    if (canvasEl.width !== Math.round(cssW * dpr) || canvasEl.height !== Math.round(cssH * dpr)) {
        canvasEl.width = Math.round(cssW * dpr);
        canvasEl.height = Math.round(cssH * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const fillColor = layer.backgroundColor
        || resolveHostNoteFill(canvasEl)
        || (item ? resolveNoteColor(item.backgroundColor) : '')
        || '';

    // Draw background at full element size — prefer note canvas fill, else host note color.
    renderBackground(ctx, layer.background || 'blank', cssW, cssH, { fillColor });

    // Load media images referenced by the canvas and re-render when ready.
    ensureImagesLoaded(layer.images || [], onLoaded);

    let bounds = getLayerBounds(layer);
    const showOverlay = noteHasTextOverlayEnabled(item);
    if (showOverlay) {
        bounds = unionBounds(bounds, estimateNoteTextOverlayBounds(item)) || bounds;
    }
    const { scale, offsetX, offsetY } = fitTransform(cssW, cssH, bounds);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    if (showOverlay) {
        paintNoteTextOverlay(ctx, item, {
            fillColor,
            doc,
            pageIndex: activePageIndex(doc)
        });
    }
    drawLayer(ctx, layer);
    ctx.restore();
}

/**
 * Recompute and redraw an inline note canvas element.
 * Stroke-only canvases never get ensureImagesLoaded's onLoaded callback, so we
 * always schedule a post-layout pass — that matches the "works after adding media"
 * path that was accidentally papering over zero-size first paints.
 * @param {HTMLElement} section - the note attachments section root
 * @param {object} item - note item with item.canvas
 */
export function refreshNoteCanvasPreview(section, item) {
    if (!section || !item?.canvas) return;
    const canvas = section.querySelector('[data-note-canvas-preview]');
    if (!canvas) return;

    const paint = () => {
        renderNoteCanvas(canvas, item.canvas, {
            item,
            onLoaded: () => renderNoteCanvas(canvas, item.canvas, { item })
        });
    };

    // Paint immediately, then keep re-painting until the preview has a settled,
    // drawable box. Full-board rebuilds (grid placement, File Cabinet drawer height
    // transition) can take several frames to lay the card out, so the old 2-frame
    // retry budget was frequently exhausted before layout settled — leaving the note
    // canvas blank/invisible on the board until an unrelated later re-render.
    paint();

    let retries = 0;
    const MAX_RETRIES = 20;
    const settle = () => {
        const { ready } = resolvePreviewSize(canvas);
        if (ready || retries >= MAX_RETRIES) {
            paint();
            return;
        }
        retries += 1;
        requestAnimationFrame(settle);
    };

    requestAnimationFrame(settle);
}
