import { readDocument, getActivePage, PAGE_FORMATS } from './canvasDocument.js';
import { renderBackground } from './canvasBackgrounds.js';
import { drawBrushStroke, drawShapeStroke, drawTextObject } from './canvasBrushes.js';

function renderStrokesToContext(ctx, strokes, texts) {
    strokes.forEach((s) => {
        if (s.tool === 'brush') drawBrushStroke(ctx, s);
        else if (s.tool === 'text') drawTextObject(ctx, s);
        else drawShapeStroke(ctx, s);
    });
    (texts || []).forEach((t) => drawTextObject(ctx, t));
}

function renderPageToCanvas(page, doc) {
    const fmt = PAGE_FORMATS[page.format] || PAGE_FORMATS.a4;
    const canvas = document.createElement('canvas');
    canvas.width = fmt.width;
    canvas.height = fmt.height;
    const ctx = canvas.getContext('2d');
    const bg = doc.canvasMode === 'infinite' ? (doc.infinite.background || 'blank') : (page.background || 'blank');
    renderBackground(ctx, bg, fmt.width, fmt.height);
    const strokes = doc.canvasMode === 'infinite' ? doc.infinite.strokes : (page.strokes || []);
    const texts = doc.canvasMode === 'infinite' ? doc.infinite.texts : (page.texts || []);
    renderStrokesToContext(ctx, strokes, texts);
    return canvas;
}

export function exportCanvasJson() {
    const doc = readDocument();
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `magicCanvas_${Math.floor(Date.now() / 1000)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
}

export function exportCanvasPng({ allPages = false } = {}) {
    const doc = readDocument();
    if (allPages && doc.canvasMode !== 'infinite' && doc.pages.length > 1) {
        const fmt = PAGE_FORMATS[doc.pages[0]?.format] || PAGE_FORMATS.a4;
        const out = document.createElement('canvas');
        out.width = fmt.width;
        out.height = fmt.height * doc.pages.length;
        const ctx = out.getContext('2d');
        doc.pages.forEach((page, i) => {
            const c = renderPageToCanvas(page, { ...doc, canvasMode: page.format ? doc.canvasMode : 'a4', activePageId: page.id });
            ctx.drawImage(c, 0, i * fmt.height);
        });
        downloadCanvas(out, 'magicCanvas_pages.png');
        return;
    }
    const page = getActivePage(doc);
    const c = renderPageToCanvas(page, doc);
    downloadCanvas(c, 'magicCanvas.png');
}

export function exportCanvasPdf() {
    const doc = readDocument();
    const pages = doc.canvasMode === 'infinite'
        ? [{ ...getActivePage(doc), strokes: doc.infinite.strokes, texts: doc.infinite.texts }]
        : doc.pages;
    const images = pages.map((page) => {
        const c = renderPageToCanvas(page, doc);
        return c.toDataURL('image/png');
    });
    const win = window.open('', '_blank');
    if (!win) {
        alert('Allow pop-ups to export PDF via print dialog.');
        return;
    }
    win.document.write(`<!DOCTYPE html><html><head><title>magicCanvas export</title>
        <style>body{margin:0}img{display:block;width:100%;page-break-after:always}@media print{img{page-break-after:always}}</style>
        </head><body>${images.map((src) => `<img src="${src}" alt="page">`).join('')}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
}

function downloadCanvas(canvas, filename) {
    canvas.toBlob((blob) => {
        if (!blob) return;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }, 'image/png');
}
