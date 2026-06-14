import { conditionFromWmoCode } from './weatherIcons.js';

const API_BASE = 'https://api.open-meteo.com/v1/forecast';

export const OpenMeteoForecastProvider = {
    id: 'open-meteo-forecast',
    label: 'Open-Meteo forecast',
    kind: 'forecast',
    defaultEnabled: true,
    ttlMs: 15 * 60 * 1000,

    async fetch(ctx) {
        const { lat, lon, signal } = ctx;
        const params = new URLSearchParams({
            latitude: String(lat),
            longitude: String(lon),
            timezone: 'auto',
            forecast_days: '4',
            current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code',
            hourly: 'temperature_2m,weather_code',
            daily: 'weather_code,temperature_2m_max,temperature_2m_min'
        });
        const res = await fetch(`${API_BASE}?${params}`, { signal, headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
        return res.json();
    },

    normalize(raw) {
        if (!raw || typeof raw !== 'object') return {};

        const current = raw.current || {};
        const wmoCurrent = current.weather_code;
        const condition = conditionFromWmoCode(wmoCurrent);

        const hTimes = raw.hourly?.time || [];
        const hTemps = raw.hourly?.temperature_2m || [];
        const hCodes = raw.hourly?.weather_code || [];
        const hourly = buildHourlyFromNow(hTimes, hTemps, hCodes, current.time, 12);

        const daily = [];
        const dTimes = raw.daily?.time || [];
        const dMax = raw.daily?.temperature_2m_max || [];
        const dMin = raw.daily?.temperature_2m_min || [];
        const dCodes = raw.daily?.weather_code || [];
        for (let i = 0; i < Math.min(dTimes.length, 4); i++) {
            const code = dCodes[i];
            daily.push({
                date: `${dTimes[i]}T12:00:00`,
                tempMin: num(dMin[i]),
                tempMax: num(dMax[i]),
                icon: code,
                condition: conditionFromWmoCode(code)
            });
        }

        return {
            location: raw.latitude != null ? {
                lat: raw.latitude,
                lon: raw.longitude
            } : undefined,
            current: {
                temp: num(current.temperature_2m),
                feelsLike: num(current.apparent_temperature),
                humidity: num(current.relative_humidity_2m),
                condition,
                icon: wmoCurrent,
                updatedAt: current.time || null
            },
            hourly,
            daily,
            model: 'Open-Meteo'
        };
    }
};

function num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** First hourly index at or after the anchor time's hour (local). */
function hourlyStartIndex(times, anchorIso) {
    if (!times.length) return 0;
    const anchor = anchorIso ? new Date(anchorIso) : new Date();
    const floor = new Date(anchor);
    floor.setMinutes(0, 0, 0);
    const floorMs = floor.getTime();
    for (let i = 0; i < times.length; i++) {
        const slotMs = new Date(times[i]).getTime();
        if (Number.isFinite(slotMs) && slotMs >= floorMs) return i;
    }
    return 0;
}

function buildHourlyFromNow(times, temps, codes, anchorIso, count) {
    const start = hourlyStartIndex(times, anchorIso);
    const hourly = [];
    for (let i = start; i < Math.min(times.length, start + count); i++) {
        const code = codes[i];
        hourly.push({
            date: times[i],
            temp: num(temps[i]),
            icon: code,
            condition: conditionFromWmoCode(code)
        });
    }
    return hourly;
}
