export const BRUSH_STYLES = ['pen', 'marker', 'highlighter', 'pencil', 'spray', 'calligraphy', 'brush'];

export const STYLE_CONFIG = {
    pen: { alpha: 1, widthMul: 1, pressureMin: 0.08, pressureRange: 1.22, pressureAlpha: true, alphaMin: 0.4, alphaRange: 0.6 },
    marker: { alpha: 0.85, widthMul: 1, pressureMin: 0.15, pressureRange: 1.0, pressureAlpha: true, alphaMin: 0.5, alphaRange: 0.45 },
    highlighter: { alpha: 0.35, widthMul: 1.8, pressureMin: 0.5, pressureRange: 0.6, pressureAlpha: true, alphaMin: 0.28, alphaRange: 0.12 },
    pencil: { alpha: 0.55, widthMul: 1, pressureMin: 0.1, pressureRange: 1.15, pressureAlpha: true, alphaMin: 0.35, alphaRange: 0.55, grain: true },
    spray: { alpha: 0.7, widthMul: 1.2, pressureMin: 0.2, pressureRange: 0.95, spray: true },
    // Gothic / broad-edge nib: flat chisel stamp at a fixed ~45° angle
    calligraphy: { alpha: 1, widthMul: 1.15, pressureMin: 0.85, pressureRange: 0.35, calligraphy: true },
    // Chinese / Sumi ink brush: soft ellipse, strong pressure response
    brush: { alpha: 0.88, widthMul: 1.35, pressureMin: 0.12, pressureRange: 1.35, pressureAlpha: true, alphaMin: 0.35, alphaRange: 0.65, cjk: true }
};

/** Default gothic nib angle (radians). Pen tilt overrides when available. */
const NIB_ANGLE = -Math.PI / 4;

function normalizePressure(p) {
    const clamped = Math.max(0, Math.min(1, p ?? 0.5));
    return Math.pow(clamped, 0.5);
}

export function effectiveWidth(baseWidth, pressure, style) {
    const cfg = STYLE_CONFIG[style] || STYLE_CONFIG.pen;
    const p = normalizePressure(pressure);
    return baseWidth * cfg.widthMul * (cfg.pressureMin + cfg.pressureRange * p);
}

export function effectiveAlpha(baseAlpha, pressure, style) {
    const cfg = STYLE_CONFIG[style] || STYLE_CONFIG.pen;
    if (!cfg.pressureAlpha) return baseAlpha;
    const p = normalizePressure(pressure);
    return baseAlpha * (cfg.alphaMin + cfg.alphaRange * p);
}

function drawPencilGrain(ctx, x, y, w) {
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#ffffff';
    const r = Math.max(w * 0.3, 1);
    ctx.beginPath();
    ctx.arc(x + r * 0.3, y - r * 0.2, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function sprayDots(ctx, x, y, w, color, alpha, density = 8) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    const spread = w * 1.5;
    const count = Math.min(density, 10);
    for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.random() * spread;
        const dot = Math.max(0.4, w * 0.08 * Math.random());
        ctx.beginPath();
        ctx.arc(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad, dot, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function stampAt(ctx, stroke, style, cfg, x, y, p) {
    const w = effectiveWidth(stroke.width, p, style);
    ctx.globalAlpha = effectiveAlpha(cfg.alpha, p, style);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(w / 2, 0.4), 0, Math.PI * 2);
    ctx.fill();
    if (cfg.grain) drawPencilGrain(ctx, x, y, w);
}

function stampSegment(ctx, stroke, style, cfg, a, b) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const midW = effectiveWidth(stroke.width, (a.p + b.p) / 2, style);
    // Larger step = fewer stamps; keep continuous look for grainy/pencil styles.
    const step = Math.max(midW * 0.55, cfg.grain ? 2.2 : 1.6);
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const p = a.p + (b.p - a.p) * t;
        stampAt(ctx, stroke, style, cfg, x, y, p);
    }
}

/**
 * Resolve gothic nib angle. Prefer pen tilt when present; otherwise fixed 45°.
 */
