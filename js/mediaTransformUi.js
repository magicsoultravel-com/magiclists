/** @module {"owns":"media library optimize/scale confirm popover", "related":["mediaTransform.js","mediaLibrary.js","mediaQuickActions.js","popoverPosition.js"]} */
import { escapeHTML } from './domEscape.js';
import { positionPopoverBelowAnchor } from './popoverPosition.js';
import { commitMediaItem, getMediaRecord, MEDIA_MAX_BYTES } from './mediaLibrary.js';
import { formatByteSize } from './mediaMetadata.js';
import {
    buildTransformedFilename,
    coerceOutputMime,
    estimateTransformedSize,
    imageHasAlpha
} from './mediaTransform.js';
import { showAppToast } from './toast.js';

const SCALE_PRESETS = [0.5, 0.75, 1.5, 2];

/** @type {HTMLElement|null} */
let popoverEl = null;
/** @type {HTMLElement|null} */
let activeAnchor = null;
/** @type {'optimize'|'scale'|null} */
let activeMode = null;
/** @type {string|null} */
let activeMediaId = null;
/** @type {((meta: object) => void)|null} */
let onCommittedCb = null;
/** @type {((e: MouseEvent) => void)|null} */
let outsideHandler = null;
/** @type {((e: KeyboardEvent) => void)|null} */
let keyHandler = null;
/** @type {number} */
let estimateGen = 0;
/** @type {{ blob: Blob, width: number, height: number, byteSize: number, mime: string }|null} */
let lastEstimate = null;

function ensurePopover() {
    if (popoverEl) return popoverEl;
    popoverEl = document.createElement('div');
    popoverEl.className = 'media-transform-popover clock-style-popover is-hidden';
    popoverEl.setAttribute('role', 'dialog');
    popoverEl.setAttribute('aria-label', 'Transform media');
    document.body.appendChild(popoverEl);
    return popoverEl;
}

function detachListeners() {
    if (outsideHandler) {
        document.removeEventListener('mousedown', outsideHandler, true);
        outsideHandler = null;
    }
    if (keyHandler) {
        document.removeEventListener('keydown', keyHandler);
        keyHandler = null;
    }
}

export function closeMediaTransformPopover() {
    estimateGen += 1;
    lastEstimate = null;
    detachListeners();
    if (popoverEl) popoverEl.classList.add('is-hidden');
    activeAnchor = null;
    activeMode = null;
    activeMediaId = null;
    onCommittedCb = null;
}

/**
 * @param {HTMLElement} anchor
 * @param {'optimize'|'scale'} mode
 */
export function isMediaTransformPopoverOpen(anchor, mode) {
    return !!(
        popoverEl
        && !popoverEl.classList.contains('is-hidden')
        && activeAnchor === anchor
        && activeMode === mode
    );
}

/**
 * @param {object} meta
 * @param {'optimize'|'scale'} mode
 * @param {{ hasAlpha?: boolean, pngAllowed?: boolean }} [opts]
 */
function renderShell(meta, mode, opts = {}) {
    const hasAlpha = !!opts.hasAlpha;
    const pngAllowed = hasAlpha || !!opts.pngAllowed;
    const dims = (meta.width && meta.height)
        ? `${meta.width}×${meta.height}`
        : 'Unknown size';
    const sizeLabel = formatByteSize(meta.byteSize || 0);
    const title = mode === 'optimize' ? 'Optimize' : 'Scale';

    // Transparent sources: JPEG is invalid — only WebP (alpha-capable) + PNG (lossless).
    const formatOpts = hasAlpha
        ? [
            `<option value="image/webp">WebP</option>`,
            `<option value="image/png">PNG (lossless)</option>`
        ].join('')
        : [
            `<option value="image/webp">WebP</option>`,
            `<option value="image/jpeg">JPEG</option>`,
            pngAllowed ? `<option value="image/png">PNG</option>` : ''
        ].join('');

    const alphaNote = hasAlpha
        ? '<p class="media-transform-popover__source">Transparency detected — JPEG disabled</p>'
        : '';

    const scaleRow = mode === 'scale'
        ? `<div class="media-transform-popover__presets" role="group" aria-label="Scale">
            ${SCALE_PRESETS.map((s) => {
                const pct = Math.round(s * 100);
                const selected = s === 0.5 ? ' is-selected' : '';
                return `<button type="button" class="media-transform-popover__preset${selected}" data-scale="${s}" aria-pressed="${s === 0.5}">${pct}%</button>`;
            }).join('')}
           </div>
           <label class="media-transform-popover__field">Quality
             <input type="range" min="50" max="95" step="1" value="80" data-quality>
             <span class="media-transform-popover__quality-val" data-quality-label>80%</span>
           </label>`
        : `<label class="media-transform-popover__field">Quality
             <input type="range" min="70" max="100" step="1" value="92" data-quality>
             <span class="media-transform-popover__quality-val" data-quality-label>92%</span>
           </label>`;

    return `
        <div class="media-transform-popover__head">
            <strong>${escapeHTML(title)}</strong>
            <button type="button" class="card-act" data-transform-close title="Close" aria-label="Close">×</button>
        </div>
        <p class="media-transform-popover__source">${escapeHTML(dims)} · ${escapeHTML(sizeLabel)}</p>
        ${alphaNote}
        <label class="media-transform-popover__field">Format
            <select data-format>${formatOpts}</select>
        </label>
        ${scaleRow}
        <p class="media-transform-popover__estimate" data-estimate>Estimating…</p>
        <p class="media-transform-popover__warn is-hidden" data-warn></p>
        <div class="media-transform-popover__actions">
            <button type="button" class="btn btn--compact" data-transform-cancel>Cancel</button>
            <button type="button" class="btn btn--compact btn--primary" data-transform-confirm disabled>Create</button>
        </div>
    `;
}

