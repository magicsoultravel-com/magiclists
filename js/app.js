import { API } from './api.js';
import { UI, ACTION_ICONS } from './ui.js';
import { Editor } from './editor.js';
import { DragDropEngine } from './dragdrop.js';
import { ToolsManager } from './toolsManager.js';
import { Calendar } from './calendar.js';
import { SidePanel } from './hamburger.js';
import { applyBackupToStorage } from './backup.js';
import { DEFAULT_CATEGORIES, normalizeCategories } from './categories.js';
import { UndoManager, historyLabelForItem } from './undo.js';
import { DesktopBackground } from './desktopBackground.js';
import { ChromeBackground } from './chromeBackground.js';
import { ClockStyle } from './clockStyle.js';
import { ColorPicker, PALETTE_NOTE, randomNoteColor } from './colorPicker.js';

function countHiddenFromBoard(items) {
    return items.filter(item => UI.isHiddenFromBoard(item)).length;
}

const AppState = {
    user: { isLoggedIn: false, token: null },
    items: [],
    categories: [...DEFAULT_CATEGORIES],
    hiddenCategories: JSON.parse(localStorage.getItem('matrix_hidden_categories') || '[]'),
    expandedCards: JSON.parse(localStorage.getItem('matrix_expanded_cards') || '{}'),
    viewSettings: {
        sortBy: (() => {
            const preferred = localStorage.getItem('matrix_preferred_view') || 'columns';
            if (preferred === 'grid' || preferred === 'list') {
                localStorage.setItem('matrix_preferred_view', 'columns');
                return 'columns';
            }
            return preferred;
        })(),
        currentView: 'active'
    }
};

class Application {
    async init() {
        DesktopBackground.init();
        ChromeBackground.init();
        this.checkAuthSession();
        Editor.init();
        await ToolsManager.init(() => AppState.items);
        Calendar.init();
        this.renderControlBar();
        this.loadCategoriesStore();
        await this.syncDataStore();
        this.setupCoreListeners();
        SidePanel.init(AppState);
        SidePanel.setupStatusClickHandlers();
        ClockStyle.init();
        this.setupFreeformResetButton();
        this.updateFreeformResetVisibility();
        this.setupBackupInterface();
        this.setupFab();
        this.setupUndo();
    }

    setupUndo() {
        const undoBtn = document.getElementById('btn-undo');
        const redoBtn = document.getElementById('btn-redo');
        if (undoBtn) undoBtn.innerHTML = ACTION_ICONS.undo;
        if (redoBtn) redoBtn.innerHTML = ACTION_ICONS.redo;

        UndoManager.init({
            getToken: () => AppState.user.token,
            isEnabled: () => AppState.user.isLoggedIn,
            onRestore: (item, { preserveView = false } = {}) => this.restoreItem(item, preserveView),
            onRemove: (itemId) => this.removeItemFromWorkspace(itemId)
        });
    }

    async removeItemFromWorkspace(itemId) {
        AppState.items = AppState.items.filter((i) => i.id !== itemId);
        if (Editor.activeItem?.id === itemId) Editor.close();
        await this.syncDataStore();
    }

    async restoreItem(item, preserveView = false) {
        const idx = AppState.items.findIndex((i) => i.id === item.id);
        if (idx >= 0) AppState.items[idx] = item;
        else AppState.items.push(item);

        if (Editor.activeItem?.id === item.id && !Editor.overlay?.classList.contains('is-hidden')) {
            Editor.activeItem = JSON.parse(JSON.stringify(item));
            Editor.renderForm();
            Editor.updateEditorSizeLabel();
        }

        if (preserveView) {
            const canvas = document.getElementById('app-canvas');
            UI.updateSingleCard(canvas, item, AppState.hiddenCategories);
            if (AppState.viewSettings.sortBy === 'freeform') {
                DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
            }
            this.updateWorkspaceCounter();
            return;
        }
        await this.syncDataStore();
    }

    checkAuthSession() {
        const cachedToken = localStorage.getItem('admin_token');
        if (cachedToken) {
            AppState.user.isLoggedIn = true;
            AppState.user.token = cachedToken;
        } else {
            AppState.user.isLoggedIn = false;
            AppState.user.token = null;
        }
    }

