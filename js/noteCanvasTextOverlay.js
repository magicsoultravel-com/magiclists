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
    itemToActiveChecklistRows,
    migrateNoteCanvasTextFlags
} from './noteBodyConversion.js';

export { migrateNoteCanvasTextFlags };

const PAD = 48;
export const OVERLAY_FONT_DEFAULT = 20;
export const OVERLAY_FONT_MIN = 12;
export const OVERLAY_FONT_MAX = 48;
export const OVERLAY_FONT_STEP = 2;
const LINE_HEIGHT = 1.35;
const GROW_MARGIN = 80;
const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * Clamp / snap overlay font size for a note.
 * @param {object} [item]
 * @returns {number}
 */
export function resolveOverlayFontSize(item) {
    const n = Number(item?.canvasOverlayFontSize);
    const raw = Number.isFinite(n) ? n : OVERLAY_FONT_DEFAULT;
    const snapped = Math.round(raw / OVERLAY_FONT_STEP) * OVERLAY_FONT_STEP;
    return Math.min(OVERLAY_FONT_MAX, Math.max(OVERLAY_FONT_MIN, snapped));
}

/** Percent of default text height (100% = OVERLAY_FONT_DEFAULT). */
export function overlayFontSizeToPercent(fontSize) {
    const size = resolveOverlayFontSize({ canvasOverlayFontSize: fontSize });
    return Math.round((size / OVERLAY_FONT_DEFAULT) * 100);
}

/** Map a percent of default height back to a clamped font size. */
export function percentToOverlayFontSize(percent) {
    const n = Number(percent);
    const raw = Number.isFinite(n) ? (n / 100) * OVERLAY_FONT_DEFAULT : OVERLAY_FONT_DEFAULT;
    return resolveOverlayFontSize({ canvasOverlayFontSize: raw });
}

function overlayFont(fontSize) {
    return `${fontSize}px ${FONT_FAMILY}`;
}

function lineStepFor(fontSize) {
    return fontSize * LINE_HEIGHT;
}

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

function pushTextLines(out, ctx, text, columnWidth) {
    for (const line of wrapPlainText(ctx, text, columnWidth)) {
        out.push({ kind: 'text', text: line });
    }
}

function pushChecklistRows(out, ctx, item, columnWidth, fontSize) {
    const { header, rows } = itemToActiveChecklistRows(item);
    if (!rows.length) return;
    if (header) pushTextLines(out, ctx, header, columnWidth);

    const box = fontSize * 0.85;
    const gap = fontSize * 0.35;
    const indentUnit = fontSize * 0.9;

    for (const row of rows) {
        const indentPx = (row.indentLevel || 0) * indentUnit;
        const textMax = Math.max(40, columnWidth - indentPx - box - gap);
        const wrapped = wrapPlainText(ctx, row.text, textMax);
        wrapped.forEach((line, i) => {
            out.push({
                kind: 'check',
                text: line,
                indentLevel: row.indentLevel || 0,
                showBox: i === 0
            });
        });
    }
}

/**
 * Build structured overlay lines (plain text + checklist rows with empty boxes).
 * @param {object} item
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} fontSize
 * @param {number} columnWidth
 * @returns {{ lines: object[], isPlaceholder: boolean }}
 */
function buildOverlayLines(item, ctx, fontSize, columnWidth) {
    migrateNoteCanvasTextFlags(item);
    const showContent = !!item?.canvasShowNoteContent;
    const showChecklist = !!item?.canvasShowNoteChecklist;
    if (!showContent && !showChecklist) return { lines: [], isPlaceholder: false };

    const { text, isPlaceholder } = resolveNoteOverlayPlainText(item);
    if (!text) return { lines: [], isPlaceholder: false };

    if (isPlaceholder) {
        return {
            lines: wrapPlainText(ctx, text, columnWidth).map((line) => ({ kind: 'text', text: line })),
            isPlaceholder: true
        };
    }

    const lines = [];
    const content = showContent ? itemToPlainContentText(item).trim() : '';
    const checklistPlain = showChecklist ? itemToPlainActiveChecklistText(item).trim() : '';

    if (content) pushTextLines(lines, ctx, content, columnWidth);
    if (content && checklistPlain) lines.push({ kind: 'text', text: '' });
    if (checklistPlain) pushChecklistRows(lines, ctx, item, columnWidth, fontSize);

    return { lines, isPlaceholder: false };
}

/**
 * Measure wrapped overlay lines for the note.
 * @param {object} item
 * @param {CanvasRenderingContext2D} [ctx]
 */
export function measureNoteTextOverlay(item, ctx = null) {
    const measureCtx = ctx || makeMeasureCtx();
    const columnWidth = noteTextColumnWidth();
    const fontSize = resolveOverlayFontSize(item);
    const lineStep = lineStepFor(fontSize);
    if (!measureCtx) {
        return {
            lines: [],
            fontSize,
            lineStep,
            pad: PAD,
            columnWidth,
            textHeight: 0,
            isPlaceholder: false
        };
    }
    measureCtx.font = overlayFont(fontSize);
    const { lines, isPlaceholder } = buildOverlayLines(item, measureCtx, fontSize, columnWidth);
    return {
        lines,
        fontSize,
        lineStep,
        pad: PAD,
        columnWidth,
        textHeight: lines.length ? PAD * 2 + lines.length * lineStep : 0,
        isPlaceholder
    };
}

function pageContentHeight(doc, fontSize) {
    const dims = getPageDimensions(doc);
    return Math.max(lineStepFor(fontSize), dims.height - PAD * 2);
}

function linesPerPage(doc, fontSize) {
    return Math.max(1, Math.floor(pageContentHeight(doc, fontSize) / lineStepFor(fontSize)));
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

    const perPage = linesPerPage(doc, measured.fontSize);
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

function paintOverlayLines(ctx, lines, { fillColor, isPlaceholder, fontSize, lineStep } = {}) {
    const box = fontSize * 0.85;
    const gap = fontSize * 0.35;
    const indentUnit = fontSize * 0.9;
    const ink = contrastInkForBackground(fillColor);

    ctx.save();
    ctx.font = overlayFont(fontSize);
    ctx.textBaseline = 'top';
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, fontSize * 0.08);
    if (isPlaceholder) ctx.globalAlpha = 0.42;

    let y = PAD;
    for (const line of lines) {
        if (line.kind === 'check') {
            const indentPx = (line.indentLevel || 0) * indentUnit;
            const x = PAD + indentPx;
            if (line.showBox) {
                const boxY = y + Math.max(0, (lineStep - box) * 0.2);
                ctx.strokeRect(x, boxY, box, box);
            }
            if (line.text) ctx.fillText(line.text, x + box + gap, y);
        } else if (line.text) {
            ctx.fillText(line.text, PAD, y);
        }
        y += lineStep;
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
        const perPage = linesPerPage(doc, measured.fontSize);
        const start = Math.max(0, pageIndex) * perPage;
        lines = measured.lines.slice(start, start + perPage);
    }
    if (!lines.length) return;
    paintOverlayLines(ctx, lines, {
        fillColor,
        isPlaceholder: measured.isPlaceholder,
        fontSize: measured.fontSize,
        lineStep: measured.lineStep
    });
}

/** Active page index for paged overlay painting. */
export function activePageIndex(doc) {
    if (!doc?.pages?.length) return 0;
    const page = getActivePage(doc);
    const idx = doc.pages.findIndex((p) => p.id === page?.id);
    return idx >= 0 ? idx : 0;
}
