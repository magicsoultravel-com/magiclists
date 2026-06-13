import { TvProviderRegistry } from './tvProviders/registry.js';
import {
    channelKey,
    parseChannelKey,
    migrateFavoriteRef,
    normalizeChannel
} from './tvProviders/channelShape.js';
import { canPlayNativeHls, isHlsUrl, loadHlsLibrary } from './tvHls.js';

const STATE_KEY = 'matrix_tv_state';
const RECENTS_CAP = 20;
const DEFAULT_BROWSER_W = 360;
const DEFAULT_BROWSER_H = 420;
const DEFAULT_BROWSE_SORT = 'name';
const DEFAULT_COUNTRY_SORT = 'count';

function migrateRecentsMeta(raw) {
    if (Array.isArray(raw.recentsMeta) && raw.recentsMeta.length) {
        return raw.recentsMeta.map((entry) => {
            if (typeof entry === 'string') {
                return { key: migrateFavoriteRef(entry), name: '', logo: '', countrycode: '', at: 0 };
            }
            return {
                key: migrateFavoriteRef(entry.key),
                name: entry.name || '',
                logo: entry.logo || '',
                countrycode: entry.countrycode || '',
                at: Number.isFinite(entry.at) ? entry.at : 0
            };
        }).filter((e) => e.key);
    }
    if (Array.isArray(raw.recents)) {
        return raw.recents.map((key) => ({
            key: migrateFavoriteRef(key),
            name: '',
            logo: '',
            countrycode: '',
            at: 0
        })).filter((e) => e.key);
    }
    return [];
}

