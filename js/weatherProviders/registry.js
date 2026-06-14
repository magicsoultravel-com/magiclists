import { ImgwForecastProvider } from './imgwForecast.js';
import { ImgwSynopProvider } from './imgwSynop.js';
import { ImgwWarningsProvider } from './imgwWarnings.js';

const PROVIDERS = [
    ImgwForecastProvider,
    ImgwSynopProvider,
    ImgwWarningsProvider
];

const PROVIDER_MAP = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

export const WeatherProviderRegistry = {
    listProviders() {
        return PROVIDERS.map((p) => ({
            id: p.id,
            label: p.label,
            kind: p.kind,
            defaultEnabled: p.defaultEnabled !== false
        }));
    },

    getProvider(id) {
        return PROVIDER_MAP[id] || null;
    },

    getEnabledProviderIds(settings) {
        const defaults = PROVIDERS.filter((p) => p.defaultEnabled !== false).map((p) => p.id);
        const enabled = settings?.enabledSources;
        if (!Array.isArray(enabled) || !enabled.length) return defaults;
        return enabled.filter((id) => PROVIDER_MAP[id]);
    }
};
