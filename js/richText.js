/** @module {"owns":"rich text sanitize, linkify, strip markup", "related":["noteSurface.js","noteModel.js"]} */
const ALLOWED_TAGS = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'S', 'STRIKE', 'DEL', 'U', 'BR']);
const MARKUP_RE = /<(?:\/?)(?:a|b|strong|i|em|s|strike|del|u|br)\b/i;
// `URL_RE` is global for replace(); boolean tests use a non-global twin.
// `RegExp.test` on a /g pattern advances lastIndex, so reusing URL_RE inside
// hasRichMarkup made it alternate true/false across calls and flip note text
// and checklist rows between editable and read-only.
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const URL_TEST_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/i;

function escapeHtmlAttr(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

export function sanitizeHref(href) {
    if (!href || typeof href !== 'string') return '';
    const trimmed = href.trim();
    if (!trimmed) return '';
    let normalized = trimmed;
    if (/^www\./i.test(normalized)) normalized = `https://${normalized}`;
    try {
        const url = new URL(normalized, window.location.origin);
        const scheme = url.protocol.toLowerCase();
        if (scheme === 'http:' || scheme === 'https:' || scheme === 'mailto:') {
            return url.href;
        }
    } catch {
        return '';
    }
    return '';
}

export function hasRichMarkup(str) {
    if (!str || typeof str !== 'string') return false;
    return MARKUP_RE.test(str) || URL_TEST_RE.test(str);
}

export function stripRichText(html) {
    if (!html) return '';
    const raw = String(html);
    if (!/<[^>]+>/.test(raw)) return raw;
    const tpl = document.createElement('template');
    tpl.innerHTML = raw;
    return tpl.content.textContent || '';
}

function linkifyPlainText(text) {
    return String(text ?? '').replace(URL_RE, (match) => {
        const safe = sanitizeHref(match);
        if (!safe) return match;
        return `<a href="${escapeHtmlAttr(safe)}" target="_blank" rel="noopener noreferrer">${match}</a>`;
    });
}

function linkifyTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    for (const node of textNodes) {
        if (node.parentElement?.closest('a')) continue;
        const linked = linkifyPlainText(node.textContent);
        if (linked === node.textContent) continue;
        const tpl = document.createElement('template');
        tpl.innerHTML = linked;
        node.replaceWith(...tpl.content.childNodes);
    }
}

export function linkifyPlainUrls(html) {
    if (html == null) return '';
    const raw = String(html);
    if (!raw) return '';
    if (!/<[^>]+>/.test(raw)) return linkifyPlainText(raw);

    const tpl = document.createElement('template');
    tpl.innerHTML = raw;
    linkifyTextNodes(tpl.content);
    return tpl.innerHTML;
}

function walkNodes(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName;
    if (tag === 'BR') return '<br>';

    if (tag === 'A') {
        const href = sanitizeHref(node.getAttribute('href'));
        if (!href) return Array.from(node.childNodes).map(walkNodes).join('');
        const inner = Array.from(node.childNodes).map(walkNodes).join('');
        return `<a href="${escapeHtmlAttr(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    }

    if (ALLOWED_TAGS.has(tag)) {
        const inner = Array.from(node.childNodes).map(walkNodes).join('');
        return `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`;
    }

    // Chrome sometimes emits decoration via styled spans instead of <u>/<s>.
    if (tag === 'SPAN') {
        const deco = String(node.style?.textDecoration || node.getAttribute('style') || '').toLowerCase();
        const inner = Array.from(node.childNodes).map(walkNodes).join('');
        if (!inner) return '';
        if (/\bunderline\b/.test(deco)) return `<u>${inner}</u>`;
        if (/\bline-through\b/.test(deco)) return `<s>${inner}</s>`;
        return inner;
    }

    if (tag === 'DIV' || tag === 'P') {
        const parts = Array.from(node.childNodes).map(walkNodes).filter(Boolean);
        if (!parts.length) return '';
        return parts.join('<br>');
    }

    return Array.from(node.childNodes).map(walkNodes).join('');
}

export function sanitizeRichHtml(html) {
    if (html == null) return '';
    const raw = String(html);
    if (!raw) return '';
    if (!/<[^>]+>/.test(raw)) return linkifyPlainText(raw);

    const tpl = document.createElement('template');
    tpl.innerHTML = raw;
    let out = Array.from(tpl.content.childNodes).map(walkNodes).join('');
    // Strip leading/trailing <br> only (contenteditable placeholders / pasted blanks).
    // Mid-content soft breaks between real text are preserved.
    out = out.replace(/^(?:\s*<br>)+/i, '').replace(/(?:<br>\s*)+$/i, '');
    return linkifyPlainUrls(out);
}

export function richFieldIsEmpty(html) {
    return !stripRichText(html || '').trim();
}
