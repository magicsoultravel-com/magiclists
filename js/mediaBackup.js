/** @module {"owns":"media library backup export/import (meta JSON, embeds, ZIP)", "related":["mediaLibrary.js","backup.js"]} */
import {
    MEDIA_EMBED_CAP,
    getMediaRecord,
    listMedia,
    putMediaRecord,
    toPublicMeta,
    createMediaId
} from './mediaLibrary.js';
import { generateThumbnail } from './mediaMetadata.js';
import { IndexedDBMediaStore } from './storage/indexedDbMediaStore.js';

export const MEDIA_META_FILE_PREFIX = 'matrix_media_meta_';
export const MEDIA_ZIP_FILE_PREFIX = 'matrix_media_backup_';

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
async function blobToBase64(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

/**
 * @param {string} b64
 * @param {string} mime
 * @returns {Blob}
 */
function base64ToBlob(b64, mime) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

/**
 * Build media_library section for workspace JSON (meta + small embeds).
 * @param {{ embed?: boolean }} [opts]
 */
export async function buildMediaLibraryBackupSection(opts = {}) {
    const embed = opts.embed !== false;
    const records = await IndexedDBMediaStore.getAll();
    const items = [];

    for (const record of records) {
        const meta = toPublicMeta(record);
        if (!meta) continue;
        const entry = { ...meta };
        delete entry.blobPresent;
        if (embed && record.blob && record.byteSize <= MEDIA_EMBED_CAP) {
            try {
                entry.dataBase64 = await blobToBase64(record.blob);
                entry.blobPresent = true;
            } catch {
                entry.blobPresent = false;
            }
        } else {
            entry.blobPresent = !!(record.blob && !record.blobMissing);
        }
        items.push(entry);
    }

    return {
        version: 1,
        exportedAt: nowSeconds(),
        items
    };
}

/**
 * Meta-only package (never embeds).
 */
export async function buildMediaMetaOnlyPackage() {
    const items = await listMedia();
    return {
        version: 1,
        exportedAt: nowSeconds(),
        items: items.map((m) => {
            const copy = { ...m };
            delete copy.dataBase64;
            return copy;
        })
    };
}

/**
 * Apply media_library section from workspace / meta JSON.
 * @param {object} section
 * @returns {Promise<number>} items upserted
 */
export async function applyMediaLibraryBackupSection(section) {
    if (!section || typeof section !== 'object') return 0;
    const items = Array.isArray(section.items) ? section.items : [];
    let count = 0;

    for (const entry of items) {
        if (!entry || typeof entry !== 'object') continue;
        const id = entry.id || createMediaId();
        const existing = await getMediaRecord(id);
        let blob = existing?.blob || null;
        let thumbBlob = existing?.thumbBlob || null;
        let blobMissing = true;

        if (entry.dataBase64) {
            try {
                blob = base64ToBlob(entry.dataBase64, entry.mime || 'application/octet-stream');
                blobMissing = false;
                thumbBlob = (await generateThumbnail(blob)) || thumbBlob;
            } catch {
                blob = existing?.blob || null;
                blobMissing = !blob;
            }
        } else if (blob) {
            blobMissing = false;
        }

        const ts = nowSeconds();
        const record = {
            id,
            filename: entry.filename || existing?.filename || 'file',
            mime: entry.mime || existing?.mime || 'application/octet-stream',
            byteSize: entry.byteSize ?? blob?.size ?? existing?.byteSize ?? 0,
            title: entry.title ?? existing?.title ?? '',
            description: entry.description ?? existing?.description ?? '',
            source: entry.source || existing?.source || 'import',
            createdAt: entry.createdAt || existing?.createdAt || ts,
            updatedAt: ts,
            width: entry.width ?? existing?.width ?? null,
            height: entry.height ?? existing?.height ?? null,
            cameraMake: entry.cameraMake ?? existing?.cameraMake ?? null,
            cameraModel: entry.cameraModel ?? existing?.cameraModel ?? null,
            orientation: entry.orientation ?? existing?.orientation ?? null,
            orientationLabel: entry.orientationLabel ?? existing?.orientationLabel ?? null,
            capturedAt: entry.capturedAt ?? existing?.capturedAt ?? null,
            capturedAtLabel: entry.capturedAtLabel ?? existing?.capturedAtLabel ?? null,
            gps: entry.gps ?? existing?.gps ?? null,
            blob,
            thumbBlob,
            blobMissing
        };
        await putMediaRecord(record);
        count += 1;
    }
    return count;
}

export async function downloadMediaMetaJson() {
    const pkg = await buildMediaMetaOnlyPackage();
    const text = JSON.stringify(pkg, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    triggerDownload(blob, `${MEDIA_META_FILE_PREFIX}${nowSeconds()}.json`);
}

export async function importMediaMetaJsonFile(file) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid media meta file');
    const section = parsed.media_library || parsed;
    if (!Array.isArray(section.items)) throw new Error('Not a media metadata file');
    return applyMediaLibraryBackupSection(section);
}

function safeName(name) {
    return String(name || 'file').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
}

/**
 * Uncompressed ZIP (store) writer — enough for offline media packages.
 * @param {Array<{ name: string, data: Uint8Array }>} files
 * @returns {Blob}
 */
function buildZipStore(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
        const nameBytes = encoder.encode(file.name);
        const data = file.data;
        const crc = crc32(data);
        const local = new Uint8Array(30 + nameBytes.length + data.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0, true);
        lv.setUint16(8, 0, true);
        lv.setUint16(10, 0, true);
        lv.setUint16(12, 0, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);
        local.set(nameBytes, 30);
        local.set(data, 30 + nameBytes.length);
        localParts.push(local);

        const central = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(central.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, 0, true);
        cv.setUint16(14, 0, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);
        central.set(nameBytes, 46);
        centralParts.push(central);

        offset += local.length;
    }

    const centralSize = centralParts.reduce((n, p) => n + p.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

function crc32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Minimal ZIP reader (store + deflate via DecompressionStream when available).
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Map<string, Uint8Array>>}
 */
async function readZip(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const files = new Map();
    let offset = 0;

    while (offset + 4 <= view.byteLength) {
        const sig = view.getUint32(offset, true);
        if (sig !== 0x04034b50) break;
        const method = view.getUint16(offset + 8, true);
        const compSize = view.getUint32(offset + 18, true);
        const nameLen = view.getUint16(offset + 26, true);
        const extraLen = view.getUint16(offset + 28, true);
        const nameStart = offset + 30;
        const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
        const dataStart = nameStart + nameLen + extraLen;
        const compressed = bytes.subarray(dataStart, dataStart + compSize);
        let data = compressed;
        if (method === 8) {
            if (typeof DecompressionStream === 'undefined') {
                throw new Error('Deflated ZIP entries require DecompressionStream');
            }
            const ds = new DecompressionStream('deflate-raw');
            const stream = new Blob([compressed]).stream().pipeThrough(ds);
            data = new Uint8Array(await new Response(stream).arrayBuffer());
        } else if (method !== 0) {
            throw new Error(`Unsupported ZIP compression method ${method}`);
        }
        files.set(name, data);
        offset = dataStart + compSize;
    }
    return files;
}

export async function downloadMediaZip() {
    const records = await IndexedDBMediaStore.getAll();
    const manifestItems = [];
    const zipFiles = [];
    const encoder = new TextEncoder();

    for (const record of records) {
        const meta = toPublicMeta(record);
        if (!meta) continue;
        manifestItems.push(meta);
        if (record.blob && !record.blobMissing) {
            const buf = new Uint8Array(await record.blob.arrayBuffer());
            const path = `files/${record.id}_${safeName(record.filename)}`;
            zipFiles.push({ name: path, data: buf });
            meta.zipPath = path;
        }
    }

    const manifest = {
        version: 1,
        exportedAt: nowSeconds(),
        items: manifestItems
    };
    zipFiles.unshift({
        name: 'manifest.json',
        data: encoder.encode(JSON.stringify(manifest, null, 2))
    });

    const zipBlob = buildZipStore(zipFiles);
    triggerDownload(zipBlob, `${MEDIA_ZIP_FILE_PREFIX}${nowSeconds()}.zip`);
}

export async function importMediaZipFile(file) {
    const buffer = await file.arrayBuffer();
    const files = await readZip(buffer);
    const manifestBytes = files.get('manifest.json');
    if (!manifestBytes) throw new Error('Missing manifest.json in media ZIP');
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    const items = Array.isArray(manifest.items) ? manifest.items : [];
    let count = 0;
    const ts = nowSeconds();

    for (const entry of items) {
        const id = entry.id || createMediaId();
        let blob = null;
        let path = entry.zipPath;
        if (!path) {
            // fallback: find files/<id>_
            for (const key of files.keys()) {
                if (key.startsWith(`files/${id}_`) || key.startsWith(`files/${id}.`)) {
                    path = key;
                    break;
                }
            }
        }
        if (path && files.has(path)) {
            const data = files.get(path);
            blob = new Blob([data], { type: entry.mime || 'application/octet-stream' });
        }
        const thumbBlob = blob ? await generateThumbnail(blob) : null;
        await putMediaRecord({
            id,
            filename: entry.filename || 'file',
            mime: entry.mime || 'application/octet-stream',
            byteSize: entry.byteSize ?? blob?.size ?? 0,
            title: entry.title || '',
            description: entry.description || '',
            source: entry.source || 'import',
            createdAt: entry.createdAt || ts,
            updatedAt: ts,
            width: entry.width ?? null,
            height: entry.height ?? null,
            cameraMake: entry.cameraMake || null,
            cameraModel: entry.cameraModel || null,
            orientation: entry.orientation ?? null,
            orientationLabel: entry.orientationLabel || null,
            capturedAt: entry.capturedAt ?? null,
            capturedAtLabel: entry.capturedAtLabel || null,
            gps: entry.gps || null,
            blob,
            thumbBlob,
            blobMissing: !blob
        });
        count += 1;
    }
    return count;
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}
