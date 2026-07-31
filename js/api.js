/** @module {"owns":"item CRUD and matrix_database localStorage persistence", "related":["noteModel.js","layoutStorage.js"]} */
import { DEFAULT_CATEGORIES, detectDuplicateCategories } from './categories.js';
import { purgeLayoutForItem } from './layoutStorage.js';
import { normalizeTileSize } from './tileGeometry.js';
import { ensureStepIds, getCreatedTimestamp, getUpdatedTimestamp } from './noteModel.js';

function normalizeItemTileSize(tileSize) {
    return normalizeTileSize(tileSize);
}

const DEFAULT_DATABASE_SEED = {
    "auth": { "admin_token": "dev-admin-secret-2026" },
    "settings": { "categories": DEFAULT_CATEGORIES },
    "items": [{
        "id": "item_root_init",
        "owner_id": "admin",
        "visibility": "private",
        "type": "note",
        "title": "Welcome to Your Matrix Dashboard",
        "content": "Click '+ New' to build custom cards or manage web links.",
        "status": "active",
        "categories": ["Lifestyle"],
        "backgroundColor": "",
        "startDateTime": "",
        "endDateTime": "",
        "created_at": 1775080000,
        "updated_at": 1775080000,
        "tileSize": "large"
    }]
};

let lastRepairDiagnostics = null;

/**
 * Non-destructive database repair + diagnostics.
 *
 * INVARIANT: No repair may modify user-authored content. Repairs may add
 * missing metadata (e.g. step IDs, schemaVersion) and collect diagnostics,
 * but must never alter titles, content, categories, ordering, or layout.
 *
 * schemaVersion is persistent metadata so future persisted-format
 * migrations have a deterministic starting point. This PR does NOT
 * introduce any versioned schema migrations.
 */
function runDatabaseRepair(db) {
    const repaired = (db && typeof db === 'object')
        ? { ...db }
        : JSON.parse(JSON.stringify(DEFAULT_DATABASE_SEED));

    let changed = false;
    const diagnostics = {
        schemaVersion: 1,
        schemaUpgraded: false,
        stepIdsMigrated: 0,
        duplicateCategoriesDetected: [],
        warnings: []
    };

    if (!repaired.schemaVersion) {
        repaired.schemaVersion = 1;
        diagnostics.schemaUpgraded = true;
        changed = true;
    } else {
        diagnostics.schemaVersion = repaired.schemaVersion;
    }

    if (!repaired.auth || typeof repaired.auth !== 'object') {
        repaired.auth = { ...DEFAULT_DATABASE_SEED.auth };
        changed = true;
    } else if (!repaired.auth.admin_token) {
        repaired.auth = { ...repaired.auth, admin_token: DEFAULT_DATABASE_SEED.auth.admin_token };
        changed = true;
    }

    if (!repaired.settings || typeof repaired.settings !== 'object') {
        repaired.settings = { ...DEFAULT_DATABASE_SEED.settings };
        changed = true;
    } else if (!Array.isArray(repaired.settings.categories) || !repaired.settings.categories.length) {
        repaired.settings = { ...repaired.settings, categories: [...DEFAULT_DATABASE_SEED.settings.categories] };
        changed = true;
    }

    if (!Array.isArray(repaired.items)) {
        repaired.items = [];
        changed = true;
    }

    // Category duplicate detection: diagnostics only — never mutates or removes.
    const duplicates = detectDuplicateCategories(repaired.settings?.categories || []);
    diagnostics.duplicateCategoriesDetected = duplicates;
    if (duplicates.length > 0) {
        diagnostics.warnings.push(
            `Duplicate category names detected (${duplicates.length}): ${duplicates.map((d) => d.name).join(', ')}`
        );
    }

    // Per-item repairs: add missing metadata only. User-authored content
    // (title, content, categories, ordering, layout) is never modified.
    let stepIdsMigrated = 0;
    repaired.items = repaired.items.map((item) => {
        if (!item || typeof item !== 'object') return item;

        const tileSize = item.tileSize ? normalizeItemTileSize(item.tileSize) : 'large';

        // Backfill missing created_at/updated_at using centralized helpers.
        const createdAt = getCreatedTimestamp(item);
        const updatedAt = getUpdatedTimestamp(item);

        let itemChanged = false;
        let nextSteps = null;
        if (Array.isArray(item.steps) && item.steps.length > 0) {
            const stepResult = ensureStepIds(item.steps);
            if (stepResult.added > 0) {
                nextSteps = stepResult.steps;
                stepIdsMigrated += stepResult.added;
                itemChanged = true;
            }
        }

        if (!itemChanged
            && item.tileSize === tileSize
            && item.created_at === createdAt
            && item.updated_at === updatedAt) {
            return item;
        }

        const next = { ...item };
        if (nextSteps) next.steps = nextSteps;
        if (item.tileSize !== tileSize) next.tileSize = tileSize;
        if (item.created_at !== createdAt) next.created_at = createdAt;
        if (item.updated_at !== updatedAt) next.updated_at = updatedAt;
        changed = true;
        return next;
    });
    diagnostics.stepIdsMigrated = stepIdsMigrated;

    return { db: repaired, diagnostics, changed };
}

