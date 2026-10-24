/** @module {"owns":"the Application service calls - auth session checks, the repair log, the category store load/alias/sync pipeline, the workspace counter, the backup and export commands with the backup panel that exposes them, and the category/login commands","related":["../app.js","state.js","listeners.js","backup.js"],"events":["category:renamed","category:hide_requested"]} */
import { API } from '../api.js';
import {
    applyBackupToStorage,
    backupFilename,
    buildBackupPackage,
    buildFullBackupArchivePayload,
    importFullBackupArchive,
    parseBackupPackage,
    serializeBackupPackage,
    txtExportFilename,
    writeLastLocalExportAt,
    writeLastLocalTxtExportAt,
    writeLastMediaZipExportAt
} from '../backup.js';
import {
    UNCATEGORIZED_COLOR,
    addCategoryToRegistry,
    applyCategoryAliasesToItems,
    getLastCategoryWriteAliases,
    normalizeCategories,
    validateNewCategoryName,
    writeStoredCategories
} from '../categories.js';
import { CategoriesOverlay } from '../categoriesOverlay.js';
import { DesktopManager } from '../desktopManager.js';
import { DesktopZoom } from '../desktopZoom.js';
import { DragDropEngine } from '../dragdrop.js';
import { seedCategoryAsFiled } from '../fileCabinet.js';
import { SidePanel } from '../hamburger.js';
import { LoadingManager } from '../loadingUtils.js';
import { itemToTxtExportText, sortItemsForTxtExport } from '../noteBodyConversion.js';
import { NoteSurface } from '../noteSurface.js';
import { SidebarHistory } from '../sidebarHistory.js';
import { SidebarStats } from '../sidebarStats.js';
import { showAppToast } from '../toast.js';
import { UI } from '../ui.js';
import { UndoManager } from '../undo.js';
import { AppState } from './state.js';