function resolveNibAngle(pt) {
    const tx = pt?.tiltX || 0;
    const ty = pt?.tiltY || 0;
    if (Math.abs(tx) > 2 || Math.abs(ty) > 2) {
        return Math.atan2(ty, tx);
    }
    return NIB_ANGLE;
}

/**
 * Flat chisel / broad-nib stamp — classic gothic thick/thin from stroke direction.
 * Shape is a thin rhombus (flat tip) rotated to the nib angle.
 */
function stampChisel(ctx, x, y, nibW, nibAngle, alpha) {
    const half = Math.max(nibW / 2, 0.6);
    const tip = Math.max(nibW * 0.12, 0.45);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(nibAngle);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    // Rhombus: long along nib edge, sharp on the writing face
    ctx.moveTo(-half, 0);
    ctx.lineTo(0, -tip);
    ctx.lineTo(half, 0);
    ctx.lineTo(0, tip);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

/**
 * Soft Sumi / Chinese ink-brush stamp — ellipse along travel, pressure drives size.
 */
function stampInkBrush(ctx, x, y, w, angle, alpha) {
    const rx = Math.max(w * 0.55, 0.5);
    const ry = Math.max(w * 0.32, 0.35);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // Soft wet edge — lighter outer halo
    ctx.globalAlpha = alpha * 0.22;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 1.35, ry * 1.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function stampChiselSegment(ctx, stroke, style, cfg, a, b) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const midW = effectiveWidth(stroke.width, (a.p + b.p) / 2, style);
    const step = Math.max(midW * 0.22, 1.1);
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const p = a.p + (b.p - a.p) * t;
        const pt = { tiltX: a.tiltX + ((b.tiltX || 0) - (a.tiltX || 0)) * t, tiltY: a.tiltY + ((b.tiltY || 0) - (a.tiltY || 0)) * t };
        const nibW = effectiveWidth(stroke.width, p, style);
        stampChisel(ctx, x, y, nibW, resolveNibAngle(pt), cfg.alpha);
    }
}

function stampInkBrushSegment(ctx, stroke, style, cfg, a, b) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const midW = effectiveWidth(stroke.width, (a.p + b.p) / 2, style);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const step = Math.max(midW * 0.28, 1.4);
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const p = a.p + (b.p - a.p) * t;
        const w = effectiveWidth(stroke.width, p, style);
        const alpha = effectiveAlpha(cfg.alpha, p, style);
        stampInkBrush(ctx, x, y, w, angle, alpha);
    }
}

export function drawBrushStroke(ctx, stroke) {
    const pts = stroke.points;
    if (!pts?.length) return;
    const cfg = STYLE_CONFIG[stroke.style] || STYLE_CONFIG.pen;
    const style = stroke.style || 'pen';

    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (cfg.spray) {
        pts.forEach((pt) => {
            const w = effectiveWidth(stroke.width, pt.p, style);
            sprayDots(ctx, pt.x, pt.y, w, stroke.color, effectiveAlpha(cfg.alpha, pt.p, style), Math.floor(4 + Math.min(w, 12) * 0.45));
        });
        ctx.restore();
        return;
    }

    if (pts.length === 1) {
        if (cfg.calligraphy) {
            const w = effectiveWidth(stroke.width, pts[0].p, style);
            stampChisel(ctx, pts[0].x, pts[0].y, w, resolveNibAngle(pts[0]), cfg.alpha);
        } else if (cfg.cjk) {
            const w = effectiveWidth(stroke.width, pts[0].p, style);
            stampInkBrush(ctx, pts[0].x, pts[0].y, w, 0, effectiveAlpha(cfg.alpha, pts[0].p, style));
        } else {
            stampAt(ctx, stroke, style, cfg, pts[0].x, pts[0].y, pts[0].p);
        }
        ctx.restore();
        return;
    }

    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];

        if (cfg.calligraphy) {
            stampChiselSegment(ctx, stroke, style, cfg, a, b);
            continue;
        }

        if (cfg.cjk) {
            stampInkBrushSegment(ctx, stroke, style, cfg, a, b);
            continue;
        }

        stampSegment(ctx, stroke, style, cfg, a, b);
    }
    ctx.restore();
}

