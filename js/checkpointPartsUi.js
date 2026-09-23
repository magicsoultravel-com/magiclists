/**
 * @module {"owns":"shared NOTES/BOARD/CANVAS/MEDIA checkpoint zip-composition UI","related":["scheduledBackup.js","cloudBackup.js","scheduledBackupConfig.js"]}
 *
 * Same look as the scheduled-backup popover sections. Used by local schedule
 * and cloud backup so both surfaces compose the same checkpoint ZIP parts.
 */
import { sanitizeFilenameTag } from './scheduledBackupConfig.js';

function escapeAttr(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

/**
 * Relative "Xm ago" label for unix-seconds timestamps.
 * @param {number|null|undefined} unixSeconds
 */
export function formatRelativePast(unixSeconds) {
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

/**
 * @param {object} config normalized parts config (notes/board/canvas/media/tag)
 * @param {{
 *   jsonLast?: number|null,
 *   txtLast?: number|null,
 *   metaLast?: number|null,
 *   zipLast?: number|null,
 *   includeTag?: boolean,
 *   checkpointHint?: string|null
 * }} [opts]
 * @returns {string} HTML fragment
 */
export function renderCheckpointPartsHtml(config, opts = {}) {
    const includeTag = opts.includeTag !== false;
    const jsonLast = opts.jsonLast ?? config.notes?.lastExportAt ?? null;
    const txtLast = opts.txtLast ?? null;
    const metaLast = opts.metaLast ?? config.media?.lastMetaExportAt ?? null;
    const zipLast = opts.zipLast ?? config.media?.lastZipExportAt ?? null;
    const zipModeLabel = config.media?.lastZipMode === 'incremental' ? 'incr' : 'full';
    const incrementalDisabled = !config.media?.enabled;
    const notesJson = config.notes?.format !== 'txt';
    const notesIncrementalDisabled = !config.notes?.enabled || !notesJson;
    const incrementalLabel = 'Incremental content (meta always full)';
    const notesModeLabel = config.notes?.lastMode === 'incremental' ? 'incr' : 'full';
    const notesRestoreHint = !notesJson
        ? 'TXT export is always a full dump.'
        : 'Restore: import the newest full notes file, then incr files oldest → newest.';
    const boardHint = 'Positions + chrome are written only when they change.';
    const canvasHint = 'The drawing is written only when it changes.';
    const checkpointHint = opts.checkpointHint
        ?? 'One ZIP per checkpoint, carrying only what changed. Restore: import checkpoints oldest → newest.';
    const mediaHint = 'Only changed media files ride along. Untick incremental once to re-anchor a full ZIP.';

    const notesLastLine = txtLast != null
        ? `Last: JSON ${escapeAttr(formatRelativePast(jsonLast))}${notesJson && config.notes?.lastMode ? ` (${escapeAttr(notesModeLabel)})` : ''} · TXT ${escapeAttr(formatRelativePast(txtLast))}`
        : `Last: ${escapeAttr(formatRelativePast(jsonLast))}${notesJson && config.notes?.lastMode ? ` (${escapeAttr(notesModeLabel)})` : ''}`;

    const zipLastLabel = zipLast
        ? `${formatRelativePast(zipLast)} (${zipModeLabel})`
        : 'Never';

    const tagBlock = includeTag
        ? `
            <div class="schedule-export-popover__field">
                <span class="schedule-export-popover__label">Personal tag</span>
                <input type="text" class="schedule-export-popover__unit" data-cp-tag maxlength="8"
                    placeholder="e.g. luna" autocomplete="off" spellcheck="false"
                    value="${escapeAttr(config.tag || '')}" aria-label="Personal filename tag">
                <p class="schedule-export-popover__meta schedule-export-popover__hint">
                    Letters, numbers, - and _ (max 8). Files: <span data-cp-tag-preview></span>
                </p>
            </div>
        `
        : '';

    const hintBlock = checkpointHint
        ? `<p class="schedule-export-popover__meta schedule-export-popover__hint" data-cp-checkpoint-hint>${escapeAttr(checkpointHint)}</p>`
        : '';

    return `
        ${tagBlock}
        ${hintBlock}
        <div class="schedule-export-popover__section">
            <label class="schedule-export-popover__section-head">
                <input type="checkbox" data-cp-notes-enabled${config.notes?.enabled ? ' checked' : ''}>
                <span>NOTES</span>
            </label>
            <div class="schedule-export-popover__section-body">
                <div class="schedule-export-popover__field">
                    <span class="schedule-export-popover__label">Export type</span>
                    <div class="schedule-export-popover__seg" role="group" aria-label="Notes export type">
                        <button type="button" class="schedule-export-popover__seg-btn${notesJson ? ' is-active' : ''}" data-cp-notes-format="json">JSON</button>
                        <button type="button" class="schedule-export-popover__seg-btn${!notesJson ? ' is-active' : ''}" data-cp-notes-format="txt">TXT</button>
                    </div>
                </div>
                <p class="schedule-export-popover__meta">${notesLastLine}</p>
                <label class="schedule-export-popover__check">
                    <input type="checkbox" data-cp-notes-incremental${config.notes?.incremental && !notesIncrementalDisabled ? ' checked' : ''}${notesIncrementalDisabled ? ' disabled' : ''}>
                    <span>Incremental content (only changed notes)</span>
                </label>
                <p class="schedule-export-popover__meta schedule-export-popover__hint">${escapeAttr(notesRestoreHint)}</p>
            </div>
        </div>
        <div class="schedule-export-popover__section">
            <label class="schedule-export-popover__section-head">
                <input type="checkbox" data-cp-board-enabled${config.board?.enabled ? ' checked' : ''}>
                <span>BOARD</span>
            </label>
            <div class="schedule-export-popover__section-body">
                <p class="schedule-export-popover__meta">Last: ${escapeAttr(formatRelativePast(config.board?.lastExportAt))}</p>
                <p class="schedule-export-popover__meta schedule-export-popover__hint">${escapeAttr(boardHint)}</p>
            </div>
        </div>
        <div class="schedule-export-popover__section">
            <label class="schedule-export-popover__section-head">
                <input type="checkbox" data-cp-canvas-enabled${config.canvas?.enabled ? ' checked' : ''}>
                <span>CANVAS</span>
            </label>
            <div class="schedule-export-popover__section-body">
                <p class="schedule-export-popover__meta">Last: ${escapeAttr(formatRelativePast(config.canvas?.lastExportAt))}</p>
                <p class="schedule-export-popover__meta schedule-export-popover__hint">${escapeAttr(canvasHint)}</p>
            </div>
        </div>
        <div class="schedule-export-popover__section">
            <label class="schedule-export-popover__section-head">
                <input type="checkbox" data-cp-media-enabled${config.media?.enabled ? ' checked' : ''}>
                <span>MEDIA</span>
            </label>
            <div class="schedule-export-popover__section-body">
                <label class="schedule-export-popover__check">
                    <input type="checkbox" data-cp-media-incremental${config.media?.incremental && !incrementalDisabled ? ' checked' : ''}${incrementalDisabled ? ' disabled' : ''}>
                    <span>${escapeAttr(incrementalLabel)}</span>
                </label>
                <p class="schedule-export-popover__meta schedule-export-popover__hint">${escapeAttr(mediaHint)}</p>
                <p class="schedule-export-popover__meta">Last: Meta ${escapeAttr(formatRelativePast(metaLast))} · ZIP ${escapeAttr(zipLastLabel)}</p>
            </div>
        </div>
    `;
}

/**
 * Wire change handlers for the parts HTML. Callers own persistence via read/write.
 * @param {Element} root
 * @param {{
 *   readConfig: () => object,
 *   writeConfig: (config: object) => void,
 *   onRerender?: () => void,
 *   includeTag?: boolean
 * }} api
 */
export function bindCheckpointPartsUi(root, api) {
    if (!root || !api?.readConfig || !api?.writeConfig) return;

    const rerender = () => {
        if (typeof api.onRerender === 'function') api.onRerender();
    };

    root.querySelectorAll('[data-cp-notes-format]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const next = api.readConfig();
            next.notes.format = btn.getAttribute('data-cp-notes-format') === 'txt' ? 'txt' : 'json';
            api.writeConfig(next);
            rerender();
        });
    });

    root.querySelector('[data-cp-notes-enabled]')?.addEventListener('change', (e) => {
        const next = api.readConfig();
        next.notes.enabled = !!e.target.checked;
        api.writeConfig(next);
        rerender();
    });

    root.querySelector('[data-cp-media-enabled]')?.addEventListener('change', (e) => {
        const next = api.readConfig();
        next.media.enabled = !!e.target.checked;
        api.writeConfig(next);
        rerender();
    });

    if (api.includeTag !== false) {
        const tagInput = root.querySelector('[data-cp-tag]');
        const tagPreview = root.querySelector('[data-cp-tag-preview]');
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
            const next = api.readConfig();
            next.tag = clean;
            api.writeConfig(next);
        });
        updateTagPreview();
    }

    root.querySelector('[data-cp-notes-incremental]')?.addEventListener('change', (e) => {
        const next = api.readConfig();
        next.notes.incremental = !!e.target.checked;
        api.writeConfig(next);
    });

    root.querySelector('[data-cp-board-enabled]')?.addEventListener('change', (e) => {
        const next = api.readConfig();
        next.board.enabled = !!e.target.checked;
        api.writeConfig(next);
    });

    root.querySelector('[data-cp-canvas-enabled]')?.addEventListener('change', (e) => {
        const next = api.readConfig();
        next.canvas.enabled = !!e.target.checked;
        api.writeConfig(next);
    });

    root.querySelector('[data-cp-media-incremental]')?.addEventListener('change', (e) => {
        const next = api.readConfig();
        next.media.incremental = !!e.target.checked;
        api.writeConfig(next);
    });
}

