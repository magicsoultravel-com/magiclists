import { haversineKm } from './imgwSynopStations.js';

export const WEATHER_LOCATIONS = [
    { id: 'warsaw', label: 'Warsaw', lat: 52.19638889, lon: 21.04638889, teryt: '146501' },
    { id: 'krakow', label: 'Kraków', lat: 50.0647, lon: 19.9450, teryt: '126101' },
    { id: 'gdansk', label: 'Gdańsk', lat: 54.3520, lon: 18.6466, teryt: '226101' },
    { id: 'wroclaw', label: 'Wrocław', lat: 51.1079, lon: 17.0385, teryt: '026401' },
    { id: 'poznan', label: 'Poznań', lat: 52.4086, lon: 16.8122, teryt: '306401' },
    { id: 'lodz', label: 'Łódź', lat: 51.7219, lon: 19.3981, teryt: '106101' },
    { id: 'szczecin', label: 'Szczecin', lat: 53.3956, lon: 14.9019, teryt: '326201' },
    { id: 'lublin', label: 'Lublin', lat: 51.2500, lon: 22.5667, teryt: '066101' },
    { id: 'katowice', label: 'Katowice', lat: 50.8125, lon: 19.0889, teryt: '246901' },
    { id: 'bialystok', label: 'Białystok', lat: 53.1072, lon: 23.1139, teryt: '206101' }
];

const BY_ID = Object.fromEntries(WEATHER_LOCATIONS.map((loc) => [loc.id, loc]));

export function getLocationById(id) {
    return BY_ID[id] || WEATHER_LOCATIONS[0];
}

export function listLocations() {
    return WEATHER_LOCATIONS.map(({ id, label }) => ({ id, label }));
}

export function findNearestLocation(lat, lon) {
    let best = WEATHER_LOCATIONS[0];
    let bestDist = Infinity;
    for (const loc of WEATHER_LOCATIONS) {
        const dist = haversineKm(lat, lon, loc.lat, loc.lon);
        if (dist < bestDist) {
            bestDist = dist;
            best = loc;
        }
    }
    return best;
}

export function resolveLocationSettings(settings) {
    const raw = settings || {};
    if (raw.locationId && BY_ID[raw.locationId]) {
        const loc = BY_ID[raw.locationId];
        return {
            locationId: loc.id,
            lat: loc.lat,
            lon: loc.lon,
            label: loc.label,
            teryt: loc.teryt,
            refreshMinutes: raw.refreshMinutes ?? 15,
            enabledSources: raw.enabledSources
        };
    }

    if (Number.isFinite(raw.lat) && Number.isFinite(raw.lon)) {
        const loc = findNearestLocation(raw.lat, raw.lon);
        return {
            locationId: loc.id,
            lat: loc.lat,
            lon: loc.lon,
            label: loc.label,
            teryt: loc.teryt,
            refreshMinutes: raw.refreshMinutes ?? 15,
            enabledSources: raw.enabledSources
        };
    }

    const loc = WEATHER_LOCATIONS[0];
    return {
        locationId: loc.id,
        lat: loc.lat,
        lon: loc.lon,
        label: loc.label,
        teryt: loc.teryt,
        refreshMinutes: raw.refreshMinutes ?? 15,
        enabledSources: raw.enabledSources
    };
}
