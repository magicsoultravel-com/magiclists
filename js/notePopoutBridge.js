/** @module {"owns":"note popout window open/focus, edit claims, BroadcastChannel sync", "related":["popoutNote.js","app.js","noteQuickActions.js"]} */
import { CARD_ICONS } from './icons.js';
import { showAppToast } from './toast.js';

const CHANNEL_NAME = 'magiclists-notes';
const CLAIMS_KEY = 'matrix_note_edit_claims';
const WINDOW_ID_KEY = 'matrix_note_popout_window_id';
/** Survives preview hosts that rewrite popout.html?id=… → /popout (no query). */
export const POPOUT_HANDOFF_KEY = 'matrix_popout_handoff_id';
const CLAIM_TTL_MS = 15000;
const HEARTBEAT_MS = 5000;

function readClaims() {
    try {
        const raw = JSON.parse(localStorage.getItem(CLAIMS_KEY) || '{}');
        return raw && typeof raw === 'object' ? raw : {};
    } catch {
        return {};
    }
}

function writeClaims(claims) {
    try {
        localStorage.setItem(CLAIMS_KEY, JSON.stringify(claims));
    } catch (err) {
        console.warn('[NotePopout] could not persist claims:', err);
    }
}

function pruneExpiredClaims(claims = readClaims(), now = Date.now()) {
    let changed = false;
    for (const [noteId, claim] of Object.entries(claims)) {
        if (!claim?.expiresAt || claim.expiresAt < now) {
            delete claims[noteId];
            changed = true;
        }
    }
    if (changed) writeClaims(claims);
    return claims;
}

