/**
 * @module {"owns":"pure incremental-backup helpers (export fingerprint hash, note revision snapshots, notes patch build/merge)","related":["backup.js","scheduledBackup.js"]}
 *
 * DOM-free so it can be unit tested under `node --test` (same pattern as
 * backupClaim.js). Nothing here reads localStorage, IndexedDB or the DOM —
 * callers pass in the plain data they already have.
 */

/** Marker stored in incremental notes packages (`kind` field). */
export const NOTES_PATCH_KIND = 'magicnotes_notes_patch';

/** Stable sync fingerprint for skip-if-unchanged scheduled exports. */
export function hashExportFingerprint(text) {
    const str = String(text ?? '');
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
}

/**
 * Cheap, change-sensitive revision stamp for a single note.
 * Length + hash keeps djb2 collision odds negligible for real note payloads,
 * so a changed note is never silently skipped by the incremental export.
 * @param {object} item
 * @returns {string}
 */
export function itemRevision(item) {
    if (!item || typeof item !== 'object') return '0:0';
    let text;
    try {
        text = JSON.stringify(item);
    } catch {
        // Cyclic payloads cannot be exported anyway — treat as always-changed.
        return `unserializable:${Date.now()}`;
    }
    return `${text.length}:${hashExportFingerprint(text)}`;
}

/**
 * @param {Array<object>} [items]
 * @returns {Record<string, string>} itemId → revision
 */
export function buildItemRevisionMap(items = []) {
    const map = {};
    for (const item of Array.isArray(items) ? items : []) {
        const id = item?.id;
        if (typeof id !== 'string' || !id) continue;
        map[id] = itemRevision(item);
    }
    return map;
}

/**
 * Coerce a stored/raw snapshot into the canonical shape.
 * @param {object} [raw]
 * @returns {{ baseAt: number|null, items: Record<string,string>, categories: string|null, desktops: string|null }}
 */
export function normalizeNotesSnapshot(raw) {
    const snapshot = raw && typeof raw === 'object' ? raw : {};
    const baseAt = Number(snapshot.baseAt);
    return {
        baseAt: Number.isFinite(baseAt) && baseAt > 0 ? baseAt : null,
        items: snapshot.items && typeof snapshot.items === 'object' ? snapshot.items : {},
        categories: typeof snapshot.categories === 'string' ? snapshot.categories : null,
        desktops: typeof snapshot.desktops === 'string' ? snapshot.desktops : null
    };
}

/**
 * A baseline (full) notes export must exist before patches can be produced:
 * patches only carry changes relative to the previous snapshot, so restore
 * always needs the newest full file plus every patch since it.
 * @param {object} [rawSnapshot]
 */
export function hasNotesBaseline(rawSnapshot) {
    return normalizeNotesSnapshot(rawSnapshot).baseAt != null;
}

/**
 * Diff the current items against a stored revision snapshot.
 * @param {Array<object>} [items]
 * @param {object} [rawSnapshot]
 * @returns {{
 *   changed: Array<object>,
 *   removed: Array<string>,
 *   revisions: Record<string,string>,
 *   snapshot: { baseAt: number|null, items: Record<string,string>, categories: string|null, desktops: string|null }
 * }}
 */
export function diffNotesAgainstSnapshot(items = [], rawSnapshot) {
    const snapshot = normalizeNotesSnapshot(rawSnapshot);
    const list = Array.isArray(items) ? items : [];
    const revisions = buildItemRevisionMap(list);
    const changed = [];

    for (const item of list) {
        const id = item?.id;
        // Id-less entries are repaired on import; always ship them.
        if (typeof id !== 'string' || !id) {
            changed.push(item);
            continue;
        }
        if (snapshot.items[id] !== revisions[id]) changed.push(item);
    }

    const liveIds = new Set(Object.keys(revisions));
    const removed = Object.keys(snapshot.items).filter((id) => !liveIds.has(id));

    return { changed, removed, revisions, snapshot };
}

/**
 * @param {object} pkg parsed backup package
 */
export function isNotesPatchPackage(pkg) {
    return !!pkg && typeof pkg === 'object' && pkg.kind === NOTES_PATCH_KIND;
}

/**
 * Merge a notes patch onto the current local database: upsert the patched
 * notes, drop the ids the patch reports as deleted, keep everything else.
 * Returns a database shaped like a legacy snapshot so the normal replace-style
 * import path can consume it unchanged.
 *
 * @param {object} currentDb current `matrix_database` payload (may be null)
 * @param {object} patch parsed notes patch package
 * @returns {object}
 */
export function mergeNotesPatchDatabase(currentDb, patch) {
    const current = currentDb && typeof currentDb === 'object' ? currentDb : {};
    const patchDb = patch?.matrix_database && typeof patch.matrix_database === 'object'
        ? patch.matrix_database
        : {};
    const patchItems = Array.isArray(patchDb.items)
        ? patchDb.items.filter((item) => item && typeof item === 'object')
        : [];
    const patchIds = new Set(patchItems.map((item) => item?.id).filter(Boolean));
    const removed = new Set(
        (Array.isArray(patch?.delta?.removed) ? patch.delta.removed : []).filter(Boolean)
    );
    const currentItems = Array.isArray(current.items) ? current.items : [];

    const kept = currentItems.filter((item) => {
        const id = item?.id;
        // Keep id-less entries: repairDatabase() owns their fate on load.
        if (typeof id !== 'string' || !id) return true;
        if (removed.has(id)) return false;
        return !patchIds.has(id);
    });

    return { ...current, ...patchDb, items: [...kept, ...patchItems] };
}
