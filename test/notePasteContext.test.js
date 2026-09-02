// test/notePasteContext.test.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    filterImageFiles,
    isImageFile,
    registerLiveNoteSource,
    resolveImagePasteAttachNoteId,
    resolveLiveNoteItem,
    resolveNotePasteTarget,
    resetNotePasteContextForTests,
    setModalEditorNoteIdResolver
} from '../js/notePasteContext.js';
import { filesFromDataTransfer, resolvePasteStagingOpts } from '../js/mediaPasteCatcher.js';

function mockField({
    field = 'content',
    noteId = 'note-1',
    inModal = false,
    excluded = false,
    excludeKind = null
} = {}) {
    const shell = { __kind: 'shell' };
    const card = noteId ? { __kind: 'card', dataset: { id: noteId } } : null;
    const modalMount = inModal ? { __kind: 'modal' } : null;

    const fieldEl = {
        dataset: { field },
        classList: { contains: () => false },
        matches(sel) {
            if (excludeKind === 'sheet' && sel === '[data-sheet-cell]') return true;
            return false;
        },
        closest(sel) {
            if (excluded && sel === '#media-staging-overlay') return { __kind: 'staging' };
            if (excludeKind === 'cabinet' && sel.includes('file-cabinet')) return { __kind: 'cabinet' };
            if (sel === '.card-inline-edit') return fieldEl;
            if (sel === '.editor-note-shell') return shell;
            if (sel === '.mini-card') return card;
            if (sel === '#modal-form-mount') return modalMount;
            return null;
        }
    };
    return fieldEl;
}

describe('isImageFile', () => {
    it('accepts image mime types', () => {
        assert.equal(isImageFile({ type: 'image/png' }), true);
        assert.equal(isImageFile({ type: 'image/jpeg' }), true);
    });

    it('rejects non-image mime types', () => {
        assert.equal(isImageFile({ type: 'application/pdf' }), false);
        assert.equal(isImageFile({ type: 'text/plain' }), false);
        assert.equal(isImageFile(null), false);
    });
});

describe('filterImageFiles', () => {
    it('returns only image entries', () => {
        const files = [
            { type: 'image/png' },
            { type: 'application/pdf' },
            { type: 'image/webp' }
        ];
        assert.equal(filterImageFiles(files).length, 2);
    });
});

describe('resolveNotePasteTarget', () => {
    beforeEach(() => resetNotePasteContextForTests());

    it('returns note id and field for board inline content', () => {
        const active = mockField({ field: 'content', noteId: 'note-a' });
        assert.deepEqual(resolveNotePasteTarget(active), { noteId: 'note-a', field: 'content' });
    });

    it('accepts title and checklist step fields', () => {
        assert.deepEqual(
            resolveNotePasteTarget(mockField({ field: 'title' })),
            { noteId: 'note-1', field: 'title' }
        );
        assert.deepEqual(
            resolveNotePasteTarget(mockField({ field: 'step-text' })),
            { noteId: 'note-1', field: 'step-text' }
        );
    });

    it('resolves modal editor note id via resolver', () => {
        setModalEditorNoteIdResolver(() => 'modal-note-9');
        const active = mockField({ field: 'content', noteId: null, inModal: true });
        assert.deepEqual(resolveNotePasteTarget(active), {
            noteId: 'modal-note-9',
            field: 'content'
        });
    });

    it('returns null outside note shell', () => {
        const active = {
            closest(sel) {
                if (sel === '.card-inline-edit') return { dataset: { field: 'content' }, closest: () => null };
                return null;
            }
        };
        assert.equal(resolveNotePasteTarget(active), null);
    });

    it('returns null for excluded contexts', () => {
        assert.equal(resolveNotePasteTarget(mockField({ excluded: true })), null);
        assert.equal(resolveNotePasteTarget(mockField({ excludeKind: 'cabinet' })), null);
        assert.equal(resolveNotePasteTarget(mockField({ excludeKind: 'sheet' })), null);
    });

    it('returns null for unknown data-field values', () => {
        const active = mockField({ field: 'other' });
        assert.equal(resolveNotePasteTarget(active), null);
    });
});

describe('resolveImagePasteAttachNoteId', () => {
    it('returns note id when images present and logged in', () => {
        const files = [{ type: 'image/png' }];
        assert.equal(
            resolveImagePasteAttachNoteId(files, {
                pasteTarget: { noteId: 'n1', field: 'content' },
                hasLogin: true
            }),
            'n1'
        );
    });

    it('returns null without login or without images', () => {
        const target = { noteId: 'n1', field: 'content' };
        assert.equal(resolveImagePasteAttachNoteId([{ type: 'image/png' }], { pasteTarget: target, hasLogin: false }), null);
        assert.equal(resolveImagePasteAttachNoteId([{ type: 'application/pdf' }], { pasteTarget: target, hasLogin: true }), null);
        assert.equal(resolveImagePasteAttachNoteId([{ type: 'image/png' }], { pasteTarget: null, hasLogin: true }), null);
    });
});

describe('resolveLiveNoteItem', () => {
    beforeEach(() => resetNotePasteContextForTests());

    it('finds first matching registered source', () => {
        registerLiveNoteSource(() => null);
        registerLiveNoteSource((id) => (id === 'wanted' ? { id: 'wanted', title: 'Hi' } : null));
        assert.deepEqual(resolveLiveNoteItem('wanted'), { id: 'wanted', title: 'Hi' });
        assert.equal(resolveLiveNoteItem('other'), null);
    });
});

describe('resolvePasteStagingOpts', () => {
    it('sets attachNoteId for image paste in note when logged in', () => {
        const files = [{ type: 'image/png' }];
        const opts = resolvePasteStagingOpts(files, {
            hasLogin: true,
            pasteTarget: { noteId: 'note-x', field: 'title' }
        });
        assert.equal(opts.source, 'paste');
        assert.equal(opts.attachNoteId, 'note-x');
    });

    it('leaves attachNoteId null for non-image paste in note', () => {
        const opts = resolvePasteStagingOpts([{ type: 'application/pdf' }], {
            hasLogin: true,
            pasteTarget: { noteId: 'note-x', field: 'content' }
        });
        assert.equal(opts.attachNoteId, null);
    });

    it('leaves attachNoteId null when not logged in', () => {
        const opts = resolvePasteStagingOpts([{ type: 'image/png' }], {
            hasLogin: false,
            pasteTarget: { noteId: 'note-x', field: 'content' }
        });
        assert.equal(opts.attachNoteId, null);
        assert.equal(opts.loginRequiredForAttach, true);
    });
});

describe('filesFromDataTransfer', () => {
    it('reads clipboard files array', () => {
        const file = { name: 'a.png', type: 'image/png' };
        const dt = { files: [file], items: [] };
        assert.deepEqual(filesFromDataTransfer(dt), [file]);
    });

    it('falls back to DataTransferItem list', () => {
        const file = { name: 'b.png', type: 'image/png' };
        const dt = {
            files: [],
            items: [{ kind: 'file', getAsFile: () => file }]
        };
        assert.deepEqual(filesFromDataTransfer(dt), [file]);
    });

    it('returns empty array for missing data', () => {
        assert.deepEqual(filesFromDataTransfer(null), []);
    });
});
