export function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(str) {
    return escapeHTML(str).replace(/"/g, '&quot;');
}

export function escapeQuotes(str) {
    return str ? String(str).replace(/"/g, '&quot;') : '';
}
