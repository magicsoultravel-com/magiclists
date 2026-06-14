import { conditionFromIcon, conditionFromMetrics } from './weatherIcons.js';

const FORECAST_PROXY = 'https://imgw-api-proxy.evtlab.pl/forecast';

export const ImgwForecastProvider = {
    id: 'imgw-forecast',
    label: 'IMGW forecast',
    kind: 'forecast',
    defaultEnabled: false,
    ttlMs: 15 * 60 * 1000,

    async fetch(ctx) {
        const { lat, lon, signal } = ctx;
        const qs = `lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
        return fetchForecast(`${FORECAST_PROXY}?${qs}`, signal);
    },
    normalize(raw) {
        if (!raw || typeof raw !== 'object') return {};

        const current = raw.current || {};
        const firstHourly = raw.hourly?.[0];
        const currentIcon = current.icon || firstHourly?.icon || null;
        const condition = currentIcon
            ? conditionFromIcon(currentIcon)
            : conditionFromMetrics(current);

        return {
            location: raw.location ? {
                lat: raw.location.Lat ?? raw.location.lat,
                lon: raw.location.Lon ?? raw.location.lon,
                gridIndex: raw.location.Index
            } : undefined,
            current: {
                temp: num(current.temp),
                feelsLike: num(current.feels_like),
                humidity: num(current.humidity),
                pressure: num(current.pressure),
                windSpeed: num(current.wind_speed),
                windGust: num(current.wind_gust),
                windDir: num(current.wind_dir),
                cloud: num(current.cloud),
                precip: num(current.precip),
                rain: num(current.rain),
                snow: num(current.snow),
                condition,
                icon: currentIcon,
                updatedAt: current.date || null
            },
            hourly: buildImgwHourlyFromNow(raw.hourly || [], current.date, 12),
            daily: (raw.daily || []).slice(0, 4).map((d) => ({
                date: d.date,
                tempMin: num(d.temp_min),
                tempMax: num(d.temp_max),
                precip: num(d.precip),
                rain: num(d.rain),
                snow: num(d.snow),
                icon: d.icon,
                condition: d.icon ? conditionFromIcon(d.icon) : conditionFromMetrics(d)
            })),
            model: raw.model || null
        };
    }
};

async function fetchForecast(url, signal) {
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`IMGW forecast HTTP ${res.status}`);
    return parseJsonResponse(res);
}

async function parseJsonResponse(res) {
    const text = await res.text();
    const trimmed = text.trimStart();
    if (trimmed.startsWith('<?php') || trimmed.startsWith('<!')) {
        throw new Error('Forecast response was not JSON (server returned HTML/PHP)');
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new Error('Forecast response was not valid JSON');
    }
}

function num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

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

function buildImgwHourlyFromNow(rows, anchorIso, count) {
    const times = rows.map((h) => h.date);
    const start = hourlyStartIndex(times, anchorIso);
    return rows.slice(start, start + count).map((h) => ({
        date: h.date,
        temp: num(h.temp),
        feelsLike: num(h.feels_like),
        precip: num(h.precip),
        rain: num(h.rain),
        snow: num(h.snow),
        cloud: num(h.cloud),
        windSpeed: num(h.wind_speed),
        icon: h.icon,
        condition: h.icon ? conditionFromIcon(h.icon) : conditionFromMetrics(h)
    }));
}
