/** @module {"owns":"local backup export/import, encrypted packages", "related":["cloudBackup.js","api.js"]} */
import {
    ensureUncategorizedCategory,
    normalizeCategories,
    readStoredCategories,
    writeStoredCategories
} from './categories.js';
import { applyLayoutBackupKeys, getLayoutBackupKeys, repairSpatialLayoutStorage } from './layoutStorage.js';

export const BACKUP_FILE_PREFIX = 'matrix_workspace_backup_';
export const ENCRYPTED_BACKUP_MARKER = 'matrix_encrypted_backup';
export const LAST_LOCAL_EXPORT_KEY = 'matrix_last_local_export_at';
const CLOUD_CONFIG_KEY = 'matrix_cloud_config';

export function formatExportTimestamp(timestamp) {
    if (!timestamp) return 'Never';
    return new Date(timestamp * 1000).toLocaleString();
}

export function readLastLocalExportAt() {
    try {
        const ts = Number(localStorage.getItem(LAST_LOCAL_EXPORT_KEY));
        return Number.isFinite(ts) ? ts : null;
    } catch {
        return null;
    }
}

export function writeLastLocalExportAt(timestamp) {
    if (!Number.isFinite(timestamp)) return;
    localStorage.setItem(LAST_LOCAL_EXPORT_KEY, String(timestamp));
}

export function readLastCloudExportAt() {
    try {
        const config = JSON.parse(localStorage.getItem(CLOUD_CONFIG_KEY) || 'null');
        const ts = Number(config?.lastCheckpointAt);
        return Number.isFinite(ts) ? ts : null;
    } catch {
        return null;
    }
}

export function backupFilename(timestamp = Math.floor(Date.now() / 1000)) {
    return `${BACKUP_FILE_PREFIX}${timestamp}.json`;
}

export function buildBackupPackage() {
    const categories = readStoredCategories({ keepEmpty: true });
    writeStoredCategories(categories, { keepEmpty: true });

    const databasePayload = localStorage.getItem('matrix_database');
    let matrix_database = databasePayload ? JSON.parse(databasePayload) : null;
    if (matrix_database) {
        matrix_database = {
            ...matrix_database,
            settings: {
                ...(matrix_database.settings || {}),
                categories: categories.map((cat) => cat.name)
            }
        };
    }

    const layoutKeys = getLayoutBackupKeys();
    return {
        timestamp: Math.floor(Date.now() / 1000),
        matrix_database,
        matrix_custom_categories: categories,
        ...Object.fromEntries(
            Object.entries(layoutKeys).map(([key, raw]) => {
                try {
                    return [key, JSON.parse(raw)];
                } catch {
                    return [key, raw];
                }
            })
        )
    };
}

export function serializeBackupPackage(pkg) {
    return JSON.stringify(pkg, null, 2);
}

export function parseBackupPackage(text) {
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid backup package');
    }
    if (parsed[ENCRYPTED_BACKUP_MARKER]) {
        throw new Error('Encrypted backup — passphrase required.');
    }
    if (!parsed.matrix_database && !parsed.matrix_custom_categories) {
        throw new Error('Not a Magic Lists backup file (missing matrix_database).');
    }
    return parsed;
}

export function isEncryptedBackupPackage(parsed) {
    return !!(parsed && typeof parsed === 'object' && parsed[ENCRYPTED_BACKUP_MARKER]);
}

function bytesToBase64(bytes) {
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary);
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function deriveKey(passphrase, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptBackupPackage(jsonString, passphrase) {
    const clean = String(passphrase || '').trim();
    if (!clean) throw new Error('Passphrase is required for encryption.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(clean, salt);
    const enc = new TextEncoder();
    const cipher = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        enc.encode(jsonString)
    );
    return JSON.stringify({
        [ENCRYPTED_BACKUP_MARKER]: true,
        v: 1,
        salt: bytesToBase64(salt),
        iv: bytesToBase64(iv),
        data: bytesToBase64(new Uint8Array(cipher))
    });
}

export async function decryptBackupPackage(text, passphrase) {
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;
    if (!isEncryptedBackupPackage(parsed)) {
        return parseBackupPackage(parsed);
    }
    const clean = String(passphrase || '').trim();
    if (!clean) throw new Error('Passphrase required for encrypted backup.');
    const salt = base64ToBytes(parsed.salt);
    const iv = base64ToBytes(parsed.iv);
    const data = base64ToBytes(parsed.data);
    const key = await deriveKey(clean, salt);
    const dec = new TextDecoder();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return parseBackupPackage(dec.decode(plain));
}

export function isBackupFilename(name) {
    return typeof name === 'string'
        && name.startsWith(BACKUP_FILE_PREFIX)
        && name.endsWith('.json');
}

export function timestampFromBackupFilename(name) {
    if (!isBackupFilename(name)) return null;
    const raw = name.slice(BACKUP_FILE_PREFIX.length, -'.json'.length);
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : null;
}

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

    try {
        const db = JSON.parse(localStorage.getItem('matrix_database') || '{}');
        const categories = readStoredCategories({ keepEmpty: true });
        repairSpatialLayoutStorage({ items: db.items || [], categories });
    } catch {
        /* ignore layout repair failures on import */
    }
}