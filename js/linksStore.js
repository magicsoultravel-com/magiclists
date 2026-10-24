/**
 * @module {"owns":"links localStorage CRUD, folder CRUD/moves, scoped manual reorder, dedup rejection, device-local preview ids, link change events","related":["linksModel.js","backup.js","sync.js","sidebarLinks.js","linksOverlay.js"],"events":["links:changed","links:previews_changed"]}
 */
import {
    LINKS_SCHEMA_VERSION,
    createFolderId,
    findFolderByName,
    normalizeFolderName,
    normalizeFolderRecord,
    normalizeLinkRecord,
    normalizeLinkUrl,
    normalizeLinksPayload
} from './linksModel.js';

/** Saved links ride the notes/content backup stream. */
export const LINKS_STORAGE_KEY = 'matrix_links';
/** Screenshot opt-ins are per device: never synced or backed up. */
export const LINKS_PREVIEW_IDS_KEY = 'matrix_links_preview_ids';
export const LINKS_CHANGED_EVENT = 'links:changed';
export const LINKS_PREVIEWS_CHANGED_EVENT = 'links:previews_changed';

function emit(name, detail) {
    if (typeof window === 'undefined' || !window.dispatchEvent) return;
    window.dispatchEvent(new CustomEvent(name, { detail }));
}

