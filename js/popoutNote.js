/** @module {"owns":"standalone note popout window boot, edit, flush, undo", "related":["notePopoutBridge.js","noteSurface.js","api.js","undo.js"]} */
import { API } from './api.js';
import { AppTheme } from './appTheme.js';
import { NoteFontScale } from './noteFontScale.js';
import { NoteSurface } from './noteSurface.js';
import { bindNoteQuickActions } from './noteQuickActions.js';
import { NotePopoutBridge, resolvePopoutNoteId, POPOUT_COLLAPSED_W, POPOUT_COLLAPSED_H, PIP_WINDOW_W, PIP_WINDOW_H, POPUP_WINDOW_W, POPUP_WINDOW_H } from './notePopoutBridge.js';
import { UndoManager, historyLabelForItem, mergeItemOntoExisting } from './undo.js';
import { applyItemCardTheme, applyCardCategoryBand } from './noteSurfaceHtml.js';
import { getCardRenderContext, readStoredCategories } from './categories.js';
import { ColorPicker, PALETTE_NOTE, resolveNoteColor, THEME_DEFAULT_COLOR } from './colorPicker.js';
import { BoardOperations } from './boardOperations.js';
import { flushDesktopAutoSave, clearDesktopAutoSaveTimer } from './noteSurfaceMutations.js';
import { stripRichText } from './richText.js';
import { showAppToast } from './toast.js';
import { CARD_ICONS } from './icons.js';

const statusEl = document.getElementById('popout-status');
const rootEl = document.getElementById('popout-root');

const uiStub = {
    toggleBoardPin() { return false; },
    syncBoardPinClass() {},
    isBoardPinned() { return false; },
    raiseDesktopCard() {},
    syncCalendarButtonUI: BoardOperations.syncCalendarButtonUI.bind(BoardOperations)
};