    loadCategoriesStore() {
        const storedCats = localStorage.getItem('matrix_custom_categories');
        if (storedCats) {
            try {
                const parsed = normalizeCategories(JSON.parse(storedCats), { keepEmpty: true });
                if (parsed.length) AppState.categories = parsed;
            } catch {
                /* ignore */
            }
        }

        if (!AppState.categories?.length) {
            const db = API._getLocalDB();
            AppState.categories = normalizeCategories(db.settings?.categories || []);
            localStorage.setItem('matrix_custom_categories', JSON.stringify(AppState.categories));
        }
    }

    async syncDataStore() {
        const canvas = document.getElementById('app-canvas');
        try {
            const data = await API.fetchItems(AppState.user.token);
            AppState.items = Array.isArray(data?.items) ? data.items : [];

            if (AppState.items.length === 0 && !data?.write_access && (data?.total_items || 0) > 0) {
                canvas.innerHTML = `<div class="system-status-msg">Notes are in local storage but require admin login. Use Quick actions → Login (default dev token: dev-admin-secret-2026).</div>`;
            } else {
                UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
            }

            DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
        } catch (err) {
            console.error('[Fatal Sync Failure] Data sync broken:', err);
            if (canvas) {
                canvas.innerHTML = `<div class="system-status-msg">Failed to load workspace data. Try importing a backup or clearing site storage.</div>`;
            }
        } finally {
            this.updateWorkspaceCounter();
        }
    }

    updateWorkspaceCounter() {
        SidePanel.updateCategories(AppState.categories, AppState.hiddenCategories);
        SidePanel.updateNotesList(AppState.items);
    }

    renderControlBar() {
        const filterControls = document.getElementById('filter-controls');
        const mode = AppState.viewSettings.sortBy;
        if (filterControls) {
            filterControls.innerHTML = `
                <button class="btn btn--compact btn--icon ${mode === 'columns' ? 'active' : ''}" id="btn-view-cols" title="Columns view" aria-label="Columns view">${ACTION_ICONS.viewCols}</button>
                <button class="btn btn--compact btn--icon ${mode === 'freeform' ? 'active' : ''}" id="btn-view-free" title="Freeform view" aria-label="Freeform view">${ACTION_ICONS.viewFree}</button>
            `;
            document.getElementById('btn-view-cols').addEventListener('click', () => this.switchViewMode('columns'));
            document.getElementById('btn-view-free').addEventListener('click', () => this.switchViewMode('freeform'));
            this.updateViewToggleState();
        }

        this.renderQuickActions();
        this.updateFabVisibility();
        this.updateFreeformResetVisibility();
        UndoManager.updateToolbar();
    }

    renderQuickActions() {
        const zone = document.getElementById('quick-actions-zone');
        if (!zone) return;

        if (!AppState.user.isLoggedIn) {
            zone.innerHTML = `<button type="button" class="btn btn--compact btn--block" id="btn-auth-login">Login</button>`;
            document.getElementById('btn-auth-login')?.addEventListener('click', () => this.executeLoginPrompt());
            return;
        }

        zone.innerHTML = `
            <button type="button" class="btn btn--compact btn--icon" id="btn-add-category" title="Add category" aria-label="Add category">${ACTION_ICONS.category}</button>
            <button type="button" class="btn btn--compact btn--icon" id="btn-export-db" title="Export backup" aria-label="Export backup">${ACTION_ICONS.export}</button>
            <button type="button" class="btn btn--compact btn--icon" id="btn-import-db" title="Import backup" aria-label="Import backup">${ACTION_ICONS.import}</button>
            <button type="button" class="btn btn--compact btn--icon btn--icon-danger" id="btn-auth-logout" title="Logout" aria-label="Logout">${ACTION_ICONS.logout}</button>
        `;
        document.getElementById('btn-add-category').addEventListener('click', () => this.executeAddCategoryPrompt());
        document.getElementById('btn-export-db').addEventListener('click', () => this.executeDataBackupExport());
        document.getElementById('btn-import-db').addEventListener('click', () => document.getElementById('system-import-file-picker').click());
        document.getElementById('btn-auth-logout').addEventListener('click', () => this.executeLogout());
    }

    setupFab() {
        const fab = document.getElementById('fab-create');
        if (!fab) return;
        fab.addEventListener('click', () => {
            if (!AppState.user.isLoggedIn) {
                this.executeLoginPrompt();
                return;
            }
            Editor.open(null, AppState.categories);
        });
    }

