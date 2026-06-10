export function renderBackground(ctx, type, width, height, { spacing = 24, fillColor = '' } = {}) {
    ctx.clearRect(0, 0, width, height);
    const fallback = getComputedStyle(document.documentElement).getPropertyValue('--desktop-bg').trim()
        || getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim()
        || '#121214';
    const bg = fillColor || fallback || '#121214';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    if (type === 'blank' || !type) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;

    if (type === 'grid') {
        for (let x = spacing; x < width; x += spacing) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = spacing; y < height; y += spacing) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
    } else if (type === 'notebook') {
        const margin = Math.floor(width * 0.12);
        ctx.strokeStyle = 'rgba(248,113,113,0.35)';
        ctx.beginPath();
        ctx.moveTo(margin, 0);
        ctx.lineTo(margin, height);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        const lineH = 32;
        for (let y = 48; y < height; y += lineH) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
    } else if (type === 'staff') {
        const staffGap = 96;
        const lineGap = 8;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        for (let top = 40; top < height; top += staffGap) {
            for (let i = 0; i < 5; i++) {
                const y = top + i * lineGap;
                ctx.beginPath();
                ctx.moveTo(24, y);
                ctx.lineTo(width - 24, y);
                ctx.stroke();
            }
        }
    }
    ctx.restore();
}
