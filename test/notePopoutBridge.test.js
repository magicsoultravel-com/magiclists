// test/notePopoutBridge.test.js
// Regression tests for the note-popout cross-window protocol.
//
// The popout is opened with window.open(), which gives the popup an initial
// *copy* of the opener's sessionStorage. Because the bridge stores its window
// id in sessionStorage, the popup could inherit the main window's id. When
// both windows share an id the app treats them as one identity: the main
// drops every popout broadcast (senderId === own id) and never sees the
// popout's claim as "other" — so the board locks nothing, live saves never
// reach the board, and the final snapshot never returns on pop-in.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const WINDOW_ID_KEY = 'matrix_note_popout_window_id';

let sessionStore;
let localStorageStore;
let broadcastInstances;

class FakeBroadcastChannel {
    constructor(name) {
        this.name = name;
        this.onmessage = null;
        this.closed = false;
        broadcastInstances.add(this);
    }

    postMessage(message) {
        const recipients = [...broadcastInstances].filter((inst) => inst !== this && !inst.closed);
        for (const inst of recipients) {
            // Browsers deliver channel messages as a later task — after the
            // synchronous localStorage claim write has landed.
            queueMicrotask(() => {
                if (!inst.closed && inst.onmessage) inst.onmessage({ data: message });
            });
        }
    }

    close() {
        this.closed = true;
        broadcastInstances.delete(this);
    }
}

/** Install fake browser globals the bridge touches at runtime. */
function installGlobals({ seededWindowId = null } = {}) {
    sessionStore = new Map();
    if (seededWindowId) sessionStore.set(WINDOW_ID_KEY, seededWindowId);
    localStorageStore = new Map();

    globalThis.sessionStorage = {
        getItem: (key) => (sessionStore.has(key) ? sessionStore.get(key) : null),
        setItem: (key, value) => sessionStore.set(key, String(value)),
        removeItem: (key) => sessionStore.delete(key)
    };
    globalThis.localStorage = {
        getItem: (key) => (localStorageStore.has(key) ? localStorageStore.get(key) : null),
        setItem: (key, value) => localStorageStore.set(key, String(value)),
        removeItem: (key) => localStorageStore.delete(key)
    };
    globalThis.window = {
        addEventListener: () => {},
        setInterval: () => 1,
        clearInterval: () => {},
        name: ''
    };
    globalThis.document = {
        querySelectorAll: () => []
    };

    broadcastInstances = new Set();
    globalThis.BroadcastChannel = FakeBroadcastChannel;
}

/** Each query-string specifier is a separate module instance = separate window. */
function loadBridge(tag) {
    return import(`../js/notePopoutBridge.js?window=${tag}`);
}

function tick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
    broadcastInstances = new Set();
});

