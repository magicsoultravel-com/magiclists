/** @module {"owns":"magicCanvas image cache and draw helpers", "related":["mediaLibrary.js","drawingBoard.js","canvasDocument.js"]} */
import { getObjectUrl, releaseObjectUrl } from './mediaLibrary.js';

/** @type {Map<string, { img: HTMLImageElement, url: string, refs: number, loading: Promise<HTMLImageElement>|null }>} */
const cache = new Map();

const INITIAL_MAX_SIDE = 240;
const MIN_IMAGE_SIDE = 24;

/**
 * Load (or return cached) HTMLImageElement for a media library id.
 * Claims a getObjectUrl ref on first load; release via clearImageCache.
 * @param {string} mediaId
 * @returns {Promise<HTMLImageElement|null>}
 */
export async function loadImage(mediaId) {
    if (!mediaId) return null;
    const existing = cache.get(mediaId);
    if (existing?.img?.complete && existing.img.naturalWidth > 0) {
        existing.refs += 1;
        return existing.img;
    }
    if (existing?.loading) {
        const img = await existing.loading;
        if (img) existing.refs += 1;
        return img;
    }

    const entry = { img: null, url: null, refs: 0, loading: null };
    entry.loading = (async () => {
        const url = await getObjectUrl(mediaId, 'blob');
        if (!url) {
            cache.delete(mediaId);
            return null;
        }
        entry.url = url;
        const img = new Image();
        img.decoding = 'async';
        const loaded = new Promise((resolve, reject) => {
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('image load failed'));
        });
        img.src = url;
        try {
            await loaded;
            entry.img = img;
            entry.refs = 1;
            entry.loading = null;
            cache.set(mediaId, entry);
            return img;
        } catch {
            releaseObjectUrl(mediaId, 'blob');
            cache.delete(mediaId);
            return null;
        }
    })();

    cache.set(mediaId, entry);
    return entry.loading;
}

/**
 * Synchronous lookup of a already-loaded image (for redraw).
 * @param {string} mediaId
 * @returns {HTMLImageElement|null}
 */
export function getCachedImage(mediaId) {
    const entry = cache.get(mediaId);
    if (entry?.img?.complete && entry.img.naturalWidth > 0) return entry.img;
    return null;
}

/** Drop every cached image and release object URLs. */
export function clearImageCache() {
    for (const mediaId of [...cache.keys()]) {
        const entry = cache.get(mediaId);
        if (entry?.url) releaseObjectUrl(mediaId, 'blob');
        cache.delete(mediaId);
    }
}

/**
 * Ensure all mediaIds used by the given image items are loaded.
 * Triggers a redraw callback when any load completes.
 * @param {Array<{ mediaId?: string }>} images
 * @param {() => void} [onLoaded]
 */
export function ensureImagesLoaded(images, onLoaded) {
    if (!Array.isArray(images) || !images.length) return;
    const ids = new Set(images.map((i) => i?.mediaId).filter(Boolean));
    for (const id of ids) {
        if (getCachedImage(id)) continue;
        loadImage(id).then((img) => {
            if (img) onLoaded?.();
        }).catch(() => { /* ignore */ });
    }
}

/**
 * Compute an initial placement size that fits within INITIAL_MAX_SIDE on the longest side.
 * @param {number} naturalW
 * @param {number} naturalH
 * @returns {{ width: number, height: number }}
 */
export function initialImageSize(naturalW, naturalH) {
    const w = Math.max(1, naturalW || INITIAL_MAX_SIDE);
    const h = Math.max(1, naturalH || INITIAL_MAX_SIDE);
    const scale = Math.min(1, INITIAL_MAX_SIDE / Math.max(w, h));
    return {
        width: Math.max(MIN_IMAGE_SIDE, Math.round(w * scale)),
        height: Math.max(MIN_IMAGE_SIDE, Math.round(h * scale))
    };
}

