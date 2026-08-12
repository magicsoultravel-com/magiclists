/** @module {{"owns":"radio Google Cast support (native Cast SDK)", "related":["sidebarRadio.js","radioPlayer.js","radioPopover.js"]}} */
/**
 * Resolve the Google Cast SDK.
 * The sender library is loaded synchronously in <head> (see index.html). It must
 * NOT be injected dynamically/async, or Chrome reports the Cast API as unavailable.
 */
function loadCastSdk() {
    if (typeof window !== 'undefined' && window.cast?.framework && window.chrome?.cast) {
        return Promise.resolve(window.cast.framework);
    }
    if (window.__castSdkReady) return window.__castSdkReady;
    // SDK was blocked, loaded too late, or reported __onGCastApiAvailable(false).
    return Promise.reject(new Error('Google Cast SDK unavailable'));
}

/** Guess MIME type from a stream URL for the Default Media Receiver. */
function contentTypeForUrl(url) {
    const path = String(url || '').split('?')[0].toLowerCase();
    if (path.endsWith('.aac')) return 'audio/aac';
    if (path.endsWith('.ogg') || path.endsWith('.oga')) return 'audio/ogg';
    if (path.endsWith('.m3u8')) return 'application/x-mpegURL';
    return 'audio/mpeg';
}

export const RadioCast = {
    context: null,
    session: null,
    castDeviceName: null,
    available: false,
    casting: false,

    async init() {
        if (this.available) return;
        try {
            await loadCastSdk();
            this.available = true;

            const context = window.cast.framework.CastContext.getInstance();
            context.setOptions({
                receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
                autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
            });
            this.context = context;

            context.addEventListener(
                window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
                () => this.syncFromContext()
            );

            this.dispatchChanged();
        } catch (e) {
            console.warn('Cast init failed:', e);
        }
    },

    syncFromContext() {
        if (!this.context) return;
        this.session = this.context.getCurrentSession();
        this.castDeviceName = this.session?.getCastDevice()?.friendlyName || null;
        this.casting = !!this.session;
        this.dispatchChanged();
    },

    dispatchChanged() {
        window.dispatchEvent(new CustomEvent('radio:cast_state_changed'));
    },

    getStatus() {
        return {
            available: this.available,
            casting: this.casting,
            deviceName: this.castDeviceName
        };
    },

    /** Cast a station stream to a device chosen via Chrome's native Cast picker. */
    async castStation(url, name) {
        if (!this.available) await this.init();
        if (!this.available || !this.context) {
            throw new Error('Google Cast is not available in this browser.');
        }
        if (!url) throw new Error('No station URL to cast.');

        try {
            await this.context.requestSession();
        } catch (err) {
            const cancelCode = window.chrome?.cast?.ErrorCode?.CANCEL;
            if (err === cancelCode || err?.code === cancelCode) {
                throw new Error('Cast cancelled');
            }
            throw new Error('Could not start cast session.');
        }

        const session = this.context.getCurrentSession();
        if (!session) throw new Error('Cast session not started.');

        this.session = session;
        this.castDeviceName = session.getCastDevice()?.friendlyName || null;
        this.dispatchChanged();

        const media = new window.chrome.cast.media.MediaInfo(url, contentTypeForUrl(url));
        media.streamType = window.chrome.cast.media.StreamType.LIVE;
        const meta = new window.chrome.cast.media.GenericMediaMetadata();
        meta.metadataType = window.chrome.cast.media.MetadataType.GENERIC;
        meta.title = name || 'Radio';
        media.metadata = meta;

        const request = new window.chrome.cast.media.LoadRequest(media);
        request.autoplay = true;

        try {
            await session.loadMedia(request);
        } catch (err) {
            const cancelCode = window.chrome?.cast?.ErrorCode?.CANCEL;
            if (err === cancelCode || err?.code === cancelCode) {
                throw new Error('Cast cancelled');
            }
            throw new Error('Could not load stream on cast device.');
        }

        this.casting = true;
        this.dispatchChanged();
    },

    async stopAll() {
        if (this.context) {
            try {
                await this.context.endCurrentSession(true);
            } catch (e) { /* ignore */ }
        }
        this.session = null;
        this.castDeviceName = null;
        this.casting = false;
        this.dispatchChanged();
    },

    isCasting() {
        return this.casting;
    }
};
