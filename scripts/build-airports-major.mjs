/**
 * Builds data/airports-major.json from OurAirports (large_airport + IATA).
 * Run: node scripts/build-airports-major.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'data', 'airports-major.json');
const CSV_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';

function parseCsvLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            values.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    values.push(current);
    return values;
}

const csv = await fetch(CSV_URL).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
});

const lines = csv.trim().split(/\r?\n/);
const headers = parseCsvLine(lines[0]);
const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

const features = [];

for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (row[idx.type] !== 'large_airport') continue;

    const iata = (row[idx.iata_code] || '').trim();
    if (!iata) continue;

    const lat = parseFloat(row[idx.latitude_deg]);
    const lng = parseFloat(row[idx.longitude_deg]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {
            name: row[idx.name] || '',
            iata,
            icao: (row[idx.icao_code] || row[idx.gps_code] || '').trim(),
            city: row[idx.municipality] || '',
            country: row[idx.iso_country] || ''
        }
    });
}

features.sort((a, b) => a.properties.iata.localeCompare(b.properties.iata));

const geojson = {
    type: 'FeatureCollection',
    meta: {
        source: 'OurAirports (ourairports.com)',
        filter: 'large_airport with IATA',
        count: features.length,
        generated: new Date().toISOString().slice(0, 10)
    },
    features
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(geojson));

console.log(`Wrote ${features.length} airports to ${OUT}`);
