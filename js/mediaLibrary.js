/** @module {"owns":"media library CRUD, thumbs, size limits", "related":["storage/indexedDbMediaStore.js","mediaMetadata.js","mediaBackup.js"]} */
import { IndexedDBMediaStore } from './storage/indexedDbMediaStore.js';
import { buildMediaMetadata, generateThumbnail } from './mediaMetadata.js';

export const MEDIA_MAX_BYTES = 25 * 1024 * 1024;
export const MEDIA_EMBED_CAP = 256 * 1024;
export const MEDIA_LIBRARY_CHANGED = 'media:library_changed';

const objectUrls = new Map();

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

export function createMediaId() {
    return `media_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function notifyChanged() {
    window.dispatchEvent(new CustomEvent(MEDIA_LIBRARY_CHANGED));
}

/**
 * Meta-only view of a stored record (safe to serialize).
 * @param {object} record
 */
export function toPublicMeta(record) {
    if (!record) return null;
    const hasBlob = !!(record.blob && (record.blob.size > 0 || record.blob instanceof Blob));
    return {
        id: record.id,
        filename: record.filename || '',
        mime: record.mime || 'application/octet-stream',
        byteSize: record.byteSize || 0,
        title: record.title || '',
        description: record.description || '',
        source: record.source || 'upload',
        createdAt: record.createdAt || 0,
        updatedAt: record.updatedAt || 0,
        width: record.width ?? null,
        height: record.height ?? null,
        cameraMake: record.cameraMake || null,
        cameraModel: record.cameraModel || null,
        orientation: record.orientation ?? null,
        orientationLabel: record.orientationLabel || null,
        capturedAt: record.capturedAt ?? null,
        capturedAtLabel: record.capturedAtLabel || null,
        gps: record.gps || null,
        blobPresent: hasBlob && !record.blobMissing,
        blobMissing: !hasBlob || !!record.blobMissing
    };
}

/**
 * @param {Blob|File} blob
 * @param {{ title?: string, description?: string, source?: string, filename?: string, id?: string }} [opts]
 */
export async function commitMediaItem(blob, opts = {}) {
    if (!blob) throw new Error('No file to add');
    if (blob.size > MEDIA_MAX_BYTES) {
        const err = new Error(`File exceeds ${Math.round(MEDIA_MAX_BYTES / (1024 * 1024))} MB limit`);
        err.code = 'MEDIA_TOO_LARGE';
        throw err;
    }

    const extracted = await buildMediaMetadata(blob, {
        filename: opts.filename,
        source: opts.source || 'upload'
    });
    const id = opts.id || createMediaId();
    const ts = nowSeconds();
    const thumbBlob = await generateThumbnail(blob);

    const record = {
        id,
        ...extracted,
        title: (opts.title ?? '').trim() || stripExt(extracted.filename),
        description: (opts.description ?? '').trim(),
        createdAt: ts,
        updatedAt: ts,
        blob,
        thumbBlob: thumbBlob || null,
        blobMissing: false
    };

    const ok = await IndexedDBMediaStore.put(record);
    if (!ok) {
        const err = new Error('Could not store media (storage full or unavailable)');
        err.code = 'MEDIA_STORE_FAILED';
        throw err;
    }
    notifyChanged();
    return toPublicMeta(record);
}

/**
 * @param {Array<{ blob: Blob|File, title?: string, description?: string, source?: string, filename?: string }>} items
 */
export async function commitMediaItems(items) {
    const results = [];
    for (const item of items || []) {
        results.push(await commitMediaItem(item.blob, item));
    }
    return results;
}

export async function listMedia() {
    const all = await IndexedDBMediaStore.getAll();
    return all
        .map(toPublicMeta)
        .filter(Boolean)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function getMediaRecord(id) {
    return IndexedDBMediaStore.get(id);
}

export async function getMediaMeta(id) {
    return toPublicMeta(await IndexedDBMediaStore.get(id));
}

/**
 * @param {string} id
 * @param {{ title?: string, description?: string }} patch
 */
export async function updateMediaMeta(id, patch = {}) {
    const record = await IndexedDBMediaStore.get(id);
    if (!record) return null;
    if (patch.title !== undefined) record.title = String(patch.title || '').trim();
    if (patch.description !== undefined) record.description = String(patch.description || '').trim();
    record.updatedAt = nowSeconds();
    await IndexedDBMediaStore.put(record);
    revokeObjectUrl(id);
    notifyChanged();
    return toPublicMeta(record);
}

export async function removeMedia(id) {
    revokeObjectUrl(id);
    revokeThumbUrl(id);
    await IndexedDBMediaStore.remove(id);
    notifyChanged();
}

/**
 * Upsert a full record (restore / import).
 * @param {object} record
 */
export async function putMediaRecord(record) {
    if (!record?.id) return false;
    const ok = await IndexedDBMediaStore.put(record);
    if (ok) notifyChanged();
    return ok;
}

export async function countMedia() {
    const all = await IndexedDBMediaStore.getAll();
    return all.length;
}

/**
 * @param {string} id
 * @param {'blob'|'thumb'} [which]
 */
export async function getObjectUrl(id, which = 'blob') {
    const key = `${which}:${id}`;
    if (objectUrls.has(key)) return objectUrls.get(key);
    const record = await IndexedDBMediaStore.get(id);
    if (!record) return null;
    const blob = which === 'thumb' ? (record.thumbBlob || record.blob) : record.blob;
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    objectUrls.set(key, url);
    return url;
}

export function revokeObjectUrl(id) {
    for (const which of ['blob', 'thumb']) {
        const key = `${which}:${id}`;
        const url = objectUrls.get(key);
        if (url) {
            URL.revokeObjectURL(url);
            objectUrls.delete(key);
        }
    }
}

function revokeThumbUrl(id) {
    revokeObjectUrl(id);
}

export function revokeAllObjectUrls() {
    for (const url of objectUrls.values()) {
        URL.revokeObjectURL(url);
    }
    objectUrls.clear();
}

function stripExt(name) {
    const s = String(name || 'Untitled');
    const i = s.lastIndexOf('.');
    return i > 0 ? s.slice(0, i) : s;
}

export const MediaLibrary = {
    MEDIA_MAX_BYTES,
    MEDIA_EMBED_CAP,
    createMediaId,
    commitMediaItem,
    commitMediaItems,
    listMedia,
    getMediaRecord,
    getMediaMeta,
    updateMediaMeta,
    removeMedia,
    putMediaRecord,
    countMedia,
    getObjectUrl,
    revokeObjectUrl,
    revokeAllObjectUrls,
    toPublicMeta
};
