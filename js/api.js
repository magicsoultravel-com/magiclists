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

export const API = {
    _getLocalDB() {
        let dbRaw = localStorage.getItem('matrix_database');
        if (!dbRaw) {
            localStorage.setItem('matrix_database', JSON.stringify(DEFAULT_DATABASE_SEED));
            return DEFAULT_DATABASE_SEED;
        }
        try { return JSON.parse(dbRaw); } catch (e) { return DEFAULT_DATABASE_SEED; }
    },

    _writeLocalDB(dbData) {
        localStorage.setItem('matrix_database', JSON.stringify(dbData));
    },

    async fetchItems(token = null) {
        const db = this._getLocalDB();
        const hasAccess = (token === db.auth.admin_token);
        const filteredItems = hasAccess ? db.items : db.items.filter(item => item.visibility === 'public');
        return new Promise((resolve) => setTimeout(() => resolve({ items: filteredItems, write_access: hasAccess }), 50));
    },

    async saveItem(itemObject, token = null) {
        const db = this._getLocalDB();
        if (token !== db.auth.admin_token) return false;

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
        if (token !== db.auth.admin_token) return false;

        const initialLength = db.items.length;
        db.items = db.items.filter(item => item.id !== itemId);
        
        if (db.items.length !== initialLength) {
            this._writeLocalDB(db);
            return true;
        }
        return false;
    }
};
