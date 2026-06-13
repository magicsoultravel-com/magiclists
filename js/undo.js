import { API } from './api.js';
import { safeSetItem } from './layoutStorage.js';
import { stripRichText } from './richText.js';
import { showAppToast } from './toast.js';

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

function trimStack(stack, max = MAX_STACK) {
    while (stack.length > max) stack.shift();
}

function trimStacks(manager) {
    trimStack(manager.undoStack);
    trimStack(manager.redoStack);
}

function itemForwardDelta(before, after) {
    const delta = {};
    const keys = new Set([
        ...Object.keys(before || {}),
        ...Object.keys(after || {})
    ]);
    keys.forEach((key) => {
        if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) {
            delta[key] = after[key];
        }
    });
    return delta;
}

function applyForwardDelta(before, delta) {
    return { ...before, ...delta };
}

function afterItemFromData(data) {
    if (!data?.before) return null;
    if (data.after) return cloneItem(data.after);
    if (data.forwardDelta) return applyForwardDelta(cloneItem(data.before), data.forwardDelta);
    return null;
}

export function historyLabelForItem(item) {
    const title = stripRichText(item?.title || '').trim();
    return title ? `Edit "${title}"` : 'Edit note';
}

const DETAIL_MAX_LINES = 12;
const DETAIL_MAX_LINE_CHARS = 320;
const DETAIL_TEXT_PREVIEW = 280;
const DETAIL_MAX_STEP_CHANGES = 5;

const DETAIL_SKIP_KEYS = new Set(['id', 'owner_id', 'created_at', 'updated_at']);

const DETAIL_FIELD_LABELS = {
    title: 'Title',
    content: 'Content',
    steps: 'Checklist',
    status: 'Status',
    visibility: 'Visibility',
    type: 'Type',
    categories: 'Categories',
    backgroundColor: 'Color',
    tileSize: 'Tile size',
    editorBodyLayout: 'Editor layout',
    startDateTime: 'Start',
    endDateTime: 'End',
    hiddenFromBoard: 'Hidden from board',
    hideFromCalendar: 'Hidden from calendar',
    isRecurring: 'Recurring',
    attachments: 'Attachments'
};

function truncateDetailText(text, max = DETAIL_MAX_LINE_CHARS) {
    const value = String(text ?? '');
    if (value.length <= max) return value;
    return `${value.slice(0, max - 1)}…`;
}

function plainFieldText(value) {
    return stripRichText(value || '').trim();
}

function formatEmptyLabel(text) {
    return text ? text : '(empty)';
}

function formatTextChange(beforeVal, afterVal, { hugeSummaryLabel = 'Content' } = {}) {
    const before = plainFieldText(beforeVal);
    const after = plainFieldText(afterVal);
    if (!before && !after) return null;
    const totalLen = before.length + after.length;
    if (totalLen > DETAIL_TEXT_PREVIEW * 2) {
        const delta = after.length - before.length;
        const sign = delta >= 0 ? '+' : '';
        return `${hugeSummaryLabel} updated (${sign}${delta} chars)`;
    }
    const left = truncateDetailText(formatEmptyLabel(before), DETAIL_TEXT_PREVIEW);
    const right = truncateDetailText(formatEmptyLabel(after), DETAIL_TEXT_PREVIEW);
    return `${left} → ${right}`;
}

function formatScalarChange(label, beforeVal, afterVal) {
    const left = beforeVal == null || beforeVal === '' ? '(empty)' : String(beforeVal);
    const right = afterVal == null || afterVal === '' ? '(empty)' : String(afterVal);
    if (left === right) return null;
    return `${label}: ${truncateDetailText(left)} → ${truncateDetailText(right)}`;
}

function formatBoolChange(label, beforeVal, afterVal) {
    const left = beforeVal === true ? 'yes' : 'no';
    const right = afterVal === true ? 'yes' : 'no';
    if (left === right) return null;
    return `${label}: ${left} → ${right}`;
}

function formatCategoriesChange(beforeVal, afterVal) {
    const left = Array.isArray(beforeVal) ? beforeVal.filter(Boolean).join(', ') : '';
    const right = Array.isArray(afterVal) ? afterVal.filter(Boolean).join(', ') : '';
    return formatScalarChange('Categories', left || '(none)', right || '(none)');
}

