/** @module {"owns":"image optimize/resample helpers for media library", "related":["mediaMetadata.js","mediaLibrary.js","mediaTransformUi.js"]} */

const ORIENT_SWAP = new Set([5, 6, 7, 8]);

/**
 * @param {number|null|undefined} orientation
 */
function shouldSwapDimensions(orientation) {
    return ORIENT_SWAP.has(Number(orientation) || 0);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number|null|undefined} orientation
 */
function applyExifOrientation(ctx, orientation) {
    switch (Number(orientation) || 0) {
        case 2: ctx.scale(-1, 1); break;
        case 3: ctx.rotate(Math.PI); break;
        case 4: ctx.scale(1, -1); break;
        case 5: ctx.rotate(Math.PI / 2); ctx.scale(-1, 1); break;
        case 6: ctx.rotate(Math.PI / 2); break;
        case 7: ctx.rotate(-Math.PI / 2); ctx.scale(-1, 1); break;
        case 8: ctx.rotate(-Math.PI / 2); break;
        default: break;
    }
}

/**
 * @param {string} mime
 * @returns {'image/webp'|'image/jpeg'|'image/png'}
 */
export function normalizeOutputMime(mime) {
    const m = String(mime || '').toLowerCase();
    if (m === 'image/png') return 'image/png';
    if (m === 'image/jpeg' || m === 'image/jpg') return 'image/jpeg';
    return 'image/webp';
}

/**
 * JPEG cannot store alpha — coerce to WebP when the source has transparency.
 * @param {string} mime
 * @param {{ hasAlpha?: boolean }} [opts]
 * @returns {'image/webp'|'image/jpeg'|'image/png'}
 */
export function coerceOutputMime(mime, opts = {}) {
    const normalized = normalizeOutputMime(mime);
    if (opts.hasAlpha && normalized === 'image/jpeg') return 'image/webp';
    return normalized;
}

/**
 * Detect whether decoded pixels use a non-opaque alpha channel.
 * Samples a downscaled raster (JPEG mime short-circuits to false).
 * @param {Blob} blob
 * @returns {Promise<boolean>}
 */
export async function imageHasAlpha(blob) {
    if (!blob) return false;
    const type = String(blob.type || '').toLowerCase();
    if (!type.startsWith('image/')) return false;
    // JPEG never has alpha.
    if (type === 'image/jpeg' || type === 'image/jpg') return false;
    if (typeof createImageBitmap !== 'function') return false;

    let bitmap;
    try {
        bitmap = await createImageBitmap(blob);
    } catch {
        return false;
    }

    try {
        const maxEdge = 64;
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height, 1));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return false;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(bitmap, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        // Any pixel with alpha below fully opaque counts as transparency.
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 255) return true;
        }
        return false;
    } catch {
        return false;
    } finally {
        bitmap.close?.();
    }
}

/**
 * @param {string} mime
 */
export function extForMime(mime) {
    const m = normalizeOutputMime(mime);
    if (m === 'image/png') return 'png';
    if (m === 'image/jpeg') return 'jpg';
    return 'webp';
}

/**
 * @param {string} filename
 * @param {string} suffix  e.g. "optimized" or "50"
 * @param {string} mime
 */
export function buildTransformedFilename(filename, suffix, mime) {
    const base = String(filename || 'image');
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const clean = String(suffix || '').replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'out';
    return `${stem}-${clean}.${extForMime(mime)}`;
}

/**
 * @param {Blob} blob
 * @param {{
 *   scale?: number,
 *   mime?: string,
 *   quality?: number,
 *   orientation?: number|null,
 *   hasAlpha?: boolean
 * }} [opts]
 * @returns {Promise<{ blob: Blob, width: number, height: number, byteSize: number, mime: string }>}
 */
export async function resampleImageBlob(blob, opts = {}) {
    if (!blob || !String(blob.type || '').startsWith('image/')) {
        const err = new Error('Not an image');
        err.code = 'MEDIA_NOT_IMAGE';
        throw err;
    }
    if (typeof createImageBitmap !== 'function') {
        const err = new Error('Image transform unsupported in this browser');
        err.code = 'MEDIA_TRANSFORM_UNSUPPORTED';
        throw err;
    }

    const scale = Number(opts.scale);
    const scaleFactor = Number.isFinite(scale) && scale > 0 ? scale : 1;
    // Prefer caller-provided flag; otherwise detect (JPEG short-circuits inside).
    const hasAlpha = typeof opts.hasAlpha === 'boolean'
        ? opts.hasAlpha
        : await imageHasAlpha(blob);
    const mime = coerceOutputMime(opts.mime || 'image/webp', { hasAlpha });
    const qualityRaw = Number(opts.quality);
    const quality = Number.isFinite(qualityRaw)
        ? Math.min(1, Math.max(0.05, qualityRaw))
        : 0.92;
    const orientation = opts.orientation ?? null;

    let bitmap;
    try {
        bitmap = await createImageBitmap(blob);
    } catch {
        const err = new Error('Could not decode image');
        err.code = 'MEDIA_DECODE_FAILED';
        throw err;
    }

    try {
        const swap = shouldSwapDimensions(orientation);
        const srcW = Math.max(1, Math.round(bitmap.width * scaleFactor));
        const srcH = Math.max(1, Math.round(bitmap.height * scaleFactor));
        const width = swap ? srcH : srcW;
        const height = swap ? srcW : srcH;

        if (width > 16384 || height > 16384) {
            const err = new Error('Target dimensions too large');
            err.code = 'MEDIA_TRANSFORM_TOO_LARGE';
            throw err;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            const err = new Error('Canvas unavailable');
            err.code = 'MEDIA_TRANSFORM_UNSUPPORTED';
            throw err;
        }

        // Opaque white underlay only for JPEG. Transparent sources never reach
        // JPEG — coerceOutputMime forces WebP/PNG when hasAlpha is true.
        if (mime === 'image/jpeg') {
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, width, height);
        }

        ctx.translate(width / 2, height / 2);
        applyExifOrientation(ctx, orientation);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, -srcW / 2, -srcH / 2, srcW, srcH);

        const outBlob = await new Promise((resolve, reject) => {
            const done = (b) => {
                if (b) resolve(b);
                else reject(Object.assign(new Error('Encode failed'), { code: 'MEDIA_ENCODE_FAILED' }));
            };
            if (mime === 'image/png') {
                canvas.toBlob(done, mime);
            } else {
                canvas.toBlob(done, mime, quality);
            }
        });

        return {
            blob: outBlob,
            width,
            height,
            byteSize: outBlob.size || 0,
            mime: outBlob.type || mime
        };
    } finally {
        bitmap.close?.();
    }
}

/**
 * Same-dimension re-encode.
 * @param {Blob} blob
 * @param {{ mime?: string, quality?: number, orientation?: number|null }} [opts]
 */
export async function optimizeImageBlob(blob, opts = {}) {
    return resampleImageBlob(blob, { ...opts, scale: 1 });
}

/**
 * Encode and return size preview (same as resample; alias for UI clarity).
 * @param {Blob} blob
 * @param {{ scale?: number, mime?: string, quality?: number, orientation?: number|null }} [opts]
 */
export async function estimateTransformedSize(blob, opts = {}) {
    return resampleImageBlob(blob, opts);
}
