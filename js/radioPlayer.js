import { RadioProviderRegistry } from './radioProviders/registry.js';
import {
    stationKey,
    parseStationKey,
    migrateFavoriteRef,
    normalizeStation
} from './radioProviders/stationShape.js';

const STATE_KEY = 'matrix_radio_state';
const RECENTS_CAP = 20;
const DEFAULT_BROWSER_W = 320;
const DEFAULT_BROWSER_H = 360;
const DEFAULT_BROWSE_SORT = 'clickcount';

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

function loadState() {
    try {
        const raw = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
        const miniPlayerDocked = raw.miniPlayerDocked !== undefined
            ? raw.miniPlayerDocked !== false
            : raw.panelDocked !== false;

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
            miniPlayerDocked,
            miniPlayerX: Number.isFinite(raw.miniPlayerX) ? raw.miniPlayerX
                : (Number.isFinite(raw.panelX) ? raw.panelX : null),
            miniPlayerY: Number.isFinite(raw.miniPlayerY) ? raw.miniPlayerY
                : (Number.isFinite(raw.panelY) ? raw.panelY : null),
            browserW: Number.isFinite(raw.browserW) ? raw.browserW : DEFAULT_BROWSER_W,
            browserH: Number.isFinite(raw.browserH) ? raw.browserH : DEFAULT_BROWSER_H,
            browserX: Number.isFinite(raw.browserX) ? raw.browserX : null,
            browserY: Number.isFinite(raw.browserY) ? raw.browserY : null,
            browserFloating: raw.browserFloating === true,
            browseSort: raw.browseSort || DEFAULT_BROWSE_SORT
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
            miniPlayerDocked: true,
            miniPlayerX: null,
            miniPlayerY: null,
            browserW: DEFAULT_BROWSER_W,
            browserH: DEFAULT_BROWSER_H,
            browserX: null,
            browserY: null,
            browserFloating: false,
            browseSort: DEFAULT_BROWSE_SORT
        };
    }
}

function saveState(patch) {
    const current = loadState();
    const next = { ...current, ...patch };
    if (next.recentsMeta) {
        next.recents = next.recentsMeta.map((e) => e.key);
    }
    localStorage.setItem(STATE_KEY, JSON.stringify(next));
    return next;
}

function dispatchState(detail) {
    window.dispatchEvent(new CustomEvent('radio:state_changed', { detail }));
}

