/** @module {"owns":"desktop switcher dock UI, floating pill with collapsible drawer"} */

import { DesktopManager } from './desktopManager.js';

const TOGGLE_ICON = '🖥️';
const DRAWER_HEIGHT = 48;
const PILL_WIDTH_PX = 48;

let _drawerEl = null;
let _toggleEl = null;
let _isDrawerOpen = false;
let _isDragActive = false;
let _signal = null;

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

function renderDesktopButtons(drawer) {
    const count = DesktopManager.getDesktopCount();
    drawer.innerHTML = '';
    
    for (let i = 1; i <= count; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'desktop-dock-btn';
        btn.id = `desktop-dock-btn-${i}`;
        btn.dataset.desktopId = String(i);
        btn.title = `Desktop ${i}`;
        btn.setAttribute('aria-label', `Desktop ${i}`);
        btn.textContent = `[${i}]`;
        
        if (i === DesktopManager.getActiveDesktop()) {
            btn.classList.add('active');
            btn.setAttribute('aria-current', 'true');
        }
        
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            DesktopManager.setActiveDesktop(i);
            closeDrawer();
            // Dispatch event for workspace refresh (Phase 2 will handle)
            window.dispatchEvent(new CustomEvent('desktop:changed', {
                detail: { desktopId: i }
            }));
        });

        // Drag-over support for desktop dock drop detection
        btn.addEventListener('pointerenter', () => {
            _isDragActive = true;
            btn.classList.add('drag-over');
        });

        btn.addEventListener('pointerleave', () => {
            _isDragActive = false;
            btn.classList.remove('drag-over');
        });

        drawer.appendChild(btn);
    }
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

function bindEvents() {
    _toggleEl.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDrawer();
    });

    // Open drawer on hover
    _toggleEl.addEventListener('pointerenter', () => {
        openDrawer();
    });

    // Close drawer when pointer leaves toggle area
    _toggleEl.addEventListener('pointerleave', () => {
        // Use a small delay to allow smooth hover UX
        setTimeout(() => {
            if (!_drawerEl?.contains(document.activeElement)) {
                closeDrawer();
            }
        }, 100);
    });

    // Close drawer when clicking outside
    document.addEventListener('click', (e) => {
        if (_isDrawerOpen && !_toggleEl.contains(e.target) && !_drawerEl.contains(e.target)) {
            closeDrawer();
        }
    });

    // Close drawer on escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _isDrawerOpen) {
            closeDrawer();
        }
    });

// Listen for desktop changes to update UI
    DesktopManager.onDesktopChange(() => {
        updateActiveButton();
    });
    
    // Listen for desktop count changes to refresh button list
    window.addEventListener('desktop:count_changed', () => {
        if (_drawerEl) {
            renderDesktopButtons(_drawerEl);
            updateActiveButton();
        }
    });
}

export const DesktopDock = {
    init() {
        // Create elements
        _toggleEl = createTogglePill();
        _drawerEl = createDrawer();
        
        // Combine into container
        const container = document.createElement('div');
        container.id = 'desktop-dock';
        container.className = 'desktop-dock';
        container.appendChild(_toggleEl);
        container.appendChild(_drawerEl);
        
        // Find workspace shell for mounting
        const workspaceShell = document.getElementById('workspace-shell');
        if (workspaceShell) {
            workspaceShell.appendChild(container);
        }
        
        // Render initial buttons
        renderDesktopButtons(_drawerEl);
        
        // Bind events
        bindEvents();
    },

    isOpen() {
        return _isDrawerOpen;
    },

    isDragActive() {
        return _isDragActive;
    },

    open() {
        openDrawer();
    },

    close() {
        closeDrawer();
    },

    refreshButtons() {
        if (_drawerEl) {
            renderDesktopButtons(_drawerEl);
        }
    }
};

