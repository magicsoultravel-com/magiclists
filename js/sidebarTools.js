import { clampPanelToViewport } from './popoverPosition.js';
import { CARD_ICONS } from './ui.js';
import { readToolsDock, writeToolsDock, writeSidebarSection } from './sidebarPrefs.js';

export const SidebarTools = {
    root: null,

    init() {
        this.root = document.getElementById('sidebar-tools');
        if (!this.root) return;

        this.bindDockButton();
        this.bindDrag();
        this.bindViewportClamp();
        this.applyInitialDockState();
    },

    isUndocked() {
        return this.root?.classList.contains('sidebar-tools--undocked');
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
        const { docked, x, y } = readToolsDock();
        if (docked !== false) {
            this.updateDockButton();
            return;
        }

        this.ensureUndockedInBody();
        this.root.classList.add('sidebar-tools--undocked');
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
        const notesList = document.querySelector('.side-panel-list');
        if (!notesList || this.root.parentElement !== document.body) return;
        notesList.insertAdjacentElement('beforebegin', this.root);
    },

    expandSection() {
        const section = document.getElementById('tools-section');
        const header = document.getElementById('tools-section-header');
        if (!section) return;
        section.classList.remove('collapsed');
        header?.querySelector('.collapsable-toggle')?.classList.remove('collapsed');
        writeSidebarSection('tools-section', false);
    },

    updateDockButton() {
        const btn = this.root?.querySelector('[data-tools-dock]');
        if (!btn) return;
        const undocked = this.isUndocked();
        btn.innerHTML = undocked ? CARD_ICONS.pin : CARD_ICONS.unpin;
        const label = undocked ? 'Dock in sidebar' : 'Undock to canvas';
        btn.setAttribute('title', label);
        btn.setAttribute('aria-label', label);
    },

    bindDockButton() {
        this.root.querySelector('[data-tools-dock]')?.addEventListener('click', (e) => {
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
        this.root.classList.remove('sidebar-tools--undocked', 'sidebar-tools--dragging');
        this.root.style.left = '';
        this.root.style.top = '';
        this.restoreToSidebar();
        writeToolsDock({ docked: true, x: null, y: null });
    },

    applyUndockedState(persist = true) {
        const rect = this.root.getBoundingClientRect();
        const saved = readToolsDock();
        let x = saved.x ?? rect.left;
        let y = saved.y ?? rect.top;

        this.expandSection();
        this.ensureUndockedInBody();
        this.root.classList.add('sidebar-tools--undocked');
        this.root.style.left = `${x}px`;
        this.root.style.top = `${y}px`;
        const clamped = clampPanelToViewport(this.root, x, y);
        this.root.style.left = `${clamped.x}px`;
        this.root.style.top = `${clamped.y}px`;

        if (persist) {
            writeToolsDock({
                docked: false,
                x: clamped.x,
                y: clamped.y
            });
        }
    },

    bindDrag() {
        const header = document.getElementById('tools-section-header');
        if (!header || header.dataset.toolsDragBound === 'true') return;
        header.dataset.toolsDragBound = 'true';

        header.addEventListener('pointerdown', (e) => {
            if (!this.isUndocked()) return;
            if (e.target.closest('[data-tools-dock]') || e.target.closest('.collapsable-toggle')) return;
            if (e.button !== 0) return;

            e.preventDefault();
            let dragging = true;
            let didDrag = false;
            const startX = e.clientX;
            const startY = e.clientY;
            const startLeft = parseFloat(this.root.style.left) || 0;
            const startTop = parseFloat(this.root.style.top) || 0;

            this.root.classList.add('sidebar-tools--dragging');
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
                this.root.classList.remove('sidebar-tools--dragging');
                header.releasePointerCapture(ev.pointerId);
                if (didDrag) {
                    header.dataset.suppressClick = 'true';
                    requestAnimationFrame(() => {
                        delete header.dataset.suppressClick;
                    });
                }
                writeToolsDock({
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
