/** @module {"owns":"sidebar radio player and station browser", "related":["radioPlayer.js","radioProviders/registry.js","radioPopover.js","sidebarModules.js"]} */
import { RadioProviderRegistry } from './radioProviders/registry.js';
import { stationKey, parseStationKey } from './radioProviders/stationShape.js';
import { RadioPlayer } from './radioPlayer.js';
import { RadioVisualizer } from './radioVisualizer.js';
import { RadioPopover } from './radioPopover.js';
import { RadioCast } from './radioCast.js';
import { escapeHtml, countryFlagEmoji, debounce, syncMarquee, bindFaviconImage } from './radioUtils.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import { renderSidebarModuleHeaderHtml } from './sidebarModules.js';
import { copyPlainTextToClipboard } from './clipboard.js';
import { showAppToast } from './toast.js';

const BROWSE_PAGE_SIZE = 60;
const BROWSE_SORT_OPTIONS = [
    { value: 'name', label: 'Name' },
    { value: 'clickcount', label: 'Popular' },
    { value: 'votes', label: 'Votes' },
    { value: 'bitrate', label: 'Bitrate' }
];
const BROWSE_SORT_DIR_OPTIONS = [
    { value: 'asc', label: 'Ascending' },
    { value: 'desc', label: 'Descending' }
];

const COUNTRY_SORT_OPTIONS = [
    { value: 'count', label: 'Most stations' },
    { value: 'name', label: 'Name' }
];

