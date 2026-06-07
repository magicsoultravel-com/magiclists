import { DEFAULT_CATEGORIES } from './categories.js';

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
        "updated_at": 1775080000
    }]
};

function repairDatabase(db) {
    const repaired = (db && typeof db === 'object') ? { ...db } : JSON.parse(JSON.stringify(DEFAULT_DATABASE_SEED));

    if (!repaired.auth || typeof repaired.auth !== 'object') {
        repaired.auth = { ...DEFAULT_DATABASE_SEED.auth };
    } else if (!repaired.auth.admin_token) {
        repaired.auth.admin_token = DEFAULT_DATABASE_SEED.auth.admin_token;
    }

    if (!repaired.settings || typeof repaired.settings !== 'object') {
        repaired.settings = { ...DEFAULT_DATABASE_SEED.settings };
    } else if (!Array.isArray(repaired.settings.categories) || !repaired.settings.categories.length) {
        repaired.settings.categories = [...DEFAULT_DATABASE_SEED.settings.categories];
    }

    if (!Array.isArray(repaired.items)) {
        repaired.items = [];
    }

    return repaired;
}

export const API = {
    _getLocalDB() {
        let dbRaw = localStorage.getItem('matrix_database');
        if (!dbRaw) {
            const seed = repairDatabase(DEFAULT_DATABASE_SEED);
            localStorage.setItem('matrix_database', JSON.stringify(seed));
            return seed;
        }

        try {
            const parsed = JSON.parse(dbRaw);
            const repaired = repairDatabase(parsed);
            if (JSON.stringify(parsed) !== JSON.stringify(repaired)) {
                localStorage.setItem('matrix_database', JSON.stringify(repaired));
            }
            return repaired;
        } catch {
            const seed = repairDatabase(DEFAULT_DATABASE_SEED);
            localStorage.setItem('matrix_database', JSON.stringify(seed));
            return seed;
        }
    },

    _writeLocalDB(dbData) {
        localStorage.setItem('matrix_database', JSON.stringify(repairDatabase(dbData)));
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
            return true;
        }
        return false;
    }
};
