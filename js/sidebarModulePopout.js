/** @module {"owns":"sidebar module popout open/focus/pop-in, DOM portal", "related":["popoutWindows.js","sidebarModules.js","appDocuments.js"]} */
import { CARD_ICONS } from './icons.js';
import { showAppToast } from './toast.js';
import {
    MODULE_PIP_W,
    MODULE_PIP_H,
    MODULE_POPUP_W,
    MODULE_POPUP_H,
    MODULE_CLOCK_PIP_H,
    MODULE_CLOCK_POPUP_H,
    openBrowserPopup,
    prepareBlankPopoutDocument,
    requestPipWindow,
    shouldUsePipPopout,
    unregisterPipWindow,
    windowNameForModule
} from './popoutWindows.js';
import {
    registerAppDocument,
    unregisterAppDocument
} from './appDocuments.js';
import {
    SIDEBAR_MODULE_UNDOCKED,
    SIDEBAR_MODULE_DOCK_SEL,
    SIDEBAR_MODULE_POPOUT_SEL,
    SIDEBAR_MODULE_POPIN_SEL
} from './sidebarUndock.js';
import { SIDEBAR_MODULES } from './sidebarModules.js';

import {
    SIDEBAR_MODULE_POPOUT_PLACEHOLDER,
    SIDEBAR_MODULE_POPOUT_LIVE,
    transferShellState
} from './sidebarModulePopoutShell.js';

const MODULE_LABELS = {
    clock: 'Clock',
    'quick-actions': 'Actions',
    radio: 'Radio',
    tv: 'TV',
    weather: 'Weather',
    tools: 'Tools',
    'notes-list': 'Lists',
    history: 'History',
    stats: 'Stats'
};

/** @type {Map<string, { placeholder: HTMLElement, liveRoot: HTMLElement, win: Window, isPip: boolean, onKey?: (e: KeyboardEvent) => void }>} */
const poppedById = new Map();

/** @type {(moduleId: string) => { updateDockButton?: () => void }|null|undefined} */
let getUndockForModule = () => null;

function moduleLabel(id) {
    return MODULE_LABELS[id] || id;
}

function placeholderIdFor(moduleId) {
    const config = SIDEBAR_MODULES.find((m) => m.id === moduleId);
    return config ? `${config.rootId}-placeholder` : `${moduleId}-placeholder`;
}

function popoutSizeFor(moduleId) {
    const isClock = moduleId === 'clock';
    const usePip = shouldUsePipPopout();
    return {
        width: usePip ? MODULE_PIP_W : MODULE_POPUP_W,
        height: usePip
            ? (isClock ? MODULE_CLOCK_PIP_H : MODULE_PIP_H)
            : (isClock ? MODULE_CLOCK_POPUP_H : MODULE_POPUP_H)
    };
}

function buildPlaceholderHeader(moduleId) {
    const label = moduleLabel(moduleId);
    const header = document.createElement('div');
    header.className = 'collapsable-header sidebar-module-popout-placeholder__header';
    header.innerHTML = `
        <span class="collapsable-heading sidebar-module-popout-placeholder__title">${label}</span>
        <button type="button" class="card-act sidebar-module__popout is-active" data-sidebar-popout title="Focus popout window" aria-label="Focus popout window" aria-pressed="true">${CARD_ICONS.popoutExit}</button>
        <button type="button" class="card-act sidebar-module__popin" data-sidebar-popin title="Pop in (return module to sidebar)" aria-label="Pop in (return module to sidebar)">${CARD_ICONS.popin}</button>
        <button type="button" class="card-act sidebar-module__dock" data-sidebar-dock title="Undock to canvas" aria-label="Undock to canvas"></button>
    `;
    return header;
}

function createPlaceholder(moduleId, liveRoot) {
    const placeholder = document.createElement('div');
    placeholder.id = placeholderIdFor(moduleId);
    placeholder.className = 'sidebar-module sidebar-module--popout-placeholder is-popout-locked';
    placeholder.dataset.modulePopoutPlaceholder = moduleId;
    placeholder.dataset.moduleId = moduleId;

    transferShellState(liveRoot, placeholder);

    const overlay = document.createElement('div');
    overlay.className = 'note-popout-lock-overlay sidebar-module-popout-lock-overlay';
    const icon = document.createElement('button');
    icon.type = 'button';
    icon.className = 'note-popout-lock-icon';
    icon.title = 'Open in popout — click to focus';
    icon.setAttribute('aria-label', 'Open in popout — click to focus');
    icon.innerHTML = CARD_ICONS.popout;
    icon.addEventListener('click', (e) => {
        e.stopPropagation();
        SidebarModulePopout.openOrFocus(moduleId);
    });
    overlay.appendChild(icon);

    placeholder.appendChild(overlay);
    placeholder.appendChild(buildPlaceholderHeader(moduleId));

    if (moduleId === 'clock') {
        const resize = document.createElement('div');
        resize.className = 'sidebar-clock__resize-se ff-resize ff-resize-se is-hidden';
        resize.setAttribute('data-sidebar-clock-resize', '');
        resize.setAttribute('aria-hidden', 'true');
        placeholder.appendChild(resize);
    }

    return placeholder;
}

