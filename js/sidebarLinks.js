/**
 * @module {"owns":"Links sidebar module tile/list rendering, count and manage/view shortcuts","related":["linksStore.js","linksModel.js","linksOverlay.js","sidebarModules.js","sidebarPrefs.js"],"events":["links:changed","links:manage_requested"]}
 */
import { escapeAttr, escapeHTML } from './domEscape.js';
import {
    LINKS_SIDEBAR_LIMIT,
    bindLinkThumbFallbacks,
    buildLinkThumbHtml,
    linkDisplayTitle,
    linkHostLabel
} from './linksModel.js';
import { LINKS_CHANGED_EVENT, readLinks } from './linksStore.js';
import { isSidebarModuleEnabled } from './sidebarModulePrefs.js';
import {
    LINKS_VIEW_LIST,
    LINKS_VIEW_TILES,
    readLinksSidebarView,
    writeLinksSidebarView
} from './sidebarPrefs.js';

let root = null;
let list = null;
let countEl = null;
let more = null;
let viewToggle = null;
let bound = false;

function buildTileHtml(link) {
    const title = linkDisplayTitle(link);
    const host = linkHostLabel(link);
    const label = host && host !== title ? `${title} — ${host}` : title;
    const hostLine = host && host !== title
        ? `<span class="sidebar-links__tile-host">${escapeHTML(host)}</span>`
        : '';
    return `<a class="sidebar-links__tile" href="${escapeAttr(link.url)}" data-link-id="${escapeAttr(link.id)}"
        target="_blank" rel="noopener noreferrer" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">
        ${buildLinkThumbHtml(link)}
        <span class="sidebar-links__tile-text">
            <span class="sidebar-links__tile-title">${escapeHTML(title)}</span>
            ${hostLine}
        </span>
    </a>`;
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

function openManager(focusAdd = false) {
    window.dispatchEvent(new CustomEvent('links:manage_requested', { detail: { focusAdd } }));
}

function bindEvents() {
    if (!root || bound) return;
    bound = true;

    root.addEventListener('click', (e) => {
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
}

export const SidebarLinks = {
    init() {
        root = document.getElementById('sidebar-links');
        if (!root) return;
        list = root.querySelector('[data-links-list]');
        countEl = root.querySelector('[data-links-count]');
        more = root.querySelector('[data-links-more]');
        viewToggle = root.querySelector('[data-links-view-toggle]');
        bindEvents();
        this.refresh();
    },

    refresh() {
        if (!root || !list) return;
        /* Pull-based module: no tile rebuilds while hidden; the lifecycle start
           hook refreshes once when it is re-enabled. */
        if (!isSidebarModuleEnabled('links')) return;
        applyViewChrome();
        const links = readLinks().links;
        const visible = links.slice(0, LINKS_SIDEBAR_LIMIT);

        if (countEl) {
            countEl.textContent = links.length ? String(links.length) : '';
            countEl.classList.toggle('is-empty', links.length === 0);
        }
        /* Attribute state, not classes: view and empty layout both branch from
           data-* so the list-view flex rule cannot override an is-hidden class. */
        root.dataset.linksEmpty = links.length ? 'false' : 'true';
        list.innerHTML = visible.map(buildTileHtml).join('');
        bindLinkThumbFallbacks(list);

        if (more) {
            const hiddenCount = Math.max(0, links.length - visible.length);
            more.innerHTML = hiddenCount
                ? `<button type="button" class="sidebar-links__more" data-links-more>+${hiddenCount} more in Links</button>`
                : '';
        }
    },

    /** Sidebar list is favicon-only; screenshot previews render in the manager. */
    openManager
};
