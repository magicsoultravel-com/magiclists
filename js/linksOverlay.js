/**
 * @module {"owns":"Links manager floating panel: add/edit/delete, manual drag ordering, favicon refresh, tile/list views, opt-in thum.io screenshots","related":["linksStore.js","linksModel.js","sidebarLinks.js","desktopFloatChrome.js"],"events":["links:changed","links:previews_changed","links:manage_requested"]}
 */
import { escapeAttr, escapeHTML } from './domEscape.js';
import { ACTION_ICONS, CARD_ICONS, FORMAT_ICONS } from './icons.js';
import { bindFloatResize, mountFloatChrome } from './desktopFloatChrome.js';
import { raiseDesktopElement } from './desktopStack.js';
import { showAppToast } from './toast.js';
import {
    LINK_TITLE_MAX,
    LINK_URL_MAX,
    bindLinkThumbFallbacks,
    buildLinkThumbHtml,
    linkDisplayTitle,
    linkHostLabel,
    linkUrlLabel,
    normalizeLinkSort,
    sortLinks
} from './linksModel.js';
import {
    LINKS_CHANGED_EVENT,
    LINKS_PREVIEWS_CHANGED_EVENT,
    LINKS_PREVIEW_IDS_KEY,
    LINKS_STORAGE_KEY,
    addLink,
    clearAllLinks,
    readLinks,
    readPreviewIds,
    removeLink,
    reorderLinks,
    setLinkPreviewEnabled,
    updateLink
} from './linksStore.js';

const PANEL_STORAGE_KEY = 'matrix_links_panel';
const SORT_STORAGE_KEY = 'matrix_links_sort';
const VIEW_STORAGE_KEY = 'matrix_links_view';
const FAVICON_TOKENS_KEY = 'matrix_links_favicon_tokens';
const DEFAULT_W = 760;
const DEFAULT_H = 560;
const MIN_W = 480;
const MIN_H = 360;

const SORT_OPTIONS = [
    { value: 'date-desc', label: 'Newest' },
    { value: 'date-asc', label: 'Oldest' },
    { value: 'name-asc', label: 'Name A–Z' },
    { value: 'name-desc', label: 'Name Z–A' },
    { value: 'manual', label: 'Manual' }
];

const VIEW_ICONS = Object.freeze({
    tiles: ACTION_ICONS.category,
    list: FORMAT_ICONS.toNotes
});

let panel = null;
let selectedId = null;
let currentSort = 'date-desc';
let currentView = 'tiles';
let floatChromeBound = false;
let tileDragBound = false;
let draggedLinkId = null;
let faviconTokenFallback = {};

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function loadSort() {
    try {
        return normalizeLinkSort(localStorage.getItem(SORT_STORAGE_KEY) || 'date-desc');
    } catch {
        return 'date-desc';
    }
}

function saveSort(value) {
    currentSort = normalizeLinkSort(value);
    try {
        localStorage.setItem(SORT_STORAGE_KEY, currentSort);
    } catch {
        /* ignore */
    }
}

function normalizeView(value) {
    return value === 'list' ? 'list' : 'tiles';
}

function loadView() {
    try {
        return normalizeView(localStorage.getItem(VIEW_STORAGE_KEY));
    } catch {
        return 'tiles';
    }
}

function saveView(value) {
    currentView = normalizeView(value);
    try {
        localStorage.setItem(VIEW_STORAGE_KEY, currentView);
    } catch {
        /* ignore */
    }
}

function readFaviconTokens() {
    try {
        const raw = localStorage.getItem(FAVICON_TOKENS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { ...faviconTokenFallback };
        }
        const tokens = {};
        for (const [id, value] of Object.entries(parsed)) {
            if (!id || (typeof value !== 'string' && typeof value !== 'number')) continue;
            const token = String(value).trim();
            if (token) tokens[id] = token;
        }
        faviconTokenFallback = { ...tokens };
        return tokens;
    } catch {
        return { ...faviconTokenFallback };
    }
}

function writeFaviconTokens(tokens) {
    faviconTokenFallback = { ...tokens };
    try {
        localStorage.setItem(FAVICON_TOKENS_KEY, JSON.stringify(faviconTokenFallback));
    } catch {
        /* ignore quota/unavailable storage; the in-memory fallback still works */
    }
}

