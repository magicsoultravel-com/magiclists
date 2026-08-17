// test/appDocuments.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('appDocuments multi-document lookup', () => {
    /** @type {import('../js/appDocuments.js')} */
    let appDocuments;

    beforeEach(async () => {
        globalThis.document = {
            getElementById(id) {
                return id === 'main-only' ? { id: 'main-only', doc: 'main' } : null;
            }
        };
        appDocuments = await import('../js/appDocuments.js?doc=1');
    });

    afterEach(() => {
        delete globalThis.document;
    });

    it('finds elements in the main document first', () => {
        const el = appDocuments.getAppElementById('main-only');
        assert.equal(el?.doc, 'main');
    });

    it('falls back to registered popout documents', () => {
        const popoutDoc = {
            getElementById(id) {
                return id === 'sidebar-tools' ? { id: 'sidebar-tools', doc: 'popout' } : null;
            }
        };
        appDocuments.registerAppDocument(popoutDoc);
        const el = appDocuments.getAppElementById('sidebar-tools');
        assert.equal(el?.doc, 'popout');
        appDocuments.unregisterAppDocument(popoutDoc);
        assert.equal(appDocuments.getAppElementById('sidebar-tools'), null);
    });
});
