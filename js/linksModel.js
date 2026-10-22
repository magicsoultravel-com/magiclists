/**
 * @module {"owns":"pure link URL normalization, dedup keys, display/thumb helpers, favicon cache-busting and manual/name/date sorting","related":["linksStore.js","linksOverlay.js","sidebarLinks.js","backupDelta.js"],"notes":"DOM-free except bindLinkThumbFallbacks; no storage access"}
 */
import { escapeAttr, escapeHTML } from './domEscape.js';

/** Persisted link collection schema version. */
export const LINKS_SCHEMA_VERSION = 1;
/** Maximum stored URL length (characters). */
export const LINK_URL_MAX = 2048;
/** Maximum stored title length (characters). */
export const LINK_TITLE_MAX = 120;
/** Sidebar renders at most this many tiles; the manager always shows all. */
export const LINKS_SIDEBAR_LIMIT = 60;

/** Third-party screenshot service used only after explicit user opt-in. */
export const LINK_SCREENSHOT_SERVICE = 'https://image.thum.io';

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const LINK_SORT_MODES = new Set(['manual', 'name-asc', 'name-desc', 'date-desc', 'date-asc']);

function urlKeyFor(url) {
    // Host is already lowercased by the URL parser (including its port).
    // Path and query stay byte-for-byte; fragment and protocol are ignored.
    return `${url.host.toLowerCase()}${url.pathname}${url.search}`;
}

/**
 * Normalize a user-entered URL. Bare domains get an https:// prefix; only
 * http(s) URLs are accepted. The stored URL keeps its protocol and fragment —
 * the fragment is ignored only by the dedup key.
 *
 * @param {string} raw
 * @returns {{ ok: true, url: string, key: string, host: string, hostname: string, origin: string } | { ok: false, error: string }}
 */
export function normalizeLinkUrl(raw) {
    const input = String(raw ?? '').trim();
    if (!input) return { ok: false, error: 'Enter a URL.' };
    if (input.length > LINK_URL_MAX) {
        return { ok: false, error: `URL is too long (max ${LINK_URL_MAX} characters).` };
    }

    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
    if (hasScheme && !/^https?:\/\//i.test(input)) {
        return { ok: false, error: 'Only http:// and https:// links are supported.' };
    }

    let url;
    try {
        url = new URL(hasScheme ? input : `https://${input}`);
    } catch {
        return { ok: false, error: 'Enter a valid http(s) URL.' };
    }

    if (!HTTP_PROTOCOLS.has(url.protocol) || !url.hostname) {
        return { ok: false, error: 'Enter a valid http(s) URL.' };
    }
    if (url.username || url.password) {
        return { ok: false, error: 'URLs with a username or password are not supported.' };
    }
    if (url.href.length > LINK_URL_MAX) {
        return { ok: false, error: `URL is too long (max ${LINK_URL_MAX} characters).` };
    }

    return {
        ok: true,
        url: url.href,
        key: urlKeyFor(url),
        host: url.host,
        hostname: url.hostname,
        origin: url.origin
    };
}

/**
 * Dedup key for a URL: lowercase host + pathname + search. Protocol, fragment
 * and a manually typed trailing slash are deliberately left alone (the URL
 * parser only adds `/` for an empty path, so `/a` and `/a/` remain distinct).
 *
 * @param {string} raw
 * @returns {string} key, or '' when the URL is invalid
 */
export function buildLinkUrlKey(raw) {
    const normalized = normalizeLinkUrl(raw);
    return normalized.ok ? normalized.key : '';
}

