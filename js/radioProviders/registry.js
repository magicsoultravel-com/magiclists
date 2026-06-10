import { RadioBrowserProvider } from './radioBrowser.js';
import { IptvOrgProvider } from './iptvOrg.js';
import { PROVIDER_IPTV_ORG, PROVIDER_RADIO_BROWSER } from './stationShape.js';

const STATE_KEY = 'matrix_radio_state';

const PROVIDERS = {
    [PROVIDER_RADIO_BROWSER]: RadioBrowserProvider,
    [PROVIDER_IPTV_ORG]: IptvOrgProvider
};

function loadSettings() {
    try {
        const raw = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
        return {
            catalogProvider: raw.catalogProvider || PROVIDER_RADIO_BROWSER,
            radioBrowserMirror: raw.radioBrowserMirror || null,
            hideOfflineStations: raw.hideOfflineStations !== false
        };
    } catch {
        return {
            catalogProvider: PROVIDER_RADIO_BROWSER,
            radioBrowserMirror: null,
            hideOfflineStations: true
        };
    }
}

function saveSettings(patch) {
    const current = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    const next = { ...current, ...patch };
    localStorage.setItem(STATE_KEY, JSON.stringify(next));
    return next;
}

export const RadioProviderRegistry = {
    listProviders() {
        return Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label }));
    },

    getSettings() {
        return loadSettings();
    },

    saveSettings(patch) {
        return saveSettings(patch);
    },

    getActiveProviderId() {
        return loadSettings().catalogProvider;
    },

    getProvider(id) {
        return PROVIDERS[id || loadSettings().catalogProvider] || RadioBrowserProvider;
    },

    getActiveProvider() {
        return this.getProvider(this.getActiveProviderId());
    },

    setActiveProvider(providerId) {
        if (!PROVIDERS[providerId]) return;
        const prev = loadSettings().catalogProvider;
        saveSettings({ catalogProvider: providerId });
        if (prev !== providerId) {
            this.getProvider(prev).invalidateCache?.();
        }
    },

    getHideOffline() {
        return loadSettings().hideOfflineStations;
    },

    setHideOffline(value) {
        saveSettings({ hideOfflineStations: !!value });
        RadioBrowserProvider.invalidateCache();
    },

    getMirror() {
        return loadSettings().radioBrowserMirror;
    },

    setMirror(hostname) {
        saveSettings({ radioBrowserMirror: hostname || null });
        if (hostname) {
            RadioBrowserProvider.setMirror(hostname);
        } else {
            RadioBrowserProvider.setMirror(null);
        }
    },

    async discoverMirrors() {
        return RadioBrowserProvider.discoverMirrors();
    },

    async getCountries(opts = {}) {
        return this.getActiveProvider().getCountries(opts);
    },

    async searchStations(opts = {}) {
        const settings = loadSettings();
        return this.getActiveProvider().searchStations({
            ...opts,
            hideOffline: opts.hideOffline ?? settings.hideOfflineStations
        });
    },

    async getStation(ref, opts = {}) {
        const providerId = ref?.providerId || loadSettings().catalogProvider;
        const stationId = ref?.stationId || ref?.stationuuid || ref;
        const provider = this.getProvider(providerId);
        return provider.getStationById(stationId, opts);
    },

    async getStationsByRefs(refs, opts = {}) {
        const byProvider = new Map();
        refs.forEach((key) => {
            const parsed = typeof key === 'string' && key.includes(':')
                ? { providerId: key.slice(0, key.indexOf(':')), stationId: key.slice(key.indexOf(':') + 1) }
                : { providerId: PROVIDER_RADIO_BROWSER, stationId: key };
            if (!byProvider.has(parsed.providerId)) byProvider.set(parsed.providerId, []);
            byProvider.get(parsed.providerId).push(parsed.stationId);
        });

        const results = [];
        for (const [providerId, ids] of byProvider) {
            const provider = this.getProvider(providerId);
            const stations = await provider.getStationsByIds(ids, opts);
            results.push(...stations);
        }
        return results;
    },

    refreshCatalog() {
        const provider = this.getActiveProvider();
        provider.invalidateCache?.();
        return provider.getCountries({ refresh: true });
    },

    clearActiveCache() {
        this.getActiveProvider().clearCache?.();
    },

    clearAllCaches() {
        Object.values(PROVIDERS).forEach((p) => p.clearCache?.());
    }
};

// Apply saved mirror on load
const savedMirror = loadSettings().radioBrowserMirror;
if (savedMirror) {
    RadioBrowserProvider.setMirror(savedMirror);
}
