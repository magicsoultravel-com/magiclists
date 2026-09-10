function drawTrebleClef(ctx, x, staffTop, lineGap) {
    const gLine = staffTop + lineGap * 3;
    const s = lineGap * 0.72;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(1.1, lineGap * 0.14);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.translate(x, gLine);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(2, 5.5);
    ctx.bezierCurveTo(-6, 5, -9, -1, -5, -7);
    ctx.bezierCurveTo(-1, -12, 7, -9, 6, -3);
    ctx.bezierCurveTo(5, 2, -1, 5, -4, 4);
    ctx.bezierCurveTo(-8, 2, -6, -4, -1, -3);
    ctx.bezierCurveTo(4, -2, 6, 3, 3, 6.5);
    ctx.bezierCurveTo(1, 8.5, -2, 9, -3.5, 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(3, 7);
    ctx.bezierCurveTo(5, 9, 4, 11.5, 1.5, 12);
    ctx.bezierCurveTo(-0.5, 12.4, -2, 11, -1, 9);
    ctx.stroke();
    ctx.restore();
}

function drawSquareGrid(ctx, width, height, spacing, majorEvery = 0) {
    const minor = 'rgba(255,255,255,0.08)';
    const major = 'rgba(255,255,255,0.16)';
    let xi = 0;
    for (let x = spacing; x < width; x += spacing) {
        xi += 1;
        ctx.beginPath();
        ctx.strokeStyle = majorEvery && xi % majorEvery === 0 ? major : minor;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    let yi = 0;
    for (let y = spacing; y < height; y += spacing) {
        yi += 1;
        ctx.beginPath();
        ctx.strokeStyle = majorEvery && yi % majorEvery === 0 ? major : minor;
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
}

function drawDotGrid(ctx, width, height, spacing) {
    const r = Math.max(1, spacing * 0.08);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    for (let y = spacing; y < height; y += spacing) {
        for (let x = spacing; x < width; x += spacing) {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawIsometricGrid(ctx, width, height, spacing) {
    const stroke = 'rgba(255,255,255,0.08)';
    const diag = spacing * Math.sqrt(3);
    ctx.strokeStyle = stroke;
    for (let x = 0; x < width + height; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x - height, height);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + height, height);
        ctx.stroke();
    }
    for (let y = 0; y < height; y += diag) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
}

function drawHexCell(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const ang = (Math.PI / 3) * i - Math.PI / 6;
        const x = cx + r * Math.cos(ang);
        const y = cy + r * Math.sin(ang);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
}

function drawHexGrid(ctx, width, height, spacing) {
    const r = spacing * 0.45;
    const rowH = spacing * 0.78;
    const colW = spacing * 0.9;
    let row = 0;
    for (let y = r; y < height + r; y += rowH, row++) {
        const offset = row % 2 ? colW * 0.5 : 0;
        for (let x = r + offset; x < width + r; x += colW) {
            drawHexCell(ctx, x, y, r);
        }
    }
}

function drawRuledLines(ctx, width, height, lineH = 32, startY = 48) {
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    for (let y = startY; y < height; y += lineH) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
}

function drawStaffBlock(ctx, width, top, lineGap, lineStartX, clefX = 28) {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    drawTrebleClef(ctx, clefX, top, lineGap);
    for (let i = 0; i < 5; i++) {
        const y = top + i * lineGap;
        ctx.beginPath();
        ctx.moveTo(lineStartX, y);
        ctx.lineTo(width - 24, y);
        ctx.stroke();
    }
}

function drawFootballField(ctx, width, height, margin = 40) {
    // FIFA pitch ~105×68 — fit at 100% inside the page without stretching.
    const pitchAspect = 105 / 68;
    const availW = Math.max(1, width - margin * 2);
    const availH = Math.max(1, height - margin * 2);
    let fieldWidth;
    let fieldHeight;
    if (availW / availH > pitchAspect) {
        fieldHeight = availH;
        fieldWidth = fieldHeight * pitchAspect;
    } else {
        fieldWidth = availW;
        fieldHeight = fieldWidth / pitchAspect;
    }
    const fieldLeft = (width - fieldWidth) / 2;
    const fieldTop = (height - fieldHeight) / 2;
    const fieldRight = fieldLeft + fieldWidth;
    const fieldBottom = fieldTop + fieldHeight;

    const centerX = fieldLeft + fieldWidth / 2;
    const centerY = fieldTop + fieldHeight / 2;
    const scale = fieldWidth / 1050;

    const centerCircleRadius = fieldWidth * 0.10;
    const penaltyAreaDepth = fieldWidth * 0.16;
    const penaltyAreaWidth = fieldHeight * 0.52;
    const goalBoxDepth = fieldWidth * 0.055;
    const goalBoxWidth = fieldHeight * 0.24;
    const spotR = Math.max(2, 3.5 * scale);
    const arcR = Math.max(10, fieldWidth * 0.09);
    const cornerRadius = Math.max(8, 14 * scale);

    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(1.25, 1.75 * scale);

    ctx.strokeRect(fieldLeft, fieldTop, fieldWidth, fieldHeight);

    ctx.beginPath();
    ctx.moveTo(centerX, fieldTop);
    ctx.lineTo(centerX, fieldBottom);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(centerX, centerY, centerCircleRadius, 0, Math.PI * 2);
    ctx.stroke();

    const leftPenaltyTop = centerY - penaltyAreaWidth / 2;
    ctx.strokeRect(fieldLeft, leftPenaltyTop, penaltyAreaDepth, penaltyAreaWidth);
    ctx.beginPath();
    ctx.arc(fieldLeft + penaltyAreaDepth, centerY, spotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(fieldLeft + penaltyAreaDepth, centerY, arcR, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    ctx.strokeRect(fieldRight - penaltyAreaDepth, leftPenaltyTop, penaltyAreaDepth, penaltyAreaWidth);
    ctx.beginPath();
    ctx.arc(fieldRight - penaltyAreaDepth, centerY, spotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(fieldRight - penaltyAreaDepth, centerY, arcR, Math.PI / 2, -Math.PI / 2);
    ctx.stroke();

    const goalBoxTop = centerY - goalBoxWidth / 2;
    ctx.strokeRect(fieldLeft, goalBoxTop, goalBoxDepth, goalBoxWidth);
    ctx.strokeRect(fieldRight - goalBoxDepth, goalBoxTop, goalBoxDepth, goalBoxWidth);

    ctx.beginPath();
    ctx.arc(fieldLeft + cornerRadius, fieldTop + cornerRadius, cornerRadius, Math.PI, Math.PI * 1.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(fieldRight - cornerRadius, fieldTop + cornerRadius, cornerRadius, Math.PI * 1.5, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(fieldLeft + cornerRadius, fieldBottom - cornerRadius, cornerRadius, Math.PI * 0.5, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(fieldRight - cornerRadius, fieldBottom - cornerRadius, cornerRadius, 0, Math.PI * 0.5);
    ctx.stroke();
}

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
        drawSquareGrid(ctx, width, height, spacing);
    } else if (type === 'dots') {
        drawDotGrid(ctx, width, height, spacing);
    } else if (type === 'graph') {
        drawSquareGrid(ctx, width, height, 12, 5);
    } else if (type === 'coarse') {
        drawSquareGrid(ctx, width, height, 48);
    } else if (type === 'isometric') {
        drawIsometricGrid(ctx, width, height, spacing);
    } else if (type === 'ruled') {
        drawRuledLines(ctx, width, height);
    } else if (type === 'hex') {
        drawHexGrid(ctx, width, height, spacing);
    } else if (type === 'notebook') {
        const margin = Math.floor(width * 0.12);
        ctx.strokeStyle = 'rgba(248,113,113,0.35)';
        ctx.beginPath();
        ctx.moveTo(margin, 0);
        ctx.lineTo(margin, height);
        ctx.stroke();
        drawRuledLines(ctx, width, height);
    } else if (type === 'staff') {
        // Scale to ~100% of A4 reference so staves stay readable on every page size.
        const refH = 1754;
        const scale = Math.max(0.45, height / refH);
        const lineGap = Math.max(7, 12 * scale);
        const staffHeight = lineGap * 4;
        const staffGap = Math.max(staffHeight + 28, 96 * scale);
        const margin = Math.max(24, 40 * scale);
        const clefX = Math.max(20, 28 * scale);
        const lineStartX = Math.max(40, 52 * scale);
        for (let top = margin; top + staffHeight < height - margin * 0.5; top += staffGap) {
            drawStaffBlock(ctx, width, top, lineGap, lineStartX, clefX);
        }
    } else if (type === 'football') {
        drawFootballField(ctx, width, height);
    }
    ctx.restore();
}