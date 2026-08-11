import { migrateFavoriteRef } from './radioProviders/stationShape.js';

export const RADIO_STATE_KEY = 'matrix_radio_state';
export const RADIO_RECENTS_CAP = 20;
export const DEFAULT_BROWSER_W = 320;
export const DEFAULT_BROWSER_H = 360;
export const DEFAULT_BROWSE_SORT = 'clickcount';
export const DEFAULT_COUNTRY_SORT = 'count';

function migrateRecentsMeta(raw) {
    if (Array.isArray(raw.recentsMeta) && raw.recentsMeta.length) {
        return raw.recentsMeta.map((entry) => {
            if (typeof entry === 'string') {
                return { key: migrateFavoriteRef(entry), name: '', favicon: '', countrycode: '', at: 0 };
            }
            return {
                key: migrateFavoriteRef(entry.key),
                name: entry.name || '',
                favicon: entry.favicon || '',
                countrycode: entry.countrycode || '',
                at: Number.isFinite(entry.at) ? entry.at : 0
            };
        }).filter((e) => e.key);
    }
    if (Array.isArray(raw.recents)) {
        return raw.recents.map((key) => ({
            key: migrateFavoriteRef(key),
            name: '',
            favicon: '',
            countrycode: '',
            at: 0
        })).filter((e) => e.key);
    }
    return [];
}

/** Pure read + normalize of persisted radio state. No DOM or side effects. */
export function loadRadioState() {
    try {
        const raw = JSON.parse(localStorage.getItem(RADIO_STATE_KEY) || '{}');

        // Clean up transient properties that may have been saved by older app versions
        delete raw.miniPlayerDocked;
        delete raw.miniPlayerX;
        delete raw.miniPlayerY;
        delete raw.panelDocked;
        delete raw.panelX;
        delete raw.panelY;

        const favorites = Array.isArray(raw.favorites)
            ? raw.favorites.map(migrateFavoriteRef)
            : [];
        const recentsMeta = migrateRecentsMeta(raw);
        const recents = recentsMeta.map((e) => e.key);

        const lastKey = raw.lastStationKey
            || (raw.lastStationUuid ? migrateFavoriteRef(raw.lastStationUuid) : null);

        return {
            favorites,
            recents,
            recentsMeta,
            volume: Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : 0.85,
            lastStationKey: lastKey,
            lastStationName: raw.lastStationName || '',
            wasPlaying: raw.wasPlaying === true,
            catalogProvider: raw.catalogProvider || 'radio-browser',
            radioBrowserMirror: raw.radioBrowserMirror || null,
            hideOfflineStations: raw.hideOfflineStations !== false,
            browserW: Number.isFinite(raw.browserW) ? raw.browserW : DEFAULT_BROWSER_W,
            browserH: Number.isFinite(raw.browserH) ? raw.browserH : DEFAULT_BROWSER_H,
            browserX: Number.isFinite(raw.browserX) ? raw.browserX : null,
            browserY: Number.isFinite(raw.browserY) ? raw.browserY : null,
            browserFloating: raw.browserFloating === true,
            browseSort: raw.browseSort || DEFAULT_BROWSE_SORT,
            countrySort: raw.countrySort || DEFAULT_COUNTRY_SORT
        };
    } catch {
        return {
            favorites: [],
            recents: [],
            recentsMeta: [],
            volume: 0.85,
            lastStationKey: null,
            lastStationName: '',
            wasPlaying: false,
            catalogProvider: 'radio-browser',
            radioBrowserMirror: null,
            hideOfflineStations: true,
            browserW: DEFAULT_BROWSER_W,
            browserH: DEFAULT_BROWSER_H,
            browserX: null,
            browserY: null,
            browserFloating: false,
            browseSort: DEFAULT_BROWSE_SORT,
            countrySort: DEFAULT_COUNTRY_SORT
        };
    }
}

/** Merge a patch into normalized radio state and persist. */
export function patchRadioState(patch) {
    const current = loadRadioState();
    const next = { ...current, ...patch };
    if (next.recentsMeta) {
        next.recents = next.recentsMeta.map((e) => e.key);
    }
    delete next.miniPlayerDocked;
    delete next.miniPlayerX;
    delete next.miniPlayerY;
    delete next.panelDocked;
    delete next.panelX;
    delete next.panelY;
    localStorage.setItem(RADIO_STATE_KEY, JSON.stringify(next));
    return next;
}
