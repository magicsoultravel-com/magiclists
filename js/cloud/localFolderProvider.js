import {
    formatCloudError,
    registerCloudProvider
} from './cloudProvider.js';
import {
    isBackupFilename,
    timestampFromBackupFilename
} from '../backup.js';

const HANDLE_DB = 'matrix_cloud_local';
const HANDLE_STORE = 'handles';
const HANDLE_KEY = 'backupDir';

let dirHandle = null;

function openHandleDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(HANDLE_DB, 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(HANDLE_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveDirHandle(handle) {
    const db = await openHandleDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, 'readwrite');
        tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function loadDirHandle() {
    const db = await openHandleDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, 'readonly');
        const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function ensureDirPermission(handle) {
    if (!handle) return false;
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') return true;
    perm = await handle.requestPermission({ mode: 'readwrite' });
    return perm === 'granted';
}

async function scanBackupFiles() {
    if (!dirHandle) return [];
    const files = [];
    for await (const entry of dirHandle.values()) {
        if (entry.kind !== 'file' || !isBackupFilename(entry.name)) continue;
        const file = await entry.getFile();
        files.push({
            id: entry.name,
            name: entry.name,
            timestamp: timestampFromBackupFilename(entry.name) || Math.floor(file.lastModified / 1000),
            size: file.size
        });
    }
    return files.sort((a, b) => b.timestamp - a.timestamp);
}

export const LocalFolderProvider = {
    id: 'local',
    label: 'Local folder',

    async connect() {
        if (typeof window.showDirectoryPicker !== 'function') {
            return { ok: false, error: 'Local folder backup needs a Chromium-based browser.' };
        }
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            if (!(await ensureDirPermission(handle))) {
                return { ok: false, error: 'Folder permission denied.' };
            }
            dirHandle = handle;
            await saveDirHandle(handle);
            return { ok: true, folderName: handle.name };
        } catch (err) {
            if (err?.name === 'AbortError') {
                return { ok: false, error: 'Folder not selected.' };
            }
            return { ok: false, error: formatCloudError(err) };
        }
    },

    async reconnectFromSession() {
        try {
            const handle = await loadDirHandle();
            if (!handle) return { ok: false, error: 'Pick folder again.' };
            if (!(await ensureDirPermission(handle))) {
                return { ok: false, error: 'Folder permission denied.' };
            }
            dirHandle = handle;
            return { ok: true };
        } catch (err) {
            return { ok: false, error: formatCloudError(err) };
        }
    },

    disconnect() {
        dirHandle = null;
    },

    isConnected() {
        return !!dirHandle;
    },

    getSessionEmail() {
        return null;
    },

    browseFolders() {
        return [];
    },

    getFolderMeta() {
        if (!dirHandle) return null;
        return { id: '.', path: `/${dirHandle.name}`, name: dirHandle.name, parentId: null };
    },

    getDirectoryMeta() {
        return this.getFolderMeta();
    },

    listDirectoryContents() {
        return { meta: this.getFolderMeta(), folders: [], files: [] };
    },

    async createFolder() {
        throw new Error('Create folder is not supported for local backup.');
    },

    async ensureDefaultFolder() {
        throw new Error('Use folder picker for local backup.');
    },

    setBackupFolder() {
        if (!dirHandle) throw new Error('Folder not connected');
        return { id: '.', path: `/${dirHandle.name}` };
    },

    resolveBackupFolder(folderId) {
        if (folderId && folderId !== '.') {
            throw new Error('Local backup uses one selected folder.');
        }
        return this.setBackupFolder();
    },

    async listBackups() {
        if (!dirHandle) throw new Error('Backup folder not configured');
        return scanBackupFiles();
    },

    async uploadBackup(jsonString, filename) {
        if (!dirHandle) throw new Error('Backup folder not configured');
        const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(jsonString);
        await writable.close();
        return { id: filename, name: filename };
    },

    async downloadBackup(id) {
        if (!dirHandle) throw new Error('Backup folder not configured');
        const fileHandle = await dirHandle.getFileHandle(id);
        const file = await fileHandle.getFile();
        return file.text();
    },

    async deleteBackup(id) {
        if (!dirHandle) throw new Error('Backup folder not configured');
        await dirHandle.removeEntry(id);
    },

    async deleteBackups(ids) {
        const list = Array.isArray(ids) ? ids : [];
        for (const id of list) {
            await this.deleteBackup(id);
        }
    }
};

registerCloudProvider('local', () => LocalFolderProvider);
