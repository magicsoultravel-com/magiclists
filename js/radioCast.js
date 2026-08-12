/** @module {{"owns":"radio Google Cast support (native Cast SDK)", "related":["sidebarRadio.js","radioPlayer.js","radioPopover.js"]}} */
const CAST_SDK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js';

let sdkPromise = null;
let apiAvailable = false;

/** Lazily load the Google Cast SDK (mirrors tvHls.js loader pattern). */
function loadCastSdk() {
    if (typeof window !== 'undefined' && window.cast?.framework) {
        apiAvailable = true;
        return Promise.resolve(window.cast.framework);
    }
    if (sdkPromise) return sdkPromise;

    sdkPromise = new Promise((resolve, reject) => {
        const prev = window.__onGCastApiAvailable;
        window.__onGCastApiAvailable = (isAvailable) => {
            if (prev) prev(isAvailable);
            apiAvailable = isAvailable;
            if (isAvailable && window.cast?.framework) {
                resolve(window.cast.framework);
            } else {
                reject(new Error('Google Cast SDK unavailable'));
            }
        };
        const script = document.createElement('script');
        script.src = CAST_SDK_URL;
        script.async = true;
        script.onerror = () => reject(new Error('Failed to load Google Cast SDK'));
        document.head.appendChild(script);
    });

    return sdkPromise;
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

        const session = await this.context.requestSession();
        this.session = session;
        this.castDeviceName = session?.getCastDevice()?.friendlyName || null;
        this.dispatchChanged();

        const media = new window.chrome.cast.media.MediaInfo(url, 'audio/*');
        const meta = new window.chrome.cast.media.GenericMediaMetadata();
        meta.metadataType = window.chrome.cast.media.MetadataType.GENERIC;
        meta.title = name || 'Radio';
        media.metadata = meta;

        const request = new window.chrome.cast.media.LoadRequest(media);
        await session.loadMedia(request);
        this.casting = true;
        this.dispatchChanged();
    },

    async stopAll() {
        if (this.session) {
            try {
                await this.session.stop();
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
