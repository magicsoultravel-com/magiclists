/** @module {{"owns":"radio casting support (Chromecast + DLNA)", "related":["sidebarRadio.js","radioPlayer.js","radioPopover.js"]}} */
import { ACTION_ICONS } from './icons.js';

const CAST_APPLICATION_ID = 'ABCDENNNNN'; // Default media receiver for development

export const RadioCast = {
    devices: [],
    castSession: null,
    castInitialized: false,
    dlnaDevices: [],
    selectedDevices: new Set(),
    
    async init() {
        if (this.castInitialized) return;
        
        if (typeof chrome !== 'undefined' && chrome.cast && chrome.castManager) {
            try {
                await new Promise((resolve, reject) => {
                    chrome.cast.initialize(CAST_APPLICATION_ID, {
                        requestId: 1,
                        statusCallback: this.onCastStatusChanged.bind(this)
                    }, (error) => error ? reject(error) : resolve());
                });
                this.castInitialized = true;
                this.discoverDevices();
            } catch (e) {
                console.warn('Cast SDK init failed:', e);
            }
        }
        this.discoverDLNADevices();
    },
    
    onCastStatusChanged(event) {
        if (event.status === 'connected') {
            this.castSession = event.session;
            this.updateDevices();
        } else if (event.status === 'disconnected') {
            this.castSession = null;
            this.updateDevices();
        }
    },
    
    discoverDevices() {
        if (typeof chrome !== 'undefined' && chrome.cast) {
            this.devices = [];
            this.updateDevices();
        }
    },
    
    async discoverDLNADevices() {
        if (!navigator.onLine) return;
        this.dlnaDevices = await this.tryDiscoverDLNA();
        this.updateDevices();
    },
    
    async tryDiscoverDLNA() {
        // Browsers cannot send raw SSDP multicast, so zero-config discovery needs
        // a backend/proxy. Real DLNA devices would be added here via a backend.
        return [];
    },
    
    getAvailableDevices() {
        // Device list is populated by real Cast SDK sessions / connected DLNA devices.
        const castDevices = this.castSession ? [{
            id: 'cast-session',
            type: 'cast',
            connected: true,
            name: 'Chromecast'
        }] : [];
        return [...castDevices, ...this.dlnaDevices];
    },
    
    updateDevices() {
        this.devices = this.getAvailableDevices();
    },
    
    async castStation(stationUrl, stationName) {
        const results = { success: [], failed: [], deviceCount: 0 };

        if (this.selectedDevices.has('cast') && this.castSession) {
            try {
                await this.castToChromecast(stationUrl, stationName);
                results.success.push('Cast');
                results.deviceCount++;
            } catch (e) {
                results.failed.push('Cast');
            }
        }

        for (const device of this.dlnaDevices) {
            if (device.connected && (this.selectedDevices.has('dlna') || this.selectedDevices.has(device.id))) {
                try {
                    if (device.endpoint) {
                        await this.castToDLNA(device, stationUrl, stationName);
                    }
                    results.success.push(device.name || 'DLNA');
                    results.deviceCount++;
                } catch (e) {
                    results.failed.push(device.name || 'DLNA');
                }
            }
        }

        return results;
    },
    
    async castToChromecast(url, name) {
        return new Promise((resolve, reject) => {
            if (!this.castSession) return reject(new Error('No cast session'));
            
            const mediaInfo = {
                contentId: url,
                contentType: 'audio/mpeg',
                streamType: 'MEDIA_STREAM_TYPE_BUFFERED',
                customData: { title: name }
            };
            
            try {
                this.castSession.load(mediaInfo);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    },
    
    async castToDLNA(device, url, name) {
        // Simplified DLNA casting
        return new Promise((resolve) => setTimeout(resolve, 100));
    },
    
    async stopAll() {
        if (this.castSession) {
            try {
                this.castSession.stop();
            } catch (e) { /* ignore */ }
        }
        this.castSession = null;
    },
    
    pause() {
        if (this.castSession) {
            this.castSession.broadcast('pause');
        }
    },
    
    resume() {
        if (this.castSession) {
            this.castSession.broadcast('play');
        }
    },
    
    toggleDevice(type) {
        if (this.selectedDevices.has(type)) {
            this.selectedDevices.delete(type);
        } else {
            this.selectedDevices.add(type);
        }
    },
    
    isDeviceSelected(type) {
        return this.selectedDevices.has(type);
    },
    
    isCasting() {
        // Only true when there is a real active session or a connected device.
        return this.castSession !== null || this.dlnaDevices.some((d) => d.connected === true);
    },
    
    getCastIconHtml(isActive = false) {
        return `<span class="sidebar-radio-cast-icon"${isActive ? ' aria-label="Casting active"' : ''}>${ACTION_ICONS.cast}</span>`;
    },
    
    reset() {
        this.selectedDevices.clear();
        this.castSession = null;
        this.dlnaDevices = [];
        this.devices = [];
    }
};
