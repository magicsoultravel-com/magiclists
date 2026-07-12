/**
 * Backup Module
 * Handles data export, import, and local storage synchronization.
 */
import { API } from './api.js';
import { LoadingManager } from './loadingUtils.js';

export function buildBackupPackage() {
    const db = API._getLocalDB();
    return {
        timestamp: new Date().toISOString(),
        matrix_database: {
            items: db.items,
            auth: db.auth,
            settings: db.settings
        }
    };
}

export function serializeBackupPackage(pkg) {
    return JSON.stringify(pkg);
}

export function parseBackupPackage(json) {
    return JSON.parse(json);
}

export function applyBackupToStorage(pkg) {
    const db = API._getLocalDB();
    if (pkg.matrix_database) {
        const data = pkg.matrix_database;
        if (data.items) db.items = data.items;
        if (data.auth) db.auth = data.auth;
        if (data.settings) db.settings = data.settings;
    }
}

export function writeLastLocalExportAt(timestamp) {
    localStorage.setItem('matrix_last_export_at', timestamp);
}