afterEach(() => {
    for (const inst of broadcastInstances) inst.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
    delete globalThis.BroadcastChannel;
});
describe('popout window style (frameless PiP vs browser window)', () => {
    it('defaults to the frameless PiP preference when no option is stored', async () => {
        installGlobals();
        const { readPopoutModePreference } = await import('../js/notePopoutBridge.js?pip-pref-default');
        assert.equal(readPopoutModePreference(), 'pip');
    });

    it('respects a stored browser-window preference', async () => {
        installGlobals();
        localStorageStore.set('matrix_display_options', JSON.stringify({ popoutMode: 'window' }));
        const { readPopoutModePreference } = await import('../js/notePopoutBridge.js?pip-pref-window');
        assert.equal(readPopoutModePreference(), 'window');
    });

    it('detects supported Document Picture-in-Picture in a capable browser', async () => {
        installGlobals();
        globalThis.window.isSecureContext = true;
        globalThis.window.documentPictureInPicture = { requestWindow: () => Promise.resolve(null) };
        const { supportsDocumentPip } = await import('../js/notePopoutBridge.js?pip-detect-supported');
        assert.equal(supportsDocumentPip(), true);
    });

    it('reports no PiP support when the browser lacks the API', async () => {
        installGlobals();
        const { supportsDocumentPip } = await import('../js/notePopoutBridge.js?pip-detect-unsupported');
        assert.equal(supportsDocumentPip(), false);
    });
});
describe('note popout bridge window identity', () => {
    it('gives a popout a fresh window id instead of inheriting the opener clone', async () => {
        installGlobals({ seededWindowId: 'opener-window-id' });

        const main = await loadBridge('main');
        const popout = await loadBridge('popout');
        const popout2 = await loadBridge('popout2');

        main.NotePopoutBridge.init({ role: 'main' });
        popout.NotePopoutBridge.init({ role: 'popout' });
        popout2.NotePopoutBridge.init({ role: 'popout' });

        assert.notEqual(popout.NotePopoutBridge.windowId, main.NotePopoutBridge.windowId,
            'a popout inheriting the main id must mint its own');
        assert.notEqual(popout2.NotePopoutBridge.windowId, popout.NotePopoutBridge.windowId,
            'two popouts must never share a window id');
    });

    it('keeps the main window id stable across reloads', async () => {
        installGlobals();

        const main = await loadBridge('reload-main');
        main.NotePopoutBridge.init({ role: 'main' });
        const firstId = main.NotePopoutBridge.windowId;

        // Same tab reload: reads the same sessionStorage again.
        const mainReload = await loadBridge('reload-main-again');
        mainReload.NotePopoutBridge.init({ role: 'main' });

        assert.equal(mainReload.NotePopoutBridge.windowId, firstId);
    });

    it('delivers claim + save + pop-in broadcasts from popout to main', async () => {
        installGlobals({ seededWindowId: 'opener-window-id' });

        const main = await loadBridge('flow-main');
        const popout = await loadBridge('flow-popout');

        const claimEvents = [];
        const noteSavedEvents = [];

        main.NotePopoutBridge.init({
            role: 'main',
            handlers: {
                onClaimChanged: (noteId, item) => claimEvents.push({ noteId, item }),
                onNoteSaved: (noteId, item) => noteSavedEvents.push({ noteId, item })
            }
        });
        popout.NotePopoutBridge.init({ role: 'popout' });

        const noteId = 'note-1';

        // --- Pop out: the popout claims the note ---
        assert.equal(popout.NotePopoutBridge.claim(noteId, { role: 'popout' }), true);
        await tick();

        assert.equal(main.NotePopoutBridge.isClaimedByOther(noteId), true,
            'board must see the popout as the owner so it can lock the card');
        assert.equal(main.NotePopoutBridge.isPoppedOut(noteId), true);

        // --- Live edits broadcast while the popout is open ---
        const snapshot = { id: noteId, title: 'Edited in popout', content: '<p>latest edit</p>' };
        popout.NotePopoutBridge.broadcastNoteSaved(noteId, snapshot);
        await tick();

        assert.equal(noteSavedEvents.length, 1, 'main must receive live note_saved broadcasts');
        assert.deepEqual(noteSavedEvents[0].item, snapshot);

        // --- Pop in: closing hands back the final snapshot ---
        claimEvents.length = 0;
        const finalSnap = { id: noteId, title: 'Final', content: '<p>final edit</p>' };
        popout.NotePopoutBridge.release(noteId, { item: finalSnap });
        await tick();

        assert.equal(main.NotePopoutBridge.isClaimedByOther(noteId), false,
            'claim must clear after pop-in');
        assert.equal(popout.NotePopoutBridge.isClaimedByUs(noteId), false);

        const closedEvent = claimEvents.find((e) => e.noteId === noteId);
        assert.ok(closedEvent, 'main must receive the popout_closed claim-change broadcast');
        assert.deepEqual(closedEvent.item, finalSnap,
            'pop-in must return the final snapshot so the board repaints latest content');
    });

    it('force-clears an orphaned popout claim when the opener handles PiP close', async () => {
        installGlobals({ seededWindowId: 'opener-window-id' });

        const main = await loadBridge('pip-close-main');
        const popout = await loadBridge('pip-close-popout');

        const claimEvents = [];
        main.NotePopoutBridge.init({
            role: 'main',
            handlers: {
                onClaimChanged: (noteId, item) => claimEvents.push({ noteId, item })
            }
        });
        popout.NotePopoutBridge.init({ role: 'popout' });

        const noteId = 'note-pip-orphan';
        assert.equal(popout.NotePopoutBridge.claim(noteId, { role: 'popout' }), true);
        await tick();
        assert.equal(main.NotePopoutBridge.isPoppedOut(noteId), true);
        assert.equal(main.NotePopoutBridge.isClaimedByOther(noteId), true);

        // Simulate native back-to-tab: popout dies without calling release.
        // Main owns a different windowId, so release() would not clear the claim.
        claimEvents.length = 0;
        const fakePip = { closed: true };
        main.NotePopoutBridge.pipWindows.add(fakePip);
        main.NotePopoutBridge.openWindows.set(noteId, fakePip);
        main.NotePopoutBridge.handlePipClosed(noteId, fakePip);

        assert.equal(main.NotePopoutBridge.isPoppedOut(noteId), false,
            'orphaned popout claim must clear on PiP pagehide');
        assert.equal(main.NotePopoutBridge.isClaimedByOther(noteId), false);
        assert.equal(main.NotePopoutBridge.pipWindows.has(fakePip), false);
        assert.equal(main.NotePopoutBridge.openWindows.has(noteId), false);

        const closedEvent = claimEvents.find((e) => e.noteId === noteId);
        assert.ok(closedEvent, 'board must be notified so locked cards unlock');
        assert.equal(closedEvent.item, null);
    });

    it('is a no-op when PiP close runs after a normal pop-in release', async () => {
        installGlobals({ seededWindowId: 'opener-window-id' });

        const main = await loadBridge('pip-idempotent-main');
        const popout = await loadBridge('pip-idempotent-popout');

        const claimEvents = [];
        main.NotePopoutBridge.init({
            role: 'main',
            handlers: {
                onClaimChanged: (noteId) => claimEvents.push(noteId)
            }
        });
        popout.NotePopoutBridge.init({ role: 'popout' });

        const noteId = 'note-pip-done';
        popout.NotePopoutBridge.claim(noteId, { role: 'popout' });
        await tick();
        popout.NotePopoutBridge.release(noteId, { item: { id: noteId } });
        await tick();

        claimEvents.length = 0;
        main.NotePopoutBridge.handlePipClosed(noteId, null);

        assert.equal(main.NotePopoutBridge.isPoppedOut(noteId), false);
        assert.equal(claimEvents.length, 0,
            'second close must not re-broadcast when the claim is already gone');
    });
});
