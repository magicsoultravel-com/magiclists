/** @module {"owns":"media file metadata and EXIF extraction", "related":["mediaLibrary.js"]} */

const ORIENTATION_LABELS = {
    1: 'Normal',
    2: 'Mirrored',
    3: 'Rotated 180°',
    4: 'Mirrored vertical',
    5: 'Mirrored + rotated 90° CW',
    6: 'Rotated 90° CW',
    7: 'Mirrored + rotated 90° CCW',
    8: 'Rotated 90° CCW'
};

/**
 * @param {Blob|File} blob
 * @returns {Promise<{ width: number|null, height: number|null }>}
 */
export async function readImageDimensions(blob) {
    if (!blob || !String(blob.type || '').startsWith('image/')) {
        return { width: null, height: null };
    }
    try {
        if (typeof createImageBitmap === 'function') {
            const bmp = await createImageBitmap(blob);
            const width = bmp.width;
            const height = bmp.height;
            bmp.close?.();
            return { width, height };
        }
    } catch {
        /* fall through */
    }
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve({ width: img.naturalWidth || null, height: img.naturalHeight || null });
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve({ width: null, height: null });
        };
        img.src = url;
    });
}

/**
 * Minimal JPEG EXIF reader for human-facing fields.
 * @param {ArrayBuffer} buffer
 * @returns {object}
 */
export function parseJpegExif(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return {};

    let offset = 2;
    while (offset + 4 <= view.byteLength) {
        if (view.getUint8(offset) !== 0xff) break;
        const marker = view.getUint8(offset + 1);
        const size = view.getUint16(offset + 2);
        if (marker === 0xe1 && size >= 8) {
            return parseExifSegment(view, offset + 4, size - 2);
        }
        if (marker === 0xda) break; // SOS
        offset += 2 + size;
    }
    return {};
}

function parseExifSegment(view, start, length) {
    const end = Math.min(start + length, view.byteLength);
    if (start + 6 > end) return {};
    const header = String.fromCharCode(
        view.getUint8(start),
        view.getUint8(start + 1),
        view.getUint8(start + 2),
        view.getUint8(start + 3)
    );
    if (header !== 'Exif') return {};

    const tiffStart = start + 6;
    if (tiffStart + 8 > end) return {};
    const le = view.getUint16(tiffStart) === 0x4949;
    const get16 = (o) => (le ? view.getUint16(o, true) : view.getUint16(o, false));
    const get32 = (o) => (le ? view.getUint32(o, true) : view.getUint32(o, false));

    if (get16(tiffStart + 2) !== 0x002a) return {};
    const ifd0Offset = get32(tiffStart + 4);
    const result = {};
    const ifd0 = readIfd(view, tiffStart, ifd0Offset, end, le, get16, get32);
    Object.assign(result, mapIfdTags(ifd0, view, tiffStart, end, le, get16, get32));

    if (ifd0.exifOffset != null) {
        const exif = readIfd(view, tiffStart, ifd0.exifOffset, end, le, get16, get32);
        Object.assign(result, mapExifTags(exif, view, tiffStart, end, le, get16, get32));
    }
    if (ifd0.gpsOffset != null) {
        const gps = readIfd(view, tiffStart, ifd0.gpsOffset, end, le, get16, get32);
        const coords = mapGps(gps, view, tiffStart, end, le, get16, get32);
        if (coords) result.gps = coords;
    }
    return result;
}

function readIfd(view, tiffStart, ifdOffset, end, le, get16, get32) {
    const abs = tiffStart + ifdOffset;
    const out = {};
    if (abs + 2 > end) return out;
    const count = get16(abs);
    for (let i = 0; i < count; i++) {
        const entry = abs + 2 + i * 12;
        if (entry + 12 > end) break;
        const tag = get16(entry);
        const type = get16(entry + 2);
        const num = get32(entry + 4);
        const valueOffset = entry + 8;
        out[tag] = { type, num, valueOffset };
    }
    return out;
}

