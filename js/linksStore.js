/**
 * @module {"owns":"links localStorage CRUD, dedup rejection, device-local preview ids, link change events","related":["linksModel.js","backup.js","sync.js","sidebarLinks.js","linksOverlay.js"],"events":["links:changed","links:previews_changed"]}
 */
import {
    LINKS_SCHEMA_VERSION,
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
    return { version: LINKS_SCHEMA_VERSION, updatedAt: 0, links: [] };
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
    emit(LINKS_CHANGED_EVENT, { links: payload.links, updatedAt: payload.updatedAt });
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
        links: normalized.links
    };
    if (!persistPayload(payload)) return false;
    pruneLinkPreviewIds(payload.links.map((link) => link.id));
    return true;
}

/**
 * Add a link at the top of the list.
 * @param {{ url: string, title?: string }} input
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

    const link = normalizeLinkRecord({
        url: normalized.url,
        title: input?.title,
        createdAt: now,
        updatedAt: now
    }, { now });
    if (!link) return { ok: false, error: 'Enter a valid http(s) URL.' };

    const next = {
        version: LINKS_SCHEMA_VERSION,
        updatedAt: now,
        links: [link, ...payload.links]
    };
    if (!persistPayload(next)) {
        return { ok: false, error: 'Could not save the link (storage may be full).' };
    }
    return { ok: true, link };
}

/**
 * Update a link's title and/or URL. URL edits are re-validated and checked
 * against every other link's dedup key.
 *
 * @param {string} id
 * @param {{ title?: string, url?: string }} patch
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

    const nextLink = normalizeLinkRecord({
        ...existing,
        url: normalized.url,
        title: patch.title !== undefined ? patch.title : existing.title,
        updatedAt: now
    }, { now });
    if (!nextLink) return { ok: false, error: 'Enter a valid http(s) URL.' };

    if (nextLink.url === existing.url && nextLink.title === existing.title) {
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
        version: LINKS_SCHEMA_VERSION,
        updatedAt: Date.now(),
        links: nextLinks
    });
    if (!written) return false;
    pruneLinkPreviewIds(nextLinks.map((link) => link.id));
    return true;
}

/**
 * Delete every saved link and clear all screenshot opt-ins.
 * @returns {number} number of removed links
 */
export function clearAllLinks() {
    const payload = readLinks();
    if (!payload.links.length) {
        clearLinkPreviewIds();
        return 0;
    }
    const written = persistPayload({
        version: LINKS_SCHEMA_VERSION,
        updatedAt: Date.now(),
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
    if (!Array.isArray(section.links)) return false;
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