export function checkAuthSession(app) {
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

// Diagnostics from the latest repairDatabase() run (normal load or save).
// Logged in the console for observability — no toast, no permanent UI.
export function logRepairDiagnostics(app) {
    try {
        const diagnostics = API.getLastRepairDiagnostics();
        if (!diagnostics) return;
        if (diagnostics.schemaUpgraded
            || diagnostics.stepIdsMigrated > 0
            || diagnostics.duplicateCategoriesDetected.length > 0
            || diagnostics.warnings.length > 0) {
            console.info('[repairDatabase]', diagnostics);
        }
    } catch {
        /* diagnostics are best-effort */
    }
}

export function loadCategoriesStore(app) {
    const storedCats = localStorage.getItem('matrix_custom_categories');
    if (storedCats) {
        try {
            const parsed = normalizeCategories(JSON.parse(storedCats), { keepEmpty: true });
            if (parsed.length) {
                AppState.categories = writeStoredCategories(parsed, { keepEmpty: true });
                app._pendingCategoryAliases = getLastCategoryWriteAliases();
                return;
            }
        } catch {
            /* ignore */
        }
    }

    if (!AppState.categories?.length) {
        const db = API._getLocalDB();
        AppState.categories = writeStoredCategories(normalizeCategories(db.settings?.categories || []));
        app._pendingCategoryAliases = getLastCategoryWriteAliases();
    }
}

export function applyPendingCategoryAliases(app) {
    const aliases = app._pendingCategoryAliases;
    app._pendingCategoryAliases = null;
    if (!aliases || !Object.keys(aliases).length) return;
    (AppState.items || []).forEach((item) => {
        if (!item?.categories?.length) return;
        const beforeItem = NoteSurface.snapshotItem(item);
        const changed = applyCategoryAliasesToItems([item], aliases);
        if (!changed) return;
        NoteSurface.emitItemMutation(item, {
            preserveView: true,
            beforeItem,
            skipRerender: true,
            skipUndo: true
        });
    });
}

export async function syncDataStore(app) {
    // Show loading indicator on app-canvas during sync
    const canvas = document.getElementById('app-canvas');
    if (canvas) {
        LoadingManager.show(canvas, 'Syncing data...');
    }
    
    const task = app._syncQueue.then(() => app._syncDataStoreInner());
    app._syncQueue = task.catch(() => {});
    task.finally(() => {
        if (canvas) {
            LoadingManager.hide(canvas);
        }
    });
    return task;
}

export async function _syncDataStoreInner(app) {
    const canvas = document.getElementById('app-canvas');
    try {
        if (canvas && AppState.workspaceMode !== 'drawing') {
            UI.flushLayoutFromCanvas(canvas, AppState.viewSettings.sortBy);
        }

        // Never re-read items from storage while a mutation save is still in
        // flight: a render rebuilt from stale ancestors (e.g. File Cabinet toggle
        // right after drawing) could otherwise make the freshly drawn note canvas
        // invisible on the board. Wait for pending saves to settle first.
        if (app._pendingItemSaves?.size) {
            await Promise.allSettled([...app._pendingItemSaves]);
        }

        const data = await API.fetchItems(AppState.user.token);
        AppState.items = Array.isArray(data?.items) ? data.items : [];
        AppState.items = DesktopManager.sanitizeNotesDesktops(AppState.items);
        app.applyPendingCategoryAliases();

        if (AppState.workspaceMode === 'drawing') {
            /* board hidden — skip note canvas rebuild */
        } else if (AppState.items.length === 0 && !data?.write_access && (data?.total_items || 0) > 0) {
            canvas.innerHTML = `<div class="system-status-msg">Notes are in local storage but require admin login. Use Quick actions → Login (default dev token: dev-admin-secret-2026).</div>`;
        } else {
            UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
        }

        DesktopZoom.apply();
        if (AppState.workspaceMode !== 'drawing') {
            DragDropEngine.init(AppState.user, AppState.items, () => app.syncDataStore());
        }
    } catch (err) {
        console.error('[Fatal Sync Failure] Data sync broken:', err);
        if (canvas) {
            canvas.innerHTML = `<div class="system-status-msg">Failed to load workspace data. Try importing a backup or clearing site storage.</div>`;
        }
    } finally {
        app.updateWorkspaceCounter();
    }
}

export function updateWorkspaceCounter(app) {
    SidePanel.updateCategories(AppState.categories, AppState.hiddenCategories, AppState.items);
    SidePanel.updateNotesList(AppState.items);
    SidebarStats.update();
}

export async function executeDataBackupExport(app) {
    // Show loading indicator on the export button
    const exportBtn = document.getElementById('btn-export-db');
    if (exportBtn) {
        LoadingManager.show(exportBtn, 'Exporting backup...');
    }
    
    try {
        const backupPackage = await buildBackupPackage();
        const blob = new Blob([serializeBackupPackage(backupPackage)], { type: 'application/json' });
        const virtualLink = document.createElement('a');
        virtualLink.href = URL.createObjectURL(blob);
        virtualLink.download = backupFilename(backupPackage.timestamp);
        virtualLink.click();
        URL.revokeObjectURL(virtualLink.href);
        writeLastLocalExportAt(backupPackage.timestamp);
        SidebarStats.update();
    } finally {
        // Hide loading indicator
        const exportBtn = document.getElementById('btn-export-db');
        if (exportBtn) {
            LoadingManager.hide(exportBtn);
        }
    }
}

export async function executeFullBackupExport(app) {
    const exportBtn = document.getElementById('btn-export-all');
    if (exportBtn) {
        LoadingManager.show(exportBtn, 'Exporting all...');
    }
    try {
        const payload = await buildFullBackupArchivePayload();
        const virtualLink = document.createElement('a');
        virtualLink.href = URL.createObjectURL(payload.blob);
        virtualLink.download = payload.filename;
        virtualLink.click();
        URL.revokeObjectURL(virtualLink.href);
        writeLastLocalExportAt(payload.timestamp);
        writeLastMediaZipExportAt(payload.timestamp);
        SidebarStats.update();
        showAppToast('Exported full backup archive');
    } catch (err) {
        console.error('[Export all]', err);
        showAppToast(err?.message || 'Export all failed');
    } finally {
        const btn = document.getElementById('btn-export-all');
        if (btn) LoadingManager.hide(btn);
    }
}

export function executeExportAllTxt(app) {
    // Show loading indicator on the export button
    const exportBtn = document.getElementById('btn-export-txt');
    if (exportBtn) {
        LoadingManager.show(exportBtn, 'Exporting TXT...');
    }

    try {
        // Get all items (active, archived, hidden)
        const allItems = [...AppState.items];
        
        // Sort items by category (primary) and date (secondary, newest first)
        const sortedItems = sortItemsForTxtExport(allItems);
        
        // Build export content with section dividers
        const sections = [];
        let currentCategory = null;
        
        sortedItems.forEach((item) => {
            const categories = Array.isArray(item?.categories) ? item.categories.filter(Boolean) : [];
            const itemCategory = categories.length > 0 ? categories[0] : 'Uncategorized';
            
            // Add section divider when category changes
            if (itemCategory !== currentCategory) {
                if (currentCategory !== null) {
                    sections.push('\n\n---\n\n');
                }
                currentCategory = itemCategory;
            }
            
            const itemText = itemToTxtExportText(item);
            if (itemText) {
                sections.push(itemText);
            }
        });
        
        const content = sections.join('\n\n');

        // Report export size
        const lineCount = content.split('\n').length;
        showAppToast(`Exported ${lineCount} lines from ${sortedItems.length} notes`);

        const blob = new Blob([content], { type: 'text/plain' });
        const virtualLink = document.createElement('a');
        virtualLink.href = URL.createObjectURL(blob);
        virtualLink.download = txtExportFilename();
        virtualLink.click();
        URL.revokeObjectURL(virtualLink.href);
        writeLastLocalTxtExportAt(Math.floor(Date.now() / 1000));
        SidebarStats.update();
    } finally {
        // Hide loading indicator
        const exportBtn = document.getElementById('btn-export-txt');
        if (exportBtn) {
            LoadingManager.hide(exportBtn);
        }
    }
}

export function setupBackupInterface(app) {
    const filePicker = document.getElementById('system-import-file-picker');
    if (filePicker) {
        filePicker.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            // Show loading indicator on file picker
            LoadingManager.show(filePicker, 'Importing backup...');
            
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const parsedBackup = parseBackupPackage(event.target.result);
                    await applyBackupToStorage(parsedBackup);
                    const storedDb = JSON.parse(localStorage.getItem('matrix_database') || 'null');
                    const itemCount = Array.isArray(storedDb?.items) ? storedDb.items.length : 0;
                    const patchNote = parsedBackup.delta ? ' Applied an incremental patch.' : '';
                    const token = parsedBackup.matrix_database?.auth?.admin_token;
                    const tokenNote = token
                        ? ' Admin session restored from backup.'
                        : ' Log in with your admin token to see private notes.';
                    alert(`Restore successful (${itemCount} items).${tokenNote}${patchNote}`);
                    window.location.reload();
                } catch (err) {
                    console.error('[Import]', err);
                    alert('Import Aborted: Invalid or unsupported backup file.');
                } finally {
                    // Hide loading indicator
                    LoadingManager.hide(filePicker);
                    filePicker.value = '';
                }
            };
            reader.readAsText(file);
        });
    }

    const archivePicker = document.getElementById('system-import-all-picker');
    if (archivePicker) {
        archivePicker.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            LoadingManager.show(archivePicker, 'Importing…');
            try {
                const buffer = await file.arrayBuffer();
                const { readZip } = await import('../mediaBackup.js');
                const zipFiles = await readZip(buffer);

                // Single-note packages: merge/replace one note — never wipe the workspace.
                if (zipFiles.has('note.json')) {
                    const { importNotePackageFromZipMap, parseNotePackageFromZipMap } = await import('../notePackage.js');
                    try {
                        parseNotePackageFromZipMap(zipFiles);
                        LoadingManager.show(archivePicker, 'Importing note…');
                        const result = await importNotePackageFromZipMap(zipFiles);
                        if (result?.status !== 'cancelled') await app.syncDataStore();
                        return;
                    } catch (noteErr) {
                        if (!String(noteErr?.message || '').includes('Not a Magic Lists note package')) {
                            throw noteErr;
                        }
                        // note.json present but not our kind — fall through.
                    }
                }

                const confirmed = confirm('Restore this full backup archive? Your current workspace and media library will be replaced.');
                if (!confirmed) return;

                LoadingManager.show(archivePicker, 'Importing all…');
                const archiveBlob = new Blob([buffer], { type: file.type || 'application/zip' });
                const parsedBackup = await importFullBackupArchive(archiveBlob);
                // Two shapes come back: a checkpoint bundle ({ manifest, applied })
                // and a legacy full archive (a package with matrix_database).
                const isCheckpoint = parsedBackup?.manifest?.kind === 'magicnotes_checkpoint';
                let itemCount = parsedBackup?.matrix_database?.items?.length ?? 0;
                if (isCheckpoint) {
                    // Delta bundles may carry no notes part, so report what the
                    // library holds after the restore instead of the payload.
                    try {
                        itemCount = JSON.parse(localStorage.getItem('matrix_database') || '{}').items?.length ?? 0;
                    } catch {
                        itemCount = 0;
                    }
                }
                alert(isCheckpoint
                    ? `Checkpoint restored (${itemCount} notes). Reloading…`
                    : `Restore successful (${itemCount} items). Reloading…`);
                window.location.reload();
            } catch (err) {
                console.error('[Import all]', err);
                alert(err?.message || 'Import Aborted: Invalid or unsupported archive.');
            } finally {
                LoadingManager.hide(archivePicker);
                archivePicker.value = '';
            }
        });
    }
}

