// test/linksStore.test.js
// Storage/CRUD guards for the Links module: normalization on write, duplicate
// rejection, manual ordering, backup replacement, and device-local preview pruning.
//
// Run with: npm test  (node --test)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

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

const events = [];
class FakeCustomEvent {
    constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
    }
}
globalThis.CustomEvent = FakeCustomEvent;
globalThis.window = {
    dispatchEvent: (event) => {
        events.push(event);
        return true;
    }
};

const {
    LINKS_PREVIEW_IDS_KEY,
    LINKS_STORAGE_KEY,
    addLink,
    applyLinksBackupSection,
    clearAllLinks,
    clearLinkPreviewIds,
    isLinkPreviewEnabled,
    pruneLinkPreviewIds,
    readLinks,
    readPreviewIds,
    removeLink,
    reorderLinks,
    setLinkPreviewEnabled,
    updateLink,
    writeLinksPayload,
    writePreviewIds
} = await import('../js/linksStore.js');

function storedPayload() {
    return JSON.parse(localStorage.getItem(LINKS_STORAGE_KEY) || '{}');
}

describe('linksStore · add/update/delete', () => {
    beforeEach(() => {
        memory.clear();
        events.length = 0;
    });

    it('adds normalized links newest-first and emits a change event', () => {
        const first = addLink({ url: 'Example.com/A', title: '  First  ' }, { now: 100 });
        const second = addLink({ url: 'example.com/B' }, { now: 200 });
        assert.equal(first.ok, true);
        assert.equal(second.ok, true);
        assert.equal(first.link.url, 'https://example.com/A');
        assert.equal(first.link.title, 'First');

        const payload = readLinks();
        assert.deepEqual(payload.links.map((link) => link.url), [
            'https://example.com/B',
            'https://example.com/A'
        ]);
        assert.equal(storedPayload().updatedAt, 200);
        assert.equal(events.at(-1).type, 'links:changed');
    });

    it('rejects duplicates by dedup key even across protocol/fragment', () => {
        addLink({ url: 'https://example.com/A' }, { now: 1 });
        const duplicate = addLink({ url: 'http://example.com/A#section' }, { now: 2 });
        assert.equal(duplicate.ok, false);
        assert.equal(duplicate.error, 'That link is already saved.');
        assert.equal(readLinks().links.length, 1);

        const trailingSlash = addLink({ url: 'http://example.com/A/' }, { now: 3 });
        assert.equal(trailingSlash.ok, true);
        assert.equal(readLinks().links.length, 2);
    });

    it('rejects invalid URLs without writing', () => {
        const result = addLink({ url: 'javascript://alert(1)' });
        assert.equal(result.ok, false);
        assert.equal(readLinks().links.length, 0);
        assert.equal(events.length, 0);
    });

    it('updates title/url and rejects a duplicate target', () => {
        const a = addLink({ url: 'example.com/A', title: 'A' }, { now: 10 });
        const b = addLink({ url: 'example.com/B', title: 'B' }, { now: 11 });

        const renamed = updateLink(a.link.id, { title: 'Alpha' }, { now: 20 });
        assert.equal(renamed.ok, true);
        assert.equal(renamed.link.title, 'Alpha');
        assert.equal(renamed.link.url, 'https://example.com/A');
        assert.equal(renamed.link.updatedAt, 20);

        const duplicate = updateLink(a.link.id, { url: b.link.url }, { now: 21 });
        assert.equal(duplicate.ok, false);
        assert.equal(duplicate.error, 'That link is already saved.');

        const unchanged = updateLink(a.link.id, { title: 'Alpha' }, { now: 22 });
        assert.equal(unchanged.ok, true);
        assert.equal(unchanged.unchanged, true);

        const missing = updateLink('link_missing', { title: 'X' });
        assert.equal(missing.ok, false);
    });

    it('deletes one link or clears all, pruning preview ids', () => {
        const a = addLink({ url: 'example.com/A' }, { now: 1 });
        const b = addLink({ url: 'example.com/B' }, { now: 2 });
        writePreviewIds([a.link.id, b.link.id]);

        assert.equal(removeLink(a.link.id), true);
        assert.deepEqual(readPreviewIds(), [b.link.id]);
        assert.deepEqual(readLinks().links.map((link) => link.id), [b.link.id]);

        clearAllLinks();
        assert.equal(readLinks().links.length, 0);
        assert.deepEqual(readPreviewIds(), []);
    });
});

