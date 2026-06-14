import { WeatherProviderRegistry } from './weatherProviders/registry.js';
import { resolveLocationSettings, listLocations } from './weatherProviders/weatherLocations.js';

const CACHE_KEY = 'magiclists_weather_cache';
const SETTINGS_KEY = 'magiclists_weather_settings';

const DEFAULT_SETTINGS = {
    locationId: 'warsaw',
    lat: 52.19638889,
    lon: 21.04638889,
    label: 'Warsaw',
    teryt: '146501',
    enabledSources: ['open-meteo-forecast'],
    refreshMinutes: 15
};

let state = {
    snapshot: null,
    loading: false,
    lastRefreshAt: null
};

let abortController = null;
let pollTimer = null;

function loadCache() {
    try {
        return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    } catch {
        return {};
    }
}

function saveCache(cache) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

function loadSettings() {
    try {
        const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        const merged = { ...DEFAULT_SETTINGS, ...raw };
        if (Array.isArray(merged.enabledSources) && merged.enabledSources.length) {
            merged.enabledSources = merged.enabledSources.map((id) =>
                id === 'imgw-forecast' ? 'open-meteo-forecast' : id
            );
            merged.enabledSources = [...new Set(merged.enabledSources)];
        }
        return resolveLocationSettings(merged);
    } catch {
        return resolveLocationSettings(DEFAULT_SETTINGS);
    }
}

function saveSettings(patch) {
    const merged = { ...loadSettings(), ...patch };
    const next = resolveLocationSettings(merged);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
}

function cacheKey(providerId, lat, lon) {
    return `${providerId}|${Number(lat).toFixed(5)}|${Number(lon).toFixed(5)}`;
}

function isFresh(entry, ttlMs) {
    return entry && Number.isFinite(entry.cachedAt) && (Date.now() - entry.cachedAt) < ttlMs;
}

function emitState() {
    window.dispatchEvent(new CustomEvent('weather:state_changed', {
        detail: {
            snapshot: state.snapshot,
            loading: state.loading,
            lastRefreshAt: state.lastRefreshAt,
            settings: loadSettings()
        }
    }));
}

function mergeFragments(fragments) {
    const merged = {
        location: { lat: null, lon: null, label: null },
        current: null,
        hourly: [],
        daily: [],
        observation: null,
        alerts: [],
        alertsUnfiltered: false,
        model: null,
        sources: [],
        errors: [],
        fetchedAt: Date.now()
    };

    fragments.forEach(({ providerId, label, fragment, cachedAt, stale }) => {
        merged.sources.push({ id: providerId, label, fetchedAt: cachedAt, stale: !!stale });
        if (!fragment) return;

        if (fragment.location) {
            merged.location = { ...merged.location, ...fragment.location };
        }
        if (fragment.current) merged.current = { ...merged.current, ...fragment.current };
        if (fragment.hourly?.length) merged.hourly = fragment.hourly;
        if (fragment.daily?.length) merged.daily = fragment.daily;
        if (fragment.observation) merged.observation = fragment.observation;
        if (fragment.alerts?.length) {
            merged.alerts = fragment.alerts;
            merged.alertsUnfiltered = !!fragment.alertsUnfiltered;
        }
        if (fragment.model) merged.model = fragment.model;
    });

    const settings = loadSettings();
    merged.location.lat = merged.location.lat ?? settings.lat;
    merged.location.lon = merged.location.lon ?? settings.lon;
    merged.location.label = settings.label || merged.location.label;

    return merged;
}

async function fetchProvider(provider, settings, { force = false, signal } = {}) {
    const cache = loadCache();
    const key = cacheKey(provider.id, settings.lat, settings.lon);
    const cached = cache[key];

    if (!force && isFresh(cached, provider.ttlMs)) {
        return {
            providerId: provider.id,
            label: provider.label,
            fragment: cached.data,
            cachedAt: cached.cachedAt,
            stale: false
        };
    }

    try {
        const raw = await provider.fetch({
            lat: settings.lat,
            lon: settings.lon,
            teryt: settings.teryt,
            signal
        });
        const fragment = provider.normalize(raw);
        const cachedAt = Date.now();
        cache[key] = { data: fragment, cachedAt };
        saveCache(cache);
        return {
            providerId: provider.id,
            label: provider.label,
            fragment,
            cachedAt,
            stale: false
        };
    } catch (err) {
        if (cached?.data) {
            return {
                providerId: provider.id,
                label: provider.label,
                fragment: cached.data,
                cachedAt: cached.cachedAt,
                stale: true,
                error: err.message || String(err)
            };
        }
        return {
            providerId: provider.id,
            label: provider.label,
            fragment: null,
            cachedAt: null,
            stale: true,
            error: err.message || String(err)
        };
    }
}

export const WeatherApi = {
    getSettings() {
        return loadSettings();
    },

    saveSettings(patch) {
        const next = saveSettings(patch);
        emitState();
        return next;
    },

    getState() {
        return {
            snapshot: state.snapshot,
            loading: state.loading,
            lastRefreshAt: state.lastRefreshAt,
            settings: loadSettings()
        };
    },

    listLocations() {
        return listLocations();
    },

    getPogodaUrl(lat, lon) {
        const settings = loadSettings();
        const la = lat ?? settings.lat;
        const lo = lon ?? settings.lon;
        return `https://meteo.imgw.pl/pogoda?lat=${encodeURIComponent(la)}&lon=${encodeURIComponent(lo)}`;
    },

    listProviders() {
        return WeatherProviderRegistry.listProviders();
    },

    async refresh({ force = false } = {}) {
        if (abortController) abortController.abort();
        abortController = new AbortController();
        const signal = abortController.signal;

        state.loading = true;
        emitState();

        const settings = loadSettings();
        const providerIds = WeatherProviderRegistry.getEnabledProviderIds(settings);
        const providers = providerIds
            .map((id) => WeatherProviderRegistry.getProvider(id))
            .filter(Boolean);

        const results = await Promise.all(
            providers.map((p) => fetchProvider(p, settings, { force, signal }))
        );

        if (signal.aborted) return state.snapshot;

        const errors = results.filter((r) => r.error).map((r) => ({
            providerId: r.providerId,
            message: r.error
        }));

        state.snapshot = mergeFragments(results);
        state.snapshot.errors = errors;
        state.lastRefreshAt = Date.now();
        state.loading = false;
        emitState();
        return state.snapshot;
    },

    startPolling() {
        this.stopPolling();
        const tick = () => {
            this.refresh().catch(() => {});
        };
        tick();
        const settings = loadSettings();
        const ms = Math.max(5, settings.refreshMinutes || 15) * 60 * 1000;
        pollTimer = setInterval(tick, ms);
    },

    stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
    },

    restartPolling() {
        this.stopPolling();
        this.startPolling();
    }
};
