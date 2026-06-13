import { TvProviderRegistry } from './tvProviders/registry.js';
import { channelKey, parseChannelKey } from './tvProviders/channelShape.js';
import { TvPlayer } from './tvPlayer.js';
import { TvPopover } from './tvPopover.js';
import { clampPanelToViewport } from './popoverPosition.js';
import { escapeHtml, countryFlagEmoji, debounce, syncMarquee, bindFaviconImage } from './tvUtils.js';
import { ACTION_ICONS, CARD_ICONS } from './ui.js';
import { applySectionCollapse } from './hamburger.js';
import { showAppToast } from './toast.js';

const BROWSE_PAGE_SIZE = 60;
const BROWSE_SORT_OPTIONS = [{ value: 'name', label: 'Name' }];
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
    listChannels: [],
    activeTab: 'browse',
    loadSeq: 0,
    highlightUuid: null,
    onStateChanged: null,

    init() {
        this.root = document.getElementById('sidebar-tv');
        if (!this.root) return;

        TvPlayer.init();
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
        this.bindDockButton();
        this.bindMiniPlayerDrag();
        this.applyInitialDockState();
        this.bindViewportClamp();
    },

    isUndocked() {
        return this.root?.classList.contains('sidebar-tv--undocked');
    },

    bindViewportClamp() {
        window.addEventListener('resize', () => {
            if (!this.isUndocked()) return;
            const x = parseFloat(this.root.style.left) || 0;
            const y = parseFloat(this.root.style.top) || 0;
            const clamped = clampPanelToViewport(this.root, x, y);
            this.root.style.left = `${clamped.x}px`;
            this.root.style.top = `${clamped.y}px`;
            TvPopover.reposition();
        });
    },

    applyInitialDockState() {
        const { miniPlayerDocked, miniPlayerX, miniPlayerY } = TvPlayer.getMiniPlayerState();
        if (miniPlayerDocked !== false) {
            this.updateDockButton();
            return;
        }
        this.ensureUndockedInBody();
        this.root.classList.add('sidebar-tv--undocked');
        if (miniPlayerX != null && miniPlayerY != null) {
            this.root.style.left = `${miniPlayerX}px`;
            this.root.style.top = `${miniPlayerY}px`;
            requestAnimationFrame(() => {
                const clamped = clampPanelToViewport(this.root, miniPlayerX, miniPlayerY);
                this.root.style.left = `${clamped.x}px`;
                this.root.style.top = `${clamped.y}px`;
            });
        } else {
            this.applyUndockedState(false);
        }
        this.updateDockButton();
    },

    ensureUndockedInBody() {
        if (this.root.parentElement !== document.body) {
            document.body.appendChild(this.root);
        }
    },

    restoreToSidebar() {
        if (this.root.parentElement !== document.body) return;
        const scroll = document.querySelector('.side-panel-scroll');
        if (!scroll) return;
        const radio = document.getElementById('sidebar-radio');
        if (radio && radio.parentElement === scroll) {
            radio.insertAdjacentElement('afterend', this.root);
            return;
        }
        const quickActions = document.getElementById('sidebar-quick-actions');
        if (quickActions && quickActions.parentElement === scroll) {
            quickActions.insertAdjacentElement('afterend', this.root);
            return;
        }
        const first = scroll.firstElementChild;
        if (first) first.insertAdjacentElement('afterend', this.root);
        else scroll.appendChild(this.root);
    },

    updateDockButton() {
        const btn = this.root?.querySelector('[data-tv-dock]');
        if (!btn) return;
        const undocked = this.isUndocked();
        btn.innerHTML = undocked ? CARD_ICONS.pin : CARD_ICONS.unpin;
        const label = undocked ? 'Dock in sidebar' : 'Undock to canvas';
        btn.setAttribute('title', label);
        btn.setAttribute('aria-label', label);
    },

    bindDockButton() {
        this.root.querySelector('[data-tv-dock]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMiniPlayerDock();
        });
    },

    toggleMiniPlayerDock() {
        if (this.isUndocked()) this.applyDockedState();
        else this.applyUndockedState();
        this.updateDockButton();
        TvPopover.reposition();
    },

    applyDockedState() {
        this.root.classList.remove('sidebar-tv--undocked', 'sidebar-tv--dragging');
        this.root.style.left = '';
        this.root.style.top = '';
        this.restoreToSidebar();
        TvPlayer.saveMiniPlayerState({ miniPlayerDocked: true, miniPlayerX: null, miniPlayerY: null });
    },

    applyUndockedState(persist = true) {
        const rect = this.root.getBoundingClientRect();
        const saved = TvPlayer.getMiniPlayerState();
        let x = saved.miniPlayerX ?? rect.left;
        let y = saved.miniPlayerY ?? rect.top;
        this.ensureUndockedInBody();
        this.root.classList.add('sidebar-tv--undocked');
        this.root.style.left = `${x}px`;
        this.root.style.top = `${y}px`;
        const clamped = clampPanelToViewport(this.root, x, y);
        this.root.style.left = `${clamped.x}px`;
        this.root.style.top = `${clamped.y}px`;
        if (persist) {
            TvPlayer.saveMiniPlayerState({
                miniPlayerDocked: false,
                miniPlayerX: clamped.x,
                miniPlayerY: clamped.y
            });
        }
    },

    bindMiniPlayerDrag() {
        const header = document.getElementById('tv-section-header');
        if (!header) return;
        header.addEventListener('pointerdown', (e) => {
            if (!this.isUndocked()) return;
            if (e.target.closest('[data-tv-dock]') || e.target.closest('.collapsable-toggle')) return;
            if (e.target.closest('.sidebar-tv__compact')) return;
            if (e.button !== 0) return;
            e.preventDefault();
            let dragging = true;
            let didDrag = false;
            const startX = e.clientX;
            const startY = e.clientY;
            const startLeft = parseFloat(this.root.style.left) || 0;
            const startTop = parseFloat(this.root.style.top) || 0;
            this.root.classList.add('sidebar-tv--dragging');
            header.setPointerCapture(e.pointerId);
            const onMove = (ev) => {
                if (!dragging) return;
                if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) didDrag = true;
                const clamped = clampPanelToViewport(this.root, startLeft + (ev.clientX - startX), startTop + (ev.clientY - startY));
                this.root.style.left = `${clamped.x}px`;
                this.root.style.top = `${clamped.y}px`;
                TvPopover.reposition();
            };
            const onUp = (ev) => {
                if (!dragging) return;
                dragging = false;
                this.root.classList.remove('sidebar-tv--dragging');
                header.releasePointerCapture(ev.pointerId);
                if (didDrag) {
                    header.dataset.suppressClick = 'true';
                    requestAnimationFrame(() => { delete header.dataset.suppressClick; });
                }
                TvPlayer.saveMiniPlayerState({
                    miniPlayerX: parseFloat(this.root.style.left) || 0,
                    miniPlayerY: parseFloat(this.root.style.top) || 0
                });
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        });
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
        this.root.innerHTML = `
            <div class="collapsable-header list-row--header" id="tv-section-header">
                <span class="collapsable-heading"><span class="collapsable-toggle">▼</span>TV</span>
                <div class="sidebar-tv__compact">
                    <button type="button" class="sidebar-tv__compact-art" data-tv-channel-context title="Show channel in browser" aria-label="Show channel in browser">
                        <img class="sidebar-tv__compact-art-img is-hidden" data-tv-compact-art alt="">
                        <span class="sidebar-tv__compact-art-fallback" data-tv-compact-art-fallback aria-hidden="true">📺</span>
                    </button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-tv__action" data-tv-play aria-label="Play or pause">
                        <span data-tv-play-icon></span>
                    </button>
                    <input type="range" class="sidebar-tv__volume-compact" data-tv-volume-compact min="0" max="100" value="85" aria-label="Volume">
                </div>
                <button type="button" class="card-act sidebar-tv__dock" data-tv-dock title="Undock to canvas" aria-label="Undock to canvas">${CARD_ICONS.unpin}</button>
            </div>
            <div class="collapsable-section" id="tv-section">
                <div class="sidebar-tv__now-playing" data-tv-transport>
                    <button type="button" class="sidebar-tv__art" data-tv-channel-context title="Show channel in browser" aria-label="Show channel in browser">
                        <img class="sidebar-tv__art-img is-hidden" data-tv-art alt="">
                        <span class="sidebar-tv__art-fallback" data-tv-art-fallback aria-hidden="true">📺</span>
                    </button>
                    <div class="sidebar-tv__meta">
                        <div class="sidebar-tv__title-row">
                            <div class="sidebar-tv__marquee" data-tv-marquee>TV</div>
                        </div>
                        <div class="sidebar-tv__locale-row">
                            <button type="button" class="sidebar-tv__locale is-hidden" data-tv-channel-context title="Show channel in browser" aria-label="Show channel in browser">
                                <span data-tv-flag aria-hidden="true"></span>
                                <span class="sidebar-tv__country-name" data-tv-country-name></span>
                            </button>
                            <span class="sidebar-tv__load-status is-hidden" data-tv-load-status></span>
                        </div>
                        <div class="sidebar-tv__volume-row">
                            <input type="range" class="sidebar-tv__volume" data-tv-volume min="0" max="100" value="85" aria-label="Volume">
                        </div>
                    </div>
                </div>
                <div class="sidebar-tv__actions">
                    <button type="button" class="btn btn--compact btn-icon sidebar-tv__action" data-tv-play aria-label="Play or pause">
                        <span data-tv-play-icon></span>
                    </button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-tv__action" data-tv-open="browse" title="Browse channels" aria-label="Browse channels" aria-expanded="false" aria-haspopup="dialog">${ACTION_ICONS.tvBrowse}</button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-tv__action sidebar-tv__action--heart is-hidden" data-tv-favorite title="Add favorite" aria-label="Add favorite" aria-pressed="false">${CARD_ICONS.heart}</button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-tv__action" data-tv-open="special" title="TV settings" aria-label="TV settings" aria-expanded="false" aria-haspopup="dialog">${ACTION_ICONS.radioSpecial}</button>
                </div>
            </div>
        `;
        applySectionCollapse('tv-section', 'tv-section-header', true);
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
            this.root.querySelector('[data-tv-art-fallback]')?.classList.add('is-hidden');
        });
        bindFaviconImage(this.root.querySelector('[data-tv-compact-art]'), () => {
            this.root.querySelector('[data-tv-compact-art-fallback]')?.classList.add('is-hidden');
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
                <div class="tv-special-form__actions">
                    <button type="button" class="btn btn--compact" data-tv-refresh-catalog>Refresh catalog</button>
                    <button type="button" class="btn btn--compact" data-tv-clear-cache>Clear cache</button>
                </div>
                <p class="tv-special-form__help"><strong>Refresh catalog</strong> re-downloads from iptv-org. <strong>Clear cache</strong> wipes the stored catalog; the next browse fetches fresh.</p>
            </div>
        `;

        body.querySelector('[data-tv-provider]')?.addEventListener('change', async (e) => {
            TvProviderRegistry.setActiveProvider(e.target.value);
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

        body.querySelector('[data-tv-refresh-catalog]')?.addEventListener('click', async () => {
            await TvProviderRegistry.refreshCatalog();
            this.countries = await TvProviderRegistry.getCountries({ refresh: true });
            if (TvPopover.mode === 'browse') {
                this.browseView = 'countries';
                this.browseCountry = null;
                await this.renderBrowseCountries();
            }
        });

        body.querySelector('[data-tv-clear-cache]')?.addEventListener('click', async () => {
            TvProviderRegistry.clearAllCaches();
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
        return `<select class="form-input sidebar-tv__sort" ${attrName} aria-label="${escapeHtml(label)}">
            ${options.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === current ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
        </select>`;
    },

    renderBrowseCountriesToolbar() {
        return `<div class="tv-popover__toolbar-row">
            <input type="search" class="form-input sidebar-tv__search" data-tv-country-search placeholder="Filter countries…" aria-label="Filter countries" autocomplete="off" spellcheck="false" value="${escapeHtml(this.countryFilter)}">
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

    renderCountryTile(c) {
        const code = c.iso_3166_1 || '';
        const count = c.stationcount ? `${c.stationcount}` : '';
        return `<button type="button" class="tv-tile tv-tile--country" data-tv-country="${escapeHtml(code)}" data-tv-country-name="${escapeHtml(c.name || code)}" title="${escapeHtml(c.name || code)}">
            <span class="tv-tile__flag" aria-hidden="true">${countryFlagEmoji(code)}</span>
            <span class="tv-tile__label u-truncate">${escapeHtml(c.name || code)}</span>
            ${count ? `<span class="tv-tile__meta">${escapeHtml(count)}</span>` : ''}
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
        body.innerHTML = `<div class="tv-tile-grid" data-tv-country-grid>${filtered.map((c) => this.renderCountryTile(c)).join('')}</div>`;
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
        await this.renderBrowseCountry();
    },

    renderBrowseSortToolbar() {
        return `<div class="tv-popover__toolbar-row tv-popover__toolbar-row--end">
            ${this.renderSortSelect(BROWSE_SORT_OPTIONS, TvPlayer.getBrowseSort(), 'data-tv-sort', 'Sort channels')}
        </div>`;
    },

    renderRecentsToolbar() {
        return `<div class="tv-popover__toolbar-row tv-popover__toolbar-row--end">
            <button type="button" class="btn btn--compact btn-icon card-act sidebar-tv__clear-recents" data-tv-clear-recents title="Clear recents" aria-label="Clear recents">${CARD_ICONS.delete}</button>
        </div>`;
    },

    async renderBrowseCountry(append = false) {
        const { code, name } = this.browseCountry || {};
        TvPopover.setTitle(name || 'Channels');
        TvPopover.setBackVisible(true, () => {
            this.browseView = 'countries';
            this.browseCountry = null;
            this.browseOffset = 0;
            this.browseChannels = [];
            this.renderBrowseCountries();
        });
        TvPopover.setToolbarHtml(this.renderBrowseSortToolbar());
        const body = TvPopover.getBodyEl();
        if (!body) return;
        if (!append) body.innerHTML = '<p class="tool-msg">Loading…</p>';
        const sort = TvPlayer.getBrowseSort();
        const seq = ++this.loadSeq;
        try {
            const data = await TvProviderRegistry.searchChannels({
                countrycode: code,
                limit: BROWSE_PAGE_SIZE,
                offset: this.browseOffset,
                order: sort,
                reverse: false,
                hideOffline: TvProviderRegistry.getHideOffline()
            });
            if (seq !== this.loadSeq) return;
            const page = Array.isArray(data) ? data : [];
            this.browseHasMore = page.length >= BROWSE_PAGE_SIZE;
            this.browseChannels = append ? [...this.browseChannels, ...page] : page;
            if (!this.browseChannels.length) {
                body.innerHTML = '<p class="tool-msg">No channels in this country.</p>';
            } else if (append) {
                const grid = body.querySelector('[data-tv-channel-grid]');
                if (grid && page.length) {
                    const wrapper = document.createElement('div');
                    wrapper.innerHTML = page.map((ch) => this.renderChannelTile(ch)).join('');
                    while (wrapper.firstChild) grid.appendChild(wrapper.firstChild);
                    this.bindChannelTileActions(grid);
                }
                body.querySelector('[data-tv-load-more]')?.remove();
                if (this.browseHasMore) {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'btn btn--compact sidebar-tv__load-more';
                    btn.setAttribute('data-tv-load-more', '');
                    btn.textContent = 'Load more';
                    body.appendChild(btn);
                    this.bindBrowseCountryControls(body);
                }
            } else {
                body.innerHTML = `<div class="tv-tile-grid tv-tile-grid--channels" data-tv-channel-grid>
                    ${this.browseChannels.map((ch) => this.renderChannelTile(ch)).join('')}
                </div>${this.browseHasMore ? '<button type="button" class="btn btn--compact sidebar-tv__load-more" data-tv-load-more>Load more</button>' : ''}`;
                this.bindChannelTileActions(body);
                this.bindBrowseCountryControls(body);
                this.scrollToHighlightedChannel(body);
            }
        } catch {
            if (seq !== this.loadSeq) return;
            body.innerHTML = '<p class="tool-msg tool-msg--error">Could not load channels.</p>';
        }
        TvPopover.reposition();
    },

    bindBrowseCountryControls(body) {
        TvPopover.getToolbarEl()?.querySelector('[data-tv-sort]')?.addEventListener('change', (e) => {
            TvPlayer.saveBrowseSort(e.target.value);
            this.browseOffset = 0;
            this.browseChannels = [];
            this.renderBrowseCountry();
        });
        body.querySelector('[data-tv-load-more]')?.addEventListener('click', () => {
            this.browseOffset += BROWSE_PAGE_SIZE;
            this.renderBrowseCountry(true);
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
                body.innerHTML = `<div class="tv-tile-grid tv-tile-grid--channels">${this.listChannels.map((ch) => this.renderChannelTile(ch)).join('')}</div>`;
                this.bindChannelTileActions(body);
            }
        } catch {
            if (seq !== this.loadSeq) return;
            this.listChannels = fallback;
            body.innerHTML = this.listChannels.length
                ? `<div class="tv-tile-grid tv-tile-grid--channels">${this.listChannels.map((ch) => this.renderChannelTile(ch)).join('')}</div>`
                : '<p class="tool-msg tool-msg--error">Could not load list.</p>';
            if (this.listChannels.length) this.bindChannelTileActions(body);
        }
        TvPopover.reposition();
    },

    renderChannelTile(channel) {
        const uuid = channelKey(channel);
        const fav = TvPlayer.isFavorite(channel);
        const playing = channelKey(TvPlayer.channel) === uuid && (TvPlayer.playing || TvPlayer.loading);
        const offline = channel.lastcheckok === 0;
        const logoHtml = channel.logo
            ? `<img class="tv-tile__logo is-hidden" src="${escapeHtml(channel.logo)}" alt="" width="32" height="32" loading="lazy" decoding="async">`
            : '<span class="tv-tile__logo tv-tile__logo--fallback" aria-hidden="true">📺</span>';
        const flag = channel.countrycode ? `<span class="tv-tile__badge" aria-hidden="true">${countryFlagEmoji(channel.countrycode)}</span>` : '';
        const starIcon = fav ? CARD_ICONS.starFilled : CARD_ICONS.star;
        return `<div class="tv-tile tv-tile--channel${playing ? ' is-on-desktop' : ''}${offline ? ' tv-tile--offline' : ''}" data-tv-channel="${escapeHtml(uuid)}" role="button" tabindex="0" title="${escapeHtml(channel.name || '')}">
            <span class="tv-tile__art">${logoHtml}</span>
            <span class="tv-tile__label u-truncate">${escapeHtml(channel.name || 'Unknown')}</span>
            ${flag}
            ${offline ? '<span class="tv-tile__offline">offline</span>' : ''}
            <button type="button" class="card-act tv-tile__star${fav ? ' is-active' : ''}" data-tv-star="${escapeHtml(uuid)}" title="${fav ? 'Remove favorite' : 'Add favorite'}" aria-label="${fav ? 'Remove favorite' : 'Add favorite'}" aria-pressed="${fav ? 'true' : 'false'}">${starIcon}</button>
        </div>`;
    },

    bindChannelTileActions(container) {
        if (!container) return;
        container.querySelectorAll('.tv-tile__logo[src]').forEach((img) => {
            bindFaviconImage(img, () => {
                const empty = document.createElement('span');
                empty.className = 'tv-tile__logo tv-tile__logo--empty';
                empty.setAttribute('aria-hidden', 'true');
                img.replaceWith(empty);
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
        TvPlayer.toggleFavorite(typeof channelOrKey === 'object' ? channelOrKey : parseChannelKey(key));
        if (TvPopover.mode && !TvPopover.panel?.classList.contains('is-hidden')) this.refreshOpenPanel();
        this.updateTransport();
        return true;
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
        if (state.loading || state.loadPhase === 'connecting' || state.loadPhase === 'buffering') {
            return ACTION_ICONS.radioLoading.replace('sidebar-radio__spin-icon', 'sidebar-tv__spin-icon');
        }
        if (state.playing) return ACTION_ICONS.radioPause;
        return ACTION_ICONS.radioPlay;
    },

    updateTransport(detail = null) {
        const state = detail || {
            channel: TvPlayer.channel,
            playing: TvPlayer.playing,
            loading: TvPlayer.loading,
            loadPhase: TvPlayer.loadPhase,
            error: TvPlayer.error,
            resumeBlocked: TvPlayer.resumeBlocked,
            volume: TvPlayer.volume
        };
        const marqueeEl = this.root?.querySelector('[data-tv-marquee]');
        const artImg = this.root?.querySelector('[data-tv-art]');
        const artFallback = this.root?.querySelector('[data-tv-art-fallback]');
        const compactArtImg = this.root?.querySelector('[data-tv-compact-art]');
        const compactArtFallback = this.root?.querySelector('[data-tv-compact-art-fallback]');
        const flagEl = this.root?.querySelector('[data-tv-flag]');
        const countryNameEl = this.root?.querySelector('[data-tv-country-name]');
        const localeBtn = this.root?.querySelector('.sidebar-tv__locale');
        const loadStatusEl = this.root?.querySelector('[data-tv-load-status]');
        const volumeEls = this.root?.querySelectorAll('[data-tv-volume], [data-tv-volume-compact]');
        const favBtn = this.root?.querySelector('[data-tv-favorite]');
        const transport = this.root?.querySelector('[data-tv-transport]');
        const artBtn = this.root?.querySelector('.sidebar-tv__art');

        let titleText = 'TV';
        let isError = false;
        if (state.resumeBlocked) titleText = 'Tap play to resume';
        else if (state.error) { titleText = state.error; isError = true; }
        else if (state.channel?.name) titleText = state.channel.name;

        if (marqueeEl) syncMarquee(marqueeEl, titleText, { error: isError || !!state.resumeBlocked });

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
        artBtn?.classList.toggle('sidebar-tv__art--loading', isLoading);
        this.root?.querySelector('.sidebar-tv__compact-art')?.classList.toggle('sidebar-tv__art--loading', isLoading);

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

        transport?.classList.toggle('sidebar-tv__now-playing--active', !!(state.channel || state.playing || state.loading));
    }
};
