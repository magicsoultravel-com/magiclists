import {
    formatCloudError,
    registerCloudProvider
} from './cloudProvider.js';
import {
    isBackupFilename,
    timestampFromBackupFilename
} from '../backup.js';

const SESSION_KEY = 'matrix_cloud_mega_session';
const DEFAULT_FOLDER_PATH = ['magicnotes', 'backups'];
const DOWNLOAD_OPTIONS = { maxConnections: 1 };
const UTF8_DECODER = new TextDecoder('utf-8');

let megajsModule = null;
let storage = null;
let backupFolder = null;

async function loadMegajs() {
    if (!megajsModule) {
        megajsModule = await import('../../vendor/megajs.browser.mjs');
    }
    return megajsModule;
}

function readSession() {
    try {
        return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    } catch {
        return null;
    }
}

function writeSession(credentials) {
    if (!credentials) {
        sessionStorage.removeItem(SESSION_KEY);
        return;
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        email: credentials.email,
        password: credentials.password,
        secondFactorCode: credentials.secondFactorCode || ''
    }));
}

function waitReady(instance) {
    return new Promise((resolve, reject) => {
        instance.ready.then(() => resolve(instance)).catch(reject);
    });
}

async function openStorage(credentials) {
    const { Storage } = await loadMegajs();
    const instance = new Storage({
        email: credentials.email,
        password: credentials.password,
        secondFactorCode: credentials.secondFactorCode || undefined,
        userAgent: null
    });
    await waitReady(instance);
    return instance;
}

