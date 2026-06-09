import { API } from './api.js';
import { UI, ACTION_ICONS, createNoteId } from './ui.js';
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
import { FocusMode } from './focusMode.js';
import { DisplayOptions } from './displayOptions.js';
import { AppTheme } from './appTheme.js';
import { DesktopZoom } from './desktopZoom.js';
import { NoteFontScale } from './noteFontScale.js';
import { exportAppCode } from './codeExport.js';
import { readViewSessions, restoreViewSession } from './viewSession.js';
import { SearchBar } from './searchBar.js';

function countHiddenFromBoard(items) {
    return items.filter(item => UI.isHiddenFromBoard(item)).length;
}

const AppState = {
    user: { isLoggedIn: false, token: null },
    items: [],
    categories: [...DEFAULT_CATEGORIES],
    hiddenCategories: JSON.parse(localStorage.getItem('matrix_hidden_categories') || '[]'),
    focusCategories: [],
    expandedCards: {},
    viewSettings: {
        sortBy: (() => {
            const preferred = localStorage.getItem('matrix_preferred_view') || 'columns';
            if (preferred === 'list') {
                localStorage.setItem('matrix_preferred_view', 'columns');
                return 'columns';
            }
            if (preferred === 'grid' && !window.matchMedia('(min-width: 769px)').matches) {
                return 'columns';
            }
            if (preferred === 'freeform' || preferred === 'grid') return preferred;
            return 'columns';
        })(),
        currentView: 'active'
    }
};