function setFaviconToken(id) {
    if (!id) return;
    const tokens = readFaviconTokens();
    const previous = Number(tokens[id]) || 0;
    tokens[id] = String(Math.max(Date.now(), previous + 1));
    writeFaviconTokens(tokens);
}

function removeFaviconToken(id) {
    if (!id) return;
    const tokens = readFaviconTokens();
    if (!(id in tokens)) return;
    delete tokens[id];
    writeFaviconTokens(tokens);
}

function clearFaviconTokens() {
    faviconTokenFallback = {};
    try {
        localStorage.removeItem(FAVICON_TOKENS_KEY);
    } catch {
        /* ignore unavailable storage */
    }
}

function loadPanelGeom() {
    try {
        return JSON.parse(localStorage.getItem(PANEL_STORAGE_KEY) || 'null') || {};
    } catch {
        return {};
    }
}

function savePanelGeom(patch = {}) {
    if (!panel) return;
    const next = {
        ...loadPanelGeom(),
        x: panel.offsetLeft,
        y: panel.offsetTop,
        w: panel.offsetWidth,
        h: panel.offsetHeight,
        ...patch
    };
    try {
        localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(next));
    } catch {
        /* ignore quota */
    }
}

function viewportBounds() {
    return {
        left: 8,
        top: 8,
        right: window.innerWidth - 8,
        bottom: window.innerHeight - 8
    };
}

function clampPanelPos(x, y, w, h) {
    const b = viewportBounds();
    return {
        x: clamp(x, b.left, Math.max(b.left, b.right - w)),
        y: clamp(y, b.top, Math.max(b.top, b.bottom - h))
    };
}

function applySavedGeometry() {
    if (!panel) return;
    const saved = loadPanelGeom();
    const w = Number.isFinite(saved.w) ? saved.w : DEFAULT_W;
    const h = Number.isFinite(saved.h) ? saved.h : DEFAULT_H;
    const width = clamp(w, MIN_W, window.innerWidth - 16);
    const height = clamp(h, MIN_H, window.innerHeight - 16);
    const fallbackX = Math.max(16, (window.innerWidth - width) / 2);
    const fallbackY = Math.max(16, (window.innerHeight - height) / 5);
    const pos = clampPanelPos(
        Number.isFinite(saved.x) ? saved.x : fallbackX,
        Number.isFinite(saved.y) ? saved.y : fallbackY,
        width,
        height
    );
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    panel.style.left = `${pos.x}px`;
    panel.style.top = `${pos.y}px`;
}

function bringPanelFront() {
    if (panel) raiseDesktopElement(panel);
}

function pointerDelta(clientX, clientY, startX, startY) {
    return { dx: clientX - startX, dy: clientY - startY };
}

const PANEL_DRAG_BLOCK_SEL = [
    'button',
    'input',
    'textarea',
    'select',
    'a',
    'label',
    '.btn',
    '.links-panel__tile',
    '.links-panel__detail-preview',
    '.ff-resize',
    '.ff-resize-layer'
].join(', ');

function isPanelDragBlocked(target) {
    if (!target?.closest) return true;
    if (target.closest('.links-panel__drag')) return false;
    if (target.closest('.card-act')) return true;
    return !!target.closest(PANEL_DRAG_BLOCK_SEL);
}

function bindPanelDrag() {
    if (!panel) return;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    const onPointerDown = (e) => {
        if (e.button !== 0 || !panel.contains(e.target) || isPanelDragBlocked(e.target)) return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        originLeft = panel.offsetLeft;
        originTop = panel.offsetTop;
        try {
            panel.setPointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
        panel.classList.add('is-dragging');
        bringPanelFront();
    };

    const onPointerMove = (e) => {
        if (!dragging) return;
        const { dx, dy } = pointerDelta(e.clientX, e.clientY, startX, startY);
        const pos = clampPanelPos(originLeft + dx, originTop + dy, panel.offsetWidth, panel.offsetHeight);
        panel.style.left = `${pos.x}px`;
        panel.style.top = `${pos.y}px`;
    };

    const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        panel.classList.remove('is-dragging');
        try {
            panel.releasePointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
        savePanelGeom();
    };

    panel.addEventListener('pointerdown', onPointerDown);
    panel.addEventListener('pointermove', onPointerMove);
    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);
}