function folderEntries(folder) {
    if (!folder?.children) return [];
    return folder.children
        .filter((entry) => entry && entry.directory)
        .map((entry) => ({
            id: entry.nodeId,
            name: entry.name,
            path: buildFolderPath(entry)
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function buildFolderPath(folder) {
    const parts = [];
    let node = folder;
    while (node && node.parent && node !== storage.root) {
        parts.unshift(node.name);
        node = node.parent;
    }
    return parts.length ? `/${parts.join('/')}` : '/';
}

function fileEntries(folder) {
    if (!folder?.children) return [];
    return folder.children
        .filter((entry) => entry && !entry.directory)
        .map((entry) => ({
            id: entry.nodeId,
            name: entry.name,
            size: entry.size || 0,
            timestamp: entry.timestamp || 0
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function getDirectoryMeta(parentId) {
    if (!parentId) {
        return { id: null, path: '/', name: 'Root', parentId: null };
    }
    const folder = resolveFolder(parentId);
    if (!folder) return null;
    return {
        id: folder.nodeId,
        name: folder.name,
        path: buildFolderPath(folder),
        parentId: folder.parent && folder.parent !== storage.root ? folder.parent.nodeId : null
    };
}

function resolveFolder(folderId) {
    if (!storage || !folderId) return null;
    return storage.files[folderId] || null;
}

function promisifyDelete(node) {
    return new Promise((resolve, reject) => {
        node.delete(true, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

async function ensureFolderPath(pathParts) {
    let current = storage.root;
    for (const name of pathParts) {
        let child = current.children?.find((entry) => entry.directory && entry.name === name);
        if (!child) {
            child = await current.mkdir(name);
        }
        current = child;
    }
    return current;
}

function backupEntries(folder) {
    if (!folder?.children) return [];
    return folder.children
        .filter((entry) => entry && !entry.directory && isBackupFilename(entry.name))
        .map((entry) => ({
            id: entry.nodeId,
            name: entry.name,
            timestamp: timestampFromBackupFilename(entry.name) || entry.timestamp || 0,
            size: entry.size || 0
        }))
        .sort((a, b) => b.timestamp - a.timestamp);
}

function isMacVerificationError(err) {
    const raw = typeof err === 'string' ? err : (err?.message || String(err ?? ''));
    return raw.includes('MAC verification failed');
}

export function mapMegaDownloadError(err) {
    return formatCloudError(err);
}

export function mapMegaLoginError(err) {
    const raw = formatCloudError(err);
    const upper = raw.toUpperCase();

    if (upper.includes('EMFAREQUIRED') || upper.includes('(-26)') || upper.includes('MULTI-FACTOR')) {
        return {
            message: 'Two-factor code required. Open your authenticator app, enter the 6-digit code, and try again.',
            mfaRequired: true
        };
    }
    if (upper.includes('ENOENT') || upper.includes('(-9)') || upper.includes('WRONG PASSWORD')) {
        return { message: 'Email or password incorrect.', mfaRequired: false };
    }
    if (upper.includes('FAILED TO FETCH') || upper.includes('NETWORKERROR') || upper.includes('ECONNREFUSED')) {
        return { message: 'Could not reach MEGA. Check your connection and try again.', mfaRequired: false };
    }
    return { message: raw, mfaRequired: false };
}

function utf8UploadBytes(jsonString) {
    return new TextEncoder().encode(String(jsonString ?? ''));
}

async function resolveBackupFile(id) {
    const file = storage?.files?.[id];
    if (!file || file.directory) {
        throw new Error('Checkpoint not found — reconnect cloud and try again.');
    }
    if (typeof file.loadAttributes === 'function') {
        try {
            await file.loadAttributes();
        } catch {
            /* use cached metadata if refresh fails */
        }
    }
    return file;
}

async function downloadFileBuffer(file) {
    return file.downloadBuffer(DOWNLOAD_OPTIONS);
}

export const MegaProvider = {
    id: 'mega',
    label: 'MEGA',

    async connect(credentials) {
        try {
            if (storage) {
                try { storage.close(); } catch { /* ignore */ }
            }
            storage = await openStorage(credentials);
            backupFolder = null;
            writeSession(credentials);
            return { ok: true };
        } catch (err) {
            storage = null;
            backupFolder = null;
            const mapped = mapMegaLoginError(err);
            return { ok: false, error: mapped.message, mfaRequired: mapped.mfaRequired };
        }
    },

    async reconnectFromSession() {
        const session = readSession();
        if (!session?.email || !session.password) {
            return { ok: false, error: 'Session expired — log in again.' };
        }
        return this.connect(session);
    },

    disconnect() {
        if (storage) {
            try { storage.close(); } catch { /* ignore */ }
        }
        storage = null;
        backupFolder = null;
        writeSession(null);
    },

    isConnected() {
        return !!(storage && storage.status === 'ready');
    },

    getSessionEmail() {
        return readSession()?.email || null;
    },

    browseFolders(parentId = null) {
        const folder = parentId ? resolveFolder(parentId) : storage?.root;
        if (!folder?.directory) return [];
        return folderEntries(folder);
    },

    getFolderMeta(folderId) {
        return getDirectoryMeta(folderId);
    },

    getDirectoryMeta(parentId = null) {
        return getDirectoryMeta(parentId);
    },

    listDirectoryContents(parentId = null) {
        const folder = parentId ? resolveFolder(parentId) : storage?.root;
        if (!folder?.directory) {
            return { meta: getDirectoryMeta(parentId), folders: [], files: [] };
        }
        return {
            meta: getDirectoryMeta(parentId),
            folders: folderEntries(folder),
            files: fileEntries(folder)
        };
    },

    async createFolder(parentId, name) {
        const parent = parentId ? resolveFolder(parentId) : storage?.root;
        if (!parent?.directory) throw new Error('Parent folder not found');
        const clean = String(name || '').trim();
        if (!clean) throw new Error('Folder name is required');
        const created = await parent.mkdir(clean);
        return {
            id: created.nodeId,
            name: created.name,
            path: buildFolderPath(created),
            parentId: parent.nodeId
        };
    },

    async ensureDefaultFolder() {
        const folder = await ensureFolderPath(DEFAULT_FOLDER_PATH);
        return {
            id: folder.nodeId,
            path: `/${DEFAULT_FOLDER_PATH.join('/')}`
        };
    },

    setBackupFolder(folderId) {
        const folder = resolveFolder(folderId);
        if (!folder?.directory) throw new Error('Backup folder not found');
        backupFolder = folder;
        return {
            id: folder.nodeId,
            path: buildFolderPath(folder)
        };
    },

    resolveBackupFolder(folderId) {
        if (folderId) {
            return this.setBackupFolder(folderId);
        }
        if (backupFolder) {
            return {
                id: backupFolder.nodeId,
                path: buildFolderPath(backupFolder)
            };
        }
        return null;
    },

    listBackups() {
        if (!backupFolder) throw new Error('Backup folder not configured');
        return backupEntries(backupFolder);
    },

    async uploadBackup(jsonString, filename) {
        if (!backupFolder) throw new Error('Backup folder not configured');
        const bytes = utf8UploadBytes(jsonString);
        const upload = backupFolder.upload({ name: filename, size: bytes.length }, bytes);
        await upload.complete;
        const created = backupFolder.children?.find((entry) => !entry.directory && entry.name === filename);
        return {
            id: created?.nodeId || null,
            name: filename
        };
    },

    async downloadBackup(id) {
        const file = await resolveBackupFile(id);
        let lastErr = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const buffer = await downloadFileBuffer(file);
                return UTF8_DECODER.decode(buffer);
            } catch (err) {
                lastErr = err;
                if (!isMacVerificationError(err) || attempt > 0) break;
            }
        }
        throw new Error(mapMegaDownloadError(lastErr));
    },

    async deleteBackup(id) {
        const file = storage?.files?.[id];
        if (!file || file.directory) throw new Error('Checkpoint not found');
        await promisifyDelete(file);
    },

    async deleteBackups(ids) {
        const list = Array.isArray(ids) ? ids : [];
        for (const id of list) {
            await this.deleteBackup(id);
        }
    }
};

registerCloudProvider('mega', () => MegaProvider);