class Application {
    async init() {
        DesktopBackground.init();
        ChromeBackground.init();
        NoteFontScale.init();
        DisplayOptions.init({
            getLoggedIn: () => AppState.user.isLoggedIn
        });
        AppTheme.init();
        readViewSessions();
        restoreViewSession(AppState.viewSettings.sortBy);
        AppState.expandedCards = UI.readExpandedCardsForMode(AppState.viewSettings.sortBy);
        this.checkAuthSession();
        Editor.init();
        await ToolsManager.init(() => AppState.items, () => AppState.focusCategories);
        Calendar.init();
        this.renderControlBar();
        this.loadCategoriesStore();
        await this.syncDataStore();
        this.setupCoreListeners();
        SidePanel.init(AppState);
        SidePanel.setupStatusClickHandlers();
        ClockStyle.init();
        DesktopZoom.init();
        this.setupLayoutResetButton();
        this.setupCollapseAllButton();
        this.setupDisplayOptionsButton();
        this.setupAppThemeButton();
        this.setupFocusModeButton();
        this.setupSearchBar();
        this.setupSaveViewButton();
        this.setupRecallViewButton();
        this.updateLayoutResetVisibility();
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
            onRemove: (itemId) => this.removeItemFromWorkspace(itemId),
            onStackChange: () => SidePanel.renderHistoryPanel()
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
            UI.updateSingleCard(canvas, item, AppState.hiddenCategories, AppState.focusCategories);
            if (['freeform', 'grid', 'columns'].includes(AppState.viewSettings.sortBy)) {
                DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
            }
            this.updateWorkspaceCounter();
            return;
        }
        await this.syncDataStore();
    }

    checkAuthSession() {
        const cachedToken = localStorage.getItem('admin_token')?.trim() || '';
        const validToken = API._getLocalDB().auth?.admin_token || '';
        if (cachedToken && cachedToken === validToken) {
            AppState.user.isLoggedIn = true;
            AppState.user.token = cachedToken;
            return;
        }
        if (cachedToken) localStorage.removeItem('admin_token');
        AppState.user.isLoggedIn = false;
        AppState.user.token = null;
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
                UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories, AppState.focusCategories);
                UI.syncCollapseAllButton();
            }

            DesktopZoom.apply();
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
        SidePanel.updateCategories(AppState.categories, AppState.hiddenCategories, AppState.items);
        SidePanel.updateNotesList(AppState.items);
        SidePanel.updateStorageFooter();
    }

    renderControlBar() {
        const filterControls = document.getElementById('filter-controls');
        const mode = AppState.viewSettings.sortBy;
        const showGrid = DesktopZoom.isDesktopViewport();
        if (filterControls) {
            const gridBtn = showGrid
                ? `<button class="btn btn--compact btn--icon ${mode === 'grid' ? 'active' : ''}" id="btn-view-grid" title="Grid board" aria-label="Grid board">${ACTION_ICONS.viewGrid}</button>`
                : '';
            filterControls.innerHTML = `
                <button class="btn btn--compact btn--icon ${mode === 'columns' ? 'active' : ''}" id="btn-view-cols" title="Columns view" aria-label="Columns view">${ACTION_ICONS.viewCols}</button>
                <button class="btn btn--compact btn--icon ${mode === 'freeform' ? 'active' : ''}" id="btn-view-free" title="Freeform view" aria-label="Freeform view">${ACTION_ICONS.viewFree}</button>
                ${gridBtn}
            `;
            document.getElementById('btn-view-cols').addEventListener('click', () => this.switchViewMode('columns'));
            document.getElementById('btn-view-free').addEventListener('click', () => this.switchViewMode('freeform'));
            document.getElementById('btn-view-grid')?.addEventListener('click', () => this.switchViewMode('grid'));
            this.updateViewToggleState();
        }

        this.renderQuickActions();
        this.updateFabVisibility();
        this.updateLayoutResetVisibility();
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
            <button type="button" class="btn btn--compact btn--icon" id="btn-export-code" title="Export app code" aria-label="Export app code">${ACTION_ICONS.exportCode}</button>
            <button type="button" class="btn btn--compact btn--icon" id="btn-import-db" title="Import backup" aria-label="Import backup">${ACTION_ICONS.import}</button>
            <button type="button" class="btn btn--compact btn--icon btn--icon-danger" id="btn-auth-logout" title="Logout" aria-label="Logout">${ACTION_ICONS.logout}</button>
        `;
        document.getElementById('btn-add-category').addEventListener('click', () => this.executeAddCategoryPrompt());
        document.getElementById('btn-export-db').addEventListener('click', () => this.executeDataBackupExport());
        document.getElementById('btn-export-code').addEventListener('click', () => this.executeCodeExport());
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
        if (!fab) return;
        fab.classList.remove('is-hidden');
        const needsLogin = !AppState.user.isLoggedIn;
        fab.title = needsLogin ? 'New note (login required)' : 'New note';
        fab.setAttribute('aria-label', fab.title);
    }

    async executeCodeExport() {
        if (!AppState.user.isLoggedIn) return;
        const btn = document.getElementById('btn-export-code');
        if (btn) btn.disabled = true;
        try {
            await exportAppCode(AppState.user.token);
        } catch (err) {
            console.error('[Code export]', err);
            alert(err?.message || 'Could not export app code.');
        } finally {
            if (btn) btn.disabled = false;
        }
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
                UI.appendToCanvasOrder({ type: 'category', name: cleanName });
                this.syncDataStore();
            }
        });
    }

    executeLoginPrompt() {
        const secretInput = prompt("Enter Admin Security Token Code:");
        if (secretInput) {
            localStorage.setItem('admin_token', secretInput.trim());
            this.checkAuthSession();
            UndoManager.loadStacks();
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
        this.updateLayoutResetVisibility();
        this.syncDataStore();
    }

    async switchViewMode(mode) {
        if (mode === 'grid' && !DesktopZoom.isDesktopViewport()) return;
        const prevMode = AppState.viewSettings.sortBy;
        if (prevMode === mode) return;

        const canvas = document.getElementById('app-canvas');
        UI.persistViewSessionForMode(prevMode, canvas);

        AppState.viewSettings.sortBy = mode;
        localStorage.setItem('matrix_preferred_view', mode);
        const scrollState = UI.restoreViewSessionForMode(mode);
        AppState.expandedCards = UI.readExpandedCardsForMode(mode);

        window.dispatchEvent(new CustomEvent('view:mode_changed', { detail: mode }));
        this.updateViewToggleState();
        this.updateLayoutResetVisibility();
        await this.syncDataStore();

        if (scrollState) {
            requestAnimationFrame(() => {
                UI.restoreScrollState(document.getElementById('app-canvas'), scrollState);
            });
        }
    }

    updateViewToggleState() {
        const mode = AppState.viewSettings.sortBy;
        document.getElementById('btn-view-cols')?.classList.toggle('active', mode === 'columns');
        document.getElementById('btn-view-free')?.classList.toggle('active', mode === 'freeform');
        document.getElementById('btn-view-grid')?.classList.toggle('active', mode === 'grid');
        this.updateDesktopZoomVisibility();
    }

    updateDesktopZoomVisibility() {
        const show = AppState.user.isLoggedIn && DesktopZoom.isDesktopViewport();
        DesktopZoom.apply({ enabled: show });
    }

    setupLayoutResetButton() {
        const btn = document.getElementById('btn-layout-reset');
        if (btn) btn.innerHTML = ACTION_ICONS.layoutReset;
        btn?.addEventListener('click', () => {
            const mode = AppState.viewSettings.sortBy;
            if (mode === 'freeform') {
                UI.resetFreeformLayout();
            } else if (mode === 'grid') {
                UI.resetGridLayout();
            } else {
                UI.resetColumnsLayout();
            }
        });
    }

    setupCollapseAllButton() {
        const btn = document.getElementById('btn-collapse-all');
        if (!btn) return;
        btn.addEventListener('click', () => {
            UI.toggleCollapseAllCards();
        });
    }

    setupDisplayOptionsButton() {
        const btn = document.getElementById('btn-display-options');
        if (btn) btn.innerHTML = ACTION_ICONS.displayOptions;
    }

    setupAppThemeButton() {
        const btn = document.getElementById('btn-app-theme');
        if (btn) btn.innerHTML = ACTION_ICONS.appTheme;
    }

    setupFocusModeButton() {
        const btn = document.getElementById('btn-focus-mode');
        if (btn) btn.innerHTML = ACTION_ICONS.focusMode;
        FocusMode.init({
            getState: () => AppState.focusCategories,
            setState: (next) => {
                AppState.focusCategories = Array.isArray(next) ? next : [];
            },
            getHiddenCategories: () => AppState.hiddenCategories,
            onChange: () => this.onFocusChange()
        });
    }

    onFocusChange() {
        const canvas = document.getElementById('app-canvas');
        if (canvas) {
            UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories, AppState.focusCategories);
            DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
        }
        if (Calendar.isActive()) {
            Calendar.items = AppState.items;
            Calendar.refresh(AppState.focusCategories);
        }
        FocusMode.syncButtonState();
        window.dispatchEvent(new CustomEvent('board:focus_changed', {
            detail: [...AppState.focusCategories]
        }));
    }

    setupSearchBar() {
        SearchBar.init({
            getItems: () => AppState.items,
            getCategories: () => AppState.categories,
            onOpenItem: (item) => {
                window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: item }));
            },
            onFocusCategory: (name) => {
                AppState.focusCategories = [name];
                this.onFocusChange();
            }
        });
    }

    setupViewSlotPopover(btn, { ariaLabel, emptyLabel, onPick, requireSnapshot = false }) {
        if (!btn) return;
        let popover = null;
        let outsideHandler = null;
        let keyHandler = null;

        const close = () => {
            if (!popover) return;
            popover.classList.add('is-hidden');
            btn.setAttribute('aria-expanded', 'false');
            if (outsideHandler) {
                document.removeEventListener('mousedown', outsideHandler, true);
                outsideHandler = null;
            }
            if (keyHandler) {
                document.removeEventListener('keydown', keyHandler);
                keyHandler = null;
            }
        };

        const position = () => {
            if (!popover) return;
            const rect = btn.getBoundingClientRect();
            const gap = 8;
            const margin = 8;
            const popRect = popover.getBoundingClientRect();
            let top = rect.bottom + gap;
            let left = rect.right - popRect.width;
            left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));
            if (top + popRect.height > window.innerHeight - margin) {
                top = rect.top - popRect.height - gap;
            }
            top = Math.max(margin, top);
            popover.style.top = `${top}px`;
            popover.style.left = `${left}px`;
        };

        const open = () => {
            close();
            if (!popover) {
                popover = document.createElement('div');
                popover.className = 'view-slot-popover clock-style-popover is-hidden';
                popover.setAttribute('role', 'menu');
                popover.setAttribute('aria-label', ariaLabel);
                document.body.appendChild(popover);
            }

            const store = UI.getSavedViewsStore();
            popover.innerHTML = `<div class="view-slot-list">${store.slots.map((slot, idx) => {
                const snap = slot?.snapshot;
                const when = snap?.savedAt
                    ? new Date(snap.savedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
                    : emptyLabel;
                const mode = snap?.viewMode === 'freeform'
                    ? 'Freeform'
                    : snap?.viewMode === 'grid'
                        ? 'Grid'
                        : 'Columns';
                const focus = snap?.focusCategories?.length
                    ? ` · Focus: ${snap.focusCategories.join(', ')}`
                    : '';
                const disabled = requireSnapshot && !snap;
                return `<button type="button" class="view-slot-option${snap ? '' : ' is-empty'}" data-slot="${idx}" role="menuitem"${disabled ? ' disabled' : ''}>
                    <span class="view-slot-label">${slot.label || `View ${idx + 1}`}</span>
                    <span class="view-slot-meta">${snap ? `${mode} · ${when}${focus}` : when}</span>
                </button>`;
            }).join('')}</div>`;

            popover.querySelectorAll('.view-slot-option:not([disabled])').forEach((option) => {
                option.addEventListener('mousedown', (e) => e.stopPropagation());
                option.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const slot = Number(option.dataset.slot);
                    close();
                    await onPick(slot, option);
                });
            });

            popover.classList.remove('is-hidden');
            btn.setAttribute('aria-expanded', 'true');
            position();

            outsideHandler = (e) => {
                if (popover.contains(e.target) || btn.contains(e.target)) return;
                close();
            };
            keyHandler = (e) => {
                if (e.key === 'Escape') close();
            };
            requestAnimationFrame(() => {
                document.addEventListener('mousedown', outsideHandler, true);
                document.addEventListener('keydown', keyHandler);
            });
        };

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (popover && !popover.classList.contains('is-hidden')) close();
            else open();
        });
    }

    setupSaveViewButton() {
        const btn = document.getElementById('btn-save-view');
        if (!btn) return;
        btn.innerHTML = ACTION_ICONS.saveView;
        btn.title = 'Save view';
        btn.setAttribute('aria-label', 'Save view');
        btn.setAttribute('aria-haspopup', 'menu');

        this.setupViewSlotPopover(btn, {
            ariaLabel: 'Save view slot',
            emptyLabel: 'Empty — click to save',
            onPick: async (slot) => {
                const mode = AppState.viewSettings.sortBy;
                UI.saveViewSnapshotToSlot(slot, mode, AppState.focusCategories);
                this.updateRecallViewButtonState();
                btn.classList.add('is-saved');
                setTimeout(() => btn.classList.remove('is-saved'), 1600);
            }
        });
    }

    setupRecallViewButton() {
        const btn = document.getElementById('btn-recall-view');
        if (!btn) return;
        btn.innerHTML = ACTION_ICONS.recallView;
        btn.setAttribute('aria-haspopup', 'menu');
        this.updateRecallViewButtonState();

        this.setupViewSlotPopover(btn, {
            ariaLabel: 'Restore saved view',
            emptyLabel: 'Empty',
            requireSnapshot: true,
            onPick: async (slot) => {
                const ok = await this.restoreSavedView(slot);
                if (!ok) {
                    this.updateRecallViewButtonState();
                    return;
                }
                btn.classList.add('is-recalled');
                setTimeout(() => {
                    btn.classList.remove('is-recalled');
                    this.updateRecallViewButtonState();
                }, 1600);
            }
        });
    }

    updateRecallViewButtonState() {
        const btn = document.getElementById('btn-recall-view');
        if (!btn) return;
        const hasAny = UI.hasAnySavedViewSlot();
        btn.disabled = !hasAny;
        const defaultTitle = 'Restore saved view';
        btn.title = hasAny ? defaultTitle : 'No saved views';
        btn.setAttribute('aria-label', btn.title);
    }

    async restoreSavedView(slotIndex = 0) {
        const snapshot = UI.restoreSavedViewSnapshot(slotIndex);
        if (!snapshot) return false;

        AppState.focusCategories = Array.isArray(snapshot.focusCategories)
            ? [...snapshot.focusCategories]
            : [];
        FocusMode.syncButtonState();

        let mode = snapshot.viewMode === 'freeform'
            ? 'freeform'
            : snapshot.viewMode === 'grid'
                ? 'grid'
                : 'columns';
        if (mode === 'grid' && !DesktopZoom.isDesktopViewport()) mode = 'columns';
        if (AppState.viewSettings.sortBy !== mode) {
            AppState.viewSettings.sortBy = mode;
            localStorage.setItem('matrix_preferred_view', mode);
            window.dispatchEvent(new CustomEvent('view:mode_changed', { detail: mode }));
            this.updateViewToggleState();
            this.updateLayoutResetVisibility();
        }

        UI.restoreViewSessionForMode(mode);
        AppState.expandedCards = UI.readExpandedCardsForMode(mode);

        await this.syncDataStore();

        if (Calendar.isActive()) {
            Calendar.items = AppState.items;
            Calendar.refresh(AppState.focusCategories);
        }

        requestAnimationFrame(() => {
            const canvas = document.getElementById('app-canvas');
            if (canvas && snapshot.scroll) {
                UI.restoreScrollState(canvas, snapshot.scroll);
            }
        });

        return true;
    }

    updateLayoutResetVisibility() {
        const show = AppState.user.isLoggedIn;
        document.getElementById('btn-layout-reset')?.classList.toggle('is-hidden', !show);
        document.getElementById('btn-collapse-all')?.classList.toggle('is-hidden', !show);
        if (show) UI.syncCollapseAllButton();
        this.updateDesktopZoomVisibility();
    }

    squeezeGridIfActive() {
        const canvas = document.getElementById('app-canvas');
        if (!canvas?.classList.contains('view-grid')) return;
        UI.squeezeGridBoardToViewport(canvas, { animate: true });
    }

    setupCoreListeners() {
        let gridSqueezeTimer = null;
        window.addEventListener('resize', () => {
            this.updateDesktopZoomVisibility();
            clearTimeout(gridSqueezeTimer);
            gridSqueezeTimer = setTimeout(() => this.squeezeGridIfActive(), 120);
        });
        window.addEventListener('desktop:zoom_changed', () => {
            this.squeezeGridIfActive();
        });

        window.addEventListener('item:selected_for_edit', (e) => {
            if (!AppState.user.isLoggedIn) {
                alert("Authorization Blocked: Admin privileges required to edit workspace resources.");
                return;
            }
            const detail = e.detail;
            const item = detail?.item ?? detail;
            const sourceCard = detail?.sourceCard ?? null;
            Editor.open(item, AppState.categories, { sourceCard });
        });

        window.addEventListener('editor:reveal_on_board', async (e) => {
            const item = e.detail;
            if (!item?.id) return;
            UI.markNoteExpanded(item.id);
            const idx = AppState.items.findIndex((i) => i.id === item.id);
            if (idx >= 0) AppState.items[idx] = item;
            else AppState.items.push(item);

            await this.syncDataStore();
            requestAnimationFrame(() => {
                const card = document.getElementById('app-canvas')?.querySelector(`.mini-card[data-id="${item.id}"]`);
                card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
        });

        window.addEventListener('item:mutation_requested', async (e) => {
            if (!AppState.user.isLoggedIn) {
                alert('Login required to save notes. Use Quick actions → Login.');
                return;
            }
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
            if (!success) {
                alert('Could not save note. Log in with the correct admin token (default dev: dev-admin-secret-2026).');
                return;
            }

            if (beforeSnapshot) {
                UndoManager.recordItemChange(beforeSnapshot, item, {
                    preserveView,
                    label: historyLabelForItem(item),
                    mergeKey: detail?.mergeKey,
                    mergeWindow: detail?.mergeWindow !== false
                });
            }

            if (idx !== -1) AppState.items[idx] = item;
            else AppState.items.push(item);

            if (preserveView) {
                if (!detail?.skipRerender) {
                    const canvas = document.getElementById('app-canvas');
                    UI.updateSingleCard(canvas, item, AppState.hiddenCategories, AppState.focusCategories);
                    if (['freeform', 'grid', 'columns'].includes(AppState.viewSettings.sortBy)) {
                        DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
                    }
                }
                this.updateWorkspaceCounter();
                return;
            }
            await this.syncDataStore();
        });

        window.addEventListener('board:visibility_changed', async () => {
            UI.render(document.getElementById('app-canvas'), AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories, AppState.focusCategories);
            UI.syncCollapseAllButton();
            this.updateWorkspaceCounter();
            DragDropEngine.init(AppState.user, AppState.items, () => this.syncDataStore());
        });

        window.addEventListener('board:cards_reflowed', () => {
            const canvas = document.getElementById('app-canvas');
            if (canvas?.classList.contains('view-columns')) {
                UI.layoutColumnView(canvas, { animate: true });
            }
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
                Calendar.refresh(AppState.focusCategories);
            }
        });

        window.addEventListener('calendar:add_note', (e) => {
            const defaultDate = e.detail;
            const newItem = {
                id: createNoteId(),
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
                hiddenFromBoard: false,
                steps: [],
                editorBodyLayout: 'content'
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

