// js/toolsManager.js
import { CARD_ICONS } from './ui.js';
import { TOOLS_REGISTRY } from './tools/registry.js';

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const GENERIC_TOOL_ICON =
    '<rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1" fill="none" stroke="currentColor" stroke-width="0.95"/>' +
    '<path d="M4.5 6h3" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>';

function renderToolIcon(markup) {
    const body = (markup || '').trim() || GENERIC_TOOL_ICON;
    if (body.startsWith('<svg')) return body;
    return `<svg viewBox="0 0 12 12" width="12" height="12" focusable="false" aria-hidden="true">${body}</svg>`;
}

export const ToolsManager = {
    overlay: null,
    mountZone: null,
    dropdown: null,
    activeToolInstance: null,
    activeMountClass: null,
    registry: [],
    getItems: null,
    getFocusCategories: null,

    async init(getItems, getFocusCategories) {
        this.getItems = getItems || null;
        this.getFocusCategories = getFocusCategories || null;
        this.overlay = document.getElementById('tools-overlay');
        this.mountZone = document.getElementById('tools-form-mount');
        this.dropdown = document.getElementById('toolbox-dropdown');

        if (!this.dropdown) return;

        const closeBtn = document.getElementById('tools-close-btn');
        if (closeBtn) {
            closeBtn.innerHTML = CARD_ICONS.close;
            closeBtn.addEventListener('click', () => this.close());
        }

        window.addEventListener('tools:request_close', () => this.close());

        await this.loadRegistry();
        this.renderDropdownMenu();
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

    renderDropdownMenu() {
        if (!this.registry.length) {
            this.dropdown.innerHTML = '<p class="tool-msg">No tools available. Run node scripts/build-tools-list.mjs after adding tools.</p>';
            return;
        }

        this.dropdown.innerHTML = this.registry.map((tool) => {
            const icon = renderToolIcon(tool.icon);
            return `<button type="button" class="btn btn--compact menu-tool-trigger" data-target="${tool.id}">
                <span class="menu-tool-icon">${icon}</span>
                <span class="menu-tool-label">${escapeHtml(tool.label)}</span>
            </button>`;
        }).join('');

        this.dropdown.querySelectorAll('.menu-tool-trigger').forEach((btn) => {
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

    applyToolShell(meta) {
        const modal = this.overlay?.querySelector('.modal');
        modal?.classList.toggle('modal--wide', !!meta?.wide);

        if (meta?.mountClass) {
            this.mountZone.classList.add(meta.mountClass);
            this.activeMountClass = meta.mountClass;
        }
    },

    clearToolShell() {
        const modal = this.overlay?.querySelector('.modal');
        modal?.classList.remove('modal--wide');

        if (this.activeMountClass) {
            this.mountZone?.classList.remove(this.activeMountClass);
            this.activeMountClass = null;
        }
    },

    async launch(toolName) {
        const meta = this.getToolMeta(toolName);

        try {
            this.mountZone.innerHTML = '<p class="tool-msg">Loading tool...</p>';
            this.overlay.classList.remove('is-hidden');
            this.applyToolShell(meta);

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

        this.clearToolShell();
        this.overlay.classList.add('is-hidden');
        this.mountZone.innerHTML = '';
        this.activeToolInstance = null;
    }
};