function wirePlaceholderButtons(placeholder, moduleId) {
    placeholder.querySelector(SIDEBAR_MODULE_POPOUT_SEL)?.addEventListener('click', (e) => {
        e.stopPropagation();
        SidebarModulePopout.openOrFocus(moduleId);
    });
    placeholder.querySelector(SIDEBAR_MODULE_POPIN_SEL)?.addEventListener('click', (e) => {
        e.stopPropagation();
        SidebarModulePopout.popIn(moduleId);
    });
}

function wirePopoutWindowChrome(liveRoot, moduleId) {
    const dockBtn = liveRoot.querySelector(SIDEBAR_MODULE_DOCK_SEL);
    if (dockBtn) dockBtn.classList.add('is-hidden');

    const popoutBtn = liveRoot.querySelector(SIDEBAR_MODULE_POPOUT_SEL);
    if (popoutBtn) {
        popoutBtn.classList.add('is-active');
        popoutBtn.innerHTML = CARD_ICONS.popoutExit;
        popoutBtn.setAttribute('title', 'Pop in (return module to sidebar)');
        popoutBtn.setAttribute('aria-label', 'Pop in (return module to sidebar)');
        popoutBtn.setAttribute('aria-pressed', 'true');
    }

    liveRoot.classList.add(SIDEBAR_MODULE_POPOUT_LIVE);
    liveRoot.classList.remove(SIDEBAR_MODULE_UNDOCKED, SIDEBAR_MODULE_POPOUT_PLACEHOLDER);
    liveRoot.style.left = '';
    liveRoot.style.top = '';
    liveRoot.style.removeProperty('z-index');
}

function reparentTvVideoHolder(targetDoc) {
    const holder = document.getElementById('tv-video-holder');
    if (!holder || !targetDoc?.body) return;
    targetDoc.body.appendChild(holder);
}

function restoreTvVideoHolder() {
    for (const doc of [document, ...Array.from(poppedById.values()).map((e) => e.liveRoot?.ownerDocument).filter(Boolean)]) {
        const holder = doc.getElementById('tv-video-holder');
        if (holder && holder.parentElement !== document.body) {
            document.body.appendChild(holder);
            return;
        }
    }
}

function notifyUndockChrome(moduleId) {
    getUndockForModule(moduleId)?.updateDockButton?.();
    SidebarModulePopout.syncAllPopoutButtons();
}

async function openPopoutWindow(moduleId) {
    const { width, height } = popoutSizeFor(moduleId);
    const owner = { type: 'module', id: moduleId };
    const onPageHide = () => SidebarModulePopout.handleWindowClosed(moduleId);

    if (shouldUsePipPopout()) {
        const pipWin = await requestPipWindow({ width, height, owner, onPageHide });
        if (pipWin) return { win: pipWin, isPip: true };
    }

    const name = windowNameForModule(moduleId);
    const win = openBrowserPopup('about:blank', name, width, height);
    if (!win) return null;

    win.addEventListener('pagehide', onPageHide);
    prepareBlankPopoutDocument(win);
    return { win, isPip: false };
}

