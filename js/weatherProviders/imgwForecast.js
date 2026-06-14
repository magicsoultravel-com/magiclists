import { conditionFromIcon } from './weatherIcons.js';

const FORECAST_PROXY = 'https://imgw-api-proxy.evtlab.pl/forecast';
const LOCAL_PROXY = './api/weather-proxy.php';

export const ImgwForecastProvider = {
    id: 'imgw-forecast',
    label: 'IMGW forecast',
    kind: 'forecast',
    defaultEnabled: true,
    ttlMs: 15 * 60 * 1000,

    async fetch(ctx) {
        const { lat, lon, signal } = ctx;
        const qs = `lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
        try {
            return await fetchForecast(`${FORECAST_PROXY}?${qs}`, signal);
        } catch (err) {
            if (isCorsOrNetworkError(err)) {
                return fetchForecast(`${LOCAL_PROXY}?${qs}`, signal);
            }
            throw err;
        }
    },

    normalize(raw) {
        if (!raw || typeof raw !== 'object') return {};

        const current = raw.current || {};
        const dailyIcon = raw.daily?.[0]?.icon;
        const condition = conditionFromIcon(dailyIcon);

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
                condition,
                icon: dailyIcon,
                updatedAt: current.date || null
            },
            hourly: (raw.hourly || []).slice(0, 24).map((h) => ({
                date: h.date,
                temp: num(h.temp),
                feelsLike: num(h.feels_like),
                precip: num(h.precip),
                rain: num(h.rain),
                windSpeed: num(h.wind_speed),
                icon: h.icon,
                condition: conditionFromIcon(h.icon)
            })),
            daily: (raw.daily || []).slice(0, 4).map((d) => ({
                date: d.date,
                tempMin: num(d.temp_min),
                tempMax: num(d.temp_max),
                precip: num(d.precip),
                rain: num(d.rain),
                icon: d.icon,
                condition: conditionFromIcon(d.icon)
            })),
            model: raw.model || null
        };
    }
};

async function fetchForecast(url, signal) {
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`IMGW forecast HTTP ${res.status}`);
    return res.json();
}

function isCorsOrNetworkError(err) {
    if (!err) return false;
    if (err.name === 'TypeError') return true;
    return /failed to fetch|network|cors/i.test(String(err.message || err));
}

function num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
