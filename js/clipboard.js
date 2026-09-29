export async function copyPlainTextToClipboard(text) {
    const value = String(text ?? '');
    if (!value) return false;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch { /* fallback below */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}

/**
 * @param {Blob} blob
 * @returns {Promise<boolean>}
 */
export async function copyImageBlobToClipboard(blob) {
    if (!blob || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        return false;
    }
    try {
        const type = blob.type || 'image/png';
        await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
        return true;
    } catch {
        return false;
    }
}
