import { RadioProviderRegistry } from './radioProviders/registry.js';
import { stationKey, parseStationKey } from './radioProviders/stationShape.js';
import { RadioPlayer } from './radioPlayer.js';
import { RadioPopover } from './radioPopover.js';
import { clampPanelToViewport } from './popoverPosition.js';
import { escapeHtml, countryFlagEmoji, debounce, syncMarquee, bindFaviconImage } from './radioUtils.js';
import { ACTION_ICONS, CARD_ICONS } from './ui.js';
import { applySectionCollapse } from './hamburger.js';

const BROWSE_PAGE_SIZE = 60;
const BROWSE_SORT_OPTIONS = [
    { value: 'clickcount', label: 'Popular' },
    { value: 'name', label: 'Name' },
    { value: 'votes', label: 'Votes' },
    { value: 'bitrate', label: 'Bitrate' }
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
    listStations: [],
    activeTab: 'browse',
    loadSeq: 0,
    onStateChanged: null,

    init() {
        this.root = document.getElementById('sidebar-radio');
        if (!this.root) return;

        RadioPlayer.init();
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
                this.refreshOpenPanel();
            }
        };
        window.addEventListener('radio:state_changed', this.onStateChanged);
        this.updateTransport();
        this.restoreLastStationMeta().then(() => {
            this.updateTransport();
            return RadioPlayer.resumeIfWasPlaying();
        }).catch(() => {});
        this.prefetchCountries().then(() => this.updateTransport());
        this.bindDockButton();
        this.bindMiniPlayerDrag();
        this.applyInitialDockState();
        this.bindViewportClamp();
    },

    isUndocked() {
        return this.root?.classList.contains('sidebar-radio--undocked');
    },

    bindViewportClamp() {
        window.addEventListener('resize', () => {
            if (!this.isUndocked()) return;
            const x = parseFloat(this.root.style.left) || 0;
            const y = parseFloat(this.root.style.top) || 0;
            const clamped = clampPanelToViewport(this.root, x, y);
            this.root.style.left = `${clamped.x}px`;
            this.root.style.top = `${clamped.y}px`;
            RadioPopover.reposition();
        });
    },

    applyInitialDockState() {
        const { miniPlayerDocked, miniPlayerX, miniPlayerY } = RadioPlayer.getMiniPlayerState();
        if (miniPlayerDocked !== false) {
            this.updateDockButton();
            return;
        }

        this.ensureUndockedInBody();
        this.root.classList.add('sidebar-radio--undocked');
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
        const btn = this.root?.querySelector('[data-radio-dock]');
        if (!btn) return;
        const undocked = this.isUndocked();
        btn.innerHTML = undocked ? CARD_ICONS.pin : CARD_ICONS.unpin;
        const label = undocked ? 'Dock in sidebar' : 'Undock to canvas';
        btn.setAttribute('title', label);
        btn.setAttribute('aria-label', label);
    },

    bindDockButton() {
        this.root.querySelector('[data-radio-dock]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMiniPlayerDock();
        });
    },

    toggleMiniPlayerDock() {
        if (this.isUndocked()) {
            this.applyDockedState();
        } else {
            this.applyUndockedState();
        }
        this.updateDockButton();
        RadioPopover.reposition();
    },

    applyDockedState() {
        this.root.classList.remove('sidebar-radio--undocked', 'sidebar-radio--dragging');
        this.root.style.left = '';
        this.root.style.top = '';
        this.restoreToSidebar();
        RadioPlayer.saveMiniPlayerState({ miniPlayerDocked: true, miniPlayerX: null, miniPlayerY: null });
    },

    applyUndockedState(persist = true) {
        const rect = this.root.getBoundingClientRect();
        const saved = RadioPlayer.getMiniPlayerState();
        let x = saved.miniPlayerX ?? rect.left;
        let y = saved.miniPlayerY ?? rect.top;

        this.ensureUndockedInBody();
        this.root.classList.add('sidebar-radio--undocked');
        this.root.style.left = `${x}px`;
        this.root.style.top = `${y}px`;
        const clamped = clampPanelToViewport(this.root, x, y);
        this.root.style.left = `${clamped.x}px`;
        this.root.style.top = `${clamped.y}px`;

        if (persist) {
            RadioPlayer.saveMiniPlayerState({
                miniPlayerDocked: false,
                miniPlayerX: clamped.x,
                miniPlayerY: clamped.y
            });
        }
    },

    bindMiniPlayerDrag() {
        const header = document.getElementById('radio-section-header');
        if (!header) return;

        header.addEventListener('pointerdown', (e) => {
            if (!this.isUndocked()) return;
            if (e.target.closest('[data-radio-dock]') || e.target.closest('.collapsable-toggle')) return;
            if (e.target.closest('.sidebar-radio__compact')) return;
            if (e.button !== 0) return;

            e.preventDefault();
            let dragging = true;
            let didDrag = false;
            const startX = e.clientX;
            const startY = e.clientY;
            const startLeft = parseFloat(this.root.style.left) || 0;
            const startTop = parseFloat(this.root.style.top) || 0;

            this.root.classList.add('sidebar-radio--dragging');
            header.setPointerCapture(e.pointerId);

            const onMove = (ev) => {
                if (!dragging) return;
                if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) {
                    didDrag = true;
                }
                const nx = startLeft + (ev.clientX - startX);
                const ny = startTop + (ev.clientY - startY);
                const clamped = clampPanelToViewport(this.root, nx, ny);
                this.root.style.left = `${clamped.x}px`;
                this.root.style.top = `${clamped.y}px`;
                RadioPopover.reposition();
            };

            const onUp = (ev) => {
                if (!dragging) return;
                dragging = false;
                this.root.classList.remove('sidebar-radio--dragging');
                header.releasePointerCapture(ev.pointerId);
                if (didDrag) {
                    header.dataset.suppressClick = 'true';
                    requestAnimationFrame(() => {
                        delete header.dataset.suppressClick;
                    });
                }
                RadioPlayer.saveMiniPlayerState({
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
        this.root.innerHTML = `
            <div class="collapsable-header list-row--header" id="radio-section-header">
                <span class="collapsable-heading"><span class="collapsable-toggle">▼</span>Radio</span>
                <div class="sidebar-radio__compact">
                    <button type="button" class="sidebar-radio__compact-art" data-radio-station-context title="Show station in browser" aria-label="Show station in browser">
                        <img class="sidebar-radio__compact-art-img is-hidden" data-radio-compact-art alt="">
                        <span class="sidebar-radio__compact-art-fallback" data-radio-compact-art-fallback aria-hidden="true">♪</span>
                    </button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-radio__action" data-radio-play aria-label="Play or pause">
                        <span data-radio-play-icon></span>
                    </button>
                    <input type="range" class="sidebar-radio__volume-compact" data-radio-volume-compact min="0" max="100" value="85" aria-label="Volume">
                </div>
                <button type="button" class="card-act sidebar-radio__dock" data-radio-dock title="Undock to canvas" aria-label="Undock to canvas">${CARD_ICONS.unpin}</button>
            </div>
            <div class="collapsable-section" id="radio-section">
                <div class="sidebar-radio__now-playing" data-radio-transport>
                    <button type="button" class="sidebar-radio__art" data-radio-station-context title="Show station in browser" aria-label="Show station in browser">
                        <img class="sidebar-radio__art-img is-hidden" data-radio-art alt="">
                        <span class="sidebar-radio__art-fallback" data-radio-art-fallback aria-hidden="true">♪</span>
                    </button>
                    <div class="sidebar-radio__meta">
                        <div class="sidebar-radio__title-row">
                            <div class="sidebar-radio__marquee" data-radio-marquee>Radio</div>
                        </div>
                        <div class="sidebar-radio__locale-row">
                            <button type="button" class="sidebar-radio__locale is-hidden" data-radio-station-context title="Show station in browser" aria-label="Show station in browser">
                                <span data-radio-flag aria-hidden="true"></span>
                                <span class="sidebar-radio__country-name" data-radio-country-name></span>
                            </button>
                            <span class="sidebar-radio__load-status is-hidden" data-radio-load-status></span>
                        </div>
                        <div class="sidebar-radio__volume-row">
                            <input type="range" class="sidebar-radio__volume" data-radio-volume min="0" max="100" value="85" aria-label="Volume">
                        </div>
                    </div>
                </div>
                <div class="sidebar-radio__actions">
                    <button type="button" class="btn btn--compact btn-icon sidebar-radio__action" data-radio-play aria-label="Play or pause">
                        <span data-radio-play-icon></span>
                    </button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-radio__action" data-radio-open="browse" title="Browse stations" aria-label="Browse stations" aria-expanded="false" aria-haspopup="dialog">${ACTION_ICONS.radioBrowse}</button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-radio__action sidebar-radio__action--heart is-hidden" data-radio-favorite title="Add favorite" aria-label="Add favorite" aria-pressed="false">${CARD_ICONS.heart}</button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-radio__action" data-radio-open="special" title="Radio settings" aria-label="Radio settings" aria-expanded="false" aria-haspopup="dialog">${ACTION_ICONS.radioSpecial}</button>
                </div>
            </div>
        `;
        applySectionCollapse('radio-section', 'radio-section-header', true);
    },

    bindShellListeners() {
        this.root.querySelectorAll('[data-radio-play]').forEach((btn) => {
            btn.addEventListener('click', () => RadioPlayer.toggle());
        });

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

        const artImg = this.root.querySelector('[data-radio-art]');
        const compactArtImg = this.root.querySelector('[data-radio-compact-art]');
        bindFaviconImage(artImg, () => {
            this.root.querySelector('[data-radio-art-fallback]')?.classList.add('is-hidden');
        });
        bindFaviconImage(compactArtImg, () => {
            this.root.querySelector('[data-radio-compact-art-fallback]')?.classList.add('is-hidden');
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
            special: 'Radio settings'
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
            RadioProviderRegistry.setActiveProvider(e.target.value);
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
            RadioProviderRegistry.setMirror(e.target.value || null);
        });

        body.querySelector('[data-radio-hide-offline]')?.addEventListener('change', (e) => {
            RadioProviderRegistry.setHideOffline(e.target.checked);
            if (RadioPopover.mode === 'browse' && this.browseView === 'country') {
                this.renderBrowseCountry();
            }
        });

        body.querySelector('[data-radio-refresh-catalog]')?.addEventListener('click', async () => {
            await RadioProviderRegistry.refreshCatalog();
            this.countries = await RadioProviderRegistry.getCountries({ refresh: true });
            if (RadioPopover.mode === 'browse') {
                this.browseView = 'countries';
                this.browseCountry = null;
                await this.renderBrowseCountries();
            }
        });

        body.querySelector('[data-radio-clear-cache]')?.addEventListener('click', () => {
            RadioProviderRegistry.clearAllCaches();
        });

        RadioPopover.reposition();
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

        body.innerHTML = `
            <div class="radio-tile-grid" data-radio-country-grid>
                ${filtered.map((c) => this.renderCountryTile(c)).join('')}
            </div>
        `;

        body.querySelectorAll('[data-radio-country]').forEach((tile) => {
            tile.addEventListener('click', () => {
                const code = tile.getAttribute('data-radio-country');
                const name = tile.getAttribute('data-radio-country-name') || code;
                this.openBrowseCountry(code, name);
            });
        });

        RadioPopover.reposition();
    },

    renderCountryTile(c) {
        const code = c.iso_3166_1 || '';
        const flag = countryFlagEmoji(code);
        const count = c.stationcount ? `${c.stationcount}` : '';
        return `
            <button type="button" class="radio-tile radio-tile--country" data-radio-country="${escapeHtml(code)}" data-radio-country-name="${escapeHtml(c.name || code)}" title="${escapeHtml(c.name || code)}">
                <span class="radio-tile__flag" aria-hidden="true">${flag}</span>
                <span class="radio-tile__label u-truncate">${escapeHtml(c.name || code)}</span>
                ${count ? `<span class="radio-tile__meta">${escapeHtml(count)}</span>` : ''}
            </button>
        `;
    },

    renderSortSelect(options, current, attrName, label) {
        return `
            <select class="form-input sidebar-radio__sort" ${attrName} aria-label="${escapeHtml(label)}">
                ${options.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === current ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
            </select>
        `;
    },

    renderBrowseCountriesToolbar() {
        return `
            <div class="radio-popover__toolbar-row">
                <input type="search" class="form-input sidebar-radio__search" data-radio-country-search placeholder="Filter countries…" aria-label="Filter countries" autocomplete="off" spellcheck="false" value="${escapeHtml(this.countryFilter)}">
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
            <div class="radio-popover__toolbar-row radio-popover__toolbar-row--end">
                ${this.renderSortSelect(BROWSE_SORT_OPTIONS, RadioPlayer.getBrowseSort(), 'data-radio-sort', 'Sort stations')}
            </div>
        `;
    },

    renderRecentsToolbar() {
        return `
            <div class="radio-popover__toolbar-row radio-popover__toolbar-row--end">
                <button type="button" class="btn btn--compact btn-icon card-act sidebar-radio__clear-recents" data-radio-clear-recents title="Clear recents" aria-label="Clear recents">${CARD_ICONS.delete}</button>
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

        RadioPlayer.toggleFavorite(station || parseStationKey(key));
        if (RadioPopover.mode && !RadioPopover.panel?.classList.contains('is-hidden')) {
            this.refreshOpenPanel();
        }
        this.updateTransport();
        return true;
    },

    async openBrowseCountry(code, name) {
        this.browseView = 'country';
        this.browseCountry = { code, name };
        this.browseOffset = 0;
        await this.renderBrowseCountry();
    },

    async renderBrowseCountry(append = false) {
        const { code, name } = this.browseCountry || {};
        RadioPopover.setTitle(name || 'Stations');
        RadioPopover.setBackVisible(true, () => {
            this.browseView = 'countries';
            this.browseCountry = null;
            this.browseOffset = 0;
            this.browseStations = [];
            this.renderBrowseCountries();
        });
        RadioPopover.setToolbarHtml(this.renderBrowseSortToolbar());

        const body = RadioPopover.getBodyEl();
        if (!body) return;

        if (!append) {
            body.innerHTML = '<p class="tool-msg">Loading…</p>';
        }

        const sort = RadioPlayer.getBrowseSort();
        const seq = ++this.loadSeq;
        try {
            const data = await RadioProviderRegistry.searchStations({
                countrycode: code,
                limit: BROWSE_PAGE_SIZE,
                offset: this.browseOffset,
                order: sort,
                reverse: sort !== 'name',
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
                body.innerHTML = '<p class="tool-msg">No stations in this country.</p>';
            } else if (append) {
                const grid = body.querySelector('[data-radio-station-grid]');
                if (grid && page.length) {
                    const wrapper = document.createElement('div');
                    wrapper.innerHTML = page.map((s) => this.renderStationTile(s)).join('');
                    while (wrapper.firstChild) {
                        grid.appendChild(wrapper.firstChild);
                    }
                    this.bindStationTileActions(grid);
                }
                body.querySelector('[data-radio-load-more]')?.remove();
                if (this.browseHasMore) {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'btn btn--compact sidebar-radio__load-more';
                    btn.setAttribute('data-radio-load-more', '');
                    btn.textContent = 'Load more';
                    body.appendChild(btn);
                    this.bindBrowseCountryControls(body);
                }
            } else {
                body.innerHTML = `
                    <div class="radio-tile-grid radio-tile-grid--stations" data-radio-station-grid>
                        ${this.browseStations.map((s) => this.renderStationTile(s)).join('')}
                    </div>
                    ${this.browseHasMore ? '<button type="button" class="btn btn--compact sidebar-radio__load-more" data-radio-load-more>Load more</button>' : ''}
                `;
                this.bindStationTileActions(body);
                this.bindBrowseCountryControls(body);
                this.scrollToHighlightedStation(body);
            }
        } catch {
            if (seq !== this.loadSeq) return;
            body.innerHTML = '<p class="tool-msg tool-msg--error">Could not load stations.</p>';
        }
        RadioPopover.reposition();
    },

    bindBrowseCountryControls(body) {
        RadioPopover.getToolbarEl()?.querySelector('[data-radio-sort]')?.addEventListener('change', (e) => {
            RadioPlayer.saveBrowseSort(e.target.value);
            this.browseOffset = 0;
            this.browseStations = [];
            this.renderBrowseCountry();
        });

        body.querySelector('[data-radio-load-more]')?.addEventListener('click', () => {
            this.browseOffset += BROWSE_PAGE_SIZE;
            this.renderBrowseCountry(true);
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
            stationuuid: meta.key,
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
            : keys.map((key) => ({ key, name: '', favicon: '', countrycode: '' }));

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
                body.innerHTML = `<div class="radio-tile-grid radio-tile-grid--stations">${this.listStations.map((s) => this.renderStationTile(s)).join('')}</div>`;
                this.bindStationTileActions(body);
            }
        } catch {
            if (seq !== this.loadSeq) return;
            this.listStations = fallbackStations;
            if (!this.listStations.length) {
                body.innerHTML = '<p class="tool-msg tool-msg--error">Could not load list.</p>';
            } else {
                body.innerHTML = `<div class="radio-tile-grid radio-tile-grid--stations">${this.listStations.map((s) => this.renderStationTile(s)).join('')}</div>`;
                this.bindStationTileActions(body);
            }
        }
        RadioPopover.reposition();
    },

    renderStationTile(station, { compact = false } = {}) {
        const uuid = stationKey(station);
        const fav = RadioPlayer.isFavorite(station);
        const playing = stationKey(RadioPlayer.station) === uuid
            && (RadioPlayer.playing || RadioPlayer.loading);
        const offline = station.lastcheckok === 0;
        const starIcon = fav ? CARD_ICONS.starFilled : CARD_ICONS.star;
        const favicon = station.favicon
            ? `<img class="radio-tile__favicon is-hidden" src="${escapeHtml(station.favicon)}" alt="" width="32" height="32" loading="lazy" decoding="async">`
            : '<span class="radio-tile__favicon radio-tile__favicon--fallback" aria-hidden="true">♪</span>';
        const flag = station.countrycode
            ? `<span class="radio-tile__badge" aria-hidden="true">${countryFlagEmoji(station.countrycode)}</span>`
            : '';
        const offlineBadge = offline ? '<span class="radio-tile__offline">offline</span>' : '';

        return `
            <div class="radio-tile radio-tile--station${playing ? ' is-on-desktop' : ''}${offline ? ' radio-tile--offline' : ''}${compact ? ' radio-tile--compact' : ''}" data-radio-station="${escapeHtml(uuid)}" role="button" tabindex="0" title="${escapeHtml(station.name || '')}">
                <span class="radio-tile__art">${favicon}</span>
                <span class="radio-tile__label u-truncate">${escapeHtml(station.name || 'Unknown')}</span>
                ${flag}
                ${offlineBadge}
                <button type="button" class="card-act radio-tile__star${fav ? ' is-active' : ''}" data-radio-star="${escapeHtml(uuid)}" title="${fav ? 'Remove favorite' : 'Add favorite'}" aria-label="${fav ? 'Remove favorite' : 'Add favorite'}" aria-pressed="${fav ? 'true' : 'false'}">${starIcon}</button>
            </div>
        `;
    },

    bindStationTileActions(container) {
        if (!container) return;

        container.querySelectorAll('.radio-tile__favicon[src]').forEach((img) => {
            bindFaviconImage(img, () => {
                const empty = document.createElement('span');
                empty.className = 'radio-tile__favicon radio-tile__favicon--empty';
                empty.setAttribute('aria-hidden', 'true');
                img.replaceWith(empty);
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
                const station = this.findStation(uuid);
                if (station) RadioPlayer.playStation(station);
                else if (uuid) RadioPlayer.playStation(uuid);
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
            tile.classList.toggle(
                'is-on-desktop',
                tile.getAttribute('data-radio-station') === currentKey && active
            );
        });
    },

    getPlayIconHtml(state) {
        if (state.loading || state.loadPhase === 'connecting' || state.loadPhase === 'buffering') {
            return ACTION_ICONS.radioLoading;
        }
        if (state.playing) return ACTION_ICONS.radioPause;
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
        const localeBtn = this.root?.querySelector('.sidebar-radio__locale');
        const loadStatusEl = this.root?.querySelector('[data-radio-load-status]');
        const volumeEls = this.root?.querySelectorAll('[data-radio-volume], [data-radio-volume-compact]');
        const favBtn = this.root?.querySelector('[data-radio-favorite]');
        const transport = this.root?.querySelector('[data-radio-transport]');
        const artBtn = this.root?.querySelector('.sidebar-radio__art');

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
        artBtn?.classList.toggle('sidebar-radio__art--loading', isLoading);
        this.root?.querySelector('.sidebar-radio__compact-art')?.classList.toggle('sidebar-radio__art--loading', isLoading);

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

        transport?.classList.toggle('sidebar-radio__now-playing--active', !!(state.station || state.playing || state.loading));
    }
};
