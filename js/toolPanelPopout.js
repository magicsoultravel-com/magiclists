/** @module {"owns":"tool panel popout open/focus/pop-in, DOM portal", "related":["toolPanelChrome.js","toolsManager.js","popoutWindows.js","appDocuments.js"]} */
import { CARD_ICONS } from './icons.js';
import { showAppToast } from './toast.js';
import {
    TOOL_PIP_W,
    TOOL_PIP_H,
    TOOL_POPUP_W,
    TOOL_POPUP_H,
    shouldUsePipPopout,
    requestPipWindow,
    openBrowserPopup,
    prepareBlankPopoutDocument,
    unregisterPipWindow,
    windowNameForTool
} from './popoutWindows.js';
import { registerAppDocument, unregisterAppDocument } from './appDocuments.js';
import { renderToolIcon, addPopinButtonToPanel } from './toolPanelChrome.js';

/** @type {Map<string, { placeholder: HTMLElement, panelEl: HTMLElement, win: Window, isPip: boolean, onKey?: (e: KeyboardEvent)=>void, popDoc?: Document }>} */
const poppedById = new Map();

function placeholderIdFor(toolId) {
    return `tools-${String(toolId)}-popout-placeholder`;
}

function toolPopoutSizeFor(meta = {}) {
    // Wide tools look cramped when narrow, so keep a larger popout footprint.
    if (meta?.wide) return { w: 640, h: 520 };

    const w = shouldUsePipPopout() ? TOOL_PIP_W : TOOL_POPUP_W;
    const h = shouldUsePipPopout() ? TOOL_PIP_H : TOOL_POPUP_H;
    return { w, h };
}

function popoutButtonsHtml(toolId, label, iconMarkup) {
    // Placeholder chrome buttons:
    // - focus/focus popout
    // - pop in
    // - remove from desktop (dispatch tools:request_close)
    return `
        <div class="tool-panel__header tool-panel__header--popout-placeholder">
            <span class="tool-panel__icon menu-tool-icon">${iconMarkup}</span>
            <span class="tool-panel__title">${label || toolId}</span>
            <span class="tool-panel__spacer"></span>
            <div class="tool-panel__actions">
                <button type="button" class="card-act card-act--popout tool-panel__popout is-active"
                    data-tool-popout-focus="${String(toolId)}"
                    title="Focus popout window" aria-label="Focus popout window" aria-pressed="true">
                    ${CARD_ICONS.popoutExit}
                </button>
                <button type="button" class="card-act card-act--popin tool-panel__popin"
                    data-tool-popin="${String(toolId)}"
                    title="Pop in (return tool to desktop)" aria-label="Pop in (return tool to desktop)">
                    ${CARD_ICONS.popin}
                </button>
                <button type="button" class="card-act card-act--close tool-panel__close"
                    data-tool-popout-remove="${String(toolId)}"
                    title="Remove from desktop" aria-label="Remove from desktop">
                    ${CARD_ICONS.close}
                </button>
            </div>
        </div>
    `;
}

function createPlaceholder(toolId, panelEl, meta = {}) {
    const placeholder = document.createElement('div');
    placeholder.id = placeholderIdFor(toolId);
    placeholder.className = `tool-panel tool-panel--popout-placeholder tool-panel--${toolId}`;
    placeholder.dataset.toolId = toolId;
    placeholder.classList.add('is-popout-locked');

    // Keep the panel's exact size and position so desktop layout does not jump.
    placeholder.style.left = `${panelEl.offsetLeft}px`;
    placeholder.style.top = `${panelEl.offsetTop}px`;
    placeholder.style.width = `${panelEl.offsetWidth}px`;
    placeholder.style.height = `${panelEl.offsetHeight}px`;

    const label = meta?.label || toolId;
    const iconMarkup = renderToolIcon(meta?.icon, 12);

    // Grey-out / inert overlay badge.
    const overlay = document.createElement('div');
    overlay.className = 'note-popout-lock-overlay tool-panel-popout-lock-overlay';
    overlay.style.pointerEvents = 'none';
    overlay.innerHTML = `<button type="button" class="note-popout-lock-icon" title="Open in popout — click to focus" aria-label="Open in popout — click to focus">${CARD_ICONS.popout}</button>`;

    // Lock overlay icon click → focus window.
    overlay.querySelector('.note-popout-lock-icon')?.addEventListener('click', (e) => {
        e.stopPropagation();
        ToolPanelPopout.openOrFocus(toolId);
    });

    placeholder.appendChild(overlay);

    // Placeholder header; keep panel body area empty so the outline stays consistent.
    const headerHtml = popoutButtonsHtml(toolId, label, iconMarkup);
    placeholder.insertAdjacentHTML('beforeend', headerHtml);

    const body = document.createElement('div');
    body.className = 'tool-panel__body';
    body.setAttribute('aria-hidden', 'true');
    body.style.pointerEvents = 'none';
    placeholder.appendChild(body);

    // Wire header buttons.
    placeholder.querySelector('[data-tool-popout-focus]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        ToolPanelPopout.openOrFocus(toolId);
    });
    placeholder.querySelector('[data-tool-popin]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        ToolPanelPopout.popIn(toolId);
    });
    placeholder.querySelector('[data-tool-popout-remove]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('tools:request_close', { detail: { toolId } }));
    });

    return placeholder;
}

