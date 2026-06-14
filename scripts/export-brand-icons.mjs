/**
 * Export brand icon rasters from SVG masters.
 * Run: node scripts/export-brand-icons.mjs
 * Requires: npm install sharp (dev-only, run once)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandDir = path.join(__dirname, '..', 'assets', 'brand');
const ids = ['clipboard', 'easel', 'block', 'tile'];

let sharp;
try {
    sharp = (await import('sharp')).default;
} catch {
    console.error('Missing sharp. Run: npm install sharp --no-save');
    process.exit(1);
}

async function exportIcon(id) {
    const svgPath = path.join(brandDir, `icon-${id}.svg`);
    const svg = fs.readFileSync(svgPath);

    const png32 = await sharp(svg).resize(32, 32).png().toBuffer();
    const png180 = await sharp(svg).resize(180, 180).png().toBuffer();

    fs.writeFileSync(path.join(brandDir, `apple-touch-${id}.png`), png180);

    const ico = buildIco([png32, png32]);
    fs.writeFileSync(path.join(brandDir, `favicon-${id}.ico`), ico);
}

function buildIco(images) {
    const count = images.length;
    const headerSize = 6 + count * 16;
    let offset = headerSize;
    const entries = images.map((buf) => {
        const meta = { width: 32, height: 32, size: buf.length, offset };
        offset += buf.length;
        return meta;
    });

    const out = Buffer.alloc(offset);
    out.writeUInt16LE(0, 0);
    out.writeUInt16LE(1, 2);
    out.writeUInt16LE(count, 4);

    entries.forEach((entry, i) => {
        const base = 6 + i * 16;
        out.writeUInt8(entry.width >= 256 ? 0 : entry.width, base);
        out.writeUInt8(entry.height >= 256 ? 0 : entry.height, base + 1);
        out.writeUInt8(0, base + 2);
        out.writeUInt8(0, base + 3);
        out.writeUInt16LE(1, base + 4);
        out.writeUInt16LE(32, base + 6);
        out.writeUInt32LE(entry.size, base + 8);
        out.writeUInt32LE(entry.offset, base + 12);
    });

    let pos = headerSize;
    images.forEach((buf) => {
        buf.copy(out, pos);
        pos += buf.length;
    });

    return out;
}

for (const id of ids) {
    await exportIcon(id);
    console.log(`Exported ${id}`);
}

fs.copyFileSync(
    path.join(brandDir, 'favicon-clipboard.ico'),
    path.join(brandDir, 'favicon.ico')
);
console.log('Done.');
