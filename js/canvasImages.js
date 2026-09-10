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
 * Draw a canvas image item. Missing/unloaded media renders a dashed placeholder.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number, width: number, height: number, mediaId?: string }} item
 */
export function drawImageObject(ctx, item) {
    if (!item || !ctx) return;
    const x = item.x ?? 0;
    const y = item.y ?? 0;
    const w = Math.max(1, item.width ?? 1);
    const h = Math.max(1, item.height ?? 1);
    const img = item.mediaId ? getCachedImage(item.mediaId) : null;

    ctx.save();
    if (img) {
        try {
            ctx.drawImage(img, x, y, w, h);
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
