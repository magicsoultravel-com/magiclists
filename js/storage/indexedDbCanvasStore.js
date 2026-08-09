/**
 * IndexedDBC antvasStore - IndexedDB storage specifically for magicCanvas documents.
 * 
 * Uses the existing magicnotes_cache_db database with a canvas_store object store.
 * Falls back to localStorage if IndexedDB is unavailable (private mode, disabled, etc.).
 * 
 * Migration: On first read, automatically migrates from localStorage's matrix_global_drawing
 * key to IndexedDB. Idempotent - after migration, localStorage key is removed.
 */

const DB_NAME = 'magicnotes_cache_db';
const DB_VERSION = 1;
const CANVAS_STORE = 'canvas_store';

let canvasDbPromise = null;
let canvasMemoryFallback = null;

function openCanvasDb() {
    if (canvasMemoryFallback) return Promise.resolve(null);
    if (canvasDbPromise) return canvasDbPromise;

    canvasDbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            canvasMemoryFallback = new Map();
            canvasDbPromise = null;
            resolve(null);
            return;
        }

        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(CANVAS_STORE)) {
                db.createObjectStore(CANVAS_STORE, { keyPath: 'key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
            canvasMemoryFallback = new Map();
            canvasDbPromise = null;
            resolve(null);
        };
    });

    return canvasDbPromise;
}

function getFromCanvasMemory(key) {
    if (!canvasMemoryFallback) return undefined;
    return canvasMemoryFallback.has(key) ? canvasMemoryFallback.get(key) : undefined;
}

function setInCanvasMemory(key, value) {
    if (!canvasMemoryFallback) canvasMemoryFallback = new Map();
    canvasMemoryFallback.set(key, value);
}

function removeFromCanvasMemory(key) {
    if (canvasMemoryFallback) canvasMemoryFallback.delete(key);
}

/**
 * Get magicCanvas document from IndexedDB (or in-memory fallback).
 * 
 * @param {string} key - The document key ('matrix_global_drawing').
 * @param {string} legacyKey - Optional localStorage key to migrate from.
 *   If provided and localStorage has data, it's migrated to IndexedDB and
 * the localStorage key is removed.
 * @returns {Promise<any|null>} The stored document, or null if not found.
 */
async function getCanvasDocument(key, legacyKey) {
    // Migration: check localStorage first if a legacy key is provided
    if (legacyKey && typeof localStorage !== 'undefined') {
        try {
            const raw = localStorage.getItem(legacyKey);
            if (raw !== null) {
                let value;
                try {
                    value = JSON.parse(raw);
                } catch {
                    value = raw;
                }
                // Write to IndexedDB (or memory fallback)
                await setCanvasDocument(key, value);
                // Remove the old localStorage key
                try {
                    localStorage.removeItem(legacyKey);
                } catch {
                    /* ignore — migration already happened in IndexedDB */
                }
                return value;
            }
        } catch {
            /* localStorage access failed — proceed to IndexedDB */
        }
    }

    const db = await openCanvasDb();
    if (!db) {
        return getFromCanvasMemory(key) ?? null;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(CANVAS_STORE, 'readonly');
        const store = tx.objectStore(CANVAS_STORE);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => resolve(getFromCanvasMemory(key) ?? null);
    });
}

/**
 * Set magicCanvas document in IndexedDB (or in-memory fallback).
 * 
 * @param {string} key - The document key ('matrix_global_drawing').
 * @param {any} value - The document to store (will be JSON-serialized by IndexedDB).
 * @returns {Promise<boolean>} True if written successfully, false if quota/storage error.
 */
async function setCanvasDocument(key, value) {
    const db = await openCanvasDb();
    if (!db) {
        setInCanvasMemory(key, value);
        return true;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(CANVAS_STORE, 'readwrite');
        const store = tx.objectStore(CANVAS_STORE);
        store.put({ key, value });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => {
            // If IndexedDB fails, fall back to in-memory for this session
            setInCanvasMemory(key, value);
            resolve(false);
        };
    });
}

/**
 * Remove magicCanvas document from IndexedDB (or in-memory fallback).
 * 
 * @param {string} key - The document key.
 * @returns {Promise<void>}
 */
async function removeCanvasDocument(key) {
    const db = await openCanvasDb();
    if (!db) {
        removeFromCanvasMemory(key);
        return;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(CANVAS_STORE, 'readwrite');
        const store = tx.objectStore(CANVAS_STORE);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
            removeFromCanvasMemory(key);
            resolve();
        };
    });
}

/**
 * Clear all magicCanvas documents from IndexedDB (or in-memory fallback).
 * 
 * @returns {Promise<void>}
 */
async function clearCanvasDocuments() {
    const db = await openCanvasDb();
    if (!db) {
        if (canvasMemoryFallback) canvasMemoryFallback.clear();
        return;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(CANVAS_STORE, 'readwrite');
        const store = tx.objectStore(CANVAS_STORE);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
            if (canvasMemoryFallback) canvasMemoryFallback.clear();
            resolve();
        };
    });
}

export const IndexedDBC antvasStore = {
    get: getCanvasDocument,
    set: setCanvasDocument,
    remove: removeCanvasDocument,
    clear: clearCanvasDocuments,
    openDb: openCanvasDb
};
