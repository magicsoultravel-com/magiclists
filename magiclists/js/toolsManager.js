// js/toolsManager.js
import { getToolIcon } from './tool-icons.js';

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const ToolsManager = {
    overlay: null,
    mountZone: null,
    dropdown: null,
    activeToolInstance: null,
    registry: [],
    getItems: null,

    async init(getItems) {
        this.getItems = getItems || null;
        this.overlay = document.getElementById('tools-overlay');
        this.mountZone = document.getElementById('tools-form-mount');
        this.dropdown = document.getElementById('toolbox-dropdown');

        if (!this.dropdown) return;

        const closeBtn = document.getElementById('tools-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        window.addEventListener('tools:request_close', () => this.close());

        await this.loadRegistry();
        this.renderDropdownMenu();
    },

    getApiBasePath() {
        const pagePath = window.location.pathname.replace(/\/[^/]*$/, '/');
        return `${pagePath}api/tools-list.php`;
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
        try {
            const response = await fetch(`${this.getApiBasePath()}?t=${Date.now()}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            if (!Array.isArray(data)) {
                throw new Error('Invalid tools list response');
            }
            this.registry = data;
        } catch (error) {
            console.warn('[ToolsManager] Could not load tools from server:', error);
            this.registry = [];
            this.dropdown.innerHTML = '<p class="tool-msg tool-msg--error">Tools list unavailable. Ensure api/tools-list.php is deployed.</p>';
        }
    },

    renderDropdownMenu() {
        if (!this.registry.length) {
            if (!this.dropdown.innerHTML) {
                this.dropdown.innerHTML = '<p class="tool-msg">No tools found in js/tools/</p>';
            }
            return;
        }

        this.dropdown.innerHTML = this.registry.map(tool => {
            const icon = getToolIcon(tool.icon, tool.id);
            return `<button type="button" class="btn btn--compact menu-tool-trigger" data-target="${tool.id}">
                <span class="menu-tool-icon">${icon}</span>
                <span class="menu-tool-label">${escapeHtml(tool.label)}</span>
            </button>`;
        }).join('');

        this.dropdown.querySelectorAll('.menu-tool-trigger').forEach(btn => {
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
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
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

    async launch(toolName) {
        try {
            this.mountZone.innerHTML = '<p class="tool-msg">Loading tool...</p>';
            this.overlay.classList.remove('is-hidden');

            const modal = this.overlay.querySelector('.modal');
            modal?.classList.toggle('modal--wide', toolName === 'calendar');
            this.mountZone.classList.toggle('tool-mount--calendar', toolName === 'calendar');

            const toolsPath = this.getToolsBasePath();
            const modulePath = `${toolsPath}${toolName}.js?cb=${Date.now()}`;
            const module = await import(modulePath);

            this.activeToolInstance = this.resolveToolModule(module, toolName);

            if (this.activeToolInstance) {
                await this.activeToolInstance.init(this.mountZone);
            } else {
                this.mountZone.innerHTML = '<p class="tool-msg tool-msg--error">Tool module does not export an init function.</p>';
            }
        } catch (error) {
            console.error('Tool execution broken:', error);
            const toolsPath = this.getToolsBasePath();
            this.mountZone.innerHTML = `<p class="tool-msg tool-msg--error">Failed to load tool: ${toolName}. Check ${toolsPath}${toolName}.js</p>`;
        }
    },

    close() {
        if (this.activeToolInstance && typeof this.activeToolInstance.destroy === 'function') {
            this.activeToolInstance.destroy();
        }
        const modal = this.overlay?.querySelector('.modal');
        modal?.classList.remove('modal--wide');
        this.mountZone?.classList.remove('tool-mount--calendar');
        this.overlay.classList.add('is-hidden');
        this.mountZone.innerHTML = '';
        this.activeToolInstance = null;
    }
};
