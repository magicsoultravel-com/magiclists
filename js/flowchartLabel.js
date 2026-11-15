/** @module {"owns":"magicCanvas shape and connector label layout - the one wrap, size and centring model shared by the canvas painter and the inline editor", "related":["canvasBrushes.js","flowchart.js","drawingBoardFlowchart.js","drawingBoard/view.js"]} */
import {
    FLOW_LABEL_DEFAULT,
    fitFlowLabelFontSize,
    normalizeFlowLabelSize
} from './flowchart.js';

/**
 * The painter's font stack, repeated in the editor's inline styles. Both sides
 * must name the same families or the preview re-wraps with different glyph
 * widths — the editor used to inherit `system-ui` from the body and disagreed
 * with every label the canvas drew in Inter.
 */
export const FLOW_LABEL_FONT_STACK = 'Inter, system-ui, sans-serif';

/** Line advance as a multiple of the font size: painter lineH AND CSS line-height. */
export const FLOW_LABEL_LINE_HEIGHT = 1.2;

/** Horizontal inset inside a shape box, in canvas units (CSS px on screen: /dpr). */
export const FLOW_LABEL_PAD = 6;

function finiteOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Geometry of the box a label belongs to.
 *
 * Shapes centre their block in the bounding box; connectors centre it on the
 * routed bend point, because a zero-width (vertical) connector has no usable
 * bounding box.
 *
 * @param {object} stroke shape or connector stroke
 * @returns {{isConnector: boolean, left: number, top: number, w: number, h: number, centerX: number, centerY: number}}
 */
export function flowLabelBox(stroke) {
    const isConnector = stroke?.tool === 'connector';
    const x0 = finiteOr(stroke?.x0, 0);
    const y0 = finiteOr(stroke?.y0, 0);
    const x1 = finiteOr(stroke?.x1, 0);
    const y1 = finiteOr(stroke?.y1, 0);
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    const centerX = isConnector ? finiteOr(stroke?.midX, (x0 + x1) / 2) : left + w / 2;
    const centerY = isConnector ? finiteOr(stroke?.midY, (y0 + y1) / 2) : top + h / 2;
    return { isConnector, left, top, w, h, centerX, centerY };
}

/** Width a wrapped label may use; connectors never wrap (see wrapLabelLines). */
export function flowLabelMaxWidth(box) {
    if (!box || box.isConnector) return Infinity;
    return Math.max(10, box.w - FLOW_LABEL_PAD * 2);
}

/**
 * Font size a target gets when its editor opens: an explicit stored size always
 * wins, a brand-new label is fitted to its box (connectors use the default).
 * @param {object} stroke
 * @returns {number} canvas units
 */
export function flowLabelInitialFontSize(stroke) {
    const stored = stroke?.label?.fontSize;
    if (stored) return normalizeFlowLabelSize(stored);
    if (stroke?.tool === 'connector') return normalizeFlowLabelSize(FLOW_LABEL_DEFAULT);
    return normalizeFlowLabelSize(fitFlowLabelFontSize(flowLabelBox(stroke).h));
}


/**
 * Break a word that is wider than the box, one character at a time. This is the
 * canvas twin of CSS `overflow-wrap: anywhere`; without it the painter would
 * push an unbreakable run onto one overflowing line while the editor's browser
 * split it, and the two would disagree.
 */
function breakLongWord(word, limit, measure) {
    const parts = [];
    let current = '';
    for (const ch of word) {
        const next = current + ch;
        if (current && measure(next) > limit) {
            parts.push(current);
            current = ch;
        } else {
            current = next;
        }
    }
    if (current) parts.push(current);
    return parts;
}

/**
 * Split label text into painted lines.
 *
 * Soft breaks win over wrapping: every line the user typed with Shift+Enter is
 * wrapped on its own, so `\n` is never collapsed into a space (the old painter
 * split on `/\s+/` and silently merged every multi-line label). Empty lines are
 * kept as blank lines, exactly like `white-space: pre-wrap`.
 *
 * @param {string} text
 * @param {number} maxWidth painted width limit in canvas units (Infinity = no wrap)
 * @param {(text: string) => number} measure text width function (ctx.measureText)
 * @returns {string[]}
 */
