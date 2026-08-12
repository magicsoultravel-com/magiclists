/** @module {"owns":"sidebar TV player and channel browser", "related":["tvPlayer.js","tvProviders/registry.js","tvPopover.js","sidebarModules.js"], "events":["tv:state_changed"]} */
import { TvProviderRegistry } from './tvProviders/registry.js';
import { channelKey, parseChannelKey } from './tvProviders/channelShape.js';
import { TvPlayer } from './tvPlayer.js';
import { TvPopover } from './tvPopover.js';
import { TvPip } from './tvPip.js';
import { escapeHtml, countryFlagEmoji, debounce, syncMarquee, bindFaviconImage } from './tvUtils.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import { renderSidebarModuleHeaderHtml } from './sidebarModules.js';
import { showAppToast } from './toast.js';

const BROWSE_PAGE_SIZE = 60;
const BROWSE_SORT_OPTIONS = [{ value: 'name', label: 'Name' }];
const BROWSE_SORT_DIR_OPTIONS = [
    { value: 'asc', label: 'Ascending' },
    { value: 'desc', label: 'Descending' }
];
const COUNTRY_SORT_OPTIONS = [
    { value: 'count', label: 'Most channels' },
    { value: 'name', label: 'Name' }
];

export const SidebarTv = {
    root: null,
    countries: [],
    countryFilter: '',
    browseView: 'countries',
    browseCountry: null,
    browseChannels: [],
    browseOffset: 0,
    browseHasMore: false,
    browseLoading: false,
    browseScrollObserver: null,
    listChannels: [],
    activeTab: 'browse',
    loadSeq: 0,
    highlightUuid: null,
    onStateChanged: null,

    init() {
        this.root = document.getElementById('sidebar-tv');
        if (!this.root) return;

        TvPlayer.init();
        TvPip.init();
        this.renderShell();
        this.bindShellListeners();

        TvPopover.onOpen = () => TvPopover.syncVideoMount();
        TvPopover.onTabChange = (tab) => {
            this.activeTab = tab;
            this.renderPanelContent(tab);
        };

        this.onStateChanged = (e) => {
            this.updateTransport(e.detail);
            TvPopover.syncVideoMount();
            if (!TvPopover.mode || TvPopover.panel?.classList.contains('is-hidden')) return;
            const tab = TvPopover.activeTab;
            if (tab === 'browse' && this.browseView === 'country') {
                this.updatePlayingTiles();
            } else if (tab === 'recents' || tab === 'favorites') {
                this.refreshOpenPanel();
            }
        };
        window.addEventListener('tv:state_changed', this.onStateChanged);
        this.updateTransport();
        this.restoreLastChannelMeta().then(() => {
            this.updateTransport();
            return TvPlayer.resumeIfWasPlaying();
        }).catch(() => {});
        this.prefetchCountries().then(() => this.updateTransport());
    },

    async restoreLastChannelMeta() {
        const channel = TvPlayer.channel;
        const key = channelKey(channel);
        if (!key) return;
        try {
            const full = await TvProviderRegistry.getChannel(parseChannelKey(key));
            if (full) {
                TvPlayer.channel = full;
                TvPlayer.emitState();
            }
        } catch { /* keep fallback */ }
    },

    async prefetchCountries() {
        try {
            this.countries = await TvProviderRegistry.getCountries();
            if (!Array.isArray(this.countries)) this.countries = [];
        } catch {
            this.countries = [];
        }
    },

    resolveCountryName(code) {
        if (!code) return '';
        return this.countries.find((c) => c.iso_3166_1 === code)?.name || code;
    },

    renderShell() {
        const compactHtml = `
                <div class="sidebar-tv__compact">
                    <button type="button" class="sidebar-media__compact-art" data-tv-channel-context title="Show channel in browser" aria-label="Show channel in browser">
                        <img class="sidebar-media__compact-art-img is-hidden" data-tv-compact-art alt="">
                        <span class="sidebar-media__compact-art-fallback" data-tv-compact-art-fallback aria-hidden="true">📺</span>
                    </button>
                    ${!document.getElementById('side-panel')?.classList.contains('is-collapsed') ? `<span class="sidebar-tv__compact-name" data-tv-compact-name></span>` : ``}
                    <button type="button" class="btn btn--compact btn-icon sidebar-media__action" data-tv-play aria-label="Play or pause">
                        <span data-tv-play-icon></span>
                    </button>
                    <input type="range" class="sidebar-media__volume-compact" data-tv-volume-compact min="0" max="100" value="85" aria-label="Volume">
                </div>`;
        this.root.innerHTML = `
            ${renderSidebarModuleHeaderHtml({ headerId: 'tv-section-header', title: 'TV', extrasHtml: compactHtml })}
            <div class="collapsable-section" id="tv-section">
                <div class="sidebar-media__now-playing" data-tv-transport>
                    <button type="button" class="sidebar-media__art" data-tv-channel-context title="Show channel in browser" aria-label="Show channel in browser">
                        <img class="sidebar-media__art-img is-hidden" data-tv-art alt="">
                        <span class="sidebar-media__art-fallback" data-tv-art-fallback aria-hidden="true">📺</span>
                    </button>
                    <div class="sidebar-media__meta">
                        <div class="sidebar-media__title-row">
                            <div class="sidebar-media__marquee" data-tv-marquee>TV</div>
                        </div>
                        <div class="sidebar-media__locale-row">
                            <button type="button" class="sidebar-media__locale is-hidden" data-tv-channel-context title="Show channel in browser" aria-label="Show channel in browser">
                                <span data-tv-flag aria-hidden="true"></span>
                                <span class="sidebar-media__country-name" data-tv-country-name></span>
                            </button>
                            <span class="sidebar-media__load-status is-hidden" data-tv-load-status></span>
                        </div>
                        <div class="sidebar-media__volume-row">
                            <input type="range" class="sidebar-media__volume" data-tv-volume min="0" max="100" value="85" aria-label="Volume">
                        </div>
                    </div>
                </div>
                <div class="sidebar-media__actions">
                    <button type="button" class="btn btn--compact btn-icon sidebar-media__action" data-tv-play aria-label="Play or pause">
                        <span data-tv-play-icon></span>
                    </button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-media__action" data-tv-open="browse" title="Browse channels" aria-label="Browse channels" aria-expanded="false" aria-haspopup="dialog">${ACTION_ICONS.tvBrowse}</button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-media__action is-hidden" data-tv-pip title="Pop out" aria-label="Pop out" aria-pressed="false">${ACTION_ICONS.pictureInPicture}</button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-media__action sidebar-tv__action--heart is-hidden" data-tv-favorite title="Add favorite" aria-label="Add favorite" aria-pressed="false">${CARD_ICONS.heart}</button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-media__action" data-tv-open="special" title="TV settings" aria-label="TV settings" aria-expanded="false" aria-haspopup="dialog">${ACTION_ICONS.radioSpecial}</button>
                </div>
            </div>
        `;
    },

    bindShellListeners() {
        this.root.querySelectorAll('[data-tv-play]').forEach((btn) => {
            btn.addEventListener('click', () => TvPlayer.toggle());
        });
        this.root.querySelector('[data-tv-favorite]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!channelKey(TvPlayer.channel)) return;
            this.tryToggleFavorite(TvPlayer.channel);
        });
        TvPip.registerButton(this.root.querySelector('[data-tv-pip]'));
        this.root.querySelectorAll('[data-tv-channel-context]').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openBrowseForNowPlaying();
            });
        });
        const syncVolume = (value) => {
            TvPlayer.setVolume(value);
            this.root.querySelectorAll('[data-tv-volume], [data-tv-volume-compact]').forEach((el) => {
                el.value = String(Math.round(value * 100));
            });
        };
        this.root.querySelector('[data-tv-volume]')?.addEventListener('input', (e) => syncVolume(Number(e.target.value) / 100));
        this.root.querySelector('[data-tv-volume-compact]')?.addEventListener('input', (e) => syncVolume(Number(e.target.value) / 100));
        const vol = Math.round(TvPlayer.volume * 100);
        this.root.querySelectorAll('[data-tv-volume], [data-tv-volume-compact]').forEach((el) => { el.value = String(vol); });
        this.root.querySelectorAll('[data-tv-open]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openPanel(btn.getAttribute('data-tv-open'), btn);
            });
        });
        bindFaviconImage(this.root.querySelector('[data-tv-art]'), () => {
            this.root.querySelector('[data-tv-art-fallback]')?.classList.remove('is-hidden');
        });
        bindFaviconImage(this.root.querySelector('[data-tv-compact-art]'), () => {
            this.root.querySelector('[data-tv-compact-art-fallback]')?.classList.remove('is-hidden');
        });
    },

    getBrowseAnchor() {
        return this.root.querySelector('[data-tv-open="browse"]');
    },

    openPanel(mode, anchor, { browseContext = null, tab = null } = {}) {
        this.root.querySelectorAll('[data-tv-open]').forEach((btn) => {
            if (btn !== anchor) btn.setAttribute('aria-expanded', 'false');
        });
        const titles = { browse: 'Browse', favorites: 'Favorites', recents: 'Recents', special: 'TV settings' };
        TvPopover.onClose = () => {
            this.root.querySelectorAll('[data-tv-open]').forEach((btn) => btn.setAttribute('aria-expanded', 'false'));
        };
        if (mode === 'special') {
            if (!TvPopover.open('special', { attachEl: this.root, iconAnchor: anchor, title: titles.special, force: !!browseContext })) return;
            this.renderSpecialPanel();
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
        if (!TvPopover.open('browse', {
            attachEl: this.root,
            iconAnchor: browseAnchor,
            title: titles[resolvedTab] || 'TV',
            force: !!browseContext,
            tab: resolvedTab
        })) return;
        this.renderPanelContent(resolvedTab);
    },

    async openBrowseForNowPlaying() {
        const channel = TvPlayer.channel;
        const key = channelKey(channel);
        const browseBtn = this.getBrowseAnchor();
        if (!browseBtn) return;
        if (!key) {
            this.openPanel('browse', browseBtn);
            return;
        }
        const code = channel.countrycode;
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
        if (TvPlayer.isFavorite(channel)) {
            this.openPanel('browse', browseBtn, { tab: 'favorites' });
            return;
        }
        if (TvPlayer.getRecents().includes(key)) {
            this.openPanel('browse', browseBtn, { tab: 'recents' });
            return;
        }
        this.openPanel('browse', browseBtn);
    },

    async refreshOpenPanel() {
        if (TvPopover.mode === 'special') {
            this.renderSpecialPanel();
            return;
        }
        await this.renderPanelContent(TvPopover.activeTab || this.activeTab);
    },

    async renderPanelContent(mode) {
        if (mode === 'browse') {
            if (this.browseView === 'country') await this.renderBrowseCountry();
            else await this.renderBrowseCountries();
            return;
        }
        if (mode === 'favorites' || mode === 'recents') {
            await this.renderChannelGrid(mode);
        } else if (mode === 'special') {
            this.renderSpecialPanel();
        }
    },

    renderSpecialPanel() {
        TvPopover.setTitle('TV settings');
        TvPopover.setBackVisible(false);
        TvPopover.setToolbarHtml('');
        TvPopover.syncVideoMount();

        const settings = TvProviderRegistry.getSettings();
        const providers = TvProviderRegistry.listProviders();
        const body = TvPopover.getBodyEl();
        if (!body) return;

        body.innerHTML = `
            <div class="tv-special-form">
                <p class="tv-special-form__help">Browse free live TV by country. Channels come from the catalog below — <strong>iptv-org</strong> is the built-in world list. Use <strong>Browse</strong> to pick a country, then a channel. Many streams are geo-blocked or offline; try another channel or <strong>Refresh catalog</strong> if lists look empty. If country lists load but channels fail, or lists look empty or wrong, use <strong>Clear cache</strong> then browse again.</p>
                <label class="tv-special-form__row">
                    <span class="tv-special-form__label">Catalog source</span>
                    <select class="form-input tv-special-form__select" data-tv-provider>
                        ${providers.map((p) => `<option value="${escapeHtml(p.id)}"${p.id === settings.catalogProvider ? ' selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}
                    </select>
                </label>
                <label class="tv-special-form__row tv-special-form__row--check">
                    <input type="checkbox" data-tv-hide-offline${settings.hideOfflineChannels !== false ? ' checked' : ''}>
                    <span>Hide offline channels</span>
                </label>
                <label class="tv-special-form__row">
                    <span class="tv-special-form__label">Rewind buffer</span>
                    <input type="range" class="form-input tv-special-form__buffer" data-tv-buffer min="5" max="120" value="15" aria-label="Rewind buffer (seconds)">
                    <span class="tv-special-form__buffer-value" data-tv-buffer-value>15s</span>
                </label>
                <label class="tv-special-form__row">
                    <span class="tv-special-form__label">Buffer ahead</span>
                    <input type="range" class="form-input tv-special-form__buffer" data-tv-live-offset min="1" max="30" value="3" aria-label="Buffer ahead (seconds)">
                    <span class="tv-special-form__buffer-value" data-tv-live-offset-value>3s</span>
                </label>
                <label class="tv-special-form__row">
                    <span class="tv-special-form__label">Quality preference</span>
                    <select class="form-input tv-special-form__select" data-tv-quality>
                        <option value="auto" ${!settings.preferredQuality || settings.preferredQuality === 'auto' ? ' selected' : ''}>Automatic</option>
                        <option value="720p" ${settings.preferredQuality === '720p' ? ' selected' : ''}>720p</option>
                        <option value="480p" ${settings.preferredQuality === '480p' ? ' selected' : ''}>480p</option>
                        <option value="360p" ${settings.preferredQuality === '360p' ? ' selected' : ''}>360p</option>
                        <option value="240p" ${settings.preferredQuality === '240p' ? ' selected' : ''}>240p</option>
                    </select>
                </label>
                <div class="tv-special-form__actions">
                    <button type="button" class="btn btn--compact" data-tv-refresh-catalog>Refresh catalog</button>
                    <button type="button" class="btn btn--compact" data-tv-clear-cache>Clear cache</button>
                </div>
                <p class="tv-special-form__help"><strong>Refresh catalog</strong> re-downloads from iptv-org. <strong>Clear cache</strong> wipes the stored catalog; the next browse fetches fresh.</p>
            </div>
        `;

        body.querySelector('[data-tv-provider]')?.addEventListener('change', async (e) => {
            await TvProviderRegistry.setActiveProvider(e.target.value);
            this.countries = [];
            await this.prefetchCountries();
            if (TvPopover.mode === 'browse' && !TvPopover.panel?.classList.contains('is-hidden')) {
                this.browseView = 'countries';
                this.browseCountry = null;
                await this.renderBrowseCountries();
            }
        });

        body.querySelector('[data-tv-hide-offline]')?.addEventListener('change', (e) => {
            TvProviderRegistry.setHideOffline(e.target.checked);
            if (TvPopover.mode === 'browse' && this.browseView === 'country') {
                this.renderBrowseCountry();
            }
        });

        // Rewind buffer control
        const bufferSliderEl = body.querySelector('[data-tv-buffer]');
        const bufferValueEl = body.querySelector('[data-tv-buffer-value]');
        if (bufferSliderEl && bufferValueEl) {
            const syncBuffer = (val) => {
                bufferValueEl.textContent = `${val}s`;
                TvPlayer.setBufferSize(parseInt(val));
                if (TvPopover.mode === 'special' && TvPopover.panel) {
                    TvPopover.reposition();
                }
            };
            bufferSliderEl.addEventListener('input', (e) => syncBuffer(e.target.value));
            bufferSliderEl.value = TvPlayer.getBufferSize() || 15;
            syncBuffer(bufferSliderEl.value);
        }

        // Buffer ahead (live offset) control
        const liveOffsetSliderEl = body.querySelector('[data-tv-live-offset]');
        const liveOffsetValueEl = body.querySelector('[data-tv-live-offset-value]');
        if (liveOffsetSliderEl && liveOffsetValueEl) {
            const syncLiveOffset = (val) => {
                liveOffsetValueEl.textContent = `${val}s`;
                TvPlayer.setLiveOffset(parseInt(val));
                if (TvPopover.mode === 'special' && TvPopover.panel) {
                    TvPopover.reposition();
                }
            };
            liveOffsetSliderEl.addEventListener('input', (e) => syncLiveOffset(e.target.value));
            liveOffsetSliderEl.value = TvPlayer.getLiveOffset() || 3;
            syncLiveOffset(liveOffsetSliderEl.value);
        }

        // Quality preference control
        const qualitySelectEl = body.querySelector('[data-tv-quality]');
        if (qualitySelectEl) {
            qualitySelectEl.addEventListener('change', (e) => {
                const quality = e.target.value;
                if (quality !== 'auto') {
                    // For specific quality, we'd need to set a preference that the player respects
                    // For now, just update UI
                }
            });
            qualitySelectEl.value = 'auto'; // Default to auto
        }

        body.querySelector('[data-tv-refresh-catalog]')?.addEventListener('click', async () => {
            const btn = body.querySelector('[data-tv-refresh-catalog]');
            const originalText = btn?.textContent;
            if (btn) {
                btn.textContent = 'Refreshing…';
                btn.disabled = true;
            }
            try {
                await TvProviderRegistry.refreshCatalog();
                this.countries = await TvProviderRegistry.getCountries({ refresh: true });
                if (TvPopover.mode === 'browse') {
                    this.browseView = 'countries';
                    this.browseCountry = null;
                    await this.renderBrowseCountries();
                }
                showAppToast('Catalog refreshed');
            } catch (e) {
                showAppToast('Failed to refresh catalog');
            } finally {
                if (btn) {
                    btn.textContent = originalText || 'Refresh catalog';
                    btn.disabled = false;
                }
            }
        });

        body.querySelector('[data-tv-clear-cache]')?.addEventListener('click', async () => {
            await TvProviderRegistry.clearAllCaches();
            this.countries = [];
            try {
                await this.prefetchCountries();
                if (TvPopover.mode === 'browse' && !TvPopover.panel?.classList.contains('is-hidden')) {
                    this.browseView = 'countries';
                    this.browseCountry = null;
                    await this.renderBrowseCountries();
                }
                showAppToast('TV catalog cache cleared');
            } catch {
                showAppToast('Cache cleared — reopen Browse to reload');
            }
        });

        TvPopover.reposition();
    },

    renderSortSelect(options, current, attrName, label) {
        return `<select class="form-input sidebar-media__sort" ${attrName} aria-label="${escapeHtml(label)}">
            ${options.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === current ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
        </select>`;
    },

    renderBrowseCountriesToolbar() {
        return `<div class="sidebar-media-popover__toolbar-row">
            <input type="search" class="form-input sidebar-media__search" data-tv-country-search placeholder="Filter countries…" aria-label="Filter countries" autocomplete="off" spellcheck="false" value="${escapeHtml(this.countryFilter)}">
            ${this.renderSortSelect(COUNTRY_SORT_OPTIONS, TvPlayer.getCountrySort(), 'data-tv-country-sort', 'Sort countries')}
        </div>`;
    },

    sortCountries(countries) {
        const sort = TvPlayer.getCountrySort();
        const list = countries.slice();
        if (sort === 'name') list.sort((a, b) => (a.name || a.iso_3166_1 || '').localeCompare(b.name || b.iso_3166_1 || ''));
        else list.sort((a, b) => (b.stationcount || 0) - (a.stationcount || 0));
        return list;
    },

    renderCountryList(c) {
        const code = c.iso_3166_1 || '';
        const count = c.stationcount ? `${c.stationcount} stations` : '';
        return `<button type="button" class="sidebar-media-list-item sidebar-media-list-item--country" data-tv-country="${escapeHtml(code)}" data-tv-country-name="${escapeHtml(c.name || code)}" title="${escapeHtml(c.name || code)}">
            <span class="sidebar-media-list-item__flag" aria-hidden="true">${countryFlagEmoji(code)}</span>
            <span class="sidebar-media-list-item__name">${escapeHtml(c.name || code)}</span>
            ${count ? `<span class="sidebar-media-list-item__meta">${escapeHtml(count)}</span>` : ''}
        </button>`;
    },

    async renderBrowseCountries() {
        TvPopover.setTitle('Browse');
        TvPopover.setBackVisible(false);
        TvPopover.setToolbarHtml(this.renderBrowseCountriesToolbar());
        const body = TvPopover.getBodyEl();
        if (!body) return;
        body.innerHTML = '<p class="tool-msg">Loading…</p>';
        if (!this.countries.length) await this.prefetchCountries();
        const toolbar = TvPopover.getToolbarEl();
        toolbar?.querySelector('[data-tv-country-search]')?.addEventListener('input', debounce((e) => {
            this.countryFilter = e.target.value.trim().toLowerCase();
            this.renderBrowseCountries();
        }, 200));
        toolbar?.querySelector('[data-tv-country-sort]')?.addEventListener('change', (e) => {
            TvPlayer.saveCountrySort(e.target.value);
            this.renderBrowseCountries();
        });
        const filtered = this.sortCountries(this.countries).filter((c) => {
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
        body.querySelectorAll('[data-tv-country]').forEach((tile) => {
            tile.addEventListener('click', () => {
                this.openBrowseCountry(tile.getAttribute('data-tv-country'), tile.getAttribute('data-tv-country-name') || tile.getAttribute('data-tv-country'));
            });
        });
        TvPopover.reposition();
    },

    async openBrowseCountry(code, name) {
        this.browseView = 'country';
        this.browseCountry = { code, name };
        this.browseOffset = 0;
        this.disconnectBrowseScroll();
        await this.renderBrowseCountry();
    },

    renderBrowseSortToolbar() {
        return `<div class="sidebar-media-popover__toolbar-row sidebar-media-popover__toolbar-row--end">
            ${this.renderSortSelect(BROWSE_SORT_OPTIONS, TvPlayer.getBrowseSort(), 'data-tv-sort', 'Sort channels')}
            ${this.renderSortSelect(BROWSE_SORT_DIR_OPTIONS, TvPlayer.getBrowseSortDir(), 'data-tv-sort-dir', 'Sort direction')}
        </div>`;
    },

    renderRecentsToolbar() {
        return `<div class="sidebar-media-popover__toolbar-row sidebar-media-popover__toolbar-row--end">
            <button type="button" class="btn btn--compact btn-icon card-act sidebar-media__clear-recents" data-tv-clear-recents title="Clear recents" aria-label="Clear recents">${CARD_ICONS.delete}</button>
        </div>`;
    },

    disconnectBrowseScroll() {
        if (this.browseScrollObserver) {
            this.browseScrollObserver.disconnect();
            this.browseScrollObserver = null;
        }
    },

    setupBrowseScroll(body) {
        this.disconnectBrowseScroll();
        const sentinel = body?.querySelector('[data-tv-scroll-sentinel]');
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
        const body = TvPopover.getBodyEl();
        const sentinel = body?.querySelector('[data-tv-scroll-sentinel]');
        if (!sentinel || !body) return;
        const sRect = sentinel.getBoundingClientRect();
        const rRect = body.getBoundingClientRect();
        if (sRect.top > rRect.bottom + 120) return;
        this.browseOffset += BROWSE_PAGE_SIZE;
        this.renderBrowseCountry(true);
    },

    async renderBrowseCountry(append = false) {
        const { code, name } = this.browseCountry || {};
        TvPopover.setTitle(name || 'Channels');
        TvPopover.setBackVisible(true, () => {
            this.disconnectBrowseScroll();
            this.browseView = 'countries';
            this.browseCountry = null;
            this.browseOffset = 0;
            this.browseChannels = [];
            this.renderBrowseCountries();
        });

        // Only rebuild toolbar on full refresh — append must not wipe sort listeners
        if (!append) {
            TvPopover.setToolbarHtml(this.renderBrowseSortToolbar());
            this.bindBrowseCountryControls();
        }

        const body = TvPopover.getBodyEl();
        if (!body) return;
        if (!append) {
            body.innerHTML = '<p class="tool-msg">Loading…</p>';
        } else {
            const sentinel = body.querySelector('[data-tv-scroll-sentinel]');
            if (sentinel) sentinel.textContent = 'Loading…';
        }
        const sort = TvPlayer.getBrowseSort();
        const sortDir = TvPlayer.getBrowseSortDir();
        const seq = ++this.loadSeq;
        this.browseLoading = true;
        try {
            const data = await TvProviderRegistry.searchChannels({
                countrycode: code,
                limit: BROWSE_PAGE_SIZE,
                offset: this.browseOffset,
                order: sort,
                reverse: sortDir === 'desc',
                hideOffline: TvProviderRegistry.getHideOffline()
            });
            if (seq !== this.loadSeq) return;
            const page = Array.isArray(data) ? data : [];
            this.browseHasMore = page.length >= BROWSE_PAGE_SIZE;
            this.browseChannels = append ? [...this.browseChannels, ...page] : page;
            if (!this.browseChannels.length) {
                this.disconnectBrowseScroll();
                body.innerHTML = '<p class="tool-msg">No channels in this country.</p>';
            } else if (append) {
                const list = body.querySelector('.sidebar-media-list');
                const sentinel = body.querySelector('[data-tv-scroll-sentinel]');
                if (list && page.length) {
                    list.insertAdjacentHTML(
                        'beforeend',
                        page.map((ch) => this.renderChannelTile(ch)).join('')
                    );
                    this.bindChannelTileActions(list);
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
                body.innerHTML = `<div class="sidebar-media-list" data-tv-channel-grid>
                    ${this.browseChannels.map((ch) => this.renderChannelTile(ch)).join('')}
                </div>
                ${this.browseHasMore ? '<div class="sidebar-media-scroll-sentinel" data-tv-scroll-sentinel aria-hidden="true"></div>' : ''}`;
                this.bindChannelTileActions(body);
                this.setupBrowseScroll(body);
                this.scrollToHighlightedChannel(body);
            }
        } catch {
            if (seq !== this.loadSeq) return;
            if (!append) {
                body.innerHTML = '<p class="tool-msg tool-msg--error">Could not load channels.</p>';
            } else {
                const sentinel = body.querySelector('[data-tv-scroll-sentinel]');
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
        TvPopover.reposition();
    },

    bindBrowseCountryControls() {
        const toolbar = TvPopover.getToolbarEl();
        if (!toolbar) return;

        toolbar.querySelector('[data-tv-sort]')?.addEventListener('change', (e) => {
            TvPlayer.saveBrowseSort(e.target.value);
            this.browseOffset = 0;
            this.browseChannels = [];
            this.disconnectBrowseScroll();
            this.renderBrowseCountry(false);
        });
        toolbar.querySelector('[data-tv-sort-dir]')?.addEventListener('change', (e) => {
            TvPlayer.saveBrowseSortDir(e.target.value);
            this.browseOffset = 0;
            this.browseChannels = [];
            this.disconnectBrowseScroll();
            this.renderBrowseCountry(false);
        });
    },

    scrollToHighlightedChannel(body) {
        const uuid = this.highlightUuid;
        if (!uuid) return;
        requestAnimationFrame(() => {
            body.querySelector(`[data-tv-channel="${CSS.escape(uuid)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            this.highlightUuid = null;
        });
    },

    channelFromMeta(meta) {
        if (!meta?.key) return null;
        const parsed = parseChannelKey(meta.key);
        return {
            providerId: parsed.providerId,
            channelId: parsed.channelId,
            channeluuid: meta.key,
            name: meta.name || 'Unknown',
            logo: meta.logo || '',
            countrycode: meta.countrycode || ''
        };
    },

    async renderChannelGrid(kind) {
        TvPopover.setBackVisible(false);
        TvPopover.setTitle(kind === 'favorites' ? 'Favorites' : 'Recents');
        const keys = kind === 'favorites' ? TvPlayer.getFavorites() : TvPlayer.getRecents();
        if (kind === 'recents' && keys.length) {
            TvPopover.setToolbarHtml(this.renderRecentsToolbar());
            TvPopover.getToolbarEl()?.querySelector('[data-tv-clear-recents]')?.addEventListener('click', () => {
                if (!window.confirm('Clear all recent channels?')) return;
                TvPlayer.clearRecents();
                this.renderChannelGrid('recents');
            });
        } else {
            TvPopover.setToolbarHtml('');
        }
        const body = TvPopover.getBodyEl();
        if (!body) return;
        body.innerHTML = '<p class="tool-msg">Loading…</p>';
        if (!keys.length) {
            body.innerHTML = `<p class="tool-msg">${kind === 'favorites' ? 'Heart channels while watching.' : 'Played channels appear here after a successful connection.'}</p>`;
            return;
        }
        const metaList = kind === 'recents' ? TvPlayer.getRecentsMeta() : keys.map((key) => ({ key, name: '', logo: '', countrycode: '' }));
        const fallback = metaList.map((m) => this.channelFromMeta(m)).filter(Boolean);
        const seq = ++this.loadSeq;
        try {
            const data = await TvProviderRegistry.getChannelsByRefs(keys);
            if (seq !== this.loadSeq) return;
            const byKey = new Map(data.map((ch) => [channelKey(ch), ch]));
            this.listChannels = metaList.map((meta) => byKey.get(meta.key) || this.channelFromMeta(meta)).filter(Boolean);
            if (!this.listChannels.length) body.innerHTML = '<p class="tool-msg tool-msg--error">Channels unavailable.</p>';
            else {
                body.innerHTML = `<div class="sidebar-media-list">${this.listChannels.map((ch) => this.renderChannelTile(ch)).join('')}</div>`;
                this.bindChannelTileActions(body);
            }
        } catch {
            if (seq !== this.loadSeq) return;
            this.listChannels = fallback;
            body.innerHTML = this.listChannels.length
                ? `<div class="sidebar-media-list">${this.listChannels.map((ch) => this.renderChannelTile(ch)).join('')}</div>`
                : '<p class="tool-msg tool-msg--error">Could not load list.</p>';
            if (this.listChannels.length) this.bindChannelTileActions(body);
        }
        TvPopover.reposition();
    },

    renderChannelTile(channel) {
        // Use compact list view instead of tiles
        return this.renderChannelListItem(channel);
    },

    renderChannelListItem(channel) {
        const uuid = channelKey(channel);
        const fav = TvPlayer.isFavorite(channel);
        const playing = channelKey(TvPlayer.channel) === uuid && (TvPlayer.playing || TvPlayer.loading);
        const offline = channel.lastcheckok === 0;
        const logoHtml = channel.logo
            ? `<img class="sidebar-media-list-item__logo" src="${escapeHtml(channel.logo)}" alt="" width="20" height="20" loading="lazy" decoding="async">`
            : '<span class="sidebar-media-list-item__logo sidebar-media-list-item__logo--fallback" aria-hidden="true">📺</span>';
        const flag = channel.countrycode ? `<span class="sidebar-media-list-item__flag">${countryFlagEmoji(channel.countrycode)}</span>` : '';
        const starIcon = fav ? CARD_ICONS.starFilled : CARD_ICONS.star;
        return `<div class="sidebar-media-list-item sidebar-media-list-item--channel${playing ? ' is-on-desktop' : ''}" data-tv-channel="${escapeHtml(uuid)}" role="button" tabindex="0" title="${escapeHtml(channel.name || '')}">
            ${logoHtml}
            <span class="sidebar-media-list-item__name">${escapeHtml(channel.name || 'Unknown')}</span>
            ${flag}
            ${offline ? '<span class="sidebar-media-list-item__offline">off</span>' : ''}
            <button type="button" class="sidebar-media-list-item__star${fav ? ' is-active' : ''}" data-tv-star="${escapeHtml(uuid)}" title="${fav ? 'Remove favorite' : 'Add favorite'}" aria-label="${fav ? 'Remove favorite' : 'Add favorite'}" aria-pressed="${fav ? 'true' : 'false'}">${starIcon}</button>
        </div>`;
    },

    bindChannelTileActions(container) {
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
        container.querySelectorAll('[data-tv-star]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const uuid = btn.getAttribute('data-tv-star');
                this.tryToggleFavorite(this.findChannel(uuid) || parseChannelKey(uuid));
            });
        });
        container.querySelectorAll('[data-tv-channel]').forEach((tile) => {
            const activate = () => {
                const uuid = tile.getAttribute('data-tv-channel');
                const ch = this.findChannel(uuid);
                if (ch) TvPlayer.playChannel(ch);
                else if (uuid) TvPlayer.playChannel(uuid);
            };
            tile.addEventListener('click', (e) => {
                if (e.target.closest('[data-tv-star]')) return;
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

    findChannel(uuid) {
        return this.browseChannels.find((ch) => channelKey(ch) === uuid)
            || this.listChannels.find((ch) => channelKey(ch) === uuid)
            || (channelKey(TvPlayer.channel) === uuid ? TvPlayer.channel : null);
    },

    tryToggleFavorite(channelOrKey) {
        const key = typeof channelOrKey === 'object' && channelOrKey !== null
            ? channelKey(channelOrKey)
            : (typeof channelOrKey === 'string' ? channelOrKey : '');
        if (!key) return false;
        if (TvPlayer.isFavorite(key)) {
            const ch = typeof channelOrKey === 'object' ? channelOrKey : this.findChannel(key);
            const name = ch?.name || '';
            if (!window.confirm(name ? `Remove "${name}" from favorites?` : 'Remove from favorites?')) return false;
        }
        const isFav = TvPlayer.toggleFavorite(
            typeof channelOrKey === 'object' ? channelOrKey : parseChannelKey(key)
        );
        this.updateFavoriteStars(key, isFav);
        this.updateTransport();
        return true;
    },

    updateFavoriteStars(key, isFav) {
        if (!key) return;
        const body = TvPopover.getBodyEl();
        if (!body || TvPopover.panel?.classList.contains('is-hidden')) return;

        const starIcon = isFav ? CARD_ICONS.starFilled : CARD_ICONS.star;
        const label = isFav ? 'Remove favorite' : 'Add favorite';
        body.querySelectorAll(`[data-tv-star="${CSS.escape(key)}"]`).forEach((btn) => {
            btn.classList.toggle('is-active', isFav);
            btn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
            btn.setAttribute('aria-label', label);
            btn.title = label;
            btn.innerHTML = starIcon;
        });

        if (!isFav && TvPopover.activeTab === 'favorites') {
            body.querySelector(`[data-tv-channel="${CSS.escape(key)}"]`)?.remove();
            if (!body.querySelector('[data-tv-channel]')) {
                body.innerHTML = '<p class="tool-msg">Heart channels while watching.</p>';
                TvPopover.setToolbarHtml('');
            }
        }
    },

    updatePlayingTiles() {
        const body = TvPopover.getBodyEl();
        if (!body) return;
        const currentKey = channelKey(TvPlayer.channel);
        const active = TvPlayer.playing || TvPlayer.loading;
        body.querySelectorAll('[data-tv-channel]').forEach((tile) => {
            tile.classList.toggle('is-on-desktop', tile.getAttribute('data-tv-channel') === currentKey && active);
        });
    },

    getPlayIconHtml(state) {
        // Priority: playing > loading/connecting/buffering > idle
        if (state.playing) return ACTION_ICONS.radioPause;
        if (state.loading || state.loadPhase === 'connecting' || state.loadPhase === 'buffering') {
            return ACTION_ICONS.radioLoading;
        }
        return ACTION_ICONS.radioPlay;
    },

    // Determine if the avatar/art area should show loading state
    // The spinner should only show when actively loading/connecting/buffering, not when paused or idle
    getArtLoadingClass(state) {
        const isLoading = state.loading || state.loadPhase === 'connecting' || state.loadPhase === 'buffering';
        // When playing, we should NOT show the loading spinner on the avatar
        // The spinner is only for actual loading states
        return isLoading && !state.playing;
    },

    updateTransport(detail = null) {
        const state = detail || {
            channel: TvPlayer.channel,
            playing: TvPlayer.playing,
            loading: TvPlayer.loading,
            loadPhase: TvPlayer.loadPhase,
            error: TvPlayer.error,
            resumeBlocked: TvPlayer.resumeBlocked,
            volume: TvPlayer.volume,
            bufferSize: TvPlayer.getBufferSize(),
            connection: TvPlayer.connection,
            qualityLabel: TvPlayer.qualityLabel,
            bufferInfo: TvPlayer.getBufferInfo()
        };
        const marqueeEl = this.root?.querySelector('[data-tv-marquee]');
        const artImg = this.root?.querySelector('[data-tv-art]');
        const artFallback = this.root?.querySelector('[data-tv-art-fallback]');
        const compactArtImg = this.root?.querySelector('[data-tv-compact-art]');
        const compactArtFallback = this.root?.querySelector('[data-tv-compact-art-fallback]');
        const flagEl = this.root?.querySelector('[data-tv-flag]');
        const countryNameEl = this.root?.querySelector('[data-tv-country-name]');
        const localeBtn = this.root?.querySelector('.sidebar-media__locale');
        const loadStatusEl = this.root?.querySelector('[data-tv-load-status]');
        const volumeEls = this.root?.querySelectorAll('[data-tv-volume], [data-tv-volume-compact]');
        const favBtn = this.root?.querySelector('[data-tv-favorite]');
        const transport = this.root?.querySelector('[data-tv-transport]');
        const artBtn = this.root?.querySelector('.sidebar-media__art');

        let titleText = 'TV';
        let isError = false;
        if (state.resumeBlocked) titleText = 'Tap play to resume';
        else if (state.error) { titleText = state.error; isError = true; }
        else if (state.channel?.name) titleText = state.channel.name;

        if (marqueeEl) syncMarquee(marqueeEl, titleText, { error: isError || !!state.resumeBlocked });

        const compactNameEl = this.root?.querySelector('[data-tv-compact-name]');
        if (compactNameEl) {
            if (state.channel?.name && !state.resumeBlocked && !state.error) {
                compactNameEl.textContent = state.channel.name;
                compactNameEl.classList.remove('is-hidden');
            } else {
                compactNameEl.classList.add('is-hidden');
            }
        }

        const code = state.channel?.countrycode;
        if (localeBtn && flagEl && countryNameEl) {
            if (code && state.channel && !state.resumeBlocked) {
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

        const updateArt = (img, fallback) => {
            if (!img || !fallback) return;
            const logo = state.channel?.logo;
            if (logo) {
                fallback.classList.add('is-hidden');
                if (img.getAttribute('src') !== logo) {
                    img.classList.add('is-hidden');
                    img.src = logo;
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
        artBtn?.classList.toggle('sidebar-media__art--loading', this.getArtLoadingClass(state));
        this.root?.querySelector('.sidebar-media__compact-art')?.classList.toggle('sidebar-media__art--loading', this.getArtLoadingClass(state));

        const playIconHtml = this.getPlayIconHtml(state);
        this.root?.querySelectorAll('[data-tv-play-icon]').forEach((el) => { el.innerHTML = playIconHtml; });

        if (volumeEls.length && Number.isFinite(state.volume)) {
            const vol = String(Math.round(state.volume * 100));
            volumeEls.forEach((el) => { el.value = vol; });
        }

        if (favBtn) {
            const key = channelKey(state.channel);
            if (!key) favBtn.classList.add('is-hidden');
            else {
                const fav = TvPlayer.isFavorite(state.channel);
                favBtn.classList.remove('is-hidden');
                favBtn.classList.toggle('is-active', fav);
                favBtn.innerHTML = fav ? CARD_ICONS.heartFilled : CARD_ICONS.heart;
                favBtn.setAttribute('aria-pressed', fav ? 'true' : 'false');
                const label = fav ? 'Remove favorite' : 'Add favorite';
                favBtn.setAttribute('title', label);
                favBtn.setAttribute('aria-label', label);
            }
        }

        const pipBtn = this.root?.querySelector('[data-tv-pip]');
        if (pipBtn) {
            pipBtn.classList.toggle('is-hidden', !TvPip.supported() || !channelKey(state.channel));
        }

        transport?.classList.toggle('sidebar-media__now-playing--active', !!(state.channel || state.playing || state.loading));
    }
};