export const RadioPlayer = {
    audio: null,
    station: null,
    playing: false,
    loading: false,
    loadPhase: 'idle',
    error: null,
    resumeBlocked: false,
    recentRecordedForKey: null,
    volume: loadState().volume,

    init() {
        if (this.audio) return;
        this.audio = new Audio();
        this.audio.preload = 'none';
        this.audio.volume = this.volume;

        this.audio.addEventListener('loadstart', () => {
            this.loadPhase = 'connecting';
            this.emitState();
        });
        this.audio.addEventListener('canplay', () => {
            if (this.loadPhase !== 'idle') {
                this.loadPhase = 'idle';
                this.emitState();
            }
        });
        this.audio.addEventListener('playing', () => {
            this.playing = true;
            this.loading = false;
            this.loadPhase = 'idle';
            this.error = null;
            this.resumeBlocked = false;
            saveState({ wasPlaying: true });
            const key = stationKey(this.station);
            if (key && this.recentRecordedForKey !== key) {
                this.recentRecordedForKey = key;
                this.pushRecent(key, this.station);
            }
            this.emitState();
        });
        this.audio.addEventListener('pause', () => {
            this.playing = false;
            this.emitState();
        });
        this.audio.addEventListener('waiting', () => {
            this.loading = true;
            this.loadPhase = 'buffering';
            this.emitState();
        });
        this.audio.addEventListener('stalled', () => {
            if (this.playing || this.loading) {
                this.loadPhase = 'buffering';
                this.emitState();
            }
        });
        this.audio.addEventListener('error', () => {
            this.loading = false;
            this.loadPhase = 'idle';
            this.playing = false;
            this.error = 'Stream unavailable';
            this.emitState();
        });
        this.audio.addEventListener('ended', () => {
            this.playing = false;
            this.loadPhase = 'idle';
            this.emitState();
        });

        const saved = loadState();
        if (saved.lastStationKey) {
            const parsed = parseStationKey(saved.lastStationKey);
            this.station = {
                providerId: parsed.providerId,
                stationId: parsed.stationId,
                stationuuid: saved.lastStationKey,
                name: saved.lastStationName || 'Last station'
            };
            this.emitState();
        }
    },

    emitState() {
        dispatchState({
            station: this.station,
            playing: this.playing,
            loading: this.loading,
            loadPhase: this.loadPhase,
            error: this.error,
            resumeBlocked: this.resumeBlocked,
            volume: this.volume,
            favorites: this.getFavorites(),
            recents: this.getRecents(),
            recentsMeta: this.getRecentsMeta()
        });
    },

    getFavorites() {
        return [...loadState().favorites];
    },

    getRecents() {
        return [...loadState().recents];
    },

    getRecentsMeta() {
        return loadState().recentsMeta.map((e) => ({ ...e }));
    },

    getWasPlaying() {
        return loadState().wasPlaying;
    },

    getBrowseSort() {
        return loadState().browseSort || DEFAULT_BROWSE_SORT;
    },

    saveBrowseSort(sort) {
        saveState({ browseSort: sort || DEFAULT_BROWSE_SORT });
    },

    getMiniPlayerState() {
        const s = loadState();
        return {
            miniPlayerDocked: s.miniPlayerDocked,
            miniPlayerX: s.miniPlayerX,
            miniPlayerY: s.miniPlayerY
        };
    },

    getBrowserSize() {
        const s = loadState();
        return { w: s.browserW, h: s.browserH };
    },

    getBrowserPosition() {
        const s = loadState();
        return {
            browserX: s.browserX,
            browserY: s.browserY,
            browserFloating: s.browserFloating
        };
    },

    saveMiniPlayerState(patch) {
        saveState(patch);
    },

    saveBrowserSize(w, h) {
        saveState({ browserW: w, browserH: h });
    },

    saveBrowserPosition(patch) {
        saveState(patch);
    },

    pushRecent(key, station = null) {
        if (!key) return;
        const meta = loadState().recentsMeta.filter((e) => e.key !== key);
        meta.unshift({
            key,
            name: station?.name || '',
            favicon: station?.favicon || '',
            countrycode: station?.countrycode || '',
            at: Date.now()
        });
        saveState({ recentsMeta: meta.slice(0, RECENTS_CAP) });
    },

    isFavorite(stationOrKey) {
        const key = typeof stationOrKey === 'string'
            ? migrateFavoriteRef(stationOrKey)
            : stationKey(stationOrKey);
        return loadState().favorites.includes(key);
    },

    toggleFavorite(station) {
        const key = stationKey(station);
        if (!key) return false;
        const favorites = loadState().favorites;
        const idx = favorites.indexOf(key);
        if (idx >= 0) {
            favorites.splice(idx, 1);
            saveState({ favorites });
            this.emitState();
            return false;
        }
        favorites.unshift(key);
        saveState({ favorites });
        const parsed = parseStationKey(key);
        RadioProviderRegistry.getStation(parsed).catch(() => {});
        this.emitState();
        return true;
    },

    setVolume(value) {
        this.volume = Math.min(1, Math.max(0, value));
        if (this.audio) this.audio.volume = this.volume;
        saveState({ volume: this.volume });
        this.emitState();
    },

    async toggle() {
        if (this.playing) {
            this.pause();
            return;
        }
        this.resumeBlocked = false;
        if (this.station?.url_resolved && this.audio?.src) {
            try {
                await this.audio.play();
            } catch {
                this.error = 'Playback blocked';
                this.resumeBlocked = true;
                saveState({ wasPlaying: false });
                this.emitState();
            }
            return;
        }
        if (this.station) {
            await this.playStation(this.station);
        }
    },

    pause() {
        this.audio?.pause();
        this.playing = false;
        saveState({ wasPlaying: false });
        this.emitState();
    },

    stop() {
        if (this.audio) {
            this.audio.pause();
            this.audio.removeAttribute('src');
            this.audio.load();
        }
        this.playing = false;
        this.loading = false;
        this.loadPhase = 'idle';
        this.error = null;
        saveState({ wasPlaying: false });
        this.emitState();
    },

    async resumeIfWasPlaying() {
        if (!this.getWasPlaying() || !this.station) return;
        try {
            await this.playStation(this.station);
        } catch (e) {
            const blocked = e?.name === 'NotAllowedError'
                || String(e?.message || '').toLowerCase().includes('not allowed');
            if (blocked) {
                this.resumeBlocked = true;
                saveState({ wasPlaying: false });
                this.emitState();
            }
        }
    },

    async playStation(stationOrKey) {
        this.init();
        let station = typeof stationOrKey === 'object' && stationOrKey !== null
            ? stationOrKey
            : null;

        if (!station && typeof stationOrKey === 'string') {
            const parsed = parseStationKey(stationOrKey);
            station = await RadioProviderRegistry.getStation(parsed, { forPlay: true });
        }

        if (station && !station.url_resolved) {
            const parsed = parseStationKey(stationKey(station));
            station = await RadioProviderRegistry.getStation(parsed, { forPlay: true });
        }

        const key = stationKey(station);
        if (!key || !station) return;

        this.recentRecordedForKey = null;
        this.loading = true;
        this.loadPhase = 'connecting';
        this.error = null;
        this.resumeBlocked = false;
        this.emitState();

        try {
            if (!station.url_resolved) {
                throw new Error('No stream URL');
            }
            if (station.lastcheckok === 0) {
                throw new Error('Station offline');
            }

            this.station = normalizeStation(station, station.providerId) || station;
            saveState({
                lastStationKey: key,
                lastStationName: station.name || ''
            });

            const provider = RadioProviderRegistry.getProvider(station.providerId);
            provider.reportClick?.(station.stationId);

            if (this.audio.src !== station.url_resolved) {
                this.audio.src = station.url_resolved;
                this.audio.load();
            }
            await this.audio.play();
        } catch (e) {
            this.loading = false;
            this.loadPhase = 'idle';
            this.playing = false;
            const blocked = e?.name === 'NotAllowedError'
                || String(e?.message || '').toLowerCase().includes('not allowed');
            if (blocked) {
                this.error = null;
                this.resumeBlocked = true;
                saveState({ wasPlaying: false });
            } else {
                this.error = e?.message === 'Station offline' ? 'Station offline' : 'Stream unavailable';
            }
            if (typeof stationOrKey === 'object' && stationOrKey?.name) {
                this.station = normalizeStation(stationOrKey, stationOrKey.providerId) || stationOrKey;
            }
            this.emitState();
            if (blocked) throw e;
        }
    }
};
