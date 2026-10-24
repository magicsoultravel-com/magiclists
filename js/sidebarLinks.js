/**
 * @module {"owns":"Links sidebar folder groups, tile/list rendering, hover quick actions and manage/view shortcuts","related":["linksStore.js","linksModel.js","linksOverlay.js","sidebarModules.js","sidebarPrefs.js"],"events":["links:changed","links:manage_requested"]}
 */
import { escapeAttr, escapeHTML } from './domEscape.js';
import { CARD_ICONS } from './icons.js';
import { copyPlainTextToClipboard } from './clipboard.js';
import { showAppToast } from './toast.js';
import {
    LINKS_SIDEBAR_LIMIT,
    bindLinkThumbFallbacks,
    buildLinkThumbHtml,
    linkDisplayTitle,
    linkHostLabel,
    linksInFolder
} from './linksModel.js';
import { LINKS_CHANGED_EVENT, readLinks } from './linksStore.js';
import { isSidebarModuleEnabled } from './sidebarModulePrefs.js';
import {
    LINKS_SIDEBAR_EXPANDED_KEY,
    LINKS_VIEW_LIST,
    LINKS_VIEW_TILES,
    readLinksSidebarExpanded,
    readLinksSidebarView,
    writeLinksSidebarExpanded,
    writeLinksSidebarView
} from './sidebarPrefs.js';

let root = null;
let list = null;
let more = null;
let viewToggle = null;
let bound = false;
let expandedFolderIds = new Set();

function buildTileHtml(link, view) {
    const title = linkDisplayTitle(link);
    const host = linkHostLabel(link);
    const label = host && host !== title ? `${title} — ${host}` : title;
    const hostLine = host && host !== title
        ? `<span class="sidebar-links__tile-host">${escapeHTML(host)}</span>`
        : '';
    const thumb = view === LINKS_VIEW_LIST ? '' : buildLinkThumbHtml(link);
    return `<div class="sidebar-links__tile" data-link-id="${escapeAttr(link.id)}">
        <a class="sidebar-links__tile-main" href="${escapeAttr(link.url)}"
            target="_blank" rel="noopener noreferrer" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">
            ${thumb}
            <span class="sidebar-links__tile-text">
                <span class="sidebar-links__tile-title">${escapeHTML(title)}</span>
                ${hostLine}
            </span>
        </a>
        <span class="sidebar-links__tile-actions">
            <a class="card-act" href="${escapeAttr(link.url)}" target="_blank" rel="noopener noreferrer"
                data-link-open title="Open in new tab" aria-label="Open ${escapeAttr(title)} in new tab">${CARD_ICONS.externalLink}</a>
            <button type="button" class="card-act" data-link-copy
                title="Copy link" aria-label="Copy ${escapeAttr(title)} link">${CARD_ICONS.copy}</button>
        </span>
    </div>`;
}

function buildFolderGroupHtml(folder, folderLinks, view) {
    const expanded = expandedFolderIds.has(folder.id);
    const count = folderLinks.length;
    const meta = `${count} link${count === 1 ? '' : 's'}`;
    const linksHtml = folderLinks.map((link) => buildTileHtml(link, view)).join('');
    return `<div class="sidebar-links__folder-group${expanded ? ' is-expanded' : ''}"
        data-folder-id="${escapeAttr(folder.id)}">
        <button type="button" class="sidebar-links__folder-tile" data-folder-toggle
            aria-expanded="${expanded ? 'true' : 'false'}"
            title="${escapeAttr(`${folder.name} — ${meta}`)}"
            aria-label="${escapeAttr(`${folder.name}, ${meta}`)}">
            <span class="sidebar-links__folder-chevron" aria-hidden="true">${CARD_ICONS.chevronDown}</span>
            <span class="sidebar-links__folder-icon" aria-hidden="true">${CARD_ICONS.folder}</span>
            <span class="sidebar-links__folder-name">${escapeHTML(folder.name)}</span>
            <span class="sidebar-links__folder-count">${count}</span>
        </button>
        <div class="sidebar-links__folder-drawer">
            ${linksHtml || '<p class="sidebar-links__folder-empty">No links in this folder.</p>'}
        </div>
    </div>`;
}

function applyViewChrome() {
    const view = readLinksSidebarView();
    if (root) root.dataset.linksView = view;
    if (viewToggle) {
        const label = view === LINKS_VIEW_LIST ? 'Switch to tile view' : 'Switch to list view';
        viewToggle.title = label;
        viewToggle.setAttribute('aria-label', label);
    }
}

