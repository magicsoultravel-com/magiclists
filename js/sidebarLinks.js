/**
 * @module {"owns":"Links sidebar module tile grid, count and manage shortcut","related":["linksStore.js","linksModel.js","linksOverlay.js","sidebarModules.js"],"events":["links:changed","links:manage_requested"]}
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

let root = null;
let list = null;
let empty = null;
let countEl = null;
let more = null;
let bound = false;

function buildTileHtml(link) {
    const title = linkDisplayTitle(link);
    const host = linkHostLabel(link);
    const label = host && host !== title ? `${title} — ${host}` : title;
    return `<a class="sidebar-links__tile" href="${escapeAttr(link.url)}" data-link-id="${escapeAttr(link.id)}"
        target="_blank" rel="noopener noreferrer" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">
        ${buildLinkThumbHtml(link)}
        <span class="sidebar-links__tile-title">${escapeHTML(title)}</span>
    </a>`;
}

function openManager(focusAdd = false) {
    window.dispatchEvent(new CustomEvent('links:manage_requested', { detail: { focusAdd } }));
}

function bindEvents() {
    if (!root || bound) return;
    bound = true;

    root.addEventListener('click', (e) => {
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
        empty = root.querySelector('[data-links-empty]');
        countEl = root.querySelector('[data-links-count]');
        more = root.querySelector('[data-links-more]');
        bindEvents();
        this.refresh();
    },

    refresh() {
        if (!root || !list) return;
        const links = readLinks().links;
        const visible = links.slice(0, LINKS_SIDEBAR_LIMIT);

        if (countEl) {
            countEl.textContent = links.length ? String(links.length) : '';
            countEl.classList.toggle('is-empty', links.length === 0);
        }
        if (empty) empty.classList.toggle('is-hidden', links.length > 0);
        list.classList.toggle('is-hidden', links.length === 0);
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
