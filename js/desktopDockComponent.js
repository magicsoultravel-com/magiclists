/** @module {"owns":"desktop switcher dock UI, floating pill with collapsible drawer, dock pin lock"} */

import { DesktopManager } from './desktopManager.js';
import { BoardOperations } from './boardOperations.js';
import { CARD_ICONS } from './icons.js';
import { showAppToast } from './toast.js';

const TOGGLE_ICON = '🖥️';
const DRAWER_HEIGHT = 48;
const PILL_WIDTH_PX = 48;

// Color palette for desktop icons (R, G, B, Y, P, O, C)
const DESKTOP_COLORS = ['r', 'g', 'b', 'y', 'p', 'o', 'c'];

let _drawerEl = null;
let _toggleEl = null;
let _containerEl = null;
let _pinBtn = null;
let _isDrawerOpen = false;
let _isExpanded = false;
let _isPinned = false;
let _items = [];

function createTogglePill() {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.id = 'desktop-dock-toggle';
    pill.className = 'desktop-dock-toggle';
    pill.title = 'Switch desktop';
    pill.setAttribute('aria-label', 'Switch desktop');
    pill.setAttribute('aria-expanded', 'false');
    pill.innerHTML = TOGGLE_ICON;
    return pill;
}

function createDrawer() {
    const drawer = document.createElement('div');
    drawer.id = 'desktop-dock-drawer';
    drawer.className = 'desktop-dock-drawer';
    drawer.setAttribute('aria-hidden', 'true');
    return drawer;
}

function createPinButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'desktop-dock-pin';
    btn.className = 'desktop-dock-pin';
    btn.title = 'Pin desktop switcher';
    btn.setAttribute('aria-label', 'Pin desktop switcher');
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = CARD_ICONS.pin;
    return btn;
}

function renderDesktopButtons(drawer, items = []) {
    const count = DesktopManager.getDesktopCount();
    drawer.innerHTML = '';

    for (let i = 1; i <= count; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        const color = DESKTOP_COLORS[(i - 1) % DESKTOP_COLORS.length];
        btn.className = `desktop-dock-btn desktop-dock-btn--${color}`;
        btn.id = `desktop-dock-btn-${i}`;
        btn.dataset.desktopId = String(i);
        btn.title = `Desktop ${i}`;
        btn.setAttribute('aria-label', `Desktop ${i}`);

        // Count visible notes on this desktop (excluding hidden and archived)
        const notesForDesktop = DesktopManager.getAllNotesForDesktop(i, items);
        const visibleNotes = notesForDesktop.filter(item =>
            !BoardOperations.isHiddenFromBoard(item) && !BoardOperations.isArchived(item)
        );
        const noteCount = visibleNotes.length;

        // Colored square with note count inside
        btn.innerHTML = `<span class="desktop-dock-icon"><span class="desktop-dock-count">${noteCount}</span></span>`;

        if (i === DesktopManager.getActiveDesktop()) {
            btn.classList.add('active');
            btn.setAttribute('aria-current', 'true');
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            DesktopManager.setActiveDesktop(i);
            // Don't close drawer - allows easy switching between desktops
            window.dispatchEvent(new CustomEvent('desktop:changed', {
                detail: { desktopId: i }
            }));
        });

        // Drag-over support for desktop dock drop detection
        btn.addEventListener('pointerenter', () => {
            btn.dataset.dragOver = 'true';
            btn.classList.add('drag-over');
        });

        btn.addEventListener('pointerleave', () => {
            btn.dataset.dragOver = 'false';
            btn.classList.remove('drag-over');
        });

        drawer.appendChild(btn);
    }

    // PIN button floats in the corner of the drawer (positioned via CSS)
    drawer.appendChild(_pinBtn);
}

function openDrawer() {
    if (!_drawerEl) return;
    _isDrawerOpen = true;
    _toggleEl.setAttribute('aria-expanded', 'true');
    _drawerEl.setAttribute('aria-hidden', 'false');
    _drawerEl.classList.add('is-open');
}

function closeDrawer() {
    if (!_drawerEl) return;
    _isDrawerOpen = false;
    _toggleEl.setAttribute('aria-expanded', 'false');
    _drawerEl.setAttribute('aria-hidden', 'true');
    _drawerEl.classList.remove('is-open');
}

