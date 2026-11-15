/** @module {"owns":"global clipboard paste catcher for media staging", "related":["mediaStagingDialog.js","notePasteContext.js","drawingBoardClipboard.js"]} */
import { appendMediaStaging, isMediaStagingOpen, openMediaStaging } from './mediaStagingDialog.js';
import {
    resolveImagePasteAttachNoteId,
    resolveNotePasteTarget
} from './notePasteContext.js';
import { showAppToast } from './toast.js';
import { boardOwnsPasteEvent, pasteEventIsOwned } from './drawingBoardClipboard.js';

/**
 * Collect File/Blob items from a ClipboardEvent or ClipboardItem list.
 * @param {DataTransfer|null|undefined} dataTransfer
 * @returns {File[]}
 */
export function filesFromDataTransfer(dataTransfer) {
    if (!dataTransfer) return [];
    const out = [];
    if (dataTransfer.files?.length) {
        for (const f of dataTransfer.files) {
            if (f) out.push(f);
        }
    }
    if (!out.length && dataTransfer.items?.length) {
        for (const item of dataTransfer.items) {
            if (item.kind === 'file') {
                const f = item.getAsFile();
                if (f) out.push(f);
            }
        }
    }
    return out;
}

/**
 * @param {Array<Blob|File>} files
 * @param {{ hasLogin?: boolean, pasteTarget?: { noteId: string, field: string }|null }} [opts]
 * @returns {{ source: string, attachNoteId: string|null, loginRequiredForAttach: boolean }}
 */
export function resolvePasteStagingOpts(files, { hasLogin, pasteTarget } = {}) {
    const loggedIn = hasLogin ?? !!localStorage.getItem('admin_token')?.trim();
    const target = pasteTarget ?? resolveNotePasteTarget();
    const hasImages = (files || []).some((f) => String(f?.type || '').startsWith('image/'));
    const loginRequiredForAttach = !!(target?.noteId && hasImages && !loggedIn);
    const attachNoteId = resolveImagePasteAttachNoteId(files, {
        pasteTarget: target,
        hasLogin: loggedIn
    });
    return { source: 'paste', attachNoteId, loginRequiredForAttach };
}

/**
 * @param {ClipboardItem[]} items
 * @returns {Promise<Blob[]>}
 */
async function blobsFromClipboardItems(items) {
    const out = [];
    for (const item of items || []) {
        const types = item.types || [];
        const fileType = types.find((t) => t.startsWith('image/') || t === 'application/octet-stream')
            || types.find((t) => !t.startsWith('text/'));
        if (!fileType) continue;
        try {
            const blob = await item.getType(fileType);
            if (blob) out.push(blob);
        } catch {
            /* skip */
        }
    }
    return out;
}

/**
 * @param {Array<Blob|File>} files
 * @param {{ source?: string, attachNoteId?: string|null }} [opts]
 */
async function stageFiles(files, opts = {}) {
    if (!files?.length) return false;
    const stagingOpts = {
        source: opts.source || 'upload',
        attachNoteId: opts.attachNoteId ?? null
    };
    if (isMediaStagingOpen()) {
        await appendMediaStaging(files, stagingOpts);
    } else {
        await openMediaStaging(files, stagingOpts);
    }
    return true;
}

/**
 * True when the drawing board owns this paste event, so the media catcher must
 * leave it alone. Pure peek, no side effects: evaluating it before or after the
 * board's own paste listener gives the same answer, which is what makes the two
 * capture listeners order-independent (they are registered in different orders
 * in index.html and the popout). When the board is not active — e.g. notes mode —
 * this is false and pasting behaves exactly as before.
 * @param {ClipboardEvent|object} e
 * @returns {boolean}
 */
export function shouldYieldBoardPaste(e) {
    return pasteEventIsOwned(e) || boardOwnsPasteEvent(e);
}

function onPaste(e) {
    // Yield to the drawing board: a board copy is not media. It is identified by
    // its own markers (custom MIME / text marker / just-copied local payload),
    // never by our PNG — which is exactly why a board copy must not fall through
    // to the staging dialog here.
    if (shouldYieldBoardPaste(e)) return;
    const files = filesFromDataTransfer(e.clipboardData);
    if (!files.length) return; // text-only: leave alone
    e.preventDefault();
    e.stopPropagation();
    const stagingOpts = resolvePasteStagingOpts(files);
    if (stagingOpts.loginRequiredForAttach) {
        showAppToast('Login required to attach media');
    }
    stageFiles(files, stagingOpts).catch(() => {
        showAppToast('Could not read clipboard files');
    });
}

/**
 * FAB / explicit clipboard read.
 */
export async function readClipboardIntoStaging() {
    if (!navigator.clipboard?.read) {
        showAppToast('Use Ctrl+V to paste into the media library');
        return;
    }
    try {
        const items = await navigator.clipboard.read();
        const blobs = await blobsFromClipboardItems(items);
        if (!blobs.length) {
            showAppToast('No image or file on the clipboard');
            return;
        }
        const stagingOpts = resolvePasteStagingOpts(blobs);
        if (stagingOpts.loginRequiredForAttach) {
            showAppToast('Login required to attach media');
        }
        await stageFiles(blobs, stagingOpts);
    } catch {
        showAppToast('Clipboard access denied — use Ctrl+V instead');
    }
}

export const MediaPasteCatcher = {
    init() {
        document.addEventListener('paste', onPaste, true);
    },
    filesFromDataTransfer,
    readClipboardIntoStaging,
    resolvePasteStagingOpts,
    shouldYieldBoardPaste
};
