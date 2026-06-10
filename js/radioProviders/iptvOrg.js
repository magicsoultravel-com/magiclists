import { normalizeStation, PROVIDER_IPTV_ORG } from './stationShape.js';

const IPTV_CHANNELS_URL = 'https://iptv-org.github.io/api/channels.json';
const IPTV_STREAMS_URL = 'https://iptv-org.github.io/api/streams.json';
const IPTV_COUNTRIES_URL = 'https://iptv-org.github.io/api/countries.json';
const CACHE_KEY = 'matrix_radio_iptv_cache';
const TTL = 24 * 60 * 60 * 1000;

function loadCache() {
    try {
        return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    } catch {
        return {};
    }
}

function saveCache(data) {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), data }));
}

function isFresh(entry) {
    return entry && Number.isFinite(entry.cachedAt) && (Date.now() - entry.cachedAt) < TTL;
}

async function loadCatalog(refresh = false) {
    const cached = loadCache();
    if (!refresh && isFresh(cached) && cached.data) {
        return cached.data;
    }

    const [channelsRes, streamsRes, countriesRes] = await Promise.all([
        fetch(IPTV_CHANNELS_URL),
        fetch(IPTV_STREAMS_URL),
        fetch(IPTV_COUNTRIES_URL)
    ]);

    if (!channelsRes.ok || !streamsRes.ok) {
        throw new Error('Could not load iptv-org catalog');
    }

    const channels = await channelsRes.json();
    const streams = await streamsRes.json();
    const countries = countriesRes.ok ? await countriesRes.json() : [];

    const streamByChannel = new Map();
    (Array.isArray(streams) ? streams : []).forEach((s) => {
        const ch = s.channel || s.id;
        if (ch && s.url && !streamByChannel.has(ch)) {
            streamByChannel.set(ch, s.url);
        }
    });

    const countryNames = new Map(
        (Array.isArray(countries) ? countries : []).map((c) => [c.code, c.name])
    );

    const radioChannels = (Array.isArray(channels) ? channels : []).filter((ch) => {
        const cats = ch.categories || [];
        return cats.some((c) => String(c).toLowerCase() === 'radio');
    });

    const stations = radioChannels
        .map((ch) => {
            const url = streamByChannel.get(ch.id);
            if (!url) return null;
            return {
                id: ch.id,
                name: ch.name,
                country: ch.country || '',
                logo: ch.logo || '',
                categories: ch.categories || [],
                url_resolved: url
            };
        })
        .filter(Boolean);

    const countryCounts = new Map();
    stations.forEach((s) => {
        if (!s.country) return;
        countryCounts.set(s.country, (countryCounts.get(s.country) || 0) + 1);
    });

    const countryList = [...countryCounts.entries()]
        .map(([code, stationcount]) => ({
            iso_3166_1: code,
            name: countryNames.get(code) || code,
            stationcount
        }))
        .sort((a, b) => b.stationcount - a.stationcount);

    const byId = new Map(stations.map((s) => [s.id, s]));
    const byCountry = new Map();
    stations.forEach((s) => {
        if (!s.country) return;
        if (!byCountry.has(s.country)) byCountry.set(s.country, []);
        byCountry.get(s.country).push(s);
    });

    const catalog = { stations, countryList, byId, byCountry };
    saveCache(catalog);
    return catalog;
}

export const IptvOrgProvider = {
    id: PROVIDER_IPTV_ORG,
    label: 'iptv-org',

    async getCountries({ refresh = false } = {}) {
        const catalog = await loadCatalog(refresh);
        return catalog.countryList;
    },

    async searchStations({ countrycode = '', limit = 100, refresh = false, hideOffline = true } = {}) {
        const catalog = await loadCatalog(refresh);
        let list = countrycode
            ? (catalog.byCountry.get(countrycode) || [])
            : catalog.stations;

        if (hideOffline) {
            list = list.filter((s) => s.url_resolved);
        }

        return list
            .slice(0, limit)
            .map((s) => normalizeStation(s, PROVIDER_IPTV_ORG))
            .filter(Boolean);
    },

    async getStationById(stationId, { refresh = false } = {}) {
        const catalog = await loadCatalog(refresh);
        const raw = catalog.byId.get(stationId);
        return normalizeStation(raw, PROVIDER_IPTV_ORG);
    },

    async getStationsByIds(ids, opts = {}) {
        const results = await Promise.all(
            ids.map((id) => this.getStationById(id, opts))
        );
        return results.filter(Boolean);
    },

    reportClick() {
        /* no-op */
    },

    invalidateCache() {
        localStorage.removeItem(CACHE_KEY);
    },

    clearCache() {
        localStorage.removeItem(CACHE_KEY);
    }
};
