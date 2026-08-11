import { RadioProviderRegistry } from './radioProviders/registry.js';
import {
    stationKey,
    parseStationKey,
    migrateFavoriteRef,
    normalizeStation
} from './radioProviders/stationShape.js';
import {
    RADIO_RECENTS_CAP,
    DEFAULT_BROWSE_SORT,
    DEFAULT_COUNTRY_SORT,
    loadRadioState,
    patchRadioState
} from './radioState.js';

const RECENTS_CAP = RADIO_RECENTS_CAP;

function loadState() {
    return loadRadioState();
}

function saveState(patch) {
    return patchRadioState(patch);
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

    getCountrySort() {
        return loadState().countrySort || DEFAULT_COUNTRY_SORT;
    },

    saveCountrySort(sort) {
        saveState({ countrySort: sort || DEFAULT_COUNTRY_SORT });
    },

    clearRecents() {
        saveState({ recentsMeta: [] });
        this.emitState();
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
        this.emitState();
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

        const key = stationKey(station);
        if (!key || !station) {
            this.loading = false;
            this.loadPhase = 'idle';
            this.error = 'Invalid station';
            this.emitState();
            return;
        }

        // Fetch station data if URL is missing or station is incomplete
        if (!station.url_resolved) {
            const parsed = parseStationKey(key);
            const fetched = await RadioProviderRegistry.getStation(parsed, { forPlay: true });
            if (!fetched || !fetched.url_resolved || fetched.lastcheckok === 0) {
                this.loading = false;
                this.loadPhase = 'idle';
                this.error = fetched ? 'Stream unavailable' : 'Could not load station';
                if (fetched && fetched.lastcheckok === 0) {
                    this.error = 'Station offline';
                }
                this.emitState();
                return;
            }
            station = fetched;
        } else if (station.lastcheckok === 0) {
            this.loading = false;
            this.loadPhase = 'idle';
            this.error = 'Station offline';
            this.emitState();
            return;
        }

        // Normalize and set station BEFORE emitState so UI shows correct station
        this.station = normalizeStation(station, station.providerId) || station;
        saveState({
            lastStationKey: key,
            lastStationName: station.name || ''
        });

        this.recentRecordedForKey = null;
        this.loading = true;
        this.loadPhase = 'connecting';
        this.error = null;
        this.resumeBlocked = false;
        this.emitState();

        try {
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
            this.emitState();
            if (blocked) throw e;
        }
    }
};
