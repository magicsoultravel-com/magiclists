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

function drawStaffBlock(ctx, width, top, lineGap, lineStartX) {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    drawTrebleClef(ctx, 28, top, lineGap);
    for (let i = 0; i < 5; i++) {
        const y = top + i * lineGap;
        ctx.beginPath();
        ctx.moveTo(lineStartX, y);
        ctx.lineTo(width - 24, y);
        ctx.stroke();
    }
}

function drawFootballField(ctx, width, height, margin = 40) {
    const fieldLeft = margin;
    const fieldRight = width - margin;
    const fieldTop = margin;
    const fieldBottom = height - margin;
    
    const fieldWidth = fieldRight - fieldLeft;
    const fieldHeight = fieldBottom - fieldTop;
    
    // Center line
    const centerX = (fieldLeft + fieldRight) / 2;
    
    // Center circle
    const centerCircleRadius = fieldWidth * 0.10;
    
    // Penalty areas
    const penaltyAreaLength = fieldHeight * 0.15;
    const penaltyAreaWidth = fieldWidth * 0.40;
    
    // Penalty spots
    const penaltySpotX = fieldLeft + penaltyAreaLength;
    const penaltySpotXR = fieldRight - penaltyAreaLength;
    const penaltySpotY = fieldTop + fieldHeight / 2;
    
    // Goal boxes
    const goalBoxLength = fieldHeight * 0.06;
    const goalBoxWidth = fieldWidth * 0.20;
    
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.5;
    
    // Outer boundary
    ctx.strokeRect(fieldLeft, fieldTop, fieldWidth, fieldHeight);
    
    // Center line
    ctx.beginPath();
    ctx.moveTo(centerX, fieldTop);
    ctx.lineTo(centerX, fieldBottom);
    ctx.stroke();
    
    // Center circle
    ctx.beginPath();
    ctx.arc(centerX, penaltySpotY, centerCircleRadius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Left penalty area
    const leftPenaltyTop = fieldTop + (fieldHeight - penaltyAreaWidth) / 2;
    const leftPenaltyBottom = fieldTop + (fieldHeight + penaltyAreaWidth) / 2;
    
    // Left penalty box
    ctx.strokeRect(fieldLeft, leftPenaltyTop, penaltyAreaLength, penaltyAreaWidth);
    
    // Left penalty spot
    ctx.beginPath();
    ctx.arc(penaltySpotX, penaltySpotY, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Left penalty arc
    ctx.beginPath();
    ctx.arc(penaltySpotX, penaltySpotY, 8, Math.PI, 1.5 * Math.PI);
    ctx.stroke();
    
    // Right penalty area
    const rightPenaltyTop = leftPenaltyTop;
    const rightPenaltyBottom = leftPenaltyBottom;
    
    // Right penalty box
    ctx.strokeRect(fieldRight - penaltyAreaLength, rightPenaltyTop, penaltyAreaLength, penaltyAreaWidth);
    
    // Right penalty spot
    ctx.beginPath();
    ctx.arc(penaltySpotXR, penaltySpotY, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Right penalty arc
    ctx.beginPath();
    ctx.arc(penaltySpotXR, penaltySpotY, 8, 1.5 * Math.PI, 2 * Math.PI);
    ctx.stroke();
    
    // Goal boxes (smaller areas at each end)
    const goalBoxTop = fieldTop + (fieldHeight - goalBoxWidth) / 2;
    const goalBoxBottom = fieldTop + (fieldHeight + goalBoxWidth) / 2;
    
    // Left goal box
    ctx.strokeRect(fieldLeft, goalBoxTop, goalBoxLength, goalBoxWidth);
    
    // Right goal box
    ctx.strokeRect(fieldRight - goalBoxLength, goalBoxTop, goalBoxLength, goalBoxWidth);
    
    // Corner arc ticks (small arcs at corners)
    const cornerRadius = 12;
    
    // Top-left corner tick
    ctx.beginPath();
    ctx.arc(fieldLeft + cornerRadius, fieldTop + cornerRadius, cornerRadius, Math.PI, 1.5 * Math.PI);
    ctx.stroke();
    
    // Top-right corner tick
    ctx.beginPath();
    ctx.arc(fieldRight - cornerRadius, fieldTop + cornerRadius, cornerRadius, 1.5 * Math.PI, 2 * Math.PI);
    ctx.stroke();
    
    // Bottom-left corner tick
    ctx.beginPath();
    ctx.arc(fieldLeft + cornerRadius, fieldBottom - cornerRadius, cornerRadius, 0.5 * Math.PI, Math.PI);
    ctx.stroke();
    
    // Bottom-right corner tick
    ctx.beginPath();
    ctx.arc(fieldRight - cornerRadius, fieldBottom - cornerRadius, cornerRadius, 0, 0.5 * Math.PI);
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
        const staffGap = 96;
        const lineGap = 8;
        for (let top = 40; top < height; top += staffGap) {
            drawStaffBlock(ctx, width, top, lineGap, 48);
        }
    } else if (type === 'football') {
        drawFootballField(ctx, width, height);
    }
    ctx.restore();
}