export const SidebarRadio = {
    root: null,
    countries: [],
    countryFilter: '',
    browseView: 'countries',
    browseCountry: null,
    browseStations: [],
    browseOffset: 0,
    browseHasMore: false,
    browseLoading: false,
    browseScrollObserver: null,
    listStations: [],
    activeTab: 'browse',
    loadSeq: 0,
    onStateChanged: null,

    init() {
        this.root = document.getElementById('sidebar-radio');
        if (!this.root) return;

        RadioPlayer.init();
        RadioCast.init().catch(() => {});
        this.renderShell();
        this.bindShellListeners();

        RadioPopover.onTabChange = (tab) => {
            this.activeTab = tab;
            this.renderPanelContent(tab);
        };

        this.onStateChanged = (e) => {
            this.updateTransport(e.detail);
            if (!RadioPopover.mode || RadioPopover.panel?.classList.contains('is-hidden')) return;
            const tab = RadioPopover.activeTab;
            if (tab === 'browse' && this.browseView === 'country') {
                this.updatePlayingTiles();
            } else if (tab === 'recents' || tab === 'favorites') {
                this.updatePlayingTiles();
            }
        };
        window.addEventListener('radio:state_changed', this.onStateChanged);
        window.addEventListener('radio:cast_state_changed', () => {
            this.syncCastActiveState();
            if (RadioPopover.mode === 'cast') this.renderCastPanel();
        });
        this.updateTransport();
        requestAnimationFrame(() => {
            RadioVisualizer.restoreSession();
        });
        this.restoreLastStationMeta().then(() => {
            this.updateTransport();
            return RadioPlayer.resumeIfWasPlaying();
        }).catch(() => {});
        this.prefetchCountries().then(() => this.updateTransport());
    },

    async restoreLastStationMeta() {
        const station = RadioPlayer.station;
        const key = stationKey(station);
        if (!key) return;
        try {
            const parsed = parseStationKey(key);
            const full = await RadioProviderRegistry.getStation(parsed);
            if (full) {
                RadioPlayer.station = full;
                RadioPlayer.emitState();
            }
        } catch {
            /* keep fallback name */
        }
    },

    async prefetchCountries() {
        try {
            this.countries = await RadioProviderRegistry.getCountries();
            if (!Array.isArray(this.countries)) this.countries = [];
        } catch {
            this.countries = [];
        }
    },

    resolveCountryName(code) {
        if (!code) return '';
        const found = this.countries.find((c) => c.iso_3166_1 === code);
        return found?.name || code;
    },

    renderShell() {
        const compactHtml = `
                <div class="sidebar-radio__compact">
                    <button type="button" class="sidebar-media__compact-art" data-radio-station-context title="Show station in browser" aria-label="Show station in browser">
                        <img class="sidebar-media__compact-art-img is-hidden" data-radio-compact-art alt="">
                        <span class="sidebar-media__compact-art-fallback" data-radio-compact-art-fallback aria-hidden="true">♪</span>
                    </button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-media__action" data-radio-play aria-label="Play or pause">
                        <span data-radio-play-icon></span>
                    </button>
                    <input type="range" class="sidebar-media__volume-compact" data-radio-volume-compact min="0" max="100" value="85" aria-label="Volume">
                </div>`;
        this.root.innerHTML = `
            ${renderSidebarModuleHeaderHtml({ headerId: 'radio-section-header', title: 'Radio', extrasHtml: compactHtml })}
            <div class="collapsable-section" id="radio-section">
                <div class="sidebar-media__now-playing" data-radio-transport>
                    <button type="button" class="sidebar-media__art" data-radio-station-context title="Show station in browser" aria-label="Show station in browser">
                        <img class="sidebar-media__art-img is-hidden" data-radio-art alt="">
                        <span class="sidebar-media__art-fallback" data-radio-art-fallback aria-hidden="true">♪</span>
                    </button>
                    <div class="sidebar-media__meta">
                        <div class="sidebar-media__title-row">
                            <div class="sidebar-media__marquee" data-radio-marquee>Radio</div>
                        </div>
                        <div class="sidebar-media__locale-row">
                            <button type="button" class="sidebar-media__locale is-hidden" data-radio-station-context title="Show station in browser" aria-label="Show station in browser">
                                <span data-radio-flag aria-hidden="true"></span>
                                <span class="sidebar-media__country-name" data-radio-country-name></span>
                            </button>
                            <span class="sidebar-media__load-status is-hidden" data-radio-load-status></span>
                        </div>
                        <div class="sidebar-media__volume-row">
                            <input type="range" class="sidebar-media__volume" data-radio-volume min="0" max="100" value="85" aria-label="Volume">
                        </div>
                    </div>
                </div>
                <div class="sidebar-media__actions">
                    <button type="button" class="btn btn--compact btn-icon sidebar-media__action" data-radio-play aria-label="Play or pause">
                        <span data-radio-play-icon></span>
                    </button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-media__action" data-radio-stop title="Stop" aria-label="Stop">${ACTION_ICONS.mediaStop}</button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-media__action" data-radio-open="browse" title="Browse stations" aria-label="Browse stations" aria-expanded="false" aria-haspopup="dialog">${ACTION_ICONS.radioBrowse}</button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-media__action sidebar-radio__action--heart is-hidden" data-radio-favorite title="Add favorite" aria-label="Add favorite" aria-pressed="false">${CARD_ICONS.heart}</button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-media__action" data-radio-visualizer-toggle title="Toggle radio visualizer" aria-label="Toggle radio visualizer" aria-pressed="false">${ACTION_ICONS.radioVisualizer}</button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-media__action" data-radio-open="special" title="Radio settings" aria-label="Radio settings" aria-expanded="false" aria-haspopup="dialog">${ACTION_ICONS.radioSpecial}</button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-media__action sidebar-radio__cast-btn" data-radio-cast title="Cast radio" aria-label="Cast radio" aria-pressed="false">${ACTION_ICONS.cast}</button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-media__action" data-radio-url title="Copy station link" aria-label="Copy station link">${ACTION_ICONS.link}</button>
                </div>
            </div>
        `;
    },

    bindShellListeners() {
        this.root.querySelectorAll('[data-radio-play]').forEach((btn) => {
            btn.addEventListener('click', () => RadioPlayer.toggle());
        });
        this.root.querySelector('[data-radio-stop]')?.addEventListener('click', () => RadioPlayer.stop());

        this.root.querySelector('[data-radio-favorite]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const station = RadioPlayer.station;
            if (!stationKey(station)) return;
            this.tryToggleFavorite(station);
        });

        this.root.querySelectorAll('[data-radio-station-context]').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openBrowseForNowPlaying();
            });
        });

        const syncVolume = (value) => {
            RadioPlayer.setVolume(value);
            this.root.querySelectorAll('[data-radio-volume], [data-radio-volume-compact]').forEach((el) => {
                el.value = String(Math.round(value * 100));
            });
        };

        this.root.querySelector('[data-radio-volume]')?.addEventListener('input', (e) => {
            syncVolume(Number(e.target.value) / 100);
        });
        this.root.querySelector('[data-radio-volume-compact]')?.addEventListener('input', (e) => {
            syncVolume(Number(e.target.value) / 100);
        });

        const vol = Math.round(RadioPlayer.volume * 100);
        this.root.querySelectorAll('[data-radio-volume], [data-radio-volume-compact]').forEach((el) => {
            el.value = String(vol);
        });

        this.root.querySelectorAll('[data-radio-open]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openPanel(btn.getAttribute('data-radio-open'), btn);
            });
        });

        this.root.querySelector('[data-radio-cast]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openCastPanel();
        });

        this.root.querySelector('[data-radio-url]')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const station = RadioPlayer.station;
            if (!station?.url_resolved) {
                showAppToast('No station to share');
                return;
            }
            const success = await copyPlainTextToClipboard(station.url_resolved);
            if (success) {
                showAppToast('Station link copied to clipboard');
            } else {
                showAppToast('Failed to copy station link');
            }
        });

        this.root.querySelector('[data-radio-visualizer-toggle]')?.addEventListener('click', async () => {
            const button = this.root.querySelector('[data-radio-visualizer-toggle]');
            const enabled = await RadioVisualizer.toggle(null, RadioPlayer.getAudioElement());
            if (button) {
                button.setAttribute('aria-pressed', String(enabled));
                button.classList.toggle('is-active', enabled);
            }
            const modal = document.querySelector('.media-visualizer-modal');
            if (modal && enabled) {
                const modeEl = modal.querySelector('[data-media-visualizer-mode]');
                const paletteEl = modal.querySelector('[data-media-visualizer-palette]');
                const sensitivityEl = modal.querySelector('[data-media-visualizer-sensitivity]');
                const bpmEl = modal.querySelector('[data-media-visualizer-bpm]');
                RadioVisualizer.setSettings({
                    mode: modeEl?.value || 'mountains',
                    palette: paletteEl?.value || 'horizon',
                    sensitivity: sensitivityEl?.value || 1.0,
                    amplitude: modal.querySelector('[data-media-visualizer-amplitude]')?.value || 0.55,
                    bpm: bpmEl?.value || 120
                });
            }
        });

        window.addEventListener('radio:visualizer_changed', (e) => {
            const enabled = !!e.detail?.enabled;
            const button = this.root.querySelector('[data-radio-visualizer-toggle]');
            if (button) {
                button.setAttribute('aria-pressed', String(enabled));
                button.classList.toggle('is-active', enabled);
            }
        });

        const artImg = this.root.querySelector('[data-radio-art]');
        const compactArtImg = this.root.querySelector('[data-radio-compact-art]');
        bindFaviconImage(artImg, () => {
            this.root.querySelector('[data-radio-art-fallback]')?.classList.remove('is-hidden');
        });
        bindFaviconImage(compactArtImg, () => {
            this.root.querySelector('[data-radio-compact-art-fallback]')?.classList.remove('is-hidden');
        });
    },

    getBrowseAnchor() {
        return this.root.querySelector('[data-radio-open="browse"]');
    },

    openPanel(mode, anchor, { browseContext = null, tab = null } = {}) {
        this.root.querySelectorAll('[data-radio-open]').forEach((btn) => {
            if (btn !== anchor) btn.setAttribute('aria-expanded', 'false');
        });

        const titles = {
            browse: 'Browse',
            favorites: 'Favorites',
            recents: 'Recents',
            special: 'Radio settings',
            cast: 'Cast radio'
        };

        RadioPopover.onClose = () => {
            this.root.querySelectorAll('[data-radio-open]').forEach((btn) => {
                btn.setAttribute('aria-expanded', 'false');
            });
        };

        if (mode === 'special') {
            const opened = RadioPopover.open('special', {
                attachEl: this.root,
                iconAnchor: anchor,
                title: titles.special,
                force: !!browseContext
            });
            if (!opened) return;
            this.renderSpecialPanel();
            return;
        }

        if (mode === 'cast') {
            const opened = RadioPopover.open('cast', {
                attachEl: this.root,
                iconAnchor: anchor,
                title: titles.cast,
                force: !!browseContext
            });
            if (!opened) return;
            this.renderCastPanel();
            return;
        }

        const resolvedTab = tab || (mode === 'browse' ? 'browse' : mode);
        this.activeTab = resolvedTab;

        if (resolvedTab === 'browse' && !browseContext) {
            this.browseView = 'countries';
            this.browseCountry = null;
            this.countryFilter = '';
        }

        if (browseContext) {
            this.browseView = browseContext.view || 'countries';
            this.browseCountry = browseContext.country || null;
            this.highlightUuid = browseContext.highlightUuid || null;
        } else {
            this.highlightUuid = null;
        }

        const browseAnchor = this.getBrowseAnchor() || anchor;
        const opened = RadioPopover.open('browse', {
            attachEl: this.root,
            iconAnchor: browseAnchor,
            title: titles[resolvedTab] || 'Radio',
            force: !!browseContext,
            tab: resolvedTab
        });
        if (!opened) return;
        this.renderPanelContent(resolvedTab);
    },

    async openBrowseForNowPlaying() {
        const station = RadioPlayer.station;
        const key = stationKey(station);
        const browseBtn = this.getBrowseAnchor();
        if (!browseBtn) return;

        if (!key) {
            this.openPanel('browse', browseBtn);
            return;
        }

        const code = station.countrycode;

        if (code) {
            await this.prefetchCountries();
            this.openPanel('browse', browseBtn, {
                browseContext: {
                    view: 'country',
                    country: { code, name: this.resolveCountryName(code) },
                    highlightUuid: key
                }
            });
            return;
        }

        if (RadioPlayer.isFavorite(station)) {
            this.openPanel('browse', browseBtn, { tab: 'favorites' });
            return;
        }

        if (RadioPlayer.getRecents().includes(key)) {
            this.openPanel('browse', browseBtn, { tab: 'recents' });
            return;
        }

        this.openPanel('browse', browseBtn);
    },

    async refreshOpenPanel() {
        if (RadioPopover.mode === 'special') {
            this.renderSpecialPanel();
            return;
        }
        if (RadioPopover.mode === 'cast') {
            this.renderCastPanel();
            return;
        }
        await this.renderPanelContent(RadioPopover.activeTab || this.activeTab);
    },

    async renderPanelContent(mode) {
        if (mode === 'browse') {
            if (this.browseView === 'country') {
                await this.renderBrowseCountry();
            } else {
                await this.renderBrowseCountries();
            }
            return;
        }
        if (mode === 'favorites') {
            await this.renderStationGrid('favorites');
            return;
        }
        if (mode === 'recents') {
            await this.renderStationGrid('recents');
            return;
        }
        if (mode === 'special') {
            this.renderSpecialPanel();
        }
    },

    renderSpecialPanel() {
        RadioPopover.setTitle('Radio settings');
        RadioPopover.setBackVisible(false);
        RadioPopover.setToolbarHtml('');

        const settings = RadioProviderRegistry.getSettings();
        const providers = RadioProviderRegistry.listProviders();
        const body = RadioPopover.getBodyEl();
        if (!body) return;

        body.innerHTML = `
            <div class="radio-special-form">
                <label class="radio-special-form__row">
                    <span class="radio-special-form__label">Catalog source</span>
                    <select class="form-input radio-special-form__select" data-radio-provider>
                        ${providers.map((p) => `<option value="${escapeHtml(p.id)}"${p.id === settings.catalogProvider ? ' selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}
                    </select>
                </label>
                <label class="radio-special-form__row${settings.catalogProvider !== 'radio-browser' ? ' is-hidden' : ''}" data-radio-mirror-row>
                    <span class="radio-special-form__label">Radio Browser mirror</span>
                    <select class="form-input radio-special-form__select" data-radio-mirror>
                        <option value="">Auto</option>
                    </select>
                </label>
                <label class="radio-special-form__row radio-special-form__row--check">
                    <input type="checkbox" data-radio-hide-offline${settings.hideOfflineStations ? ' checked' : ''}>
                    <span>Hide offline stations</span>
                </label>
                <div class="radio-special-form__actions">
                    <button type="button" class="btn btn--compact" data-radio-refresh-catalog>Refresh catalog</button>
                    <button type="button" class="btn btn--compact" data-radio-clear-cache>Clear cache</button>
                </div>
            </div>
        `;

        this.populateMirrorSelect(body, settings.radioBrowserMirror);

        body.querySelector('[data-radio-provider]')?.addEventListener('change', async (e) => {
            await RadioProviderRegistry.setActiveProvider(e.target.value);
            body.querySelector('[data-radio-mirror-row]')?.classList.toggle('is-hidden', e.target.value !== 'radio-browser');
            this.countries = [];
            await this.prefetchCountries();
            if (RadioPopover.mode === 'browse' && !RadioPopover.panel?.classList.contains('is-hidden')) {
                this.browseView = 'countries';
                this.browseCountry = null;
                await this.renderBrowseCountries();
            }
        });

        body.querySelector('[data-radio-mirror]')?.addEventListener('change', (e) => {
            RadioProviderRegistry.setMirror(e.target.value || null).catch(() => {});
        });

        body.querySelector('[data-radio-hide-offline]')?.addEventListener('change', (e) => {
            RadioProviderRegistry.setHideOffline(e.target.checked).catch(() => {});
            if (RadioPopover.mode === 'browse' && this.browseView === 'country') {
                this.renderBrowseCountry();
            }
        });

        body.querySelector('[data-radio-refresh-catalog]')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const originalText = btn?.textContent || '';
            if (btn) {
                btn.textContent = 'Refreshing…';
                btn.disabled = true;
            }
            try {
                await RadioProviderRegistry.refreshCatalog();
                this.countries = await RadioProviderRegistry.getCountries({ refresh: true });
                if (RadioPopover.mode === 'browse') {
                    this.browseView = 'countries';
                    this.browseCountry = null;
                    await this.renderBrowseCountries();
                }
                showAppToast('Catalog refreshed');
            } catch {
                showAppToast('Failed to refresh catalog');
            } finally {
                if (btn) {
                    btn.textContent = originalText || 'Refresh catalog';
                    btn.disabled = false;
                }
            }
        });

        body.querySelector('[data-radio-clear-cache]')?.addEventListener('click', async () => {
            try {
                await RadioProviderRegistry.clearAllCaches();
                this.countries = [];
                showAppToast('Radio catalog cache cleared');
                this.prefetchCountries();
                if (RadioPopover.mode === 'browse' && !RadioPopover.panel?.classList.contains('is-hidden')) {
                    this.browseView = 'countries';
                    this.browseCountry = null;
                    await this.renderBrowseCountries();
                }
            } catch {
                showAppToast('Failed to clear the radio catalog cache');
            }
        });

        RadioPopover.reposition();
    },

    openCastPanel() {
        const anchor = this.root.querySelector('[data-radio-cast]');
        const opened = RadioPopover.open('cast', {
            attachEl: this.root,
            iconAnchor: anchor,
            title: 'Cast radio',
            force: false
        });
        if (!opened) return;

        RadioPopover.onClose = () => {
            anchor?.setAttribute('aria-expanded', 'false');
        };
        anchor?.setAttribute('aria-expanded', 'true');

        RadioCast.init().catch(() => {});
        this.renderCastPanel();
    },

    renderCastPanel() {
        RadioPopover.setTitle('Cast radio');
        RadioPopover.setBackVisible(false);
        RadioPopover.setToolbarHtml('');

        const body = RadioPopover.getBodyEl();
        if (!body) return;

        const station = RadioPlayer.station;
        const nowKey = stationKey(station);
        const hasStation = !!nowKey && !!station?.url_resolved;
        const status = RadioCast.getStatus();

        body.innerHTML = `
            <div class="radio-cast-panel">
                <p class="radio-cast-panel__avail${status.available ? ' is-ok' : ''}">
                    ${status.available
        ? 'Google Cast is available.'
        : 'Google Cast is not available. Casting requires Chrome with Google Cast support on an HTTPS connection.'}
                </p>
                <div class="radio-cast-panel__status${status.casting ? ' is-casting' : ''}" data-radio-cast-status>
                    ${status.casting ? `Casting to <strong>${escapeHtml(status.deviceName || 'device')}</strong>` : 'Not casting'}
                </div>
                <div class="radio-cast-panel__actions">
                    <button type="button" class="btn btn--compact" data-radio-cast-go${!hasStation || !status.available ? ' disabled' : ''}>Cast current station</button>
                    <button type="button" class="btn btn--compact" data-radio-cast-stop${status.casting ? '' : ' disabled'}>Stop</button>
                </div>
            </div>
        `;

        this.bindCastPanelEvents(body, hasStation);
        RadioPopover.reposition();
    },

    bindCastPanelEvents(body, hasStation) {
        body.querySelector('[data-radio-cast-go]')?.addEventListener('click', async (e) => {
            if (!hasStation) return;
            const btn = e.currentTarget;
            btn.disabled = true;

            let station = RadioPlayer.station;
            let ok = false;
            try {
                if (!station?.url_resolved) {
                    const key = stationKey(station);
                    const parsed = parseStationKey(key);
                    if (parsed) {
                        const fetched = await RadioProviderRegistry.getStation(parsed, { forPlay: true });
                        if (fetched?.url_resolved) {
                            station = fetched;
                            RadioPlayer.station = fetched;
                            RadioPlayer.emitState();
                        }
                    }
                }
                if (!station?.url_resolved) {
                    throw new Error('Station stream URL unavailable.');
                }
                await RadioCast.castStation(station.url_resolved, station.name || 'Radio');
                ok = true;
            } catch (err) {
                this.showCastStatus(err?.message || 'Cast failed');
            } finally {
                btn.disabled = false;
                if (ok && RadioPopover.mode === 'cast') this.renderCastPanel();
            }
        });

        body.querySelector('[data-radio-cast-stop]')?.addEventListener('click', async () => {
            await RadioCast.stopAll();
            if (RadioPopover.mode === 'cast') this.renderCastPanel();
        });

        this.syncCastActiveState();
    },

    showCastStatus(msg) {
        const el = RadioPopover.getBodyEl()?.querySelector('[data-radio-cast-status]');
        if (el) {
            el.textContent = msg;
            el.classList.add('is-casting');
        }
    },

    syncCastActiveState() {
        const active = RadioCast.isCasting();
        this.root?.querySelectorAll('[data-radio-cast]').forEach((btn) => {
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    },

    async populateMirrorSelect(body, current) {
        const select = body.querySelector('[data-radio-mirror]');
        if (!select) return;
        try {
            const mirrors = await RadioProviderRegistry.discoverMirrors();
            mirrors.forEach((host) => {
                const opt = document.createElement('option');
                opt.value = host;
                opt.textContent = host;
                if (host === current) opt.selected = true;
                select.appendChild(opt);
            });
        } catch {
            /* auto only */
        }
    },

    async renderBrowseCountries() {
        RadioPopover.setTitle('Browse');
        RadioPopover.setBackVisible(false);
        RadioPopover.setToolbarHtml(this.renderBrowseCountriesToolbar());

        const body = RadioPopover.getBodyEl();
        if (!body) return;
        body.innerHTML = '<p class="tool-msg">Loading…</p>';

        if (!this.countries.length) {
            await this.prefetchCountries();
        }

        const toolbar = RadioPopover.getToolbarEl();
        toolbar?.querySelector('[data-radio-country-search]')?.addEventListener('input', debounce((e) => {
            this.countryFilter = e.target.value.trim().toLowerCase();
            this.renderBrowseCountries();
        }, 200));
        toolbar?.querySelector('[data-radio-country-sort]')?.addEventListener('change', (e) => {
            RadioPlayer.saveCountrySort(e.target.value);
            this.renderBrowseCountries();
        });

        const filtered = this.sortCountries(this.countries)
            .filter((c) => {
                if (!this.countryFilter) return true;
                const name = (c.name || '').toLowerCase();
                const code = (c.iso_3166_1 || '').toLowerCase();
                return name.includes(this.countryFilter) || code.includes(this.countryFilter);
            });

        if (!filtered.length) {
            body.innerHTML = '<p class="tool-msg">No countries match.</p>';
            return;
        }

        body.innerHTML = `<div class="sidebar-media-list">${filtered.map((c) => this.renderCountryList(c)).join('')}</div>`;

        body.querySelectorAll('[data-radio-country]').forEach((tile) => {
            tile.addEventListener('click', () => {
                const code = tile.getAttribute('data-radio-country');
                const name = tile.getAttribute('data-radio-country-name') || code;
                this.openBrowseCountry(code, name);
            });
        });

        RadioPopover.reposition();
    },

    renderCountryList(c) {
        const code = c.iso_3166_1 || '';
        const flag = countryFlagEmoji(code);
        const count = c.stationcount ? `${c.stationcount} stations` : '';
        return `<button type="button" class="sidebar-media-list-item sidebar-media-list-item--country" data-radio-country="${escapeHtml(code)}" data-radio-country-name="${escapeHtml(c.name || code)}" title="${escapeHtml(c.name || code)}">
            <span class="sidebar-media-list-item__flag" aria-hidden="true">${flag}</span>
            <span class="sidebar-media-list-item__name">${escapeHtml(c.name || code)}</span>
            ${count ? `<span class="sidebar-media-list-item__meta">${escapeHtml(count)}</span>` : ''}
        </button>`;
    },

    renderSortSelect(options, current, attrName, label) {
        return `
            <select class="form-input sidebar-media__sort" ${attrName} aria-label="${escapeHtml(label)}">
                ${options.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === current ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
            </select>
        `;
    },

    renderBrowseCountriesToolbar() {
        return `
            <div class="sidebar-media-popover__toolbar-row">
                <input type="search" class="form-input sidebar-media__search" data-radio-country-search placeholder="Filter countries…" aria-label="Filter countries" autocomplete="off" spellcheck="false" value="${escapeHtml(this.countryFilter)}">
                ${this.renderSortSelect(COUNTRY_SORT_OPTIONS, RadioPlayer.getCountrySort(), 'data-radio-country-sort', 'Sort countries')}
            </div>
        `;
    },

    sortCountries(countries) {
        const sort = RadioPlayer.getCountrySort();
        const list = countries.slice();
        if (sort === 'name') {
            list.sort((a, b) => (a.name || a.iso_3166_1 || '').localeCompare(b.name || b.iso_3166_1 || ''));
        } else {
            list.sort((a, b) => (b.stationcount || 0) - (a.stationcount || 0));
        }
        return list;
    },

    renderBrowseSortToolbar() {
        return `
            <div class="sidebar-media-popover__toolbar-row sidebar-media-popover__toolbar-row--end">
                ${this.renderSortSelect(BROWSE_SORT_OPTIONS, RadioPlayer.getBrowseSort(), 'data-radio-sort', 'Sort stations')}
                ${this.renderSortSelect(BROWSE_SORT_DIR_OPTIONS, RadioPlayer.getBrowseSortDir(), 'data-radio-sort-dir', 'Sort direction')}
            </div>
        `;
    },

    renderRecentsToolbar() {
        return `
            <div class="sidebar-media-popover__toolbar-row sidebar-media-popover__toolbar-row--end">
                <button type="button" class="btn btn--compact btn-icon card-act sidebar-media__clear-recents" data-radio-clear-recents title="Clear recents" aria-label="Clear recents">${CARD_ICONS.delete}</button>
            </div>
        `;
    },

    tryToggleFavorite(stationOrKey) {
        const station = typeof stationOrKey === 'object' && stationOrKey !== null
            ? stationOrKey
            : null;
        const key = station ? stationKey(station) : (typeof stationOrKey === 'string' ? stationOrKey : '');
        if (!key) return false;

        if (RadioPlayer.isFavorite(key)) {
            const name = station?.name || this.findStation(key)?.name || '';
            const msg = name ? `Remove "${name}" from favorites?` : 'Remove from favorites?';
            if (!window.confirm(msg)) return false;
        }

        const isFav = RadioPlayer.toggleFavorite(station || parseStationKey(key));
        this.updateFavoriteStars(key, isFav);
        this.updateTransport();
        return true;
    },

    updateFavoriteStars(key, isFav) {
        if (!key) return;
        const body = RadioPopover.getBodyEl();
        if (!body || RadioPopover.panel?.classList.contains('is-hidden')) return;

        const starIcon = isFav ? CARD_ICONS.starFilled : CARD_ICONS.star;
        const label = isFav ? 'Remove favorite' : 'Add favorite';
        body.querySelectorAll(`[data-radio-star="${CSS.escape(key)}"]`).forEach((btn) => {
            btn.classList.toggle('is-active', isFav);
            btn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
            btn.setAttribute('aria-label', label);
            btn.title = label;
            btn.innerHTML = starIcon;
        });

        // On Favorites tab, drop the row when unfavorited instead of re-rendering the panel
        if (!isFav && RadioPopover.activeTab === 'favorites') {
            body.querySelector(`[data-radio-station="${CSS.escape(key)}"]`)?.remove();
            if (!body.querySelector('[data-radio-station]')) {
                body.innerHTML = '<p class="tool-msg">Heart stations while listening.</p>';
                RadioPopover.setToolbarHtml('');
            }
        }
    },

    disconnectBrowseScroll() {
        if (this.browseScrollObserver) {
            this.browseScrollObserver.disconnect();
            this.browseScrollObserver = null;
        }
    },

    setupBrowseScroll(body) {
        this.disconnectBrowseScroll();
        const sentinel = body?.querySelector('[data-radio-scroll-sentinel]');
        if (!sentinel || !body) return;

        this.browseScrollObserver = new IntersectionObserver((entries) => {
            const hit = entries.some((e) => e.isIntersecting);
            if (!hit) return;
            this.maybeLoadMoreBrowse();
        }, {
            root: body,
            rootMargin: '120px',
            threshold: 0
        });
        this.browseScrollObserver.observe(sentinel);
        this.maybeLoadMoreBrowse();
    },

    maybeLoadMoreBrowse() {
        if (!this.browseHasMore || this.browseLoading) return;
        if (this.browseView !== 'country') return;
        const body = RadioPopover.getBodyEl();
        const sentinel = body?.querySelector('[data-radio-scroll-sentinel]');
        if (!sentinel || !body) return;
        const sRect = sentinel.getBoundingClientRect();
        const rRect = body.getBoundingClientRect();
        if (sRect.top > rRect.bottom + 120) return;
        this.browseOffset += BROWSE_PAGE_SIZE;
        this.renderBrowseCountry(true);
    },

    async openBrowseCountry(code, name) {
        this.browseView = 'country';
        this.browseCountry = { code, name };
        this.browseOffset = 0;
        this.disconnectBrowseScroll();
        await this.renderBrowseCountry();
    },

    async renderBrowseCountry(append = false) {
        const { code, name } = this.browseCountry || {};
        RadioPopover.setTitle(name || 'Stations');
        RadioPopover.setBackVisible(true, () => {
            this.disconnectBrowseScroll();
            this.browseView = 'countries';
            this.browseCountry = null;
            this.browseOffset = 0;
            this.browseStations = [];
            this.renderBrowseCountries();
        });

        // Only rebuild toolbar on full refresh — append must not wipe sort listeners
        if (!append) {
            RadioPopover.setToolbarHtml(this.renderBrowseSortToolbar());
            this.bindBrowseCountryControls();
        }

        const body = RadioPopover.getBodyEl();
        if (!body) return;

        if (!append) {
            body.innerHTML = '<p class="tool-msg">Loading…</p>';
        } else {
            const sentinel = body.querySelector('[data-radio-scroll-sentinel]');
            if (sentinel) sentinel.textContent = 'Loading…';
        }

        const sort = RadioPlayer.getBrowseSort();
        const sortDir = RadioPlayer.getBrowseSortDir();
        const seq = ++this.loadSeq;
        this.browseLoading = true;
        try {
            const data = await RadioProviderRegistry.searchStations({
                countrycode: code,
                limit: BROWSE_PAGE_SIZE,
                offset: this.browseOffset,
                order: sort,
                reverse: sortDir === 'desc',
                hideOffline: RadioProviderRegistry.getHideOffline()
            });
            if (seq !== this.loadSeq) return;

            const page = Array.isArray(data) ? data : [];
            this.browseHasMore = page.length >= BROWSE_PAGE_SIZE;

            if (append) {
                this.browseStations = [...this.browseStations, ...page];
            } else {
                this.browseStations = page;
            }

            if (!this.browseStations.length) {
                this.disconnectBrowseScroll();
                body.innerHTML = '<p class="tool-msg">No stations in this country.</p>';
            } else if (append) {
                const list = body.querySelector('.sidebar-media-list');
                const sentinel = body.querySelector('[data-radio-scroll-sentinel]');
                if (list && page.length) {
                    list.insertAdjacentHTML(
                        'beforeend',
                        page.map((s) => this.renderStationTile(s)).join('')
                    );
                    this.bindStationTileActions(list);
                }
                if (sentinel) {
                    if (this.browseHasMore) {
                        sentinel.textContent = '';
                        sentinel.classList.remove('is-hidden');
                    } else {
                        sentinel.remove();
                        this.disconnectBrowseScroll();
                    }
                }
            } else {
                body.innerHTML = `<div class="sidebar-media-list" data-radio-station-grid>
                    ${this.browseStations.map((s) => this.renderStationTile(s)).join('')}
                </div>
                ${this.browseHasMore ? '<div class="sidebar-media-scroll-sentinel" data-radio-scroll-sentinel aria-hidden="true"></div>' : ''}
                `;
                this.bindStationTileActions(body);
                this.setupBrowseScroll(body);
                this.scrollToHighlightedStation(body);
            }
        } catch {
            if (seq !== this.loadSeq) return;
            if (!append) {
                body.innerHTML = '<p class="tool-msg tool-msg--error">Could not load stations.</p>';
            } else {
                const sentinel = body.querySelector('[data-radio-scroll-sentinel]');
                if (sentinel) sentinel.textContent = 'Could not load more';
            }
        } finally {
            if (seq === this.loadSeq) {
                this.browseLoading = false;
                if (this.browseHasMore) {
                    requestAnimationFrame(() => this.maybeLoadMoreBrowse());
                }
            }
        }
        RadioPopover.reposition();
    },

    bindBrowseCountryControls() {
        const toolbar = RadioPopover.getToolbarEl();
        if (!toolbar) return;

        toolbar.querySelector('[data-radio-sort]')?.addEventListener('change', (e) => {
            RadioPlayer.saveBrowseSort(e.target.value);
            this.browseOffset = 0;
            this.browseStations = [];
            this.disconnectBrowseScroll();
            this.renderBrowseCountry(false);
        });
        toolbar.querySelector('[data-radio-sort-dir]')?.addEventListener('change', (e) => {
            RadioPlayer.saveBrowseSortDir(e.target.value);
            this.browseOffset = 0;
            this.browseStations = [];
            this.disconnectBrowseScroll();
            this.renderBrowseCountry(false);
        });
    },

    scrollToHighlightedStation(body) {
        const uuid = this.highlightUuid;
        if (!uuid) return;
        requestAnimationFrame(() => {
            const tile = body.querySelector(`[data-radio-station="${CSS.escape(uuid)}"]`);
            tile?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            this.highlightUuid = null;
        });
    },

    stationFromMeta(meta) {
        if (!meta?.key) return null;
        const parsed = parseStationKey(meta.key);
        return {
            providerId: parsed.providerId,
            stationId: parsed.stationId,
            stationuuid: parsed.stationId,
            name: meta.name || 'Unknown',
            favicon: meta.favicon || '',
            countrycode: meta.countrycode || ''
        };
    },

    async renderStationGrid(kind) {
        RadioPopover.setBackVisible(false);
        RadioPopover.setTitle(kind === 'favorites' ? 'Favorites' : 'Recents');

        const keys = kind === 'favorites' ? RadioPlayer.getFavorites() : RadioPlayer.getRecents();
        if (kind === 'recents' && keys.length) {
            RadioPopover.setToolbarHtml(this.renderRecentsToolbar());
            RadioPopover.getToolbarEl()?.querySelector('[data-radio-clear-recents]')?.addEventListener('click', () => {
                if (!window.confirm('Clear all recent stations?')) return;
                RadioPlayer.clearRecents();
                this.renderStationGrid('recents');
            });
        } else {
            RadioPopover.setToolbarHtml('');
        }

        const body = RadioPopover.getBodyEl();
        if (!body) return;
        body.innerHTML = '<p class="tool-msg">Loading…</p>';

        if (!keys.length) {
            body.innerHTML = `<p class="tool-msg">${kind === 'favorites' ? 'Heart stations while listening.' : 'Played stations appear here after a successful connection.'}</p>`;
            return;
        }

        const metaList = kind === 'recents'
            ? RadioPlayer.getRecentsMeta()
            : keys.map((key) => {
                const cached = this.listStations.find((s) => stationKey(s) === key)
                    || this.browseStations.find((s) => stationKey(s) === key);
                return cached
                    ? { key, name: cached.name || '', favicon: cached.favicon || '', countrycode: cached.countrycode || '' }
                    : { key, name: '', favicon: '', countrycode: '' };
            });

        const fallbackStations = metaList
            .map((meta) => this.stationFromMeta(meta))
            .filter(Boolean);

        const seq = ++this.loadSeq;
        try {
            const data = await RadioProviderRegistry.getStationsByRefs(keys);
            if (seq !== this.loadSeq) return;
            const byKey = new Map(data.map((s) => [stationKey(s), s]));
            this.listStations = metaList.map((meta) => {
                const hydrated = byKey.get(meta.key);
                if (hydrated) return hydrated;
                return this.stationFromMeta(meta);
            }).filter(Boolean);

            if (!this.listStations.length) {
                body.innerHTML = '<p class="tool-msg tool-msg--error">Stations unavailable.</p>';
            } else {
                body.innerHTML = `<div class="sidebar-media-list">${this.listStations.map((s) => this.renderStationTile(s)).join('')}</div>`;
                this.bindStationTileActions(body);
            }
        } catch {
            if (seq !== this.loadSeq) return;
            this.listStations = fallbackStations;
            if (!this.listStations.length) {
                body.innerHTML = '<p class="tool-msg tool-msg--error">Could not load list.</p>';
            } else {
                body.innerHTML = `<div class="sidebar-media-list">${this.listStations.map((s) => this.renderStationTile(s)).join('')}</div>`;
                this.bindStationTileActions(body);
            }
        }
        RadioPopover.reposition();
    },

    renderStationTile(station) {
        const uuid = stationKey(station);
        const fav = RadioPlayer.isFavorite(station);
        const playing = stationKey(RadioPlayer.station) === uuid
            && (RadioPlayer.playing || RadioPlayer.loading);
        const offline = station.lastcheckok === 0;
        const starIcon = fav ? CARD_ICONS.starFilled : CARD_ICONS.star;
        const favicon = station.favicon
            ? `<img class="sidebar-media-list-item__logo" src="${escapeHtml(station.favicon)}" alt="" width="20" height="20" loading="lazy" decoding="async">`
            : '<span class="sidebar-media-list-item__logo sidebar-media-list-item__logo--fallback" aria-hidden="true">♪</span>';
        const flag = station.countrycode
            ? `<span class="sidebar-media-list-item__flag">${countryFlagEmoji(station.countrycode)}</span>`
            : '';
        const offlineBadge = offline ? '<span class="sidebar-media-list-item__offline">off</span>' : '';

        return `<div class="sidebar-media-list-item sidebar-media-list-item--channel${playing ? ' is-on-desktop' : ''}" data-radio-station="${escapeHtml(uuid)}" role="button" tabindex="0" title="${escapeHtml(station.name || '')}">
                ${favicon}
                <span class="sidebar-media-list-item__name">${escapeHtml(station.name || 'Unknown')}</span>
                ${flag}
                ${offlineBadge}
                <button type="button" class="sidebar-media-list-item__star${fav ? ' is-active' : ''}" data-radio-star="${escapeHtml(uuid)}" title="${fav ? 'Remove favorite' : 'Add favorite'}" aria-label="${fav ? 'Remove favorite' : 'Add favorite'}" aria-pressed="${fav ? 'true' : 'false'}">${starIcon}</button>
            </div>`;
    },

    bindStationTileActions(container) {
        if (!container) return;

        // Handle image loading for list items
        container.querySelectorAll('.sidebar-media-list-item__logo[src]').forEach((img) => {
            const parent = img.closest('.sidebar-media-list-item');
            bindFaviconImage(img, () => {
                // When image fails, show the fallback emoji
                parent?.querySelector('.sidebar-media-list-item__logo--fallback')?.classList.remove('is-hidden');
                img.classList.add('is-hidden');
            });
        });

        container.querySelectorAll('[data-radio-star]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const uuid = btn.getAttribute('data-radio-star');
                const station = this.findStation(uuid);
                this.tryToggleFavorite(station || parseStationKey(uuid));
            });
        });

        container.querySelectorAll('[data-radio-station]').forEach((tile) => {
            const activate = () => {
                const uuid = tile.getAttribute('data-radio-station');
                if (uuid) RadioPlayer.playStation(uuid);
            };
            tile.addEventListener('click', (e) => {
                if (e.target.closest('[data-radio-star]')) return;
                activate();
            });
            tile.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activate();
                }
            });
        });
    },

    findStation(uuid) {
        return this.browseStations.find((s) => stationKey(s) === uuid)
            || this.listStations.find((s) => stationKey(s) === uuid)
            || (stationKey(RadioPlayer.station) === uuid ? RadioPlayer.station : null);
    },

    updatePlayingTiles() {
        const body = RadioPopover.getBodyEl();
        if (!body) return;
        const currentKey = stationKey(RadioPlayer.station);
        const active = RadioPlayer.playing || RadioPlayer.loading;
        body.querySelectorAll('[data-radio-station]').forEach((tile) => {
            const isCurrent = tile.getAttribute('data-radio-station') === currentKey && active;
            tile.classList.toggle('is-on-desktop', isCurrent);
            tile.classList.toggle('is-playing', isCurrent);
        });
    },

    getPlayIconHtml(state) {
        if (state.loading || state.loadPhase === 'connecting' || state.loadPhase === 'buffering') {
            return ACTION_ICONS.radioLoading;
        }
        if (state.playing) {
            return ACTION_ICONS.radioPauseWave;
        }
        return ACTION_ICONS.radioPlay;
    },

    updateTransport(detail = null) {
        const state = detail || {
            station: RadioPlayer.station,
            playing: RadioPlayer.playing,
            loading: RadioPlayer.loading,
            loadPhase: RadioPlayer.loadPhase,
            error: RadioPlayer.error,
            resumeBlocked: RadioPlayer.resumeBlocked,
            volume: RadioPlayer.volume
        };

        const marqueeEl = this.root?.querySelector('[data-radio-marquee]');
        const artImg = this.root?.querySelector('[data-radio-art]');
        const artFallback = this.root?.querySelector('[data-radio-art-fallback]');
        const compactArtImg = this.root?.querySelector('[data-radio-compact-art]');
        const compactArtFallback = this.root?.querySelector('[data-radio-compact-art-fallback]');
        const flagEl = this.root?.querySelector('[data-radio-flag]');
        const countryNameEl = this.root?.querySelector('[data-radio-country-name]');
        const localeBtn = this.root?.querySelector('.sidebar-media__locale');
        const loadStatusEl = this.root?.querySelector('[data-radio-load-status]');
        const volumeEls = this.root?.querySelectorAll('[data-radio-volume], [data-radio-volume-compact]');
        const favBtn = this.root?.querySelector('[data-radio-favorite]');
        const transport = this.root?.querySelector('[data-radio-transport]');
        const artBtn = this.root?.querySelector('.sidebar-media__art');

        let titleText = 'Radio';
        let isError = false;
        if (state.resumeBlocked) {
            titleText = 'Tap play to resume';
        } else if (state.error) {
            titleText = state.error;
            isError = true;
        } else if (state.station?.name) {
            titleText = state.station.name;
        }

        if (marqueeEl) {
            syncMarquee(marqueeEl, titleText, { error: isError || !!state.resumeBlocked });
        }

        const code = state.station?.countrycode;
        if (localeBtn && flagEl && countryNameEl) {
            if (code && state.station && !state.resumeBlocked) {
                flagEl.textContent = countryFlagEmoji(code);
                countryNameEl.textContent = this.resolveCountryName(code) || code;
                localeBtn.classList.remove('is-hidden');
            } else {
                localeBtn.classList.add('is-hidden');
            }
        }

        if (loadStatusEl) {
            let statusText = '';
            if (state.loadPhase === 'connecting') statusText = 'Connecting…';
            else if (state.loadPhase === 'buffering') statusText = 'Buffering…';
            loadStatusEl.textContent = statusText;
            loadStatusEl.classList.toggle('is-hidden', !statusText);
        }

        const favicon = state.station?.favicon;
        const updateArt = (img, fallback) => {
            if (!img || !fallback) return;
            if (favicon) {
                fallback.classList.add('is-hidden');
                if (img.getAttribute('src') !== favicon) {
                    img.classList.add('is-hidden');
                    img.src = favicon;
                } else if (img.complete && img.naturalWidth > 0) {
                    img.classList.remove('is-hidden');
                }
            } else {
                img.removeAttribute('src');
                img.classList.add('is-hidden');
                fallback.classList.remove('is-hidden');
            }
        };
        updateArt(artImg, artFallback);
        updateArt(compactArtImg, compactArtFallback);

        const isLoading = state.loading || state.loadPhase === 'connecting' || state.loadPhase === 'buffering';
        artBtn?.classList.toggle('sidebar-media__art--loading', isLoading);
        this.root?.querySelector('.sidebar-media__compact-art')?.classList.toggle('sidebar-media__art--loading', isLoading);

        const playIconHtml = this.getPlayIconHtml(state);
        this.root?.querySelectorAll('[data-radio-play-icon]').forEach((el) => {
            el.innerHTML = playIconHtml;
        });

        if (volumeEls.length && Number.isFinite(state.volume)) {
            const vol = String(Math.round(state.volume * 100));
            volumeEls.forEach((el) => { el.value = vol; });
        }

        if (favBtn) {
            const key = stationKey(state.station);
            if (!key) {
                favBtn.classList.add('is-hidden');
            } else {
                const fav = RadioPlayer.isFavorite(state.station);
                favBtn.classList.remove('is-hidden');
                favBtn.classList.toggle('is-active', fav);
                favBtn.innerHTML = fav ? CARD_ICONS.heartFilled : CARD_ICONS.heart;
                favBtn.setAttribute('aria-pressed', fav ? 'true' : 'false');
                const label = fav ? 'Remove favorite' : 'Add favorite';
                favBtn.setAttribute('title', label);
                favBtn.setAttribute('aria-label', label);
            }
        }

        transport?.classList.toggle('sidebar-media__now-playing--active', !!(state.station || state.playing || state.loading));
    }
};