export function repairDatabase(db) {
    const result = runDatabaseRepair(db);
    lastRepairDiagnostics = result.diagnostics;
    return result.db;
}

function getLastRepairDiagnostics() {
    return lastRepairDiagnostics;
}

export const API = {
    getLastRepairDiagnostics() {
        return getLastRepairDiagnostics();
    },

    _getLocalDB() {
        let dbRaw = localStorage.getItem('matrix_database');
        if (!dbRaw) {
            const result = runDatabaseRepair(DEFAULT_DATABASE_SEED);
            lastRepairDiagnostics = result.diagnostics;
            localStorage.setItem('matrix_database', JSON.stringify(result.db));
            return result.db;
        }

        try {
            const parsed = JSON.parse(dbRaw);
            const result = runDatabaseRepair(parsed);
            lastRepairDiagnostics = result.diagnostics;
            if (result.changed) {
                localStorage.setItem('matrix_database', JSON.stringify(result.db));
            }
            return result.db;
        } catch {
            const result = runDatabaseRepair(DEFAULT_DATABASE_SEED);
            lastRepairDiagnostics = result.diagnostics;
            localStorage.setItem('matrix_database', JSON.stringify(result.db));
            return result.db;
        }
    },

    _writeLocalDB(dbData) {
        const result = runDatabaseRepair(dbData);
        lastRepairDiagnostics = result.diagnostics;
        localStorage.setItem('matrix_database', JSON.stringify(result.db));
    },

    async fetchItems(token = null) {
        const db = this._getLocalDB();
        const items = Array.isArray(db.items) ? db.items : [];
        const hasAccess = !!(token && token === db.auth?.admin_token);
        const filteredItems = hasAccess
            ? items
            : items.filter((item) => item.visibility === 'public');
        return new Promise((resolve) => setTimeout(() => resolve({
            items: filteredItems,
            write_access: hasAccess,
            total_items: items.length
        }), 50));
    },

    async saveItem(itemObject, token = null) {
        const db = this._getLocalDB();
        if (token !== db.auth?.admin_token) return false;

        const index = db.items.findIndex(i => i.id === itemObject.id);
        const timestamp = Math.floor(Date.now() / 1000);

        if (index !== -1) {
            db.items[index] = { ...db.items[index], ...itemObject, updated_at: timestamp };
        } else {
            itemObject.created_at = timestamp;
            itemObject.updated_at = timestamp;
            db.items.push(itemObject);
        }
        this._writeLocalDB(db);
        return true;
    },

    async deleteItem(itemId, token = null) {
        const db = this._getLocalDB();
        if (token !== db.auth?.admin_token) return false;

        const initialLength = db.items.length;
        db.items = db.items.filter(item => item.id !== itemId);
        
        if (db.items.length !== initialLength) {
            this._writeLocalDB(db);
            purgeLayoutForItem(itemId);
            return true;
        }
        return false;
    }
};