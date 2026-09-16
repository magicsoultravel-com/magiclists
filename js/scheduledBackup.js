/** @module {"owns":"scheduled local JSON/TXT/media auto-export timer and popover", "related":["backup.js","mediaBackup.js","app.js","noteQuickActions.js"]} */
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import { positionPopoverBelowAnchor } from './popoverPosition.js';
import {
    buildBoardExportPayload,
    buildCanvasExportPayload,
    buildFullBackupArchivePayload,
    buildNotesExportPayload,
    hashExportFingerprint,
    readLastLocalExportAt,
    readLastLocalTxtExportAt,
    readLastMediaMetaExportAt,
    readLastMediaZipExportAt,
    txtExportFilename,
    writeLastLocalExportAt,
    writeLastLocalTxtExportAt,
    writeLastMediaMetaExportAt,
    writeLastMediaZipExportAt
} from './backup.js';
import {
    buildMediaMetaExportPayload,
    buildMediaZipExportPayload
} from './mediaBackup.js';
import { normalizeNotesSnapshot } from './backupDelta.js';
import { itemToTxtExportText, sortItemsForTxtExport } from './noteBodyConversion.js';
import { SidebarStats } from './sidebarStats.js';
import {
    CLAIM_JITTER_MAX_MS,
    CLAIM_SETTLE_MS,
    createClaim,
    finalizeClaim,
    isClaimActive,
    mayCommit,
    normalizeClaim,
    scheduleNextDue
} from './backupClaim.js';
import {
    clampAmount,
    normalizeConfig
} from './scheduledBackupConfig.js';

const STORAGE_KEY = 'matrix_scheduled_export';
const DEFAULT_TITLE = 'Scheduled backup';
const RING_CIRCUMFERENCE = 2 * Math.PI * 11;

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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

function readBoardEnabledFromUi() {
    return !!document.querySelector('[data-schedule-board-enabled]')?.checked;
}

function readCanvasEnabledFromUi() {
    return !!document.querySelector('[data-schedule-canvas-enabled]')?.checked;
}

