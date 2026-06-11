import { normalizeCategories } from './categories.js';
import { applyLayoutBackupKeys } from './layoutStorage.js';

function migrateImportedStep(step) {
    if (!step || typeof step !== 'object') return step;
    return {
        startDateTime: '',
        endDateTime: '',
        level: 0,
        completed: false,
        text: '',
        ...step,
        level: Number.isFinite(Number(step.level)) ? Number(step.level) : 0,
        completed: step.completed === true
    };
}

export function migrateImportedItem(item) {
    if (!item || typeof item !== 'object') return item;
    const migrated = {
        hiddenFromBoard: false,
        hideFromCalendar: false,
        startDateTime: '',
        endDateTime: '',
        backgroundColor: '',
        isRecurring: false,
        attachments: [],
        ...item,
        hiddenFromBoard: item.hiddenFromBoard === true,
        hideFromCalendar: item.hideFromCalendar === true
    };
    if (Array.isArray(item.steps)) {
        migrated.steps = item.steps.map(migrateImportedStep);
    }
    return migrated;
}

export function migrateImportedDatabase(db, categories = []) {
    if (!db || typeof db !== 'object') return db;
    const names = normalizeCategories(categories, { keepEmpty: true }).map((c) => c.name);
    return {
        ...db,
        auth: {
            admin_token: 'dev-admin-secret-2026',
            ...(db.auth || {})
        },
        settings: {
            ...(db.settings || {}),
            categories: names.length ? names : (db.settings?.categories || [])
        },
        items: Array.isArray(db.items) ? db.items.map(migrateImportedItem) : []
    };
}

export function applyBackupToStorage(parsedBackup) {
    const categories = parsedBackup.matrix_custom_categories
        ? normalizeCategories(parsedBackup.matrix_custom_categories, { keepEmpty: true })
        : [];

    if (categories.length) {
        localStorage.setItem('matrix_custom_categories', JSON.stringify(categories));
    }

    if (parsedBackup.matrix_database) {
        let existingDb = null;
        try {
            const raw = localStorage.getItem('matrix_database');
            existingDb = raw ? JSON.parse(raw) : null;
        } catch {
            /* ignore */
        }

        const db = migrateImportedDatabase(parsedBackup.matrix_database, categories);
        if (!Array.isArray(parsedBackup.matrix_database.items) && Array.isArray(existingDb?.items)) {
            db.items = existingDb.items.map(migrateImportedItem);
        }

        localStorage.setItem('matrix_database', JSON.stringify(db));
        if (db.auth?.admin_token) {
            localStorage.setItem('admin_token', db.auth.admin_token);
        }
        if (!categories.length && Array.isArray(db.settings?.categories) && db.settings.categories.length) {
            localStorage.setItem(
                'matrix_custom_categories',
                JSON.stringify(normalizeCategories(db.settings.categories, { keepEmpty: true }))
            );
        }
    }

    // UI-only hide lists from a prior session can hide imported items by id.
    localStorage.removeItem('matrix_hidden_board_ids');
    localStorage.removeItem('matrix_calendar_hidden_ids');

    if (parsedBackup.matrix_global_drawing != null) {
        localStorage.setItem('matrix_global_drawing', typeof parsedBackup.matrix_global_drawing === 'string'
            ? parsedBackup.matrix_global_drawing
            : JSON.stringify(parsedBackup.matrix_global_drawing));
    }
    if (parsedBackup.matrix_drawing_prefs != null) {
        localStorage.setItem('matrix_drawing_prefs', typeof parsedBackup.matrix_drawing_prefs === 'string'
            ? parsedBackup.matrix_drawing_prefs
            : JSON.stringify(parsedBackup.matrix_drawing_prefs));
    }
    if (parsedBackup.matrix_workspace_mode != null) {
        localStorage.setItem('matrix_workspace_mode', parsedBackup.matrix_workspace_mode);
    }
    if (parsedBackup.matrix_drawing_toolbar_hidden != null) {
        localStorage.setItem('matrix_drawing_toolbar_hidden', parsedBackup.matrix_drawing_toolbar_hidden);
    }
    if (parsedBackup.matrix_drawing_toolbar_collapsed != null) {
        localStorage.setItem('matrix_drawing_toolbar_hidden', parsedBackup.matrix_drawing_toolbar_collapsed);
    }
    if (parsedBackup.matrix_canvas_viewport != null) {
        localStorage.setItem('matrix_canvas_viewport', typeof parsedBackup.matrix_canvas_viewport === 'string'
            ? parsedBackup.matrix_canvas_viewport
            : JSON.stringify(parsedBackup.matrix_canvas_viewport));
    }

    applyLayoutBackupKeys(parsedBackup);
}
