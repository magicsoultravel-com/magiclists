// test/sidebarLinks.test.js
// Sidebar Links folder grouping: folder-first markup, persisted expansion and
// the root-level render cap that must ignore links living inside folders.
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

globalThis.CustomEvent = class FakeCustomEvent {
    constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
    }
};

let list = null;
let more = null;
let root = null;

function makeRoot() {
    list = {
        innerHTML: '',
        querySelectorAll: () => []
    };
    more = { innerHTML: '' };
    const viewToggle = {
        title: '',
        setAttribute(name, value) {
            this[name] = value;
        }
    };
    root = {
        dataset: {},
        querySelector(selector) {
            if (selector === '[data-links-list]') return list;
            if (selector === '[data-links-more]') return more;
            if (selector === '[data-links-view-toggle]') return viewToggle;
            return null;
        },
        addEventListener() {}
    };
    globalThis.document = {
        getElementById: (id) => (id === 'sidebar-links' ? root : null)
    };
}

globalThis.window = {
    addEventListener() {},
    dispatchEvent: () => true
};

const { writeLinksPayload } = await import('../js/linksStore.js');
const { SidebarLinks } = await import('../js/sidebarLinks.js');

function makeLinks(count, prefix, folderId = null) {
    return Array.from({ length: count }, (_, index) => ({
        id: `link_${prefix}_${index}`,
        url: `https://example.com/${prefix}/${index}`,
        title: `${prefix} ${index}`,
        folderId
    }));
}

describe('sidebarLinks · folders', () => {
    beforeEach(() => {
        memory.clear();
        makeRoot();
    });

    it('renders folders before root links and preserves pinned expansion', () => {
        localStorage.setItem('matrix_links_sidebar_expanded', JSON.stringify(['folder_work']));
        writeLinksPayload({
            version: 2,
            updatedAt: 1,
            folders: [{ id: 'folder_work', name: 'Work' }],
            links: [
                { id: 'link_folder', url: 'https://example.com/folder', title: 'Inside', folderId: 'folder_work' },
                { id: 'link_root', url: 'https://example.com/root', title: 'At root' }
            ]
        });

        SidebarLinks.init();
        assert.equal(root.dataset.linksEmpty, 'false');
        assert.match(list.innerHTML, /sidebar-links__folder-group is-expanded/);
        assert.match(list.innerHTML, /sidebar-links__folder-name">Work</);
        assert.match(list.innerHTML, /sidebar-links__folder-icon/);
        assert.match(list.innerHTML, /Inside/);
        assert.match(list.innerHTML, /At root/);
        assert.ok(list.innerHTML.indexOf('sidebar-links__folder-group') < list.innerHTML.indexOf('At root'));
    });

    it('shows a folder-only sidebar instead of the empty message state', () => {
        writeLinksPayload({
            version: 2,
            updatedAt: 1,
            folders: [{ id: 'folder_empty', name: 'Empty folder' }],
            links: []
        });

        SidebarLinks.init();
        assert.equal(root.dataset.linksEmpty, 'false');
        assert.match(list.innerHTML, /Empty folder/);
        assert.match(list.innerHTML, /No links in this folder/);
    });

    it('renders list-mode folder rows without fetching thumbnails', () => {
        localStorage.setItem('matrix_links_sidebar_view', 'list');
        writeLinksPayload({
            version: 2,
            updatedAt: 1,
            folders: [{ id: 'folder_work', name: 'Work' }],
            links: [
                { id: 'link_folder', url: 'https://example.com/folder', title: 'Inside', folderId: 'folder_work' },
                { id: 'link_root', url: 'https://example.com/root', title: 'At root' }
            ]
        });

        SidebarLinks.init();
        assert.match(list.innerHTML, /sidebar-links__folder-group/);
        assert.match(list.innerHTML, /sidebar-links__folder-name">Work</);
        assert.equal(list.innerHTML.includes('sidebar-links__folder-icon'), false);
        assert.equal(list.innerHTML.includes('class="link-thumb'), false);
    });

    it('clamps the tile folder popover inside the sidebar width', () => {
        writeLinksPayload({
            version: 2,
            updatedAt: 1,
            folders: [{ id: 'folder_work', name: 'Work' }],
            links: [{ id: 'link_folder', url: 'https://example.com/folder', title: 'Inside', folderId: 'folder_work' }]
        });

        const vars = {};
        const group = {
            getBoundingClientRect: () => ({ left: 150, width: 44 }),
            style: {
                setProperty(name, value) {
                    vars[name] = value;
                }
            }
        };
        list.clientWidth = 204;
        list.offsetWidth = 204;
        list.getBoundingClientRect = () => ({ left: 0, width: 204 });
        list.querySelectorAll = (selector) => (
            selector === '.sidebar-links__folder-group' ? [group] : []
        );

        SidebarLinks.init();
        assert.equal(vars['--folder-drawer-width'], '196px');
        assert.equal(vars['--folder-drawer-left'], '4px');
    });

    it('caps only root links, never folder contents', () => {
        writeLinksPayload({
            version: 2,
            updatedAt: 1,
            folders: [{ id: 'folder_big', name: 'Big' }],
            links: [
                ...makeLinks(60, 'root'),
                ...makeLinks(5, 'folder', 'folder_big')
            ]
        });

        SidebarLinks.init();
        assert.equal(more.innerHTML, '');
        assert.match(list.innerHTML, /sidebar-links__folder-group/);
        assert.match(list.innerHTML, /folder 4/);

        writeLinksPayload({
            version: 2,
            updatedAt: 2,
            folders: [{ id: 'folder_big', name: 'Big' }],
            links: [
                ...makeLinks(61, 'root2'),
                ...makeLinks(5, 'folder2', 'folder_big')
            ]
        });
        SidebarLinks.refresh();
        assert.match(more.innerHTML, /\+1 more at top level/);
    });
});
