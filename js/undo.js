import { API } from './api.js';
import { stripRichText } from './richText.js';

const MAX_STACK = 50;
const MERGE_MS = 2500;
const STORAGE_KEY = 'matrix_undo_history';

let handlers = {
    getToken: () => null,
    isEnabled: () => false,
    onRestore: async () => {},
    onRemove: async () => {},
    onStackChange: () => {}
};

function cloneItem(item) {
    return JSON.parse(JSON.stringify(item));
}

function itemsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

export function historyLabelForItem(item) {
    const title = stripRichText(item?.title || '').trim();
    return title ? `Edit "${title}"` : 'Edit note';
}

function serializeEntry(entry) {
    if (!entry?.kind) return null;
    if (entry.kind === 'change') {
        return {
            kind: 'change',
            label: entry.label,
            mergeKey: entry.mergeKey,
            mergedAt: entry.mergedAt,
            preserveView: !!entry.preserveView,
            before: entry.before,
            after: entry.after
        };
    }
    if (entry.kind === 'deletion') {
        return {
            kind: 'deletion',
            label: entry.label,
            item: entry.item
        };
    }
    return null;
}

export const UndoManager = {
    undoStack: [],
    redoStack: [],
    busy: false,
    isApplying: false,
    undoBtn: null,
    redoBtn: null,
    controlsEl: null,

    init(h = {}) {
        handlers = { ...handlers, ...h };
        this.undoBtn = document.getElementById('btn-undo');
        this.redoBtn = document.getElementById('btn-redo');
        this.controlsEl = document.getElementById('history-controls');

        this.undoBtn?.addEventListener('click', () => this.undo());
        this.redoBtn?.addEventListener('click', () => this.redo());
        document.addEventListener('keydown', (e) => this.handleKeydown(e));
        this.loadStacks();
        this.updateToolbar();
    },

    createChangeEntry({ before, after, preserveView = false, label, mergeKey, mergedAt }) {
        const beforeItem = cloneItem(before);
        const afterItem = cloneItem(after);
        const keepView = !!preserveView;
        return {
            kind: 'change',
            label: label || historyLabelForItem(afterItem),
            mergeKey,
            mergedAt,
            preserveView: keepView,
            before: beforeItem,
            after: afterItem,
            undo: () => this.applyItem(beforeItem, { preserveView: keepView }),
            redo: () => this.applyItem(afterItem, { preserveView: keepView })
        };
    },

    createDeletionEntry(item, label) {
        const snapshot = cloneItem(item);
        const itemLabel = label || `Delete "${stripRichText(snapshot.title || '').trim() || 'note'}"`;
        return {
            kind: 'deletion',
            label: itemLabel,
            item: snapshot,
            undo: () => this.applyItem(snapshot, { preserveView: false }),
            redo: async () => {
                const token = handlers.getToken();
                if (!token) return false;
                const ok = await API.deleteItem(snapshot.id, token);
                if (ok) await handlers.onRemove(snapshot.id);
                return ok;
            }
        };
    },

    hydrateEntry(data) {
        if (!data?.kind) return null;
        if (data.kind === 'change' && data.before && data.after) {
            return this.createChangeEntry({
                before: data.before,
                after: data.after,
                preserveView: data.preserveView,
                label: data.label,
                mergeKey: data.mergeKey,
                mergedAt: data.mergedAt
            });
        }
        if (data.kind === 'deletion' && data.item) {
            return this.createDeletionEntry(data.item, data.label);
        }
        return null;
    },

    loadStacks() {
        if (!handlers.isEnabled()) {
            this.undoStack = [];
            this.redoStack = [];
            return;
        }
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            const undo = Array.isArray(parsed?.undo) ? parsed.undo : [];
            const redo = Array.isArray(parsed?.redo) ? parsed.redo : [];
            this.undoStack = undo.map((entry) => this.hydrateEntry(entry)).filter(Boolean);
            this.redoStack = redo.map((entry) => this.hydrateEntry(entry)).filter(Boolean);
        } catch (err) {
            console.warn('[Undo] could not load history:', err);
            this.undoStack = [];
            this.redoStack = [];
        }
    },

    persistStacks() {
        if (!handlers.isEnabled()) return;
        try {
            const payload = {
                undo: this.undoStack.map(serializeEntry).filter(Boolean),
                redo: this.redoStack.map(serializeEntry).filter(Boolean)
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (err) {
            console.warn('[Undo] could not persist history:', err);
        }
    },

    clear({ persist = true } = {}) {
        this.undoStack = [];
        this.redoStack = [];
        if (persist) {
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch {
                /* ignore */
            }
        }
        this.updateToolbar();
    },

    handleKeydown(e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        const active = document.activeElement;
        const tag = active?.tagName;
        if (active?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (!handlers.isEnabled()) return;

        if (e.key === 'z' && !e.shiftKey) {
            if (!this.undoStack.length) return;
            e.preventDefault();
            this.undo();
            return;
        }
        if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
            if (!this.redoStack.length) return;
            e.preventDefault();
            this.redo();
        }
    },

    push(entry) {
        if (!handlers.isEnabled()) return;
        this.undoStack.push(entry);
        if (this.undoStack.length > MAX_STACK) this.undoStack.shift();
        this.redoStack = [];
        this.updateToolbar();
    },

    async applyItem(item, { preserveView = false } = {}) {
        const token = handlers.getToken();
        if (!token || !item) return false;
        const ok = await API.saveItem(item, token);
        if (ok) await handlers.onRestore(item, { preserveView });
        return ok;
    },

    recordItemChange(beforeItem, afterItem, {
        preserveView = false,
        label,
        mergeKey,
        mergeWindow = true
    } = {}) {
        if (this.isApplying || !handlers.isEnabled() || !beforeItem || !afterItem) return;
        if (itemsEqual(beforeItem, afterItem)) return;

        const after = cloneItem(afterItem);
        const entryLabel = label || historyLabelForItem(after);
        const now = Date.now();
        const top = this.undoStack[this.undoStack.length - 1];
        const key = mergeKey || after.id;

        if (mergeWindow && top?.kind === 'change' && top.mergeKey === key && now - (top.mergedAt || 0) < MERGE_MS) {
            top.after = cloneItem(after);
            top.redo = () => this.applyItem(top.after, { preserveView });
            top.label = entryLabel;
            top.mergedAt = now;
            this.redoStack = [];
            this.updateToolbar();
            return;
        }

        this.push(this.createChangeEntry({
            before: beforeItem,
            after,
            preserveView,
            label: entryLabel,
            mergeKey: key,
            mergedAt: now
        }));
    },

    recordItemDeletion(item, label) {
        this.push(this.createDeletionEntry(item, label));
    },

    async undo() {
        if (this.busy || !this.undoStack.length || !handlers.isEnabled()) return;
        const entry = this.undoStack.pop();
        if (!entry) return;

        this.busy = true;
        this.isApplying = true;
        this.updateToolbar();
        try {
            const ok = await entry.undo();
            if (ok === false) {
                this.undoStack.push(entry);
            } else {
                this.redoStack.push(entry);
            }
        } catch (err) {
            console.error('[Undo] failed:', err);
            this.undoStack.push(entry);
        } finally {
            this.busy = false;
            this.isApplying = false;
            this.updateToolbar();
        }
    },

    async redo() {
        if (this.busy || !this.redoStack.length || !handlers.isEnabled()) return;
        const entry = this.redoStack.pop();
        if (!entry) return;

        this.busy = true;
        this.isApplying = true;
        this.updateToolbar();
        try {
            const ok = await entry.redo();
            if (ok === false) {
                this.redoStack.push(entry);
            } else {
                this.undoStack.push(entry);
            }
        } catch (err) {
            console.error('[Redo] failed:', err);
            this.redoStack.push(entry);
        } finally {
            this.busy = false;
            this.isApplying = false;
            this.updateToolbar();
        }
    },

    updateToolbar() {
        const enabled = handlers.isEnabled();
        this.controlsEl?.classList.toggle('is-hidden', !enabled);
        if (this.undoBtn) {
            this.undoBtn.disabled = !enabled || this.busy || this.undoStack.length === 0;
            this.undoBtn.title = this.undoStack.length
                ? `Undo: ${this.undoStack[this.undoStack.length - 1].label} (Ctrl+Z)`
                : 'Undo (Ctrl+Z)';
        }
        if (this.redoBtn) {
            this.redoBtn.disabled = !enabled || this.busy || this.redoStack.length === 0;
            this.redoBtn.title = this.redoStack.length
                ? `Redo: ${this.redoStack[this.redoStack.length - 1].label} (Ctrl+Y)`
                : 'Redo (Ctrl+Y)';
        }
        if (enabled) this.persistStacks();
        handlers.onStackChange?.();
    }
};