/** Notes JSON + Media both enabled → one full archive download. */
function isCombinedArchiveMode(config) {
    return !!(config?.notes?.enabled && config?.media?.enabled && config?.notes?.format === 'json');
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
        // Other tabs update their ring/labels the moment a claim or finalize
        // lands, instead of waiting up to 500ms for their own tick.
        window.addEventListener('storage', (event) => {
            if (event.key === STORAGE_KEY) {
                this.syncButton();
                this.refreshOpenStatus();
            }
        });
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
        const combinedMode = isCombinedArchiveMode(config);
        const incrementalDisabled = !config.media.enabled || combinedMode;
        const notesJson = config.notes.format === 'json';
        const notesIncrementalDisabled = !config.notes.enabled || !notesJson || combinedMode;
        const sessionDisabled = combinedMode;
        const restoreHint = combinedMode
            ? 'Restore: use Import all for the combined archive.'
            : 'Restore: import latest meta JSON, then ZIP files oldest → newest.';
        const incrementalLabel = combinedMode
            ? 'Incremental content (disabled — combined archive is always a full snapshot)'
            : 'Incremental content (meta always full)';
        const notesModeLabel = config.notes.lastMode === 'incremental' ? 'incr' : 'full';
        const notesRestoreHint = combinedMode
            ? 'Restore: the combined archive carries notes, media and layout.'
            : (config.notes.incremental && !notesJson
                ? 'TXT export is always a full dump.'
                : 'Restore: import the newest full notes file, then incr files oldest → newest.');
        const boardHint = combinedMode
            ? 'Included in the combined archive.'
            : 'Positions + chrome are written only when they change.';
        const canvasHint = combinedMode
            ? 'Included in the combined archive.'
            : 'The drawing is written only when it changes.';

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
                    <p class="schedule-export-popover__meta">Last: JSON ${escapeAttr(formatRelativePast(jsonLast))}${notesJson && config.notes.lastMode ? ` (${escapeAttr(notesModeLabel)})` : ''} · TXT ${escapeAttr(formatRelativePast(txtLast))}</p>
                    <label class="schedule-export-popover__check">
                        <input type="checkbox" data-schedule-notes-incremental${config.notes.incremental && !notesIncrementalDisabled ? ' checked' : ''}${notesIncrementalDisabled ? ' disabled' : ''}>
                        <span>Incremental content (only changed notes)</span>
                    </label>
                    <p class="schedule-export-popover__meta schedule-export-popover__hint">${escapeAttr(notesRestoreHint)}</p>
                </div>
            </div>
            <div class="schedule-export-popover__section">
                <label class="schedule-export-popover__section-head">
                    <input type="checkbox" data-schedule-board-enabled${config.board.enabled && !sessionDisabled ? ' checked' : ''}${sessionDisabled ? ' disabled' : ''}>
                    <span>BOARD</span>
                </label>
                <div class="schedule-export-popover__section-body">
                    <p class="schedule-export-popover__meta">Last: ${escapeAttr(formatRelativePast(config.board.lastExportAt))}</p>
                    <p class="schedule-export-popover__meta schedule-export-popover__hint">${escapeAttr(boardHint)}</p>
                </div>
            </div>
            <div class="schedule-export-popover__section">
                <label class="schedule-export-popover__section-head">
                    <input type="checkbox" data-schedule-canvas-enabled${config.canvas.enabled && !sessionDisabled ? ' checked' : ''}${sessionDisabled ? ' disabled' : ''}>
                    <span>CANVAS</span>
                </label>
                <div class="schedule-export-popover__section-body">
                    <p class="schedule-export-popover__meta">Last: ${escapeAttr(formatRelativePast(config.canvas.lastExportAt))}</p>
                    <p class="schedule-export-popover__meta schedule-export-popover__hint">${escapeAttr(canvasHint)}</p>
                </div>
            </div>
            <div class="schedule-export-popover__section">
                <label class="schedule-export-popover__section-head">
                    <input type="checkbox" data-schedule-media-enabled${config.media.enabled ? ' checked' : ''}>
                    <span>MEDIA</span>
                </label>
                <div class="schedule-export-popover__section-body">
                    <label class="schedule-export-popover__check">
                        <input type="checkbox" data-schedule-media-incremental${config.media.incremental && !combinedMode ? ' checked' : ''}${incrementalDisabled ? ' disabled' : ''}>
                        <span>${escapeAttr(incrementalLabel)}</span>
                    </label>
                    <p class="schedule-export-popover__meta schedule-export-popover__hint">${escapeAttr(restoreHint)}</p>
                    <p class="schedule-export-popover__meta">Last: Meta ${escapeAttr(formatRelativePast(metaLast))} · ZIP ${escapeAttr(zipLast ? `${formatRelativePast(zipLast)} (${combinedMode ? 'archive' : zipModeLabel})` : 'Never')}</p>
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

        body.querySelector('[data-schedule-notes-incremental]')?.addEventListener('change', (e) => {
            const next = readConfig();
            next.notes.incremental = !!e.target.checked;
            writeConfig(next);
        });

        body.querySelector('[data-schedule-board-enabled]')?.addEventListener('change', (e) => {
            const next = readConfig();
            next.board.enabled = !!e.target.checked;
            writeConfig(next);
        });

        body.querySelector('[data-schedule-canvas-enabled]')?.addEventListener('change', (e) => {
            const next = readConfig();
            next.canvas.enabled = !!e.target.checked;
            writeConfig(next);
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
        const boardEl = document.querySelector('[data-schedule-board-enabled]');
        if (boardEl && !boardEl.disabled) {
            config.board.enabled = !!boardEl.checked;
        }
        const canvasEl = document.querySelector('[data-schedule-canvas-enabled]');
        if (canvasEl && !canvasEl.disabled) {
            config.canvas.enabled = !!canvasEl.checked;
        }
        const notesIncrEl = document.querySelector('[data-schedule-notes-incremental]');
        if (notesIncrEl && !notesIncrEl.disabled) {
            config.notes.incremental = !!notesIncrEl.checked;
        }
        const incrEl = document.querySelector('[data-schedule-media-incremental]');
        if (incrEl && !incrEl.disabled) {
            config.media.incremental = !!incrEl.checked;
        }
        return config;
    },

    start() {
        const config = this.persistUiTargets(readConfig());
        if (!config.notes.enabled && !config.media.enabled && !config.board.enabled && !config.canvas.enabled) {
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
            // A fresh claim means another tab is mid-export — stand down until it
            // finalizes (nextDueAt already advanced) or its lease expires.
            if (isClaimActive(config.runningClaim)) {
                this.syncButton();
                this.refreshOpenStatus();
                return;
            }
            this.claimAndFire(config);
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

    /**
     * Two-phase single-writer commit. Called by onTick when the schedule is due
     * and no other tab holds a live claim.
     */
    async claimAndFire(config) {
        if (this.busy) return;
        const claim = createClaim();

        // Consume the due slot BEFORE exporting so no other tab sees "due" while
        // this export is in flight (even if this tab crashes mid-export).
        config.nextDueAt = Date.now() + intervalMs(config);
        config.runningClaim = claim;
        writeConfig(config);

        // Settle: simultaneous bids across tabs resolve by last-write-wins.
        // The jitter staggers identical tick timings so one bid clearly
        // survives; the winner is the tab whose token is still stored.
        const jitter = Math.random() * CLAIM_JITTER_MAX_MS;
        await sleep(CLAIM_SETTLE_MS + jitter);

        const latest = readConfig();
        if (!mayCommit(claim, latest)) {
            // Another tab won the slot — stand down without exporting. The
            // winner already advanced nextDueAt, so we wait for the next interval.
            this.syncButton();
            return;
        }
        await this.fireExport(latest, claim.token);
    },

    /**
     * Run the actual exports as the confirmed claim holder, then finalize by
     * merging results onto the freshest config (claim-scoped).
     * @param {object} config
     * @param {string} claimToken
     */
    async fireExport(config, claimToken) {
        if (this.busy) return;
        this.busy = true;
        let statsDirty = false;
        try {
            const results = { notes: null, media: null, board: null, canvas: null };
            if (isCombinedArchiveMode(config)) {
                const combined = await this.exportCombinedArchive(config);
                statsDirty = combined.changed || statsDirty;
                results.notes = combined.notesPatch;
                results.media = combined.mediaPatch;
            } else {
                // Failure isolation: one stream throwing must not block the
                // others, and whatever succeeded still commits to the config.
                const runStream = async (name, exportFn) => {
                    try {
                        const result = await exportFn(config);
                        statsDirty = result.changed || statsDirty;
                        results[name] = result.patch;
                    } catch (err) {
                        console.warn(`[ScheduledBackup] ${name} export failed`, err);
                    }
                };
                if (config.notes.enabled) await runStream('notes', (c) => this.exportNotes(c));
                if (config.media.enabled) await runStream('media', (c) => this.exportMedia(c));
                if (config.board.enabled) await runStream('board', (c) => this.exportBoard(c));
                if (config.canvas.enabled) await runStream('canvas', (c) => this.exportCanvas(c));
            }
            this.finalizeExport(claimToken, results);
            if (statsDirty) SidebarStats.update();
        } catch (err) {
            console.warn('[ScheduledBackup] export failed', err);
            this.finalizeExport(claimToken, null);
        } finally {
            this.busy = false;
            this.syncButton();
            if (this.panel && !this.panel.classList.contains('is-hidden')) {
                this.renderBody();
            }
        }
    },

    /**
     * Merge export results (fingerprints / timestamps / zip snapshot) onto the
     * FRESH config, clear our claim, and re-arm nextDueAt only when the
     * schedule is still enabled and not paused. This is what prevents a Stop or
     * Pause clicked in another tab mid-export from being resurrected, and what
     * lets a losing tab's finalize be a clean no-op.
     */
    finalizeExport(claimToken, results) {
        const merged = finalizeClaim(claimToken, readConfig(), results || {});
        if (!merged) return; // claim lost/expired — another window owns the slot.
        writeConfig(scheduleNextDue(merged, intervalMs(merged)));
    },

    /**
     * Combined Notes(JSON)+Media → one magicnotes_backup_*.zip.
     * Incremental is ignored; always a full media snapshot inside the archive.
     */
    async exportCombinedArchive(config) {
        const payload = await buildFullBackupArchivePayload();
        const fingerprint = hashExportFingerprint(payload.textForFingerprint);
        if (fingerprint === config.notes.lastFingerprint) {
            return { changed: false, notesPatch: null, mediaPatch: null };
        }

        downloadBlob(payload.blob, payload.filename);
        const ts = payload.timestamp || Math.floor(Date.now() / 1000);
        writeLastLocalExportAt(ts);
        writeLastMediaZipExportAt(ts);

        return {
            changed: true,
            notesPatch: { lastFingerprint: fingerprint, lastExportAt: ts, lastMode: 'full' },
            mediaPatch: {
                lastZipFingerprint: fingerprint,
                lastZipExportAt: ts,
                lastZipMode: 'full',
                zipSnapshot: payload.nextSnapshot || {}
            }
        };
    },

    /**
     * Build + download a notes payload. Returns a { changed, patch } pair so the
     * caller can merge the result without touching the shared config directly.
     * JSON honours the incremental setting (baseline first, then changed notes
     * only); TXT is always a full dump and leaves the JSON patch chain alone.
     */
    async exportNotes(config) {
        const payload = await this.buildNotesPayload(config.notes);
        if (payload.skipped) return { changed: false, patch: null };

        const fingerprint = hashExportFingerprint(payload.textForFingerprint || payload.text);
        // Full/baseline payloads are deduped by fingerprint; patches are already
        // gated by the revision snapshot, so never skip them by fingerprint.
        if (!payload.isIncremental && fingerprint === config.notes.lastFingerprint) {
            return { changed: false, patch: null };
        }

        downloadBlob(payload.blob, payload.filename);
        const ts = payload.timestamp || Math.floor(Date.now() / 1000);
        const patch = { lastFingerprint: fingerprint, lastExportAt: ts };

        if (config.notes.format === 'txt') {
            writeLastLocalTxtExportAt(ts);
        } else {
            writeLastLocalExportAt(ts);
            if (payload.nextSnapshot) {
                patch.patchSnapshot = payload.nextSnapshot;
                patch.lastMode = payload.isIncremental ? 'incremental' : 'full';
            }
        }

        return { changed: true, patch };
    },

    /**
     * Board stream: positions + chrome. Tiny file, own fingerprint, so dragging
     * a card never rewrites notes or the canvas — and drawing never rewrites it.
     */
    async exportBoard(config) {
        const payload = await buildBoardExportPayload();
        const fingerprint = hashExportFingerprint(payload.textForFingerprint || payload.text);
        if (fingerprint === config.board.lastFingerprint) {
            return { changed: false, patch: null };
        }

        downloadBlob(payload.blob, payload.filename);
        return {
            changed: true,
            patch: { lastFingerprint: fingerprint, lastExportAt: payload.timestamp }
        };
    },

    /**
     * Canvas stream: the magicCanvas document on its own fingerprint, so a
     * brush stroke never rewrites notes or board positions.
     */
    async exportCanvas(config) {
        const payload = await buildCanvasExportPayload();
        const fingerprint = hashExportFingerprint(payload.textForFingerprint || payload.text);
        if (fingerprint === config.canvas.lastFingerprint) {
            return { changed: false, patch: null };
        }

        downloadBlob(payload.blob, payload.filename);
        return {
            changed: true,
            patch: { lastFingerprint: fingerprint, lastExportAt: payload.timestamp }
        };
    },

    /**
     * Build + download media meta / zip payloads. Returns a { changed, patch }
     * pair (see exportNotes). Only the confirmed claim winner's patch is ever
     * written to the shared config, keeping the incremental ZIP chain linear.
     */
    async exportMedia(config) {
        const mediaPatch = {};
        let changed = false;

        const metaPayload = await buildMediaMetaExportPayload();
        const metaFp = hashExportFingerprint(metaPayload.textForFingerprint || metaPayload.text);
        if (metaFp !== config.media.lastMetaFingerprint) {
            downloadBlob(metaPayload.blob, metaPayload.filename);
            mediaPatch.lastMetaFingerprint = metaFp;
            mediaPatch.lastMetaExportAt = metaPayload.timestamp;
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
                mediaPatch.lastZipFingerprint = zipFp;
                mediaPatch.lastZipExportAt = zipPayload.timestamp;
                mediaPatch.lastZipMode = zipPayload.isIncremental ? 'incremental' : 'full';
                mediaPatch.zipSnapshot = zipPayload.nextSnapshot;
                writeLastMediaZipExportAt(zipPayload.timestamp);
                changed = true;
            }
        }

        return { changed, patch: changed ? mediaPatch : null };
    },

    /**
     * @param {{ format?: string, incremental?: boolean, patchSnapshot?: object }} notesConfig
     */
    async buildNotesPayload(notesConfig = {}) {
        const format = notesConfig.format === 'txt' ? 'txt' : 'json';
        if (format === 'txt') {
            const text = buildTxtContent(this.getItems());
            return {
                skipped: false,
                isIncremental: false,
                nextSnapshot: null,
                text,
                textForFingerprint: text,
                blob: new Blob([text], { type: 'text/plain' }),
                filename: txtExportFilename(),
                timestamp: Math.floor(Date.now() / 1000)
            };
        }

        return buildNotesExportPayload({
            incremental: !!notesConfig.incremental,
            snapshot: notesConfig.patchSnapshot
        });
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
            const backingUp = isClaimActive(config.runningClaim);
            const label = paused
                ? `Scheduled backup paused · ${formatRemaining(remaining)} left`
                : (backingUp
                    ? 'Scheduled backup running…'
                    : `Auto backup in ${formatRemaining(remaining)}`);
            btn.title = label;
            btn.setAttribute('aria-label', label);
        } else {
            btn.title = DEFAULT_TITLE;
            btn.setAttribute('aria-label', DEFAULT_TITLE);
        }
    }
};
