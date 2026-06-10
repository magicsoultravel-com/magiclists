import { RadioBrowserApi } from './radioBrowserApi.js';
import { RadioPlayer } from './radioPlayer.js';
import { ACTION_ICONS, CARD_ICONS } from './ui.js';

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

export const SidebarRadio = {
    root: null,
    tab: 'browse',
    countries: [],
    tags: [],
    stations: [],
    listMessage: '',
    listError: false,
    searchTerm: '',
    countryCode: '',
    tag: '',
    searchSeq: 0,
    onStateChanged: null,

    init() {
        this.root = document.getElementById('sidebar-radio');
        if (!this.root) return;

        RadioPlayer.init();
        this.renderShell();
        this.bindShellListeners();
        this.onStateChanged = (e) => this.handlePlayerState(e.detail);
        window.addEventListener('radio:state_changed', this.onStateChanged);
        this.updateTransport();
        this.loadFilters();
        this.loadStations();
        this.restoreLastStationMeta();
    },

    async restoreLastStationMeta() {
        const uuid = RadioPlayer.station?.stationuuid;
        if (!uuid) return;
        try {
            const station = await RadioBrowserApi.getStationByUuid(uuid);
            if (station) {
                RadioPlayer.station = station;
                RadioPlayer.emitState();
            }
        } catch {
            // keep saved name fallback
        }
    },

    renderShell() {
        this.root.innerHTML = `
            <div class="sidebar-radio__transport" data-radio-transport>
                <button type="button" class="btn btn--compact btn-icon sidebar-radio__play" data-radio-play aria-label="Play or pause">
                    <span data-radio-play-icon></span>
                </button>
                <div class="sidebar-radio__now">
                    <img class="sidebar-radio__favicon is-hidden" data-radio-favicon alt="" width="14" height="14">
                    <span class="sidebar-radio__title u-truncate" data-radio-title>Radio</span>
                </div>
                <input type="range" class="sidebar-radio__volume" data-radio-volume min="0" max="100" value="85" aria-label="Volume">
            </div>
            <div class="collapsable-header list-row--header" id="radio-section-header">
                <span class="collapsable-heading"><span class="collapsable-toggle">▼</span>Radio</span>
                <button type="button" class="card-act sidebar-radio__refresh" data-radio-refresh title="Refresh list" aria-label="Refresh station list">${ACTION_ICONS.layoutReset}</button>
            </div>
            <div class="collapsable-section" id="radio-section">
                <div class="sidebar-radio__tabs">
                    <button type="button" class="btn btn--compact sidebar-radio__tab is-active" data-radio-tab="browse">Browse</button>
                    <button type="button" class="btn btn--compact sidebar-radio__tab" data-radio-tab="favorites">Favorites</button>
                </div>
                <div class="sidebar-radio__browse" data-radio-browse-panel>
                    <input type="search" class="form-input sidebar-radio__search" data-radio-search placeholder="Search stations…" aria-label="Search radio stations" autocomplete="off" spellcheck="false">
                    <div class="sidebar-radio__filters">
                        <select class="form-input sidebar-radio__country" data-radio-country aria-label="Country">
                            <option value="">All countries</option>
                        </select>
                    </div>
                    <div class="sidebar-radio__tags" data-radio-tags></div>
                </div>
                <div class="sidebar-radio__list-wrap">
                    <p class="tool-msg is-hidden" data-radio-list-msg></p>
                    <div class="toolbox-list sidebar-radio__list" data-radio-list role="list"></div>
                </div>
            </div>
        `;
    },

    bindShellListeners() {
        this.root.querySelector('[data-radio-play]')?.addEventListener('click', () => {
            RadioPlayer.toggle();
        });

        const volumeEl = this.root.querySelector('[data-radio-volume]');
        volumeEl?.addEventListener('input', (e) => {
            RadioPlayer.setVolume(Number(e.target.value) / 100);
        });
        if (volumeEl) {
            volumeEl.value = String(Math.round(RadioPlayer.volume * 100));
        }

        this.root.querySelector('[data-radio-refresh]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.refreshCurrentView();
        });

        this.root.querySelectorAll('[data-radio-tab]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-radio-tab');
                if (tab) this.setTab(tab);
            });
        });

        const searchEl = this.root.querySelector('[data-radio-search]');
        if (searchEl) {
            searchEl.addEventListener('input', debounce((e) => {
                this.searchTerm = e.target.value.trim();
                this.loadStations();
            }, 300));
        }

        this.root.querySelector('[data-radio-country]')?.addEventListener('change', (e) => {
            this.countryCode = e.target.value;
            this.loadStations();
        });

        this.root.querySelector('[data-radio-list]')?.addEventListener('click', (e) => {
            const starBtn = e.target.closest('[data-radio-star]');
            if (starBtn) {
                e.preventDefault();
                e.stopPropagation();
                const uuid = starBtn.getAttribute('data-radio-star');
                const station = this.stations.find((s) => s.stationuuid === uuid);
                if (station) {
                    RadioPlayer.toggleFavorite(station);
                    this.renderStationList();
                }
                return;
            }
            const row = e.target.closest('[data-radio-station]');
            if (!row) return;
            const uuid = row.getAttribute('data-radio-station');
            const station = this.stations.find((s) => s.stationuuid === uuid);
            if (station) RadioPlayer.playStation(station);
        });
    },

    setTab(tab) {
        this.tab = tab;
        this.root.querySelectorAll('[data-radio-tab]').forEach((btn) => {
            btn.classList.toggle('is-active', btn.getAttribute('data-radio-tab') === tab);
        });
        const browsePanel = this.root.querySelector('[data-radio-browse-panel]');
        browsePanel?.classList.toggle('is-hidden', tab !== 'browse');
        this.loadStations();
    },

    async loadFilters() {
        try {
            const [countries, tags] = await Promise.all([
                RadioBrowserApi.getCountries(),
                RadioBrowserApi.getTags()
            ]);
            this.countries = Array.isArray(countries) ? countries : [];
            this.tags = Array.isArray(tags) ? tags : [];
            this.renderCountrySelect();
            this.renderTagChips();
        } catch {
            // filters optional
        }
    },

    renderCountrySelect() {
        const select = this.root.querySelector('[data-radio-country]');
        if (!select) return;
        const options = this.countries
            .slice()
            .sort((a, b) => (b.stationcount || 0) - (a.stationcount || 0))
            .map((c) => `<option value="${escapeHtml(c.iso_3166_1 || '')}">${escapeHtml(c.name || c.iso_3166_1)}</option>`)
            .join('');
        select.innerHTML = `<option value="">All countries</option>${options}`;
        if (this.countryCode) select.value = this.countryCode;
    },

    renderTagChips() {
        const wrap = this.root.querySelector('[data-radio-tags]');
        if (!wrap) return;
        wrap.innerHTML = this.tags.slice(0, 12).map((t) => {
            const name = t.name || '';
            const active = this.tag === name ? ' is-active' : '';
            return `<button type="button" class="btn btn--compact sidebar-radio__tag${active}" data-radio-tag="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
        }).join('');

        wrap.querySelectorAll('[data-radio-tag]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const value = btn.getAttribute('data-radio-tag') || '';
                this.tag = this.tag === value ? '' : value;
                this.renderTagChips();
                this.loadStations();
            });
        });
    },

    async refreshCurrentView() {
        if (this.tab === 'favorites') {
            await this.loadFavorites(true);
            return;
        }
        RadioBrowserApi.invalidateQueryCache();
        await this.loadFilters();
        await this.loadStations(true);
    },

    async loadStations(refresh = false) {
        if (this.tab === 'favorites') {
            await this.loadFavorites(refresh);
            return;
        }

        const seq = ++this.searchSeq;
        this.setListMessage('Loading…', false);

        if (this.searchTerm.length === 1) {
            this.stations = [];
            this.setListMessage('Type at least 2 characters to search.', false);
            this.renderStationList();
            return;
        }

        if (!this.searchTerm && !this.countryCode && !this.tag) {
            this.stations = [];
            this.setListMessage('Pick a country, tag, or search.', false);
            this.renderStationList();
            return;
        }

        try {
            const data = await RadioBrowserApi.searchStations({
                name: this.searchTerm,
                countrycode: this.countryCode,
                tag: this.tag,
                refresh
            });
            if (seq !== this.searchSeq) return;
            this.stations = Array.isArray(data) ? data : [];
            if (!this.stations.length) {
                this.setListMessage('No stations found.', false);
            } else {
                this.setListMessage('', false);
            }
            this.renderStationList();
        } catch {
            if (seq !== this.searchSeq) return;
            this.stations = [];
            this.setListMessage('Could not load stations.', true);
            this.renderStationList();
        }
    },

    async loadFavorites(refresh = false) {
        const seq = ++this.searchSeq;
        const uuids = RadioPlayer.getFavorites();
        if (!uuids.length) {
            this.stations = [];
            this.setListMessage('Star stations from Browse.', false);
            this.renderStationList();
            return;
        }

        this.setListMessage('Loading…', false);
        try {
            const data = await RadioBrowserApi.getStationsByUuids(uuids, { refresh });
            if (seq !== this.searchSeq) return;
            const byUuid = new Map(data.map((s) => [s.stationuuid, s]));
            this.stations = uuids.map((uuid) => byUuid.get(uuid)).filter(Boolean);
            if (!this.stations.length) {
                this.setListMessage('Favorites unavailable.', true);
            } else {
                this.setListMessage('', false);
            }
            this.renderStationList();
        } catch {
            if (seq !== this.searchSeq) return;
            this.stations = [];
            this.setListMessage('Could not load favorites.', true);
            this.renderStationList();
        }
    },

    setListMessage(text, isError) {
        this.listMessage = text;
        this.listError = isError;
        const msgEl = this.root?.querySelector('[data-radio-list-msg]');
        if (!msgEl) return;
        msgEl.textContent = text;
        msgEl.classList.toggle('is-hidden', !text);
        msgEl.classList.toggle('tool-msg--error', !!isError && !!text);
    },

    renderStationList() {
        const listEl = this.root?.querySelector('[data-radio-list]');
        if (!listEl) return;

        const playingUuid = RadioPlayer.station?.stationuuid;
        listEl.innerHTML = this.stations.map((station) => {
            const uuid = station.stationuuid;
            const fav = RadioPlayer.isFavorite(uuid);
            const playing = playingUuid === uuid && (RadioPlayer.playing || RadioPlayer.loading);
            const offline = station.lastcheckok === 0;
            const starIcon = fav ? CARD_ICONS.starFilled : CARD_ICONS.star;
            const favicon = station.favicon
                ? `<img class="sidebar-radio__row-favicon" src="${escapeHtml(station.favicon)}" alt="" width="14" height="14" loading="lazy">`
                : '<span class="sidebar-radio__row-favicon sidebar-radio__row-favicon--fallback" aria-hidden="true">♪</span>';
            const meta = [station.countrycode, station.bitrate ? `${station.bitrate}k` : ''].filter(Boolean).join(' · ');
            return `
                <div class="menu-tool-trigger sidebar-radio__row${playing ? ' is-on-desktop' : ''}${offline ? ' sidebar-radio__row--offline' : ''}" data-radio-station="${escapeHtml(uuid)}" role="listitem">
                    ${favicon}
                    <span class="menu-tool-label sidebar-radio__row-label">
                        <span class="sidebar-radio__row-name u-truncate">${escapeHtml(station.name || 'Unknown')}</span>
                        ${meta ? `<span class="sidebar-radio__row-meta">${escapeHtml(meta)}</span>` : ''}
                    </span>
                    <button type="button" class="card-act sidebar-radio__star${fav ? ' is-active' : ''}" data-radio-star="${escapeHtml(uuid)}" title="${fav ? 'Remove favorite' : 'Add favorite'}" aria-label="${fav ? 'Remove favorite' : 'Add favorite'}" aria-pressed="${fav ? 'true' : 'false'}">${starIcon}</button>
                </div>
            `;
        }).join('');
    },

    handlePlayerState(detail) {
        this.updateTransport(detail);
        this.renderStationList();
    },

    updateTransport(detail = null) {
        const state = detail || {
            station: RadioPlayer.station,
            playing: RadioPlayer.playing,
            loading: RadioPlayer.loading,
            error: RadioPlayer.error,
            volume: RadioPlayer.volume
        };

        const titleEl = this.root?.querySelector('[data-radio-title]');
        const faviconEl = this.root?.querySelector('[data-radio-favicon]');
        const playIconEl = this.root?.querySelector('[data-radio-play-icon]');
        const volumeEl = this.root?.querySelector('[data-radio-volume]');
        const transport = this.root?.querySelector('[data-radio-transport]');

        if (titleEl) {
            if (state.error) {
                titleEl.textContent = state.error;
                titleEl.classList.add('sidebar-radio__title--error');
            } else if (state.station?.name) {
                titleEl.textContent = state.station.name;
                titleEl.classList.remove('sidebar-radio__title--error');
            } else {
                titleEl.textContent = 'Radio';
                titleEl.classList.remove('sidebar-radio__title--error');
            }
        }

        if (faviconEl) {
            const favicon = state.station?.favicon;
            if (favicon) {
                faviconEl.src = favicon;
                faviconEl.classList.remove('is-hidden');
            } else {
                faviconEl.removeAttribute('src');
                faviconEl.classList.add('is-hidden');
            }
        }

        if (playIconEl) {
            if (state.loading) {
                playIconEl.textContent = '…';
            } else if (state.playing) {
                playIconEl.innerHTML = '<span class="sidebar-radio__pause-bars" aria-hidden="true"><span></span><span></span></span>';
            } else {
                playIconEl.innerHTML = '<span class="sidebar-radio__play-triangle" aria-hidden="true"></span>';
            }
        }

        if (volumeEl && Number.isFinite(state.volume)) {
            volumeEl.value = String(Math.round(state.volume * 100));
        }

        transport?.classList.toggle('sidebar-radio__transport--active', !!(state.station || state.playing || state.loading));
    }
};
