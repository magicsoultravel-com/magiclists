// test/popoutWindows.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

function installGlobals() {
    globalThis.localStorage = {
        _data: new Map(),
        getItem(key) {
            return this._data.has(key) ? this._data.get(key) : null;
        },
        setItem(key, value) {
            this._data.set(key, String(value));
        }
    };
    globalThis.window = {
        isSecureContext: true,
        documentPictureInPicture: {
            requestWindow: async () => ({
                closed: false,
                document: { head: { prepend() {}, querySelectorAll: () => [] }, documentElement: { dataset: {} }, body: {} },
                addEventListener() {}
            })
        },
        location: { pathname: '/index.html', origin: 'http://localhost' }
    };
    globalThis.document = {
        head: { querySelectorAll: () => [], prepend() {} },
        documentElement: { attributes: [], dataset: {} }
    };
}

describe('popoutWindows PiP occupancy', () => {
    beforeEach(() => {
        installGlobals();
    });

    afterEach(() => {
        delete globalThis.localStorage;
        delete globalThis.window;
        delete globalThis.document;
    });

    it('starts unoccupied', async () => {
        const mod = await import('../js/popoutWindows.js?pipOcc=1');
        assert.equal(mod.isPipOccupied(), false);
    });

    it('tracks a single active PiP window per tab', async () => {
        const mod = await import('../js/popoutWindows.js?pipOcc=2');
        const win = { closed: false, addEventListener() {} };
        mod.registerPipWindow(win, { type: 'note', id: 'n1' });
        assert.equal(mod.isPipOccupied(), true);
        assert.deepEqual(mod.getActivePipOwner(), { type: 'note', id: 'n1' });
        mod.unregisterPipWindow(win);
        assert.equal(mod.isPipOccupied(), false);
    });

    it('requestPipWindow returns null when PiP is already occupied', async () => {
        const mod = await import('../js/popoutWindows.js?pipOcc=3');
        const win = { closed: false, addEventListener() {} };
        mod.registerPipWindow(win, { type: 'module', id: 'radio' });
        const next = await mod.requestPipWindow({
            width: 260,
            height: 480,
            owner: { type: 'module', id: 'tv' }
        });
        assert.equal(next, null);
    });
});

describe('popoutWindows preferences', () => {
    beforeEach(() => {
        installGlobals();
    });

    afterEach(() => {
        delete globalThis.localStorage;
        delete globalThis.window;
        delete globalThis.document;
    });

    it('shouldUsePipPopout respects stored window mode', async () => {
        const mod = await import('../js/popoutWindows.js?pref=1');
        localStorage.setItem('matrix_display_options', JSON.stringify({ popoutMode: 'window' }));
        assert.equal(mod.shouldUsePipPopout(), false);
        localStorage.setItem('matrix_display_options', JSON.stringify({ popoutMode: 'pip' }));
        assert.equal(mod.shouldUsePipPopout(), true);
    });
});
