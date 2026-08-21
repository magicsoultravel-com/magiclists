/**
 * Dedicated IndexedDB for media library records (meta + blob + thumb).
 * Separate from magicnotes_cache_db so canvas/cache version upgrades stay untouched.
 */

const DB_NAME = 'magicnotes_media_db';
const DB_VERSION = 1;
const STORE_NAME = 'media_records';

let dbPromise = null;
/** @type {Map<string, object>|null} */
let memoryFallback = null;

function openDb() {
    if (memoryFallback) return Promise.resolve(null);
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
            memoryFallback = new Map();
            dbPromise = null;
            resolve(null);
            return;
        }

        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
            memoryFallback = new Map();
            dbPromise = null;
            resolve(null);
        };
    });

    return dbPromise;
}

/**
 * @param {object} record
 * @returns {Promise<boolean>}
 */
async function put(record) {
    if (!record?.id) return false;
    const db = await openDb();
    if (!db) {
        if (!memoryFallback) memoryFallback = new Map();
        memoryFallback.set(record.id, record);
        return true;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => {
            if (!memoryFallback) memoryFallback = new Map();
            memoryFallback.set(record.id, record);
            resolve(false);
        };
    });
}

/**
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function get(id) {
    if (!id) return null;
    const db = await openDb();
    if (!db) {
        return memoryFallback?.get(id) ?? null;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(memoryFallback?.get(id) ?? null);
    });
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
async function remove(id) {
    if (!id) return;
    const db = await openDb();
    if (!db) {
        memoryFallback?.delete(id);
        return;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
            memoryFallback?.delete(id);
            resolve();
        };
    });
}

/**
 * @returns {Promise<object[]>}
 */
async function getAll() {
    const db = await openDb();
    if (!db) {
        return memoryFallback ? Array.from(memoryFallback.values()) : [];
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve(memoryFallback ? Array.from(memoryFallback.values()) : []);
    });
}

/**
 * @returns {Promise<void>}
 */
async function clear() {
    const db = await openDb();
    if (!db) {
        memoryFallback?.clear();
        return;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
            memoryFallback?.clear();
            resolve();
        };
    });
}

export const IndexedDBMediaStore = {
    put,
    get,
    remove,
    getAll,
    clear,
    openDb
};