function readValue(entry, view, tiffStart, end, le, get16, get32) {
    if (!entry) return null;
    const { type, num, valueOffset } = entry;
    const typeSize = type === 1 || type === 2 || type === 7 ? 1
        : type === 3 ? 2
            : type === 4 || type === 9 ? 4
                : type === 5 || type === 10 ? 8
                    : 1;
    const byteLen = typeSize * num;
    let dataOffset = valueOffset;
    if (byteLen > 4) {
        dataOffset = tiffStart + get32(valueOffset);
    }
    if (dataOffset < 0 || dataOffset + byteLen > end) return null;

    if (type === 2) {
        let s = '';
        for (let i = 0; i < num; i++) {
            const c = view.getUint8(dataOffset + i);
            if (c === 0) break;
            s += String.fromCharCode(c);
        }
        return s.trim();
    }
    if (type === 3) {
        if (num === 1) return get16(dataOffset);
        const arr = [];
        for (let i = 0; i < num; i++) arr.push(get16(dataOffset + i * 2));
        return arr;
    }
    if (type === 4) {
        if (num === 1) return get32(dataOffset);
        const arr = [];
        for (let i = 0; i < num; i++) arr.push(get32(dataOffset + i * 4));
        return arr;
    }
    if (type === 5 || type === 10) {
        const vals = [];
        for (let i = 0; i < num; i++) {
            const o = dataOffset + i * 8;
            if (o + 8 > end) break;
            const n = get32(o);
            const d = get32(o + 4);
            vals.push(d ? n / d : 0);
        }
        return num === 1 ? vals[0] : vals;
    }
    if (type === 1 || type === 7) {
        if (num === 1) return view.getUint8(dataOffset);
        const arr = [];
        for (let i = 0; i < Math.min(num, 64); i++) arr.push(view.getUint8(dataOffset + i));
        return arr;
    }
    return null;
}

function mapIfdTags(ifd, view, tiffStart, end, le, get16, get32) {
    const out = {};
    const make = readValue(ifd[0x010f], view, tiffStart, end, le, get16, get32);
    const model = readValue(ifd[0x0110], view, tiffStart, end, le, get16, get32);
    const orient = readValue(ifd[0x0112], view, tiffStart, end, le, get16, get32);
    const datetime = readValue(ifd[0x0132], view, tiffStart, end, le, get16, get32);
    if (make) out.cameraMake = String(make);
    if (model) out.cameraModel = String(model);
    if (orient != null) {
        out.orientation = Number(orient);
        out.orientationLabel = ORIENTATION_LABELS[Number(orient)] || String(orient);
    }
    if (datetime) out.capturedAtLabel = String(datetime);
    if (ifd[0x8769]) {
        out.exifOffset = readValue(ifd[0x8769], view, tiffStart, end, le, get16, get32);
    }
    if (ifd[0x8825]) {
        out.gpsOffset = readValue(ifd[0x8825], view, tiffStart, end, le, get16, get32);
    }
    return out;
}

function mapExifTags(ifd, view, tiffStart, end, le, get16, get32) {
    const out = {};
    const dto = readValue(ifd[0x9003], view, tiffStart, end, le, get16, get32);
    if (dto) out.capturedAtLabel = String(dto);
    const soft = readValue(ifd[0xa002], view, tiffStart, end, le, get16, get32);
    const soh = readValue(ifd[0xa003], view, tiffStart, end, le, get16, get32);
    if (soft != null) out.exifWidth = Number(soft);
    if (soh != null) out.exifHeight = Number(soh);
    return out;
}

function mapGps(ifd, view, tiffStart, end, le, get16, get32) {
    const latRef = readValue(ifd[0x0001], view, tiffStart, end, le, get16, get32);
    const lat = readValue(ifd[0x0002], view, tiffStart, end, le, get16, get32);
    const lonRef = readValue(ifd[0x0003], view, tiffStart, end, le, get16, get32);
    const lon = readValue(ifd[0x0004], view, tiffStart, end, le, get16, get32);
    if (!Array.isArray(lat) || !Array.isArray(lon) || lat.length < 3 || lon.length < 3) return null;
    let latitude = lat[0] + lat[1] / 60 + lat[2] / 3600;
    let longitude = lon[0] + lon[1] / 60 + lon[2] / 3600;
    if (String(latRef).toUpperCase().startsWith('S')) latitude = -latitude;
    if (String(lonRef).toUpperCase().startsWith('W')) longitude = -longitude;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { lat: latitude, lon: longitude };
}

/**
 * Parse EXIF from JPEG blob when applicable.
 * @param {Blob} blob
 * @returns {Promise<object>}
 */
export async function extractExifFromBlob(blob) {
    if (!blob) return {};
    const type = String(blob.type || '').toLowerCase();
    const looksJpeg = type === 'image/jpeg' || type === 'image/jpg';
    if (!looksJpeg) {
        // Clipboard blobs often have empty type — sniff JPEG magic
        const head = await blob.slice(0, 2).arrayBuffer();
        const view = new DataView(head);
        if (view.byteLength < 2 || view.getUint16(0) !== 0xffd8) return {};
    }
    // Cap read to first 256KB — EXIF lives near the start
    const slice = blob.slice(0, Math.min(blob.size, 256 * 1024));
    const buffer = await slice.arrayBuffer();
    return parseJpegExif(buffer);
}

/**
 * @param {string} label - EXIF datetime "YYYY:MM:DD HH:MM:SS"
 * @returns {number|null} unix seconds
 */