/** @param {number} [now] */
export function createLinkId(now = Date.now()) {
    return `link_${now}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Coerce one stored/imported record into the canonical shape.
 *
 * @param {object} record
 * @param {{ now?: number }} [opts]
 * @returns {{ id: string, url: string, title: string, createdAt: number, updatedAt: number } | null}
 */
export function normalizeLinkRecord(record, opts = {}) {
    if (!record || typeof record !== 'object') return null;
    const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    const normalized = normalizeLinkUrl(record.url);
    if (!normalized.ok) return null;

    const rawId = typeof record.id === 'string' ? record.id.trim() : '';
    const id = rawId && rawId.length <= 80 ? rawId : createLinkId(now);
    const createdAt = Number(record.createdAt);
    const updatedAt = Number(record.updatedAt);

    return {
        id,
        url: normalized.url,
        title: String(record.title ?? '').trim().slice(0, LINK_TITLE_MAX),
        createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : now,
        updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : now
    };
}

/**
 * Normalize a stored payload (`{ version, updatedAt, links }`), a raw links
 * array, or a backup section. Duplicate dedup keys are dropped (first wins);
 * duplicate ids are regenerated so the list remains addressable.
 *
 * @param {unknown} raw
 * @param {{ now?: number }} [opts]
 * @returns {{ version: number, updatedAt: number, links: Array<object> }}
 */
export function normalizeLinksPayload(raw, opts = {}) {
    const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    const source = Array.isArray(raw)
        ? raw
        : (Array.isArray(raw?.links) ? raw.links : []);
    const links = [];
    const seenKeys = new Set();
    const seenIds = new Set();

    for (const entry of source) {
        const link = normalizeLinkRecord(entry, { now });
        if (!link) continue;
        const key = buildLinkUrlKey(link.url);
        if (!key || seenKeys.has(key)) continue;
        if (seenIds.has(link.id)) link.id = createLinkId(now);
        seenKeys.add(key);
        seenIds.add(link.id);
        links.push(link);
    }

    const rawUpdatedAt = Number(raw?.updatedAt);
    return {
        version: LINKS_SCHEMA_VERSION,
        updatedAt: Number.isFinite(rawUpdatedAt) && rawUpdatedAt > 0 ? rawUpdatedAt : 0,
        links
    };
}

/** Title shown on tiles and in the manager. */
export function linkDisplayTitle(link) {
    const title = String(link?.title ?? '').trim();
    if (title) return title;
    const normalized = normalizeLinkUrl(link?.url);
    if (!normalized.ok) return 'Link';
    return normalized.hostname.replace(/^www\./i, '') || 'Link';
}

/** Host label without a leading `www.` (keeps a non-default port). */
export function linkHostLabel(link) {
    const normalized = normalizeLinkUrl(link?.url);
    if (!normalized.ok) return '';
    return normalized.host.replace(/^www\./i, '') || normalized.host;
}

/** URL label without the protocol (keeps path/query/fragment). */
export function linkUrlLabel(link) {
    const normalized = normalizeLinkUrl(link?.url);
    if (!normalized.ok) return '';
    return normalized.url.replace(/^https?:\/\//i, '');
}

/** Single fallback letter for the layered tile thumbnail. */
export function linkLetter(link) {
    const source = linkDisplayTitle(link).replace(/^www\./i, '');
    for (const char of Array.from(source)) {
        if (/[\p{L}\p{N}]/u.test(char)) return char.toLocaleUpperCase();
    }
    return '?';
}


/**
 * Direct-site favicon URL. No third-party favicon proxy: the browser requests
 * `<origin>/favicon.ico` from the linked site itself.
 */
export function linkFaviconUrl(link, opts = {}) {
    const normalized = normalizeLinkUrl(link?.url);
    if (!normalized.ok) return '';
    const token = opts.cacheBust == null ? '' : String(opts.cacheBust).trim();
    const suffix = token ? `?v=${encodeURIComponent(token)}` : '';
    return `${normalized.origin}/favicon.ico${suffix}`;
}

/**
 * thum.io screenshot URL for an opted-in link. The fragment is stripped so
 * the screenshot URL is stable, and the caller is responsible for never
 * rendering this before the user explicitly opts in.
 */
export function linkScreenshotUrl(link, opts = {}) {
    const normalized = normalizeLinkUrl(link?.url);
    if (!normalized.ok) return '';
    const width = Number.isFinite(Number(opts.width)) ? Math.max(120, Math.round(Number(opts.width))) : 640;
    const height = Number.isFinite(Number(opts.height)) ? Math.max(80, Math.round(Number(opts.height))) : 400;
    let target = normalized.url;
    try {
        const parsed = new URL(target);
        parsed.hash = '';
        target = parsed.href;
    } catch {
        /* normalizeLinkUrl already validated it */
    }
    return `${LINK_SCREENSHOT_SERVICE}/get/width/${width}/crop/${height}/noanimate/${target}`;
}

/**
 * Layered thumbnail markup: letter (always, underneath) → direct favicon →
 * optional thum.io screenshot overlay. Failed images add `is-failed` and the
 * lower layer stays visible.
 *
 * @param {object} link
 * @param {{ showScreenshot?: boolean, modifier?: string, faviconCacheBust?: string|number }} [opts]
 */
export function buildLinkThumbHtml(link, opts = {}) {
    const modifier = opts.modifier ? ` link-thumb--${escapeAttr(String(opts.modifier))}` : '';
    const letter = escapeHTML(linkLetter(link));
    const favicon = linkFaviconUrl(link, { cacheBust: opts.faviconCacheBust });
    const screenshot = opts.showScreenshot ? linkScreenshotUrl(link) : '';

    return `<span class="link-thumb${modifier}" aria-hidden="true">
        <span class="link-thumb__letter">${letter}</span>
        ${favicon ? `<img class="link-thumb__favicon" data-link-thumb-favicon src="${escapeAttr(favicon)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
        ${screenshot ? `<img class="link-thumb__screenshot" data-link-thumb-screenshot src="${escapeAttr(screenshot)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
    </span>`;
}

/**
 * Attach error fallbacks to every thumbnail image under `root`. Idempotent per
 * image so repeated refreshes do not stack listeners.
 *
 * @param {ParentNode|null} root
 */
export function bindLinkThumbFallbacks(root) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('img[data-link-thumb-favicon], img[data-link-thumb-screenshot]').forEach((img) => {
        if (img.dataset.linkThumbBound === '1') return;
        img.dataset.linkThumbBound = '1';
        img.addEventListener('error', () => {
            img.classList.add('is-failed');
            img.removeAttribute('src');
        });
    });
}

/** @param {string} [mode] */
export function normalizeLinkSort(mode) {
    return LINK_SORT_MODES.has(mode) ? mode : 'date-desc';
}

/**
 * Sort links for the sidebar and manager. Always returns a copy.
 * @param {Array<object>} [links]
 * @param {string} [mode]
 */
export function sortLinks(links, mode) {
    const list = Array.isArray(links) ? links.slice() : [];
    const sortMode = normalizeLinkSort(mode);
    if (sortMode === 'manual') return list;
    const [field, dir] = sortMode.split('-');
    const factor = dir === 'desc' ? -1 : 1;

    list.sort((a, b) => {
        if (field === 'date') {
            const at = Number(a?.createdAt || 0);
            const bt = Number(b?.createdAt || 0);
            if (at !== bt) return (at - bt) * factor;
        }
        const titleCompare = linkDisplayTitle(a).localeCompare(
            linkDisplayTitle(b),
            undefined,
            { sensitivity: 'base' }
        );
        if (titleCompare !== 0) return titleCompare * (field === 'name' ? factor : 1);
        return String(a?.id || '').localeCompare(String(b?.id || ''));
    });

    return list;
}

