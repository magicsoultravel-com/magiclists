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
    createFolder,
    isLinkPreviewEnabled,
    moveLinkToFolder,
    pruneLinkPreviewIds,
    readLinks,
    readPreviewIds,
    removeFolder,
    removeLink,
    renameFolder,
    reorderFolders,
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
describe('linksStore · folders', () => {
    beforeEach(() => {
        memory.clear();
        events.length = 0;
    });

    it('creates, renames and deletes folders without deleting their links', () => {
        const work = createFolder('  Work   Stuff ', { now: 10 });
        assert.equal(work.ok, true);
        assert.equal(work.folder.name, 'Work Stuff');
        assert.equal(createFolder('work stuff', { now: 11 }).ok, false);

        const home = createFolder('Home', { now: 12 });
        assert.equal(home.ok, true);
        assert.deepEqual(readLinks().folders.map((folder) => folder.name), ['Work Stuff', 'Home']);

        const renamed = renameFolder(work.folder.id, 'Projects', { now: 20 });
        assert.equal(renamed.ok, true);
        assert.equal(renamed.folder.name, 'Projects');
        assert.equal(renameFolder(home.folder.id, 'projects', { now: 21 }).ok, false);
        assert.equal(renameFolder(work.folder.id, 'Projects', { now: 22 }).unchanged, true);

        const link = addLink({ url: 'example.com/InFolder', folderId: work.folder.id }, { now: 30 }).link;
        const root = addLink({ url: 'example.com/Root' }, { now: 31 }).link;
        const removed = removeFolder(work.folder.id, { now: 40 });
        assert.equal(removed.ok, true);
        assert.equal(removed.movedLinks, 1);
        const payload = readLinks();
        assert.deepEqual(payload.folders.map((folder) => folder.id), [home.folder.id]);
        assert.equal(payload.links.find((entry) => entry.id === link.id).folderId, null);
        assert.equal(payload.links.find((entry) => entry.id === link.id).updatedAt, 30);
        assert.equal(payload.links.find((entry) => entry.id === root.id).folderId, null);

        assert.equal(clearAllLinks(), 2);
        assert.deepEqual(readLinks().folders, []);
        assert.deepEqual(readLinks().links, []);
    });

    it('adds, moves and updates links inside one folder while preserving timestamps', () => {
        const alpha = createFolder('Alpha', { now: 1 }).folder;
        const beta = createFolder('Beta', { now: 2 }).folder;
        const root = addLink({ url: 'example.com/Root' }, { now: 10 }).link;
        const a = addLink({ url: 'example.com/A', folderId: alpha.id }, { now: 11 }).link;
        const b = addLink({ url: 'example.com/B', folderId: alpha.id }, { now: 12 }).link;
        const betaLink = addLink({ url: 'example.com/Beta', folderId: beta.id }, { now: 13 }).link;
        assert.equal(addLink({ url: 'example.com/A' }, { now: 14 }).ok, false);
        const betaIndex = readLinks().links.findIndex((link) => link.id === betaLink.id);

        const moved = moveLinkToFolder(root.id, alpha.id, { now: 20 });
        assert.equal(moved.ok, true);
        assert.equal(moved.changed, true);
        assert.equal(moved.link.folderId, alpha.id);
        assert.equal(moved.link.updatedAt, 10);
        assert.equal(moveLinkToFolder(root.id, alpha.id, { now: 21 }).changed, false);
        assert.equal(moveLinkToFolder(root.id, 'folder_missing').ok, false);

        const reordered = reorderLinks([root.id, b.id, a.id], { folderId: alpha.id, now: 30 });
        assert.equal(reordered.ok, true);
        assert.deepEqual(
            readLinks().links.filter((link) => link.folderId === alpha.id).map((link) => link.id),
            [root.id, b.id, a.id]
        );
        assert.equal(readLinks().links.find((link) => link.id === root.id).updatedAt, 10);
        assert.equal(readLinks().links.findIndex((link) => link.id === betaLink.id), betaIndex);
        assert.equal(readLinks().links.find((link) => link.id === betaLink.id).folderId, beta.id);

        const movedBack = updateLink(a.id, { folderId: null }, { now: 40 });
        assert.equal(movedBack.ok, true);
        assert.equal(movedBack.link.folderId, null);
        assert.equal(updateLink(b.id, { folderId: beta.id }, { now: 41 }).link.folderId, beta.id);
        assert.equal(updateLink(b.id, { folderId: 'folder_missing' }).ok, false);
    });

    it('reorders folders with an exact id set', () => {
        const alpha = createFolder('Alpha', { now: 1 }).folder;
        const beta = createFolder('Beta', { now: 2 }).folder;
        assert.deepEqual(reorderFolders([beta.id, alpha.id], { now: 9 }), { ok: true, changed: true });
        assert.deepEqual(readLinks().folders.map((folder) => folder.id), [beta.id, alpha.id]);
        assert.equal(reorderFolders([beta.id], { now: 10 }).ok, false);
        assert.equal(reorderFolders([beta.id, 'folder_missing'], { now: 11 }).ok, false);
        assert.deepEqual(readLinks().folders.map((folder) => folder.id), [beta.id, alpha.id]);
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

    it('preserves folders from backup sections and roots orphaned links', () => {
        const applied = applyLinksBackupSection({
            version: 2,
            updatedAt: 999,
            folders: [
                { id: 'folder_keep', name: 'Keep' },
                { id: 'folder_dup', name: 'keep' }
            ],
            links: [
                { id: 'link_in', url: 'example.com/In', folderId: 'folder_keep', createdAt: 5, updatedAt: 5 },
                { id: 'link_orphan', url: 'example.com/Orphan', folderId: 'folder_missing' }
            ]
        });
        assert.equal(applied, true);
        const payload = readLinks();
        assert.deepEqual(payload.folders.map((folder) => folder.name), ['Keep']);
        assert.equal(payload.links.find((link) => link.id === 'link_in').folderId, 'folder_keep');
        assert.equal(payload.links.find((link) => link.id === 'link_orphan').folderId, null);
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