function shapeBBox(stroke) {
    const { x0, y0, x1, y1 } = stroke;
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    return { left, top, right: left + w, bottom: top + h, w, h, cx: left + w / 2, cy: top + h / 2 };
}

function drawArrow(ctx, stroke) {
    const { x0, y0, x1, y1 } = stroke;
    const head = Math.max(8, (stroke.width || 2) * 3);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(ang - 0.45), y1 - head * Math.sin(ang - 0.45));
    ctx.lineTo(x1 - head * Math.cos(ang + 0.45), y1 - head * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fillStyle = stroke.color;
    ctx.fill();
}

function drawTriangle(ctx, b) {
    ctx.beginPath();
    ctx.moveTo(b.cx, b.top);
    ctx.lineTo(b.left, b.bottom);
    ctx.lineTo(b.right, b.bottom);
    ctx.closePath();
    ctx.stroke();
}

function drawDiamond(ctx, b) {
    ctx.beginPath();
    ctx.moveTo(b.cx, b.top);
    ctx.lineTo(b.right, b.cy);
    ctx.lineTo(b.cx, b.bottom);
    ctx.lineTo(b.left, b.cy);
    ctx.closePath();
    ctx.stroke();
}

function drawRoundedRect(ctx, b) {
    const r = Math.min(12, b.w / 4, b.h / 4);
    if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(b.left, b.top, Math.max(b.w, 1), Math.max(b.h, 1), r);
        ctx.stroke();
        return;
    }
    ctx.strokeRect(b.left, b.top, Math.max(b.w, 1), Math.max(b.h, 1));
}

function drawStar(ctx, b) {
    const outer = Math.min(b.w, b.h) / 2;
    const inner = outer * 0.42;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = b.cx + r * Math.cos(ang);
        const y = b.cy + r * Math.sin(ang);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
}

function drawChevron(ctx, b) {
    const inset = b.w * 0.2;
    ctx.beginPath();
    ctx.moveTo(b.left, b.top);
    ctx.lineTo(b.right - inset, b.cy);
    ctx.lineTo(b.left, b.bottom);
    ctx.stroke();
}

function drawTrapezoid(ctx, b) {
    const inset = b.w * 0.2;
    ctx.beginPath();
    ctx.moveTo(b.left + inset, b.top);
    ctx.lineTo(b.right - inset, b.top);
    ctx.lineTo(b.right, b.bottom);
    ctx.lineTo(b.left, b.bottom);
    ctx.closePath();
    ctx.stroke();
}

function drawParallelogram(ctx, b) {
    const skew = b.w * 0.25;
    ctx.beginPath();
    ctx.moveTo(b.left + skew, b.top);
    ctx.lineTo(b.right, b.top);
    ctx.lineTo(b.right - skew, b.bottom);
    ctx.lineTo(b.left, b.bottom);
    ctx.closePath();
    ctx.stroke();
}

function drawCube(ctx, b) {
    const d = Math.min(b.w, b.h) * 0.28;
    const fL = b.left, fT = b.top + d, fR = b.right - d, fB = b.bottom;
    const bL = b.left + d, bT = b.top, bR = b.right, bB = b.bottom - d;
    ctx.beginPath();
    ctx.rect(fL, fT, fR - fL, fB - fT);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(fL, fT); ctx.lineTo(bL, bT);
    ctx.moveTo(fR, fT); ctx.lineTo(bR, bT);
    ctx.moveTo(fR, fB); ctx.lineTo(bR, bB);
    ctx.moveTo(bL, bT); ctx.lineTo(bR, bT); ctx.lineTo(bR, bB); ctx.lineTo(bL, bB); ctx.lineTo(bL, bT);
    ctx.stroke();
}