function setupFloatingChrome() {
    if (!panel || floatChromeBound) return;
    mountFloatChrome(panel, { resizable: true, mode: 'tool' });
    bindFloatResize(panel, {
        mins: { w: MIN_W, h: MIN_H },
        getBounds: viewportBounds,
        pointerDelta,
        clampPosition: (el, x, y) => clampPanelPos(x, y, el.offsetWidth, el.offsetHeight),
        onEnd: () => savePanelGeom(),
        onBringToFront: bringPanelFront
    });
    bindPanelDrag();
    panel.addEventListener('pointerdown', () => bringPanelFront());
    floatChromeBound = true;
}


function formatSavedDate(ts) {
    const value = Number(ts);
    if (!Number.isFinite(value) || value <= 0) return '—';
    try {
        return new Date(value).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch {
        return '—';
    }
}

function buildTileHtml(link, previewIds, isSelected, faviconTokens = {}) {
    const title = linkDisplayTitle(link);
    const isManual = currentSort === 'manual';
    const dragTitle = isManual ? 'Drag to reorder' : 'Switch sort to Manual to reorder';
    return `<div class="links-panel__tile${isSelected ? ' is-selected' : ''}" data-link-id="${escapeAttr(link.id)}">
        <span class="card-act links-panel__tile-grip${isManual ? '' : ' is-disabled'}" data-link-drag-grip
            draggable="${isManual ? 'true' : 'false'}" role="button" tabindex="-1"
            title="${escapeAttr(dragTitle)}" aria-label="${escapeAttr(dragTitle)}"
            aria-disabled="${isManual ? 'false' : 'true'}">${CARD_ICONS.drag}</span>
        <button type="button" class="links-panel__tile-select" data-link-select
            title="Select ${escapeAttr(title)}" aria-pressed="${isSelected ? 'true' : 'false'}">
            ${buildLinkThumbHtml(link, {
                showScreenshot: previewIds.has(link.id),
                faviconCacheBust: faviconTokens[link.id]
            })}
            <span class="links-panel__tile-text">
                <span class="links-panel__tile-title">${escapeHTML(title)}</span>
                <span class="links-panel__tile-host">${escapeHTML(linkUrlLabel(link))}</span>
            </span>
        </button>
        <span class="links-panel__tile-actions">
            <a class="card-act" href="${escapeAttr(link.url)}" target="_blank" rel="noopener noreferrer"
                data-link-open title="Open in new tab" aria-label="Open ${escapeAttr(title)} in new tab">${CARD_ICONS.externalLink}</a>
            <button type="button" class="card-act" data-link-edit title="Edit link" aria-label="Edit ${escapeAttr(title)}">${CARD_ICONS.edit}</button>
            <button type="button" class="card-act" data-link-refresh-favicon title="Refresh favicon" aria-label="Refresh favicon for ${escapeAttr(title)}">${ACTION_ICONS.resetCustomization}</button>
            <button type="button" class="card-act" data-link-delete title="Delete link" aria-label="Delete ${escapeAttr(title)}">${CARD_ICONS.delete}</button>
        </span>
    </div>`;
}

function syncViewChrome() {
    if (!panel) return;
    const grid = panel.querySelector('[data-links-grid]');
    if (grid) grid.dataset.linksView = currentView;
    const btn = panel.querySelector('[data-links-view-toggle]');
    if (!btn) return;
    const label = currentView === 'list' ? 'Switch to tile view' : 'Switch to list view';
    btn.innerHTML = VIEW_ICONS[currentView] || '';
    btn.dataset.viewMode = currentView;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.classList.toggle('is-list', currentView === 'list');
    btn.classList.toggle('is-tiles', currentView !== 'list');
}

function clearDropMarkers() {
    panel?.querySelectorAll('.links-panel__tile.is-drop-before, .links-panel__tile.is-drop-after').forEach((tile) => {
        tile.classList.remove('is-drop-before', 'is-drop-after');
    });
}

function clearTileDragState() {
    panel?.querySelectorAll('.links-panel__tile.is-dragging, .links-panel__tile.is-drop-before, .links-panel__tile.is-drop-after').forEach((tile) => {
        tile.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after');
    });
    draggedLinkId = null;
}

function isDropBefore(e, tile) {
    const rect = tile.getBoundingClientRect();
    return currentView === 'list'
        ? e.clientY < rect.top + rect.height / 2
        : e.clientX < rect.left + rect.width / 2;
}

function bindTileDrag() {
    if (!panel || tileDragBound) return;
    const grid = panel.querySelector('[data-links-grid]');
    if (!grid) return;
    tileDragBound = true;

    grid.addEventListener('dragstart', (e) => {
        const grip = e.target.closest?.('[data-link-drag-grip]');
        const tile = grip?.closest('.links-panel__tile');
        if (!grip || !tile || currentSort !== 'manual') {
            e.preventDefault();
            draggedLinkId = null;
            return;
        }
        draggedLinkId = tile.dataset.linkId || null;
        if (!draggedLinkId) return;
        tile.classList.add('is-dragging');
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedLinkId);
        }
    });

    grid.addEventListener('dragover', (e) => {
        if (!draggedLinkId || currentSort !== 'manual') return;
        const tile = e.target.closest?.('.links-panel__tile');
        if (!tile || !grid.contains(tile)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        clearDropMarkers();
        if (tile.dataset.linkId === draggedLinkId) return;
        tile.classList.add(isDropBefore(e, tile) ? 'is-drop-before' : 'is-drop-after');
    });

    grid.addEventListener('drop', (e) => {
        if (!draggedLinkId || currentSort !== 'manual') {
            clearTileDragState();
            return;
        }
        const tile = e.target.closest?.('.links-panel__tile');
        if (!tile || !grid.contains(tile)) {
            clearTileDragState();
            return;
        }
        e.preventDefault();
        const draggedId = draggedLinkId;
        const targetId = tile.dataset.linkId;
        const before = isDropBefore(e, tile);
        clearTileDragState();
        if (!draggedId || !targetId || draggedId === targetId) return;

        const ids = readLinks().links.map((link) => link.id);
        const fromIndex = ids.indexOf(draggedId);
        if (fromIndex < 0 || !ids.includes(targetId)) return;
        ids.splice(fromIndex, 1);
        let targetIndex = ids.indexOf(targetId);
        if (targetIndex < 0) return;
        if (!before) targetIndex += 1;
        ids.splice(targetIndex, 0, draggedId);

        const result = reorderLinks(ids);
        if (!result.ok) {
            showAppToast(result.error);
            LinksOverlay.refresh();
        }
    });

    grid.addEventListener('dragend', () => {
        clearTileDragState();
    });
}


