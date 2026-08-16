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
});