describe('linksStore · manual ordering', () => {
    beforeEach(() => {
        memory.clear();
        events.length = 0;
    });

    it('reorders the full collection with an exact id set', () => {
        const a = addLink({ url: 'example.com/A' }, { now: 10 }).link;
        const b = addLink({ url: 'example.com/B' }, { now: 11 }).link;
        const c = addLink({ url: 'example.com/C' }, { now: 12 }).link;
        const before = new Map(readLinks().links.map((link) => [link.id, link]));

        const result = reorderLinks([a.id, b.id, c.id], { now: 99 });
        assert.deepEqual(result, { ok: true, changed: true });
        const payload = readLinks();
        assert.deepEqual(payload.links.map((link) => link.id), [a.id, b.id, c.id]);
        assert.equal(payload.updatedAt, 99);
        assert.equal(events.at(-1).type, 'links:changed');
        assert.deepEqual(events.at(-1).detail.links.map((link) => link.id), [a.id, b.id, c.id]);

        for (const link of payload.links) {
            assert.equal(link.createdAt, before.get(link.id).createdAt);
            assert.equal(link.updatedAt, before.get(link.id).updatedAt);
        }
    });

    it('does not write or emit when the order is unchanged', () => {
        const a = addLink({ url: 'example.com/A' }, { now: 10 }).link;
        const b = addLink({ url: 'example.com/B' }, { now: 11 }).link;
        reorderLinks([a.id, b.id], { now: 50 });
        const eventCount = events.length;

        assert.deepEqual(reorderLinks([a.id, b.id], { now: 60 }), { ok: true, changed: false });
        assert.equal(events.length, eventCount);
        assert.equal(readLinks().updatedAt, 50);
    });

    it('rejects partial, duplicate or unknown ids without writing', () => {
        const a = addLink({ url: 'example.com/A' }, { now: 10 }).link;
        const b = addLink({ url: 'example.com/B' }, { now: 11 }).link;
        const c = addLink({ url: 'example.com/C' }, { now: 12 }).link;
        const before = localStorage.getItem(LINKS_STORAGE_KEY);
        const eventCount = events.length;

        assert.equal(reorderLinks([a.id, b.id], { now: 90 }).ok, false);
        assert.equal(reorderLinks([a.id, b.id, b.id], { now: 91 }).ok, false);
        assert.equal(reorderLinks([a.id, b.id, 'link_missing'], { now: 92 }).ok, false);
        assert.equal(reorderLinks('nope', { now: 93 }).ok, false);
        assert.equal(localStorage.getItem(LINKS_STORAGE_KEY), before);
        assert.equal(events.length, eventCount);
        assert.deepEqual(readLinks().links.map((link) => link.id), [c.id, b.id, a.id]);
    });
});

describe('linksStore · backup replacement', () => {
    beforeEach(() => {
        memory.clear();
        events.length = 0;
    });

    it('replaces the collection from a backup section and preserves updatedAt', () => {
        addLink({ url: 'example.com/Old' }, { now: 1 });
        const applied = applyLinksBackupSection({
            version: 1,
            updatedAt: 999,
            links: [
                { id: 'link_in', url: 'example.com/In', title: 'In', createdAt: 5, updatedAt: 5 }
            ]
        });
        assert.equal(applied, true);
        const payload = readLinks();
        assert.equal(payload.updatedAt, 999);
        assert.deepEqual(payload.links.map((link) => link.url), ['https://example.com/In']);
    });

    it('ignores malformed sections so old packages leave links alone', () => {
        addLink({ url: 'example.com/Keep' }, { now: 1 });
        assert.equal(applyLinksBackupSection(undefined), false);
        assert.equal(applyLinksBackupSection({}), false);
        assert.equal(applyLinksBackupSection({ links: 'nope' }), false);
        assert.deepEqual(readLinks().links.map((link) => link.url), ['https://example.com/Keep']);
    });

    it('accepts an empty links array and clears the list plus previews', () => {
        const a = addLink({ url: 'example.com/A' }, { now: 1 });
        writePreviewIds([a.link.id]);
        assert.equal(applyLinksBackupSection({ version: 1, updatedAt: 2, links: [] }), true);
        assert.equal(readLinks().links.length, 0);
        assert.deepEqual(readPreviewIds(), []);
    });

    it('writeLinksPayload normalizes and can touch updatedAt', () => {
        writeLinksPayload([{ url: 'example.com/A' }], { now: 77 });
        assert.equal(readLinks().updatedAt, 77);
        writeLinksPayload({ updatedAt: 5, links: [{ url: 'example.com/B' }] }, { touch: false });
        assert.equal(readLinks().updatedAt, 5);
    });
});

describe('linksStore · device-local preview opt-ins', () => {
    beforeEach(() => {
        memory.clear();
        events.length = 0;
    });

    it('enables, disables and sanitizes preview ids', () => {
        assert.equal(setLinkPreviewEnabled('link_a', true), true);
        assert.equal(isLinkPreviewEnabled('link_a'), true);
        assert.equal(setLinkPreviewEnabled('link_a', false), true);
        assert.equal(isLinkPreviewEnabled('link_a'), false);

        writePreviewIds(['link_a', 'link_a', '', null, 'link_b']);
        assert.deepEqual(readPreviewIds(), ['link_a', 'link_b']);
        assert.equal(events.at(-1).type, 'links:previews_changed');
    });

    it('prunes ids that no longer exist and clears the key', () => {
        writePreviewIds(['link_a', 'link_b']);
        assert.equal(pruneLinkPreviewIds(['link_b']), true);
        assert.deepEqual(readPreviewIds(), ['link_b']);

        clearLinkPreviewIds();
        assert.deepEqual(readPreviewIds(), []);
        assert.equal(localStorage.getItem(LINKS_PREVIEW_IDS_KEY), null);
    });
});