/**
 * Source-pixel window of an image item. Uncropped items use the full natural
 * bitmap; a cropped item stores its window in `item.crop` (natural pixels).
 * Values are clamped so a stale/partial crop can never point outside the bitmap.
 *
 * @param {{ crop?: {x?:number,y?:number,width?:number,height?:number}, naturalWidth?: number, naturalHeight?: number, width?: number, height?: number }} item
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function getImageSourceWindow(item) {
    const naturalW = Math.max(1, Number(item?.naturalWidth) || Number(item?.width) || 1);
    const naturalH = Math.max(1, Number(item?.naturalHeight) || Number(item?.height) || 1);
    const crop = item?.crop;
    const cropW = Number(crop?.width);
    const cropH = Number(crop?.height);
    if (!crop || !Number.isFinite(cropW) || !Number.isFinite(cropH) || cropW <= 0 || cropH <= 0) {
        return { x: 0, y: 0, width: naturalW, height: naturalH };
    }
    const width = Math.min(cropW, naturalW);
    const height = Math.min(cropH, naturalH);
    const x = Math.min(Math.max(Number(crop.x) || 0, 0), naturalW - width);
    const y = Math.min(Math.max(Number(crop.y) || 0, 0), naturalH - height);
    return { x, y, width, height };
}

/**
 * drawImage arguments for an image item: the plain 5-arg form when the item
 * shows the whole bitmap, or a 9-arg source window when it is cropped.
 * `cropped` lets callers keep the simple path (and is what tests assert on).
 *
 * @param {{ x?: number, y?: number, width?: number, height?: number, crop?: object, naturalWidth?: number, naturalHeight?: number }} item
 * @param {{ naturalWidth?: number, naturalHeight?: number }} [img]
 * @returns {{ sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, cropped: boolean }}
 */
export function imageDrawArgs(item, img) {
    const dw = Math.max(1, item?.width ?? 1);
    const dh = Math.max(1, item?.height ?? 1);
    // Prefer the live bitmap's dimensions so a stale naturalWidth can't make
    // drawImage throw on an out-of-bounds source rect.
    const naturalW = Math.max(1, Number(img?.naturalWidth) || Number(item?.naturalWidth) || dw);
    const naturalH = Math.max(1, Number(img?.naturalHeight) || Number(item?.naturalHeight) || dh);
    const src = getImageSourceWindow({ ...item, naturalWidth: naturalW, naturalHeight: naturalH });
    const cropped = src.x > 0 || src.y > 0 || src.width < naturalW || src.height < naturalH;
    return {
        sx: src.x,
        sy: src.y,
        sw: src.width,
        sh: src.height,
        dx: item?.x ?? 0,
        dy: item?.y ?? 0,
        dw,
        dh,
        cropped
    };
}

/**
 * World-space metrics mapping an item's source window to the canvas.
 *
 * `originX/originY` is where the item's *full original bitmap* starts in world
 * coordinates and `sx/sy` are world-px per source-px. Both are invariant while
 * an item is re-cropped consistently (display rect and source window change by
 * the same factor), which is what lets a crop frame grow back out to un-crop.
 *
 * @param {{ x?: number, y?: number, width?: number, height?: number, crop?: object, naturalWidth?: number, naturalHeight?: number }} item
 * @returns {{ src: {x:number,y:number,width:number,height:number}, sx: number, sy: number, naturalWidth: number, naturalHeight: number, originX: number, originY: number }}
 */
export function cropMetrics(item) {
    const src = getImageSourceWindow(item);
    const width = Math.max(1, item?.width ?? 1);
    const height = Math.max(1, item?.height ?? 1);
    const sx = src.width > 0 ? width / src.width : 1;
    const sy = src.height > 0 ? height / src.height : 1;
    return {
        src,
        sx,
        sy,
        naturalWidth: Math.max(src.width, Number(item?.naturalWidth) || src.width),
        naturalHeight: Math.max(src.height, Number(item?.naturalHeight) || src.height),
        originX: (item?.x ?? 0) - src.x * sx,
        originY: (item?.y ?? 0) - src.y * sy
    };
}