function toggleDrawer() {
    if (_isDrawerOpen) {
        closeDrawer();
    } else {
        openDrawer();
    }
}

function updateActiveButton() {
    if (!_drawerEl) return;
    const activeId = DesktopManager.getActiveDesktop();
    _drawerEl.querySelectorAll('.desktop-dock-btn').forEach(btn => {
        const id = Number(btn.dataset.desktopId);
        const isActive = id === activeId;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
}

function updatePinButton() {
    if (!_pinBtn) return;
    _isPinned = DesktopManager.isDockPinned();
    _pinBtn.setAttribute('aria-pressed', _isPinned ? 'true' : 'false');
    _pinBtn.title = _isPinned ? 'Unpin desktop switcher' : 'Pin desktop switcher';
    _pinBtn.setAttribute('aria-label', _isPinned ? 'Unpin desktop switcher' : 'Pin desktop switcher');
    _pinBtn.innerHTML = _isPinned ? CARD_ICONS.unpin : CARD_ICONS.pin;
    _pinBtn.classList.toggle('is-pinned', _isPinned);
    _toggleEl.classList.toggle('is-pinned', _isPinned);
    _containerEl?.classList.toggle('is-pinned', _isPinned);
}

function bindEvents() {
    _toggleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        _isExpanded = !_isExpanded;
        if (_isExpanded) {
            openDrawer();
        } else {
            closeDrawer();
        }
    });

    _containerEl.addEventListener('pointerenter', () => {
        _containerEl.classList.add('is-hovered');
        if (!_isExpanded) {
            openDrawer();
        }
    });

    _containerEl.addEventListener('pointerleave', () => {
        _containerEl.classList.remove('is-hovered');
        if (!_isExpanded) {
            closeDrawer();
        }
    });

    // Close drawer when clicking outside — but only if not pinned
    document.addEventListener('click', (e) => {
        if (_isPinned) return;
        if (_isDrawerOpen && !_containerEl.contains(e.target)) {
            _isExpanded = false;
            closeDrawer();
        }
    });

    // Close drawer on escape — but only if not pinned
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _isDrawerOpen && !_isPinned) {
            _isExpanded = false;
            closeDrawer();
        }
    });

    // PIN button click handler
    _pinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nowPinned = DesktopManager.toggleDockPinned();
        updatePinButton();
        if (nowPinned) {
            if (!_isDrawerOpen) {
                openDrawer();
            }
            _isExpanded = true;
            showAppToast('Desktop switcher pinned');
        } else {
            showAppToast('Desktop switcher unpinned');
        }
    });

    DesktopManager.onDesktopChange(() => {
        updateActiveButton();
    });

    window.addEventListener('desktop:count_changed', () => {
        if (_drawerEl) {
            renderDesktopButtons(_drawerEl, _items);
            updateActiveButton();
        }
    });

    window.addEventListener('item:mutation_requested', () => {
        if (_drawerEl) {
            renderDesktopButtons(_drawerEl, _items);
            updateActiveButton();
        }
    });

    DesktopManager.onDockPinChange(() => {
        updatePinButton();
    });
}

export const DesktopDock = {
    init() {
        _toggleEl = createTogglePill();
        _drawerEl = createDrawer();
        _pinBtn = createPinButton();

        const container = document.createElement('div');
        container.id = 'desktop-dock';
        container.className = 'desktop-dock';
        container.appendChild(_toggleEl);
        container.appendChild(_drawerEl);

        _containerEl = container;

        const workspaceShell = document.getElementById('workspace-shell');
        if (workspaceShell) {
            workspaceShell.appendChild(container);
        }

        renderDesktopButtons(_drawerEl, _items);

        updatePinButton();
        if (_isPinned) {
            _isExpanded = true;
            openDrawer();
        }

        bindEvents();
    },

    isOpen() {
        return _isDrawerOpen;
    },

    isDragActive() {
        if (!_drawerEl) return false;
        return _drawerEl.querySelector('.desktop-dock-btn[drag-over="true"]') !== null;
    },

    isPinned() {
        return _isPinned;
    },

    open() {
        openDrawer();
    },

    close() {
        closeDrawer();
    },

    refreshButtons(items = []) {
        _items = items;
        if (_drawerEl) {
            renderDesktopButtons(_drawerEl, items);
        }
    }
};