function buildDetailHtml(link, previewIds, faviconTokens = {}) {
    if (!link) {
        return '<p class="links-panel__detail-empty">Select a link to edit it.</p>';
    }
    const title = linkDisplayTitle(link);
    const host = linkHostLabel(link);
    const previewOn = previewIds.has(link.id);
    const previewLabel = previewOn ? 'Remove screenshot preview' : 'Load screenshot preview';
    return `<div class="links-panel__detail-head">
        <h3 class="links-panel__detail-title">Link details</h3>
        <a class="btn btn--compact links-panel__detail-open" href="${escapeAttr(link.url)}"
            target="_blank" rel="noopener noreferrer">Open ${CARD_ICONS.externalLink}</a>
    </div>
    <div class="links-panel__detail-preview">
        ${buildLinkThumbHtml(link, {
            showScreenshot: previewOn,
            modifier: 'detail',
            faviconCacheBust: faviconTokens[link.id]
        })}
    </div>
    <form class="links-panel__edit-form" data-link-edit-form data-link-id="${escapeAttr(link.id)}">
        <label class="links-panel__field">
            <span>Title</span>
            <input type="text" data-link-edit-title value="${escapeAttr(link.title)}"
                placeholder="${escapeAttr(title)}" maxlength="${LINK_TITLE_MAX}" autocomplete="off">
        </label>
        <label class="links-panel__field">
            <span>URL</span>
            <input type="text" data-link-edit-url value="${escapeAttr(link.url)}" maxlength="${LINK_URL_MAX}"
                inputmode="url" spellcheck="false" autocomplete="off">
        </label>
        <div class="links-panel__detail-actions">
            <button type="submit" class="btn btn--compact" data-link-save>${CARD_ICONS.save} Save</button>
            <button type="button" class="btn btn--compact" data-link-preview-toggle>${previewLabel}</button>
            <button type="button" class="btn btn--compact" data-link-refresh-favicon
                title="Reload this favicon from the site">${ACTION_ICONS.resetCustomization} Refresh favicon</button>
        </div>
    </form>
    <p class="links-panel__preview-note">
        ${previewOn
        ? 'Screenshot preview enabled on this device. Loaded from image.thum.io.'
        : 'Screenshot previews are off. Enabling one sends this URL to image.thum.io.'}
    </p>
    <dl class="links-panel__meta">
        <div><dt>Host</dt><dd>${escapeHTML(host || '—')}</dd></div>
        <div><dt>Saved</dt><dd>${escapeHTML(formatSavedDate(link.createdAt))}</dd></div>
    </dl>
    <button type="button" class="btn btn--compact links-panel__detail-delete" data-link-detail-delete>
        ${CARD_ICONS.delete} Delete link
    </button>`;
}


