/** Admin-only app source export (ZIP). PHP endpoint when available; client zip fallback. */

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function u16(n) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n, true);
    return b;
}

function u32(n) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0, true);
    return b;
}

function concatChunks(chunks) {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

function buildZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
        const nameBytes = encoder.encode(file.path);
        const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
        const dataCrc = crc32(data);
        const localHeader = concatChunks([
            u32(0x04034b50),
            u16(20),
            u16(0),
            u16(0),
            u16(0),
            u16(0),
            u32(dataCrc),
            u32(data.length),
            u32(data.length),
            u16(nameBytes.length),
            u16(0),
            nameBytes,
            data
        ]);
        localParts.push(localHeader);

        const centralHeader = concatChunks([
            u32(0x02014b50),
            u16(20),
            u16(20),
            u16(0),
            u16(0),
            u16(0),
            u16(0),
            u32(dataCrc),
            u32(data.length),
            u32(data.length),
            u16(nameBytes.length),
            u16(0),
            u16(0),
            u16(0),
            u16(0),
            u32(0),
            u32(offset),
            nameBytes
        ]);
        centralParts.push(centralHeader);
        offset += localHeader.length;
    }

    const central = concatChunks(centralParts);
    const local = concatChunks(localParts);
    const end = concatChunks([
        u32(0x06054b50),
        u16(0),
        u16(0),
        u16(files.length),
        u16(files.length),
        u32(central.length),
        u32(local.length),
        u16(0)
    ]);
    return concatChunks([local, central, end]);
}

function triggerDownload(blob, filename) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}

async function fetchExportManifest(token) {
    try {
        const res = await fetch('./api/export-code.php?manifest=1', {
            headers: { 'X-Admin-Token': token },
            cache: 'no-store'
        });
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data?.paths) && data.paths.length) return data.paths;
        }
    } catch {
        /* PHP unavailable */
    }

    const staticRes = await fetch('./api/code-manifest.json', { cache: 'no-store' });
    if (!staticRes.ok) return null;
    const data = await staticRes.json();
    return Array.isArray(data?.paths) ? data.paths : null;
}

async function tryServerZipExport(token) {
    const res = await fetch('./api/export-code.php', {
        headers: { 'X-Admin-Token': token },
        cache: 'no-store'
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (!blob.size) return false;

    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/i);
    const filename = match?.[1] || `magiclists_code_${Math.floor(Date.now() / 1000)}.zip`;
    triggerDownload(blob, filename);
    return true;
}

async function clientZipExport(token, paths) {
    const files = [];
    for (const relPath of paths) {
        const url = `./${relPath.split('/').map(encodeURIComponent).join('/')}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
            console.warn('[codeExport] skipped', relPath, res.status);
            continue;
        }
        files.push({ path: relPath, data: await res.text() });
    }
    if (!files.length) {
        throw new Error('No source files could be fetched for export.');
    }
    const stamp = Math.floor(Date.now() / 1000);
    const blob = new Blob([buildZip(files)], { type: 'application/zip' });
    triggerDownload(blob, `magiclists_code_${stamp}.zip`);
}

/**
 * Export app source as a ZIP download. Requires admin session token.
 * @param {string} token
 */
export async function exportAppCode(token) {
    if (!token) {
        throw new Error('Admin login required.');
    }

    try {
        if (await tryServerZipExport(token)) return;
    } catch (err) {
        console.warn('[codeExport] server zip unavailable', err);
    }

    let paths = null;
    try {
        paths = await fetchExportManifest(token);
    } catch {
        /* static hosting without PHP */
    }

    if (!paths?.length) {
        throw new Error('Code export needs PHP (api/export-code.php) or a local web server.');
    }

    await clientZipExport(token, paths);
}
