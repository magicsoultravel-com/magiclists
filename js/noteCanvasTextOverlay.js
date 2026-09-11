/** @module {"owns":"non-editable note text overlay for note-canvas bg / preview", "related":["drawingBoard.js","noteCanvasRenderer.js","noteBodyConversion.js"]} */
import {
    PAGE_FORMATS,
    addPage,
    expandInfiniteBounds,
    getActivePage,
    getPageDimensions
} from './canvasDocument.js';
import {
    itemToNoteCanvasOverlayText,
    itemToPlainContentText,
    itemToPlainActiveChecklistText,
    migrateNoteCanvasTextFlags
} from './noteBodyConversion.js';

export { migrateNoteCanvasTextFlags };

const PAD = 48;
const FONT_SIZE = 20;
const LINE_HEIGHT = 1.35;
const FONT = `${FONT_SIZE}px system-ui, -apple-system, "Segoe UI", sans-serif`;
const LINE_STEP = FONT_SIZE * LINE_HEIGHT;
const GROW_MARGIN = 80;

function parseCssColor(input) {
    if (!input || typeof input !== 'string') return null;
    const s = input.trim();
    if (s.startsWith('#')) {
        let hex = s.slice(1);
        if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
        if (hex.length !== 6) return null;
        const n = Number.parseInt(hex, 16);
        if (!Number.isFinite(n)) return null;
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (m) return { r: +m[1], g: +m[2], b: +m[3] };
    return null;
}

function relativeLuminance({ r, g, b }) {
    const linear = [r, g, b].map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/**
 * Ink color that contrasts with a note / canvas fill.
 * @param {string} bgColor
 * @returns {string}
 */
export function contrastInkForBackground(bgColor) {
    const rgb = parseCssColor(bgColor);
    if (!rgb) return 'rgba(236, 236, 241, 0.78)';
    return relativeLuminance(rgb) > 0.55
        ? 'rgba(18, 18, 24, 0.72)'
        : 'rgba(236, 236, 241, 0.78)';
}

function wrapLine(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const lines = [];
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
        const next = `${current} ${words[i]}`;
        if (ctx.measureText(next).width <= maxWidth) {
            current = next;
        } else {
            lines.push(current);
            current = words[i];
        }
    }
    lines.push(current);
    return lines;
}

function wrapPlainText(ctx, text, maxWidth) {
    const out = [];
    const paragraphs = String(text || '').replace(/\r\n/g, '\n').split('\n');
    for (const para of paragraphs) {
        if (!para.trim()) {
            out.push('');
            continue;
        }
        out.push(...wrapLine(ctx, para, maxWidth));
    }
    return out;
}

function makeMeasureCtx() {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    return canvas.getContext('2d');
}

/** A4 column width used for readable copy-paper layout. */
export function noteTextColumnWidth() {
    return Math.max(80, PAGE_FORMATS.a4.width - PAD * 2);
}

/** Whether either copy-paper layer is enabled on the note. */
export function noteHasTextOverlayEnabled(item) {
    migrateNoteCanvasTextFlags(item);
    return !!(item?.canvasShowNoteContent || item?.canvasShowNoteChecklist);
}

/**
 * Build overlay plain text (+ optional empty placeholder) from note flags.
 * @param {object} item
 * @returns {{ text: string, isPlaceholder: boolean }}
 */
export function resolveNoteOverlayPlainText(item) {
    migrateNoteCanvasTextFlags(item);
    const showContent = !!item?.canvasShowNoteContent;
    const showChecklist = !!item?.canvasShowNoteChecklist;
    if (!showContent && !showChecklist) return { text: '', isPlaceholder: false };

    const plain = itemToNoteCanvasOverlayText(item, {
        content: showContent,
        checklist: showChecklist
    }).trim();
    if (plain) return { text: plain, isPlaceholder: false };

    const missing = [];
    if (showContent && !itemToPlainContentText(item).trim()) missing.push('content');
    if (showChecklist && !itemToPlainActiveChecklistText(item).trim()) missing.push('checklist');
    if (!missing.length) return { text: '', isPlaceholder: false };
    return {
        text: `No ${missing.join(' or ')} text yet — add it in the note editor.`,
        isPlaceholder: true
    };
}

/**
 * Measure wrapped overlay lines for the note.
 * @param {object} item
 * @param {CanvasRenderingContext2D} [ctx]
 */
export function measureNoteTextOverlay(item, ctx = null) {
    const measureCtx = ctx || makeMeasureCtx();
    const columnWidth = noteTextColumnWidth();
    const { text, isPlaceholder } = resolveNoteOverlayPlainText(item);
    if (!text || !measureCtx) {
        return {
            lines: [],
            lineStep: LINE_STEP,
            pad: PAD,
            columnWidth,
            textHeight: 0,
            isPlaceholder: false
        };
    }
    measureCtx.font = FONT;
    const lines = wrapPlainText(measureCtx, text, columnWidth);
    return {
        lines,
        lineStep: LINE_STEP,
        pad: PAD,
        columnWidth,
        textHeight: PAD * 2 + lines.length * LINE_STEP,
        isPlaceholder
    };
}

function pageContentHeight(doc) {
    const dims = getPageDimensions(doc);
    return Math.max(LINE_STEP, dims.height - PAD * 2);
}

function linesPerPage(doc) {
    return Math.max(1, Math.floor(pageContentHeight(doc) / LINE_STEP));
}

/**
 * Grow infinite bounds or add pages so overlay text fits.
 * @param {object} doc
 * @param {object} item
 * @returns {boolean}
 */
export function ensureCanvasFitsNoteText(doc, item) {
    if (!doc || !noteHasTextOverlayEnabled(item)) return false;
    const measured = measureNoteTextOverlay(item);
    if (!measured.lines.length) return false;

    let changed = false;
    const needX = PAGE_FORMATS.a4.width + GROW_MARGIN;
    const needY = measured.textHeight + GROW_MARGIN;

    if (doc.canvasMode === 'infinite') {
        if (!doc.infinite?.bounds) return false;
        const before = { ...doc.infinite.bounds };
        expandInfiniteBounds(doc, needX, needY, GROW_MARGIN);
        const b = doc.infinite.bounds;
        if (b.maxX < needX) {
            b.maxX = needX;
            changed = true;
        }
        if (b.maxY < needY) {
            b.maxY = needY;
            changed = true;
        }
        changed = changed
            || before.maxX !== b.maxX
            || before.maxY !== b.maxY
            || before.minX !== b.minX
            || before.minY !== b.minY;
        return changed;
    }

    const perPage = linesPerPage(doc);
    const pagesNeeded = Math.max(1, Math.ceil(measured.lines.length / perPage));
    while ((doc.pages?.length || 0) < pagesNeeded) {
        addPage(doc);
        changed = true;
    }
    return changed;
}

/**
 * Estimate world bounds occupied by the overlay (for preview fit).
 * @param {object} item
 */
export function estimateNoteTextOverlayBounds(item) {
    if (!noteHasTextOverlayEnabled(item)) return null;
    const measured = measureNoteTextOverlay(item);
    if (!measured.lines.length) return null;
    return {
        minX: 0,
        minY: 0,
        maxX: PAGE_FORMATS.a4.width,
        maxY: measured.textHeight
    };
}

function paintLines(ctx, lines, { fillColor, isPlaceholder } = {}) {
    ctx.save();
    ctx.font = FONT;
    ctx.textBaseline = 'top';
    ctx.fillStyle = contrastInkForBackground(fillColor);
    if (isPlaceholder) ctx.globalAlpha = 0.42;
    let y = PAD;
    for (const line of lines) {
        if (line) ctx.fillText(line, PAD, y);
        y += LINE_STEP;
    }
    ctx.restore();
}

/**
 * Paint non-editable note text as copy-paper on a canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} item
 * @param {{ fillColor?: string, doc?: object, pageIndex?: number }} [opts]
 */
export function paintNoteTextOverlay(ctx, item, { fillColor = '', doc = null, pageIndex = 0 } = {}) {
    if (!ctx || !item || !noteHasTextOverlayEnabled(item)) return;
    const measured = measureNoteTextOverlay(item, ctx);
    if (!measured.lines.length) return;

    let lines = measured.lines;
    if (doc && doc.canvasMode !== 'infinite') {
        const perPage = linesPerPage(doc);
        const start = Math.max(0, pageIndex) * perPage;
        lines = measured.lines.slice(start, start + perPage);
    }
    if (!lines.length) return;
    paintLines(ctx, lines, {
        fillColor,
        isPlaceholder: measured.isPlaceholder
    });
}

/** Active page index for paged overlay painting. */
export function activePageIndex(doc) {
    if (!doc?.pages?.length) return 0;
    const page = getActivePage(doc);
    const idx = doc.pages.findIndex((p) => p.id === page?.id);
    return idx >= 0 ? idx : 0;
}
