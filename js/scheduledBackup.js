/** @module {"owns":"scheduled local JSON/TXT/media auto-export timer and popover", "related":["backup.js","mediaBackup.js","app.js","noteQuickActions.js"]} */
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import { positionPopoverBelowAnchor } from './popoverPosition.js';
import {
    buildBackupPackage,
    hashExportFingerprint,
    readLastLocalExportAt,
    readLastLocalTxtExportAt,
    readLastMediaMetaExportAt,
    readLastMediaZipExportAt,
    serializeBackupPackage,
    writeLastLocalExportAt,
    writeLastLocalTxtExportAt,
    writeLastMediaMetaExportAt,
    writeLastMediaZipExportAt
} from './backup.js';
import {
    buildMediaMetaExportPayload,
    buildMediaZipExportPayload
} from './mediaBackup.js';
import { itemToTxtExportText, sortItemsForTxtExport } from './noteBodyConversion.js';
import { SidebarStats } from './sidebarStats.js';

const STORAGE_KEY = 'matrix_scheduled_export';
const DEFAULT_TITLE = 'Scheduled backup';
const RING_CIRCUMFERENCE = 2 * Math.PI * 11;

function clampAmount(value, { allowZero = false } = {}) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return allowZero ? 0 : 1;
    const min = allowZero ? 0 : 1;
    return Math.min(99, Math.max(min, n));
}

function normalizeNotesSection(raw, legacy) {
    const format = raw?.format === 'txt' ? 'txt' : 'json';
    return {
        enabled: raw?.enabled !== undefined ? !!raw.enabled : true,
        format,
        lastFingerprint: typeof raw?.lastFingerprint === 'string'
            ? raw.lastFingerprint
            : (typeof legacy?.lastFingerprint === 'string' ? legacy.lastFingerprint : null),
        lastExportAt: Number.isFinite(Number(raw?.lastExportAt)) ? Number(raw.lastExportAt) : null
    };
}

function normalizeMediaSection(raw) {
    const zipSnapshot = raw?.zipSnapshot && typeof raw.zipSnapshot === 'object' ? raw.zipSnapshot : {};
    return {
        enabled: !!raw?.enabled,
        incremental: !!raw?.incremental,
        lastMetaFingerprint: typeof raw?.lastMetaFingerprint === 'string' ? raw.lastMetaFingerprint : null,
        lastMetaExportAt: Number.isFinite(Number(raw?.lastMetaExportAt)) ? Number(raw.lastMetaExportAt) : null,
        lastZipFingerprint: typeof raw?.lastZipFingerprint === 'string' ? raw.lastZipFingerprint : null,
        lastZipExportAt: Number.isFinite(Number(raw?.lastZipExportAt)) ? Number(raw.lastZipExportAt) : null,
        lastZipMode: raw?.lastZipMode === 'incremental' ? 'incremental' : (raw?.lastZipMode === 'full' ? 'full' : null),
        zipSnapshot
    };
}

function normalizeConfig(raw) {
    const unit = raw?.unit === 'hours' ? 'hours' : 'minutes';
    const legacyFormat = raw?.format;
    const hasLegacyShape = legacyFormat != null && raw?.notes == null;
    return {
        enabled: !!raw?.enabled,
        paused: !!raw?.paused,
        amount: clampAmount(raw?.amount ?? 30, { allowZero: true }),
        unit,
        nextDueAt: Number.isFinite(Number(raw?.nextDueAt)) ? Number(raw.nextDueAt) : null,
        remainingMsWhenPaused: Number.isFinite(Number(raw?.remainingMsWhenPaused))
            ? Number(raw.remainingMsWhenPaused)
            : null,
        notes: normalizeNotesSection(raw?.notes, hasLegacyShape ? raw : null),
        media: normalizeMediaSection(raw?.media)
    };
}

function readConfig() {
    try {
        return normalizeConfig(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
    } catch {
        return normalizeConfig(null);
    }
}

function writeConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeConfig(config)));
}

function intervalMs(config) {
    const amount = clampAmount(config.amount, { allowZero: false });
    return amount * (config.unit === 'hours' ? 3600000 : 60000);
}