/**
 * @param {HTMLElement} root
 */
/**
 * @param {HTMLElement} root
 * @param {{ hasAlpha?: boolean }} [ctx]
 */
function readForm(root, ctx = {}) {
    const format = coerceOutputMime(
        root.querySelector('[data-format]')?.value || 'image/webp',
        { hasAlpha: !!ctx.hasAlpha }
    );
    const qualityInput = root.querySelector('[data-quality]');
    const qualityPct = Number(qualityInput?.value) || 92;
    const quality = Math.min(1, Math.max(0.05, qualityPct / 100));
    const selectedPreset = root.querySelector('.media-transform-popover__preset.is-selected');
    const scale = activeMode === 'scale'
        ? (Number(selectedPreset?.dataset.scale) || 0.5)
        : 1;
    return { format, quality, scale, qualityPct };
}

/**
 * @param {HTMLElement} root
 * @param {object} meta
 * @param {Blob} blob
 */
async function runEstimate(root, meta, blob) {
    const gen = ++estimateGen;
    const estimateEl = root.querySelector('[data-estimate]');
    const warnEl = root.querySelector('[data-warn]');
    const confirmBtn = root.querySelector('[data-transform-confirm]');
    const hasAlpha = !!meta.hasAlpha;
    const { format, quality, scale } = readForm(root, { hasAlpha });

    if (estimateEl) estimateEl.textContent = 'Estimating…';
    warnEl?.classList.add('is-hidden');
    if (confirmBtn) confirmBtn.disabled = true;
    lastEstimate = null;

    // PNG ignores quality — hide slider noise by disabling when PNG selected
    const qualityInput = root.querySelector('[data-quality]');
    if (qualityInput) qualityInput.disabled = format === 'image/png';

    try {
        const result = await estimateTransformedSize(blob, {
            scale,
            mime: format,
            quality,
            orientation: meta.orientation ?? null,
            hasAlpha
        });
        if (gen !== estimateGen) return;

        lastEstimate = result;
        const srcW = meta.width || result.width;
        const srcH = meta.height || result.height;
        const dimLine = activeMode === 'scale'
            ? `${srcW}×${srcH} → ${result.width}×${result.height}`
            : `${result.width}×${result.height}`;
        if (estimateEl) {
            estimateEl.textContent = `${dimLine} · ${formatByteSize(result.byteSize)}`;
        }

        const tooLarge = result.byteSize > MEDIA_MAX_BYTES;
        const grew = result.byteSize > (meta.byteSize || 0);
        if (warnEl) {
            if (tooLarge) {
                warnEl.textContent = `Exceeds ${Math.round(MEDIA_MAX_BYTES / (1024 * 1024))} MB limit`;
                warnEl.classList.remove('is-hidden');
            } else if (grew) {
                warnEl.textContent = 'Larger than original — still create?';
                warnEl.classList.remove('is-hidden');
            } else {
                warnEl.classList.add('is-hidden');
            }
        }
        if (confirmBtn) confirmBtn.disabled = tooLarge;
        if (activeAnchor && popoverEl && !popoverEl.classList.contains('is-hidden')) {
            positionPopoverBelowAnchor(popoverEl, activeAnchor);
        }
    } catch (err) {
        if (gen !== estimateGen) return;
        if (estimateEl) estimateEl.textContent = err?.message || 'Estimate failed';
        if (confirmBtn) confirmBtn.disabled = true;
    }
}

/**
 * @param {HTMLElement} root
 * @param {object} meta
 * @param {Blob} blob
 */
