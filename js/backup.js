import {
    ensureUncategorizedCategory,
    normalizeCategories,
    writeStoredCategories
} from './categories.js';
import { applyLayoutBackupKeys } from './layoutStorage.js';

let stepIdSeq = 0;

function createStepId() {
    stepIdSeq += 1;
    return `step_${Date.now()}_${stepIdSeq}_${Math.random().toString(36).slice(2, 8)}`;
}

function migrateImportedStep(step) {
    if (!step || typeof step !== 'object') return step;
    return {
        startDateTime: '',
        endDateTime: '',
        level: 0,
        completed: false,
        text: '',
        ...step,
        id: createStepId(),
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
    const names = ensureUncategorizedCategory(normalizeCategories(categories, { keepEmpty: true }))
        .map((c) => c.name);
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
    stepIdSeq = 0;
    const categories = parsedBackup.matrix_custom_categories
        ? ensureUncategorizedCategory(normalizeCategories(parsedBackup.matrix_custom_categories, { keepEmpty: true }))
        : [];

    if (categories.length) {
        writeStoredCategories(categories, { keepEmpty: true });
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
            writeStoredCategories(normalizeCategories(db.settings.categories, { keepEmpty: true }), { keepEmpty: true });
        }
    }

    // UI-only hide lists from a prior session can hide imported items by id.
    localStorage.removeItem('matrix_hidden_board_ids');
    localStorage.removeItem('matrix_calendar_hidden_ids');

    applyLayoutBackupKeys(parsedBackup);
}
