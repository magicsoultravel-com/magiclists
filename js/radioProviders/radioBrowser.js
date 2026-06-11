import { RadioBrowserApi } from '../radioBrowserApi.js';
import { normalizeStation, PROVIDER_RADIO_BROWSER } from './stationShape.js';

export const RadioBrowserProvider = {
    id: PROVIDER_RADIO_BROWSER,
    label: 'Radio Browser',

    async getCountries({ refresh = false } = {}) {
        return RadioBrowserApi.getCountries({ refresh });
    },

    async searchStations({
        countrycode = '',
        limit = 100,
        offset = 0,
        order = 'clickcount',
        reverse = true,
        refresh = false,
        hideOffline = true
    } = {}) {
        const data = await RadioBrowserApi.searchStations({
            countrycode,
            limit,
            offset,
            order,
            reverse,
            refresh,
            hideOffline
        });
        return (Array.isArray(data) ? data : [])
            .map((s) => normalizeStation(s, PROVIDER_RADIO_BROWSER))
            .filter(Boolean);
    },

    async getStationById(stationId, { refresh = false, forPlay = false } = {}) {
        const raw = await RadioBrowserApi.getStationByUuid(stationId, { refresh, forPlay });
        return normalizeStation(raw, PROVIDER_RADIO_BROWSER);
    },

    async getStationsByIds(ids, opts = {}) {
        const results = await Promise.all(
            ids.map((id) => this.getStationById(id, opts))
        );
        return results.filter(Boolean);
    },

    reportClick(stationId) {
        return RadioBrowserApi.reportClick(stationId);
    },

    discoverMirrors() {
        return RadioBrowserApi.discoverServers();
    },

    setMirror(hostname) {
        RadioBrowserApi.setMirrorHost(hostname);
    },

    invalidateCache() {
        RadioBrowserApi.invalidateQueryCache();
    },

    clearCache() {
        RadioBrowserApi.clearCache();
    }
};
