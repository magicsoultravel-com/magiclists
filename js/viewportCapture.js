/** @module {"owns":"best-effort viewport PNG capture for scribble copy", "related":["quickScribble.js","clipboard.js"]} */

/**
 * Collect CSS text from same-origin stylesheets (cross-origin sheets are skipped).
 * @returns {string}
 */
function collectDocumentCss() {
    let css = '';
    const sheets = document.styleSheets || [];
    for (let i = 0; i < sheets.length; i += 1) {
        const sheet = sheets[i];
        try {
            const rules = sheet.cssRules || sheet.rules;
            if (!rules) continue;
            for (let j = 0; j < rules.length; j += 1) {
                css += `${rules[j].cssText}\n`;
            }
        } catch {
            // Cross-origin stylesheet — ignore.
        }
    }
    return css;
}

/**
 * Capture the visible viewport as a PNG blob (DOM foreignObject + optional overlay canvas).
 * Best-effort: complex CSS, cross-origin media, and some filters may not render perfectly.
 *
 * @param {{
 *   exclude?: Element|null,
 *   overlayCanvas?: HTMLCanvasElement|null,
 *   hideDuringCapture?: Element|null
 * }} [opts]
 * @returns {Promise<Blob|null>}
 */
export async function captureViewportPngBlob(opts = {}) {
    const exclude = opts.exclude || null;
    const hideEl = opts.hideDuringCapture || null;
    const overlay = opts.overlayCanvas || null;

    const w = Math.max(1, Math.round(window.innerWidth || document.documentElement?.clientWidth || 1));
    const h = Math.max(1, Math.round(window.innerHeight || document.documentElement?.clientHeight || 1));
    const dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    const scrollX = window.scrollX || document.documentElement?.scrollLeft || 0;
    const scrollY = window.scrollY || document.documentElement?.scrollTop || 0;

    const prevVisibility = hideEl ? hideEl.style.visibility : null;
    if (hideEl) hideEl.style.visibility = 'hidden';

    try {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const cssText = collectDocumentCss();
        const body = document.body;
        const bodyClone = body.cloneNode(true);
        bodyClone.querySelectorAll('script, noscript').forEach((el) => el.remove());
        if (exclude?.id) {
            bodyClone.querySelector(`#${CSS.escape(exclude.id)}`)?.remove();
        }
        bodyClone.querySelectorAll('[data-qs-chrome]').forEach((el) => el.remove());

        const bodyStyle = getComputedStyle(body);
        const htmlStyle = getComputedStyle(document.documentElement);
        const bg = bodyStyle.backgroundColor || htmlStyle.backgroundColor || '#ffffff';

        const xhtml = [
            '<div xmlns="http://www.w3.org/1999/xhtml"',
            ` style="width:${w}px;height:${h}px;overflow:hidden;margin:0;padding:0;background:${bg};">`,
            `<style>${cssText.replace(/<\/style>/gi, '<\\/style>')}</style>`,
            `<div style="position:relative;width:${Math.max(body.scrollWidth, w)}px;height:${Math.max(body.scrollHeight, h)}px;transform:translate(${-scrollX}px,${-scrollY}px);transform-origin:0 0;">`,
            bodyClone.innerHTML,
            '</div></div>'
        ].join('');

        const svg = [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`,
            `<foreignObject x="0" y="0" width="${w}" height="${h}">`,
            xhtml,
            '</foreignObject></svg>'
        ].join('');

        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
        let img = null;
        try {
            img = await loadImage(url);
        } catch {
            img = null;
        } finally {
            URL.revokeObjectURL(url);
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        if (img) {
            try {
                ctx.drawImage(img, 0, 0, w, h);
            } catch { /* tainted */ }
        }

        if (overlay && overlay.width && overlay.height) {
            try {
                ctx.drawImage(overlay, 0, 0, w, h);
            } catch { /* ignore */ }
        }

        return await canvasToPngBlob(canvas);
    } catch {
        if (!overlay) return null;
        try {
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(overlay, 0, 0, w, h);
            return await canvasToPngBlob(canvas);
        } catch {
            return null;
        }
    } finally {
        if (hideEl) hideEl.style.visibility = prevVisibility || '';
    }
}

/**
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('viewport image load failed'));
        img.src = url;
    });
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Blob|null>}
 */
function canvasToPngBlob(canvas) {
    return new Promise((resolve) => {
        try {
            canvas.toBlob((blob) => resolve(blob || null), 'image/png');
        } catch {
            resolve(null);
        }
    });
}
