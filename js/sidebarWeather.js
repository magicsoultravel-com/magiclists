/** @module {"owns":"sidebar weather glance and forecast panel", "related":["weatherApi.js","weatherProviders/registry.js","sidebarModules.js"]} */
import { WeatherApi } from './weatherApi.js';
import { escapeHtml } from './radioUtils.js';
import { ACTION_ICONS } from './icons.js';
import { renderSidebarModuleHeaderHtml } from './sidebarModules.js';
import { conditionLabel, weatherIconSvg, weatherIconSvgFromCode } from './weatherProviders/weatherIcons.js';

const REFRESH_ICON = ACTION_ICONS.resetCustomization;

export const SidebarWeather = {
    root: null,
    settingsOpen: false,
    onStateChanged: null,

    init() {
        this.root = document.getElementById('sidebar-weather');
        if (!this.root) return;

        this.renderShell();
        this.bindShellListeners();

        this.onStateChanged = () => this.renderContent();
        window.addEventListener('weather:state_changed', this.onStateChanged);

        WeatherApi.startPolling();
        this.renderContent();
    },

    destroy() {
        WeatherApi.stopPolling();
        if (this.onStateChanged) {
            window.removeEventListener('weather:state_changed', this.onStateChanged);
        }
    },

    renderShell() {
        const extrasHtml = `
                <div class="sidebar-weather__compact" data-weather-compact>
                    <span class="sidebar-weather__compact-icon" data-weather-compact-icon></span>
                    <span class="sidebar-weather__compact-temp" data-weather-compact-temp>—</span>
                </div>
                <button type="button" class="btn btn--compact btn-icon sidebar-weather__refresh" data-weather-refresh title="Refresh weather" aria-label="Refresh weather">${REFRESH_ICON}</button>`;
        this.root.innerHTML = `
            ${renderSidebarModuleHeaderHtml({ headerId: 'weather-section-header', title: 'Weather', extrasHtml })}
            <div class="collapsable-section" id="weather-section">
                <div class="sidebar-weather__body" data-weather-body></div>
            </div>
        `;
    },

    bindShellListeners() {
        this.root.querySelector('[data-weather-refresh]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            WeatherApi.refresh({ force: true }).catch(() => {});
        });
    },

    renderContent() {
        const { snapshot, loading, lastRefreshAt, settings } = WeatherApi.getState();
        this.updateCompact(snapshot, loading);
        const body = this.root?.querySelector('[data-weather-body]');
        if (!body) return;

        if (loading && !snapshot) {
            body.innerHTML = '<p class="tool-msg sidebar-weather__msg">Loading forecast…</p>';
            return;
        }

        if (!snapshot) {
            body.innerHTML = '<p class="tool-msg sidebar-weather__msg">Weather data unavailable.</p>';
            return;
        }

        body.innerHTML = this.buildExpandedHtml(snapshot, lastRefreshAt, settings);
        this.bindExpandedListeners(settings);
    },

    updateCompact(snapshot, loading) {
        const tempEl = this.root?.querySelector('[data-weather-compact-temp]');
        const iconEl = this.root?.querySelector('[data-weather-compact-icon]');
        const refreshBtn = this.root?.querySelector('[data-weather-refresh]');

        refreshBtn?.classList.toggle('sidebar-weather__refresh--loading', !!loading);

        if (!snapshot?.current) {
            tempEl.textContent = loading ? '…' : '—';
            if (iconEl) iconEl.innerHTML = '';
            return;
        }

        const current = snapshot.current;
        tempEl.textContent = current.temp != null ? `${Math.round(current.temp)}°` : '—';
        if (iconEl) {
            iconEl.innerHTML = weatherIconSvgFromCode(current.icon, current, { size: 16 });
        }
    },

    isSourceEnabled(settings, id) {
        const providers = WeatherApi.listProviders();
        const enabled = settings.enabledSources?.length
            ? settings.enabledSources
            : providers.filter((p) => p.defaultEnabled).map((p) => p.id);
        return enabled.includes(id);
    },

    buildExpandedHtml(snapshot, lastRefreshAt, settings) {
        const current = snapshot.current || {};
        const hourly = (snapshot.hourly || []).slice(0, 12);
        const daily = (snapshot.daily || []).slice(0, 4);
        const stale = snapshot.sources?.some((s) => s.stale);
        const forecastError = (snapshot.errors || []).find((e) =>
            e.providerId === 'open-meteo-forecast' || e.providerId === 'imgw-forecast'
        );
        const cityLabel = settings.label || snapshot.location?.label || '';
        const locations = WeatherApi.listLocations();
        const locationOptions = locations.map((loc) => {
            const sel = loc.id === settings.locationId ? 'selected' : '';
            return `<option value="${escapeHtml(loc.id)}" ${sel}>${escapeHtml(loc.label)}</option>`;
        }).join('');
        const pogodaUrl = WeatherApi.getPogodaUrl(settings.lat, settings.lon);
        const showSynop = this.isSourceEnabled(settings, 'imgw-synop') && snapshot.observation?.stationName;
        const showWarnings = this.isSourceEnabled(settings, 'imgw-warnings') && (snapshot.alerts?.length || 0) > 0;
        const providers = WeatherApi.listProviders();
        const enabled = new Set(
            settings.enabledSources?.length
                ? settings.enabledSources
                : providers.filter((p) => p.defaultEnabled).map((p) => p.id)
        );

        const hourlyHtml = hourly.map((h) => {
            const time = formatHour(h.date);
            const temp = h.temp != null ? `${Math.round(h.temp)}°` : '—';
            return `<div class="sidebar-weather__hour" title="${escapeHtml(conditionLabel(h.condition))}">
                <span class="sidebar-weather__hour-time">${escapeHtml(time)}</span>
                <span class="sidebar-weather__hour-icon">${weatherIconSvgFromCode(h.icon, h, { size: 20 })}</span>
                <span class="sidebar-weather__hour-temp">${escapeHtml(temp)}</span>
            </div>`;
        }).join('');

        const dailyHtml = daily.map((d) => {
            const day = formatDayShort(d.date);
            const hi = d.tempMax != null ? `${Math.round(d.tempMax)}°` : '—';
            const lo = d.tempMin != null ? `${Math.round(d.tempMin)}°` : '—';
            return `<div class="sidebar-weather__day" title="${escapeHtml(conditionLabel(d.condition))}">
                <span class="sidebar-weather__day-name">${escapeHtml(day)}</span>
                <span class="sidebar-weather__day-icon">${weatherIconSvgFromCode(d.icon, d, { size: 22 })}</span>
                <span class="sidebar-weather__day-temps"><span class="sidebar-weather__day-hi">${escapeHtml(hi)}</span><span class="sidebar-weather__day-lo">${escapeHtml(lo)}</span></span>
            </div>`;
        }).join('');

        const alertsHtml = showWarnings
            ? snapshot.alerts.map((a) => `<div class="sidebar-weather__alert sidebar-weather__alert--level-${Math.min(3, Math.max(1, a.level || 1))}">
                <div class="sidebar-weather__alert-name">${escapeHtml(a.name)}</div>
                ${a.text ? `<div class="sidebar-weather__alert-text">${escapeHtml(a.text)}</div>` : ''}
            </div>`).join('')
            : '';

        const sourceToggles = providers.map((p) => {
            const checked = enabled.has(p.id) ? 'checked' : '';
            return `<label class="sidebar-weather__source-toggle list-row">
                <span>${escapeHtml(p.label)}</span>
                <input type="checkbox" data-weather-source="${escapeHtml(p.id)}" ${checked}>
            </label>`;
        }).join('');

        return `
            <div class="sidebar-weather__now">
                <span class="sidebar-weather__now-icon">${weatherIconSvgFromCode(current.icon, current, { size: 36 })}</span>
                <div class="sidebar-weather__now-meta">
                    ${cityLabel ? `<span class="sidebar-weather__now-place">${escapeHtml(cityLabel)}</span>` : ''}
                    <span class="sidebar-weather__now-temp">${current.temp != null ? `${Math.round(current.temp)}°` : '—'}</span>
                    <span class="sidebar-weather__now-label">${escapeHtml(conditionLabel(current.condition))}</span>
                    ${current.feelsLike != null ? `<span class="sidebar-weather__now-feels">Feels ${Math.round(current.feelsLike)}°</span>` : ''}
                </div>
            </div>
            ${hourly.length ? `
            <div class="sidebar-weather__block">
                <div class="sidebar-weather__block-title">Next hours</div>
                <div class="sidebar-weather__hourly" aria-label="Hourly forecast">${hourlyHtml}</div>
            </div>` : ''}
            ${daily.length ? `
            <div class="sidebar-weather__block">
                <div class="sidebar-weather__block-title">Next days</div>
                <div class="sidebar-weather__daily" aria-label="Daily forecast">${dailyHtml}</div>
            </div>` : ''}
            ${showSynop ? `<div class="sidebar-weather__synop">Synop ${escapeHtml(snapshot.observation.stationName)}${snapshot.observation.temp != null ? ` · ${Math.round(snapshot.observation.temp)}°` : ''}</div>` : ''}
            ${alertsHtml ? `<div class="sidebar-weather__alerts">${alertsHtml}</div>` : ''}
            ${forecastError ? `<p class="tool-msg sidebar-weather__msg sidebar-weather__msg--warn">${escapeHtml(forecastError.message)}</p>` : ''}
            <div class="sidebar-weather__footer">
                <span class="sidebar-weather__updated">${formatUpdated(lastRefreshAt, stale)}</span>
                <a class="sidebar-weather__link" href="${escapeHtml(pogodaUrl)}" target="_blank" rel="noopener noreferrer">IMGW ↗</a>
            </div>
            <div class="sidebar-weather__settings">
                <button type="button" class="btn btn--compact sidebar-weather__settings-toggle" data-weather-settings-toggle aria-expanded="${this.settingsOpen}">
                    ${this.settingsOpen ? 'Hide settings' : 'Settings'}
                </button>
                <div class="sidebar-weather__settings-panel ${this.settingsOpen ? '' : 'is-hidden'}" data-weather-settings-panel>
                    <label class="form-group">
                        <span>Location</span>
                        <select class="form-input" data-weather-location aria-label="Weather location">${locationOptions}</select>
                    </label>
                    <label class="form-group">
                        <span>Refresh (min)</span>
                        <input type="number" min="5" max="120" step="5" class="form-input" data-weather-refresh-min value="${settings.refreshMinutes || 15}">
                    </label>
                    <div class="sidebar-weather__sources">${sourceToggles}</div>
                    <button type="button" class="btn btn--compact" data-weather-save-settings>Save &amp; refresh</button>
                </div>
            </div>
        `;
    },

    bindExpandedListeners(settings) {
        this.root.querySelector('[data-weather-settings-toggle]')?.addEventListener('click', () => {
            this.settingsOpen = !this.settingsOpen;
            this.renderContent();
        });

        this.root.querySelector('[data-weather-save-settings]')?.addEventListener('click', () => {
            const locationId = this.root.querySelector('[data-weather-location]')?.value;
            const refreshMinutes = parseInt(this.root.querySelector('[data-weather-refresh-min]')?.value, 10);
            const enabledSources = [...this.root.querySelectorAll('[data-weather-source]')]
                .filter((el) => el.checked)
                .map((el) => el.dataset.weatherSource);

            if (!locationId) return;

            WeatherApi.saveSettings({
                locationId,
                refreshMinutes: Number.isFinite(refreshMinutes) ? refreshMinutes : 15,
                enabledSources: enabledSources.length ? enabledSources : ['open-meteo-forecast']
            });
            WeatherApi.restartPolling();
        });
    }
};

function formatHour(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
        return '—';
    }
}

function formatDayShort(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });
    } catch {
        return '—';
    }
}

function formatUpdated(ts, stale) {
    if (!ts) return stale ? 'Stale cache' : 'Not updated yet';
    const when = new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    return stale ? `Updated ${when} (stale)` : `Updated ${when}`;
}
