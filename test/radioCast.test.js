// test/radioCast.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

function installCastGlobals() {
    const ctxListeners = [];
    const win = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
    win.chrome = {
        cast: {
            media: { DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1PRIMARY' },
            AutoJoinPolicy: { ORIGIN_SCOPED: 'origin' }
        }
    };
    win.cast = {
        framework: {
            CastContextEventType: { SESSION_STATE_CHANGED: 'session_changed' },
            CastContext: {
                getInstance: () => ({
                    setOptions(opts) { win._castOptions = opts; },
                    addEventListener(type, fn) { ctxListeners.push({ type, fn }); },
                    getCurrentSession: () => null,
                    endCurrentSession: async () => {}
                })
            }
        }
    };
    globalThis.window = win;
    globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
    return { win, ctxListeners };
}

function installNoCastGlobals() {
    globalThis.window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
    globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
}

describe('RadioCast init', () => {
    beforeEach(() => {
        delete globalThis.window;
        delete globalThis.CustomEvent;
    });

    afterEach(() => {
        delete globalThis.window;
        delete globalThis.CustomEvent;
    });

    it('resolves fast when the Cast SDK is already available and wires the context once', async () => {
        const { win, ctxListeners } = installCastGlobals();
        const { RadioCast } = await import(`../js/radioCast.js?fast=${Date.now()}`);

        // Two concurrent init calls must share one SDK setup.
        await Promise.all([RadioCast.init(), RadioCast.init()]);

        assert.equal(RadioCast.available, true);
        assert.ok(win._castOptions, 'CastContext.setOptions should be called');
        assert.equal(win._castOptions.receiverApplicationId, 'CC1PRIMARY');
        assert.equal(ctxListeners.length, 1, 'session listener should be registered exactly once');
        assert.equal(ctxListeners[0].type, 'session_changed');
    });

    it('settles to unavailable (bounded, no hang) when the Cast SDK never loads', async () => {
        installNoCastGlobals();
        const { RadioCast } = await import(`../js/radioCast.js?absent=${Date.now()}`);

        const started = Date.now();
        await RadioCast.init();
        const elapsed = Date.now() - started;

        assert.equal(RadioCast.available, false);
        assert.equal(RadioCast.context, null);
        assert.ok(elapsed < 15000, 'init should settle within the bounded SDK wait');
        assert.equal(RadioCast.initPromise, null, 'init promise should be released after settling');
    });

    it('getStatus reflects the SDK availability state', async () => {
        installCastGlobals();
        const { RadioCast } = await import(`../js/radioCast.js?status=${Date.now()}`);
        assert.deepEqual(RadioCast.getStatus(), { available: false, casting: false, deviceName: null });
        await RadioCast.init();
        assert.equal(RadioCast.getStatus().available, true);
    });
});