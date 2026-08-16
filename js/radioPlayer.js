import { RadioCast } from './radioCast.js';
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
    DEFAULT_BROWSE_SORT_DIR,
    DEFAULT_COUNTRY_SORT,
    loadRadioState,
    patchRadioState
} from './radioState.js';

const RECENTS_CAP = RADIO_RECENTS_CAP;
const STALE_PAUSE_MS = 60_000;

function loadState() {
    return loadRadioState();
}

function saveState(patch) {
    return patchRadioState(patch);
}

function dispatchState(detail) {
    window.dispatchEvent(new CustomEvent('radio:state_changed', { detail }));
}

async function getVisualizer() {
    try {
        const mod = await import('./radioVisualizer.js');
        return mod.RadioVisualizer || null;
    } catch {
        return null;
    }
}

export const RadioPlayer = {
    audio: null,
    station: null,
    playing: false,
    loading: false,
    loadPhase: 'idle',
    error: null,
    resumeBlocked: false,
    pausedAt: null,
    recentRecordedForKey: null,
    volume: loadState().volume,
    analysisMode: false,
    analysisAvailable: false,
    analysisCorsFailed: false,
    analysisCorsFailedKey: null,
    loadedWithCors: false,
    streamUrl: null,
    recoveringAudio: false,

    init() {
        if (this.audio) return;
        this.audio = new Audio();
        this.audio.preload = 'none';
        this.audio.volume = this.volume;
        this.applyCrossOriginAttr(false);
        this.bindAudioListeners(this.audio);

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

    bindAudioListeners(audio) {
        audio.addEventListener('loadstart', () => {
            this.loadPhase = 'connecting';
            this.emitState();
        });
        audio.addEventListener('canplay', () => {
            if (this.loadPhase !== 'idle') {
                this.loadPhase = 'idle';
                this.emitState();
            }
        });
        audio.addEventListener('playing', () => {
            this.playing = true;
            this.loading = false;
            this.loadPhase = 'idle';
            this.error = null;
            this.resumeBlocked = false;
            this.pausedAt = null;
            saveState({ wasPlaying: true });
            const key = stationKey(this.station);
            if (key && this.recentRecordedForKey !== key) {
                this.recentRecordedForKey = key;
                this.pushRecent(key, this.station);
            }
            this.emitState();
        });
        audio.addEventListener('pause', () => {
            this.playing = false;
            this.emitState();
        });
        audio.addEventListener('waiting', () => {
            this.loading = true;
            this.loadPhase = 'buffering';
            this.emitState();
        });
        audio.addEventListener('stalled', () => {
            if (this.playing || this.loading) {
                this.loadPhase = 'buffering';
                this.emitState();
            }
        });
        audio.addEventListener('error', () => {
            if (this.recoveringAudio) return;
            // Delayed CORS failure: recover playback without analysis rather than killing the station
            if (this.loadedWithCors && this.station?.url_resolved) {
                this.markAnalysisCorsFailed();
                this.applyCrossOriginAttr(false);
                const url = this.station.url_resolved;
                this.audio.src = url;
                this.audio.load();
                this.streamUrl = url;
                this.loadedWithCors = false;
                this.analysisAvailable = false;
                this.audio.play().then(() => {
                    this.loading = false;
                    this.loadPhase = 'idle';
                    this.error = null;
                    this.emitState();
                }).catch(async () => {
                    const recovered = await this.resetAudioElementAndPlay();
                    if (!recovered) {
                        this.loading = false;
                        this.loadPhase = 'idle';
                        this.playing = false;
                        this.error = 'Stream unavailable';
                        this.emitState();
                    }
                });
                return;
            }
            this.loading = false;
            this.loadPhase = 'idle';
            this.playing = false;
            this.error = 'Stream unavailable';
            this.emitState();
        });
        audio.addEventListener('ended', () => {
            this.playing = false;
            this.loadPhase = 'idle';
            this.emitState();
        });
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

    getBrowseSortDir() {
        const dir = loadState().browseSortDir;
        return dir === 'asc' || dir === 'desc' ? dir : DEFAULT_BROWSE_SORT_DIR;
    },

    saveBrowseSortDir(dir) {
        saveState({ browseSortDir: dir === 'asc' ? 'asc' : 'desc' });
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

    getAudioElement() {
        this.init();
        return this.audio;
    },

    wantsCorsAnalysis() {
        return !!this.analysisMode && !this.analysisCorsFailed;
    },

    markAnalysisCorsFailed(key = stationKey(this.station)) {
        this.analysisCorsFailed = true;
        this.analysisCorsFailedKey = key || this.analysisCorsFailedKey;
        this.analysisAvailable = false;
        this.loadedWithCors = false;
    },

    clearAnalysisCorsFailedIfStationChanged(key) {
        if (!key) return;
        if (this.analysisCorsFailedKey && this.analysisCorsFailedKey !== key) {
            this.analysisCorsFailed = false;
            this.analysisCorsFailedKey = null;
        }
    },

    applyCrossOriginAttr(force = this.wantsCorsAnalysis()) {
        if (!this.audio) return;
        if (force) {
            this.audio.crossOrigin = 'anonymous';
        } else {
            this.audio.removeAttribute('crossorigin');
        }
    },

    async resumeAudioGraph() {
        const viz = await getVisualizer();
        if (viz?.resumeContext) {
            await viz.resumeContext();
        }
    },

    /**
     * Replace a MediaElementSource-poisoned Audio element with a fresh one (no CORS).
     * @returns {Promise<boolean>}
     */
    async resetAudioElementAndPlay() {
        if (this.recoveringAudio) return false;
        this.recoveringAudio = true;
        const url = this.station?.url_resolved;
        const vol = this.volume;

        try {
            const viz = await getVisualizer();
            viz?.releaseGraph?.();

            try {
                this.audio?.pause();
            } catch {}

            this.audio = new Audio();
            this.audio.preload = 'none';
            this.audio.volume = vol;
            this.applyCrossOriginAttr(false);
            this.bindAudioListeners(this.audio);
            this.loadedWithCors = false;
            this.analysisAvailable = false;
            this.markAnalysisCorsFailed();
            this.streamUrl = null;

            if (!url) {
                this.recoveringAudio = false;
                return false;
            }

            this.audio.src = url;
            this.audio.load();
            this.streamUrl = url;
            await this.audio.play();
            this.loading = false;
            this.loadPhase = 'idle';
            this.error = null;
            this.emitState();
            this.recoveringAudio = false;
            return true;
        } catch (e) {
            this.recoveringAudio = false;
            const blocked = e?.name === 'NotAllowedError'
                || String(e?.message || '').toLowerCase().includes('not allowed');
            if (blocked) {
                this.error = null;
                this.resumeBlocked = true;
                this.playing = false;
                saveState({ wasPlaying: false });
            } else {
                this.loading = false;
                this.loadPhase = 'idle';
                this.playing = false;
                this.error = 'Stream unavailable';
            }
            this.emitState();
            return false;
        }
    },

    async reloadCurrentStream({ resume = false } = {}) {
        this.init();
        const url = this.station?.url_resolved;
        if (!url) return true;
        this.audio.src = url;
        this.audio.load();
        this.streamUrl = url;
        this.loadedWithCors = this.audio.crossOrigin === 'anonymous';
        if (!resume) return true;
        try {
            await this.resumeAudioGraph();
            await this.audio.play();
            return true;
        } catch (e) {
            const blocked = e?.name === 'NotAllowedError'
                || String(e?.message || '').toLowerCase().includes('not allowed');
            if (blocked) {
                this.error = null;
                this.resumeBlocked = true;
                this.playing = false;
                saveState({ wasPlaying: false });
                this.emitState();
                return false;
            }
            this.loading = false;
            this.loadPhase = 'idle';
            this.playing = false;
            this.error = 'Stream unavailable';
            this.emitState();
            return false;
        }
    },

    /**
     * Prefer analysis for future station loads. Never interrupts a playing stream.
     * @returns {{ ok: boolean, analysisAvailable: boolean }}
     */
    async setAnalysisMode(enabled) {
        this.init();
        const next = !!enabled;

        if (!next) {
            this.analysisMode = false;
            this.analysisAvailable = false;
            // Keep current playback; only change preference for the next station load
            return { ok: true, analysisAvailable: false };
        }

        this.analysisMode = true;
        if (this.analysisCorsFailed) {
            this.analysisAvailable = false;
            return { ok: true, analysisAvailable: false };
        }

        const playing = !!(this.playing || (this.audio && !this.audio.paused && !this.audio.ended));

        // Never reload while audio is audible — CORS reload is what cuts stations
        if (playing) {
            const available = this.loadedWithCors && this.audio.crossOrigin === 'anonymous';
            this.analysisAvailable = available;
            return { ok: true, analysisAvailable: available };
        }

        // Not playing: only mark preference. Actual CORS load happens in playStation.
        this.analysisAvailable = false;
        return { ok: true, analysisAvailable: false };
    },

    async toggle() {
        if (this.playing) {
            this.pause();
            return;
        }
        this.resumeBlocked = false;
        await this.resumeAudioGraph();

        const stale = this.pausedAt && (Date.now() - this.pausedAt >= STALE_PAUSE_MS);
        if (!stale && this.station?.url_resolved && this.audio?.src) {
            try {
                // If network/audio element dropped connection or is suspended/stuck after sleep, reset/reload source cleanly
                if (this.audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE || this.audio.error || (this.audio.paused && this.audio.currentTime === 0)) {
                    this.audio.src = this.station.url_resolved;
                    this.audio.load();
                }
                await this.audio.play();
                return;
            } catch {
                // Element may be MediaElementSource-poisoned without CORS or connection lost — hard recover
                const recovered = await this.resetAudioElementAndPlay();
                if (recovered) return;

                this.error = 'Playback blocked';
                this.resumeBlocked = true;
                saveState({ wasPlaying: false });
                this.emitState();
                return;
            }
        }
        if (this.station) {
            await this.playStation(this.station);
        }
    },

    pause() {
        this.audio?.pause();
        this.playing = false;
        this.pausedAt = Date.now();
        saveState({ wasPlaying: false });
        this.emitState();
    },

    stop() {
        if (this.audio) {
            this.audio.pause();
            this.audio.removeAttribute('src');
            this.audio.load();
        }
        this.streamUrl = null;
        this.playing = false;
        this.loading = false;
        this.loadPhase = 'idle';
        this.error = null;
        this.resumeBlocked = false;
        this.pausedAt = null;
        saveState({ wasPlaying: false });
        if (RadioCast.isCasting()) {
            RadioCast.stopAll().catch(() => {});
        }
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
        const requestedKey = typeof stationOrKey === 'string'
            ? migrateFavoriteRef(stationOrKey)
            : stationKey(stationOrKey);

        let station = typeof stationOrKey === 'object' && stationOrKey !== null
            ? stationOrKey
            : null;

        if (!station && requestedKey) {
            const parsed = parseStationKey(requestedKey);
            station = await RadioProviderRegistry.getStation(parsed, { forPlay: true });
        }

        let key = migrateFavoriteRef(stationKey(station) || requestedKey);
        if (!key) {
            this.loading = false;
            this.loadPhase = 'idle';
            this.error = 'Invalid station';
            this.emitState();
            return;
        }

        this.clearAnalysisCorsFailedIfStationChanged(key);

        // Reuse in-memory station when it matches and already has a stream URL
        if ((!station || !station.url_resolved)
            && stationKey(this.station) === key
            && this.station?.url_resolved) {
            station = this.station;
        }

        // Fetch station data if URL is missing or station is incomplete
        if (!station?.url_resolved) {
            const parsed = parseStationKey(key);
            const fetched = await RadioProviderRegistry.getStation(parsed, { forPlay: true });
            if (!fetched || !fetched.url_resolved || fetched.lastcheckok === 0) {
                // Last resort: currently playing same key with a URL
                if (stationKey(this.station) === key && this.station?.url_resolved) {
                    station = this.station;
                } else {
                    this.loading = false;
                    this.loadPhase = 'idle';
                    this.error = fetched ? 'Stream unavailable' : 'Could not load station';
                    if (fetched && fetched.lastcheckok === 0) {
                        this.error = 'Station offline';
                    }
                    this.emitState();
                    return;
                }
            } else {
                station = fetched;
            }
        } else if (station.lastcheckok === 0) {
            this.loading = false;
            this.loadPhase = 'idle';
            this.error = 'Station offline';
            this.emitState();
            return;
        }

        // Normalize and set station BEFORE emitState so UI shows correct station
        this.station = normalizeStation(station, station.providerId) || station;
        key = stationKey(this.station) || key;
        saveState({
            lastStationKey: key,
            lastStationName: this.station.name || ''
        });

        this.recentRecordedForKey = null;
        this.loading = true;
        this.loadPhase = 'connecting';
        this.error = null;
        this.resumeBlocked = false;
        this.pausedAt = null;
        this.emitState();

        try {
            const provider = RadioProviderRegistry.getProvider(this.station.providerId);
            provider.reportClick?.(this.station.stationId);

            const url = this.station.url_resolved;
            const wantCors = this.wantsCorsAnalysis();
            const audible = !!(this.audio && !this.audio.paused && !this.audio.ended);
            const sameUrl = this.streamUrl === url || this.audio.src === url;

            // Never CORS-upgrade an audible / already-loaded stream
            if (sameUrl && wantCors && !this.loadedWithCors) {
                this.analysisAvailable = false;
                if (audible) {
                    this.loading = false;
                    this.loadPhase = 'idle';
                    this.error = null;
                    this.emitState();
                    return;
                }
                // Resume without flipping CORS
                await this.resumeAudioGraph();
                await this.audio.play();
                this.loading = false;
                this.loadPhase = 'idle';
                this.emitState();
                return;
            }

            if (!sameUrl || (wantCors && !this.loadedWithCors && !audible)) {
                this.applyCrossOriginAttr(wantCors);
                this.audio.src = url;
                this.audio.load();
                this.streamUrl = url;
                this.loadedWithCors = wantCors && this.audio.crossOrigin === 'anonymous';
            }

            await this.resumeAudioGraph();
            await this.audio.play();
            if (this.loadedWithCors) {
                this.analysisAvailable = true;
            }
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
            } else if (this.loadedWithCors || this.wantsCorsAnalysis()) {
                this.markAnalysisCorsFailed(key);
                this.applyCrossOriginAttr(false);
                try {
                    this.audio.src = this.station.url_resolved;
                    this.audio.load();
                    this.streamUrl = this.station.url_resolved;
                    this.loadedWithCors = false;
                    await this.audio.play();
                    this.analysisAvailable = false;
                    this.error = null;
                    this.emitState();
                    return;
                } catch (fallbackErr) {
                    const recovered = await this.resetAudioElementAndPlay();
                    if (recovered) return;
                    const fallbackBlocked = fallbackErr?.name === 'NotAllowedError'
                        || String(fallbackErr?.message || '').toLowerCase().includes('not allowed');
                    if (fallbackBlocked) {
                        this.error = null;
                        this.resumeBlocked = true;
                        saveState({ wasPlaying: false });
                        this.emitState();
                        throw fallbackErr;
                    }
                    this.error = 'Stream unavailable';
                }
            } else {
                const viz = await getVisualizer();
                if (viz?.hasMediaElementSource?.()) {
                    const recovered = await this.resetAudioElementAndPlay();
                    if (recovered) return;
                }
                this.error = e?.message === 'Station offline' ? 'Station offline' : 'Stream unavailable';
            }
            this.emitState();
            if (blocked) throw e;
        }
    }
};