function loadState() {
    try {
        const raw = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
        const miniPlayerDocked = raw.miniPlayerDocked !== false;
        const favorites = Array.isArray(raw.favorites)
            ? raw.favorites.map(migrateFavoriteRef)
            : [];
        const recentsMeta = migrateRecentsMeta(raw);
        const recents = recentsMeta.map((e) => e.key);
        const lastKey = raw.lastChannelKey || null;

        return {
            favorites,
            recents,
            recentsMeta,
            volume: Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : 0.85,
            lastChannelKey: lastKey,
            lastChannelName: raw.lastChannelName || '',
            wasPlaying: raw.wasPlaying === true,
            hideOfflineChannels: raw.hideOfflineChannels !== false,
            miniPlayerDocked,
            miniPlayerX: Number.isFinite(raw.miniPlayerX) ? raw.miniPlayerX : null,
            miniPlayerY: Number.isFinite(raw.miniPlayerY) ? raw.miniPlayerY : null,
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
            lastChannelKey: null,
            lastChannelName: '',
            wasPlaying: false,
            hideOfflineChannels: true,
            miniPlayerDocked: true,
            miniPlayerX: null,
            miniPlayerY: null,
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
    window.dispatchEvent(new CustomEvent('tv:state_changed', { detail }));
}

export const TvPlayer = {
    video: null,
    videoHolder: null,
    hls: null,
    channel: null,
    playing: false,
    loading: false,
    loadPhase: 'idle',
    error: null,
    resumeBlocked: false,
    recentRecordedForKey: null,
    volume: loadState().volume,
    videoMount: null,

    init() {
        if (this.video) return;

        this.videoHolder = document.createElement('div');
        this.videoHolder.id = 'tv-video-holder';
        this.videoHolder.className = 'tv-video-holder is-hidden';
        this.videoHolder.setAttribute('aria-hidden', 'true');
        document.body.appendChild(this.videoHolder);

        this.video = document.createElement('video');
        this.video.className = 'tv-video';
        this.video.playsInline = true;
        this.video.setAttribute('playsinline', '');
        this.video.preload = 'none';
        this.video.volume = this.volume;
        this.videoHolder.appendChild(this.video);

        this.video.addEventListener('loadstart', () => {
            this.loadPhase = 'connecting';
            this.emitState();
        });
        this.video.addEventListener('canplay', () => {
            if (this.loadPhase !== 'idle') {
                this.loadPhase = 'idle';
                this.emitState();
            }
        });
        this.video.addEventListener('playing', () => {
            this.playing = true;
            this.loading = false;
            this.loadPhase = 'idle';
            this.error = null;
            this.resumeBlocked = false;
            saveState({ wasPlaying: true });
            const key = channelKey(this.channel);
            if (key && this.recentRecordedForKey !== key) {
                this.recentRecordedForKey = key;
                this.pushRecent(key, this.channel);
            }
            this.emitState();
        });
        this.video.addEventListener('pause', () => {
            this.playing = false;
            this.emitState();
        });
        this.video.addEventListener('waiting', () => {
            this.loading = true;
            this.loadPhase = 'buffering';
            this.emitState();
        });
        this.video.addEventListener('stalled', () => {
            if (this.playing || this.loading) {
                this.loadPhase = 'buffering';
                this.emitState();
            }
        });
        this.video.addEventListener('error', () => {
            this.loading = false;
            this.loadPhase = 'idle';
            this.playing = false;
            this.error = 'Stream unavailable';
            this.emitState();
        });
        this.video.addEventListener('ended', () => {
            this.playing = false;
            this.loadPhase = 'idle';
            this.emitState();
        });

        const saved = loadState();
        if (saved.lastChannelKey) {
            const parsed = parseChannelKey(saved.lastChannelKey);
            this.channel = {
                providerId: parsed.providerId,
                channelId: parsed.channelId,
                channeluuid: saved.lastChannelKey,
                name: saved.lastChannelName || 'Last channel'
            };
            this.emitState();
        }
    },

    mountVideo(targetEl) {
        if (!this.video) return;
        const mount = targetEl || this.videoHolder;
        if (this.video.parentElement !== mount) {
            mount.appendChild(this.video);
        }
        this.videoMount = mount;
        mount.classList?.remove('is-hidden');
        this.videoHolder.classList.toggle('is-hidden', mount !== this.videoHolder);
    },

    mountToHolder() {
        this.mountVideo(this.videoHolder);
    },

    emitState() {
        dispatchState({
            channel: this.channel,
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

    pushRecent(key, channel = null) {
        if (!key) return;
        const meta = loadState().recentsMeta.filter((e) => e.key !== key);
        meta.unshift({
            key,
            name: channel?.name || '',
            logo: channel?.logo || '',
            countrycode: channel?.countrycode || '',
            at: Date.now()
        });
        saveState({ recentsMeta: meta.slice(0, RECENTS_CAP) });
    },

    isFavorite(channelOrKey) {
        const key = typeof channelOrKey === 'string'
            ? migrateFavoriteRef(channelOrKey)
            : channelKey(channelOrKey);
        return loadState().favorites.includes(key);
    },

    toggleFavorite(channel) {
        const key = channelKey(channel);
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
        const parsed = parseChannelKey(key);
        TvProviderRegistry.getChannel(parsed).catch(() => {});
        this.emitState();
        return true;
    },

    setVolume(value) {
        this.volume = Math.min(1, Math.max(0, value));
        if (this.video) this.video.volume = this.volume;
        saveState({ volume: this.volume });
        this.emitState();
    },

    async destroyHls() {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    },

    async attachStream(url) {
        await this.destroyHls();
        const video = this.video;
        video.removeAttribute('src');
        video.load();

        if (isHlsUrl(url)) {
            if (canPlayNativeHls(video)) {
                video.src = url;
                return;
            }
            const Hls = await loadHlsLibrary();
            if (!Hls.isSupported()) {
                throw new Error('HLS not supported');
            }
            await new Promise((resolve, reject) => {
                this.hls = new Hls();
                this.hls.on(Hls.Events.MANIFEST_PARSED, resolve);
                this.hls.on(Hls.Events.ERROR, (_, data) => {
                    if (data.fatal) reject(new Error('Stream unavailable'));
                });
                this.hls.loadSource(url);
                this.hls.attachMedia(video);
            });
            return;
        }

        video.src = url;
    },

    async toggle() {
        if (this.playing) {
            this.pause();
            return;
        }
        this.resumeBlocked = false;
        if (this.channel?.url_resolved && (this.video?.src || this.hls)) {
            try {
                await this.video.play();
            } catch {
                this.error = 'Playback blocked';
                this.resumeBlocked = true;
                saveState({ wasPlaying: false });
                this.emitState();
            }
            return;
        }
        if (this.channel) {
            await this.playChannel(this.channel);
        }
    },

    pause() {
        this.video?.pause();
        this.playing = false;
        saveState({ wasPlaying: false });
        this.emitState();
    },

    stop() {
        this.video?.pause();
        this.destroyHls();
        if (this.video) {
            this.video.removeAttribute('src');
            this.video.load();
        }
        this.playing = false;
        this.loading = false;
        this.loadPhase = 'idle';
        this.error = null;
        saveState({ wasPlaying: false });
        this.emitState();
    },

    async resumeIfWasPlaying() {
        if (!this.getWasPlaying() || !this.channel) return;
        try {
            await this.playChannel(this.channel);
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

    async playChannel(channelOrKey) {
        this.init();
        let channel = typeof channelOrKey === 'object' && channelOrKey !== null
            ? channelOrKey
            : null;

        if (!channel && typeof channelOrKey === 'string') {
            const parsed = parseChannelKey(channelOrKey);
            channel = await TvProviderRegistry.getChannel(parsed);
        }

        if (channel && !channel.url_resolved) {
            const parsed = parseChannelKey(channelKey(channel));
            channel = await TvProviderRegistry.getChannel(parsed);
        }

        const key = channelKey(channel);
        if (!key || !channel) return;

        this.recentRecordedForKey = null;
        this.loading = true;
        this.loadPhase = 'connecting';
        this.error = null;
        this.resumeBlocked = false;
        this.emitState();

        try {
            if (!channel.url_resolved) {
                throw new Error('No stream URL');
            }
            if (channel.lastcheckok === 0) {
                throw new Error('Channel offline');
            }

            this.channel = normalizeChannel(channel, channel.providerId) || channel;
            saveState({
                lastChannelKey: key,
                lastChannelName: channel.name || ''
            });

            await this.attachStream(channel.url_resolved);
            await this.video.play();
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
                this.error = e?.message === 'Channel offline' ? 'Channel offline' : 'Stream unavailable';
            }
            if (typeof channelOrKey === 'object' && channelOrKey?.name) {
                this.channel = normalizeChannel(channelOrKey, channelOrKey.providerId) || channelOrKey;
            }
            this.emitState();
            if (blocked) throw e;
        }
    }
};
