// test/sync.test.js
// Unit tests for the cross-tab sync module (js/sync.js).
//
// The module keeps module-level state (channel, pending scopes, debounce timer
// per import, so each query-string specifier acts as a separate "tab/window",
// mirroring the pattern used in notePopoutBridge.test.js.
//
// Run with: npm test  (node --test test/)
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let broadcastInstances;

let storageListeners;

let fakeDocumentBody;

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
            // Browsers deliver channel messages as a later task — after any
            // synchronous state writes have landed..
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

/** Install fake browser globals the sync module touches at runtime. */
function installGlobals() {
    storageListeners = [];
    fakeDocumentBody = {
        classList: {
            contains: () => false,
            add() {},
            remove() {}
        }
    };

    globalThis.window = {
        addEventListener: (type, handler) => {
            if (type === 'storage') storageListeners.push(handler);
        }
    };
    globalThis.document = {
        activeElement: null,
        body: fakeDocumentBody,
        getElementById: () => null
    };

    broadcastInstances = new Set();
    globalThis.BroadcastChannel = FakeBroadcastChannel;
}

/** Each query-string specifier is a separate module instance = separate window. */
function loadSync(tag) {
    return import(`../js/sync.js?tab=${tag}`);
}

/** Fire a storage event intothe shared fake window — every module's listener runs. */
function fireStorage(key) {
    const event = { key };
    for (const handler of storageListeners) handler(event);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function setBusy(busy) {
    fakeDocumentBody.classList = {
        contains: () => busy,
        add() {},
        remove() {}
    };
}

beforeEach(() => {
    broadcastInstances = new Set();
});

afterEach(() => {
    for (const inst of broadcastInstances) inst.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.BroadcastChannel;
    storageListeners = [];
    fakeDocumentBody = null;
});

describe('cross-tab sync storage scope map', () => {
    it('maps representative persisted keys to coarse sync scopes', async () => {
        const { STORAGE_SCOPE_MAP } = await loadSync('map');
        assert.equal(STORAGE_SCOPE_MAP['matrix_database'], 'notes');
        assert.equal(STORAGE_SCOPE_MAP['matrix_undo_history'], 'notes');
        assert.equal(STORAGE_SCOPE_MAP['matrix_grid_layout'], 'layout');
        assert.equal(STORAGE_SCOPE_MAP['matrix_grid_pins'], 'layout');
        assert.equal(STORAGE_SCOPE_MAP['matrix_file_cabinet'], 'filecabinet');
        assert.equal(STORAGE_SCOPE_MAP['matrix_panel_collapsed'], 'sidebar');
        assert.equal(STORAGE_SCOPE_MAP['matrix_custom_categories'], 'categories');
        assert.equal(STORAGE_SCOPE_MAP['matrix_display_options'], 'display');
        assert.equal(STORAGE_SCOPE_MAP['matrix_custom_theme_tokens'], 'theme');
        assert.equal(STORAGE_SCOPE_MAP['matrix_workspace_mode'], 'workspace');
    });
});

describe('cross-tab sync storage-event insurance path', () => {
    it('coalesces multiple storage events into one debounced board refresh', async () => {
        installGlobals();
        const mod = await loadSync('coalesce');
        const refreshes = [];
        mod.initCrossTabSync({
            onBoardRefresh: (scopes) => refreshes.push([...scopes]),
            onVisualRefresh: () => {}
        });

        fireStorage('matrix_database');
        fireStorage('matrix_grid_layout');
        fireStorage('matrix_file_cabinet');

        // Within the debounce window — nothing yet.
        await sleep(100);
        assert.equal(refreshes.length, 0);

        await sleep(450);
        assert.equal(refreshes.length, 1);
        assert.deepEqual(refreshes[0], ['notes', 'layout', 'filecabinet']);
    });

    it('refreshes the board on a single storage write', async () => {
        installGlobals();
        const mod = await loadSync('single');
        const refreshes = [];
        mod.initCrossTabSync({
            onBoardRefresh: (scopes) => refreshes.push([...scopes]),
            onVisualRefresh: () => {}
        });

        fireStorage('matrix_database');
        await sleep(500);
        assert.deepEqual(refreshes, [['notes']]);
    });
});

describe('cross-tab sync BroadcastChannel path', () => {
    it('receives state_changed broadcasts from other windows and ignores its own', async () => {
        installGlobals();
        const tabA = await loadSync('chan-a');
        const tabB = await loadSync('chan-b');

        const gotB = [];
        const selfFires = [];
        tabB.initCrossTabSync({
            onBoardRefresh: (scopes) => gotB.push([...scopes]),
            onVisualRefresh: () => {}
        });
        tabA.initCrossTabSync({
            onBoardRefresh: (scopes) => selfFires.push([...scopes]),
            onVisualRefresh: () => {}
        });

        tabA.broadcastStateChange('notes', { key: 'matrix_database', noteId: 'n1' });
        await sleep(500);

        // B heard A; A must not refresh from its own broadcast.
        assert.deepEqual(gotB, [['notes']]);
        assert.equal(selfFires.length, 0);
    });

    it('applies visual scopes immediately with no board refresh or debounce', async () => {
        installGlobals();
        const tabA = await loadSync('visual-a');
        const tabB = await loadSync('visual-b');
        const visual = [];
        const board = [];
        tabB.initCrossTabSync({
            onBoardRefresh: () => board.push(1),
            onVisualRefresh: (scope) => visual.push(scope)
        });
        tabA.initCrossTabSync({
            onBoardRefresh: () => {},
            onVisualRefresh: () => {}
        });

        // BroadcastChannel never delivers to the sender — only the other
        // window (tabB) re-applies live, like a real browser would..
        tabA.broadcastStateChange('theme', { key: 'matrix_custom_theme_tokens' });
        tabA.broadcastStateChange('display', { key: 'matrix_display_options' });
        await sleep(20);

        assert.deepEqual(visual, ['theme', 'display']);
        assert.equal(board.length, 0);
    });
});

describe('cross-tab sync busy guard', () => {
    it('defers board refresh while the user is busy,then applies once free', async () => {
        installGlobals();
        const mod = await loadSync('busy');
        const refreshed = [];
        const deferred = [];
        mod.initCrossTabSync({
            onBoardRefresh: (scopes) => refreshed.push([...scopes]),
            onVisualRefresh: () => {},
            onDeferred: (scopes) => deferred.push([...scopes])
        });

        setBusy(true);
        fireStorage('matrix_database');
        await sleep(500);

        // Parked, not applied yet.
        assert.equal(refreshed.length, 0);
        assert.deepEqual(deferred, [['notes']]);

        // User finished — the next retry applies the parked batch.
        setBusy(false);
        await sleep(1200);
        assert.equal(refreshed.length, 1);
        assert.deepEqual(refreshed[0], ['notes']);
    });
});