function describeStepsChange(beforeSteps, afterSteps) {
    const before = Array.isArray(beforeSteps) ? beforeSteps : [];
    const after = Array.isArray(afterSteps) ? afterSteps : [];
    const beforeById = new Map(before.map((step) => [step.id, step]));
    const afterById = new Map(after.map((step) => [step.id, step]));
    const changes = [];

    after.forEach((step) => {
        if (!beforeById.has(step.id)) {
            const text = truncateDetailText(plainFieldText(step.text) || '(empty step)', DETAIL_TEXT_PREVIEW);
            changes.push(`+ ${text}`);
        }
    });

    before.forEach((step) => {
        if (!afterById.has(step.id)) {
            const text = truncateDetailText(plainFieldText(step.text) || '(empty step)', DETAIL_TEXT_PREVIEW);
            changes.push(`− ${text}`);
        }
    });

    after.forEach((step) => {
        const prev = beforeById.get(step.id);
        if (!prev) return;
        if (!!prev.completed !== !!step.completed) {
            const mark = step.completed ? '✓' : '☐';
            const text = truncateDetailText(plainFieldText(step.text) || '(step)', DETAIL_TEXT_PREVIEW);
            changes.push(`${mark} ${text}`);
            return;
        }
        const prevText = plainFieldText(prev.text);
        const nextText = plainFieldText(step.text);
        if (prevText !== nextText) {
            changes.push(`${truncateDetailText(formatEmptyLabel(prevText), DETAIL_TEXT_PREVIEW)} → ${truncateDetailText(formatEmptyLabel(nextText), DETAIL_TEXT_PREVIEW)}`);
        }
        if (Number(prev.level) !== Number(step.level)) {
            changes.push(`Level ${prev.level ?? 0} → ${step.level ?? 0}: ${truncateDetailText(nextText || prevText || '(step)', DETAIL_TEXT_PREVIEW)}`);
        }
    });

    if (!changes.length) return null;
    const shown = changes.slice(0, DETAIL_MAX_STEP_CHANGES);
    const rest = changes.length - shown.length;
    if (rest > 0) shown.push(`…and ${rest} more`);
    return shown.map((line) => `Checklist: ${line}`);
}

function describeChangeEntry(entry) {
    const before = entry.before;
    const delta = entry.forwardDelta || {};
    const after = applyForwardDelta(before, delta);
    const changedKeys = Object.keys(delta).filter((key) => !DETAIL_SKIP_KEYS.has(key));
    const lines = [];

    const pushLine = (line) => {
        if (!line || lines.length >= DETAIL_MAX_LINES) return;
        lines.push(truncateDetailText(line));
    };

    const orderedKeys = [
        'title', 'content', 'steps', 'status', 'visibility', 'type', 'categories',
        'backgroundColor', 'tileSize', 'editorBodyLayout', 'startDateTime', 'endDateTime',
        'hiddenFromBoard', 'hideFromCalendar', 'isRecurring', 'attachments'
    ];
    const keys = [
        ...orderedKeys.filter((key) => changedKeys.includes(key)),
        ...changedKeys.filter((key) => !orderedKeys.includes(key))
    ];

    keys.forEach((key) => {
        if (lines.length >= DETAIL_MAX_LINES) return;
        const label = DETAIL_FIELD_LABELS[key] || key;
        const beforeVal = before?.[key];
        const afterVal = after?.[key];

        if (key === 'title' || key === 'content') {
            const line = formatTextChange(beforeVal, afterVal, {
                hugeSummaryLabel: label
            });
            if (line) pushLine(`${label}: ${line}`);
            return;
        }
        if (key === 'steps') {
            describeStepsChange(beforeVal, afterVal)?.forEach(pushLine);
            return;
        }
        if (key === 'categories') {
            pushLine(formatCategoriesChange(beforeVal, afterVal));
            return;
        }
        if (key === 'hiddenFromBoard' || key === 'hideFromCalendar' || key === 'isRecurring') {
            pushLine(formatBoolChange(label, beforeVal, afterVal));
            return;
        }
        if (key === 'attachments') {
            pushLine('Attachments changed');
            return;
        }
        pushLine(formatScalarChange(label, beforeVal, afterVal));
    });

    if (!lines.length) {
        lines.push('Changes recorded');
    }
    return lines;
}

function describeDeletionEntry(entry) {
    const item = entry.item || {};
    const title = plainFieldText(item.title) || 'Untitled';
    const content = plainFieldText(item.content);
    const lines = [`Deleted "${truncateDetailText(title, DETAIL_TEXT_PREVIEW)}"`];
    if (content) {
        lines.push(`Content: ${truncateDetailText(content, DETAIL_TEXT_PREVIEW)}`);
    }
    return lines;
}

/** Lazy detail for sidebar history hover; caches on entry._detailCache. */
export function describeHistoryEntry(entry) {
    if (!entry) {
        return { title: 'Edit', lines: ['No details'], summary: 'No details' };
    }
    if (entry._detailCache) return entry._detailCache;

    const title = entry.label || 'Edit';
    let lines = [];

    if (entry.kind === 'change' && entry.before && entry.forwardDelta) {
        lines = describeChangeEntry(entry);
    } else if (entry.kind === 'deletion' && entry.item) {
        lines = describeDeletionEntry(entry);
    } else {
        lines = ['Changes recorded'];
    }

    const summary = lines[0] || title;
    entry._detailCache = { title, lines, summary };
    return entry._detailCache;
}