export function parseExifDateToUnix(label) {
    if (!label || typeof label !== 'string') return null;
    const m = label.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const d = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6])
    );
    const t = Math.floor(d.getTime() / 1000);
    return Number.isFinite(t) ? t : null;
}

/**
 * Build human metadata for a file/blob before commit.
 * @param {Blob|File} blob
 * @param {{ filename?: string, source?: string }} [opts]
 */
export async function buildMediaMetadata(blob, opts = {}) {
    const filename = opts.filename
        || (blob instanceof File && blob.name)
        || guessFilename(blob);
    const mime = blob.type || guessMime(filename) || 'application/octet-stream';
    const byteSize = blob.size || 0;
    const dims = await readImageDimensions(blob);
    let exif = {};
    try {
        exif = await extractExifFromBlob(blob);
    } catch {
        exif = {};
    }

    const capturedAt = parseExifDateToUnix(exif.capturedAtLabel) || null;

    return {
        filename,
        mime,
        byteSize,
        width: dims.width ?? exif.exifWidth ?? null,
        height: dims.height ?? exif.exifHeight ?? null,
        cameraMake: exif.cameraMake || null,
        cameraModel: exif.cameraModel || null,
        orientation: exif.orientation ?? null,
        orientationLabel: exif.orientationLabel || null,
        capturedAt,
        capturedAtLabel: exif.capturedAtLabel || null,
        gps: exif.gps || null,
        source: opts.source || 'upload'
    };
}

function guessFilename(blob) {
    const mime = blob?.type || '';
    if (mime.startsWith('image/')) {
        const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
        return `pasted-image.${ext}`;
    }
    if (mime) {
        const ext = mime.split('/')[1] || 'bin';
        return `pasted-file.${ext}`;
    }
    return 'pasted-file.bin';
}

function guessMime(filename) {
    const lower = String(filename || '').toLowerCase();
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.txt')) return 'text/plain';
    if (lower.endsWith('.zip')) return 'application/zip';
    return '';
}

/**
 * Generate a small JPEG thumbnail for image blobs.
 * @param {Blob} blob
 * @param {number} [maxEdge=240]
 * @returns {Promise<Blob|null>}
 */
export async function generateThumbnail(blob, maxEdge = 240) {
    if (!blob || !String(blob.type || '').startsWith('image/')) return null;
    try {
        let bitmap;
        if (typeof createImageBitmap === 'function') {
            bitmap = await createImageBitmap(blob);
        } else {
            return null;
        }
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height, 1));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            bitmap.close?.();
            return null;
        }
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();
        const thumb = await new Promise((resolve) => {
            canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.72);
        });
        return thumb || null;
    } catch {
        return null;
    }
}

/**
 * Human-readable size.
 * @param {number} bytes
 */
export function formatByteSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Flatten meta fields into display rows for UI.
 * @param {object} meta
 * @returns {Array<{ label: string, value: string }>}
 */
export function humanMetaRows(meta) {
    if (!meta) return [];
    const rows = [];
    const push = (label, value) => {
        if (value == null || value === '') return;
        rows.push({ label, value: String(value) });
    };
    const formatUnix = (ts) => {
        if (!ts) return null;
        const d = new Date(Number(ts) * 1000);
        return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
    };
    push('Filename', meta.filename);
    push('Type', meta.mime);
    push('Size', formatByteSize(meta.byteSize));
    if (meta.width && meta.height) push('Resolution', `${meta.width} × ${meta.height}`);
    push('Camera', [meta.cameraMake, meta.cameraModel].filter(Boolean).join(' ') || null);
    push('Taken', meta.capturedAtLabel || (meta.capturedAt
        ? new Date(meta.capturedAt * 1000).toLocaleString()
        : null));
    push('Added', formatUnix(meta.createdAt));
    if (meta.updatedAt && meta.updatedAt !== meta.createdAt) {
        push('Modified', formatUnix(meta.updatedAt));
    }
    push('Orientation', meta.orientationLabel);
    if (meta.gps?.lat != null && meta.gps?.lon != null) {
        push('GPS', `${meta.gps.lat.toFixed(5)}, ${meta.gps.lon.toFixed(5)}`);
    }
    push('Source', meta.source);
    if (meta.blobMissing) push('Status', 'File missing (metadata only)');
    return rows;
}

/**
 * Added / Modified timestamps for media detail overview row.
 * @param {object} meta
 * @returns {{ added: string, modified: string }}
 */
export function formatMediaDetailDates(meta) {
    const formatUnix = (ts) => {
        if (!ts) return '';
        const d = new Date(Number(ts) * 1000);
        return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
    };
    if (!meta) return { added: '', modified: '' };
    const added = formatUnix(meta.createdAt);
    const modified = meta.updatedAt && meta.updatedAt !== meta.createdAt
        ? formatUnix(meta.updatedAt)
        : '';
    return { added, modified };
}