function bindForm(root, meta, blob) {
    const scheduleEstimate = () => {
        void runEstimate(root, meta, blob);
    };

    root.querySelector('[data-format]')?.addEventListener('change', scheduleEstimate);

    const qualityInput = root.querySelector('[data-quality]');
    qualityInput?.addEventListener('input', () => {
        const label = root.querySelector('[data-quality-label]');
        if (label) label.textContent = `${qualityInput.value}%`;
        scheduleEstimate();
    });

    root.querySelectorAll('[data-scale]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            root.querySelectorAll('[data-scale]').forEach((b) => {
                b.classList.toggle('is-selected', b === btn);
                b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
            });
            // Upscale defaults to higher quality
            const scale = Number(btn.dataset.scale) || 1;
            if (qualityInput && scale > 1 && Number(qualityInput.value) < 90) {
                qualityInput.value = '92';
                const label = root.querySelector('[data-quality-label]');
                if (label) label.textContent = '92%';
            } else if (qualityInput && scale < 1 && Number(qualityInput.value) > 85) {
                qualityInput.value = '80';
                const label = root.querySelector('[data-quality-label]');
                if (label) label.textContent = '80%';
            }
            scheduleEstimate();
        });
    });

    root.querySelector('[data-transform-close]')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMediaTransformPopover();
    });
    root.querySelector('[data-transform-cancel]')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMediaTransformPopover();
    });

    root.querySelector('[data-transform-confirm]')?.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const confirmBtn = e.currentTarget;
        if (!lastEstimate?.blob || confirmBtn.disabled) return;
        const mode = activeMode;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Creating…';
        try {
            const { format, scale } = readForm(root, { hasAlpha: !!meta.hasAlpha });
            const baseTitle = (meta.title || meta.filename || 'image').replace(/\.[^.]+$/, '');
            const titleSuffix = mode === 'optimize'
                ? 'optimized'
                : `${Math.round(scale * 100)}%`;
            const title = `${baseTitle} (${titleSuffix})`;
            const filename = buildTransformedFilename(
                meta.filename || 'image',
                titleSuffix,
                lastEstimate.mime || format
            );
            const committed = await commitMediaItem(lastEstimate.blob, {
                title,
                filename,
                source: mode === 'optimize' ? 'optimize' : 'scale'
            });
            const cb = onCommittedCb;
            closeMediaTransformPopover();
            showAppToast(mode === 'optimize' ? 'Optimized copy created' : 'Scaled copy created');
            cb?.(committed);
        } catch (err) {
            confirmBtn.textContent = 'Create';
            confirmBtn.disabled = false;
            showAppToast(err?.message || 'Create failed');
        }
    });

    // Stop mousedown inside from counting as outside-close
    root.addEventListener('mousedown', (e) => e.stopPropagation());

    scheduleEstimate();
}

/**
 * @param {{
 *   mediaId: string,
 *   mode: 'optimize'|'scale',
 *   anchor: HTMLElement,
 *   onCommitted?: (meta: object) => void
 * }} opts
 */
export async function openMediaTransformPopover(opts) {
    const { mediaId, mode, anchor, onCommitted } = opts || {};
    if (!mediaId || !anchor || (mode !== 'optimize' && mode !== 'scale')) return;

    if (isMediaTransformPopoverOpen(anchor, mode)) {
        closeMediaTransformPopover();
        return;
    }

    const record = await getMediaRecord(mediaId);
    if (!record?.blob || record.blobMissing) {
        showAppToast('File missing');
        return;
    }
    if (!String(record.mime || record.blob.type || '').startsWith('image/')) {
        showAppToast('Images only');
        return;
    }

    const hasAlpha = await imageHasAlpha(record.blob);

    const root = ensurePopover();
    closeMediaTransformPopover();
    // close clears state; re-set
    activeAnchor = anchor;
    activeMode = mode;
    activeMediaId = mediaId;
    onCommittedCb = onCommitted || null;

    const meta = {
        title: record.title || '',
        filename: record.filename || '',
        byteSize: record.byteSize || record.blob.size || 0,
        width: record.width ?? null,
        height: record.height ?? null,
        orientation: record.orientation ?? null,
        mime: record.mime || record.blob.type || '',
        hasAlpha
    };
    const pngAllowed = hasAlpha || /image\/png/i.test(String(meta.mime || ''));

    root.innerHTML = renderShell(meta, mode, { hasAlpha, pngAllowed });
    const formatSel = root.querySelector('[data-format]');
    if (formatSel) {
        // Transparent + optimize → PNG (true lossless via canvas). Scale → WebP (keeps alpha, smaller).
        formatSel.value = hasAlpha && mode === 'optimize' ? 'image/png' : 'image/webp';
    }

    root.classList.remove('is-hidden');
    root.setAttribute('aria-label', mode === 'optimize' ? 'Optimize image' : 'Scale image');
    positionPopoverBelowAnchor(root, anchor);
    bindForm(root, meta, record.blob);

    outsideHandler = (e) => {
        if (!popoverEl || popoverEl.classList.contains('is-hidden')) return;
        if (popoverEl.contains(e.target)) return;
        if (activeAnchor?.contains?.(e.target)) return;
        closeMediaTransformPopover();
    };
    keyHandler = (e) => {
        if (e.key === 'Escape') closeMediaTransformPopover();
    };
    document.addEventListener('mousedown', outsideHandler, true);
    document.addEventListener('keydown', keyHandler);

    // Reposition after content/estimate may change height
    requestAnimationFrame(() => {
        if (activeAnchor && popoverEl && !popoverEl.classList.contains('is-hidden')) {
            positionPopoverBelowAnchor(popoverEl, activeAnchor);
        }
    });
}

/**
 * Toggle helper used by quick actions.
 * @param {{
 *   mediaId: string,
 *   mode: 'optimize'|'scale',
 *   anchor: HTMLElement,
 *   onCommitted?: (meta: object) => void
 * }} opts
 */
export function toggleMediaTransformPopover(opts) {
    return openMediaTransformPopover(opts);
}
