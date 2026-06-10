export function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function countryFlagEmoji(code) {
    if (!code || typeof code !== 'string' || code.length !== 2) return '🌐';
    const upper = code.toUpperCase();
    if (!/^[A-Z]{2}$/.test(upper)) return '🌐';
    return String.fromCodePoint(
        ...[...upper].map((char) => 0x1F1E6 + char.charCodeAt(0) - 65)
    );
}

export function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}