function serializeEntry(entry) {
    if (!entry?.kind) return null;
    if (entry.kind === 'change') {
        const forwardDelta = entry.forwardDelta
            ?? (entry.before && entry.after ? itemForwardDelta(entry.before, entry.after) : null);
        if (!entry.before || !forwardDelta) return null;
        return {
            kind: 'change',
            label: entry.label,
            mergeKey: entry.mergeKey,
            mergedAt: entry.mergedAt,
            preserveView: !!entry.preserveView,
            before: entry.before,
            forwardDelta
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

    init(h = {}) {
        handlers = { ...handlers, ...h };
        if (!this._keydownBound) {
            document.addEventListener('keydown', (e) => this.handleKeydown(e));
            this._keydownBound = true;
        }
        this.loadStacks();
        this.rebindToolbar();
    },

    rebindToolbar() {
        this.undoBtn = document.getElementById('btn-undo');
        this.redoBtn = document.getElementById('btn-redo');
        this.undoBtn?.addEventListener('click', () => this.undo());
        this.redoBtn?.addEventListener('click', () => this.redo());
        this.updateToolbar();
    },

    createChangeEntry({ before, after, preserveView = false, label, mergeKey, mergedAt }) {
        const beforeItem = cloneItem(before);
        const forwardDelta = itemForwardDelta(beforeItem, after);
        const afterItem = applyForwardDelta(beforeItem, forwardDelta);
        const keepView = !!preserveView;
        return {
            kind: 'change',
            label: label || historyLabelForItem(afterItem),
            mergeKey,
            mergedAt,
            preserveView: keepView,
            before: beforeItem,
            forwardDelta,
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
        if (data.kind === 'change' && data.before) {
            const after = afterItemFromData(data);
            if (!after) return null;
            return this.createChangeEntry({
                before: data.before,
                after,
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
            trimStacks(this);
        } catch (err) {
            console.warn('[Undo] could not load history:', err);
            this.undoStack = [];
            this.redoStack = [];
        }
    },

    persistStacks() {
        if (!handlers.isEnabled()) return;
        trimStacks(this);
        while (true) {
            const payload = {
                undo: this.undoStack.map(serializeEntry).filter(Boolean),
                redo: this.redoStack.map(serializeEntry).filter(Boolean)
            };
            if (safeSetItem(STORAGE_KEY, JSON.stringify(payload))) return;
            if (this.undoStack.length) {
                this.undoStack.shift();
                continue;
            }
            if (this.redoStack.length) {
                this.redoStack.shift();
                continue;
            }
            console.warn('[Undo] could not persist history: quota exceeded');
            return;
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
        trimStack(this.undoStack);
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
            top.forwardDelta = itemForwardDelta(top.before, after);
            const afterMerged = applyForwardDelta(top.before, top.forwardDelta);
            top.redo = () => this.applyItem(afterMerged, { preserveView });
            top.label = entryLabel;
            top.mergedAt = now;
            delete top._detailCache;
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
                trimStack(this.undoStack);
            } else {
                this.redoStack.push(entry);
                trimStack(this.redoStack);
                showAppToast(`Undid: ${entry.label}`);
            }
        } catch (err) {
            console.error('[Undo] failed:', err);
            this.undoStack.push(entry);
            trimStack(this.undoStack);
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
                trimStack(this.redoStack);
            } else {
                this.undoStack.push(entry);
                trimStack(this.undoStack);
                showAppToast(`Redid: ${entry.label}`);
            }
        } catch (err) {
            console.error('[Redo] failed:', err);
            this.redoStack.push(entry);
            trimStack(this.redoStack);
        } finally {
            this.busy = false;
            this.isApplying = false;
            this.updateToolbar();
        }
    },

    updateToolbar() {
        const enabled = handlers.isEnabled();
        this.undoBtn?.classList.toggle('is-hidden', !enabled);
        this.redoBtn?.classList.toggle('is-hidden', !enabled);
        if (this.undoBtn) {
            this.undoBtn.disabled = !enabled || this.busy || this.undoStack.length === 0;
            if (this.undoStack.length) {
                const entry = this.undoStack[this.undoStack.length - 1];
                const summary = describeHistoryEntry(entry).summary;
                this.undoBtn.title = `Undo: ${entry.label} — ${summary} (Ctrl+Z)`;
            } else {
                this.undoBtn.title = 'Undo (Ctrl+Z)';
            }
        }
        if (this.redoBtn) {
            this.redoBtn.disabled = !enabled || this.busy || this.redoStack.length === 0;
            if (this.redoStack.length) {
                const entry = this.redoStack[this.redoStack.length - 1];
                const summary = describeHistoryEntry(entry).summary;
                this.redoBtn.title = `Redo: ${entry.label} — ${summary} (Ctrl+Y)`;
            } else {
                this.redoBtn.title = 'Redo (Ctrl+Y)';
            }
        }
        if (enabled) this.persistStacks();
        handlers.onStackChange?.();
    }
};