function formatRemaining(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    if (hours > 0) {
        return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    }
    return `${seconds}s`;
}

function formatRelativePast(unixSeconds) {
    if (!unixSeconds) return 'Never';
    const ms = Date.now() - unixSeconds * 1000;
    if (ms < 0) return 'just now';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 48) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    return `${days}d ago`;
}

function buildTxtContent(items) {
    const sortedItems = sortItemsForTxtExport([...(items || [])]);
    const sections = [];
    let currentCategory = null;

    sortedItems.forEach((item) => {
        const categories = Array.isArray(item?.categories) ? item.categories.filter(Boolean) : [];
        const itemCategory = categories.length > 0 ? categories[0] : 'Uncategorized';

        if (itemCategory !== currentCategory) {
            if (currentCategory !== null) sections.push('\n\n---\n\n');
            currentCategory = itemCategory;
        }

        const itemText = itemToTxtExportText(item);
        if (itemText) sections.push(itemText);
    });

    return sections.join('\n\n');
}

function downloadBlob(blob, filename) {
    const virtualLink = document.createElement('a');
    virtualLink.href = URL.createObjectURL(blob);
    virtualLink.download = filename;
    virtualLink.click();
    URL.revokeObjectURL(virtualLink.href);
}

function escapeAttr(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

function readNotesEnabledFromUi() {
    return !!document.querySelector('[data-schedule-notes-enabled]')?.checked;
}

function readMediaEnabledFromUi() {
    return !!document.querySelector('[data-schedule-media-enabled]')?.checked;
}

function readMediaIncrementalFromUi() {
    return !!document.querySelector('[data-schedule-media-incremental]')?.checked;
}

export const ScheduledBackup = {
    getItems: () => [],
    getLoggedIn: () => true,
    panel: null,
    anchor: null,
    tickId: null,
    busy: false,

    init({ getItems, getLoggedIn } = {}) {
        if (typeof getItems === 'function') this.getItems = getItems;
        if (typeof getLoggedIn === 'function') this.getLoggedIn = getLoggedIn;
        this.resumeFromStorage();
        this.syncButton();
    },

    resumeFromStorage() {
        const config = readConfig();
        if (!config.enabled) {
            this.stopTick();
            this.syncButton();
            return;
        }
        if (config.paused) {
            this.stopTick();
            this.syncButton();
            return;
        }
        if (!Number.isFinite(config.nextDueAt)) {
            config.nextDueAt = Date.now() + intervalMs(config);
            writeConfig(config);
        }
        this.startTick();
        this.syncButton();
    },

    handleClick(anchor) {
        const btn = anchor || document.getElementById('btn-schedule-export');
        if (!btn) return;
        if (this.panel && !this.panel.classList.contains('is-hidden') && this.anchor === btn) {
            this.close();
            return;
        }
        this.open(btn);
    },

    ensurePanel() {
        if (this.panel) return this.panel;
        const panel = document.createElement('div');
        panel.className = 'schedule-export-popover clock-style-popover is-hidden';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Scheduled backup');
        panel.innerHTML = `
            <div class="schedule-export-popover__header">
                <span class="schedule-export-popover__title">Scheduled backup</span>
                <button type="button" class="card-act schedule-export-popover__close" data-schedule-close title="Close" aria-label="Close">${CARD_ICONS.close}</button>
            </div>
            <div class="schedule-export-popover__body" data-schedule-body></div>
        `;
        document.body.appendChild(panel);
        panel.querySelector('[data-schedule-close]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });
        this.panel = panel;
        return panel;
    },

    open(anchor) {
        this.anchor = anchor;
        const panel = this.ensurePanel();
        this.renderBody();
        panel.classList.remove('is-hidden');
        positionPopoverBelowAnchor(panel, anchor);
        this.bindDismiss();
        anchor.setAttribute('aria-expanded', 'true');
    },

    close() {
        if (this.panel) this.panel.classList.add('is-hidden');
        this.unbindDismiss();
        this.anchor?.setAttribute('aria-expanded', 'false');
        this.anchor = null;
    },

    bindDismiss() {
        this.unbindDismiss();
        this.outsideHandler = (e) => {
            if (!this.panel || this.panel.classList.contains('is-hidden')) return;
            if (this.panel.contains(e.target)) return;
            if (this.anchor?.contains(e.target)) return;
            this.close();
        };
        this.keyHandler = (e) => {
            if (e.key === 'Escape') this.close();
        };
        document.addEventListener('mousedown', this.outsideHandler);
        document.addEventListener('keydown', this.keyHandler);
    },

    unbindDismiss() {
        if (this.outsideHandler) {
            document.removeEventListener('mousedown', this.outsideHandler);
            this.outsideHandler = null;
        }
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    },

    renderBody() {
        const body = this.panel?.querySelector('[data-schedule-body]');
        if (!body) return;
        const config = readConfig();
        const remaining = this.getRemainingMs(config);
        const statusLine = config.enabled
            ? (config.paused
                ? `Paused · ${formatRemaining(remaining)} left`
                : `Running · ${formatRemaining(remaining)} left`)
            : 'Off';

        const jsonLast = readLastLocalExportAt();
        const txtLast = readLastLocalTxtExportAt();
        const metaLast = readLastMediaMetaExportAt();
        const zipLast = readLastMediaZipExportAt();
        const zipModeLabel = config.media.lastZipMode === 'incremental' ? 'incr' : 'full';

        body.innerHTML = `
            <div class="schedule-export-popover__field">
                <span class="schedule-export-popover__label">Interval</span>
                <div class="schedule-export-popover__interval">
                    <input type="range" min="0" max="99" value="${escapeAttr(config.amount)}" data-schedule-amount aria-label="Interval amount">
                    <span class="schedule-export-popover__amount" data-schedule-amount-label>${escapeAttr(config.amount)}</span>
                    <select class="schedule-export-popover__unit" data-schedule-unit aria-label="Interval unit">
                        <option value="minutes"${config.unit === 'minutes' ? ' selected' : ''}>minutes</option>
                        <option value="hours"${config.unit === 'hours' ? ' selected' : ''}>hours</option>
                    </select>
                </div>
            </div>
            <p class="schedule-export-popover__meta" data-schedule-status>${escapeAttr(statusLine)}</p>
            <div class="schedule-export-popover__section">
                <label class="schedule-export-popover__section-head">
                    <input type="checkbox" data-schedule-notes-enabled${config.notes.enabled ? ' checked' : ''}>
                    <span>NOTES</span>
                </label>
                <div class="schedule-export-popover__section-body">
                    <div class="schedule-export-popover__field">
                        <span class="schedule-export-popover__label">Export type</span>
                        <div class="schedule-export-popover__seg" role="group" aria-label="Notes export type">
                            <button type="button" class="schedule-export-popover__seg-btn${config.notes.format === 'json' ? ' is-active' : ''}" data-schedule-notes-format="json">JSON</button>
                            <button type="button" class="schedule-export-popover__seg-btn${config.notes.format === 'txt' ? ' is-active' : ''}" data-schedule-notes-format="txt">TXT</button>
                        </div>
                    </div>
                    <p class="schedule-export-popover__meta">Last: JSON ${escapeAttr(formatRelativePast(jsonLast))} · TXT ${escapeAttr(formatRelativePast(txtLast))}</p>
                </div>
            </div>
            <div class="schedule-export-popover__section">
                <label class="schedule-export-popover__section-head">
                    <input type="checkbox" data-schedule-media-enabled${config.media.enabled ? ' checked' : ''}>
                    <span>MEDIA</span>
                </label>
                <div class="schedule-export-popover__section-body">
                    <label class="schedule-export-popover__check">
                        <input type="checkbox" data-schedule-media-incremental${config.media.incremental ? ' checked' : ''}${config.media.enabled ? '' : ' disabled'}>
                        <span>Incremental content (meta always full)</span>
                    </label>
                    <p class="schedule-export-popover__meta schedule-export-popover__hint">Restore: import latest meta JSON, then ZIP files oldest → newest.</p>
                    <p class="schedule-export-popover__meta">Last: Meta ${escapeAttr(formatRelativePast(metaLast))} · ZIP ${escapeAttr(zipLast ? `${formatRelativePast(zipLast)} (${zipModeLabel})` : 'Never')}</p>
                </div>
            </div>
            <div class="schedule-export-popover__actions">
                ${config.enabled
                    ? `
                        <button type="button" class="btn btn--compact" data-schedule-toggle-pause>${config.paused ? 'Resume' : 'Pause'}</button>
                        <button type="button" class="btn btn--compact" data-schedule-stop>Stop</button>
                    `
                    : `<button type="button" class="btn btn--compact" data-schedule-start>Start</button>`}
            </div>
        `;

        body.querySelectorAll('[data-schedule-notes-format]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const next = readConfig();
                next.notes.format = btn.getAttribute('data-schedule-notes-format') === 'txt' ? 'txt' : 'json';
                writeConfig(next);
                this.renderBody();
            });
        });

        body.querySelector('[data-schedule-notes-enabled]')?.addEventListener('change', (e) => {
            const next = readConfig();
            next.notes.enabled = !!e.target.checked;
            writeConfig(next);
            this.renderBody();
        });

        body.querySelector('[data-schedule-media-enabled]')?.addEventListener('change', (e) => {
            const next = readConfig();
            next.media.enabled = !!e.target.checked;
            writeConfig(next);
            this.renderBody();
        });

        body.querySelector('[data-schedule-media-incremental]')?.addEventListener('change', (e) => {
            const next = readConfig();
            next.media.incremental = !!e.target.checked;
            writeConfig(next);
        });

        const amountInput = body.querySelector('[data-schedule-amount]');
        const amountLabel = body.querySelector('[data-schedule-amount-label]');
        amountInput?.addEventListener('input', () => {
            const display = clampAmount(amountInput.value, { allowZero: true });
            if (amountLabel) amountLabel.textContent = String(display);
            const next = readConfig();
            next.amount = display;
            if (next.enabled && !next.paused) {
                next.amount = clampAmount(display, { allowZero: false });
                next.nextDueAt = Date.now() + intervalMs(next);
                if (amountLabel) amountLabel.textContent = String(next.amount);
                if (amountInput) amountInput.value = String(next.amount);
            }
            writeConfig(next);
            this.syncButton();
        });

        body.querySelector('[data-schedule-unit]')?.addEventListener('change', (e) => {
            const next = readConfig();
            next.unit = e.target.value === 'hours' ? 'hours' : 'minutes';
            if (next.enabled && !next.paused) {
                next.nextDueAt = Date.now() + intervalMs(next);
            }
            writeConfig(next);
            this.syncButton();
            this.renderBody();
        });

        body.querySelector('[data-schedule-start]')?.addEventListener('click', () => this.start());
        body.querySelector('[data-schedule-toggle-pause]')?.addEventListener('click', () => {
            const cfg = readConfig();
            if (cfg.paused) this.resume();
            else this.pause();
        });
        body.querySelector('[data-schedule-stop]')?.addEventListener('click', () => this.stop());
    },

    readAmountFromUi() {
        const input = this.panel?.querySelector('[data-schedule-amount]');
        return clampAmount(input?.value, { allowZero: false });
    },

    persistUiTargets(config) {
        config.notes.enabled = readNotesEnabledFromUi();
        config.media.enabled = readMediaEnabledFromUi();
        config.media.incremental = readMediaIncrementalFromUi();
        return config;
    },

    start() {
        const config = this.persistUiTargets(readConfig());
        if (!config.notes.enabled && !config.media.enabled) {
            return;
        }
        config.enabled = true;
        config.paused = false;
        config.amount = this.readAmountFromUi();
        const unitEl = this.panel?.querySelector('[data-schedule-unit]');
        if (unitEl) config.unit = unitEl.value === 'hours' ? 'hours' : 'minutes';
        config.remainingMsWhenPaused = null;
        config.nextDueAt = Date.now() + intervalMs(config);
        writeConfig(config);
        this.startTick();
        this.syncButton();
        this.renderBody();
    },

    pause() {
        const config = readConfig();
        if (!config.enabled || config.paused) return;
        config.paused = true;
        config.remainingMsWhenPaused = this.getRemainingMs(config);
        writeConfig(config);
        this.stopTick();
        this.syncButton();
        this.renderBody();
    },

    resume() {
        const config = readConfig();
        if (!config.enabled || !config.paused) return;
        const remaining = Number.isFinite(config.remainingMsWhenPaused)
            ? Math.max(0, config.remainingMsWhenPaused)
            : intervalMs(config);
        config.paused = false;
        config.remainingMsWhenPaused = null;
        config.nextDueAt = Date.now() + remaining;
        writeConfig(config);
        this.startTick();
        this.syncButton();
        this.renderBody();
    },

    stop() {
        const config = readConfig();
        config.enabled = false;
        config.paused = false;
        config.nextDueAt = null;
        config.remainingMsWhenPaused = null;
        writeConfig(config);
        this.stopTick();
        this.syncButton();
        this.renderBody();
    },

    getRemainingMs(config = readConfig()) {
        if (!config.enabled) return 0;
        if (config.paused) {
            return Math.max(0, Number(config.remainingMsWhenPaused) || 0);
        }
        if (!Number.isFinite(config.nextDueAt)) return intervalMs(config);
        return Math.max(0, config.nextDueAt - Date.now());
    },

    startTick() {
        this.stopTick();
        this.tickId = window.setInterval(() => this.onTick(), 500);
        this.onTick();
    },

    stopTick() {
        if (this.tickId) {
            window.clearInterval(this.tickId);
            this.tickId = null;
        }
    },

    onTick() {
        const config = readConfig();
        if (!config.enabled || config.paused || !this.getLoggedIn()) {
            this.syncButton();
            this.refreshOpenStatus();
            return;
        }
        if (Number.isFinite(config.nextDueAt) && Date.now() >= config.nextDueAt) {
            this.fireExport(config);
            return;
        }
        this.syncButton();
        this.refreshOpenStatus();
    },

    refreshOpenStatus() {
        if (!this.panel || this.panel.classList.contains('is-hidden')) return;
        const status = this.panel.querySelector('[data-schedule-status]');
        if (!status) return;
        const config = readConfig();
        const remaining = this.getRemainingMs(config);
        status.textContent = config.enabled
            ? (config.paused
                ? `Paused · ${formatRemaining(remaining)} left`
                : `Running · ${formatRemaining(remaining)} left`)
            : 'Off';
    },

    async fireExport(config) {
        if (this.busy) return;
        this.busy = true;
        let statsDirty = false;
        try {
            if (config.notes.enabled) {
                statsDirty = await this.exportNotes(config) || statsDirty;
            }
            if (config.media.enabled) {
                statsDirty = await this.exportMedia(config) || statsDirty;
            }
            config.nextDueAt = Date.now() + intervalMs(config);
            writeConfig(config);
            if (statsDirty) SidebarStats.update();
        } catch (err) {
            console.warn('[ScheduledBackup] export failed', err);
            config.nextDueAt = Date.now() + intervalMs(config);
            writeConfig(config);
        } finally {
            this.busy = false;
            this.syncButton();
            if (this.panel && !this.panel.classList.contains('is-hidden')) {
                this.renderBody();
            }
        }
    },

    async exportNotes(config) {
        const payload = await this.buildNotesPayload(config.notes.format);
        const fingerprint = hashExportFingerprint(payload.textForFingerprint || payload.text);
        if (fingerprint === config.notes.lastFingerprint) return false;

        downloadBlob(payload.blob, payload.filename);
        const ts = payload.timestamp || Math.floor(Date.now() / 1000);
        config.notes.lastFingerprint = fingerprint;
        config.notes.lastExportAt = ts;
        if (config.notes.format === 'txt') {
            writeLastLocalTxtExportAt(ts);
        } else {
            writeLastLocalExportAt(ts);
        }
        return true;
    },

    async exportMedia(config) {
        let changed = false;
        const metaPayload = await buildMediaMetaExportPayload();
        const metaFp = hashExportFingerprint(metaPayload.textForFingerprint || metaPayload.text);
        if (metaFp !== config.media.lastMetaFingerprint) {
            downloadBlob(metaPayload.blob, metaPayload.filename);
            config.media.lastMetaFingerprint = metaFp;
            config.media.lastMetaExportAt = metaPayload.timestamp;
            writeLastMediaMetaExportAt(metaPayload.timestamp);
            changed = true;
        }

        const zipPayload = await buildMediaZipExportPayload({
            incremental: config.media.incremental,
            zipSnapshot: config.media.zipSnapshot
        });

        if (!zipPayload.skipped && zipPayload.textForFingerprint) {
            const zipFp = hashExportFingerprint(zipPayload.textForFingerprint);
            if (zipFp !== config.media.lastZipFingerprint) {
                downloadBlob(zipPayload.blob, zipPayload.filename);
                config.media.lastZipFingerprint = zipFp;
                config.media.lastZipExportAt = zipPayload.timestamp;
                config.media.lastZipMode = zipPayload.isIncremental ? 'incremental' : 'full';
                config.media.zipSnapshot = zipPayload.nextSnapshot;
                writeLastMediaZipExportAt(zipPayload.timestamp);
                changed = true;
            }
        } else if (!zipPayload.skipped && zipPayload.nextSnapshot) {
            config.media.zipSnapshot = zipPayload.nextSnapshot;
        }

        return changed;
    },

    async buildNotesPayload(format) {
        if (format === 'txt') {
            const text = buildTxtContent(this.getItems());
            return {
                text,
                blob: new Blob([text], { type: 'text/plain' }),
                filename: `matrix_all_notes_${new Date().toISOString().split('T')[0]}.txt`,
                timestamp: Math.floor(Date.now() / 1000)
            };
        }
        const backupPackage = await buildBackupPackage();
        const text = serializeBackupPackage(backupPackage);
        // Strip wall-clock fields so scheduled skip-if-unchanged stays stable.
        const { timestamp: _ts, media_library: mediaLib, ...stableRest } = backupPackage;
        const stableMedia = mediaLib && typeof mediaLib === 'object'
            ? (() => {
                const { exportedAt: _exportedAt, ...restMedia } = mediaLib;
                return restMedia;
            })()
            : mediaLib;
        const textForFingerprint = serializeBackupPackage({
            ...stableRest,
            media_library: stableMedia
        });
        return {
            text,
            textForFingerprint,
            blob: new Blob([text], { type: 'application/json' }),
            filename: `matrix_workspace_backup_${backupPackage.timestamp}.json`,
            timestamp: backupPackage.timestamp
        };
    },

    syncButton() {
        const btn = document.getElementById('btn-schedule-export');
        if (!btn) return;

        const config = readConfig();
        const armed = !!config.enabled;
        const paused = armed && !!config.paused;
        const remaining = this.getRemainingMs(config);
        const total = intervalMs(config);
        const progress = armed && total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0;

        btn.classList.toggle('is-armed', armed);
        btn.classList.toggle('is-paused', paused);
        btn.style.setProperty('--schedule-progress', String(progress));

        if (!btn.querySelector('.schedule-export-btn__ring')) {
            btn.innerHTML = `
                <svg class="schedule-export-btn__ring" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <circle class="schedule-export-btn__ring-track" cx="12" cy="12" r="11" fill="none" stroke-width="2"/>
                    <circle class="schedule-export-btn__ring-progress" cx="12" cy="12" r="11" fill="none" stroke-width="2"
                        stroke-dasharray="${RING_CIRCUMFERENCE}" stroke-dashoffset="0" transform="rotate(-90 12 12)"/>
                </svg>
                <span class="schedule-export-btn__icon">${ACTION_ICONS.scheduleExport}</span>
            `;
        }

        const progressCircle = btn.querySelector('.schedule-export-btn__ring-progress');
        if (progressCircle) {
            const offset = RING_CIRCUMFERENCE * (1 - progress);
            progressCircle.setAttribute('stroke-dashoffset', String(offset));
            progressCircle.style.opacity = armed ? '1' : '0';
        }

        if (armed) {
            const label = paused
                ? `Scheduled backup paused · ${formatRemaining(remaining)} left`
                : `Auto backup in ${formatRemaining(remaining)}`;
            btn.title = label;
            btn.setAttribute('aria-label', label);
        } else {
            btn.title = DEFAULT_TITLE;
            btn.setAttribute('aria-label', DEFAULT_TITLE);
        }
    }
};