async function openPopoutWindow(toolId, meta) {
    const { w, h } = toolPopoutSizeFor(meta);
    const owner = { type: 'tool', id: toolId };
    const onPageHide = () => ToolPanelPopout.handleWindowClosed(toolId);

    if (shouldUsePipPopout()) {
        const pipWin = await requestPipWindow({ width: w, height: h, owner, onPageHide });
        if (!pipWin) return null;
        return { win: pipWin, isPip: true };
    }

    const name = windowNameForTool(toolId);
    const win = openBrowserPopup('about:blank', name, w, h);
    if (!win) return null;
    win.addEventListener('pagehide', onPageHide);

    prepareBlankPopoutDocument(win, 'tool-panel-popout-body');
    return { win, isPip: false };
}

function prepPopoutDocument(popDoc) {
    if (!popDoc?.body) return;
    popDoc.body.innerHTML = '';
    popDoc.body.className = 'tool-panel-popout-body';
}

export const ToolPanelPopout = {
    isPoppedOut(toolId) {
        return poppedById.has(toolId);
    },

    getEntry(toolId) {
        return poppedById.get(toolId) || null;
    },

    getPopoutWindow(toolId) {
        const entry = poppedById.get(toolId);
        if (!entry?.win || entry.win.closed) return null;
        return entry.win;
    },

    openOrFocus(toolId) {
        const win = this.getPopoutWindow(toolId);
        if (!win) return null;
        try {
            win.focus();
        } catch {
            /* ignore */
        }
        return win;
    },

    async popOut(toolId, panelEl, meta = {}) {
        if (!toolId || !panelEl) return;
        if (this.isPoppedOut(toolId)) return;

        const parent = panelEl.parentElement;
        if (!parent) return;

        panelEl.classList.remove('is-hidden');

        const placeholder = createPlaceholder(toolId, panelEl, meta);
        parent.appendChild(placeholder);

        const opened = await openPopoutWindow(toolId, meta);
        if (!opened?.win) {
            placeholder.remove();
            showAppToast('Could not open tool popout window');
            return;
        }

        const { win, isPip } = opened;
        const popDoc = win.document;
        prepPopoutDocument(popDoc);
        registerAppDocument(popDoc);

        // Move the actual live panel DOM into the popout document.
        popDoc.body.appendChild(panelEl);

        // Popout window chrome:
        // - fill the window
        // - hide collapse
        // - hide popout button and add pop-in
        panelEl.classList.add('is-popout-live');
        panelEl.style.left = '0px';
        panelEl.style.top = '0px';
        panelEl.style.width = '100%';
        panelEl.style.height = '100%';
        panelEl.style.borderRadius = '0';

        const collapseBtn = panelEl.querySelector('.card-act--collapse');
        collapseBtn?.classList.add('is-hidden');

        addPopinButtonToPanel(panelEl, () => this.popIn(toolId));

        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            this.popIn(toolId);
        };
        popDoc.addEventListener('keydown', onKey);

        poppedById.set(toolId, { placeholder, panelEl, win, isPip, onKey, popDoc });

        try {
            win.focus();
        } catch {
            /* ignore */
        }

        window.dispatchEvent(new CustomEvent('floating:chrome_changed'));
    },

    popIn(toolId) {
        const entry = poppedById.get(toolId);
        if (!entry) return;
        const { placeholder, panelEl, win, isPip, onKey, popDoc } = entry;

        // Remove popout key listeners.
        if (onKey && popDoc) popDoc.removeEventListener('keydown', onKey);

        // Move back to desktop.
        const desktopParent = placeholder.parentElement || document.getElementById('tools-desktop');
        if (desktopParent) {
            panelEl.classList.remove('is-popout-live');

            // Restore sizing from placeholder (so drag/resize continues to work).
            panelEl.style.left = placeholder.style.left || '';
            panelEl.style.top = placeholder.style.top || '';
            panelEl.style.width = placeholder.style.width || '';
            panelEl.style.height = placeholder.style.height || '';
            panelEl.style.borderRadius = '';

            // Restore collapse + popout button visibility and remove injected pop-in.
            const collapseBtn = panelEl.querySelector('.card-act--collapse');
            collapseBtn?.classList.remove('is-hidden');

            panelEl.querySelectorAll('.card-act--popin.tool-panel__popin').forEach((btn) => btn.remove());
            const popoutBtn = panelEl.querySelector('.card-act--popout.tool-panel__popout');
            popoutBtn?.classList.remove('is-hidden');

            // Reinsert before placeholder, then remove placeholder.
            if (placeholder.parentElement) placeholder.parentElement.insertBefore(panelEl, placeholder);
            placeholder.remove();
        }

        poppedById.delete(toolId);

        if (popDoc && popDoc !== document) unregisterAppDocument(popDoc);
        if (win && isPip) unregisterPipWindow(win);

        if (win && !win.closed) {
            try {
                win.close();
            } catch {
                /* ignore */
            }
        }

        window.dispatchEvent(new CustomEvent('floating:chrome_changed'));
    },

    handleWindowClosed(toolId) {
        if (!poppedById.has(toolId)) return;
        this.popIn(toolId);
    }
};