function drawPyramid(ctx, b) {
    const inset = b.w * 0.08;
    ctx.beginPath();
    ctx.rect(b.left + inset, b.bottom - Math.min(b.w, b.h) * 0.35, b.w - inset * 2, Math.min(b.w, b.h) * 0.35);
    ctx.stroke();
    const apexX = b.cx;
    const apexY = b.top;
    const bl = b.left + inset;
    const br = b.right - inset;
    const bb = b.bottom;
    ctx.beginPath();
    ctx.moveTo(apexX, apexY);
    ctx.lineTo(bl, bb);
    ctx.moveTo(apexX, apexY);
    ctx.lineTo(br, bb);
    ctx.moveTo(apexX, apexY);
    ctx.lineTo(b.cx, bb - Math.min(b.w, b.h) * 0.35);
    ctx.stroke();
}

function drawCylinder(ctx, b) {
    const ry = Math.max(b.h * 0.12, 4);
    const topY = b.top + ry;
    const botY = b.bottom - ry;
    ctx.beginPath();
    ctx.ellipse(b.cx, topY, Math.max(b.w / 2, 1), ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(b.cx, botY, Math.max(b.w / 2, 1), ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b.left, topY);
    ctx.lineTo(b.left, botY);
    ctx.moveTo(b.right, topY);
    ctx.lineTo(b.right, botY);
    ctx.stroke();
}

function drawSphere(ctx, b) {
    const rx = Math.max(b.w / 2, 1);
    const ry = Math.max(b.h / 2, 1);
    ctx.beginPath();
    ctx.ellipse(b.cx, b.cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(b.cx, b.cy, rx * 0.92, ry * 0.35, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(b.cx, b.cy, rx * 0.35, ry * 0.92, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b.cx, b.top);
    ctx.lineTo(b.cx, b.bottom);
    ctx.stroke();
}

export function drawShapeStroke(ctx, stroke) {
    const cfg = STYLE_CONFIG[stroke.style] || STYLE_CONFIG.pen;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = (stroke.width || 2) * cfg.widthMul;
    ctx.globalAlpha = cfg.alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const { x0, y0, x1, y1, tool } = stroke;
    const b = shapeBBox(stroke);

    if (tool === 'line') {
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
    } else if (tool === 'arrow') {
        drawArrow(ctx, stroke);
    } else if (tool === 'rect') {
        ctx.strokeRect(b.left, b.top, Math.max(b.w, 1), Math.max(b.h, 1));
    } else if (tool === 'rounded_rect') {
        drawRoundedRect(ctx, b);
    } else if (tool === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(b.cx, b.cy, Math.max(b.w / 2, 0.5), Math.max(b.h / 2, 0.5), 0, 0, Math.PI * 2);
        ctx.stroke();
    } else if (tool === 'triangle') {
        drawTriangle(ctx, b);
    } else if (tool === 'diamond') {
        drawDiamond(ctx, b);
    } else if (tool === 'star') {
        drawStar(ctx, b);
    } else if (tool === 'chevron') {
        drawChevron(ctx, b);
    } else if (tool === 'trapezoid') {
        drawTrapezoid(ctx, b);
    } else if (tool === 'parallelogram') {
        drawParallelogram(ctx, b);
    } else if (tool === 'cube') {
        drawCube(ctx, b);
    } else if (tool === 'pyramid') {
        drawPyramid(ctx, b);
    } else if (tool === 'cylinder') {
        drawCylinder(ctx, b);
    } else if (tool === 'sphere') {
        drawSphere(ctx, b);
    }
    ctx.restore();
}

export function drawTextObject(ctx, textObj) {
    if (!textObj?.text) return;
    ctx.save();
    ctx.fillStyle = textObj.color || '#f1f5f9';
    ctx.font = `${textObj.fontSize || 24}px ${textObj.fontFamily || 'Inter, sans-serif'}`;
    ctx.textBaseline = 'top';
    String(textObj.text).split('\n').forEach((line, i) => {
        ctx.fillText(line, textObj.x, textObj.y + i * (textObj.fontSize || 24) * 1.25);
    });
    ctx.restore();
}
