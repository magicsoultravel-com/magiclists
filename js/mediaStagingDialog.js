/** @module {"owns":"media staging upload dialogue before library commit", "related":["mediaLibrary.js","mediaPasteCatcher.js","mediaLibraryOverlay.js"]} */
import { escapeAttr, escapeHTML } from './domEscape.js';
import { MEDIA_MAX_BYTES, commitMediaItems } from './mediaLibrary.js';
import { buildMediaMetadata, formatByteSize, humanMetaRows } from './mediaMetadata.js';
import { showAppToast } from './toast.js';

let overlay = null;
/** @type {Array<{ stagingId: string, blob: Blob, filename: string, mime: string, byteSize: number, title: string, description: string, source: string, meta: object|null, previewUrl: string|null, tooLarge: boolean }>} */
let pending = [];
let stagingSeq = 0;
let onCommitted = null;

function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.getElementById('media-staging-overlay');
    if (!overlay) return null;

    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) close();
    });
    overlay.querySelector('[data-media-staging-cancel]')?.addEventListener('click', () => close());
    overlay.querySelector('[data-media-staging-confirm]')?.addEventListener('click', () => confirm());
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!isOpen()) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        close();
    }, true);
    return overlay;
}

function nextStagingId() {
    stagingSeq += 1;
    return `stage_${Date.now()}_${stagingSeq}`;
}

/**
 * @param {Array<Blob|File>} files
 * @param {{ source?: string }} [opts]
 */
export async function openMediaStaging(files, opts = {}) {
    ensureOverlay();
    if (!overlay) return;

    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) {
        showAppToast('No files to add');
        return;
    }

    const source = opts.source || 'upload';
    for (const blob of list) {
        const meta = await buildMediaMetadata(blob, { source });
        const tooLarge = (blob.size || 0) > MEDIA_MAX_BYTES;
        const previewUrl = String(meta.mime || '').startsWith('image/')
            ? URL.createObjectURL(blob)
            : null;
        pending.push({
            stagingId: nextStagingId(),
            blob,
            filename: meta.filename,
            mime: meta.mime,
            byteSize: meta.byteSize,
            title: stripExt(meta.filename),
            description: '',
            source,
            meta,
            previewUrl,
            tooLarge
        });
    }

    render();
    overlay.classList.remove('is-hidden');
    requestAnimationFrame(() => {
        requestAnimationFrame(() => overlay?.classList.add('is-open'));
    });
}

/**
 * Append more files into an already-open staging dialog (or open it).
 * @param {Array<Blob|File>} files
 * @param {{ source?: string }} [opts]
 */
export async function appendMediaStaging(files, opts = {}) {
    if (!isOpen()) {
        await openMediaStaging(files, opts);
        return;
    }
    await openMediaStaging(files, opts);
}

export function isMediaStagingOpen() {
    return isOpen();
}

function isOpen() {
    return !!(overlay && !overlay.classList.contains('is-hidden'));
}

function close() {
    if (!overlay) return;
    clearPending();
    overlay.classList.remove('is-open');
    overlay.classList.add('is-hidden');
}

function clearPending() {
    for (const item of pending) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    pending = [];
}

function stripExt(name) {
    const s = String(name || 'Untitled');
    const i = s.lastIndexOf('.');
    return i > 0 ? s.slice(0, i) : s;
}

function syncFieldsFromDom() {
    if (!overlay) return;
    overlay.querySelectorAll('[data-staging-id]').forEach((card) => {
        const id = card.dataset.stagingId;
        const item = pending.find((p) => p.stagingId === id);
        if (!item) return;
        const titleEl = card.querySelector('[data-staging-title]');
        const descEl = card.querySelector('[data-staging-desc]');
        if (titleEl) item.title = titleEl.value;
        if (descEl) item.description = descEl.value;
    });
}

