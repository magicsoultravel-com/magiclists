export const BRUSH_STYLES = ['pen', 'marker', 'highlighter', 'pencil', 'spray', 'calligraphy', 'brush'];

export const STYLE_CONFIG = {
    pen: { alpha: 1, widthMul: 1, pressureMin: 0.08, pressureRange: 1.22, pressureAlpha: true, alphaMin: 0.4, alphaRange: 0.6 },
    marker: { alpha: 0.85, widthMul: 1, pressureMin: 0.15, pressureRange: 1.0, pressureAlpha: true, alphaMin: 0.5, alphaRange: 0.45 },
    highlighter: { alpha: 0.35, widthMul: 1.8, pressureMin: 0.5, pressureRange: 0.6, pressureAlpha: true, alphaMin: 0.28, alphaRange: 0.12 },
    pencil: { alpha: 0.55, widthMul: 1, pressureMin: 0.1, pressureRange: 1.15, pressureAlpha: true, alphaMin: 0.35, alphaRange: 0.55, grain: true },
    spray: { alpha: 0.7, widthMul: 1.2, pressureMin: 0.2, pressureRange: 0.95, spray: true },
    calligraphy: { alpha: 1, widthMul: 1, pressureMin: 0.12, pressureRange: 1.05, calligraphy: true },
    brush: { alpha: 0.75, widthMul: 1.4, pressureMin: 0.08, pressureRange: 1.1, cjk: true }
};

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

function sprayDots(ctx, x, y, w, color, alpha, density = 12) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    const spread = w * 1.5;
    for (let i = 0; i < density; i++) {
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
    const steps = Math.max(1, Math.ceil(dist / Math.max(midW / 3, 1)));
    for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const p = a.p + (b.p - a.p) * t;
        stampAt(ctx, stroke, style, cfg, x, y, p);
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
            sprayDots(ctx, pt.x, pt.y, w, stroke.color, effectiveAlpha(cfg.alpha, pt.p, style), Math.floor(6 + w * 2));
        });
        ctx.restore();
        return;
    }

    if (pts.length === 1) {
        stampAt(ctx, stroke, style, cfg, pts[0].x, pts[0].y, pts[0].p);
        ctx.restore();
        return;
    }

    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];

        if (cfg.calligraphy) {
            let w = effectiveWidth(stroke.width, (a.p + b.p) / 2, style);
            const tilt = Math.abs(a.tiltX || 0) + Math.abs(a.tiltY || 0);
            w *= 0.6 + Math.min(tilt / 90, 1) * 0.8;
            const angle = Math.atan2(b.y - a.y, b.x - a.x) + ((a.tiltX || 0) * Math.PI) / 360;
            ctx.globalAlpha = effectiveAlpha(cfg.alpha, (a.p + b.p) / 2, style);
            ctx.save();
            ctx.translate(a.x, a.y);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.ellipse((b.x - a.x) / 2, (b.y - a.y) / 2, Math.max(w, 0.5), Math.max(w * 0.35, 0.3), 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            continue;
        }

        if (cfg.cjk) {
            const w = effectiveWidth(stroke.width, (a.p + b.p) / 2, style);
            const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (w * 0.35)));
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                const x = a.x + (b.x - a.x) * t;
                const y = a.y + (b.y - a.y) * t;
                const taper = 0.35 + 0.65 * (1 - Math.abs(t - 0.5) * 2);
                const p = a.p + (b.p - a.p) * t;
                const pw = effectiveWidth(stroke.width, p, style) * taper;
                ctx.globalAlpha = effectiveAlpha(cfg.alpha, p, style) * (0.4 + taper * 0.5);
                ctx.beginPath();
                ctx.arc(x, y, Math.max(pw / 2, 0.4), 0, Math.PI * 2);
                ctx.fill();
            }
            continue;
        }

        stampSegment(ctx, stroke, style, cfg, a, b);
    }
    ctx.restore();
}

export function drawShapeStroke(ctx, stroke) {
    const cfg = STYLE_CONFIG[stroke.style] || STYLE_CONFIG.pen;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = (stroke.width || 2) * cfg.widthMul;
    ctx.globalAlpha = cfg.alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const { x0, y0, x1, y1, tool } = stroke;
    ctx.beginPath();
    if (tool === 'line') { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
    else if (tool === 'rect') { ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); }
    else if (tool === 'ellipse') {
        ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.max(Math.abs(x1 - x0) / 2, 0.5), Math.max(Math.abs(y1 - y0) / 2, 0.5), 0, 0, Math.PI * 2);
        ctx.stroke();
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
