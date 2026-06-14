import { WeatherApi } from './weatherApi.js';
import { applySectionCollapse } from './hamburger.js';
import { escapeHtml } from './radioUtils.js';
import { ACTION_ICONS } from './ui.js';
import { conditionLabel, weatherIconSvg } from './weatherProviders/weatherIcons.js';

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
        this.root.innerHTML = `
            <div class="collapsable-header list-row--header" id="weather-section-header">
                <span class="collapsable-heading"><span class="collapsable-toggle">▼</span>Weather</span>
                <div class="sidebar-weather__compact" data-weather-compact>
                    <span class="sidebar-weather__compact-temp" data-weather-compact-temp>—</span>
                    <span class="sidebar-weather__compact-label" data-weather-compact-label></span>
                    <span class="sidebar-weather__alert-dot is-hidden" data-weather-alert-dot title="Active warnings"></span>
                </div>
                <button type="button" class="btn btn--compact btn-icon sidebar-weather__refresh" data-weather-refresh title="Refresh weather" aria-label="Refresh weather">${REFRESH_ICON}</button>
            </div>
            <div class="collapsable-section" id="weather-section">
                <div class="sidebar-weather__body" data-weather-body></div>
            </div>
        `;
        applySectionCollapse('weather-section', 'weather-section-header', true);
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
        const labelEl = this.root?.querySelector('[data-weather-compact-label]');
        const dotEl = this.root?.querySelector('[data-weather-alert-dot]');
        const refreshBtn = this.root?.querySelector('[data-weather-refresh]');

        refreshBtn?.classList.toggle('sidebar-weather__refresh--loading', !!loading);

        if (!snapshot?.current) {
            tempEl.textContent = loading ? '…' : '—';
            labelEl.textContent = '';
            dotEl?.classList.add('is-hidden');
            return;
        }

        const temp = snapshot.current.temp;
        tempEl.textContent = temp != null ? `${Math.round(temp)}°` : '—';
        labelEl.textContent = conditionLabel(snapshot.current.condition);
        const hasAlerts = (snapshot.alerts?.length || 0) > 0;
        dotEl?.classList.toggle('is-hidden', !hasAlerts);
    },

    buildExpandedHtml(snapshot, lastRefreshAt, settings) {
        const current = snapshot.current || {};
        const condition = current.condition || 'unknown';
        const hourly = (snapshot.hourly || []).slice(0, 12);
        const daily = (snapshot.daily || []).slice(0, 3);
        const obs = snapshot.observation;
        const alerts = snapshot.alerts || [];
        const stale = snapshot.sources?.some((s) => s.stale);
        const errors = snapshot.errors || [];
        const pogodaUrl = WeatherApi.getPogodaUrl(settings.lat, settings.lon);
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
                <span class="sidebar-weather__hour-icon">${weatherIconSvg(h.condition, { size: 14 })}</span>
                <span class="sidebar-weather__hour-temp">${escapeHtml(temp)}</span>
            </div>`;
        }).join('');

        const dailyHtml = daily.map((d) => {
            const day = formatDay(d.date);
            const range = d.tempMin != null && d.tempMax != null
                ? `${Math.round(d.tempMin)}° / ${Math.round(d.tempMax)}°`
                : '—';
            return `<div class="sidebar-weather__day">
                <span class="sidebar-weather__day-name">${escapeHtml(day)}</span>
                <span class="sidebar-weather__day-icon">${weatherIconSvg(d.condition, { size: 14 })}</span>
                <span class="sidebar-weather__day-range">${escapeHtml(range)}</span>
            </div>`;
        }).join('');

        const alertsHtml = alerts.length
            ? alerts.map((a) => `<div class="sidebar-weather__alert sidebar-weather__alert--level-${Math.min(3, Math.max(1, a.level || 1))}">
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
            <div class="sidebar-weather__current">
                <div class="sidebar-weather__current-main">
                    <span class="sidebar-weather__current-icon">${weatherIconSvg(condition, { size: 28 })}</span>
                    <div class="sidebar-weather__current-temps">
                        <span class="sidebar-weather__current-temp">${current.temp != null ? `${Math.round(current.temp)}°` : '—'}</span>
                        <span class="sidebar-weather__current-feels">${current.feelsLike != null ? `Feels ${Math.round(current.feelsLike)}°` : ''}</span>
                    </div>
                </div>
                <div class="sidebar-weather__current-meta">
                    ${metaChip('Wind', formatWind(current.windSpeed, current.windDir))}
                    ${metaChip('Humidity', current.humidity != null ? `${Math.round(current.humidity)}%` : null)}
                    ${metaChip('Pressure', current.pressure != null ? `${Math.round(current.pressure)} hPa` : null)}
                </div>
            </div>
            ${obs?.stationName ? `<div class="sidebar-weather__synop">Nearest synop: <strong>${escapeHtml(obs.stationName)}</strong>${obs.temp != null ? ` · ${Math.round(obs.temp)}°` : ''}${obs.distanceKm != null ? ` · ${obs.distanceKm} km` : ''}</div>` : ''}
            ${hourly.length ? `<div class="sidebar-weather__hourly" aria-label="Hourly forecast">${hourlyHtml}</div>` : ''}
            ${daily.length ? `<div class="sidebar-weather__daily" aria-label="Daily forecast">${dailyHtml}</div>` : ''}
            ${alertsHtml ? `<div class="sidebar-weather__alerts">${snapshot.alertsUnfiltered ? '<p class="sidebar-weather__alerts-note">Showing broader warnings — area filter uncertain.</p>' : ''}${alertsHtml}</div>` : ''}
            ${errors.length ? `<p class="tool-msg sidebar-weather__msg sidebar-weather__msg--warn">${escapeHtml(errors.map((e) => e.message).join(' · '))}</p>` : ''}
            <div class="sidebar-weather__footer">
                <span class="sidebar-weather__updated">${formatUpdated(lastRefreshAt, stale)}</span>
                <a class="sidebar-weather__link" href="${escapeHtml(pogodaUrl)}" target="_blank" rel="noopener noreferrer">IMGW pogoda ↗</a>
            </div>
            <div class="sidebar-weather__settings">
                <button type="button" class="btn btn--compact sidebar-weather__settings-toggle" data-weather-settings-toggle aria-expanded="${this.settingsOpen}">
                    ${this.settingsOpen ? 'Hide settings' : 'Settings'}
                </button>
                <div class="sidebar-weather__settings-panel ${this.settingsOpen ? '' : 'is-hidden'}" data-weather-settings-panel>
                    <label class="form-group">
                        <span>Label</span>
                        <input type="text" class="form-input" data-weather-label value="${escapeHtml(settings.label || '')}" autocomplete="off">
                    </label>
                    <div class="sidebar-weather__coords">
                        <label class="form-group">
                            <span>Lat</span>
                            <input type="number" step="any" class="form-input" data-weather-lat value="${settings.lat}">
                        </label>
                        <label class="form-group">
                            <span>Lon</span>
                            <input type="number" step="any" class="form-input" data-weather-lon value="${settings.lon}">
                        </label>
                    </div>
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
            const label = this.root.querySelector('[data-weather-label]')?.value?.trim() || settings.label;
            const lat = parseFloat(this.root.querySelector('[data-weather-lat]')?.value);
            const lon = parseFloat(this.root.querySelector('[data-weather-lon]')?.value);
            const refreshMinutes = parseInt(this.root.querySelector('[data-weather-refresh-min]')?.value, 10);
            const enabledSources = [...this.root.querySelectorAll('[data-weather-source]')]
                .filter((el) => el.checked)
                .map((el) => el.dataset.weatherSource);

            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

            WeatherApi.saveSettings({
                label,
                lat,
                lon,
                refreshMinutes: Number.isFinite(refreshMinutes) ? refreshMinutes : 15,
                enabledSources: enabledSources.length ? enabledSources : null
            });
            WeatherApi.restartPolling();
        });
    }
};

function metaChip(label, value) {
    if (!value) return '';
    return `<span class="sidebar-weather__chip"><span class="sidebar-weather__chip-label">${escapeHtml(label)}</span> ${escapeHtml(value)}</span>`;
}

function formatWind(speed, dir) {
    if (speed == null) return null;
    const s = `${Math.round(speed)} m/s`;
    if (dir == null) return s;
    return `${s} · ${Math.round(dir)}°`;
}

function formatHour(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
        return '—';
    }
}

function formatDay(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    } catch {
        return '—';
    }
}

function formatUpdated(ts, stale) {
    if (!ts) return stale ? 'Stale cache' : 'Not updated yet';
    const when = new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    return stale ? `Updated ${when} (stale)` : `Updated ${when}`;
}
