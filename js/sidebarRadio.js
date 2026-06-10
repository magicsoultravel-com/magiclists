import { RadioBrowserApi } from './radioBrowserApi.js';
import { RadioPlayer } from './radioPlayer.js';
import { RadioPopover } from './radioPopover.js';
import { clampPanelToViewport } from './popoverPosition.js';
import { escapeHtml, countryFlagEmoji, debounce } from './radioUtils.js';
import { ACTION_ICONS, CARD_ICONS } from './ui.js';

export const SidebarRadio = {
    root: null,
    countries: [],
    countryFilter: '',
    browseView: 'countries',
    browseCountry: null,
    browseStations: [],
    listStations: [],
    loadSeq: 0,
    onStateChanged: null,

    init() {
        this.root = document.getElementById('sidebar-radio');
        if (!this.root) return;

        RadioPlayer.init();
        this.renderShell();
        this.bindShellListeners();
        this.onStateChanged = (e) => {
            this.updateTransport(e.detail);
            if (RadioPopover.mode && !RadioPopover.panel?.classList.contains('is-hidden')) {
                this.refreshOpenPanel();
            }
        };
        window.addEventListener('radio:state_changed', this.onStateChanged);
        this.updateTransport();
        this.restoreLastStationMeta();
        this.prefetchCountries();
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
        const brandHost = document.getElementById('side-panel-brand-host');
        if (brandHost && this.root.parentElement === document.body) {
            brandHost.insertAdjacentElement('afterend', this.root);
        }
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
            if (e.button !== 0) return;

            e.preventDefault();
            let dragging = true;
            const startX = e.clientX;
            const startY = e.clientY;
            const startLeft = parseFloat(this.root.style.left) || 0;
            const startTop = parseFloat(this.root.style.top) || 0;

            this.root.classList.add('sidebar-radio--dragging');
            header.setPointerCapture(e.pointerId);

            const onMove = (ev) => {
                if (!dragging) return;
                const x = startLeft + (ev.clientX - startX);
                const y = startTop + (ev.clientY - startY);
                const clamped = clampPanelToViewport(this.root, x, y);
                this.root.style.left = `${clamped.x}px`;
                this.root.style.top = `${clamped.y}px`;
                RadioPopover.reposition();
            };

            const onUp = (ev) => {
                if (!dragging) return;
                dragging = false;
                this.root.classList.remove('sidebar-radio--dragging');
                header.releasePointerCapture(ev.pointerId);
                const x = parseFloat(this.root.style.left) || 0;
                const y = parseFloat(this.root.style.top) || 0;
                RadioPlayer.saveMiniPlayerState({ miniPlayerX: x, miniPlayerY: y });
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
        const uuid = RadioPlayer.station?.stationuuid;
        if (!uuid) return;
        try {
            const station = await RadioBrowserApi.getStationByUuid(uuid);
            if (station) {
                RadioPlayer.station = station;
                RadioPlayer.emitState();
            }
        } catch {
            /* keep fallback name */
        }
    },

    async prefetchCountries() {
        try {
            this.countries = await RadioBrowserApi.getCountries();
            if (!Array.isArray(this.countries)) this.countries = [];
        } catch {
            this.countries = [];
        }
    },

    renderShell() {
        this.root.innerHTML = `
            <div class="collapsable-header list-row--header" id="radio-section-header">
                <span class="collapsable-heading"><span class="collapsable-toggle">▼</span>Radio</span>
                <button type="button" class="card-act sidebar-radio__dock" data-radio-dock title="Undock to canvas" aria-label="Undock to canvas">${CARD_ICONS.unpin}</button>
            </div>
            <div class="collapsable-section" id="radio-section">
                <div class="sidebar-radio__transport" data-radio-transport>
                    <button type="button" class="btn btn--compact btn-icon sidebar-radio__play" data-radio-play aria-label="Play or pause">
                        <span data-radio-play-icon></span>
                    </button>
                    <span class="sidebar-radio__flag is-hidden" data-radio-flag aria-hidden="true"></span>
                    <img class="sidebar-radio__favicon is-hidden" data-radio-favicon alt="" width="14" height="14">
                    <span class="sidebar-radio__title u-truncate" data-radio-title>Radio</span>
                    <button type="button" class="card-act sidebar-radio__favorite is-hidden" data-radio-favorite title="Add favorite" aria-label="Add favorite" aria-pressed="false">${CARD_ICONS.heart}</button>
                    <input type="range" class="sidebar-radio__volume" data-radio-volume min="0" max="100" value="85" aria-label="Volume">
                </div>
                <div class="sidebar-radio__actions">
                    <button type="button" class="btn btn--compact btn-icon sidebar-radio__action" data-radio-open="browse" title="Browse stations" aria-label="Browse stations" aria-expanded="false" aria-haspopup="dialog">${ACTION_ICONS.radioBrowse}</button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-radio__action" data-radio-open="favorites" title="Favorites" aria-label="Favorites" aria-expanded="false" aria-haspopup="dialog">${CARD_ICONS.star}</button>
                    <button type="button" class="btn btn--compact btn-icon sidebar-radio__action" data-radio-open="recents" title="Recents" aria-label="Recents" aria-expanded="false" aria-haspopup="dialog">${ACTION_ICONS.radioRecents}</button>
                </div>
            </div>
        `;
    },

    bindShellListeners() {
        this.root.querySelector('[data-radio-play]')?.addEventListener('click', () => {
            RadioPlayer.toggle();
        });

        this.root.querySelector('[data-radio-favorite]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const station = RadioPlayer.station;
            if (!station?.stationuuid) return;
            RadioPlayer.toggleFavorite(station);
            if (RadioPopover.mode && !RadioPopover.panel?.classList.contains('is-hidden')) {
                this.refreshOpenPanel();
            }
        });

        const volumeEl = this.root.querySelector('[data-radio-volume]');
        volumeEl?.addEventListener('input', (e) => {
            RadioPlayer.setVolume(Number(e.target.value) / 100);
        });
        if (volumeEl) {
            volumeEl.value = String(Math.round(RadioPlayer.volume * 100));
        }

        this.root.querySelectorAll('[data-radio-open]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const mode = btn.getAttribute('data-radio-open');
                this.openPanel(mode, btn);
            });
        });
    },

    openPanel(mode, anchor) {
        this.root.querySelectorAll('[data-radio-open]').forEach((btn) => {
            if (btn !== anchor) btn.setAttribute('aria-expanded', 'false');
        });

        const titles = { browse: 'Browse', favorites: 'Favorites', recents: 'Recents' };
        RadioPopover.onClose = () => {
            this.root.querySelectorAll('[data-radio-open]').forEach((btn) => {
                btn.setAttribute('aria-expanded', 'false');
            });
        };

        if (mode === 'browse') {
            this.browseView = 'countries';
            this.browseCountry = null;
            this.countryFilter = '';
        }

        RadioPopover.open(mode, {
            attachEl: this.root,
            iconAnchor: anchor,
            title: titles[mode] || 'Radio'
        });
        this.renderPanelContent(mode);
    },

    async refreshOpenPanel() {
        await this.renderPanelContent(RadioPopover.mode);
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
        }
    },

    async renderBrowseCountries() {
        RadioPopover.setTitle('Browse');
        RadioPopover.setBackVisible(false);
        RadioPopover.setToolbarHtml(`
            <input type="search" class="form-input sidebar-radio__search" data-radio-country-search placeholder="Filter countries…" aria-label="Filter countries" autocomplete="off" spellcheck="false" value="${escapeHtml(this.countryFilter)}">
        `);

        const body = RadioPopover.getBodyEl();
        if (!body) return;
        body.innerHTML = '<p class="tool-msg">Loading…</p>';

        if (!this.countries.length) {
            await this.prefetchCountries();
        }

        const searchEl = RadioPopover.getToolbarEl()?.querySelector('[data-radio-country-search]');
        searchEl?.addEventListener('input', debounce((e) => {
            this.countryFilter = e.target.value.trim().toLowerCase();
            this.renderBrowseCountries();
        }, 200));

        const recentsHtml = await this.buildRecentsStripHtml();
        const filtered = this.countries
            .slice()
            .sort((a, b) => (b.stationcount || 0) - (a.stationcount || 0))
            .filter((c) => {
                if (!this.countryFilter) return true;
                const name = (c.name || '').toLowerCase();
                const code = (c.iso_3166_1 || '').toLowerCase();
                return name.includes(this.countryFilter) || code.includes(this.countryFilter);
            });

        if (!filtered.length) {
            body.innerHTML = `${recentsHtml}<p class="tool-msg">No countries match.</p>`;
            return;
        }

        body.innerHTML = `
            ${recentsHtml}
            <div class="radio-tile-grid" data-radio-country-grid>
                ${filtered.map((c) => this.renderCountryTile(c)).join('')}
            </div>
        `;

        body.querySelector('[data-radio-see-recents]')?.addEventListener('click', (e) => {
            e.preventDefault();
            const btn = this.root.querySelector('[data-radio-open="recents"]');
            if (btn) this.openPanel('recents', btn);
        });

        body.querySelectorAll('[data-radio-country]').forEach((tile) => {
            tile.addEventListener('click', () => {
                const code = tile.getAttribute('data-radio-country');
                const name = tile.getAttribute('data-radio-country-name') || code;
                this.openBrowseCountry(code, name);
            });
        });

        this.bindStationTileActions(body);
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

    async buildRecentsStripHtml() {
        const uuids = RadioPlayer.getRecents().slice(0, 6);
        if (!uuids.length) return '';

        const stations = await RadioBrowserApi.getStationsByUuids(uuids);
        const byUuid = new Map(stations.map((s) => [s.stationuuid, s]));
        const ordered = uuids.map((id) => byUuid.get(id)).filter(Boolean);
        if (!ordered.length) return '';

        return `
            <div class="radio-recents-strip">
                <div class="radio-recents-strip__head">
                    <span class="radio-recents-strip__label">Recents</span>
                    <button type="button" class="btn btn--compact sidebar-radio__see-all" data-radio-see-recents>See all</button>
                </div>
                <div class="radio-recents-strip__grid">
                    ${ordered.map((s) => this.renderStationTile(s, { compact: true })).join('')}
                </div>
            </div>
        `;
    },

    async openBrowseCountry(code, name) {
        this.browseView = 'country';
        this.browseCountry = { code, name };
        await this.renderBrowseCountry();
    },

    async renderBrowseCountry() {
        const { code, name } = this.browseCountry || {};
        RadioPopover.setTitle(name || 'Stations');
        RadioPopover.setBackVisible(true, () => {
            this.browseView = 'countries';
            this.browseCountry = null;
            this.renderBrowseCountries();
        });
        RadioPopover.setToolbarHtml('');

        const body = RadioPopover.getBodyEl();
        if (!body) return;
        body.innerHTML = '<p class="tool-msg">Loading…</p>';

        const seq = ++this.loadSeq;
        try {
            const data = await RadioBrowserApi.searchStations({ countrycode: code, limit: 80 });
            if (seq !== this.loadSeq) return;
            this.browseStations = Array.isArray(data) ? data : [];
            if (!this.browseStations.length) {
                body.innerHTML = '<p class="tool-msg">No stations in this country.</p>';
            } else {
                body.innerHTML = `<div class="radio-tile-grid">${this.browseStations.map((s) => this.renderStationTile(s)).join('')}</div>`;
                this.bindStationTileActions(body);
            }
        } catch {
            if (seq !== this.loadSeq) return;
            body.innerHTML = '<p class="tool-msg tool-msg--error">Could not load stations.</p>';
        }
        RadioPopover.reposition();
    },

    async renderStationGrid(kind) {
        RadioPopover.setBackVisible(false);
        RadioPopover.setToolbarHtml('');
        RadioPopover.setTitle(kind === 'favorites' ? 'Favorites' : 'Recents');

        const body = RadioPopover.getBodyEl();
        if (!body) return;
        body.innerHTML = '<p class="tool-msg">Loading…</p>';

        const uuids = kind === 'favorites' ? RadioPlayer.getFavorites() : RadioPlayer.getRecents();
        if (!uuids.length) {
            body.innerHTML = `<p class="tool-msg">${kind === 'favorites' ? 'Star stations while browsing.' : 'Played stations appear here.'}</p>`;
            return;
        }

        const seq = ++this.loadSeq;
        try {
            const data = await RadioBrowserApi.getStationsByUuids(uuids);
            if (seq !== this.loadSeq) return;
            const byUuid = new Map(data.map((s) => [s.stationuuid, s]));
            this.listStations = uuids.map((id) => byUuid.get(id)).filter(Boolean);
            if (!this.listStations.length) {
                body.innerHTML = '<p class="tool-msg tool-msg--error">Stations unavailable.</p>';
            } else {
                body.innerHTML = `<div class="radio-tile-grid">${this.listStations.map((s) => this.renderStationTile(s)).join('')}</div>`;
                this.bindStationTileActions(body);
            }
        } catch {
            if (seq !== this.loadSeq) return;
            body.innerHTML = '<p class="tool-msg tool-msg--error">Could not load list.</p>';
        }
        RadioPopover.reposition();
    },

    renderStationTile(station, { compact = false } = {}) {
        const uuid = station.stationuuid;
        const fav = RadioPlayer.isFavorite(uuid);
        const playing = RadioPlayer.station?.stationuuid === uuid && (RadioPlayer.playing || RadioPlayer.loading);
        const starIcon = fav ? CARD_ICONS.starFilled : CARD_ICONS.star;
        const favicon = station.favicon
            ? `<img class="radio-tile__favicon" src="${escapeHtml(station.favicon)}" alt="" width="16" height="16" loading="lazy">`
            : '<span class="radio-tile__favicon radio-tile__favicon--fallback" aria-hidden="true">♪</span>';
        const flag = station.countrycode ? `<span class="radio-tile__badge" aria-hidden="true">${countryFlagEmoji(station.countrycode)}</span>` : '';

        return `
            <div class="radio-tile radio-tile--station${playing ? ' is-on-desktop' : ''}${compact ? ' radio-tile--compact' : ''}" data-radio-station="${escapeHtml(uuid)}" role="button" tabindex="0" title="${escapeHtml(station.name || '')}">
                ${favicon}
                ${flag}
                <span class="radio-tile__label u-truncate">${escapeHtml(station.name || 'Unknown')}</span>
                <button type="button" class="card-act radio-tile__star${fav ? ' is-active' : ''}" data-radio-star="${escapeHtml(uuid)}" title="${fav ? 'Remove favorite' : 'Add favorite'}" aria-label="${fav ? 'Remove favorite' : 'Add favorite'}" aria-pressed="${fav ? 'true' : 'false'}">${starIcon}</button>
            </div>
        `;
    },

    bindStationTileActions(container) {
        if (!container) return;

        container.querySelectorAll('[data-radio-star]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const uuid = btn.getAttribute('data-radio-star');
                const station = this.findStation(uuid);
                RadioPlayer.toggleFavorite(station || { stationuuid: uuid });
                this.refreshOpenPanel();
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
        return this.browseStations.find((s) => s.stationuuid === uuid)
            || this.listStations.find((s) => s.stationuuid === uuid)
            || null;
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
        const flagEl = this.root?.querySelector('[data-radio-flag]');
        const playIconEl = this.root?.querySelector('[data-radio-play-icon]');
        const volumeEl = this.root?.querySelector('[data-radio-volume]');
        const favBtn = this.root?.querySelector('[data-radio-favorite]');
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

        if (flagEl) {
            const code = state.station?.countrycode;
            if (code) {
                flagEl.textContent = countryFlagEmoji(code);
                flagEl.classList.remove('is-hidden');
            } else {
                flagEl.textContent = '';
                flagEl.classList.add('is-hidden');
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

        if (favBtn) {
            const uuid = state.station?.stationuuid;
            if (!uuid) {
                favBtn.classList.add('is-hidden');
                favBtn.setAttribute('aria-pressed', 'false');
            } else {
                const fav = RadioPlayer.isFavorite(uuid);
                favBtn.classList.remove('is-hidden');
                favBtn.classList.toggle('is-active', fav);
                favBtn.innerHTML = fav ? CARD_ICONS.heartFilled : CARD_ICONS.heart;
                favBtn.setAttribute('aria-pressed', fav ? 'true' : 'false');
                const label = fav ? 'Remove favorite' : 'Add favorite';
                favBtn.setAttribute('title', label);
                favBtn.setAttribute('aria-label', label);
            }
        }

        transport?.classList.toggle('sidebar-radio__transport--active', !!(state.station || state.playing || state.loading));
    }
};