/**
 * The full original frame in world space — the region a crop box may cover.
 * Equals the item's display rect when nothing has been cropped yet.
 * @param {ReturnType<typeof cropMetrics>} metrics
 * @returns {{x:number,y:number,width:number,height:number}|null}
 */
export function cropLimitRect(metrics) {
    if (!metrics) return null;
    return {
        x: metrics.originX,
        y: metrics.originY,
        width: metrics.naturalWidth * metrics.sx,
        height: metrics.naturalHeight * metrics.sy
    };
}

function clampValue(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * Clamp a crop box into the frame and never below the minimum side, so a live
 * crop frame can never collapse to a degenerate rect.
 * @param {{x:number,y:number,width:number,height:number}} box
 * @param {{x:number,y:number,width:number,height:number}} limitRect
 * @param {number} [minSide]
 */
export function normalizeCropBox(box, limitRect, minSide = MIN_IMAGE_SIDE) {
    if (!box || !limitRect) return null;
    const minWidth = Math.min(minSide, limitRect.width);
    const minHeight = Math.min(minSide, limitRect.height);
    const width = clampValue(Number(box.width) || 0, minWidth, limitRect.width);
    const height = clampValue(Number(box.height) || 0, minHeight, limitRect.height);
    return {
        x: clampValue(Number(box.x) || 0, limitRect.x, limitRect.x + limitRect.width - width),
        y: clampValue(Number(box.y) || 0, limitRect.y, limitRect.y + limitRect.height - height),
        width,
        height
    };
}

/**
 * Move one edge/corner of a crop box to the pointer, clamped to the frame.
 * `handle` uses the same ids as getResizeHandles(): nw/n/ne/e/se/s/sw/w.
 * @param {{x:number,y:number,width:number,height:number}} box
 * @param {string} handle
 * @param {number} x pointer world x
 * @param {number} y pointer world y
 * @param {{x:number,y:number,width:number,height:number}} limitRect
 * @param {number} [minSide]
 */
export function resizeCropBox(box, handle, x, y, limitRect, minSide = MIN_IMAGE_SIDE) {
    if (!box || !handle || !limitRect) return box;
    const minWidth = Math.min(minSide, limitRect.width);
    const minHeight = Math.min(minSide, limitRect.height);
    let minX = box.x;
    let minY = box.y;
    let maxX = box.x + box.width;
    let maxY = box.y + box.height;

    if (handle.includes('w')) minX = clampValue(x, limitRect.x, maxX - minWidth);
    if (handle.includes('e')) maxX = clampValue(x, minX + minWidth, limitRect.x + limitRect.width);
    if (handle.includes('n')) minY = clampValue(y, limitRect.y, maxY - minHeight);
    if (handle.includes('s')) maxY = clampValue(y, minY + minHeight, limitRect.y + limitRect.height);

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Slide a crop box by a delta, keeping it inside the frame.
 * @param {{x:number,y:number,width:number,height:number}} box
 * @param {number} dx
 * @param {number} dy
 * @param {{x:number,y:number,width:number,height:number}} limitRect
 */
export function moveCropBox(box, dx, dy, limitRect) {
    if (!box || !limitRect) return box;
    return {
        x: clampValue(box.x + dx, limitRect.x, limitRect.x + limitRect.width - box.width),
        y: clampValue(box.y + dy, limitRect.y, limitRect.y + limitRect.height - box.height),
        width: box.width,
        height: box.height
    };
}

/**
 * Map a world-space crop box back to item geometry: the display rect plus the
 * source window. Normalize the box against cropLimitRect() first — that keeps
 * the inverse exact and lets a box cover previously discarded pixels again.
 *
 * @param {ReturnType<typeof cropMetrics>} metrics
 * @param {{x:number,y:number,width:number,height:number}} box
 * @returns {{ x:number, y:number, width:number, height:number, crop:{x:number,y:number,width:number,height:number} }|null}
 */
export function boxToCropPatch(metrics, box) {
    if (!metrics || !box) return null;
    const { sx, sy, naturalWidth, naturalHeight } = metrics;
    const width = Math.max(1, box.width);
    const height = Math.max(1, box.height);
    const cropWidth = Math.min(width / sx, naturalWidth);
    const cropHeight = Math.min(height / sy, naturalHeight);
    return {
        x: box.x,
        y: box.y,
        width,
        height,
        crop: {
            x: clampValue((box.x - metrics.originX) / sx, 0, Math.max(0, naturalWidth - cropWidth)),
            y: clampValue((box.y - metrics.originY) / sy, 0, Math.max(0, naturalHeight - cropHeight)),
            width: cropWidth,
            height: cropHeight
        }
    };
}

/**
 * Draw a canvas image item. Missing/unloaded media renders a dashed placeholder.
 * Cropped items sample their source window; everything else draws full-frame.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number, width: number, height: number, mediaId?: string, crop?: object }} item
 * @param {HTMLImageElement|{naturalWidth?: number, naturalHeight?: number}} [img] pre-resolved
 *   bitmap; defaults to the media cache. Injectable so the crop path is testable.
 */
export function drawImageObject(ctx, item, img = null) {
    if (!item || !ctx) return;
    const x = item.x ?? 0;
    const y = item.y ?? 0;
    const w = Math.max(1, item.width ?? 1);
    const h = Math.max(1, item.height ?? 1);
    const bitmap = img || (item.mediaId ? getCachedImage(item.mediaId) : null);

    ctx.save();
    if (bitmap) {
        try {
            const args = imageDrawArgs(item, bitmap);
            if (args.cropped) {
                ctx.drawImage(bitmap, args.sx, args.sy, args.sw, args.sh, args.dx, args.dy, args.dw, args.dh);
            } else {
                ctx.drawImage(bitmap, x, y, w, h);
            }
        } catch {
            drawMissingPlaceholder(ctx, x, y, w, h);
        }
    } else {
        drawMissingPlaceholder(ctx, x, y, w, h);
    }
    ctx.restore();
}

/**
 * Ghost of the *discarded* pixels: paints the whole original bitmap, dimmed,
 * inside its full frame so a crop frame can be dragged back out to un-crop.
 * Draw it immediately before the item's own (cropped) pass.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} item image item
 * @param {{ alpha?: number, limitRect?: {x:number,y:number,width:number,height:number}|null, img?: object|null }} [opts]
 * @returns {boolean} true when a ghost was painted
 */
export function drawImageGhost(ctx, item, { alpha = 0.35, limitRect = null, img = null } = {}) {
    if (!ctx || !item) return false;
    const bitmap = img || (item.mediaId ? getCachedImage(item.mediaId) : null);
    if (!bitmap) return false;

    const metrics = cropMetrics(item);
    const src = metrics.src;
    // Nothing discarded yet → nothing to ghost.
    if (src.x <= 0 && src.y <= 0
        && src.width >= metrics.naturalWidth && src.height >= metrics.naturalHeight) {
        return false;
    }

    const frame = limitRect || cropLimitRect(metrics);
    if (!frame) return false;

    ctx.save();
    ctx.globalAlpha = alpha;
    try {
        ctx.drawImage(
            bitmap,
            0, 0, metrics.naturalWidth, metrics.naturalHeight,
            frame.x, frame.y, frame.width, frame.height
        );
    } catch {
        ctx.restore();
        return false;
    }
    ctx.restore();
    return true;
}

function drawMissingPlaceholder(ctx, x, y, w, h) {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.7)';
    ctx.fillStyle = 'rgba(30, 41, 59, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.font = `${Math.max(12, Math.min(w, h) * 0.12)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Image', x + w / 2, y + h / 2);
}

export { INITIAL_MAX_SIDE, MIN_IMAGE_SIDE };