export const SidebarModulePopout = {
    isPoppedOut(moduleId) {
        return poppedById.has(moduleId);
    },

    getPlaceholder(moduleId) {
        return poppedById.get(moduleId)?.placeholder || null;
    },

    getLiveRoot(moduleId) {
        return poppedById.get(moduleId)?.liveRoot || null;
    },

    getPopoutWindow(moduleId) {
        const entry = poppedById.get(moduleId);
        if (!entry?.win || entry.win.closed) return null;
        return entry.win;
    },

    openOrFocus(moduleId) {
        if (!moduleId) return null;

        const existing = this.getPopoutWindow(moduleId);
        if (existing) {
            try {
                existing.focus();
            } catch {
                /* ignore */
            }
            return existing;
        }

        if (this.isPoppedOut(moduleId)) {
            showAppToast('Focusing popout window');
            return null;
        }

        this.popOut(moduleId);
        return null;
    },

    async popOut(moduleId) {
        const config = SIDEBAR_MODULES.find((m) => m.id === moduleId);
        if (!config) return;

        const liveRoot = document.getElementById(config.rootId);
        if (!liveRoot || this.isPoppedOut(moduleId)) return;

        const parent = liveRoot.parentElement;
        const nextSibling = liveRoot.nextSibling;
        const placeholder = createPlaceholder(moduleId, liveRoot);
        wirePlaceholderButtons(placeholder, moduleId);

        if (parent) {
            if (nextSibling) parent.insertBefore(placeholder, nextSibling);
            else parent.appendChild(placeholder);
        }

        const opened = await openPopoutWindow(moduleId);
        if (!opened?.win) {
            placeholder.remove();
            showAppToast('Could not open popout window');
            return;
        }

        const { win, isPip } = opened;
        const popDoc = win.document;
        registerAppDocument(popDoc);

        if (moduleId === 'tv') reparentTvVideoHolder(popDoc);

        popDoc.body.appendChild(liveRoot);
        wirePopoutWindowChrome(liveRoot, moduleId);

        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                SidebarModulePopout.popIn(moduleId);
            }
        };
        popDoc.addEventListener('keydown', onKey);

        poppedById.set(moduleId, {
            placeholder,
            liveRoot,
            win,
            isPip,
            parent,
            nextSibling,
            onKey
        });

        try {
            win.focus();
        } catch {
            /* ignore */
        }

        window.dispatchEvent(new CustomEvent('floating:chrome_changed'));
        notifyUndockChrome(moduleId);
    },

    popIn(moduleId) {
        const entry = poppedById.get(moduleId);
        if (!entry) return;

        const { placeholder, liveRoot, win, isPip, onKey } = entry;
        const popDoc = liveRoot.ownerDocument;

        if (onKey && popDoc) popDoc.removeEventListener('keydown', onKey);

        if (moduleId === 'tv') restoreTvVideoHolder();

        liveRoot.classList.remove(SIDEBAR_MODULE_POPOUT_LIVE);
        const dockBtn = liveRoot.querySelector(SIDEBAR_MODULE_DOCK_SEL);
        if (dockBtn) dockBtn.classList.remove('is-hidden');

        transferShellState(placeholder, liveRoot);

        const parent = placeholder.parentElement;
        if (parent) {
            parent.insertBefore(liveRoot, placeholder);
        }

        placeholder.remove();
        poppedById.delete(moduleId);

        if (popDoc && popDoc !== document) {
            unregisterAppDocument(popDoc);
        }

        if (isPip) {
            unregisterPipWindow(win);
        }

        if (win && !win.closed) {
            try {
                win.close();
            } catch {
                /* ignore */
            }
        }

        window.dispatchEvent(new CustomEvent('floating:chrome_changed'));
        notifyUndockChrome(moduleId);
    },

    handleWindowClosed(moduleId) {
        if (!poppedById.has(moduleId)) return;
        this.popIn(moduleId);
    },

    syncPopoutButtonUI(btn, moduleId) {
        if (!btn || !moduleId) return;
        const popped = this.isPoppedOut(moduleId);
        const title = popped ? 'Focus popout window' : 'Pop out module';
        btn.classList.toggle('is-active', popped);
        btn.setAttribute('aria-pressed', popped ? 'true' : 'false');
        btn.setAttribute('title', title);
        btn.setAttribute('aria-label', title);
        btn.innerHTML = popped ? CARD_ICONS.popoutExit : CARD_ICONS.popout;
    },

    syncAllPopoutButtons(root = document) {
        root.querySelectorAll?.(SIDEBAR_MODULE_POPOUT_SEL).forEach((btn) => {
            const moduleId = btn.closest('[data-module-id]')?.dataset?.moduleId
                || btn.closest('[data-module-popout-placeholder]')?.dataset?.modulePopoutPlaceholder
                || btn.closest('.sidebar-module')?.id?.replace(/^sidebar-/, '').replace(/-section$/, '')
                || null;
            const fromConfig = SIDEBAR_MODULES.find((m) => {
                const configRoot = document.getElementById(m.rootId) || this.getPlaceholder(m.id);
                return configRoot?.contains(btn);
            });
            const id = moduleId || fromConfig?.id;
            if (id) this.syncPopoutButtonUI(btn, id);
        });
    },

    bindModulePopout(moduleId, getRoot) {
        const root = getRoot();
        if (!root || root.dataset.modulePopoutBound === 'true') return;
        root.dataset.modulePopoutBound = 'true';

        const btn = root.querySelector(SIDEBAR_MODULE_POPOUT_SEL);
        if (!btn) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (root.classList.contains(SIDEBAR_MODULE_POPOUT_LIVE)) {
                this.popIn(moduleId);
                return;
            }
            if (this.isPoppedOut(moduleId)) this.openOrFocus(moduleId);
            else this.popOut(moduleId);
        });

        this.syncPopoutButtonUI(btn, moduleId);
    }
};

export function initAllModulePopouts(getRootForModule, resolveUndock) {
    getUndockForModule = resolveUndock || (() => null);
    SIDEBAR_MODULES.forEach((config) => {
        SidebarModulePopout.bindModulePopout(config.id, () => getRootForModule(config.id));
    });
}
