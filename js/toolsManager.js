// js/toolsManager.js
import { TOOLS_REGISTRY } from './tools/registry.js';
import { createToolPanel, renderToolIcon } from './toolPanelChrome.js';

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export { renderToolIcon };

export const ToolsManager = {
    desktop: null,
    dropdown: null,
    openPanels: new Map(),
    registry: [],
    getItems: null,

    async init(getItems) {
        this.getItems = getItems || null;
        this.desktop = document.getElementById('tools-desktop');
        this.dropdown = document.getElementById('toolbox-dropdown');

        if (!this.dropdown) return;

        window.addEventListener('tools:request_close', (e) => {
            const toolId = e.detail?.toolId;
            if (toolId) this.dismiss(toolId);
            else this.closeAll();
        });

        await this.loadRegistry();
        this.renderDropdownMenu();
        this.bindDesktopBoundsWatcher();
    },

    bindDesktopBoundsWatcher() {
        if (this._desktopBoundsWatcher) return;
        const sidePanel = document.getElementById('side-panel');
        if (!sidePanel) return;
        this._desktopBoundsWatcher = new MutationObserver(() => {
            window.dispatchEvent(new CustomEvent('tools:desktop_bounds_changed'));
        });
        this._desktopBoundsWatcher.observe(sidePanel, { attributes: true, attributeFilter: ['class'] });
    },

    getToolsBasePath() {
        const appScript = document.querySelector('script[type="module"][src*="app.js"]');
        if (appScript?.src) {
            const scriptDir = appScript.src.substring(0, appScript.src.lastIndexOf('/') + 1);
            return `${scriptDir}tools/`;
        }
        return './js/tools/';
    },

    async loadRegistry() {
        this.registry = Array.isArray(TOOLS_REGISTRY) ? TOOLS_REGISTRY : [];
    },

    getToolMeta(toolId) {
        return this.registry.find((tool) => tool.id === toolId) || null;
    },

    isOnDesktop(toolId) {
        return this.openPanels.has(toolId);
    },

    renderDropdownMenu() {
        if (!this.registry.length) {
            this.dropdown.innerHTML = '<p class="tool-msg">No tools available. Run node scripts/build-tools-list.mjs after adding tools.</p>';
            return;
        }

        this.dropdown.innerHTML = this.registry.map((tool) => {
            const icon = renderToolIcon(tool.icon);
            const onDesktop = this.isOnDesktop(tool.id);
            return `<button type="button" class="btn btn--compact btn--icon${onDesktop ? ' active' : ''}" data-target="${tool.id}" title="${escapeHtml(tool.label)}" aria-label="${escapeHtml(tool.label)}" aria-pressed="${onDesktop ? 'true' : 'false'}">${icon}</button>`;
        }).join('');

        this.dropdown.querySelectorAll('[data-target]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const targetModule = e.currentTarget.getAttribute('data-target');
                if (targetModule) this.launch(targetModule);
            });
        });
    },

    resolveToolModule(module, toolName) {
        if (module.default && typeof module.default.init === 'function') {
            return module.default;
        }

        const pascal = toolName
            .split(/[-_]/)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');

        if (module[pascal] && typeof module[pascal].init === 'function') {
            return module[pascal];
        }

        for (const value of Object.values(module)) {
            if (value && typeof value.init === 'function') {
                return value;
            }
        }

        return null;
    },

    focus(toolId) {
        const entry = this.openPanels.get(toolId);
        if (!entry) return;
        entry.chrome.focus();
    },

    collapse(toolId) {
        const entry = this.openPanels.get(toolId);
        entry?.chrome.collapse();
    },

    expand(toolId) {
        const entry = this.openPanels.get(toolId);
        entry?.chrome.expand();
    },

    async launch(toolName) {
        if (this.openPanels.has(toolName)) {
            this.focus(toolName);
            this.renderDropdownMenu();
            return;
        }

        const meta = this.getToolMeta(toolName);
        if (!meta || !this.desktop) return;

        const chrome = createToolPanel(toolName, meta, this.desktop, {
            onDismiss: () => this.dismiss(toolName),
            onResize: (bodyEl) => {
                const entry = this.openPanels.get(toolName);
                entry?.instance?.onPanelResize?.(bodyEl);
            }
        });

        chrome.bodyEl.innerHTML = '<p class="tool-msg">Loading tool...</p>';
        chrome.show();

        const entry = { chrome, instance: null, meta };
        this.openPanels.set(toolName, entry);
        this.renderDropdownMenu();

        try {
            const toolsPath = this.getToolsBasePath();
            const modulePath = `${toolsPath}${toolName}.js?cb=${Date.now()}`;
            const module = await import(modulePath);

            if (!this.openPanels.has(toolName)) return;

            const instance = this.resolveToolModule(module, toolName);
            entry.instance = instance;

            if (instance) {
                chrome.bodyEl.innerHTML = '';
                await instance.init(chrome.bodyEl, {
                    updateChipReadout: (text) => chrome.updateChipReadout?.(text)
                });
                chrome.persist();
            } else {
                chrome.bodyEl.innerHTML = '<p class="tool-msg tool-msg--error">Tool module does not export an init function.</p>';
            }
        } catch (error) {
            console.error('Tool execution broken:', error);
            if (this.openPanels.has(toolName)) {
                const toolsPath = this.getToolsBasePath();
                chrome.bodyEl.innerHTML = `<p class="tool-msg tool-msg--error">Failed to load tool: ${toolName}. Check ${toolsPath}${toolName}.js</p>`;
            }
        }
    },

    dismiss(toolId) {
        const entry = this.openPanels.get(toolId);
        if (!entry) return;

        if (entry.instance && typeof entry.instance.destroy === 'function') {
            entry.instance.destroy();
        }

        entry.chrome.destroy();
        this.openPanels.delete(toolId);
        this.renderDropdownMenu();
    },

     close() {
        this.closeAll();
    },

    closeAll() {
        [...this.openPanels.keys()].forEach((id) => this.dismiss(id));
    }
};
