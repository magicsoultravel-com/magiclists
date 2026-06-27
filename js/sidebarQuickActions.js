import { readQuickActionsDock, writeQuickActionsDock, writeSidebarSection } from './sidebarPrefs.js';
import { initSidebarUndock } from './sidebarUndock.js';

export const SidebarQuickActions = {
    root: null,

    init() {
        this.root = document.getElementById('sidebar-quick-actions');
        if (!this.root) return;

        Object.assign(this, initSidebarUndock({
            getRoot: () => this.root,
            undockedClass: 'sidebar-quick-actions--undocked',
            draggingClass: 'sidebar-quick-actions--dragging',
            dockSelector: '[data-quick-actions-dock]',
            getHeader: () => document.getElementById('quick-actions-header'),
            readDock: readQuickActionsDock,
            writeDock: writeQuickActionsDock,
            restoreToSidebar: () => this.restoreToSidebar(),
            onBeforeUndock: () => this.expandSection()
        }));
        this.applyInitialDockState();
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
    }
};