function parseStored(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function emptyPayload() {
    return { version: LINKS_SCHEMA_VERSION, updatedAt: 0, folders: [], links: [] };
}

/**
 * Validate a requested folder assignment. `undefined`, `null`, and '' mean
 * the root level; any other value must reference a folder in the payload.
 * @returns {{ ok: true, folderId: string|null } | { ok: false, error: string }}
 */
function resolveFolderTarget(payload, folderId) {
    if (folderId === undefined || folderId === null || folderId === '') {
        return { ok: true, folderId: null };
    }
    if (typeof folderId !== 'string') {
        return { ok: false, error: 'That folder no longer exists.' };
    }
    const folder = payload.folders.find((candidate) => candidate.id === folderId);
    if (!folder) return { ok: false, error: 'That folder no longer exists.' };
    return { ok: true, folderId: folder.id };
}

function inFolderScope(link, folderId) {
    const current = typeof link?.folderId === 'string' && link.folderId ? link.folderId : null;
    return current === (folderId || null);
}

/** Read + normalize the saved links collection. Never throws. */
export function readLinks() {
    const parsed = parseStored(LINKS_STORAGE_KEY);
    if (!parsed) return emptyPayload();
    return normalizeLinksPayload(parsed);
}

function persistPayload(payload) {
    try {
        localStorage.setItem(LINKS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
        return false;
    }
    emit(LINKS_CHANGED_EVENT, {
        links: payload.links,
        folders: payload.folders,
        updatedAt: payload.updatedAt
    });
    return true;
}

/**
 * Replace the whole collection from plain/imported data. Preview ids are
 * pruned against the incoming ids so stale device-local opt-ins cannot leak
 * onto a future link that reuses an id.
 *
 * @param {unknown} raw
 * @param {{ touch?: boolean, now?: number }} [opts]
 * @returns {boolean} true when written
 */
export function writeLinksPayload(raw, opts = {}) {
    const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    const normalized = normalizeLinksPayload(raw, { now });
    const payload = {
        version: LINKS_SCHEMA_VERSION,
        updatedAt: opts.touch === false ? normalized.updatedAt : now,
        folders: normalized.folders,
        links: normalized.links
    };
    if (!persistPayload(payload)) return false;
    pruneLinkPreviewIds(payload.links.map((link) => link.id));
    return true;
}

/**
 * Add a link at the top of its folder (or the root list).
 * @param {{ url: string, title?: string, folderId?: string|null }} input
 * @param {{ now?: number }} [opts]
 * @returns {{ ok: true, link: object } | { ok: false, error: string }}
 */
export function addLink(input, opts = {}) {
    const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    const normalized = normalizeLinkUrl(input?.url);
    if (!normalized.ok) return { ok: false, error: normalized.error };

    const payload = readLinks();
    if (payload.links.some((link) => normalizeLinkUrl(link.url).key === normalized.key)) {
        return { ok: false, error: 'That link is already saved.' };
    }

    const target = resolveFolderTarget(payload, input?.folderId);
    if (!target.ok) return { ok: false, error: target.error };

    const link = normalizeLinkRecord({
        url: normalized.url,
        title: input?.title,
        folderId: target.folderId,
        createdAt: now,
        updatedAt: now
    }, { now });
    if (!link) return { ok: false, error: 'Enter a valid http(s) URL.' };

    const next = {
        version: LINKS_SCHEMA_VERSION,
        updatedAt: now,
        folders: payload.folders,
        links: [link, ...payload.links]
    };
    if (!persistPayload(next)) {
        return { ok: false, error: 'Could not save the link (storage may be full).' };
    }
    return { ok: true, link };
}

/**
 * Update a link's title, URL, and/or folder. URL edits are re-validated and
 * checked against every other link's dedup key.
 *
 * @param {string} id
 * @param {{ title?: string, url?: string, folderId?: string|null }} patch
 * @param {{ now?: number }} [opts]
 * @returns {{ ok: true, link: object, unchanged?: boolean } | { ok: false, error: string }}
 */
export function updateLink(id, patch = {}, opts = {}) {
    if (!id) return { ok: false, error: 'Link not found.' };
    const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    const payload = readLinks();
    const existing = payload.links.find((link) => link.id === id);
    if (!existing) return { ok: false, error: 'Link not found.' };

    const normalized = normalizeLinkUrl(patch.url ?? existing.url);
    if (!normalized.ok) return { ok: false, error: normalized.error };

    const duplicate = payload.links.some((link) => {
        if (link.id === id) return false;
        const candidate = normalizeLinkUrl(link.url);
        return candidate.ok && candidate.key === normalized.key;
    });
    if (duplicate) return { ok: false, error: 'That link is already saved.' };

    let folderId = existing.folderId || null;
    if (patch.folderId !== undefined) {
        const target = resolveFolderTarget(payload, patch.folderId);
        if (!target.ok) return { ok: false, error: target.error };
        folderId = target.folderId;
    }

    const nextLink = normalizeLinkRecord({
        ...existing,
        url: normalized.url,
        title: patch.title !== undefined ? patch.title : existing.title,
        folderId,
        updatedAt: now
    }, { now });
    if (!nextLink) return { ok: false, error: 'Enter a valid http(s) URL.' };

    if (
        nextLink.url === existing.url
        && nextLink.title === existing.title
        && nextLink.folderId === (existing.folderId || null)
    ) {
        return { ok: true, link: existing, unchanged: true };
    }

    const next = {
        ...payload,
        updatedAt: now,
        links: payload.links.map((link) => (link.id === id ? nextLink : link))
    };
    if (!persistPayload(next)) {
        return { ok: false, error: 'Could not save the link (storage may be full).' };
    }
    return { ok: true, link: nextLink };
}

/**
 * Persist a manual order for one level (the root list or a single folder).
 * This only reorders the existing records: per-link createdAt/updatedAt values
 * are never touched, so Date sorts keep their real chronology.
 *
 * The caller must pass the complete set of current ids for that level. Partial
 * orders are rejected rather than merged, because a reorder can originate from
 * a stale snapshot after another tab changed the collection.
 *
 * @param {string[]} orderedIds
 * @param {{ now?: number, folderId?: string|null }} [opts]
 * @returns {{ ok: true, changed: boolean } | { ok: false, error: string }}
 */
export function reorderLinks(orderedIds, opts = {}) {
    const payload = readLinks();
    const target = resolveFolderTarget(payload, opts.folderId);
    if (!target.ok) return { ok: false, error: target.error };
    if (!Array.isArray(orderedIds)) {
        return { ok: false, error: 'Link order is out of date. Refresh and try again.' };
    }
    const scopeLinks = payload.links.filter((link) => inFolderScope(link, target.folderId));
    const currentIds = scopeLinks.map((link) => link.id);
    if (orderedIds.length !== currentIds.length) {
        return { ok: false, error: 'Link order is out of date. Refresh and try again.' };
    }
    const known = new Set(currentIds);
    const seen = new Set();
    for (const id of orderedIds) {
        if (typeof id !== 'string' || !known.has(id) || seen.has(id)) {
            return { ok: false, error: 'Link order is out of date. Refresh and try again.' };
        }
        seen.add(id);
    }
    if (orderedIds.every((id, index) => id === currentIds[index])) {
        return { ok: true, changed: false };
    }

    const byId = new Map(scopeLinks.map((link) => [link.id, link]));
    const orderedScoped = orderedIds.map((id) => byId.get(id));
    let scopedIndex = 0;
    const nextLinks = payload.links.map((link) => (
        inFolderScope(link, target.folderId) ? orderedScoped[scopedIndex++] : link
    ));
    const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    const next = {
        ...payload,
        updatedAt: now,
        links: nextLinks
    };
    if (!persistPayload(next)) {
        return { ok: false, error: 'Could not save the link order (storage may be full).' };
    }
    return { ok: true, changed: true };
}
/**
 * Create a folder at the end of the folder order.
 * @param {string} name
 * @param {{ now?: number }} [opts]
 * @returns {{ ok: true, folder: object } | { ok: false, error: string }}
 */
export function createFolder(name, opts = {}) {
    const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    const normalizedName = normalizeFolderName(name);
    if (!normalizedName) return { ok: false, error: 'Enter a folder name.' };

    const payload = readLinks();
    if (findFolderByName(payload.folders, normalizedName)) {
        return { ok: false, error: 'A folder with that name already exists.' };
    }

    const folder = normalizeFolderRecord({
        id: createFolderId(now),
        name: normalizedName,
        createdAt: now,
        updatedAt: now
    }, { now });
    if (!folder) return { ok: false, error: 'Enter a folder name.' };

    const next = {
        ...payload,
        updatedAt: now,
        folders: [...payload.folders, folder]
    };
    if (!persistPayload(next)) {
        return { ok: false, error: 'Could not save the folder (storage may be full).' };
    }
    return { ok: true, folder };
}

/**
 * Rename an existing folder. Names stay unique case-insensitively.
 * @param {string} id
 * @param {string} name
 * @param {{ now?: number }} [opts]
 * @returns {{ ok: true, folder: object, unchanged?: boolean } | { ok: false, error: string }}
 */
export function renameFolder(id, name, opts = {}) {
    if (!id) return { ok: false, error: 'Folder not found.' };
    const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    const normalizedName = normalizeFolderName(name);
    if (!normalizedName) return { ok: false, error: 'Enter a folder name.' };

    const payload = readLinks();
    const existing = payload.folders.find((folder) => folder.id === id);
    if (!existing) return { ok: false, error: 'Folder not found.' };
    if (findFolderByName(payload.folders, normalizedName, id)) {
        return { ok: false, error: 'A folder with that name already exists.' };
    }
    if (normalizedName === existing.name) {
        return { ok: true, folder: existing, unchanged: true };
    }

    const folder = { ...existing, name: normalizedName, updatedAt: now };
    const next = {
        ...payload,
        updatedAt: now,
        folders: payload.folders.map((entry) => (entry.id === id ? folder : entry))
    };
    if (!persistPayload(next)) {
        return { ok: false, error: 'Could not save the folder (storage may be full).' };
    }
    return { ok: true, folder };
}

/**
 * Delete a folder, returning its links to the root level instead of deleting
 * them. Link timestamps are preserved so date sorts stay stable.
 *
 * @param {string} id
 * @param {{ now?: number }} [opts]
 * @returns {{ ok: true, folder: object, movedLinks: number } | { ok: false, error: string }}
 */
export function removeFolder(id, opts = {}) {
    if (!id) return { ok: false, error: 'Folder not found.' };
    const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    const payload = readLinks();
    const folder = payload.folders.find((entry) => entry.id === id);
    if (!folder) return { ok: false, error: 'Folder not found.' };

    let movedLinks = 0;
    const nextLinks = payload.links.map((link) => {
        if (link.folderId !== id) return link;
        movedLinks += 1;
        return { ...link, folderId: null };
    });
    const next = {
        ...payload,
        updatedAt: now,
        folders: payload.folders.filter((entry) => entry.id !== id),
        links: nextLinks
    };
    if (!persistPayload(next)) {
        return { ok: false, error: 'Could not delete the folder (storage may be full).' };
    }
    return { ok: true, folder, movedLinks };
}

/**
 * Move a link into a folder, or back to the root when `folderId` is null.
 * Organizational moves do not touch the link's timestamps.
 *
 * @param {string} linkId
 * @param {string|null} folderId
 * @param {{ now?: number }} [opts]
 * @returns {{ ok: true, changed: boolean, link: object } | { ok: false, error: string }}
 */
export function moveLinkToFolder(linkId, folderId, opts = {}) {
    if (!linkId) return { ok: false, error: 'Link not found.' };
    const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    const payload = readLinks();
    const existing = payload.links.find((link) => link.id === linkId);
    if (!existing) return { ok: false, error: 'Link not found.' };

    const target = resolveFolderTarget(payload, folderId);
    if (!target.ok) return { ok: false, error: target.error };
    if ((existing.folderId || null) === target.folderId) {
        return { ok: true, changed: false, link: existing };
    }

    const link = { ...existing, folderId: target.folderId };
    const next = {
        ...payload,
        updatedAt: now,
        links: payload.links.map((entry) => (entry.id === linkId ? link : entry))
    };
    if (!persistPayload(next)) {
        return { ok: false, error: 'Could not move the link (storage may be full).' };
    }
    return { ok: true, changed: true, link };
}

/**
 * Persist a manual order for the folder list. The caller must pass every
 * current folder id; partial orders are rejected.
 *
 * @param {string[]} orderedIds
 * @param {{ now?: number }} [opts]
 * @returns {{ ok: true, changed: boolean } | { ok: false, error: string }}
 */
export function reorderFolders(orderedIds, opts = {}) {
    const payload = readLinks();
    if (!Array.isArray(orderedIds)) {
        return { ok: false, error: 'Folder order is out of date. Refresh and try again.' };
    }
    const currentIds = payload.folders.map((folder) => folder.id);
    if (orderedIds.length !== currentIds.length) {
        return { ok: false, error: 'Folder order is out of date. Refresh and try again.' };
    }
    const known = new Set(currentIds);
    const seen = new Set();
    for (const id of orderedIds) {
        if (typeof id !== 'string' || !known.has(id) || seen.has(id)) {
            return { ok: false, error: 'Folder order is out of date. Refresh and try again.' };
        }
        seen.add(id);
    }
    if (orderedIds.every((id, index) => id === currentIds[index])) {
        return { ok: true, changed: false };
    }

    const byId = new Map(payload.folders.map((folder) => [folder.id, folder]));
    const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    const next = {
        ...payload,
        updatedAt: now,
        folders: orderedIds.map((id) => byId.get(id))
    };
    if (!persistPayload(next)) {
        return { ok: false, error: 'Could not save the folder order (storage may be full).' };
    }
    return { ok: true, changed: true };
}





/**
 * Delete one link and prune its device-local preview opt-in.
 * @param {string} id
 * @returns {boolean} true when a link was removed
 */
export function removeLink(id) {
    if (!id) return false;
    const payload = readLinks();
    const nextLinks = payload.links.filter((link) => link.id !== id);
    if (nextLinks.length === payload.links.length) return false;

    const written = persistPayload({
        ...payload,
        updatedAt: Date.now(),
        links: nextLinks
    });
    if (!written) return false;
    pruneLinkPreviewIds(nextLinks.map((link) => link.id));
    return true;
}

/**
 * Delete every saved link and folder, and clear all screenshot opt-ins.
 * @returns {number} number of removed links
 */
export function clearAllLinks() {
    const payload = readLinks();
    if (!payload.links.length && !payload.folders.length) {
        clearLinkPreviewIds();
        return 0;
    }
    const written = persistPayload({
        version: LINKS_SCHEMA_VERSION,
        updatedAt: Date.now(),
        folders: [],
        links: []
    });
    if (!written) return 0;
    clearLinkPreviewIds();
    return payload.links.length;
}

/**
 * Apply an imported `pkg.links` section. Invalid/missing sections are ignored
 * so old packages (which have no links field) leave the current list alone.
 *
 * @param {unknown} section
 * @returns {boolean} true when applied
 */
export function applyLinksBackupSection(section) {
    if (!section || typeof section !== 'object') return false;
    if (!Array.isArray(section.links) && !Array.isArray(section.folders)) return false;
    return writeLinksPayload(section, { touch: false });
}

/** Device-local screenshot opt-in ids, sanitized and unique. */
export function readPreviewIds() {
    const parsed = parseStored(LINKS_PREVIEW_IDS_KEY);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    const ids = [];
    for (const value of parsed) {
        if (typeof value !== 'string' || !value || seen.has(value)) continue;
        seen.add(value);
        ids.push(value);
    }
    return ids;
}

/** @param {string} id */
export function isLinkPreviewEnabled(id) {
    return !!id && readPreviewIds().includes(id);
}

/**
 * Persist the device-local screenshot opt-in set.
 * @param {Iterable<string>} ids
 * @returns {boolean} true when accepted (write failures are non-fatal)
 */
export function writePreviewIds(ids) {
    const next = [];
    const seen = new Set();
    for (const value of ids || []) {
        if (typeof value !== 'string' || !value || seen.has(value)) continue;
        seen.add(value);
        next.push(value);
    }
    const current = readPreviewIds();
    if (current.length === next.length && current.every((id, index) => id === next[index])) {
        return true;
    }
    try {
        localStorage.setItem(LINKS_PREVIEW_IDS_KEY, JSON.stringify(next));
    } catch {
        return false;
    }
    emit(LINKS_PREVIEWS_CHANGED_EVENT, { ids: next });
    return true;
}

/**
 * Opt one link into (or out of) the third-party screenshot preview. The UI is
 * responsible for confirming before enabling.
 *
 * @param {string} id
 * @param {boolean} enabled
 */
export function setLinkPreviewEnabled(id, enabled) {
    if (!id) return false;
    const ids = new Set(readPreviewIds());
    const has = ids.has(id);
    if (enabled && !has) ids.add(id);
    else if (!enabled && has) ids.delete(id);
    else return true;
    return writePreviewIds(ids);
}

/** Drop opt-ins whose link no longer exists. */
export function pruneLinkPreviewIds(validIds) {
    const valid = validIds instanceof Set ? validIds : new Set(validIds || []);
    const current = readPreviewIds();
    const next = current.filter((id) => valid.has(id));
    if (next.length === current.length) return false;
    return writePreviewIds(next);
}

/** Clear every screenshot opt-in on this device. */
export function clearLinkPreviewIds() {
    if (!readPreviewIds().length) {
        try {
            localStorage.removeItem(LINKS_PREVIEW_IDS_KEY);
        } catch {
            /* ignore */
        }
        return;
    }
    try {
        localStorage.removeItem(LINKS_PREVIEW_IDS_KEY);
    } catch {
        /* ignore */
    }
    emit(LINKS_PREVIEWS_CHANGED_EVENT, { ids: [] });
}