function render() {
    if (!overlay) return;
    const body = overlay.querySelector('[data-media-staging-body]');
    const countEl = overlay.querySelector('[data-media-staging-count]');
    const confirmBtn = overlay.querySelector('[data-media-staging-confirm]');
    if (!body) return;

    if (countEl) countEl.textContent = String(pending.length);
    const validCount = pending.filter((p) => !p.tooLarge).length;
    if (confirmBtn) {
        confirmBtn.disabled = validCount === 0;
        confirmBtn.textContent = validCount ? `Add ${validCount} to library` : 'Add to library';
    }

    body.innerHTML = pending.map((item) => {
        const rows = humanMetaRows(item.meta).filter((r) => r.label !== 'Source' && r.label !== 'Filename');
        const preview = item.previewUrl
            ? `<img class="media-staging__preview" src="${escapeAttr(item.previewUrl)}" alt="">`
            : `<div class="media-staging__file-icon" aria-hidden="true">${escapeHTML((item.mime || 'file').split('/')[0])}</div>`;
        const warn = item.tooLarge
            ? `<p class="media-staging__warn">Too large (max ${Math.round(MEDIA_MAX_BYTES / (1024 * 1024))} MB) — will be skipped</p>`
            : '';
        const metaHtml = rows.slice(0, 6).map((r) => (
            `<div class="media-staging__meta-row"><span>${escapeHTML(r.label)}</span><span>${escapeHTML(r.value)}</span></div>`
        )).join('');
        return `
            <article class="media-staging__card${item.tooLarge ? ' media-staging__card--blocked' : ''}" data-staging-id="${escapeAttr(item.stagingId)}">
                <div class="media-staging__preview-wrap">${preview}</div>
                <div class="media-staging__fields">
                    <label class="media-staging__label">Title
                        <input type="text" class="media-staging__input" data-staging-title value="${escapeAttr(item.title)}">
                    </label>
                    <label class="media-staging__label">Description
                        <textarea class="media-staging__input media-staging__textarea" data-staging-desc rows="2">${escapeHTML(item.description)}</textarea>
                    </label>
                    <p class="media-staging__filename">${escapeHTML(item.filename)} · ${escapeHTML(formatByteSize(item.byteSize))} · ${escapeHTML(item.mime)}</p>
                    ${warn}
                    <div class="media-staging__meta">${metaHtml}</div>
                    <button type="button" class="btn btn--compact" data-staging-remove>Remove</button>
                </div>
            </article>
        `;
    }).join('');

    body.querySelectorAll('[data-staging-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
            syncFieldsFromDom();
            const card = btn.closest('[data-staging-id]');
            const id = card?.dataset.stagingId;
            const idx = pending.findIndex((p) => p.stagingId === id);
            if (idx >= 0) {
                if (pending[idx].previewUrl) URL.revokeObjectURL(pending[idx].previewUrl);
                pending.splice(idx, 1);
            }
            if (!pending.length) {
                close();
                return;
            }
            render();
        });
    });
}

async function confirm() {
    syncFieldsFromDom();
    const toCommit = pending.filter((p) => !p.tooLarge);
    if (!toCommit.length) {
        showAppToast('No valid files to add');
        return;
    }
    const confirmBtn = overlay?.querySelector('[data-media-staging-confirm]');
    if (confirmBtn) confirmBtn.disabled = true;
    try {
        await commitMediaItems(toCommit.map((p) => ({
            blob: p.blob,
            title: p.title,
            description: p.description,
            source: p.source,
            filename: p.filename
        })));
        showAppToast(toCommit.length === 1 ? 'Added to media library' : `Added ${toCommit.length} items to media library`);
        const cb = onCommitted;
        close();
        cb?.();
    } catch (err) {
        showAppToast(err?.message || 'Could not add media');
        if (confirmBtn) confirmBtn.disabled = false;
    }
}

export function setMediaStagingOnCommitted(fn) {
    onCommitted = fn;
}

export const MediaStagingDialog = {
    init: ensureOverlay,
    open: openMediaStaging,
    append: appendMediaStaging,
    close,
    isOpen: isMediaStagingOpen,
    setOnCommitted: setMediaStagingOnCommitted
};