/**
 * Shared add-category flow: persist immediately with a default (or given) color.
 * Optionally opens ColorPicker afterward to refine.
 * @param {{ name?: string, color?: string, anchor?: HTMLElement|null, openPicker?: boolean }} [opts]
 */
export function executeAddCategory(app, opts = {}) {
    let cleanName = String(opts.name || '').trim();
    if (!cleanName) {
        const nameInput = prompt('Enter Unique New Category Label Name:');
        if (!nameInput || !nameInput.trim()) return null;
        cleanName = nameInput.trim();
    }
    const validation = validateNewCategoryName(cleanName, AppState.categories);
    if (!validation.ok) {
        alert(`Conflict: ${validation.error}`);
        return null;
    }
    const color = (opts.color && String(opts.color).trim()) || UNCATEGORIZED_COLOR;
    const next = addCategoryToRegistry(validation.cleanName, color, AppState.categories);
    if (!next) return null;
    AppState.categories = next;
    seedCategoryAsFiled(validation.cleanName);
    window.dispatchEvent(new CustomEvent('categories:toggled'));
    window.dispatchEvent(new CustomEvent('filecabinet:layout_changed', { detail: { flushLayout: false } }));
    app.updateWorkspaceCounter();
    const canvas = document.getElementById('app-canvas');
    if (canvas && AppState.workspaceMode !== 'drawing') {
        UI.render(canvas, AppState.items, AppState.viewSettings.sortBy, AppState.hiddenCategories);
    }
    SidePanel.updateCategories(AppState.categories, AppState.hiddenCategories, AppState.items);
    CategoriesOverlay.afterCategoryAdded(
        validation.cleanName,
        opts.openPicker === false ? null : (opts.anchor || document.getElementById('btn-manage-categories'))
    );
    return validation.cleanName;
}

