/** @module {"owns":"scheduled JSON/TXT/board/canvas/media auto-export timer and popover", "related":["backup.js","mediaBackup.js","app.js","noteQuickActions.js"]} */
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import { positionPopoverBelowAnchor } from './popoverPosition.js';
import {
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
import { buildCheckpointExportPayload } from './checkpointBundle.js';
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
    normalizeConfig,
    sanitizeFilenameTag
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

/** Persist the per-stream "last export" markers after a bundle download. */
function applyCheckpointMarkers(config, patches) {
    if (!patches) return;
    if (patches.notes) {
        if (config.notes.format === 'txt') {
            writeLastLocalTxtExportAt(patches.notes.lastExportAt);
        } else {
            writeLastLocalExportAt(patches.notes.lastExportAt);
        }
    }
    if (patches.media?.lastMetaExportAt != null) {
        writeLastMediaMetaExportAt(patches.media.lastMetaExportAt);
    }
    if (patches.media?.lastZipExportAt != null) {
        writeLastMediaZipExportAt(patches.media.lastZipExportAt);
    }
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
        const incrementalDisabled = !config.media.enabled;
        const notesJson = config.notes.format === 'json';
        const notesIncrementalDisabled = !config.notes.enabled || !notesJson;
        const incrementalLabel = 'Incremental content (meta always full)';
        const notesModeLabel = config.notes.lastMode === 'incremental' ? 'incr' : 'full';
        const notesRestoreHint = !notesJson
            ? 'TXT export is always a full dump.'
            : 'Restore: import the newest full notes file, then incr files oldest → newest.';
        const boardHint = 'Positions + chrome are written only when they change.';
        const canvasHint = 'The drawing is written only when it changes.';
        const checkpointHint = 'One ZIP per checkpoint, carrying only what changed. Restore: import checkpoints oldest → newest.';
        const mediaHint = 'Only changed media files ride along. Untick incremental once to re-anchor a full ZIP.';

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
            <div class="schedule-export-popover__field">
                <span class="schedule-export-popover__label">Personal tag</span>
                <input type="text" class="schedule-export-popover__unit" data-schedule-tag maxlength="8"
                    placeholder="e.g. luna" autocomplete="off" spellcheck="false"
                    value="${escapeAttr(config.tag)}" aria-label="Personal filename tag">
                <p class="schedule-export-popover__meta schedule-export-popover__hint">
                    Letters, numbers, - and _ (max 8). Files: <span data-schedule-tag-preview></span>
                </p>
            </div>
            <p class="schedule-export-popover__meta" data-schedule-status>${escapeAttr(statusLine)}</p>
            <p class="schedule-export-popover__meta schedule-export-popover__hint" data-schedule-checkpoint-hint>${escapeAttr(checkpointHint)}</p>
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
                    <input type="checkbox" data-schedule-board-enabled${config.board.enabled ? ' checked' : ''}>
                    <span>BOARD</span>
                </label>
                <div class="schedule-export-popover__section-body">
                    <p class="schedule-export-popover__meta">Last: ${escapeAttr(formatRelativePast(config.board.lastExportAt))}</p>
                    <p class="schedule-export-popover__meta schedule-export-popover__hint">${escapeAttr(boardHint)}</p>
                </div>
            </div>
            <div class="schedule-export-popover__section">
                <label class="schedule-export-popover__section-head">
                    <input type="checkbox" data-schedule-canvas-enabled${config.canvas.enabled ? ' checked' : ''}>
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
                        <input type="checkbox" data-schedule-media-incremental${config.media.incremental && !incrementalDisabled ? ' checked' : ''}${incrementalDisabled ? ' disabled' : ''}>
                        <span>${escapeAttr(incrementalLabel)}</span>
                    </label>
                    <p class="schedule-export-popover__meta schedule-export-popover__hint">${escapeAttr(mediaHint)}</p>
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

        const tagInput = body.querySelector('[data-schedule-tag]');
        const tagPreview = body.querySelector('[data-schedule-tag-preview]');
        const updateTagPreview = () => {
            const clean = sanitizeFilenameTag(tagInput?.value);
            if (tagPreview) {
                tagPreview.textContent = `magicnotes_${clean ? `${clean}_` : ''}export_*.zip`;
            }
        };
        tagInput?.addEventListener('input', () => {
            const clean = sanitizeFilenameTag(tagInput.value);
            if (tagInput.value !== clean) tagInput.value = clean;
            updateTagPreview();
            const next = readConfig();
            next.tag = clean;
            writeConfig(next);
        });
        updateTagPreview();

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
        const tagInput = document.querySelector('[data-schedule-tag]');
        if (tagInput) {
            config.tag = sanitizeFilenameTag(tagInput.value);
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
            // One bundle per tick. The builder still gates every part by its
            // own fingerprint/snapshot, so a quiet tick downloads nothing and
            // a note-only tick ships a tiny ZIP with just the notes part.
            const result = await this.exportCheckpoint(config);
            statsDirty = result.changed || statsDirty;
            this.finalizeExport(claimToken, result.patches || {
                notes: null, media: null, board: null, canvas: null
            });
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
     * Build + download ONE checkpoint bundle ZIP carrying whatever changed
     * since the last checkpoint (notes part, board, canvas, media meta and/or
     * only-the-changed media files). Nothing changed → no download.
     * Returns the per-stream patches for finalizeClaim.
     */
    async exportCheckpoint(config) {
        const extras = {};
        if (config.notes.enabled && config.notes.format === 'txt') {
            extras.notesTxtPayload = await this.buildNotesPayload(config.notes);
        }
        const payload = await buildCheckpointExportPayload(config, extras);
        if (payload.skipped) return { changed: false, patches: null };

        downloadBlob(payload.blob, payload.filename);
        applyCheckpointMarkers(config, payload.patches);
        return { changed: true, patches: payload.patches };
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