    updateFabVisibility() {
        const fab = document.getElementById('fab-create');
        fab?.classList.toggle('is-hidden', !AppState.user.isLoggedIn);
    }

    executeDataBackupExport() {
        const databasePayload = localStorage.getItem('matrix_database');
        const customCategoriesPayload = localStorage.getItem('matrix_custom_categories');
        const backupPackage = {
            timestamp: Math.floor(Date.now() / 1000),
            matrix_database: databasePayload ? JSON.parse(databasePayload) : null,
            matrix_custom_categories: customCategoriesPayload ? JSON.parse(customCategoriesPayload) : null
        };
        const blob = new Blob([JSON.stringify(backupPackage, null, 2)], { type: 'application/json' });
        const virtualLink = document.createElement('a');
        virtualLink.href = URL.createObjectURL(blob);
        virtualLink.download = `matrix_workspace_backup_${Math.floor(Date.now()/1000)}.json`;
        virtualLink.click();
        URL.revokeObjectURL(virtualLink.href);
    }

    setupBackupInterface() {
        const filePicker = document.getElementById('system-import-file-picker');
        if (!filePicker) return;
        filePicker.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const parsedBackup = JSON.parse(event.target.result);
                    if (!parsedBackup.matrix_database && !parsedBackup.matrix_custom_categories) {
                        alert('Import Aborted: Not a Magic Lists backup file (missing matrix_database).');
                        return;
                    }
                    applyBackupToStorage(parsedBackup);
                    const itemCount = parsedBackup.matrix_database?.items?.length ?? 0;
                    const token = parsedBackup.matrix_database?.auth?.admin_token;
                    const tokenNote = token
                        ? ' Admin session restored from backup.'
                        : ' Log in with your admin token to see private notes.';
                    alert(`Restore successful (${itemCount} items).${tokenNote}`);
                    window.location.reload();
                } catch (err) {
                    console.error('[Import]', err);
                    alert('Import Aborted: Invalid or unsupported backup file.');
                }
            };
            reader.readAsText(file);
        });
    }

    executeAddCategoryPrompt() {
        if (!AppState.user.isLoggedIn) return;
        const nameInput = prompt("Enter Unique New Category Label Name:");
        if (!nameInput || !nameInput.trim()) return;
        const cleanName = nameInput.trim();
        if (AppState.categories.map(c => c.name.toLowerCase()).includes(cleanName.toLowerCase())) {
            alert("Conflict: That category tag layout already exists.");
            return;
        }
        const addBtn = document.getElementById('btn-add-category');
        if (!addBtn) return;
        ColorPicker.open({
            anchor: addBtn,
            presets: PALETTE_NOTE,
            value: '#64748b',
            align: 'end',
            onSelect: (color) => {
                const cleanColor = color && color.trim() ? color.trim() : '#64748b';
                AppState.categories.push({ name: cleanName, color: cleanColor });
                localStorage.setItem('matrix_custom_categories', JSON.stringify(AppState.categories));
                this.syncDataStore();
            }
        });
    }

    executeLoginPrompt() {
        const secretInput = prompt("Enter Admin Security Token Code:");
        if (secretInput) {
            localStorage.setItem('admin_token', secretInput.trim());
            this.checkAuthSession();
            this.renderControlBar();
            this.syncDataStore();
        }
    }

    executeLogout() {
        localStorage.removeItem('admin_token');
        AppState.user.isLoggedIn = false;
        AppState.user.token = null;
        UndoManager.clear();
        this.renderControlBar();
        this.updateFreeformResetVisibility();
        this.syncDataStore();
    }

    switchViewMode(mode) {
        AppState.viewSettings.sortBy = mode;
        localStorage.setItem('matrix_preferred_view', mode);
        window.dispatchEvent(new CustomEvent('view:mode_changed', { detail: mode }));
        this.updateViewToggleState();
        this.updateFreeformResetVisibility();
        this.syncDataStore();
    }

    updateViewToggleState() {
        const mode = AppState.viewSettings.sortBy;
        document.getElementById('btn-view-cols')?.classList.toggle('active', mode === 'columns');
        document.getElementById('btn-view-free')?.classList.toggle('active', mode === 'freeform');
    }

    setupFreeformResetButton() {
        const btn = document.getElementById('btn-freeform-reset');
        if (btn) btn.innerHTML = ACTION_ICONS.layoutReset;
        btn?.addEventListener('click', () => {
            if (AppState.viewSettings.sortBy !== 'freeform') return;
            UI.resetFreeformLayout();
            this.syncDataStore();
        });
    }

    updateFreeformResetVisibility() {
        const btn = document.getElementById('btn-freeform-reset');
        if (!btn) return;
        const show = AppState.viewSettings.sortBy === 'freeform' && AppState.user.isLoggedIn;
        btn.classList.toggle('is-hidden', !show);
    }

    setupCoreListeners() {
        window.addEventListener('item:selected_for_edit', (e) => {
            if (!AppState.user.isLoggedIn) {
                alert("Authorization Blocked: Admin privileges required to edit workspace resources.");
                return;
            }
            Editor.open(e.detail, AppState.categories);
        });

        window.addEventListener('item:mutation_requested', async (e) => {
            if (!AppState.user.isLoggedIn) return;
            const detail = e.detail;
            const item = detail?.item ?? detail;
            const preserveView = detail?.preserveView === true;
            if (!item?.id) return;

            const idx = AppState.items.findIndex((i) => i.id === item.id);
            const beforeSnapshot = detail?.beforeItem
                ? JSON.parse(JSON.stringify(detail.beforeItem))
                : idx >= 0
                    ? JSON.parse(JSON.stringify(AppState.items[idx]))
                    : null;

            const success = await API.saveItem(item, AppState.user.token);
            if (!success) return;

            if (beforeSnapshot) {
                UndoManager.recordItemChange(beforeSnapshot, item, {
                    preserveView,
                    label: historyLabelForItem(item)
                });
            }

            if (idx !== -1) AppState.items[idx] = item;
            else AppState.items.push(item);

            if (preserveView) {
                if (!detail?.skipRerender) {
                    const canvas = document.getElementById('app-canvas');
                    UI.updateSingleCard(canvas, item, AppState.hiddenCategories);
                    if (AppState.viewSettings.sortBy === 'freeform') {
                        DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
                    }
                }
                this.updateWorkspaceCounter();
                return;
            }
            await this.syncDataStore();
        });

        window.addEventListener('board:visibility_changed', async () => {
            UI.render(document.getElementById('app-canvas'), AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
            this.updateWorkspaceCounter();
            DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
        });

        window.addEventListener('calendar:items_changed', (e) => {
            const sourceItem = Editor.activeItem || e.detail;
            if (sourceItem?.id) {
                const idx = AppState.items.findIndex(i => i.id === sourceItem.id);
                if (idx !== -1) {
                    AppState.items[idx] = {
                        ...AppState.items[idx],
                        hideFromCalendar: sourceItem.hideFromCalendar === true
                    };
                }
            }
            if (Calendar.isActive()) {
                Calendar.items = AppState.items;
                Calendar.refresh();
            }
        });

        window.addEventListener('calendar:add_note', (e) => {
            const defaultDate = e.detail;
            const newItem = {
                id: `item_${Math.floor(Date.now() / 1000)}`,
                owner_id: "admin",
                visibility: "private",
                type: "note",
                title: "",
                content: "",
                status: "active",
                categories: [],
                backgroundColor: randomNoteColor(),
                startDateTime: defaultDate.toISOString(),
                endDateTime: "",
                isRecurring: false,
                hideFromCalendar: false,
                hiddenFromBoard: false
            };
            Editor.open(newItem, AppState.categories);
        });

        window.addEventListener('category:show_requested', (e) => {
            const catName = e.detail?.name;
            if (catName) {
                AppState.hiddenCategories = AppState.hiddenCategories.filter(c => c !== catName);
                localStorage.setItem('matrix_hidden_categories', JSON.stringify(AppState.hiddenCategories));
                window.dispatchEvent(new CustomEvent('categories:toggled'));
                this.syncDataStore();
            }
        });

        window.addEventListener('category:order_changed', (e) => {
            AppState.categories = e.detail || AppState.categories;
            this.syncDataStore();
        });
    }
}

const CoreApp = new Application();
document.addEventListener('DOMContentLoaded', () => CoreApp.init());

