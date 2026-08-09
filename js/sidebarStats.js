/** @module {"owns":"sidebar workspace stats module", "related":["layoutStorage.js","backup.js","sidebarModules.js"]} */
import { formatStorageSize, getLocalStorageByteEstimate, getLocalStorageUsageBreakdown, getStorageBreakdown } from './layoutStorage.js';
import {
    formatExportTimestamp,
    readLastCloudExportAt,
    readLastLocalExportAt
} from './backup.js';
import { IndexedDBStore } from './storage/indexedDbStore.js';

export const SidebarStats = {
    init() {
        this.update();
    },

    async update() {
        const container = document.getElementById('sidebar-storage-stats');
        if (!container) return;

        const total = getLocalStorageByteEstimate();
        const mb = (total / (1024 * 1024)).toFixed(2);
        const pct = Math.min(100, Math.round((total / 5_000_000) * 100));
        const { notes, matrix, app } = getStorageBreakdown();
        const keyBreakdown = getLocalStorageUsageBreakdown(6);
        const totalLine = `Total: ${mb} MB (~${pct}%)`;
        const detail = keyBreakdown
            .map((row) => `${row.key}: ${(row.bytes / 1024).toFixed(1)} KB`)
            .join('\n');
        const fallbackDetail = 'Notes: note content · Matrix: categories, layouts, view state · App: theme, tools, session';

        const hintLine = keyBreakdown.length
            ? '<span class="sidebar-storage-stat sidebar-storage-stat--hint">Hover for largest items</span>'
            : '';

        const localExportAt = formatExportTimestamp(readLastLocalExportAt());
        const cloudExportAt = formatExportTimestamp(readLastCloudExportAt());

        // Get IndexedDB stats
        const { sizeBytes, breakdown } = await getIndexedDBStats();
        const sizeStr = formatStorageSize(sizeBytes);
        const breakdownTooltip = breakdown.map(e => `${e.key}: ${formatStorageSize(e.sizeBytes)}`).join('\n');

        container.innerHTML = `
             <span class="sidebar-storage-stat">Notes: ${formatStorageSize(notes)}</span>
             <span class="sidebar-storage-stat">Matrix: ${formatStorageSize(matrix)}</span>
             <span class="sidebar-storage-stat">App: ${formatStorageSize(app)}</span>
             <span class="sidebar-storage-stat">${totalLine}</span>
             <span class="sidebar-storage-stat">Local export: ${localExportAt}</span>
             <span class="sidebar-storage-stat">Cloud export: ${cloudExportAt}</span>
             <span class="sidebar-storage-stat" title="${breakdownTooltip}">IndexedDB: ${sizeStr}</span>
             ${hintLine}
         `;

        container.title = detail
            ? `${totalLine}\n${detail}`
            : `${totalLine}\n${fallbackDetail}`;
    }
};

async function getIndexedDBStats() {
    try {
        const dbPromise = IndexedDBStore.openDb();
        if (!dbPromise) {
            return { sizeBytes: 0, entryCount: 0, breakdown: [] };
        }
        const db = await dbPromise;
        const allKeys = await db.getAllKeys();
        const entries = await Promise.all(allKeys.map(async (key) => {
            const value = await db.get(key);
            const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
            const keyBytes = new TextEncoder().encode(key).length;
            const valueBytes = new TextEncoder().encode(valueStr).length;
            return { key, sizeBytes: keyBytes + valueBytes };
        }));
        entries.sort((a, b) => b.sizeBytes - a.sizeBytes);
        const sizeBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
        const breakdown = entries.slice(0, 5).map(e => `${e.key}: ${formatStorageSize(e.sizeBytes)}`);
        return { sizeBytes, entryCount: entries.length, breakdown };
    } catch (e) {
        console.warn('[SidebarStats] IndexedDB stats error', e);
        return { sizeBytes: 0, entryCount: 0, breakdown: [] };
    }
}