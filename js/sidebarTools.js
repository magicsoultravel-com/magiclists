/** @module {"owns":"sidebar tools dock and tool launcher chips", "related":["toolsManager.js","toolPanelChrome.js","sidebarPrefs.js","sidebarUndock.js"]} */
import { readToolsDock, writeToolsDock, writeSidebarSection } from './sidebarPrefs.js';
import { initSidebarUndock } from './sidebarUndock.js';

export const SidebarTools = {
    root: null,

    init() {
        this.root = document.getElementById('sidebar-tools');
        if (!this.root) return;

        Object.assign(this, initSidebarUndock({
            getRoot: () => this.root,
            undockedClass: 'sidebar-tools--undocked',
            draggingClass: 'sidebar-tools--dragging',
            dockSelector: '[data-tools-dock]',
            getHeader: () => document.getElementById('tools-section-header'),
            readDock: readToolsDock,
            writeDock: writeToolsDock,
            restoreToSidebar: () => this.restoreToSidebar(),
            onBeforeUndock: () => this.expandSection()
        }));
        this.applyInitialDockState();
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
    }
};
