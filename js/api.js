/** @module {"owns":"item CRUD and matrix_database localStorage persistence", "related":["noteModel.js","layoutStorage.js"]} */
import { DEFAULT_CATEGORIES, detectDuplicateCategories } from './categories.js';
import { purgeLayoutForItem } from './layoutStorage.js';
import { normalizeTileSize } from './tileGeometry.js';
import { createNoteId, ensureStepIds, ensureStepLevels, getCreatedTimestamp, getUpdatedTimestamp } from './noteModel.js';
import { ensureStepsParentOrder } from './checklistSteps.js';

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

// Core schema metadata for a note item. These defaults are used only to
// backfill missing metadata (never to overwrite user-authored content).
const SCHEMA_CORE_DEFAULTS = {
    owner_id: 'admin',
    visibility: 'private',
    status: 'active',
    categories: [],
    backgroundColor: '',
    startDateTime: '',
    endDateTime: '',
    isRecurring: false,
    hideFromCalendar: false,
    hiddenFromBoard: false,
    attachments: []
};

function itemStepIdSet(item) {
    const set = new Set();
    if (Array.isArray(item?.steps)) {
        item.steps.forEach((step) => {
            if (step && typeof step.id === 'string') set.add(step.id);
        });
    }
    return set;
}

function stepIdOverlap(a, b) {
    const aSet = itemStepIdSet(a);
    const bSet = itemStepIdSet(b);
    let shared = 0;
    for (const id of aSet) if (bSet.has(id)) shared += 1;
    return shared;
}

/**
 * Structural twins are two items that represent the same underlying note:
 * same title, or a significant overlap of checklist step IDs. Used to detect
 * and collapse id-less duplicates that were pushed as brand-new items (e.g. by
 * an id-less saveItem / stale undo snapshot) rather than intentional notes.
 */