function toggleView() {
    const next = readLinksSidebarView() === LINKS_VIEW_LIST ? LINKS_VIEW_TILES : LINKS_VIEW_LIST;
    writeLinksSidebarView(next);
    SidebarLinks.refresh();
}

function toggleFolder(id) {
    if (!id) return;
    if (expandedFolderIds.has(id)) expandedFolderIds.delete(id);
    else expandedFolderIds.add(id);
    writeLinksSidebarExpanded(expandedFolderIds);
    SidebarLinks.refresh();
}

function openManager(focusAdd = false) {
    window.dispatchEvent(new CustomEvent('links:manage_requested', { detail: { focusAdd } }));
}

function bindEvents() {
    if (!root || bound) return;
    bound = true;

    root.addEventListener('click', (e) => {
        const folderToggle = e.target.closest?.('[data-folder-toggle]');
        if (folderToggle) {
            e.preventDefault();
            const id = folderToggle.closest('[data-folder-id]')?.dataset.folderId;
            toggleFolder(id);
            return;
        }

        const copyBtn = e.target.closest?.('[data-link-copy]');
        if (copyBtn) {
            e.preventDefault();
            const id = copyBtn.closest('[data-link-id]')?.dataset.linkId;
            const link = id ? readLinks().links.find((entry) => entry.id === id) : null;
            if (!link) {
                showAppToast('Link not found');
                return;
            }
            void copyPlainTextToClipboard(link.url).then((ok) => {
                showAppToast(ok ? 'Link copied' : 'Could not copy link');
            });
            return;
        }

        const viewBtn = e.target.closest?.('[data-links-view-toggle]');
        if (viewBtn) {
            e.preventDefault();
            toggleView();
            return;
        }
        const manage = e.target.closest?.('[data-links-manage]');
        if (manage) {
            e.preventDefault();
            openManager(false);
            return;
        }
        const moreBtn = e.target.closest?.('[data-links-more]');
        if (moreBtn) {
            e.preventDefault();
            openManager(false);
        }
    });

    window.addEventListener(LINKS_CHANGED_EVENT, () => {
        SidebarLinks.refresh();
    });

    window.addEventListener('storage', (e) => {
        if (e.key !== LINKS_SIDEBAR_EXPANDED_KEY) return;
        expandedFolderIds = new Set(readLinksSidebarExpanded());
        SidebarLinks.refresh();
    });
}

export const SidebarLinks = {
    init() {
        root = document.getElementById('sidebar-links');
        if (!root) return;
        list = root.querySelector('[data-links-list]');
        more = root.querySelector('[data-links-more]');
        viewToggle = root.querySelector('[data-links-view-toggle]');
        expandedFolderIds = new Set(readLinksSidebarExpanded());
        bindEvents();
        this.refresh();
    },

    refresh() {
        if (!root || !list) return;
        /* Pull-based module: no tile rebuilds while hidden; the lifecycle start
           hook refreshes once when it is re-enabled. */
        if (!isSidebarModuleEnabled('links')) return;
        applyViewChrome();
        const payload = readLinks();
        const links = payload.links;
        const folders = payload.folders;
        const folderIds = new Set(folders.map((folder) => folder.id));
        let pruned = false;
        for (const id of [...expandedFolderIds]) {
            if (folderIds.has(id)) continue;
            expandedFolderIds.delete(id);
            pruned = true;
        }
        if (pruned) writeLinksSidebarExpanded(expandedFolderIds);

        const rootLinks = linksInFolder(links, null);
        const visibleRootLinks = rootLinks.slice(0, LINKS_SIDEBAR_LIMIT);

        /* Attribute state, not classes: view and empty layout both branch from
           data-* so the list-view flex rule cannot override an is-hidden class. */
        root.dataset.linksEmpty = folders.length || rootLinks.length ? 'false' : 'true';
        const view = readLinksSidebarView();
        const folderHtml = folders.map((folder) => (
            buildFolderGroupHtml(folder, linksInFolder(links, folder.id), view)
        )).join('');
        const rootHtml = visibleRootLinks.map((link) => buildTileHtml(link, view)).join('');
        list.innerHTML = folderHtml + rootHtml;
        bindLinkThumbFallbacks(list);

        if (more) {
            const hiddenCount = Math.max(0, rootLinks.length - visibleRootLinks.length);
            more.innerHTML = hiddenCount
                ? `<button type="button" class="sidebar-links__more" data-links-more>+${hiddenCount} more at top level</button>`
                : '';
        }
    },

    /** Sidebar list is favicon-only; screenshot previews render in the manager. */
    openManager
};
