/** @module {"owns":"planner table/chart paint + measure for note-canvas overlay", "related":["noteCanvasTextOverlay.js","planner.js","plannerGantt.js"]} */
import {
    PLANNER_COLUMNS,
    PLANNER_COL_COUNT,
    derivePlannerTasks,
    getPlannerField,
    plannerHasContent
} from './planner.js';
import { layoutPlannerGantt } from './plannerGantt.js';
import {
    getColWidth,
    SHEET_ROW_HEAD_WIDTH_PX,
    sheetGridTotalWidthPx
} from './sheet.js';

const CELL_PAD_X = 4;
const BLOCK_GAP = 16;

/**
 * @param {object} [item]
 * @returns {boolean}
 */
export function notePlannerIsActive(item) {
    return !!(item?.planner && !item?.plannerHidden);
}

/**
 * @param {object} [item]
 * @returns {boolean}
 */
export function noteShowsPlannerTableOverlay(item) {
    return notePlannerIsActive(item) && !!item?.canvasShowNotePlannerTable;
}

/**
 * @param {object} [item]
 * @returns {boolean}
 */
export function noteShowsPlannerChartOverlay(item) {
    return notePlannerIsActive(item) && !!item?.canvasShowNotePlannerChart;
}

/**
 * Scale sheet column widths so the table fits a target content width when needed.
 * @param {object} sheet
 * @param {number} fontSize
 * @param {number} [maxContentWidth]
 * @returns {{ widths: number[], rowHead: number, scale: number, totalWidth: number, rowHeight: number }}
 */
function resolveTableGeometry(sheet, fontSize, maxContentWidth = Infinity) {
    const natural = sheetGridTotalWidthPx(sheet, { includeStructCol: false });
    const scale = Number.isFinite(maxContentWidth) && natural > maxContentWidth && natural > 0
        ? maxContentWidth / natural
        : 1;
    const rowHead = Math.max(14, Math.round(SHEET_ROW_HEAD_WIDTH_PX * Math.max(scale, fontSize / 14)));
    const widths = [];
    for (let c = 0; c < PLANNER_COL_COUNT; c++) {
        widths.push(Math.max(28, Math.round(getColWidth(sheet, c) * scale * Math.max(1, fontSize / 14))));
    }
    const totalWidth = rowHead + widths.reduce((s, w) => s + w, 0);
    const rowHeight = Math.max(18, Math.round(fontSize * 1.45));
    return { widths, rowHead, scale, totalWidth, rowHeight };
}

/**
 * Measure planner table (sheet only — no summary stats).
 * @param {object} item
 * @param {number} fontSize
 * @param {number} [maxContentWidth]
 * @returns {{ width: number, height: number, geometry: object, rows: number, isPlaceholder: boolean, hasData: boolean }|null}
 */
export function measurePlannerTableOverlay(item, fontSize, maxContentWidth = Infinity) {
    if (!noteShowsPlannerTableOverlay(item)) return null;
    const sheet = item.planner?.sheet;
    if (!sheet) {
        return {
            width: Math.min(280, maxContentWidth),
            height: Math.max(28, fontSize * 1.6),
            geometry: null,
            rows: 0,
            isPlaceholder: true,
            hasData: false
        };
    }
    const geometry = resolveTableGeometry(sheet, fontSize, maxContentWidth);
    const rows = Math.max(0, sheet.rows | 0);
    const hasData = plannerHasContent(item.planner);
    const headerH = geometry.rowHeight;
    const bodyH = Math.max(1, rows) * geometry.rowHeight;
    const height = hasData || rows
        ? headerH + bodyH
        : Math.max(28, fontSize * 1.6);
    return {
        width: geometry.totalWidth,
        height,
        geometry,
        rows,
        isPlaceholder: !hasData,
        hasData
    };
}

/**
 * Measure planner Gantt chart overlay.
 * @param {object} item
 * @param {number} fontSize
 * @returns {{ width: number, height: number, layout: object, isPlaceholder: boolean }|null}
 */
export function measurePlannerChartOverlay(item, fontSize) {
    if (!noteShowsPlannerChartOverlay(item)) return null;
    const planner = item.planner;
    const tasks = derivePlannerTasks(planner);
    const rowHeight = Math.max(18, Math.round(fontSize * 1.15));
    const labelWidth = Math.max(48, Math.round(fontSize * 3.2));
    const layout = layoutPlannerGantt(tasks, {
        zoom: planner?.zoom || 'week',
        rowHeight,
        labelWidth
    });
    return {
        width: (layout.labelWidth || 0) + (layout.chartWidth || 0),
        height: layout.height || rowHeight,
        layout,
        isPlaceholder: !!layout.empty
    };
}

export function plannerOverlayBlockGap() {
    return BLOCK_GAP;
}

