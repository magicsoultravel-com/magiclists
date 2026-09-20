/** @module {"owns":"magicCanvas image cache and draw helpers", "related":["mediaLibrary.js","drawingBoard.js","canvasDocument.js"]} */
import { getObjectUrl, releaseObjectUrl } from './mediaLibrary.js';

/** @type {Map<string, { img: HTMLImageElement, url: string, refs: number, loading: Promise<HTMLImageElement>|null }>} */
const cache = new Map();

const INITIAL_MAX_SIDE = 240;
const MIN_IMAGE_SIDE = 24;

/**
 * Load (or return cached) HTMLImageElement for a media library id.
 * Claims a getObjectUrl ref on first load; release via releaseImage / clearImageCache.
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

/**
 * Release one claim on a cached image. Revokes the object URL when refs hit 0.
 * @param {string} mediaId
 */
export function releaseImage(mediaId) {
    const entry = cache.get(mediaId);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs === 0) {
        if (entry.url) releaseObjectUrl(mediaId, 'blob');
        cache.delete(mediaId);
    }
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
 * Crop an image item to a world/bitmap-space rectangle.
 *
 * The item's displayed rect stays the visible window: we intersect the drag
 * rect with the current rect, then map that intersection back through the
 * item's existing source window — so cropping an already-cropped image
 * composes instead of resetting. The media file itself is never touched.
 *
 * @param {{ x?: number, y?: number, width?: number, height?: number, crop?: object, naturalWidth?: number, naturalHeight?: number }} item
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} rect
 * @param {{ minSide?: number }} [opts]
 * @returns {{ x: number, y: number, width: number, height: number, crop: {x:number,y:number,width:number,height:number} }|null}
 *   null when the rect misses the image or the result would be smaller than `minSide`.
 */
export function computeImageCrop(item, rect, { minSide = MIN_IMAGE_SIDE } = {}) {
    if (!item || !rect) return null;

    const curX = item.x ?? 0;
    const curY = item.y ?? 0;
    const curW = Math.max(1, item.width ?? 1);
    const curH = Math.max(1, item.height ?? 1);

    const ix0 = Math.max(curX, Math.min(rect.minX, rect.maxX));
    const iy0 = Math.max(curY, Math.min(rect.minY, rect.maxY));
    const ix1 = Math.min(curX + curW, Math.max(rect.minX, rect.maxX));
    const iy1 = Math.min(curY + curH, Math.max(rect.minY, rect.maxY));

    const width = ix1 - ix0;
    const height = iy1 - iy0;
    if (!(width > 0) || !(height > 0)) return null;
    if (width < minSide || height < minSide) return null;

    const src = getImageSourceWindow(item);
    const scaleX = src.width / curW;
    const scaleY = src.height / curH;

    return {
        x: ix0,
        y: iy0,
        width,
        height,
        crop: {
            x: src.x + (ix0 - curX) * scaleX,
            y: src.y + (iy0 - curY) * scaleY,
            width: width * scaleX,
            height: height * scaleY
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