export const LinksOverlay = {
    init() {
        panel = document.getElementById('links-panel');
        if (!panel) return;
        currentSort = loadSort();
        currentView = loadView();

        applySavedGeometry();
        this.renderChrome();
        this.bindChrome();
        setupFloatingChrome();
        bindTileDrag();

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !this.isOpen()) return;
            e.preventDefault();
            this.close();
        });

        window.addEventListener(LINKS_CHANGED_EVENT, () => {
            if (this.isOpen()) this.refresh();
        });
        window.addEventListener(LINKS_PREVIEWS_CHANGED_EVENT, () => {
            if (this.isOpen()) this.refresh();
        });
        window.addEventListener('storage', (e) => {
            if (e.key === VIEW_STORAGE_KEY) {
                currentView = loadView();
                if (this.isOpen()) this.refresh();
                return;
            }
            if (e.key === FAVICON_TOKENS_KEY) {
                if (this.isOpen()) this.refresh();
                return;
            }
            if (e.key !== LINKS_STORAGE_KEY && e.key !== LINKS_PREVIEW_IDS_KEY) return;
            if (this.isOpen()) this.refresh();
        });

        window.addEventListener('resize', () => {
            if (!panel || panel.classList.contains('is-hidden')) return;
            const pos = clampPanelPos(
                panel.offsetLeft,
                panel.offsetTop,
                panel.offsetWidth,
                panel.offsetHeight
            );
            panel.style.left = `${pos.x}px`;
            panel.style.top = `${pos.y}px`;
        });
    },

    renderChrome() {
        if (!panel) return;
        const header = panel.querySelector('[data-links-header]');
        if (header) {
            header.innerHTML = `
                <h2 class="links-panel__title" data-links-title>Links</h2>
                <p class="links-panel__summary" data-links-summary></p>
                <div class="links-panel__controls">
                    <label class="links-panel__sort">
                        <span class="links-panel__sort-label">Sort</span>
                        <select class="links-panel__sort-select" data-links-sort aria-label="Sort links">
                            ${SORT_OPTIONS.map((o) => `<option value="${escapeAttr(o.value)}">${escapeHTML(o.label)}</option>`).join('')}
                        </select>
                    </label>
                    <button type="button" class="card-act links-panel__view-toggle" data-links-view-toggle
                        title="Switch to list view" aria-label="Switch to list view"></button>
                </div>`;
        }
        const sortSelect = panel.querySelector('[data-links-sort]');
        if (sortSelect) sortSelect.value = currentSort;
        syncViewChrome();

        const drag = panel.querySelector('[data-links-drag]');
        if (drag) drag.innerHTML = CARD_ICONS.drag;
        const closeBtn = panel.querySelector('[data-links-close]');
        if (closeBtn) closeBtn.innerHTML = CARD_ICONS.close;

        const footer = panel.querySelector('[data-links-footer]');
        if (footer) {
            footer.innerHTML = `
                <form class="links-panel__add-form" data-links-add-form>
                    <input type="text" class="links-panel__add-title" data-links-add-title
                        placeholder="Title (optional)" aria-label="Link title"
                        maxlength="${LINK_TITLE_MAX}" autocomplete="off">
                    <input type="text" class="links-panel__add-url" data-links-add-url
                        placeholder="example.com/page" aria-label="Link URL" required
                        maxlength="${LINK_URL_MAX}" inputmode="url" spellcheck="false" autocomplete="off">
                    <button type="submit" class="btn btn--compact" data-links-add-submit
                        title="Add link" aria-label="Add link">${ACTION_ICONS.plus} Add</button>
                </form>
                <button type="button" class="btn btn--compact btn--icon links-panel__clear" data-links-clear
                    title="Clear all links" aria-label="Clear all links" disabled>${CARD_ICONS.delete}</button>`;
        }
    },


    bindChrome() {
        if (!panel) return;
        panel.querySelector('[data-links-close]')?.addEventListener('click', () => this.close());

        panel.querySelector('[data-links-add-form]')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitAdd();
        });

        panel.querySelector('[data-links-sort]')?.addEventListener('change', (e) => {
            saveSort(e.target?.value);
            this.refresh();
        });

        panel.querySelector('[data-links-view-toggle]')?.addEventListener('click', (e) => {
            e.preventDefault();
            saveView(currentView === 'list' ? 'tiles' : 'list');
            syncViewChrome();
            this.refresh();
        });

        panel.querySelector('[data-links-clear]')?.addEventListener('click', () => {
            this.clearAll();
        });

        panel.addEventListener('submit', (e) => {
            const form = e.target.closest?.('[data-link-edit-form]');
            if (!form) return;
            e.preventDefault();
            this.saveEdit(form);
        });

        panel.addEventListener('click', (e) => {
            const refreshFavicon = e.target.closest?.('[data-link-refresh-favicon]');
            if (refreshFavicon) {
                e.preventDefault();
                const id = refreshFavicon.closest('[data-link-id]')?.dataset.linkId
                    || panel.querySelector('[data-link-edit-form]')?.dataset.linkId;
                if (id) this.refreshFavicon(id);
                return;
            }

            const previewToggle = e.target.closest?.('[data-link-preview-toggle]');
            if (previewToggle) {
                e.preventDefault();
                const id = panel.querySelector('[data-link-edit-form]')?.dataset.linkId;
                if (id) this.togglePreview(id);
                return;
            }

            const detailDelete = e.target.closest?.('[data-link-detail-delete]');
            if (detailDelete) {
                e.preventDefault();
                const id = panel.querySelector('[data-link-edit-form]')?.dataset.linkId;
                if (id) this.deleteLink(id);
                return;
            }

            const selectBtn = e.target.closest?.('[data-link-select]');
            if (selectBtn) {
                const id = selectBtn.closest('[data-link-id]')?.dataset.linkId;
                if (!id) return;
                selectedId = id;
                this.refresh();
                return;
            }

            const editBtn = e.target.closest?.('[data-link-edit]');
            if (editBtn) {
                const id = editBtn.closest('[data-link-id]')?.dataset.linkId;
                if (!id) return;
                selectedId = id;
                this.refresh();
                requestAnimationFrame(() => {
                    panel.querySelector('[data-link-edit-title]')?.focus();
                });
                return;
            }

            const deleteBtn = e.target.closest?.('[data-link-delete]');
            if (deleteBtn) {
                const id = deleteBtn.closest('[data-link-id]')?.dataset.linkId;
                if (id) this.deleteLink(id);
            }
        });
    },

    refresh() {
        if (!panel) return;
        const allLinks = readLinks().links;
        const links = sortLinks(allLinks, currentSort);
        const previewIds = new Set(readPreviewIds());
        const faviconTokens = readFaviconTokens();
        if (currentSort !== 'manual') clearTileDragState();
        if (!selectedId || !links.some((link) => link.id === selectedId)) {
            selectedId = links[0]?.id || null;
        }

        const titleEl = panel.querySelector('[data-links-title]');
        if (titleEl) titleEl.textContent = links.length ? `Links (${links.length})` : 'Links';
        const summaryEl = panel.querySelector('[data-links-summary]');
        if (summaryEl) {
            const previewCount = [...previewIds].filter((id) => links.some((link) => link.id === id)).length;
            summaryEl.textContent = `${links.length} saved · ${previewCount} screenshot preview${previewCount === 1 ? '' : 's'} on this device`;
        }
        const sortSelect = panel.querySelector('[data-links-sort]');
        if (sortSelect && sortSelect.value !== currentSort) sortSelect.value = currentSort;
        syncViewChrome();

        const grid = panel.querySelector('[data-links-grid]');
        if (grid) {
            grid.innerHTML = links.length
                ? links.map((link) => buildTileHtml(link, previewIds, link.id === selectedId, faviconTokens)).join('')
                : '<p class="links-panel__empty">No links yet. Add a URL below to get started.</p>';
        }

        const selected = links.find((link) => link.id === selectedId) || null;
        const detail = panel.querySelector('[data-links-detail]');
        if (detail) detail.innerHTML = buildDetailHtml(selected, previewIds, faviconTokens);

        bindLinkThumbFallbacks(panel);

        const clearBtn = panel.querySelector('[data-links-clear]');
        if (clearBtn) clearBtn.disabled = links.length === 0;
    },

    submitAdd() {
        const urlInput = panel?.querySelector('[data-links-add-url]');
        const titleInput = panel?.querySelector('[data-links-add-title]');
        const result = addLink({
            url: urlInput?.value || '',
            title: titleInput?.value || ''
        });
        if (!result.ok) {
            alert(result.error);
            urlInput?.focus();
            urlInput?.select();
            return;
        }
        selectedId = result.link.id;
        if (urlInput) urlInput.value = '';
        if (titleInput) titleInput.value = '';
        this.refresh();
        showAppToast('Link saved');
        requestAnimationFrame(() => urlInput?.focus());
    },

    saveEdit(form) {
        if (!form) return;
        const id = form.dataset.linkId;
        const urlInput = form.querySelector('[data-link-edit-url]');
        const titleInput = form.querySelector('[data-link-edit-title]');
        const result = updateLink(id, {
            url: urlInput?.value || '',
            title: titleInput?.value || ''
        });
        if (!result.ok) {
            alert(result.error);
            urlInput?.focus();
            urlInput?.select();
            return;
        }
        showAppToast(result.unchanged ? 'No changes' : 'Link updated');
        this.refresh();
    },

    deleteLink(id) {
        const link = readLinks().links.find((entry) => entry.id === id);
        if (!link) return;
        if (!confirm(`Delete "${linkDisplayTitle(link)}"?`)) return;
        if (!removeLink(id)) {
            showAppToast('Could not delete link');
            return;
        }
        if (selectedId === id) selectedId = null;
        removeFaviconToken(id);
        this.refresh();
        showAppToast('Link deleted');
    },

    clearAll() {
        const links = readLinks().links;
        if (!links.length) return;
        if (!confirm(`Delete all ${links.length} saved link${links.length === 1 ? '' : 's'}?`)) return;
        const removed = clearAllLinks();
        if (!removed) {
            showAppToast('Could not clear links');
            return;
        }
        selectedId = null;
        clearFaviconTokens();
        this.refresh();
        showAppToast(`${removed} link${removed === 1 ? '' : 's'} cleared`);
    },

    refreshFavicon(id) {
        const link = readLinks().links.find((entry) => entry.id === id);
        if (!link) return;
        setFaviconToken(id);
        this.refresh();
        showAppToast('Favicon refreshed');
    },

    togglePreview(id) {
        const link = readLinks().links.find((entry) => entry.id === id);
        if (!link) return;
        const enabled = readPreviewIds().includes(id);
        if (!enabled) {
            const message = `Load a screenshot preview from image.thum.io?\n\nThis sends this link URL to a third-party screenshot service from this device.\n\n${link.url}`;
            if (!confirm(message)) return;
        }
        if (!setLinkPreviewEnabled(id, !enabled)) {
            showAppToast('Could not update preview preference');
            return;
        }
        showAppToast(enabled ? 'Screenshot preview removed' : 'Screenshot preview enabled');
    },

    isOpen() {
        return !!(panel && !panel.classList.contains('is-hidden'));
    },

    /**
     * @param {{ focusAdd?: boolean, selectLinkId?: string }} [opts]
     */
    open(opts = {}) {
        if (!panel) return;
        applySavedGeometry();
        if (opts.selectLinkId) selectedId = opts.selectLinkId;
        panel.classList.remove('is-hidden');
        panel.classList.add('is-open');
        bringPanelFront();
        this.refresh();
        if (opts.focusAdd) {
            requestAnimationFrame(() => {
                panel.querySelector('[data-links-add-url]')?.focus();
            });
        }
    },

    close() {
        if (!panel) return;
        savePanelGeom();
        panel.classList.remove('is-open');
        panel.classList.add('is-hidden');
        selectedId = null;
    }
};