function ensureWindowId(forceNew = false) {
    try {
        // window.open() starts a popup with a *copy* of the opener's
        // sessionStorage, so a popout can inherit the main window's id here.
        // Two windows sharing an id would drop each other's BroadcastChannel
        // messages (senderId === own id) and never see each other as "other"
        // when checking claims — breaking the board lock and the pop-in
        // refresh. Popout windows therefore always mint their own id.
        let id = forceNew ? null : sessionStorage.getItem(WINDOW_ID_KEY);
        if (!id) {
            id = (crypto.randomUUID?.() || `win_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);
            sessionStorage.setItem(WINDOW_ID_KEY, id);
        }
        return id;
    } catch {
        return `win_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }
}

function windowNameForNote(noteId) {
    return `magiclists-note-${String(noteId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function popoutUrlForNote(noteId) {
    // Resolve against the directory of the current page so subpath hosts work:
    // …/index.html → …/popout.html?id=…  |  …/ → …/popout.html?id=…
    const path = window.location.pathname || '/';
    const dir = path.endsWith('/') ? path : path.replace(/[^/]+$/, '');
    const url = new URL(`${dir}popout.html`, window.location.origin);
    url.searchParams.set('id', noteId);
    // Hash often survives extensionless rewrites that drop the query string.
    url.hash = noteId;
    return url.href;
}

export function writePopoutHandoff(noteId) {
    if (!noteId) return;
    try {
        localStorage.setItem(POPOUT_HANDOFF_KEY, noteId);
    } catch (err) {
        console.warn('[NotePopout] could not write handoff id:', err);
    }
}

export function clearPopoutHandoff() {
    try {
        localStorage.removeItem(POPOUT_HANDOFF_KEY);
    } catch {
        /* ignore */
    }
}

/**
 * Resolve note id: query → hash → localStorage handoff.
 * Clears handoff when id came from hash/handoff (or after a successful query match).
 */
export function resolvePopoutNoteId() {
    const fromQuery = new URLSearchParams(window.location.search).get('id')?.trim() || '';
    if (fromQuery) {
        clearPopoutHandoff();
        return fromQuery;
    }

    const fromHash = (window.location.hash || '').replace(/^#/, '').trim();
    if (fromHash) {
        clearPopoutHandoff();
        return fromHash;
    }

    try {
        const fromHandoff = localStorage.getItem(POPOUT_HANDOFF_KEY)?.trim() || '';
        if (fromHandoff) {
            clearPopoutHandoff();
            return fromHandoff;
        }
    } catch {
        /* ignore */
    }
    return '';
}

function ensurePopoutNavigated(win, url) {
    if (!win || win.closed) return;
    try {
        const current = win.location?.href || '';
        if (current !== url) {
            win.location.assign(url);
        }
    } catch {
        // Cross-origin or briefly inaccessible — window.open already targeted url.
    }
}

/**
 * @typedef {object} NotePopoutHandlers
 * @property {(msg: object) => void} [onMessage]
 * @property {(noteId: string, item?: object|null) => void} [onClaimChanged]
 * @property {(noteId: string, item: object|null) => void} [onNoteSaved]
 * @property {() => void} [onUndoChanged]
 */

export const NotePopoutBridge = {
    role: 'main',
    windowId: null,
    channel: null,
    heartbeatTimer: null,
    /** @type {Map<string, Window>} */
    openWindows: new Map(),
    /** @type {Set<string>} notes this window currently claims */
    localClaims: new Set(),
    /** @type {NotePopoutHandlers} */
    handlers: {},

    init({ role = 'main', handlers = {} } = {}) {
        this.role = role;
        this.windowId = ensureWindowId(role === 'popout');
        this.handlers = handlers || {};
        pruneExpiredClaims();

        try {
            this.channel?.close();
        } catch {
            /* ignore */
        }
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.channel.onmessage = (event) => this.handleMessage(event.data);

        window.addEventListener('storage', (e) => {
            if (e.key === CLAIMS_KEY) {
                this.notifyClaimChanges();
            }
            if (e.key === 'matrix_database' || e.key === 'matrix_undo_history') {
                if (e.key === 'matrix_undo_history') this.handlers.onUndoChanged?.();
            }
        });

        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = window.setInterval(() => this.heartbeat(), HEARTBEAT_MS);

        window.addEventListener('beforeunload', () => this.releaseAllClaims());
    },

    handleMessage(data) {
        if (!data || typeof data !== 'object') return;
        if (data.senderId && data.senderId === this.windowId) return;

        if (data.type === 'claim_changed' || data.type === 'popout_opened' || data.type === 'popout_closed') {
            pruneExpiredClaims();
            this.notifyClaimChanges(data.noteId, data.type === 'popout_closed' ? (data.item || null) : null);
        }
        if (data.type === 'note_saved') {
            this.handlers.onNoteSaved?.(data.noteId, data.item || null);
        }
        if (data.type === 'undo_changed') {
            this.handlers.onUndoChanged?.();
        }
        if (data.type === 'request_close' && this.role === 'popout' && data.noteId) {
            if (this.localClaims.has(data.noteId)) {
                this.handlers.onMessage?.(data);
            }
        }
        if (data.type === 'request_focus' && this.role === 'popout' && data.noteId) {
            if (this.localClaims.has(data.noteId)) {
                try {
                    window.focus();
                } catch {
                    /* ignore */
                }
            }
        }
        this.handlers.onMessage?.(data);
    },

    broadcast(type, payload = {}) {
        const message = {
            type,
            senderId: this.windowId,
            role: this.role,
            at: Date.now(),
            ...payload
        };
        try {
            this.channel?.postMessage(message);
        } catch (err) {
            console.warn('[NotePopout] broadcast failed:', err);
        }
    },

    notifyClaimChanges(noteId = null, item = null) {
        this.handlers.onClaimChanged?.(noteId, item);
        this.syncAllPopoutButtons();
    },

    getClaim(noteId) {
        if (!noteId) return null;
        const claims = pruneExpiredClaims();
        return claims[noteId] || null;
    },

    isClaimedByUs(noteId) {
        const claim = this.getClaim(noteId);
        return !!(claim && claim.ownerId === this.windowId);
    },

    isClaimedByOther(noteId) {
        const claim = this.getClaim(noteId);
        return !!(claim && claim.ownerId && claim.ownerId !== this.windowId);
    },

    isPoppedOut(noteId) {
        const claim = this.getClaim(noteId);
        return !!(claim && claim.role === 'popout');
    },

    claim(noteId, { role = this.role } = {}) {
        if (!noteId) return false;
        const claims = pruneExpiredClaims();
        const existing = claims[noteId];
        if (existing && existing.ownerId !== this.windowId) {
            return false;
        }
        claims[noteId] = {
            ownerId: this.windowId,
            role,
            expiresAt: Date.now() + CLAIM_TTL_MS
        };
        writeClaims(claims);
        this.localClaims.add(noteId);
        this.broadcast(role === 'popout' ? 'popout_opened' : 'claim_changed', { noteId, role });
        this.notifyClaimChanges(noteId);
        return true;
    },

    release(noteId, { broadcast = true, item = null } = {}) {
        if (!noteId) return;
        const claims = pruneExpiredClaims();
        const existing = claims[noteId];
        if (existing && existing.ownerId === this.windowId) {
            delete claims[noteId];
            writeClaims(claims);
        }
        this.localClaims.delete(noteId);
        this.openWindows.delete(noteId);
        if (broadcast) {
            this.broadcast('popout_closed', { noteId, item: item || null });
            this.notifyClaimChanges(noteId, item || null);
        }
    },

    releaseAllClaims() {
        const ids = [...this.localClaims];
        for (const noteId of ids) {
            this.release(noteId, { broadcast: true });
        }
    },

    heartbeat() {
        const before = { ...readClaims() };
        if (!this.localClaims.size) {
            const after = pruneExpiredClaims();
            const removed = Object.keys(before).filter((id) => !after[id]);
            if (removed.length) {
                removed.forEach((noteId) => this.notifyClaimChanges(noteId));
            }
            return;
        }
        const claims = pruneExpiredClaims();
        let changed = false;
        for (const noteId of this.localClaims) {
            const claim = claims[noteId];
            if (!claim || claim.ownerId !== this.windowId) {
                claims[noteId] = {
                    ownerId: this.windowId,
                    role: this.role,
                    expiresAt: Date.now() + CLAIM_TTL_MS
                };
                changed = true;
            } else {
                claim.expiresAt = Date.now() + CLAIM_TTL_MS;
                changed = true;
            }
        }
        if (changed) writeClaims(claims);
    },

    /**
     * Open or focus a popout for the note. If already claimed by a popout we own
     * a window ref for, focus it. If claimed by another popout, request focus.
     * If the active popout button is toggled off (caller decides), use requestClose.
     */
    openOrFocus(noteId) {
        if (!noteId) return null;
        if (!localStorage.getItem('admin_token')) {
            showAppToast('Login required to pop out notes');
            return null;
        }

        const url = popoutUrlForNote(noteId);
        writePopoutHandoff(noteId);
        const existing = this.openWindows.get(noteId);
        if (existing && !existing.closed) {
            ensurePopoutNavigated(existing, url);
            try {
                existing.focus();
            } catch {
                /* ignore */
            }
            this.broadcast('request_focus', { noteId });
            return existing;
        }

        if (this.isPoppedOut(noteId) && this.isClaimedByOther(noteId)) {
            this.broadcast('request_focus', { noteId });
            showAppToast('Focusing popout window');
            return null;
        }

        const name = windowNameForNote(noteId);
        const features = 'popup=yes,width=480,height=640,menubar=no,toolbar=no,location=no,status=no';
        const win = window.open(url, name, features);
        if (!win) {
            showAppToast('Pop-out blocked — allow popups for this site');
            return null;
        }
        // Named-window reuse can focus a stale document without navigating —
        // force the correct popout.html?id=… URL every time.
        ensurePopoutNavigated(win, url);
        this.openWindows.set(noteId, win);
        try {
            win.focus();
        } catch {
            /* ignore */
        }
        return win;
    },

    requestClose(noteId) {
        if (!noteId) return;
        // Ask the popout to flush+save then close itself. Do not win.close() here —
        // that races the async save and drops the last edits on the board.
        this.broadcast('request_close', { noteId });
        this.openWindows.delete(noteId);
    },

    /**
     * Open or focus a popout. Board/modal always use this (recall when already open).
     * Pop-in is only done from inside the popout window.
     */
    togglePopout(noteId) {
        this.openOrFocus(noteId);
        return 'open';
    },

    broadcastNoteSaved(noteId, item) {
        this.broadcast('note_saved', { noteId, item });
    },

    broadcastUndoChanged() {
        this.broadcast('undo_changed', {});
    },

    syncPopoutButtonUI(btn, noteId) {
        if (!btn || !noteId) return;
        const popped = this.isPoppedOut(noteId);
        const title = popped ? 'Focus popout window' : 'Pop out note';
        btn.classList.toggle('is-active', popped);
        btn.classList.remove('is-on', 'is-off');
        btn.setAttribute('aria-pressed', popped ? 'true' : 'false');
        btn.setAttribute('title', title);
        btn.setAttribute('aria-label', title);
        btn.innerHTML = popped ? CARD_ICONS.popoutExit : CARD_ICONS.popout;
    },

    syncAllPopoutButtons(root = document) {
        root.querySelectorAll?.('.card-act--popout[data-note-id], .card-act--popout').forEach((btn) => {
            const noteId = btn.dataset.noteId
                || btn.closest('[data-id]')?.dataset?.id
                || btn.closest('.mini-card')?.dataset?.id;
            if (noteId) this.syncPopoutButtonUI(btn, noteId);
        });
    }
};