export function wrapLabelLines(text, maxWidth, measure) {
    const src = String(text ?? '');
    if (!src) return [];
    const limit = Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : Infinity;
    const measureFn = typeof measure === 'function' ? measure : (line) => String(line).length;
    const lines = [];
    for (const paragraph of src.split('\n')) {
        const words = paragraph.split(/[ \t]+/).filter(Boolean);
        if (!words.length) {
            lines.push('');
            continue;
        }
        let current = '';
        for (const word of words) {
            if (measureFn(word) > limit) {
                if (current) {
                    lines.push(current);
                    current = '';
                }
                const parts = breakLongWord(word, limit, measureFn);
                lines.push(...parts.slice(0, -1));
                current = parts[parts.length - 1] || '';
                continue;
            }
            const next = current ? current + ' ' + word : word;
            if (!current || measureFn(next) <= limit) current = next;
            else {
                lines.push(current);
                current = word;
            }
        }
        if (current) lines.push(current);
    }
    return lines;
}


/**
 * Everything the painter needs: lines, the exact size, and where the block sits.
 *
 * The block is centred on `centerY` — the shape's vertical middle or the
 * connector's bend point — and every line advances by `lineHeight`, the same
 * numbers the editor's flex box / line boxes produce.
 *
 * @param {object} stroke
 * @param {(text: string) => number} measure
 * @returns {{box: object, lines: string[], fontSize: number, lineHeight: number, centerX: number, blockTop: number, blockHeight: number}|null}
 */
export function flowLabelCanvasLayout(stroke, measure) {
    const label = stroke?.label;
    const text = label ? String(label.text || '') : '';
    if (!text.trim()) return null;
    const box = flowLabelBox(stroke);
    const fontSize = normalizeFlowLabelSize(label.fontSize);
    const lineHeight = fontSize * FLOW_LABEL_LINE_HEIGHT;
    const lines = wrapLabelLines(text, flowLabelMaxWidth(box), measure);
    if (!lines.length) return null;
    const blockHeight = lines.length * lineHeight;
    return {
        box,
        lines,
        fontSize,
        lineHeight,
        centerX: box.centerX,
        blockTop: box.centerY - blockHeight / 2,
        blockHeight
    };
}

/**
 * Baseline of the first line, using the CSS half-leading model: a line box is
 * `lineHeight` tall, the glyph box is `ascent + descent`, and the difference is
 * split evenly above and below. Canvas' `textBaseline: 'middle'` does NOT use
 * that model, which is why labels used to sit a pixel or two higher on the
 * canvas than in the editor.
 *
 * @param {{blockTop: number, lineHeight: number}} layout
 * @param {number} ascent
 * @param {number} descent
 * @returns {number}
 */
export function flowLabelFirstBaseline(layout, ascent, descent) {
    const halfLeading = (layout.lineHeight - (ascent + descent)) / 2;
    return layout.blockTop + halfLeading + ascent;
}

/**
 * Numbers the DOM editor copies so it lays out exactly like the painter, in CSS
 * px (world coordinates divided by dpr; zoom is carried by the layer transform).
 *
 * @param {object} stroke
 * @param {{dpr?: number, fontSize?: number}} [opts] fontSize in canvas units
 * @returns {{isConnector: boolean, fontSizeCss: number, padCss: number, lineHeight: number, fontFamily: string, left: number, top: number, width: number, height: number}}
 */
export function flowLabelEditorMetrics(stroke, opts = {}) {
    const dpr = Number(opts.dpr) > 0 ? Number(opts.dpr) : 1;
    const box = flowLabelBox(stroke);
    const fontSize = normalizeFlowLabelSize(opts.fontSize ?? stroke?.label?.fontSize);
    const fontSizeCss = fontSize / dpr;
    if (box.isConnector) {
        // Width 0 + centred text: every line overflows symmetrically around the
        // bend point, which is what ctx.textAlign = 'center' does at centerX.
        return {
            isConnector: true,
            fontSizeCss,
            padCss: 0,
            lineHeight: FLOW_LABEL_LINE_HEIGHT,
            fontFamily: FLOW_LABEL_FONT_STACK,
            left: box.centerX / dpr,
            top: box.centerY / dpr,
            width: 0,
            height: 0
        };
    }
    return {
        isConnector: false,
        fontSizeCss,
        padCss: FLOW_LABEL_PAD / dpr,
        lineHeight: FLOW_LABEL_LINE_HEIGHT,
        fontFamily: FLOW_LABEL_FONT_STACK,
        left: box.left / dpr,
        top: box.top / dpr,
        width: box.w / dpr,
        height: box.h / dpr
    };
}
