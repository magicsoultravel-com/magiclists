const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'S', 'STRIKE', 'DEL', 'BR']);
const MARKUP_RE = /<(?:\/?)(?:b|strong|i|em|s|strike|del|br)\b/i;

export function hasRichMarkup(str) {
    if (!str || typeof str !== 'string') return false;
    return MARKUP_RE.test(str);
}

export function stripRichText(html) {
    if (!html) return '';
    const raw = String(html);
    if (!/<[^>]+>/.test(raw)) return raw;
    const tpl = document.createElement('template');
    tpl.innerHTML = raw;
    return tpl.content.textContent || '';
}

function walkNodes(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName;
    if (tag === 'BR') return '<br>';

    if (ALLOWED_TAGS.has(tag)) {
        const inner = Array.from(node.childNodes).map(walkNodes).join('');
        return `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`;
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
    if (!/<[^>]+>/.test(raw)) return raw;

    const tpl = document.createElement('template');
    tpl.innerHTML = raw;
    let out = Array.from(tpl.content.childNodes).map(walkNodes).join('');
    out = out.replace(/(?:<br>\s*)+$/i, '');
    return out;
}

export function richFieldIsEmpty(html) {
    return !stripRichText(html || '').trim();
}
