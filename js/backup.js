import { normalizeCategories } from './categories.js';

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
        const db = migrateImportedDatabase(parsedBackup.matrix_database, categories);
        localStorage.setItem('matrix_database', JSON.stringify(db));
        if (db.auth?.admin_token) {
            localStorage.setItem('admin_token', db.auth.admin_token);
        }
    }

    // UI-only hide lists from a prior session can hide imported items by id.
    localStorage.removeItem('matrix_hidden_board_ids');
    localStorage.removeItem('matrix_calendar_hidden_ids');
}
