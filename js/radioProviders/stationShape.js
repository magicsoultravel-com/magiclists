export const PROVIDER_RADIO_BROWSER = 'radio-browser';
export const PROVIDER_IPTV_ORG = 'iptv-org';

/** @param {{ providerId?: string, stationId?: string, stationuuid?: string }} station */
export function stationKey(station) {
    if (!station) return '';
    if (typeof station === 'string') {
        return station.includes(':') ? station : `${PROVIDER_RADIO_BROWSER}:${station}`;
    }
    const providerId = station.providerId || PROVIDER_RADIO_BROWSER;
    const stationId = station.stationId || station.stationuuid || '';
    return `${providerId}:${stationId}`;
}

/** @param {string} key */
export function parseStationKey(key) {
    if (!key) return null;
    if (!key.includes(':')) {
        return { providerId: PROVIDER_RADIO_BROWSER, stationId: key };
    }
    const idx = key.indexOf(':');
    return {
        providerId: key.slice(0, idx),
        stationId: key.slice(idx + 1)
    };
}

/** Normalize any provider record to a common station shape. */
export function normalizeStation(raw, providerId = PROVIDER_RADIO_BROWSER) {
    if (!raw) return null;

    if (providerId === PROVIDER_IPTV_ORG) {
        const stationId = raw.id || raw.stationId;
        if (!stationId || !raw.url_resolved) return null;
        return {
            providerId: PROVIDER_IPTV_ORG,
            stationId,
            stationuuid: stationKey({ providerId: PROVIDER_IPTV_ORG, stationId }),
            name: raw.name || 'Unknown',
            url_resolved: raw.url_resolved,
            favicon: raw.logo || raw.favicon || '',
            countrycode: raw.country || raw.countrycode || '',
            tags: Array.isArray(raw.categories) ? raw.categories.join(', ') : (raw.tags || ''),
            lastcheckok: raw.url_resolved ? 1 : 0
        };
    }

    const stationId = raw.stationuuid || raw.stationId;
    if (!stationId) return null;
    return {
        providerId: PROVIDER_RADIO_BROWSER,
        stationId,
        stationuuid: stationKey({ providerId: PROVIDER_RADIO_BROWSER, stationId }),
        name: raw.name || 'Unknown',
        url_resolved: raw.url_resolved || raw.url || '',
        favicon: raw.favicon || '',
        countrycode: raw.countrycode || '',
        tags: raw.tags || '',
        bitrate: raw.bitrate,
        lastcheckok: raw.lastcheckok
    };
}

/** @param {string|{ providerId?: string, stationId?: string }} ref */
export function migrateFavoriteRef(ref) {
    if (typeof ref === 'string') {
        if (ref.includes(':')) return ref;
        return `${PROVIDER_RADIO_BROWSER}:${ref}`;
    }
    return stationKey(ref);
}