function isStructuralTwin(a, b) {
    if (!a || !b) return false;
    const aTitle = String(a.title || '').trim();
    const bTitle = String(b.title || '').trim();
    const aSteps = Array.isArray(a.steps) ? a.steps.length : 0;
    const bSteps = Array.isArray(b.steps) ? b.steps.length : 0;
    const sharedSteps = stepIdOverlap(a, b);
    if (sharedSteps === 0) return false;
    if (aTitle && aTitle === bTitle) return true;
    const minSteps = Math.min(aSteps, bSteps);
    return minSteps > 0 && sharedSteps >= Math.max(1, Math.ceil(minSteps / 2));
}

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

    // Drop id-less items that are structural twins of a real (id'd) item.
    // These are orphaned duplicates (e.g. created when an id-less snapshot was
    // pushed as a new item by saveItem) rather than intentional separate notes.
    // Done before the per-item pass so they never receive metadata backfills.
    const idLessCount = repaired.items.filter((item) => (
        item && typeof item === 'object' && (typeof item.id !== 'string' || !item.id)
    )).length;
    if (idLessCount > 0) {
        const kept = [];
        let twinDropped = 0;
        for (const item of repaired.items) {
            if (!item || typeof item !== 'object' || (typeof item.id === 'string' && item.id)) {
                kept.push(item);
                continue;
            }
            const hasTwin = repaired.items.some((other) => (
                other !== item
                && other && typeof other === 'object'
                && typeof other.id === 'string' && other.id
                && isStructuralTwin(item, other)
            ));
            if (hasTwin) {
                twinDropped += 1;
                changed = true;
                continue;
            }
            kept.push(item);
        }
        if (twinDropped > 0) {
            diagnostics.twinDuplicatesDropped = twinDropped;
            diagnostics.warnings.push(`${twinDropped} id-less duplicate item(s) dropped (matched a structural twin).`);
            repaired.items = kept;
        }
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
    let stepsParentOrderMigrated = 0;
    let schemaCoreBackfilled = 0;
    repaired.items = repaired.items.map((item) => {
        if (!item || typeof item !== 'object') return item;

        // Backfill missing id + core schema metadata so no id-less item can
        // persist (an id-less item can never be matched/updated by saveItem
        // and would otherwise be pushed as a brand-new duplicate). This is
        // pure metadata — user-authored content is never touched.
        const needsId = typeof item.id !== 'string' || !item.id;
        const schemaBackfill = { ...SCHEMA_CORE_DEFAULTS };
        for (const key of Object.keys(schemaBackfill)) {
            if (item[key] !== undefined) schemaBackfill[key] = item[key];
        }
        if (needsId) schemaBackfill.id = createNoteId();
        if (typeof item.type !== 'string' || !item.type) {
            schemaBackfill.type = (Array.isArray(item.steps) && item.steps.length > 0) ? 'checklist' : 'note';
        }
        const base = { ...item, ...schemaBackfill };

        const tileSize = base.tileSize ? normalizeItemTileSize(base.tileSize) : 'large';

        // Backfill missing created_at/updated_at using centralized helpers.
        const createdAt = getCreatedTimestamp(base);
        const updatedAt = getUpdatedTimestamp(base);

        let itemChanged = needsId || Object.keys(schemaBackfill).some((k) => k !== 'id' && item[k] === undefined);
        let nextSteps = base.steps;
        if (!Array.isArray(base.steps)) {
            nextSteps = [];
            itemChanged = true;
        } else if (base.steps.length > 0) {
            const stepResult = ensureStepIds(base.steps);
            if (stepResult.added > 0) {
                nextSteps = stepResult.steps;
                stepIdsMigrated += stepResult.added;
                itemChanged = true;
            }
            // Backfill missing/invalid `level` on steps to fix indent/outdent on old notes
            const levelResult = ensureStepLevels(nextSteps);
            if (levelResult.added > 0) {
                nextSteps = levelResult.steps;
                itemChanged = true;
            }
            // Backfill explicit parentId + order position metadata (H3-B model).
            // Silent and non-destructive — existing ids/text/levels are preserved.
            const orderResult = ensureStepsParentOrder(nextSteps);
            if (orderResult.added > 0) {
                nextSteps = orderResult.steps;
                stepsParentOrderMigrated += orderResult.added;
                itemChanged = true;
            }
        }

        // Backfill missing editorBodyLayout to 'both' (safe default matching new notes)
        const nextEditorBodyLayout = base.editorBodyLayout || 'both';
        if (!base.editorBodyLayout) {
            itemChanged = true;
        }

        if (!itemChanged
            && base.tileSize === tileSize
            && base.created_at === createdAt
            && base.updated_at === updatedAt) {
            return base;
        }

        if (needsId || Object.keys(SCHEMA_CORE_DEFAULTS).some((k) => item[k] === undefined)) {
            schemaCoreBackfilled += 1;
        }

        const next = { ...base };
        if (nextSteps !== base.steps) next.steps = nextSteps;
        if (nextEditorBodyLayout !== base.editorBodyLayout) next.editorBodyLayout = nextEditorBodyLayout;
        if (base.tileSize !== tileSize) next.tileSize = tileSize;
        if (base.created_at !== createdAt) next.created_at = createdAt;
        if (base.updated_at !== updatedAt) next.updated_at = updatedAt;
        changed = true;
        return next;
    });
    diagnostics.stepIdsMigrated = stepIdsMigrated;
    if (stepsParentOrderMigrated > 0) {
        diagnostics.stepsParentOrderMigrated = stepsParentOrderMigrated;
        diagnostics.warnings.push(`${stepsParentOrderMigrated} step(s) backfilled with explicit parentId/order position metadata.`);
    }
    if (schemaCoreBackfilled > 0) {
        diagnostics.schemaCoreBackfilled = schemaCoreBackfilled;
        diagnostics.warnings.push(`${schemaCoreBackfilled} item(s) backfilled with missing id/schema metadata.`);
    }

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

        // Guard: never persist an id-less item. If the caller passed a partial
        // object (missing id/schema metadata), backfill it so it merges onto the
        // real item instead of being pushed as a brand-new duplicate. If it is
        // structurally a twin of an existing id'd item (same title / shared step
        // IDs — e.g. a stale undo/redo snapshot), collapse onto that item.
        const normalized = { ...itemObject };
        if (typeof normalized.id !== 'string' || !normalized.id) {
            normalized.id = createNoteId();
            for (const key of Object.keys(SCHEMA_CORE_DEFAULTS)) {
                if (normalized[key] === undefined) normalized[key] = SCHEMA_CORE_DEFAULTS[key];
            }
            if (typeof normalized.type !== 'string' || !normalized.type) {
                normalized.type = (Array.isArray(normalized.steps) && normalized.steps.length > 0) ? 'checklist' : 'note';
            }
            const twinIndex = db.items.findIndex((existing) => (
                existing && typeof existing === 'object'
                && typeof existing.id === 'string' && existing.id
                && isStructuralTwin(normalized, existing)
            ));
            if (twinIndex >= 0) normalized.id = db.items[twinIndex].id;
        }

        const index = db.items.findIndex(i => i.id === normalized.id);
        const timestamp = Math.floor(Date.now() / 1000);

        if (index !== -1) {
            db.items[index] = { ...db.items[index], ...normalized, updated_at: timestamp };
        } else {
            db.items.push(normalized);
        }
        this._writeLocalDB(db);

        // When an item is archived or hidden from the board, purge its stale
        // spatial/layout entries so it no longer "resets to the same position"
        // on refresh. Restoring (status back to active / unhiding) keeps layout.
        if (normalized?.id
            && (normalized.status === 'archived' || normalized.hiddenFromBoard === true)) {
            purgeLayoutForItem(normalized.id);
        }

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
