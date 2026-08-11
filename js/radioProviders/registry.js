import { RadioBrowserProvider } from './radioBrowser.js';
import { IptvOrgProvider } from './iptvOrg.js';
import { PROVIDER_IPTV_ORG, PROVIDER_RADIO_BROWSER, parseStationKey } from './stationShape.js';
import { loadRadioState, patchRadioState } from '../radioState.js';

const PROVIDERS = {
    [PROVIDER_RADIO_BROWSER]: RadioBrowserProvider,
    [PROVIDER_IPTV_ORG]: IptvOrgProvider
};

function loadSettings() {
    const state = loadRadioState();
    return {
        catalogProvider: state.catalogProvider || PROVIDER_RADIO_BROWSER,
        radioBrowserMirror: state.radioBrowserMirror || null,
        hideOfflineStations: state.hideOfflineStations !== false
    };
}

function saveSettings(patch) {
    return patchRadioState(patch);
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

    async setActiveProvider(providerId) {
        if (!PROVIDERS[providerId]) return;
        const prev = loadSettings().catalogProvider;
        saveSettings({ catalogProvider: providerId });
        if (prev !== providerId) {
            await this.getProvider(prev).invalidateCache?.();
        }
    },

    getHideOffline() {
        return loadSettings().hideOfflineStations;
    },

    async setHideOffline(value) {
        saveSettings({ hideOfflineStations: !!value });
        await RadioBrowserProvider.invalidateCache();
    },

    getMirror() {
        return loadSettings().radioBrowserMirror;
    },

    async setMirror(hostname) {
        saveSettings({ radioBrowserMirror: hostname || null });
        if (hostname) {
            await RadioBrowserProvider.setMirror(hostname);
        } else {
            await RadioBrowserProvider.setMirror(null);
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
            const parsed = parseStationKey(key) || { providerId: PROVIDER_RADIO_BROWSER, stationId: key };
            if (!parsed.stationId) return;
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

    async refreshCatalog() {
        const provider = this.getActiveProvider();
        await provider.invalidateCache?.();
        return provider.getCountries({ refresh: true });
    },

    async clearActiveCache() {
        await this.getActiveProvider().clearCache?.();
    },

    async clearAllCaches() {
        await Promise.all(Object.values(PROVIDERS).map((p) => p.clearCache?.()));
    }
};

// Apply saved mirror on load
const savedMirror = loadSettings().radioBrowserMirror;
if (savedMirror) {
    RadioBrowserProvider.setMirror(savedMirror).catch(() => {});
}
