import { clampPanelToViewport } from './popoverPosition.js';
import { CARD_ICONS } from './ui.js';
import { readQuickActionsDock, writeQuickActionsDock, writeSidebarSection } from './sidebarPrefs.js';

export const SidebarQuickActions = {
    root: null,

    init() {
        this.root = document.getElementById('sidebar-quick-actions');
        if (!this.root) return;

        this.bindDockButton();
        this.bindDrag();
        this.bindViewportClamp();
        this.applyInitialDockState();
    },

    isUndocked() {
        return this.root?.classList.contains('sidebar-quick-actions--undocked');
    },

    bindViewportClamp() {
        window.addEventListener('resize', () => {
            if (!this.isUndocked()) return;
            const x = parseFloat(this.root.style.left) || 0;
            const y = parseFloat(this.root.style.top) || 0;
            const clamped = clampPanelToViewport(this.root, x, y);
            this.root.style.left = `${clamped.x}px`;
            this.root.style.top = `${clamped.y}px`;
        });
    },

    applyInitialDockState() {
        const { docked, x, y } = readQuickActionsDock();
        if (docked !== false) {
            this.updateDockButton();
            return;
        }

        this.ensureUndockedInBody();
        this.root.classList.add('sidebar-quick-actions--undocked');
        this.expandSection();
        if (x != null && y != null) {
            this.root.style.left = `${x}px`;
            this.root.style.top = `${y}px`;
            requestAnimationFrame(() => {
                const clamped = clampPanelToViewport(this.root, x, y);
                this.root.style.left = `${clamped.x}px`;
                this.root.style.top = `${clamped.y}px`;
            });
        } else {
            this.applyUndockedState(false);
        }
        this.updateDockButton();
    },

    ensureUndockedInBody() {
        if (this.root.parentElement !== document.body) {
            document.body.appendChild(this.root);
        }
    },

    restoreToSidebar() {
        const scroll = document.querySelector('.side-panel-scroll');
        if (!scroll || this.root.parentElement !== document.body) return;
        scroll.insertAdjacentElement('afterbegin', this.root);
    },

    expandSection() {
        const section = document.getElementById('quick-actions-section');
        const header = document.getElementById('quick-actions-header');
        if (!section) return;
        section.classList.remove('collapsed');
        header?.querySelector('.collapsable-toggle')?.classList.remove('collapsed');
        writeSidebarSection('quick-actions-section', false);
    },

    updateDockButton() {
        const btn = this.root?.querySelector('[data-quick-actions-dock]');
        if (!btn) return;
        const undocked = this.isUndocked();
        btn.innerHTML = undocked ? CARD_ICONS.pin : CARD_ICONS.unpin;
        const label = undocked ? 'Dock in sidebar' : 'Undock to canvas';
        btn.setAttribute('title', label);
        btn.setAttribute('aria-label', label);
    },

    bindDockButton() {
        this.root.querySelector('[data-quick-actions-dock]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDock();
        });
    },

    toggleDock() {
        if (this.isUndocked()) this.applyDockedState();
        else this.applyUndockedState();
        this.updateDockButton();
    },

    applyDockedState() {
        this.root.classList.remove('sidebar-quick-actions--undocked', 'sidebar-quick-actions--dragging');
        this.root.style.left = '';
        this.root.style.top = '';
        this.restoreToSidebar();
        writeQuickActionsDock({ docked: true, x: null, y: null });
    },

    applyUndockedState(persist = true) {
        const rect = this.root.getBoundingClientRect();
        const saved = readQuickActionsDock();
        let x = saved.x ?? rect.left;
        let y = saved.y ?? rect.top;

        this.expandSection();
        this.ensureUndockedInBody();
        this.root.classList.add('sidebar-quick-actions--undocked');
        this.root.style.left = `${x}px`;
        this.root.style.top = `${y}px`;
        const clamped = clampPanelToViewport(this.root, x, y);
        this.root.style.left = `${clamped.x}px`;
        this.root.style.top = `${clamped.y}px`;

        if (persist) {
            writeQuickActionsDock({
                docked: false,
                x: clamped.x,
                y: clamped.y
            });
        }
    },

    bindDrag() {
        const header = document.getElementById('quick-actions-header');
        if (!header || header.dataset.quickActionsDragBound === 'true') return;
        header.dataset.quickActionsDragBound = 'true';

        header.addEventListener('pointerdown', (e) => {
            if (!this.isUndocked()) return;
            if (e.target.closest('[data-quick-actions-dock]') || e.target.closest('.collapsable-toggle')) return;
            if (e.button !== 0) return;

            e.preventDefault();
            let dragging = true;
            let didDrag = false;
            const startX = e.clientX;
            const startY = e.clientY;
            const startLeft = parseFloat(this.root.style.left) || 0;
            const startTop = parseFloat(this.root.style.top) || 0;

            this.root.classList.add('sidebar-quick-actions--dragging');
            header.setPointerCapture(e.pointerId);

            const onMove = (ev) => {
                if (!dragging) return;
                if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) didDrag = true;
                const clamped = clampPanelToViewport(
                    this.root,
                    startLeft + (ev.clientX - startX),
                    startTop + (ev.clientY - startY)
                );
                this.root.style.left = `${clamped.x}px`;
                this.root.style.top = `${clamped.y}px`;
            };

            const onUp = (ev) => {
                if (!dragging) return;
                dragging = false;
                this.root.classList.remove('sidebar-quick-actions--dragging');
                header.releasePointerCapture(ev.pointerId);
                if (didDrag) {
                    header.dataset.suppressClick = 'true';
                    requestAnimationFrame(() => {
                        delete header.dataset.suppressClick;
                    });
                }
                writeQuickActionsDock({
                    x: parseFloat(this.root.style.left) || 0,
                    y: parseFloat(this.root.style.top) || 0
                });
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        });
    }
};