const PopoutEditor = {
    activeItem: null,
    noteId: null,
    card: null,
    mountZone: null,
    colorBtn: null,
    iconBtn: null,
    calendarToggleBtn: null,
    token: null,
    closing: false,
    windowCollapsed: false,
    rememberedOuterW: 0,
    rememberedOuterH: 0,

    async boot() {
        AppTheme.init();
        NoteFontScale.init?.();

        this.noteId = resolvePopoutNoteId();
        if (!this.noteId) {
            this.showFatal(
                `Missing note id. Open a note from the board (pop-out icon), not popout.html directly. Current URL: ${window.location.href}`
            );
            return;
        }

        this.token = localStorage.getItem('admin_token')?.trim() || '';
        if (!this.token) {
            this.showFatal('Login required in the main window, then pop out again.');
            return;
        }

        const data = await API.fetchItems(this.token);
        const item = (data?.items || []).find((it) => it.id === this.noteId);
        if (!item) {
            this.showFatal('Note not found. It may have been deleted.');
            return;
        }

        NotePopoutBridge.init({
            role: 'popout',
            handlers: {
                onMessage: (msg) => this.onBridgeMessage(msg),
                onNoteSaved: (noteId, remoteItem) => {
                    if (noteId !== this.noteId || !remoteItem) return;
                    if (NotePopoutBridge.isClaimedByUs(this.noteId)) return;
                    Object.assign(this.activeItem, remoteItem);
                    this.render();
                },
                onUndoChanged: () => {
                    if (!UndoManager.isApplying) UndoManager.reloadFromStorage();
                }
            }
        });

        if (!NotePopoutBridge.claim(this.noteId, { role: 'popout' })) {
            this.showFatal('This note is already being edited elsewhere.');
            return;
        }

        UndoManager.init({
            getToken: () => this.token,
            isEnabled: () => !!this.token,
            onRestore: async (restored) => {
                const merged = mergeItemOntoExisting(this.activeItem, restored);
                Object.assign(this.activeItem, merged);
                await API.saveItem(this.activeItem, this.token);
                NotePopoutBridge.broadcastNoteSaved(this.noteId, NoteSurface.snapshotItem(this.activeItem));
                NotePopoutBridge.broadcastUndoChanged();
                this.render();
            },
            onRemove: async () => {
                this.closePopout({ skipPersist: true });
            },
            onStackChange: () => {
                NotePopoutBridge.broadcastUndoChanged();
            }
        });

        this.activeItem = NoteSurface.snapshotItem(item);
        this.updateDocumentTitle();
        this.render();
        this.bindLifecycle();

        window.addEventListener('item:mutation_requested', (e) => this.onMutation(e));
    },

    showFatal(message) {
        if (statusEl) {
            statusEl.hidden = false;
            statusEl.textContent = message;
        }
        if (rootEl) rootEl.innerHTML = '';
    },

    updateDocumentTitle() {
        const title = stripRichText(this.activeItem?.title || '').trim() || 'Note';
        document.title = `${title} — magicNotes`;
    },

    syncActiveItemFromDom() {
        if (!this.activeItem || !this.mountZone) return;
        NoteSurface.syncItemBodyFromDom(this.mountZone, this.activeItem);
    },

    markInteracted() {},

    defaultExpandedSize() {
        const isPip = document.documentElement.dataset.popoutMode === 'pip';
        return isPip
            ? { w: PIP_WINDOW_W, h: PIP_WINDOW_H }
            : { w: POPUP_WINDOW_W, h: POPUP_WINDOW_H };
    },

    applyWindowSize(w, h) {
        try {
            window.resizeTo(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
        } catch (err) {
            console.warn('[PopoutNote] resizeTo failed:', err);
        }
    },

    syncWindowSizeButton() {
        const btn = this.card?.querySelector('.card-act--window-size');
        if (!btn) return;
        const title = this.windowCollapsed ? 'Expand window' : 'Collapse window';
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.setAttribute('aria-pressed', this.windowCollapsed ? 'true' : 'false');
        btn.innerHTML = this.windowCollapsed ? CARD_ICONS.expand : CARD_ICONS.collapse;
    },

    toggleWindowSize() {
        if (this.windowCollapsed) {
            const fallback = this.defaultExpandedSize();
            const w = this.rememberedOuterW || fallback.w;
            const h = this.rememberedOuterH || fallback.h;
            this.applyWindowSize(w, h);
            this.windowCollapsed = false;
        } else {
            this.rememberedOuterW = window.outerWidth || 0;
            this.rememberedOuterH = window.outerHeight || 0;
            this.applyWindowSize(POPOUT_COLLAPSED_W, POPOUT_COLLAPSED_H);
            this.windowCollapsed = true;
        }
        this.syncWindowSizeButton();
    },

    triggerAutoSave() {
        if (!this.card || !this.activeItem) return;
        const shell = this.card.querySelector('.editor-note-shell');
        if (shell) flushDesktopAutoSave(shell, this.activeItem, { mergeWindow: true });
    },

    openColorPicker() {
        if (!this.colorBtn || !this.activeItem) return;
        ColorPicker.open({
            anchor: this.colorBtn,
            presets: PALETTE_NOTE,
            value: resolveNoteColor(this.activeItem.backgroundColor),
            align: 'end',
            onSelect: (color) => {
                NoteSurface.mutateItem(this.activeItem, (it) => {
                    it.backgroundColor = color || THEME_DEFAULT_COLOR;
                }, { preserveView: true, skipRerender: true });
                applyItemCardTheme(this.card, this.activeItem);
            }
        });
    },

    openEmojiPicker() {
        const shell = this.mountZone?.querySelector('.editor-note-shell') || this.mountZone;
        NoteSurface.openEmojiPickerForNote(shell, this.iconBtn, this.activeItem, {
            onChange: () => this.triggerAutoSave()
        });
    },

    async closePopout({ skipPersist = false } = {}) {
        if (this.closing) return;
        this.closing = true;
        clearDesktopAutoSaveTimer();

        let finalSnap = null;
        try {
            if (!skipPersist && this.activeItem && this.token) {
                const shell = this.card?.querySelector('.editor-note-shell');
                const before = NoteSurface.snapshotItem(this.activeItem);
                if (shell) NoteSurface.syncItemBodyFromDom(shell, this.activeItem);
                const ok = await API.saveItem(this.activeItem, this.token);
                if (ok) {
                    UndoManager.recordItemChange(before, this.activeItem, {
                        preserveView: true,
                        label: historyLabelForItem(this.activeItem),
                        mergeWindow: false
                    });
                    finalSnap = NoteSurface.snapshotItem(this.activeItem);
                    NotePopoutBridge.broadcastNoteSaved(this.noteId, finalSnap);
                    NotePopoutBridge.broadcastUndoChanged();
                }
            } else if (this.activeItem) {
                finalSnap = NoteSurface.snapshotItem(this.activeItem);
            }
        } catch (err) {
            console.error('[PopoutNote] close save failed:', err);
            if (this.activeItem) finalSnap = NoteSurface.snapshotItem(this.activeItem);
        }

        NotePopoutBridge.release(this.noteId, { item: finalSnap });
        try {
            window.opener?.focus?.();
        } catch {
            /* ignore */
        }
        window.close();
        // If the browser blocks window.close (not opened by script), show status.
        window.setTimeout(() => {
            if (!window.closed) {
                this.closing = false;
                showAppToast('Close this window to pop the note back in');
            }
        }, 250);
    },

    flushNow() {
        if (!this.activeItem || !this.card) return;
        const shell = this.card.querySelector('.editor-note-shell');
        if (shell) {
            flushDesktopAutoSave(shell, this.activeItem, { mergeWindow: false });
        }
    },

    /**
     * Best-effort flush + claim release when the popout is torn down without
     * going through closePopout (native PiP back-to-tab fires pagehide;
     * classic window popouts may only get beforeunload).
     */
    teardownOnUnload() {
        if (this.closing) return;
        this.closing = true;
        clearDesktopAutoSaveTimer();
        let snapshot = null;
        const shell = this.card?.querySelector('.editor-note-shell');
        if (shell && this.activeItem) {
            NoteSurface.syncItemBodyFromDom(shell, this.activeItem);
            snapshot = NoteSurface.snapshotItem(this.activeItem);
            if (this.token) {
                // Fire-and-forget; browsers may kill the page mid-flight.
                API.saveItem(this.activeItem, this.token);
            }
        } else if (this.activeItem) {
            snapshot = NoteSurface.snapshotItem(this.activeItem);
        }
        NotePopoutBridge.release(this.noteId, { item: snapshot });
    },

    bindLifecycle() {
        // Document PiP: pagehide is the reliable close signal (native back-to-tab).
        window.addEventListener('pagehide', () => this.teardownOnUnload());
        // Classic window.open popouts: beforeunload as a best-effort fallback.
        window.addEventListener('beforeunload', () => this.teardownOnUnload());
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.flushNow();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.closePopout();
            }
        });
    },

    onBridgeMessage(msg) {
        if (msg?.type === 'request_close' && msg.noteId === this.noteId) {
            this.closePopout();
        }
    },

    async onMutation(e) {
        if (this.closing) return;
        const detail = e.detail;
        const item = detail?.item ?? detail;
        if (!item?.id || item.id !== this.noteId) return;
        if (!this.token) return;

        const beforeSnapshot = detail?.beforeItem
            ? JSON.parse(JSON.stringify(detail.beforeItem))
            : NoteSurface.snapshotItem(this.activeItem);

        const success = await API.saveItem(item, this.token);
        if (!success) {
            showAppToast('Could not save note');
            return;
        }

        Object.assign(this.activeItem, item);
        this.updateDocumentTitle();

        const skipUndo = detail?.skipUndo === true;
        if (!skipUndo && beforeSnapshot) {
            UndoManager.recordItemChange(beforeSnapshot, item, {
                preserveView: true,
                label: historyLabelForItem(item),
                mergeKey: detail?.mergeKey,
                mergeWindow: detail?.mergeWindow !== false
            });
        }

        NotePopoutBridge.broadcastNoteSaved(this.noteId, NoteSurface.snapshotItem(this.activeItem));
        if (!skipUndo) NotePopoutBridge.broadcastUndoChanged();
    },

    render() {
        if (!rootEl || !this.activeItem) return;
        const categories = readStoredCategories();
        const { targetCatName, categoryColor } = getCardRenderContext(this.activeItem, categories);

        rootEl.innerHTML = '';
        const card = document.createElement('div');
        card.className = 'note-popout-card mini-card has-custom-bg';
        card.dataset.id = this.activeItem.id;

        const toolbarHtml = NoteSurface.buildNoteQuickActionsHtml(this.activeItem, {
            surface: 'popout',
            calHidden: BoardOperations.isHiddenFromCalendar(this.activeItem),
            poppedOut: true,
            windowCollapsed: this.windowCollapsed
        });

        card.innerHTML = NoteSurface.buildNoteEditorShell(this.activeItem, {
            canEdit: true,
            richEdit: true,
            toolbarHtml,
            targetCatName,
            categoryColor
        });

        rootEl.appendChild(card);
        this.card = card;
        this.mountZone = card;
        applyItemCardTheme(card, this.activeItem);
        applyCardCategoryBand(card, categoryColor);

        bindNoteQuickActions(card, this.activeItem, {
            surface: 'popout',
            ui: uiStub,
            editor: this
        });

        const onChange = () => {
            const shell = card.querySelector('.editor-note-shell');
            if (shell) flushDesktopAutoSave(shell, this.activeItem, { mergeWindow: false });
        };

        NoteSurface.bindNoteEditorShell(card, this.activeItem, {
            richEdit: true,
            onChange,
            refresh: () => this.render(),
            stopMousedownPropagation: false
        });
    }
};

PopoutEditor.boot().catch((err) => {
    console.error('[PopoutNote]', err);
    if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = 'Failed to open popout note.';
    }
});