/** @deprecated use executeAddCategory */
export function executeAddCategoryPrompt(app, anchorEl = null) {
    app.executeAddCategory({ anchor: anchorEl || document.getElementById('btn-manage-categories') });
}

export function executeLoginPrompt(app) {
    // Show loading indicator on the login button
    const loginBtn = document.getElementById('btn-auth-login');
    if (loginBtn) {
        LoadingManager.show(loginBtn, 'Logging in...');
    }
    
    try {
        const secretInput = prompt("Enter Admin Security Token Code:");
        if (secretInput) {
            localStorage.setItem('admin_token', secretInput.trim());
            app.checkAuthSession();
            UndoManager.loadStacks();
            app.renderControlBar();
            SidebarHistory.renderPanel();
            app.syncDataStore();
        }
    } finally {
        // Hide loading indicator
        const loginBtn = document.getElementById('btn-auth-login');
        if (loginBtn) {
            LoadingManager.hide(loginBtn);
        }
    }
}

export function executeLogout(app) {
    // Show loading indicator on the logout button
    const logoutBtn = document.getElementById('btn-auth-logout');
    if (logoutBtn) {
        LoadingManager.show(logoutBtn, 'Logging out...');
    }
    
    try {
        localStorage.removeItem('admin_token');
        AppState.user.isLoggedIn = false;
        AppState.user.token = null;
        UndoManager.clear();
        app.renderControlBar();
        SidebarHistory.renderPanel();
        app.updateLayoutResetVisibility();
        app.syncDataStore();
    } finally {
        // Hide loading indicator
        const logoutBtn = document.getElementById('btn-auth-logout');
        if (logoutBtn) {
            LoadingManager.hide(logoutBtn);
        }
    }
}
