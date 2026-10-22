// test/sidebarPrefs.test.js
// Sidebar presentation prefs: Links tile/list view normalization + persistence.
//
// Run with: npm test  (node --test)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    LINKS_SIDEBAR_VIEW_KEY,
    LINKS_VIEW_LIST,
    LINKS_VIEW_TILES,
    normalizeLinksSidebarView,
    readLinksSidebarView,
    readSidebarPrefs,
    writeLinksSidebarView
} from '../js/sidebarPrefs.js';

const memory = new Map();
globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => void memory.set(key, String(value)),
    removeItem: (key) => void memory.delete(key),
    clear: () => memory.clear(),
    key: (index) => [...memory.keys()][index] ?? null,
    get length() {
        return memory.size;
    }
};

describe('sidebarPrefs · Links view', () => {
    beforeEach(() => {
        memory.clear();
    });

    it('defaults to tiles when no preference is stored', () => {
        assert.equal(readLinksSidebarView(), LINKS_VIEW_TILES);
    });

    it('normalizes known and unknown view values', () => {
        assert.equal(normalizeLinksSidebarView(LINKS_VIEW_TILES), LINKS_VIEW_TILES);
        assert.equal(normalizeLinksSidebarView(LINKS_VIEW_LIST), LINKS_VIEW_LIST);
        assert.equal(normalizeLinksSidebarView('carousel'), LINKS_VIEW_TILES);
        assert.equal(normalizeLinksSidebarView(null), LINKS_VIEW_TILES);
    });

    it('persists and reads list view', () => {
        writeLinksSidebarView(LINKS_VIEW_LIST);
        assert.equal(localStorage.getItem(LINKS_SIDEBAR_VIEW_KEY), LINKS_VIEW_LIST);
        assert.equal(readLinksSidebarView(), LINKS_VIEW_LIST);
        assert.equal(readSidebarPrefs().linksView, LINKS_VIEW_LIST);
    });

    it('normalizes a malformed stored value back to tiles', () => {
        localStorage.setItem(LINKS_SIDEBAR_VIEW_KEY, 'grid');
        assert.equal(readLinksSidebarView(), LINKS_VIEW_TILES);

        writeLinksSidebarView('carousel');
        assert.equal(localStorage.getItem(LINKS_SIDEBAR_VIEW_KEY), LINKS_VIEW_TILES);
    });

    it('falls back to tiles when storage access throws', () => {
        const original = localStorage.getItem;
        localStorage.getItem = () => {
            throw new Error('storage blocked');
        };
        try {
            assert.equal(readLinksSidebarView(), LINKS_VIEW_TILES);
        } finally {
            localStorage.getItem = original;
        }
    });
});