/**
 * Copy current UI toggles onto a config object (mutates and returns it).
 * @param {Element|Document} root
 * @param {object} config
 */
export function readCheckpointPartsFromUi(root, config) {
    if (!root || !config) return config;
    const notesEl = root.querySelector('[data-cp-notes-enabled]');
    if (notesEl) config.notes.enabled = !!notesEl.checked;
    const mediaEl = root.querySelector('[data-cp-media-enabled]');
    if (mediaEl) config.media.enabled = !!mediaEl.checked;
    const boardEl = root.querySelector('[data-cp-board-enabled]');
    if (boardEl && !boardEl.disabled) config.board.enabled = !!boardEl.checked;
    const canvasEl = root.querySelector('[data-cp-canvas-enabled]');
    if (canvasEl && !canvasEl.disabled) config.canvas.enabled = !!canvasEl.checked;
    const notesIncrEl = root.querySelector('[data-cp-notes-incremental]');
    if (notesIncrEl && !notesIncrEl.disabled) config.notes.incremental = !!notesIncrEl.checked;
    const incrEl = root.querySelector('[data-cp-media-incremental]');
    if (incrEl && !incrEl.disabled) config.media.incremental = !!incrEl.checked;
    const tagInput = root.querySelector('[data-cp-tag]');
    if (tagInput) config.tag = sanitizeFilenameTag(tagInput.value);
    return config;
}

/**
 * Merge per-stream fingerprint patches onto a parts config (no claim logic).
 * @param {object} config
 * @param {{ notes?: object, media?: object, board?: object, canvas?: object }|null} patches
 */
export function mergeCheckpointPatches(config, patches) {
    if (!config || !patches) return config;
    if (patches.notes && config.notes) {
        config.notes = { ...config.notes, ...patches.notes };
    }
    if (patches.media && config.media) {
        config.media = { ...config.media, ...patches.media };
    }
    if (patches.board && config.board) {
        config.board = { ...config.board, ...patches.board };
    }
    if (patches.canvas && config.canvas) {
        config.canvas = { ...config.canvas, ...patches.canvas };
    }
    return config;
}
