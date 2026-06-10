import { RadioBrowserApi } from './radioBrowserApi.js';

const STATE_KEY = 'matrix_radio_state';

function loadState() {
    try {
        const raw = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
        return {
            favorites: Array.isArray(raw.favorites) ? raw.favorites : [],
            volume: Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : 0.85,
            lastStationUuid: raw.lastStationUuid || null,
            lastStationName: raw.lastStationName || ''
        };
    } catch {
        return { favorites: [], volume: 0.85, lastStationUuid: null, lastStationName: '' };
    }
}

function saveState(patch) {
    const current = loadState();
    const next = { ...current, ...patch };
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
    error: null,
    volume: loadState().volume,

    init() {
        if (this.audio) return;
        this.audio = new Audio();
        this.audio.preload = 'none';
        this.audio.volume = this.volume;

        this.audio.addEventListener('playing', () => {
            this.playing = true;
            this.loading = false;
            this.error = null;
            this.emitState();
        });
        this.audio.addEventListener('pause', () => {
            this.playing = false;
            this.emitState();
        });
        this.audio.addEventListener('waiting', () => {
            this.loading = true;
            this.emitState();
        });
        this.audio.addEventListener('error', () => {
            this.loading = false;
            this.playing = false;
            this.error = 'Stream unavailable';
            this.emitState();
        });
        this.audio.addEventListener('ended', () => {
            this.playing = false;
            this.emitState();
        });

        const saved = loadState();
        if (saved.lastStationUuid) {
            this.station = {
                stationuuid: saved.lastStationUuid,
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
            error: this.error,
            volume: this.volume
        });
    },

    getFavorites() {
        return [...loadState().favorites];
    },

    isFavorite(uuid) {
        return loadState().favorites.includes(uuid);
    },

    toggleFavorite(station) {
        if (!station?.stationuuid) return false;
        const favorites = loadState().favorites;
        const idx = favorites.indexOf(station.stationuuid);
        if (idx >= 0) {
            favorites.splice(idx, 1);
            saveState({ favorites });
            this.emitState();
            return false;
        }
        favorites.unshift(station.stationuuid);
        saveState({ favorites });
        RadioBrowserApi.getStationByUuid(station.stationuuid).catch(() => {});
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
        if (this.station?.stationuuid && this.audio?.src) {
            try {
                await this.audio.play();
            } catch {
                this.error = 'Playback blocked';
                this.emitState();
            }
            return;
        }
        if (this.station?.stationuuid) {
            await this.playStation(this.station);
        }
    },

    pause() {
        this.audio?.pause();
        this.playing = false;
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
        this.error = null;
        this.emitState();
    },

    async playStation(stationOrUuid) {
        this.init();
        const uuid = typeof stationOrUuid === 'string'
            ? stationOrUuid
            : stationOrUuid?.stationuuid;
        if (!uuid) return;

        this.loading = true;
        this.error = null;
        this.emitState();

        try {
            const station = await RadioBrowserApi.getStationByUuid(uuid, { forPlay: true });
            if (!station?.url_resolved) {
                throw new Error('No stream URL');
            }
            if (station.lastcheckok === 0) {
                throw new Error('Station offline');
            }

            this.station = station;
            saveState({
                lastStationUuid: station.stationuuid,
                lastStationName: station.name || ''
            });

            RadioBrowserApi.reportClick(station.stationuuid);

            if (this.audio.src !== station.url_resolved) {
                this.audio.src = station.url_resolved;
                this.audio.load();
            }
            await this.audio.play();
        } catch (e) {
            this.loading = false;
            this.playing = false;
            this.error = e?.message === 'Station offline' ? 'Station offline' : 'Stream unavailable';
            if (typeof stationOrUuid === 'object' && stationOrUuid?.name) {
                this.station = stationOrUuid;
            }
            this.emitState();
        }
    }
};
