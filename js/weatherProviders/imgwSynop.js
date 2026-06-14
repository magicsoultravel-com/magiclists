import { findNearestStation } from './imgwSynopStations.js';

const SYNOP_URL = 'https://danepubliczne.imgw.pl/api/data/synop';

export const ImgwSynopProvider = {
    id: 'imgw-synop',
    label: 'IMGW synop',
    kind: 'observation',
    defaultEnabled: false,
    ttlMs: 30 * 60 * 1000,

    async fetch(ctx) {
        const { lat, lon, signal } = ctx;
        const res = await fetch(SYNOP_URL, { signal, headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`IMGW synop HTTP ${res.status}`);
        const stations = await res.json();
        const nearest = findNearestStation(lat, lon);
        if (!nearest) return { stations, nearest: null };

        const row = Array.isArray(stations)
            ? stations.find((s) => String(s.id_stacji) === nearest.id)
            : null;
        return { stations, nearest, row };
    },

    normalize(raw) {
        const row = raw?.row;
        if (!row) {
            return raw?.nearest ? {
                observation: {
                    stationId: raw.nearest.id,
                    stationName: raw.nearest.name,
                    distanceKm: Math.round(raw.nearest.distanceKm * 10) / 10,
                    updatedAt: null
                }
            } : {};
        }

        const updatedAt = row.data_pomiaru && row.godzina_pomiaru
            ? `${row.data_pomiaru}T${String(row.godzina_pomiaru).padStart(2, '0')}:00:00`
            : null;

        return {
            observation: {
                stationId: String(row.id_stacji),
                stationName: row.stacja || raw.nearest?.name,
                distanceKm: raw.nearest ? Math.round(raw.nearest.distanceKm * 10) / 10 : null,
                temp: num(row.temperatura),
                humidity: num(row.wilgotnosc_wzgledna),
                pressure: num(row.cisnienie),
                windSpeed: num(row.predkosc_wiatru),
                windDir: num(row.kierunek_wiatru),
                rain: num(row.suma_opadu),
                updatedAt
            }
        };
    }
};

function num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