/**
 * Paint sheet-only planner table at (x, y).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} item
 * @param {{ x: number, y: number, fontSize: number, ink: string, fontFamily: string, measured?: object }} opts
 * @returns {number} height painted
 */
export function paintPlannerTableOverlay(ctx, item, opts) {
    const {
        x, y, fontSize, ink, fontFamily,
        measured = measurePlannerTableOverlay(item, fontSize)
    } = opts;
    if (!measured) return 0;

    ctx.save();
    ctx.font = `${Math.max(10, Math.round(fontSize * 0.85))}px ${fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, fontSize * 0.06);

    if (!measured.hasData || !measured.geometry) {
        ctx.globalAlpha = 0.42;
        ctx.fillText('No planner rows yet — add them in the note editor.', x, y + fontSize * 0.7);
        ctx.restore();
        return measured.height;
    }

    const sheet = item.planner.sheet;
    const { widths, rowHead, rowHeight, totalWidth } = measured.geometry;
    const headerH = rowHeight;
    const tableH = headerH + Math.max(1, measured.rows) * rowHeight;

    // Outer frame + header fill wash
    ctx.globalAlpha = 0.12;
    ctx.fillRect(x, y, totalWidth, headerH);
    ctx.globalAlpha = 1;

    ctx.strokeRect(x + 0.5, y + 0.5, totalWidth - 1, tableH - 1);

    // Vertical grid
    let cx = x + rowHead;
    for (let c = 0; c < PLANNER_COL_COUNT; c++) {
        ctx.beginPath();
        ctx.moveTo(cx + 0.5, y);
        ctx.lineTo(cx + 0.5, y + tableH);
        ctx.stroke();
        cx += widths[c];
    }
    // Row-head divider
    ctx.beginPath();
    ctx.moveTo(x + rowHead + 0.5, y);
    ctx.lineTo(x + rowHead + 0.5, y + tableH);
    ctx.stroke();

    // Horizontal grid
    for (let r = 0; r <= measured.rows; r++) {
        const ly = y + headerH + r * rowHeight;
        ctx.beginPath();
        ctx.moveTo(x, ly + 0.5);
        ctx.lineTo(x + totalWidth, ly + 0.5);
        ctx.stroke();
    }
    // Header bottom
    ctx.beginPath();
    ctx.moveTo(x, y + headerH + 0.5);
    ctx.lineTo(x + totalWidth, y + headerH + 0.5);
    ctx.stroke();

    const clipAndFill = (tx, ty, tw, th, text, bold = false) => {
        const label = String(text || '');
        if (!label) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(tx, ty, tw, th);
        ctx.clip();
        if (bold) ctx.font = `600 ${Math.max(10, Math.round(fontSize * 0.8))}px ${fontFamily}`;
        else ctx.font = `${Math.max(10, Math.round(fontSize * 0.85))}px ${fontFamily}`;
        ctx.fillText(label, tx + CELL_PAD_X, ty + th / 2);
        ctx.restore();
    };

    // Header labels
    cx = x + rowHead;
    for (let c = 0; c < PLANNER_COL_COUNT; c++) {
        clipAndFill(cx, y, widths[c], headerH, PLANNER_COLUMNS[c].label, true);
        cx += widths[c];
    }

    // Body cells
    for (let r = 0; r < measured.rows; r++) {
        const ry = y + headerH + r * rowHeight;
        clipAndFill(x, ry, rowHead, rowHeight, String(r + 1), true);
        cx = x + rowHead;
        for (let c = 0; c < PLANNER_COL_COUNT; c++) {
            const key = PLANNER_COLUMNS[c].key;
            const value = getPlannerField(sheet, r, key);
            clipAndFill(cx, ry, widths[c], rowHeight, value);
            cx += widths[c];
        }
    }

    ctx.restore();
    return measured.height;
}

function strokeGanttEdge(ctx, path) {
    const raw = String(path || '');
    if (!raw) return;
    const tokens = raw.match(/[MHV][^MHV]*/g);
    if (!tokens?.length) return;
    ctx.beginPath();
    let x = 0;
    let y = 0;
    let started = false;
    for (const tok of tokens) {
        const cmd = tok[0];
        const nums = tok.slice(1).split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n));
        if (cmd === 'M' && nums.length >= 2) {
            x = nums[0];
            y = nums[1];
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.moveTo(x, y);
            }
        } else if (cmd === 'H' && nums.length >= 1) {
            x = nums[0];
            if (started) ctx.lineTo(x, y);
        } else if (cmd === 'V' && nums.length >= 1) {
            y = nums[0];
            if (started) ctx.lineTo(x, y);
        }
    }
    if (started) ctx.stroke();
}

/**
 * Paint planner Gantt chart at (x, y).
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} item
 * @param {{ x: number, y: number, fontSize: number, ink: string, fontFamily: string, measured?: object }} opts
 * @returns {number} height painted
 */
export function paintPlannerChartOverlay(ctx, item, opts) {
    const {
        x, y, fontSize, ink, fontFamily,
        measured = measurePlannerChartOverlay(item, fontSize)
    } = opts;
    if (!measured?.layout) return 0;

    const layout = measured.layout;
    const {
        labelWidth, chartWidth, height, headerHeight, majorBandH = 0,
        majors = [], minors = [], bands = [], bars = [], edges = [], todayX, empty
    } = layout;
    const minorTicks = minors.length ? minors : (layout.ticks || []);
    const bodyH = Math.max(0, height - headerHeight);

    ctx.save();
    ctx.translate(x, y);
    ctx.font = `${Math.max(9, Math.round(fontSize * 0.7))}px ${fontFamily}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, fontSize * 0.05);

    // Label rail
    ctx.globalAlpha = 0.1;
    ctx.fillRect(0, 0, labelWidth, height);
    ctx.globalAlpha = 1;
    ctx.strokeRect(0.5, 0.5, labelWidth - 1, height - 1);

    const railLabels = empty
        ? [{ name: '—', y: headerHeight + (layout.rowHeight || 22) / 2 }]
        : bars.map((b) => ({ name: b.name || b.id || '—', y: b.y + b.height / 2 }));
    for (const row of railLabels) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(2, row.y - (layout.rowHeight || 22) / 2, labelWidth - 4, layout.rowHeight || 22);
        ctx.clip();
        ctx.globalAlpha = empty ? 0.42 : 0.85;
        ctx.fillText(String(row.name), 6, row.y + 3);
        ctx.restore();
    }

    // Chart area
    ctx.save();
    ctx.translate(labelWidth, 0);

    ctx.globalAlpha = 0.08;
    if (majorBandH > 0) ctx.fillRect(0, 0, chartWidth, headerHeight);
    ctx.fillRect(0, headerHeight, chartWidth, bodyH);
    ctx.globalAlpha = 1;
    ctx.strokeRect(0.5, 0.5, chartWidth - 1, height - 1);

    for (const b of bands || []) {
        if (!(b.width > 0)) continue;
        ctx.globalAlpha = b.alt ? 0.06 : 0.03;
        ctx.fillRect(b.x, headerHeight, b.width, bodyH);
    }
    ctx.globalAlpha = 1;

    const majorY = majorBandH > 0 ? majorBandH - 3 : 0;
    for (const m of majors || []) {
        if (!(m.width > 0)) continue;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(m.x + 0.5, 0);
        ctx.lineTo(m.x + 0.5, height);
        ctx.stroke();
        ctx.globalAlpha = 0.85;
        if (m.label) ctx.fillText(String(m.label), m.x + 3, majorY || 11);
        if (majorBandH > 0) {
            ctx.globalAlpha = 0.25;
            ctx.beginPath();
            ctx.moveTo(m.x, majorBandH + 0.5);
            ctx.lineTo(m.x + m.width, majorBandH + 0.5);
            ctx.stroke();
        }
    }

    const minorY = headerHeight - 4;
    for (const t of minorTicks) {
        ctx.globalAlpha = t.major ? 0.35 : 0.18;
        ctx.beginPath();
        ctx.moveTo(t.x + 0.5, majorBandH);
        ctx.lineTo(t.x + 0.5, height);
        ctx.stroke();
        if (t.label) {
            ctx.globalAlpha = t.weekend ? 0.55 : 0.75;
            ctx.fillText(String(t.label), t.x + 2, minorY);
        }
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.45;
    for (const e of edges) strokeGanttEdge(ctx, e.path);
    ctx.globalAlpha = 1;

    for (const b of bars) {
        const fill = b.categoryColor || ink;
        ctx.fillStyle = fill;
        ctx.globalAlpha = b.categoryColor ? 0.85 : 0.55;
        const rx = 2;
        const bw = Math.max(2, b.width);
        const bh = Math.max(2, b.height);
        roundRect(ctx, b.x, b.y, bw, bh, rx);
        ctx.fill();
    }
    ctx.fillStyle = ink;
    ctx.globalAlpha = 1;

    if (todayX != null) {
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = Math.max(1.5, fontSize * 0.08);
        ctx.beginPath();
        ctx.moveTo(todayX + 0.5, 0);
        ctx.lineTo(todayX + 0.5, height);
        ctx.stroke();
        ctx.lineWidth = Math.max(1, fontSize * 0.05);
        ctx.globalAlpha = 1;
    }

    if (empty) {
        ctx.globalAlpha = 0.42;
        ctx.fillText('Add Start dates in the table to see bars', 12, headerHeight + 28);
        ctx.globalAlpha = 1;
    }

    ctx.restore();
    ctx.restore();
    return measured.height;
}

function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}
